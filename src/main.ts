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

// Load or create main triangle strip area
await mapper.loadOrCreateArea('main', () =>
  new TriangleStripArea(
    [
      new Point(vec2.fromValues(-0.5, -0.5), 0), // bottom-left
      new Point(vec2.fromValues(0.5, -0.5), 0),  // bottom-right
      new Point(vec2.fromValues(-0.5, 0.5), 0),  // top-left
      new Point(vec2.fromValues(0.5, 0.5), 0),   // top-right
    ],
    vec3.fromValues(0.3, 0.8, 0.6), // Green color for trees
    0 // No rotation
  )
)

// Get the main area and create artwork renderer
const mainArea = mapper.areas[0] as TriangleStripArea
const artworkRenderer = new TriangleStripArtworkRenderer(
  mainArea,
  mapper.gl,
  mapper.projContext,
  mapper
)

// Set initial resolution
artworkRenderer.setResolution(vec2.fromValues(canvas.width, canvas.height))

// Update artwork resolution on window resize
window.addEventListener('resize', () => {
  artworkRenderer.setResolution(vec2.fromValues(canvas.width, canvas.height))
})

// Set render callback
let startTime = Date.now()
mapper.setRenderCallback((_deltaTime) => {
  const gl = mapper.gl

  // Clear canvas with dark background
  gl.viewport(0, 0, canvas.width, canvas.height)
  gl.clearColor(0.1, 0.1, 0.15, 1.0)
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

  // Render artwork in proj mode (render to screen, framebuffer = null)
  if (!mapper.getPhotoMode()) {
    const time = (Date.now() - startTime) / 1000 // seconds
    artworkRenderer.render(time * 0.1, null)
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

  // Toggle edit mode with 'E' (only in proj mode)
  if (e.key === 'e' || e.key === 'E') {
    if (!mapper.getPhotoMode()) {
      isEditMode = !isEditMode
      mapper.setEditMode(isEditMode)
      console.log(`Edit mode: ${isEditMode ? 'ON' : 'OFF'}`)
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
})

console.log('Trees app initialized')
console.log('Controls:')
console.log('- Left click + drag: Move points')
console.log('- Double-click empty space: Add new point')
console.log('- Double-click endpoint: Remove endpoint')
console.log('- Shift + drag: Precision mode')
console.log('- P key: Upload photo')
console.log('- M key: Toggle photo/proj mode')
console.log('- E key: Toggle edit mode (proj mode only)')
