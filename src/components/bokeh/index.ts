import { vec2 } from "gl-matrix"
import { GridArea, ProjRenderContext } from "web-mapper"
import ShaderProgram from "utils/shader-program"
import { RectVao } from "utils/basic-vaos"
import { Controls } from "av-controls"
import { SmoothFader, RGBFaders } from "time-n-controls";


import updateVs from "./shaders/update.vs"
import updateFs from "./shaders/update.fs"
import renderVs from "./shaders/render.vs"
import renderFs from "./shaders/render.fs"


export class BokehArtwork {
  private sqrtNumParticles = 128
  private numParticles = 0
  
  private textureCount = 1
  private renderTextures: WebGLTexture[][] = []
  private renderFbos: WebGLFramebuffer[] = []
  
  private rectVao: RectVao
  
  private updateProgram: ShaderProgram
  private renderProgram: ShaderProgram
  
  private cornerBuffer: WebGLBuffer | null = null
  private particleVao: WebGLVertexArrayObject | null = null
  
  private resolution = vec2.fromValues(1, 1)

  // Viewport calculation for area-based rendering
  private viewportX = 0
  private viewportY = 0
  private viewportWidth = 1
  private viewportHeight = 1

  // Aspect ratio for viewport-normalized coordinates
  private aspect = vec2.fromValues(1, 1)

  private noiseTime = 0
  
  
  // Controls
  private colorARgbFader = new RGBFaders('color a', 0, 0, 50, 50, [1, 0, 0])
  private colorBRgbFader = new RGBFaders('color b', 50, 0, 50, 50, [0, 0.8, 1])
  private intensityColorFader = new RGBFaders('intensity color', 0, 50, 50, 50, [1, 0.5, 0], 0, 2)
  
  private blinkAmountFader = new Controls.Fader.Receiver(
    new Controls.Fader.Spec(
      new Controls.Base.Args('blink amount', 50, 50, 16, 50, '#378'), 3.5, 0, 7, 2
    )
  )
  
  private blinkFrequencyFader = new Controls.Fader.Receiver(
    new Controls.Fader.Spec(
      new Controls.Base.Args('blink frequency', 66, 50, 17, 50, '#378'), 2, 0.1, 10, 2
    )
  )
  
  private blinkDurationFader = new Controls.Fader.Receiver(
    new Controls.Fader.Spec(
      new Controls.Base.Args('blink duration', 83, 50, 17, 50, '#378'), 1, 0.5, 5, 2
    )
  )
  
  private sqrtNumParticlesFader = new Controls.Fader.Receiver(
    new Controls.Fader.Spec(
      new Controls.Base.Args('sqrt num particles', 0, 50, 20, 50, '#291'), this.sqrtNumParticles, 32, 512, 0
    ),
    (value: number) => {
      this.setSqrtNumParticles(Math.floor(value))
    }
  )
  
  private speedBoostFactorFader = new Controls.Fader.Receiver(
    new Controls.Fader.Spec(
      new Controls.Base.Args('speed boost factor', 20, 50, 20, 50, '#291'), 5, 0, 10, 2
    )
  )
  
  private noiseTimeScaleFader = new Controls.Fader.Receiver(
    new Controls.Fader.Spec(
      new Controls.Base.Args('noise time scale', 40, 0, 20, 50, '#394'), 0.5, 0, 3, 2
    )
  )
  
  private speedFader = new Controls.Fader.Receiver(
    new Controls.Fader.Spec(
      new Controls.Base.Args('speed', 60, 0, 20, 50, '#419'), 0.25, 0, 2, 2
    )
  )
  
  
  private dofAmountFader = new Controls.Fader.Receiver(
    new Controls.Fader.Spec(
      new Controls.Base.Args('dof amount', 0, 50, 20, 50, '#418'), 1, 0, 2, 2
    )
  )

  private featherFader = new Controls.Fader.Receiver(
    new Controls.Fader.Spec(
      new Controls.Base.Args('feather pixel', 20, 50, 20, 50, '#419'), 0.5, 0, 2, 2
    )
  )
  
  private particleSizeFader = new Controls.Fader.Receiver(
    new Controls.Fader.Spec(
      new Controls.Base.Args('particle size', 40, 0, 20, 50, '#923'), 0.05, 0.01, 0.2, 3
    )
  )

  private zCenterFader = new SmoothFader( 
    new Controls.Fader.Spec(
      new Controls.Base.Args('z center', 60, 50, 20, 50, '#28f'), 15, 5, 30, 2
    )
  )
  
