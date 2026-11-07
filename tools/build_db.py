"""Stage 3: parsed hymns (en + tw JSON) -> SQLite database."""
import json, re, sqlite3, subprocess, sys, os

SMALL = {'and', 'of', 'the', 'in', 'to', 'on', 'for', 'with'}


def nice(t):
    w = t.title().split()
    return ' '.join(x.lower() if i and x.lower() in SMALL else x for i, x in enumerate(w)).replace("’S", "’s")


OUT = sys.argv[1] if len(sys.argv) > 1 else 'hymnal.db'
en = {h['number']: h for h in json.load(open('build/en_hymns.json'))['hymns']}
tw = {h['number']: h for h in json.load(open('build/tw_hymns.json'))['hymns']}

# ------------------------------------------------------------ English themes from the printed contents list
toc_txt = subprocess.run(['pdftotext', '-f', '9', '-l', '13', '-layout', 'PRESBY HYMN ENGLISH.pdf', '-'],
                         capture_output=True, text=True).stdout
start = toc_txt.index('THEMES FOR ENGLISH HYMNAL')
toc_txt = toc_txt[start:toc_txt.index('PREFACE')]
en_themes = []        # (theme, subtheme, from, to)
theme, pending = None, ''
for raw in toc_txt.splitlines():
    line = raw.replace('\f', ' ').strip()
    if not line or line.startswith('THEMES FOR') or re.fullmatch(r'[xivl]+', line):
        continue
    m = re.match(r'^(.*?)\s+-\s+(\d+)\s*-\s*(\d+)\s*$', line)
    sub = re.match(r'^([ivx]+)\.\s+(.*)$', (pending + ' ' + (m.group(1) if m else line)).strip())
    if m:
        name = (pending + ' ' + m.group(1)).strip()
        sm = re.match(r'^([ivx]+)\.\s+(.*)$', name)
        if sm:
            en_themes.append((theme, sm.group(2).strip(), int(m.group(2)), int(m.group(3))))
        else:
            theme = nice(name)
            en_themes.append((theme, None, int(m.group(2)), int(m.group(3))))
        pending = ''
    elif re.match(r'^[ivx]+\.\s', line) or pending:
        pending = (pending + ' ' + line).strip()
    else:
        theme = nice(line)
        pending = ''
# top-level lines that carry a range are both theme and (only) subtheme: fix duplicates
def en_theme_for(n):
    best = None
    for th, sub, a, b in en_themes:
        if a <= n <= b:
            if sub is not None:
                return th, sub
            best = (th, None)
    return best or (None, None)

# ------------------------------------------------------------ scripture reference parsing
BOOKS = ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel',
         '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra', 'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs',
         'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel',
         'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi',
         'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians',
         'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon',
         'Hebrews', 'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude', 'Revelation']
ALIASES = {'psalm': 'Psalms', 'ps': 'Psalms', 'rev': 'Revelation', 'revelations': 'Revelation', 'deut': 'Deuteronomy',
           'phil': 'Philippians', 'philip': 'Philippians', 'matt': 'Matthew', 'mat': 'Matthew', 'eph': 'Ephesians',
           'isa': 'Isaiah', 'is': 'Isaiah', 'heb': 'Hebrews', 'rom': 'Romans', 'cor': 'Corinthians', 'col': 'Colossians',
           'gen': 'Genesis', 'exod': 'Exodus', 'num': 'Numbers', 'jer': 'Jeremiah', 'ezek': 'Ezekiel', 'dan': 'Daniel',
           'zech': 'Zechariah', 'mal': 'Malachi', 'prov': 'Proverbs', 'eccl': 'Ecclesiastes', 'lam': 'Lamentations',
           'gal': 'Galatians', 'thess': 'Thessalonians', 'tim': 'Timothy', 'pet': 'Peter', 'jn': 'John', 'lk': 'Luke',
           'mk': 'Mark', 'jas': 'James', 'sam': 'Samuel', 'kgs': 'Kings', 'chron': 'Chronicles', 'hab': 'Habakkuk',
           'zeph': 'Zephaniah', 'song of songs': 'Song of Solomon', 'canticles': 'Song of Solomon', 'song': 'Song of Solomon'}


