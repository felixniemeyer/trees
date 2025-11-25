#version 300 es

in vec2 a_position;
out vec2 v_uv;

// FXAA texture coordinates
out vec2 v_rgbNW;
out vec2 v_rgbNE;
out vec2 v_rgbSW;
out vec2 v_rgbSE;
out vec2 v_rgbM;

uniform vec2 u_resolution;

void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);

    // Pre-compute FXAA texture coordinates for mobile optimization
    // Converts from NDC [-1,1] to pixel coordinates [0, resolution]
    vec2 fragCoord = v_uv * u_resolution;
    vec2 inverseVP = 1.0 / u_resolution;

    v_rgbNW = (fragCoord + vec2(-1.0, -1.0)) * inverseVP;
    v_rgbNE = (fragCoord + vec2(1.0, -1.0)) * inverseVP;
    v_rgbSW = (fragCoord + vec2(-1.0, 1.0)) * inverseVP;
    v_rgbSE = (fragCoord + vec2(1.0, 1.0)) * inverseVP;
    v_rgbM = fragCoord * inverseVP;
}
