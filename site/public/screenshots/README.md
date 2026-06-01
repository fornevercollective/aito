# Screenshots for Launch

This folder holds the final screenshots used on the aito launch site.

## Recommended Images & Sizes

### 1. Editor Hero / Main View
- File: `editor-main.png` or `editor-hero.jpg`
- Size: 1600×900 or wider (16:9 or 16:10)
- Content: Clean shot of the main aito editor with before/after slider visible, AI prompt bar active, and preferably a nice image loaded.
- Style: Dark UI, high-end, minimal. Show the "LIVE VIEW" indicator if possible.

### 2. LUT Controls
- File: `lut-controls.png`
- Size: 1200×800 or similar
- Content: The LUT panel open, showing presets (VSCO, Cinema, Film) and intensity slider.
- Alternative: A before/after showing a strong film LUT applied.

### 3. Tether / Live Lab
- File: `tether-live.png`
- Size: 1400×900
- Content: Editor with the tether panel open + a live camera preview coming in (even if faked).
- Bonus: Show the "LIVE VIEW" badge clearly.

### 4. (Optional) Brush + Masking
- File: `brush-masking.png`
- Size: 1200×800
- Content: Active mask + brush tool in use.

### 5. (Optional) Grok AI in action
- File: `grok-prompt.png`
- Content: The AI command bar in use with a nice result.

## Guidelines

- Use real or very high-quality mock images (fashion, portrait, landscape, cinematic stills work great).
- Keep the overall aesthetic dark, minimal, and premium (matches aito's #0a0a0b background).
- Export at 2x for retina.
- Compress with ImageOptim or Squoosh before committing.
- Update the `alt` text in `index.astro` when you replace the placeholders.

## Current Launch Screenshots (accurate to current UI)

These images reflect the actual shipping interface (desktop 3-column + mobile PWA sheets):

- `desktop-hero.jpg` — Full desktop layout with inspector (tether + EXIF)
- `mobile-pwa.jpg` — iPhone PWA with bottom bar + open AI sheet
- `lut-desktop.jpg` — LUT controls in the real right panel
- `brush-refine.jpg` — Brush + mask in current UI

Old mocks have been replaced with higher-fidelity generations that match the real code.

All are high-quality mockups at ~1920×1080 (16:9) representing the final aesthetic. They will be replaced with real captures from the shipping app before any public announcement.

To update:
1. Drop new files here (jpg or png, 1600–1920 wide preferred)
2. Update the four `<img>` src paths + captions in `site/src/pages/index.astro`
3. Rebuild: `cd site && npm run build`
4. Deploy via the GitHub Action (it will pick them up automatically)

---

Once you drop real images here, run:

```bash
cd site
npm run build
```

and deploy. The launch site will look significantly more premium.