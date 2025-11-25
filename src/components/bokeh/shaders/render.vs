#version 300 es

precision highp float;
precision mediump int;

layout(location = 0) in vec2 corner;

uniform sampler2D positionsTex;

uniform int sqrtNumParticles;
uniform float invSqrtNumParticles; 
uniform float invNumParticles; 

uniform float intensityFactor; 
uniform float focusDistance; 
uniform float invMaxDistance; 
uniform float maxDistanceSlope;
 

uniform vec3 colorA; 
uniform vec3 colorB; 

uniform float dofAmount;

// Aspect ratio for circular particle rendering
uniform vec2 aspect; // aspect.x = sqrt(width/height), aspect.y = 1/aspect.x

uniform float particleSize; 

uniform float blinkPhase; 
uniform float blinkAmount; 
uniform float blinkSlope; 

uniform float relativeFeather;

uniform float maxFd; // Maximum blur factor

flat out int instanceId; 
flat out float intensity; 
out vec2 xy; 
flat out float smoothStepFrom; 
flat out vec3 rgb; 
flat out float depth; 

void main() {
  instanceId = gl_InstanceID;

  ivec2 iUvId = ivec2(
    instanceId % sqrtNumParticles,
    instanceId / sqrtNumParticles
  );

  //oclor
  vec2 uvId = (vec2(iUvId) + 0.5) * invSqrtNumParticles; 

  rgb = mix(colorA, colorB, uvId.x);

  // particles coordinates are in viewport-normalized space
  vec3 particlePos = texture(positionsTex, uvId).xyz;

  float floatId = float(instanceId) * invNumParticles;
  float blinkD = max(floatId - blinkPhase, blinkPhase - floatId);
  float blink = 1. + blinkAmount * max(0., 1. - blinkD * blinkSlope);

  float distance = particlePos.z;
  float fd = abs(distance - focusDistance) * dofAmount + 1.;

  intensity = (intensityFactor * blink) * clamp(1.0 - distance * invMaxDistance, 0., 1.) / (fd * fd);

  float r = min(maxFd, fd) * particleSize / distance;

  // Apply aspect correction to corner offset for circular particles
  vec2 aspectCorrectedCorner = corner * aspect.yx;

  // Simple viewport rendering with 1.1 padding
  gl_Position = vec4((particlePos.xy + r * aspectCorrectedCorner) * 1.1, 0.0, 1.0);

  depth = distance; // Use Z distance directly for depth
  smoothStepFrom = 1. - relativeFeather / r;
  xy = corner; 
}