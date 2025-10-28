#version 300 es

precision highp float;

// Input from vertex shader
in vec2 v_uv;

// Uniforms
uniform sampler2D photoTexture;
uniform float time;  // Time for scrolling animation

// Output
out vec4 fragColor;

void main() {
  // Scroll UV coordinates along Y axis using fract for looping
  vec2 scrollUv = vec2(v_uv.x, fract(v_uv.y + time));

  // Sample the photo texture
  fragColor = texture(photoTexture, scrollUv);
}
