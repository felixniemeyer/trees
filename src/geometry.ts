import { GridArea, Point } from 'web-mapper';
import { vec2, vec3 } from 'gl-matrix';

const bokehPoints: Point[][] = [];
for (let i = 0; i < 2; i++) {
  bokehPoints.push([]);
  for (let j = 0; j < 2; j++) {
    bokehPoints[i]!.push(new Point(vec2.fromValues(i * 0.1 - 0.05, j * 0.1 - 0.05), 0));
  }
}

export const bokeh = new GridArea(bokehPoints, vec3.fromValues(0.8, 0.8, 0.2), 0);
