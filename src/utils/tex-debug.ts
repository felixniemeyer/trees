import { vec2 } from "gl-matrix"
import ShaderProgram from "./shader-program"

import texDebugVs from "../shaders/debug/tex-debug.vs"
import texDebug2dFs from "../shaders/debug/tex-debug-2d.fs"
import texDebug2dArrayFs from "../shaders/debug/tex-debug-2d-array.fs"

export enum TexDebugMode {
  FULLSCREEN = 'fullscreen',
  CORNER = 'corner'
}

abstract class TexDebugBase {
  protected vao!: WebGLVertexArrayObject
  protected vertexBuffer!: WebGLBuffer
  protected currentTexture: WebGLTexture | null = null
  protected mode = TexDebugMode.CORNER
  protected textureAspectRatio = 1.0

  constructor(protected gl: WebGL2RenderingContext, protected program: ShaderProgram) {
    this.setupQuad()
  }
  
  private setupQuad() {
    const gl = this.gl
    
    this.vao = gl.createVertexArray()
    this.vertexBuffer = gl.createBuffer()
    
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer)
    
    // Fullscreen quad vertices
    const vertices = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1,
    ])
    
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    
    gl.bindVertexArray(null)
  }
  
  setTexture(texture: WebGLTexture, aspectRatio = 1.0) {
    this.currentTexture = texture
    this.textureAspectRatio = aspectRatio
  }
  
  setMode(mode: TexDebugMode) {
    this.mode = mode
  }

  protected abstract getTextureTarget(): number
  protected abstract setTextureSpecificUniforms(): void
  
  render(resolution: vec2) {
    if (!this.currentTexture) return
    
    const gl = this.gl
    this.program.use()
    
    // Bind texture
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(this.getTextureTarget(), this.currentTexture)
    gl.uniform1i(this.program.uniLocs.tex, 0)
    
    // Set texture-specific uniforms
    this.setTextureSpecificUniforms()
    
    const texelSize = vec2.fromValues(1.0 / resolution[0], 1.0 / resolution[1])
    gl.uniform2fv(this.program.uniLocs.texelSize, texelSize)
    
    // Enable blending for corner mode
    if (this.mode === TexDebugMode.CORNER) {
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    }
    
    // Render quad
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)
    
    if (this.mode === TexDebugMode.CORNER) {
      gl.disable(gl.BLEND)
    }
  }
}

export class TexDebug2D extends TexDebugBase {
  constructor(gl: WebGL2RenderingContext) {
    super(gl, new ShaderProgram(gl, texDebugVs, texDebug2dFs))
  }

  protected getTextureTarget(): number {
    return this.gl.TEXTURE_2D
  }

  protected setTextureSpecificUniforms(): void {
    // No special uniforms for 2D textures
  }
}

export class TexDebug2DArray extends TexDebugBase {
  private currentLayer = 0

  constructor(gl: WebGL2RenderingContext) {
    super(gl, new ShaderProgram(gl, texDebugVs, texDebug2dArrayFs))
  }

  protected getTextureTarget(): number {
    return this.gl.TEXTURE_2D_ARRAY
  }

  protected setTextureSpecificUniforms(): void {
    this.gl.uniform1i(this.program.uniLocs.layerIndex, this.currentLayer)
  }

  setLayer(layer: number) {
    this.currentLayer = layer
  }

  getLayer(): number {
    return this.currentLayer
  }
}

// Legacy export for backward compatibility
export class TexDebug extends TexDebug2DArray {}