def canon_book(name):
    n = re.sub(r'\s+', ' ', name.strip().rstrip('.')).strip()
    m = re.match(r'^([123])\s*(.*)$', n)
    pre, rest = (m.group(1) + ' ', m.group(2)) if m else ('', n)
    key = rest.lower().rstrip('.')
    cand = ALIASES.get(key, rest)
    full = pre + cand
    for b in BOOKS:
        if b.lower() == full.lower() or b.lower().startswith(full.lower()) and len(full) >= 3:
            return b
    return None


def parse_refs(text):
    refs, last_book = [], None
    t = re.sub(r'(\d)\s*vs\.?', r'\1 vs.', text)
    for seg in re.split(r';|’|(?<=\d)\.\s+(?=[A-Z1-3])', t):
        seg = seg.strip().strip('.').strip()
        if not seg:
            continue
        m = re.match(r'^(?P<book>(?:[1-3]\s?)?[A-Za-z][A-Za-z ]*?)\.?\s*(?P<ch>\d+)\s*(?:(?:v{1,2}s?\.?|:)\s*(?P<vs>[\d,\s\-–]+))?\.?$', seg)
        if m:
            book = canon_book(m.group('book'))
            if book is None:
                refs.append(dict(raw=seg, book=None, chapter=int(m.group('ch')), vs=m.group('vs')))
                continue
            last_book = book
            refs.append(dict(raw=seg, book=book, chapter=int(m.group('ch')), vs=m.group('vs')))
            continue
        m = re.match(r'^(?P<ch>\d+)\s*(?:(?:v{1,2}s?\.?|:)\s*(?P<vs>[\d,\s\-–]+))?\.?$', seg)
        if m and last_book:
            refs.append(dict(raw=seg, book=last_book, chapter=int(m.group('ch')), vs=m.group('vs')))
            continue
        refs.append(dict(raw=seg, book=None, chapter=None, vs=None))
    out = []
    for r in refs:
        ranges = []
        if r['vs']:
            for part in re.split(r',', r['vs']):
                part = part.strip()
                mm = re.match(r'^(\d+)\s*[-–]\s*(\d+)$', part)
                if mm:
                    ranges.append((int(mm.group(1)), int(mm.group(2))))
                elif part.isdigit():
                    ranges.append((int(part), int(part)))
        out += [(r['raw'], r['book'], r['chapter'], a, b) for a, b in ranges] if ranges else \
               [(r['raw'], r['book'], r['chapter'], None, None)]
    return out


# Twi section titles repeat on every page with small spelling/case variations: keep the most common per numeral
from collections import Counter, defaultdict
_sec, _sub = defaultdict(Counter), defaultdict(Counter)
for h in tw.values():
    if h.get('twi_section'):
        _sec[h['twi_section'][0]][h['twi_section'][1]] += 1
        if h.get('twi_sub'):
            _sub[(h['twi_section'][0], h['twi_sub'][0])][h['twi_sub'][1]] += 1
SEC = {k: v.most_common(1)[0][0] for k, v in _sec.items()}
SUB = {k: v.most_common(1)[0][0] for k, v in _sub.items()}

# ------------------------------------------------------------ build
if os.path.exists(OUT):
    os.remove(OUT)
db = sqlite3.connect(OUT)
db.executescript('''
PRAGMA foreign_keys = ON;
CREATE TABLE hymn (
    number INTEGER PRIMARY KEY CHECK (number BETWEEN 1 AND 850)
);
CREATE TABLE hymn_text (
    id INTEGER PRIMARY KEY,
    hymn_number INTEGER NOT NULL REFERENCES hymn(number),
    language TEXT NOT NULL CHECK (language IN ('en','tw')),
    scripture_raw TEXT,            -- reference line printed above the hymn
    theme TEXT,                    -- main theme / section
    subtheme TEXT,                 -- sub-theme / sub-section
    first_line TEXT,
    author_line TEXT,              -- composer / author / translator credits as printed
    source_page INTEGER,           -- PDF page the hymn starts on
    needs_review INTEGER NOT NULL DEFAULT 0,
    review_notes TEXT,
    UNIQUE (hymn_number, language)
);
CREATE TABLE stanza (
    id INTEGER PRIMARY KEY,
    hymn_text_id INTEGER NOT NULL REFERENCES hymn_text(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,          -- order of appearance
    kind TEXT NOT NULL CHECK (kind IN ('verse','refrain')),
    verse_number INTEGER,          -- NULL for refrains
    UNIQUE (hymn_text_id, seq)
);
CREATE TABLE line (
    id INTEGER PRIMARY KEY,
    stanza_id INTEGER NOT NULL REFERENCES stanza(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    text TEXT NOT NULL,
    UNIQUE (stanza_id, seq)
);
CREATE TABLE scripture_ref (        -- language independent: refs are the same for both books
    id INTEGER PRIMARY KEY,
    hymn_number INTEGER NOT NULL REFERENCES hymn(number),
    raw TEXT NOT NULL,
    book TEXT, chapter INTEGER, verse_start INTEGER, verse_end INTEGER
);
CREATE INDEX idx_stanza_text ON stanza(hymn_text_id, seq);
CREATE INDEX idx_ref ON scripture_ref(book, chapter);
CREATE VIEW stanza_text AS
    SELECT s.id AS stanza_id, s.hymn_text_id, s.seq, s.kind, s.verse_number,
           group_concat(l.text, char(10)) AS body
    FROM stanza s JOIN line l ON l.stanza_id = s.id
    GROUP BY s.id;
''')


