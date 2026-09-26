#!/bin/bash
# Builds the desktop app on this Mac (no installer, no GitHub) and installs it as
# ~/Applications/Scripture Listener.app, replacing the previous copy. Takes a minute or two.
# Needs: npm run build-index, npm run setup-whisper, and a self-contained whisper-server in
# build/whisper/darwin-<arch>/ (see .github/workflows/desktop.yml).
# Usage: npm run install-local
set -euo pipefail
cd "$(dirname "$0")/.."
ARCH=$(uname -m); [ "$ARCH" = x86_64 ] && ARCH=x64
[ -x "build/whisper/darwin-$ARCH/whisper-server" ] || { echo "Missing build/whisper/darwin-$ARCH/whisper-server"; exit 1; }
OUT=$(mktemp -d /tmp/scripture-listener-build.XXXXXX)   # outside iCloud-synced folders (code signing fails there)
env -u ELECTRON_RUN_AS_NODE npx electron-builder --mac --"$ARCH" --dir -c.directories.output="$OUT" >/dev/null
APP="$HOME/Applications/Scripture Listener.app"
pkill -f "$APP/Contents/MacOS/" 2>/dev/null || true; sleep 1
mkdir -p "$HOME/Applications" && rm -rf "$APP"
ditto "$OUT/mac-$ARCH/Scripture Listener.app" "$APP"
rm -rf "$OUT"
echo "Installed $APP (version $(node -p "require('./package.json').version"))"
