#version 300 es

precision highp float;
precision mediump int;

in vec2 a_position;

uniform int sqrtNumParticles;

out vec2 particleId; 

void main() {
    gl_Position = vec4(a_position, 0, 1);

    vec2 uv = a_position * 0.5 + 0.5;
    particleId = vec2(uv * float(sqrtNumParticles));
}