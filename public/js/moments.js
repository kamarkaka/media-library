(function () {
  window.removeMoment = function (id) {
    fetch('/api/moments/' + id, { method: 'DELETE' })
      .then(function (r) {
        if (r.ok) {
          var el = document.querySelector('[data-moment-id="' + id + '"]');
          if (el) el.remove();
        }
      })
      .catch(function (err) { alert('Failed: ' + err.message); });
  };
})();
