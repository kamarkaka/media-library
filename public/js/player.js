(function () {
  var video = document.getElementById('video-player');
  if (!video) return;

  var videoId = video.dataset.videoId;
  var resumePosition = parseFloat(video.dataset.resumePosition) || 0;
  var playPauseBtn = document.getElementById('play-pause-btn');
  var playIcon = document.getElementById('play-icon');
  var pauseIcon = document.getElementById('pause-icon');
  var hasResumed = false;

  // Resume position without autoplay
  if (resumePosition > 0) {
    video.addEventListener('loadedmetadata', function () {
      video.currentTime = resumePosition;
    }, { once: true });
  }

  // Play/pause button
  function updatePlayPauseIcon() {
    if (video.paused) {
      playIcon.classList.remove('hidden');
      pauseIcon.classList.add('hidden');
    } else {
      playIcon.classList.add('hidden');
      pauseIcon.classList.remove('hidden');
    }
  }

  if (playPauseBtn) {
    playPauseBtn.addEventListener('click', function () {
      if (video.paused) { video.play(); } else { video.pause(); }
    });
  }

  video.addEventListener('play', updatePlayPauseIcon);
  video.addEventListener('pause', updatePlayPauseIcon);
  video.addEventListener('ended', updatePlayPauseIcon);

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

  // Log: snapshot every 30 seconds during playback
  var snapshotInterval = setInterval(function () {
    if (!video.paused && !video.ended) {
      logEvent('snapshot', video.currentTime);
    }
  }, 30000);

  video.addEventListener('ended', function () {
    clearInterval(snapshotInterval);
  });

  // Log: prev/next — intercept transport bar links
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
})();
