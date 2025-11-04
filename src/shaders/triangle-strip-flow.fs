#version 300 es

precision highp float;

// Input from vertex shader
in vec2 v_uv;

// Uniforms
uniform sampler2D photoTexture;
uniform float time;  // Time for scrolling animation
uniform float u_depth;  // Depth value for this tree

// Output
out vec4 fragColor;

void main() {
  // Scroll UV coordinates along Y axis using mod(2.0) for mirrored repeat
  vec2 scrollUv = vec2(v_uv.x, mod(v_uv.y + time, 2.0));

  // Sample the photo texture with mirrored repeat
  vec4 color = texture(photoTexture, scrollUv);

  // Output RGB with depth in alpha channel
  fragColor = vec4(color.rgb, u_depth);

  //debug
  // fragColor = vec4(1);
}
