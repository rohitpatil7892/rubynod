# Rubynod AI — Architecture Enhancement Plan

## Goal

Transform Rubynod from a local AI chat extension into a **true Ollama-first coding agent** similar to Cursor / Continue.dev while keeping:

- 100% local-first
- Privacy-focused
- Fast on consumer hardware
- Optimized for Node.js workflows
- Reliable with Ollama models

---

# Current Strengths

Current architecture already includes:

- Agent loop
- Hybrid retrieval
- FTS search
- Symbol support
- Ollama integration
- Tool execution
- Chat UI
- Context attachments
- Security direction

This is a strong foundation.

---

# Missing High ROI Improvements

## 1. Symbol Graph Service (P0)

### Problem

Current retrieval is file/chunk focused.

AI still lacks:

- Definitions
- References
- Import graph
- Dependency relations
- Related files

This causes bad multi-file edits.

### Add

Create:

```text
packages/rubynod-ai/src/symbol-graph/
```

Functions:

```ts
findDefinition(symbol)

findReferences(symbol)

findRelatedFiles(file)

findImports(file)

findExportConsumers(file)
```

### Why

Example:

User:

> Refactor auth flow

Without symbol graph:

AI edits random files.

With symbol graph:

AI finds:

```text
auth.service.ts
jwt.middleware.ts
token.service.ts
user.controller.ts
```

### Implementation

Use:

- VS Code LSP APIs
- TypeScript AST
- Workspace symbols

Avoid regex.

---

## 2. Context Ranking Engine (P0)

### Problem

Current context bundle uses fixed order.

Large repos = noisy context.

### Add

Create:

```text
context-ranker.ts
```

Instead of:

```text
manual
active file
retrieval
diagnostics
git
```

Use relevance scoring.

Example:

User:

> Fix database timeout issue

Priority:

1. DB diagnostics
2. changed DB files
3. active file
4. semantic retrieval
5. git

### Benefit

Better context quality.

Much better local model performance.

---

## 3. Planning Mode (P0)

### Problem

Local models jump directly into editing.

This causes poor edits.

### Add

Before execution:

```text
Plan → Approve → Execute
```

Example:

User:

> Add Redis caching

Agent:

```md
Plan:
1. Inspect architecture
2. Detect cache layer
3. Add dependency
4. Create service
5. Wire middleware
6. Verify build
```

Then:

```text
[Approve]
```

### Benefit

Huge reliability improvement for:

- qwen
- deepseek
- smaller models

---

## 4. Agent Scratchpad Memory (P1)

### Problem

AI repeats actions.

Example:

- reads same file again
- reinstalls dependency
- repeats failed edits

### Add

Create:

```text
agent-scratchpad.ts
```

Structure:

```ts
{
  filesRead: [],
  filesEdited: [],
  dependenciesInstalled: [],
  errorsObserved: [],
  attempts: []
}
```

### Benefit

Smarter agent behavior.

Less looping.

---

## 5. Workspace Summary Cache (P1)

### Problem

AI redetects stack every prompt.

### Add

Generate:

```text
.rubynod/workspace-summary.json
```

Example:

```json
{
  "framework": "Express",
  "database": "Postgres",
  "orm": "Sequelize",
  "testFramework": "Jest"
}
```

### Benefit

Faster context.

Better responses.

Lower token usage.

---

## 6. Failure Recovery Mode (P1)

### Problem

Agent spirals after errors.

### Add

If:

```text
lint fails
compile fails
tool fails
```

Switch to:

```text
minimal-fix-mode
```

Prompt:

> Fix only introduced error.
> Do not refactor.

### Benefit

More stable edits.

Cursor-like reliability.

---

## 7. Token Budget Manager (P0)

### Problem

Context explosion.

Especially bad for Ollama.

### Add

Create:

```text
context-budget-manager.ts
```

Split context:

```text
System → 15%
Workspace → 20%
Retrieval → 25%
Chat → 20%
Scratchpad → 10%
Reserve → 10%
```

### Benefit

Better performance on:

```text
7B–14B models
```

---

## 8. Model Capability Profiles (P1)

### Problem

Same behavior for all models.

Bad for weak local models.

### Add

Create:

```json
{
  "model": "qwen3-coder:14b",
  "tools": true,
  "reasoning": 8,
  "editing": 9,
  "speed": 6
}
```

Adaptive behavior:

Weak model:

```text
more planning
smaller context
more retries
```

Strong model:

```text
larger context
fewer restrictions
```

---

# Updated Recommended Roadmap

## Phase 1 — Stability

- bridge health
- service reliability
- model validation
- onboarding fixes

## Phase 2 — Retrieval

- Ollama embeddings
- hybrid search
- ranking improvements

## Phase 2.5 — Symbol Intelligence (NEW)

- symbol graph
- definition lookup
- references
- dependency awareness

## Phase 3 — Context Engine

- context bundle
- ranking engine
- diagnostics
- git context

## Phase 4 — Agent Intelligence

- planning mode
- scratchpad memory
- verification loop

## Phase 5 — Security

- terminal safe mode
- secret blocking
- path jail

## Phase 6 — UX Polish

- diff improvements
- problem panel actions
- indexing feedback

---

# What To Delay

Avoid early overengineering.

Delay:

- Shadow workspace
- Thread persistence
- Multi-root indexing
- Per-hunk diff approval
- Cloud APIs

Focus on core reliability first.

---

# Success Criteria

Rubynod is ready when:

- @codebase works for paraphrased queries
- agent edits multiple files correctly
- lint auto-fixes happen
- Marketplace install works instantly
- no repoPath confusion
- safe terminal by default
- fast retrieval in large repos

---

# Core Principle

Cursor wins because of:

```text
Context
+ Tool Loop
+ Verification
```

Not because of prompts.

Rubynod should optimize:

> Context quality over prompt complexity