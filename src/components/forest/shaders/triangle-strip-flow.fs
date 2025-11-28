#version 300 es

precision highp float;

// Input from vertex shader
in vec2 v_uv;
in float v_vertexId;

// Uniforms
uniform sampler2D photoTexture;
uniform float time;  // Time for scrolling animation
uniform float u_depth;  // Depth value for this tree
uniform float u_selected;  // 1.0 if selected, 0.0 otherwise
uniform float u_boost; // Brightness boost from animation
uniform int u_debugMode;  // 0 = off, 1 = vertex ID colors, 2 = every vertex different color

// Output
out vec4 fragColor;

// HSV to RGB conversion for rainbow colors
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  // Scroll UV coordinates along Y axis using mod(2.0) for mirrored repeat
  vec2 scrollUv = vec2(v_uv.x, mod(v_uv.y + time, 2.0));

  // Sample the photo texture with mirrored repeat
  vec4 color = texture(photoTexture, scrollUv);

  vec3 finalColor = color.rgb;

  // Apply debug visualization based on mode
  if (u_debugMode == 1) {
    // Mode 1: Vertex ID colors (RGB pattern)
    int vertexMod = int(v_vertexId) % 3;
    vec3 debugColor;
    if (vertexMod == 0) {
      debugColor = vec3(1.0, 0.0, 0.0);  // Red
    } else if (vertexMod == 1) {
      debugColor = vec3(0.0, 1.0, 0.0);  // Green
    } else {
      debugColor = vec3(0.0, 0.0, 1.0);  // Blue
    }
    finalColor = mix(color.rgb, debugColor, 0.7);
  } else if (u_debugMode == 2) {
    // Mode 2: Every vertex gets unique color (rainbow)
    float hue = mod(v_vertexId * 0.1, 1.0);
    vec3 debugColor = hsv2rgb(vec3(hue, 0.8, 1.0));
    finalColor = mix(color.rgb, debugColor, 0.7);
  }

  // Mix with white if selected (50% white mix)
  finalColor = mix(finalColor, vec3(1.0), u_selected * 0.5);

  // Apply brightness boost
  finalColor = finalColor * (1.0 + u_boost);

  // Output RGB with depth in alpha channel
  fragColor = vec4(finalColor, u_depth);

  // Write depth to depth buffer for depth testing
  gl_FragDepth = u_depth;
}