  private zGravityFader = new Controls.Fader.Receiver(
    new Controls.Fader.Spec(
      new Controls.Base.Args('z gravity', 80, 50, 20, 50, '#f82'), 0.2, 0, 1, 2
    ),
    (value: number) => {
      this.updateProgram.use()
      this.gl.uniform1f(this.updateProgram.uniLocs.zGravity, value)
    }
  )

  private maxFdFader = new Controls.Fader.Receiver(
    new Controls.Fader.Spec(
      new Controls.Base.Args('max blur', 60, 0, 20, 50, '#482'), 10, 1, 20, 2
    )
  )
  
  
  private focusDistanceFader = new Controls.Fader.Receiver(
    new Controls.Fader.Spec(
      new Controls.Base.Args('focus offset', 0, 0, 20, 50, '#941'), 0, -1, 1, 2
    )
  )
  
  private intensityFactorFader = new Controls.Fader.Receiver(
    new Controls.Fader.Spec(
      new Controls.Base.Args('intensity factor', 20, 0, 20, 50, '#491'), 0.45, 0, 2, 2
    )
  )
  
  private driftAmountFader = new Controls.Fader.Receiver(
    new Controls.Fader.Spec(
      new Controls.Base.Args('drift amount', 0, 0, 20, 50, '#919'), 0.05, 0, 0.1, 2
    ),
    (value: number) => {
      this.updateProgram.use()
      this.gl.uniform1f(this.updateProgram.uniLocs.driftAmount, value)
    }
  )
  
  private noiseAmountFader = new Controls.Fader.Receiver(
    new Controls.Fader.Spec(
      new Controls.Base.Args('noise amount', 20, 0, 20, 50, '#919'), 0.1, 0, 0.3, 2
    ),
    (value: number) => {
      this.updateProgram.use()
      this.gl.uniform1f(this.updateProgram.uniLocs.noiseAmount, value)
    }
  )
  
  private yWindBaseFader = new Controls.Fader.Receiver(
    new Controls.Fader.Spec(
      new Controls.Base.Args('y wind base', 80, 0, 20, 50, '#919'), 0.0, -1, 1, 3
    )
  )

  private useStencilSwitch = new Controls.Switch.Receiver(
    new Controls.Switch.Spec(
      new Controls.Base.Args('use stencil', 80, 0, 20, 25, '#459'),
      true 
    )
  )
  
  private currentRenderIndex = 0
  private blinkPhase = 0

  unsubscribes: (() => void)[] = []
  requireAreaUpdate = true
  
  constructor(
    public area: GridArea,
    private gl: WebGL2RenderingContext,
    private renderContext: ProjRenderContext
  ) {
    this.updateProgram = new ShaderProgram(gl, updateVs, updateFs)
    this.renderProgram = new ShaderProgram(gl, renderVs, renderFs)

    // Set derivative hint to potentially improve fragment precision
    gl.hint(gl.FRAGMENT_SHADER_DERIVATIVE_HINT, gl.NICEST)

    this.rectVao = new RectVao(gl)
    
    const excitement = 0
    
    // Setup update program uniforms
    this.updateProgram.use()
    const updateUniLocs = this.updateProgram.uniLocs
    gl.uniform1i(updateUniLocs.inPosTex, 0)
    gl.uniform1f(updateUniLocs.driftAmount, this.driftAmountFader.value)
    gl.uniform1f(updateUniLocs.noiseAmount, this.noiseAmountFader.value * (1 + excitement * 2.5))
    gl.uniform1f(updateUniLocs.zCenter, this.zCenterFader.getValue())
    gl.uniform1f(updateUniLocs.time, 0)
    
    // Setup render program uniforms
    this.renderProgram.use()
    const renderUniLocs = this.renderProgram.uniLocs
    gl.uniform1i(renderUniLocs.positionsTex, 0)
    
    // Initialize render textures and framebuffers
    for(let renderIndex = 0; renderIndex < 2; renderIndex++) {
      this.renderFbos[renderIndex] = gl.createFramebuffer()
      this.renderTextures[renderIndex] = []
      for(let textureIndex = 0; textureIndex < this.textureCount; textureIndex++) {
        this.renderTextures[renderIndex][textureIndex] = gl.createTexture()
      }
    }
    
    
    // Setup corner vertex buffer for all instances
    this.cornerBuffer = gl.createBuffer()!
    const corners = new Float32Array([
      -1, -1,  // bottom-left
       1, -1,  // bottom-right  
      -1,  1,  // top-left
       1,  1   // top-right
    ])
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW)
    
