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

  // DEBUG: Skip projection matrix, use positions directly as NDC
  gl_Position = vec4(position.xy, 0.0, 1.0);

  // Original with projection:
  // gl_Position = projectionMatrix * vec4(position, 1.0);
}
