(function () {
  var video = document.getElementById('video-player');
  if (!video) return;

  var videoId = video.dataset.videoId;
  var resumePosition = parseFloat(video.dataset.resumePosition) || 0;
  var hasResumed = false;

  // Resume position without autoplay
  if (resumePosition > 0) {
    video.addEventListener('loadedmetadata', function () {
      video.currentTime = resumePosition;
    }, { once: true });
  }

  // --- Playback logging ---

  // Log: start or resume
  video.addEventListener('play', function () {
    if (resumePosition > 0 && !hasResumed) {
      hasResumed = true;
      logEvent('resume', video.currentTime);
    } else {
      logEvent('start', video.currentTime);
    }
  });

  // Log: pause (but not when video ends)
  video.addEventListener('pause', function () {
    if (!video.ended) {
      logEvent('pause', video.currentTime);
    }
  });

  // Log: snapshot every 10 seconds during playback
  var snapshotInterval = setInterval(function () {
    if (!video.paused && !video.ended) {
      logEvent('snapshot', video.currentTime);
    }
  }, 10000);

  video.addEventListener('ended', function () {
    clearInterval(snapshotInterval);
  });

  // Log: prev/next — intercept overlay nav links
  document.querySelectorAll('a[href^="/player/"]').forEach(function (link) {
    link.addEventListener('click', function () {
      var isPrev = link.title && link.title.startsWith('Previous');
      var isNext = link.title && link.title.startsWith('Next');
      if (isPrev || isNext) {
        var event = isPrev ? 'prev' : 'next';
        navigator.sendBeacon(
          '/api/playback/' + videoId + '/log',
          new Blob([JSON.stringify({ event: event, position: video.currentTime })], { type: 'application/json' })
        );
      }
    });
  });

  // --- Position saving ---

  var lastSaved = resumePosition;
  var saveInterval = setInterval(function () {
    if (!video.paused && !video.ended && Math.abs(video.currentTime - lastSaved) > 2) {
      savePosition(video.currentTime);
      lastSaved = video.currentTime;
    }
  }, 5000);

  video.addEventListener('pause', function () {
    savePosition(video.currentTime);
  });

  window.addEventListener('beforeunload', function () {
    clearInterval(saveInterval);
    clearInterval(snapshotInterval);
    var data = JSON.stringify({ position: video.currentTime });
    navigator.sendBeacon('/api/playback/' + videoId, new Blob([data], { type: 'application/json' }));
  });

  video.addEventListener('ended', function () {
    clearInterval(saveInterval);
    savePosition(video.currentTime);
  });

  function savePosition(position) {
    fetch('/api/playback/' + videoId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position: position }),
    }).catch(function (err) {
      console.error('Failed to save position:', err);
    });
  }

  function logEvent(event, position) {
    fetch('/api/playback/' + videoId + '/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: event, position: position }),
    }).catch(function (err) {
      console.error('Failed to log event:', err);
    });
  }

  // --- Metadata toggle ---
  var metaToggle = document.getElementById('metadata-toggle');
  var metaContent = document.getElementById('metadata-content');
  var metaChevron = document.getElementById('metadata-chevron');

  if (metaToggle && metaContent) {
    metaToggle.addEventListener('click', function () {
      var isHidden = metaContent.style.display === 'none';
      metaContent.style.display = isHidden ? 'grid' : 'none';
      metaChevron.classList.toggle('rotate-90', isHidden);
    });
  }

  // --- Tag autocomplete ---
  var tagCache = {};

  function fetchTags(type, callback) {
    if (tagCache[type]) return callback(tagCache[type]);
    fetch('/api/' + type)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        tagCache[type] = data;
        callback(data);
      })
      .catch(function () { callback([]); });
  }

  function setupAutocomplete(input) {
    var type = input.dataset.autocomplete;
    var dropdown = document.getElementById(type + '-dropdown');
    var selectedIndex = -1;

    function showDropdown(items) {
      if (items.length === 0) { dropdown.classList.add('hidden'); return; }
      dropdown.innerHTML = '';
      items.forEach(function (item, i) {
        var div = document.createElement('div');
        div.className = 'px-2 py-1.5 text-sm text-gray-200 cursor-pointer hover:bg-gray-600';
        div.textContent = item.name;
        div.addEventListener('mousedown', function (e) {
          e.preventDefault();
          input.value = item.name;
          dropdown.classList.add('hidden');
          addVideoTag(type, input.id, type + '-tags');
        });
        dropdown.appendChild(div);
      });
      dropdown.classList.remove('hidden');
      selectedIndex = -1;
    }

    function updateHighlight() {
      var children = dropdown.children;
      for (var i = 0; i < children.length; i++) {
        children[i].classList.toggle('bg-gray-600', i === selectedIndex);
      }
    }

    input.addEventListener('input', function () {
      var query = input.value.trim().toLowerCase();
      if (!query) { dropdown.classList.add('hidden'); return; }
      fetchTags(type, function (all) {
        var existing = {};
        document.querySelectorAll('#' + type + '-tags [data-tag-id]').forEach(function (el) {
          existing[el.dataset.tagId] = true;
        });
        var filtered = all.filter(function (t) {
          return t.name.toLowerCase().indexOf(query) !== -1 && !existing[t.id];
        });
        showDropdown(filtered.slice(0, 10));
      });
    });

    input.addEventListener('keydown', function (e) {
      var children = dropdown.children;
      if (dropdown.classList.contains('hidden') || children.length === 0) {
        if (e.key === 'Enter') {
          e.preventDefault();
          addVideoTag(type, input.id, type + '-tags');
        }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, children.length - 1);
        updateHighlight();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        updateHighlight();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedIndex >= 0 && children[selectedIndex]) {
          input.value = children[selectedIndex].textContent;
          dropdown.classList.add('hidden');
          addVideoTag(type, input.id, type + '-tags');
        } else {
          addVideoTag(type, input.id, type + '-tags');
        }
      } else if (e.key === 'Escape') {
        dropdown.classList.add('hidden');
      }
    });

    input.addEventListener('blur', function () {
      setTimeout(function () { dropdown.classList.add('hidden'); }, 150);
    });
  }

  document.querySelectorAll('[data-autocomplete]').forEach(setupAutocomplete);

  // --- Video tag management (genres/cast) ---
  window.removeVideoTag = function (type, tagId, btn) {
    fetch('/api/videos/' + videoId + '/' + type + '/' + tagId, { method: 'DELETE' })
      .then(function (res) {
        if (res.ok) btn.closest('[data-tag-id]').remove();
      })
      .catch(function (err) { alert('Failed: ' + err.message); });
  };

  window.addVideoTag = function (type, inputId, containerId) {
    var input = document.getElementById(inputId);
    var name = input.value.trim();
    if (!name) return;

    fetch('/api/videos/' + videoId + '/' + type, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name }),
    })
      .then(function (res) {
        if (!res.ok) return res.json().then(function (d) { throw new Error(d.error); });
        return res.json();
      })
      .then(function (tag) {
        var container = document.getElementById(containerId);
        var span = document.createElement('span');
        span.className = 'inline-flex items-center gap-1 bg-gray-700 text-gray-200 px-2 py-1 rounded-full text-xs';
        span.dataset.tagId = tag.id;
        span.innerHTML = escapeHtml(tag.name) +
          '<button type="button" onclick="removeVideoTag(\'' + type + '\', ' + tag.id + ', this)" class="text-gray-500 hover:text-red-400 transition-colors">' +
          '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>' +
          '</button>';
        var inserted = false;
        var existing = container.querySelectorAll('[data-tag-id]');
        for (var i = 0; i < existing.length; i++) {
          if (existing[i].textContent.trim().localeCompare(tag.name) > 0) {
            container.insertBefore(span, existing[i]);
            inserted = true;
            break;
          }
        }
        if (!inserted) container.appendChild(span);
        input.value = '';
        delete tagCache[type];
        var dd = document.getElementById(type + '-dropdown');
        if (dd) dd.classList.add('hidden');
      })
      .catch(function (err) { alert(err.message); });
  };

  // --- Metadata editing ---
  var metaForm = document.getElementById('video-meta-form');
  var metaStatus = document.getElementById('meta-save-status');

  if (metaForm) {
    metaForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var body = {};
      var inputs = metaForm.querySelectorAll('input[name]:not([disabled]), select[name]');
      inputs.forEach(function (input) {
        body[input.name] = input.value;
      });

      metaStatus.textContent = 'Saving...';
      metaStatus.className = 'text-sm text-gray-400';

      fetch('/api/videos/' + videoId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); })
        .then(function (result) {
          if (result.ok) {
            metaStatus.textContent = 'Saved!';
            metaStatus.className = 'text-sm text-green-400';
          } else {
            metaStatus.textContent = result.data.error || 'Failed';
            metaStatus.className = 'text-sm text-red-400';
          }
          setTimeout(function () { metaStatus.textContent = ''; }, 3000);
        })
        .catch(function (err) {
          metaStatus.textContent = 'Failed: ' + err.message;
          metaStatus.className = 'text-sm text-red-400';
        });
    });
  }
})();
