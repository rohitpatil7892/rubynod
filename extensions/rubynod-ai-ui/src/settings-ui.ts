import type { SettingsPanelState } from './settings-panel-state';

/** Copilot-style Rubynod settings webview shell (logic in media/settings-panel.js). */
export function getSettingsHtml(
  state: SettingsPanelState,
  scriptSrc: string,
  panelsScriptSrc: string,
  cursorCssSrc: string,
  cspSource: string,
  nonce: string
): string {
  const stateJson = JSON.stringify(state).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${cspSource}; font-src ${cspSource}; script-src 'nonce-${nonce}' ${cspSource};" />
<link rel="stylesheet" href="${cursorCssSrc}" />
<style>
  :root {
    --bg: var(--vscode-editor-background, #1e1e1e);
    --bg2: var(--vscode-sideBar-background, #252526);
    --border: color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
    --text: var(--vscode-foreground, #ccc);
    --muted: var(--vscode-descriptionForeground, #9d9d9d);
    --accent: var(--vscode-focusBorder, #0078d4);
    --accent-soft: color-mix(in srgb, var(--accent) 18%, transparent);
    --radius: 8px;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: var(--vscode-font-family, system-ui, sans-serif);
    font-size: 13px;
    color: var(--text);
    background: var(--bg);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .topbar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--bg2);
  }
  .topbar h1 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    flex: 1;
  }
  .topbar .ver { font-size: 11px; color: var(--muted); }
  .search-wrap { flex: 0 1 280px; }
  .search-wrap input {
    width: 100%;
    padding: 6px 10px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    font: inherit;
  }
  .save-status { font-size: 11px; min-width: 48px; text-align: right; }
  .save-status.ok { color: #4ade80; }
  .save-status.err { color: #f87171; }
  .btn {
    padding: 6px 12px;
    border-radius: var(--radius);
    border: none;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    background: var(--vscode-button-background, var(--accent));
    color: var(--vscode-button-foreground, #fff);
  }
  .btn.secondary {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
  }
  .btn:hover { filter: brightness(1.08); }
  .layout {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .sidebar {
    width: 200px;
    flex-shrink: 0;
    border-right: 1px solid var(--border);
    background: var(--bg2);
    overflow-y: auto;
    padding: 8px 6px;
  }
  .nav-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .nav-item:hover { background: var(--accent-soft); }
  .nav-item.active {
    background: var(--vscode-list-activeSelectionBackground, var(--accent-soft));
    font-weight: 600;
  }
  .nav-icon { opacity: 0.85; width: 18px; text-align: center; }
  .main {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    padding: 20px 28px 32px;
  }
  .section-head { margin-bottom: 20px; }
  .section-head h1 { margin: 0 0 6px; font-size: 20px; font-weight: 600; }
  .section-head p { margin: 0; color: var(--muted); line-height: 1.5; max-width: 560px; }
  .section-fields {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-width: 720px;
  }
  .field, .action-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 0;
    border-bottom: 1px solid var(--border);
  }
  .field-text { flex: 1; min-width: 0; }
  .field-label { font-weight: 500; }
  .field-desc { font-size: 11px; color: var(--muted); margin-top: 4px; line-height: 1.4; }
  .field-control { flex-shrink: 0; }
  .input {
    min-width: 200px;
    padding: 6px 10px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    font: inherit;
  }
  .input.select { min-width: 240px; }
  .toggle {
    position: relative;
    display: inline-block;
    width: 40px;
    height: 22px;
    cursor: pointer;
  }
  .toggle input { opacity: 0; width: 0; height: 0; }
  .toggle-track {
    position: absolute;
    inset: 0;
    background: var(--border);
    border-radius: 11px;
    transition: background 0.2s;
  }
  .toggle-track::after {
    content: '';
    position: absolute;
    width: 16px;
    height: 16px;
    left: 3px;
    top: 3px;
    background: #fff;
    border-radius: 50%;
    transition: transform 0.2s;
  }
  .toggle input:checked + .toggle-track { background: var(--accent); }
  .toggle input:checked + .toggle-track::after { transform: translateX(18px); }
</style>
</head>
<body>
  <header class="topbar">
    <h1>Rubynod Settings</h1>
    <span class="ver">v${state.version}</span>
    <div class="search-wrap">
      <input type="search" id="search" placeholder="Search settings…" />
    </div>
    <span class="save-status" id="save-status"></span>
    <button type="button" class="btn secondary" id="close-btn">Done</button>
  </header>
  <div class="layout">
    <nav class="sidebar" id="nav"></nav>
    <main class="main" id="content"></main>
  </div>
  <script nonce="${nonce}">window.__RUBYNOD_SETTINGS__ = ${stateJson};</script>
  <script nonce="${nonce}" src="${panelsScriptSrc}"></script>
  <script nonce="${nonce}" src="${scriptSrc}"></script>
</body>
</html>`;
}
