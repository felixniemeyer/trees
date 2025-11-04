#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_treesTexture;
uniform sampler2D u_shadowMap;

uniform float u_shadowAmount; 

void main() {
    vec4 trees = texture(u_treesTexture, v_uv);
    float shade = texture(u_shadowMap, v_uv).r;

    // Composite: RGB * (1 - shade)
    vec3 finalColor = trees.rgb * max(0., (1.0 - shade * u_shadowAmount)); 

    fragColor = vec4(finalColor, 1.0);
}
