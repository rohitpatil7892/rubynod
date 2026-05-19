# Rubynod indexing

Rubynod indexes your workspace so the AI understands your codebase with local semantic and full-text search.

## What gets indexed

| Data | Purpose |
|------|---------|
| **Code chunks** | Smart splits at functions/classes (~100 lines max) |
| **Embeddings** | Local semantic vectors for “find related code” |
| **Full-text** | Keyword / token matching |
| **LSP symbols** | Functions, classes, methods from the language server |
| **File metadata** | Paths, mtimes, sizes |

Respects `.gitignore`, `.rubynodignore`, and `.cursorignore`.

## Storage

`<workspace>/.rubynod/index/chunks.db` (SQLite, local only)

## How AI uses the index

### 1. Automatic context (default on)

Setting: `rubynod.index.autoInjectContext` (default **true**)

Every agent message automatically includes the top matching chunks for your question — no need to type `@codebase` every time.

### 2. Manual @codebase

In chat: **@ Context → @codebase** or type a query. Uses full context pack (chunks + symbols).

### 3. Agent tool `codebase_search`

The agent can call `codebase_search` during a run for fresh retrieval.

## IDE integration

| Feature | Command / UI |
|---------|----------------|
| Status bar | `Index: N chunks` (bottom right) |
| Rebuild | **Rubynod: Build Codebase Index** |
| On workspace open | `rubynod.index.autoIndexOnOpen` |
| On file save | `rubynod.index.autoIndexOnSave` + LSP symbols |

## API (AI service)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/index/build` | POST | Full reindex |
| `/index/status` | GET | Stats + ready flag |
| `/index/search` | POST | Hybrid search results |
| `/index/context` | POST | Formatted AI context pack |
| `/index/update-file` | POST | Incremental file + symbols |

## Settings

```json
{
  "rubynod.index.autoIndexOnOpen": true,
  "rubynod.index.autoIndexOnSave": true,
  "rubynod.index.autoInjectContext": true,
  "rubynod.index.maxAutoContextChunks": 8,
  "rubynod.index.maxAutoContextChars": 24000,
  "rubynod.privacy.localIndexOnly": true
}
```

## Privacy

With `rubynod.privacy.localIndexOnly` (default **true**), embeddings are computed **on your machine** — no code sent to an embedding API for indexing.

## Troubleshooting

- **“Index offline”** — Start AI service: `npm run dev:ai`
- **“Index empty”** — Run **Build Codebase Index** or open a folder with source files
- **Poor results** — Rebuild index after large refactors; use specific queries in `@codebase`
