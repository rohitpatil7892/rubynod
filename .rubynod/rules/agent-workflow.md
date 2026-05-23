# Agent workflow (files & terminal)

## Tools-first rule (most important)

Always call tools — **never explain steps** when you can act:

- If asked to create a file: call `write_file` with complete contents.
- If asked to edit a file: call `read_file` first, then `search_replace` or `write_file`.
- If asked to run a command: call `run_terminal` (after stating the command in your reply).
- Do **not** output bullet-point instructions or markdown steps instead of calling tools.
- One `write_file` call per file per turn — full contents only, no partial writes.
- After writing a file, call `read_lints` on that path to check for errors.

## Before creating or overwriting files

1. Check what already exists: `inspect_workspace`, `read_file`, `glob`, or `list_dir`.
2. If the target file exists (e.g. `server.js`), **read it first**. Prefer `search_replace` or a deliberate `write_file` update — do not recreate from scratch unless the user asked to replace it.
3. Use short conventional paths (`server.js`, `package.json`) — never slugify the user's message as a filename.

## Node.js server requests

When the user asks for a Node/Express server:

1. Call `inspect_workspace` or read `package.json` and list the root.
2. If `server.js` (or `index.js` / `src/index.ts`) already exists → read it and extend or fix it.
3. If there is **no** `package.json` and the user only wants a single file → you may create `server.js` only (no bootstrap).
4. If the user wants to **run** the app or needs npm dependencies → create minimal `package.json` (name, `scripts.start`, dependencies), then `server.js`, then suggest `npm install` and `npm start` in chat.
5. Do **not** add React/Vite/full boilerplate unless the user asked for it.

## Terminal commands

1. Propose the exact command in your reply first (e.g. `npm install` then `node server.js`).
2. Use `run_terminal` only when execution is needed; the user must **Approve** in the IDE (unless auto-approve is on).
3. If the command is rejected, tell the user they can run it manually in the terminal.

## Language matching

If the user asks for Node.js, write JavaScript/TypeScript — not Python. Match file extension to the language in `contents`.
