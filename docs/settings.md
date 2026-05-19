# Rubynod settings (Cursor-style)

Open in VS Code: **Cmd+,** → search `rubynod`, or run **Rubynod: Open Settings**.

## Cursor → Rubynod mapping

| Cursor | Rubynod setting |
|--------|-----------------|
| Models → default model | `rubynod.models.chatModel` |
| Cursor Tab | `rubynod.tab.enabled`, `rubynod.tab.debounceMs` |
| Chat default mode | `rubynod.chat.defaultMode` |
| Codebase indexing | `rubynod.index.autoIndexOnOpen` |
| Privacy mode | `rubynod.privacy.privacyMode` |
| YOLO / auto-run terminal | `rubynod.agent.yoloMode` or `rubynod.agent.autoApproveTerminal` |
| MCP servers | `rubynod.mcp.enabled` + `~/.rubynod/mcp.json` |
| Rules for AI | `.rubynod/rules/`, `AGENTS.md` (not a setting — project files) |

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
- **includeActiveFile** — attach current file each message
- **includeOpenFiles** — list open tabs
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
- **localIndexOnly** — local embeddings for @codebase
- **telemetry** — opt-in analytics

### MCP (`rubynod.mcp.*`)
- **enabled** — load MCP tools for the agent

### Service (`rubynod.ai.serviceUrl`)
- URL of `rubynod-ai` process (default `http://127.0.0.1:3847`)

## Workspace vs user settings

| Scope | Use for |
|-------|---------|
| **User** | API keys, default models, privacy |
| **Workspace** | Team model choice, stricter agent approval |

Example workspace `.vscode/settings.json` is included in this repo.

## Deprecated keys

Old `rubynod.ai.*` keys still work but show deprecation hints — migrate to `rubynod.models.*`, `rubynod.chat.*`, etc.
