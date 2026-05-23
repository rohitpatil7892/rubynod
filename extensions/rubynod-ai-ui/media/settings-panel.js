(function () {
  const vscode = acquireVsCodeApi();
  const S = window.__RUBYNOD_SETTINGS__;
  const P = window.RubynodSettingsPanels;

  const nav = document.getElementById('nav');
  const content = document.getElementById('content');
  const search = document.getElementById('search');
  const statusEl = document.getElementById('save-status');

  function showInitError(msg) {
    if (content) {
      content.innerHTML =
        '<div class="section-head"><h1>Settings unavailable</h1><p class="field-desc">' +
        String(msg).replace(/</g, '&lt;') +
        '</p></div>';
    }
    if (nav) nav.innerHTML = '';
  }

  if (!S || !nav || !content) {
    showInitError('Settings state failed to load. Reload the VS Code window and try again.');
    return;
  }

  let activeSection = S.activeSection || (S.sections[0] && S.sections[0].id) || 'models';
  let modelOptions = [];

  function stopPoll() {
    if (P && P.stopIndexPoll) P.stopIndexPoll();
  }

  function setStatus(msg, ok) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.className = 'save-status' + (ok ? ' ok' : msg ? ' err' : '');
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sectionMatches(sec, q) {
    if (!q) return true;
    if (sec.label.toLowerCase().includes(q) || sec.description.toLowerCase().includes(q)) return true;
    if (sec.panel && sec.panel.includes(q)) return true;
    if (!sec.fields) return false;
    return sec.fields.some(function (f) {
      return f.label.toLowerCase().includes(q);
    });
  }

  function renderNav(filter) {
    const q = (filter || '').toLowerCase();
    nav.innerHTML = S.sections
      .filter(function (sec) {
        return sectionMatches(sec, q);
      })
      .map(function (sec) {
        return (
          '<button type="button" class="nav-item' +
          (sec.id === activeSection ? ' active' : '') +
          '" data-id="' +
          esc(sec.id) +
          '"><span class="nav-icon">' +
          esc(sec.icon) +
          '</span><span class="nav-label">' +
          esc(sec.label) +
          '</span></button>'
        );
      })
      .join('');
    nav.querySelectorAll('.nav-item').forEach(function (btn) {
      btn.onclick = function () {
        activeSection = btn.getAttribute('data-id');
        stopPoll();
        renderNav(search ? search.value : '');
        renderContent();
        var sec = S.sections.find(function (s) {
          return s.id === activeSection;
        });
        if (sec && sec.panel === 'index') vscode.postMessage({ type: 'refreshIndex' });
      };
    });
  }

  function fieldRow(f) {
    if (f.type === 'action') {
      return (
        '<div class="field action-row">' +
        '<div class="field-text"><div class="field-label">' +
        esc(f.label) +
        '</div>' +
        (f.description ? '<div class="field-desc">' + esc(f.description) + '</div>' : '') +
        '</div>' +
        '<button type="button" class="btn secondary" data-action="' +
        esc(f.action) +
        '">' +
        esc(f.actionLabel || 'Open') +
        '</button></div>'
      );
    }

    const id = 'f-' + f.key.replace(/\./g, '-');
    let control = '';

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
      const opts = (f.enumOptions || [])
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
        .join('');
      control =
        '<select class="input select" id="' +
        id +
        '" data-key="' +
        esc(f.key) +
        '">' +
        opts +
        '</select>';
    } else if (f.type === 'models') {
      const opts = modelOptions.length
        ? modelOptions
            .map(function (m) {
              return (
                '<option value="' +
                esc(m) +
                '"' +
                (m === f.value ? ' selected' : '') +
                '>' +
                esc(m) +
                '</option>'
              );
            })
            .join('')
        : '<option value="' + esc(String(f.value || '')) + '">' + esc(String(f.value || '')) + '</option>';
      control =
        '<select class="input select" id="' +
        id +
        '" data-key="' +
        esc(f.key) +
        '">' +
        opts +
        '</select>';
    } else if (f.type === 'number') {
      control =
        '<input class="input" type="number" id="' +
        id +
        '" data-key="' +
        esc(f.key) +
        '" value="' +
        esc(String(f.value ?? '')) +
        '"' +
        (f.min != null ? ' min="' + f.min + '"' : '') +
        (f.max != null ? ' max="' + f.max + '"' : '') +
        '>';
    } else {
      control =
        '<input class="input" type="' +
        (f.sensitive ? 'password' : 'text') +
        '" id="' +
        id +
        '" data-key="' +
        esc(f.key) +
        '" value="' +
        esc(String(f.value ?? '')) +
        '">';
    }

    return (
      '<div class="field">' +
      '<div class="field-text"><div class="field-label">' +
      esc(f.label) +
      '</div>' +
      (f.description ? '<div class="field-desc">' + esc(f.description) + '</div>' : '') +
      '</div>' +
      '<div class="field-control">' +
      control +
      '</div></div>'
    );
  }

  function onSet(key, val) {
    setStatus('Saving…', false);
    vscode.postMessage({ type: 'set', key: key, value: val });
  }

  function renderContent() {
    const sec = S.sections.find(function (s) {
      return s.id === activeSection;
    });
    if (!sec) {
      activeSection = (S.sections[0] && S.sections[0].id) || 'models';
      return renderContent();
    }

    if (sec.panel) {
      if (!P) {
        content.innerHTML =
          '<div class="section-head"><h1>' +
          esc(sec.label) +
          '</h1><p class="field-desc">Panel scripts failed to load. Run <strong>Developer: Reload Window</strong> and open settings again.</p></div>';
        return;
      }
      content.innerHTML =
        '<div class="section-head"><h1>' +
        esc(sec.label) +
        '</h1><p>' +
        esc(sec.description) +
        '</p></div>' +
        P.render(sec.panel, vscode, onSet);
      P.bind(content, vscode, onSet);
      if (sec.panel === 'index') {
        vscode.postMessage({ type: 'refreshIndex' });
        if (P.isIndexing()) P.startIndexPoll(vscode);
      } else {
        stopPoll();
      }
      return;
    }

    stopPoll();
    content.innerHTML =
      '<div class="section-head"><h1>' +
      esc(sec.label) +
      '</h1><p>' +
      esc(sec.description) +
      '</p></div><div class="section-fields">' +
      (sec.fields || []).map(fieldRow).join('') +
      '</div>';
    bindFields();
  }

  function bindFields() {
    content.querySelectorAll('[data-key]').forEach(function (el) {
      const key = el.getAttribute('data-key');
      const ev = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'blur';
      el.addEventListener(ev, function () {
        let val;
        if (el.type === 'checkbox') val = el.checked;
        else if (el.type === 'number') val = Number(el.value);
        else val = el.value;
        onSet(key, val);
      });
    });
    content.querySelectorAll('[data-action]').forEach(function (btn) {
      btn.onclick = function () {
        vscode.postMessage({ type: 'action', action: btn.getAttribute('data-action') });
      };
    });
  }

  function navigateTo(sectionId) {
    if (!sectionId) return;
    const exists = S.sections.some(function (s) {
      return s.id === sectionId;
    });
    if (!exists) return;
    activeSection = sectionId;
    stopPoll();
    renderNav(search ? search.value : '');
    renderContent();
    const sec = S.sections.find(function (s) {
      return s.id === activeSection;
    });
    if (sec && sec.panel === 'index') vscode.postMessage({ type: 'refreshIndex' });
  }

  if (search) {
    search.addEventListener('input', function () {
      renderNav(search.value);
    });
  }

  window.addEventListener('message', function (e) {
    const m = e.data;
    if (m.type === 'navigate' && m.section) {
      navigateTo(m.section);
      return;
    }
    if (m.type === 'saved') {
      setStatus('Saved', true);
      setTimeout(function () {
        setStatus('', true);
      }, 1500);
    }
    if (m.type === 'error') setStatus(m.message || 'Error', false);
    if (m.type === 'models' && Array.isArray(m.models)) {
      modelOptions = m.models;
      renderContent();
    }
    if (m.type === 'indexStatus' && P) {
      P.setIndexData(m.data, m.settings);
      if (activeSection === 'indexing') renderContent();
      if (m.data && m.data.stats && m.data.stats.indexing) P.startIndexPoll(vscode);
      else stopPoll();
    }
    if (m.type === 'rulesList' && P) {
      P.setRules(m.items);
      if (activeSection === 'rules') renderContent();
    }
    if (m.type === 'skillsList' && P) {
      P.setSkills(m.items);
      if (activeSection === 'skills') renderContent();
    }
    if (m.type === 'mcpList' && P) {
      P.setMcp(m.items, m.globalEnabled);
      if (activeSection === 'mcp') renderContent();
    }
  });

  document.getElementById('close-btn')?.addEventListener('click', function () {
    vscode.postMessage({ type: 'close' });
  });

  try {
    renderNav();
    renderContent();
    vscode.postMessage({ type: 'ready' });
  } catch (err) {
    showInitError(err && err.message ? err.message : String(err));
  }
})();
