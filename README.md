# Rubynod

VS Code-class code editor with Cursor-like AI: agent chat, codebase indexing, MCP, terminal tools, Composer, and inline edit.

**Platforms:** macOS · Windows · Linux ([details](docs/platforms.md))

**Cursor / VS Code parity:** [gap analysis](docs/gap-analysis.md) · [performance tuning](docs/performance.md)

| | macOS | Windows | Linux |
|---|--------|---------|--------|
| VS Code extension | Yes | Yes | Yes |
| AI service (Node) | Yes | Yes | Yes |
| Desktop app (Code-OSS fork) | Yes | Yes | Yes |
| Shortcuts | ⌘K / ⌘L | Ctrl+K / Ctrl+L | Ctrl+K / Ctrl+L |

## Architecture

```
rubynod/
  product.json              # Code-OSS fork branding
  packages/
    rubynod-ai/               # Agent loop, tools, model router, HTTP/IPC API
    rubynod-index/            # Semantic + text indexing for @codebase
    rubynod-mcp/              # MCP client hub
    rubynod-cli/              # CLI for headless agents
  extensions/
    rubynod-ai-ui/            # Chat, Composer, @ mentions, inline edit (VS Code extension)
```

## Quick start

### 1. Install dependencies

```bash
cd rubynod
npm install
npm run build
```

### 2. Start AI service

```bash
npm run dev:ai
# Listens on http://127.0.0.1:3847
```

### 3. Use with VS Code / Rubynod

**Extension dev mode** (fastest):

```bash
code --extensionDevelopmentPath=extensions/rubynod-ai-ui
```

Set `rubynod.ai.serviceUrl` to `http://127.0.0.1:3847` if needed.

### 4. Full desktop fork (optional)

**macOS / Linux:**

```bash
npm run setup:fork
cd vscode-fork && npm install && npm run compile
./scripts/code.sh
```

**Windows (PowerShell):**

```powershell
npm run setup:fork:win
cd vscode-fork; npm install; npm run compile
.\scripts\code.bat
```

## Codebase indexing (like Cursor)

Rubynod indexes your repo locally (chunks + symbols + semantic search) and **auto-injects relevant code** into agent messages.

- Status bar: `Index: N chunks`
- Command: **Rubynod: Build Codebase Index**
- Docs: [docs/indexing.md](docs/indexing.md)

## Configuration

**Settings UI:** Cmd+, → search `rubynod`, or command **Rubynod: Open Settings**.  
Full reference: [docs/settings.md](docs/settings.md) (Cursor-style groups: Models, Chat, Tab, Agent, Index, Privacy, MCP).

| File | Purpose |
|------|---------|
| `~/.rubynod/mcp.json` | MCP servers (stdio/SSE/HTTP) |
| `.rubynodignore` | Exclude paths from indexing |
| `.rubynod/rules/` | Project AI rules |
| `AGENTS.md` | Root agent instructions |
| `.rubynod/skills/` | SKILL.md skill packs |

## Local models (Ollama) — default

Rubynod defaults to **Ollama** at `http://127.0.0.1:11434`:

1. Install [Ollama](https://ollama.com) and run `ollama pull llama3.2` (or any model).
2. Start Rubynod AI: `npm run dev:ai`
3. Open the extension — it auto-detects models and shows the active model in the status bar (`Ollama: …`).
4. Command: **Rubynod: Select Ollama Model**

Settings: `rubynod.ollama.autoConnect`, `rubynod.ollama.host`, `rubynod.models.*`

## Cloud API keys (optional)

Set `rubynod.models.provider` to `openai` | `anthropic` | `openrouter` and add keys:

- `rubynod.models.apiKey` or `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`

## CLI

```bash
npm run cli -- agent "Explain this repo" --workspace .
```

## Deploy on GitHub and auto-update

Rubynod supports **VS Code–style update notifications** when you publish a new version on GitHub.

1. Create a GitHub repo and push this project.
2. Repo is configured for **[rohitpatil7892/rubynod](https://github.com/rohitpatil7892/rubynod)** (`product.json`, update manifests, extension settings).
3. Optional: change **`rubynod.update.githubRepo`** if you use a different fork.
4. Publish a release:

```bash
node scripts/sync-version.mjs 0.2.0
git add -A && git commit -m "chore: release v0.2.0"
git tag v0.2.0 && git push origin main --tags
```

The **Release** workflow builds a `.vsix`, updates `updates/api/update/*.json` on `main`, and creates a GitHub Release. The desktop fork reads `updateUrl`; the extension shows a notification when a newer tag exists.

Full guide: [docs/releases-and-updates.md](docs/releases-and-updates.md)

## License

MIT. Code-OSS fork components follow upstream licenses.
