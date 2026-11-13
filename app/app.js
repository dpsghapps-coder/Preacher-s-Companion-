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
let sbs = store.get('sbs', window.innerWidth >= 700);   // verse-aligned side-by-side layout

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

/* ------------------------------------------------------------- loading placeholders */
function skeleton(label, kind = 'list', n = 7) {
  const w = [[88, 55], [72, 40], [95, 60], [65, 35], [80, 50], [90, 45], [70, 58], [84, 38]];
  const body = kind === 'text'
    ? `<div class="skel-text">${[96, 100, 92, 98, 60, 100, 94, 97, 88, 100, 45].map(x => `<span class="skel" style="width:${x}%"></span>`).join('')}</div>`
    : Array.from({ length: n }, (_, i) => `<div class="skel-row"><span class="skel n"></span><span class="col"><span class="skel" style="width:${w[i % 8][0]}%"></span><span class="skel" style="width:${w[i % 8][1]}%;height:10px"></span></span></div>`).join('');
  return `<div class="loading" role="status"><div class="head"><span class="spinner"></span><span>${esc(label)}</span></div><div class="bar-loop"></div>${body}</div>`;
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
    const book = /^\d{1,3}$/.test(inp.value.trim()) ? '' : `<p class="hint"><a href="#/staff/q/${encodeURIComponent(inp.value.trim())}">Search “${esc(inp.value.trim())}” in The Shepherd’s Staff →</a></p>`;
    res.innerHTML = (r.nums.length ? `<div class="hint">${esc(r.note)} · ${r.nums.length}${r.nums.length === 120 ? '+' : ''} hymn(s)</div><ul class="list">${rowsFor(r.nums)}</ul>`
      : `<p class="muted">${esc(r.note || 'No hymns found.')}</p>`) + book;
  };
  let t; inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 150); });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter' && /^\d{1,3}$/.test(inp.value.trim())) location.hash = '#/h/' + +inp.value.trim(); });
  $('#view').insertAdjacentHTML('beforeend', '<footer><a href="#" onclick="signOut();return false">Sign out</a></footer>');
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
  const blocksFor = l => {
    const ht = texts.find(t => t.language === l);
    if (!ht) return null;
    const st = q(`SELECT s.id, s.kind, s.verse_number v, s.variant FROM stanza s WHERE hymn_text_id=? ORDER BY seq`, [ht.id]);
    const blocks = []; let lastVar = null, cur = null;
    st.forEach(s => {
      const lines = q(`SELECT text FROM line WHERE stanza_id=? ORDER BY seq`, [s.id]).map(r => esc(r.text)).join('\n');
      let pre = '';
      if (s.variant && s.variant !== lastVar) { pre = `<div class="hint"><b>Version ${esc(s.variant)}</b></div>`; lastVar = s.variant; }
      const html = pre + `<div class="stanza ${s.kind}"><span class="vn">${s.kind === 'verse' ? s.v : ''}</span><p>${lines}</p></div>`;
      if (s.kind === 'verse' || !cur) { cur = { key: s.kind === 'verse' ? (s.variant || '') + ':' + String(s.v).padStart(3, '0') : '000', html: '' }; blocks.push(cur); }
      cur.html += html;                         // a refrain stays with the verse it follows
    });
    const credit = ht.author_line ? `<div class="credit">${esc(ht.author_line)}</div>` : '';
    const warn = ht.needs_review ? `<div class="warn">Still being proof-read — check against the printed book.</div>` : '';
    return { ht, blocks, credit, warn };
  };
  const data = langs().map(l => ({ l, ...(blocksFor(l) || {}) })).filter(d => d.ht);
  let cols;
  if (lang === 'both' && sbs && data.length === 2) {
    const keys = [...new Set(data.flatMap(d => d.blocks.map(b => b.key)))].sort();
    const cell = (d, k) => (d.blocks.find(b => b.key === k)?.html) || '';
    cols = `<div class="sbs"><h3>English</h3><h3>Twi</h3>${data.map(d => d.warn).some(Boolean) ? `<div>${data[0].warn}</div><div>${data[1].warn}</div>` : ''}` +
      keys.map(k => `<div class="cell">${cell(data[0], k)}</div><div class="cell">${cell(data[1], k)}</div>`).join('') +
      `<div>${data[0].credit}</div><div>${data[1].credit}</div></div>`;
  } else {
    cols = data.map(d => `<section class="col"><h3>${LANGNAME[d.l]}</h3>${d.warn}${d.blocks.map(b => b.html).join('')}${d.credit}</section>`).join('');
  }
  const meta = texts.find(t => t.language === firstLang()) || texts[0] || {};
  const isFav = favs.includes(n);
  $('#view').innerHTML = `<article class="hymn">
    <div class="bar"><a href="#/hymn-prev">‹ ${Math.max(1, n - 1)}</a>
      <span><button class="star" id="fav" title="Save">${isFav ? '★' : '☆'}</button>
      <button id="smaller" aria-label="Smaller text">A−</button> <button id="bigger" aria-label="Larger text">A+</button>
      <button id="wake" title="Keep the screen on">${wake ? '☀ on' : '☀'}</button>${lang === 'both' ? `<button id="sbsbtn" title="Side by side / stacked">${sbs ? '▤ Stacked' : '◫ Side by side'}</button>` : ''}</span>
      <a href="#/hymn-next">${Math.min(850, n + 1)} ›</a></div>
    <h2>Hymn ${n}</h2>
    <div class="meta">${refs.map(r => `<span class="chip">${esc(r)}</span>`).join('')}</div>
    <div class="meta">${[meta.theme, meta.subtheme].filter(Boolean).map(esc).join(' › ')}</div>
    <div class="cols ${lang === 'both' && !sbs ? 'both' : ''}" style="margin-top:14px">${cols}</div></article>`;
  $('#fav').onclick = () => { favs = isFav ? favs.filter(x => x !== n) : [...favs, n]; store.set('favs', favs); viewHymn(n); };
  $('#bigger').onclick = () => { fs = Math.min(40, fs + 2); store.set('fs', fs); renderShell(); };
  $('#smaller').onclick = () => { fs = Math.max(14, fs - 2); store.set('fs', fs); renderShell(); };
  if ($('#sbsbtn')) $('#sbsbtn').onclick = () => { sbs = !sbs; store.set('sbs', sbs); viewHymn(n); };
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


