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

/* ------------------------------------------------------------- document art */
// The Apostles' Creed: a cross inside a ring of twelve points (the twelve apostles / twelve articles of the creed).
// Drawn with theme tokens so it follows Reverent / Warm / Crisp and light / dark.
function docArt(slug, cls = '') {
  if (slug !== 'apostles-creed') return '';
  const dots = Array.from({ length: 12 }, (_, i) => {
    const a = (i * 30 - 90) * Math.PI / 180;
    return `<circle cx="${(60 + 37 * Math.cos(a)).toFixed(1)}" cy="${(70 + 37 * Math.sin(a)).toFixed(1)}" r="${i === 0 ? 4.2 : 3.2}"/>`;
  }).join('');
  return `<svg class="docart ${cls}" viewBox="0 0 120 160" role="img" aria-label="The Apostles’ Creed">
    <rect width="120" height="160" rx="8" style="fill:var(--accent)"/>
    <rect x="8" y="8" width="104" height="144" rx="4" fill="none" style="stroke:var(--accent-fg)" stroke-opacity=".35" stroke-width="1.2"/>
    <g style="fill:var(--accent-fg)">${dots}</g>
    <path d="M60 47v47M45 62h30" fill="none" style="stroke:var(--accent-fg)" stroke-width="7" stroke-linecap="round"/>
    <text x="60" y="137" text-anchor="middle" font-size="12" font-weight="700" letter-spacing="4.5" style="fill:var(--accent-fg);font-family:var(--font-head)">CREDO</text>
  </svg>`;
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

/* ------------------------------------------------------------- theme: Reverent / Warm / Crisp × auto / light / dark */
const MODES = ['auto', 'light', 'dark'];
const MODE_ICON = {
  auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
  light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>'
};
const MODE_LABEL = { auto: 'Appearance: follows your device', light: 'Appearance: light', dark: 'Appearance: dark' };
function applyTheme() {
  const d = document.documentElement, style = store.get('style', 'reverent'), mode = store.get('mode', 'auto');
  d.dataset.style = style;
  if (mode === 'auto') delete d.dataset.mode; else d.dataset.mode = mode;
  const sel = $('#themesel'); if (sel) sel.value = style;
  const mb = $('#modebtn'); if (mb) { mb.innerHTML = MODE_ICON[mode]; mb.title = mb.ariaLabel = MODE_LABEL[mode] + ' (tap to change)'; }
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = getComputedStyle(d).getPropertyValue('--meta-color').trim() || meta.content;
}
$('#themesel').addEventListener('change', e => { store.set('style', e.target.value); applyTheme(); });
$('#modebtn').addEventListener('click', () => { const m = store.get('mode', 'auto'); store.set('mode', MODES[(MODES.indexOf(m) + 1) % 3]); applyTheme(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
// sticky search + tabs height, used to pin list group headers just below them
new ResizeObserver(([e]) => document.documentElement.style.setProperty('--hdr', e.target.offsetHeight + 'px')).observe($('#stick'));
applyTheme();

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
/* ------------------------------------------------------------- global search (header): hymns, praise songs, library, directory */
let gTimer = null;
const gInp = $('#gq');
gInp.addEventListener('input', () => {
  clearTimeout(gTimer);
  gTimer = setTimeout(() => {
    const v = gInp.value.trim(), target = '#/search/' + encodeURIComponent(v);
    if (!v) { if (location.hash.startsWith('#/search')) history.back(); return; }
    if (location.hash.startsWith('#/search')) { history.replaceState(null, '', target); route(); } else location.hash = target;
  }, 180);
});
gInp.addEventListener('keydown', e => {
  if (e.key === 'Enter') { const v = gInp.value.trim(); gInp.blur(); if (/^\d{1,3}$/.test(v) && +v >= 1 && +v <= 850) location.hash = '#/h/' + +v; }
  if (e.key === 'Escape') { gInp.value = ''; gInp.dispatchEvent(new Event('input')); }
});
document.addEventListener('keydown', e => { if (e.key === '/' && !e.target.matches('input,textarea,select')) { e.preventDefault(); gInp.focus(); } });

async function viewGlobalSearch(text) {
  if (document.activeElement !== gInp && gInp.value.trim() !== text) gInp.value = text;
  const t = text.trim();
  if (!t) { $('#view').innerHTML = `<p class="muted pad">Type a hymn number, words from a hymn or song, a Bible passage (e.g. <b>Psalm 23</b>), or a minister, congregation or district.</p>`; return; }
  const isNum = /^\d{1,3}$/.test(t);
  const sec = (title, count, body, more) => `<section class="rsec"><h3 class="sec">${title} <span class="muted">${count}</span></h3>${body}${more || ''}</section>`;
  let html = '';
  const r = search(t);
  if (r.nums.length) html += sec('PHB Hymns', r.nums.length + (r.nums.length === 120 ? '+' : ''), `<div class="hint">${esc(r.note)}</div><ul class="list">${rowsFor(r.nums.slice(0, 25))}</ul>`,
    r.nums.length > 25 ? `<p class="hint">Showing 25. Add another word to narrow it down.</p>` : '');
  else if (r.note) html += `<p class="muted">${esc(r.note)}</p>`;
  const gs = isNum ? [] : gospelSearch(t, 'all');
  if (gs.length) html += sec('Praise &amp; Worship', gs.length, `<ul class="list">${gs.slice(0, 12).map(gospelRow).join('')}</ul>`,
    gs.length > 12 ? `<p class="hint"><a href="#/praise" onclick="gQuery=${esc(JSON.stringify(t))};gLang='all'">See all ${gs.length} songs →</a></p>` : '');
  if (!isNum) {
    const f = '%' + fold(t) + '%';
    const docs = q(`SELECT DISTINCT d.slug, d.title FROM document d LEFT JOIN document_line l ON l.slug=d.slug WHERE lower(d.title) LIKE ? OR lower(l.text) LIKE ?`, [f, f]);
    const lib = docs.map(d => `<li><a href="#/doc/${esc(d.slug)}"><span class="num">${docArt(d.slug, 'mini') || '▤'}</span><span class="first">${esc(d.title)}</span></a></li>`).join('')
      + `<li><a href="#/staff/q/${encodeURIComponent(t)}"><span class="num"><img class="cover mini" src="shepherds-staff-cover.jpg" alt=""></span><span class="first">Search “${esc(t)}” in The Shepherd’s Staff<small>1302 pages · full text</small></span></a></li>`;
    html += sec('Library', '', `<ul class="list">${lib}</ul>`);
  }
  if (!isNum && t.length >= 2) {
    $('#view').innerHTML = html + skeleton('Searching the directory…', 'list', 3);
    try {
      await loadDir();
      if (location.hash !== '#/search/' + encodeURIComponent(text)) return;      // the user kept typing
      const hits = dirSearch(t);
      if (hits.length) html += sec('Directory', hits.length + (hits.length === 200 ? '+' : ''), `<ul class="list">${hits.slice(0, 25).map(personRow).join('')}</ul>`, hits.length > 25 ? '<p class="hint">Showing 25. Add another word to narrow it down.</p>' : '');
    } catch (e) { html += `<p class="warn">Directory unavailable: ${esc(e.message)}</p>`; }
  }
  $('#view').innerHTML = html || `<p class="muted pad">Nothing matches “${esc(t)}”.</p>`;
}

/* ------------------------------------------------------------- hubs: Music, Library */
const ICON = {
  hymns: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/><path d="M14 6.5v6.3"/><circle cx="12.3" cy="13" r="1.7"/><path d="M14 6.5l2.6.9"/></svg>',
  praise: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3v5h5M8.5 12.5h7M8.5 16h5"/></svg>',
  order: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M5 7h14"/><path d="M5 7l-2.5 6a3 3 0 0 0 5 0zM19 7l-2.5 6a3 3 0 0 0 5 0z"/><path d="M8 21h8"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2a5 5 0 0 1 5.5 4.8"/></svg>'
};
const hubRow = (href, art, title, sub, badge) => `<li><a class="hubrow" href="${href}"><span class="hubart">${art}</span><span class="hubtxt"><b>${title}</b><small>${sub}</small></span>${badge ? `<span class="badge">${badge}</span>` : ''}<span class="chev" aria-hidden="true">›</span></a></li>`;
const tile = (icon, cls = '') => `<span class="tile ${cls}">${ICON[icon]}</span>`;
function shellFooter() {
  return '<footer><a href="#" id="upd" onclick="updateDb();return false">Update database</a><div id="updmsg">' + (Date.now() - store.get('dbUpdated', 0) < 15000 ? 'Database updated ✓' : '') + '</div></footer>';
}
function viewMusic() {
  const nh = q('SELECT COUNT(DISTINCT hymn_number) n FROM hymn_text')[0].n, ns = loadGospel().length;
  $('#view').innerHTML = `<h2>Music</h2><ul class="hub">
    ${hubRow('#/hymns', tile('hymns'), 'PHB Hymns', `Presbyterian Hymn Book · ${nh} hymns · English &amp; Twi`)}
    ${hubRow('#/praise', tile('praise'), 'Praise &amp; Worship', `${ns} gospel songs · English &amp; Akan`)}
  </ul>` + (recent.length ? `<h3 class="sec">Recently opened</h3><ul class="list">${rowsFor(recent.slice(0, 6))}</ul>` : '') + shellFooter();
}
function viewLibrary() {
  $('#view').innerHTML = `<h2>Library</h2><ul class="hub">
    ${hubRow('#/doc/apostles-creed', docArt('apostles-creed', 'mini'), 'The Apostles’ Creed', 'English · Twi · Ga · Ewe')}
    ${hubRow('#/soon/constitution', tile('doc'), 'Constitution', 'Presbyterian Church of Ghana', 'Coming soon')}
    ${hubRow('#/soon/manual-of-order', tile('order'), 'Manual of Order', 'Presbyterian Church of Ghana', 'Coming soon')}
    ${hubRow('#/staff', '<img class="cover mini" src="shepherds-staff-cover.jpg" alt="">', 'The Shepherd’s Staff', 'Ralph Mahoney (ed.) · 1302 pages · full-text search')}
  </ul>` + shellFooter();
}
const SOON = { constitution: 'Constitution', 'manual-of-order': 'Manual of Order' };
function viewSoon(slug) {
  const t = SOON[slug] || 'This document';
  $('#view').innerHTML = `<div class="bar"><a href="#/library">‹ Library</a></div>
    <div class="empty">${tile(slug === 'constitution' ? 'doc' : 'order', 'lg')}<h2>${esc(t)}</h2>
    <p class="muted">The ${esc(t)} of the Presbyterian Church of Ghana will be added here. Once it is in, it opens like the Apostles’ Creed, with search and adjustable text size.</p>
    <a class="btn" href="#/library">Back to the Library</a></div>`;
}

/* ------------------------------------------------------------- PHB Hymns: by number / by theme */
function viewHymns(mode) {
  const l = firstLang();
  const seg = `<div class="seg wide" role="tablist" aria-label="Browse hymns"><button role="tab" aria-selected="${mode !== 'themes'}" class="${mode !== 'themes' ? 'on' : ''}" onclick="location.hash='#/hymns'">By number</button><button role="tab" aria-selected="${mode === 'themes'}" class="${mode === 'themes' ? 'on' : ''}" onclick="location.hash='#/hymns/themes'">By theme</button></div>`;
  const head = `<div class="bar"><a href="#/music">‹ Music</a></div><h2>PHB Hymns</h2><div class="hint">Presbyterian Hymn Book · ${lang === 'both' ? 'English &amp; Twi' : LANGNAME[l]}</div>${seg}`;
  if (mode === 'themes') { $('#view').innerHTML = head + `<div id="themes"></div>`; viewThemes($('#themes')); return; }
  const nums = Array.from({ length: 850 }, (_, i) => i + 1);
  const blocks = [];
  for (let i = 0; i < 850; i += 50) blocks.push([i + 1, Math.min(850, i + 50)]);
  $('#view').innerHTML = head + `<div class="az">${blocks.map(([x]) => `<a href="#" data-n="${x}">${x}</a>`).join('')}</div>
    <ul class="list">${blocks.map(([x, y]) => `<li class="grp" id="hn-${x}">${x}–${y}</li>` + rowsFor(nums.slice(x - 1, y))).join('')}</ul>`;
  document.querySelectorAll('.az a[data-n]').forEach(x => x.onclick = e => { e.preventDefault(); document.getElementById('hn-' + x.dataset.n)?.scrollIntoView({ block: 'start' }); });
}

/* ------------------------------------------------------------- Directory (names & roles only; no phone numbers or emails) */
let ddb = null;
const dq = (sql, p = []) => { const st = ddb.prepare(sql); st.bind(p); const o = []; while (st.step()) o.push(st.getAsObject()); st.free(); return o; };
async function loadDir() {
  if (ddb) return;
  const resp = await fetch('directory.db');
  if (!resp.ok) throw new Error('directory.db ' + resp.status);
  try { const copy = resp.clone(); caches.open('hymnal-data-v15').then(c => c.put('directory.db', copy)).catch(() => {}); } catch {}
  const SQL = await initSqlJs({ locateFile: f => 'vendor/' + f });
  ddb = new SQL.Database(new Uint8Array(await resp.arrayBuffer()));
}
const AREA_LABEL = { presbytery_office: 'Presbytery office', departmental_directors: 'Directors & chaplains', district: 'District', sub_district: 'Sub-district', mission_field: 'Mission field', ecumenical: 'Ecumenical', chaplaincy: 'Chaplaincy', retired: 'Retired', sick_leave: 'On sick leave', other: '' };
function personRow(p) {
  const where = [p.congregation, p.area, p.presbytery].filter(Boolean).map(esc).join(' · ');
  const role = p.role || ({ Rev: 'Minister', Cat: 'Catechist', Caretaker: 'Caretaker' }[p.category] || '');
  const initials = (p.name.match(/\b[A-Z]/g) || ['?']).filter((_, i, arr) => i === 0 || i === arr.length - 1).join('');
  return `<li class="person"><span class="avatar" aria-hidden="true">${esc(initials)}</span><span class="first">${p.title ? `<span class="muted">${esc(p.title)}</span> ` : ''}${esc(p.name)}<small>${role ? `<b>${esc(role)}</b>${where ? ' · ' : ''}` : ''}${where}</small></span></li>`;
}
function dirSearch(text) {
  const words = fold(text).split(' ').filter(Boolean); if (!words.length) return [];
  return dq(`SELECT p.*, a.name area, pr.name presbytery FROM person p JOIN area a ON a.id=p.area_id JOIN presbytery pr ON pr.id=a.presbytery_id
    WHERE ${words.map(() => 'p.norm LIKE ?').join(' AND ')} ORDER BY p.is_dm DESC, p.category='Rev' DESC, p.name LIMIT 200`, words.map(w => '% ' + w + '%'));
}
async function viewDirectory(kind, id) {
  if (!ddb) $('#view').innerHTML = skeleton('Opening the directory…');
  try { await loadDir(); } catch (e) { $('#view').innerHTML = `<p class="warn">Could not load the directory: ${esc(e.message)}</p>`; return; }
  const note = `<p class="hint">Names, roles and congregations only. Contact details are not published in the app.</p>`;
  if (kind === 'a') {
    const a = dq('SELECT a.*, pr.name presbytery FROM area a JOIN presbytery pr ON pr.id=a.presbytery_id WHERE a.id=?', [id])[0];
    if (!a) { $('#view').innerHTML = '<p class="muted pad">Not found.</p>'; return; }
    const ppl = dq(`SELECT p.*, NULL area, NULL presbytery FROM person p WHERE area_id=? ORDER BY p.is_dm DESC, CASE p.category WHEN 'Rev' THEN 0 WHEN 'Cat' THEN 1 WHEN 'Caretaker' THEN 2 ELSE 3 END, p.congregation, p.name`, [id]);
    $('#view').innerHTML = `<div class="bar"><a href="#/directory/p/${a.presbytery_id}">‹ ${esc(a.presbytery)}</a></div>
      <h2>${esc(a.name)}</h2><div class="hint">${AREA_LABEL[a.type] ? esc(AREA_LABEL[a.type]) + ' · ' : ''}${esc(a.presbytery)} Presbytery · ${ppl.length} people</div>
      <ul class="list">${ppl.map(personRow).join('')}</ul>${note}`;
    window.scrollTo(0, 0); return;
  }
  if (kind === 'p') {
    const pr = dq('SELECT * FROM presbytery WHERE id=?', [id])[0];
    if (!pr) { $('#view').innerHTML = '<p class="muted pad">Not found.</p>'; return; }
    const areas = dq(`SELECT a.*, COUNT(p.id) n FROM area a LEFT JOIN person p ON p.area_id=a.id WHERE a.presbytery_id=? GROUP BY a.id ORDER BY a.type<>'presbytery_office', a.type<>'departmental_directors', a.name`, [id]);
    $('#view').innerHTML = `<div class="bar"><a href="#/directory">‹ Directory</a></div><h2>${esc(pr.name)}</h2><div class="hint">Presbytery · ${areas.length} districts and offices</div>
      <ul class="list">${areas.map(a => `<li><a href="#/directory/a/${a.id}"><span class="first">${esc(a.name)}<small>${esc(AREA_LABEL[a.type] || 'District')}</small></span><span class="cnt">${a.n}</span></a></li>`).join('')}</ul>`;
    window.scrollTo(0, 0); return;
  }
  const ps = dq(`SELECT pr.id, pr.name, COUNT(DISTINCT a.id) na, COUNT(p.id) n FROM presbytery pr JOIN area a ON a.presbytery_id=pr.id LEFT JOIN person p ON p.area_id=a.id GROUP BY pr.id ORDER BY pr.name`);
  const total = ps.reduce((x, y) => x + y.n, 0);
  $('#view').innerHTML = `<h2>Directory</h2><div class="hint">${ps.length} presbyteries · ${total.toLocaleString()} ministers, catechists and caretakers. Search above for a name, congregation or district.</div>
    <ul class="list">${ps.map(p => `<li><a href="#/directory/p/${p.id}"><span class="first">${esc(p.name)}<small>${p.na} districts and offices</small></span><span class="cnt">${p.n}</span></a></li>`).join('')}</ul>${note}` + shellFooter();
}

/* ------------------------------------------------------------- themes */
function viewThemes(into = $('#view')) {
  const l = firstLang();
  const rows = q(`SELECT hymn_number n, first_line f, theme t, subtheme s FROM hymn_text WHERE language=? ORDER BY hymn_number`, [l]);
  const tree = new Map();
  rows.forEach(r => {
    const t = r.t || '(other)', s = r.s || '';
    if (!tree.has(t)) tree.set(t, new Map());
    const sm = tree.get(t); if (!sm.has(s)) sm.set(s, []); sm.get(s).push(r);
  });
  let h = '';
  for (const [t, sm] of tree) {
    const count = [...sm.values()].reduce((a, b) => a + b.length, 0);
    h += `<details><summary>${esc(t)} <span class="muted">(${count})</span></summary>`;
    for (const [s, items] of sm) {
      const list = `<ul class="list">${items.map(r => hymnRow(r.n, r.f)).join('')}</ul>`;
      h += s ? `<details><summary>${esc(s)} <span class="muted">${items[0].n}–${items.at(-1).n}</span></summary>${list}</details>` : list;
    }
    h += '</details>';
  }
  into.innerHTML = h;
}

/* ------------------------------------------------------------- saved */
function viewSaved() {
  $('#view').innerHTML = `<h2>Favourites</h2>` + (favs.length ? `<ul class="list">${rowsFor([...favs].sort((a, b) => a - b))}</ul>`
    : `<p class="muted">No favourites yet. Open a hymn and tap ☆ to keep it here.</p>`) +
    (recent.length ? `<h3 class="sec">Recently opened</h3><ul class="list">${rowsFor(recent.slice(0, 15))}</ul>` : '') + shellFooter();
}

/* ------------------------------------------------------------- hymn */
function refsText(n) {
  const rs = q(`SELECT raw, book, chapter, verse_start a, verse_end b FROM scripture_ref WHERE hymn_number=? ORDER BY id`, [n]);
  return rs.map(r => r.book ? { label: `${r.book} ${r.chapter}${r.a ? ':' + r.a + (r.b && r.b !== r.a ? '–' + r.b : '') : ''}`, href: `#/ref/${encodeURIComponent(r.book)}/${r.chapter}${r.a ? '/' + r.a + (r.b && r.b !== r.a ? '-' + r.b : '') : ''}` } : { label: r.raw });
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
    <div class="bar"><a href="#/hymns">‹ PHB Hymns</a></div>
    <div class="bar"><a href="#/hymn-prev">‹ ${Math.max(1, n - 1)}</a>
      <span><button class="star" id="fav" title="Save">${isFav ? '★' : '☆'}</button>
      <button id="smaller" aria-label="Smaller text">A−</button> <button id="bigger" aria-label="Larger text">A+</button>
      <button id="wake" title="Keep the screen on">${wake ? '☀ on' : '☀'}</button>${lang === 'both' ? `<button id="sbsbtn" title="Side by side / stacked">${sbs ? '▤ Stacked' : '◫ Side by side'}</button>` : ''}</span>
      <a href="#/hymn-next">${Math.min(850, n + 1)} ›</a></div>
    <h2>Hymn ${n}</h2>
    <div class="meta">${refs.map(r => r.href ? `<a class="chip" href="${r.href}">${esc(r.label)}</a>` : `<span class="chip">${esc(r.label)}</span>`).join('')}</div>
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
let sdb = null, sdivs = [], spages = null, staffQuery = '', ssec = { II: {}, III: {} };
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
  if (!resp.ok) throw new Error('staff.db ' + resp.status);
  try { const copy = resp.clone(); caches.open('hymnal-data-v15').then(c => c.put('staff.db', copy)).catch(() => {}); } catch {}
  const SQL = await initSqlJs({ locateFile: f => 'vendor/' + f });
  sdb = new SQL.Database(new Uint8Array(await resp.arrayBuffer()));
  const sq = (sql, p = []) => { const st = sdb.prepare(sql); st.bind(p); const o = []; while (st.step()) o.push(st.getAsObject()); st.free(); return o; };
  sdivs = sq('SELECT * FROM staff_division ORDER BY start_page');
  spages = sq('SELECT page, division_id d, label, fmt, text FROM staff_page ORDER BY page').map(r => ({ ...r, f: ' ' + foldKeep(r.text).replace(/\s+/g, ' ') + ' ' }));
  ssec = { II: {}, III: {} };                                // cross-reference targets: part -> 'E4' / 'C10.6' -> { page, title }
  for (const r of sq('SELECT part, code, sub, title, page FROM staff_section')) ssec[r.part][r.sub ? r.code + '.' + r.sub : r.code] = { page: r.page, title: r.title };
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
  $('#view').innerHTML = skeleton('Opening the book…');
  try { if (!await loadStaff()) return; } catch (e) { $('#view').innerHTML = `<p class="warn">Could not load the library: ${esc(e.message)}</p>`; return; }
  $('#view').innerHTML = `<div class="bar"><a href="#/library">‹ Library</a></div><div class="bookhead"><img class="cover" src="shepherds-staff-cover.jpg" width="720" height="1080" alt="The Shepherd’s Staff — book cover">
    <div><h2 style="margin:.2em 0">The Shepherd’s Staff</h2>
    <div class="hint">Ralph Mahoney (ed.), World MAP · ${spages.length} pages · full-text search</div></div></div>
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
  const ctx = { part: d && d.title.startsWith('II.') ? 'II' : 'III', div: d && d.title === 'Contents' ? 'contents' : '', listing: (p.text.match(/^\s*[A-G]\s?\d{1,2}(?:\.\d{1,2})?\s*[-–:;]\s+\S/gm) || []).length >= 3 };
  const body = p.text ? (p.fmt === 'l' ? p.text.split('\n').map(t => `<div style="white-space:pre-line">${renderText(t, q, ctx)}</div>`).join('') : p.text.split('\n\n').map(t => `<p>${renderText(t, q, ctx)}</p>`).join('')) : (n === 1 ? '' : '<p class="muted">(blank page)</p>');
  $('#view').innerHTML = `<article class="hymn staffpage"><div class="bar"><a href="#/staff/p/${Math.max(1, n - 1)}${qs}">‹ ${Math.max(1, n - 1)}</a>
    <span><a href="#/staff" onclick="staffQuery=${esc(JSON.stringify(q))}">☰ Search</a> <button id="smaller">A−</button> <button id="bigger">A+</button></span>
    <a href="#/staff/p/${Math.min(spages.length, n + 1)}${qs}">${Math.min(spages.length, n + 1)} ›</a></div>
    <div class="meta">${esc(d ? d.title : '')} · page ${n} of ${spages.length}${p.label ? ` · book page ${esc(p.label)}` : ''}</div>
    ${n === 1 ? '<figure class="frontcover"><img class="cover" src="shepherds-staff-cover.jpg" width="720" height="1080" alt="The Shepherd’s Staff — book cover"><figcaption class="muted">The Shepherd’s Staff · Ralph Mahoney (ed.), World MAP</figcaption></figure>' : ''}
    <div class="prose" style="font-size:var(--fs);line-height:1.5;margin-top:10px">${body}</div></article>`;
  $('#bigger').onclick = () => { fs = Math.min(40, fs + 2); store.set('fs', fs); renderShell(); };
  $('#smaller').onclick = () => { fs = Math.max(14, fs - 2); store.set('fs', fs); renderShell(); };
  const first = $('.prose mark, .prose a.hit'); if (first) first.scrollIntoView({ block: 'center' }); else window.scrollTo(0, 0);
}
document.addEventListener('keydown', e => {
  const m = location.hash.match(/^#\/staff\/p\/(\d+)(\/.*)?$/); if (!m || e.target.matches('input')) return;
  if (e.key === 'ArrowLeft') location.hash = '#/staff/p/' + Math.max(1, +m[1] - 1) + (m[2] || '');
  if (e.key === 'ArrowRight') location.hash = '#/staff/p/' + (+m[1] + 1) + (m[2] || '');
});


/* ------------------------------------------------------------- Bible references: parse, link, look up */
const BOOKS = [
  ['Genesis', 'ge gen genesis'], ['Exodus', 'ex exo exod exodus'], ['Leviticus', 'le lev leviticus'], ['Numbers', 'nu num numbers'],
  ['Deuteronomy', 'de deu deut deuteronomy'], ['Joshua', 'jos josh joshua'], ['Judges', 'jdg judg judges'], ['Ruth', 'ru rut ruth'],
  ['1 Samuel', '1sa 1sam 1samuel'], ['2 Samuel', '2sa 2sam 2samuel'], ['1 Kings', '1ki 1kgs 1kings'], ['2 Kings', '2ki 2kgs 2kings'],
  ['1 Chronicles', '1ch 1chr 1chron 1chronicles'], ['2 Chronicles', '2ch 2chr 2chron 2chronicles'], ['Ezra', 'ezr ezra'],
  ['Nehemiah', 'ne neh nehemiah'], ['Esther', 'es est esther'], ['Job', 'job'], ['Psalms', 'ps psa psalm psalms'],
  ['Proverbs', 'pr pro prov proverbs'], ['Ecclesiastes', 'ec ecc eccl ecclesiastes'], ['Song of Solomon', 'ss song'],
  ['Isaiah', 'isa isaiah'], ['Jeremiah', 'jer jeremiah'], ['Lamentations', 'la lam lamentations'], ['Ezekiel', 'eze ezek ezekiel'],
  ['Daniel', 'da dan daniel'], ['Hosea', 'ho hos hosea'], ['Joel', 'joe joel'], ['Amos', 'am amos'], ['Obadiah', 'ob oba obadiah'],
  ['Jonah', 'jon jonah'], ['Micah', 'mic micah'], ['Nahum', 'nah nahum'], ['Habakkuk', 'hab habakkuk'], ['Zephaniah', 'zep zeph zephaniah'],
  ['Haggai', 'hag haggai'], ['Zechariah', 'zec zech zechariah'], ['Malachi', 'mal malachi'],
  ['Matthew', 'mt mat matt matthew'], ['Mark', 'mk mar mark'], ['Luke', 'lu luk luke'], ['John', 'joh jn john'], ['Acts', 'ac act acts'],
  ['Romans', 'ro rom romans'], ['1 Corinthians', '1co 1cor 1corinthians'], ['2 Corinthians', '2co 2cor 2corinthians'], ['Galatians', 'ga gal galatians'],
  ['Ephesians', 'eph ephesians'], ['Philippians', 'php phil philippians'], ['Colossians', 'col colossians'],
  ['1 Thessalonians', '1th 1ths 1thes 1thess 1thessalonians'], ['2 Thessalonians', '2th 2ths 2thes 2thess 2thessalonians'],
  ['1 Timothy', '1ti 1tim 1timothy'], ['2 Timothy', '2ti 2tim 2timothy'], ['Titus', 'tit titus'], ['Philemon', 'phm philem philemon'],
  ['Hebrews', 'heb hebrews'], ['James', 'jas jam james'], ['1 Peter', '1pe 1pet 1peter'], ['2 Peter', '2pe 2pet 2peter'],
  ['1 John', '1jo 1jn 1joh 1john'], ['2 John', '2jo 2jn 2joh 2john'], ['3 John', '3jo 3jn 3joh 3john'], ['Jude', 'jude'], ['Revelation', 're rev revelation revelations']
];
const ALIAS = {}; BOOKS.forEach(([name, al]) => al.split(' ').forEach(x => { ALIAS[x] = name; }));
const FULL = new Set(['genesis', 'exodus', 'leviticus', 'numbers', 'deuteronomy', 'joshua', 'judges', 'psalm', 'psalms', 'proverbs', 'ecclesiastes', 'isaiah', 'jeremiah', 'ezekiel', 'daniel', 'matthew', 'mark', 'luke', 'john', 'acts', 'romans', 'galatians', 'ephesians', 'philippians', 'colossians', 'hebrews', 'james', 'revelation', 'corinthians', 'thessalonians', 'timothy', 'peter']);
const bareWords = [...new Set(Object.keys(ALIAS).filter(k => !/^\d/.test(k)).concat(['samuel', 'kings', 'chronicles', 'corinthians', 'thessalonians', 'timothy', 'peter']))].sort((x, y) => y.length - x.length);
const numWords = ['sa', 'sam', 'samuel', 'ki', 'kgs', 'kings', 'ch', 'chr', 'chron', 'chronicles', 'co', 'cor', 'corinthians', 'th', 'ths', 'thes', 'thess', 'thessalonians', 'ti', 'tim', 'timothy', 'pe', 'pet', 'peter', 'jo', 'jn', 'joh', 'john'].sort((x, y) => y.length - x.length);
const REF_RE = new RegExp('(?<![A-Za-z0-9])(?:((?:[1-3]\\s?\\.?\\s?|[Il]{1,3}\\s?))(' + numWords.join('|') + ')|(' + bareWords.join('|') + '))(?![A-Za-z])\\.?\\s?(\\d{1,3})(?:\\s?[:.]\\s?(\\d{1,3}(?:\\s?[-–]\\s?\\d{1,3})?(?:\\s?,\\s?\\d{1,3}(?:\\s?[-–]\\s?\\d{1,3})?)*))?(?![A-Za-z0-9])', 'gi');
function canonBook(num, word) {
  const w = word.toLowerCase();
  if (num) { const n = { i: 1, ii: 2, iii: 3 }[num.trim().replace(/\./g, '').toLowerCase()] || +num.trim().replace(/\./g, ''); return ALIAS[n + w] || (w === 'samuel' ? n + ' Samuel' : w === 'kings' ? n + ' Kings' : null) || ALIAS[n + w.slice(0, 3)] || null; }
  return ALIAS[w] || (w === 'samuel' ? null : null);
}
function parseVerses(vs) {                       // "104,105" "18-25" "1-3, 11" -> [[a,b],...]
  if (!vs) return [];
  return vs.split(',').map(p => { const m = p.trim().match(/^(\d+)\s*[-–]\s*(\d+)$/); return m ? [+m[1], +m[2]] : [+p.trim(), +p.trim()]; }).filter(r => r[0] > 0);
}
function* findRefs(text) {
  REF_RE.lastIndex = 0; let m;
  while ((m = REF_RE.exec(text))) {
    const bare = (m[3] || '').toLowerCase();
    let word = m[2] || m[3], pre = m[1], book;
    if (pre && /^[Il]+$/.test(pre) && /[a-z]/.test(word[0])) {          // "Isa 40:1" is Isaiah, not "I" + "sa"
      book = ALIAS[(pre + word).toLowerCase()]; pre = null; word = m[1] + m[2];
      if (!book) continue;
    } else {
      if (!/[A-Z]/.test(word[0]) || (pre && !/^([1-3]|[Il]{1,3})/.test(pre.trim()))) continue;   // "am 5:30" or "i co…" are not references
      book = canonBook(pre && pre.replace(/l/g, 'I'), word);
      if (!book) continue;
    }
    const hasVerse = m[5] !== undefined;
    // without a verse, only full book names count ("Psalm 23", "Hebrews 11") so "Ac 20" or "Re 3" in running text are left alone
    if (!hasVerse && !FULL.has(word.toLowerCase())) continue;
    yield { index: m.index, text: m[0], book, ch: +m[4], vs: parseVerses(m[5]) };
  }
}
const refHref = r => `#/ref/${encodeURIComponent(r.book)}/${r.ch}${r.vs.length ? '/' + r.vs.map(v => v[0] === v[1] ? v[0] : v[0] + '-' + v[1]).join(',') : ''}`;
const refLabel = r => `${r.book} ${r.ch}${r.vs.length ? ':' + r.vs.map(v => v[0] === v[1] ? v[0] : v[0] + '–' + v[1]).join(', ') : ''}`;
function refOverlap(r, target) {                  // does reference r cover target {book,ch,vs}?
  if (r.book !== target.book || r.ch !== target.ch) return false;
  if (!target.vs.length || !r.vs.length) return true;
  return r.vs.some(a => target.vs.some(b => a[0] <= b[1] && b[0] <= a[1]));
}
function parseTarget(q) {                         // "ref:John/3/16-18"
  const m = /^ref:([^/]+)\/(\d+)(?:\/(.*))?$/.exec(q || ''); if (!m) return null;
  return { book: decodeURIComponent(m[1]), ch: +m[2], vs: parseVerses((m[3] || '').replace(/-/g, '-')) };
}
// "Section C5", "Sections B8, B9, B10", "Section C 10.6"  ->  page of that section (Part II concordance or Part III leaders guide, by where the text is)
const XSEC_RE = /\b[Ss]ections?\s+([A-G]\s?\d{1,2}(?:\.\d{1,2})?(?:\s*(?:,|and|&|or)\s*(?:[A-G]\s?)?\d{1,2}(?:\.\d{1,2})?)*)/g;
function sectionTarget(code, sub, part) {
  const order = part === 'II' ? ['II', 'III'] : ['III', 'II'];
  for (const p of order) { const t = (sub && ssec[p][code + '.' + sub]) || ssec[p][code]; if (t && t.page) return { ...t, part: p, code }; }
  return null;
}
function* findXrefs(text, part) {
  XSEC_RE.lastIndex = 0; let m;
  while ((m = XSEC_RE.exec(text))) {
    const base = m.index + m[0].length - m[1].length; let letter = '';
    const tok = /([A-G])?\s?(\d{1,2})(?:\.(\d{1,2}))?/g; let t;
    while ((t = tok.exec(m[1]))) {
      if (t[1]) letter = t[1]; if (!letter) continue;
      const code = letter + t[2], target = sectionTarget(code, t[3] ? +t[3] : null, part);
      if (target) yield { index: base + t.index, text: t[0], page: target.page, title: `${code}${t[3] ? '.' + t[3] : ''} — ${target.title || ''}`.trim() };
    }
  }
}
// contents lists: a whole line such as "A2: Training Leaders To Do Nine Things" or "E4. REPENTANCE" links to its section
function listingTarget(par, ctx) {
  let m = /^\s*([A-G])\s?(\d{1,2}|[lI])(?:\.(\d{1,2}))?\s*[-–:;]\s+\S/.exec(par);
  if (m && ctx.listing) return sectionTarget(m[1] + ('lI'.includes(m[2]) ? '1' : m[2]), m[3] ? +m[3] : null, 'III');
  m = /^\s*([A-IP])\s?(\d{1,2}|[lI])\.\s+\S/.exec(par);
  if (m && ctx.part === 'II') return sectionTarget((m[1] === 'P' ? 'F' : m[1]) + ('lI'.includes(m[2]) ? '1' : m[2]), null, 'II');
  if (ctx.div === 'contents') {                                                    // the three parts of the book
    m = /^\s*(I{1,3})\.\s+(New|Topical|Leaders)/.exec(par);
    const d = m && sdivs.find(x => x.title.startsWith(m[2] === 'New' ? 'I. New' : m[2] === 'Topical' ? 'II. Topical' : 'A. '));
    if (d) return { page: d.start_page };
  }
  m = /^\s*([A-I]):\s+\S/.exec(par);
  if (m && ctx.div === 'contents') return sectionTarget(m[1] + '1', null, 'II');
  return null;
}
// text -> html: Bible references and section cross-references become links, search words are highlighted
function renderText(text, q, ctx = {}) {
  const target = parseTarget(q), hq = target ? '' : q;
  const items = [...findRefs(text).map(r => ({ ...r, kind: 'bible' })), ...findXrefs(text, ctx.part || 'III').map(r => ({ ...r, kind: 'sec' }))].sort((x, y) => x.index - y.index);
  let out = '', pos = 0;
  for (const r of items) {
    if (r.index < pos) continue;
    out += hl(text.slice(pos, r.index), hq);
    out += r.kind === 'sec'
      ? `<a class="ref sec" href="#/staff/p/${r.page}" title="${esc(r.title)}">${hl(r.text, hq)}</a>`
      : `<a class="ref${target && refOverlap(r, target) ? ' hit' : ''}" href="${refHref(r)}">${hl(r.text, hq)}</a>`;
    pos = r.index + r.text.length;
  }
  out += hl(text.slice(pos), hq);
  const lt = listingTarget(text, ctx);                       // a contents line: make the whole line one link
  return lt ? `<a class="ref sec" href="#/staff/p/${lt.page}">${out}</a>` : out;
}
let refIndex = null;                              // page -> [refs]  (built once, on first use)
function buildRefIndex() {
  if (refIndex) return refIndex;
  refIndex = new Map();
  for (const p of spages) { const rs = [...findRefs(p.text)]; if (rs.length) refIndex.set(p.page, rs); }
  return refIndex;
}
async function viewRef(book, ch, vsText) {
  $('#view').innerHTML = skeleton('Looking up references…');
  try { if (!await loadStaff()) return; } catch (e) { $('#view').innerHTML = `<p class="warn">${esc(e.message)}</p>`; return; }
  const target = { book, ch, vs: parseVerses(vsText) };
  const label = refLabel(target);
  const vrange = target.vs.length ? target.vs : null;
  const hy = q(`SELECT DISTINCT hymn_number n FROM scripture_ref WHERE book=? AND chapter=? ${vrange ? 'AND (verse_start IS NULL OR (' + vrange.map(() => 'verse_start<=? AND coalesce(verse_end,verse_start)>=?').join(' OR ') + '))' : ''} ORDER BY n`,
    vrange ? [book, ch, ...vrange.flatMap(v => [v[1], v[0]])] : [book, ch]).map(r => r.n);
  const idx = buildRefIndex(); const hits = [];
  for (const [page, rs] of idx) { const r = rs.find(x => refOverlap(x, target)); if (r) hits.push({ page, r }); }
  const enc = encodeURIComponent(`ref:${encodeURIComponent(book)}/${ch}${target.vs.length ? '/' + target.vs.map(v => v[0] === v[1] ? v[0] : v[0] + '-' + v[1]).join(',') : ''}`);
  const bible = `https://www.biblegateway.com/passage/?search=${encodeURIComponent(label.replace('–', '-'))}&version=NKJV`;
  const snip = h => { const t = spages[h.page - 1].text; const from = Math.max(0, h.r.index - 90), to = Math.min(t.length, h.r.index + h.r.text.length + 90); return (from ? '… ' : '') + esc(t.slice(from, h.r.index)) + '<mark>' + esc(h.r.text) + '</mark>' + esc(t.slice(h.r.index + h.r.text.length, to)).replace(/\s+/g, ' ') + (to < t.length ? ' …' : ''); };
  $('#view').innerHTML = `<div class="bar"><a href="javascript:history.back()">‹ Back</a><a class="btn" href="${bible}" target="_blank" rel="noopener">Read the passage ↗</a></div>
    <h2 style="margin:.2em 0">${esc(label)}</h2>
    <h3 class="sec">Hymns <span class="muted">(${hy.length})</span></h3>${hy.length ? `<ul class="list">${rowsFor(hy)}</ul>` : '<p class="muted">No hymn cites this passage.</p>'}
    <h3 class="sec">In The Shepherd’s Staff <span class="muted">(${hits.length} page${hits.length === 1 ? '' : 's'})</span></h3>
    ${hits.length ? `<ul class="list">${hits.slice(0, 80).map(h => `<li><a href="#/staff/p/${h.page}/${enc}"><span class="num">${h.page}</span><span class="first">${snip(h)}</span></a></li>`).join('')}</ul>${hits.length > 80 ? '<p class="hint">Showing the first 80 pages.</p>' : ''}` : '<p class="muted">Not quoted in the book.</p>'}`;
  window.scrollTo(0, 0);
}


/* ------------------------------------------------------------- Documents (creeds, liturgy, …) */
let docLangs = null;
function viewDoc(slug) {
  const d = q('SELECT * FROM document WHERE slug=?', [slug])[0];
  if (!d) { $('#view').innerHTML = '<p class="muted pad">No such document.</p>'; return; }
  const vers = q('SELECT language, language_name n, heading FROM document_text WHERE slug=? ORDER BY seq', [slug]);
  const have = vers.map(v => v.language);
  let sel = (docLangs || store.get('doclangs', null) || (lang === 'both' ? ['en', 'tw'] : [lang])).filter(l => have.includes(l));
  if (!sel.length) sel = [have[0]];
  const lines = l => q('SELECT text FROM document_line WHERE slug=? AND language=? ORDER BY seq', [slug, l]).map(r => r.text);
  const cols = sel.map(l => { const v = vers.find(x => x.language === l); return { v, lines: lines(l) }; });
  const grid = cols.length > 1 && sbs;
  $('#view').innerHTML = `<article class="hymn doc"><div class="bar"><a href="#/library">‹ Library</a>
      <span><button id="smaller">A−</button> <button id="bigger">A+</button> <button id="copy">Copy</button>${cols.length > 1 ? `<button id="sbsbtn">${sbs ? '▤ Stacked' : '◫ Side by side'}</button>` : ''}</span></div>
    ${docArt(slug) ? `<div class="bookhead">${docArt(slug, 'cover')}<h2 style="margin:0">${esc(d.title)}</h2></div>` : `<h2 style="margin:.2em 0">${esc(d.title)}</h2>`}
    <div class="chips" role="group" aria-label="Languages">${vers.map(v => `<button class="chipbtn${sel.includes(v.language) ? ' on' : ''}" data-l="${esc(v.language)}">${esc(v.n)}</button>`).join('')}</div>
    <div class="cols ${grid ? 'docgrid' : ''}" style="${grid ? `grid-template-columns:repeat(${cols.length},1fr)` : ''}">${cols.map(c => `<section class="col"><h3>${esc(c.v.n)}</h3><div class="docname">${esc(c.v.heading || '')}</div>${c.lines.map(t => `<p class="docline">${esc(t)}</p>`).join('')}</section>`).join('')}</div>
    ${d.source ? `<p class="credit" style="margin-top:18px">${esc(d.source)}</p>` : ''}</article>`;
  document.querySelectorAll('.chipbtn').forEach(b => b.onclick = () => {
    const l = b.dataset.l; const next = sel.includes(l) ? sel.filter(x => x !== l) : have.filter(x => x === l || sel.includes(x));
    if (!next.length) return; docLangs = next; store.set('doclangs', next); viewDoc(slug);
  });
  $('#bigger').onclick = () => { fs = Math.min(40, fs + 2); store.set('fs', fs); renderShell(); };
  $('#smaller').onclick = () => { fs = Math.max(14, fs - 2); store.set('fs', fs); renderShell(); };
  $('#copy').onclick = async () => {
    const t = cols.map(c => `${c.v.heading || c.v.n}\n${c.lines.join('\n')}`).join('\n\n');
    try { await navigator.clipboard.writeText(t); $('#copy').textContent = 'Copied ✓'; } catch { $('#copy').textContent = 'Copy failed'; }
    setTimeout(() => { const b = $('#copy'); if (b) b.textContent = 'Copy'; }, 1500);
  };
  if ($('#sbsbtn')) $('#sbsbtn').onclick = () => { sbs = !sbs; store.set('sbs', sbs); viewDoc(slug); };
  window.scrollTo(0, 0);
}


/* ------------------------------------------------------------- Gospel songs: search + language filter (archived lyrics where available) */
const GLANG = { en: 'English', ak: 'Akan (Twi)' };
let gLang = store.get('glang', 'all'), gQuery = '', gOnly = false;
let gSongs = null;
function loadGospel() {
  return gSongs ||= q('SELECT id, title, language, year, url, also_urls, norm, lyrics IS NOT NULL AS has FROM gospel_song ORDER BY norm, language');
}
function gospelSearch(text, langFilter, onlyLyrics) {
  const words = foldKeep(text.replace(/ε/g, 'ɛ')).split(/\s+/).filter(Boolean);
  let list = loadGospel().filter(s => (langFilter === 'all' || s.language === langFilter) && (!onlyLyrics || s.has));
  if (!words.length) return list;
  const hit = list.filter(s => words.every(w => (' ' + s.norm).includes(' ' + w) || s.norm.includes(w)));
  const first = words[0];                                  // titles that start with the search come first
  return hit.sort((x, y) => (y.norm.startsWith(first) - x.norm.startsWith(first)) || (x.norm < y.norm ? -1 : 1));
}
function gospelRow(s) {
  const extra = s.also_urls ? JSON.parse(s.also_urls) : [];
  const meta = `${GLANG[s.language]}${s.year ? ' · ' + s.year : ''}${extra.length ? ' · ' + (extra.length + 1) + ' posts' : ''}`;
  if (s.has) return `<li class="gs"><a href="#/praise/${s.id}"><span class="first">${esc(s.title)}<small>${meta}</small></span><span class="badge">Lyrics</span></a></li>`;
  return `<li class="gs"><a href="${esc(s.url)}" target="_blank" rel="noopener"><span class="first">${esc(s.title)}<small>${meta}</small></span><span class="ext" aria-hidden="true">↗</span></a>${extra.map((u, i) => `<a class="alt" href="${esc(u)}" target="_blank" rel="noopener">post ${i + 2}</a>`).join('')}</li>`;
}
function viewGospelSong(id) {
  const s = q('SELECT * FROM gospel_song WHERE id=?', [id])[0];
  if (!s || !s.lyrics) { location.replace('#/praise'); return; }
  $('#view').innerHTML = `<article class="hymn"><div class="bar"><a href="#/praise">‹ Praise &amp; Worship</a><span><button id="smaller">A−</button> <button id="bigger">A+</button></span></div>
    <h2 style="margin:.2em 0">${esc(s.title)}</h2><div class="meta">${GLANG[s.language]}${s.year ? ' · ' + s.year : ''}</div>
    <div class="prose" style="font-size:var(--fs);line-height:1.55;margin-top:12px">${s.lyrics.split(/\n\s*\n/).map(st => { const ls = st.split('\n'); const lab = /^(verse\s*\d+|chorus|refrain|bridge)$/i.test(ls[0]); return `<p class="stz">${lab ? `<b class="lab">${esc(ls[0])}</b>` : ''}${esc((lab ? ls.slice(1) : ls).join('\n'))}</p>`; }).join('')}</div>
    <p class="credit" style="margin-top:18px">${esc(s.lyrics_basis || 'Lyrics archived from the source')}.<br>Text from <a href="${esc(s.url)}" target="_blank" rel="noopener">the original post ↗</a>.</p></article>`;
  $('#bigger').onclick = () => { fs = Math.min(40, fs + 2); store.set('fs', fs); renderShell(); };
  $('#smaller').onclick = () => { fs = Math.max(14, fs - 2); store.set('fs', fs); renderShell(); };
  window.scrollTo(0, 0);
}
function viewGospel() {
  const songs = loadGospel(); const n = { all: songs.length, en: songs.filter(s => s.language === 'en').length, ak: songs.filter(s => s.language === 'ak').length };
  $('#view').innerHTML = `<div class="bar"><a href="#/music">‹ Music</a></div><h2 style="margin:.2em 0">Praise &amp; Worship</h2>
    <div class="hint">${n.all} songs · tap a title to read archived lyrics in the app when available</div>
    <input id="pq" type="search" placeholder="Search song titles (Twi letters ɔ ɛ optional)" autocomplete="off" enterkeyhint="search" value="${esc(gQuery)}">
    <div class="chips" role="group" aria-label="Language" style="margin-top:10px">${[['all', 'All'], ['en', 'English'], ['ak', 'Akan (Twi)']].map(([k, label]) => `<button class="chipbtn${gLang === k ? ' on' : ''}" data-g="${k}">${label} <span class="cnt">${n[k]}</span></button>`).join('')}<button class="chipbtn${gOnly ? ' on' : ''}" id="gonly">Lyrics in app <span class="cnt">${songs.filter(s => s.has).length}</span></button></div>
    <div id="gres"></div>
    <footer style="margin-top:22px">Lyrics are shown in the app when a matching archived text is available. Source posts are linked for checking; rights remain unverified.</footer>`;
  const inp = $('#pq'), res = $('#gres');
  const run = () => {
    gQuery = inp.value; const list = gospelSearch(gQuery, gLang, gOnly), shown = gQuery.trim() ? list.slice(0, 300) : list;       // browsing shows every song, grouped by letter
    if (!list.length) { res.innerHTML = '<p class="muted" style="margin-top:14px">No songs match.</p>'; return; }
    let html = `<div class="hint" style="margin-top:12px">${list.length} song${list.length === 1 ? '' : 's'}${gQuery.trim() && list.length > 300 ? ' · showing the first 300, narrow your search' : ''}</div>`;
    if (!gQuery.trim()) {                                                       // browsing: group by first letter with a jump strip
      const letters = [...new Set(shown.map(s => (s.norm[0] || '#').toUpperCase()))];
      html += `<div class="az">${letters.map(l => `<a href="#" data-l="${l}">${l}</a>`).join('')}</div><ul class="list">`;
      let cur = '';
      for (const s of shown) { const l = (s.norm[0] || '#').toUpperCase(); if (l !== cur) { cur = l; html += `<li class="grp" id="g-${l}">${l}</li>`; } html += gospelRow(s); }
      html += '</ul>';
    } else html += `<ul class="list">${shown.map(gospelRow).join('')}</ul>`;
    res.innerHTML = html;
    res.querySelectorAll('.az a').forEach(a => a.onclick = e => { e.preventDefault(); document.getElementById('g-' + a.dataset.l)?.scrollIntoView({ block: 'start' }); });
  };
  document.querySelectorAll('.chipbtn[data-g]').forEach(b => b.onclick = () => { gLang = b.dataset.g; store.set('glang', gLang); document.querySelectorAll('.chipbtn[data-g]').forEach(x => x.classList.toggle('on', x === b)); run(); });
  $('#gonly').onclick = () => { gOnly = !gOnly; $('#gonly').classList.toggle('on', gOnly); run(); };
  let t; inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 150); });
  run(); if (!/Mobi|Android/i.test(navigator.userAgent)) inp.focus();
}

/* ------------------------------------------------------------- router + boot */
function route() {
  if (!db) return;
  const h = location.hash || '#/';
  // old links keep working
  for (const [re, to] of [[/^#\/?$/, '#/music'], [/^#\/themes/, '#/hymns/themes'], [/^#\/gospel/, '#/praise']]) if (re.test(h)) { location.replace(h.replace(re, to)); return; }
  const tab = /^#\/(music|hymns|h\/|praise)/.test(h) ? 'music' : /^#\/(library|staff|doc|soon|ref)/.test(h) ? 'library' : h.startsWith('#/directory') ? 'directory' : h.startsWith('#/saved') ? 'saved' : '';
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  if (!h.startsWith('#/search') && document.activeElement !== gInp) gInp.value = '';
  let m;
  if ((m = h.match(/^#\/search\/?(.*)$/))) return viewGlobalSearch(decodeURIComponent(m[1]));
  if ((m = h.match(/^#\/h\/(\d+)/))) return viewHymn(+m[1]);
  if ((m = h.match(/^#\/hymns(\/themes)?$/))) return viewHymns(m[1] ? 'themes' : 'number');
  if ((m = h.match(/^#\/praise\/(\d+)$/))) return viewGospelSong(+m[1]);
  if (h.startsWith('#/praise')) return viewGospel();
  if ((m = h.match(/^#\/doc\/([\w-]+)$/))) return viewDoc(m[1]);
  if ((m = h.match(/^#\/soon\/([\w-]+)$/))) return viewSoon(m[1]);
  if ((m = h.match(/^#\/ref\/([^/]+)\/(\d+)(?:\/(.*))?$/))) return viewRef(decodeURIComponent(m[1]), +m[2], decodeURIComponent(m[3] || ''));
  if ((m = h.match(/^#\/staff\/q\/(.*)$/))) { staffQuery = decodeURIComponent(m[1]); location.replace('#/staff'); return; }
  if ((m = h.match(/^#\/staff\/p\/(\d+)(?:\/(.*))?$/))) return viewStaffPage(+m[1], decodeURIComponent(m[2] || ''));
  if (h.startsWith('#/staff')) return viewStaff();
  if (h.startsWith('#/library')) return viewLibrary();
  if ((m = h.match(/^#\/directory\/([pa])\/(\d+)$/))) return viewDirectory(m[1], +m[2]);
  if (h.startsWith('#/directory')) return viewDirectory();
  if (h.startsWith('#/saved')) return viewSaved();
  viewMusic();
}
window.addEventListener('hashchange', route);

// Download the latest databases from the server (bypassing the offline copy), then reload.
async function updateDb() {
  const btn = $('#upd'), msg = $('#updmsg');
  if (!btn || btn.dataset.busy) return;
  btn.dataset.busy = '1'; btn.textContent = 'Updating…'; msg.textContent = '';
  try {
    const cache = await caches.open('hymnal-data-v15').catch(() => null);
    const files = ['hymnal.db'];
    if (sdb || (cache && await cache.match('staff.db'))) files.push('staff.db');   // only refresh the library if it was downloaded
    if (ddb || (cache && await cache.match('directory.db'))) files.push('directory.db');
    for (const f of files) {
      const r = await fetch(f, { credentials: 'same-origin', cache: 'reload' });
      if (!r.ok) throw new Error(f + ' ' + r.status);
      const buf = await r.arrayBuffer();
      if (cache) await cache.put(f, new Response(buf, { headers: { 'Content-Type': 'application/octet-stream' } }));
    }
    store.set('dbUpdated', Date.now());
    location.reload();
  } catch (e) {
    msg.textContent = navigator.onLine ? 'Update failed (' + e.message + '). Your current copy is unchanged.' : 'You are offline. Connect to the internet to update.';
    btn.textContent = 'Update database'; delete btn.dataset.busy;
  }
}
window.updateDb = updateDb;

(async () => {
  renderShell();
  try {
    const resp = await fetch('hymnal.db', { credentials: 'same-origin' });
    if (!resp.ok) throw new Error('hymnal.db ' + resp.status);
    // keep an offline copy right away (the service worker is not in charge yet on the very first visit)
    try { const copy = resp.clone(); caches.open('hymnal-data-v15').then(c => c.put('hymnal.db', copy)).catch(() => {}); } catch {}
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
