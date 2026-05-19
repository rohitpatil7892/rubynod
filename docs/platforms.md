# Rubynod platform support

Rubynod targets **macOS**, **Windows**, and **Linux** — same as VS Code / Code-OSS.

## Supported platforms

| Platform | Architectures | Editor | AI extension | AI service |
|----------|---------------|--------|--------------|------------|
| **macOS** | arm64, x64 | Code-OSS fork or VS Code | Yes | Yes |
| **Windows** | x64, arm64 | Code-OSS fork or VS Code | Yes | Yes |
| **Linux** | x64, arm64 | Code-OSS fork or VS Code | Yes | Yes |

## Requirements (all platforms)

- **Node.js 20+**
- **npm 9+**
- **Git**
- **ripgrep** (`rg`) on PATH — for fast code search in the agent  
  - macOS: `brew install ripgrep`  
  - Windows: `winget install BurntSushi.ripgrep.MSVC` or [releases](https://github.com/BurntSushi/ripgrep/releases)  
  - Linux: `sudo apt install ripgrep` / `sudo dnf install ripgrep`

## Quick start by OS

### macOS

```bash
cd rubynod
npm install && npm run build
npm run dev:ai
# New terminal:
code --extensionDevelopmentPath=extensions/rubynod-ai-ui
```

Full desktop app:

```bash
npm run setup:fork
cd vscode-fork && npm install && npm run compile && ./scripts/code.sh
```

### Windows (PowerShell)

```powershell
cd rubynod
npm install
npm run build
npm run dev:ai
# New terminal:
code --extensionDevelopmentPath=extensions\rubynod-ai-ui
```

Full desktop app:

```powershell
npm run setup:fork:win
cd vscode-fork
npm install
npm run compile
.\scripts\code.bat
```

### Linux

```bash
cd rubynod
npm install && npm run build
npm run dev:ai
code --extensionDevelopmentPath=extensions/rubynod-ai-ui
```

Full desktop app:

```bash
npm run setup:fork
cd vscode-fork && npm install && npm run compile && ./scripts/code.sh
```

## Keyboard shortcuts

| Action | macOS | Windows / Linux |
|--------|-------|-----------------|
| Chat | ⌘L | Ctrl+L |
| Inline edit | ⌘K | Ctrl+K |
| Composer | ⌘⇧I | Ctrl+Shift+I |

## Config & data locations

| Item | macOS / Linux | Windows |
|------|---------------|---------|
| User settings | `~/.rubynod/` | `%USERPROFILE%\.rubynod\` |
| MCP config | `~/.rubynod/mcp.json` | `%USERPROFILE%\.rubynod\mcp.json` |
| Codebase index | `<workspace>/.rubynod/index/` | Same |

## Building desktop installers

After `npm run setup:fork` and compiling Code-OSS:

| OS | Output (typical) |
|----|------------------|
| macOS | `.app` in `vscode-fork` build output |
| Windows | `.exe` setup via Inno Setup in VS Code build |
| Linux | `.deb` / `.rpm` / AppImage per VS Code docs |

See [Code-OSS wiki](https://github.com/microsoft/vscode/wiki/How-to-Contribute#build-and-run) for platform-specific compile flags.

## CI

GitHub Actions builds on `macos-latest`, `ubuntu-latest`, and `windows-latest` — see [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).
