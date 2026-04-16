(function () {
  var grid = document.getElementById('video-grid');
  var sentinel = document.getElementById('scroll-sentinel');

  // --- Search autocomplete ---
  var searchInput = document.getElementById('search-input');
  var searchDropdown = document.getElementById('search-dropdown');
  var searchTimer = null;

  var sectionLabels = {
    code: 'Code',
    name: 'Name',
    filename: 'Filename',
    genre: 'Genre',
    cast: 'Cast',
  };

  if (searchInput && searchDropdown) {
    searchInput.addEventListener('input', function () {
      clearTimeout(searchTimer);
      var q = searchInput.value.trim();
      if (!q) { searchDropdown.classList.add('hidden'); return; }

      // Debounce 200ms
      searchTimer = setTimeout(function () {
        fetch('/api/search-suggestions?q=' + encodeURIComponent(q))
          .then(function (r) { return r.json(); })
          .then(function (data) {
            var sections = Object.keys(data);
            if (sections.length === 0) {
              searchDropdown.classList.add('hidden');
              return;
            }

            var html = '';
            sections.forEach(function (section) {
              html += '<div class="px-3 py-1.5 text-xs text-gray-500 uppercase tracking-wide bg-gray-900">' + (sectionLabels[section] || section) + '</div>';
              data[section].forEach(function (value) {
                html += '<div class="px-3 py-2 text-sm text-gray-200 cursor-pointer hover:bg-gray-700 truncate" data-value="' + escapeHtml(value) + '">' + escapeHtml(value) + '</div>';
              });
            });

            searchDropdown.innerHTML = html;
            searchDropdown.classList.remove('hidden');
          })
          .catch(function () {});
      }, 200);
    });

    // Click on suggestion
    searchDropdown.addEventListener('click', function (e) {
      var item = e.target.closest('[data-value]');
      if (item) {
        searchInput.value = item.dataset.value;
        searchDropdown.classList.add('hidden');
        document.getElementById('search-form').submit();
      }
    });

    // Hide dropdown on blur
    searchInput.addEventListener('blur', function () {
      setTimeout(function () { searchDropdown.classList.add('hidden'); }, 150);
    });

    // Keyboard navigation
    searchInput.addEventListener('keydown', function (e) {
      if (searchDropdown.classList.contains('hidden')) return;
      var items = searchDropdown.querySelectorAll('[data-value]');
      var active = searchDropdown.querySelector('[data-value].bg-gray-700');
      var idx = -1;
      items.forEach(function (el, i) { if (el === active) idx = i; });

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (active) active.classList.remove('bg-gray-700');
        idx = Math.min(idx + 1, items.length - 1);
        items[idx].classList.add('bg-gray-700');
        items[idx].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (active) active.classList.remove('bg-gray-700');
        idx = Math.max(idx - 1, 0);
        items[idx].classList.add('bg-gray-700');
        items[idx].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && active) {
        e.preventDefault();
        searchInput.value = active.dataset.value;
        searchDropdown.classList.add('hidden');
        document.getElementById('search-form').submit();
      } else if (e.key === 'Escape') {
        searchDropdown.classList.add('hidden');
      }
    });
  }

  // Infinite scroll
  if (sentinel && grid) {
    var loading = false;
    var currentPage = parseInt(sentinel.dataset.page, 10);
    var filters = JSON.parse(sentinel.dataset.filters);

    var observer = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting && !loading) {
        loading = true;
        currentPage++;

        var params = new URLSearchParams();
        params.set('page', currentPage.toString());
        Object.keys(filters).forEach(function (key) {
          if (filters[key]) params.set(key, filters[key]);
        });

        fetch('/api/videos?' + params.toString())
          .then(function (r) { return r.json(); })
          .then(function (data) {
            data.videos.forEach(function (video) {
              var playback = data.playbackMap ? data.playbackMap[video.id] : null;
              grid.insertAdjacentHTML('beforeend', createVideoCard(video, playback));
            });
            if (!data.hasMore) {
              sentinel.remove();
              observer.disconnect();
            }
            loading = false;
          })
          .catch(function (err) {
            console.error('Failed to load more videos:', err);
            loading = false;
          });
      }
    }, { rootMargin: '300px' });

    observer.observe(sentinel);
  }

  function createVideoCard(video, playback) {
    var progressHtml = '';
    if (playback && playback.position > 0) {
      var barStyle = video.length
        ? 'width: ' + Math.min(100, playback.position / video.length * 100) + '%'
        : 'width: 100%';
      progressHtml = '<div class="absolute bottom-0 left-0 right-0 h-1 bg-gray-600">' +
        '<div class="h-full bg-blue-500" style="' + barStyle + '"></div></div>';
    }

    var coverHtml = video.cover_image
      ? '<img src="/api/videos/' + video.id + '/cover" alt="" class="h-full object-cover object-right absolute right-0" loading="lazy">'
      : '<div class="w-full h-full flex items-center justify-center text-gray-500">' +
        '<svg class="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" ' +
        'd="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>' +
        '</svg></div>';

    var dateHtml = video.release_date
      ? '<p class="text-xs text-gray-500 mt-0.5">' + formatLocaleDate(video.release_date) + '</p>'
      : '';

    return '<a href="/player/' + video.id + '" class="group bg-gray-800 rounded-lg overflow-hidden hover:ring-2 hover:ring-blue-500 transition-all">' +
      '<div class="aspect-[2/3] bg-gray-700 relative overflow-hidden">' + coverHtml + progressHtml + '</div>' +
      '<div class="p-2">' +
      '<p class="text-sm text-gray-200 break-words">' + escapeHtml(video.name || video.filename) + '</p>' +
      dateHtml +
      '</div></a>';
  }

})();
