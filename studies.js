/* One active study shelf, server-backed studies, and the review/build flow. */
(function () {
  'use strict';
  var code = '', started = false, active = blankStudy(), studies = [], workspace = { free: 0, total: 0 };
  var syncState = 'saved', syncError = '', listError = '', saveTimer = null, savePromise = null, toastTimer = null, pollTimer = null, pollToken = 0, localSafe = true;
  var epoch = 0, listRequest = 0, currentRoute = '#/studies', search = '';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function blankStudy() { return { id: '', name: '', by: '', items: [], status: 'draft', updatedAt: '', pinned: false, _dirty: false }; }
  function unique(items) { return Array.from(new Set((Array.isArray(items) ? items : []).filter(function (x) { return typeof x === 'string' && x; }))); }
  function normalize(study) {
    var s = Object.assign(blankStudy(), study || {});
    if (typeof s.items === 'string') { try { s.items = JSON.parse(s.items); } catch (e) { s.items = []; } }
    s.items = unique(s.items); s.id = String(s.id || ''); s.name = String(s.name || ''); s.by = String(s.by || ''); s._dirty = s._dirty === true;
    return s;
  }
  function localGet() { try { return normalize(JSON.parse(localStorage.getItem('nccog.studyShelf') || 'null')); } catch (e) { localSafe = false; return blankStudy(); } }
  function localSet() {
    try { localStorage.setItem('nccog.studyShelf', JSON.stringify(Object.assign({}, active, { localSavedAt: new Date().toISOString() }))); localSafe = true; return true; } catch (e) { localSafe = false; return false; }
  }
  function rememberedBy() { try { return localStorage.getItem('nccog.by') || ''; } catch (e) { return ''; } }
  function api(name) {
    var args = Array.prototype.slice.call(arguments, 1);
    if (!window.AppAPI) return Promise.reject(new Error('The library is still starting. Try again in a moment.'));
    return AppAPI.call.apply(null, [name].concat(args));
  }
  function item(key) { return window.Library && Library.getItem(key); }
  function defaultName() {
    var first = item(active.items[0]);
    if (!first) return 'My Study';
    var title = String(first[1] || '').replace(/\s*[-–—:]?\s*(commentary|notes|sermons?|volume\s+\d+)\s*$/i, '').trim();
    return (title || 'My') + ' Study';
  }
  function displayName() { return active.name.trim() || defaultName(); }
  function statusOf(s) {
    if (s.status === 'queued' || s.status === 'building') return 'Building';
    if (s.status === 'failed') return 'Failed';
    if (s.displayStatus) {
      var shown = String(s.displayStatus).toLowerCase().replace(/[_-]+/g, ' ');
      if (shown === 'needs update') return 'Needs update';
      if (shown === 'building' || shown === 'queued') return 'Building';
      if (shown === 'ready') return 'Ready';
      if (shown === 'failed') return 'Failed';
      if (shown === 'draft') return 'Draft';
    }
    if (s.status !== 'ready') return 'Draft';
    return s.builtHash && s.currentHash && s.builtHash !== s.currentHash ? 'Needs update' : 'Ready';
  }
  function safeUrl(value) { try { var u = new URL(value); return u.protocol === 'https:' ? u.href : ''; } catch (e) { return ''; } }
  function locked() { return statusOf(active) === 'Building'; }
  function mergePartial(base, incoming) {
    var next = Object.assign({}, base, incoming || {});
    next.items = incoming && Object.prototype.hasOwnProperty.call(incoming, 'items') ? normalize({ items: incoming.items }).items : base.items.slice();
    return next;
  }
  function saveLocalAndPaint() {
    var savedLocally = localSet(); paintBar();
    if (window.Library && Library.shelfChanged) Library.shelfChanged();
    return savedLocally;
  }
  function paintBar() {
    var bar = $('shelfBar'); if (!bar) return;
    var count = active.items.length;
    bar.classList.toggle('hidden', !count);
    document.body.classList.toggle('has-shelf', !!count);
    if (!count) return;
    $('shelfLabel').innerHTML = '<span>Adding to: ' + esc(displayName()) + '</span><small>Study shelf · ' + count + ' item' + (count === 1 ? '' : 's') + '</small>';
  }
  function showToast(message, undo) {
    var el = $('studyToast'); if (!el) return;
    clearTimeout(toastTimer);
    el.innerHTML = '<span>' + esc(message) + '</span>' + (undo ? '<button type="button" id="undoShelf">Undo</button>' : '');
    el.classList.remove('hidden');
    if ($('undoShelf')) $('undoShelf').onclick = function () { clearTimeout(toastTimer); el.classList.add('hidden'); undo(); };
    toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 6000);
  }
  function scheduleSave(delay) {
    clearTimeout(saveTimer); syncState = navigator.onLine ? 'saving' : 'offline'; syncError = '';
    saveTimer = setTimeout(function () { saveNow().catch(function () {}); }, delay == null ? 700 : delay);
    paintSync();
  }
  function saveNow() {
    clearTimeout(saveTimer); saveTimer = null;
    if (savePromise) return savePromise.then(function () { return active._dirty ? saveNow() : active; });
    if (!active._dirty) { syncState = 'saved'; paintSync(); return Promise.resolve(active); }
    if (!active.items.length && !active.id) { active._dirty = false; syncState = 'saved'; return Promise.resolve(active); }
    if (!navigator.onLine) { syncState = 'offline'; saveLocalAndPaint(); return Promise.reject(new Error('Offline')); }
    var myEpoch = epoch, snapshot = active.items.slice(), sourceName = active.name, sourceBy = active.by;
    var payload = { id: active.id || undefined, name: displayName(), by: active.by.trim() || rememberedBy() || 'Library member', items: snapshot };
    syncState = 'saving'; syncError = '';
    savePromise = api('saveStudy', code, payload).then(function (saved) {
      if (myEpoch !== epoch) return active;
      if (snapshot.join('\0') !== active.items.join('\0') || sourceName !== active.name || sourceBy !== active.by) {
        if (!active.id && saved && saved.id) active.id = saved.id;
        active._dirty = true; upsert(saved); saveLocalAndPaint(); scheduleSave(0); return active;
      }
      active = Object.assign({}, active, normalize(saved), { _dirty: false }); syncState = 'saved'; syncError = ''; saveLocalAndPaint(); upsert(active); paintSync();
      return active;
    }).catch(function (error) {
      if (myEpoch === epoch) { syncState = navigator.onLine ? 'error' : 'offline'; syncError = error.message || String(error); localSet(); paintSync(); }
      throw error;
    }).finally(function () { savePromise = null; });
    return savePromise;
  }
  function upsert(s) {
    if (!s || !s.id) return;
    var i = studies.findIndex(function (x) { return x.id === s.id; });
    if (i < 0) studies.unshift(normalize(s)); else studies[i] = Object.assign({}, studies[i], normalize(s));
  }
  function switchTo(study) {
    clearTimeout(saveTimer); stopPolling(); clearTimeout(toastTimer); if ($('studyToast')) $('studyToast').classList.add('hidden'); epoch++;
    active = normalize(study); syncState = 'saved'; syncError = ''; saveLocalAndPaint();
  }
  function flushActive() {
    clearTimeout(saveTimer); saveTimer = null;
    if (savePromise) return savePromise.then(flushActive);
    return active._dirty ? saveNow() : Promise.resolve(active);
  }
  function toggle(key) {
    if (locked()) { showToast('This study is being built right now. Wait until it is ready before changing the shelf.'); return; }
    if (!item(key)) return;
    var i = active.items.indexOf(key);
    if (i >= 0) active.items.splice(i, 1); else { active.items.push(key); if (!active.name) active.name = defaultName(); }
    active._dirty = true;
    if (active.status === 'ready') active.displayStatus = 'Needs update';
    if (!saveLocalAndPaint()) showToast('This phone could not store a backup. Keep the app open and reconnect so the shelf can save to the server.'); scheduleSave();
    if (currentRoute === '#/studies/review') renderReview();
  }
  function addAll(keys, suggestedName) {
    if (locked()) { showToast('This study is being built right now. Wait until it is ready before adding books.'); return; }
    var before = active.items.slice(), added = 0, existing = 0, undoEpoch = epoch;
    unique(keys).forEach(function (key) { if (!item(key)) return; if (active.items.indexOf(key) >= 0) existing++; else { active.items.push(key); added++; } });
    if (!active.name && suggestedName) active.name = suggestedName;
    if (active.status === 'ready' && added) active.displayStatus = 'Needs update';
    if (added) active._dirty = true;
    var backedUp = saveLocalAndPaint(); if (added) scheduleSave();
    var message = 'Added ' + added + ' new, ' + existing + ' already on the shelf.' + (backedUp ? '' : ' This phone could not store a backup; reconnect before closing the app.');
    showToast(message, added ? function () { if (epoch !== undoEpoch) return; active.items = before; active._dirty = true; saveLocalAndPaint(); scheduleSave(0); } : null);
  }
  function slotUse(keys) {
    return 1 + unique(keys).reduce(function (sum, key) {
      var row = item(key), chars = row && Number(row[7]), words = row && Number(row[6]);
      if (!chars || chars < 1) chars = words > 0 ? words * 6 : 1;
      return sum + Math.max(1, Math.ceil(chars / 899000));
    }, 0);
  }
  function syncMessage() {
    if (syncState === 'saving') return '<p class="study-sync" role="status">Saving this shelf…</p>';
    if (syncState === 'offline') return '<div class="msg info">' + (localSafe ? 'You are offline. This shelf is safe on this phone and will save to the library server when you reconnect.' : 'You are offline and this browser could not store a backup. Keep this page open, reconnect, then save again before leaving.') + '</div>';
    if (syncState === 'error') return '<div class="msg err">' + (localSafe ? 'The shelf is safe on this phone, but the server copy did not save. ' : 'The server copy did not save and this browser could not store a backup. Keep this page open. ') + esc(syncError) + '<button type="button" class="btn ghost wide" id="retryStudySave">Try saving again</button></div>';
    return '<p class="study-sync">✓ Saved for your other devices</p>';
  }
  function paintSync() {
    var target = $('studySync'); if (!target) return;
    target.innerHTML = syncMessage();
    if ($('retryStudySave')) $('retryStudySave').onclick = function () { saveNow().catch(function () {}); };
  }
  function itemGroups() {
    var groups = new Map();
    active.items.forEach(function (key) { var r = item(key), kind = r ? r[5] : '?'; if (!groups.has(kind)) groups.set(kind, []); groups.get(kind).push({ key: key, row: r }); });
    return Array.from(groups.entries());
  }
  function buildState() {
    var status = statusOf(active);
    if (status === 'Building') return '<div class="card build-state" role="status"><h3>Setting up “' + esc(displayName()) + '”</h3><div class="progress"><i></i></div><p><b>About 5 minutes. You can close the app.</b></p><p>We will keep working, and this study will stay in Studies.</p></div>';
    var notebookUrl = safeUrl(active.notebookUrl);
    if (status === 'Ready' && notebookUrl) return '<div class="card ready-state"><h3>Ready!</h3><a class="btn gold wide" href="' + esc(notebookUrl) + '" target="_blank" rel="noopener noreferrer">Open notebook <span aria-hidden="true">↗</span></a><p>Your notebook is named <b>Study Workspace ' + String(active.workspaceNum || '').padStart(2, '0') + '</b> in Gemini.</p>' + (active.error ? '<div class="msg info"><b>The notebook is ready with a note:</b> ' + esc(active.error) + '</div>' : '') + '</div>';
    if (status === 'Failed') return '<div class="msg err"><b>The study could not finish.</b> Your shelf is still saved. ' + esc(active.error || 'Try building it again, or email Matt if it keeps happening.') + '</div>';
    return '';
  }
  function renderReview() {
    var view = $('studiesView'); if (!view) return;
    currentRoute = '#/studies/review';
    if (!active.items.length) {
      view.innerHTML = '<button type="button" class="btn ghost back-button" data-study-back>← Back</button><div class="card empty-state"><h2>Your study shelf is empty</h2><p>Find books or sermons in the Library, then tap + Add to shelf.</p><div id="studySync">' + syncMessage() + '</div><a class="btn wide" href="#/library">Browse the library</a></div>';
      paintSync(); bindCommon(); return;
    }
    var slots = slotUse(active.items), groups = itemGroups(), isLocked = locked();
    var grouped = groups.map(function (group) {
      var label = group[0] === '?' ? 'Unavailable items' : Library.kindName(group[0]);
      return '<details class="study-group" open><summary>' + esc(label) + ' (' + group[1].length + ')</summary>' + group[1].map(function (entry) {
        return '<div class="study-item"><span><b>' + esc(entry.row ? entry.row[1] : entry.key) + '</b>' + (entry.row && entry.row[2] ? '<small>' + esc(entry.row[2]) + '</small>' : '') + '</span><button type="button" class="btn ghost small" data-remove-study="' + esc(entry.key) + '"' + (isLocked ? ' disabled' : '') + '>Remove</button></div>';
      }).join('') + '</details>';
    }).join('');
    view.innerHTML = '<button type="button" class="btn ghost back-button" data-study-back>← Back</button><h2 class="screen-heading">Your study shelf</h2>' + buildState() +
      '<div class="card review-card"><label for="studyName">Name this study</label><input id="studyName" type="text" value="' + esc(displayName()) + '" maxlength="100" autocomplete="off"' + (isLocked ? ' disabled' : '') + '><label for="studyBy">Made by</label><input id="studyBy" type="text" value="' + esc(active.by || rememberedBy()) + '" maxlength="80" autocomplete="name" placeholder="Your name"' + (isLocked ? ' disabled' : '') + '><div id="studySync">' + syncMessage() + '</div>' +
      '<div class="slot-meter"><span><b>' + active.items.length + ' item' + (active.items.length === 1 ? '' : 's') + '</b></span><span>uses <b>' + slots + ' of 40 slots</b></span><div class="meter"><i style="width:' + Math.min(100, slots / 40 * 100) + '%"></i></div></div>' + (slots > 40 ? '<div class="msg err">This study needs ' + slots + ' slots and a workspace holds 40. Remove a few large books.</div>' : '') + grouped +
      '<button type="button" class="btn gold wide" id="buildStudy"' + (slots > 40 || isLocked ? ' disabled' : '') + '>' + (isLocked ? 'Building your notebook…' : statusOf(active) === 'Needs update' || active.status === 'ready' ? 'Update my notebook' : 'Make my study notebook') + '</button><button type="button" class="text-action" id="saveLater">Save for later</button><div id="reviewMessage" aria-live="polite"></div></div>';
    $('studyName').addEventListener('input', function () { active.name = this.value; active._dirty = true; saveLocalAndPaint(); scheduleSave(); });
    $('studyBy').addEventListener('input', function () { active.by = this.value; active._dirty = true; try { localStorage.setItem('nccog.by', active.by); } catch (e) { localSafe = false; } saveLocalAndPaint(); scheduleSave(); });
    view.querySelectorAll('[data-remove-study]').forEach(function (b) { b.onclick = function () { toggle(b.dataset.removeStudy); }; });
    paintSync();
    $('saveLater').onclick = function () { saveNow().then(function () { showToast('Study saved for later.'); location.hash = '#/studies'; }).catch(function () {}); };
    $('buildStudy').onclick = build;
    bindCommon();
    if (statusOf(active) === 'Building' && !pollTimer) startPolling();
  }
  function build() {
    var name = $('studyName').value.trim(), by = $('studyBy').value.trim();
    if (!name || !by) { $('reviewMessage').innerHTML = '<div class="msg err">Please give the study a name and say who made it. Your shelf is still saved.</div>'; return; }
    active.name = name; active.by = by; active._dirty = true; saveLocalAndPaint();
    $('buildStudy').disabled = true; $('reviewMessage').innerHTML = '<div class="msg info">Saving the shelf and reserving a workspace…</div>';
    saveNow().then(function () { return api('buildStudy', code, active.id); }).then(function (result) {
      active = mergePartial(active, result); active.status = result.status || 'queued'; saveLocalAndPaint(); upsert(active); renderReview();
    }).catch(function (error) {
      $('reviewMessage').innerHTML = '<div class="msg err">The notebook build did not start. Your shelf is still saved. ' + esc(error.message || error) + ' Check your connection and try again.</div>'; $('buildStudy').disabled = false;
    });
  }
  function startPolling() {
    stopPolling(); if (!active.id || !navigator.onLine || document.hidden) return;
    var myEpoch = epoch, id = active.id, myPoll = pollToken;
    function check() {
      api('studyStatus', code, id).then(function (result) {
        if (pollToken !== myPoll || epoch !== myEpoch || active.id !== id || currentRoute !== '#/studies/review' || document.hidden) return;
        var fresh = mergePartial(active, result), pending = active._dirty;
        active = pending ? Object.assign({}, fresh, { name: active.name, by: active.by, items: active.items.slice(), _dirty: true, displayStatus: fresh.status === 'ready' ? 'needs_update' : fresh.displayStatus }) : fresh;
        upsert(active); saveLocalAndPaint(); renderReview();
        if (statusOf(active) !== 'Building') { stopPolling(); if (active._dirty) scheduleSave(0); }
      }).catch(function () {});
    }
    pollTimer = setInterval(check, 10000); check();
  }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; pollToken++; }
  function studyCard(s) {
    var status = statusOf(s), cls = status.toLowerCase().replace(/\s+/g, '-'), count = s.items.length;
    var built = s.builtAt ? ' · built ' + new Date(s.builtAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
    var notebookUrl = safeUrl(s.notebookUrl);
    var action = status === 'Ready' && notebookUrl ? '<a class="btn gold study-primary" href="' + esc(notebookUrl) + '" target="_blank" rel="noopener noreferrer">Open notebook</a>' : '<button type="button" class="btn study-primary" data-open-study="' + esc(s.id) + '">' + (status === 'Needs update' ? 'Update my notebook' : status === 'Building' ? 'View progress' : 'Finish and build') + '</button>';
    return '<article class="card study-card" data-study-card="' + esc(s.id) + '"><div class="study-card-head"><h3>' + (s.pinned ? '<span aria-label="Pinned">★</span> ' : '') + esc(s.name || 'Untitled study') + '</h3><span class="status-chip ' + cls + '">' + esc(status) + '</span></div><p class="metadata">' + count + ' item' + (count === 1 ? '' : 's') + built + '</p><div class="study-actions">' + action + '<details class="more-menu"><summary>⋯ More</summary><div><button type="button" data-open-study="' + esc(s.id) + '">Rename or edit</button><button type="button" data-duplicate-study="' + esc(s.id) + '">Duplicate</button><button type="button" data-pin-study="' + esc(s.id) + '">' + (s.pinned ? 'Unpin' : 'Pin') + '</button><button type="button" data-archive-study="' + esc(s.id) + '">Archive</button></div></details></div><div class="archive-confirm hidden" data-archive-confirm="' + esc(s.id) + '"><p>Archive this study and free its workspace? The study stays in the ledger.</p><button type="button" class="btn ghost" data-cancel-archive="' + esc(s.id) + '">Keep it</button><button type="button" class="btn" data-confirm-archive="' + esc(s.id) + '">Archive</button></div></article>';
  }
  function renderList() {
    var view = $('studiesView'); if (!view) return; currentRoute = '#/studies'; stopPolling();
    var visible = studies.filter(function (s) { return s.status !== 'archived' && (!search || (s.name + ' ' + s.by).toLowerCase().indexOf(search.toLowerCase()) >= 0); });
    var pinned = visible.filter(function (s) { return s.pinned; }), recent = visible.filter(function (s) { return !s.pinned; }).sort(function (a, b) { return Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0); });
    var body = !studies.length && !listError ? '<div class="card empty-state"><h3>No studies yet</h3><p>A study is a notebook built from the books you pick.</p><a class="btn wide" href="#/library">Choose books in the Library</a></div>' :
      (!visible.length ? '<div class="card empty-state"><h3>No matching studies</h3><p>Try a shorter name.</p></div>' : (pinned.length ? '<p class="eyebrow list-label">Pinned</p>' + pinned.map(studyCard).join('') : '') + (recent.length ? '<p class="eyebrow list-label">Recent</p>' + recent.map(studyCard).join('') : ''));
    view.innerHTML = '<div class="screen-title-row"><h2 class="screen-heading">Studies</h2><button type="button" class="btn ghost" id="newStudy">+ New</button></div>' + (studies.length >= 8 ? '<label for="studySearch">Search my studies</label><input id="studySearch" type="search" value="' + esc(search) + '" placeholder="Search my studies" autocomplete="off">' : '') + (listError ? '<div class="msg info">' + esc(listError) + '<button type="button" class="btn ghost wide" id="retryStudies">Try again</button></div>' : '') + body + '<p class="workspace-footer">' + Number(workspace.free || 0) + ' of ' + Number(workspace.total || 0) + ' workspaces free</p>';
    $('newStudy').onclick = function () {
      flushActive().then(function () { switchTo(blankStudy()); location.hash = '#/library'; showToast('New study shelf ready. Add books from the Library.'); }).catch(function (e) { listError = 'The current shelf must save before starting another one. Reconnect and try again. ' + (e.message || e); renderList(); });
    };
    if ($('studySearch')) $('studySearch').oninput = function () { search = this.value; renderList(); var input = $('studySearch'); input.focus(); input.setSelectionRange(input.value.length, input.value.length); };
    if ($('retryStudies')) $('retryStudies').onclick = refreshList;
    bindList();
  }
  function bindList() {
    var view = $('studiesView');
    view.querySelectorAll('[data-open-study]').forEach(function (b) { b.onclick = function () { openStudy(b.dataset.openStudy); }; });
    view.querySelectorAll('[data-duplicate-study]').forEach(function (b) { b.onclick = function () {
      var source = studies.find(function (s) { return s.id === b.dataset.duplicateStudy; }); if (!source) return;
      b.disabled = true; flushActive().then(function () { return api('saveStudy', code, { name: 'Copy of ' + (source.name || 'Untitled study'), by: source.by || rememberedBy() || 'Library member', items: source.items }); }).then(function (copy) { switchTo(copy); upsert(copy); location.hash = '#/studies/review'; }).catch(function (e) { listError = 'The copy was not created. The current shelf is unchanged. ' + (e.message || e); renderList(); });
    }; });
    view.querySelectorAll('[data-pin-study]').forEach(function (b) { b.onclick = function () {
      var source = studies.find(function (s) { return s.id === b.dataset.pinStudy; }); if (!source) return;
      api('pinStudy', code, source.id, !source.pinned).then(function (updated) { upsert(updated); renderList(); }).catch(function (e) { listError = 'The pin did not change. ' + (e.message || e); renderList(); });
    }; });
    view.querySelectorAll('[data-archive-study]').forEach(function (b) { b.onclick = function () { var box = view.querySelector('[data-archive-confirm="' + CSS.escape(b.dataset.archiveStudy) + '"]'); box.classList.remove('hidden'); }; });
    view.querySelectorAll('[data-cancel-archive]').forEach(function (b) { b.onclick = function () { b.closest('.archive-confirm').classList.add('hidden'); }; });
    view.querySelectorAll('[data-confirm-archive]').forEach(function (b) { b.onclick = function () {
      b.disabled = true; var wait = active.id === b.dataset.confirmArchive ? flushActive() : Promise.resolve(); wait.then(function () { return api('archiveStudy', code, b.dataset.confirmArchive); }).then(function (updated) {
        upsert(updated); if (active.id === updated.id) switchTo(blankStudy()); renderList(); refreshList();
      }).catch(function (e) { listError = 'The study was not archived. Its workspace is unchanged. ' + (e.message || e); renderList(); });
    }; });
  }
  function openStudy(id) {
    flushActive().then(function () {
      var myEpoch = ++epoch; clearTimeout(saveTimer); stopPolling();
      return api('getStudy', code, id).then(function (study) { if (myEpoch !== epoch) return; active = normalize(study); syncState = 'saved'; saveLocalAndPaint(); location.hash = '#/studies/review'; });
    }).catch(function (e) { listError = 'The current shelf must save before another study can open. Nothing was changed. Reconnect and try again. ' + (e.message || e); renderList(); });
  }
  function bindCommon() {
    $('studiesView').querySelectorAll('[data-study-back]').forEach(function (b) { b.onclick = function () { location.hash = '#/studies'; }; });
  }
  function refreshList() {
    if (!navigator.onLine) { listError = studies.length ? 'Offline: showing studies saved on this phone.' : 'Connect to the internet to load studies saved on other devices.'; renderList(); return Promise.resolve(); }
    var request = ++listRequest;
    return api('listStudies', code).then(function (result) {
      if (request !== listRequest) return;
      studies = (result && Array.isArray(result.studies) ? result.studies : []).map(normalize); workspace = result.workspace || workspace; listError = '';
      var serverActive = active.id && studies.find(function (s) { return s.id === active.id; });
      if (active._dirty) scheduleSave(0);
      else if (serverActive) {
        var myEpoch = epoch, id = active.id;
        api('getStudy', code, id).then(function (fresh) { if (myEpoch === epoch && active.id === id && !active._dirty) { active = normalize(fresh); saveLocalAndPaint(); if (currentRoute === '#/studies/review') renderReview(); } }).catch(function () {});
      } else if (!active.items.length) {
        var draft = studies.find(function (s) { return statusOf(s) === 'Draft'; }); if (draft) { active = normalize(draft); saveLocalAndPaint(); }
      } else if (active.id) { active = blankStudy(); saveLocalAndPaint(); }
      if (currentRoute === '#/studies') renderList();
    }).catch(function (e) { if (request === listRequest) { listError = 'Studies could not be updated. Your current shelf is still safe. ' + (e.message || e); if (currentRoute === '#/studies') renderList(); } });
  }
  function show(hash) {
    var path = (hash || '#/studies').split('?')[0]; currentRoute = path;
    if (path === '#/studies/review') renderReview(); else if (path.indexOf('#/studies/') === 0) openStudy(decodeURIComponent(path.slice(10))); else { renderList(); refreshList(); }
  }
  function hide() { currentRoute = '#/hidden'; stopPolling(); }
  function start(accessCode) {
    code = accessCode; if (started) return; started = true; active = localGet();
    if (!active.by) active.by = rememberedBy(); if (!navigator.onLine && active._dirty) syncState = 'offline'; saveLocalAndPaint(); refreshList();
    $('shelfLabel').onclick = function () { location.hash = '#/studies/review'; };
    window.addEventListener('online', function () {
      if (active._dirty) saveNow().catch(function () {}).finally(refreshList); else refreshList();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stopPolling();
      else if (currentRoute === '#/studies/review' && locked() && !pollTimer) startPolling();
    });
  }
  window.Studies = {
    summary: function () { return { active: !!(active.id || active.name || active.items.length), name: displayName() }; },
    start: start, show: show, hide: hide, has: function (key) { return active.items.indexOf(key) >= 0; }, locked: locked, toggle: toggle, addAll: addAll,
    _test: { shelf: function () { return JSON.parse(JSON.stringify(active)); }, studies: function () { return JSON.parse(JSON.stringify(studies)); }, slots: slotUse, syncNow: saveNow, refresh: refreshList, poll: startPolling }
  };
})();
