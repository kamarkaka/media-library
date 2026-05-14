(function () {
  var video = document.getElementById('video-player');
  var container = document.getElementById('video-container');
  if (!video || !container) return;

  var videoId = container.dataset.videoId;
  var resumePosition = parseFloat(container.dataset.resumePosition) || 0;
  var seekStep = parseInt(container.dataset.seekStep, 10) || 10;
  var directPlay = container.dataset.directPlay === '1';
  var streamUrl = container.dataset.streamUrl;
  var hlsUrl = container.dataset.hlsUrl;
  var hasResumed = false;
  var hlsInstance = null;

  // --- Initialize video source ---
  function seekToResume() {
    if (resumePosition > 0 && video.duration && isFinite(video.duration)) {
      video.currentTime = Math.min(resumePosition, video.duration);
    }
  }

  if (directPlay) {
    video.src = streamUrl;
    video.addEventListener('loadedmetadata', seekToResume, { once: true });
  } else if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    hlsInstance = new Hls();
    hlsInstance.loadSource(hlsUrl);
    hlsInstance.attachMedia(video);
    // Wait for HLS manifest + media to be ready before seeking
    hlsInstance.on(Hls.Events.MANIFEST_PARSED, function () {
      setupQualitySelector();
    });
    hlsInstance.on(Hls.Events.LEVEL_LOADED, function () {
      seekToResume();
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = hlsUrl;
    video.addEventListener('loadedmetadata', seekToResume, { once: true });
  } else {
    video.src = streamUrl;
    video.addEventListener('loadedmetadata', seekToResume, { once: true });
  }

  // Duration may arrive late (especially with HLS) — update display when it changes
  video.addEventListener('durationchange', function () {
    if (video.duration && isFinite(video.duration)) {
      timeDisplay.textContent = formatTime(video.currentTime) + ' / ' + formatTime(video.duration);
    }
  });

  // --- Cover image overlay ---
  var coverOverlay = document.getElementById('cover-overlay');
  if (coverOverlay) {
    coverOverlay.addEventListener('click', function () {
      coverOverlay.classList.add('opacity-0');
      video.play();
      setTimeout(function () { coverOverlay.remove(); }, 500);
    });
    // Also hide cover if video starts playing by other means (e.g. native controls)
    video.addEventListener('play', function () {
      if (coverOverlay.parentNode) {
        coverOverlay.classList.add('opacity-0');
        setTimeout(function () { coverOverlay.remove(); }, 500);
      }
    }, { once: true });
  }

  // --- Custom Controls ---
  var controls = document.getElementById('player-controls');
  var btnPlay = document.getElementById('btn-play');
  var iconPlay = document.getElementById('icon-play');
  var iconPause = document.getElementById('icon-pause');
  var btnRewind = document.getElementById('btn-rewind');
  var btnForward = document.getElementById('btn-forward');
  var btnFullscreen = document.getElementById('btn-fullscreen');
  var iconFsEnter = document.getElementById('icon-fs-enter');
  var iconFsExit = document.getElementById('icon-fs-exit');
  var seekBar = document.getElementById('seek-bar');
  var seekProgress = document.getElementById('seek-progress');
  var seekBuffer = document.getElementById('seek-buffer');
  var seekHandle = document.getElementById('seek-handle');
  var timeDisplay = document.getElementById('time-display');

  function formatTime(s) {
    if (isNaN(s) || !isFinite(s)) return '0:00';
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = Math.floor(s % 60);
    if (h > 0) return h + ':' + (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function updatePlayIcon() {
    if (video.paused) {
      iconPlay.classList.remove('hidden');
      iconPause.classList.add('hidden');
      container.classList.add('paused');
    } else {
      iconPlay.classList.add('hidden');
      iconPause.classList.remove('hidden');
      container.classList.remove('paused');
    }
  }

  // Play/Pause
  if (btnPlay) {
    btnPlay.addEventListener('click', function () {
      if (video.paused) { video.play(); } else { video.pause(); }
    });
  }
  // Tap on video: toggle overlay visibility, not play/pause
  video.addEventListener('click', function () {
    if (controlsVisible) {
      hideControls();
    } else {
      showControls();
    }
  });
  video.addEventListener('play', updatePlayIcon);
  video.addEventListener('pause', updatePlayIcon);

  // Rewind / Forward
  function getDuration() { return (video.duration && isFinite(video.duration)) ? video.duration : 0; }
  if (btnRewind) btnRewind.addEventListener('click', function () { video.currentTime = Math.max(0, video.currentTime - seekStep); });
  if (btnForward) btnForward.addEventListener('click', function () { var d = getDuration(); if (d) video.currentTime = Math.min(d, video.currentTime + seekStep); });

  // Time + progress update
  video.addEventListener('timeupdate', function () {
    var d = getDuration();
    if (!d) return;
    var pct = (video.currentTime / d) * 100;
    seekProgress.style.width = pct + '%';
    seekHandle.style.left = 'calc(' + pct + '% - 6px)';
    timeDisplay.textContent = formatTime(video.currentTime) + ' / ' + formatTime(d);
  });

  // Buffer progress
  video.addEventListener('progress', function () {
    if (!video.duration || !video.buffered.length) return;
    var end = video.buffered.end(video.buffered.length - 1);
    seekBuffer.style.width = (end / video.duration * 100) + '%';
  });

  // Seek bar click/drag
  var seeking = false;

  function seekTo(e) {
    var d = getDuration();
    if (!d) return;
    var rect = seekBar.getBoundingClientRect();
    var pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    video.currentTime = pct * d;
  }

  if (seekBar) {
    seekBar.addEventListener('mousedown', function (e) {
      seeking = true;
      seekTo(e);
    });
    document.addEventListener('mousemove', function (e) {
      if (seeking) seekTo(e);
    });
    document.addEventListener('mouseup', function () { seeking = false; });

    // Touch support
    seekBar.addEventListener('touchstart', function (e) {
      seeking = true;
      seekTo(e.touches[0]);
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      if (seeking) seekTo(e.touches[0]);
    });
    document.addEventListener('touchend', function () { seeking = false; });
  }

  // Fullscreen — use webkitEnterFullscreen on iOS Safari (no Fullscreen API)
  function enterFullscreen() {
    if (container.requestFullscreen) {
      container.requestFullscreen();
    } else if (container.webkitRequestFullscreen) {
      container.webkitRequestFullscreen();
    } else if (video.webkitEnterFullscreen) {
      // iOS Safari: only the video element can go fullscreen
      video.webkitEnterFullscreen();
    }
  }

  function exitFullscreen() {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  }

  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  if (btnFullscreen) {
    btnFullscreen.addEventListener('click', function () {
      if (isFullscreen()) { exitFullscreen(); } else { enterFullscreen(); }
    });

    function onFsChange() {
      var fs = isFullscreen();
      iconFsEnter.classList.toggle('hidden', fs);
      iconFsExit.classList.toggle('hidden', !fs);
    }
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', function (e) {
    // Don't capture when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.key === ' ' || e.key === 'k') {
      e.preventDefault();
      if (video.paused) { video.play(); } else { video.pause(); }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      video.currentTime = Math.max(0, video.currentTime - seekStep);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      video.currentTime = Math.min(video.duration || 0, video.currentTime + seekStep);
    } else if (e.key === 'f') {
      e.preventDefault();
      if (isFullscreen()) { exitFullscreen(); } else { enterFullscreen(); }
    }
  });

  // Auto-hide controls after 3 seconds of inactivity
  var hideTimeout;
  var controlsVisible = false;

  function showControls() {
    controls.style.opacity = '1';
    controlsVisible = true;
    clearTimeout(hideTimeout);
    if (!video.paused) {
      hideTimeout = setTimeout(hideControls, 3000);
    }
  }

  function hideControls() {
    if (!video.paused) {
      controls.style.opacity = '0';
      controlsVisible = false;
    }
  }

  container.addEventListener('mousemove', showControls);
  container.addEventListener('mouseleave', hideControls);
  // Touch: handled by video click handler above

  // Show controls when paused, start hide timer when playing
  video.addEventListener('pause', showControls);
  video.addEventListener('play', function () {
    hideTimeout = setTimeout(hideControls, 3000);
  });

  // --- Quality Selector ---
  var btnQuality = document.getElementById('btn-quality');
  var qualityMenu = document.getElementById('quality-menu');

  function setupQualitySelector() {
    if (!hlsInstance || !btnQuality) return;
    btnQuality.classList.remove('hidden');

    btnQuality.addEventListener('click', function (e) {
      e.stopPropagation();
      qualityMenu.classList.toggle('hidden');
    });

    document.addEventListener('click', function () { qualityMenu.classList.add('hidden'); });

    hlsInstance.on(Hls.Events.LEVEL_SWITCHED, function (_, data) {
      var level = hlsInstance.levels[data.level];
      btnQuality.textContent = hlsInstance.autoLevelEnabled ? 'Auto' : (level.height + 'p');
    });

    renderQualityMenu();
  }

  function renderQualityMenu() {
    if (!hlsInstance) return;
    var html = '';
    var current = hlsInstance.currentLevel;

    html += '<div class="px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-700 ' + (current === -1 ? 'text-blue-400' : 'text-gray-300') + '" data-level="-1">Auto</div>';
    hlsInstance.levels.forEach(function (level, i) {
      var label = level.height + 'p';
      var active = current === i;
      html += '<div class="px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-700 ' + (active ? 'text-blue-400' : 'text-gray-300') + '" data-level="' + i + '">' + label + '</div>';
    });

    qualityMenu.innerHTML = html;
    qualityMenu.querySelectorAll('[data-level]').forEach(function (el) {
      el.addEventListener('click', function () {
        hlsInstance.currentLevel = parseInt(el.dataset.level, 10);
        qualityMenu.classList.add('hidden');
        renderQualityMenu();
      });
    });
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

  // --- Details view/edit toggle ---
  var detailsView = document.getElementById('details-view');
  var detailsForm = document.getElementById('video-meta-form');
  var editBtn = document.getElementById('details-edit-btn');

  window.showEditMode = function () {
    detailsView.style.display = 'none';
    detailsForm.style.display = '';
    editBtn.textContent = 'Cancel';
  }

  window.showViewMode = function () {
    detailsView.style.display = '';
    detailsForm.style.display = 'none';
    editBtn.textContent = 'Edit';
  }

  // Sync read-only view spans from form input values
  function syncDetailsView() {
    var fields = ['code', 'name', 'director', 'maker', 'label'];
    fields.forEach(function (field) {
      var input = detailsForm.querySelector('[name="' + field + '"]');
      var span = detailsView.querySelector('[data-view="' + field + '"]');
      if (input && span) span.textContent = input.value || '—';
    });
    // Release date — format to locale
    var dateInput = detailsForm.querySelector('[name="release_date"]');
    var dateSpan = detailsView.querySelector('[data-view="release_date"]');
    if (dateInput && dateSpan) {
      dateSpan.textContent = dateInput.value ? formatLocaleDate(dateInput.value) : '—';
    }
    // Cover image: show as link or "—"
    var coverInput = detailsForm.querySelector('[name="cover_image"]');
    var coverSpan = detailsView.querySelector('[data-view="cover_image"]');
    if (coverInput && coverSpan) {
      coverSpan.innerHTML = coverInput.value
        ? '<a href="' + escapeHtml(coverInput.value) + '" target="_blank" class="text-blue-400 hover:text-blue-300 truncate block max-w-xs">' + escapeHtml(coverInput.value) + '</a>'
        : '—';
    }
    // Genres and cast from tag containers
    ['genres', 'cast'].forEach(function (type) {
      var span = detailsView.querySelector('[data-view="' + type + '"]');
      if (!span) return;
      var tags = document.querySelectorAll('#' + type + '-tags [data-tag-id]');
      var names = [];
      tags.forEach(function (el) { names.push(el.textContent.trim()); });
      span.textContent = names.length ? names.join(', ') : '—';
    });
  }

  if (editBtn) {
    editBtn.addEventListener('click', function () {
      if (detailsForm.style.display === 'none') {
        showEditMode();
      } else {
        showViewMode();
      }
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

  // --- Matched toggle ---
  var matchedToggle = document.getElementById('matched-toggle');
  var matchedTrack = document.getElementById('matched-track');
  var matchedKnob = document.getElementById('matched-knob');

  function updateMatchedUI(checked) {
    matchedTrack.className = 'w-9 h-5 rounded-full transition-colors ' + (checked ? 'bg-green-500' : 'bg-gray-600');
    if (checked) { matchedKnob.classList.add('translate-x-4'); } else { matchedKnob.classList.remove('translate-x-4'); }
  }

  if (matchedToggle) {
    matchedToggle.addEventListener('change', function () {
      var checked = matchedToggle.checked;
      updateMatchedUI(checked);

      fetch('/api/videos/' + videoId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matched: checked ? 1 : 0 }),
      }).catch(function (err) {
        console.error('Failed to update matched:', err);
        matchedToggle.checked = !checked;
        updateMatchedUI(!checked);
      });
    });
  }

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
            syncDetailsView();
            showViewMode();
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
