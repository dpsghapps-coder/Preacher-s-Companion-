'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
const LANGNAME = { en: 'English', tw: 'Twi' };
let db, lang = store.get('lang', 'en'), fs = store.get('fs', 19);
let favs = store.get('favs', []), recent = store.get('recent', []);
let wake = null;

function q(sql, params = []) {
  const st = db.prepare(sql); st.bind(params);
  const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out;
}
const langs = () => lang === 'both' ? ['en', 'tw'] : [lang];
const firstLang = () => lang === 'tw' ? 'tw' : 'en';

function fold(t) {
  return t.toLowerCase().replace(/ɔ/g, 'o').replace(/ɛ/g, 'e').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------- shell */
function setLang(l) {
  lang = l; store.set('lang', l); renderShell(); route();
}
function renderShell() {
  document.querySelectorAll('#langseg button').forEach(b => b.classList.toggle('on', b.dataset.lang === lang));
  document.documentElement.style.setProperty('--fs', fs + 'px');
}
document.addEventListener('click', e => {
  const b = e.target.closest('#langseg button'); if (b) setLang(b.dataset.lang);
});

function hymnRow(n, first, sub) {
  return `<li><a href="#/h/${n}"><span class="num">${n}</span><span class="first">${esc(first)}${sub ? `<small>${esc(sub)}</small>` : ''}</span></a></li>`;
}
function firstLines(nums) {
  if (!nums.length) return {};
  const rows = q(`SELECT hymn_number n, language l, first_line f, theme t, subtheme s FROM hymn_text WHERE hymn_number IN (${nums.join(',')})`);
  const m = {}; rows.forEach(r => { (m[r.n] ||= {})[r.l] = r; }); return m;
}
function rowsFor(nums) {
  const m = firstLines(nums), fl = firstLang();
  return nums.map(n => {
    const r = m[n]?.[fl] || m[n]?.en || m[n]?.tw || {};
    const other = lang === 'both' ? (m[n]?.[fl === 'en' ? 'tw' : 'en']?.f || '') : '';
    const th = [r.t, r.s].filter(Boolean).join(' › ');
    return hymnRow(n, r.f || '', other || th);
  }).join('');
}

/* ------------------------------------------------------------- search */
const BOOK_RE = /^((?:[1-3]\s?)?[a-z]+)\.?\s*(\d+)(?:\s*[:.\s]\s*(\d+))?$/i;
function search(text) {
  text = text.trim(); if (!text) return { nums: [], note: '' };
  if (/^\d{1,3}$/.test(text)) { const n = +text; return n >= 1 && n <= 850 ? { nums: [n], note: '' } : { nums: [], note: 'Hymn numbers run from 1 to 850.' }; }
  const m = text.match(BOOK_RE);
  if (m) {
    const prefix = m[1].replace(/\s/g, '').toLowerCase();
    const books = q(`SELECT DISTINCT book FROM scripture_ref WHERE book IS NOT NULL AND replace(lower(book),' ','') LIKE ? ORDER BY book`, [prefix + '%']);
    if (books.length && prefix.length >= 2) {
      const b = books[0].book, ch = +m[2], v = m[3] ? +m[3] : null;
      const rows = q(`SELECT DISTINCT hymn_number n FROM scripture_ref WHERE book=? AND chapter=? ${v ? 'AND (verse_start IS NULL OR (verse_start<=? AND coalesce(verse_end,verse_start)>=?))' : ''} ORDER BY n`, v ? [b, ch, v, v] : [b, ch]);
      return { nums: rows.map(r => r.n), note: `Hymns referring to ${b} ${ch}${v ? ':' + v : ''}` };
    }
  }
  const words = fold(text).split(' ').filter(Boolean);
  if (!words.length) return { nums: [], note: '' };
  const where = words.map(() => 'norm LIKE ?').join(' AND ');
  const ph = langs().map(() => '?').join(',');
  const rows = q(`SELECT DISTINCT hymn_number n FROM hymn_search WHERE language IN (${ph}) AND ${where} ORDER BY n LIMIT 120`, [...langs(), ...words.map(w => '%' + w + '%')]);
  return { nums: rows.map(r => r.n), note: `Words matching “${text}”` };
}
let lastQuery = '';
function viewSearch() {
  $('#view').innerHTML = `<input id="q" type="search" placeholder="Hymn number, words, or Bible passage (e.g. Psalm 23)" autocomplete="off" enterkeyhint="search" value="${esc(lastQuery)}">
    <div class="hint">Try: <b>79</b> · <b>redeemer</b> · <b>Nyankopɔn</b> · <b>John 3:16</b></div><div id="res"></div>`;
  const inp = $('#q'), res = $('#res');
  const run = () => {
    lastQuery = inp.value;
    const r = search(inp.value);
    if (!inp.value.trim()) {
      const rec = recent.slice(0, 8);
      res.innerHTML = rec.length ? `<div class="hint">Recently opened</div><ul class="list">${rowsFor(rec)}</ul>` : '';
      return;
    }
    res.innerHTML = r.nums.length ? `<div class="hint">${esc(r.note)} · ${r.nums.length}${r.nums.length === 120 ? '+' : ''} hymn(s)</div><ul class="list">${rowsFor(r.nums)}</ul>`
      : `<p class="muted">${esc(r.note || 'No hymns found.')}</p>`;
  };
  let t; inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 150); });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter' && /^\d{1,3}$/.test(inp.value.trim())) location.hash = '#/h/' + +inp.value.trim(); });
  run(); if (!/Mobi|Android/i.test(navigator.userAgent)) inp.focus();
}

