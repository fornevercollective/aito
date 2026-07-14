#!/usr/bin/env bash
# Standalone AitoMac.app — embedded booth, no Terminal, double-click launch.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BIN="$ROOT/bin/AitoMac"
APP="$ROOT/bin/AitoMac.app"
ROOT_APP="$ROOT/aito-mac.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RES="$CONTENTS/Resources"
BUNDLE_ROOT="$RES/aito-mac"

echo "→ building bin/AitoMac…"
SWIFT_SOURCES=(
  AitoMac/AitoMacApp.swift
  AitoMac/BoothViewController.swift
  AitoMac/BoothServer.swift
  AitoMac/BoothStaticServer.swift
  AitoMac/Bridges/RepelBridge.swift
  AitoMac/Bridges/LuaBridge.swift
  AitoMac/Bridges/WalkerBridge.swift
  AitoMac/Bridges/JaxBridge.swift
)
SWIFT_FLAGS=(-O "${SWIFT_SOURCES[@]}" -framework AppKit -framework WebKit)
ARCH="$(uname -m)"
if [[ "$ARCH" == "arm64" ]]; then
  swiftc "${SWIFT_FLAGS[@]}" -target arm64-apple-macos13.0 -o bin/AitoMac
elif [[ "$ARCH" == "x86_64" ]]; then
  swiftc "${SWIFT_FLAGS[@]}" -target x86_64-apple-macos13.0 -o bin/AitoMac
else
  swiftc "${SWIFT_FLAGS[@]}" -o bin/AitoMac
fi
chmod +x bin/AitoMac

rm -rf "$APP"
mkdir -p "$MACOS" "$BUNDLE_ROOT"

cp "$BIN" "$MACOS/AitoMac"
chmod +x "$MACOS/AitoMac"

echo "→ embedding booth resources…"
rsync -a --delete \
  --exclude '.DS_Store' \
  "$ROOT/booth/" "$BUNDLE_ROOT/booth/"
mkdir -p "$BUNDLE_ROOT/wasm" "$BUNDLE_ROOT/scripts" "$BUNDLE_ROOT/bin" "$BUNDLE_ROOT/music"
[[ -f "$ROOT/wasm/booth_modulator.wasm" ]] && cp "$ROOT/wasm/booth_modulator.wasm" "$BUNDLE_ROOT/wasm/"
[[ -x "$ROOT/bin/aito-walk" ]] && cp "$ROOT/bin/aito-walk" "$BUNDLE_ROOT/bin/"
for f in serve.mjs serve.py presets.lua export_presets.lua launch-booth.sh; do
  [[ -f "$ROOT/scripts/$f" ]] && cp "$ROOT/scripts/$f" "$BUNDLE_ROOT/scripts/"
done
chmod +x "$BUNDLE_ROOT/scripts/"*.mjs "$BUNDLE_ROOT/scripts/"*.py "$BUNDLE_ROOT/scripts/"*.sh 2>/dev/null || true
[[ -d "$ROOT/music" ]] && rsync -a "$ROOT/music/" "$BUNDLE_ROOT/music/" 2>/dev/null || true
[[ -d "$ROOT/jax-sidecar" ]] && rsync -a --exclude '__pycache__' "$ROOT/jax-sidecar/" "$BUNDLE_ROOT/jax-sidecar/"
[[ -d "$ROOT/zipdepth-sidecar" ]] && rsync -a --exclude '__pycache__' "$ROOT/zipdepth-sidecar/" "$BUNDLE_ROOT/zipdepth-sidecar/"

cat > "$CONTENTS/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>en</string>
	<key>CFBundleExecutable</key>
	<string>AitoMac</string>
	<key>CFBundleIdentifier</key>
	<string>com.fornevercollective.aito-mac</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>aito-mac</string>
	<key>CFBundleDisplayName</key>
	<string>aito-mac</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>0.1.1</string>
	<key>CFBundleVersion</key>
	<string>2</string>
	<key>LSMinimumSystemVersion</key>
	<string>13.0</string>
	<key>LSUIElement</key>
	<false/>
	<key>LSBackgroundOnly</key>
	<false/>
	<key>NSHighResolutionCapable</key>
	<true/>
	<key>NSPrincipalClass</key>
	<string>NSApplication</string>
	<key>LSApplicationCategoryType</key>
	<string>public.app-category.graphics-design</string>
	<key>NSCameraUsageDescription</key>
	<string>aito-mac gsplat booth needs the camera for live point-cloud capture.</string>
	<key>NSMicrophoneUsageDescription</key>
	<string>Microphone is used for audio-reactive gsplat and track playback.</string>
	<key>NSAppTransportSecurity</key>
	<dict>
		<key>NSAllowsLocalNetworking</key>
		<true/>
		<key>NSAllowsArbitraryLoadsInWebContent</key>
		<true/>
	</dict>
</dict>
</plist>
PLIST

# Finder-friendly copy at project root (no Terminal)
rm -rf "$ROOT_APP"
ditto "$APP" "$ROOT_APP"

echo "✓ $APP"
echo "✓ $ROOT_APP  ← double-click this (no Terminal)"
echo "  Optional: drag aito-mac.app to /Applications"