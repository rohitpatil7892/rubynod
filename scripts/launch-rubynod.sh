#!/usr/bin/env bash
# Launch Rubynod: AI service + VS Code with Rubynod extension (Ollama-first).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="/opt/homebrew/opt/node@20/bin:/opt/homebrew/bin:$PATH"

# Build if needed
if [[ ! -d packages/rubynod-ai/dist ]]; then
  echo "Building Rubynod packages..."
  npm run build
fi

# Start AI service if not running
if ! curl -sf http://127.0.0.1:3847/health >/dev/null 2>&1; then
  echo "Starting Rubynod AI service on :3847..."
  node packages/rubynod-ai/dist/server.js &
  AI_PID=$!
  sleep 1
  trap 'kill "$AI_PID" 2>/dev/null || true' EXIT
fi

# Ollama hint
if ! curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  echo "Tip: start Ollama — ollama serve && ollama pull llama3.2"
fi

CODE_BIN="${CODE_BIN:-code}"
if ! command -v "$CODE_BIN" >/dev/null 2>&1; then
  CODE_BIN="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
fi

echo "Opening Rubynod in VS Code..."
exec "$CODE_BIN" --extensionDevelopmentPath="$ROOT/extensions/rubynod-ai-ui" "$@"
