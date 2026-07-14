import * as THREE from "three";

/**
 * Rubenfro-style gsplat shards — tangent-oriented ellipses, radial depth fan.
 * World spin is applied on cloudPivot (not in this shader).
 */
export function makeSplatMaterial(tintStrength = 0, tier = 2) {
  const gsplat = tier >= 2;
  return new THREE.ShaderMaterial({
    uniforms: {
      uSize: { value: 0.012 },
      uDispersion: { value: 0.06 },
      uTime: { value: 0 },
      uGlow: { value: 0.85 },
      uHue: { value: 0 },
      uOpacity: { value: 0.92 },
      uJitter: { value: 0.02 },
      uTilt: { value: 0 },
      uTint: { value: new THREE.Vector3(1, 1, 1) },
      uTintMix: { value: tintStrength },
      uSplatStretch: { value: 2.2 },
      uSplatSharp: { value: 10 },
      uSplatMix: { value: 0.72 },
      uSplatGlow: { value: 0.65 },
      uSplatBeatSize: { value: 0.4 },
      uSplatRot: { value: 0 },
      uSplatBloom: { value: 0.35 },
      uSplatRipple: { value: 0.25 },
      uShardLen: { value: 1.4 },
      uRadialStretch: { value: 0.9 },
      uDepthStretch: { value: 0.55 },
      uBeat: { value: 0 },
      uMusical: { value: 1 },
      uLayerPulse: { value: 0 },
      uHarmonic: { value: 0 },
      uBass: { value: 0 },
      uMid: { value: 0 },
      uHigh: { value: 0 },
    },
    vertexShader: `
      attribute float aSeed;
      uniform float uSize;
      uniform float uDispersion;
      uniform float uTime;
      uniform float uJitter;
      uniform float uTilt;
      uniform float uBeat;
      uniform float uMusical;
      uniform float uLayerPulse;
      uniform float uSplatBeatSize;
      uniform float uSplatRipple;
      uniform float uShardLen;
      uniform float uDepthStretch;
      uniform float uBass;
      uniform float uMid;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vRadius;
      varying float vTangent;
      varying float vShardScale;
      varying float vRipple;

      void main() {
        vColor = color;
        vec3 p = position;
        float beat = uBeat * uMusical;
        float audio = uBass * 0.6 + uMid * 0.35;
        float radius = length(p.xz);
        vRadius = radius;
        vTangent = atan(p.x, p.z) + 1.57079633;

        float pulse = 1.0 + beat * 0.3 + audio * 0.18
          + sin(uTime * 7.0 + aSeed * 40.0) * uLayerPulse * 0.07;
        float ripple = sin(uTime * 11.0 + aSeed * 22.0 + beat * 3.5) * uSplatRipple;
        vRipple = ripple;

        float wobble = sin(uTime * 2.2 + aSeed * 6.28) * uDispersion * pulse;
        p.z += wobble + beat * 0.05 + audio * 0.035 + ripple * 0.025;
        p.x += cos(uTime * 1.5 + aSeed * 12.0) * uDispersion * 0.28 * pulse;
        p.y += sin(uTime * 1.9 + aSeed * 9.0) * uDispersion * 0.28 * pulse;
        p += (vec3(fract(aSeed * 17.3), fract(aSeed * 9.7), fract(aSeed * 23.1)) - 0.5) * uJitter;
        p.y += p.z * uTilt;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float depthScale = 320.0 / max(0.12, -mv.z);
        float shardBoost = 1.0 + radius * uShardLen * 0.35 + uDepthStretch * 0.4;
        float sizePump = 1.0 + beat * uSplatBeatSize + audio * uSplatBeatSize * 0.45;
        gl_PointSize = uSize * depthScale * sizePump * shardBoost;
        vShardScale = shardBoost;
        vAlpha = 1.0;
      }
    `,
    fragmentShader: `
      uniform float uGlow;
      uniform float uHue;
      uniform float uOpacity;
      uniform vec3 uTint;
      uniform float uTintMix;
      uniform float uSplatStretch;
      uniform float uSplatSharp;
      uniform float uSplatMix;
      uniform float uSplatGlow;
      uniform float uSplatRot;
      uniform float uSplatBloom;
      uniform float uShardLen;
      uniform float uRadialStretch;
      uniform float uBeat;
      uniform float uHarmonic;
      uniform float uHigh;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vRadius;
      varying float vTangent;
      varying float vShardScale;
      varying float vRipple;

      vec3 hueShift(vec3 c, float h) {
        float angle = h * 6.28318;
        float cosA = cos(angle);
        float sinA = sin(angle);
        mat3 m = mat3(
          0.299 + 0.701 * cosA + 0.168 * sinA,
          0.587 - 0.587 * cosA + 0.330 * sinA,
          0.114 - 0.114 * cosA - 0.497 * sinA,
          0.299 - 0.299 * cosA - 0.328 * sinA,
          0.587 + 0.413 * cosA + 0.035 * sinA,
          0.114 - 0.114 * cosA + 0.292 * sinA,
          0.299 - 0.300 * cosA + 1.250 * sinA,
          0.587 - 0.588 * cosA - 1.050 * sinA,
          0.114 + 0.886 * cosA - 0.203 * sinA
        );
        return clamp(m * c, 0.0, 1.0);
      }

      void main() {
        float streak = uShardLen * (1.0 + vRadius * uRadialStretch) * vShardScale;
        streak *= mix(1.0, 1.45, uBeat);
        float angle = vTangent + uSplatRot + uBeat * 0.25 + uHarmonic * 0.35;
        float cr = cos(angle);
        float sr = sin(angle);

        vec2 uv = gl_PointCoord - 0.5;
        uv = vec2(cr * uv.x - sr * uv.y, sr * uv.x + cr * uv.y);
        uv.x *= streak * uSplatStretch;
        uv.y *= mix(1.0, 0.12, min(1.0, uShardLen * 0.65));
        uv += vec2(vRipple * 0.06, vRipple * 0.04);

        float d = length(uv);
        if (d > 1.05) discard;

        float sharp = exp(-d * d * uSplatSharp);
        float soft = exp(-d * mix(2.5, 9.0, uSplatBloom));
        float splat = mix(sharp, soft, uSplatMix);
        float alpha = splat * vAlpha * uOpacity;
        vec3 base = mix(vColor, uTint * vColor, uTintMix);
        float hue = uHue + uHarmonic * 0.12 + uHigh * 0.06;
        vec3 col = hueShift(base, hue);
        float glow = uGlow * (1.0 - d * 1.4) + uBeat * uSplatGlow + uHigh * 0.3;
        col *= 1.0 + max(0.0, glow);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: gsplat ? THREE.NormalBlending : THREE.AdditiveBlending,
    vertexColors: true,
  });
}