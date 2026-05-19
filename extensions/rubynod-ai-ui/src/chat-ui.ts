/** Rubynod chat webview */
export function getChatHtml(defaultMode: string): string {
  const nonce = String(Date.now());
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<style>
  :root {
    --rn-accent: var(--vscode-focusBorder, #0078d4);
    --rn-accent-soft: color-mix(in srgb, var(--rn-accent) 18%, transparent);
    --rn-surface: var(--vscode-sideBar-background, #1e1e1e);
    --rn-surface-2: var(--vscode-editor-background, #252526);
    --rn-border: color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
    --rn-muted: var(--vscode-descriptionForeground, #9d9d9d);
    --rn-text: var(--vscode-foreground, #ccc);
    --rn-radius: 10px;
    --rn-radius-sm: 6px;
    --rn-shadow: 0 -4px 24px rgba(0,0,0,0.25);
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0; padding: 0;
    font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
    font-size: 13px; line-height: 1.55;
    color: var(--rn-text);
    background: var(--rn-surface);
    display: flex; flex-direction: column;
    overflow: hidden;
  }

  /* —— Header (history + new chat) —— */
  .chat-header {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--rn-border);
    background: var(--rn-surface);
    min-width: 0;
  }
  .chat-header-main {
    flex: 1;
    min-width: 0;
  }
  .session-title {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: var(--rn-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chat-header-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }
  .header-icon-btn {
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: var(--rn-radius-sm);
    background: transparent;
    color: var(--rn-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, color 0.15s;
  }
  .header-icon-btn:hover,
  .header-icon-btn.active {
    background: var(--rn-accent-soft);
    color: var(--rn-text);
  }
  .header-icon-btn svg {
    width: 16px;
    height: 16px;
    fill: currentColor;
  }
  .history-panel {
    position: absolute;
    top: 44px;
    left: 8px;
    right: 8px;
    z-index: 100;
    max-height: min(420px, 55vh);
    display: flex;
    flex-direction: column;
    border: 1px solid var(--rn-border);
    border-radius: var(--rn-radius);
    background: var(--rn-surface-2);
    box-shadow: 0 12px 32px rgba(0,0,0,0.45);
  }
  .history-panel.hidden { display: none; }
  .history-panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-bottom: 1px solid var(--rn-border);
    font-size: 11px;
    font-weight: 600;
    color: var(--rn-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .history-list {
    overflow-y: auto;
    padding: 4px 0;
  }
  .history-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;
    cursor: pointer;
    border: none;
    width: 100%;
    text-align: left;
    background: transparent;
    color: var(--rn-text);
    font-family: inherit;
    font-size: 12px;
  }
  .history-item:hover { background: var(--rn-accent-soft); }
  .history-item.active {
    background: var(--vscode-list-activeSelectionBackground, var(--rn-accent-soft));
  }
  .history-item-body { flex: 1; min-width: 0; }
  .history-item-title {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .history-item-meta {
    font-size: 10px;
    color: var(--rn-muted);
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .history-item-delete {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--rn-muted);
    cursor: pointer;
    opacity: 0;
    font-size: 14px;
    line-height: 1;
  }
  .history-item:hover .history-item-delete { opacity: 1; }
  .history-item-delete:hover {
    background: color-mix(in srgb, #f87171 20%, transparent);
    color: #f87171;
  }
  .history-empty {
    padding: 24px 16px;
    text-align: center;
    color: var(--rn-muted);
    font-size: 12px;
  }
  .chat-shell {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* —— Chips (above composer input) —— */
  #chips {
    display: flex; flex-wrap: wrap; gap: 6px;
    min-height: 0; margin-bottom: 6px;
  }
  #chips:empty { display: none; }
  #targets {
    display: flex; flex-wrap: wrap; gap: 6px;
    margin-bottom: 6px; min-height: 0;
  }
  #targets:empty { display: none; }
  .target-chip {
    font-size: 11px; padding: 3px 8px 3px 10px;
    border-radius: 20px;
    background: color-mix(in srgb, #a78bfa 12%, var(--rn-surface));
    border: 1px solid color-mix(in srgb, #a78bfa 35%, var(--rn-border));
    color: var(--rn-text);
    display: inline-flex; align-items: center; gap: 6px;
    cursor: default; max-width: 220px;
  }
  .target-chip .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .target-chip .x { opacity: 0.6; cursor: pointer; font-size: 14px; }
  .target-chip .x:hover { opacity: 1; }
  .toolbar-text-btn {
    font-size: 10px; font-weight: 600; padding: 5px 8px;
    border-radius: var(--rn-radius-sm);
    border: 1px solid var(--rn-border);
    background: var(--rn-surface);
    color: var(--rn-muted); cursor: pointer;
    flex-shrink: 0;
  }
  .toolbar-text-btn:hover { color: var(--rn-text); border-color: var(--rn-accent); }
  .toolbar-text-btn.hidden { display: none; }
  .diff-card {
    border: 1px solid var(--rn-accent);
    border-radius: var(--rn-radius);
    padding: 10px 12px; margin: 8px 0;
    background: var(--rn-accent-soft);
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    font-size: 12px;
  }
  .diff-card .diff-file { flex: 1; font-weight: 500; min-width: 120px; }
  .diff-card button {
    padding: 4px 10px; border-radius: var(--rn-radius-sm);
    border: 1px solid var(--rn-border); cursor: pointer;
    font-size: 11px; font-weight: 600;
  }
  .diff-card .accept { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; }
  .diff-card .reject { background: transparent; color: var(--rn-muted); }
  .chip {
    font-size: 11px; padding: 3px 8px 3px 10px;
    border-radius: 20px;
    background: var(--rn-accent-soft);
    border: 1px solid var(--rn-border);
    color: var(--rn-text);
    display: inline-flex; align-items: center; gap: 6px;
    cursor: pointer; max-width: 200px;
    transition: border-color 0.15s;
  }
  .chip:hover { border-color: var(--rn-accent); }
  .chip .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chip .x {
    opacity: 0.6; font-size: 14px; line-height: 1;
    padding: 0 2px; border-radius: 4px;
  }
  .chip .x:hover { opacity: 1; background: rgba(255,255,255,0.1); }

  /* —— Mentions (above composer input) —— */
  #mention-box {
    display: none;
    margin-bottom: 6px; border: 1px solid var(--rn-border);
    border-radius: var(--rn-radius);
    background: var(--rn-surface-2);
    max-height: 180px; overflow-y: auto;
    box-shadow: 0 8px 24px rgba(0,0,0,0.35);
  }
  #mention-box.visible { display: block; }
  .mention-item {
    padding: 8px 12px; cursor: pointer;
    border-bottom: 1px solid var(--rn-border);
    display: flex; flex-direction: column; gap: 2px;
  }
  .mention-item:last-child { border-bottom: none; }
  .mention-item:hover, .mention-item.active {
    background: var(--vscode-list-activeSelectionBackground, var(--rn-accent-soft));
  }
  .mention-item .name { font-weight: 500; font-size: 12px; }
  .mention-item .desc { font-size: 10px; color: var(--rn-muted); }

  /* —— Thread —— */
  #thread {
    flex: 1 1 0; min-height: 0;
    overflow-y: auto; overflow-x: hidden;
    padding: 16px 12px 12px;
    display: flex; flex-direction: column; gap: 16px;
    scroll-behavior: smooth;
  }
  .empty-state {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    text-align: center; padding: 24px 16px; gap: 8px;
    color: var(--rn-muted);
  }
  .empty-state h2 {
    margin: 0; font-size: 15px; font-weight: 600; color: var(--rn-text);
  }
  .empty-state p { margin: 0; font-size: 12px; max-width: 260px; line-height: 1.5; }
  .kbd {
    display: inline-block; padding: 2px 6px; border-radius: 4px;
    background: var(--rn-surface-2); border: 1px solid var(--rn-border);
    font-size: 10px; font-family: inherit;
  }

  .bubble-user {
    align-self: flex-end; max-width: 88%;
    background: linear-gradient(135deg, var(--rn-accent-soft), transparent);
    border: 1px solid var(--rn-border);
    border-right: 2px solid var(--rn-accent);
    border-radius: var(--rn-radius) var(--rn-radius) 4px var(--rn-radius);
    padding: 10px 14px;
    white-space: pre-wrap; word-break: break-word;
    font-size: 13px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  }
  .bubble-assistant { align-self: stretch; width: 100%; }
  .assistant-text {
    padding: 2px 4px; white-space: pre-wrap; word-break: break-word;
    font-size: 13px; line-height: 1.6;
  }
  .assistant-text code {
    font-family: var(--vscode-editor-font-family, ui-monospace, monospace);
    background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.2));
    padding: 2px 5px; border-radius: 4px; font-size: 12px;
  }
  .assistant-text .md-p { margin: 0 0 10px; }
  .assistant-text .md-p:last-child { margin-bottom: 0; }
  .assistant-text pre.code-block {
    margin: 10px 0;
    padding: 10px 12px;
    border-radius: var(--rn-radius-sm);
    border: 1px solid var(--rn-border);
    background: var(--vscode-terminal-background, #0d0d0d);
    color: var(--vscode-terminal-foreground, #d4d4d4);
    overflow-x: auto;
    font-family: var(--vscode-editor-font-family, ui-monospace, monospace);
    font-size: 11px;
    line-height: 1.45;
    white-space: pre;
    word-break: normal;
  }
  .assistant-text pre.code-block code {
    display: block;
    background: none;
    padding: 0;
    border-radius: 0;
    font-size: inherit;
  }
  .tok-keyword { color: var(--vscode-symbolIcon-keywordForeground, #569cd6); }
  .tok-string { color: var(--vscode-debugTokenExpression-string, #ce9178); }
  .tok-comment { color: var(--vscode-editorLineNumber-activeForeground, #6a9955); font-style: italic; }
  .tok-number { color: var(--vscode-debugTokenExpression-number, #b5cea8); }
  .tok-function { color: var(--vscode-symbolIcon-functionForeground, #dcdcaa); }
  .tok-type { color: var(--vscode-symbolIcon-classForeground, #4ec9b0); }
  .tool-result { margin-top: 8px; font-size: 10px; color: var(--rn-muted); }
  .assistant-text .code-lang {
    display: block;
    font-size: 10px;
    color: var(--rn-muted);
    margin-bottom: 6px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .activity-panel {
    align-self: stretch;
    border: 1px solid var(--rn-border);
    border-radius: var(--rn-radius);
    background: var(--rn-surface-2);
    margin: 4px 0 12px;
    overflow: hidden;
  }
  .activity-panel.done { opacity: 0.92; }
  .activity-header {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--rn-border);
    font-size: 11px; font-weight: 600;
    color: var(--rn-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .activity-header .spinner { width: 10px; height: 10px; }
  .activity-steps { padding: 6px 0; }
  .activity-step {
    display: flex; gap: 10px; align-items: flex-start;
    padding: 7px 12px;
    font-size: 12px;
    border-left: 2px solid transparent;
  }
  .activity-step.active { border-left-color: var(--rn-accent); background: var(--rn-accent-soft); }
  .activity-step.done { border-left-color: color-mix(in srgb, var(--rn-accent) 40%, transparent); }
  .activity-step.error { border-left-color: #f87171; }
  .activity-step-icon {
    width: 20px; height: 20px; border-radius: 4px;
    display: flex; align-items: center; justify-content: center;
    font-size: 10px; flex-shrink: 0; font-weight: 700;
  }
  .activity-step-icon.think { background: #3d2a38; color: #f9a8d4; }
  .activity-step-icon.plan { background: #2e2a5c; color: #c4b5fd; }
  .activity-step-icon.explore { background: #1e3a5f; color: #93c5fd; }
  .activity-step-icon.edit { background: #3d3420; color: #fcd34d; }
  .activity-step-icon.run { background: #1a3d1a; color: #86efac; }
  .activity-step-icon.search { background: #3d3420; color: #fcd34d; }
  .activity-step-body { flex: 1; min-width: 0; }
  .activity-step-label { font-weight: 500; color: var(--rn-text); line-height: 1.4; }
  .activity-step-detail {
    font-size: 11px; color: var(--rn-muted);
    margin-top: 2px; line-height: 1.4;
    word-break: break-word;
  }
  .activity-thought {
    margin: 0 12px 8px;
    padding: 8px 10px;
    border-radius: var(--rn-radius-sm);
    background: var(--rn-surface);
    border: 1px solid var(--rn-border);
    font-size: 11px; line-height: 1.5;
    color: var(--rn-muted);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 120px;
    overflow-y: auto;
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.35; transform: scale(0.85); }
    50% { opacity: 1; transform: scale(1); }
  }

  .tool-card {
    border: 1px solid var(--rn-border);
    border-radius: var(--rn-radius);
    margin: 8px 0; overflow: hidden;
    background: var(--rn-surface-2);
    transition: border-color 0.2s;
  }
  .tool-card.running { border-color: var(--rn-accent); box-shadow: 0 0 0 1px var(--rn-accent-soft); }
  .tool-header {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 12px; cursor: pointer; user-select: none;
    font-size: 12px;
  }
  .tool-header:hover { background: var(--rn-accent-soft); }
  .tool-icon {
    width: 22px; height: 22px; border-radius: var(--rn-radius-sm);
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; flex-shrink: 0; font-weight: 600;
  }
  .tool-icon.terminal { background: #1a3d1a; color: #86efac; }
  .tool-icon.edit { background: #2e2a5c; color: #c4b5fd; }
  .tool-icon.read { background: #1e3a5f; color: #93c5fd; }
  .tool-icon.search { background: #3d3420; color: #fcd34d; }
  .tool-icon.think { background: #3d2a38; color: #f9a8d4; }
  .tool-title { flex: 1; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tool-status { font-size: 10px; color: var(--rn-muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .tool-status.running { color: var(--rn-accent); }
  .tool-body {
    display: none; padding: 10px 12px;
    border-top: 1px solid var(--rn-border);
    font-family: var(--vscode-editor-font-family, ui-monospace, monospace);
    font-size: 11px; line-height: 1.45;
    max-height: 180px; overflow: auto;
    white-space: pre-wrap; word-break: break-all;
    background: var(--vscode-terminal-background, #0d0d0d);
    color: var(--vscode-terminal-foreground, #d4d4d4);
  }
  .tool-card.expanded .tool-body { display: block; }

  /* —— Composer (bottom: mode, @, stop, send) —— */
  .composer {
    flex-shrink: 0;
    min-width: 0;
    padding: 8px 12px 10px;
    background: var(--rn-surface-2);
    border-top: 1px solid var(--rn-border);
    box-shadow: var(--rn-shadow);
  }
  .composer-status-row {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    min-height: 22px;
    margin-bottom: 6px;
  }
  .composer-status-row.work-active {
    justify-content: space-between;
  }
  .ai-status {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px 3px 6px;
    border-radius: 20px;
    border: 1px solid var(--rn-border);
    background: var(--rn-surface);
    font-size: 10px;
    font-weight: 600;
    color: var(--rn-muted);
    cursor: pointer;
    line-height: 1;
    flex-shrink: 0;
    transition: border-color 0.15s, background 0.15s;
  }
  .ai-status:hover { border-color: var(--rn-accent); background: var(--rn-accent-soft); }
  .ai-status.online { color: #4ade80; border-color: color-mix(in srgb, #4ade80 35%, var(--rn-border)); }
  .ai-status.offline { color: #f87171; border-color: color-mix(in srgb, #f87171 35%, var(--rn-border)); }
  .ai-status.checking { color: var(--rn-muted); }
  .ai-status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    flex-shrink: 0;
  }
  .ai-status.checking .ai-status-dot { animation: pulse 1s ease-in-out infinite; }
  #status {
    flex: 1;
    min-width: 0;
    font-size: 11px;
    color: var(--rn-muted);
    display: flex;
    align-items: center;
    gap: 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  #status:empty { display: none; }
  .composer-box {
    display: flex; flex-direction: column; gap: 0;
    border: 1px solid var(--rn-border);
    border-radius: var(--rn-radius);
    background: var(--rn-surface);
    overflow: visible;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .composer-box:focus-within {
    border-color: var(--rn-accent);
    box-shadow: 0 0 0 1px var(--rn-accent-soft);
  }
  .composer-input-wrap {
    padding: 10px 12px 4px;
  }
  #input {
    width: 100%; min-height: 40px; max-height: 140px;
    resize: none; border: none; background: transparent;
    color: var(--rn-text); font-family: inherit;
    font-size: 13px; line-height: 1.5; outline: none;
    padding: 0;
  }
  #input::placeholder {
    color: var(--rn-muted);
    opacity: 1;
  }
  .composer-toolbar {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 8px 8px;
    border-top: 1px solid var(--rn-border);
    background: color-mix(in srgb, var(--rn-surface-2) 40%, var(--rn-surface));
    min-width: 0;
  }
  .toolbar-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    width: 100%;
  }
  .toolbar-row-models {
    flex-wrap: wrap;
  }
  .toolbar-row-actions {
    flex-wrap: nowrap;
    gap: 4px;
  }
  .toolbar-scroll {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1 1 auto;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: thin;
    padding-bottom: 1px;
  }
  .toolbar-scroll::-webkit-scrollbar { height: 4px; }
  .toolbar-end {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    margin-left: auto;
  }
  .mode-select {
    font-size: 11px; font-weight: 500;
    padding: 5px 6px; border-radius: var(--rn-radius-sm);
    border: 1px solid var(--rn-border);
    background: var(--rn-surface);
    color: var(--rn-text); cursor: pointer;
    outline: none;
    flex-shrink: 0;
    min-width: 0;
    max-width: 100%;
  }
  .mode-select:hover { border-color: var(--rn-accent); }
  .toolbar-row-models .mode-select { flex: 1 1 56px; }
  .model-select {
    flex: 2 1 72px;
    min-width: 0;
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
  }
  .provider-select {
    flex: 1 1 64px;
    max-width: 96px;
  }
  .icon-btn {
    width: 28px; height: 28px; border-radius: var(--rn-radius-sm);
    border: 1px solid var(--rn-border);
    background: var(--rn-surface);
    color: var(--rn-muted); cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-size: 13px; font-weight: 600;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
    flex-shrink: 0;
  }
  .icon-btn:hover { background: var(--rn-accent-soft); color: var(--rn-text); border-color: var(--rn-accent); }
  .icon-btn.danger { color: #f87171; border-color: color-mix(in srgb, #f87171 40%, var(--rn-border)); }
  .icon-btn.danger:hover { background: color-mix(in srgb, #f87171 15%, transparent); border-color: #f87171; }
  .icon-btn.hidden { display: none; }
  #send-btn {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 6px 12px; border-radius: var(--rn-radius-sm);
    flex-shrink: 0;
    border: none; cursor: pointer;
    background: var(--vscode-button-background, var(--rn-accent));
    color: var(--vscode-button-foreground, #fff);
    font-size: 12px; font-weight: 600;
    transition: opacity 0.15s, transform 0.1s;
  }
  #send-btn:hover:not(:disabled) { filter: brightness(1.08); }
  #send-btn:active:not(:disabled) { transform: scale(0.98); }
  #send-btn:disabled { opacity: 0.45; cursor: not-allowed; }
  #send-btn.hidden { display: none; }
  .spinner {
    width: 12px; height: 12px; border: 2px solid var(--rn-border);
    border-top-color: var(--rn-accent); border-radius: 50%;
    animation: spin 0.65s linear infinite; flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  <header class="chat-header">
    <div class="chat-header-main">
      <span id="session-title" class="session-title">New Chat</span>
    </div>
    <div class="chat-header-actions">
      <button type="button" id="history-btn" class="header-icon-btn" title="Chat history" aria-label="Chat history">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm7.5-.5v4l3.25 1.9.75-1.28L9.5 9.27V7.5H7.5z"/></svg>
      </button>
      <button type="button" id="new-chat-btn" class="header-icon-btn" title="New chat" aria-label="New chat">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5a.75.75 0 0 1 .75.75V7h3.75a.75.75 0 0 1 0 1.5H8.75v3.75a.75.75 0 0 1-1.5 0V8.5H3.5a.75.75 0 0 1 0-1.5h3.75V3.25A.75.75 0 0 1 8 2.5z"/></svg>
      </button>
    </div>
  </header>
  <div class="chat-shell">
    <div id="history-panel" class="history-panel hidden" role="dialog" aria-label="Chat history">
      <div class="history-panel-head">
        <span>Previous chats</span>
        <button type="button" id="history-close" class="header-icon-btn" title="Close" aria-label="Close">×</button>
      </div>
      <div id="history-list" class="history-list"></div>
    </div>
    <div id="thread">
    <div class="empty-state" id="empty">
      <h2>What can I help you build?</h2>
    </div>
    </div>
  </div>
  <div class="composer">
    <div id="targets"></div>
    <div id="chips"></div>
    <div id="mention-box"></div>
    <div class="composer-status-row" id="composer-status-row">
      <div id="status"></div>
      <button type="button" id="ai-status" class="ai-status checking" title="Checking AI service…">
        <span class="ai-status-dot"></span>
        <span class="ai-status-label">…</span>
      </button>
    </div>
    <div class="composer-box">
      <div class="composer-input-wrap">
        <textarea id="input" rows="2" placeholder="Ask Rubynod… (@ files · Enter send · Shift+Enter new line)"></textarea>
      </div>
      <div class="composer-toolbar">
        <div class="toolbar-row toolbar-row-models">
          <select id="mode" class="mode-select" title="Mode">
            <option value="agent"${defaultMode === 'agent' ? ' selected' : ''}>Agent</option>
            <option value="plan"${defaultMode === 'plan' ? ' selected' : ''}>Plan</option>
            <option value="ask"${defaultMode === 'ask' ? ' selected' : ''}>Ask</option>
            <option value="debug"${defaultMode === 'debug' ? ' selected' : ''}>Debug</option>
          </select>
          <select id="provider" class="mode-select provider-select" title="Provider">
            <option value="ollama">Ollama</option>
          </select>
          <select id="model" class="mode-select model-select" title="Model for this message">
            <option value="">Model…</option>
          </select>
        </div>
        <div class="toolbar-row toolbar-row-actions">
          <div class="toolbar-scroll">
            <button type="button" class="icon-btn" id="ctx-btn" title="Add context (@)">@</button>
            <button type="button" class="toolbar-text-btn" id="tabs-btn" title="Add open editor tabs">Tabs</button>
            <button type="button" class="toolbar-text-btn" id="checkpoint-btn" title="Save checkpoint">Save</button>
            <button type="button" class="toolbar-text-btn hidden" id="accept-all-btn" title="Accept all">Accept</button>
            <button type="button" class="toolbar-text-btn hidden" id="reject-all-btn" title="Reject all">Reject</button>
          </div>
          <div class="toolbar-end">
            <button type="button" class="icon-btn danger hidden" id="stop-btn" title="Stop">■</button>
            <button type="button" id="send-btn">Send</button>
          </div>
        </div>
      </div>
    </div>
  </div>
<script nonce="${nonce}">
(function() {
  const vscode = acquireVsCodeApi();
  const thread = document.getElementById('thread');
  const emptyEl = document.getElementById('empty');
  const input = document.getElementById('input');
  const statusEl = document.getElementById('status');
  const composerStatusRow = document.getElementById('composer-status-row');
  const sendBtn = document.getElementById('send-btn');
  const stopBtn = document.getElementById('stop-btn');
  const chips = document.getElementById('chips');
  const targets = document.getElementById('targets');
  const mentionBox = document.getElementById('mention-box');
  const acceptAllBtn = document.getElementById('accept-all-btn');
  const rejectAllBtn = document.getElementById('reject-all-btn');
  const aiStatusBtn = document.getElementById('ai-status');
  const modelSelect = document.getElementById('model');
  const providerSelect = document.getElementById('provider');
  const sessionTitleEl = document.getElementById('session-title');
  const historyBtn = document.getElementById('history-btn');
  const newChatBtn = document.getElementById('new-chat-btn');
  const historyPanel = document.getElementById('history-panel');
  const historyList = document.getElementById('history-list');
  const historyClose = document.getElementById('history-close');
  let chatSessions = [];

  function formatSessionTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (sameDay) return 'Today · ' + time;
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday · ' + time;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' · ' + time;
  }

  function setSessionTitle(title) {
    if (sessionTitleEl) sessionTitleEl.textContent = title || 'New Chat';
  }

  function renderSessions(sessions, activeId) {
    chatSessions = sessions || [];
    const active = chatSessions.find(s => s.id === activeId) || chatSessions.find(s => s.active);
    setSessionTitle(active ? active.title : 'New Chat');
    if (!historyList) return;
    if (!chatSessions.length) {
      historyList.innerHTML = '<div class="history-empty">No previous chats yet</div>';
      return;
    }
    historyList.innerHTML = chatSessions.map(s => {
      const meta = (s.preview && s.preview !== s.title ? s.preview : '') || formatSessionTime(s.updatedAt);
      return '<div class="history-item' + (s.id === activeId || s.active ? ' active' : '') + '" data-id="' + escapeHtml(s.id) + '">' +
        '<div class="history-item-body">' +
        '<div class="history-item-title">' + escapeHtml(s.title || 'New Chat') + '</div>' +
        '<div class="history-item-meta">' + escapeHtml(meta) + '</div>' +
        '</div>' +
        '<button type="button" class="history-item-delete" data-id="' + escapeHtml(s.id) + '" title="Delete chat" aria-label="Delete">×</button>' +
        '</div>';
    }).join('');
    historyList.querySelectorAll('.history-item').forEach(row => {
      row.onclick = (e) => {
        if (e.target.classList.contains('history-item-delete')) return;
        const id = row.dataset.id;
        if (!id) return;
        closeHistoryPanel();
        vscode.postMessage({ type: 'selectSession', sessionId: id });
      };
    });
    historyList.querySelectorAll('.history-item-delete').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (!id) return;
        vscode.postMessage({ type: 'deleteSession', sessionId: id });
      };
    });
  }

  function openHistoryPanel() {
    if (!historyPanel) return;
    historyPanel.classList.remove('hidden');
    historyBtn && historyBtn.classList.add('active');
    vscode.postMessage({ type: 'listSessions' });
  }

  function closeHistoryPanel() {
    if (!historyPanel) return;
    historyPanel.classList.add('hidden');
    historyBtn && historyBtn.classList.remove('active');
  }

  function toggleHistoryPanel() {
    if (historyPanel && !historyPanel.classList.contains('hidden')) closeHistoryPanel();
    else openHistoryPanel();
  }

  if (historyBtn) historyBtn.onclick = toggleHistoryPanel;
  if (historyClose) historyClose.onclick = closeHistoryPanel;
  if (newChatBtn) newChatBtn.onclick = () => {
    closeHistoryPanel();
    vscode.postMessage({ type: 'newChat' });
  };
  document.addEventListener('click', (e) => {
    if (!historyPanel || historyPanel.classList.contains('hidden')) return;
    const t = e.target;
    if (historyPanel.contains(t) || (historyBtn && historyBtn.contains(t))) return;
    closeHistoryPanel();
  });

  function fillChatModels(data) {
    const models = data.models || [];
    const current = data.current || '';
    const provider = data.provider || 'ollama';
    const showPicker = data.showPicker !== false && models.length > 0;
    const saved = vscode.getState() || {};

    if (providerSelect && data.providers && data.providers.length) {
      providerSelect.innerHTML = '';
      data.providers.forEach(function(p) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.label;
        if (p.id === (saved.lastProvider || provider)) opt.selected = true;
        providerSelect.appendChild(opt);
      });
      providerSelect.style.display = '';
    }

    if (!modelSelect) return;
    const pickModel =
      saved.lastProvider === provider && saved.lastModel && models.indexOf(saved.lastModel) >= 0
        ? saved.lastModel
        : current;
    modelSelect.innerHTML = '';
    if (!showPicker) {
      modelSelect.style.display = 'none';
      return;
    }
    modelSelect.style.display = '';
    models.forEach(function(name) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === pickModel) opt.selected = true;
      modelSelect.appendChild(opt);
    });
  }

  function syncModelChoice() {
    const m = modelSelect && modelSelect.value;
    const p = providerSelect && providerSelect.value;
    if (!m || !p) return;
    const prev = vscode.getState() || {};
    vscode.setState({ ...prev, lastModel: m, lastProvider: p });
    vscode.postMessage({ type: 'setModel', model: m, provider: p });
  }

  if (providerSelect) {
    providerSelect.addEventListener('change', function() {
      const p = providerSelect.value;
      const prev = vscode.getState() || {};
      vscode.setState({ ...prev, lastProvider: p });
      vscode.postMessage({ type: 'listModels', provider: p });
    });
  }
  if (modelSelect) {
    modelSelect.addEventListener('change', syncModelChoice);
  }

  vscode.postMessage({ type: 'listModels' });

  function setAiStatus(online, checking) {
    if (!aiStatusBtn) return;
    aiStatusBtn.className = 'ai-status ' + (checking ? 'checking' : online ? 'online' : 'offline');
    const label = aiStatusBtn.querySelector('.ai-status-label');
    if (label) label.textContent = checking ? '…' : online ? 'Online' : 'Offline';
    aiStatusBtn.title = checking
      ? 'Checking AI service…'
      : online
        ? 'AI service connected (127.0.0.1:3847)'
        : 'AI offline — click to start service';
  }
  if (aiStatusBtn) {
    aiStatusBtn.onclick = () => vscode.postMessage({ type: 'startAiService' });
  }

  let mentionActive = -1;
  let mentionItems = [];
  let state = {
    running: false,
    assistantEl: null,
    assistantMarkdown: '',
    activityPanel: null,
    activitySteps: {},
    toolCards: {},
    toolArgs: {},
  };

  function stripLineNumbers(text) {
    if (!text) return '';
    return String(text).split('\\n').map(function(line) {
      var m = line.match(/^\\d+\\|(.*)$/);
      return m ? m[1] : line;
    }).join('\\n');
  }

  function writeFileContents(args) {
    if (!args) return '';
    return args.contents || args.content || args.body || args.text || args.code || '';
  }

  function langFromPath(filePath) {
    const ext = String(filePath || '').split('.').pop().toLowerCase();
    const map = { ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', py: 'python', rs: 'rust', go: 'go', java: 'java', json: 'json', md: 'markdown', sh: 'bash', yml: 'yaml', yaml: 'yaml' };
    return map[ext] || ext || 'code';
  }

  function toolBodyCodeHtml(text, filePath) {
    const clean = stripLineNumbers(text);
    if (!clean.trim()) return escapeHtml(text || '');
    const lang = langFromPath(filePath);
    return '<pre class="code-block" style="margin:0"><code>' + highlightCode(clean.slice(0, 4000), lang) + '</code></pre>';
  }

  function toolBodyWriteHtml(args) {
    const text = writeFileContents(args);
    if (!text) return '';
    return toolBodyCodeHtml(text, args.path);
  }

  const stepIcons = { think: '◆', plan: '◇', explore: '↳', edit: '✎', run: '$_', search: '⌕' };

  function hideEmpty() {
    if (emptyEl && emptyEl.parentNode) emptyEl.remove();
  }

  function getAtQuery() {
    const val = input.value;
    const pos = input.selectionStart ?? val.length;
    const before = val.slice(0, pos);
    const m = before.match(/@([^\\s@]*)$/);
    return m ? m[1] : null;
  }

  function hideMentions() {
    mentionBox.classList.remove('visible');
    mentionBox.innerHTML = '';
    mentionItems = [];
    mentionActive = -1;
  }

  function showMentions(list) {
    mentionItems = list;
    mentionActive = list.length ? 0 : -1;
    if (!list.length) { hideMentions(); return; }
    mentionBox.innerHTML = list.map((it, i) => {
      const icon = it.kind === 'folder' ? '📁' : it.kind === 'symbol' ? '◇' : '📄';
      return '<div class="mention-item' + (i === 0 ? ' active' : '') + '" data-i="' + i + '">' +
        '<span class="name">' + icon + ' ' + escapeHtml(it.label) + '</span>' +
        (it.description ? '<span class="desc">' + escapeHtml(it.description) + '</span>' : '') +
        '</div>';
    }).join('');
    mentionBox.classList.add('visible');
    mentionBox.querySelectorAll('.mention-item').forEach(el => {
      el.onclick = () => pickMention(parseInt(el.dataset.i, 10));
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function highlightCode(code, lang) {
    let s = escapeHtml(stripLineNumbers(code));
    s = s.replace(/\\/\\*[\\s\\S]*?\\*\\//g, function(m) { return '<span class="tok-comment">' + m + '</span>'; });
    s = s.replace(/(^|[\\s;{}])(\\/\\/[^\\n]*)/g, function(_, pre, cm) { return pre + '<span class="tok-comment">' + cm + '</span>'; });
    s = s.replace(/&quot;(?:[^&]|&(?!quot;))*&quot;/g, function(m) { return '<span class="tok-string">' + m + '</span>'; });
    s = s.replace(/&#39;(?:[^&]|&(?!#39;))*&#39;/g, function(m) { return '<span class="tok-string">' + m + '</span>'; });
    s = s.replace(new RegExp(String.fromCharCode(96) + '[^' + String.fromCharCode(96) + ']*' + String.fromCharCode(96), 'g'), function(m) { return '<span class="tok-string">' + m + '</span>'; });
    s = s.replace(/\\b([A-Za-z_][\\w]*)\\s*(?=\\()/g, '<span class="tok-function">$1</span>');
    s = s.replace(/\\b(?:const|let|var|function|return|if|else|elif|for|while|do|switch|case|break|continue|class|extends|import|export|from|as|async|await|try|catch|finally|throw|new|typeof|instanceof|interface|type|enum|implements|public|private|protected|static|void|int|float|double|bool|boolean|string|number|any|unknown|never|null|undefined|true|false|def|print|lambda|pass|raise|yield|with|package|func|struct|impl|use|pub|fn|mut|match|loop|crate|mod|super|trait|where)\\b/g, '<span class="tok-keyword">$&</span>');
    s = s.replace(/\\b([A-Z][A-Za-z0-9_]*)\\b/g, '<span class="tok-type">$1</span>');
    s = s.replace(/\\b(\\d+\\.?\\d*)\\b/g, '<span class="tok-number">$1</span>');
    return s;
  }

  function renderInlineMarkdown(text) {
    if (!text) return '';
    let s = escapeHtml(text);
    s = s.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
    s = s.replace(new RegExp(String.fromCharCode(96) + '([^' + String.fromCharCode(96) + '\\\\n]+)' + String.fromCharCode(96), 'g'), '<code>$1</code>');
    s = s.replace(/\\n/g, '<br>');
    return '<p class="md-p">' + s + '</p>';
  }

  function renderAssistantMarkdown(el, raw) {
    const fence = String.fromCharCode(96, 96, 96);
    const parts = String(raw).split(fence);
    let html = '';
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        let chunk = parts[i];
        let lang = '';
        const nl = chunk.indexOf('\\n');
        if (nl > 0) {
          const maybeLang = chunk.slice(0, nl).trim();
          if (/^[a-zA-Z0-9#+._-]+$/.test(maybeLang)) {
            lang = maybeLang;
            chunk = chunk.slice(nl + 1);
          }
        }
        const code = chunk.replace(/\\n$/, '');
        html += '<pre class="code-block">';
        if (lang) html += '<span class="code-lang">' + escapeHtml(lang) + '</span>';
        html += '<code>' + highlightCode(code, lang) + '</code></pre>';
      } else if (parts[i]) {
        html += renderInlineMarkdown(parts[i]);
      }
    }
    el.innerHTML = html || '<p class="md-p"></p>';
  }

  function pickMention(idx) {
    const it = mentionItems[idx];
    if (!it) return;
    const val = input.value;
    const pos = input.selectionStart ?? val.length;
    const before = val.slice(0, pos);
    const after = val.slice(pos);
    const insert = it.kind === 'folder' ? '@folder:' + it.path + ' ' : '@' + it.path + ' ';
    input.value = before.replace(/@([^\\s@]*)$/, insert) + after;
    hideMentions();
    input.focus();
    vscode.postMessage({ type: 'pickMention', query: it.kind === 'folder' ? 'folder:' + it.path : it.path });
  }

  function highlightMention() {
    mentionBox.querySelectorAll('.mention-item').forEach((el, i) => {
      el.classList.toggle('active', i === mentionActive);
    });
  }

  input.addEventListener('input', () => {
    const q = getAtQuery();
    if (q !== null) vscode.postMessage({ type: 'atQuery', query: q });
    else hideMentions();
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  });

  input.addEventListener('keydown', e => {
    if (mentionBox.classList.contains('visible')) {
      if (e.key === 'ArrowDown') { e.preventDefault(); mentionActive = Math.min(mentionActive + 1, mentionItems.length - 1); highlightMention(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); mentionActive = Math.max(mentionActive - 1, 0); highlightMention(); return; }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (mentionActive >= 0) pickMention(mentionActive); return; }
      if (e.key === 'Escape') { e.preventDefault(); hideMentions(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  function toolKind(name) {
    if (name === 'run_terminal' || name === 'Shell') return 'terminal';
    if (name === 'write_file' || name === 'search_replace') return 'edit';
    if (name === 'grep' || name === 'glob' || name === 'codebase_search') return 'search';
    if (name === 'read_file' || name === 'list_dir' || name === 'read_lints') return 'read';
    return 'think';
  }

  function toolLabel(name, args) {
    args = args || {};
    if (name === 'run_terminal' || name === 'Shell') return args.command || 'Terminal';
    if (name === 'write_file') return 'Write ' + (args.path || 'file');
    if (name === 'search_replace') return 'Edit ' + (args.path || 'file');
    if (name === 'read_file') return 'Read ' + (args.path || 'file');
    if (name === 'grep') return 'Grep: ' + (args.pattern || '');
    if (name === 'glob') return 'Glob: ' + (args.pattern || '');
    if (name === 'codebase_search') return 'Search: ' + (args.query || '');
    return name;
  }

  function iconChar(kind) {
    return { terminal: '$_', edit: '✎', read: '↳', search: '⌕', think: '◆' }[kind] || '◆';
  }

  function setStatus(text, running) {
    statusEl.innerHTML = running
      ? '<span class="spinner"></span><span>' + escapeHtml(text) + '</span>'
      : (text ? escapeHtml(text) : '');
    if (composerStatusRow) composerStatusRow.classList.toggle('work-active', !!running || !!text);
    sendBtn.disabled = running;
    stopBtn.classList.toggle('hidden', !running);
    sendBtn.classList.toggle('hidden', running);
    state.running = running;
  }

  function ensureActivityPanel() {
    if (state.activityPanel) return state.activityPanel;
    hideEmpty();
    const panel = document.createElement('div');
    panel.className = 'activity-panel';
    panel.innerHTML =
      '<div class="activity-header"><span class="spinner"></span><span>Working</span></div>' +
      '<div class="activity-steps"></div>';
    state.activityPanel = panel;
    state.activitySteps = {};
    thread.appendChild(panel);
    scroll();
    return panel;
  }

  function finishActivityPanel() {
    if (!state.activityPanel) return;
    state.activityPanel.classList.add('done');
    const header = state.activityPanel.querySelector('.activity-header span:last-child');
    if (header) header.textContent = 'Done';
    const spin = state.activityPanel.querySelector('.activity-header .spinner');
    if (spin) spin.remove();
  }

  function upsertActivityStep(id, step, label, detail, status) {
    const panel = ensureActivityPanel();
    const stepsEl = panel.querySelector('.activity-steps');
    let row = state.activitySteps[id];
    const iconClass = step || 'think';
    const icon = stepIcons[iconClass] || stepIcons.think;
    if (!row) {
      row = document.createElement('div');
      row.className = 'activity-step';
      row.dataset.id = id;
      row.innerHTML =
        '<span class="activity-step-icon ' + iconClass + '">' + icon + '</span>' +
        '<div class="activity-step-body">' +
          '<div class="activity-step-label"></div>' +
          '<div class="activity-step-detail"></div>' +
        '</div>';
      stepsEl.appendChild(row);
      state.activitySteps[id] = row;
    }
    row.className = 'activity-step ' + (status || 'active');
    row.querySelector('.activity-step-label').textContent = label || '';
    const detailEl = row.querySelector('.activity-step-detail');
    if (detail) {
      detailEl.textContent = detail;
      detailEl.style.display = 'block';
    } else if (status === 'active') {
      detailEl.textContent = '';
      detailEl.style.display = 'none';
    }
    scroll();
  }

  function addThought(text) {
    if (!text || !text.trim()) return;
    const panel = ensureActivityPanel();
    let block = panel.querySelector('.activity-thought');
    if (!block) {
      block = document.createElement('div');
      block.className = 'activity-thought';
      panel.insertBefore(block, panel.querySelector('.activity-steps'));
    }
    block.textContent = text.trim();
    scroll();
  }

  function scroll() { thread.scrollTop = thread.scrollHeight; }

  function ensureAssistant() {
    if (!state.assistantEl) {
      hideEmpty();
      const wrap = document.createElement('div');
      wrap.className = 'bubble-assistant';
      const text = document.createElement('div');
      text.className = 'assistant-text';
      wrap.appendChild(text);
      thread.appendChild(wrap);
      state.assistantEl = text;
      state.assistantMarkdown = '';
    }
    return state.assistantEl;
  }

  function appendUser(text) {
    hideEmpty();
    state.assistantEl = null;
    const el = document.createElement('div');
    el.className = 'bubble-user';
    el.textContent = text;
    thread.appendChild(el);
    scroll();
  }

  function appendText(delta) {
    const el = ensureAssistant();
    state.assistantMarkdown += delta;
    renderAssistantMarkdown(el, state.assistantMarkdown);
    scroll();
  }

  function startTool(id, name, args) {
    state.assistantEl = null;
    state.toolArgs[id] = args || {};
    const kind = toolKind(name);
    const card = document.createElement('div');
    card.className = 'tool-card running expanded';
    card.dataset.id = id;
    card.innerHTML =
      '<div class="tool-header">' +
        '<span class="tool-icon ' + kind + '">' + iconChar(kind) + '</span>' +
        '<span class="tool-title">' + escapeHtml(toolLabel(name, args)) + '</span>' +
        '<span class="tool-status running"><span class="spinner"></span></span>' +
      '</div>' +
      '<div class="tool-body"></div>';
    const body = card.querySelector('.tool-body');
    if (name === 'write_file' && writeFileContents(args)) body.innerHTML = toolBodyWriteHtml(args);
    else if (kind === 'terminal' && args && args.command) body.textContent = '$ ' + args.command;
    else if (args && args.path) body.textContent = args.path;
    else if (args) body.textContent = JSON.stringify(args, null, 2).slice(0, 800);
    card.querySelector('.tool-header').onclick = () => card.classList.toggle('expanded');
    thread.appendChild(card);
    state.toolCards[id] = card;
    setStatus(kind === 'terminal' ? 'Running command…' : 'Working…', true);
    scroll();
  }

  function endTool(id, name, result, ok) {
    const card = state.toolCards[id];
    if (!card) return;
    card.classList.remove('running');
    const status = card.querySelector('.tool-status');
    status.className = 'tool-status';
    status.textContent = ok === false ? 'Failed' : 'Done';
    const body = card.querySelector('.tool-body');
    const args = state.toolArgs[id] || {};
    if (name === 'write_file' && writeFileContents(args)) {
      body.innerHTML = toolBodyWriteHtml(args);
      if (result) body.insertAdjacentHTML('beforeend', '<div class="tool-result">' + escapeHtml(String(result)) + '</div>');
    } else if (name === 'read_file' && result && !String(result).startsWith('Error:')) {
      body.innerHTML = toolBodyCodeHtml(String(result), args.path);
    } else if (result) body.textContent = stripLineNumbers(String(result)).slice(0, 4000);
    delete state.toolArgs[id];
    scroll();
  }

  function renderToolHistory(entry) {
    state.assistantEl = null;
    const name = entry.name;
    const args = entry.args || {};
    const ok = entry.ok !== false;
    const kind = toolKind(name);
    const card = document.createElement('div');
    card.className = 'tool-card expanded';
    card.dataset.id = entry.id;
    card.innerHTML =
      '<div class="tool-header">' +
        '<span class="tool-icon ' + kind + '">' + iconChar(kind) + '</span>' +
        '<span class="tool-title">' + escapeHtml(toolLabel(name, args)) + '</span>' +
        '<span class="tool-status">' + (ok ? 'Done' : 'Failed') + '</span>' +
      '</div>' +
      '<div class="tool-body"></div>';
    const body = card.querySelector('.tool-body');
    const result = entry.result || '';
    if (name === 'write_file' && writeFileContents(args)) {
      body.innerHTML = toolBodyWriteHtml(args);
      if (result) body.insertAdjacentHTML('beforeend', '<div class="tool-result">' + escapeHtml(String(result)) + '</div>');
    } else if (name === 'read_file' && result && !String(result).startsWith('Error:')) {
      body.innerHTML = toolBodyCodeHtml(String(result), args.path);
    } else if (result) body.textContent = stripLineNumbers(String(result)).slice(0, 4000);
    else if (kind === 'terminal' && args.command) body.textContent = '$ ' + args.command;
    else if (args.path) body.textContent = args.path;
    else if (Object.keys(args).length) body.textContent = JSON.stringify(args, null, 2).slice(0, 800);
    card.querySelector('.tool-header').onclick = () => card.classList.toggle('expanded');
    thread.appendChild(card);
  }

  function renderHistoryEntry(entry) {
    if (!entry || !entry.kind) return;
    if (entry.kind === 'user') {
      appendUser(entry.text);
      return;
    }
    if (entry.kind === 'assistant') {
      hideEmpty();
      state.assistantEl = null;
      state.assistantMarkdown = '';
      const el = ensureAssistant();
      state.assistantMarkdown = entry.text;
      renderAssistantMarkdown(el, entry.text);
      state.assistantEl = null;
      state.assistantMarkdown = '';
      return;
    }
    if (entry.kind === 'tool') {
      renderToolHistory(entry);
      return;
    }
    if (entry.kind === 'error') {
      hideEmpty();
      state.assistantEl = null;
      const el = ensureAssistant();
      el.textContent = '⚠ ' + (entry.message || 'Error');
      state.assistantEl = null;
    }
  }

  function hydrateHistory(entries) {
    if (!entries || !entries.length) return;
    thread.innerHTML = '';
    state = { running: false, assistantEl: null, assistantMarkdown: '', thinkingEl: null, activityPanel: null, activitySteps: {}, toolCards: {}, toolArgs: {} };
    for (const entry of entries) renderHistoryEntry(entry);
    setStatus('', false);
    scroll();
  }

  function renderTargets(files) {
    targets.innerHTML = (files || []).map(f =>
      '<span class="target-chip" data-file="' + escapeHtml(f) + '">' +
      '<span class="label">✎ ' + escapeHtml(f) + '</span><span class="x">×</span></span>'
    ).join('');
    targets.querySelectorAll('.target-chip .x').forEach(el => {
      el.onclick = (e) => {
        e.stopPropagation();
        const file = el.closest('.target-chip')?.dataset.file;
        if (file) vscode.postMessage({ type: 'removeTarget', file });
      };
    });
  }

  function setPendingDiffs(count) {
    const show = count > 0;
    acceptAllBtn.classList.toggle('hidden', !show);
    rejectAllBtn.classList.toggle('hidden', !show);
  }

  function showDiffCard(file) {
    hideEmpty();
    state.assistantEl = null;
    const card = document.createElement('div');
    card.className = 'diff-card';
    card.dataset.file = file;
    card.innerHTML =
      '<span class="diff-file">📝 ' + escapeHtml(file) + '</span>' +
      '<button type="button" class="accept">Accept</button>' +
      '<button type="button" class="reject">Reject</button>';
    card.querySelector('.accept').onclick = () => vscode.postMessage({ type: 'acceptDiff', file });
    card.querySelector('.reject').onclick = () => vscode.postMessage({ type: 'rejectDiff', file });
    thread.appendChild(card);
    scroll();
  }

  function send() {
    const text = input.value.trim();
    if (!text) return;
    if (state.running) return;
    hideMentions();
    const mode = document.getElementById('mode').value;
    const model = modelSelect && modelSelect.value ? modelSelect.value : undefined;
    const provider = providerSelect && providerSelect.value ? providerSelect.value : undefined;
    appendUser(text);
    input.value = '';
    input.style.height = 'auto';
    setStatus('Sending…', true);
    vscode.postMessage({ type: 'send', text, mode, model, provider });
  }

  document.getElementById('send-btn').onclick = send;
  document.getElementById('ctx-btn').onclick = () => vscode.postMessage({ type: 'addContext' });
  document.getElementById('tabs-btn').onclick = () => vscode.postMessage({ type: 'addOpenFiles' });
  document.getElementById('checkpoint-btn').onclick = () => vscode.postMessage({ type: 'checkpoint' });
  acceptAllBtn.onclick = () => vscode.postMessage({ type: 'acceptAll' });
  rejectAllBtn.onclick = () => vscode.postMessage({ type: 'rejectAll' });
  document.getElementById('stop-btn').onclick = () => vscode.postMessage({ type: 'stop' });

  window.addEventListener('message', e => {
    const m = e.data;
    switch (m.type) {
      case 'runStart':
        state.toolCards = {};
        state.assistantMarkdown = '';
        state.activityPanel = null;
        state.activitySteps = {};
        upsertActivityStep('think-live', 'think', m.label || 'Thinking…', '', 'active');
        setStatus('Agent running…', true);
        break;
      case 'activity':
        upsertActivityStep(m.id, m.step || 'think', m.label, m.detail, m.status || 'active');
        setStatus(m.label || 'Working…', true);
        break;
      case 'thought':
        addThought(m.text);
        break;
      case 'user':
        break;
      case 'text':
        appendText(m.text);
        setStatus('Generating…', true);
        break;
      case 'toolStart':
        startTool(m.id, m.name, m.args);
        break;
      case 'toolEnd':
        endTool(m.id, m.name, m.result, m.ok);
        break;
      case 'diff':
        showDiffCard(m.file);
        break;
      case 'diffResolved':
        thread.querySelectorAll('.diff-card[data-file]').forEach(el => {
          if (el.dataset.file === m.file) el.remove();
        });
        break;
      case 'targets':
        renderTargets(m.files || []);
        break;
      case 'aiStatus':
        setAiStatus(!!m.online, !!m.checking);
        if (m.online) vscode.postMessage({ type: 'listModels' });
        break;
      case 'chatModels':
        fillChatModels(m);
        break;
      case 'pendingDiffs':
        setPendingDiffs(m.count || 0);
        break;
      case 'runEnd':
        finishActivityPanel();
        setStatus('', false);
        state.assistantEl = null;
        break;
      case 'error':
        finishActivityPanel();
        ensureAssistant();
        appendText('\\n\\n⚠ ' + (m.message || 'Error'));
        setStatus('', false);
        state.running = false;
        sendBtn.disabled = false;
        stopBtn.classList.add('hidden');
        sendBtn.classList.remove('hidden');
        break;
      case 'atSuggestions':
        showMentions(m.suggestions || []);
        break;
      case 'chips':
        chips.innerHTML = (m.items || []).map(it =>
          '<span class="chip" data-label="' + escapeHtml(it.label||'') + '" data-path="' + escapeHtml(it.path||'') + '" data-line="' + (it.startLine||'') + '">' +
          '<span class="label">' + escapeHtml(it.label) + '</span><span class="x">×</span></span>'
        ).join('');
        chips.querySelectorAll('.chip').forEach(el => {
          el.querySelector('.x').onclick = (e) => { e.stopPropagation(); vscode.postMessage({ type: 'removeChip', label: el.dataset.label }); };
          el.onclick = (e) => {
            if (e.target.classList.contains('x')) return;
            vscode.postMessage({ type: 'openChip', path: el.dataset.path, startLine: el.dataset.line ? parseInt(el.dataset.line,10) : undefined });
          };
        });
        break;
      case 'sessions':
        renderSessions(m.sessions || [], m.activeId);
        break;
      case 'hydrate':
        hydrateHistory(m.entries || []);
        break;
      case 'clear':
        thread.innerHTML = '<div class="empty-state" id="empty"><h2>What can I help you build?</h2></div>';
        setSessionTitle('New Chat');
        state = { running: false, assistantEl: null, assistantMarkdown: '', activityPanel: null, activitySteps: {}, toolCards: {}, toolArgs: {} };
        sendBtn.disabled = false;
        stopBtn.classList.add('hidden');
        sendBtn.classList.remove('hidden');
        break;
    }
  });
})();
</script>
</body>
</html>`;
}
