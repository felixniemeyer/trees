import './style.css'
import './project-selection.css'
import { vec2, vec3 } from 'gl-matrix'
import { WebMapper, TriangleStripArea, Point } from 'web-mapper'
import { ProjectSelection } from './project-selection'
import IndexedDBStorage from '../../web-mapper/src/storage/indexdb'
import { Forest } from './forest'
import { Controls, Transports } from 'av-controls'

// Get canvas
const canvas = document.getElementById('canvas') as HTMLCanvasElement
if (!canvas) {
  throw new Error('Canvas element not found')
}

// Project selection state
let projectSelection: ProjectSelection | null = null
let artwork: Artwork | null = null

// Artwork class - encapsulates all mapper-dependent state and logic
class Artwork {
  mapper: WebMapper
  forest: Forest
  trees: TriangleStripArea[]
  isEditMode: boolean = true
  debugMode: number = 0
  startTime: number = Date.now()

  // Audio reactivity
  audioContext: AudioContext | null = null
  analyser: AnalyserNode | null = null
  audioDataArray: Float32Array<ArrayBuffer> | null = null
  audioEnabled: boolean = false
  audioEnergies: number[] = []

  // Storage reference
  storage: IndexedDBStorage

  constructor(mapper: WebMapper, trees: TriangleStripArea[], storage: IndexedDBStorage) {
    this.mapper = mapper
    this.trees = trees
    this.storage = storage
    this.forest = new Forest(mapper.gl, trees, mapper.projContext, mapper, [canvas.width, canvas.height])
  }

  dispose() {
    this.forest.dispose()
  }

  // Tree management methods
  async addTree() {
    const newIndex = this.trees.length
    const newTree = await this.mapper.loadOrCreateArea(`tree-${newIndex}`, () => createDefaultTree(newIndex))
    this.trees.push(newTree as TriangleStripArea)
    await this.storage.saveArea('tree-count', this.trees.length)
    this.forest.dispose()
    this.forest = new Forest(this.mapper.gl, this.trees, this.mapper.projContext, this.mapper, [canvas.width, canvas.height])
    console.log(`Added tree ${newIndex}. Total: ${this.trees.length}`)
  }

  async removeTree() {
    if (this.trees.length === 0) return
    const lastTree = this.trees.pop()!
    if ((lastTree as any).storageKey) {
      await this.storage.saveArea((lastTree as any).storageKey, null)
    }
    this.mapper.removeArea(lastTree)
    await this.storage.saveArea('tree-count', this.trees.length)
    this.forest.dispose()
    if (this.trees.length > 0) {
      this.forest = new Forest(this.mapper.gl, this.trees, this.mapper.projContext, this.mapper, [canvas.width, canvas.height])
    }
    console.log(`Removed tree. Total: ${this.trees.length}`)
  }

  // Audio methods
  async initAudio() {
    try {
      this.audioContext = new AudioContext()
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const source = this.audioContext.createMediaStreamSource(stream)

      this.analyser = this.audioContext.createAnalyser()
      this.analyser.fftSize = 2048
      this.analyser.smoothingTimeConstant = 0.3

      source.connect(this.analyser)

      this.audioDataArray = new Float32Array(this.analyser.frequencyBinCount)
      this.audioEnergies = new Array(this.trees.length).fill(0)

      console.log('Audio initialized - microphone active')
      return true
    } catch (error) {
      console.error('Failed to initialize audio:', error)
      return false
    }
  }

  async toggleAudioReactivity() {
    if (!this.audioEnabled && !this.audioContext) {
      const success = await this.initAudio()
      if (success) {
        this.audioEnabled = true
        console.log('Audio reactivity: ON')
        return true
      }
      return false
    } else {
      this.audioEnabled = !this.audioEnabled
      console.log(`Audio reactivity: ${this.audioEnabled ? 'ON' : 'OFF'}`)
      return this.audioEnabled
    }
  }

  toggleEditMode() {
    // Don't toggle edit mode in photo mode (photo mode always has edit mode enabled)
    if (this.mapper.getPhotoMode()) {
      console.log('Cannot disable edit mode in photo mode')
      return
    }
    this.isEditMode = !this.isEditMode
    this.mapper.setEditMode(this.isEditMode)
    console.log(`Edit mode: ${this.isEditMode ? 'ON' : 'OFF'}`)
  }

