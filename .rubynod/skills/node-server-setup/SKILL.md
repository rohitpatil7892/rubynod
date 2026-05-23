---
name: node-server-setup
description: Create or update a minimal Node.js HTTP server with optional package.json only when needed to run
---

# Node server setup (minimal, not bootstrap)

## 1. Inspect first

- Run `inspect_workspace` or `read_file` on `package.json` and `server.js`.
- If `server.js` exists, read it and update — do not create a duplicate.

## 2. Create only what is missing

| Situation | Action |
|-----------|--------|
| User wants code only | `write_file` → `server.js` (plain `http` or `express` if deps exist) |
| `package.json` missing + user wants to run | Minimal `package.json`: `name`, `"start": "node server.js"`, `dependencies` if using express |
| `package.json` exists | Add/update `scripts.start` with `search_replace` if needed |
| Dependencies missing (listed in package.json) | Run **`npm install`** once at project root — not per-package loops |
| Need to add a **new** package | `npm install <pkg>` or update package.json + `npm install` |

## 3. Minimal server.js (no express)

```javascript
const http = require('http');
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, path: req.url }));
});
server.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
```

## 4. Run flow

1. State in chat: "To run: `npm install` (if needed) then `node server.js` or `npm start`."
2. Call `run_terminal` with that command when the user agrees.
3. If rejected, repeat the command for manual copy-paste.

Do not create README, Docker, tests, or frontend unless requested.