/* ------------------------------------------------------------- themes */
function viewThemes() {
  const l = firstLang();
  const rows = q(`SELECT hymn_number n, first_line f, theme t, subtheme s FROM hymn_text WHERE language=? ORDER BY hymn_number`, [l]);
  const tree = new Map();
  rows.forEach(r => {
    const t = r.t || '(other)', s = r.s || '';
    if (!tree.has(t)) tree.set(t, new Map());
    const sm = tree.get(t); if (!sm.has(s)) sm.set(s, []); sm.get(s).push(r);
  });
  let h = `<div class="hint">Themes of the ${LANGNAME[l]} book</div>`;
  for (const [t, sm] of tree) {
    const count = [...sm.values()].reduce((a, b) => a + b.length, 0);
    h += `<details><summary>${esc(t)} <span class="muted">(${count})</span></summary>`;
    for (const [s, items] of sm) {
      const list = `<ul class="list">${items.map(r => hymnRow(r.n, r.f)).join('')}</ul>`;
      h += s ? `<details><summary>${esc(s)} <span class="muted">${items[0].n}–${items.at(-1).n}</span></summary>${list}</details>` : list;
    }
    h += '</details>';
  }
  $('#view').innerHTML = h;
}

/* ------------------------------------------------------------- saved */
function viewSaved() {
  $('#view').innerHTML = (favs.length ? `<div class="hint">Saved hymns</div><ul class="list">${rowsFor([...favs].sort((a, b) => a - b))}</ul>`
    : `<p class="muted pad">No saved hymns yet. Open a hymn and tap ☆ to keep it here.</p>`) +
    (recent.length ? `<div class="hint">Recently opened</div><ul class="list">${rowsFor(recent.slice(0, 15))}</ul>` : '');
}

