(function () {
  var grid = document.getElementById('video-grid');
  var sentinel = document.getElementById('scroll-sentinel');

  // --- Filter Pills ---
  var pillContainer = document.getElementById('filter-pills');
  if (pillContainer) {
    var currentFilters = JSON.parse(pillContainer.dataset.current || '{}');
    var filterDefs = [
      { key: 'match', label: 'Status', endpoint: null, multi: false, options: ['matched', 'unmatched'] },
      { key: 'genre', label: 'Genre', endpoint: '/api/genres', multi: true },
      { key: 'cast', label: 'Cast', endpoint: '/api/cast', multi: true },
      { key: 'director', label: 'Director', endpoint: '/api/directors', multi: true },
      { key: 'maker', label: 'Maker', endpoint: '/api/makers', multi: true },
      { key: 'label', label: 'Label', endpoint: '/api/labels', multi: true },
    ];

    var optionsCache = {};
    var openDropdown = null;

    function getSelected(key) {
      var val = currentFilters[key];
      if (!val) return [];
      if (Array.isArray(val)) return val;
      if (typeof val === 'string' && val) return [val];
      return [];
    }

    function applyFilters() {
      var url = new URL(window.location.origin + '/');
      var q = document.getElementById('search-input');
      if (q && q.value.trim()) url.searchParams.set('q', q.value.trim());
      filterDefs.forEach(function (def) {
        var sel = getSelected(def.key);
        if (sel.length > 0) url.searchParams.set(def.key, sel.join(','));
      });
      var sort = new URLSearchParams(window.location.search).get('sort');
      if (sort) url.searchParams.set('sort', sort);
      window.location = url.toString();
    }

    var pendingApply = false;

    function closeDropdown() {
      if (openDropdown) {
        openDropdown.remove();
        openDropdown = null;
      }
      document.removeEventListener('click', onDocClick);
      if (pendingApply) {
        pendingApply = false;
        applyFilters();
      }
    }

    function onDocClick(e) {
      if (openDropdown && !openDropdown.contains(e.target) && !e.target.closest('.filter-pill')) {
        closeDropdown();
      }
    }

    function renderPills() {
      var html = '<div class="flex flex-wrap items-center gap-2">';
      var hasAny = false;

      filterDefs.forEach(function (def) {
        var sel = getSelected(def.key);
        var active = sel.length > 0;
        if (active) hasAny = true;
        var countBadge = active && def.multi ? ' (' + sel.length + ')' : '';
        var label = def.label + countBadge;
        if (active && !def.multi) label = def.label + ': ' + sel[0];
        var cls = active
          ? 'bg-blue-600 text-white border-blue-600'
          : 'bg-transparent text-gray-400 border-gray-600 hover:border-gray-400';
        html += '<button class="filter-pill px-3 py-1 rounded-full border text-sm cursor-pointer transition-colors ' + cls + '" data-filter="' + def.key + '">' +
          escapeHtml(label) + ' <span class="ml-0.5 text-xs">&#9662;</span></button>';
      });

      if (hasAny) {
        html += '<button class="text-xs text-gray-500 hover:text-gray-300 ml-2 cursor-pointer" id="clear-all-filters">Clear all</button>';
      }
      html += '</div>';

      // Active filter tags
      if (hasAny) {
        html += '<div class="flex flex-wrap gap-1.5 mt-2">';
        filterDefs.forEach(function (def) {
          var sel = getSelected(def.key);
          sel.forEach(function (val) {
            html += '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-700 text-xs text-gray-300">' +
              escapeHtml(def.label) + ': ' + escapeHtml(val) +
              '<button class="hover:text-white cursor-pointer" data-remove-key="' + def.key + '" data-remove-val="' + escapeHtml(val) + '">&times;</button>' +
              '</span>';
          });
        });
        html += '</div>';
      }

      pillContainer.innerHTML = html;

      // Bind pill clicks
      pillContainer.querySelectorAll('.filter-pill').forEach(function (pill) {
        pill.addEventListener('click', function (e) {
          e.stopPropagation();
          var key = pill.dataset.filter;
          var def = filterDefs.find(function (d) { return d.key === key; });
          if (!def) return;
          if (openDropdown && openDropdown.dataset.filterKey === key) {
            closeDropdown();
            return;
          }
          closeDropdown();
          showDropdown(def, pill);
        });
      });

      // Bind tag remove buttons
      pillContainer.querySelectorAll('[data-remove-key]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var key = btn.dataset.removeKey;
          var val = btn.dataset.removeVal;
          var sel = getSelected(key);
          currentFilters[key] = sel.filter(function (v) { return v !== val; });
          applyFilters();
        });
      });

      // Bind clear all
      var clearBtn = document.getElementById('clear-all-filters');
      if (clearBtn) {
        clearBtn.addEventListener('click', function () {
          filterDefs.forEach(function (def) { currentFilters[def.key] = def.multi ? [] : ''; });
          applyFilters();
        });
      }
    }

    function showDropdown(def, pill) {
      var dropdown = document.createElement('div');
      dropdown.className = 'absolute z-40 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-lg w-56 max-h-64 overflow-hidden flex flex-col';
      dropdown.dataset.filterKey = def.key;

      // Position below the pill
      var rect = pill.getBoundingClientRect();
      var containerRect = pillContainer.getBoundingClientRect();
      dropdown.style.position = 'absolute';
      dropdown.style.left = (rect.left - containerRect.left) + 'px';
      dropdown.style.top = (rect.bottom - containerRect.top + 4) + 'px';

      pillContainer.style.position = 'relative';
      pillContainer.appendChild(dropdown);
      openDropdown = dropdown;

      if (def.endpoint) {
        dropdown.innerHTML = '<div class="p-3 text-sm text-gray-500">Loading...</div>';
        var cacheKey = def.key;
        if (optionsCache[cacheKey]) {
          renderDropdownContent(dropdown, def, optionsCache[cacheKey]);
        } else {
          fetch(def.endpoint)
            .then(function (r) { return r.json(); })
            .then(function (data) {
              // Normalize: endpoints may return [{name: "..."}, ...] or ["..."]
              var options = data.map(function (item) { return typeof item === 'string' ? item : item.name; });
              optionsCache[cacheKey] = options;
              renderDropdownContent(dropdown, def, options);
            })
            .catch(function () {
              dropdown.innerHTML = '<div class="p-3 text-sm text-red-400">Failed to load</div>';
            });
        }
      } else {
        renderDropdownContent(dropdown, def, def.options);
      }

      setTimeout(function () { document.addEventListener('click', onDocClick); }, 0);
    }

    function renderDropdownContent(dropdown, def, options) {
      var sel = getSelected(def.key);

      // Preserve search input state across re-renders
      var prevSearch = dropdown.querySelector('.dropdown-search');
      var searchVal = prevSearch ? prevSearch.value : '';

      var html = '';

      if (def.multi) {
        html += '<div class="p-2 border-b border-gray-700">' +
          '<input type="text" placeholder="Search..." value="' + escapeHtml(searchVal) + '" class="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 dropdown-search">' +
          '</div>';
      }

      html += '<div class="overflow-y-auto flex-1">';
      options.forEach(function (opt) {
        var checked = sel.indexOf(opt) !== -1;
        var icon = def.multi
          ? (checked ? '&#9745;' : '&#9744;')
          : (checked ? '&#9679;' : '&#9675;');
        var hidden = searchVal && opt.toLowerCase().indexOf(searchVal.toLowerCase()) === -1;
        html += '<div class="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-700 dropdown-option' + (checked ? ' text-white' : ' text-gray-400') + '"' + (hidden ? ' style="display:none"' : '') + ' data-value="' + escapeHtml(opt) + '">' +
          '<span class="text-xs">' + icon + '</span>' +
          '<span class="truncate">' + escapeHtml(opt) + '</span></div>';
      });
      html += '</div>';
      dropdown.innerHTML = html;

      // Bind option clicks
      dropdown.querySelectorAll('.dropdown-option').forEach(function (optEl) {
        optEl.addEventListener('click', function () {
          var val = optEl.dataset.value;
          if (def.multi) {
            var current = getSelected(def.key);
            var idx = current.indexOf(val);
            if (idx !== -1) {
              current.splice(idx, 1);
            } else {
              current.push(val);
            }
            currentFilters[def.key] = current;
            pendingApply = true;
            renderDropdownContent(dropdown, def, options);
          } else {
            var cur = getSelected(def.key);
            currentFilters[def.key] = cur[0] === val ? '' : val;
            applyFilters();
          }
        });
      });

      // Bind search input
      var searchInput = dropdown.querySelector('.dropdown-search');
      if (searchInput) {
        searchInput.addEventListener('input', function () {
          var q = searchInput.value.toLowerCase();
          dropdown.querySelectorAll('.dropdown-option').forEach(function (optEl) {
            var text = (optEl.dataset.value || '').toLowerCase();
            optEl.style.display = text.indexOf(q) !== -1 ? '' : 'none';
          });
        });
        searchInput.focus();
      }
    }

    renderPills();
  }

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
                html += '<div class="px-3 py-2 text-sm text-gray-200 cursor-pointer hover:bg-gray-700 truncate" data-value="' + escapeHtml(value) + '" data-section="' + section + '">' + escapeHtml(value) + '</div>';
              });
            });

            searchDropdown.innerHTML = html;
            searchDropdown.classList.remove('hidden');
          })
          .catch(function () {});
      }, 200);
    });

    // Navigate to the appropriate filtered URL based on section type
    function selectSuggestion(value, section) {
      searchDropdown.classList.add('hidden');
      var url = new URL(window.location.origin + '/');
      if (section === 'genre' || section === 'cast') {
        // Exact filter by genre or cast
        url.searchParams.set(section, value);
      } else {
        // Text search for code, name, filename
        url.searchParams.set('q', value);
      }
      window.location = url.toString();
    }

    // Click on suggestion
    searchDropdown.addEventListener('click', function (e) {
      var item = e.target.closest('[data-value]');
      if (item) {
        selectSuggestion(item.dataset.value, item.dataset.section);
      }
    });

    // Form submit — preserve active filters when searching
    document.getElementById('search-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var q = searchInput.value.trim();
      var url = new URL(window.location.href);
      if (q) {
        url.searchParams.set('q', q);
      } else {
        url.searchParams.delete('q');
      }
      window.location = url.toString();
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
        selectSuggestion(active.dataset.value, active.dataset.section);
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
