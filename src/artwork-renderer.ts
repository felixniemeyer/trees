import { vec2 } from "gl-matrix"
import { TriangleStripArea, ProjRenderContext, WebMapper } from "web-mapper"
import ShaderProgram from "web-mapper/dist/utils/shader-program"

import flowVs from "./shaders/triangle-strip-flow.vs"
import flowFs from "./shaders/triangle-strip-flow.fs"

export class TriangleStripArtworkRenderer {
  private program: ShaderProgram
  private vao: WebGLVertexArrayObject
  private positionBuffer: WebGLBuffer
  private uvBuffer: WebGLBuffer

  private generatedTexture: WebGLTexture
  private textureWidth = 0
  private textureHeight = 0

  private vertexCount = 0
  private unsubscribe?: () => void

  // Distance calculation results
  private evenDistances: number[] = []
  private oddDistances: number[] = []
  private normalizedEvenUVs: number[] = []
  private normalizedOddUVs: number[] = []

  constructor(
    private area: TriangleStripArea,
    private gl: WebGL2RenderingContext,
    private renderContext: ProjRenderContext,
    private webMapper: WebMapper
  ) {
    this.program = new ShaderProgram(this.gl, flowVs, flowFs)

    // Create VAO for triangle strip
    this.vao = this.gl.createVertexArray()!
    this.gl.bindVertexArray(this.vao)

    // Position buffer (vec3)
    this.positionBuffer = this.gl.createBuffer()!
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer)
    this.gl.enableVertexAttribArray(0)
    this.gl.vertexAttribPointer(0, 3, this.gl.FLOAT, false, 0, 0)