  async togglePhotoMode() {
    const currentPhotoMode = this.mapper.getPhotoMode()
    const newPhotoMode = !currentPhotoMode
    this.mapper.setPhotoMode(newPhotoMode)
    console.log(`${newPhotoMode ? 'Photo' : 'Proj'} mode`)

    // Save to project metadata
    const projectId = this.storage.getCurrentProject()
    if (projectId) {
      await this.storage.updateProjectMetadata(projectId, {
        photoMode: newPhotoMode
      })
    }
  }

  uploadPhoto() {
    const input = document.createElement('input')
    console.log('uploadPhotoPad')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0]
      if (!file) return
      const image = new Image()
      const url = URL.createObjectURL(file)
      image.onload = () => {
        this.mapper.setPhoto(image)
        console.log('Photo loaded and set. Switched to photo mode.')
        URL.revokeObjectURL(url)
      }
      image.onerror = () => {
        console.error('Failed to load photo')
        URL.revokeObjectURL(url)
      }
      image.src = url
    }
    input.click()
  }

  setupResizeObserver() {
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width
        const height = entry.contentRect.height
        console.log(`Canvas resized: ${width}x${height}`)
        ;(this.mapper as any).setResolution(width, height)
        this.forest.setResolution(width, height)
      }
    })
    resizeObserver.observe(canvas)
  }

  setupRenderCallback(joystickControl: any, joystickSensitivityFader: any) {
    this.mapper.setRenderCallback((deltaTime) => {
      const gl = this.mapper.gl

      // Joystick-based point movement
      if (joystickControl.x !== 0 || joystickControl.y !== 0) {
        const sensitivity = joystickSensitivityFader.value
        const dx = joystickControl.x * sensitivity * deltaTime * 0.001
        const dy = -joystickControl.y * sensitivity * deltaTime * 0.001

        // Move selected point if one exists
        this.mapper.moveSelectedPoint(dx, dy)
      }

      // Clear canvas with dark background
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clearColor(0.1, 0.1, 0.15, 1.0)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

      // Render artwork in proj mode (render to screen, framebuffer = null)
      if (!this.mapper.getPhotoMode() && !this.debugMode) {
        // Audio analysis
        if (this.audioEnabled && this.analyser && this.audioDataArray) {
          this.analyser.getFloatFrequencyData(this.audioDataArray)

          // Update audio energies array for each tree based on its frequency index
          if (this.audioEnergies.length !== this.trees.length) {
            this.audioEnergies = new Array(this.trees.length).fill(0)
          }

          // Forest will handle the frequency-to-bin mapping
        }

        // Normal mode: render with Forest (handles all trees with shadows)
        const time = (Date.now() - this.startTime) / 1000 // seconds
        this.forest.update()
        this.forest.render(time, null, this.audioEnabled, this.audioDataArray || new Float32Array(0), this.debugMode)
      }

      // WebMapper automatically renders areas/handles in edit mode
    })
  }
}

// ========== AV-CONTROLS ==========
// Trees Tab Controls
const addTreePad = new Controls.Pad.Receiver(new Controls.Pad.Spec(
  new Controls.Base.Args('add tree', 60, 0, 20, 15, '#4a8')
), async () => {
  await artwork?.addTree()
})

const removeTreePad = new Controls.Pad.Receiver(new Controls.Pad.Spec(
  new Controls.Base.Args('remove tree', 80, 0, 20, 15, '#a48')
), async () => {
  await artwork?.removeTree()
})

const randomizeDepthsPad = new Controls.Pad.Receiver(new Controls.Pad.Spec(
  new Controls.Base.Args('randomize depths', 0, 0, 20, 15, '#8a4')
), () => {
  artwork?.forest.randomizeDepths()
})

// Tree selection controls
const previousTreePad = new Controls.Pad.Receiver(new Controls.Pad.Spec(
  new Controls.Base.Args('previous tree', 0, 45, 20, 15, '#5a8')
), () => {
  artwork?.forest.selectPreviousTree()
})

const nextTreePad = new Controls.Pad.Receiver(new Controls.Pad.Spec(
  new Controls.Base.Args('next tree', 20, 45, 20, 15, '#5a8')
), () => {
  artwork?.forest.selectNextTree()
})

