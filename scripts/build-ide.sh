#!/usr/bin/env bash
# Build Rubynod packages + optional Code-OSS desktop fork.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== 1/2 Rubynod AI + extension ==="
npm install
npm run build
mkdir -p dist
npm run package:ext 2>/dev/null || npx @vscode/vsce package extensions/rubynod-ai-ui --out dist/

echo ""
echo "=== 2/2 Code-OSS desktop (optional, slow) ==="
echo "Requires: Node 22 (brew install node@22), full Xcode from App Store for native modules."
echo "Skip this step and use: ./scripts/launch-rubynod.sh"
echo ""

if [[ "${BUILD_VSCODE_FORK:-0}" != "1" ]]; then
  echo "Set BUILD_VSCODE_FORK=1 to build vscode-fork (30–90 min)."
  exit 0
fi

export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
node -v

if [[ ! -d vscode-fork ]]; then
  VSCODE_TAG="${VSCODE_TAG:-1.102.3}" bash scripts/setup-code-oss-fork.sh
fi

# Extension symlink breaks vscode compile — load via launch script instead
rm -f vscode-fork/extensions/rubynod-ai-ui

cd vscode-fork
if [[ ! -d node_modules ]]; then
  npm install --ignore-scripts
  node build/npm/postinstall.js
fi
npm run compile
echo "Desktop build done. Run: cd vscode-fork && ./scripts/code.sh --extensionDevelopmentPath=../extensions/rubynod-ai-ui"
