import * as THREE from "three";
import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type {
  ActiveLayer,
  EffectKind,
  EffectPropsByKind,
} from "@/effects/types";
import { SAMPLING_FRAG, SAMPLING_VERT } from "@/effects/shaders/sampling";
import { UNFOCUSED_FRAG, UNFOCUSED_VERT } from "@/effects/shaders/unfocused";
import { BURN_FRAG, BURN_VERT } from "@/effects/shaders/burn";
import { GLASS_FRAG, GLASS_VERT } from "@/effects/shaders/glass";
import { MAGNIFIER_FRAG, MAGNIFIER_VERT } from "@/effects/shaders/magnifier";
import { CRACK_FRAG, CRACK_VERT } from "@/effects/shaders/crack";
import { mergeAi } from "@/ai/mapper";
import { useApp } from "@/state/store";

/**
 * Renders a single full-bleed quad with the shader chosen by `kind`
 * and uniforms built from the layer's props merged with AI signals.
 *
 * Clipping to a side of the slider is done inside each shader via the
 * `uClipSign` / `uClipX` uniforms (see common.glsl SLIDER_CLIP).
 */

interface Props {
  layer: ActiveLayer;
  texture: THREE.Texture;
  order: number;
  /** 0=both, -1=keep left of slider, +1=keep right of slider. */
  clipSign: -1 | 0 | 1;
  /** Slider X in 0..1 UV space. */
  clipX: number;
}

const SHADERS: Record<
  EffectKind,
  { vert: string; frag: string; uniforms(): Record<string, THREE.IUniform> }
> = {
  sampling: {
    vert: SAMPLING_VERT,
    frag: SAMPLING_FRAG,
    uniforms: () => ({
      uMap: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uPixel: { value: 1 },
      uBrightness: { value: 0 },
      uContrast: { value: 0 },
      uSaturation: { value: 0 },
      uStep: { value: 16 },
      uAnimation: { value: 0 },
      uClipSign: { value: 0 },
      uClipX: { value: 0.5 },
    }),
  },
  unfocused: {
    vert: UNFOCUSED_VERT,
    frag: UNFOCUSED_FRAG,
    uniforms: () => ({
      uMap: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uBlur: { value: 0 },
      uAngle: { value: 0 },
      uFalloff: { value: 0.5 },
      uType: { value: 1 },
      uOrigin: { value: new THREE.Vector2(0.5, 0.5) },
      uDistortion: { value: 0 },
      uDispersion: { value: 0 },
      uNoise: { value: 0 },
      uBlend: { value: 0 },
      uClipSign: { value: 0 },
      uClipX: { value: 0.5 },
    }),
  },
  burn: {
    vert: BURN_VERT,
    frag: BURN_FRAG,
    uniforms: () => ({
      uMap: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uBurn: { value: 0 },
      uDensity: { value: 0.5 },
      uDistortion: { value: 0.2 },
      uHardness: { value: 0.4 },
      uDispersion: { value: 0.2 },
      uEdgeColor: { value: new THREE.Color(1.0, 0.36, 0.18) },
      uMaskColor: { value: new THREE.Color(0, 0, 0) },
      uTransparent: { value: true },
      uInvert: { value: false },
      uClipSign: { value: 0 },
      uClipX: { value: 0.5 },
    }),
  },
  glass: {
    vert: GLASS_VERT,
    frag: GLASS_FRAG,
    uniforms: () => ({
      uMap: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uIor: { value: 1 },
      uRoughness: { value: 0 },
      uBump: { value: 0 },
      uDispersion: { value: 0 },
      uDepth: { value: 0 },
      uPattern: { value: 0 },
      uClipSign: { value: 0 },
      uClipX: { value: 0.5 },
    }),
  },
  magnifier: {
    vert: MAGNIFIER_VERT,
    frag: MAGNIFIER_FRAG,
    uniforms: () => ({
      uMap: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uOrigin: { value: new THREE.Vector2(0.5, 0.5) },
      uRadius: { value: 0 },
      uStrength: { value: 0.5 },
      uSpace: { value: 0.3 },
      uDisturbance: { value: 0 },
      uFeather: { value: 0.2 },
      uThreshold: { value: 0.5 },
      uCompensation: { value: 0.5 },
      uDispersion: { value: 0 },
      uScale: { value: 0 },
      uClipSign: { value: 0 },
      uClipX: { value: 0.5 },
    }),
  },
  crack: {
    vert: CRACK_VERT,
    frag: CRACK_FRAG,
    uniforms: () => ({
      uMap: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uSegment: { value: 1 },
      uStrength: { value: 0 },
      uDispersion: { value: 0 },
      uType: { value: 1 },
      uReady: { value: 1 },
      uFadeIn: { value: false },
      uClipSign: { value: 0 },
      uClipX: { value: 0.5 },
    }),
  },
};

