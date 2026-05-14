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
    if (type === 'scrape') {
      var scraperSelect = document.getElementById('scraper-type');
      if (scraperSelect) body.scraperType = scraperSelect.value;
    }

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

  // --- Validate scraper ---
  window.validateScraper = function () {
    var btn = document.getElementById('validate-btn');
    var statusEl = document.getElementById('validate-status');
    var resultsEl = document.getElementById('validate-results');
    var scraperSelect = document.getElementById('validate-scraper-type');
    var scraperType = scraperSelect ? scraperSelect.value : '';

    btn.disabled = true;
    btn.textContent = 'Validating...';
    btn.classList.add('opacity-50', 'cursor-not-allowed');
    statusEl.textContent = 'Running validation...';
    statusEl.className = 'text-sm text-gray-400';
    resultsEl.classList.add('hidden');

    fetch('/api/library/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scraperType: scraperType }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        btn.disabled = false;
        btn.textContent = 'Validate Scraper';
        btn.classList.remove('opacity-50', 'cursor-not-allowed');

        if (data.error) {
          statusEl.textContent = data.error;
          statusEl.className = 'text-sm text-yellow-400';
          return;
        }

        statusEl.textContent = data.success ? 'PASS' : 'FAIL';
        statusEl.className = 'text-sm ' + (data.success ? 'text-green-400' : 'text-red-400');

        // Show field-by-field results
        var html = '<table class="w-full text-xs"><thead><tr class="text-gray-500"><th class="text-left py-1">Field</th><th class="text-left py-1">Expected</th><th class="text-left py-1">Actual</th><th class="text-left py-1">Result</th></tr></thead><tbody>';
        data.fields.forEach(function (f) {
          var expected = Array.isArray(f.expected) ? f.expected.join(', ') : (f.expected || '—');
          var actual = Array.isArray(f.actual) ? f.actual.join(', ') : (f.actual || '—');
          var icon = f.match ? '<span class="text-green-400">✓</span>' : '<span class="text-red-400">✗</span>';
          html += '<tr class="border-t border-gray-700"><td class="py-1 text-gray-300">' + f.field + '</td><td class="py-1 text-gray-400 truncate max-w-[200px]">' + escapeHtml(expected) + '</td><td class="py-1 text-gray-400 truncate max-w-[200px]">' + escapeHtml(actual) + '</td><td class="py-1">' + icon + '</td></tr>';
        });
        html += '</tbody></table>';
        resultsEl.innerHTML = html;
        resultsEl.classList.remove('hidden');
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = 'Validate Scraper';
        btn.classList.remove('opacity-50', 'cursor-not-allowed');
        statusEl.textContent = 'Failed: ' + err.message;
        statusEl.className = 'text-sm text-red-400';
      });
  };

  // Fix date formats
  window.fixDateFormats = function () {
    var btn = document.getElementById('fix-dates-btn');
    var statusEl = document.getElementById('fix-dates-status');
    btn.disabled = true;
    btn.textContent = 'Fixing...';
    btn.classList.add('opacity-50', 'cursor-not-allowed');
    statusEl.textContent = 'Processing...';
    statusEl.className = 'text-sm text-gray-400';

    fetch('/api/library/fix-dates', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        btn.disabled = false;
        btn.textContent = 'Fix Date Formats';
        btn.classList.remove('opacity-50', 'cursor-not-allowed');
        if (data.error) {
          statusEl.textContent = 'Error: ' + data.error;
          statusEl.className = 'text-sm text-red-400';
        } else {
          statusEl.textContent = 'Fixed ' + data.fixed + ' of ' + data.total + ' dates';
          statusEl.className = 'text-sm text-green-400';
        }
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = 'Fix Date Formats';
        btn.classList.remove('opacity-50', 'cursor-not-allowed');
        statusEl.textContent = 'Failed: ' + err.message;
        statusEl.className = 'text-sm text-red-400';
      });
  };

  // Auto-match videos
  window.autoMatchVideos = function () {
    var statusEl = document.getElementById('auto-match-status');
    setButtonBusy('auto-match-btn', true, 'Matching...', 'Auto-Match Videos');
    statusEl.textContent = 'Processing...';
    statusEl.className = 'text-sm text-gray-400';

    fetch('/api/library/auto-match', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        setButtonBusy('auto-match-btn', false, 'Matching...', 'Auto-Match Videos');
        if (data.error) {
          statusEl.textContent = 'Error: ' + data.error;
          statusEl.className = 'text-sm text-red-400';
        } else {
          statusEl.textContent = data.matched + ' matched, ' + data.unmatched + ' unmatched';
          statusEl.className = 'text-sm text-green-400';
        }
      })
      .catch(function (err) {
        setButtonBusy('auto-match-btn', false, 'Matching...', 'Auto-Match Videos');
        statusEl.textContent = 'Failed: ' + err.message;
        statusEl.className = 'text-sm text-red-400';
      });
  };

  // Expand/collapse validation details
  window.toggleValidationDetails = function (el) {
    var details = el.parentElement.querySelector('.validation-details');
    if (details) details.classList.toggle('hidden');
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

  // Seek step
  var seekStepSelect = document.getElementById('seek-step-select');
  var seekStepStatus = document.getElementById('seek-step-status');
  if (seekStepSelect) {
    seekStepSelect.addEventListener('change', function () {
      var step = seekStepSelect.value;
      fetch('/api/library/settings/seek-step', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: parseInt(step, 10) }),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          seekStepStatus.textContent = data.success ? 'Saved' : (data.error || 'Failed');
          seekStepStatus.className = 'text-sm ' + (data.success ? 'text-green-400' : 'text-red-400');
          setTimeout(function () { seekStepStatus.textContent = ''; }, 2000);
        })
        .catch(function (err) {
          seekStepStatus.textContent = 'Failed: ' + err.message;
          seekStepStatus.className = 'text-sm text-red-400';
        });
    });
  }

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
