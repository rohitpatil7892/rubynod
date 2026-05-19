# Rubynod AI

**Open-source AI coding assistant for VS Code** — agent chat, local codebase indexing, file edits with diff review, terminal tools, inline edit, and tab autocomplete. Runs on your machine with **[Ollama](https://ollama.com)** by default; OpenAI, Anthropic, and OpenRouter are optional.

[GitHub repository](https://github.com/rohitpatil7892/rubynod) · [Report an issue](https://github.com/rohitpatil7892/rubynod/issues)

---

## Features

| Feature | Description |
|--------|-------------|
| **Agent chat** | **Agent**, **Plan**, **Ask**, and **Debug** modes in the Rubynod AI sidebar |
| **Chat history** | Previous chats list, **New chat**, per-workspace session storage |
| **Model picker** | Choose **provider** (Ollama / cloud) and **model** per message |
| **File tools** | Read, write, search/replace, grep, glob — review changes with **Accept / Reject** diffs |
| **@ context** | Attach files, folders, symbols, drag-and-drop, and context chips |
| **Codebase index** | Local semantic + full-text search; optional auto-inject into agent prompts |
| **Inline edit** | `Cmd+K` / `Ctrl+K` on the current selection |
| **Tab autocomplete** | Optional ghost-text completions while you type |
| **MCP** | Connect extra tools via `~/.rubynod/mcp.json` |
| **Checkpoints** | Save workspace checkpoints before agent edits |
| **Rules & skills** | `AGENTS.md`, `.rubynod/rules/`, `.rubynod/skills/` |

**Platforms:** macOS · Windows · Linux

---

## Important: extension + AI service

Installing from the Marketplace gives you the **VS Code UI only**. Rubynod also needs a small **AI service** from the same repo (agent loop, tools, indexing) and usually **Ollama** for local models.

```
Extension  →  AI service (:3847)  →  Ollama (:11434) or cloud API
```

---

## Quick setup (Marketplace install)

### 1. One-time: clone and build the AI service

```bash
git clone https://github.com/rohitpatil7892/rubynod.git
cd rubynod

# macOS: Node 22 recommended (avoid Node 25 for native modules)
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"

npm install
npm run build
```

### 2. Point the extension at the repo

1. Open VS Code **Settings** (`Cmd+,`)
2. Search `rubynod.ai.repoPath`
3. Set the path to your `rubynod` clone (e.g. `~/Desktop/myCode/rubynod`)

### 3. Start services

**Terminal A — AI service** (keep running):

```bash
cd /path/to/rubynod
npm run start:ai
```

**Terminal B — Ollama** (if using local models):

```bash
ollama serve
ollama pull qwen2.5-coder
```

### 4. In VS Code

1. Command Palette → **Rubynod: Start AI Service** (first time may confirm repo path)
2. Open the **Rubynod AI** activity bar icon → **Chat**
3. Set **Provider** to Ollama and pick a **model** (e.g. `qwen2.5-coder` for file tools)
4. Use **Ask** for questions; **Agent** when you want edits

---

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+L` / `Ctrl+L` | Open chat |
| `Cmd+K` / `Ctrl+K` | Inline edit on selection |

---

## Commands

| Command | Description |
|---------|-------------|
| **Rubynod: Open Chat** | Focus the chat sidebar |
| **Rubynod: New Chat** | Start a new conversation |
| **Rubynod: Start AI Service** | Start or configure the local AI service |
| **Rubynod: Clear Chat History** | Clear all chats for this workspace |
| **Rubynod: Build Codebase Index** | Rebuild the local code index |
| **Rubynod: Select Ollama Model** | Pick default Ollama model |
| **Rubynod: Add to Chat** | Add file/selection from explorer |
| **Rubynod: Inline Edit** | Edit selection with AI |
| **Rubynod: Open Settings** | Jump to Rubynod settings |

---

## Settings (common)

| Setting | Purpose |
|---------|---------|
| `rubynod.ai.repoPath` | Path to cloned `rubynod` repo (AI service) |
| `rubynod.ai.serviceUrl` | AI service URL (default `http://127.0.0.1:3847`) |
| `rubynod.models.provider` | `ollama` · `openai` · `anthropic` · `openrouter` |
| `rubynod.models.chatModel` | Default chat/agent model |
| `rubynod.chat.defaultMode` | `agent` · `plan` · `ask` · `debug` |
| `rubynod.index.autoInjectContext` | Auto-attach indexed code to prompts |

Search **`rubynod`** in Settings for the full list.

---

## Requirements

| Requirement | Notes |
|-------------|--------|
| **VS Code 1.85+** | |
| **Node.js 20 or 22** | For the AI service (not bundled in the VSIX) |
| **Ollama** (recommended) | Local LLMs at `http://127.0.0.1:11434` |
| **ripgrep** (`rg`) | Used by agent search — [install](https://github.com/BurntSushi/ripgrep) |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| **AI offline** in chat | Run `npm run start:ai` in the repo, or **Rubynod: Start AI Service** |
| **`fetch failed`** | AI service not running on port **3847** |
| **`Cannot register multiple views rubynod.chatView`** | Two Rubynod installs (Marketplace + dev). Disable one in Extensions |
| **Agent writes wrong files / raw JSON** | Use **Ask** for how-to questions; use **qwen2.5-coder** in **Agent** mode |
| **Empty file after write** | Update extension; use a tool-capable model |
| **Tab complete: model required** | Set `rubynod.models.chatModel` or `rubynod.tab.model` |

---

## Documentation

Full docs live in the [GitHub repo](https://github.com/rohitpatil7892/rubynod):

- [Settings](https://github.com/rohitpatil7892/rubynod/blob/main/docs/settings.md)
- [Indexing](https://github.com/rohitpatil7892/rubynod/blob/main/docs/indexing.md)
- [Chat & file context](https://github.com/rohitpatil7892/rubynod/blob/main/docs/chat-file-context.md)
- [Releases & updates](https://github.com/rohitpatil7892/rubynod/blob/main/docs/releases-and-updates.md)

---

## License

MIT — see [LICENSE](https://github.com/rohitpatil7892/rubynod/blob/main/README.md#license) in the repository.