    // Setup particle VAO
    this.particleVao = gl.createVertexArray()!
    gl.bindVertexArray(this.particleVao)
    
    // Bind corner vertex buffer 
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.enableVertexAttribArray(0)
    
    gl.bindVertexArray(null)
    
    // Initialize particles
    this.setSqrtNumParticles(this.sqrtNumParticles)

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
  
  setSqrtNumParticles(sqrtNumParticles: number) {
    const gl = this.gl
    
    this.sqrtNumParticles = sqrtNumParticles
    this.numParticles = sqrtNumParticles * sqrtNumParticles
    
    // Initialize particle data
    for(let renderIndex = 0; renderIndex < 2; renderIndex++) {
      const data = new Float32Array(sqrtNumParticles * sqrtNumParticles * 4)

      // Initialize particles in viewport-normalized coordinates [-1,1] for XY, depth around zCenter for Z
      const z = this.zCenterFader.getValue()
      const zSpread = z - 1 // Random Z spread around center

      for(let k = 0; k < data.length; k += 4) {
        data[k + 0] = (Math.random() * 2 - 1) // x: viewport-normalized [-1, 1]
        data[k + 1] = (Math.random() * 2 - 1) // y: viewport-normalized [-1, 1]
        data[k + 2] = z + (Math.random() * 2 - 1) * zSpread // z: depth around center
        data[k + 3] = 0
      }
      
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.renderFbos[renderIndex])
      
      // Disable UNPACK_FLIP_Y_WEBGL for Float32Array upload
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)

