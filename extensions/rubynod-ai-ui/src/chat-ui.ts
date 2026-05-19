/** Rubynod chat webview — polished Cursor-style UI */
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

  /* —— Header —— */
  .header {
    flex-shrink: 0;
    padding: 10px 12px;
    border-bottom: 1px solid var(--rn-border);
    display: flex; align-items: center; gap: 8px;
    background: var(--rn-surface-2);
  }
  .brand {
    font-weight: 600; font-size: 12px; letter-spacing: 0.02em;
    color: var(--rn-text); margin-right: auto;
  }
  .brand span { color: var(--rn-accent); }
  .pill {
    font-size: 11px; font-weight: 500; padding: 4px 10px;
    border-radius: 20px; border: 1px solid var(--rn-border);
    background: var(--rn-surface);
    color: var(--rn-text); cursor: pointer;
  }
  .pill select {
    border: none; background: transparent; color: inherit;
    font: inherit; cursor: pointer; outline: none;
  }
  .icon-btn {
    width: 28px; height: 28px; border-radius: var(--rn-radius-sm);
    border: 1px solid var(--rn-border);
    background: var(--rn-surface);
    color: var(--rn-muted); cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; transition: background 0.15s, color 0.15s;
  }
  .icon-btn:hover { background: var(--rn-accent-soft); color: var(--rn-text); }
  .icon-btn.danger:hover { color: #f87171; border-color: #f87171; }

  /* —— Chips —— */
  #chips {
    flex-shrink: 0; padding: 6px 12px 0;
    display: flex; flex-wrap: wrap; gap: 6px;
    min-height: 0;
  }
  #chips:empty { display: none; }
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

  /* —— Mentions —— */
  #mention-box {
    display: none; flex-shrink: 0;
    margin: 6px 12px 0; border: 1px solid var(--rn-border);
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
    flex: 1; overflow-y: auto; overflow-x: hidden;
    padding: 16px 12px 8px;
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

  .thinking {
    display: inline-flex; align-items: center; gap: 10px;
    padding: 10px 14px; border-radius: var(--rn-radius);
    background: var(--rn-surface-2);
    border: 1px solid var(--rn-border);
    color: var(--rn-muted); font-size: 12px;
  }
  .thinking .dots { display: flex; gap: 4px; }
  .thinking .dots span {
    width: 5px; height: 5px; border-radius: 50%;
    background: var(--rn-accent);
    animation: pulse 1.2s ease-in-out infinite;
  }
  .thinking .dots span:nth-child(2) { animation-delay: 0.15s; }
  .thinking .dots span:nth-child(3) { animation-delay: 0.3s; }
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

  /* —— Composer —— */
  .composer {
    flex-shrink: 0;
    padding: 10px 12px 12px;
    background: var(--rn-surface-2);
    border-top: 1px solid var(--rn-border);
    box-shadow: var(--rn-shadow);
  }
  #status {
    font-size: 11px; color: var(--rn-muted);
    min-height: 16px; margin-bottom: 8px;
    display: flex; align-items: center; gap: 8px;
  }
  .composer-box {
    display: flex; flex-direction: column; gap: 8px;
    border: 1px solid var(--rn-border);
    border-radius: var(--rn-radius);
    background: var(--rn-surface);
    padding: 8px 8px 8px 12px;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .composer-box:focus-within {
    border-color: var(--rn-accent);
    box-shadow: 0 0 0 1px var(--rn-accent-soft);
  }
  #input {
    width: 100%; min-height: 40px; max-height: 140px;
    resize: none; border: none; background: transparent;
    color: var(--rn-text); font-family: inherit;
    font-size: 13px; line-height: 1.5; outline: none;
    padding: 4px 0;
  }
  #input::placeholder { color: var(--rn-muted); }
  .composer-actions {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
  }
  .hint { font-size: 10px; color: var(--rn-muted); }
  #send-btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 16px; border-radius: var(--rn-radius-sm);
    border: none; cursor: pointer;
    background: var(--vscode-button-background, var(--rn-accent));
    color: var(--vscode-button-foreground, #fff);
    font-size: 12px; font-weight: 600;
    transition: opacity 0.15s, transform 0.1s;
  }
  #send-btn:hover:not(:disabled) { filter: brightness(1.08); }
  #send-btn:active:not(:disabled) { transform: scale(0.98); }
  #send-btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .spinner {
    width: 12px; height: 12px; border: 2px solid var(--rn-border);
    border-top-color: var(--rn-accent); border-radius: 50%;
    animation: spin 0.65s linear infinite; flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  <div class="header">
    <div class="brand">Ruby<span>nod</span></div>
    <div class="pill">
      <select id="mode" title="Mode">
        <option value="agent"${defaultMode === 'agent' ? ' selected' : ''}>Agent</option>
        <option value="plan"${defaultMode === 'plan' ? ' selected' : ''}>Plan</option>
        <option value="ask"${defaultMode === 'ask' ? ' selected' : ''}>Ask</option>
        <option value="debug"${defaultMode === 'debug' ? ' selected' : ''}>Debug</option>
      </select>
    </div>
    <button class="icon-btn" id="ctx-btn" title="Add context (@)">@</button>
    <button class="icon-btn danger" id="stop-btn" title="Stop">■</button>
  </div>
  <div id="chips"></div>
  <div id="mention-box"></div>
  <div id="thread">
    <div class="empty-state" id="empty">
      <h2>What can I help you build?</h2>
      <p>Ask anything about your code. Use <span class="kbd">@file</span> for context. <span class="kbd">Enter</span> to send.</p>
    </div>
  </div>
  <div class="composer">
    <div id="status"></div>
    <div class="composer-box">
      <textarea id="input" rows="2" placeholder="Ask Rubynod…"></textarea>
      <div class="composer-actions">
        <span class="hint"><span class="kbd">Enter</span> send · <span class="kbd">Shift+Enter</span> new line</span>
        <button id="send-btn" type="button">Send ↑</button>
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
  const sendBtn = document.getElementById('send-btn');
  const chips = document.getElementById('chips');
  const mentionBox = document.getElementById('mention-box');

  let mentionActive = -1;
  let mentionItems = [];
  let state = { running: false, assistantEl: null, thinkingEl: null, toolCards: {} };

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
    sendBtn.disabled = running;
    state.running = running;
  }

  function hideThinking() {
    if (state.thinkingEl) { state.thinkingEl.remove(); state.thinkingEl = null; }
  }

  function showThinking(label) {
    hideThinking();
    hideEmpty();
    const el = document.createElement('div');
    el.className = 'thinking';
    el.innerHTML = '<span class="dots"><span></span><span></span><span></span></span><span>' + escapeHtml(label || 'Thinking') + '…</span>';
    state.thinkingEl = el;
    thread.appendChild(el);
    scroll();
  }

  function scroll() { thread.scrollTop = thread.scrollHeight; }

  function ensureAssistant() {
    hideThinking();
    if (!state.assistantEl) {
      hideEmpty();
      const wrap = document.createElement('div');
      wrap.className = 'bubble-assistant';
      const text = document.createElement('div');
      text.className = 'assistant-text';
      wrap.appendChild(text);
      thread.appendChild(wrap);
      state.assistantEl = text;
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
    el.textContent += delta;
    scroll();
  }

  function startTool(id, name, args) {
    hideThinking();
    state.assistantEl = null;
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
    if (kind === 'terminal' && args && args.command) body.textContent = '$ ' + args.command;
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
    if (result) body.textContent = String(result).slice(0, 4000);
    scroll();
  }

  function send() {
    const text = input.value.trim();
    if (!text) return;
    if (state.running) return;
    hideMentions();
    const mode = document.getElementById('mode').value;
    appendUser(text);
    input.value = '';
    input.style.height = 'auto';
    setStatus('Sending…', true);
    vscode.postMessage({ type: 'send', text, mode });
  }

  document.getElementById('send-btn').onclick = send;
  document.getElementById('ctx-btn').onclick = () => vscode.postMessage({ type: 'addContext' });
  document.getElementById('stop-btn').onclick = () => vscode.postMessage({ type: 'stop' });

  window.addEventListener('message', e => {
    const m = e.data;
    switch (m.type) {
      case 'runStart':
        state.toolCards = {};
        showThinking(m.label || 'Thinking');
        setStatus('Agent running…', true);
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
        break;
      case 'runEnd':
        hideThinking();
        setStatus('', false);
        state.assistantEl = null;
        break;
      case 'error':
        hideThinking();
        ensureAssistant();
        appendText('\\n\\n⚠ ' + (m.message || 'Error'));
        setStatus('', false);
        state.running = false;
        sendBtn.disabled = false;
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
      case 'clear':
        thread.innerHTML = '<div class="empty-state" id="empty"><h2>What can I help you build?</h2><p>Ask anything about your code.</p></div>';
        state = { running: false, assistantEl: null, thinkingEl: null, toolCards: {} };
        sendBtn.disabled = false;
        break;
    }
  });
})();
</script>
</body>
</html>`;
}
