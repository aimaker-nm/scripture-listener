#!/bin/bash
# Builds "Scripture Listener.app" (a double-click launcher) in ~/Applications.
# Usage: npm run make-app
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT_DIR="$(pwd)"
NODE_PATH="$(command -v node)"
APP="$HOME/Applications/Scripture Listener.app"

mkdir -p "$HOME/Applications"
sed -e "s#__PROJECT_DIR__#$PROJECT_DIR#" -e "s#__NODE_PATH__#$NODE_PATH#" mac/app.applescript > /tmp/scripture-listener.applescript
rm -rf "$APP"
osacompile -s -o "$APP" /tmp/scripture-listener.applescript
rm /tmp/scripture-listener.applescript

# App icon (Dock / Finder) from public/icons/icon.svg rendered sizes in mac/icon.iconset.
if [ -d mac/icon.iconset ]; then
  iconutil -c icns -o "$APP/Contents/Resources/applet.icns" mac/icon.iconset
  codesign --force --deep -s - "$APP" 2>/dev/null   # re-sign after changing the bundle
  touch "$APP"
fi
echo "Built $APP"
