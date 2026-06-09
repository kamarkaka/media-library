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
  var files = [];
  try { files = JSON.parse(decodeURIComponent(container.dataset.files || '%5B%5D')); } catch (e) {}
  var currentFileId = null;
  var hasResumed = false;
  var hlsInstance = null;

  // --- Initialize video source ---
  var resumed = false;
  function seekToResume() {
    if (resumed || resumePosition <= 0) return;
    resumed = true;
    video.currentTime = resumePosition;
  }

  // Load (or switch to) a source. Direct-play is decided PER FILE — each file carries its own flag.
  function loadSource(f) {
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    if (f) {
      directPlay = f.directPlay;
      streamUrl = f.streamUrl;
      hlsUrl = f.hlsUrl;
      currentFileId = f.id;
    }
    if (directPlay) {
      video.src = streamUrl;
    } else if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      hlsInstance = new Hls();
      hlsInstance.loadSource(hlsUrl);
      hlsInstance.attachMedia(video);
      hlsInstance.on(Hls.Events.MANIFEST_PARSED, function () {
        setupQualitySelector();
      });
      hlsInstance.on(Hls.Events.LEVEL_LOADED, function (_, data) {
        if (data.details && data.details.totalduration) {
          hlsDuration = data.details.totalduration;
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl;
    } else {
      video.src = streamUrl;
    }
  }

  // Switch the active source to file `f`, then seek to `seekTo` once playable (optionally resume play)
  function switchToFile(f, seekTo, autoplay) {
    loadSource(f);
    video.addEventListener('canplay', function once() {
      video.removeEventListener('canplay', once);
      if (seekTo > 0) { try { video.currentTime = seekTo; } catch (e) {} }
      if (autoplay) video.play();
    });
  }

  // Initial source: the default (alphabetically-first) file, else the container's single-file URLs
  var initialFile = files.length ? (files.filter(function (f) { return f.isDefault; })[0] || files[0]) : null;
  loadSource(initialFile);

  // Wait until the video is actually playable before seeking to resume position
  video.addEventListener('canplay', seekToResume, { once: true });

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

  // Single tap: toggle overlay. Double tap: play/pause.
  var tapTimer = null;
  video.addEventListener('click', function (e) {
    e.preventDefault();
    if (tapTimer) {
      clearTimeout(tapTimer);
      tapTimer = null;
      if (video.paused) { video.play(); } else { video.pause(); }
    } else {
      tapTimer = setTimeout(function () {
        tapTimer = null;
        if (controlsVisible) { hideControls(); } else { showControls(); }
      }, 250);
    }
  });

  // Swipe to seek (touch only)
  var touchStartX = 0;
  var touchStartTime = 0;
  var swiping = false;

  container.addEventListener('touchstart', function (e) {
    if (e.target.closest('#player-controls') || e.target.closest('#quality-wrapper') || e.target.closest('#file-wrapper')) return;
    touchStartX = e.touches[0].clientX;
    touchStartTime = Date.now();
    swiping = true;
  }, { passive: true });

  container.addEventListener('touchend', function (e) {
    if (!swiping) return;
    swiping = false;
    var dx = e.changedTouches[0].clientX - touchStartX;
    var dt = Date.now() - touchStartTime;
    // Require minimum 50px swipe within 500ms
    if (Math.abs(dx) > 50 && dt < 500) {
      if (dx > 0) {
        video.currentTime = Math.min(getDuration() || video.currentTime, video.currentTime + seekStep);
      } else {
        video.currentTime = Math.max(0, video.currentTime - seekStep);
      }
    }
  }, { passive: true });

  // touch-action: manipulation in CSS already prevents double-tap zoom

  video.addEventListener('play', updatePlayIcon);
  video.addEventListener('pause', updatePlayIcon);

  // Stick video to top while playing
  video.addEventListener('play', function () { container.classList.add('sticky-player'); });
  video.addEventListener('pause', function () { container.classList.remove('sticky-player'); });
  video.addEventListener('ended', function () { container.classList.remove('sticky-player'); });

  // HLS.js provides duration via level details before the video element does
  var hlsDuration = 0;
  function getDuration() {
    if (video.duration && isFinite(video.duration)) return video.duration;
    return hlsDuration || 0;
  }

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

  // Seek bar drag (handle only, not bar click)
  var seeking = false;

  function seekTo(e) {
    var d = getDuration();
    if (!d) return;
    var rect = seekBar.getBoundingClientRect();
    var pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    video.currentTime = pct * d;
  }

  if (seekHandle) {
    seekHandle.addEventListener('mousedown', function (e) {
      e.preventDefault();
      seeking = true;
    });
    document.addEventListener('mousemove', function (e) {
      if (seeking) seekTo(e);
    });
    document.addEventListener('mouseup', function () { if (seeking) { seeking = false; showControls(); } });

    seekHandle.addEventListener('touchstart', function (e) {
      e.stopPropagation();
      seeking = true;
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      if (seeking) seekTo(e.touches[0]);
    });
    document.addEventListener('touchend', function () { if (seeking) { seeking = false; showControls(); } });
  }

  // Fullscreen — iOS Safari only supports webkitEnterFullscreen on <video>, and requires playback
  var isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function enterFullscreen() {
    if (isiOS) {
      // Try standard API on the video element first (iPad Safari supports this)
      if (video.requestFullscreen) {
        video.requestFullscreen();
      } else if (video.webkitRequestFullscreen) {
        video.webkitRequestFullscreen();
      } else if (video.webkitEnterFullscreen) {
        video.webkitEnterFullscreen();
      }
      return;
    }
    if (container.requestFullscreen) {
      container.requestFullscreen();
    } else if (container.webkitRequestFullscreen) {
      container.webkitRequestFullscreen();
    }
  }

  function exitFullscreen() {
    if (video.webkitDisplayingFullscreen && video.webkitExitFullscreen) {
      video.webkitExitFullscreen();
      return;
    }
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  }

  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement || video.webkitDisplayingFullscreen);
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
    // iOS Safari fires these on the video element
    video.addEventListener('webkitbeginfullscreen', function () { onFsChange(); });
    video.addEventListener('webkitendfullscreen', function () { onFsChange(); });
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
    if (!video.paused && !seeking) {
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

  // --- File Selector (multiple files per entry) ---
  var btnFile = document.getElementById('btn-file');
  var fileMenu = document.getElementById('file-menu');
  var fileWrapper = document.getElementById('file-wrapper');

  function renderFileMenu() {
    if (!fileMenu) return;
    var html = '';
    files.forEach(function (f) {
      var active = f.id === currentFileId;
      html += '<div class="px-3 py-1.5 text-xs cursor-pointer hover:bg-gray-700 break-words ' +
        (active ? 'text-blue-400' : 'text-gray-300') + '" data-file-id="' + f.id + '">' + escapeHtml(f.filename) + '</div>';
    });
    fileMenu.innerHTML = html;
    fileMenu.querySelectorAll('[data-file-id]').forEach(function (el) {
      el.addEventListener('click', function () {
        var fid = el.dataset.fileId;
        if (fid === currentFileId) { fileMenu.classList.add('hidden'); return; }
        var f = files.filter(function (x) { return x.id === fid; })[0];
        if (!f) return;
        // Preserve playback position and play state across the switch
        switchToFile(f, video.currentTime, !video.paused);
        fileMenu.classList.add('hidden');
        renderFileMenu();
      });
    });
  }

  if (fileWrapper && btnFile && fileMenu && files.length > 1) {
    fileWrapper.classList.remove('hidden');
    btnFile.addEventListener('click', function (e) {
      e.stopPropagation();
      fileMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', function () { fileMenu.classList.add('hidden'); });
    renderFileMenu();
  }

  // --- Thumbnails ---
  var thumbCarousel = document.getElementById('thumbnail-carousel');
  var genThumbsBtn = document.getElementById('generate-thumbnails-btn');
  var thumbsStatus = document.getElementById('thumbnails-status');

  function renderThumbnails(fileGroups) {
    var multi = fileGroups.length > 1;
    var html = '';
    fileGroups.forEach(function (f) {
      if (multi) html += '<div class="text-xs text-gray-500 mb-1 truncate">' + escapeHtml(f.filename) + '</div>';
      html += '<div class="flex gap-2 overflow-x-auto pb-2 mb-2" style="scroll-snap-type: x mandatory;">';
      if (f.thumbnails && f.thumbnails.length) {
        f.thumbnails.forEach(function (th) {
          html += '<img src="' + th.url +
            '" loading="lazy" class="h-24 rounded cursor-pointer flex-shrink-0" style="scroll-snap-align: start;">';
        });
      } else {
        html += '<span class="text-xs text-gray-600 self-center">No thumbnails yet</span>';
      }
      html += '</div>';
    });
    thumbCarousel.innerHTML = html;
  }

  // --- Thumbnail lightbox: click/tap a thumbnail to view it at full size ---
  var lightbox = document.getElementById('thumb-lightbox');
  var lightboxImg = document.getElementById('thumb-lightbox-img');

  function openLightbox(src) {
    if (!lightbox || !lightboxImg) return;
    lightboxImg.src = src;
    lightbox.classList.remove('hidden');
    lightbox.classList.add('flex');
  }

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.classList.add('hidden');
    lightbox.classList.remove('flex');
    lightboxImg.src = '';
  }

  if (thumbCarousel) {
    thumbCarousel.addEventListener('click', function (e) {
      var img = e.target.closest('img');
      if (!img) return;
      openLightbox(img.src);
    });
  }

  if (lightbox) {
    // Tap/click anywhere outside the image (or press Escape) closes the popup
    lightbox.addEventListener('click', function (e) {
      if (e.target !== lightboxImg) closeLightbox();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !lightbox.classList.contains('hidden')) closeLightbox();
    });
  }

  // Initial render from the server-provided file list
  if (thumbCarousel) renderThumbnails(files);

  if (genThumbsBtn) {
    genThumbsBtn.addEventListener('click', function () {
      genThumbsBtn.disabled = true;
      genThumbsBtn.classList.add('opacity-50');
      genThumbsBtn.textContent = 'Generating…';
      thumbsStatus.textContent = 'Generating thumbnails for all files… this may take a moment';
      thumbsStatus.className = 'text-sm text-yellow-400';
      fetch('/api/videos/' + videoId + '/thumbnails', { method: 'POST' })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (result) {
          if (!result.ok) {
            thumbsStatus.textContent = result.data.error || 'Failed';
            thumbsStatus.className = 'text-sm text-red-400';
            return;
          }
          var groups = result.data.files || [];
          renderThumbnails(groups);
          // Keep the in-memory files' thumbnails in sync so a later carousel re-render is correct
          groups.forEach(function (g) {
            var f = files.filter(function (x) { return x.id === g.id; })[0];
            if (f) f.thumbnails = g.thumbnails;
          });
          var errs = result.data.errors || [];
          if (errs.length) {
            thumbsStatus.textContent = 'Done with ' + errs.length + ' error(s): ' + errs[0];
            thumbsStatus.className = 'text-sm text-yellow-400';
          } else {
            thumbsStatus.textContent = 'Done!';
            thumbsStatus.className = 'text-sm text-green-400';
          }
          genThumbsBtn.textContent = 'Re-generate';
        })
        .catch(function (err) {
          thumbsStatus.textContent = 'Failed: ' + err.message;
          thumbsStatus.className = 'text-sm text-red-400';
        })
        .finally(function () {
          genThumbsBtn.disabled = false;
          genThumbsBtn.classList.remove('opacity-50');
          if (genThumbsBtn.textContent === 'Generating…') genThumbsBtn.textContent = 'Generate';
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
    // URL fields: show as link or "—"
    ['cover_image'].forEach(function (field) {
      var input = detailsForm.querySelector('[name="' + field + '"]');
      var span = detailsView.querySelector('[data-view="' + field + '"]');
      if (input && span) {
        span.innerHTML = input.value
          ? '<a href="' + escapeHtml(input.value) + '" target="_blank" class="text-blue-400 hover:text-blue-300 truncate block max-w-xs">' + escapeHtml(input.value) + '</a>'
          : '—';
      }
    });
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

  window.clearAllTags = function (type) {
    var container = document.getElementById(type + '-tags');
    if (!container) return;
    var tags = container.querySelectorAll('[data-tag-id]');
    tags.forEach(function (tag) {
      var tagId = tag.dataset.tagId;
      fetch('/api/videos/' + videoId + '/' + type + '/' + tagId, { method: 'DELETE' })
        .catch(function () {});
      tag.remove();
    });
    delete tagCache[type];
    syncDetailsView();
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
        input.value = input.value.trim();
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
            // Reload cover image if changed
            var coverImg = document.querySelector('#video-container img[src*="/cover"]');
            if (coverImg && body.cover_image) {
              coverImg.src = '/api/videos/' + videoId + '/cover?' + Date.now();
            }
            // Reload genre/cast links in read-only view
            ['genres', 'cast'].forEach(function (type) {
              var span = detailsView.querySelector('[data-view="' + type + '"]');
              if (!span) return;
              var tags = document.querySelectorAll('#' + type + '-tags [data-tag-id]');
              var links = [];
              tags.forEach(function (el) {
                var name = el.textContent.trim();
                if (name) links.push('<a href="/?' + type + '=' + encodeURIComponent(name) + '" class="text-blue-400 hover:text-blue-300">' + escapeHtml(name) + '</a>');
              });
              span.innerHTML = links.length ? links.join(', ') : '—';
            });
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

  // --- Scrape Comparison ---
  var scrapeToggle = document.getElementById('scrape-compare-toggle');
  var scrapeContent = document.getElementById('scrape-compare-content');
  var scrapeChevron = document.getElementById('scrape-compare-chevron');
  var scrapeAllBtn = document.getElementById('scrape-all-btn');
  var scrapeAllStatus = document.getElementById('scrape-all-status');
  var comparisonTable = document.getElementById('scrape-comparison-table');
  var applyWrapper = document.getElementById('scrape-apply-wrapper');
  var applyBtn = document.getElementById('scrape-apply-btn');
  var applyStatus = document.getElementById('scrape-apply-status');
  var scrapeResults = null;

  if (scrapeToggle && scrapeContent) {
    scrapeToggle.addEventListener('click', function () {
      var isHidden = scrapeContent.style.display === 'none';
      scrapeContent.style.display = isHidden ? 'block' : 'none';
      scrapeChevron.classList.toggle('rotate-90', isHidden);
    });
  }

  var scrapeFields = [
    { key: 'code', label: 'Code', putKey: 'code' },
    { key: 'name', label: 'Name', putKey: 'name' },
    { key: 'releaseDate', label: 'Release Date', putKey: 'release_date' },
    { key: 'director', label: 'Director', putKey: 'director' },
    { key: 'maker', label: 'Maker', putKey: 'maker' },
    { key: 'label', label: 'Label', putKey: 'label' },
    { key: 'genres', label: 'Genres', putKey: 'genres' },
    { key: 'cast', label: 'Cast', putKey: 'cast' },
    { key: 'coverImage', label: 'Cover Image', putKey: 'cover_image' },
  ];

  if (scrapeAllBtn) {
    scrapeAllBtn.addEventListener('click', function () {
      var selected = [];
      document.querySelectorAll('.scraper-checkbox:checked').forEach(function (cb) {
        selected.push(cb.value);
      });
      if (selected.length === 0) {
        scrapeAllStatus.textContent = 'Select at least one scraper';
        scrapeAllStatus.className = 'text-sm text-yellow-400';
        return;
      }

      scrapeAllBtn.disabled = true;
      scrapeAllBtn.classList.add('opacity-50');
      scrapeAllStatus.innerHTML = '<span class="inline-block animate-spin mr-1">&#9696;</span> Scraping ' + selected.length + ' source(s)... this may take a minute';
      scrapeAllStatus.className = 'text-sm text-yellow-400';
      comparisonTable.classList.add('hidden');
      applyWrapper.classList.add('hidden');

      fetch('/api/videos/' + videoId + '/scrape-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scrapers: selected }),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.error) {
            scrapeAllStatus.textContent = data.error;
            scrapeAllStatus.className = 'text-sm text-red-400';
            return;
          }
          scrapeResults = data.results;
          scrapeAllStatus.textContent = 'Done!';
          scrapeAllStatus.className = 'text-sm text-green-400';
          renderComparisonTable(data.results);
        })
        .catch(function (err) {
          scrapeAllStatus.textContent = 'Failed: ' + err.message;
          scrapeAllStatus.className = 'text-sm text-red-400';
        })
        .finally(function () {
          scrapeAllBtn.disabled = false;
          scrapeAllBtn.classList.remove('opacity-50');
        });
    });
  }

  function renderComparisonTable(results) {
    var scraperNames = Object.keys(results);
    if (scraperNames.length === 0) {
      comparisonTable.innerHTML = '<p class="text-sm text-gray-500">No scrapers available.</p>';
      comparisonTable.classList.remove('hidden');
      return;
    }

    var html = '';

    scrapeFields.forEach(function (field) {
      // Collect scrapers that have a value for this field
      var options = [];
      scraperNames.forEach(function (name) {
        var meta = results[name];
        if (!meta) return;
        var val = meta[field.key];
        if (val === null || val === undefined || val === '' || (Array.isArray(val) && val.length === 0)) return;
        var displayVal;
        if (Array.isArray(val)) {
          displayVal = val.join(', ');
        } else if (field.key === 'coverImage' && String(val).length > 60) {
          displayVal = String(val).substring(0, 60) + '...';
        } else {
          displayVal = String(val);
        }
        options.push({ name: name, display: displayVal });
      });

      if (options.length === 0) return;

      html += '<div class="mb-3">';
      html += '<div class="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">' + field.label + '</div>';
      options.forEach(function (opt) {
        html += '<div class="scrape-option flex items-start gap-2 py-1.5 px-2 rounded cursor-pointer transition-colors text-gray-400 hover:bg-gray-700/50" data-field="' + field.key + '" data-scraper="' + escapeHtml(opt.name) + '">';
        html += '<span class="text-sm break-words min-w-0">' + escapeHtml(opt.display) + '</span>';
        html += '<span class="text-xs text-gray-600 flex-shrink-0 ml-auto">' + escapeHtml(opt.name) + '</span>';
        html += '</div>';
      });
      html += '</div>';
    });

    if (!html) {
      html = '<p class="text-sm text-gray-500">No results found from any scraper.</p>';
    }

    comparisonTable.innerHTML = html;
    comparisonTable.classList.remove('hidden');
    applyWrapper.classList.remove('hidden');

    // Toggle selection on click — clicking again deselects
    comparisonTable.querySelectorAll('.scrape-option').forEach(function (el) {
      el.addEventListener('click', function () {
        var field = el.dataset.field;
        var wasSelected = el.classList.contains('bg-blue-600/20');
        // Deselect all options for this field
        comparisonTable.querySelectorAll('.scrape-option[data-field="' + field + '"]').forEach(function (sib) {
          sib.classList.remove('bg-blue-600/20', 'text-white', 'border', 'border-blue-500/50');
          sib.classList.add('text-gray-400');
          delete sib.dataset.selected;
        });
        // Select this one (unless it was already selected — toggle off)
        if (!wasSelected) {
          el.classList.add('bg-blue-600/20', 'text-white', 'border', 'border-blue-500/50');
          el.classList.remove('text-gray-400');
          el.dataset.selected = '1';
        }
      });
    });
  }

  if (applyBtn) {
    applyBtn.addEventListener('click', function () {
      if (!scrapeResults) return;

      var body = {};
      var fieldSources = {};
      scrapeFields.forEach(function (field) {
        var selected = comparisonTable.querySelector('.scrape-option[data-field="' + field.key + '"][data-selected="1"]');
        if (selected) {
          var scraperName = selected.dataset.scraper;
          var meta = scrapeResults[scraperName];
          if (meta && meta[field.key] !== undefined && meta[field.key] !== null) {
            var val = meta[field.key];
            body[field.putKey] = Array.isArray(val) ? val.join(', ') : val;
            fieldSources[field.putKey] = scraperName;
          }
        }
      });
      if (Object.keys(fieldSources).length > 0) body.fieldSources = fieldSources;

      if (Object.keys(fieldSources).length === 0) {
        applyStatus.textContent = 'No fields selected';
        applyStatus.className = 'text-sm text-yellow-400 ml-2';
        return;
      }

      applyBtn.disabled = true;
      applyStatus.textContent = 'Applying...';
      applyStatus.className = 'text-sm text-gray-400 ml-2';

      fetch('/api/videos/' + videoId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (result) {
          if (result.ok) {
            applyStatus.textContent = 'Applied! Reloading...';
            applyStatus.className = 'text-sm text-green-400 ml-2';
            setTimeout(function () { location.reload(); }, 1000);
          } else {
            applyStatus.textContent = result.data.error || 'Failed';
            applyStatus.className = 'text-sm text-red-400 ml-2';
          }
        })
        .catch(function (err) {
          applyStatus.textContent = 'Failed: ' + err.message;
          applyStatus.className = 'text-sm text-red-400 ml-2';
        })
        .finally(function () {
          applyBtn.disabled = false;
        });
    });
  }
})();
