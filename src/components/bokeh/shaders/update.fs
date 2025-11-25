#version 300 es

precision highp float;
precision mediump int;

uniform sampler2D inPosTex;

uniform int sqrtNumParticles;
uniform int numParticles;
uniform float invSqrtNumParticles;
uniform float invNumParticles;

uniform float driftAmount;
uniform float noiseAmount;
uniform float xWind;

uniform float speed;
uniform float zCenter;
uniform float zGravity;

// Time for 4D noise
uniform float time;

// Aspect ratio for viewport-normalized coordinates
uniform vec2 aspect; // aspect.x = sqrt(width/height), aspect.y = 1/aspect.x

in vec2 particleId;

layout(location=0) out vec4 pos;

float hash(int x); 
float snoise4d(vec4 v); 
#include "../../noise.glsl"

// 5-octave 4D noise
vec3 fbm4d(vec4 p) {
  vec3 result = vec3(0.0);
  float amplitude = 1.0;
  float frequency = 1.0;
  
  for(int i = 0; i < 5; i++) {
    result += amplitude * vec3(
      snoise4d(p * frequency + vec4(0.0, 0.0, 0.0, 0.0)),
      snoise4d(p * frequency + vec4(100.0, 0.0, 0.0, 0.0)), 
      snoise4d(p * frequency + vec4(0.0, 100.0, 0.0, 0.0))
    );
    amplitude *= 0.5;
    frequency *= 2.0;
  }
  
  return result;
}

void main() {
  ivec2 iUv = ivec2(floor(particleId));
  int id = iUv.x + iUv.y * sqrtNumParticles;
  float normId = float(id) * invNumParticles;

  vec3 inPos = texelFetch(inPosTex, iUv, 0).xyz;

  float noiseSpeed = float(iUv.y) * invSqrtNumParticles + 0.5;

  vec3 drift = (vec3(
    hash(id),
    hash(id + numParticles),
    hash(id + numParticles * 2)
  ) - 0.5) * driftAmount;

  // 4D noise for smooth movement using aspect-corrected position
  vec4 noisePos = vec4(inPos.xy * inPos.z * aspect, inPos.z, time) * 0.1;
  vec3 noise = fbm4d(noisePos);

  // Z-gravity toward z-center
  float zForce = (zCenter - inPos.z) * zGravity;
  float invZ = 1.0 / inPos.z;
  zForce += 0.2 * invZ; 

  vec3 combinedVelo = noiseSpeed * noise * noiseAmount + drift;
  combinedVelo.x += xWind;
  combinedVelo.z += zForce;

  // Convert world-space velocity to viewport-space and apply z-scaling
  vec3 newPos = inPos + combinedVelo * speed * vec3(aspect.yx * invZ, 1.0);

  // Keep particles beyond minimum distance for perspective scaling
  newPos.z = max(newPos.z, 1.0);

  // Simple viewport wrapping with padding
  vec2 wrapBound = 1.0 + aspect.yx * 0.1;

  // Wrap using mod with viewport bounds
  newPos.xy = mod(newPos.xy + wrapBound, wrapBound * 2.0) - wrapBound;

  pos = vec4(newPos, 1.0);
}