/** Cursor-style Index / Rules / Skills / MCP panels (load before settings-panel.js). */
window.RubynodSettingsPanels = (function () {
  var indexData = null;
  var indexSettings = null;
  var rulesList = [];
  var skillsList = [];
  var mcpList = [];
  var rulesTab = 'project';
  var indexPollTimer = null;

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatTime(iso) {
    if (!iso) return 'Never';
    try {
      var d = new Date(iso);
      var now = new Date();
      var mins = Math.round((now - d) / 60000);
      if (mins < 2) return 'Just now';
      if (mins < 60) return mins + 'm ago';
      if (mins < 1440) return Math.round(mins / 60) + 'h ago';
      return d.toLocaleDateString();
    } catch (_) {
      return iso;
    }
  }

  function renderIndex(vscode) {
    var d = indexData || {};
    var st = d.stats || {};
    var indexing = !!(st.indexing || d.indexing);
    var ready = !!d.ready && !indexing && (st.chunkCount || 0) > 0;
    var empty = !indexing && !ready;
    var offline = d.offline;

    var pillClass = offline ? 'err' : indexing ? 'busy' : ready ? 'ok' : 'warn';
    var pillText = offline
      ? 'Offline'
      : indexing
        ? 'Indexing…'
        : ready
          ? 'Indexed'
          : 'Not indexed';

    var progressPct = indexing && st.filesTotal
      ? Math.min(100, Math.round((st.filesDone / st.filesTotal) * 100))
      : ready
        ? 100
        : 0;

    var is = indexSettings || {};
    var html =
      '<div class="cursor-panel">' +
      '<div class="cursor-card">' +
      '<div class="cursor-card-head">' +
      '<div><h2 class="cursor-card-title">Codebase Index</h2>' +
      '<p class="cursor-card-sub">Powers @codebase search and automatic context in agent mode.</p></div>' +
      '<span class="cursor-status-pill ' +
      pillClass +
      '"><span class="cursor-status-dot"></span>' +
      esc(pillText) +
      '</span></div>';

    if (indexing) {
      html +=
        '<div class="cursor-progress"><div class="cursor-progress-bar" style="width:' +
        progressPct +
        '%"></div></div>' +
        '<p class="cursor-card-sub">' +
        esc(st.message || 'Scanning and embedding files…') +
        (st.filesTotal ? ' · ' + st.filesDone + ' / ' + st.filesTotal + ' files' : '') +
        '</p>';
    }

    html +=
      '<div class="cursor-stat-grid">' +
      '<div class="cursor-stat"><div class="cursor-stat-val">' +
      (st.fileCount ?? '—') +
      '</div><div class="cursor-stat-lbl">Files</div></div>' +
      '<div class="cursor-stat"><div class="cursor-stat-val">' +
      (st.chunkCount ?? '—') +
      '</div><div class="cursor-stat-lbl">Chunks</div></div>' +
      '<div class="cursor-stat"><div class="cursor-stat-val">' +
      (st.symbolCount ?? '—') +
      '</div><div class="cursor-stat-lbl">Symbols</div></div>' +
      '</div>' +
      '<p class="cursor-card-sub">Embeddings: <strong>' +
      esc(d.embeddingProvider || 'ollama') +
      '</strong> · ' +
      esc(d.embeddingModel || 'nomic-embed-text') +
      ' · Last sync: ' +
      esc(formatTime(st.lastIndexedAt)) +
      '</p>';

    if (d.needsEmbeddingRebuild) {
      html +=
        '<p class="cursor-card-sub" style="color:#fbbf24">⚠ Embedding settings changed — sync index to rebuild vectors.</p>';
    }

    html +=
      '<div class="cursor-actions">' +
      '<button type="button" class="btn" data-action="buildIndex"' +
      (indexing ? ' disabled' : '') +
      '>↻ Sync Index</button>' +
      '<button type="button" class="btn secondary" data-action="openRubynodignore">.rubynodignore</button>' +
      '<button type="button" class="btn secondary" data-action="refreshIndex">Refresh status</button>' +
      '</div></div>';

    html += '<div class="cursor-card"><h3 class="cursor-card-title" style="margin:0 0 12px">Index settings</h3><div class="section-fields cursor-inline-fields">';
    var fields = [
      { key: 'index.autoIndexOnOpen', label: 'Index on workspace open', type: 'boolean', value: !!is.autoIndexOnOpen },
      { key: 'index.autoIndexOnSave', label: 'Update index on save', type: 'boolean', value: !!is.autoIndexOnSave },
      { key: 'index.autoInjectContext', label: 'Auto-inject index context', type: 'boolean', value: !!is.autoInjectContext },
      {
        key: 'index.embeddingProvider',
        label: 'Embedding provider',
        type: 'enum',
        value: is.embeddingProvider || 'ollama',
        enumOptions: [
          { value: 'ollama', label: 'Ollama' },
          { value: 'hash', label: 'Local hash' },
        ],
      },
      { key: 'index.embeddingModel', label: 'Embedding model', type: 'string', value: is.embeddingModel || '' },
      { key: 'index.maxAutoContextChunks', label: 'Max context chunks', type: 'number', value: is.maxAutoContextChunks ?? 8, min: 1, max: 32 },
      { key: 'index.maxAutoContextChars', label: 'Max context chars', type: 'number', value: is.maxAutoContextChars ?? 24000, min: 2000, max: 100000 },
      { key: 'chat.autoContext', label: 'Auto context mode', type: 'enum', value: is.autoContext || 'coding', enumOptions: [
        { value: 'coding', label: 'Coding' },
        { value: 'minimal', label: 'Minimal' },
        { value: 'off', label: 'Off' },
      ]},
    ];
    html += renderInlineFields(fields);
    html += '</div></div></div>';
    return html;
  }

  function renderRules(vscode) {
    var filtered = rulesList.filter(function (r) {
      return r.scope === rulesTab;
    });
    var html =
      '<div class="cursor-panel">' +
      '<div class="cursor-toolbar">' +
      '<h3>Rules for AI</h3>' +
      '<button type="button" class="btn" data-action="newRule" data-scope="' +
      esc(rulesTab) +
      '">+ Add rule</button></div>' +
      '<p class="cursor-card-sub" style="margin:-4px 0 12px">Markdown instructions merged into every agent run. Same idea as Cursor project rules.</p>' +
      '<div class="cursor-tabs">' +
      '<button type="button" class="cursor-tab' +
      (rulesTab === 'project' ? ' active' : '') +
      '" data-rules-tab="project">Project</button>' +
      '<button type="button" class="cursor-tab' +
      (rulesTab === 'global' ? ' active' : '') +
      '" data-rules-tab="global">User</button></div>';

    if (!filtered.length) {
      html +=
        '<div class="cursor-empty">No ' +
        rulesTab +
        ' rules yet. Click <strong>Add rule</strong> or add files to <code>.rubynod/rules/</code>.</div>';
    } else {
      html += '<div class="cursor-list">';
      filtered.forEach(function (r) {
        html +=
          '<div class="cursor-list-item">' +
          '<div class="cursor-list-icon">📋</div>' +
          '<div class="cursor-list-body">' +
          '<div class="cursor-list-title">' +
          esc(r.title) +
          '</div>' +
          '<div class="cursor-list-desc">' +
          esc(r.preview || 'No preview') +
          '</div>' +
          '<div class="cursor-list-meta">' +
          esc(r.path) +
          '</div></div>' +
          '<div class="cursor-list-actions">' +
          '<button type="button" class="btn secondary" data-action="openPath" data-path="' +
          esc(r.path) +
          '">Open</button>' +
          '<button type="button" class="btn secondary" data-action="deleteRule" data-path="' +
          esc(r.path) +
          '">Delete</button></div></div>';
      });
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderSkills(vscode) {
    var html =
      '<div class="cursor-panel">' +
      '<div class="cursor-toolbar">' +
      '<h3>Agent Skills</h3>' +
      '<div style="display:flex;gap:6px">' +
      '<button type="button" class="btn secondary" data-action="newSkill" data-scope="project">+ Project</button>' +
      '<button type="button" class="btn secondary" data-action="newSkill" data-scope="global">+ User</button></div></div>' +
      '<p class="cursor-card-sub" style="margin:-4px 0 12px">Skills are invoked when the task matches their description (like Cursor skills).</p>';

    if (!skillsList.length) {
      html +=
        '<div class="cursor-empty">No skills found. Add <code>.rubynod/skills/&lt;name&gt;/SKILL.md</code>.</div>';
    } else {
      html += '<div class="cursor-skill-grid">';
      skillsList.forEach(function (sk) {
        html +=
          '<div class="cursor-skill-card" data-action="openPath" data-path="' +
          esc(sk.path) +
          '" title="' +
          esc(sk.path) +
          '">' +
          '<div class="cursor-skill-name">' +
          esc(sk.name) +
          '</div>' +
          '<div class="cursor-skill-desc">' +
          esc(sk.description || 'No description') +
          '</div>' +
          '<div class="cursor-list-meta" style="margin-top:8px">' +
          esc(sk.scope) +
          ' · ' +
          esc(sk.path.split('/').slice(-2).join('/')) +
          '</div></div>';
      });
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderMcp(vscode) {
    var html =
      '<div class="cursor-panel">' +
      '<div class="cursor-toolbar">' +
      '<h3>MCP Servers</h3>' +
      '<button type="button" class="btn" data-action="newMcpServer">+ Add server</button></div>' +
      '<p class="cursor-card-sub" style="margin:-4px 0 12px">Connect external tools via Model Context Protocol. Toggle servers on/off like Cursor.</p>';

    html +=
      '<div class="field" style="padding:0 0 12px;border:none">' +
      '<div class="field-text"><div class="field-label">Enable MCP globally</div></div>' +
      '<div class="field-control"><label class="toggle"><input type="checkbox" id="mcp-enabled" data-key="mcp.enabled"' +
      (window.__RUBYNOD_MCP_ENABLED__ ? ' checked' : '') +
      '><span class="toggle-track"></span></label></div></div>';

    if (!mcpList.length) {
      html +=
        '<div class="cursor-empty">No MCP servers in <code>~/.rubynod/mcp.json</code> or <code>.rubynod/mcp.json</code>. Copy from <code>.rubynod/mcp.json.example</code>.</div>';
    } else {
      html += '<div class="cursor-list">';
      mcpList.forEach(function (srv) {
        var cmd = srv.url
          ? srv.url
          : (srv.command || '') + (srv.args && srv.args.length ? ' ' + srv.args.join(' ') : '');
        html +=
          '<div class="cursor-list-item">' +
          '<div class="cursor-list-icon">🔌</div>' +
          '<div class="cursor-list-body">' +
          '<div class="cursor-list-title">' +
          esc(srv.name) +
          '</div>' +
          '<div class="cursor-mcp-cmd">' +
          esc(cmd) +
          '</div>' +
          '<div class="cursor-list-meta">' +
          esc(srv.scope) +
          ' · ' +
          esc(srv.configPath) +
          '</div></div>' +
          '<div class="cursor-list-actions">' +
          '<label class="toggle" title="Enable server"><input type="checkbox" data-mcp-toggle="' +
          esc(srv.id) +
          '"' +
          (!srv.disabled ? ' checked' : '') +
          '><span class="toggle-track"></span></label>' +
          '<button type="button" class="btn secondary" data-action="openPath" data-path="' +
          esc(srv.configPath) +
          '">Edit</button></div></div>';
      });
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderInlineFields(fields) {
    return fields
      .map(function (f) {
        var id = 'if-' + f.key.replace(/\./g, '-');
        var control = '';
        if (f.type === 'boolean') {
          control =
            '<label class="toggle"><input type="checkbox" id="' +
            id +
            '" data-key="' +
            esc(f.key) +
            '"' +
            (f.value ? ' checked' : '') +
            '><span class="toggle-track"></span></label>';
        } else if (f.type === 'enum') {
          control =
            '<select class="input select" data-key="' +
            esc(f.key) +
            '">' +
            (f.enumOptions || [])
              .map(function (o) {
                return (
                  '<option value="' +
                  esc(o.value) +
                  '"' +
                  (o.value === f.value ? ' selected' : '') +
                  '>' +
                  esc(o.label) +
                  '</option>'
                );
              })
              .join('') +
            '</select>';
        } else if (f.type === 'number') {
          control =
            '<input class="input" type="number" data-key="' +
            esc(f.key) +
            '" value="' +
            esc(String(f.value ?? '')) +
            '">';
        } else {
          control =
            '<input class="input" type="text" data-key="' +
            esc(f.key) +
            '" value="' +
            esc(String(f.value ?? '')) +
            '">';
        }
        return (
          '<div class="field"><div class="field-text"><div class="field-label">' +
          esc(f.label) +
          '</div></div><div class="field-control">' +
          control +
          '</div></div>'
        );
      })
      .join('');
  }

  function bindPanelActions(root, vscode, onSet) {
    root.querySelectorAll('[data-rules-tab]').forEach(function (btn) {
      btn.onclick = function () {
        rulesTab = btn.getAttribute('data-rules-tab');
        vscode.postMessage({ type: 'refreshPanel', section: 'rules' });
      };
    });
    root.querySelectorAll('[data-action]').forEach(function (btn) {
      btn.onclick = function (e) {
        var action = btn.getAttribute('data-action');
        if (action === 'openPath' && btn.getAttribute('data-path')) {
          vscode.postMessage({ type: 'openPath', path: btn.getAttribute('data-path') });
          return;
        }
        if (btn.classList.contains('cursor-skill-card')) return;
        vscode.postMessage({
          type: 'action',
          action: action,
          scope: btn.getAttribute('data-scope'),
          path: btn.getAttribute('data-path'),
        });
      };
    });
    root.querySelectorAll('.cursor-skill-card').forEach(function (card) {
      card.onclick = function () {
        vscode.postMessage({ type: 'openPath', path: card.getAttribute('data-path') });
      };
    });
    root.querySelectorAll('[data-mcp-toggle]').forEach(function (el) {
      el.onchange = function () {
        vscode.postMessage({
          type: 'mcpToggle',
          id: el.getAttribute('data-mcp-toggle'),
          enabled: el.checked,
        });
      };
    });
    root.querySelectorAll('[data-key]').forEach(function (el) {
      var ev = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'blur';
      el.addEventListener(ev, function () {
        var val = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
        if (onSet) onSet(el.getAttribute('data-key'), val);
      });
    });
  }

  function startIndexPoll(vscode) {
    stopIndexPoll();
    indexPollTimer = setInterval(function () {
      vscode.postMessage({ type: 'refreshIndex' });
    }, 2500);
  }

  function stopIndexPoll() {
    if (indexPollTimer) {
      clearInterval(indexPollTimer);
      indexPollTimer = null;
    }
  }

  return {
    render: function (panel, vscode, onSet) {
      if (panel === 'index') return renderIndex(vscode);
      if (panel === 'rules') return renderRules(vscode);
      if (panel === 'skills') return renderSkills(vscode);
      if (panel === 'mcp') return renderMcp(vscode);
      return '';
    },
    bind: bindPanelActions,
    renderInlineFields: renderInlineFields,
    setIndexData: function (d, settings) {
      indexData = d;
      indexSettings = settings;
    },
    setRules: function (list) {
      rulesList = list || [];
    },
    setSkills: function (list) {
      skillsList = list || [];
    },
    setMcp: function (list, globalEnabled) {
      mcpList = list || [];
      window.__RUBYNOD_MCP_ENABLED__ = !!globalEnabled;
    },
    startIndexPoll: startIndexPoll,
    stopIndexPoll: stopIndexPoll,
    isIndexing: function () {
      return !!(indexData && indexData.stats && indexData.stats.indexing);
    },
  };
})();