const deselectTreePad = new Controls.Pad.Receiver(new Controls.Pad.Spec(
  new Controls.Base.Args('deselect tree', 40, 45, 20, 15, '#858')
), () => {
  artwork?.forest.deselectTree()
})

const increaseOctavesPad = new Controls.Pad.Receiver(new Controls.Pad.Spec(
  new Controls.Base.Args('increase octaves', 60, 45, 20, 15, '#4a5')
), () => {
  artwork?.forest.increaseOctaves()
})

const decreaseOctavesPad = new Controls.Pad.Receiver(new Controls.Pad.Spec(
  new Controls.Base.Args('decrease octaves', 80, 45, 20, 15, '#5a4')
), () => {
  artwork?.forest.decreaseOctaves()
})

const shadowSizeFader = new Controls.Fader.Receiver(
  new Controls.Fader.Spec(
    new Controls.Base.Args('shadow size', 0, 15, 20, 30, '#58a'),
    0.25, 0, 1, 2
  ),
  (value) => {
    artwork?.forest.setShadowSize(value)
  }
)

const shadowAlphaFader = new Controls.Fader.Receiver(
  new Controls.Fader.Spec(
    new Controls.Base.Args('shadow alpha', 20, 15, 20, 30, '#58a'),
    0.02, 0, 0.1, 3
  ),
  (value) => {
    artwork?.forest.setShadowAlpha(value)
  }
)

const shadowAmountFader = new Controls.Fader.Receiver(
  new Controls.Fader.Spec(
    new Controls.Base.Args('shadow amount', 40, 15, 20, 30, '#58a'),
    1.5, 0, 3, 2
  ),
  (value) => {
    artwork?.forest.setShadowAmount(value)
  }
)

const audioScaleFader = new Controls.Fader.Receiver(
  new Controls.Fader.Spec(
    new Controls.Base.Args('audio scale', 60, 15, 20, 30, '#a85'),
    0.5, 0, 1, 2
  ),
  (value) => {
    artwork?.forest.setAudioReactivityScale(value)
  }
)

const audioToggle = new Controls.Switch.Receiver(
  new Controls.Switch.Spec(
    new Controls.Base.Args('audio reactivity', 20, 0, 20, 15, '#a85'),
    false
  ),
  async () => {
    if (artwork) {
      const enabled = await artwork.toggleAudioReactivity()
      audioToggle.on = enabled
    }
  }
)

const shuffleFrequenciesPad = new Controls.Pad.Receiver(new Controls.Pad.Spec(
  new Controls.Base.Args('shuffle frequencies', 40, 0, 20, 15, '#a58')
), () => {
  artwork?.forest.shuffleFrequencies()
})

// Mapping Tab Controls (from regenbogenanglerfisch)
const toggleUIControl = new Controls.Pad.Receiver(new Controls.Pad.Spec(
  new Controls.Base.Args('toggle edit mode', 20, 0, 20, 15, '#888')
), () => {
  artwork?.toggleEditMode()
})

const resetPositionsButton = new Controls.ConfirmButton.Receiver(
  new Controls.ConfirmButton.Spec(
    new Controls.Base.Args('reset mapping points', 0, 15, 20, 15, '#f44')
  ),
  async () => {
    await artwork?.mapper.resetAll()
  }
)

const exitProjectPad = new Controls.Pad.Receiver(new Controls.Pad.Spec(
  new Controls.Base.Args('exit project', 0, 0, 20, 15, '#a44')
), async () => {
  await exitProject()
})

const uploadPhotoPad = new Controls.Pad.Receiver(new Controls.Pad.Spec(
  new Controls.Base.Args('upload photo', 40, 15, 20, 15, '#4a4')
), () => {
  artwork?.uploadPhoto()
})

const modeTogglePad = new Controls.Pad.Receiver(new Controls.Pad.Spec(
  new Controls.Base.Args('toggle photo/proj', 40, 0, 20, 15, '#48a')
), async () => {
  await artwork?.togglePhotoMode()
})

