#!/usr/bin/env bash
# Clone Code-OSS and apply Rubynod branding. Run from repo root.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FORK_DIR="${ROOT}/vscode-fork"
VSCODE_TAG="${VSCODE_TAG:-1.99.0}"

if [[ -d "${FORK_DIR}/.git" ]]; then
  echo "Code-OSS fork already exists at ${FORK_DIR}"
else
  echo "Cloning vscode (${VSCODE_TAG}) — this may take several minutes..."
  git clone --depth 1 --branch "${VSCODE_TAG}" https://github.com/microsoft/vscode.git "${FORK_DIR}"
fi

cp "${ROOT}/product.json" "${FORK_DIR}/product.json"
echo "Applied Rubynod product.json (includes updateUrl for GitHub auto-updates)"
echo "  Update URLs: https://github.com/rohitpatil7892/rubynod (edit product.json if you fork elsewhere)"

# Symlink built-in AI extension into vscode extensions folder
EXT_SRC="${ROOT}/extensions/rubynod-ai-ui"
EXT_DST="${FORK_DIR}/extensions/rubynod-ai-ui"
if [[ ! -e "${EXT_DST}" ]]; then
  ln -sf "${EXT_SRC}" "${EXT_DST}"
  echo "Linked rubynod-ai-ui extension"
fi

cat <<'EOF'

Supported platforms: macOS, Linux (this script), Windows (use npm run setup:fork:win)

Next steps to build Rubynod desktop app:
  cd vscode-fork
  npm install
  npm run compile
  ./scripts/code.sh   # launches dev build

Rubynod AI service (separate terminal):
  npm run dev:ai -w @rubynod/ai

For daily development without full fork build, use the VS Code extension:
  code --extensionDevelopmentPath=extensions/rubynod-ai-ui
EOF
