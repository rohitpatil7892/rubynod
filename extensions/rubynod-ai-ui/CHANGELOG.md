# Changelog

All notable changes to the **Rubynod AI** VS Code extension are documented here.

## [0.1.7] - 2025-05-21

### Fixed
- Strip `<script>` / `</script>` lines from agent file writes (server + extension)
- Prevents `server.js` starting with a bogus HTML `<script>` line

## [0.1.6] - 2025-05-21

### Fixed
- Chat syntax highlighting: keywords no longer break HTML (`class="tok-*"` text artifacts)
- Highlight order: keywords before comments/strings; uses `data-rn` spans instead of `class="tok-*"`
- Strip accidental `<script>` / markdown fences from agent `write_file` contents

## [0.1.5] - 2025-05-21

### Fixed
- Chat code blocks: syntax highlighting no longer breaks HTML (`class="tok-function"` showing as text)
- Code preview uses VS Code editor colors/font (not terminal theme)
- Agent file writes: reject slug filenames from the user prompt; auto-rename to `server.js` / `app.py` etc.
- Stronger rules: Node.js requests get `.js` files, not Python; short paths only

## [0.1.4] - 2025-05-21

### Fixed
- Bundled server crash: keep `openai/_vendor` in the VSIX (required by the OpenAI SDK at runtime)
- In-process start logs the real error to the extension host debug console

## [0.1.3] - 2025-05-21

### Added
- **Bundled AI agent** — no git clone or `npm run start:ai` for users
- **In-process server** (default) — runs inside VS Code; no system Node.js required
- **`rubynod.ai.lazyStart`** — start agent on first chat/index use (faster VS Code startup)
- Install guide: [docs/install-extension.md](../../docs/install-extension.md)

### Changed
- Codebase index uses **sql.js** (portable WASM) instead of native SQLite
- CI builds and uploads VSIX per OS; release workflow runs `bundle:server` + `package:ext`
- Smaller VSIX: prune dev files from bundled `server/node_modules`

### Fixed
- Bundle script cleanup (`ENOTEMPTY`) and copy path for AI `dist/`

## [0.1.2] - 2025-05-19

### Fixed
- Chat history panel: full-height scrollable list, wrapped titles (no overlap/clipping)
- Marketplace README: removed broken top image; bullet lists instead of wide tables
- Activity bar uses `icon-128.png` (same as Marketplace listing icon)

### Added
- Chat **history panel** (clock icon) and **New chat** in the header
- Multiple chat **sessions per workspace** with migration from older single-thread storage
- **Provider** and **model** picker in the composer (per message)
- Responsive composer toolbar for narrow sidebars

### Fixed
- Composer controls hidden when the panel is narrow
- Empty `write_file` content and tab-complete model errors (with matching AI service update)
- Duplicate `rubynod.chatView` registration detection when Marketplace + dev extension are both enabled

### Changed
- Marketplace publisher **RohitPatil**
- Improved chat UI: syntax highlighting, combined status row, tool history on reload

## [0.1.1] - 2025-05

### Added
- Initial Marketplace release: agent chat, file tools, diff review, @ context, indexing hooks
- Ollama model selection and AI service integration
- Inline edit (`Cmd+K`) and tab autocomplete

## [0.1.0] - 2025-05

- First public preview on VS Code Marketplace