const ANIM_MAP: Record<"seamless" | "stepped", number> = {
  seamless: 0,
  stepped: 1,
};
const UNFOCUSED_TYPE: Record<
  EffectPropsByKind["unfocused"]["type"],
  number
> = { linear: 0, quadratic: 1, cubic: 2, square: 3 };
const UNFOCUSED_BLEND: Record<
  EffectPropsByKind["unfocused"]["blend"],
  number
> = { none: 0, darker: 1, lighter: 2, both: 3 };
const GLASS_PATTERN: Record<
  EffectPropsByKind["glass"]["pattern"],
  number
> = { lens: 0, ripple: 1, splat: 2 };
const CRACK_TYPE: Record<EffectPropsByKind["crack"]["type"], number> = {
  classic: 0,
  modern: 1,
};

export function EffectLayer({ layer, texture, order, clipSign, clipX }: Props) {
  const spec = SHADERS[layer.kind];
  const matRef = useRef<THREE.ShaderMaterial>(null!);
  const uniforms = useMemo(() => spec.uniforms(), [spec]);
  const { size } = useThree();
  const ai = useApp((s) => s.ai);

  useFrame(() => {
    if (!matRef.current) return;
    const merged = mergeAi(layer.kind, layer.props, ai);
    const u = uniforms;
    u.uMap.value = texture;
    (u.uResolution.value as THREE.Vector2).set(size.width, size.height);
    u.uClipSign.value = clipSign;
    u.uClipX.value = clipX;

    switch (layer.kind) {
      case "sampling": {
        const p = merged as EffectPropsByKind["sampling"];
        u.uPixel.value = p.pixel;
        u.uBrightness.value = p.brightness;
        u.uContrast.value = p.contrast;
        u.uSaturation.value = p.saturation;
        u.uStep.value = p.step;
        u.uAnimation.value = ANIM_MAP[p.animation];
        break;
      }
      case "unfocused": {
        const p = merged as EffectPropsByKind["unfocused"];
        u.uBlur.value = p.blur;
        u.uAngle.value = p.angle;
        u.uFalloff.value = p.falloff;
        u.uType.value = UNFOCUSED_TYPE[p.type];
        (u.uOrigin.value as THREE.Vector2).set(p.originX, p.originY);
        u.uDistortion.value = p.distortion;
        u.uDispersion.value = p.dispersion;
        u.uNoise.value = p.noise;
        u.uBlend.value = UNFOCUSED_BLEND[p.blend];
        break;
      }
      case "burn": {
        const p = merged as EffectPropsByKind["burn"];
        u.uBurn.value = p.burn;
        u.uDensity.value = p.density;
        u.uDistortion.value = p.distortion;
        u.uHardness.value = p.hardness;
        u.uDispersion.value = p.dispersion;
        (u.uEdgeColor.value as THREE.Color).setRGB(...p.edgeColor);
        (u.uMaskColor.value as THREE.Color).setRGB(...p.maskColor);
        u.uTransparent.value = p.transparent;
        u.uInvert.value = p.invert;
        break;
      }
      case "glass": {
        const p = merged as EffectPropsByKind["glass"];
        u.uIor.value = p.ior;
        u.uRoughness.value = p.roughness;
        u.uBump.value = p.bump;
        u.uDispersion.value = p.dispersion;
        u.uDepth.value = p.depth;
        u.uPattern.value = GLASS_PATTERN[p.pattern];
        break;
      }
      case "magnifier": {
        const p = merged as EffectPropsByKind["magnifier"];
        (u.uOrigin.value as THREE.Vector2).set(p.originX, p.originY);
        u.uRadius.value = p.radius;
        u.uStrength.value = p.strength;
        u.uSpace.value = p.space;
        u.uDisturbance.value = p.disturbance;
        u.uFeather.value = p.feather;
        u.uThreshold.value = p.threshold;
        u.uCompensation.value = p.compensation;
        u.uDispersion.value = p.dispersion;
        u.uScale.value = p.scale;
        break;
      }
      case "crack": {
        const p = merged as EffectPropsByKind["crack"];
        u.uSegment.value = p.segment;
        u.uStrength.value = p.strength;
        u.uDispersion.value = p.dispersion;
        u.uType.value = CRACK_TYPE[p.type];
        u.uReady.value = ai.tilesReady;
        u.uFadeIn.value = p.fadeIn;
        break;
      }
    }
  });

  return (
    <mesh position={[0, 0, order * 0.001]}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={spec.vert}
        fragmentShader={spec.frag}
        uniforms={uniforms}
        transparent
      />
    </mesh>
  );
}
