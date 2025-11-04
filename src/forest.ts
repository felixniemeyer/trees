import { TriangleStripArtworkRenderer } from './artwork-renderer'
import ShaderProgram from '../../web-mapper/src/utils/shader-program'
import shadowProcessVs from './shaders/shadow-process.vs'
import shadowProcessFs from './shaders/shadow-process.fs'
import compositeVs from './shaders/composite.vs'
import compositeFs from './shaders/composite.fs'

export class Forest {
  private gl: WebGL2RenderingContext
  private trees: TriangleStripArtworkRenderer[]
  private treeDepths: number[]
  private resolution: [number, number]

  // Render targets
  private treesTexture: WebGLTexture
  private treesFramebuffer: WebGLFramebuffer
  private treesDepthBuffer: WebGLRenderbuffer
  private shadowMap: WebGLTexture
  private shadowFramebuffer: WebGLFramebuffer

  // Shaders
  private shadowProcessProgram: ShaderProgram
  private compositeProgram: ShaderProgram

  // Fullscreen quad
  private quadVAO: WebGLVertexArrayObject

  // Shadow parameters
  private shadowSize: number = 0.1
  private shadowAlpha: number = 0.1

  constructor(
    gl: WebGL2RenderingContext,
    trees: TriangleStripArtworkRenderer[],
    resolution: [number, number]
  ) {
    this.gl = gl
    this.trees = trees
    this.resolution = resolution

    // Assign random depths to trees
    this.treeDepths = trees.map(() => Math.random())

    // Create render targets
    this.treesTexture = this.createTexture()
    this.treesDepthBuffer = this.createDepthBuffer()
    this.treesFramebuffer = this.createFramebufferWithDepth(this.treesTexture, this.treesDepthBuffer)

    this.shadowMap = this.createTexture()
    this.shadowFramebuffer = this.createFramebuffer(this.shadowMap)

    // Create shaders
    this.shadowProcessProgram = new ShaderProgram(gl, shadowProcessVs, shadowProcessFs)
    this.compositeProgram = new ShaderProgram(gl, compositeVs, compositeFs)

    // Create fullscreen quad
    this.quadVAO = this.createFullscreenQuad()
  }

  private createTexture(): WebGLTexture {
    const gl = this.gl
    const texture = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      this.resolution[0],
      this.resolution[1],
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null
    )
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return texture
  }

  private createDepthBuffer(): WebGLRenderbuffer {
    const gl = this.gl
    const depthBuffer = gl.createRenderbuffer()!
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer)
    gl.renderbufferStorage(
      gl.RENDERBUFFER,
      gl.DEPTH_COMPONENT24,
      this.resolution[0],
      this.resolution[1]
    )
    gl.bindRenderbuffer(gl.RENDERBUFFER, null)
    return depthBuffer
  }

  private createFramebuffer(texture: WebGLTexture): WebGLFramebuffer {
    const gl = this.gl
    const framebuffer = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0
    )

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`Framebuffer incomplete: ${status}`)
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return framebuffer
  }

  private createFramebufferWithDepth(texture: WebGLTexture, depthBuffer: WebGLRenderbuffer): WebGLFramebuffer {
    const gl = this.gl
    const framebuffer = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0
    )
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER,
      gl.DEPTH_ATTACHMENT,
      gl.RENDERBUFFER,
      depthBuffer
    )

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`Framebuffer incomplete: ${status}`)
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return framebuffer
  }

  private createFullscreenQuad(): WebGLVertexArrayObject {
    const gl = this.gl
    const vao = gl.createVertexArray()!
    gl.bindVertexArray(vao)

    const positions = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1
    ])

    const buffer = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    gl.bindVertexArray(null)
    return vao
  }

  update() {
    // Trees will update themselves via their subscriptions
    // No explicit update needed here
  }

  render(time: number, targetFramebuffer: WebGLFramebuffer | null) {
    const gl = this.gl

    // Step 1: Render all trees to trees texture with depth in alpha
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.treesFramebuffer)
    gl.viewport(0, 0, this.resolution[0], this.resolution[1])
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LESS)

    for (let i = 0; i < this.trees.length; i++) {
      this.trees[i]!.render(time, this.treesFramebuffer, this.treeDepths[i]!)
    }

    gl.disable(gl.DEPTH_TEST)

    // Step 2: Process shadows (accumulate into shadow map)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFramebuffer)
    gl.viewport(0, 0, this.resolution[0], this.resolution[1])

    // Enable alpha blending for accumulation
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    this.shadowProcessProgram.use()

    // Set uniforms
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.treesTexture)
    gl.uniform1i(this.shadowProcessProgram.uniLocs.u_treesTexture, 0)
    gl.uniform1f(this.shadowProcessProgram.uniLocs.u_shadowSize, this.shadowSize)
    gl.uniform1f(this.shadowProcessProgram.uniLocs.u_shadowAlpha, this.shadowAlpha)

    // Random seed for this frame
    const randomSeed = [Math.random() * 100, Math.random() * 100]
    gl.uniform2fv(this.shadowProcessProgram.uniLocs.u_randomSeed, randomSeed)

    // Aspect ratio (note: aspect.yx swizzle is done in shader)
    const aspect = this.resolution[0] / this.resolution[1]
    gl.uniform2f(this.shadowProcessProgram.uniLocs.u_aspect, aspect, 1.0)

    // Draw fullscreen quad
    gl.bindVertexArray(this.quadVAO)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)

    gl.disable(gl.BLEND)

    // Step 3: Composite final image
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFramebuffer)
    gl.viewport(0, 0, this.resolution[0], this.resolution[1])
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    this.compositeProgram.use()

    // Set uniforms
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.treesTexture)
    gl.uniform1i(this.compositeProgram.uniLocs.u_treesTexture, 0)

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.shadowMap)
    gl.uniform1i(this.compositeProgram.uniLocs.u_shadowMap, 1)

    // Draw fullscreen quad
    gl.bindVertexArray(this.quadVAO)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)
  }

  dispose() {
    const gl = this.gl
    gl.deleteTexture(this.treesTexture)
    gl.deleteRenderbuffer(this.treesDepthBuffer)
    gl.deleteFramebuffer(this.treesFramebuffer)
    gl.deleteTexture(this.shadowMap)
    gl.deleteFramebuffer(this.shadowFramebuffer)
    gl.deleteVertexArray(this.quadVAO)
  }
}
