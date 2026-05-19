# Rubynod performance guide

Performance is a first-class goal: indexing and context injection must stay fast on large repos.

## Architecture


| Layer                | Role                        | Performance notes                                |
| -------------------- | --------------------------- | ------------------------------------------------ |
| VS Code extension    | UI, save events, @ mentions | Debounced index updates; adaptive status polling |
| `rubynod-ai` service | Agent, tools, index API     | Single-flight index builds; context cache        |
| `rubynod-index`      | SQLite + local embeddings   | Candidate-limited hybrid search; mtime skip      |


## Indexing

### Defaults (tuned for speed)

- **No automatic full index** when the AI service starts (`RUBYNOD_INDEX_ON_START=0`). The extension triggers build on workspace open if `rubynod.index.autoIndexOnOpen` is true.
- **Incremental updates** on save via `/index/update-file` (debounced 800ms in the extension, 400ms on the server).
- **Skip unchanged files** using stored `mtime_ms` — re-read only when the file changed.
- **Full rebuild** only via command *Rubynod: Build Codebase Index* or explicit `/index/build`.

### Search (hybrid)

Old behavior scanned **every chunk** for semantic similarity (O(n) per query). Current behavior:

1. **Text pre-filter** — SQL `LIKE` on content, max ~400 rows
2. **Semantic rank** — cosine similarity only on those candidates
3. **Symbol hits** — indexed SQL lookup
4. Merge and return top `limit` results

For monorepos >50k chunks, raise limits cautiously or split workspaces.

## Settings


| Setting                                     | Default | Purpose                                      |
| ------------------------------------------- | ------- | -------------------------------------------- |
| `rubynod.index.autoIndexOnOpen`             | `true`  | Background full index when opening workspace |
| `rubynod.index.autoIndexOnSave`             | `true`  | Incremental update on save                   |
| `rubynod.index.autoInjectContext`           | `true`  | Auto @codebase snippets in agent messages    |
| `rubynod.index.maxAutoContextChunks`        | `8`     | Cap chunks per message                       |
| `rubynod.index.maxAutoContextChars`         | `24000` | Cap injected characters                      |
| `rubynod.performance.indexSaveDebounceMs`   | `800`   | Batch rapid saves                            |
| `rubynod.performance.indexBuildConcurrency` | `8`     | Parallel files during full build             |
| `rubynod.performance.searchCandidateLimit`  | `400`   | Max rows for hybrid pre-filter               |
| `rubynod.performance.contextCacheTtlSec`    | `45`    | Reuse context packs for similar queries      |
| `rubynod.performance.statusPollIntervalMs`  | `30000` | Status bar refresh when idle                 |
| `rubynod.chat.maxFileContextChars`          | `48000` | Per-file attachment cap                      |
| `rubynod.tab.debounceMs`                    | `600`   | Tab completion delay                         |


## Environment variables (AI service)


| Variable                 | Default | Purpose                                             |
| ------------------------ | ------- | --------------------------------------------------- |
| `RUBYNOD_INDEX_ON_START` | `0`     | Set `1` to index all workspaces when service starts |
| `RUBYNOD_WEB_SEARCH`     | `0`     | Set `1` to enable `web_search` agent tool           |


## Tips for large repos

1. Add paths to `**.rubynodignore`** (same spirit as `.cursorignore`).
2. Turn off `**autoIndexOnOpen**` and run manual index once.
3. Lower `**maxAutoContextChunks**` / `**maxAutoContextChars**` for faster agent turns.
4. Disable `**autoInjectContext**` if you only use explicit `@file` / `@folder`.
5. Keep **one AI service** instance — index DB is per workspace under `.rubynod/index/`.

## Measuring

- Status bar: `Index: N chunks` when ready, spinner while indexing.
- `GET /index/status?workspaceRoot=...` — chunk/file/symbol counts.
- Watch CPU during first index; incremental saves should be light.

