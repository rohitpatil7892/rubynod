# Rubynod feature checklist

## P0 — MVP
- [x] Code-OSS fork scaffolding (`product.json`, `scripts/setup-code-oss-fork.sh`)
- [x] Chat + Agent mode with read/write/terminal tools
- [x] `@file`, `@folder`, `@codebase` (basic index)
- [x] MCP stdio servers
- [x] Inline edit + Tab autocomplete
- [x] Diff accept/reject
- [x] `.rubynodignore` + workspace rules

## P1 — Daily driver
- [x] Composer multi-file flow
- [x] Plan / Ask / Debug modes
- [x] Full @ mention set + context picker
- [x] Hybrid retrieval index
- [x] Terminal output in context; approval modes
- [x] Skills + `AGENTS.md`

## P2 — Platform
- [x] Cloud agents API (stub)
- [x] CLI
- [ ] Automations + hooks
- [ ] PR review assistant
- [ ] Remote SSH/dev containers

## Performance (first-class)
- [x] Candidate-limited hybrid search (no full-table scan)
- [x] Incremental index with mtime skip + debounced saves
- [x] Parallel index build + single-flight queue
- [x] Context pack cache (TTL)
- [x] Lazy AI service index (extension triggers build)
- See [gap-analysis.md](./gap-analysis.md) and [performance.md](./performance.md)
