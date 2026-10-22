/* MiniSearch 7.2.0 (MIT, Luca Ongaro). See THIRD-PARTY-LICENSES.txt. */
'use strict';
var engine, rows = [], generation = 0;
var loadError = false;
var kindOrder = { B: 0, C: 0, K: 1, S: 1, U: 2, J: 3, F: 4 };
try { importScripts('https://cdn.jsdelivr.net/npm/minisearch@7.2.0/dist/umd/index.min.js'); }
catch (e) { loadError = true; }
function normalized(value) {
  return String(value || '').toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim();
}
function wholePhrase(text, phrase) {
  if (!phrase) return false;
  var at = text.indexOf(phrase);
  while (at !== -1) {
    var before = at === 0 || !/[a-z0-9]/.test(text.charAt(at - 1));
    var end = at + phrase.length;
    var after = end === text.length || !/[a-z0-9]/.test(text.charAt(end));
    if (before && after) return true;
    at = text.indexOf(phrase, at + 1);
  }
  return false;
}
function matchBonus(row, phrase) {
  var title = normalized(row[1]), author = normalized(row[2]), bonus = 0;
  if (title === phrase) bonus += 2;
  else if (title.indexOf(phrase) === 0 || wholePhrase(title, phrase)) bonus += 1;
  if (wholePhrase(author, phrase)) bonus += 1;
  return bonus;
}
self.onmessage = function (event) {
  var m = event.data;
  if (m.type === 'build') {
    if (loadError) { self.postMessage({ type: 'error', message: 'Search did not load. Your library is safe. Browse by kind or notebook, or reconnect and tap Try search again.' }); return; }
    var started = performance.now(), at = 0, run = ++generation;
    rows = m.items;
    engine = new MiniSearch({ fields: ['title', 'author'], searchOptions: { boost: { title: 3 }, prefix: true, fuzzy: 0.2, combineWith: 'AND' } });
    function chunk() {
      if (run !== generation) return;
      try {
        var end = Math.min(at + 750, rows.length);
        for (; at < end; at++) engine.add({ id: at, title: rows[at][1], author: rows[at][2] });
        if (at < rows.length) { self.postMessage({ type: 'progress', done: at, count: rows.length }); setTimeout(chunk, 0); }
        else self.postMessage({ type: 'ready', milliseconds: performance.now() - started, count: rows.length });
      } catch (e) { self.postMessage({ type: 'error', message: 'Search could not get ready. Your library is safe. Browse by kind or notebook, or tap Try search again.' }); }
    }
    chunk();
  } else if (m.type === 'search') {
    try {
      var start = performance.now();
      var found = m.q ? engine.search(m.q) : rows.map(function (_, i) { return { id: i, score: 0 }; });
      found = found.filter(function (result) {
        var i = result.id;
        var row = rows[i];
        return (!m.kind || row[5] === m.kind) && (m.notebook == null || row[4] === m.notebook) && (m.other || row[5] !== 'F');
      });
      if (m.q) {
        var phrase = normalized(m.q);
        found.forEach(function (result) { result.titleAuthorBonus = matchBonus(rows[result.id], phrase); });
        found.sort(function (a, b) {
          var bonus = b.titleAuthorBonus - a.titleAuthorBonus;
          if (bonus) return bonus;
          // Equivalent exact matches use the requested kind order so journals cannot swamp books.
          if (a.titleAuthorBonus > 0) {
            var kind = kindOrder[rows[a.id][5]] - kindOrder[rows[b.id][5]];
            if (kind) return kind;
          }
          var score = b.score - a.score;
          if (score) return score;
          return kindOrder[rows[a.id][5]] - kindOrder[rows[b.id][5]] || a.id - b.id;
        });
      }
      var ids = found.map(function (result) { return result.id; });
      self.postMessage({ type: 'results', request: m.request, ids: ids, milliseconds: performance.now() - start });
    } catch (e) { self.postMessage({ type: 'queryError', request: m.request }); }
  }
};
