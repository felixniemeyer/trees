#version 300 es

precision highp float; 

uniform vec3 intensityColor; 

in vec2 xy; 
flat in float smoothStepFrom; 
flat in vec3 rgb; 
flat in float intensity; 

out vec4 FragColor; 

void main() {
  float alpha = (1. - smoothstep(smoothStepFrom, 1., length(xy))) * intensity;
  FragColor = vec4(rgb + intensityColor * intensity, alpha);
}