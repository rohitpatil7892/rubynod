# Rubynod vs VS Code vs Cursor — gap analysis

Rubynod = **Code-OSS shell** (fork scripts) + **Rubynod AI extension** + **local AI service**. Many VS Code features come from the editor; AI features come from the extension/service.

**Legend:** ✅ Supported · 🟡 Partial · ❌ Not yet · 🔧 Via VS Code / fork only

---

## VS Code core (editor shell)

| Capability | VS Code | Rubynod | Notes |
|------------|---------|---------|-------|
| Monaco editor, syntax, themes | ✅ | 🔧 | Requires built Code-OSS fork |
| Extensions (marketplace) | ✅ | 🔧 | Open VSX / VS Marketplace when fork built |
| Debugging, breakpoints | ✅ | 🔧 | Standard VS Code |
| Git SCM, diff, merge | ✅ | 🔧 | Standard VS Code |
| Integrated terminal | ✅ | 🔧 | Agent can run commands via bridge |
| Tasks, launch.json | ✅ | 🔧 | Standard VS Code |
| Remote SSH / WSL / Containers | ✅ | ❌ | P2 — not in Rubynod layer |
| Settings Sync / Profiles | ✅ | 🔧 | VS Code built-in when fork built |
| Multi-root workspace | ✅ | 🟡 | Index/context use active folder; improving |
| Command palette | ✅ | 🟡 | Rubynod commands registered; not full parity |
| Search / replace across files | ✅ | 🔧 | VS Code + agent `grep` tool |
| Language servers (LSP) | ✅ | 🔧 | Standard VS Code |
| Snippets, Emmet | ✅ | 🔧 | Standard VS Code |
| Problems / Output panels | ✅ | 🔧 | Agent `read_lints` uses bridge |

---

## Cursor AI — chat & agent

| Capability | Cursor | Rubynod | Priority |
|------------|--------|---------|----------|
| Chat + streaming | ✅ | ✅ | — |
| Agent tool loop (read/write/terminal) | ✅ | ✅ | — |
| Plan / Ask / Debug modes | ✅ | ✅ | — |
| Stop / cancel generation | ✅ | ✅ | — |
| @file, @folder, line ranges | ✅ | ✅ | — |
| @codebase (indexed retrieval) | ✅ | ✅ | Optimized hybrid search |
| @ symbol (workspace) | ✅ | ✅ | `symbol:` mentions |
| Thinking / tool UI in chat | ✅ | ✅ | — |
| File chips, drag-drop context | ✅ | ✅ | — |
| Rules (`.cursor/rules`, AGENTS.md) | ✅ | ✅ | `.rubynod/rules` + Cursor paths |
| Skills (SKILL.md) | ✅ | ✅ | — |
| MCP tools | ✅ | ✅ | `~/.rubynod/mcp.json` |
| YOLO / auto-approve | ✅ | ✅ | Settings |
| Memories (persistent facts) | ✅ | ✅ | `.rubynod/memories.json` |
| Image attachments in chat | ✅ | ❌ | P2 |
| @web / live docs | ✅ | 🟡 | `web_search` tool (opt-in) |
| Background / cloud agents | ✅ | 🟡 | API stub only |
| PR review / Bugbot | ✅ | ❌ | P2 |
| Team rules sync | ✅ | ❌ | P2 |
| Automations / hooks | ✅ | ❌ | P2 |

---

## Cursor AI — editing

| Capability | Cursor | Rubynod | Priority |
|------------|--------|---------|----------|
| Inline edit (Cmd+K) | ✅ | ✅ | — |
| Tab autocomplete (ghost text) | ✅ | ✅ | Debounced, single in-flight |
| Composer multi-file | ✅ | 🟡 | Checkpoints; UI polish ongoing |
| Apply diff hunk accept/reject | ✅ | 🟡 | Bridge + composer flow |
| Shadow workspace (isolated edits) | ✅ | ❌ | P2 |

---

## Indexing & performance (key differentiator)

| Capability | Cursor | Rubynod | Status |
|------------|--------|---------|--------|
| Local index + embeddings | ✅ | ✅ | Hash embeddings (local) |
| Incremental index on save | ✅ | ✅ | Debounced `update-file` |
| Skip unchanged files (mtime) | ✅ | ✅ | Server-side skip |
| No full-table semantic scan | ✅ | ✅ | Candidate-limited search |
| Index build queue (single-flight) | — | ✅ | Per-workspace |
| Context pack cache | — | ✅ | TTL cache on AI service |
| Lazy index on service start | — | ✅ | Extension triggers build |
| Configurable caps (chars/files/chunks) | ✅ | ✅ | Settings |
| FTS5 / vector DB at scale | ✅ | 🟡 | FTS table optional; P1 ANN later |
| Background worker (extension host) | ✅ | 🟡 | Index runs in Node service |

See [performance.md](./performance.md) for tuning.

---

## Recommended roadmap

### P0 (done / in progress)
- Performance-first indexing and search
- Gap doc + settings for caps
- @symbol, memories, web search (opt-in)

### P1 (next)
- Multi-root: index all folders, pick context root per file
- Composer diff UI parity with Cursor
- File watcher index (not only on save)
- Optional cloud embeddings with privacy gate

### P2
- Remote SSH, dev containers
- Cloud agents, PR review
- Image chat, automations, hooks
- Full Code-OSS fork CI build per platform

---

## How to run Rubynod today

1. `npm run build` at repo root  
2. `npm run dev:ai` — AI service on port 3847  
3. `code --extensionDevelopmentPath=extensions/rubynod-ai-ui`  
4. Build Code-OSS fork when you need a **branded desktop app** (see `scripts/setup-code-oss-fork.sh`)
