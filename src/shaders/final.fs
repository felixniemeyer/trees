#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

// FXAA texture coordinates from vertex shader (unused in passthrough)
in vec2 v_rgbNW;
in vec2 v_rgbNE;
in vec2 v_rgbSW;
in vec2 v_rgbSE;
in vec2 v_rgbM;

uniform sampler2D u_texture;
uniform vec2 u_resolution;

void main() {
    // Simple passthrough - disable FXAA
    fragColor = texture(u_texture, v_uv);
}