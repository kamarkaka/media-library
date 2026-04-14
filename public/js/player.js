(function () {
  var video = document.getElementById('video-player');
  if (!video) return;

  var videoId = video.dataset.videoId;
  var resumePosition = parseFloat(video.dataset.resumePosition) || 0;
  var playPauseBtn = document.getElementById('play-pause-btn');
  var playIcon = document.getElementById('play-icon');
  var pauseIcon = document.getElementById('pause-icon');

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

  // Periodically save position
  var lastSaved = resumePosition;
  var saveInterval = setInterval(function () {
    if (!video.paused && !video.ended && Math.abs(video.currentTime - lastSaved) > 2) {
      savePosition(video.currentTime);
      lastSaved = video.currentTime;
    }
  }, 5000);

  // Save on pause
  video.addEventListener('pause', function () {
    savePosition(video.currentTime);
  });

  // Save on page unload
  window.addEventListener('beforeunload', function () {
    // Use sendBeacon for reliable delivery during unload
    var data = JSON.stringify({ position: video.currentTime });
    navigator.sendBeacon('/api/playback/' + videoId, new Blob([data], { type: 'application/json' }));
  });

  // Cleanup on video end
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
})();
