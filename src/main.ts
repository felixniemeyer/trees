import './style.css'
import { vec2, vec3 } from 'gl-matrix'
import { WebMapper, TriangleStripArea, Point } from 'web-mapper'

// Get canvas
const canvas = document.getElementById('canvas') as HTMLCanvasElement
if (!canvas) {
  throw new Error('Canvas element not found')
}

// Create triangle strip area with 4 points forming a square [-0.5, 0.5]
const stripPoints: Point[] = [
  new Point(vec2.fromValues(-0.5, -0.5), 0), // bottom-left
  new Point(vec2.fromValues(0.5, -0.5), 0),  // bottom-right
  new Point(vec2.fromValues(-0.5, 0.5), 0),  // top-left
  new Point(vec2.fromValues(0.5, 0.5), 0),   // top-right
]

const triangleStripArea = new TriangleStripArea(
  stripPoints,
  vec3.fromValues(0.3, 0.8, 0.6), // Green color for trees
  0 // No rotation
)

// Create WebMapper
const mapper = new WebMapper(canvas, {
  artworkId: 'trees'
})

// Enable edit mode so we can manipulate points
mapper.setEditMode(true)

// Add triangle strip area
mapper.addArea(triangleStripArea)

// Set render callback
mapper.setRenderCallback((_deltaTime) => {
  const gl = mapper.gl

  // Clear canvas with dark background
  gl.viewport(0, 0, canvas.width, canvas.height)
  gl.clearColor(0.1, 0.1, 0.15, 1.0)
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

  // WebMapper automatically renders areas in edit mode
})

// Photo upload handler - triggered by 'P' key
document.addEventListener('keydown', async (e) => {
  if (e.key === 'p' || e.key === 'P') {
    // Create file input element
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'

    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0]
      if (!file) return

      // Read file as blob
      const blob = new Blob([await file.arrayBuffer()], { type: file.type })

      // TODO: Call mapper.setPhoto(blob) once WebMapper photo integration is complete
      console.log('Photo selected:', file.name, 'Size:', blob.size, 'bytes')
      console.log('Photo upload functionality will be wired up once WebMapper photo mode is integrated')
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
console.log('- P key: Upload photo (coming soon)')
