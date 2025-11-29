import { vec2 } from "gl-matrix"
import { GridArea, ProjRenderContext } from "web-mapper"
import ShaderProgram from "web-mapper/src/utils/shader-program"
import { RectVao } from "../../utils/basic-vaos"
import { Controls } from "av-controls"
import { RGBFaders, Clock, LFOControl, TapPatternPair } from "time-n-controls"

import feedbackVs from "./shaders/feedback.vs"
import feedbackFs from "./shaders/feedback.fs"
import displayFs from "./shaders/display.fs"

export class Feedback {
  private resolution = vec2.fromValues(1, 1) // Screen resolution

  // Viewport calculation for area-based rendering
  private viewportX = 0
  private viewportY = 0
  private viewportWidth = 1
  private viewportHeight = 1
  
  // Aspect ratio for viewport-normalized coordinates
  private aspect = vec2.fromValues(1, 1)

  // Feedback system
  private textures: WebGLTexture[] = []
  private framebuffers: WebGLFramebuffer[] = []
  private feedbackResolution = vec2.fromValues(1, 1)
  private currentTextureIndex = 0

  private program: ShaderProgram
  private displayProgram: ShaderProgram
  private rectVao: RectVao

  private noiseTime = 0

  // Controls
  private noiseFrequFader = new Controls.Fader.Receiver(new Controls.Fader.Spec(
    new Controls.Base.Args('noise frequency', 0, 0, 20, 50, '#88a'), 14.0, 1, 50, 2
  ))

  private rndFreqControl!: TapPatternPair
  private noiseSpeedControl!: LFOControl
  private noiseStrengthControl!: LFOControl
  private sustainControl!: LFOControl
  private mixFactorControl!: LFOControl

  private decaySubtractControl = new Controls.Fader.Receiver(new Controls.Fader.Spec(
    new Controls.Base.Args('decay subtract', 80, 50, 20, 50, '#f84'), 0.01, 0.0, 1.0, 3
  ))

  private tintFaders = new RGBFaders('tint', 20, 50, 60, 50, [1, 1, 1], 0.9, 1)

  unsubscribes: (() => void)[] = []
  requireAreaUpdate = true

  constructor(
    private area: GridArea,
    private gl: WebGL2RenderingContext,
    private renderContext: ProjRenderContext,
    private clock: Clock
  ) {
    this.program = new ShaderProgram(gl, feedbackVs, feedbackFs)
    this.displayProgram = new ShaderProgram(gl, feedbackVs, displayFs)
    this.rectVao = new RectVao(gl)

    // Initialize Controls
    this.rndFreqControl = new TapPatternPair(
      'rnd freq', 0, 50, 20, 50, '#88a',
      this.clock,
      (velocity) => {
        const min = 1
        const max = 50
        this.noiseFrequFader.value = min + Math.random() * (max - min)
      }
    )

    this.noiseSpeedControl = new LFOControl(
      'noise speed', this.clock, 20, 0, 20, 50, 0.16, 0.01, 1.0, '#8aa'
    )

    this.noiseStrengthControl = new LFOControl(
      'lookup length', this.clock, 40, 0, 20, 50, 2.0, 0.0, 15.0, '#aa8'
    )

    this.mixFactorControl = new LFOControl(
      'mix factor', this.clock, 60, 0, 20, 50, 0.9, 0.001, 1.0, '#a8a'
    )

    this.sustainControl = new LFOControl(
      'sustain', this.clock, 80, 0, 20, 50, 0.9, 0.001, 1.0, '#8a8'
    )

    // Subscribe to area changes
    let unsubscribe = this.area.subscribe(() => {
      this.requireAreaUpdate = true
    })
    this.unsubscribes.push(unsubscribe)

    unsubscribe = this.renderContext.subscribe(() => {
      this.requireAreaUpdate = true
    })
    this.unsubscribes.push(unsubscribe)
  }

  setResolution(res: vec2) {
    this.resolution = vec2.clone(res)
    this.requireAreaUpdate = true
  }

