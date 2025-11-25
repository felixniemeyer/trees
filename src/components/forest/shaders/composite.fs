#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

// FXAA texture coordinates from vertex shader
in vec2 v_rgbNW;
in vec2 v_rgbNE;
in vec2 v_rgbSW;
in vec2 v_rgbSE;
in vec2 v_rgbM;

uniform sampler2D u_treesTexture;
uniform sampler2D u_shadowMap;
uniform vec2 u_resolution;

uniform float u_shadowAmount;
uniform float u_lightAmount;
uniform float u_shadowOffset;

// FXAA quality parameters (conservative settings for performance)
#define FXAA_REDUCE_MIN   (1.0 / 128.0)
#define FXAA_REDUCE_MUL   (1.0 / 8.0)
#define FXAA_SPAN_MAX     8.0

// FXAA anti-aliasing function
// Adapted from geeks3d.com via webgl-meincraft (Armin Ronacher)
vec4 fxaa(sampler2D tex, vec2 fragCoord, vec2 resolution,
          vec2 v_rgbNW, vec2 v_rgbNE,
          vec2 v_rgbSW, vec2 v_rgbSE,
          vec2 v_rgbM) {
    vec4 color;
    mediump vec2 inverseVP = vec2(1.0 / resolution.x, 1.0 / resolution.y);

    // Sample 5-point neighborhood
    vec3 rgbNW = texture(tex, v_rgbNW).xyz;
    vec3 rgbNE = texture(tex, v_rgbNE).xyz;
    vec3 rgbSW = texture(tex, v_rgbSW).xyz;
    vec3 rgbSE = texture(tex, v_rgbSE).xyz;
    vec4 texColor = texture(tex, v_rgbM);
    vec3 rgbM = texColor.xyz;

    // Compute luma (perceived brightness) for edge detection
    vec3 luma = vec3(0.299, 0.587, 0.114);
    float lumaNW = dot(rgbNW, luma);
    float lumaNE = dot(rgbNE, luma);
    float lumaSW = dot(rgbSW, luma);
    float lumaSE = dot(rgbSE, luma);
    float lumaM = dot(rgbM, luma);
    float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
    float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));

    // Compute edge direction from luma differences
    mediump vec2 dir;
    dir.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE));
    dir.y = ((lumaNW + lumaSW) - (lumaNE + lumaSE));

    // Scale direction by reduction factor
    float dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) *
                          (0.25 * FXAA_REDUCE_MUL), FXAA_REDUCE_MIN);

    float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
    dir = min(vec2(FXAA_SPAN_MAX, FXAA_SPAN_MAX),
              max(vec2(-FXAA_SPAN_MAX, -FXAA_SPAN_MAX),
              dir * rcpDirMin)) * inverseVP;

    // Sample along edge direction for blur
    vec3 rgbA = 0.5 * (
        texture(tex, fragCoord * inverseVP + dir * (1.0 / 3.0 - 0.5)).xyz +
        texture(tex, fragCoord * inverseVP + dir * (2.0 / 3.0 - 0.5)).xyz);
    vec3 rgbB = rgbA * 0.5 + 0.25 * (
        texture(tex, fragCoord * inverseVP + dir * -0.5).xyz +
        texture(tex, fragCoord * inverseVP + dir * 0.5).xyz);

    // Choose blend result based on luma bounds
    float lumaB = dot(rgbB, luma);
    if ((lumaB < lumaMin) || (lumaB > lumaMax))
        color = vec4(rgbA, texColor.a);
    else
        color = vec4(rgbB, texColor.a);

    return color;
}

void main() {
    // Apply FXAA to trees texture first
    vec2 fragCoord = v_uv * u_resolution;
    vec4 trees = fxaa(u_treesTexture, fragCoord, u_resolution,
                      v_rgbNW, v_rgbNE, v_rgbSW, v_rgbSE, v_rgbM);

    // Apply shadow/light effect
    float shade = texture(u_shadowMap, v_uv).r + u_shadowOffset;

    // Split into shadow (positive) and light (negative) with separate scaling
    float shadow = max(0.0, shade) * u_shadowAmount;
    float light = max(0.0, -shade) * u_lightAmount;

    // Mix with black for shadow, mix with white for light
    vec3 darkened = mix(trees.rgb, vec3(0.0), shadow);
    vec3 finalColor = mix(darkened, vec3(1.0), light);

    fragColor = vec4(finalColor, 1.0);
}
