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

  // --- Metadata editing ---
  var metaForm = document.getElementById('video-meta-form');
  var metaStatus = document.getElementById('meta-save-status');

  if (metaForm) {
    metaForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var body = {};
      var inputs = metaForm.querySelectorAll('input[name]:not([disabled])');
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
