import { vec2 } from "gl-matrix"
import { TriangleStripArea, ProjRenderContext, WebMapper } from "web-mapper"
import ShaderProgram from "web-mapper/dist/utils/shader-program"

import flowVs from "./shaders/triangle-strip-flow.vs"
import flowFs from "./shaders/triangle-strip-flow.fs"
import textureMappingVs from "./shaders/texture-mapping.vs"
import textureMappingFs from "./shaders/texture-mapping.fs"

export class TriangleStripArtworkRenderer {
  private program: ShaderProgram
  private textureMappingProgram: ShaderProgram
  private vao: WebGLVertexArrayObject
  private positionBuffer: WebGLBuffer
  private uvBuffer: WebGLBuffer

  // Texture mapping VAO and buffers
  private textureMappingVAO: WebGLVertexArrayObject
  private textureMappingPositionBuffer: WebGLBuffer
  private textureMappingPhotoCoordBuffer: WebGLBuffer

  private generatedTexture: WebGLTexture
  private textureWidth = 0
  private textureHeight = 0

  private vertexCount = 0
  private unsubscribeArea?: () => void
  private unsubscribePhoto?: () => void

  // Photo data
  private photoTexture: WebGLTexture | null = null
  private photoDimensions: vec2 | null = null

  // Regeneration flag to avoid duplicate work
  private needsRegeneration = false

  // Resolution for viewport management
  private resolution = vec2.create()

  // Distance calculation results
  private evenDistances: number[] = []
  private oddDistances: number[] = []
  private normalizedEvenUVs: number[] = []
  private normalizedOddUVs: number[] = []

  // Constructor parameters stored as fields
  private area: TriangleStripArea
  private gl: WebGL2RenderingContext
  private renderContext: ProjRenderContext
  private webMapper: WebMapper