const debugModeSelect = new Controls.Selector.Receiver(
  new Controls.Selector.Spec(
    new Controls.Base.Args('debug mode', 20, 15, 20, 15, '#844'),
    ['Off', 'Vertex ID', 'Every Vertex'],
    0
  ),
  (value) => {
    if (artwork) {
      artwork.debugMode = value
      const modeNames = ['Off', 'Vertex ID', 'Every Vertex']
      console.log(`Debug mode: ${modeNames[value]}`)
    }
  }
)

const joystickControl = new Controls.Joystick.Receiver(
  new Controls.Joystick.Spec(
    new Controls.Base.Args('joystick', 20, 30, 60, 40, '#4a8'),
    { x: 0, y: 0 }
  ),
)

const snapRadiusFader = new Controls.Fader.Receiver(
  new Controls.Fader.Spec(
    new Controls.Base.Args('snap radius', 80, 0, 20, 30, '#585'),
    0.05, 0, 0.1, 2
  )
)

const snappingToggle = new Controls.Switch.Receiver(
  new Controls.Switch.Spec(
    new Controls.Base.Args('snapping', 60, 15, 20, 15, '#636'),
    true
  )
)

const handleSizeFader = new Controls.Fader.Receiver(
  new Controls.Fader.Spec(
    new Controls.Base.Args('handle size', 60, 70, 20, 30, '#474'),
    0.05, 0, 0.1, 2
  ),
  (value) => {
    artwork?.mapper.setHandleSize(value)
  }
)

const handleLineWidthFader = new Controls.Fader.Receiver(
  new Controls.Fader.Spec(
    new Controls.Base.Args('handle line width', 80, 70, 20, 30, '#447'),
    0.1, 0.1, 0.5, 2
  ),
  (value) => {
    artwork?.mapper.setHandleLineWidth(value)
  }
)

const previousAreaPad = new Controls.Pad.Receiver(new Controls.Pad.Spec(
  new Controls.Base.Args('previous area', 0, 30, 20, 15, '#a5a')
), () => {
  // TODO: implement selectPreviousArea
  console.log('Previous area (not implemented)')
})

const nextAreaPad = new Controls.Pad.Receiver(new Controls.Pad.Spec(
  new Controls.Base.Args('next area', 0, 55, 20, 15, '#a5a')
), () => {
  // TODO: implement selectNextArea
  console.log('Next area (not implemented)')
})

const deselectPointPad = new Controls.Pad.Receiver(new Controls.Pad.Spec(
  new Controls.Base.Args('deselect point', 80, 45, 20, 10, '#5aa')
), () => {
  // TODO: implement deselectPoint
  console.log('Deselect point (not implemented)')
})

const previousPointPad = new Controls.Pad.Receiver(new Controls.Pad.Spec(
  new Controls.Base.Args('previous point', 80, 30, 20, 15, '#aa5')
), () => {
  // TODO: implement selectPreviousPoint
  console.log('Previous point (not implemented)')
})

const nextPointPad = new Controls.Pad.Receiver(new Controls.Pad.Spec(
  new Controls.Base.Args('next point', 80, 55, 20, 15, '#aa5')
), () => {
  // TODO: implement selectNextPoint
  console.log('Next point (not implemented)')
})

const moveGroupedPointsSwitch = new Controls.Switch.Receiver(
  new Controls.Switch.Spec(
    new Controls.Base.Args('move grouped points', 60, 0, 20, 15, '#a5a'),
    true
  ),
)

const cursorWidthFader = new Controls.Fader.Receiver(
  new Controls.Fader.Spec(
    new Controls.Base.Args('cursor width', 0, 70, 20, 30, '#774'),
    0.005, 0.001, 0.02, 3
  ),
  (value) => {
    artwork?.mapper.setCursorWidth(value)
  }
)

const cursorLengthFader = new Controls.Fader.Receiver(
  new Controls.Fader.Spec(
    new Controls.Base.Args('cursor length', 20, 70, 20, 30, '#774'),
    0.5, 0, 2, 2
  ),
  (value) => {
    artwork?.mapper.setCursorLength(value)
  }
)

const joystickSensitivityFader = new Controls.Fader.Receiver(
  new Controls.Fader.Spec(
    new Controls.Base.Args('joystick sensitivity', 40, 70, 20, 30, '#927'),
    1, 0.1, 2, 2
  )
)

