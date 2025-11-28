import { TriangleStripArtworkRenderer } from './artwork-renderer'
import { Tree } from './tree'
import ShaderProgram from 'web-mapper/src/utils/shader-program'
import { TriangleStripArea, type WebMapper, type ProjRenderContext, Point } from 'web-mapper'
import { vec2 } from 'gl-matrix'
import shadowProcessVs from './shaders/shadow-process.vs'
import shadowProcessFs from './shaders/shadow-process.fs'
import compositeVs from "./shaders/forest-composite.vs"
import compositeFs from './shaders/composite.fs'
import { Controls } from 'av-controls'
import { Clock, TapPatternPairWithAmountFader } from 'time-n-controls'
import type IndexedDBStorage from 'web-mapper/src/storage/indexdb'

interface Bump {
  start: number
  size: number
  duration: number
  indices: number[]
}

export class Forest {
  private gl: WebGL2RenderingContext
  private webMapper: WebMapper
  private storage: IndexedDBStorage
  private renderContext: ProjRenderContext
  private trees: Tree[] = []
  private resolution: [number, number]
  private treeCount: number = 0
  private clock: Clock

  // Animation state
  private bumps: Bump[] = []
  private permutation: number[] = []
  private permutationOffset = 0

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

  // Audio reactivity
  private lastFrameTime: number = performance.now()
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private audioDataArray: Float32Array | null = null
  private audioEnabled: boolean = false

  // Controls - initialized inline
  private shadowSizeFader = new Controls.Fader.Receiver(
    new Controls.Fader.Spec(
      new Controls.Base.Args('shadow size', 0, 15, 20, 30, '#58a'),
      0.25, 0.01, 1, 2
    )
  )

  private shadowAlphaFader = new Controls.Fader.Receiver(
    new Controls.Fader.Spec(
      new Controls.Base.Args('shadow alpha', 20, 15, 20, 30, '#58a'),
      0.02, 0, 0.1, 3
    )
  )

  private shadowAmountFader = new Controls.Fader.Receiver(
    new Controls.Fader.Spec(
      new Controls.Base.Args('shadow amount', 40, 15, 20, 30, '#58a'),
      5, 0, 10, 2
    )
  )

  private lightAmountFader = new Controls.Fader.Receiver(
    new Controls.Fader.Spec(
      new Controls.Base.Args('light amount', 60, 15, 20, 30, '#58a'),
      5, 0, 10, 2
    )
  )

  private shadowOffsetFader = new Controls.Fader.Receiver(
    new Controls.Fader.Spec(
      new Controls.Base.Args('shadow offset', 80, 15, 20, 30, '#58a'),
      0.2, -0.1, 0.4, 2
    )
  )

  private speedScaleFader = new Controls.Fader.Receiver(
    new Controls.Fader.Spec(
      new Controls.Base.Args('speed scale', 60, 60, 20, 30, '#a85'),
      1.0, 0, 2, 2
    )
  )

  private speedPulseFader = new Controls.Fader.Receiver(
    new Controls.Fader.Spec(
      new Controls.Base.Args('speed pulse', 80, 60, 20, 30, '#a85'),
      0.0, 0, 1, 2
    )
  )

  // Animation Controls
  private lightUpTap!: TapPatternPairWithAmountFader // Initialized in constructor

  private lightUpPercentage = new Controls.Fader.Receiver(
    new Controls.Fader.Spec(
      new Controls.Base.Args('light up %', 20, 0, 20, 50, '#f84'),
      0.1, 0, 1, 2
    )
  )

  private bumpDuration = new Controls.Fader.Receiver(
    new Controls.Fader.Spec(
      new Controls.Base.Args('duration', 40, 0, 20, 50, '#f84'),
      1.0, 0.1, 5.0, 2
    )
  )

  private bumpSteepness = new Controls.Fader.Receiver(
    new Controls.Fader.Spec(
      new Controls.Base.Args('steepness', 60, 0, 20, 50, '#f84'),
      14.0, 1.0, 50.0, 2
    )
  )

  private bumpVersatz = new Controls.Fader.Receiver(
    new Controls.Fader.Spec(
      new Controls.Base.Args('versatz', 80, 0, 20, 50, '#f84'),
      0.0, 0.0, 1.0, 2
    )
  )