  constructor(
    area: TriangleStripArea,
    gl: WebGL2RenderingContext,
    renderContext: ProjRenderContext,
    webMapper: WebMapper
  ) {
    this.area = area
    this.gl = gl
    this.renderContext = renderContext
    this.webMapper = webMapper
    this.program = new ShaderProgram(this.gl, flowVs, flowFs)
    this.textureMappingProgram = new ShaderProgram(this.gl, textureMappingVs, textureMappingFs)

    // Create VAO for triangle strip artwork rendering
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

    // Create VAO for texture mapping
    this.textureMappingVAO = this.gl.createVertexArray()!
    this.gl.bindVertexArray(this.textureMappingVAO)

    // Position buffer (vec2 in NDC)
    this.textureMappingPositionBuffer = this.gl.createBuffer()!
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.textureMappingPositionBuffer)
    this.gl.enableVertexAttribArray(0)
    this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, 0, 0)

    // Photo pixel coordinate buffer (vec2)
    this.textureMappingPhotoCoordBuffer = this.gl.createBuffer()!
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.textureMappingPhotoCoordBuffer)
    this.gl.enableVertexAttribArray(1)
    this.gl.vertexAttribPointer(1, 2, this.gl.FLOAT, false, 0, 0)

    this.gl.bindVertexArray(null)

    // Create texture for photo mapping
    this.generatedTexture = this.gl.createTexture()!

    // Subscribe to area changes
    this.unsubscribeArea = this.area.subscribe(() => {
      this.needsRegeneration = true
    })

    // Subscribe to photo changes
    this.unsubscribePhoto = this.webMapper.subscribeToPhotoChanges((texture, dimensions) => {
      this.photoTexture = texture
      this.photoDimensions = dimensions
      this.needsRegeneration = true
    })
  }

  setResolution(res: vec2) {
    this.resolution = vec2.clone(res)
  }

  private updateGeometry(dimensions: vec2) {
    this.calculateDistances(dimensions)
    this.updateTexture()
    this.updateVertexBuffers()
  }

  private calculateDistances(dimensions: vec2) {
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

    // Get max distance for each side independently
    const lastEvenIndex = pointCount % 2 === 0 ? pointCount - 2 : pointCount - 1
    const lastOddIndex = pointCount % 2 === 0 ? pointCount - 1 : pointCount - 2
    const maxEvenDistance = this.evenDistances[lastEvenIndex]!
    const maxOddDistance = this.oddDistances[lastOddIndex]!

    // Normalize each side independently to [0, 1]
    this.normalizedEvenUVs = this.evenDistances.map(d => d / maxEvenDistance)
    this.normalizedOddUVs = this.oddDistances.map(d => d / maxOddDistance)

    // Calculate texture dimensions based on the longer side
    const maxDistance = Math.max(maxEvenDistance, maxOddDistance)
    const edgeDistance0 = vec2.distance(pixelPositions[0]!, pixelPositions[1]!)
    const edgeDistanceLast = vec2.distance(pixelPositions[pointCount - 2]!, pixelPositions[pointCount - 1]!)

    this.textureWidth = Math.ceil(Math.max(edgeDistance0, edgeDistanceLast))
    this.textureHeight = Math.ceil(maxDistance)
  }

  private updateTexture() {
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
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT)

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

    // Set viewport to texture dimensions for texture rendering
    gl.viewport(0, 0, this.textureWidth, this.textureHeight)

    // Clear texture
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)

    // Render photo mapped onto texture using pixel positions and normalized distances
    if (!this.photoTexture || !this.photoDimensions) {
      // No photo available, just leave texture black
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.deleteFramebuffer(framebuffer)
      return
    }

    const points = this.area.points
    const pointCount = points.length

    if (pointCount < 2) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.deleteFramebuffer(framebuffer)
      return
    }

    // Build vertex data: positions in NDC and photo pixel coordinates
    // x = 1 for left column (even indices), x = -1 for right column (odd indices) - flipped to match orientation
    // y = normalizedDistance * 2 - 1 (converting [0,1] to [-1,1])
    const positions: number[] = []
    const photoPixelCoords: number[] = []

    // Convert photoPos to pixel space for all points
    const pixelPositions: vec2[] = []
    for (let i = 0; i < pointCount; i++) {
      const photoPos = points[i]!.photoPos
      const pixelPos = vec2.fromValues(
        (photoPos[0] * 0.5 + 0.5) * this.photoDimensions[0],
        (photoPos[1] * 0.5 + 0.5) * this.photoDimensions[1]
      )
      pixelPositions.push(pixelPos)
    }

    // Build triangle strip: alternate between even (left) and odd (right) points
    for (let i = 0; i < pointCount; i++) {
      const isEven = i % 2 === 0
      const x = isEven ? 1.0 : -1.0
      const normalizedY = isEven ? this.normalizedEvenUVs[i]! : this.normalizedOddUVs[i]!
      const y = normalizedY * 2.0 - 1.0

      positions.push(x, y)
      photoPixelCoords.push(pixelPositions[i]![0], pixelPositions[i]![1])
    }

    // Update buffers
    gl.bindBuffer(gl.ARRAY_BUFFER, this.textureMappingPositionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW)

    gl.bindBuffer(gl.ARRAY_BUFFER, this.textureMappingPhotoCoordBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(photoPixelCoords), gl.DYNAMIC_DRAW)

    // Render using texture mapping shader
    this.textureMappingProgram.use()

    // Set uniforms
    gl.uniform2fv(this.textureMappingProgram.uniLocs.photoDimensions, this.photoDimensions as Float32Array)

    // Bind photo texture
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.photoTexture)
    gl.uniform1i(this.textureMappingProgram.uniLocs.photoTexture, 0)

    // Draw triangle strip
    gl.bindVertexArray(this.textureMappingVAO)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, pointCount)
    gl.bindVertexArray(null)

    // Cleanup: restore framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.deleteFramebuffer(framebuffer)

    // Note: viewport will be set properly in render() method
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

    // Log vertex data
    console.log('Flow texture vertex data:')
    for (let i = 0; i < pointCount; i++) {
      const posIdx = i * 3
      const uvIdx = i * 2
      console.log(`  Vertex ${i}: pos=(${positions[posIdx]}, ${positions[posIdx + 1]}, ${positions[posIdx + 2]}), uv=(${uvs[uvIdx]}, ${uvs[uvIdx + 1]})`)
    }

    // Update buffers
    const gl = this.gl

    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW)

    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.DYNAMIC_DRAW)
  }

  render(time: number, targetFramebuffer: WebGLFramebuffer | null) {
    // Check if we need to regenerate geometry
    if (this.needsRegeneration && this.photoTexture && this.photoDimensions) {
      this.updateGeometry(this.photoDimensions)
      this.needsRegeneration = false
    }

    if (this.vertexCount < 2 || !this.photoTexture) return

    const gl = this.gl

    // Bind target framebuffer and set viewport
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFramebuffer)
    gl.viewport(0, 0, this.resolution[0], this.resolution[1])

    this.program.use()

    // Set uniforms
    const projMatrix = this.renderContext.getProjectionMatrix()
    gl.uniformMatrix4fv(
      this.program.uniLocs.projectionMatrix,
      false,
      projMatrix
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

  debugRenderTexture(targetFramebuffer: WebGLFramebuffer | null) {
    const gl = this.gl

    // Bind target framebuffer and set viewport
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFramebuffer)
    gl.viewport(0, 0, this.resolution[0], this.resolution[1])

    // Use texture mapping program to render the generated texture fullscreen
    this.textureMappingProgram.use()

    // Create a fullscreen quad in NDC coordinates
    const positions = new Float32Array([
      -1, -1,  // bottom-left
       1, -1,  // bottom-right
      -1,  1,  // top-left
       1,  1   // top-right
    ])

    // UV coordinates for the generated texture
    const uvs = new Float32Array([
      0, 0,  // bottom-left
      1, 0,  // bottom-right
      0, 1,  // top-left
      1, 1   // top-right
    ])

    // Update buffers with fullscreen quad
    gl.bindBuffer(gl.ARRAY_BUFFER, this.textureMappingPositionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW)

    gl.bindBuffer(gl.ARRAY_BUFFER, this.textureMappingPhotoCoordBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.DYNAMIC_DRAW)

    // Set uniforms - photoDimensions needs to be vec2(1,1) for normalized UVs
    gl.uniform2f(this.textureMappingProgram.uniLocs.photoDimensions, 1.0, 1.0)

    // Bind generated texture
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.generatedTexture)
    gl.uniform1i(this.textureMappingProgram.uniLocs.photoTexture, 0)

    // Draw fullscreen quad
    gl.bindVertexArray(this.textureMappingVAO)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)
  }

  destroy() {
    if (this.unsubscribeArea) {
      this.unsubscribeArea()
    }
    if (this.unsubscribePhoto) {
      this.unsubscribePhoto()
    }
    this.gl.deleteVertexArray(this.vao)
    this.gl.deleteBuffer(this.positionBuffer)
    this.gl.deleteBuffer(this.uvBuffer)
    this.gl.deleteVertexArray(this.textureMappingVAO)
    this.gl.deleteBuffer(this.textureMappingPositionBuffer)
    this.gl.deleteBuffer(this.textureMappingPhotoCoordBuffer)
    this.gl.deleteTexture(this.generatedTexture)
  }
}
