# PWA Icons for aito

Current setup uses the SVG icon for broad compatibility.

## Recommended: Generate proper PNG icons

Run one of these to produce the real raster icons the PWA spec prefers:

### Option 1: Using rsvg-convert (fastest, best quality)
```bash
brew install librsvg
rsvg-convert -w 192 -h 192 icon.svg -o icon-192.png
rsvg-convert -w 512 -h 512 icon.svg -o icon-512.png
```

### Option 2: Using ImageMagick
```bash
convert -background none -resize 192x192 icon.svg icon-192.png
convert -background none -resize 512x512 icon.svg icon-512.png
```

### Option 3: Using Node (sharp)
```bash
npm install -D sharp
node -e '
  const sharp = require("sharp");
  const fs = require("fs");
  const svg = fs.readFileSync("icon.svg");
  sharp(svg).resize(192).png().toFile("icon-192.png");
  sharp(svg).resize(512).png().toFile("icon-512.png");
'
```

Then update `manifest.webmanifest` to point to the `.png` versions (and keep the SVG as fallback).

For maskable icons, add 10-20% safe padding around the mark when generating the 512px version.
