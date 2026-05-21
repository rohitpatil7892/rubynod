# Rubynod AI

**Open-source AI coding assistant for VS Code** — agent chat, local codebase indexing, file edits with diff review, terminal tools, inline edit, and tab autocomplete. Runs on your machine with **[Ollama](https://ollama.com)** by default; OpenAI, Anthropic, and OpenRouter are optional.

[GitHub repository](https://github.com/rohitpatil7892/rubynod) · [Report an issue](https://github.com/rohitpatil7892/rubynod/issues)

---

## Features

- **Agent chat** — Agent, Plan, Ask, and Debug modes in the sidebar
- **Chat history** — Previous chats, New chat, per-workspace sessions
- **Model picker** — Ollama or cloud provider and model per message
- **File tools** — Read, write, search/replace, grep, glob; Accept/Reject diffs
- **@ context** — Files, folders, symbols, drag-and-drop, context chips
- **Codebase index** — Local semantic and full-text search; optional auto-inject
- **Inline edit** — `Cmd+K` / `Ctrl+K` on the current selection
- **Tab autocomplete** — Optional ghost-text while you type
- **MCP** — Extra tools via `~/.rubynod/mcp.json`
- **Checkpoints** — Save workspace state before agent edits
- **Rules and skills** — `AGENTS.md`, `.rubynod/rules/`, `.rubynod/skills/`

**Platforms:** macOS, Windows, Linux

---

## Important: extension + AI service

The extension **bundles and auto-starts** the Rubynod AI agent on port **3847** inside VS Code (in-process by default — **no separate Node.js install**). You still need **Ollama** for local models (or a cloud API key).

```
Extension (in-process agent)  →  http://127.0.0.1:3847  →  Ollama (:11434) or cloud API
```

---

## Quick setup (Marketplace install)

### 1. Install requirements

- **VS Code 1.85+**
- **Ollama** (recommended for local models)

```bash
ollama serve
ollama pull qwen2.5-coder
```

### 2. In VS Code

1. Install **Rubynod AI** from the Marketplace and reload
2. The extension starts the AI agent automatically (check **Output → Rubynod AI Service**)
3. Open the **Rubynod AI** activity bar icon → **Chat**
4. Set **Provider** to Ollama and pick a **model** (e.g. `qwen2.5-coder` for file tools)
5. Use **Ask** for questions; **Agent** when you want edits

If the agent does not start: **Cmd+Shift+P → Rubynod: Start AI Service**

### Install from VSIX (release)

```bash
npm run package:ext
code --install-extension dist/rubynod-ai-ui-*.vsix
```

See [docs/install-extension.md](../../docs/install-extension.md) for end-user setup (extension + Ollama only).

### Developing from source

```bash
git clone https://github.com/rohitpatil7892/rubynod.git
cd rubynod && npm install && npm run package:ext
```

Then F5 the `rubynod-ai-ui` folder, or install the VSIX from `dist/`.

---

## Keyboard shortcuts

- `Cmd+L` / `Ctrl+L` — open chat
- `Cmd+K` / `Ctrl+K` — inline edit on selection

---

## Commands

- **Rubynod: Open Chat** — focus the chat sidebar
- **Rubynod: New Chat** — start a new conversation
- **Rubynod: Start AI Service** — start or configure the local AI service
- **Rubynod: Clear Chat History** — clear all chats for this workspace
- **Rubynod: Build Codebase Index** — rebuild the local code index
- **Rubynod: Select Ollama Model** — pick default Ollama model
- **Rubynod: Add to Chat** — add file or selection from explorer
- **Rubynod: Inline Edit** — edit selection with AI
- **Rubynod: Open Settings** — jump to Rubynod settings

---

## Settings (common)

- `rubynod.ai.repoPath` — path to cloned `rubynod` repo (AI service)
- `rubynod.ai.serviceUrl` — AI service URL (default `http://127.0.0.1:3847`)
- `rubynod.models.provider` — `ollama`, `openai`, `anthropic`, or `openrouter`
- `rubynod.models.chatModel` — default chat/agent model
- `rubynod.chat.defaultMode` — `agent`, `plan`, `ask`, or `debug`
- `rubynod.index.autoInjectContext` — auto-attach indexed code to prompts

Search **`rubynod`** in Settings for the full list.

---

## Requirements

- **VS Code 1.85+**
- **Node.js** — not required for normal use (agent runs in-process). Optional for child-process fallback (`rubynod.ai.inProcess`: false)
- **Ollama** (recommended) — local LLMs at `http://127.0.0.1:11434`
- **ripgrep** (`rg`) — agent search ([install](https://github.com/BurntSushi/ripgrep))

---

## Troubleshooting

- **AI offline** — run `npm run start:ai` or **Rubynod: Start AI Service**
- **`fetch failed`** — AI service not running on port **3847**
- **Duplicate `rubynod.chatView`** — disable Marketplace or dev copy in Extensions
- **Agent writes wrong files** — use **Ask** for how-to; use **qwen2.5-coder** in **Agent** mode
- **Empty file after write** — update extension; use a tool-capable model
- **Tab complete: model required** — set `rubynod.models.chatModel` or `rubynod.tab.model`

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
