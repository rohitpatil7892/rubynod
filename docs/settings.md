# Rubynod settings

Open in VS Code: **Cmd+,** → search `rubynod`, or run **Rubynod: Open Settings**.

## Setting groups

| Area | Rubynod settings |
|------|------------------|
| Models | `rubynod.models.chatModel`, `rubynod.models.provider` |
| Tab autocomplete | `rubynod.tab.enabled`, `rubynod.tab.debounceMs` |
| Chat default mode | `rubynod.chat.defaultMode` |
| Codebase indexing | `rubynod.index.autoIndexOnOpen` |
| Privacy mode | `rubynod.privacy.privacyMode` |
| YOLO / auto-run terminal | `rubynod.agent.yoloMode` or `rubynod.agent.autoApproveTerminal` |
| MCP servers | `rubynod.mcp.enabled` + `~/.rubynod/mcp.json` |
| Rules for AI | `.rubynod/rules/`, `AGENTS.md` — use clickable links in **Rubynod Rules, Skills & MCP** settings |
| Open Rules / Skills / MCP from Settings | Click links in settings UI or Command Palette |

## Sections

### Models (`rubynod.models.*`)
- **provider** — `openai`, `anthropic`, `ollama`, `openrouter`
- **chatModel** — Chat & Agent
- **tabModel** / **inlineModel** — overrides (empty = chat model)
- **baseUrl** — custom endpoint (Ollama, OpenRouter, etc.)
- **apiKey** — or use `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` env vars
- **temperature**, **maxTokens**

### Chat (`rubynod.chat.*`)
- **defaultMode** — `agent` | `plan` | `ask` | `debug`
- **includeActiveFile** — attach current file each message (default **false**; use **Tabs** or `@file`)
- **includeOpenFiles** — list open tabs each message (default **false**)
- **maxFileContextChars** — truncate large @files
- **maxContextAttachments** — cap chips per message

### Tab (`rubynod.tab.*`)
- **enabled** — ghost-text autocomplete
- **debounceMs** — delay before request

### Agent (`rubynod.agent.*`)
- **autoApproveTerminal** — skip terminal confirm dialog
- **autoApproveFileWrites** — apply diffs without review
- **yoloMode** — both of the above (trusted repos only)
- **maxTurns** — tool loop limit

### Index (`rubynod.index.*`)
- **autoIndexOnOpen** — build index at workspace open
- **autoIndexOnSave** — refresh on save

### Privacy (`rubynod.privacy.*`)
- **privacyMode** — minimize cloud code exposure
- **localIndexOnly** — keep embeddings local
- **telemetry** — off by default

### MCP (`rubynod.mcp.*`)
- **enabled** — connect MCP servers from config files

### Performance (`rubynod.performance.*`)
- **indexSaveDebounceMs**, **indexBuildConcurrency**, **searchCandidateLimit**, **contextCacheTtlSec**

### Update (`rubynod.update.*`)
- **enabled**, **githubRepo**, **checkIntervalHours**
