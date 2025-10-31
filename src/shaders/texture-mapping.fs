#version 300 es

precision highp float;

// Input from vertex shader
in vec2 v_photoUV;

// Uniforms
uniform sampler2D photoTexture;

// Output
out vec4 fragColor;

void main() {
  // Sample the photo texture with mirrored repeat
  fragColor = texture(photoTexture, v_photoUV);
}
