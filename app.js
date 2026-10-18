
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var store = {
    get: function (k) { try { return localStorage.getItem('nccog.' + k) || ''; } catch (e) { return ''; } },
    set: function (k, v) { try { localStorage.setItem('nccog.' + k, v); } catch (e) {} }
  };
  var state = { type: 'Sermon', src: 'youtube', code: store.get('code'), fileText: '', fileName: '', catalog: null };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function msg(el, kind, html) { $(el).innerHTML = html ? '<div class="msg ' + kind + '">' + html + '</div>' : ''; }
  function busy(el, text) { $(el).innerHTML = '<div class="msg info">' + esc(text) + '<div class="progress"><i></i></div></div>'; }
  var API = 'https://script.google.com/macros/s/AKfycbyBwzkNdR2GQeZgReO4uOgmC2V_mQeMuFRCeIpbOvv7tsTYfWCeoi8Gz1_7ZZCCQ7Z8/exec';
  var ACTIONS = { getPublicInfo: 'publicInfo', verifyCode: 'verifyCode', getCatalog: 'catalog', addItem: 'addItem' };
  function call(fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    if (!navigator.onLine) return Promise.reject(new Error('No internet connection. Nothing was sent. Try again when you are back online.'));
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: ACTIONS[fn], args: args }) })
      .then(function (r) { if (!r.ok) throw new Error('The library server did not answer (HTTP ' + r.status + '). Nothing was saved. Try again in a minute.'); return r.json(); })
      .then(function (j) { if (!j.ok) throw new Error(j.error || 'Something went wrong.'); return j.data; })
      .catch(function (e) { if (e instanceof TypeError) throw new Error('Could not reach the library server. Check your internet and try again. Nothing was saved.'); throw e; });
  }
  function friendly(e) {
    var m = (e && e.message) || String(e);
    m = m.replace(/^Exception:\s*/, '');
    if (/Exceeded maximum execution time/i.test(m)) m = 'That took too long and was stopped. Nothing was saved. For long videos, try again with a shorter length, or email Matt.';
    return esc(m) + '<br><small>Need help? <a href="mailto:mstaton53@gmail.com?subject=Notebook%20Library%20app%20problem">Email Matt</a></small>';
  }

  // ---------- tabs ----------
  function showTab(name) {
    ['add', 'library', 'help', 'admin'].forEach(function (t) { var s = $('tab-' + t); if (s) s.classList.toggle('hidden', t !== name); });
    Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) { b.classList.toggle('on', b.dataset.tab === name); });
    if (name === 'library') loadCatalog();
    if (name === 'admin') loadAdmin();
  }
  Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) {
    b.addEventListener('click', function () { showTab(b.dataset.tab); });
  });

  // ---------- gate ----------
  function enterApp() {
    $('gate').classList.add('hidden');
    $('tabs').classList.remove('hidden');
    showTab('add');
    call('getCatalog', state.code).then(function (c) { state.catalog = c; fillNotebookSelect(); }).catch(function () {});
  }
  function tryCode(code) {
    return call('verifyCode', code).then(function () { state.code = code; store.set('code', code); enterApp(); });
  }
  $('codeBtn').addEventListener('click', function () {
    var c = $('codeIn').value.trim();
    if (!c) return msg('gateMsg', 'err', 'Please type the access code.');
    busy('gateMsg', 'Checking…');
    tryCode(c).catch(function (e) { msg('gateMsg', 'err', friendly(e)); });
  });
  $('codeIn').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('codeBtn').click(); });

  call('getPublicInfo').then(function (info) {
    if (!info.ready && !info.isOwner) {
      $('gate').classList.remove('hidden');
      msg('gateMsg', 'info', 'The app is still being set up. Please try again later, or email Matt.');
      return;
    }
    if (info.isOwner) { state.code = state.code || '__owner__'; }
    if (state.code && state.code !== '__owner__') {
      tryCode(state.code).catch(function () { $('gate').classList.remove('hidden'); });
    } else if (info.isOwner) {
      $('tabs').classList.remove('hidden'); showTab(info.ready ? 'add' : 'admin');
    } else {
      $('gate').classList.remove('hidden');
    }
  }).catch(function (e) { $('gate').classList.remove('hidden'); msg('gateMsg', 'err', friendly(e)); });

  // ---------- add form ----------
  $('byIn').value = store.get('by');
  function pick(groupId, key, after) {
    Array.prototype.forEach.call(document.querySelectorAll('#' + groupId + ' .choice'), function (b) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('#' + groupId + ' .choice'), function (x) { x.classList.remove('on'); });
        b.classList.add('on'); state[key] = b.dataset.v; if (after) after();
      });
    });
  }
  function syncForm() {
    ['youtube', 'audio', 'file', 'paste'].forEach(function (s) { $('src-' + s).classList.toggle('hidden', s !== state.src); });
    $('authorLbl').textContent = state.type === 'Sermon' ? 'Speaker' : 'Author';
    $('authorIn').placeholder = state.type === 'Sermon' ? 'e.g. Pastor Smith' : 'e.g. Andrew Murray';
  }
  pick('typeChoices', 'type', function () {
    if (state.type === 'Book' && (state.src === 'youtube' || state.src === 'audio')) { document.querySelector('#srcChoices [data-v=file]').click(); }
    syncForm();
  });
  pick('srcChoices', 'src', syncForm);
  syncForm();

  function fillNotebookSelect() {
    var sel = $('nbIn');
    while (sel.options.length > 1) sel.remove(1);
    (state.catalog ? state.catalog.notebooks : []).filter(function (n) { return n.intake; }).forEach(function (n) {
      var o = document.createElement('option'); o.value = n.name; o.textContent = n.name; sel.appendChild(o);
    });
  }

  // ---------- file reading (done on this device) ----------
  function readAsText(file) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsText(file); }); }
  function readAsBuffer(file) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsArrayBuffer(file); }); }
  function readAsB64(file) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1]); }; r.onerror = rej; r.readAsDataURL(file); }); }

  function pdfText(buf) {
    var lib = window.pdfjsLib;
    if (!lib) return Promise.reject(new Error('The PDF reader did not load. Check your internet connection and try again.'));
    lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    return lib.getDocument({ data: buf }).promise.then(function (pdf) {
      var pages = [], i = 1;
      function next() {
        if (i > pdf.numPages) return Promise.resolve(pages.join('\n\n'));
        $('fileInfo').textContent = 'Reading page ' + i + ' of ' + pdf.numPages + '…';
        return pdf.getPage(i).then(function (p) { return p.getTextContent(); }).then(function (tc) {
          var line = '', out = [], lastY = null;
          tc.items.forEach(function (it) {
            var y = it.transform ? Math.round(it.transform[5]) : null;
            if (lastY !== null && y !== lastY) { out.push(line); line = ''; }
            line += it.str + (it.hasEOL ? '\n' : ''); lastY = y;
          });
          out.push(line); pages.push(out.join('\n')); i++; return next();
        });
      }
      return next();
    });
  }
  function epubText(buf) {
    if (!window.JSZip) return Promise.reject(new Error('The EPUB reader did not load. Check your internet connection and try again.'));
    return JSZip.loadAsync(buf).then(function (zip) {
      return zip.file('META-INF/container.xml').async('string').then(function (c) {
        var opfPath = /full-path="([^"]+)"/.exec(c)[1];
        var base = opfPath.indexOf('/') >= 0 ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
        return zip.file(opfPath).async('string').then(function (opf) {
          var doc = new DOMParser().parseFromString(opf, 'application/xml');
          var man = {};
          Array.prototype.forEach.call(doc.getElementsByTagName('item'), function (it) { man[it.getAttribute('id')] = it.getAttribute('href'); });
          var spine = Array.prototype.map.call(doc.getElementsByTagName('itemref'), function (r) { return man[r.getAttribute('idref')]; }).filter(Boolean);
          return Promise.all(spine.map(function (h) {
            var f = zip.file(decodeURIComponent(base + h)); return f ? f.async('string') : '';
          })).then(function (htmls) {
            return htmls.map(function (h) {
              var d = new DOMParser().parseFromString(h, 'text/html');
              Array.prototype.forEach.call(d.querySelectorAll('p,div,h1,h2,h3,h4,li,br'), function (n) { n.appendChild(d.createTextNode('\n')); });
              return (d.body ? d.body.textContent : '').replace(/\n{3,}/g, '\n\n').trim();
            }).join('\n\n');
          });
        });
      });
    });
  }
  $('fileIn').addEventListener('change', function () {
    var f = this.files[0]; state.fileText = ''; state.fileName = '';
    if (!f) return;
    $('fileInfo').textContent = 'Reading ' + f.name + '…';
    var name = f.name.toLowerCase(), p;
    if (name.endsWith('.pdf')) p = readAsBuffer(f).then(pdfText);
    else if (name.endsWith('.epub')) p = readAsBuffer(f).then(epubText);
    else if (name.endsWith('.txt')) p = readAsText(f);
    else { $('fileInfo').textContent = 'Please choose a PDF, EPUB or TXT file.'; return; }
    p.then(function (t) {
      state.fileText = t; state.fileName = f.name;
      var w = (t.match(/\S+/g) || []).length;
      $('fileInfo').textContent = w < 50
        ? 'Found almost no text in this file. If it is a scanned book (pictures of pages), it cannot be read yet.'
        : '✓ Read ' + w.toLocaleString() + ' words from ' + f.name + '.';
      if (!$('titleIn').value) $('titleIn').value = f.name.replace(/\.(pdf|epub|txt)$/i, '').replace(/[_-]+/g, ' ');
    }).catch(function (e) { $('fileInfo').textContent = 'Could not read this file: ' + (e.message || e); });
  });

  // ---------- submit ----------
  function submit(extra) {
    var item = { code: state.code, by: $('byIn').value.trim(), type: state.type, title: $('titleIn').value.trim(),
      author: $('authorIn').value.trim(), date: $('dateIn').value, notebook: $('nbIn').value, source: '' };
    store.set('by', item.by);
    if (!item.title) return Promise.reject(new Error('Please give it a title (step 3).'));
    var prep;
    if (extra && extra.text) { item.text = extra.text; item.source = extra.source || ''; item.confirmNotebook = extra.confirmNotebook; prep = Promise.resolve(); }
    else if (state.src === 'youtube') {
      var u = $('ytUrl').value.trim();
      if (!/^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(u)) return Promise.reject(new Error('Please paste a YouTube link (it starts with https://youtube.com or https://youtu.be).'));
      item.youtube = u; item.minutes = $('ytMin').value; prep = Promise.resolve();
    } else if (state.src === 'audio') {
      var a = $('audioIn').files[0];
      if (!a) return Promise.reject(new Error('Please choose an audio file.'));
      if (a.size > 30 * 1024 * 1024) return Promise.reject(new Error('That audio file is over 30 MB. Please use a YouTube link for long recordings, or email Matt.'));
      item.audioMime = a.type || 'audio/mpeg';
      prep = readAsB64(a).then(function (b) { item.audioB64 = b; });
    } else if (state.src === 'file') {
      if (!state.fileText) return Promise.reject(new Error('Please choose a file and wait for the ✓ "Read … words" message.'));
      item.text = state.fileText; item.source = state.fileName; prep = Promise.resolve();
    } else {
      item.text = $('pasteIn').value;
      if ((item.text.match(/\S+/g) || []).length < 30) return Promise.reject(new Error('Please paste at least a few sentences.'));
      prep = Promise.resolve();
    }
    return prep.then(function () { return call('addItem', item); });
  }

  function showResult(r) {
    if (r.status === 'choose') {
      var html = 'Not sure where this fits best. <b>Pick a notebook:</b><div class="choices" style="margin-top:10px">' +
        r.options.map(function (o) { return '<button class="choice' + (o === r.suggestion ? ' on' : '') + '" data-nb="' + esc(o) + '"><b>' + esc(o) + '</b>' +
          (o === r.suggestion ? '<span>suggested</span>' : '') + '</button>'; }).join('') + '</div>';
      msg('addMsg', 'info', html);
      Array.prototype.forEach.call(document.querySelectorAll('#addMsg [data-nb]'), function (b) {
        b.addEventListener('click', function () { run({ text: r.text, source: r.source, confirmNotebook: b.dataset.nb }); });
      });
      return;
    }
    var links = r.shelves.map(function (s) { return '<a href="' + esc(s.url) + '" target="_blank">' + esc(s.name) + '</a>'; }).join(', ');
    msg('addMsg', 'ok', '<b>✓ Added to “' + esc(r.notebook) + '”</b> (' + Number(r.words).toLocaleString() + ' words).<br>' +
      'Saved on: ' + links + '<br><b>Ready in about 5 minutes.</b> The notebook picks it up by itself.' +
      (r.note ? '<br><small>' + esc(r.note) + '</small>' : '') +
      (r.notebookUrl ? '<p><a class="btn small" href="' + esc(r.notebookUrl) + '" target="_blank">Open the notebook</a></p>' : ''));
    $('titleIn').value = ''; $('pasteIn').value = ''; $('ytUrl').value = ''; $('fileIn').value = ''; $('audioIn').value = '';
    state.fileText = ''; $('fileInfo').textContent = ''; state.catalog = null;
  }

  function run(extra) {
    $('addBtn').disabled = true;
    var slow = state.src === 'youtube' || state.src === 'audio';
    busy('addMsg', slow && !(extra && extra.text) ? 'Transcribing and sorting… this can take 1–4 minutes. Please keep this page open.' : 'Saving and sorting…');
    submit(extra).then(showResult).catch(function (e) { msg('addMsg', 'err', friendly(e)); })
      .then(function () { $('addBtn').disabled = false; });
  }
  $('addBtn').addEventListener('click', function () { run(); });

  // ---------- library ----------
  function loadCatalog() {
    var draw = function (c) {
      state.catalog = c;
      $('nbList').innerHTML = c.notebooks.length ? c.notebooks.map(function (n) {
        return '<div class="nb"><div><b>' + esc(n.name) + '</b><small>' + esc(n.description) + '</small>' +
          (n.intake ? '<small>' + n.shelvesFree + ' of ' + n.shelvesTotal + ' shelves free</small>' : '<small>Reference library</small>') + '</div>' +
          (n.url ? '<a class="btn small" href="' + esc(n.url) + '" target="_blank">Open</a>' : '') + '</div>';
      }).join('') : 'No notebooks yet.';
      drawItems();
    };
    if (state.catalog) draw(state.catalog);
    call('getCatalog', state.code).then(draw).catch(function (e) { $('nbList').innerHTML = '<div class="msg err">' + friendly(e) + '</div>'; });
  }
  function drawItems() {
    var q = $('searchIn').value.trim().toLowerCase();
    var items = (state.catalog ? state.catalog.items : []).filter(function (it) {
      return !q || [it.title, it.author, it.topics, it.notebook, it.summary, it.type].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    var nbUrl = {}; (state.catalog ? state.catalog.notebooks : []).forEach(function (n) { nbUrl[n.name] = n.url; });
    $('itemList').innerHTML = items.length ? items.map(function (it) {
      return '<div class="item"><div class="t">' + esc(it.title) + '</div>' +
        '<div class="m">' + esc(it.type) + (it.author ? ' · ' + esc(it.author) : '') + (it.date ? ' · ' + esc(it.date) : '') +
        ' · in <a href="' + esc(nbUrl[it.notebook] || '#') + '" target="_blank">' + esc(it.notebook) + '</a>' +
        ' · <a href="' + esc(it.shelfUrl) + '" target="_blank">read the text</a></div>' +
        (it.summary ? '<div class="m">' + esc(it.summary) + '</div>' : '') +
        (it.topics ? String(it.topics).split(',').map(function (t) { return '<span class="tag">' + esc(t.trim()) + '</span>'; }).join('') : '') + '</div>';
    }).join('') : (q ? 'Nothing matches “' + esc(q) + '”.' : 'Nothing added yet. Use the ➕ Add tab.');
  }
  $('searchIn').addEventListener('input', drawItems);

  // ---------- Android share menu: prefill a shared YouTube link or text ----------
  (function () {
    var p = new URLSearchParams(location.search);
    var shared = [p.get('url'), p.get('text'), p.get('title')].filter(Boolean).join(' ');
    if (!shared) return;
    var m = shared.match(/https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/\S+|youtu\.be\/\S+)/i);
    if (m) {
      $('ytUrl').value = m[0];
      document.querySelector('#typeChoices [data-v=Sermon]').click();
      document.querySelector('#srcChoices [data-v=youtube]').click();
      var t = (p.get('title') || '').trim(); if (t && !$('titleIn').value) $('titleIn').value = t;
    } else {
      document.querySelector('#srcChoices [data-v=paste]').click();
      $('pasteIn').value = shared;
    }
    history.replaceState(null, '', location.pathname);
  })();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
})();

