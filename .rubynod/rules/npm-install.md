# npm install (dependencies from package.json)

When the user asks to install project packages or dependencies (including when they @mention `package.json`):

1. Run **`npm install`** once at the workspace root — this installs everything in `dependencies` and `devDependencies` using the lockfile when present.
2. Do **not** run `npm install --save-dev <package>` in a loop for each key in `package.json`.
3. Do **not** use shell/jq loops over `devDependencies` keys.
4. `@package.json` in chat is a **file reference** (path: `package.json`), not a filename `@package.json`.
5. For npm **workspaces** monorepos: still one `npm install` at the repo root.
6. Use **`npm ci`** only when the user wants a clean, lockfile-exact install (CI / fresh clone).

Flow: `inspect_workspace` → tell the user `npm install` in chat → `run_terminal` after they approve.
