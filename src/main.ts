import './style.css'
import './project-selection.css'
import { vec2, vec3 } from 'gl-matrix'
import { WebMapper, TriangleStripArea, Point } from 'web-mapper'
import { ProjectSelection } from './project-selection'
import IndexedDBStorage from '../../web-mapper/src/storage/indexdb'
import { Forest } from './forest'

// Get canvas
const canvas = document.getElementById('canvas') as HTMLCanvasElement
if (!canvas) {
  throw new Error('Canvas element not found')
}

// Global state
let mapper: WebMapper | null = null
let isEditMode = true
let debugMode = false
let startTime = Date.now()
let trees: TriangleStripArea[] = []
let projectSelection: ProjectSelection | null = null
let forest: Forest | null = null

// Audio reactivity
let audioContext: AudioContext | null = null
let analyser: AnalyserNode | null = null
let audioDataArray: Float32Array | null = null
let audioEnabled = false
let audioEnergies: number[] = []

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

// Initialize audio system
async function initAudio() {
  try {
    audioContext = new AudioContext()
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const source = audioContext.createMediaStreamSource(stream)

    analyser = audioContext.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.3

    source.connect(analyser)

    audioDataArray = new Float32Array(analyser.frequencyBinCount)
    audioEnergies = new Array(trees.length).fill(0)

    console.log('Audio initialized - microphone active')
    return true
  } catch (error) {
    console.error('Failed to initialize audio:', error)
    return false
  }
}