  private audioToggle!: Controls.Switch.Receiver
  private addTreePad!: Controls.Pad.Receiver
  private removeTreePad!: Controls.Pad.Receiver
  private moveTreeUpPad!: Controls.Pad.Receiver
  private moveTreeDownPad!: Controls.Pad.Receiver
  private randomizeDepthsPad!: Controls.Pad.Receiver
  private previousTreePad!: Controls.Pad.Receiver
  private nextTreePad!: Controls.Pad.Receiver
  private deselectTreePad!: Controls.Pad.Receiver
  private randomizeSpeedsPad!: Controls.Pad.Receiver
  private increaseOctavesPad!: Controls.Pad.Receiver
  private decreaseOctavesPad!: Controls.Pad.Receiver
  private shuffleFrequenciesPad!: Controls.Pad.Receiver

  constructor(
    gl: WebGL2RenderingContext,
    webMapper: WebMapper,
    storage: IndexedDBStorage,
    _artworkId: string,
    renderContext: ProjRenderContext,
    resolution: [number, number],
    clock: Clock
  ) {
    this.gl = gl
    this.webMapper = webMapper
    this.storage = storage
    this.renderContext = renderContext
    this.resolution = resolution
    this.clock = clock

    // Initialize animation controls that require clock
    this.lightUpTap = new TapPatternPairWithAmountFader(
      'light up', 0, 0, 20, 50, '#f84',
      this.clock,
      (velocity: number) => this.triggerLightUp(velocity)
    )

    // Trees will be populated by loadTrees()
    this.trees = []

    // Create render targets
    this.treesTexture = this.createTexture()
    this.treesDepthBuffer = this.createDepthBuffer()
    this.treesFramebuffer = this.createFramebufferWithDepth(this.treesTexture, this.treesDepthBuffer)

    this.shadowMap = this.createShadowTexture()
    this.shadowFramebuffer = this.createFramebuffer(this.shadowMap)

    // Create shaders
    this.shadowProcessProgram = new ShaderProgram(gl, shadowProcessVs, shadowProcessFs)
    this.compositeProgram = new ShaderProgram(gl, compositeVs, compositeFs)

    // Create fullscreen quad
    this.quadVAO = this.createFullscreenQuad()
  }

  // Tree loading and management
  async loadTrees() {
    // Load tree count from storage
    this.treeCount = await this.storage.loadArea('tree-count') || 1

    // Load each tree
    for (let i = 0; i < this.treeCount; i++) {
      const area = await this.webMapper.loadOrCreateArea(`tree-${i}`, () => this.createDefaultTree(i))
      const treeArea = area as TriangleStripArea
      
      // Initialize metadata if needed
      this.initializeTreeMetadata(treeArea, i)
      
      // Create Tree wrapper
      const tree = new Tree(
        treeArea, 
        this.gl, 
        this.renderContext, 
        this.webMapper, 
        vec2.fromValues(this.resolution[0], this.resolution[1])
      )
      this.trees.push(tree)
    }

    // Initialize permutation
    this.updatePermutation()

    console.log(`Forest: Loaded ${this.treeCount} tree(s)`)
  }

  private createDefaultTree(index: number): TriangleStripArea {
    const points = [
      new Point(vec2.fromValues(-0.2, -0.2), 0),
      new Point(vec2.fromValues(0.2, -0.2), 0),
      new Point(vec2.fromValues(-0.2, 0.2), 0),
      new Point(vec2.fromValues(0.2, 0.2), 0),
    ]
    const color = this.generateColor(index)
    const angle = 0
    return new TriangleStripArea(points, color, angle)
  }

  private generateColor(index: number): [number, number, number] {
    // Generate deterministic but varied colors based on index
    const hue = (index * 137.508) % 360 // Golden angle for good distribution
    return this.hslToRgb(hue / 360, 0.7, 0.6)
  }

  private hslToRgb(h: number, s: number, l: number): [number, number, number] {
    let r, g, b

    if (s === 0) {
      r = g = b = l
    } else {
      const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1
        if (t > 1) t -= 1
        if (t < 1/6) return p + (q - p) * 6 * t
        if (t < 1/2) return q
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6
        return p
      }

      const q = l < 0.5 ? l * (1 + s) : l + s - l * s
      const p = 2 * l - q
      r = hue2rgb(p, q, h + 1/3)
      g = hue2rgb(p, q, h)
      b = hue2rgb(p, q, h - 1/3)
    }

