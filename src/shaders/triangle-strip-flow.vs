#version 300 es

precision highp float;

// Vertex attributes
in vec3 position;  // 3D projPos from triangle strip
in vec2 uv;        // UV coordinates (x: 0 or 1, y: normalized distance)

// Uniforms
uniform mat4 projectionMatrix;

// Output to fragment shader
out vec2 v_uv;

void main() {
  v_uv = uv;

  // Apply projection matrix for proper 3D to 2D transformation
  gl_Position = projectionMatrix * vec4(position, 1.0);
}
