import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Canvas, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import { Suspense, useEffect, useMemo } from "react";
import { EffectLayer } from "./EffectLayer";
import { useApp } from "@/state/store";
import { ADJUST_FRAG, ADJUST_VERT } from "@/effects/shaders/adjust";
/**
 * Full-bleed orthographic canvas. The "before" and "after" textures
 * each render as a full-bleed quad, the after one clipped to the right
 * of the slider position. Effect layers stack on top, each scoped to
 * the side declared in the layer's `side` field.
 */
function FitQuad({ children }) {
    const { size, camera } = useThree();
    useEffect(() => {
        if (!camera.isOrthographicCamera)
            return;
        const cam = camera;
        cam.left = -size.width / 2;
        cam.right = size.width / 2;
        cam.top = size.height / 2;
        cam.bottom = -size.height / 2;
        cam.near = -1000;
        cam.far = 1000;
        cam.updateProjectionMatrix();
    }, [camera, size]);
    return (_jsx("group", { scale: [size.width, size.height, 1], children: children }));
}
function Layers() {
    const before = useApp((s) => s.before);
    const after = useApp((s) => s.after);
    const slider = useApp((s) => s.slider);
    const layers = useApp((s) => s.layers);
    const adj = useApp((s) => s.adjustments);
    const scope = useApp((s) => s.adjustmentScope);
    const segments = useApp((s) => s.segments);
    const activeId = useApp((s) => s.activeSegmentId);
    const { viewport, size } = useThree();
    const beforeTex = useTexture(before);
    const afterTex = useTexture(after);
    // Active SAM/brush mask as texture for masked corrections
    const activeMask = segments.find((m) => m.id === activeId);
    const activeMaskUrl = activeMask?.dataUrl ?? null;
    const maskTex = useTexture(activeMaskUrl || "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"); // 1x1 transparent fallback
    useMemo(() => {
        [beforeTex, afterTex, maskTex].forEach((t) => {
            if (t) {
                t.colorSpace = THREE.SRGBColorSpace;
                t.needsUpdate = true;
            }
        });
    }, [beforeTex, afterTex, maskTex]);
    // World-space x of the slider line, given the inner group is scaled
    // to viewport size.
    const wx = (slider - 0.5) * viewport.width;
    // Base passthrough layers: render the source images directly.
    // "before" shows on the left, "after" on the right of `wx`.
    // We insert a corrections (adjust) pass on the after side right after the base after texture.
    return (_jsxs(_Fragment, { children: [_jsxs("mesh", { position: [0, 0, -0.01], children: [_jsx("planeGeometry", { args: [1, 1] }), _jsx("meshBasicMaterial", { map: beforeTex, toneMapped: false, clippingPlanes: [
                            new THREE.Plane(new THREE.Vector3(-1, 0, 0), wx),
                        ] })] }), _jsxs("mesh", { position: [0, 0, -0.005], children: [_jsx("planeGeometry", { args: [1, 1] }), _jsx("meshBasicMaterial", { map: afterTex, toneMapped: false, clippingPlanes: [
                            new THREE.Plane(new THREE.Vector3(1, 0, 0), -wx),
                        ] })] }), _jsxs("mesh", { position: [0, 0, -0.003], children: [_jsx("planeGeometry", { args: [1, 1] }), _jsx("shaderMaterial", { vertexShader: ADJUST_VERT, fragmentShader: ADJUST_FRAG, uniforms: {
                            uMap: { value: afterTex },
                            uResolution: { value: new THREE.Vector2(size.width, size.height) },
                            uExposure: { value: adj.exposure },
                            uContrast: { value: adj.contrast },
                            uSaturation: { value: adj.saturation },
                            uTemperature: { value: adj.temperature },
                            uTint: { value: adj.tint },
                            uClarity: { value: adj.clarity },
                            uLutIntensity: { value: adj.lutIntensity ?? 0 },
                            uMask: { value: maskTex },
                            uUseMask: { value: scope.useActiveMask && activeMaskUrl ? 1 : 0 },
                            uInvertMask: { value: scope.invert ? 1 : 0 },
                            uClipSign: { value: 1 }, // only right of slider
                            uClipX: { value: slider },
                        }, transparent: false })] }), layers
                .filter((l) => l.enabled)
                .map((l, i) => {
                const tex = l.side === "before" ? beforeTex : afterTex;
                const clipSign = l.side === "both" ? 0 : l.side === "before" ? -1 : 1;
                return (_jsx(EffectLayer, { layer: l, texture: tex, order: i + 1, clipSign: clipSign, clipX: slider }, l.id));
            })] }));
}
export function EffectStage() {
    return (_jsx(Canvas, { orthographic: true, gl: { antialias: true }, onCreated: ({ gl }) => {
            gl.localClippingEnabled = true;
        }, camera: { position: [0, 0, 100], near: -1000, far: 1000 }, dpr: [1, 2], children: _jsx(Suspense, { fallback: null, children: _jsx(FitQuad, { children: _jsx(Layers, {}) }) }) }));
}
