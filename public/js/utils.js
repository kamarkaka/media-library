function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// Format a date string to the user's locale
function formatLocaleDate(dateStr) {
  if (!dateStr) return '—';
  var d = new Date(dateStr + 'T00:00:00'); // force local timezone
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Auto-format all elements with data-date attribute on page load
document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('[data-date]').forEach(function (el) {
    var date = el.getAttribute('data-date');
    if (date) el.textContent = formatLocaleDate(date);
  });
});