    return [r, g, b]
  }

  private initializeTreeMetadata(area: TriangleStripArea, index: number) {
    if (!area.metadata) {
      area.metadata = {}
    }

    // Initialize speed
    if (area.metadata.speed === undefined) {
      area.metadata.speed = Math.random() * 0.4 - 0.2 // -0.2 to 0.2
      area.save()
    }

    // Initialize depth
    if (area.metadata.depth === undefined) {
      area.metadata.depth = Math.random()
      area.save()
    }

    // Initialize frequency index
    if (area.metadata.frequencyIndex === undefined) {
      area.metadata.frequencyIndex = index
      area.save()
    }
  }

  private updatePermutation() {
    // Update permutation for animation
    this.permutation = Array.from({ length: this.trees.length }, (_, i) => i)
    // Shuffle permutation
    for (let i = this.permutation.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.permutation[i], this.permutation[j]] = [this.permutation[j]!, this.permutation[i]!]
    }
  }

  async addTree() {
    const index = this.treeCount
    const area = await this.webMapper.loadOrCreateArea(`tree-${index}`, () => this.createDefaultTree(index))
    const treeArea = area as TriangleStripArea
    this.initializeTreeMetadata(treeArea, index)

    const tree = new Tree(
      treeArea, 
      this.gl, 
      this.renderContext, 
      this.webMapper, 
      vec2.fromValues(this.resolution[0], this.resolution[1])
    )
    this.trees.push(tree)

    this.treeCount++
    await this.storage.saveArea('tree-count', this.treeCount)

    this.updatePermutation()

    console.log(`Added tree ${index}. Total: ${this.treeCount}`)
  }

  async removeTree() {
    if (this.treeCount === 0) {
      console.log('No trees to remove')
      return
    }

    const index = this.treeCount - 1
    const tree = this.trees.pop()!

    // Remove from WebMapper and storage
    await this.storage.saveArea(`tree-${index}`, null)
    this.webMapper.removeArea(tree.area)
    tree.destroy()

    this.treeCount--
    await this.storage.saveArea('tree-count', this.treeCount)

    this.updatePermutation()

    console.log(`Removed tree. Total: ${this.treeCount}`)
  }

  private triggerLightUp(velocity: number) {
    if (this.treeCount === 0) return

    const count = Math.round(0.5 + this.lightUpPercentage.value * (this.treeCount - 0.5))
    const indices: number[] = []
    
    for (let i = 0; i < count; i++) {
      const idx = this.permutation[(this.permutationOffset + i) % this.treeCount]!
      indices.push(idx)
    }
    
    this.permutationOffset = (this.permutationOffset + Math.floor(count * this.lightUpPercentage.value)) % this.treeCount

    this.bumps.push({
      start: this.clock.getBeat(),
      size: velocity * this.lightUpTap.amountFader.value,
      duration: this.bumpDuration.value,
      indices: indices
    })
  }

  setResolution(width: number, height: number) {
    // Only recreate if resolution actually changed
    if (width === this.resolution[0] && height === this.resolution[1]) {
      console.log(`Forest: Resolution unchanged (${width}x${height})`)
      return
    }

    console.log(`Forest: Recreating framebuffers ${this.resolution[0]}x${this.resolution[1]} → ${width}x${height}`)
    this.resolution = [width, height]

    const gl = this.gl

    // Delete old render targets
    gl.deleteTexture(this.treesTexture)
    gl.deleteRenderbuffer(this.treesDepthBuffer)
    gl.deleteFramebuffer(this.treesFramebuffer)
    gl.deleteTexture(this.shadowMap)
    gl.deleteFramebuffer(this.shadowFramebuffer)

    // Recreate render targets with new resolution
    this.treesTexture = this.createTexture()
    this.treesDepthBuffer = this.createDepthBuffer()
    this.treesFramebuffer = this.createFramebufferWithDepth(this.treesTexture, this.treesDepthBuffer)
    this.shadowMap = this.createShadowTexture()
    this.shadowFramebuffer = this.createFramebuffer(this.shadowMap)
    
    // Update resolution for all trees
    const resVec = vec2.fromValues(width, height)
    this.trees.forEach(tree => tree.setResolution(resVec))
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

  private createShadowTexture(): WebGLTexture {
    const gl = this.gl
    const texture = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R32F,  // Single-channel 32-bit float
      this.resolution[0],
      this.resolution[1],
      0,
      gl.RED,   // Single channel
      gl.FLOAT,
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

  render(time: number, targetFramebuffer: WebGLFramebuffer | null, debugMode: number = 0) {
    const gl = this.gl

    // Calculate delta time
    const now = performance.now()
    const deltaTime = Math.min((now - this.lastFrameTime) / 1000, 0.1) // Cap at 100ms
    this.lastFrameTime = now

    // Process audio if enabled
    if (this.audioEnabled && this.analyser && this.audioDataArray) {
      this.analyser.getFloatFrequencyData(this.audioDataArray as any)
      this.processAudio(this.audioDataArray, deltaTime)
      // Debug: log first smoothed energy value occasionally
      if (Math.random() < 0.01) {
        console.log('Audio processing:', this.smoothedEnergies[0], 'offset:', this.audioOffsets[0])
      }
    }

    // Update phase
    // Done in loop below

    // Step 1: Render all trees to trees texture with depth in alpha
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.treesFramebuffer)
    gl.viewport(0, 0, this.resolution[0], this.resolution[1])
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

    // Disable blending for opaque tree rendering
    gl.disable(gl.BLEND)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LESS)

    // Calculate boosts from bumps
    const currentBeat = this.clock.getBeat()
    // Clean up old bumps
    const maxDuration = 10 // Safety margin
    this.bumps = this.bumps.filter(b => currentBeat - b.start < b.duration + maxDuration)

    const treeBoosts = new Float32Array(this.treeCount)
    const s = this.bumpSteepness.value
    const versatz = this.bumpVersatz.value

    for (const bump of this.bumps) {
      const bumpTime = currentBeat - bump.start
      if (bumpTime < 0) continue // Future bump?

      // Distribute boost across selected trees with optional versatz
      const invCount = bump.indices.length > 1 ? 1.0 / (bump.indices.length - 1) : 0
      
      for (let i = 0; i < bump.indices.length; i++) {
        const p = i * invCount
        const treeDelay = p * versatz * bump.duration
        const t = (bumpTime - treeDelay) / bump.duration
        
        if (t >= 0 && t <= 1) {
          const xs = t * s
          const xsp1 = xs + 1
          const y = xs * (1 - t) / (xsp1 * xsp1)
          
          const scale = 20.0 
          treeBoosts[bump.indices[i]!] += Math.max(0, y * scale) * bump.size
        }
      }
    }

    // Render phase: Render all trees to our framebuffer
    const speedScale = this.speedScaleFader.value
    const barPhase = this.clock.getBar() % 1
    const pulse = Math.sin(barPhase * Math.PI) // 0 -> 1 -> 0 over one bar
    const speedPulseAmount = this.speedPulseFader.value
    const pulseFactor = 1.0 * (1.0 - speedPulseAmount) + pulse * speedPulseAmount // Lerp between 1 and pulse

    for (let i = 0; i < this.trees.length; i++) {
      const tree = this.trees[i]!
      tree.update(deltaTime, speedScale, pulseFactor)
      tree.render(this.treesFramebuffer, treeBoosts[i]!, debugMode)
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
    gl.uniform1f(this.shadowProcessProgram.uniLocs.u_shadowSize, this.shadowSizeFader.value)
    gl.uniform1f(this.shadowProcessProgram.uniLocs.u_shadowAlpha, this.shadowAlphaFader.value)

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

    gl.uniform1f(this.compositeProgram.uniLocs.u_shadowAmount, this.shadowAmountFader.value)
    gl.uniform1f(this.compositeProgram.uniLocs.u_lightAmount, this.lightAmountFader.value)
    gl.uniform1f(this.compositeProgram.uniLocs.u_shadowOffset, this.shadowOffsetFader.value)

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.shadowMap)
    gl.uniform1i(this.compositeProgram.uniLocs.u_shadowMap, 1)

    // Set resolution for FXAA
    gl.uniform2f(this.compositeProgram.uniLocs.u_resolution, this.resolution[0], this.resolution[1])

    // Draw fullscreen quad
    gl.bindVertexArray(this.quadVAO)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)
  }

  private processAudio(audioData: any, deltaTime: number) {
    const numTrees = this.trees.length
    const minFreq = 30
    const maxFreq = 5000
    const sampleRate = 44100 // Typical sample rate
    const fftSize = 2048

    // Spectrum divided among trees
    const freqRangePerTree = (maxFreq - minFreq) / numTrees

    for (let i = 0; i < numTrees; i++) {
      const tree = this.trees[i]!
      const freqIndex = tree.frequencyIndex

      // Calculate frequency range for this tree
      const freqStart = minFreq + freqIndex * freqRangePerTree
      const freqEnd = freqStart + freqRangePerTree

      // Convert frequencies to FFT bin indices
      const binStart = Math.floor((freqStart / sampleRate) * fftSize)
      const binEnd = Math.ceil((freqEnd / sampleRate) * fftSize)

      // Average energy across bins (dB values, typically -100 to 0)
      let sumEnergy = 0
      let count = 0
      for (let bin = binStart; bin < binEnd && bin < audioData.length; bin++) {
        sumEnergy += audioData[bin]!
        count++
      }

      const avgEnergyDb = count > 0 ? sumEnergy / count : -100
      // Normalize from dB (-100 to 0) to 0-1 range
      const normalizedEnergy = Math.max(0, Math.min(1, (avgEnergyDb + 100) / 100))

      // Smooth energy
      const smoothFactor = Math.min(1, deltaTime * 3 * (1 - this.audioSmoothingFader.value))
      tree.smoothedEnergy = tree.smoothedEnergy + (normalizedEnergy - tree.smoothedEnergy) * smoothFactor

      // Accumulate audio offset
      // NOTE: Audio controls were removed from UI, so this effectively does nothing unless re-enabled in code
      // Keeping logic structure for future use
      // const audioScale = this.audioScaleFader.value // Removed
      const audioScale = 0 // Disabled
      tree.audioOffset += tree.smoothedEnergy * deltaTime * audioScale
    }
  }

  shuffleFrequencies() {
    // Create array of indices
    const indices = Array.from({ length: this.trees.length }, (_, i) => i)

    // Fisher-Yates shuffle
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j]!, indices[i]!]
    }

    // Assign shuffled indices to trees
    for (let i = 0; i < this.trees.length; i++) {
      this.trees[i]!.frequencyIndex = indices[i]!
    }

    console.log('Shuffled frequency assignments')
  }

  randomizeDepths() {
    // Generate new random depths for all trees
    for (let i = 0; i < this.trees.length; i++) {
      const newDepth = Math.random()
      this.trees[i]!.depth = newDepth
    }
  }

  randomizeSpeeds() {
    // Generate new random speeds for all trees
    for (let i = 0; i < this.trees.length; i++) {
      const newSpeed = Math.random() // 0 to 1
      this.trees[i]!.speed = newSpeed
    }
    console.log('Randomized tree speeds')
  }

  // Tree selection methods
  selectNextTree() {
    if (this.trees.length === 0) return

    // Find currently selected tree
    const currentIndex = this.trees.findIndex(t => t.area.isSelected())

    // Deselect current
    if (currentIndex !== -1) {
      this.trees[currentIndex]!.area.setSelected(false)
    }

    // Select next (wrap around)
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % this.trees.length
    this.trees[nextIndex]!.area.setSelected(true)
    this.webMapper.setSelectedArea(this.trees[nextIndex]!.area)
    console.log(`Tree ${nextIndex} selected`)
  }

  selectPreviousTree() {
    if (this.trees.length === 0) return

    // Find currently selected tree
    const currentIndex = this.trees.findIndex(t => t.area.isSelected())

    // Deselect current
    if (currentIndex !== -1) {
      this.trees[currentIndex]!.area.setSelected(false)
    }

    // Select previous (wrap around)
    const prevIndex = currentIndex === -1 ? this.trees.length - 1 : (currentIndex - 1 + this.trees.length) % this.trees.length
    this.trees[prevIndex]!.area.setSelected(true)
    this.webMapper.setSelectedArea(this.trees[prevIndex]!.area)
    console.log(`Tree ${prevIndex} selected`)
  }

  deselectTree() {
    for (const tree of this.trees) {
      tree.area.setSelected(false)
    }
    console.log('Tree deselected')
  }

  getSelectedTreeIndex(): number {
    return this.trees.findIndex(t => t.area.isSelected())
  }

  increaseOctaves() {
    const selectedIndex = this.getSelectedTreeIndex()
    if (selectedIndex === -1) return

    const area = this.trees[selectedIndex]!.area
    const currentOctaves = area.metadata!.octaves || 0
    const newOctaves = Math.min(8, currentOctaves + 1)

    area.metadata!.octaves = newOctaves
    area.save()
    area.broadcastUpdate() // Trigger re-render

    console.log(`Tree ${selectedIndex} octaves: ${newOctaves}`)
  }

  decreaseOctaves() {
    const selectedIndex = this.getSelectedTreeIndex()
    if (selectedIndex === -1) return

    const area = this.trees[selectedIndex]!.area
    const currentOctaves = area.metadata!.octaves || 0
    const newOctaves = Math.max(0, currentOctaves - 1)

    area.metadata!.octaves = newOctaves
    area.save()
    area.broadcastUpdate() // Trigger re-render

    console.log(`Tree ${selectedIndex} octaves: ${newOctaves}`)
  }

  moveSelectedTreeUp() {
    const selectedIndex = this.getSelectedTreeIndex()
    if (selectedIndex === -1) return

    const currentTree = this.trees[selectedIndex]!
    const currentDepth = currentTree.depth

    // Find the tree with the closest depth that is smaller (closer to camera)
    let targetIndex = -1
    let maxDepthBelow = -1

    for (let i = 0; i < this.trees.length; i++) {
      if (i === selectedIndex) continue
      const d = this.trees[i]!.depth
      if (d < currentDepth && d > maxDepthBelow) {
        maxDepthBelow = d
        targetIndex = i
      }
    }

    if (targetIndex === -1) {
      console.log('Already at top (closest)')
      return
    }

    const targetTree = this.trees[targetIndex]!

    // Swap depths
    currentTree.depth = maxDepthBelow
    targetTree.depth = currentDepth

    console.log(`Swapped tree ${selectedIndex} depth (${currentDepth.toFixed(3)}) with tree ${targetIndex} (${maxDepthBelow.toFixed(3)})`)
  }

  moveSelectedTreeDown() {
    const selectedIndex = this.getSelectedTreeIndex()
    if (selectedIndex === -1) return

    const currentTree = this.trees[selectedIndex]!
    const currentDepth = currentTree.depth

    // Find the tree with the closest depth that is larger (further away)
    let targetIndex = -1
    let minDepthAbove = 2 // Start higher than max possible depth (1.0)

    for (let i = 0; i < this.trees.length; i++) {
      if (i === selectedIndex) continue
      const d = this.trees[i]!.depth
      if (d > currentDepth && d < minDepthAbove) {
        minDepthAbove = d
        targetIndex = i
      }
    }

    if (targetIndex === -1) {
      console.log('Already at bottom (furthest)')
      return
    }

    const targetTree = this.trees[targetIndex]!

    // Swap depths
    currentTree.depth = minDepthAbove
    targetTree.depth = currentDepth

    console.log(`Swapped tree ${selectedIndex} depth (${currentDepth.toFixed(3)}) with tree ${targetIndex} (${minDepthAbove.toFixed(3)})`)
  }

  getControls() {
    // Pads - stored as class members, call Forest methods directly
    this.addTreePad = new Controls.Pad.Receiver(new Controls.Pad.Spec(
      new Controls.Base.Args('add tree', 60, 0, 20, 15, '#4a8')
    ), () => this.addTree())

    this.removeTreePad = new Controls.Pad.Receiver(new Controls.Pad.Spec(
      new Controls.Base.Args('remove tree', 80, 0, 20, 15, '#a48')
    ), () => this.removeTree())

    this.moveTreeUpPad = new Controls.Pad.Receiver(new Controls.Pad.Spec(
      new Controls.Base.Args('move up', 0, 60, 20, 15, '#6a8')
    ), () => this.moveSelectedTreeUp())

    this.increaseOctavesPad = new Controls.Pad.Receiver(new Controls.Pad.Spec(
      new Controls.Base.Args('increase octaves', 20, 60, 20, 15, '#4a5')
    ), () => this.increaseOctaves())

    this.moveTreeDownPad = new Controls.Pad.Receiver(new Controls.Pad.Spec(
      new Controls.Base.Args('move down', 0, 75, 20, 15, '#6a8')
    ), () => this.moveSelectedTreeDown())

    this.decreaseOctavesPad = new Controls.Pad.Receiver(new Controls.Pad.Spec(
      new Controls.Base.Args('decrease octaves', 20, 75, 20, 15, '#5a4')
    ), () => this.decreaseOctaves())

    this.randomizeDepthsPad = new Controls.Pad.Receiver(new Controls.Pad.Spec(
      new Controls.Base.Args('randomize depths', 40, 60, 20, 15, '#8a4')
    ), () => this.randomizeDepths())

    this.randomizeSpeedsPad = new Controls.Pad.Receiver(new Controls.Pad.Spec(
      new Controls.Base.Args('randomize speeds', 40, 75, 20, 15, '#8a4')
    ), () => this.randomizeSpeeds())

    this.previousTreePad = new Controls.Pad.Receiver(new Controls.Pad.Spec(
      new Controls.Base.Args('previous tree', 0, 45, 20, 15, '#5a8')
    ), () => this.selectPreviousTree())
    
    this.shuffleFrequenciesPad = new Controls.Pad.Receiver(new Controls.Pad.Spec(
      new Controls.Base.Args('shuffle frequencies', 80, 60, 20, 15, '#a58')
    ), () => this.shuffleFrequencies())

    // Organize into tabs
    const treesControls = {
      'add tree': this.addTreePad,
      'remove tree': this.removeTreePad,
      'move up': this.moveTreeUpPad,
      'move down': this.moveTreeDownPad,
      'randomize depths': this.randomizeDepthsPad,
      'randomize speeds': this.randomizeSpeedsPad,
      'previous tree': this.previousTreePad,
      'next tree': this.nextTreePad,
      'deselect tree': this.deselectTreePad,
      'increase octaves': this.increaseOctavesPad,
      'decrease octaves': this.decreaseOctavesPad,
      'shuffle frequencies': this.shuffleFrequenciesPad,
      'shadow size': this.shadowSizeFader,
      'shadow alpha': this.shadowAlphaFader,
      'shadow amount': this.shadowAmountFader,
      'light amount': this.lightAmountFader,
      'shadow offset': this.shadowOffsetFader,
      'speed scale': this.speedScaleFader,
      'speed pulse': this.speedPulseFader,
    }

    const treesGroup = new Controls.Group.Receiver(new Controls.Group.SpecWithoutControls(
      new Controls.Base.Args('trees-main', 0, 0, 100, 100, '#333')
    ), treesControls)

    const animationControls = {
      ...this.lightUpTap.getControls(),
      'light up %': this.lightUpPercentage,
      'duration': this.bumpDuration,
      'steepness': this.bumpSteepness,
      'versatz': this.bumpVersatz,
    }

    const animationGroup = new Controls.Group.Receiver(new Controls.Group.SpecWithoutControls(
      new Controls.Base.Args('trees-anim', 0, 0, 100, 100, '#333')
    ), animationControls)

    return new Controls.Tabs.Receiver(new Controls.Tabs.SpecWithoutControls(
      new Controls.Base.Args('forest', 0, 0, 100, 100, '#f84'),
      'Trees'
    ), {
      'Trees': treesGroup,
      'Animation': animationGroup
    })
  }

  // Audio methods
  async initAudio() {
    try {
      this.audioContext = new AudioContext()
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const source = this.audioContext.createMediaStreamSource(stream)

      this.analyser = this.audioContext.createAnalyser()
      this.analyser.fftSize = 2048
      this.analyser.smoothingTimeConstant = 0.3

      source.connect(this.analyser)

      this.audioDataArray = new Float32Array(this.analyser.frequencyBinCount)

      console.log('Audio initialized - microphone active')
      return true
    } catch (error) {
      console.error('Failed to initialize audio:', error)
      return false
    }
  }

  async toggleAudioReactivity() {
    if (!this.audioEnabled && !this.audioContext) {
      const success = await this.initAudio()
      if (success) {
        this.audioEnabled = true
        console.log('Audio reactivity: ON')
        return true
      }
      return false
    } else {
      this.audioEnabled = !this.audioEnabled
      console.log(`Audio reactivity: ${this.audioEnabled ? 'ON' : 'OFF'}`)
      return this.audioEnabled
    }
  }

  dispose() {
    const gl = this.gl
    gl.deleteTexture(this.treesTexture)
    gl.deleteRenderbuffer(this.treesDepthBuffer)
    gl.deleteFramebuffer(this.treesFramebuffer)
    gl.deleteTexture(this.shadowMap)
    gl.deleteFramebuffer(this.shadowFramebuffer)
    gl.deleteVertexArray(this.quadVAO)

    // Clean up audio
    if (this.audioContext) {
      this.audioContext.close()
    }
  }
}
