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
  var activeJobType = null; // 'scan' or 'scrape'
  var hideTimer = null;
  var idleRetries = 0;
  var maxIdleRetries = 10;

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

  function stopPolling() {
    polling = false;
    var setBusy = activeJobType === 'scrape' ? window.setScrapeButtonBusy : window.setScanButtonBusy;
    if (setBusy) setBusy(false);
    activeJobType = null;
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

    var statusUrl = '/api/library/' + activeJobType + '/status';
    var label = activeJobType === 'scrape' ? 'Scrape' : 'Scan';

    fetch(statusUrl)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!polling) return;

        if (data.status === 'scanning') {
          idleRetries = 0;
          show();
          var pct = data.total > 0 ? Math.round(data.processed / data.total * 100) : 0;

          if (data.total > 0) {
            toastCount.textContent = label + ': ' + data.processed + ' / ' + data.total;
          } else {
            toastCount.textContent = data.step || label + '...';
          }

          toastFile.textContent = data.currentFile || '';
          toastStep.textContent = data.step || '';
          toastBar.style.width = pct + '%';
          setTimeout(poll, 500);
        } else if (data.status === 'done') {
          toastCount.textContent = label + ' complete';
          var summary = [];
          if (data.added) summary.push('Added ' + data.added);
          if (data.updated) summary.push('Updated ' + data.updated);
          if (data.removed) summary.push('Removed ' + data.removed);
          toastFile.textContent = summary.join(', ') || 'No changes';
          toastStep.textContent = '';
          toastBar.style.width = '100%';
          setSpinnerDone();
          show();
          stopPolling();
          hideTimer = setTimeout(hide, 5000);
        } else if (data.status === 'error') {
          toastCount.textContent = label + ' failed';
          toastFile.textContent = data.error || 'Unknown error';
          toastStep.textContent = '';
          toastBar.style.width = '0%';
          show();
          stopPolling();
          hideTimer = setTimeout(hide, 8000);
        } else {
          if (idleRetries < maxIdleRetries) {
            idleRetries++;
            show();
            toastCount.textContent = 'Starting ' + label.toLowerCase() + '...';
            toastFile.textContent = '';
            toastStep.textContent = '';
            toastBar.style.width = '0%';
            setTimeout(poll, 500);
          } else {
            stopPolling();
            hide();
          }
        }
      })
      .catch(function () {
        polling = false;
      });
  }

  // type: 'scan' or 'scrape'
  window.startScanPolling = function (type) {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    activeJobType = type || 'scan';
    idleRetries = 0;
    var setBusy = activeJobType === 'scrape' ? window.setScrapeButtonBusy : window.setScanButtonBusy;
    if (setBusy) setBusy(true);
    setSpinnerActive();
    toastCount.textContent = 'Starting ' + (activeJobType === 'scrape' ? 'scrape' : 'scan') + '...';
    toastFile.textContent = '';
    toastStep.textContent = '';
    toastBar.style.width = '0%';
    show();
    if (!polling) {
      polling = true;
      poll();
    }
  };

  // On page load, resume polling if a job is active
  function checkActiveJob(type) {
    fetch('/api/library/' + type + '/status')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.status === 'scanning') {
          window.startScanPolling(type);
        }
      })
      .catch(function () {});
  }
  checkActiveJob('scan');
  checkActiveJob('scrape');
})();
