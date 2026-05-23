# Testing the Rubynod Agent

This guide covers manual and automated ways to verify that Rubynod's core features work correctly after development changes.

---

## Quick smoke test

1. Open the Rubynod chat panel.
2. Verify the status indicator is **Online** (green dot).
3. Ask `"List the files in the src folder"` — the agent should call `glob` and return results.
4. Ask `"What is the package.json main entry?"` — should call `read_file` without being asked.

---

## Drag-and-drop attachments

1. Open VS Code Explorer and drag any `.ts` file into the Rubynod composer box.
2. A chip should appear with the file name.
3. Ask `"Summarise this file"` — the file content must appear in the agent's response.
4. Drag a `.env` file — a warning modal should appear asking you to confirm before attaching.
5. Drag 5+ files — only up to `maxContextAttachments` (default 5) should be loaded.

---

## Context auto-injection (B1)

1. Open a TypeScript file with a type error.
2. Send an agent message without any `@` mention.
3. In `coding` mode (`rubynod.chat.autoContext = "coding"`), the active file and diagnostics should appear in the injected context (visible via the `## Active file` section if you ask the agent to repeat what it knows).
4. Change `rubynod.chat.autoContext` to `"off"` and repeat — no file should be injected.

---

## Codebase search (hybrid)

1. Rebuild the index: **Cmd+Shift+P → Rubynod: Build Codebase Index**.
2. In Agent mode type: `@codebase what does the CodebaseIndexer class do?`
3. The agent should return relevant code snippets with file paths.
4. Try a CamelCase query (`CodebaseIndexer`) vs a NL query (`how does indexing work`) — the former should bias toward FTS, the latter toward semantic similarity.
5. Use the **Test Retrieval** command (`Cmd+Shift+P → Rubynod: Test Retrieval`) to inspect raw search results.

---

## Plan → Approve → Execute (B5)

1. Switch the mode selector to **Plan**.
2. Ask `"Add a health check endpoint to the Express server"`.
3. The agent should output a plan (no file writes).
4. An **▶ Execute plan** button appears below the plan.
5. Click it — mode switches to **Agent** and the agent executes the plan, creating/editing files.
6. Accept/Reject the diffs.

---

## Symbol graph (B3)

1. Open a file that exports a class or function used elsewhere.
2. Ask `"Find all references to the CodebaseIndexer class"`.
3. The agent should call `find_symbol` with `action: "references"` and return a list of files.
4. Ask `"Show the symbol outline of indexer.ts"` — should call `find_symbol` with `action: "symbols"`.

---

## Agent scratchpad (B6)

1. Start a multi-step task (e.g. create a new service + update an index file).
2. In the second turn, the system prompt should include a `## Session context` block listing files already read/edited (visible in Rubynod output channel with log level `debug`).
3. The agent should not re-read files it already read in the same turn sequence.

---

## Context budget (B4)

1. In a large monorepo, run a query that would normally attach many large files.
2. Inspect the AI service logs (`/index/test-retrieval`) for context size.
3. Verify total context does not exceed the model's window (default ~32k tokens for 7-14B models).

---

## Workspace summary (B7)

1. Run **Rubynod: Build Codebase Index**.
2. Check that `.rubynod/workspace-summary.json` was written with correct `framework`, `testRunner`, and `packageManager`.
3. Ask `"What test runner does this project use?"` — the agent should answer from the workspace summary without reading `package.json`.

---

## Terminal allowlist (C)

1. Ensure `rubynod.agent.yoloMode` and `rubynod.agent.autoApproveTerminal` are both `false`.
2. Ask the agent to run `npm install`.
3. Since `npm` is in the default allowlist, it should execute without a confirmation dialog.
4. Ask the agent to run `rm -rf /` — this should be blocked by the safety blocklist, not by the allowlist.
5. Ask the agent to run a custom command like `my-custom-tool build`.
6. You should see an approval dialog.
7. Add `my-custom-tool` to `rubynod.agent.terminalAllowlist` and repeat — no dialog.

---

## Health indicator (C)

1. Stop the AI service manually.
2. The status badge should show **Service offline** in red.
3. Start the service — it transitions to **Bridge pending** (orange/checking) then **Online** (green).
4. Build the index — the indicator tooltip should show `Index: ✓`.

---

## Build

After making changes, always run:

```bash
npm run build
```

from the repo root. Fix any TypeScript errors before pushing.
