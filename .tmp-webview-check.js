
(function() {
  try {
  const vscode = window.__rubynodVsCode || acquireVsCodeApi();
  const RN = {"serviceUrl":"http://127.0.0.1:3847","ollamaHost":"http://127.0.0.1:11434","providers":[{"id":"ollama","label":"Ollama"}]};
  function rnFetchTimeout(ms) {
    try {
      if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        return AbortSignal.timeout(ms);
      }
    } catch (_) {}
    var c = new AbortController();
    setTimeout(function() { try { c.abort(); } catch (_) {} }, ms);
    return c.signal;
  }
  const thread = document.getElementById('thread');
  const emptyEl = document.getElementById('empty');
  const input = document.getElementById('input');
  const statusEl = document.getElementById('status');
  const composerStatusRow = document.getElementById('composer-status-row');
  const sendBtn = document.getElementById('send-btn');
  const stopBtn = document.getElementById('stop-btn');
  let gotStatus = false;
  let modelsLoaded = false;
  let statusPoll = null;
  let offlineRecoveryTimer = null;
  const chips = document.getElementById('chips');
  const targets = document.getElementById('targets');
  const mentionBox = document.getElementById('mention-box');
  const acceptAllBtn = document.getElementById('accept-all-btn');
  const rejectAllBtn = document.getElementById('reject-all-btn');
  const aiStatusBtn = document.getElementById('ai-status');
  const modelSelect = document.getElementById('model');
  const providerSelect = document.getElementById('provider');
  const sessionTitleEl = document.getElementById('session-title');
  const settingsBtn = document.getElementById('settings-btn');
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
      let meta = (s.preview && s.preview !== s.title ? s.preview : '') || formatSessionTime(s.updatedAt);
      if (meta.length > 120) meta = meta.slice(0, 117) + '…';
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

  function openRubynodSettings() {
    vscode.postMessage({ type: 'openSettings' });
  }
  if (settingsBtn) settingsBtn.onclick = openRubynodSettings;
  const settingsToolbarBtn = document.getElementById('settings-toolbar-btn');
  if (settingsToolbarBtn) settingsToolbarBtn.onclick = openRubynodSettings;
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
    const saved = vscode.getState() || {};

    if (data.loading !== false && data.loading && models.length === 0) {
      if (modelSelect) {
        modelSelect.innerHTML = '';
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'Loading models…';
        opt.disabled = true;
        opt.selected = true;
        modelSelect.appendChild(opt);
      }
      return;
    }

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
    modelSelect.style.display = '';

    if (models.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = data.error || 'No models — start Ollama or pick a cloud provider';
      opt.disabled = true;
      opt.selected = true;
      modelSelect.appendChild(opt);
      modelsLoaded = false;
      return;
    }

    modelsLoaded = true;
    const labels = data.modelLabels || {};
    const noToolModels = data.noToolModels || [];
    models.forEach(function(name) {
      const opt = document.createElement('option');
      opt.value = name;
      const base = labels[name] || name;
      const isNoTool = noToolModels.includes(name);
      opt.textContent = isNoTool ? base + ' ⚠ no tools' : base;
      if (isNoTool) opt.title = 'This model does not support tool calling — agent mode will be limited to Ask mode.';
      if (name === pickModel) opt.selected = true;
      modelSelect.appendChild(opt);
    });
    if (pickModel && !models.some(function(n) { return n === pickModel; })) {
      const opt = document.createElement('option');
      opt.value = pickModel;
      opt.textContent = pickModel;
      opt.selected = true;
      modelSelect.insertBefore(opt, modelSelect.firstChild);
    }
    // Update header model label
    if (hmlModel && pickModel) hmlModel.textContent = pickModel;
  }

  function syncModelChoice() {
    const m = modelSelect && modelSelect.value;
    const p = providerSelect && providerSelect.value;
    if (!m || !p) return;
    const prev = vscode.getState() || {};
    vscode.setState({ ...prev, lastModel: m, lastProvider: p });
    vscode.postMessage({ type: 'setModel', model: m, provider: p });
    if (hmlModel && m) hmlModel.textContent = m;
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

  var healthState = { service: false, bridge: true, index: false };
  var lastConfirmedOnline = false;
  var extChannelOk = false;
  var directServiceOk = false;
  var footerDiagEl = document.getElementById('footer-diag');
  var footerDiagSep = document.getElementById('footer-diag-sep');
  var footerDiagLabel = document.getElementById('footer-diag-label');

  function updateConnectionDiag() {
    if (!footerDiagEl || !footerDiagLabel) return;
    var ext = extChannelOk ? 'Ext ✓' : 'Ext ✗';
    var svc = directServiceOk ? 'Svc ✓' : 'Svc ✗';
    footerDiagLabel.textContent = ext + ' · ' + svc;
    footerDiagEl.style.display = '';
    if (footerDiagSep) footerDiagSep.style.display = '';
    footerDiagEl.title = 'Extension channel: ' + (extChannelOk ? 'OK' : 'no postMessage') +
      ' · Direct service (' + RN.serviceUrl + '): ' + (directServiceOk ? 'OK' : 'unreachable');
  }

  /** Webview can reach the AI HTTP service directly (fallback when postMessage is slow/broken). */
  async function probeServiceDirect() {
    try {
      var res = await fetch(RN.serviceUrl + '/health', { signal: rnFetchTimeout(3000) });
      if (!res.ok) return false;
      var json = await res.json();
      return json && json.ok === true;
    } catch (e) {
      console.warn('[rubynod] direct health probe failed', e);
      return false;
    }
  }

  async function runDirectHealthProbe() {
    directServiceOk = await probeServiceDirect();
    updateConnectionDiag();
    if (directServiceOk && !lastConfirmedOnline) {
      setAiStatus(true, false, false);
      setFooterOllama(true);
      gotStatus = true;
    }
    return directServiceOk;
  }

  function pingExtensionChannel() {
    var pingId = Date.now();
    vscode.postMessage({ type: 'diagnosticPing', id: pingId });
    setTimeout(function() {
      if (!extChannelOk) updateConnectionDiag();
    }, 2500);
  }

  function setAiStatus(online, checking, hidden) {
    healthState.service = !!online;
    renderHealthBadge(checking, hidden);
  }

  function updateHealthComponent(component, ok) {
    if (component === 'bridge') healthState.bridge = !!ok;
    if (component === 'index') healthState.index = !!ok;
    renderHealthBadge(false, false);
  }

  function renderHealthBadge(checking, hidden) {
    if (!aiStatusBtn) return;
    if (hidden || !RN.showAiOfflineIndicator) {
      aiStatusBtn.className = 'ai-status hidden-indicator';
      return;
    }
    const label = aiStatusBtn.querySelector('.ai-status-label');
    if (checking) {
      // Don't flash "Connecting…" if we already confirmed the service is online
      if (lastConfirmedOnline) return;
      aiStatusBtn.className = 'ai-status checking';
      if (label) label.textContent = 'Connecting…';
      aiStatusBtn.title = 'Checking AI service…';
      return;
    }
    if (!healthState.service) {
      lastConfirmedOnline = false;
      aiStatusBtn.className = 'ai-status offline';
      if (label) label.textContent = 'Offline';
      aiStatusBtn.title = 'Rubynod AI offline — click to start. Ensure Ollama is running.';
      return;
    }
    // Service is online — show Online. Bridge/index details go in tooltip only.
    lastConfirmedOnline = true;
    aiStatusBtn.className = 'ai-status online';
    if (label) label.textContent = healthState.index ? 'Online' : 'Online · No index';
    aiStatusBtn.title = [
      'Service ✓',
      'Bridge ' + (healthState.bridge ? '✓' : '⚠ pending'),
      'Index ' + (healthState.index ? '✓' : '— run Build Index'),
    ].join(' · ');
  }
  if (aiStatusBtn) {
    aiStatusBtn.onclick = function() {
      setAiStatus(false, true);
      vscode.postMessage({ type: 'startAiService' });
      vscode.postMessage({ type: 'requestInit' });
    };
  }

  function requestPanelInit() {
    vscode.postMessage({ type: 'requestInit' });
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
    thinkingHidden: false,
    hasAssistantOutput: false,
  };

  function stripLineNumbers(text) {
    if (!text) return '';
    return String(text).split('\n').map(function(line) {
      var m = line.match(/^\d+\|(.*)$/);
      return m ? m[1] : line;
    }).join('\n');
  }

  function writeFileContents(args) {
    if (!args) return '';
    return args.contents || args.content || args.body || args.text || args.code || '';
  }

  function langFromPath(filePath) {
    const ext = String(filePath || '').split('.').pop().toLowerCase();
    const map = { ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', py: 'python', rs: 'rust', go: 'go', java: 'java', json: 'json', md: 'markdown', sh: 'bash', yml: 'yaml', yaml: 'yaml' };
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

  var SLASH_COMMANDS = [
    { cmd: '/explain', desc: 'Explain the selected code or active file', mode: 'ask',   template: 'Explain this code:\n\n' },
    { cmd: '/fix',     desc: 'Fix errors in the selected code',          mode: 'agent', template: 'Fix the following issues:\n\n' },
    { cmd: '/refactor',desc: 'Refactor the selected code',              mode: 'agent', template: 'Refactor this code to be cleaner and more maintainable:\n\n' },
    { cmd: '/debug',   desc: 'Debug the error or unexpected behaviour',  mode: 'debug', template: 'Help me debug this:\n\n' },
    { cmd: '/test',    desc: 'Write tests for the selected code',        mode: 'agent', template: 'Write unit tests for:\n\n' },
    { cmd: '/docs',    desc: 'Add documentation comments',              mode: 'agent', template: 'Add JSDoc/docstring comments to:\n\n' },
  ];
  var slashBox = document.getElementById('slash-box');
  var slashItems = [];
  var slashActive = -1;

  function getSlashQuery() {
    var val = input.value;
    var pos = input.selectionStart ?? val.length;
    var before = val.slice(0, pos);
    var m = before.match(/^\/([a-z]*)$/);
    return m ? m[1] : null;
  }

  function hideSlash() {
    if (slashBox) { slashBox.classList.remove('visible'); slashBox.innerHTML = ''; }
    slashItems = [];
    slashActive = -1;
  }

  function showSlash(query) {
    var filtered = query === undefined ? SLASH_COMMANDS : SLASH_COMMANDS.filter(function(c) {
      return c.cmd.includes('/' + query);
    });
    slashItems = filtered;
    slashActive = filtered.length ? 0 : -1;
    if (!filtered.length) { hideSlash(); return; }
    if (!slashBox) return;
    slashBox.innerHTML = filtered.map(function(c, i) {
      return '<button type="button" class="slash-item' + (i === 0 ? ' active' : '') + '" data-idx="' + i + '">' +
        '<span class="slash-item-cmd">' + escapeHtml(c.cmd) + '</span>' +
        '<span class="slash-item-desc">' + escapeHtml(c.desc) + '</span>' +
        '</button>';
    }).join('');
    slashBox.classList.add('visible');
    slashBox.querySelectorAll('.slash-item').forEach(function(el) {
      el.addEventListener('mousedown', function(e) {
        e.preventDefault();
        applySlash(parseInt(el.dataset.idx, 10));
      });
    });
  }

  function applySlash(idx) {
    var cmd = slashItems[idx];
    if (!cmd) return;
    input.value = cmd.template;
    var modeEl = document.getElementById('mode');
    if (modeEl) modeEl.value = cmd.mode;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    hideSlash();
  }

  function getAtQuery() {
    const val = input.value;
    const pos = input.selectionStart ?? val.length;
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

  function showMentions(list, errMsg) {
    mentionItems = list;
    mentionActive = list.length ? 0 : -1;
    if (!list.length) {
      if (errMsg) {
        mentionBox.innerHTML = '<div class="mention-item"><span class="name">⚠ ' + escapeHtml(errMsg) + '</span></div>';
        mentionBox.classList.add('visible');
      } else {
        hideMentions();
      }
      return;
    }
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

  function fileDisplayName(p) {
    const s = String(p || '').replace(/\\/g, '/');
    const i = s.lastIndexOf('/');
    return i >= 0 ? s.slice(i + 1) : s;
  }

  const attIcons = {
    tab: '✎',
    file: '📄',
    folder: '📁',
    mention: '@',
    open: '⊞',
    selection: '◇',
    terminal: '▸',
    git: '⎇',
    codebase: '⌕',
    context: '📎',
  };

  function renderMessageAttachments(attachments) {
    if (!attachments || !attachments.length) return '';
    return attachments.map(a => {
      const icon = attIcons[a.kind] || attIcons.context;
      const title = a.path ? a.path : a.label;
      return '<span class="msg-attachment ' + escapeHtml(a.kind || 'context') + '" title="' + escapeHtml(title) + '">' +
        '<span class="msg-att-icon">' + icon + '</span>' +
        '<span>' + escapeHtml(a.label || '') + '</span></span>';
    }).join('');
  }

  /** Highlight @file, @folder:path, @name:line-range in sent user messages. */
  function highlightAtMentions(text) {
    let s = escapeHtml(text);
    s = s.replace(/@(?:folder:[^\s@]+|(?:[^\s@/]+\/)*[^\s@]+)(?::\d+(?:-\d+)?)?/g, function(m) {
      return '<span class="at-mention">' + m + '</span>';
    });
    return s;
  }

  function rn(type, text) {
    return '<span data-rn="' + type + '">' + text + '</span>';
  }

  function highlightCode(code, lang) {
    let s = escapeHtml(stripLineNumbers(code));
    const l = String(lang || '').toLowerCase();
    const isPy = l === 'python' || l === 'py';
    var kwJs = 'const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|class|extends|import|export|from|as|async|await|try|catch|finally|throw|new|typeof|instanceof|interface|type|enum|implements|public|private|protected|static|void|true|false|null|undefined';
    var kwPy = 'def|class|import|from|return|if|elif|else|for|while|break|continue|pass|raise|yield|with|as|try|except|finally|lambda|True|False|None|and|or|not|in|is';
    var kw = isPy ? kwPy : kwJs;
    s = s.replace(new RegExp('\\b(?:' + kw + ')\\b', 'g'), function(m) { return rn('kw', m); });
    s = s.replace(/\/\*[\s\S]*?\*\//g, function(m) { return rn('c', m); });
    s = s.replace(/(^|[\s;{}])(\/\/[^\n]*)/g, function(_, pre, cm) { return pre + rn('c', cm); });
    s = s.replace(/&quot;(?:[^&]|&(?!quot;))*&quot;/g, function(m) { return rn('s', m); });
    s = s.replace(/&#39;(?:[^&]|&(?!#39;))*&#39;/g, function(m) { return rn('s', m); });
    s = s.replace(new RegExp(String.fromCharCode(96) + '[^' + String.fromCharCode(96) + ']*' + String.fromCharCode(96), 'g'), function(m) { return rn('s', m); });
    if (!isPy) {
      s = s.replace(/(^|[^\w>])([A-Za-z_][\w]*)(?=\s*\()/g, function(_, pre, name) {
        return pre + rn('fn', name);
      });
    }
    s = s.replace(/(^|[^<\w/&;])([A-Z][A-Za-z0-9_]*)(?![^<]*>)/g, function(_, pre, ty) {
      return pre + rn('ty', ty);
    });
    s = s.replace(/(^|[^<\w/&;])(\d+\.?\d*)/g, function(_, pre, num) {
      return pre + rn('n', num);
    });
    return s;
  }

  function renderInlineMarkdown(text) {
    if (!text || !String(text).trim()) return '';
    let s = escapeHtml(text);
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(new RegExp(String.fromCharCode(96) + '([^' + String.fromCharCode(96) + '\\n]+)' + String.fromCharCode(96), 'g'), '<code>$1</code>');
    s = s.replace(/\n/g, '<br>');
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
        const nl = chunk.indexOf('\n');
        if (nl > 0) {
          const maybeLang = chunk.slice(0, nl).trim();
          if (/^[a-zA-Z0-9#+._-]+$/.test(maybeLang)) {
            lang = maybeLang;
            chunk = chunk.slice(nl + 1);
          }
        }
        const code = chunk.replace(/\n$/, '');
        const codeId = 'cb-' + Math.random().toString(36).slice(2, 8);
        html += '<div class="code-block-wrap">';
        html += '<div class="code-block-header">';
        html += '<span class="code-block-lang">' + escapeHtml(lang || 'code') + '</span>';
        html += '<div class="code-block-actions">';
        html += '<button type="button" class="code-block-btn" data-cb-copy="' + codeId + '">Copy</button>';
        html += '<button type="button" class="code-block-btn" data-cb-insert="' + codeId + '">Insert</button>';
        html += '</div></div>';
        html += '<pre class="code-block" id="' + codeId + '"><code>' + highlightCode(code, lang) + '</code></pre>';
        html += '</div>';
      } else if (parts[i] && String(parts[i]).trim()) {
        html += renderInlineMarkdown(parts[i]);
      }
    }
    el.innerHTML = html.trim() ? html : '';
    // Attach copy / insert handlers
    el.querySelectorAll('[data-cb-copy]').forEach(function(btn) {
      btn.onclick = function() {
        var pre = document.getElementById(btn.dataset.cbCopy);
        var text = pre ? (pre.innerText || pre.textContent || '') : '';
        function flashCopied() {
          btn.textContent = 'Copied!';
          btn.classList.add('copied');
          setTimeout(function() { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(flashCopied).catch(function() {
            vscode.postMessage({ type: 'copyCode', code: text });
            flashCopied();
          });
        } else {
          vscode.postMessage({ type: 'copyCode', code: text });
          flashCopied();
        }
      };
    });
    el.querySelectorAll('[data-cb-insert]').forEach(function(btn) {
      btn.onclick = function() {
        var pre = document.getElementById(btn.dataset.cbInsert);
        var text = pre ? (pre.innerText || pre.textContent || '') : '';
        vscode.postMessage({ type: 'insertCode', code: text });
      };
    });
  }

  function pickMention(idx) {
    const it = mentionItems[idx];
    if (!it) return;
    const val = input.value;
    const pos = input.selectionStart ?? val.length;
    const before = val.slice(0, pos);
    const after = val.slice(pos);
    const mention =
      it.kind === 'folder'
        ? 'folder:' + it.path
        : (it.mentionText || it.label || it.path);
    const insert = it.kind === 'folder' ? '@folder:' + it.path + ' ' : '@' + mention + ' ';
    input.value = before.replace(/@([^\s@]*)$/, insert) + after;
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
    const slashQ = getSlashQuery();
    if (slashQ !== null) {
      hideMentions();
      showSlash(slashQ);
    } else {
      hideSlash();
      const q = getAtQuery();
      if (q !== null) {
        mentionBox.innerHTML = '<div class="mention-item"><span class="name">Searching…</span></div>';
        mentionBox.classList.add('visible');
        vscode.postMessage({ type: 'atQuery', query: q });
      } else hideMentions();
    }
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  });

  input.addEventListener('keydown', e => {
    if (slashBox && slashBox.classList.contains('visible')) {
      if (e.key === 'ArrowDown') { e.preventDefault(); slashActive = Math.min(slashActive + 1, slashItems.length - 1); slashBox.querySelectorAll('.slash-item').forEach(function(el, i) { el.classList.toggle('active', i === slashActive); }); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); slashActive = Math.max(slashActive - 1, 0); slashBox.querySelectorAll('.slash-item').forEach(function(el, i) { el.classList.toggle('active', i === slashActive); }); return; }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (slashActive >= 0) applySlash(slashActive); return; }
      if (e.key === 'Tab') { e.preventDefault(); if (slashActive >= 0) applySlash(slashActive); return; }
      if (e.key === 'Escape') { e.preventDefault(); hideSlash(); return; }
    }
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

  function thinkingInChat() {
    return !!RN.showThinkingInChat;
  }

  function ensureActivityPanel() {
    if (!thinkingInChat()) return null;
    if (state.activityPanel) return state.activityPanel;
    hideEmpty();
    const panel = document.createElement('div');
    panel.className = 'activity-panel';
    panel.innerHTML =
      '<div class="thinking-banner">' +
        '<span class="spinner"></span>' +
        '<span class="thinking-banner-label">Thinking…</span>' +
      '</div>' +
      '<div class="activity-thought" hidden></div>' +
      '<div class="activity-steps"></div>';
    const banner = panel.querySelector('.thinking-banner');
    if (banner) {
      banner.onclick = function() {
        if (panel.classList.contains('hiding')) return;
        if (panel.classList.contains('collapsed')) {
          panel.classList.remove('collapsed');
          return;
        }
        if (panel.querySelector('.activity-thought')?.textContent?.trim()) {
          panel.classList.toggle('expanded-thought');
        }
      };
    }
    state.activityPanel = panel;
    state.activitySteps = {};
    thread.appendChild(panel);
    scroll();
    return panel;
  }

  function setThinkingBanner(label) {
    const panel = state.activityPanel;
    if (!panel) return;
    const el = panel.querySelector('.thinking-banner-label');
    if (el && label) el.textContent = label;
  }

  function collapseThinkingPanel() {
    const panel = state.activityPanel;
    if (!panel || state.thinkingHidden) return;
    state.thinkingHidden = true;
    panel.classList.add('done', 'collapsed');
    panel.classList.remove('expanded-thought');
    const label = panel.querySelector('.thinking-banner-label');
    if (label) label.textContent = '◆ Thinking (click to expand)';
    const spin = panel.querySelector('.thinking-banner .spinner');
    if (spin) spin.remove();
  }

  function hideThinkingPanel() {
    const panel = state.activityPanel;
    if (!panel) return;
    panel.classList.add('hiding');
    setTimeout(function() {
      if (panel.parentNode) panel.parentNode.removeChild(panel);
      if (state.activityPanel === panel) {
        state.activityPanel = null;
        state.activitySteps = {};
      }
    }, 350);
  }

  function finishActivityPanel() {
    if (!thinkingInChat() || !state.activityPanel) return;
    collapseThinkingPanel();
    hideThinkingPanel();
  }

  function upsertActivityStep(id, step, label, detail, status) {
    const panel = ensureActivityPanel();
    if (!panel) return;
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
    if (label && status === 'active') {
      setThinkingBanner(label.startsWith('◆') ? label : '◆ ' + label);
    }
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
    if (!thinkingInChat() || !text || !text.trim()) return;
    const panel = ensureActivityPanel();
    if (!panel) return;
    panel.classList.add('has-thought');
    setThinkingBanner('◆ Thinking…');
    let block = panel.querySelector('.activity-thought');
    if (block) {
      block.hidden = false;
      block.textContent = text.trim();
    }
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

  function appendUser(text, attachments) {
    hideEmpty();
    state.assistantEl = null;
    const wrap = document.createElement('div');
    wrap.className = 'bubble-user-wrap';
    const el = document.createElement('div');
    el.className = 'bubble-user';
    el.innerHTML = highlightAtMentions(text);
    wrap.appendChild(el);
    const attHtml = renderMessageAttachments(attachments);
    if (attHtml) {
      const attEl = document.createElement('div');
      attEl.className = 'bubble-attachments';
      attEl.innerHTML = attHtml;
      wrap.appendChild(attEl);
    }
    thread.appendChild(wrap);
    scroll();
  }

  function isTutorialChunk(delta) {
    if (!delta) return true;
    const d = String(delta);
    if (/^#{2,3}s+Steps+d/m.test(d)) return true;
    if (/Let's start by|To add a new shared service|We'll create a new file named/i.test(d)) return true;
    if (/^s*{s*"name"s*:s*"(?:read_file|write_file)"/m.test(d)) return true;
    return false;
  }

  function appendText(delta) {
    if (isTutorialChunk(delta)) return;
    if (!state.hasAssistantOutput) {
      state.hasAssistantOutput = true;
      if (thinkingInChat() && state.activityPanel) collapseThinkingPanel();
    }
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
    card.className = 'tool-card running';
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

  function endTool(id, name, result, ok, argsOverride) {
    const card = state.toolCards[id];
    if (!card) return;
    if (ok === false) {
      card.remove();
      delete state.toolCards[id];
      scroll();
      return;
    }
    card.classList.remove('running');
    const status = card.querySelector('.tool-status');
    status.className = 'tool-status';
    status.textContent = ok === false ? 'Failed' : 'Done';
    const body = card.querySelector('.tool-body');
    const args = argsOverride || state.toolArgs[id] || {};
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
    card.className = 'tool-card';
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
      appendUser(entry.text, entry.attachments);
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
    state = { running: false, assistantEl: null, assistantMarkdown: '', thinkingHidden: false, hasAssistantOutput: false, activityPanel: null, activitySteps: {}, toolCards: {}, toolArgs: {} };
    for (const entry of entries) renderHistoryEntry(entry);
    setStatus('', false);
    scroll();
  }

  function renderTargets(files) {
    targets.innerHTML = (files || []).map(f => {
      const name = fileDisplayName(f);
      return '<span class="target-chip" data-file="' + escapeHtml(f) + '" title="' + escapeHtml(f) + '">' +
        '<span class="label">✎ ' + escapeHtml(name) + '</span><span class="x">×</span></span>';
    }).join('');
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

  function showErrorCard(message) {
    hideEmpty();
    state.assistantEl = null;
    var card = document.createElement('div');
    card.className = 'error-card';
    var isTs = /TSd+:|type error|cannot find|does not exist|not assignable/i.test(message);
    var isBuild = /build failed|compilation error|npm error|exit code/i.test(message);
    var canFix = isTs || isBuild || /error|fail|crash|exception/i.test(message);
    card.innerHTML =
      '<div class="error-card-head">' +
        '<span class="error-card-icon">⚠</span>' +
        '<span class="error-card-title">Error</span>' +
      '</div>' +
      '<div class="error-card-body">' + escapeHtml(message) + '</div>' +
      (canFix
        ? '<div class="error-card-actions">' +
            '<button type="button" class="error-fix-btn">✦ Fix Automatically</button>' +
          '</div>'
        : '');
    if (canFix) {
      card.querySelector('.error-fix-btn').onclick = function() {
        card.remove();
        vscode.postMessage({ type: 'send', text: 'Fix the error: ' + message, mode: 'agent' });
      };
    }
    thread.appendChild(card);
    scroll();
  }

  function showDiffCard(file, added, removed) {
    hideEmpty();
    state.assistantEl = null;
    const card = document.createElement('div');
    card.className = 'diff-card';
    card.dataset.file = file;
    var stat = (added || removed)
      ? ' <span class="diff-stat"><span class="diff-add">+' + (added || 0) + '</span> <span class="diff-del">−' + (removed || 0) + '</span></span>'
      : '';
    card.innerHTML =
      '<span class="diff-file">📝 ' + escapeHtml(file) + stat + ' <span style="opacity:0.75;font-weight:400">— Accept to apply, Reject to discard</span></span>' +
      '<button type="button" class="accept" title="Write this change to disk">Accept</button>' +
      '<button type="button" class="reject" title="Discard; file stays unchanged">Reject</button>';
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
    input.value = '';
    input.style.height = 'auto';
    setStatus('Sending…', true);
    vscode.postMessage({ type: 'send', text, mode, model, provider });
  }

  if (sendBtn) sendBtn.onclick = send;
  const ctxBtn = document.getElementById('ctx-btn');
  const tabsBtn = document.getElementById('tabs-btn');
  const checkpointBtn = document.getElementById('checkpoint-btn');
  if (ctxBtn) ctxBtn.onclick = () => vscode.postMessage({ type: 'addContext' });
  if (tabsBtn) tabsBtn.onclick = () => vscode.postMessage({ type: 'addOpenFiles' });
  if (checkpointBtn) checkpointBtn.onclick = () => vscode.postMessage({ type: 'checkpoint' });
  if (acceptAllBtn) acceptAllBtn.onclick = () => vscode.postMessage({ type: 'acceptAll' });
  if (rejectAllBtn) rejectAllBtn.onclick = () => vscode.postMessage({ type: 'rejectAll' });
  if (stopBtn) stopBtn.onclick = () => vscode.postMessage({ type: 'stop' });

  // Footer status bar
  var footerOllamaDot = document.getElementById('footer-ollama-dot');
  var footerOllamaLabel = document.getElementById('footer-ollama-label');
  var footerIndexDot = document.getElementById('footer-index-dot');
  var footerIndexLabel = document.getElementById('footer-index-label');
  var footerTokensEl = document.getElementById('footer-tokens');
  var footerTokensLabel = document.getElementById('footer-tokens-label');
  var footerLatencyEl = document.getElementById('footer-latency');
  var footerLatencyLabel = document.getElementById('footer-latency-label');
  var runStartMs = 0;

  var hmlModel = document.getElementById('hml-model');
  var hmlStatus = document.getElementById('hml-status');

  function updateHeaderModel(modelName, online) {
    if (hmlModel && modelName) hmlModel.textContent = modelName;
    if (hmlStatus) {
      hmlStatus.textContent = online === true ? 'Ready' : online === false ? 'Offline' : 'Connecting';
      hmlStatus.className = online === true ? 'hml-ready' : 'hml-offline';
    }
  }

  function setFooterOllama(online) {
    if (!footerOllamaDot || !footerOllamaLabel) return;
    footerOllamaDot.className = 'footer-dot ' + (online ? 'ok' : 'err');
    footerOllamaLabel.textContent = online ? 'Ollama ✓' : 'Ollama ✗';
    if (hmlStatus) {
      hmlStatus.textContent = online ? 'Ready' : 'Offline';
      hmlStatus.className = online ? 'hml-ready' : 'hml-offline';
    }
  }
  function setFooterIndex(ready, indexing) {
    if (!footerIndexDot || !footerIndexLabel) return;
    footerIndexDot.className = 'footer-dot ' + (ready ? 'ok' : indexing ? 'warn' : '');
    footerIndexLabel.textContent = ready ? 'Index ✓' : indexing ? 'Indexing…' : 'No index';
  }
  function setFooterTokens(used, total) {
    if (!footerTokensEl || !footerTokensLabel) return;
    if (used && total) {
      footerTokensLabel.textContent = Math.round(used / 1000 * 10) / 10 + 'k / ' + Math.round(total / 1000 * 10) / 10 + 'k tokens';
      footerTokensEl.style.display = '';
    } else if (used) {
      footerTokensLabel.textContent = Math.round(used / 1000 * 10) / 10 + 'k ctx';
      footerTokensEl.style.display = '';
    } else {
      footerTokensEl.style.display = 'none';
    }
  }
  function setFooterLatency(ms) {
    if (!footerLatencyEl || !footerLatencyLabel) return;
    if (ms > 0) {
      footerLatencyLabel.textContent = ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms';
      footerLatencyEl.style.display = '';
    } else {
      footerLatencyEl.style.display = 'none';
    }
  }
  // Initialise from baked state
  setFooterOllama(typeof RN.initialOnline === 'boolean' ? RN.initialOnline : false);
  setFooterIndex(false, false);

  function postDroppedUris(uris) {
    var clean = [];
    for (var i = 0; i < uris.length; i++) {
      var u = (uris[i] || '').trim();
      if (u && u.charAt(0) !== '#') clean.push(u);
    }
    if (clean.length) vscode.postMessage({ type: 'filesDropped', uris: clean });
  }

  /** VS Code Explorer drops often need async DataTransferItem.getAsString (sync getData is empty). */
  function collectDropUris(dt) {
    if (!dt) return;
    var uris = [];
    var pending = 0;
    var items = dt.items;
    function finishSync() {
      if (!uris.length) {
        var uriList = dt.getData('text/uri-list');
        if (uriList) uris = uriList.split(/\r?\n/).filter(function(l) { return l && l.charAt(0) !== '#'; });
      }
      if (!uris.length) {
        var plain = dt.getData('text/plain');
        if (plain && plain.trim()) uris = [plain.trim()];
      }
      if (!uris.length && dt.files && dt.files.length) {
        for (var j = 0; j < dt.files.length; j++) {
          var f = dt.files[j];
          if (f.path) uris.push('file://' + f.path);
        }
      }
      if (uris.length) postDroppedUris(uris);
    }
    if (items && items.length) {
      for (var k = 0; k < items.length; k++) {
        var item = items[k];
        if (item.kind === 'string') {
          pending++;
          (function(typ) {
            item.getAsString(function(s) {
              pending--;
              if (s) {
                if (typ === 'text/uri-list' || s.indexOf('file://') >= 0) {
                  uris = uris.concat(s.split(/\r?\n/).filter(function(l) { return l && l.charAt(0) !== '#'; }));
                } else if (s.trim()) {
                  uris.push(s.trim());
                }
              }
              if (pending === 0) {
                if (uris.length) postDroppedUris(uris);
                else finishSync();
              }
            }, typ);
          })(item.type || 'text/uri-list');
        }
      }
      if (pending === 0) finishSync();
      return;
    }
    finishSync();
  }

  // Drag & drop file attachments onto the composer
  const composerBox = document.getElementById('composer-box');
  let dragEnterCount = 0;
  if (composerBox) {
    composerBox.addEventListener('dragenter', function(e) {
      e.preventDefault();
      dragEnterCount++;
      composerBox.classList.add('drag-over');
    });
    composerBox.addEventListener('dragleave', function(e) {
      e.preventDefault();
      dragEnterCount--;
      if (dragEnterCount <= 0) {
        dragEnterCount = 0;
        composerBox.classList.remove('drag-over');
      }
    });
    composerBox.addEventListener('dragover', function(e) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    composerBox.addEventListener('drop', function(e) {
      e.preventDefault();
      dragEnterCount = 0;
      composerBox.classList.remove('drag-over');
      collectDropUris(e.dataTransfer);
    });
  }

  // Also allow dropping on the whole chat shell (thread area)
  var chatShell = document.querySelector('.chat-shell');
  if (chatShell) {
    chatShell.addEventListener('dragover', function(e) { e.preventDefault(); });
    chatShell.addEventListener('drop', function(e) {
      e.preventDefault();
      collectDropUris(e.dataTransfer);
    });
  }

  window.addEventListener('message', e => {
    const m = e.data;
    switch (m.type) {
      case 'user':
        appendUser(m.text || '', m.attachments);
        break;
      case 'runStart':
        runStartMs = Date.now();
        setFooterLatency(0);
        state.toolCards = {};
        state.assistantMarkdown = '';
        state.activityPanel = null;
        state.activitySteps = {};
        state.thinkingHidden = false;
        state.hasAssistantOutput = false;
        if (thinkingInChat()) {
          ensureActivityPanel();
          upsertActivityStep('think-live', 'think', m.label || '◆ Thinking…', '', 'active');
          setThinkingBanner(m.label || '◆ Thinking…');
        }
        setStatus('◆ Thinking…', true);
        break;
      case 'activity':
        if (thinkingInChat()) {
          upsertActivityStep(m.id, m.step || 'think', m.label, m.detail, m.status || 'active');
        }
        setStatus(m.label || 'Working…', true);
        break;
      case 'thought':
        addThought(m.text);
        break;
      case 'text':
        appendText(m.text);
        setStatus('Generating…', true);
        break;
      case 'toolStart':
        startTool(m.id, m.name, m.args);
        break;
      case 'toolEnd':
        endTool(m.id, m.name, m.result, m.ok, m.args);
        break;
      case 'diff':
        showDiffCard(m.file, m.added, m.removed);
        break;
      case 'diffResolved':
        thread.querySelectorAll('.diff-card[data-file]').forEach(el => {
          if (el.dataset.file === m.file) el.remove();
        });
        break;
      case 'targets':
        renderTargets(m.files || []);
        break;
      case 'diagnosticPong':
        extChannelOk = true;
        updateConnectionDiag();
        if (m.extensionOnline) {
          setAiStatus(true, false, false);
          setFooterOllama(true);
          gotStatus = true;
          lastConfirmedOnline = true;
        }
        break;
      case 'aiStatus':
        extChannelOk = true;
        updateConnectionDiag();
        setAiStatus(!!m.online, !!m.checking, !!m.hidden);
        setFooterOllama(!!m.online);
        if (!m.checking) {
          gotStatus = true;
          if (m.online) {
            // Service came online — stop offline recovery poll
            if (offlineRecoveryTimer) { clearInterval(offlineRecoveryTimer); offlineRecoveryTimer = null; }
          } else {
            // Service is offline — poll every 5 s for up to 3 minutes until it comes up
            if (!offlineRecoveryTimer) {
              var _offlineRetries = 0;
              offlineRecoveryTimer = setInterval(function() {
                _offlineRetries++;
                if (_offlineRetries > 36) { clearInterval(offlineRecoveryTimer); offlineRecoveryTimer = null; return; }
                requestPanelInit();
              }, 5000);
            }
          }
        }
        break;
      case 'indexStatus':
        setFooterIndex(!!m.ready, !!m.indexing);
        updateHealthComponent('index', !!m.ready);
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
        if (runStartMs) setFooterLatency(Date.now() - runStartMs);
        runStartMs = 0;
        if (m.tokensUsed) setFooterTokens(m.tokensUsed, m.contextWindow);
        break;
      case 'error':
        if (thinkingInChat() && state.activityPanel) {
          collapseThinkingPanel();
          hideThinkingPanel();
        }
        showErrorCard(m.message || 'An error occurred');
        setStatus('', false);
        state.running = false;
        sendBtn.disabled = false;
        stopBtn.classList.add('hidden');
        sendBtn.classList.remove('hidden');
        break;
      case 'atSuggestions':
        showMentions(m.suggestions || [], m.error);
        break;
      case 'prefillComposer':
        if (m.text && input) {
          input.value = m.text;
          input.style.height = 'auto';
          input.style.height = Math.min(input.scrollHeight, 140) + 'px';
          input.focus();
        }
        break;
      case 'planReady': {
        var existing = document.getElementById('plan-approve-bar');
        if (existing) existing.remove();
        var bar = document.createElement('div');
        bar.id = 'plan-approve-bar';
        bar.className = 'plan-approve-bar';
        bar.innerHTML =
          '<span class="plan-approve-label">Plan ready —</span>' +
          '<button type="button" class="plan-approve-btn">▶ Execute</button>' +
          '<button type="button" class="plan-edit-btn">✎ Edit</button>' +
          '<button type="button" class="plan-dismiss-btn">✕ Cancel</button>';
        bar.querySelector('.plan-approve-btn').onclick = function() {
          vscode.postMessage({ type: 'approvePlan', planText: m.planText });
          bar.remove();
        };
        bar.querySelector('.plan-edit-btn').onclick = function() {
          // Prefill composer with the plan text for user editing
          if (input) {
            input.value = m.planText || '';
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 140) + 'px';
            input.focus();
          }
          bar.remove();
        };
        bar.querySelector('.plan-dismiss-btn').onclick = function() {
          vscode.postMessage({ type: 'cancelPlan' });
          bar.remove();
        };
        thread.appendChild(bar);
        scroll();
        break;
      }
      case 'attachmentsLoading':
        if (chips) {
          var loadEl = document.createElement('span');
          loadEl.className = 'chip loading';
          loadEl.id = 'chip-loading';
          loadEl.textContent = 'Loading…';
          chips.appendChild(loadEl);
        }
        break;
      case 'attachmentsLoadingDone':
        var oldLoad = document.getElementById('chip-loading');
        if (oldLoad) oldLoad.remove();
        break;
      case 'healthUpdate':
        if (m.component) updateHealthComponent(m.component, m.ok);
        break;
      case 'chips':
        chips.innerHTML = (m.items || []).map(function(it) {
          var tooltip = it.path || it.label;
          if (it.lineCount) tooltip += '\n' + it.lineCount + ' lines';
          if (it.modifiedMs) {
            var ago = Math.round((Date.now() - it.modifiedMs) / 60000);
            tooltip += '\nmodified ' + (ago < 60 ? ago + 'm ago' : Math.round(ago / 60) + 'h ago');
          }
          return '<span class="chip" title="' + escapeHtml(tooltip) + '" data-label="' + escapeHtml(it.label||'') + '" data-path="' + escapeHtml(it.path||'') + '" data-line="' + (it.startLine||'') + '">' +
            '<span class="label">' + escapeHtml(it.label) + '</span><span class="x">×</span></span>';
        }).join('');
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
        state = { running: false, assistantEl: null, assistantMarkdown: '', thinkingHidden: false, hasAssistantOutput: false, activityPanel: null, activitySteps: {}, toolCards: {}, toolArgs: {} };
        sendBtn.disabled = false;
        stopBtn.classList.add('hidden');
        sendBtn.classList.remove('hidden');
        break;
    }
  });

  statusPoll = setInterval(function() {
    requestPanelInit();
  }, 30000);

  if (aiStatusBtn) {
    var bootLbl = aiStatusBtn.querySelector('.ai-status-label');
    if (bootLbl) bootLbl.textContent = 'Connecting…';
  }
  if (modelSelect) {
    modelSelect.innerHTML = '<option value="">Loading models…</option>';
  }
  function applyBakedInit() {
    if (RN.providers) {
      fillChatModels({
        models: RN.initialModels || [],
        modelLabels: RN.initialModelLabels || {},
        current: RN.initialCurrent || '',
        provider: RN.initialProvider || 'ollama',
        providers: RN.providers,
        loading: false,
        error: RN.initialError,
        showPicker: true,
      });
    }
    if (typeof RN.initialOnline === 'boolean') {
      setAiStatus(RN.initialOnline, false);
      gotStatus = true;
    } else if (RN.initialError) {
      setAiStatus(false, false);
      gotStatus = true;
    }
  }
  applyBakedInit();
  vscode.postMessage({ type: 'webviewReady' });
  requestPanelInit();
  setTimeout(requestPanelInit, 800);
  pingExtensionChannel();
  void runDirectHealthProbe();
  setTimeout(function() {
    if (!gotStatus) {
      void runDirectHealthProbe();
      requestPanelInit();
      pingExtensionChannel();
    }
  }, 2500);
  setTimeout(function() {
    if (!gotStatus || !extChannelOk) {
      void runDirectHealthProbe();
      requestPanelInit();
    }
  }, 6000);
  } catch (bootErr) {
    console.error('[rubynod chat] boot failed:', bootErr);
    var errBtn = document.getElementById('ai-status');
    if (errBtn) {
      var lbl = errBtn.querySelector('.ai-status-label');
      if (lbl) lbl.textContent = 'Error';
      errBtn.title = String(bootErr && bootErr.message ? bootErr.message : bootErr);
    }
    var st = document.getElementById('status');
    if (st) st.textContent = 'Chat UI failed to load — reload window';
  }
})();
