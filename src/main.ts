import './style.css'
import './project-selection.css'
import { WebMapper } from 'web-mapper'
import { ProjectSelection } from './project-selection'
import IndexedDBStorage from '../../web-mapper/src/storage/indexdb'
import { Forest } from './forest'
import { BokehArtwork } from './components/bokeh';
import { bokeh } from './geometry';
import { Controls, Transports } from 'av-controls'

// Get canvas
const canvas = document.getElementById('canvas') as HTMLCanvasElement
if (!canvas) {
  throw new Error('Canvas element not found')
}

// Project selection state
let projectSelection: ProjectSelection | null = null
let artwork: ArtworkContainer | null = null

// ArtworkContainer - coordinates WebMapper and Forest (will support multiple artworks in future)
class ArtworkContainer {
  mapper: WebMapper
  forest: Forest
  bokeh: BokehArtwork
  storage: IndexedDBStorage
  isEditMode: boolean = true
  debugMode: number = 0
  startTime: number = Date.now()

  constructor(mapper: WebMapper, forest: Forest, bokeh: BokehArtwork, storage: IndexedDBStorage) {
    this.mapper = mapper
    this.forest = forest
    this.bokeh = bokeh
    this.storage = storage
  }

  dispose() {
    this.forest.dispose()
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
        this.bokeh.setResolution(vec2.fromValues(width, height))
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
        // Normal mode: render with Forest (handles all trees with shadows and audio)
        const time = (Date.now() - this.startTime) / 1000 // seconds
        this.forest.update()
        this.forest.render(time, null, this.debugMode)
        this.bokeh.render(deltaTime, null)
      }

      // WebMapper automatically renders areas/handles in edit mode
    })
  }
}

// ========== AV-CONTROLS ==========
// Trees Tab Controls
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
  artwork?.mapper.selectPreviousArea()
})

const deselectAreaPad = new Controls.Pad.Receiver(new Controls.Pad.Spec(
  new Controls.Base.Args('deselect area', 0, 45, 20, 10, '#a5a')
), () => {
  artwork?.mapper.deselectArea()
})

const nextAreaPad = new Controls.Pad.Receiver(new Controls.Pad.Spec(
  new Controls.Base.Args('next area', 0, 55, 20, 15, '#a5a')
), () => {
  artwork?.mapper.selectNextArea()
})

const deselectPointPad = new Controls.Pad.Receiver(new Controls.Pad.Spec(
  new Controls.Base.Args('deselect point', 80, 45, 20, 10, '#5aa')
), () => {
  artwork?.mapper.deselectPoint()
})

const previousPointPad = new Controls.Pad.Receiver(new Controls.Pad.Spec(
  new Controls.Base.Args('previous point', 80, 30, 20, 15, '#aa5')
), () => {
  artwork?.mapper.selectPreviousPoint()
})

const nextPointPad = new Controls.Pad.Receiver(new Controls.Pad.Spec(
  new Controls.Base.Args('next point', 80, 55, 20, 15, '#aa5')
), () => {
  artwork?.mapper.selectNextPoint()
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

  // Add bokeh area
  mapper.addArea(bokeh)

  // Enable edit mode so we can manipulate points
  mapper.setEditMode(true)

  // Create Forest - handles tree loading, management, and rendering
  const forest = new Forest(
    mapper.gl,
    mapper,
    storage,
    'trees',
    mapper.projContext,
    [canvas.width, canvas.height]
  )

  const bokehArtwork = new BokehArtwork(
    bokeh,
    mapper.gl,
    mapper.projContext
  )

  // Load trees
  await forest.loadTrees()

  // Create ArtworkContainer - coordinates WebMapper and Forest
  artwork = new ArtworkContainer(mapper, forest, bokehArtwork, storage)

  // Set up resize observer and render callback
  artwork.setupResizeObserver()
  artwork.setupRenderCallback(joystickControl, joystickSensitivityFader)

  // Set up control panel now that artwork is initialized
  setupControlPanel()

  console.log('Trees app initialized')
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

// Helper to get WebSocket URL from query params
function getWsUrl(): string | null {
  const params = new URLSearchParams(window.location.search)
  return params.get('ws') || params.get('websocket') || 'ws://localhost:8080'
}

// ========== AV-CONTROLS SETUP ==========
// Set up control panel with tabs
function setupControlPanel() {
  // Trees Tab - controls provided by Forest (no callbacks needed, Forest manages itself)
  const treesControls = artwork!.forest.getControls()
  const bokehControls = artwork!.bokeh.getControls()

  const treesTab = new Controls.Group.Receiver(new Controls.Group.SpecWithoutControls(
    new Controls.Base.Args('Trees', 0, 0, 100, 100, '#333')
  ), treesControls)

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
    'deselect area': deselectAreaPad,
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
    'Bokeh': bokehControls,
    'Mapping': mappingTab,
  })

  // Root panel
  const rootPanel = new Controls.Group.Receiver(new Controls.Group.SpecWithoutControls(
    new Controls.Base.Args('trees-app', 0, 0, 100, 100, '#111')
  ), {
    'tabs': tabs,
  })

  // Set up transport
  const wsUrl = getWsUrl()
  if (wsUrl) {
    const panels = {
      'trees-app': rootPanel,
    }
    new Transports.WebSocket.Receiver(panels, wsUrl)
    console.log(`Control panel connected to WebSocket: ${wsUrl}`)
  } else if (window.opener) {
    new Transports.Window.Receiver(window.opener, 'trees-controls', rootPanel)
    console.log('Control panel connected to opener window')
  } else {
    console.warn('No control transport found - controls will not be displayed')
  }
}

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
    await artwork.forest.addTree()
    return
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
    await artwork.forest.removeTree()
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

  // 'q' for quit project
  if (e.key === 'q') {
    exitProject()
    return
  }

  // 'a' for toggle audio reactivity (handled by Forest)
  if (e.key === 'a') {
    await artwork.forest.toggleAudioReactivity()
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