/* ------------------------------------------------------------- hymn */
function refsText(n) {
  const rs = q(`SELECT raw, book, chapter, verse_start a, verse_end b FROM scripture_ref WHERE hymn_number=? ORDER BY id`, [n]);
  return rs.map(r => r.book ? `${r.book} ${r.chapter}${r.a ? ':' + r.a + (r.b && r.b !== r.a ? '–' + r.b : '') : ''}` : r.raw);
}
function viewHymn(n) {
  if (!(n >= 1 && n <= 850)) { $('#view').innerHTML = '<p class="muted pad">No such hymn.</p>'; return; }
  recent = [n, ...recent.filter(x => x !== n)].slice(0, 30); store.set('recent', recent);
  const texts = q(`SELECT * FROM hymn_text WHERE hymn_number=?`, [n]);
  const refs = refsText(n);
  const cols = langs().map(l => {
    const ht = texts.find(t => t.language === l);
    if (!ht) return '';
    const st = q(`SELECT s.id, s.kind, s.verse_number v, s.variant FROM stanza s WHERE hymn_text_id=? ORDER BY seq`, [ht.id]);
    let lastVar = null;
    const body = st.map(s => {
      const lines = q(`SELECT text FROM line WHERE stanza_id=? ORDER BY seq`, [s.id]).map(r => esc(r.text)).join('\n');
      let pre = '';
      if (s.variant && s.variant !== lastVar) { pre = `<div class="hint"><b>Version ${esc(s.variant)}</b></div>`; lastVar = s.variant; }
      return pre + `<div class="stanza ${s.kind}"><span class="vn">${s.kind === 'verse' ? s.v : ''}</span><p>${lines}</p></div>`;
    }).join('');
    const credit = ht.author_line ? `<div class="credit">${esc(ht.author_line)}</div>` : '';
    const warn = ht.needs_review ? `<div class="warn">This text is still being proof-read — check it against the printed book.</div>` : '';
    return `<section class="col"><h3>${LANGNAME[l]}</h3>${warn}${body}${credit}</section>`;
  }).join('');
  const meta = texts.find(t => t.language === firstLang()) || texts[0] || {};
  const isFav = favs.includes(n);
  $('#view').innerHTML = `<article class="hymn">
    <div class="bar"><a href="#/hymn-prev">‹ ${Math.max(1, n - 1)}</a>
      <span><button class="star" id="fav" title="Save">${isFav ? '★' : '☆'}</button>
      <button id="smaller" aria-label="Smaller text">A−</button> <button id="bigger" aria-label="Larger text">A+</button>
      <button id="wake" title="Keep the screen on">${wake ? '☀ on' : '☀'}</button></span>
      <a href="#/hymn-next">${Math.min(850, n + 1)} ›</a></div>
    <h2>Hymn ${n}</h2>
    <div class="meta">${refs.map(r => `<span class="chip">${esc(r)}</span>`).join('')}</div>
    <div class="meta">${[meta.theme, meta.subtheme].filter(Boolean).map(esc).join(' › ')}</div>
    <div class="cols ${lang === 'both' ? 'both' : ''}" style="margin-top:14px">${cols}</div></article>`;
  $('#fav').onclick = () => { favs = isFav ? favs.filter(x => x !== n) : [...favs, n]; store.set('favs', favs); viewHymn(n); };
  $('#bigger').onclick = () => { fs = Math.min(40, fs + 2); store.set('fs', fs); renderShell(); };
  $('#smaller').onclick = () => { fs = Math.max(14, fs - 2); store.set('fs', fs); renderShell(); };
  $('#wake').onclick = async () => {
    try { if (wake) { await wake.release(); wake = null; } else wake = await navigator.wakeLock.request('screen'); } catch {}
    $('#wake').textContent = wake ? '☀ on' : '☀';
  };
  $('.bar a[href="#/hymn-prev"]').href = '#/h/' + Math.max(1, n - 1);
  $('.bar a[href="#/hymn-next"]').href = '#/h/' + Math.min(850, n + 1);
  window.scrollTo(0, 0);
}
document.addEventListener('keydown', e => {
  const m = location.hash.match(/^#\/h\/(\d+)/); if (!m || e.target.matches('input')) return;
  if (e.key === 'ArrowLeft') location.hash = '#/h/' + Math.max(1, +m[1] - 1);
  if (e.key === 'ArrowRight') location.hash = '#/h/' + Math.min(850, +m[1] + 1);
});

/* ------------------------------------------------------------- router + boot */
function route() {
  if (!db) return;
  const h = location.hash || '#/';
  const tab = h.startsWith('#/themes') ? 'themes' : h.startsWith('#/saved') ? 'saved' : 'search';
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  const m = h.match(/^#\/h\/(\d+)/);
  if (m) viewHymn(+m[1]); else if (tab === 'themes') viewThemes(); else if (tab === 'saved') viewSaved(); else viewSearch();
}
window.addEventListener('hashchange', route);

(async () => {
  renderShell();
  try {
    const [SQL, buf] = await Promise.all([
      initSqlJs({ locateFile: f => 'vendor/' + f }),
      fetch('hymnal.db').then(r => { if (!r.ok) throw new Error('hymnal.db ' + r.status); return r.arrayBuffer(); })
    ]);
    db = new SQL.Database(new Uint8Array(buf));
    document.body.dataset.ready = '1';
    route();
  } catch (e) {
    $('#view').innerHTML = `<p class="warn">Could not load the hymnal: ${esc(e.message)}. If you opened this file directly, serve the folder with a web server (e.g. <code>python3 -m http.server</code>).</p>`;
  }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