// Initialize project function
async function initializeProject(projectId: string) {
  // Set current project in storage
  storage.setCurrentProject(projectId)

  // Update project's last modified timestamp
  await storage.touchProject(projectId)

  // Create WebMapper with the storage
  mapper = new WebMapper(canvas, {
    artworkId: 'trees',
    storage: {
      get: (key: string) => storage.loadArea(key),
      set: (key: string, value: any) => storage.saveArea(key, value),
      delete: async (key: string) => storage.saveArea(key, null),
      deleteAndRecreate: () => storage.deleteAndRecreate()
    }
  })

  // Enable edit mode so we can manipulate points
  isEditMode = true
  mapper.setEditMode(isEditMode)

  // Load trees from storage
  const treeCount = await storage.loadArea('tree-count') || 1
  trees = []

  for (let i = 0; i < treeCount; i++) {
    const tree = await mapper.loadOrCreateArea(`tree-${i}`, () => createDefaultTree(i))
    trees.push(tree as TriangleStripArea)
  }

  // Create Forest instance - it will handle renderer creation and metadata management
  forest = new Forest(mapper!.gl, trees, mapper!.projContext, mapper!, [canvas.width, canvas.height])

  // Set render callback
  startTime = Date.now()
  mapper.setRenderCallback((_deltaTime) => {
    if (!mapper || !forest) return
    const gl = mapper.gl

    // Clear canvas with dark background
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(0.1, 0.1, 0.15, 1.0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

    // Render artwork in proj mode (render to screen, framebuffer = null)
    if (!mapper.getPhotoMode() && !debugMode) {
      // Audio analysis
      if (audioEnabled && analyser && audioDataArray) {
        analyser.getFloatFrequencyData(audioDataArray)

        // Update audio energies array for each tree based on its frequency index
        if (audioEnergies.length !== trees.length) {
          audioEnergies = new Array(trees.length).fill(0)
        }

        // Forest will handle the frequency-to-bin mapping
      }

      // Normal mode: render with Forest (handles all trees with shadows)
      const time = (Date.now() - startTime) / 1000 // seconds
      forest.update()
      forest.render(time, null, audioEnabled, audioDataArray || new Float32Array(0))
    }

    // WebMapper automatically renders areas/handles in edit mode
  })

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
  if (!mapper) return

  // Save thumbnail before exiting
  const projectId = storage.getCurrentProject()
  if (projectId) {
    try {
      const thumbnail = mapper.captureProjectThumbnail()
      await storage.updateProjectThumbnail(projectId, thumbnail)
    } catch (error) {
      console.error('Failed to save thumbnail:', error)
    }
  }

  // Clear current state
  if (forest) {
    forest.dispose()
    forest = null
  }
  trees = []

  mapper.destroy()
  mapper = null

  // Show project selection
  showProjectSelection()
}

// Update artwork resolution on window resize
window.addEventListener('resize', () => {
  // Recreate Forest with new resolution
  if (forest && mapper) {
    forest.dispose()
    forest = new Forest(mapper.gl, trees, mapper.projContext, mapper, [canvas.width, canvas.height])
  }
})

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
  // Exit project with 'Q'
  if (e.key === 'q' || e.key === 'Q') {
    await exitProject()
    return
  }

  // Skip other handlers if no project is loaded
  if (!mapper) return

  // Toggle photo/proj mode with 'M'
  if (e.key === 'm' || e.key === 'M') {
    const currentMode = mapper.getPhotoMode()
    mapper.setPhotoMode(!currentMode)
    console.log(`Switched to ${!currentMode ? 'photo' : 'proj'} mode`)
  }

  // Toggle edit mode with 'E' (only in proj mode, photo mode always has edit mode)
  if (e.key === 'e' || e.key === 'E') {
    if (!mapper.getPhotoMode()) {
      isEditMode = !isEditMode
      mapper.setEditMode(isEditMode)
      console.log(`Edit mode: ${isEditMode ? 'ON' : 'OFF'}`)
    } else {
      console.log('Cannot disable edit mode in photo mode')
    }
  }

  // Photo upload with 'P'
  if (e.key === 'p' || e.key === 'P') {
    // Create file input element
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'

    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0]
      if (!file) return

      console.log('Photo selected:', file.name)

      // Create image element and load the file
      const image = new Image()
      const url = URL.createObjectURL(file)

      image.onload = () => {
        // Set photo in mapper (automatically switches to photo mode)
        mapper.setPhoto(image)
        console.log('Photo loaded and set. Switched to photo mode.')

        // Clean up object URL
        URL.revokeObjectURL(url)
      }

      image.onerror = () => {
        console.error('Failed to load photo')
        URL.revokeObjectURL(url)
      }

      image.src = url
    }

    // Trigger file dialog
    input.click()
  }

  // Toggle debug texture view with 'D'
  if (e.key === 'd' || e.key === 'D') {
    if (!mapper.getPhotoMode()) {
      debugMode = !debugMode
      console.log(`Debug texture view: ${debugMode ? 'ON' : 'OFF'}`)
    }
  }

  // Randomize tree depths with 'N'
  if (e.key === 'n' || e.key === 'N') {
    if (forest) {
      forest.randomizeDepths()
      console.log('Randomized tree depths')
    }
  }

  // Toggle audio reactivity with 'A'
  if (e.key === 'a' || e.key === 'A') {
    if (!audioEnabled && !audioContext) {
      // Initialize audio for first time
      const success = await initAudio()
      if (success) {
        audioEnabled = true
        console.log('Audio reactivity: ON')
      }
    } else {
      audioEnabled = !audioEnabled
      console.log(`Audio reactivity: ${audioEnabled ? 'ON' : 'OFF'}`)
    }
  }

  // Shuffle frequency assignments with 'T'
  if (e.key === 't' || e.key === 'T') {
    if (forest) {
      forest.shuffleFrequencies()
      console.log('Shuffled frequency assignments')
    }
  }

  // Reset all areas with 'R'
  if (e.key === 'R') {
    if (confirm('Reset all trees and clear storage? This cannot be undone.')) {
      await mapper.resetAll()
    }
  }

  // Arrow Up: Add new tree
  if (e.key === 'ArrowUp') {
    const newIndex = trees.length

    // Use loadOrCreateArea to properly handle storage setup
    const newTree = await mapper.loadOrCreateArea(`tree-${newIndex}`, () => createDefaultTree(newIndex))
    trees.push(newTree as TriangleStripArea)

    await storage.saveArea('tree-count', trees.length)

    // Recreate Forest with updated trees
    if (forest) {
      forest.dispose()
    }
    forest = new Forest(mapper.gl, trees, mapper.projContext, mapper, [canvas.width, canvas.height])

    console.log(`Added tree ${newIndex}. Total: ${trees.length}`)
  }

  // Arrow Down: Remove last tree
  if (e.key === 'ArrowDown' && trees.length > 0) {
    const lastTree = trees.pop()!

    // Delete the area's storage before removing
    if ((lastTree as any).storageKey) {
      await storage.saveArea((lastTree as any).storageKey, null)
    }

    mapper.removeArea(lastTree)

    await storage.saveArea('tree-count', trees.length)

    // Recreate Forest with updated trees
    if (forest) {
      forest.dispose()
    }
    if (trees.length > 0) {
      forest = new Forest(mapper.gl, trees, mapper.projContext, mapper, [canvas.width, canvas.height])
    }

    console.log(`Removed tree. Total: ${trees.length}`)
  }
})

// Log controls on startup
console.log('Trees Mapper - Controls:')
console.log('- Q key: Exit project / Switch projects')
console.log('- Left click + drag: Move points')
console.log('- Shift + hover edge: Preview insertion point')
console.log('- Shift + click edge: Insert new point(s)')
console.log('- Shift + drag: Precision mode')
console.log('- P key: Upload photo')
console.log('- M key: Toggle photo/proj mode')
console.log('- E key: Toggle edit mode (proj mode only)')
console.log('- D key: Toggle debug texture view (proj mode only)')
console.log('- R key: Reset all trees and clear storage')
console.log('- Arrow Up: Add new tree')
console.log('- Arrow Down: Remove last tree')
