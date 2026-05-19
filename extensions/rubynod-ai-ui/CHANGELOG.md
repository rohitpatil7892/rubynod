# Changelog

All notable changes to the **Rubynod AI** VS Code extension are documented here.

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
