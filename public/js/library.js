(function () {
  var grid = document.getElementById('video-grid');
  var sentinel = document.getElementById('scroll-sentinel');
  var sortSelect = document.getElementById('sort-select');

  // Sort change reloads page
  if (sortSelect) {
    sortSelect.addEventListener('change', function () {
      var url = new URL(window.location);
      url.searchParams.set('sort', sortSelect.value);
      url.searchParams.delete('page');
      window.location = url.toString();
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
