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
      var scraperSelect = document.getElementById('default-scraper');
      if (scraperSelect) body.scraperType = scraperSelect.value;
    }

    var busyTexts = { scan: 'Scanning...', scrape: 'Scraping...', 'cover-download': 'Downloading...' };
    var defaultTexts = { scan: 'Scan Library', scrape: 'Scrape Metadata', 'cover-download': 'Download Cover Images' };
    var busyText = busyTexts[type] || 'Processing...';
    var defaultText = defaultTexts[type] || type;

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
  window.setCoverDownloadButtonBusy = function (busy) {
    setButtonBusy('cover-download-btn', busy, 'Downloading...', 'Download Cover Images');
  };

  // --- Validate scraper ---
  window.validateAllScrapers = function () {
    var btn = document.getElementById('validate-btn');
    var statusEl = document.getElementById('validate-status');
    var resultsEl = document.getElementById('validate-results');

    setButtonBusy('validate-btn', true, 'Validating...', 'Validate All Scrapers');
    statusEl.textContent = 'Running validation on all scrapers...';
    statusEl.className = 'text-sm text-gray-400';
    resultsEl.classList.add('hidden');

    fetch('/api/library/validate-all', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        setButtonBusy('validate-btn', false, 'Validating...', 'Validate All Scrapers');

        if (data.error) {
          statusEl.textContent = data.error;
          statusEl.className = 'text-sm text-yellow-400';
          return;
        }

        var scrapers = Object.keys(data.results);
        var allPass = scrapers.every(function (s) { return data.results[s].success; });
        statusEl.textContent = allPass ? 'All PASS' : 'Some FAILED';
        statusEl.className = 'text-sm ' + (allPass ? 'text-green-400' : 'text-red-400');

        var html = '';
        scrapers.forEach(function (name) {
          var r = data.results[name];
          var badge = r.success ? '<span class="px-2 py-0.5 rounded text-xs font-medium bg-green-900 text-green-300">PASS</span>'
            : '<span class="px-2 py-0.5 rounded text-xs font-medium bg-red-900 text-red-300">' + (r.error ? 'ERROR' : 'FAIL') + '</span>';
          html += '<div class="border-b border-gray-700 last:border-0 py-2">';
          html += '<div class="flex items-center gap-2">' + badge + '<span class="text-sm text-gray-300">' + escapeHtml(name) + '</span></div>';
          if (r.error) {
            html += '<p class="text-xs text-red-400 mt-1">' + escapeHtml(r.error) + '</p>';
          } else if (r.fields && r.fields.length > 0) {
            html += '<table class="w-full text-xs mt-1"><thead><tr class="text-gray-500"><th class="text-left py-1">Field</th><th class="text-left py-1">Expected</th><th class="text-left py-1">Actual</th><th class="text-left py-1"></th></tr></thead><tbody>';
            r.fields.forEach(function (f) {
              var expected = Array.isArray(f.expected) ? f.expected.join(', ') : (f.expected || '—');
              var actual = Array.isArray(f.actual) ? f.actual.join(', ') : (f.actual || '—');
              var icon = f.match ? '<span class="text-green-400">✓</span>' : '<span class="text-red-400">✗</span>';
              html += '<tr class="border-t border-gray-700"><td class="py-1 text-gray-300">' + escapeHtml(f.field) + '</td><td class="py-1 text-gray-400">' + escapeHtml(expected) + '</td><td class="py-1 text-gray-400">' + escapeHtml(actual) + '</td><td class="py-1">' + icon + '</td></tr>';
            });
            html += '</tbody></table>';
          }
          html += '</div>';
        });
        resultsEl.innerHTML = html;
        resultsEl.classList.remove('hidden');
      })
      .catch(function (err) {
        setButtonBusy('validate-btn', false, 'Validating...', 'Validate All Scrapers');
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

  // Coverage test
  window.startCoverage = function () {
    var statusEl = document.getElementById('coverage-status');
    setButtonBusy('coverage-btn', true, 'Running...', 'Run Coverage Test');
    statusEl.textContent = '';

    if (window.startScanPolling) {
      window.startScanPolling('coverage');
    }

    fetch('/api/library/coverage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume: true }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.success) {
          statusEl.textContent = data.message || 'Already in progress';
          statusEl.className = 'text-sm text-yellow-400';
        }
      })
      .catch(function (err) {
        statusEl.textContent = 'Failed: ' + err.message;
        statusEl.className = 'text-sm text-red-400';
        setButtonBusy('coverage-btn', false, 'Running...', 'Run Coverage Test');
      });
  };

  window.setCoverageButtonBusy = function (busy) {
    setButtonBusy('coverage-btn', busy, 'Running...', 'Run Coverage Test');
    if (!busy) {
      // Reload coverage results
      fetch('/api/library/coverage/results')
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var container = document.getElementById('coverage-results');
          if (!container || !data.results || data.results.length === 0) return;
          var html = '<table class="w-full text-sm mt-2">';
          html += '<thead><tr class="text-gray-500"><th class="text-left py-1">Scraper</th><th class="text-right py-1">Hits</th><th class="text-right py-1">Tested</th><th class="text-right py-1">Coverage</th></tr></thead><tbody>';
          data.results.forEach(function (r) {
            var pct = r.tested > 0 ? (r.hits / r.tested * 100).toFixed(1) : '0.0';
            var color = r.tested > 0 && r.hits / r.tested >= 0.8 ? 'text-green-400' : r.tested > 0 && r.hits / r.tested >= 0.5 ? 'text-yellow-400' : 'text-red-400';
            html += '<tr class="border-t border-gray-700"><td class="py-1 text-gray-300">' + escapeHtml(r.scraper) + '</td><td class="py-1 text-gray-300 text-right">' + r.hits + '</td><td class="py-1 text-gray-400 text-right">' + r.tested + '</td><td class="py-1 text-right"><span class="' + color + '">' + pct + '%</span></td></tr>';
          });
          html += '</tbody></table>';
          container.innerHTML = html;
        })
        .catch(function () {});
    }
  };

  // Batch replace — populate source dropdowns only
  function populateSourceDropdown(type) {
    var endpoint = type === 'genres' ? '/api/genres' : '/api/cast';
    var sourceEl = document.getElementById(type === 'genres' ? 'genre-source' : 'cast-source');
    if (!sourceEl) return;
    fetch(endpoint)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var items = data.map(function (item) { return typeof item === 'string' ? item : item.name; });
        items.forEach(function (name) {
          var opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name;
          sourceEl.appendChild(opt);
        });
      })
      .catch(function () {});
  }
  populateSourceDropdown('genres');
  populateSourceDropdown('cast');

  window.batchReplace = function (type) {
    var prefix = type === 'genres' ? 'genre' : 'cast';
    var sourceEl = document.getElementById(prefix + '-source');
    var destEl = document.getElementById(prefix + '-dest');
    var statusEl = document.getElementById(prefix + '-replace-status');
    var source = sourceEl.value;
    var destination = destEl.value.trim();

    if (!source || !destination) {
      statusEl.textContent = 'Enter both source and destination';
      statusEl.className = 'text-sm text-yellow-400';
      return;
    }
    if (source === destination) {
      statusEl.textContent = 'Source and destination must be different';
      statusEl.className = 'text-sm text-yellow-400';
      return;
    }

    setButtonBusy(prefix + '-replace-btn', true, 'Replacing...', 'Replace');
    statusEl.textContent = 'Processing...';
    statusEl.className = 'text-sm text-gray-400';

    fetch('/api/library/batch-replace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: type, source: source, destination: destination }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        setButtonBusy(prefix + '-replace-btn', false, 'Replacing...', 'Replace');
        if (data.error) {
          statusEl.textContent = 'Error: ' + data.error;
          statusEl.className = 'text-sm text-red-400';
        } else {
          statusEl.textContent = 'Replaced ' + data.replaced + ' videos';
          statusEl.className = 'text-sm text-green-400';
        }
      })
      .catch(function (err) {
        setButtonBusy(prefix + '-replace-btn', false, 'Replacing...', 'Replace');
        statusEl.textContent = 'Failed: ' + err.message;
        statusEl.className = 'text-sm text-red-400';
      });
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

  // Default scraper
  var defaultScraperSelect = document.getElementById('default-scraper');
  var defaultScraperStatus = document.getElementById('default-scraper-status');
  if (defaultScraperSelect) {
    defaultScraperSelect.addEventListener('change', function () {
      fetch('/api/library/settings/default-scraper', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scraper: defaultScraperSelect.value }),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          defaultScraperStatus.textContent = data.success ? 'Saved' : (data.error || 'Failed');
          defaultScraperStatus.className = 'text-sm ' + (data.success ? 'text-green-400' : 'text-red-400');
          setTimeout(function () { defaultScraperStatus.textContent = ''; }, 2000);
        })
        .catch(function (err) {
          defaultScraperStatus.textContent = 'Failed: ' + err.message;
          defaultScraperStatus.className = 'text-sm text-red-400';
        });
    });
  }

  // Database refresh
  window.dbRefresh = function () {
    var statusEl = document.getElementById('db-refresh-status');
    setButtonBusy('db-refresh-btn', true, 'Refreshing...', 'Refresh Database');
    fetch('/api/library/db-refresh', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        setButtonBusy('db-refresh-btn', false, 'Refreshing...', 'Refresh Database');
        statusEl.textContent = data.success ? 'Done' : (data.error || 'Failed');
        statusEl.className = 'text-sm ' + (data.success ? 'text-green-400' : 'text-red-400');
        setTimeout(function () { statusEl.textContent = ''; }, 2000);
      })
      .catch(function (err) {
        setButtonBusy('db-refresh-btn', false, 'Refreshing...', 'Refresh Database');
        statusEl.textContent = 'Failed: ' + err.message;
        statusEl.className = 'text-sm text-red-400';
      });
  };

  // Change password
  if (passwordForm) {
    passwordForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var currentPassword = document.getElementById('current-password').value;
      var newPassword = document.getElementById('new-password').value;
      var confirmPassword = document.getElementById('confirm-password').value;

      if (newPassword !== confirmPassword) {
        passwordStatus.textContent = 'Passwords do not match';
        passwordStatus.className = 'text-sm text-red-400';
        return;
      }

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