// Create storage instance (shared for project management)
const storage = new IndexedDBStorage('trees', 'v1.0.0')
await storage.init()

// Helper function to generate colors for trees
function generateColor(index: number): vec3 {
  const colors = [
    vec3.fromValues(0.3, 0.8, 0.6), // green
    vec3.fromValues(1.0, 0.3, 0.3), // red
    vec3.fromValues(0.3, 0.5, 1.0), // blue
    vec3.fromValues(1.0, 0.8, 0.2), // yellow
    vec3.fromValues(1.0, 0.4, 0.8), // magenta
    vec3.fromValues(0.2, 0.9, 0.9), // cyan
  ]
  return colors[index % colors.length]!
}

// Helper function to create default tree
function createDefaultTree(index: number): TriangleStripArea {
  const points = [
    new Point(vec2.fromValues(-0.2, -0.2), 0),
    new Point(vec2.fromValues(0.2, -0.2), 0),
    new Point(vec2.fromValues(-0.2, 0.2), 0),
    new Point(vec2.fromValues(0.2, 0.2), 0),
  ]
  const color = generateColor(index)
  const angle = 0
  // Don't pass storage to constructor - will be set up later via setStorage()
  return new TriangleStripArea(points, color, angle)
}

// Initialize project function
async function initializeProject(projectId: string) {
  // Set current project in storage
  storage.setCurrentProject(projectId)

  // Update project's last modified timestamp
  await storage.touchProject(projectId)

  // Load project metadata to get saved photoMode
  const project = await storage.getProject(projectId)
  const savedPhotoMode = project?.photoMode ?? false  // default to proj mode

  // Create WebMapper with the storage
  const mapper = new WebMapper(canvas, {
    artworkId: 'trees',
    storage: {
      get: (key: string) => storage.loadArea(key),
      set: (key: string, value: any) => storage.saveArea(key, value),
      delete: async (key: string) => storage.saveArea(key, null),
      deleteAndRecreate: () => storage.deleteAndRecreate()
    }
  })

  // Set photo mode from saved state
  mapper.setPhotoMode(savedPhotoMode)

  // Enable edit mode so we can manipulate points
  mapper.setEditMode(true)

  // Load trees from storage
  const treeCount = await storage.loadArea('tree-count') || 1
  const trees: TriangleStripArea[] = []

  for (let i = 0; i < treeCount; i++) {
    const tree = await mapper.loadOrCreateArea(`tree-${i}`, () => createDefaultTree(i))
    trees.push(tree as TriangleStripArea)
  }

  // Create Artwork instance - encapsulates all mapper-dependent state
  artwork = new Artwork(mapper, trees, storage)

  // Set up resize observer and render callback
  artwork.setupResizeObserver()
  artwork.setupRenderCallback(joystickControl, joystickSensitivityFader)

  console.log('Trees app initialized')
  console.log(`Loaded ${trees.length} tree(s) for project ${projectId}`)
}

// Show project selection UI
function showProjectSelection() {
  projectSelection = new ProjectSelection(storage, {
    onProjectSelected: async (projectId: string) => {
      projectSelection?.hide()
      await initializeProject(projectId)
    },
    onProjectCreated: async (name: string) => {
      const project = await storage.createProject(name)
      projectSelection?.hide()
      await initializeProject(project.id)
    }
  })
  projectSelection.show()
}

// Exit current project and show selection
async function exitProject() {
  if (!artwork) return

  // Save thumbnail and photo mode before exiting
  const projectId = storage.getCurrentProject()
  if (projectId) {
    try {
      const thumbnail = artwork.mapper.captureProjectThumbnail()
      const photoMode = artwork.mapper.getPhotoMode()
      await storage.updateProjectMetadata(projectId, {
        thumbnail,
        photoMode
      })
    } catch (error) {
      console.error('Failed to save project state:', error)
    }
  }

  // Clear current state
  artwork.dispose()
  artwork.mapper.destroy()
  artwork = null

  // Show project selection
  showProjectSelection()
}

