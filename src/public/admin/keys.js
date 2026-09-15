(function () {
  var tokenKey = 'cls_admin_token';
  var token = null;

  function el(tag, opts) {
    var e = document.createElement(tag);
    opts = opts || {};
    if (opts.text !== undefined) e.textContent = opts.text;
    if (opts.className) e.className = opts.className;
    if (opts.attrs) {
      Object.keys(opts.attrs).forEach(function (k) {
        e.setAttribute(k, opts.attrs[k]);
      });
    }
    return e;
  }

  function scopePillClass(scope) {
    return scope.indexOf('metrics:') === 0 ? 'pill scope-metrics' : 'pill scope-logs';
  }

  function authHeaders() {
    return { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
  }

  async function api(path, options) {
    var res = await fetch(path, Object.assign({}, options, {
      headers: Object.assign({}, authHeaders(), (options && options.headers) || {})
    }));
    var body = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      throw new Error(body.error || ('Request failed: HTTP ' + res.status));
    }
    return body;
  }

  function renderKeys(rows) {
    var tbody = document.getElementById('keys-tbody');
    var empty = document.getElementById('keys-empty');
    tbody.innerHTML = '';

    if (!rows.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    rows.forEach(function (row) {
      var tr = el('tr');
      if (row.revoked) tr.className = 'revoked';

      var appIdTd = el('td', { text: row.appId, className: 'appid', attrs: { 'data-label': 'App ID' } });
      var labelTd = el('td', { text: row.label || '—', attrs: { 'data-label': 'Label' } });

      var scopesTd = el('td', { attrs: { 'data-label': 'Scopes' } });
      (row.scopes || []).forEach(function (s) {
        scopesTd.appendChild(el('span', { text: s, className: scopePillClass(s) }));
      });

      var envsTd = el('td', { attrs: { 'data-label': 'Env' } });
      (row.environments || []).forEach(function (e) {
        envsTd.appendChild(el('span', { text: e, className: 'pill env' }));
      });

      var lastUsedTd = el('td', {
        text: row.lastUsedAt ? new Date(row.lastUsedAt).toLocaleString() : 'never',
        attrs: { 'data-label': 'Last used' }
      });
      var createdTd = el('td', {
        text: row.createdAt ? new Date(row.createdAt).toLocaleDateString() : '—',
        attrs: { 'data-label': 'Created' }
      });

      var actionsTd = el('td', { className: 'row-actions', attrs: { 'data-label': '' } });
      if (!row.revoked) {
        (row.environments || []).forEach(function (envName) {
          var rotateBtn = el('button', { text: 'Rotate ' + envName, className: 'secondary' });
          rotateBtn.addEventListener('click', function () { rotate(row.appId, envName); });
          actionsTd.appendChild(rotateBtn);
        });
        var revokeBtn = el('button', { text: 'Revoke', className: 'secondary danger' });
        revokeBtn.addEventListener('click', function () { revoke(row.appId); });
        actionsTd.appendChild(revokeBtn);
      }

      [appIdTd, labelTd, scopesTd, envsTd, lastUsedTd, createdTd, actionsTd].forEach(function (td) {
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  async function loadKeys() {
    var result = await api('/admin/keys');
    renderKeys(result.data || []);
  }

  async function revoke(appId) {
    if (!window.confirm('Revoke the key(s) for "' + appId + '"? This takes effect immediately.')) return;
    await api('/admin/keys/' + encodeURIComponent(appId) + '/revoke', { method: 'POST' });
    await loadKeys();
  }

  async function rotate(appId, environment) {
    if (!window.confirm('Rotate the ' + environment + ' key for "' + appId + '"? The old value stops working immediately.')) return;
    var result = await api('/admin/keys/' + encodeURIComponent(appId) + '/rotate', {
      method: 'POST',
      body: JSON.stringify({ environment: environment })
    });
    showRawKey({ live: environment === 'live' ? result.data.rawKey : undefined,
                 test: environment === 'test' ? result.data.rawKey : undefined });
    await loadKeys();
  }

  function copyToClipboard(text, btn) {
    var restore = btn.textContent;
    var done = function (ok) {
      btn.textContent = ok ? 'Copied' : 'Copy failed';
      setTimeout(function () { btn.textContent = restore; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    } else {
      done(false);
    }
  }

  function showRawKey(rawKeys) {
    var box = document.getElementById('raw-key-result');
    box.innerHTML = '';
    box.hidden = false;
    box.appendChild(el('p', { text: 'Copy now — this value will never be shown again.', className: 'raw-key-notice' }));
    ['live', 'test'].forEach(function (env) {
      if (!rawKeys[env]) return;
      var row = el('div', { className: 'raw-key-row' });
      row.appendChild(el('span', { text: env, className: 'env-tag' }));
      var code = document.createElement('code');
      code.textContent = rawKeys[env];
      row.appendChild(code);
      var copyBtn = el('button', { text: 'Copy', className: 'secondary' });
      copyBtn.addEventListener('click', function () { copyToClipboard(rawKeys[env], copyBtn); });
      row.appendChild(copyBtn);
      box.appendChild(row);
    });
  }

  document.getElementById('create-form').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var form = ev.target;
    var errorEl = document.getElementById('create-error');
    errorEl.hidden = true;
    var scopes = Array.prototype.slice
      .call(form.querySelectorAll('input[name=scope]:checked'))
      .map(function (cb) { return cb.value; });

    try {
      var result = await api('/admin/keys', {
        method: 'POST',
        body: JSON.stringify({
          appId: form.appId.value.trim(),
          label: form.label.value.trim() || undefined,
          scopes: scopes,
          environment: form.environment.value
        })
      });
      showRawKey(result.data.rawKeys);
      form.reset();
      await loadKeys();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  });

  document.getElementById('unlock-btn').addEventListener('click', async function () {
    var input = document.getElementById('admin-token-input');
    var errorEl = document.getElementById('unlock-error');
    errorEl.hidden = true;
    token = input.value.trim();
    if (!token) return;

    try {
      await loadKeys();
      try { sessionStorage.setItem(tokenKey, token); } catch (e) { /* private window etc — non-fatal */ }
      document.getElementById('unlock-panel').hidden = true;
      document.getElementById('app-panel').hidden = false;
      document.getElementById('list-panel').hidden = false;
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      token = null;
    }
  });

  document.getElementById('admin-token-input').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      document.getElementById('unlock-btn').click();
    }
  });

  // Best-effort restore of a token already unlocked this tab session.
  try {
    var saved = sessionStorage.getItem(tokenKey);
    if (saved) {
      document.getElementById('admin-token-input').value = saved;
      document.getElementById('unlock-btn').click();
    }
  } catch (e) { /* ignore */ }
})();