      for(let textureIndex = 0; textureIndex < this.textureCount; textureIndex++) {
        gl.bindTexture(gl.TEXTURE_2D, this.renderTextures[renderIndex][textureIndex])
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sqrtNumParticles, sqrtNumParticles, 0, gl.RGBA, gl.FLOAT, data)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + textureIndex, gl.TEXTURE_2D, this.renderTextures[renderIndex][textureIndex], 0)
      }

      // Check framebuffer status
      const fbStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
      if (fbStatus !== gl.FRAMEBUFFER_COMPLETE) {
        console.error(`Framebuffer ${renderIndex} incomplete:`, fbStatus, {
          FRAMEBUFFER_INCOMPLETE_ATTACHMENT: gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT,
          FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT: gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT,
          FRAMEBUFFER_INCOMPLETE_DIMENSIONS: gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS,
          FRAMEBUFFER_UNSUPPORTED: gl.FRAMEBUFFER_UNSUPPORTED,
          FRAMEBUFFER_INCOMPLETE_MULTISAMPLE: gl.FRAMEBUFFER_INCOMPLETE_MULTISAMPLE
        })
      } else {
      }
      
      this.updateProgram.use()
      gl.uniform1i(this.updateProgram.uniLocs.sqrtNumParticles, sqrtNumParticles)
      gl.uniform1f(this.updateProgram.uniLocs.invSqrtNumParticles, 1 / sqrtNumParticles)
      const numParticles = sqrtNumParticles ** 2
      gl.uniform1i(this.updateProgram.uniLocs.numParticles, numParticles)
      gl.uniform1f(this.updateProgram.uniLocs.invNumParticles, 1 / numParticles)
    }
    
    const numParticles = sqrtNumParticles ** 2
    
    this.renderProgram.use()
    gl.uniform1i(this.renderProgram.uniLocs.sqrtNumParticles, sqrtNumParticles)
    gl.uniform1f(this.renderProgram.uniLocs.invNumParticles, 1 / numParticles)
    gl.uniform1f(this.renderProgram.uniLocs.invSqrtNumParticles, 1 / sqrtNumParticles)
  }

  updateViewport() {
    // Calculate area bounds from vertex handles
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

    // Calculate area dimensions in normalized coordinates [-1, 1]
    const areaWidth = maxX - minX
    const areaHeight = maxY - minY

    // Convert normalized coordinate deltas to pixel dimensions
    // Normalized space [-1, 1] spans 2 units, so delta * 0.5 gives the fraction of screen space
    const pixelWidth = Math.max(1, Math.round((areaWidth * 0.5) * this.resolution[0]))
    const pixelHeight = Math.max(1, Math.round((areaHeight * 0.5) * this.resolution[1]))

    // Calculate viewport position (convert center to bottom-left origin)
    const centerX = (minX + maxX) * 0.5
    const centerY = (minY + maxY) * 0.5

    // Convert normalized center to pixel coordinates
    const pixelCenterX = ((centerX + 1) * 0.5) * this.resolution[0]
    const pixelCenterY = ((centerY + 1) * 0.5) * this.resolution[1]

    // Calculate viewport bottom-left corner
    this.viewportX = Math.round(pixelCenterX - pixelWidth * 0.5)
    this.viewportY = Math.round(pixelCenterY - pixelHeight * 0.5)
    this.viewportWidth = pixelWidth
    this.viewportHeight = pixelHeight

    // Calculate aspect ratio: aspect.x = sqrt(width/height), aspect.y = 1/aspect.x
    const aspectRatio = this.viewportWidth / this.viewportHeight
    this.aspect[0] = Math.sqrt(aspectRatio)
    this.aspect[1] = 1.0 / this.aspect[0]
  }
  
  
  setResolution(res: vec2) {
    this.resolution = vec2.clone(res)
    // Trigger viewport recalculation based on new screen resolution
    this.requireAreaUpdate = true
  }
  
  render(deltaTime: number, targetFramebuffer: WebGLFramebuffer | null) {
    if (this.requireAreaUpdate) {
      this.updateViewport()
      this.requireAreaUpdate = false
    }

    this.update(deltaTime)
    this.renderParticles(deltaTime, targetFramebuffer)
  }
  
  private update(deltaTime: number) {
    // Update RGB controls
    const sustain = Math.pow(0.5, deltaTime)
    this.colorARgbFader.update(sustain)
    this.colorBRgbFader.update(sustain)
    this.intensityColorFader.update(sustain)
    this.zCenterFader.update(sustain)
    
    const gl = this.gl
    
    this.updateProgram.use()

    // Update noise time
    this.noiseTime += deltaTime * this.noiseTimeScaleFader.value

    const updateUniLocs = this.updateProgram.uniLocs
    gl.uniform1f(updateUniLocs.time, this.noiseTime)
    gl.uniform2fv(updateUniLocs.aspect, this.aspect)
    
    const excitement = 0
    const yWind = this.yWindBaseFader.value * (1 + excitement * 1.5) 
    gl.uniform1f(updateUniLocs.yWind, yWind)
    gl.uniform1f(updateUniLocs.speed, this.speedFader.value ** 2)
    
    gl.uniform1f(updateUniLocs.zCenter, this.zCenterFader.getValue())
    
    gl.uniform1f(updateUniLocs.zGravity, this.zGravityFader.value * deltaTime)
    
    const sourceIndex = this.currentRenderIndex
    const targetIndex = 1 - sourceIndex
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.renderFbos[targetIndex])
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]) // Set single render target
    gl.viewport(0, 0, this.sqrtNumParticles, this.sqrtNumParticles)

    // Ensure clean state for data texture update
    gl.disable(gl.BLEND)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.STENCIL_TEST)
    gl.disable(gl.SCISSOR_TEST)
    gl.colorMask(true, true, true, true)

    // Explicitly set active texture unit before binding
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.renderTextures[sourceIndex][0])

    this.rectVao.draw()

    // Don't bind null - leave the current framebuffer bound

    this.currentRenderIndex = targetIndex
  }
  
  renderParticles(deltaTime: number, targetFramebuffer: WebGLFramebuffer | null) {
    const gl = this.gl

    // Bind target framebuffer for final particle rendering
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFramebuffer)
    gl.viewport(this.viewportX, this.viewportY, this.viewportWidth, this.viewportHeight)
    
    
    // Enable or disable stencil test based on switch
    if(this.useStencilSwitch.on) {
      gl.enable(gl.STENCIL_TEST)
      // Only render where stencil buffer value equals 1 (inside area)
      gl.stencilFunc(gl.EQUAL, 1, 0xFF)
      gl.stencilMask(0x00) // Don't modify stencil buffer
    } else {
      gl.disable(gl.STENCIL_TEST)
    }
    
    this.renderProgram.use()
    
    const renderUniLocs = this.renderProgram.uniLocs
    
    gl.uniform1i(renderUniLocs.sqrtNumParticles, this.sqrtNumParticles)
    gl.uniform1f(renderUniLocs.invSqrtNumParticles, 1 / this.sqrtNumParticles)
    gl.uniform1f(renderUniLocs.invNumParticles, 1 / (this.sqrtNumParticles * this.sqrtNumParticles))
    gl.uniform1f(renderUniLocs.intensityFactor, this.intensityFactorFader.value)
    
    gl.uniform1f(renderUniLocs.invMaxDistance, 1 / ProjRenderContext.FAR_PLANE)
    gl.uniform1f(renderUniLocs.maxDistanceSlope, ProjRenderContext.FAR_PLANE)

    const focusDistance = this.zCenterFader.getValue() * (1 + this.focusDistanceFader.value)
    gl.uniform1f(renderUniLocs.focusDistance, focusDistance)
    gl.uniform1f(renderUniLocs.particleSize, this.particleSizeFader.value)
    gl.uniform1f(renderUniLocs.maxFd, this.maxFdFader.value)
    
    gl.uniform3fv(renderUniLocs.colorA, this.colorARgbFader.getValues())
    gl.uniform3fv(renderUniLocs.colorB, this.colorBRgbFader.getValues())
    gl.uniform3fv(renderUniLocs.intensityColor, this.intensityColorFader.getValues())
    
    // Blinking
    const blinkFrequency = this.blinkFrequencyFader.value
    this.blinkPhase += deltaTime * 0.01 * blinkFrequency
    if(this.blinkPhase > 1) {
      this.blinkPhase = 0
    }
    gl.uniform1f(renderUniLocs.blinkPhase, this.blinkPhase)
    gl.uniform1f(renderUniLocs.blinkAmount, this.blinkAmountFader.value)
    const blinkSlope = 500 / (this.blinkDurationFader.value * blinkFrequency)
    gl.uniform1f(renderUniLocs.blinkSlope, blinkSlope)
    
    gl.uniform1f(renderUniLocs.dofAmount, this.dofAmountFader.value * 0.1)
    const relativeFeather = (this.featherFader.value * this.aspect[1] / this.viewportHeight) * 2.0
    gl.uniform1f(renderUniLocs.relativeFeather, relativeFeather)

    gl.uniform2fv(renderUniLocs.aspect, this.aspect)
    
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.renderTextures[this.currentRenderIndex][0])
    gl.uniform1i(renderUniLocs.positionsTex, 0)
    
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
    
    gl.bindVertexArray(this.particleVao)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.numParticles)
    
    gl.disable(gl.BLEND)
    gl.disable(gl.STENCIL_TEST)
    gl.depthMask(true)
    
    gl.bindVertexArray(null)
  }
  
  
  getCurrentTexture(): WebGLTexture | null {
    return this.renderTextures[this.currentRenderIndex]?.[0] || null
  }

  getControls(): Controls.Tabs.Receiver {
    const physicsControls = {
      'drift amount': this.driftAmountFader,
      'noise amount': this.noiseAmountFader,
      'x wind base': this.yWindBaseFader,
      'speed': this.speedFader,
      'speed boost factor': this.speedBoostFactorFader,
      'noise time scale': this.noiseTimeScaleFader,
      'sqrt num particles': this.sqrtNumParticlesFader,
      'z center': this.zCenterFader.getControl(), 
      'z gravity': this.zGravityFader,
    }
    
    const physicsGroup = new Controls.Group.Receiver(new Controls.Group.SpecWithoutControls(
      new Controls.Base.Args('physics', 0, 0, 100, 100, '#333')
    ), physicsControls)
    
    const visualControls = {
      'intensity factor': this.intensityFactorFader,
      'focus distance': this.focusDistanceFader,
      'particle size': this.particleSizeFader,
      'max blur': this.maxFdFader,
      'feather pixel': this.featherFader,
      'dof amount': this.dofAmountFader,
      'use stencil': this.useStencilSwitch,
    }
    
    const visualGroup = new Controls.Group.Receiver(new Controls.Group.SpecWithoutControls(
      new Controls.Base.Args('visual', 0, 0, 100, 100, '#333')
    ), visualControls)
    
    const colorControls = {
      ...this.colorARgbFader.getControls(),
      ...this.colorBRgbFader.getControls(),
      ...this.intensityColorFader.getControls(),
      'blink amount': this.blinkAmountFader,
      'blink frequency': this.blinkFrequencyFader,
      'blink duration': this.blinkDurationFader,
    }
    
    const colorGroup = new Controls.Group.Receiver(new Controls.Group.SpecWithoutControls(
      new Controls.Base.Args('colors', 0, 0, 100, 100, '#333')
    ), colorControls)
    
    const tabs = {
      'Physics': physicsGroup,
      'Visual': visualGroup,
      'Colors': colorGroup,
    }
    
    return new Controls.Tabs.Receiver(new Controls.Tabs.SpecWithoutControls(
      new Controls.Base.Args('bokeh', 0, 0, 100, 100, '#f84'),
      'Physics'
    ), tabs)
  }
}