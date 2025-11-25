
import { vec2 } from 'gl-matrix'

export function lerp(a: number, b: number, p: number) {
  return a * (1 - p) + b * p
}

export function findDoubleCircleIntersection(
  M1: vec2, 
  r1Squared: number, 
  M2: vec2, 
  r2Squared: number, 
  dir: vec2
): vec2 {
  const dx = M2[0] - M1[0]
  const dy = M2[1] - M1[1]
  const d = Math.sqrt(dx * dx + dy * dy)
  
  if (d === 0) {
    return vec2.clone(M1)
  }
  
  const r1 = Math.sqrt(r1Squared)
  const r2 = Math.sqrt(r2Squared)
  
  if (d > r1 + r2 || d < Math.abs(r1 - r2)) {
    return vec2.fromValues((M1[0] + M2[0]) / 2, (M1[1] + M2[1]) / 2)
  }
  
  const a = (r1Squared - r2Squared + d * d) / (2 * d)
  const h = Math.sqrt(r1Squared - a * a)
  
  const px = M1[0] + (a * dx) / d
  const py = M1[1] + (a * dy) / d
  
  const intersection1 = vec2.fromValues(px + (h * dy) / d, py - (h * dx) / d)
  const intersection2 = vec2.fromValues(px - (h * dy) / d, py + (h * dx) / d)
  
  const diff1 = vec2.create()
  const diff2 = vec2.create()
  vec2.sub(diff1, intersection1, M1)
  vec2.sub(diff2, intersection2, M1)
  
  const dot1 = vec2.dot(diff1, dir)
  const dot2 = vec2.dot(diff2, dir)
  
  return dot1 >= dot2 ? intersection1 : intersection2
}