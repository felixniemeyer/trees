#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

// FXAA varyings are still passed from VS but unused here
in vec2 v_rgbNW;
in vec2 v_rgbNE;
in vec2 v_rgbSW;
in vec2 v_rgbSE;
in vec2 v_rgbM;

uniform sampler2D u_treesTexture;
uniform sampler2D u_shadowMap;
// u_resolution still used by VS, but unused here

uniform float u_shadowAmount;
uniform float u_lightAmount;
uniform float u_shadowOffset;

void main() {
    // Sample trees texture directly (no FXAA)
    vec4 trees = texture(u_treesTexture, v_uv);

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
