import './style.css'
import { vec2, vec3 } from 'gl-matrix'
import { WebMapper, TriangleStripArea, Point } from 'web-mapper'
import { TriangleStripArtworkRenderer } from './artwork-renderer'

// Get canvas
const canvas = document.getElementById('canvas') as HTMLCanvasElement
if (!canvas) {
  throw new Error('Canvas element not found')
}

// Create WebMapper
const mapper = new WebMapper(canvas, {
  artworkId: 'trees'
})

// Enable edit mode so we can manipulate points
let isEditMode = true
mapper.setEditMode(isEditMode)

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
  return new TriangleStripArea(points, color, angle, mapper.storage, `tree-${index}`)
}

// Load trees from storage
const treeCount = await mapper.storage.get('tree-count') || 1
const trees: TriangleStripArea[] = []

for (let i = 0; i < treeCount; i++) {
  const tree = await mapper.loadOrCreateArea(`tree-${i}`, () => createDefaultTree(i))
  trees.push(tree as TriangleStripArea)
}

// Create artwork renderers for all trees
const artworkRenderers: TriangleStripArtworkRenderer[] = trees.map(tree =>
  new TriangleStripArtworkRenderer(tree, mapper.gl, mapper.projContext, mapper)
)

// Set initial resolution for all renderers
artworkRenderers.forEach(renderer => {
  renderer.setResolution(vec2.fromValues(canvas.width, canvas.height))
})

// Update artwork resolution on window resize
window.addEventListener('resize', () => {
  artworkRenderers.forEach(renderer => {
    renderer.setResolution(vec2.fromValues(canvas.width, canvas.height))
  })
})

// Set render callback
let startTime = Date.now()
let debugMode = false
mapper.setRenderCallback((_deltaTime) => {
  const gl = mapper.gl

  // Clear canvas with dark background
  gl.viewport(0, 0, canvas.width, canvas.height)
  gl.clearColor(0.1, 0.1, 0.15, 1.0)
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

  // Render artwork in proj mode (render to screen, framebuffer = null)
  if (!mapper.getPhotoMode()) {
    if (debugMode) {
      // Debug mode: show the generated texture directly
      artworkRenderers.forEach(renderer => renderer.debugRenderTexture(null))
    } else {
      // Normal mode: render with flow shader
      const time = (Date.now() - startTime) / 1000 // seconds
      artworkRenderers.forEach(renderer => renderer.render(time * 0.1, null))
    }
  }

  // WebMapper automatically renders areas/handles in edit mode
})

// Keyboard handlers
document.addEventListener('keydown', async (e) => {
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

  // Arrow Up: Add new tree
  if (e.key === 'ArrowUp') {
    const newIndex = trees.length
    const newTree = createDefaultTree(newIndex)
    trees.push(newTree)
    mapper.addArea(newTree)

    const newRenderer = new TriangleStripArtworkRenderer(
      newTree,
      mapper.gl,
      mapper.projContext,
      mapper
    )
    newRenderer.setResolution(vec2.fromValues(canvas.width, canvas.height))
    artworkRenderers.push(newRenderer)

    await mapper.storage.set('tree-count', trees.length)
    console.log(`Added tree ${newIndex}. Total: ${trees.length}`)
  }

  // Arrow Down: Remove last tree
  if (e.key === 'ArrowDown' && trees.length > 1) {
    const lastTree = trees.pop()!
    const lastRenderer = artworkRenderers.pop()!

    lastRenderer.destroy()
    mapper.removeArea(lastTree)

    await mapper.storage.remove(`tree-${trees.length}`)
    await mapper.storage.set('tree-count', trees.length)
    console.log(`Removed tree. Total: ${trees.length}`)
  }
})

console.log('Trees app initialized')
console.log(`Loaded ${trees.length} tree(s)`)
console.log('Controls:')
console.log('- Left click + drag: Move points')
console.log('- Shift + hover edge: Preview insertion point')
console.log('- Shift + click edge: Insert new point(s)')
console.log('- Shift + drag: Precision mode')
console.log('- P key: Upload photo')
console.log('- M key: Toggle photo/proj mode')
console.log('- E key: Toggle edit mode (proj mode only)')
console.log('- D key: Toggle debug texture view (proj mode only)')
console.log('- Arrow Up: Add new tree')
console.log('- Arrow Down: Remove last tree')
