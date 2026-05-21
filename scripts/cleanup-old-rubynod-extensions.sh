#!/usr/bin/env bash
# Remove leftover Rubynod extension folders so only one copy is on disk.
# Tip: quit VS Code first (Cmd+Q) before upgrading to avoid broken installs.
set -euo pipefail
KEEP="${1:-0.1.17}"
for dir in "$HOME/.vscode/extensions"/rohitpatil.rubynod-ai-ui-* "$HOME/.vscode/extensions"/RohitPatil.rubynod-ai-ui-*; do
  [ -d "$dir" ] || continue
  case "$dir" in
    *"-${KEEP}") continue ;;
  esac
  echo "Removing $dir"
  rm -rf "$dir"
done
echo "Done. Quit VS Code fully, then install the VSIX, then reopen."