def clean_header(h):
    h = re.sub(r'\s+', ' ', h).strip().rstrip(';').strip()
    # theme heading that shares a line with the reference, e.g. "iii. the trinity Isaiah 57 vs. 15"
    h = re.sub(r"^[ivx0-9]+\.\s+[a-z’' ,]+?\s+(?=(?:[1-3]\s?)?[A-Z][a-z])", '', h)
    return h


for n in range(1, 851):
    db.execute('INSERT INTO hymn(number) VALUES (?)', (n,))
    for lang, src in (('en', en), ('tw', tw)):
        h = src.get(n)
        if not h:
            continue
        if lang == 'en':
            th, sub = en_theme_for(n)
        else:
            sec, sb = h.get('twi_section'), h.get('twi_sub')
            th = SEC.get(sec[0]) if sec else None
            sub = SUB.get((sec[0], sb[0])) if sec and sb else None
        first = h['stanzas'][0]['lines'][0] if h['stanzas'] else None
        cur = db.execute('INSERT INTO hymn_text(hymn_number,language,scripture_raw,theme,subtheme,first_line,author_line,'
                         'source_page,needs_review,review_notes) VALUES (?,?,?,?,?,?,?,?,?,?)',
                         (n, lang, clean_header(h['header']), th, sub, first, ' | '.join(h['authors']) or None,
                          h['page'], 1 if h['review'] else 0, '; '.join(h['review']) or None))
        ht = cur.lastrowid
        for i, s in enumerate(h['stanzas'], 1):
            sc = db.execute('INSERT INTO stanza(hymn_text_id,seq,kind,verse_number) VALUES (?,?,?,?)',
                            (ht, i, s['kind'], s['verse']))
            for j, ln in enumerate(s['lines'], 1):
                db.execute('INSERT INTO line(stanza_id,seq,text) VALUES (?,?,?)', (sc.lastrowid, j, ln))
    if n in en:
        for raw, book, ch, a, b in parse_refs(clean_header(en[n]['header'])):
            db.execute('INSERT INTO scripture_ref(hymn_number,raw,book,chapter,verse_start,verse_end) VALUES (?,?,?,?,?,?)',
                       (n, raw, book, ch, a, b))
db.executescript('''
CREATE VIRTUAL TABLE stanza_fts USING fts5(body, language UNINDEXED, hymn_number UNINDEXED, verse_number UNINDEXED,
                                           tokenize='unicode61 remove_diacritics 2');
INSERT INTO stanza_fts(body, language, hymn_number, verse_number)
    SELECT st.body, ht.language, ht.hymn_number, st.verse_number
    FROM stanza_text st JOIN hymn_text ht ON ht.id = st.hymn_text_id;
''')
db.commit()
for t in ('hymn', 'hymn_text', 'stanza', 'line', 'scripture_ref'):
    print(t, db.execute(f'SELECT count(*) FROM {t}').fetchone()[0])
print('needs_review:', db.execute('SELECT language, count(*) FROM hymn_text WHERE needs_review GROUP BY language').fetchall())
print('refs without book:', db.execute('SELECT count(*) FROM scripture_ref WHERE book IS NULL').fetchone()[0])
