# Install Rubynod AI (VS Code extension only)

No git clone. No `npm run start:ai`. The extension bundles and runs the AI agent automatically.

## Requirements

- **VS Code 1.85+** (or Cursor with VS Code extensions)
- **Ollama** (recommended for local models): [ollama.com](https://ollama.com)

```bash
ollama serve
ollama pull qwen2.5-coder
```

Node.js is **not** required for normal use (`rubynod.ai.inProcess` is on by default).

## Install

### From a VSIX (release)

1. Download `rubynod-ai-ui-*.vsix` from [GitHub Releases](https://github.com/rohitpatil7892/rubynod/releases)
2. VS Code → Extensions → `...` → **Install from VSIX**
3. Reload the window

### From source (developers)

```bash
git clone https://github.com/rohitpatil7892/rubynod.git
cd rubynod
npm install
npm run package:ext
code --install-extension dist/rubynod-ai-ui-*.vsix
```

## First use

1. Open a project folder
2. Click **Rubynod AI** in the activity bar → **Chat**
3. On first message, the agent starts automatically (check **Output → Rubynod AI Service**)
4. Set **Provider** to Ollama and pick a model

## Settings (optional)

| Setting | Default | Purpose |
|---------|---------|---------|
| `rubynod.ai.lazyStart` | `true` | Start agent on first use (faster VS Code open) |
| `rubynod.ai.inProcess` | `true` | Run agent inside VS Code (no system Node) |
| `rubynod.models.provider` | `ollama` | LLM provider |
| `rubynod.models.chatModel` | `llama3.2` | Chat/agent model |

## Troubleshooting

| Issue | Fix |
|-------|-----|
| AI offline | Command Palette → **Rubynod: Start AI Service** |
| Ollama errors | Run `ollama serve`; pull a model |
| Duplicate chat view | Disable Marketplace or dev copy in Extensions |
| Slow first message | Normal — agent starts on first use when `lazyStart` is on |

## Build a release VSIX (maintainers)

```bash
npm run build
npm run bundle:server
npm run package:ext
# → dist/rubynod-ai-ui-<version>.vsix
```
