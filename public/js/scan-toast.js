(function () {
  var toast = document.getElementById('scan-toast');
  var toastCount = document.getElementById('scan-toast-count');
  var toastFile = document.getElementById('scan-toast-file');
  var toastStep = document.getElementById('scan-toast-step');
  var toastBar = document.getElementById('scan-toast-bar');
  var toastClose = document.getElementById('scan-toast-close');
  var toastSpinner = document.getElementById('scan-toast-spinner');
  if (!toast) return;

  var SPINNER_SVG = '<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>';
  var CHECK_SVG = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />';

  var polling = false;
  var hideTimer = null;
  var idleRetries = 0;
  var maxIdleRetries = 10; // keep polling up to 5s if still idle (scan hasn't started yet)

  function setSpinnerDone() {
    if (!toastSpinner) return;
    toastSpinner.classList.remove('animate-spin', 'text-blue-400');
    toastSpinner.classList.add('text-green-400');
    toastSpinner.innerHTML = CHECK_SVG;
    toastSpinner.setAttribute('stroke', 'currentColor');
  }

  function setSpinnerActive() {
    if (!toastSpinner) return;
    toastSpinner.classList.add('animate-spin', 'text-blue-400');
    toastSpinner.classList.remove('text-green-400');
    toastSpinner.innerHTML = SPINNER_SVG;
    toastSpinner.removeAttribute('stroke');
  }

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
          setSpinnerDone();
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
    setSpinnerActive();
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
