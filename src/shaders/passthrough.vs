#version 300 es

in vec2 a_position;
out vec2 v_uv;

uniform vec2 u_resolution; // Keep if needed for other pass-through, but not for simple UVs

void main() {
    v_uv = a_position * 0.5 + 0.5; // Map [-1,1] quad to [0,1] UVs
    gl_Position = vec4(a_position, 0.0, 1.0);
}