/* ------------------------------------------------------------- Library: The Shepherd's Staff */
let sdb = null, sdivs = [], spages = null, staffQuery = '';
const norm1 = ch => /[a-z0-9]/.test(ch) ? ch : ({ 'à': 'a', 'á': 'a', 'â': 'a', 'ä': 'a', 'é': 'e', 'è': 'e', 'ê': 'e', 'ï': 'i', 'í': 'i', 'ó': 'o', 'ö': 'o', 'ô': 'o', 'ú': 'u', 'ü': 'u', 'ñ': 'n', 'ɔ': 'o', 'ɛ': 'e' }[ch] || ' ');
const foldKeep = t => { let o = ''; for (const ch of t.toLowerCase()) o += norm1(ch); return o; };   // same length as t (UTF-16 safe enough for English)
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const STOP = new Set('a an and are as at be but by for from has have he her him his i in is it its me my of on or our she so that the their them they this to us was we were what when who will with you your'.split(' '));
function queryWords(q) {
  // a Bible reference such as "Ps 37:5" or "1 Cor 13" is searched as an exact phrase
  if (!/"/.test(q) && /^\s*(?:[1-3]\s?)?[A-Za-z]+\.?\s*\d+(?:\s*[:.]\s*\d+)?\s*$/.test(q)) q = '"' + q + '"';
  const phrases = [...q.matchAll(/"([^"]+)"/g)].map(m => foldKeep(m[1]).replace(/\s+/g, ' ').trim()).filter(Boolean);
  const rest = q.replace(/"[^"]*"/g, ' ');
  let words = foldKeep(rest).split(/\s+/).filter(w => w.length > 0);
  const content = words.filter(w => !STOP.has(w));
  if (content.length) words = content;                       // ignore filler words like "the", "your"
  const whole = words.length > 1 && !phrases.length ? words.join(' ') : '';
  return { phrases, words, whole };
}
async function loadStaff() {
  if (sdb) return true;
  const resp = await fetch('staff.db', { credentials: 'same-origin' });
  if (resp.status === 401) { showLogin(); return false; }
  if (!resp.ok) throw new Error('staff.db ' + resp.status);
  try { const copy = resp.clone(); caches.open('hymnal-data').then(c => c.put('staff.db', copy)).catch(() => {}); } catch {}
  const SQL = await initSqlJs({ locateFile: f => 'vendor/' + f });
  sdb = new SQL.Database(new Uint8Array(await resp.arrayBuffer()));
  const sq = (sql, p = []) => { const st = sdb.prepare(sql); st.bind(p); const o = []; while (st.step()) o.push(st.getAsObject()); st.free(); return o; };
  sdivs = sq('SELECT * FROM staff_division ORDER BY start_page');
  spages = sq('SELECT page, division_id d, fmt, text FROM staff_page ORDER BY page').map(r => ({ ...r, f: ' ' + foldKeep(r.text).replace(/\s+/g, ' ') + ' ' }));
  return true;
}
function staffSearch(q) {
  const { phrases, words, whole } = queryWords(q);
  if (!phrases.length && !words.length) return [];
  const out = [];
  const idf = {};                                            // rare words weigh more than common ones
  for (const w of words) { let df = 0; for (const p of spages) if (p.f.includes(' ' + w)) df++; idf[w] = Math.log(1 + spages.length / Math.max(1, df)); }
  for (const p of spages) {
    let score = 0, ok = true;
    for (const w of words) { const c = p.f.split(' ' + w).length - 1; if (!c) { ok = false; break; } score += c * idf[w]; }
    if (!ok) continue;
    for (const ph of phrases) { const c = p.f.split(ph).length - 1; if (!c) { ok = false; break; } score += c * 5; }
    if (ok && whole) score += 4 * (p.f.split(' ' + whole).length - 1);     // all words next to each other ranks first
    if (ok) out.push({ p, score });
  }
  return out.sort((a, b) => b.score - a.score || a.p.page - b.p.page);
}
function snippet(text, q) {
  const { phrases, words } = queryWords(q);
  const f = foldKeep(text); let at = -1;
  for (const t of [...phrases, ...[...words].sort((x, y) => y.length - x.length)]) { const i = f.search(new RegExp('(^|[^a-z0-9])' + escRe(t))); if (i >= 0) { at = i + (f[i] === ' ' || !/[a-z0-9]/.test(f[i]) ? 1 : 0); break; } }
  if (at < 0) at = 0;
  const from = Math.max(0, at - 70), to = Math.min(text.length, at + 150);
  return (from ? '… ' : '') + hl(text.slice(from, to).replace(/\s+/g, ' '), q) + (to < text.length ? ' …' : '');
}
function hl(text, q) {
  const { phrases, words } = queryWords(q); const terms = [...phrases, ...words].filter(Boolean);
  if (!terms.length) return esc(text);
  const f = foldKeep(text); const marks = [];
  for (const t of terms) { const re = new RegExp('(?<![a-z0-9])' + escRe(t).replace(/ /g, '[^a-z0-9]+') + '[a-z0-9]*', 'g'); let m; while ((m = re.exec(f))) { marks.push([m.index, m.index + m[0].length]); if (m[0].length === 0) re.lastIndex++; } }
  marks.sort((x, y) => x[0] - y[0]);
  let out = '', pos = 0;
  for (const [a, b] of marks) { if (a < pos) continue; out += esc(text.slice(pos, a)) + '<mark>' + esc(text.slice(a, b)) + '</mark>'; pos = b; }
  return out + esc(text.slice(pos));
}
async function viewStaff() {
  $('#view').innerHTML = skeleton('Opening the library…');
  try { if (!await loadStaff()) return; } catch (e) { $('#view').innerHTML = `<p class="warn">Could not load the library: ${esc(e.message)}</p>`; return; }
  $('#view').innerHTML = `<h2 style="margin:.2em 0">The Shepherd’s Staff</h2>
    <div class="hint">Ralph Mahoney (ed.), World MAP · ${spages.length} pages · full-text search</div>
    <input id="sq" type="search" placeholder="Search the book (use “quotes” for an exact phrase)" autocomplete="off" enterkeyhint="search" value="${esc(staffQuery)}">
    <div id="sres"></div>`;
  const inp = $('#sq'), res = $('#sres');
  const run = () => {
    staffQuery = inp.value; const q = inp.value.trim();
    if (!q) {
      res.innerHTML = `<div class="hint" style="margin-top:14px">Browse</div><ul class="list">${sdivs.map(d => `<li><a href="#/staff/p/${d.start_page}"><span class="num">${d.start_page}</span><span class="first">${esc(d.title)}<small>pages ${d.start_page}–${d.end_page}</small></span></a></li>`).join('')}</ul>
      <form id="jump" class="bar" style="margin-top:14px"><label class="hint">Go to page</label><input id="jn" type="number" min="1" max="${spages.length}" style="width:6em;padding:8px;font:inherit;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg)"><button class="btn">Go</button></form>`;
      $('#jump').onsubmit = e => { e.preventDefault(); const n = +$('#jn').value; if (n >= 1 && n <= spages.length) location.hash = '#/staff/p/' + n; };
      return;
    }
    const hits = staffSearch(q), shown = hits.slice(0, 80);
    res.innerHTML = hits.length ? `<div class="hint" style="margin-top:12px">${hits.length} page(s)${hits.length > 80 ? ' · showing the best 80' : ''}</div><ul class="list">${shown.map(h => {
      const d = sdivs.find(x => x.id === h.p.d);
      return `<li><a href="#/staff/p/${h.p.page}/${encodeURIComponent(q)}"><span class="num">${h.p.page}</span><span class="first">${snippet(h.p.text, q)}<small>${esc(d ? d.title : '')}</small></span></a></li>`;
    }).join('')}</ul>` : '<p class="muted">No pages match all of those words.</p>';
  };
  let t; inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 200); });
  run(); if (!/Mobi|Android/i.test(navigator.userAgent)) inp.focus();
}
async function viewStaffPage(n, q) {
  if (!sdb) $('#view').innerHTML = skeleton('Opening the library…', 'text');
  try { if (!await loadStaff()) return; } catch (e) { $('#view').innerHTML = `<p class="warn">${esc(e.message)}</p>`; return; }
  const p = spages[n - 1]; if (!p) { $('#view').innerHTML = '<p class="muted pad">No such page.</p>'; return; }
  const d = sdivs.find(x => x.id === p.d);
  const qs = q ? '/' + encodeURIComponent(q) : '';
  const body = p.text ? (p.fmt === 'l' ? `<div style="white-space:pre-line">${hl(p.text, q)}</div>` : p.text.split('\n\n').map(t => `<p>${hl(t, q)}</p>`).join('')) : '<p class="muted">(blank page)</p>';
  $('#view').innerHTML = `<article class="hymn staffpage"><div class="bar"><a href="#/staff/p/${Math.max(1, n - 1)}${qs}">‹ ${Math.max(1, n - 1)}</a>
    <span><a href="#/staff" onclick="staffQuery=${esc(JSON.stringify(q))}">☰ Search</a> <button id="smaller">A−</button> <button id="bigger">A+</button></span>
    <a href="#/staff/p/${Math.min(spages.length, n + 1)}${qs}">${Math.min(spages.length, n + 1)} ›</a></div>
    <div class="meta">${esc(d ? d.title : '')} · page ${n} of ${spages.length}</div>
    <div class="prose" style="font-size:var(--fs);line-height:1.5;margin-top:10px">${body}</div></article>`;
  $('#bigger').onclick = () => { fs = Math.min(40, fs + 2); store.set('fs', fs); renderShell(); };
  $('#smaller').onclick = () => { fs = Math.max(14, fs - 2); store.set('fs', fs); renderShell(); };
  const first = $('.prose mark'); if (first) first.scrollIntoView({ block: 'center' }); else window.scrollTo(0, 0);
}
document.addEventListener('keydown', e => {
  const m = location.hash.match(/^#\/staff\/p\/(\d+)(\/.*)?$/); if (!m || e.target.matches('input')) return;
  if (e.key === 'ArrowLeft') location.hash = '#/staff/p/' + Math.max(1, +m[1] - 1) + (m[2] || '');
  if (e.key === 'ArrowRight') location.hash = '#/staff/p/' + (+m[1] + 1) + (m[2] || '');
});

/* ------------------------------------------------------------- router + boot */
function route() {
  if (!db) return;
  const h = location.hash || '#/';
  const tab = h.startsWith('#/themes') ? 'themes' : h.startsWith('#/saved') ? 'saved' : h.startsWith('#/staff') ? 'staff' : 'search';
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  const m = h.match(/^#\/h\/(\d+)/);
  const sp = h.match(/^#\/staff\/p\/(\d+)(?:\/(.*))?$/);
  const sq = h.match(/^#\/staff\/q\/(.*)$/);
  if (sq) { staffQuery = decodeURIComponent(sq[1]); location.replace('#/staff'); return; }
  if (tab === 'staff') { sp ? viewStaffPage(+sp[1], decodeURIComponent(sp[2] || '')) : viewStaff(); return; }
  if (m) viewHymn(+m[1]); else if (tab === 'themes') viewThemes(); else if (tab === 'saved') viewSaved(); else viewSearch();
}
window.addEventListener('hashchange', route);

/* ------------------------------------------------------------- sign-in (Google) */
function showLogin(msg) {
  const id = (window.PC_CONFIG || {}).googleClientId;
  $('#view').innerHTML = `<div class="pad" style="text-align:center"><h2>Sign in</h2>
    <p class="muted">This hymnal is private. Sign in with an approved Google account.</p>
    ${id ? '<div id="gbtn" style="display:inline-block;min-height:44px"></div>' : '<p class="warn">Sign-in is not set up yet (missing Google client ID in config.js).</p>'}
    <p id="loginmsg" class="warn" style="${msg ? '' : 'display:none'}">${esc(msg || '')}</p></div>`;
  if (!id) return;
  const init = () => {
    google.accounts.id.initialize({ client_id: id, callback: async resp => {
      const note = $('#loginmsg'); note.style.display = 'none';
      try {
        const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: resp.credential }) });
        const j = await r.json().catch(() => ({}));
        if (r.ok) { location.reload(); return; }
        note.textContent = r.status === 403 ? `${j.email || 'That account'} is not on the approved list. Ask the owner to add it.` : 'Sign-in failed. Please try again.';
      } catch { note.textContent = 'No connection. Sign-in needs the internet the first time.'; }
      note.style.display = '';
    } });
    google.accounts.id.renderButton($('#gbtn'), { theme: 'outline', size: 'large', text: 'signin_with' });
  };
  if (window.google?.accounts?.id) return init();
  const sc = document.createElement('script'); sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true; sc.onload = init;
  sc.onerror = () => { $('#loginmsg').textContent = 'Could not reach Google. Check your connection.'; $('#loginmsg').style.display = ''; };
  document.head.appendChild(sc);
}
async function signOut() {
  try { await fetch('/api/logout', { method: 'POST' }); } catch {}
  try { await caches.delete('hymnal-data'); } catch {}
  location.reload();
}
window.signOut = signOut;

(async () => {
  renderShell();
  try {
    const resp = await fetch('hymnal.db', { credentials: 'same-origin' });
    if (resp.status === 401) { showLogin(); registerSW(); return; }
    if (!resp.ok) throw new Error('hymnal.db ' + resp.status);
    // keep a private offline copy right away (the service worker is not in charge yet on the very first visit)
    try { const copy = resp.clone(); caches.open('hymnal-data').then(c => c.put('hymnal.db', copy)).catch(() => {}); } catch {}
    const SQL = await initSqlJs({ locateFile: f => 'vendor/' + f });
    db = new SQL.Database(new Uint8Array(await resp.arrayBuffer()));
    document.body.dataset.ready = '1'; $('#view').removeAttribute('aria-busy');
    route();
  } catch (e) {
    $('#view').innerHTML = `<p class="warn">Could not load the hymnal: ${esc(e.message)}. If you opened this file directly, serve the folder with a web server (e.g. <code>python3 -m http.server</code>).</p>`;
  }
  registerSW();
})();
function registerSW() {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
}