    // UV buffer (vec2)
    this.uvBuffer = this.gl.createBuffer()!
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.uvBuffer)
    this.gl.enableVertexAttribArray(1)
    this.gl.vertexAttribPointer(1, 2, this.gl.FLOAT, false, 0, 0)

    this.gl.bindVertexArray(null)

    // Create texture for photo mapping
    this.generatedTexture = this.gl.createTexture()!

    // Subscribe to area changes
    this.unsubscribe = this.area.subscribe(() => {
      this.updateGeometry()
    })

    // Initial geometry update
    this.updateGeometry()
  }

  private updateGeometry() {
    this.calculateDistances()
    this.updateTexture()
    this.updateVertexBuffers()
  }

  private calculateDistances() {
    const photoData = this.webMapper.getPhoto()
    if (!photoData) {
      console.warn('No photo data available for artwork renderer')
      return
    }

    const { dimensions } = photoData
    const points = this.area.points
    const pointCount = points.length

    if (pointCount < 2) return

    // Convert photoPos to pixel space: (photoPos * 0.5 + 0.5) * dimensions
    const pixelPositions: vec2[] = []
    for (let i = 0; i < pointCount; i++) {
      const photoPos = points[i]!.photoPos
      const pixelPos = vec2.fromValues(
        (photoPos[0] * 0.5 + 0.5) * dimensions[0],
        (photoPos[1] * 0.5 + 0.5) * dimensions[1]
      )
      pixelPositions.push(pixelPos)
    }

    // Calculate distances along even side (0, 2, 4, ...)
    this.evenDistances = new Array(pointCount).fill(0)
    for (let i = 0; i < pointCount - 2; i += 2) {
      const dist = vec2.distance(pixelPositions[i]!, pixelPositions[i + 2]!)
      this.evenDistances[i + 2] = this.evenDistances[i]! + dist
    }

    // Calculate distances along odd side (1, 3, 5, ...)
    this.oddDistances = new Array(pointCount).fill(0)
    for (let i = 1; i < pointCount - 2; i += 2) {
      const dist = vec2.distance(pixelPositions[i]!, pixelPositions[i + 2]!)
      this.oddDistances[i + 2] = this.oddDistances[i]! + dist
    }

    // Get max distance for normalization
    const lastEvenIndex = pointCount % 2 === 0 ? pointCount - 2 : pointCount - 1
    const lastOddIndex = pointCount % 2 === 0 ? pointCount - 1 : pointCount - 2
    const maxDistance = Math.max(this.evenDistances[lastEvenIndex]!, this.oddDistances[lastOddIndex]!)

    // Normalize distances to [0, 1]
    this.normalizedEvenUVs = this.evenDistances.map(d => d / maxDistance)
    this.normalizedOddUVs = this.oddDistances.map(d => d / maxDistance)

    // Calculate texture dimensions
    const edgeDistance0 = vec2.distance(pixelPositions[0]!, pixelPositions[1]!)
    const edgeDistanceLast = vec2.distance(pixelPositions[pointCount - 2]!, pixelPositions[pointCount - 1]!)

    this.textureWidth = Math.ceil(Math.max(edgeDistance0, edgeDistanceLast))
    this.textureHeight = Math.ceil(maxDistance)
  }

  private updateTexture() {
    const photoData = this.webMapper.getPhoto()
    if (!photoData) return

    const { texture: photoTexture, dimensions } = photoData

    if (this.textureWidth === 0 || this.textureHeight === 0) return

    const gl = this.gl

    // Create framebuffer for rendering to texture
    const framebuffer = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)

    // Setup generated texture
    gl.bindTexture(gl.TEXTURE_2D, this.generatedTexture)
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA,
      this.textureWidth, this.textureHeight,
      0, gl.RGBA, gl.UNSIGNED_BYTE, null
    )
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    // Attach texture to framebuffer
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D, this.generatedTexture, 0
    )

    // Check framebuffer status
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      console.error('Framebuffer not complete')
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.deleteFramebuffer(framebuffer)
      return
    }

    // Set viewport to texture size
    gl.viewport(0, 0, this.textureWidth, this.textureHeight)

    // Clear texture
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)

    // TODO: Render photo mapped onto texture using pixel positions and normalized distances
    // For now, just copy the photo texture directly
    // This needs to sample the photo at the correct positions along the strip

    // Restore framebuffer and viewport
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.deleteFramebuffer(framebuffer)
  }

  private updateVertexBuffers() {
    const points = this.area.points
    const pointCount = points.length

    if (pointCount < 2) return

    this.vertexCount = pointCount

    // Build position and UV arrays
    const positions: number[] = []
    const uvs: number[] = []

    for (let i = 0; i < pointCount; i++) {
      const point = points[i]!
      const projPos = point.position

      // Add position (vec3)
      positions.push(projPos[0], projPos[1], point.depth)

      // Add UV (vec2)
      if (i % 2 === 0) {
        // Even vertex: left side (x=0)
        uvs.push(0.0, this.normalizedEvenUVs[i]!)
      } else {
        // Odd vertex: right side (x=1)
        uvs.push(1.0, this.normalizedOddUVs[i]!)
      }
    }

    // Update buffers
    const gl = this.gl

    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW)

    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.DYNAMIC_DRAW)
  }

  render(time: number) {
    if (this.vertexCount < 2) return

    const photoData = this.webMapper.getPhoto()
    if (!photoData) return

    const gl = this.gl

    this.program.use()

    // Set uniforms
    gl.uniformMatrix4fv(
      this.program.uniLocs.projectionMatrix,
      false,
      this.renderContext.getProjectionMatrix()
    )
    gl.uniform1f(this.program.uniLocs.time, time)

    // Bind generated texture (for now it's empty, but structure is ready)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.generatedTexture)
    gl.uniform1i(this.program.uniLocs.photoTexture, 0)

    // Enable blending
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    // Draw triangle strip
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, this.vertexCount)
    gl.bindVertexArray(null)

    gl.disable(gl.BLEND)
  }

  destroy() {
    if (this.unsubscribe) {
      this.unsubscribe()
    }
    this.gl.deleteVertexArray(this.vao)
    this.gl.deleteBuffer(this.positionBuffer)
    this.gl.deleteBuffer(this.uvBuffer)
    this.gl.deleteTexture(this.generatedTexture)
  }
}
