#version 300 es

precision highp float;

// Vertex position in NDC [-1, 1]
in vec2 position;
// Photo pixel coordinates to sample from
in vec2 photoPixelCoord;

// Uniforms
uniform vec2 photoDimensions;

// Output to fragment shader
out vec2 v_photoUV;

void main() {
  // Convert photo pixel coordinates to UV [0, 1]
  v_photoUV = photoPixelCoord / photoDimensions;

  gl_Position = vec4(position, 0.0, 1.0);
}
