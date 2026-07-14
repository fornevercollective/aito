#!/usr/bin/env bash
# Build aito-mac: Rust walker + WASM modulator + macOS app (xcodegen).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

mkdir -p bin wasm

echo "→ building aito-walk (tree-sitter walker)…"
cargo build --release --manifest-path walker/Cargo.toml
install -m 755 walker/target/release/aito-walk bin/aito-walk

echo "→ building booth_modulator.wasm…"
if rustup target list --installed | grep -q wasm32-unknown-unknown; then
  :
else
  rustup target add wasm32-unknown-unknown
fi
cargo build --release --manifest-path wasm/Cargo.toml --target wasm32-unknown-unknown
install -m 644 wasm/target/wasm32-unknown-unknown/release/booth_modulator.wasm wasm/booth_modulator.wasm

build_swiftc() {
  echo "→ building bin/AitoMac (swiftc)…"
  swiftc -O \
    AitoMac/AitoMacApp.swift \
    AitoMac/BoothViewController.swift \
    AitoMac/BoothServer.swift \
    AitoMac/BoothStaticServer.swift \
    AitoMac/Bridges/RepelBridge.swift \
    AitoMac/Bridges/LuaBridge.swift \
    AitoMac/Bridges/WalkerBridge.swift \
    AitoMac/Bridges/JaxBridge.swift \
    -o bin/AitoMac \
    -framework AppKit -framework WebKit
}

if command -v xcodegen >/dev/null 2>&1 && xcodebuild -version >/dev/null 2>&1; then
  echo "→ generating Xcode project…"
  xcodegen generate --spec project.yml --project .
  echo "→ building AitoMac.app (Release)…"
  xcodebuild -project AitoMac.xcodeproj -scheme AitoMac -configuration Release \
    -derivedDataPath build CODE_SIGNING_ALLOWED=NO build
  APP="build/Build/Products/Release/AitoMac.app"
  if [[ -d "$APP" ]]; then
    echo "✓ $APP"
  fi
elif swiftc -version >/dev/null 2>&1; then
  build_swiftc
  echo "✓ bin/AitoMac"
else
  echo "⚠ install Xcode or Swift toolchain for the native app."
fi

chmod +x scripts/serve.mjs scripts/serve.py scripts/make-app-bundle.sh 2>/dev/null || true
if [[ -x bin/AitoMac ]]; then
  ./scripts/make-app-bundle.sh 2>/dev/null || true
fi
echo "Done. Double-click aito-mac.app (no Terminal)"