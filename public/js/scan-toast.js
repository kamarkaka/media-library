(function () {
  var toast = document.getElementById('scan-toast');
  var toastPhase = document.getElementById('scan-toast-phase');
  var toastDetail = document.getElementById('scan-toast-detail');
  var toastBar = document.getElementById('scan-toast-bar');
  var toastClose = document.getElementById('scan-toast-close');
  if (!toast) return;

  var polling = false;
  var hideTimer = null;

  function show() {
    toast.classList.remove('hidden');
    toast.classList.remove('opacity-0');
    toast.classList.add('opacity-100');
  }

  function hide() {
    toast.classList.add('opacity-0');
    setTimeout(function () { toast.classList.add('hidden'); }, 300);
  }

  if (toastClose) {
    toastClose.addEventListener('click', function () {
      hide();
      polling = false;
    });
  }

  function poll() {
    fetch('/api/library/scan/status')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.status === 'scanning') {
          show();
          var pct = data.total > 0 ? Math.round(data.processed / data.total * 100) : 0;
          toastPhase.textContent = data.phase || 'Scanning...';
          toastDetail.textContent = data.processed + ' / ' + data.total + (data.currentFile ? ' — ' + data.currentFile : '');
          toastBar.style.width = pct + '%';
          setTimeout(poll, 500);
        } else if (data.status === 'done') {
          toastPhase.textContent = 'Scan complete';
          toastDetail.textContent = 'Added ' + data.added + ', removed ' + data.removed + ' videos';
          toastBar.style.width = '100%';
          show();
          polling = false;
          hideTimer = setTimeout(hide, 5000);
        } else if (data.status === 'error') {
          toastPhase.textContent = 'Scan failed';
          toastDetail.textContent = data.error || 'Unknown error';
          toastBar.style.width = '0%';
          show();
          polling = false;
          hideTimer = setTimeout(hide, 8000);
        } else {
          polling = false;
        }
      })
      .catch(function () {
        polling = false;
      });
  }

  // Start polling (called from settings page or on page load)
  window.startScanPolling = function () {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (!polling) {
      polling = true;
      poll();
    }
  };

  // Check on every page load if a scan is running
  fetch('/api/library/scan/status')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.status === 'scanning') {
        window.startScanPolling();
      }
    })
    .catch(function () {});
})();