  updateViewport() {
    // Match BokehArtwork viewport calculation EXACTLY
    let minX = Infinity, minY = Infinity
    let maxX = -Infinity, maxY = -Infinity

    for (let col = 0; col < this.area.columns; col++) {
      for (let row = 0; row < this.area.rows; row++) {
        const point = this.area.points[col][row]
        const pos = point.position
        minX = Math.min(minX, pos[0])
        minY = Math.min(minY, pos[1])
        maxX = Math.max(maxX, pos[0])
        maxY = Math.max(maxY, pos[1])
      }
    }

    const areaWidth = maxX - minX
    const areaHeight = maxY - minY

    const pixelWidth = Math.max(1, Math.round((areaWidth * 0.5) * this.resolution[0]))
    const pixelHeight = Math.max(1, Math.round((areaHeight * 0.5) * this.resolution[1]))

    const centerX = (minX + maxX) * 0.5
    const centerY = (minY + maxY) * 0.5

    const pixelCenterX = ((centerX + 1) * 0.5) * this.resolution[0]
    const pixelCenterY = ((centerY + 1) * 0.5) * this.resolution[1]

    this.viewportX = Math.round(pixelCenterX - pixelWidth * 0.5)
    this.viewportY = Math.round(pixelCenterY - pixelHeight * 0.5)
    this.viewportWidth = pixelWidth
    this.viewportHeight = pixelHeight

    // Calculate aspect ratio: aspect.x = sqrt(width/height), aspect.y = 1/aspect.x
    const aspectRatio = this.viewportWidth / this.viewportHeight
    this.aspect[0] = Math.sqrt(aspectRatio)
    this.aspect[1] = 1.0 / this.aspect[0]

    // Check if feedback resolution needs update
    const newRes = vec2.fromValues(this.viewportWidth, this.viewportHeight)
    if (!vec2.equals(this.feedbackResolution, newRes)) {
      this.feedbackResolution = newRes
      this.setupFeedbackTextures()
    }
  }

  setupFeedbackTextures() {
    const gl = this.gl

    if (this.textures.length > 0) {
      this.textures.forEach(t => gl.deleteTexture(t))
      this.framebuffers.forEach(f => gl.deleteFramebuffer(f))
    }

    this.textures = [gl.createTexture()!, gl.createTexture()!]
    this.framebuffers = [gl.createFramebuffer()!, gl.createFramebuffer()!]

    // Create zero-filled buffer for initialization
    const width = this.feedbackResolution[0]
    const height = this.feedbackResolution[1]
    const data = new Float32Array(width * height * 4)

    // Disable UNPACK_FLIP_Y_WEBGL for Float32Array upload to avoid warning/performance hit
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)

