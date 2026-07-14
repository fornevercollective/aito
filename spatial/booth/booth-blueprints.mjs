/**
 * Blueprint layout catalog — selection only, zero geometry on boot.
 *
 * Heavy layouts (Kaaba) load via dynamic import when the user enables them.
 * Desk / studio reuse already-mounted scene modules (toggle only).
 */

/** Catalog order = blueprintLayout param index */
export const BLUEPRINT_LAYOUTS = [
  {
    id: "none",
    label: "None",
    desc: "No spatial blueprint — free orbit",
    heavy: false,
    module: null,
  },
  {
    id: "desk",
    label: "Desk stack",
    desc: "Person · desk · screen (already light)",
    heavy: false,
    module: null, // SceneStack already in gsplat-booth
  },
  {
    id: "studio",
    label: "Studio LiDAR",
    desc: "Broadcast columns · trails (already light)",
    heavy: false,
    module: null, // StudioSpatial already in gsplat-booth
  },
  {
    id: "kaaba",
    label: "Kaaba · Haram",
    desc: "Mataf rings · gates · towers · tawaf cams (lazy load)",
    heavy: true,
    module: "./booth-kaaba-blueprint.mjs",
  },
];

export const BLUEPRINT_PARAMS = {
  blueprintLayout: {
    min: 0,
    max: BLUEPRINT_LAYOUTS.length - 1,
    step: 1,
    value: 0, // none — never auto-load
    label: "Blueprint layout",
    group: "blueprint",
  },
  blueprintEnable: {
    min: 0,
    max: 1,
    step: 1,
    value: 0, // off until user enables
    label: "Blueprint active",
    group: "blueprint",
  },
};

export function layoutAt(index) {
  const i = Math.max(0, Math.min(BLUEPRINT_LAYOUTS.length - 1, Math.round(index ?? 0)));
  return BLUEPRINT_LAYOUTS[i];
}

export function layoutIndexById(id) {
  const i = BLUEPRINT_LAYOUTS.findIndex((l) => l.id === id);
  return i >= 0 ? i : 0;
}

export function layoutLabel(index) {
  return layoutAt(index)?.label ?? "None";
}
