/* Full library browsing and search. No API URLs are part of the public catalog. */
(function () {
  'use strict';
  var kinds = { B: 'Bibles', C: 'Commentaries', S: 'Sermons', K: 'Books', J: 'Journals & Periodicals', U: 'Courses', F: 'Other Faiths' };
  var descriptions = { B: 'Translations & reference', C: 'Explore the Bible', S: 'Preaching & teaching', K: 'Faith, history & Christian life', J: 'Journals & historic periodicals', U: 'Learn at your own pace', F: 'A separate reference shelf' };
  var data, live, rows = [], notebooks = [], byKey = new Map(), additions = new Map(), recent = [];
  var worker, indexTimer, ready = false, started = false, request = 0, results = [], route = '', query = '', kind = '', nb = null, other = false, shown = 50, debounce;
  var searchError = '', loading = '', catalogError = '', cacheWarning = '', liveWarning = '', refreshPromise, code = '', restoreScroll = null;
  var metrics = { indexBuildMs: null, searchMs: null, catalogSource: '', resultCount: 0 };
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function number(n) { return Number(n).toLocaleString(); }
  function dbRun(mode, callback) {
    return new Promise(function (resolve, reject) {
      var done = false, db, timer = setTimeout(function () { finish(new Error('Storage unavailable')); }, 3000);
      function finish(error, result) { if (done) return; done = true; clearTimeout(timer); if (db) db.close(); error ? reject(error) : resolve(result); }
      try {
        var open = indexedDB.open('nccog-library', 1);
        open.onupgradeneeded = function () { open.result.createObjectStore('saved'); };
        open.onerror = function () { finish(open.error); };
        open.onblocked = function () { finish(new Error('Storage is busy')); };
        open.onsuccess = function () {
          db = open.result;
          if (done) { db.close(); return; }
          var tx = db.transaction('saved', mode), value;
          tx.oncomplete = function () { finish(null, value); };
          tx.onerror = tx.onabort = function () { finish(tx.error || new Error('Storage unavailable')); };
          callback(tx.objectStore('saved'), function (v) { value = v; });
        };
      } catch (e) { finish(e); }
    });
  }
  function readSaved(key) { return dbRun('readonly', function (s, set) { var r = s.get(key); r.onsuccess = function () { set(r.result); }; }); }
  function writeSaved(key, value) { return dbRun('readwrite', function (s) { s.put(value, key); }); }
  function saveCatalog(c) { return dbRun('readwrite', function (s) { s.put(c, 'catalog:' + c.version); s.put(c.version, 'current'); }); }
  function valid(c) {
    return c && typeof c.version === 'string' && Array.isArray(c.items) && c.count === c.items.length && Array.isArray(c.notebooks) &&
      c.notebooks.every(function (n, i) { return n.i === i && kinds[n.kind] && typeof n.name === 'string'; }) &&
      c.items.every(function (r) { return r.length === 6 && typeof r[0] === 'string' && typeof r[1] === 'string' && typeof r[2] === 'string' && c.notebooks[r[4]] && r[5] === c.notebooks[r[4]].kind; });
  }
  function fetchJSON(path) {
    var controller = new AbortController(), timer = setTimeout(function () { controller.abort(); }, 15000);
    return fetch(path, { cache: 'no-store', signal: controller.signal }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).finally(function () { clearTimeout(timer); });
  }
  function notices() {
    var messages = [catalogError, cacheWarning, liveWarning].filter(Boolean);
    $('libraryNotice').classList.toggle('hidden', !messages.length);
    $('libraryNotice').innerHTML = messages.length ? '<div class="msg info">' + messages.map(esc).join('<br>') + (catalogError || liveWarning ? '<button class="btn ghost wide" id="retryLibrary">Try updating again</button>' : '') + '</div>' : '';
    if ($('retryLibrary')) $('retryLibrary').onclick = function () { refresh(); if (window.refreshLibraryLinks) window.refreshLibraryLinks(); };
    $('offlineBanner').classList.toggle('hidden', navigator.onLine);
    $('offlineBanner').textContent = data ? 'Offline: showing saved library' : 'Offline: connect once to save the library on this device.';
  }
  async function refresh() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async function () {
      try {
        catalogError = ''; loading = data ? '' : 'Getting the library ready…';
        if (!data) {
          try {
            var version = await readSaved('current'), saved = version && await readSaved('catalog:' + version);
            if (valid(saved)) { data = saved; metrics.catalogSource = 'IndexedDB'; combine(); }
          } catch (e) { cacheWarning = 'This browser could not save the library for offline use. You can still browse while connected. Check available device storage, then reopen the app.'; }
        }
        if (!navigator.onLine) {
          if (!data) catalogError = 'There is no saved library on this device yet. Nothing was changed. Connect to the internet, then tap Try updating again.';
          return;
        }
        var latest = await fetchJSON('data/version.json');
        if (!data || latest.version !== data.version) {
          var fetched = await fetchJSON('data/catalog.json');
          if (!valid(fetched) || fetched.version !== latest.version) throw new Error('Library update incomplete');
          data = fetched; metrics.catalogSource = 'network'; combine();
          try { await saveCatalog(data); } catch (e) { cacheWarning = 'The library is ready, but this browser could not save it for offline use. Check available device storage, then reopen the app.'; }
        }
      } catch (e) {
        catalogError = data ? 'The library update could not be reached. Your saved library is still here. Check your connection and try updating again.' : 'The library could not load. Nothing was changed. Check your connection and tap Try updating again.';
      } finally { loading = ''; notices(); if (!data) render(); refreshPromise = null; }
    })();
    return refreshPromise;
  }
  function identity(title, author, notebook) { return [title, author, notebook].map(function (s) { return String(s || '').trim().toLowerCase(); }).join('\u0000'); }
  function combine() {
    if (!data) return;
    rows = data.items.slice(); notebooks = data.notebooks.map(function (n) { return Object.assign({}, n); });
    additions = new Map(); recent = [];
    var names = new Map(notebooks.map(function (n) { return [n.name, n]; }));
    var identities = new Map(rows.map(function (r) { return [identity(r[1], r[2], notebooks[r[4]].name), r]; }));
    if (live) {
      live.notebooks.forEach(function (n) { var target = names.get(n.name); if (target) { target.url = n.url; target.description = n.description; } });
      live.items.forEach(function (it) {
        var notebook = names.get(it.notebook);
        if (!notebook) { liveWarning = 'A new notebook is waiting for a library update. Ask Matt to refresh the library list; your additions are still saved.'; return; }
        var id = identity(it.title, it.author, it.notebook), row = identities.get(id);
        if (!row) {
          // Encode the stable identity, not a row position, so links survive a refresh.
          var key = 'added-' + Array.from(new TextEncoder().encode(id)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
          row = [key, String(it.title || 'Untitled'), String(it.author || ''), String(it.date || '').slice(0, 4), notebook.i, notebook.kind];
          rows.push(row); notebook.n++; identities.set(id, row);
        }
        additions.set(row[0], it); recent.push({ row: row, added: Date.parse(it.added) || 0 });
      });
    }
    recent.sort(function (a, b) { return b.added - a.added; });
    recent = recent.filter(function (item, i, all) { return all.findIndex(function (x) { return x.row[0] === item.row[0]; }) === i; }).slice(0, 10);
    byKey = new Map(rows.map(function (r) { return [r[0], r]; }));
    if (nb !== null && notebooks[nb] && notebooks[nb].kind === 'F' && !new URLSearchParams(location.hash.split('?')[1] || '').has('other')) other = true;
    buildIndex(); render(); notices();
  }
  function buildIndex() {
    ready = false; searchError = '';
    clearTimeout(indexTimer);
    if (worker) worker.terminate();
    try {
      worker = new Worker('search-worker.js');
      var deadline = indexTimer = setTimeout(function () { searchError = 'Search is taking too long to load. Your library is safe. Browse by kind or notebook, or tap Try search again.'; worker.terminate(); updateResults(); }, 30000);
      worker.onmessage = function (event) {
        var m = event.data;
        if (m.type === 'ready') { clearTimeout(deadline); ready = true; metrics.indexBuildMs = m.milliseconds; doSearch(); }
        if (m.type === 'error') { clearTimeout(deadline); searchError = m.message; updateResults(); }
        if (m.type === 'results' && m.request === request) { results = m.ids; metrics.searchMs = m.milliseconds; metrics.resultCount = results.length; updateResults(); }
        if (m.type === 'queryError' && m.request === request) { searchError = 'That search could not finish. Your library is safe. Try fewer words or tap Try search again.'; updateResults(); }
      };
      worker.onerror = function (event) { event.preventDefault(); clearTimeout(deadline); searchError = 'Search did not load. Your library is safe. Browse by kind or notebook, or reconnect and tap Try search again.'; updateResults(); };
      worker.postMessage({ type: 'build', items: rows });
    } catch (e) { searchError = 'Search is not available in this browser. Your library is safe. Browse by kind or notebook, or try a newer browser.'; }
  }
  function setLive(c, cached) {
    if (!c || !Array.isArray(c.notebooks) || !Array.isArray(c.items)) return;
    live = c;
    if (!cached) { liveWarning = ''; writeSaved('links:' + code, c).catch(function () { liveWarning = 'Notebook links and recent additions could not be saved on this device. They are available while connected.'; notices(); }); }
    combine();
  }
  function liveFailed() { liveWarning = 'Notebook links and recent additions could not be updated. Saved library browsing still works. Check your connection and try updating again.'; notices(); }
  function path() { return location.hash.split('?')[0] || '#/library'; }
  function remember() {
    var params = new URLSearchParams();
    if (query) params.set('q', query);
    params.set('other', other ? '1' : '0');
    if (shown > 50) params.set('show', shown);
    history.replaceState(Object.assign({}, history.state, { scroll: window.scrollY }), '', path() + (params.size ? '?' + params.toString() : ''));
  }
  function back(fallback) { return '<button type="button" class="btn ghost back-button" data-back="' + esc(fallback) + '">← Back</button>'; }
  function openNotebook(n) {
    var url;
    try { url = new URL(n.url); if (url.protocol !== 'https:') url = null; } catch (e) { url = null; }
    return url ? '<a class="btn gold wide" href="' + esc(url.href) + '" target="_blank" rel="noopener noreferrer">Open notebook <span aria-hidden="true">↗</span></a><p class="hint">Opens in a new tab.</p>' : '<p class="msg info">Open Gemini and look under Notebooks for <b>' + esc(n.name) + '</b>. Connect to the internet and try updating again to get its direct link.</p>';
  }
  function rowHTML(r) {
    var n = notebooks[r[4]], added = additions.get(r[0]);
    return '<article class="result-row" data-kind="' + esc(r[5]) + '"><a class="result-row-link" href="#/item/' + encodeURIComponent(r[0]) + '" aria-label="Details: ' + esc(r[1]) + '"><span class="result-copy"><span class="result-title">' + esc(r[1]) + '</span><span class="metadata">' + esc([r[2] || 'Author not listed', r[3] || 'Year not listed', n.name].join(' · ')) + '</span>' +
      (added ? '<span class="added-by">Added by ' + esc(added.by || 'a library member') + '</span>' : '') +
      '</span><span class="result-action">Details <span aria-hidden="true">→</span></span></a></article>';
  }
  function render() {
    if (!$('libraryView') || !/^#\/(library|notebook|item)(\/|$)/.test(path())) return;
    var view = $('libraryView');
    if (!data) { view.innerHTML = '<h2 class="screen-heading">Library</h2><div class="card empty-state" role="status"><h3>' + esc(catalogError ? 'The library is not ready yet' : loading || 'Getting the library ready…') + '</h3><p>Books, sermons and a place to keep learning.</p></div>'; return; }
    if (route.startsWith('#/item/')) {
      var item = byKey.get(decodeURIComponent(route.slice(7)));
      if (!item) { view.innerHTML = back('#/library') + '<div class="card empty-state"><h2>This book or sermon is not in the saved library.</h2><p>Try updating the library, or return to Library and search by title.</p><button class="btn" id="retryItem">Update library</button></div>'; $('retryItem').onclick = function () { refresh(); if (window.refreshLibraryLinks) window.refreshLibraryLinks(); }; bind(); return; }
      var notebook = notebooks[item[4]], extra = additions.get(item[0]);
      view.innerHTML = back('#/library') + '<article class="card detail-card"><p class="eyebrow">' + esc(kinds[item[5]]) + '</p><h2 class="screen-heading">' + esc(item[1]) + '</h2><dl class="detail-meta"><dt>Author</dt><dd>' + esc(item[2] || 'Not listed') + '</dd><dt>Year</dt><dd>' + esc(item[3] || 'Not listed') + '</dd><dt>Notebook</dt><dd>' + esc(notebook.name) + '</dd></dl>' + (extra ? '<p class="added-by">Added by ' + esc(extra.by || 'a library member') + '</p>' : '') + openNotebook(notebook) + '<a class="btn ghost wide" href="#/notebook/' + notebook.i + '">See this notebook</a></article>';
      bind(); return;
    }
    var inNotebook = nb !== null, current = inNotebook && notebooks[nb], scoped = kind || inNotebook, active = query || scoped;
    if (inNotebook && !current) { view.innerHTML = back('#/library') + '<div class="card empty-state"><h2>Notebook not found</h2><p>Return to Library to choose a notebook.</p></div>'; bind(); return; }
    var head = scoped ? back('#/library') : '';
    head += '<h2 id="library-heading" class="screen-heading">' + esc(current ? current.name : kind ? kinds[kind] : 'Library') + '</h2>';
    if (current) head += '<div class="card detail-card"><p>' + esc(current.description || 'Browse the books and sermons saved in this notebook.') + '</p><p class="metadata">' + number(current.n) + ' books and sermons · ' + esc(kinds[current.kind]) + '</p>' + openNotebook(current) + '</div>';
    else if (!kind) head += '<p class="intro' + (active ? ' hidden' : '') + '" id="libraryIntro">' + number(data.count) + ' books and sermons in ' + number(data.notebooks.length) + ' notebooks</p>';
    head += '<div class="search-box"><label for="searchIn">' + (current ? 'Search this notebook' : 'Find a book or sermon') + '</label><div class="search-input-wrap"><input id="searchIn" type="search" autocomplete="off" placeholder="' + esc(scoped ? 'Search ' + (current ? 'this notebook' : kinds[kind]) : 'Search ' + number(data.count) + ' books and sermons') + '" value="' + esc(query) + '"><button type="button" id="clearSearch" class="search-clear' + (query ? '' : ' hidden') + '" aria-label="Clear search" title="Clear search"><span aria-hidden="true">×</span></button></div></div><div id="searchTools"></div><div id="searchResults" aria-live="polite" aria-atomic="false"></div>';
    head += '<div id="libraryHome"' + (active ? ' class="hidden"' : '') + '><h3 class="section-heading">Browse</h3><div class="kind-grid">' + Object.keys(kinds).map(function (k) {
      var count = notebooks.filter(function (n) { return n.kind === k; }).reduce(function (sum, n) { return sum + n.n; }, 0);
      return '<a class="kind-tile" href="#/library/kind/' + k + '"><span class="kind-count">' + number(count) + '</span><b>' + esc(kinds[k]) + '</b><span>' + esc(descriptions[k]) + '</span></a>';
    }).join('') + '</div><details class="card notebook-list"><summary>Notebooks <span class="muted">A–Z · ' + notebooks.length + '</span></summary>' + notebooks.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (n) { return '<a class="notebook-link" href="#/notebook/' + n.i + '"><span>' + esc(n.name) + '</span><span class="muted">' + number(n.n) + ' <span aria-hidden="true">→</span></span></a>'; }).join('') + '</details><h3 class="section-heading">Recently added</h3><div class="result-list">' + (recent.length ? recent.map(function (x) { return rowHTML(x.row); }).join('') : '<div class="card empty-state"><p>' + (live ? 'No recent additions yet. Share a sermon, book or notes from the Add tab.' : 'Connecting to recent additions… Your books and sermons are ready to browse.') + '</p><a class="btn ghost" href="#/add">Add to the library</a></div>') + '</div></div>';
    view.innerHTML = head;
    $('searchIn').addEventListener('input', function () { query = this.value.trim(); shown = 50; $('clearSearch').classList.toggle('hidden', !query); remember(); clearTimeout(debounce); debounce = setTimeout(doSearch, 100); });
    $('clearSearch').onclick = function () { query = ''; shown = 50; $('searchIn').value = ''; this.classList.add('hidden'); remember(); doSearch(); $('searchIn').focus(); };
    bind(); doSearch();
  }
  function searchTools() {
    if (!$('searchTools')) return;
    var active = !!(query || kind || nb !== null);
    $('libraryHome').classList.toggle('hidden', active);
    if ($('libraryIntro')) $('libraryIntro').classList.toggle('hidden', active);
    var scope = nb !== null ? 'this notebook' : kind ? kinds[kind] : 'all ' + notebooks.length + ' notebooks';
    $('searchTools').innerHTML = '<p class="status-line">Searching: ' + esc(scope) + '</p>' + (active ? '<div class="chips">' + (nb === null ? Object.keys(kinds).filter(function (k) { return k !== 'F'; }).map(function (k) { return '<button class="chip' + (kind === k ? ' selected' : '') + '" data-kind-filter="' + k + '" aria-pressed="' + (kind === k) + '">' + (kind === k ? '✓ ' : '+ ') + esc(kinds[k]) + (kind === k ? ' ×' : '') + '</button>'; }).join('') : '') + (kind === 'F' ? '<button class="chip selected" data-kind-filter="F" aria-pressed="true">✓ Other Faiths ×</button>' : '') + '<button id="otherFaiths" class="chip' + (other ? ' selected' : '') + '" aria-pressed="' + other + '">' + (other ? '✓ Other Faiths included ×' : '+ Include Other Faiths') + '</button></div>' : '');
    if ($('otherFaiths')) $('otherFaiths').onclick = function () { other = !other; shown = 50; remember(); doSearch(); };
    $('searchTools').querySelectorAll('[data-kind-filter]').forEach(function (b) { b.onclick = function () {
      var next = kind === b.dataset.kindFilter ? '' : b.dataset.kindFilter;
      var params = new URLSearchParams(); if (query) params.set('q', query); if (other) params.set('other', '1');
      location.hash = '#/library' + (next ? '/kind/' + next : '') + (params.size ? '?' + params.toString() : '');
    }; });
  }
  function doSearch() {
    if (!$('searchResults')) return;
    searchTools();
    request++;
    if (!query && !kind && nb === null) { updateResults(); return; }
    if (ready) worker.postMessage({ type: 'search', request: request, q: query, kind: kind, notebook: nb, other: other });
    else {
      results = query ? [] : rows.reduce(function (ids, r, i) { if ((!kind || r[5] === kind) && (nb === null || r[4] === nb) && (other || r[5] !== 'F')) ids.push(i); return ids; }, []);
      updateResults();
    }
  }
  function updateResults() {
    var el = $('searchResults'); if (!el) return;
    var status = searchError ? '<div class="msg info">' + esc(searchError) + '<button class="btn ghost wide" id="retrySearch">Try search again</button></div>' : !ready ? '<p class="status-line" role="status">Getting the library ready… You can browse while search gets ready.</p>' : '';
    var active = query || kind || nb !== null;
    if (!active) el.innerHTML = status;
    else if (query && !ready) el.innerHTML = status;
    else if (!results.length) el.innerHTML = status + '<div class="card empty-state"><h3>' + (query ? 'No results for “' + esc(query) + '”.' : 'No books or sermons in this view.') + '</h3><p>Try fewer words, or choose a different kind.</p><button class="btn ghost" id="emptyClear">Clear search</button></div>';
    else el.innerHTML = status + '<p class="result-summary">' + number(results.length) + ' results · showing ' + number(Math.min(shown, results.length)) + '</p><div class="result-list">' + results.slice(0, shown).map(function (i) { return rowHTML(rows[i]); }).join('') + '</div>' + (shown < results.length ? '<button class="btn ghost wide" id="showMore">Show 50 more</button>' : '');
    if ($('retrySearch')) $('retrySearch').onclick = function () { buildIndex(); updateResults(); };
    if ($('emptyClear')) $('emptyClear').onclick = function () { if (query) $('clearSearch').click(); else location.hash = '#/library'; };
    if ($('showMore')) $('showMore').onclick = function () { var scroll = window.scrollY; shown += 50; remember(); updateResults(); window.scrollTo(0, scroll); var firstNew = el.querySelectorAll('.result-row a')[shown - 50]; if (firstNew) firstNew.focus({ preventScroll: true }); };
    if (restoreScroll !== null && (ready || !query)) { var scroll = restoreScroll; restoreScroll = null; requestAnimationFrame(function () { window.scrollTo(0, scroll); }); }
  }
  function bind() {
    $('libraryView').querySelectorAll('[data-back]').forEach(function (b) { b.onclick = function () { if (history.state && history.state.inApp) history.back(); else location.hash = b.dataset.back; }; });
  }
  function show(hash) {
    restoreScroll = history.state && history.state.scroll || 0;
    route = hash.split('?')[0];
    var params = new URLSearchParams(hash.split('?')[1] || '');
    query = params.get('q') || ''; kind = route.startsWith('#/library/kind/') ? route.slice(15) : ''; if (!kinds[kind]) kind = '';
    nb = route.startsWith('#/notebook/') ? Number(route.slice(11)) : null;
    other = params.has('other') ? params.get('other') === '1' : kind === 'F' || nb !== null && notebooks[nb] && notebooks[nb].kind === 'F';
    shown = Math.max(50, Math.min(50000, Number(params.get('show')) || 50));
    render();
  }
  window.Library = {
    metrics: metrics, show: show, refresh: refresh, setLive: setLive, liveFailed: liveFailed,
    start: function (accessCode) {
      code = accessCode; if (started) return; started = true; loading = 'Getting the library ready…';
      readSaved('links:' + code).then(function (saved) { if (!live && saved) setLive(saved, true); }).catch(function () {});
      refresh();
      window.addEventListener('online', function () { refresh(); if (window.refreshLibraryLinks) window.refreshLibraryLinks(); });
      window.addEventListener('offline', notices);
    }
  };
})();
