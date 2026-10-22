/* Book-level resource guide. No chapter coverage or Bible text is implied. */
(function () {
  'use strict';
  var books = [
    ['Gen','Genesis',50],['Exod','Exodus',40],['Lev','Leviticus',27],['Num','Numbers',36],['Deut','Deuteronomy',34],
    ['Josh','Joshua',24],['Judg','Judges',21],['Ruth','Ruth',4],['1Sam','1 Samuel',31],['2Sam','2 Samuel',24],
    ['1Kgs','1 Kings',22],['2Kgs','2 Kings',25],['1Chr','1 Chronicles',29],['2Chr','2 Chronicles',36],['Ezra','Ezra',10],
    ['Neh','Nehemiah',13],['Esth','Esther',10],['Job','Job',42],['Ps','Psalms',150],['Prov','Proverbs',31],
    ['Eccl','Ecclesiastes',12],['Song','Song of Solomon',8],['Isa','Isaiah',66],['Jer','Jeremiah',52],['Lam','Lamentations',5],
    ['Ezek','Ezekiel',48],['Dan','Daniel',12],['Hos','Hosea',14],['Joel','Joel',3],['Amos','Amos',9],['Obad','Obadiah',1],
    ['Jonah','Jonah',4],['Mic','Micah',7],['Nah','Nahum',3],['Hab','Habakkuk',3],['Zeph','Zephaniah',3],['Hag','Haggai',2],
    ['Zech','Zechariah',14],['Mal','Malachi',4],['Matt','Matthew',28],['Mark','Mark',16],['Luke','Luke',24],['John','John',21],
    ['Acts','Acts',28],['Rom','Romans',16],['1Cor','1 Corinthians',16],['2Cor','2 Corinthians',13],['Gal','Galatians',6],
    ['Eph','Ephesians',6],['Phil','Philippians',4],['Col','Colossians',4],['1Thess','1 Thessalonians',5],['2Thess','2 Thessalonians',3],
    ['1Tim','1 Timothy',6],['2Tim','2 Timothy',4],['Titus','Titus',3],['Phlm','Philemon',1],['Heb','Hebrews',13],
    ['Jas','James',5],['1Pet','1 Peter',5],['2Pet','2 Peter',3],['1John','1 John',5],['2John','2 John',1],['3John','3 John',1],
    ['Jude','Jude',1],['Rev','Revelation',22]
  ];
  var byCode = new Map(books.map(function (b) { return [b[0], b]; }));
  var parser, parserPromise, failed = false, suggestionToken = 0, currentGroups = [], helpers;
  var parserURL = 'https://cdn.jsdelivr.net/npm/bible-passage-reference-parser@4.0.0/cjs/en_bcv_parser.js';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }
  function getRecent() {
    try { var value = JSON.parse(localStorage.getItem('nccog.recentPassages') || '[]'); return Array.isArray(value) ? value.filter(function (s) { return !!decode(s); }).slice(0, 5) : []; } catch (e) { return []; }
  }
  function remember(osis) {
    try { localStorage.setItem('nccog.recentPassages', JSON.stringify([osis].concat(getRecent().filter(function (s) { return s !== osis; })).slice(0, 5))); } catch (e) { /* Optional history; no study data is affected. */ }
  }
  function decode(osis) {
    var parts = String(osis).split('-');
    if (parts.length > 2) return null;
    function endpoint(s) {
      var m = /^([1-3]?[A-Za-z]+)(?:\.([1-9]\d{0,2})(?:\.([1-9]\d{0,2}))?)?$/.exec(s), book = m && byCode.get(m[1]);
      return book && (!m[2] || +m[2] <= book[2]) && (!m[3] || +m[3] <= 176) ? { book: book, chapter: m[2] || '', verse: m[3] || '' } : null;
    }
    var first = endpoint(parts[0]), last = parts[1] && endpoint(parts[1]);
    if (!first || parts[1] && (!last || last.book !== first.book || !first.chapter || !last.chapter || +last.chapter < +first.chapter || last.chapter === first.chapter && +last.verse < +first.verse)) return null;
    var label = first.book[1] + (first.chapter ? ' ' + first.chapter : '') + (first.verse ? ':' + first.verse : '');
    if (last) label += '–' + (last.chapter === first.chapter && last.verse ? last.verse : last.chapter + (last.verse ? ':' + last.verse : ''));
    return { osis: osis, book: first.book, chapter: first.chapter, label: label };
  }
  function loadParser() {
    if (parser) return Promise.resolve(parser);
    if (parserPromise) return parserPromise;
    parserPromise = new Promise(function (resolve, reject) {
      if (typeof structuredClone !== 'function') { reject(new Error('Reference reader unavailable')); return; }
      var script = document.createElement('script'), done = false;
      var timer = setTimeout(function () { finish(new Error('Reference reader timed out')); }, 8000);
      function finish(error) {
        if (done) return; done = true; clearTimeout(timer); script.onload = script.onerror = null;
        if (error) { script.remove(); reject(error); return; }
        try { parser = new window.bcv_parser(); parser.set_options({ book_alone_strategy: 'full', osis_compaction_strategy: 'b', testaments: 'on' }); resolve(parser); }
        catch (e) { script.remove(); reject(e); }
      }
      script.src = parserURL; script.charset = 'utf-8'; script.onload = function () { finish(); }; script.onerror = function () { finish(new Error('Reference reader unavailable')); };
      document.head.appendChild(script);
    }).then(function (p) { failed = false; return p; }).catch(function (e) { failed = true; parserPromise = null; throw e; });
    return parserPromise;
  }
  function looksLikeReference(q) {
    var start = q.trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, '');
    return books.some(function (b) {
      var name = b[1].toLowerCase().replace(/\s+/g, ''), code = b[0].toLowerCase();
      return start.indexOf(code) === 0 || start.indexOf(name.slice(0, Math.min(3, name.length))) === 0;
    }) || /^(?:[123]|i{1,3})\s*(?:cor|john|sam|ki|chr|th|tim|pet)/i.test(q) || /^(?:jn|jhn|mt|mk|lk|ro|rm|pr|dt|gn|ex|lv|nu|ac|re)(?=[\s.\d:]|$)/i.test(q);
  }
  function parse(q) {
    return loadParser().then(function (p) {
      var text = q.trim(), matches = p.parse(text).osis_and_indices();
      // Full input only: author names and general catalog searches must stay searches.
      if (matches.length !== 1 || matches[0].indices[0] !== 0 || matches[0].indices[1] !== text.length) return null;
      return decode(matches[0].osis);
    });
  }
  function suggest(q) {
    var token = ++suggestionToken, el = document.getElementById('passageSuggestion'); if (!el) return;
    el.innerHTML = '';
    if (!q.trim() || q.length > 150) return;
    if (looksLikeReference(q)) el.innerHTML = '<p class="hint">Looking for a Bible reference…</p>';
    parse(q).then(function (ref) {
      if (token !== suggestionToken || !el.isConnected) return;
      el.innerHTML = ref ? '<a class="btn gold wide" href="#/passage/' + encodeURIComponent(ref.osis) + '">Study ' + esc(ref.label) + ' →</a>' : '';
    }).catch(function () {
      if (token !== suggestionToken || !el.isConnected || !looksLikeReference(q)) return;
      el.innerHTML = '<div class="msg info">The reference reader could not load. Your shelf is safe. Choose a book and chapter instead.<a class="btn ghost wide" href="#/passage">Choose a book and chapter</a><button class="btn ghost wide" id="retryPassageReader">Try reference reader again</button></div>';
      document.getElementById('retryPassageReader').onclick = function () { suggest(q); };
    });
  }
  function openQuery(q) {
    if (!q.trim() || q.length > 150) return;
    parse(q).then(function (ref) { if (ref && document.getElementById('searchIn') && document.getElementById('searchIn').value.trim() === q.trim()) location.hash = '#/passage/' + encodeURIComponent(ref.osis); })
      .catch(function () { if (looksLikeReference(q) && document.getElementById('searchIn') && document.getElementById('searchIn').value.trim() === q.trim()) location.hash = '#/passage?reader=unavailable'; });
  }
  function bookLinks(list) {
    var compact = { Deut: 'Deut.', Eccl: 'Eccles.', Lam: 'Lam.', '1Thess': '1 Thess.', '2Thess': '2 Thess.' };
    return list.map(function (b) { return '<a class="book-tile" aria-label="' + esc(b[1]) + '" href="#/passage/book/' + b[0] + '">' + esc(compact[b[0]] || b[1]) + '</a>'; }).join('');
  }
  function section(title, items, open, id, bulk) {
    var group = currentGroups.push(items) - 1;
    return '<details class="card passage-section" id="' + id + '"' + (open ? ' open' : '') + '><summary>' + esc(title) + ' <span class="muted">(' + items.length.toLocaleString() + ')</span></summary>' +
      (bulk ? '<button type="button" class="btn gold wide" data-passage-add="' + group + '"' + (!items.length || Studies.locked() ? ' disabled' : '') + '>+ Add all ' + items.length.toLocaleString() + '</button>' : '') +
      '<div class="result-list">' + (items.length ? items.slice(0, 20).map(helpers.rowHTML).join('') : '<p class="hint">No tagged resources in this section yet.</p>') + '</div>' +
      (items.length > 20 ? '<button class="btn ghost wide" data-passage-more="' + group + '">Show 20 more</button>' : '') + '</details>';
  }
  function paintStudy() {
    var el = document.getElementById('passageStudy'); if (!el) return;
    var study = Studies.summary(); el.innerHTML = study.active ? '<a class="passage-study" href="#/studies/review">Adding to: ' + esc(study.name) + '</a>' : '';
    document.querySelectorAll('[data-passage-add]').forEach(function (b) { b.disabled = Studies.locked() || !currentGroups[+b.dataset.passageAdd].length; });
  }
  function render(view, context) {
    helpers = context; currentGroups = [];
    var path = location.hash.split('?')[0], ref, raw;
    try { raw = decodeURIComponent(path.slice(10)); } catch (e) { raw = ''; }
    if (path === '#/passage') {
      var recent = getRecent();
      view.innerHTML = helpers.back('#/library') + '<h2 class="screen-heading">Choose a book</h2>' +
        (failed || /reader=unavailable/.test(location.hash) ? '<p class="msg info">The reference reader could not load. Your shelf is safe. This picker works without it; reconnect and try typing a reference again later.</p>' : '') +
        '<h3>Recent</h3><div class="recent-passages">' + (recent.length ? recent.map(function (s) { return '<a class="btn ghost" href="#/passage/' + encodeURIComponent(s) + '">' + esc(decode(s).label) + '</a>'; }).join('') : '<p class="hint">Passages you choose will appear here.</p>') + '</div><h3>Old Testament</h3><div class="book-grid">' + bookLinks(books.slice(0, 39)) + '</div><h3>New Testament</h3><div class="book-grid">' + bookLinks(books.slice(39)) + '</div>';
    } else if (path.indexOf('#/passage/book/') === 0 && byCode.has(path.slice(15))) {
      var book = byCode.get(path.slice(15));
      view.innerHTML = helpers.back('#/passage') + '<h2 class="screen-heading">' + esc(book[1]) + '</h2><p>Choose a chapter</p><a class="btn gold wide" href="#/passage/' + book[0] + '">Whole book</a><div class="chapter-grid">' + Array.from({ length: book[2] }, function (_, i) { return '<a class="book-tile" href="#/passage/' + book[0] + '.' + (i + 1) + '">' + (i + 1) + '</a>'; }).join('') + '</div>';
    } else if ((ref = decode(raw))) {
      remember(ref.osis);
      var code = ref.book[0], name = ref.book[1];
      var main = helpers.rows.filter(function (r) { var tag = r[8] || {}; return r[5] !== 'F' && (tag.b === 'bible' || Array.isArray(tag.b) && tag.b.indexOf(code) >= 0); });
      var mentions = helpers.rows.filter(function (r) { var tag = r[8] || {}; return r[5] !== 'F' && Array.isArray(tag.m) && tag.m.indexOf(code) >= 0 && main.indexOf(r) < 0; });
      var faiths = helpers.rows.filter(function (r) { var tag = r[8] || {}; return r[5] === 'F' && (tag.b === 'bible' || ['b','m'].some(function (k) { return Array.isArray(tag[k]) && tag[k].indexOf(code) >= 0; })); });
      view.innerHTML = helpers.back('#/passage/book/' + code) + '<h2 class="screen-heading">' + esc(ref.label) + '</h2><a class="btn ghost" href="#/passage">Change passage</a><div id="passageStudy"></div><p class="msg info">Grouped by Bible book. These cover ' + esc(name) + ', not only ' + (ref.chapter ? 'chapter ' + esc(ref.chapter) : 'a single chapter') + '.</p>' +
        section('Bible translations', main.filter(function (r) { return r[5] === 'B' && r[8].b === 'bible'; }), true, 'passage-bibles', true) +
        section('Commentaries on ' + name, main.filter(function (r) { return r[5] === 'C'; }), true, 'passage-commentaries', true) +
        section('Sermons and teaching', main.filter(function (r) { return r[5] === 'S' || r[5] === 'U'; }), false, 'passage-sermons', true) +
        section('Books', main.filter(function (r) { return r[5] === 'K' || r[5] === 'B' && r[8].b !== 'bible'; }), false, 'passage-books', true) +
        section('Journals and periodicals', main.filter(function (r) { return r[5] === 'J'; }), false, 'passage-journals', true) +
        section('Also mentions ' + name, mentions, false, 'passage-mentions', true) +
        '<section class="card"><h3>Other Faiths (' + faiths.length.toLocaleString() + ')</h3><p class="hint">Off by default. Never included in Add all.</p><button class="btn ghost wide" id="passageOther" aria-expanded="false">Include Other Faiths</button><div id="passageFaithRows" class="hidden"></div></section>';
      paintStudy();
      view.querySelectorAll('[data-passage-add]').forEach(function (b) { b.onclick = function () { Studies.addAll(currentGroups[+b.dataset.passageAdd].filter(function (r) { return r[5] !== 'F'; }).map(function (r) { return helpers.shelfKey(r[0]); }), ref.label + ' Study'); }; });
      view.querySelectorAll('[data-passage-more]').forEach(function (b) {
        var count = 20; b.onclick = function () { var items = currentGroups[+b.dataset.passageMore], list = b.previousElementSibling; list.insertAdjacentHTML('beforeend', items.slice(count, count + 20).map(helpers.rowHTML).join('')); count += 20; if (count >= items.length) b.remove(); helpers.bind(); };
      });
      document.getElementById('passageOther').onclick = function () {
        var target = document.getElementById('passageFaithRows'), open = this.getAttribute('aria-expanded') !== 'true';
        this.setAttribute('aria-expanded', String(open)); this.textContent = open ? 'Hide Other Faiths' : 'Include Other Faiths'; target.classList.toggle('hidden', !open);
        if (open) { target.innerHTML = faiths.length ? faiths.map(helpers.rowHTML).join('') : '<p class="hint">No matching resources in Other Faiths.</p>'; helpers.bind(); }
      };
    } else {
      view.innerHTML = helpers.back('#/library') + '<div class="card"><h2>Choose a valid passage</h2><p>This passage is not available. Your shelf is safe. Choose a book and chapter to continue.</p><a class="btn ghost wide" href="#/passage">Choose a book and chapter</a></div>';
    }
    helpers.bind();
  }
  window.Passages = { render: render, suggest: suggest, openQuery: openQuery, paintStudy: paintStudy };
})();
