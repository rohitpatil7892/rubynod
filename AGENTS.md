# Rubynod workspace agent instructions

- Prefer TypeScript for new packages under `packages/`.
- Match existing naming: `rubynod-*` for packages, `@rubynod/*` for npm scope.
- AI service default port: **3847**.
- Do not commit API keys or `.env` files.
- Run `npm run build` from repo root before packaging the extension.
- **Install dependencies:** from repo root run `npm install` (or `npm ci` for a clean lockfile install). Never loop `npm install --save-dev <name>` per key in `package.json`. `@package.json` in chat is a file reference, not a literal filename.
