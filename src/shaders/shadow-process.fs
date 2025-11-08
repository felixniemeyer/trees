#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_treesTexture;
uniform float u_shadowSize;
uniform float u_shadowAlpha;

uniform vec2 u_randomSeed;
uniform vec2 u_aspect;

float random(vec2 co) {
    return fract(sin(dot(co, u_randomSeed)) * 43758.5453);
}

void main() {
    // Generate random angle and lookup length
    float angle = random(v_uv) * 6.28318530718; // 2*PI
    float lookupLength = random(v_uv + vec2(1.0, 0.0)) * u_shadowSize;

    // Create random offset with aspect correction (swizzled!)
    vec2 randomOffset = vec2(cos(angle), sin(angle)) * lookupLength;
    vec2 aspectCorrectedOffset = randomOffset * u_aspect.yx;

    // Lookup depths
    float currentDepth = texture(u_treesTexture, v_uv).a;
    float offsetDepth = texture(u_treesTexture, v_uv + aspectCorrectedOffset).a;

    // Calculate soft shadow
    float depthDelta = currentDepth - offsetDepth;

    if (depthDelta > 0.0) {
        float gradientLength = depthDelta;
        float normalizedLookupDist = lookupLength / u_shadowSize;

        // Shade is strongest at edge of gradient
        // Maps from 1.0 at center to 0.0 at edge
        float shade = 1.0 - min(1.0, gradientLength - normalizedLookupDist);

        // Output shade in red channel with alpha blending weight
        fragColor = vec4(shade, 0.0, 0.0, u_shadowAlpha);
    } else {
        // No shadow - output zero with blend weight
        fragColor = vec4(0.0, 0.0, 0.0, u_shadowAlpha);
    }
}
