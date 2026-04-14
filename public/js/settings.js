(function () {
  var addForm = document.getElementById('add-path-form');
  var pathInput = document.getElementById('path-input');
  var pathList = document.getElementById('path-list');
  var scanBtn = document.getElementById('scan-btn');
  var scanStatus = document.getElementById('scan-status');
  var noPathsMsg = document.getElementById('no-paths-msg');
  var passwordForm = document.getElementById('password-form');
  var passwordStatus = document.getElementById('password-status');

  // Add path
  if (addForm) {
    addForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var pathValue = pathInput.value.trim();
      if (!pathValue) return;

      fetch('/api/paths', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: pathValue }),
      })
        .then(function (res) {
          if (!res.ok) return res.json().then(function (d) { throw new Error(d.error); });
          return res.json();
        })
        .then(function (newPath) {
          var div = document.createElement('div');
          div.className = 'flex items-center justify-between py-2.5 border-b border-gray-700 last:border-0';
          div.dataset.pathId = newPath.id;
          div.innerHTML =
            '<code class="text-gray-300 text-sm">' + escapeHtml(newPath.path) + '</code>' +
            '<button onclick="deletePath(' + newPath.id + ')" class="text-red-400 hover:text-red-300 text-xs ml-4">Remove</button>';
          pathList.appendChild(div);
          if (noPathsMsg) noPathsMsg.remove();
          pathInput.value = '';
        })
        .catch(function (err) { alert(err.message); });
    });
  }

  // Delete path
  window.deletePath = function (id) {
    if (!confirm('Remove this path?')) return;
    fetch('/api/paths/' + id, { method: 'DELETE' })
      .then(function (res) {
        if (res.ok) {
          var el = document.querySelector('[data-path-id="' + id + '"]');
          if (el) el.remove();
        }
      })
      .catch(function (err) { alert('Failed: ' + err.message); });
  };

  // Scan library (fire-and-forget, progress shown via toast)
  window.scanLibrary = function () {
    scanBtn.disabled = true;
    scanBtn.textContent = 'Scan started';
    scanStatus.textContent = '';

    // Start polling immediately — don't wait for POST response
    if (window.startScanPolling) {
      window.startScanPolling();
    }

    var fullRescan = document.getElementById('full-rescan');
    fetch('/api/library/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullRescan: fullRescan ? fullRescan.checked : false }),
    })
      .then(function () {})
      .catch(function (err) {
        scanStatus.textContent = 'Failed to start scan: ' + err.message;
        scanStatus.className = 'text-sm text-red-400';
      })
      .finally(function () {
        setTimeout(function () {
          scanBtn.disabled = false;
          scanBtn.textContent = 'Scan Library';
        }, 2000);
      });
  };

  // Change password
  if (passwordForm) {
    passwordForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var currentPassword = document.getElementById('current-password').value;
      var newPassword = document.getElementById('new-password').value;

      fetch('/api/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: currentPassword, newPassword: newPassword }),
      })
        .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); })
        .then(function (result) {
          if (result.ok) {
            passwordStatus.textContent = 'Password updated!';
            passwordStatus.className = 'text-sm text-green-400';
            passwordForm.reset();
          } else {
            passwordStatus.textContent = result.data.error || 'Failed';
            passwordStatus.className = 'text-sm text-red-400';
          }
        })
        .catch(function (err) {
          passwordStatus.textContent = 'Failed: ' + err.message;
          passwordStatus.className = 'text-sm text-red-400';
        });
    });
  }

})();