// ========== AV-CONTROLS SETUP ==========
// Set up control panel with tabs
function setupControlPanel() {
  // Trees Tab
  const treesTab = new Controls.Group.Receiver(new Controls.Group.SpecWithoutControls(
    new Controls.Base.Args('Trees', 0, 0, 100, 100, '#333')
  ), {
    'add tree': addTreePad,
    'remove tree': removeTreePad,
    'randomize depths': randomizeDepthsPad,
    'previous tree': previousTreePad,
    'next tree': nextTreePad,
    'deselect tree': deselectTreePad,
    'increase octaves': increaseOctavesPad,
    'decrease octaves': decreaseOctavesPad,
    'shadow size': shadowSizeFader,
    'shadow alpha': shadowAlphaFader,
    'shadow amount': shadowAmountFader,
    'audio scale': audioScaleFader,
    'audio reactivity': audioToggle,
    'shuffle frequencies': shuffleFrequenciesPad,
  })

  // Mapping Tab
  const mappingTab = new Controls.Group.Receiver(new Controls.Group.SpecWithoutControls(
    new Controls.Base.Args('Mapping', 0, 0, 100, 100, '#333')
  ), {
    'toggle edit mode': toggleUIControl,
    'reset mapping points': resetPositionsButton,
    'exit project': exitProjectPad,
    'upload photo': uploadPhotoPad,
    'photo mode': modeTogglePad,
    'debug mode': debugModeSelect,
    'joystick': joystickControl,
    'snap radius': snapRadiusFader,
    'snapping': snappingToggle,
    'handle size': handleSizeFader,
    'handle line width': handleLineWidthFader,
    'previous area': previousAreaPad,
    'next area': nextAreaPad,
    'deselect point': deselectPointPad,
    'previous point': previousPointPad,
    'next point': nextPointPad,
    'move grouped points': moveGroupedPointsSwitch,
    'cursor width': cursorWidthFader,
    'cursor length': cursorLengthFader,
    'joystick sensitivity': joystickSensitivityFader,
  })

  // Create tabs
  const tabs = new Controls.Tabs.Receiver(new Controls.Tabs.SpecWithoutControls(
    new Controls.Base.Args('trees-controls', 0, 0, 100, 100, '#222'),
    'Trees' // initially active tab
  ), {
    'Trees': treesTab,
    'Mapping': mappingTab,
  })

  // Root panel
  const rootPanel = new Controls.Group.Receiver(new Controls.Group.SpecWithoutControls(
    new Controls.Base.Args('trees-app', 0, 0, 100, 100, '#111')
  ), {
    'tabs': tabs,
  })

  // Set up Window transport
  if (window.opener) {
    new Transports.Window.Receiver(window.opener, 'trees-controls', rootPanel)
    console.log('Control panel connected to opener window')
  } else {
    console.warn('No opener window found - controls will not be displayed')
  }
}

// Initialize controls after project is loaded
setupControlPanel()

// Check for last used project or show selection
const lastProjectId = storage.getLastUsedProject()
if (lastProjectId) {
  const project = await storage.getProject(lastProjectId)
  if (project) {
    await initializeProject(lastProjectId)
  } else {
    // Project no longer exists
    showProjectSelection()
  }
} else {
  showProjectSelection()
}

// Keyboard handlers
document.addEventListener('keydown', async (e) => {
  if (!artwork) return

  // Shift for WebMapper precision mode
  if (e.key === 'Shift') {
    artwork.mapper.setShiftHeld(true)
    return
  }

  // Arrow keys for tree management
  if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
    await artwork.addTree()
    return
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
    await artwork.removeTree()
    return
  }

  // 'p' for upload photo
  if (e.key === 'p') {
    artwork.uploadPhoto()
    return
  }

  // 'm' for toggle photo/proj mode
  if (e.key === 'm') {
    await artwork.togglePhotoMode()
    return
  }

  // 'e' for toggle edit mode
  if (e.key === 'e') {
    artwork.toggleEditMode()
    return
  }
})

document.addEventListener('keyup', (e) => {
  if (e.key === 'Shift' && artwork) {
    artwork.mapper.setShiftHeld(false)
  }
})

// Log controls on startup
console.log('Trees Mapper - AV-Controls Active')
console.log('- Open control panel in separate window to access all controls')
console.log('- Shift + drag: Precision mode')
console.log('- Left click + drag: Move points')
console.log('- Shift + hover edge: Preview insertion point')
console.log('- Shift + click edge: Insert new point(s)')
