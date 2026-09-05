#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

echo "=========================================================="
echo "🚀 SendaGo AI (Claude Code Edition) Extension Installer"
echo "=========================================================="
echo "📁 Root directory: $DIR"
echo ""

# 1. Compile TypeScript and Bundle with esbuild
echo "📦 1. Compiling TypeScript & Bundling extension..."
cd "$DIR/vscode-extension"
npm run bundle

# 2. Package into .vsix
echo "🔨 2. Packaging VSIX bundle..."
npx @vscode/vsce package --no-dependencies --allow-missing-repository

VSIX_FILE=$(ls -t "$DIR/vscode-extension"/*.vsix | head -n 1)
echo "✅ VSIX Created: $VSIX_FILE"
echo ""

# 3. Install to Antigravity IDE
echo "🌌 3. Installing to Antigravity IDE..."
ANTIGRAVITY_BIN="/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide"

if [ -f "$ANTIGRAVITY_BIN" ]; then
  "$ANTIGRAVITY_BIN" --install-extension "$VSIX_FILE" --force
  echo "✅ Berhasil terpasang di Antigravity IDE!"
else
  echo "⚠️ Antigravity binary tidak ditemukan di $ANTIGRAVITY_BIN"
fi
echo ""

# 4. Install to VS Code
echo "💻 4. Installing to VS Code..."
if command -v code >/dev/null 2>&1; then
  code --install-extension "$VSIX_FILE" --force
  echo "✅ Berhasil terpasang di VS Code!"
else
  echo "⚠️ VS Code CLI ('code') tidak ditemukan di PATH"
fi
echo ""

echo "=========================================================="
echo "🎉 INSTALASI SELESAI!"
echo "=========================================================="
echo "Silakan Reload Window di VS Code & Antigravity IDE:"
echo "Tekan Cmd+Shift+P -> Ketik: 'Developer: Reload Window'"
echo "=========================================================="
