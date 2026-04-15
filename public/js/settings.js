(function () {
  var addForm = document.getElementById('add-path-form');
  var pathInput = document.getElementById('path-input');
  var pathList = document.getElementById('path-list');
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

  // --- Scan / Scrape jobs ---
  function setButtonBusy(btnId, busy, busyText, defaultText) {
    var btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = busy;
    btn.textContent = busy ? busyText : defaultText;
    if (busy) {
      btn.classList.add('opacity-50', 'cursor-not-allowed');
    } else {
      btn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
  }

  window.startJob = function (type) {
    var btnId = type + '-btn';
    var statusId = type + '-status';
    var fullCheckId = 'full-' + type;
    var btn = document.getElementById(btnId);
    var statusEl = document.getElementById(statusId);
    var fullCheck = document.getElementById(fullCheckId);

    if (btn.disabled) return;

    var isFull = fullCheck ? fullCheck.checked : false;
    var endpoint = '/api/library/' + type;
    var bodyKey = type === 'scan' ? 'fullScan' : 'fullScrape';
    var body = {};
    body[bodyKey] = isFull;

    var busyText = type === 'scan' ? 'Scanning...' : 'Scraping...';
    var defaultText = type === 'scan' ? 'Scan Library' : 'Scrape Metadata';

    setButtonBusy(btnId, true, busyText, defaultText);
    statusEl.textContent = '';

    if (window.startScanPolling) {
      window.startScanPolling(type);
    }

    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data.success) {
          statusEl.textContent = data.message || 'Already in progress';
          statusEl.className = 'text-sm text-yellow-400';
        }
      })
      .catch(function (err) {
        statusEl.textContent = 'Failed: ' + err.message;
        statusEl.className = 'text-sm text-red-400';
        setButtonBusy(btnId, false, busyText, defaultText);
      });
  };

  // Expose for scan-toast.js
  window.setScanButtonBusy = function (busy) {
    setButtonBusy('scan-btn', busy, 'Scanning...', 'Scan Library');
  };
  window.setScrapeButtonBusy = function (busy) {
    setButtonBusy('scrape-btn', busy, 'Scraping...', 'Scrape Metadata');
  };

  // Toggle switches
  function setupToggle(id) {
    var input = document.getElementById(id);
    var track = document.getElementById(id + '-track');
    var knob = document.getElementById(id + '-knob');
    if (!input || !track || !knob) return;
    function update() {
      if (input.checked) {
        track.classList.replace('bg-gray-600', 'bg-blue-500');
        knob.classList.add('translate-x-4');
      } else {
        track.classList.replace('bg-blue-500', 'bg-gray-600');
        knob.classList.remove('translate-x-4');
      }
    }
    input.addEventListener('change', update);
    update();
  }
  setupToggle('full-scan');
  setupToggle('full-scrape');

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
