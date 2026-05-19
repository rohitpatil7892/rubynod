/** Cursor-style chat webview HTML (thinking, edits, terminal cards). */
export function getChatHtml(defaultMode: string): string {
  const nonce = String(Date.now());
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<style>
  :root {
    --rn-accent: #e74c3c;
    --rn-muted: var(--vscode-descriptionForeground);
    --rn-border: var(--vscode-widget-border, var(--vscode-input-border));
    --rn-card: var(--vscode-editor-inactiveSelectionBackground);
    --rn-user: var(--vscode-input-background);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0;
    font-family: var(--vscode-font-family);
    font-size: 13px; line-height: 1.5;
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    display: flex; flex-direction: column; height: 100vh;
  }
  .header {
    padding: 8px 10px; border-bottom: 1px solid var(--rn-border);
    display: flex; gap: 6px; align-items: center; flex-wrap: wrap;
  }
  .header select, .header button {
    font-size: 12px; padding: 4px 8px; border-radius: 6px;
    border: 1px solid var(--rn-border);
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground); cursor: pointer;
  }
  .header button.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground); border: none;
  }
  .header button.danger { color: var(--rn-accent); }
  #chips { padding: 4px 10px; display: flex; flex-wrap: wrap; gap: 4px; min-height: 24px; }
  .chip {
    font-size: 11px; padding: 2px 8px; border-radius: 10px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground); cursor: pointer;
  }
  #thread {
    flex: 1; overflow-y: auto; padding: 12px 10px;
    display: flex; flex-direction: column; gap: 12px;
  }
  .bubble-user {
    align-self: flex-end; max-width: 92%;
    background: var(--rn-user);
    border: 1px solid var(--rn-border);
    border-radius: 12px 12px 4px 12px;
    padding: 10px 12px; white-space: pre-wrap; word-break: break-word;
  }
  .bubble-assistant {
    align-self: flex-start; max-width: 100%; width: 100%;
  }
  .assistant-text {
    padding: 4px 2px; white-space: pre-wrap; word-break: break-word;
  }
  .assistant-text code {
    font-family: var(--vscode-editor-font-family, monospace);
    background: var(--vscode-textCodeBlock-background);
    padding: 1px 4px; border-radius: 3px; font-size: 12px;
  }
  .thinking {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 10px; color: var(--rn-muted); font-size: 12px;
  }
  .thinking .dots span {
    display: inline-block; width: 4px; height: 4px; border-radius: 50%;
    background: var(--rn-muted); margin: 0 2px;
    animation: bounce 1.2s infinite;
  }
  .thinking .dots span:nth-child(2) { animation-delay: 0.15s; }
  .thinking .dots span:nth-child(3) { animation-delay: 0.3s; }
  @keyframes bounce {
    0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
    40% { transform: translateY(-4px); opacity: 1; }
  }
  .tool-card {
    border: 1px solid var(--rn-border);
    border-radius: 8px; margin: 6px 0; overflow: hidden;
    background: var(--vscode-editor-background);
  }
  .tool-card.running { border-color: var(--rn-accent); }
  .tool-card.done { opacity: 0.95; }
  .tool-header {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 10px; cursor: pointer; user-select: none;
    background: var(--rn-card); font-size: 12px;
  }
  .tool-header:hover { filter: brightness(1.05); }
  .tool-icon {
    width: 18px; height: 18px; border-radius: 4px;
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; flex-shrink: 0;
  }
  .tool-icon.terminal { background: #2d5a27; color: #b8f0b0; }
  .tool-icon.edit { background: #3d3a6b; color: #c4b5fd; }
  .tool-icon.read { background: #2a3f5f; color: #93c5fd; }
  .tool-icon.search { background: #4a3f2a; color: #fcd34d; }
  .tool-icon.think { background: #4a3748; color: #f9a8d4; }
  .tool-title { flex: 1; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tool-status {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em;
    color: var(--rn-muted);
  }
  .tool-status.running { color: var(--rn-accent); }
  .spinner {
    width: 12px; height: 12px; border: 2px solid var(--rn-border);
    border-top-color: var(--rn-accent); border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .tool-body {
    display: none; padding: 8px 10px; border-top: 1px solid var(--rn-border);
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px; max-height: 200px; overflow: auto;
    white-space: pre-wrap; word-break: break-all;
    color: var(--vscode-terminal-ansiBrightWhite, var(--vscode-foreground));
    background: var(--vscode-terminal-background, #1e1e1e);
  }
  .tool-card.expanded .tool-body { display: block; }
  .footer {
    border-top: 1px solid var(--rn-border); padding: 8px 10px;
    display: flex; flex-direction: column; gap: 6px;
  }
  #status {
    font-size: 11px; color: var(--rn-muted); min-height: 14px;
    display: flex; align-items: center; gap: 6px;
  }
  #input-row { display: flex; gap: 8px; align-items: flex-end; }
  #input {
    flex: 1; min-height: 44px; max-height: 120px; resize: vertical;
    padding: 10px 12px; border-radius: 8px;
    border: 1px solid var(--rn-border);
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    font-family: inherit; font-size: 13px;
  }
  #input:focus { outline: 1px solid var(--rn-accent); }
  #send-btn {
    padding: 10px 16px; border-radius: 8px; border: none;
    background: var(--rn-accent); color: #fff;
    font-weight: 600; cursor: pointer; font-size: 12px;
  }
  #send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  #chips { padding: 4px 10px; display: flex; flex-wrap: wrap; gap: 4px; min-height: 8px; }
  .chip {
    font-size: 11px; padding: 3px 8px; border-radius: 10px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    display: inline-flex; align-items: center; gap: 4px; cursor: pointer;
  }
  .chip.file { border-left: 2px solid #93c5fd; }
  .chip.folder { border-left: 2px solid #fcd34d; }
  .chip .x { opacity: 0.7; margin-left: 2px; }
  .chip .x:hover { opacity: 1; color: var(--rn-accent); }
  #mention-box {
    display: none; position: relative; margin: 0 10px;
    border: 1px solid var(--rn-border); border-radius: 8px;
    background: var(--vscode-editor-background);
    max-height: 160px; overflow-y: auto; font-size: 12px;
  }
  #mention-box.visible { display: block; }
  .mention-item {
    padding: 6px 10px; cursor: pointer;
    border-bottom: 1px solid var(--rn-border);
  }
  .mention-item:hover, .mention-item.active { background: var(--vscode-list-hoverBackground); }
  .mention-item .desc { font-size: 10px; color: var(--rn-muted); }
</style>
</head>
<body>
  <div class="header">
    <select id="mode">
      <option value="agent"${defaultMode === 'agent' ? ' selected' : ''}>∞ Agent</option>
      <option value="plan"${defaultMode === 'plan' ? ' selected' : ''}>Plan</option>
      <option value="ask"${defaultMode === 'ask' ? ' selected' : ''}>Ask</option>
      <option value="debug"${defaultMode === 'debug' ? ' selected' : ''}>Debug</option>
    </select>
    <button id="ctx-btn">@</button>
    <button id="stop-btn" class="danger">Stop</button>
  </div>
  <div id="chips"></div>
  <div id="mention-box"></div>
  <div id="thread"></div>
  <div class="footer">
    <div id="status"></div>
    <div id="input-row">
      <textarea id="input" rows="2" placeholder="Ask Rubynod… @file.ts @folder:src/ — Ctrl/Cmd+Enter"></textarea>
      <button id="send-btn">Send</button>
    </div>
  </div>
<script nonce="${nonce}">
(function() {
  const vscode = acquireVsCodeApi();
  const thread = document.getElementById('thread');
  const input = document.getElementById('input');
  const statusEl = document.getElementById('status');
  const sendBtn = document.getElementById('send-btn');
  const chips = document.getElementById('chips');
  const mentionBox = document.getElementById('mention-box');
  let mentionActive = -1;
  let mentionItems = [];

  let state = { running: false, assistantEl: null, thinkingEl: null, toolCards: {} };

  function getAtQuery() {
    const val = input.value;
    const pos = input.selectionStart || val.length;
    const before = val.slice(0, pos);
    const m = before.match(/@([^\s@]*)$/);
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
    mentionActive = 0;
    if (!list.length) { hideMentions(); return; }
    mentionBox.innerHTML = list.map((it, i) =>
      '<div class="mention-item' + (i === 0 ? ' active' : '') + '" data-i="' + i + '">' +
      '<div>' + (it.kind === 'folder' ? '📁 ' : '📄 ') + it.label + '</div>' +
      '<div class="desc">' + (it.description || '') + '</div></div>'
    ).join('');
    mentionBox.classList.add('visible');
    mentionBox.querySelectorAll('.mention-item').forEach(el => {
      el.onclick = () => pickMention(parseInt(el.dataset.i, 10));
    });
  }

  function pickMention(idx) {
    const it = mentionItems[idx];
    if (!it) return;
    const val = input.value;
    const pos = input.selectionStart || val.length;
    const before = val.slice(0, pos);
    const after = val.slice(pos);
    const replaced = before.replace(/@([^\s@]*)$/, it.kind === 'folder' ? '@folder:' + it.path + ' ' : '@' + it.path + ' ');
    input.value = replaced + after;
    hideMentions();
    vscode.postMessage({ type: 'pickMention', query: it.kind === 'folder' ? 'folder:' + it.path : it.path });
  }

  input.addEventListener('input', () => {
    const q = getAtQuery();
    if (q !== null) vscode.postMessage({ type: 'atQuery', query: q });
    else hideMentions();
  });
  input.addEventListener('keydown', e => {
    if (!mentionBox.classList.contains('visible')) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); mentionActive = Math.min(mentionActive + 1, mentionItems.length - 1); highlightMention(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); mentionActive = Math.max(mentionActive - 1, 0); highlightMention(); }
    if (e.key === 'Enter' && mentionActive >= 0) { e.preventDefault(); pickMention(mentionActive); }
    if (e.key === 'Escape') hideMentions();
  });
  function highlightMention() {
    mentionBox.querySelectorAll('.mention-item').forEach((el, i) => {
      el.classList.toggle('active', i === mentionActive);
    });
  }

  function toolKind(name) {
    if (name === 'run_terminal' || name === 'Shell') return 'terminal';
    if (name === 'write_file' || name === 'search_replace') return 'edit';
    if (name === 'grep' || name === 'glob' || name === 'codebase_search') return 'search';
    if (name === 'read_file' || name === 'list_dir' || name === 'read_lints') return 'read';
    return 'think';
  }

  function toolLabel(name, args) {
    if (name === 'run_terminal' || name === 'Shell') return args.command || 'Run command';
    if (name === 'write_file') return 'Create ' + (args.path || 'file');
    if (name === 'search_replace') return 'Edit ' + (args.path || 'file');
    if (name === 'read_file') return 'Read ' + (args.path || 'file');
    if (name === 'grep') return 'Search: ' + (args.pattern || '');
    if (name === 'glob') return 'Find: ' + (args.pattern || '');
    if (name === 'codebase_search') return 'Codebase: ' + (args.query || '');
    return name;
  }

  function iconChar(kind) {
    return { terminal: '$', edit: '✎', read: '↳', search: '⌕', think: '◆' }[kind] || '◆';
  }

  function setStatus(text, running) {
    statusEl.innerHTML = running
      ? '<span class="spinner"></span><span>' + text + '</span>'
      : (text || '');
    sendBtn.disabled = running;
    state.running = running;
  }

  function hideThinking() {
    if (state.thinkingEl) { state.thinkingEl.remove(); state.thinkingEl = null; }
  }

  function showThinking(label) {
    hideThinking();
    const el = document.createElement('div');
    el.className = 'thinking';
    el.innerHTML = '<span class="dots"><span></span><span></span><span></span></span><span>' + (label || 'Thinking') + '…</span>';
    state.thinkingEl = el;
    thread.appendChild(el);
    scroll();
  }

  function scroll() { thread.scrollTop = thread.scrollHeight; }

  function ensureAssistant() {
    hideThinking();
    if (!state.assistantEl) {
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
    const title = toolLabel(name, args || {});
    card.innerHTML =
      '<div class="tool-header">' +
        '<span class="tool-icon ' + kind + '">' + iconChar(kind) + '</span>' +
        '<span class="tool-title"></span>' +
        '<span class="tool-status running"><span class="spinner"></span></span>' +
      '</div>' +
      '<div class="tool-body"></div>';
    card.querySelector('.tool-title').textContent = title;
    const body = card.querySelector('.tool-body');
    if (kind === 'terminal' && args.command) body.textContent = '$ ' + args.command;
    else if (kind === 'edit' && args.path) body.textContent = args.path;
  else body.textContent = JSON.stringify(args, null, 2).slice(0, 500);
    card.querySelector('.tool-header').onclick = () => card.classList.toggle('expanded');
    thread.appendChild(card);
    state.toolCards[id] = card;
    if (kind === 'terminal') setStatus('Running terminal…', true);
    else if (kind === 'edit') setStatus('Editing files…', true);
    else setStatus('Working…', true);
    scroll();
  }

  function endTool(id, name, result, ok) {
    const card = state.toolCards[id];
    if (!card) return;
    card.classList.remove('running');
    card.classList.add('done');
    const status = card.querySelector('.tool-status');
    status.className = 'tool-status';
    status.textContent = ok === false ? 'Failed' : 'Done';
    const body = card.querySelector('.tool-body');
    const preview = (result || '').slice(0, 4000);
    if (preview) body.textContent = preview;
    scroll();
  }

  function onDiff(file) {
    const cards = Object.values(state.toolCards);
    const last = cards[cards.length - 1];
    if (last) {
      const t = last.querySelector('.tool-title');
      if (t) t.textContent = 'Edited ' + file;
    }
  }

  document.getElementById('send-btn').onclick = send;
  document.getElementById('ctx-btn').onclick = () => vscode.postMessage({ type: 'addContext' });
  document.getElementById('stop-btn').onclick = () => vscode.postMessage({ type: 'stop' });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
  });

  function send() {
    const text = input.value.trim();
    if (!text || state.running) return;
    input.value = '';
    vscode.postMessage({ type: 'send', text, mode: document.getElementById('mode').value });
  }

  window.addEventListener('message', e => {
    const m = e.data;
    switch (m.type) {
      case 'runStart':
        state.toolCards = {};
        showThinking(m.label || 'Thinking');
        setStatus('Agent running…', true);
        break;
      case 'user':
        appendUser(m.text);
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
        onDiff(m.file);
        break;
      case 'runEnd':
        hideThinking();
        setStatus('', false);
        state.assistantEl = null;
        break;
      case 'error':
        hideThinking();
        appendText('\n\n⚠ ' + m.message);
        setStatus('', false);
        break;
      case 'atSuggestions':
        showMentions(m.suggestions || []);
        break;
      case 'chips':
        chips.innerHTML = (m.items || []).map(it => {
          const cls = 'chip ' + (it.type || 'file');
          const icon = it.type === 'folder' ? '📁' : '📄';
          return '<span class="' + cls + '" data-label="' + (it.label||'').replace(/"/g,'') + '" data-path="' + (it.path||'').replace(/"/g,'') + '" data-line="' + (it.startLine||'') + '">' +
            icon + ' ' + it.label + ' <span class="x">×</span></span>';
        }).join('');
        chips.querySelectorAll('.chip').forEach(el => {
          el.querySelector('.x').onclick = (e) => { e.stopPropagation(); vscode.postMessage({ type: 'removeChip', label: el.dataset.label }); };
          el.onclick = (e) => {
            if (e.target.classList.contains('x')) return;
            if (el.dataset.path) vscode.postMessage({ type: 'openChip', path: el.dataset.path, startLine: el.dataset.line ? parseInt(el.dataset.line,10) : undefined });
          };
        });
        break;
      case 'clear':
        thread.innerHTML = '';
        state = { running: false, assistantEl: null, thinkingEl: null, toolCards: {} };
        break;
    }
  });
})();
</script>
</body>
</html>`;
}