    for (let i = 0; i < 2; i++) {
      gl.bindTexture(gl.TEXTURE_2D, this.textures[i])
      // Use RGBA16F and HALF_FLOAT for sufficient precision and better performance
      // Upload zero data to avoid lazy initialization warning
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.FLOAT, data)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[i])
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures[i], 0)
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  render(inputTexture: WebGLTexture) {
    const deltaTime = this.clock.getTickDeltaS()

    if (this.requireAreaUpdate) {
      this.updateViewport()
      this.requireAreaUpdate = false
    }

    const gl = this.gl

    const sourceIndex = this.currentTextureIndex
    const targetIndex = 1 - sourceIndex

    // Bind target framebuffer (Feedback Ping-Pong)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[targetIndex])
    gl.viewport(0, 0, this.feedbackResolution[0], this.feedbackResolution[1])

    gl.disable(gl.BLEND)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.STENCIL_TEST)

    this.program.use()

    // Update noise time
    this.noiseTime += deltaTime * this.noiseSpeedControl.getValue()
    gl.uniform1f(this.program.uniLocs.u_time, this.noiseTime)

    // Calculate input transform
    // Map [0,1] of Feedback Texture to [u0, v0] -> [u1, v1] of Input Texture (Full Screen)
    const scaleX = this.viewportWidth / this.resolution[0]
    const scaleY = this.viewportHeight / this.resolution[1]
    const offsetX = this.viewportX / this.resolution[0]
    const offsetY = this.viewportY / this.resolution[1]
    
    gl.uniform4f(this.program.uniLocs.u_inputTransform, scaleX, scaleY, offsetX, offsetY)

    // Uniforms
    gl.uniform1f(this.program.uniLocs.u_noiseScale, this.noiseFrequFader.value)
    gl.uniform1f(this.program.uniLocs.u_noiseStrength, this.noiseStrengthControl.getValue()) // Adjust scaling
    
    // Use time-corrected sustain: value represents fraction remaining after 1 second
    // Apply squaring to the fader value for a more exponential response
    const faderValueSquared = Math.pow(this.sustainControl.getValue(), 2);
    const frameSustain = Math.pow(faderValueSquared, deltaTime);
    gl.uniform1f(this.program.uniLocs.u_sustain, frameSustain)
    
    // Time-corrected subtract value
    // Fader value is squared for exponential response
    const subtractPerSec = Math.pow(this.decaySubtractControl.value, 2)
    const frameSubtract = subtractPerSec * deltaTime
    gl.uniform1f(this.program.uniLocs.u_decaySubtract, frameSubtract)
    
    gl.uniform1f(this.program.uniLocs.u_mixFactor, this.mixFactorControl.getValue())
    gl.uniform2fv(this.program.uniLocs.u_aspect, this.aspect)
    
    // Update and set tint
    const sustain = Math.pow(0.5, deltaTime)
    this.tintFaders.update(sustain)
    gl.uniform3fv(this.program.uniLocs.u_tint, this.tintFaders.getValues())

    // Bind textures
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, inputTexture)
    gl.uniform1i(this.program.uniLocs.u_inputTexture, 0)

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.textures[sourceIndex])
    gl.uniform1i(this.program.uniLocs.u_feedbackTexture, 1)

    // Render Quad
    this.rectVao.draw()

    this.currentTextureIndex = targetIndex
  }

  draw(targetFramebuffer: WebGLFramebuffer | null, useStencil: boolean = false) {
    const gl = this.gl
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFramebuffer)
    gl.viewport(this.viewportX, this.viewportY, this.viewportWidth, this.viewportHeight)

    // Blend mode for drawing to screen (if needed, though usually opaque)
    // If we want to blend with what's already there (unlikely for feedback base), enable blend
    // For now, disable blend (opaque overwrite of the feedback area)
    gl.disable(gl.BLEND)
    gl.disable(gl.DEPTH_TEST)
    
    if (useStencil) {
      gl.enable(gl.STENCIL_TEST)
      gl.stencilFunc(gl.EQUAL, 1, 0xFF)
      gl.stencilMask(0x00) // Don't write to stencil
    } else {
      gl.disable(gl.STENCIL_TEST)
    }

    this.displayProgram.use()
    
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.textures[this.currentTextureIndex])
    gl.uniform1i(this.displayProgram.uniLocs.u_texture, 0)

    this.rectVao.draw()
  }

  getTexture(): WebGLTexture {
    return this.textures[this.currentTextureIndex]!
  }

  getControls(): Controls.Group.Receiver {
    const controls = {
      'noise frequency': this.noiseFrequFader,
      ...this.rndFreqControl.getControls(),
      ...this.noiseSpeedControl.getControls(),
      ...this.noiseStrengthControl.getControls(),
      ...this.mixFactorControl.getControls(),
      ...this.sustainControl.getControls(),
      'decay subtract': this.decaySubtractControl,
      ...this.tintFaders.getControls(),
    }
    
    return new Controls.Group.Receiver(new Controls.Group.SpecWithoutControls(
      new Controls.Base.Args('feedback', 0, 0, 100, 100, '#95f')
    ), controls)
  }

  dispose() {
    const gl = this.gl
    this.unsubscribes.forEach(u => u())
    this.textures.forEach(t => gl.deleteTexture(t))
    this.framebuffers.forEach(f => gl.deleteFramebuffer(f))
  }
}
