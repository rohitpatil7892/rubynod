# Rubynod

**An open-source AI coding assistant for VS Code** — agent chat, local codebase indexing, file edits, terminal tools, and inline edit. Runs on your machine with **[Ollama](https://ollama.com)** by default; cloud models optional.

[![GitHub](https://img.shields.io/github/stars/rohitpatil7892/rubynod?style=social)](https://github.com/rohitpatil7892/rubynod)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/rohitpatil7892/rubynod/blob/main/README.md#license)

**Repository:** [github.com/rohitpatil7892/rubynod](https://github.com/rohitpatil7892/rubynod)

---

## What you get

| Feature | Description |
|---------|-------------|
| **Agent chat** | Agent, Plan, Ask, and Debug modes in the Rubynod AI sidebar |
| **File tools** | Read, write, search/replace, grep, glob — with diff review (accept/reject) |
| **@ context** | `@files`, folders, symbols, drag-and-drop, and context chips |
| **Codebase index** | Local semantic + full-text search; auto-injects relevant code into prompts |
| **Inline edit** | `Cmd+K` / `Ctrl+K` on a selection |
| **Tab autocomplete** | Optional ghost-text completions while you type |
| **MCP** | Connect tools via `~/.rubynod/mcp.json` |
| **CLI** | Headless agent runs for scripts and CI |
| **Desktop fork** | Optional branded Code-OSS build (advanced) |

**Platforms:** macOS · Windows · Linux — [platform guide](docs/platforms.md)

---

## Requirements

| Requirement | Notes |
|-------------|--------|
| **Node.js 20 or 22** | Use Node 22 on macOS if Homebrew `node@25` breaks native modules |
| **VS Code 1.85+** | Or the Rubynod Code-OSS fork when built |
| **Ollama** (recommended) | Local models at `http://127.0.0.1:11434` |
| **ripgrep** (`rg`) | Used by the agent for fast search — [install](https://github.com/BurntSushi/ripgrep) |

---

## Quick start (5 minutes)

### 1. Clone and build

```bash
git clone https://github.com/rohitpatil7892/rubynod.git
cd rubynod

# macOS: prefer Node 22
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"

npm install
npm run build
```

### 2. Start the AI service

```bash
npm run start:ai
# Service: http://127.0.0.1:3847
```

Keep this terminal open while you use Rubynod.

### 3. Install the extension

**Option A — development (from repo):**

```bash
npm run launch
```

Opens VS Code with the Rubynod extension loaded and starts the AI service if needed.

**Option B — packaged VSIX:**

```bash
npm run package:ext
code --install-extension dist/rubynod-ai-ui-0.1.0.vsix --force
```

Then reload the window and run **Rubynod: Start AI Service** if the chat shows offline.

### 4. Pull a model (Ollama)

```bash
ollama pull qwen2.5-coder   # recommended for tool use (read/write files)
# or: ollama pull llama3.2
```

In VS Code: **Cmd+,** → search `rubynod` → set `rubynod.models.chatModel` to your model name.

### 5. Open chat

Open the **Rubynod AI** icon in the activity bar → **Chat**. Choose **Agent** mode and ask something, e.g. *“Explain this repo”* or *“Add a logger module”*.

---

## Installed from VS Code Marketplace?

The extension is only the **UI**. It does **not** connect to Ollama by itself.

| Piece | What it does | Port |
|-------|----------------|------|
| **Rubynod AI extension** | Chat, file tools, settings | — |
| **Rubynod AI service** (from this repo) | Agent, indexing, tools | `3847` |
| **Ollama** | LLM models | `11434` |

**Flow:** Extension → `http://127.0.0.1:3847` → Ollama

**One-time setup:**

1. Clone this repo anywhere: `git clone https://github.com/rohitpatil7892/rubynod.git`
2. `cd rubynod && npm install && npm run build`
3. VS Code → Settings → `rubynod.ai.repoPath` → path to that clone  
4. **Rubynod: Start AI Service** (only asks for the folder the first time)
5. Keep **Ollama** running: `ollama serve`

You can open **any** project in VS Code; the agent service does not have to be your workspace folder.

---

## Architecture

```
rubynod/
├── packages/
│   ├── rubynod-ai/        # Agent loop, tools, model router, HTTP API (:3847)
│   ├── rubynod-index/     # Local indexing + semantic search
│   ├── rubynod-mcp/       # MCP client hub
│   └── rubynod-cli/       # Headless CLI
├── extensions/
│   └── rubynod-ai-ui/     # VS Code extension (chat UI, bridge, indexing)
├── product.json           # Code-OSS fork branding (optional desktop app)
└── scripts/               # Build, launch, release helpers
```

The extension talks to the AI service over HTTP. File and terminal operations go through a local **IDE bridge** so the agent can read and write your workspace safely.

---

## Everyday commands

| Command | What it does |
|---------|----------------|
| `npm run start:ai` | Run AI service (production) |
| `npm run dev:ai` | Run AI service with watch |
| `npm run launch` | Start AI + open VS Code with extension |
| `npm run package:ext` | Build `dist/rubynod-ai-ui-*.vsix` |
| `npm run build` | Compile all packages + extension |
| `npm run rebuild:native` | Rebuild `better-sqlite3` after Node version change |

**VS Code palette:** `Rubynod: Open Chat` · `Rubynod: Start AI Service` · `Rubynod: Build Codebase Index` · `Rubynod: Select Ollama Model` · `Rubynod: Clear Chat History`

**Keyboard:** `Cmd+L` / `Ctrl+L` — open chat · `Cmd+K` / `Ctrl+K` — inline edit on selection

---

## Configuration

Open **Settings** → search `rubynod`, or see [docs/settings.md](docs/settings.md).

| Setting | Purpose |
|---------|---------|
| `rubynod.models.chatModel` | Model for chat and agent |
| `rubynod.models.provider` | `ollama` · `openai` · `anthropic` · `openrouter` |
| `rubynod.ai.serviceUrl` | AI service URL (default `http://127.0.0.1:3847`) |
| `rubynod.chat.defaultMode` | `agent` · `plan` · `ask` · `debug` |
| `rubynod.agent.yoloMode` | Auto-approve file writes and terminal (trusted repos only) |
| `rubynod.index.autoInjectContext` | Auto-attach indexed code to agent messages |

### Project files

| Path | Purpose |
|------|---------|
| `AGENTS.md` | Root instructions for the agent |
| `.rubynod/rules/` | Project-specific AI rules |
| `.rubynod/skills/` | `SKILL.md` skill packs |
| `.rubynodignore` | Paths excluded from indexing |
| `~/.rubynod/mcp.json` | MCP server definitions |

---

## Codebase indexing

Rubynod builds a **local index** (chunks, symbols, embeddings) so the agent understands your repo without sending everything to the cloud.

- Status bar shows index health (`Index: N chunks`)
- **Rubynod: Build Codebase Index** — manual rebuild
- `@codebase` or automatic context injection (setting on by default)

Details: [docs/indexing.md](docs/indexing.md) · Tuning: [docs/performance.md](docs/performance.md)

---

## Cloud models (optional)

Set `rubynod.models.provider` to `openai`, `anthropic`, or `openrouter`, then add an API key via:

- `rubynod.models.apiKey`, or
- Environment: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`

---

## CLI

```bash
npm run cli -- agent "Summarize this project" --workspace .
```

---

## Duplicate extension error (`rubynod.chatView`)

You see this when **two copies** of Rubynod AI are active, for example:

- **VS Code Marketplace** (`RohitPatil.rubynod-ai-ui`) **and**
- **Dev install** (`npm run launch` or `--extensionDevelopmentPath=...`)

**Fix — use only one:**

1. **Extensions** (`Cmd+Shift+X`) → search `Rubynod`
2. If you see **two** entries, **Disable** or **Uninstall** one:
   - Daily use from Marketplace → disable/uninstall the dev copy; do **not** use `npm run launch`
   - Developing the repo → uninstall/disable **RohitPatil.rubynod-ai-ui** from Marketplace; use `npm run launch` or F5 on `extensions/rubynod-ai-ui`
3. **Developer: Reload Window**

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| **AI offline** in chat | Run `npm run start:ai` or **Rubynod: Start AI Service** |
| **`fetch failed`** | AI service not running on port 3847 |
| **`Cannot register multiple views` `rubynod.chatView`** | Two Rubynod extensions installed — disable one (see section above) |
| **Agent won’t edit files** | Use **Agent** mode + a tool-capable model (e.g. `qwen2.5-coder`) |
| **Empty file after write** | Update extension; ensure model sends full `contents` in `write_file` |
| **Native module errors** | Use Node 22: `npm run rebuild:native` |
| **Tab complete: model required** | Set `rubynod.models.chatModel` or `rubynod.tab.model` |

More: [docs/chat-file-context.md](docs/chat-file-context.md) · [docs/gap-analysis.md](docs/gap-analysis.md)

---

## Optional: branded desktop app

Building the full Code-OSS fork takes significant time (Xcode on macOS, etc.):

```bash
BUILD_VSCODE_FORK=1 npm run build:ide
cd vscode-fork && ./scripts/code.sh --extensionDevelopmentPath=../extensions/rubynod-ai-ui
```

For daily use, **VS Code + Rubynod extension** (`npm run launch`) is enough.

---

## Documentation

| Doc | Topic |
|-----|--------|
| [settings.md](docs/settings.md) | All `rubynod.*` settings |
| [indexing.md](docs/indexing.md) | How indexing works |
| [chat-file-context.md](docs/chat-file-context.md) | `@` files, folders, chips |
| [releases-and-updates.md](docs/releases-and-updates.md) | Publish releases + auto-update |
| [platforms.md](docs/platforms.md) | OS-specific setup |
| [gap-analysis.md](docs/gap-analysis.md) | Feature status vs VS Code |
| [features.md](docs/features.md) | Roadmap checklist |

---

## Publishing a release

```bash
node scripts/sync-version.mjs 0.2.0
git add -A && git commit -m "chore: release v0.2.0"
git tag v0.2.0 && git push origin main --tags
```

GitHub Actions builds the `.vsix` and creates a release. See [docs/releases-and-updates.md](docs/releases-and-updates.md).

---

## Contributing

Issues and pull requests are welcome on [GitHub](https://github.com/rohitpatil7892/rubynod/issues).

1. Fork the repo  
2. Create a branch (`git checkout -b feature/my-change`)  
3. `npm run build` and test with `npm run launch`  
4. Open a PR  

---

## License

MIT. Code-OSS fork components follow upstream licenses when you build the desktop app.
