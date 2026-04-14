(function () {
  var toast = document.getElementById('scan-toast');
  var toastCount = document.getElementById('scan-toast-count');
  var toastFile = document.getElementById('scan-toast-file');
  var toastStep = document.getElementById('scan-toast-step');
  var toastBar = document.getElementById('scan-toast-bar');
  var toastClose = document.getElementById('scan-toast-close');
  if (!toast) return;

  var polling = false;
  var hideTimer = null;
  var idleRetries = 0;
  var maxIdleRetries = 10; // keep polling up to 5s if still idle (scan hasn't started yet)

  function stopScanPolling() {
    polling = false;
    if (window.setScanButtonBusy) window.setScanButtonBusy(false);
  }

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
    if (!polling) return;

    fetch('/api/library/scan/status')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!polling) return;

        if (data.status === 'scanning') {
          idleRetries = 0;
          show();
          var pct = data.total > 0 ? Math.round(data.processed / data.total * 100) : 0;

          if (data.total > 0) {
            toastCount.textContent = 'Processing ' + data.processed + ' / ' + data.total + ' files';
          } else {
            toastCount.textContent = data.step || 'Scanning...';
          }

          toastFile.textContent = data.currentFile || '';
          toastStep.textContent = data.step || '';
          toastBar.style.width = pct + '%';
          setTimeout(poll, 500);
        } else if (data.status === 'done') {
          toastCount.textContent = 'Scan complete';
          toastFile.textContent = 'Added ' + data.added + ', updated ' + data.updated + ', removed ' + data.removed;
          toastStep.textContent = '';
          toastBar.style.width = '100%';
          show();
          stopScanPolling();
          hideTimer = setTimeout(hide, 5000);
        } else if (data.status === 'error') {
          toastCount.textContent = 'Scan failed';
          toastFile.textContent = data.error || 'Unknown error';
          toastStep.textContent = '';
          toastBar.style.width = '0%';
          show();
          stopScanPolling();
          hideTimer = setTimeout(hide, 8000);
        } else {
          // idle — scan may not have started yet, retry a few times
          if (idleRetries < maxIdleRetries) {
            idleRetries++;
            show();
            toastCount.textContent = 'Starting scan...';
            toastFile.textContent = '';
            toastStep.textContent = '';
            toastBar.style.width = '0%';
            setTimeout(poll, 500);
          } else {
            stopScanPolling();
            hide();
          }
        }
      })
      .catch(function () {
        polling = false;
      });
  }

  window.startScanPolling = function () {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    idleRetries = 0;
    if (window.setScanButtonBusy) window.setScanButtonBusy(true);
    // Show toast immediately before any network round-trip
    toastCount.textContent = 'Starting scan...';
    toastFile.textContent = '';
    toastStep.textContent = '';
    toastBar.style.width = '0%';
    show();
    if (!polling) {
      polling = true;
      poll();
    }
  };

  // On page load, resume polling if a scan is active
  fetch('/api/library/scan/status')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.status === 'scanning') {
        window.startScanPolling();
      }
    })
    .catch(function () {});
})();
