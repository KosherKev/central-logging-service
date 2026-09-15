(function () {
  var tokenKey = 'cls_admin_token';
  var token = null;

  function el(tag, opts) {
    var e = document.createElement(tag);
    opts = opts || {};
    if (opts.text !== undefined) e.textContent = opts.text;
    if (opts.className) e.className = opts.className;
    return e;
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
    tbody.innerHTML = '';
    rows.forEach(function (row) {
      var tr = el('tr');
      if (row.revoked) tr.className = 'revoked';

      var appIdTd = el('td', { text: row.appId });
      var labelTd = el('td', { text: row.label || '—' });

      var scopesTd = el('td', { className: 'scopes' });
      (row.scopes || []).forEach(function (s) {
        scopesTd.appendChild(el('span', { text: s }));
      });

      var envsTd = el('td', { className: 'envs' });
      (row.environments || []).forEach(function (e) {
        envsTd.appendChild(el('span', { text: e }));
      });

      var lastUsedTd = el('td', { text: row.lastUsedAt ? new Date(row.lastUsedAt).toLocaleString() : 'never' });
      var createdTd = el('td', { text: row.createdAt ? new Date(row.createdAt).toLocaleDateString() : '—' });

      var actionsTd = el('td', { className: 'row-actions' });
      if (!row.revoked) {
        (row.environments || []).forEach(function (envName) {
          var rotateBtn = el('button', { text: 'Rotate ' + envName, className: 'secondary' });
          rotateBtn.addEventListener('click', function () { rotate(row.appId, envName); });
          actionsTd.appendChild(rotateBtn);
        });
        var revokeBtn = el('button', { text: 'Revoke', className: 'secondary' });
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

  function showRawKey(rawKeys) {
    var box = document.getElementById('raw-key-result');
    box.innerHTML = '';
    box.hidden = false;
    var notice = el('p', { text: 'Copy now — this value will never be shown again.' });
    notice.className = 'error';
    box.appendChild(notice);
    ['test', 'live'].forEach(function (env) {
      if (rawKeys[env]) {
        var line = el('div', { className: 'raw-key-box', text: env + ': ' + rawKeys[env] });
        box.appendChild(line);
      }
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

  // Best-effort restore of a token already unlocked this tab session.
  try {
    var saved = sessionStorage.getItem(tokenKey);
    if (saved) {
      document.getElementById('admin-token-input').value = saved;
      document.getElementById('unlock-btn').click();
    }
  } catch (e) { /* ignore */ }
})();
