#!/usr/bin/env bash
# Prefer Homebrew Node 22/20 — avoid broken default node@25 (simdjson dylib mismatch on some Macs).
for candidate in \
  "/opt/homebrew/opt/node@22/bin" \
  "/opt/homebrew/opt/node@20/bin" \
  "/usr/local/opt/node@22/bin" \
  "/usr/local/opt/node@20/bin"; do
  if [[ -x "${candidate}/node" ]] && "${candidate}/node" -e "process.exit(0)" 2>/dev/null; then
    export PATH="${candidate}:$PATH"
    break
  fi
done
if ! node -e "process.exit(0)" 2>/dev/null; then
  echo "Rubynod: Node failed to run. Fix with: brew install node@22 && export PATH=\"/opt/homebrew/opt/node@22/bin:\$PATH\""
  exit 1
fi
