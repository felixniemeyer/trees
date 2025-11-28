import { TriangleStripArtworkRenderer } from './artwork-renderer'
import { TriangleStripArea, type WebMapper, type ProjRenderContext } from 'web-mapper'
import { vec2 } from 'gl-matrix'

export class Tree {
  public area: TriangleStripArea
  public renderer: TriangleStripArtworkRenderer
  
  // Runtime state
  public offset: number = 0
  public audioOffset: number = 0
  public smoothedEnergy: number = 0
  
  constructor(
    area: TriangleStripArea,
    gl: WebGL2RenderingContext,
    renderContext: ProjRenderContext,
    webMapper: WebMapper,
    resolution: vec2
  ) {
    this.area = area
    this.renderer = new TriangleStripArtworkRenderer(area, gl, renderContext, webMapper)
    this.renderer.setResolution(resolution)
  }

  get speed(): number {
    return this.area.metadata?.speed || 0
  }

  set speed(v: number) {
    if (!this.area.metadata) this.area.metadata = {}
    this.area.metadata.speed = v
    this.area.save()
  }

  get depth(): number {
    return this.area.metadata?.depth || 0
  }

  set depth(v: number) {
    if (!this.area.metadata) this.area.metadata = {}
    this.area.metadata.depth = v
    this.area.save()
  }

  get frequencyIndex(): number {
    return this.area.metadata?.frequencyIndex || 0
  }

  set frequencyIndex(v: number) {
    if (!this.area.metadata) this.area.metadata = {}
    this.area.metadata.frequencyIndex = v
    this.area.save()
  }

  update(deltaTime: number, speedScale: number, pulseFactor: number) {
    this.renderer.update()
    
    const instantaneousSpeed = this.speed * speedScale * pulseFactor * 0.1
    this.offset += instantaneousSpeed * deltaTime
  }

  render(targetFramebuffer: WebGLFramebuffer | null, boost: number, debugMode: number) {
    const totalTime = this.offset + this.audioOffset
    this.renderer.render(totalTime, targetFramebuffer, this.depth, boost, debugMode)
  }

  setResolution(res: vec2) {
    this.renderer.setResolution(res)
  }

  destroy() {
    this.renderer.destroy()
  }
}
