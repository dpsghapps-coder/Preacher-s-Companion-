"""The Shepherd's Staff (Corrected Edition PDF) -> app/staff.db  (one row per PDF page + section index for cross-references)
usage: python3 tools/build_staff_db.py The_Shepherds_Staff_Corrected.pdf app/staff.db"""
import re, sqlite3, subprocess, sys, os, collections
PDF, OUT = sys.argv[1], sys.argv[2]
run = lambda *a: subprocess.run(a, capture_output=True, text=True).stdout
lay = run('pdftotext', '-layout', PDF, '-').split('\f')
raw = run('pdftotext', PDF, '-').split('\f')
total = sum(1 for _ in range(len(lay) - 1)) if not lay[-1].strip() else len(lay)
lay, raw = lay[:total], raw[:total]
norm = lambda s: re.sub(r'[^a-z0-9]+', ' ', s.lower()).strip()
lines = [[x.strip() for x in p.split('\n') if x.strip()] for p in lay]

# ---------- printed page numbers (bare number on the last line of the page) ----------
label = {}
for i, ls in enumerate(lines, 1):
    if ls and re.fullmatch(r'\d{1,4}', ls[-1]): label[i] = ls[-1]

# ---------- divisions: found by their headings, checked against what the text says ----------
def find_first(pattern, lo=1, top=4):
    for i in range(lo, total + 1):
        if any(re.match(pattern, x, re.I) for x in lines[i - 1][:top]): return i
starts = [('Front matter', 1), ('Contents', find_first(r'^TABLE OF CONTENTS', 1, 3)),
          ('I. New Believers Bible Study', find_first(r'^NEW BELIEVERS BIBLE STUDY', 3)),
          ('II. Topical Concordance', find_first(r'^TOPICAL CONCORDANCE', 6)),
          ('A. Leaders Basic Training', find_first(r'^(?:A[.\\s:\\-–]*)?LEADERS BASIC TRAINING', 100)),
          ('B. Victorious Christian Leadership', find_first(r'^(?:B[.\\s:\\-–]*)?VICTORIOUS CHRISTIAN LEADERSHIP', 100)),
          ('C. What Leaders Need to Know About …', find_first(r'^(?:C[.\\s:\\-–]*)?WHAT LEADERS NEED TO KNOW', 100)),
          ('D. How Leaders Can …', find_first(r'^(?:D[.\\s:\\-–]*)?HOW LEADERS CAN', 100)),
          ('E. How Jesus Builds His Church Through …', find_first(r'^(?:E[.\\s:\\-–]*)?HOW JESUS BUILDS', 100)),
          ('F. Rewards / Judgments', find_first(r'^(?:F[.\\s:\\-–]*)?REWARDS', 100)),
          ('G. Eschatology', find_first(r'^(?:G[.\\s:\\-–]*)?ESCHATOLOGY', 100))]
assert all(s[1] for s in starts), starts
divs = [(t, a, (starts[i + 1][1] - 1 if i + 1 < len(starts) else total)) for i, (t, a) in enumerate(starts)]
PART2 = (divs[3][1], divs[4][1] - 1)                       # topical concordance
GUIDE = {t[0]: (a, b) for t, a, b in divs[4:]}              # 'A'.. 'G' -> page range of that division

# ---------- Part II: Topical Concordance topics (A1 … I4) ----------
topics = {}
for i in range(PART2[0], PART2[1] + 1):
    ls = lines[i - 1]
    if not (i <= PART2[0] + 2 or any('TABLE OF CONTENTS' in x.upper() for x in ls[:4])): continue
    for x in ls:
        m = re.match(r'^([A-IP])\s?(\d{1,2}|[lI])\.\s+(.{3,90})$', x)
        if m: topics.setdefault(('F' if m.group(1) == 'P' else m.group(1)) + ('1' if m.group(2) in 'lI' else m.group(2)), m.group(3).strip())
sections = []        # (part, code, sub, title, page, exact)
prev = PART2[0]
for code in sorted(topics, key=lambda c: (c[0], int(c[1:]))):
    n, nt, hit = code[1:], norm(topics[code]), None
    for i in range(prev, PART2[1] + 1):
        if any(norm(x).startswith(n + ' ' + nt[:22]) and len(norm(x)) < len(nt) + 12 for x in lines[i - 1][:60]) and i > PART2[0] + 2: hit = i; break
    if hit: prev = hit
    sections.append(('II', code, None, topics[code], hit or prev, bool(hit)))      # unlocated topic: nearest earlier one

# ---------- Part III: Leaders Training Guide sections A1 … G2 and their sub-sections (A3.1 …) ----------
TOC = {'A': 5, 'B': 2, 'C': 11, 'D': 13, 'E': 7, 'F': 3, 'G': 2}
head = re.compile(r'^\s*(?:SECTION\s+)?([A-G])\s?(\d{1,2}|[lI])(?:\.(\d{1,2}))?\s*(?:[-–:]\s+(\S.*)|)$', re.I)
tocpage = re.compile(r'^\s*([A-G])\s?(\d{1,2}|[lI])\s*[:;]\s*(.+?)\s*\.{2,}')
titles = {}
for i in range(1, divs[2][1]):                         # front-matter contents list gives the official titles
    for x in lines[i - 1]:
        m = tocpage.match(x)
        if m: titles.setdefault(m.group(1) + ('1' if m.group(2) in 'lI' else m.group(2)), m.group(3).strip())
found, subs = {}, {}
for L, (lo, hi) in GUIDE.items():
    for i in range(lo, hi + 1):
        ms = [m for m in (head.match(x) for x in lines[i - 1][:60]) if m and m.group(1).upper() == L]
        codes = {L + ('1' if m.group(2) in 'lI' else m.group(2)) for m in ms}
        if len(codes) >= 3: continue                                  # division contents list (many different sections)
        for x in lines[i - 1][:40]:
            m = head.match(x)
            if not m or m.group(1).upper() != L: continue
            code = L + ('1' if m.group(2) in 'lI' else m.group(2))
            if int(code[1:]) > TOC[L]: continue
            if m.group(3): subs.setdefault(f'{code}.{m.group(3)}', (i, (m.group(4) or '').strip()))
            found.setdefault(code, i)                                  # a section's own start page lists its sub-sections
for L in GUIDE:                                                       # two sections on one contents page: the later one has not really been found
    for k in range(2, TOC[L] + 1):
        if found.get(f'{L}{k}') is not None and found.get(f'{L}{k}') == found.get(f'{L}{k-1}'): del found[f'{L}{k}']
# title match as a second chance for sections whose heading line has no code
for L, (lo, hi) in GUIDE.items():
    for k in range(1, TOC[L] + 1):
        code = f'{L}{k}'
        if code in found or code not in titles: continue
        nt = norm(titles[code])
        for i in range(lo + 1, hi + 1):
            top = lines[i - 1][:14]
            if sum(1 for x in top if re.match(r'^[A-G]\s?\d{1,2}\s*[-–:.]', x)) >= 3: continue
            if any(norm(x).endswith(nt) and len(norm(x)) < len(nt) + 16 for x in top): found[code] = i; break
for L in GUIDE:                                                       # still unknown: use its earliest sub-section heading
    for k in range(1, TOC[L] + 1):
        code = f'{L}{k}'
        pgs = [pg for key, (pg, _) in subs.items() if key.startswith(code + '.') and pg > GUIDE[L][0]]
        if (code not in found or found[code] == GUIDE[L][0]) and pgs: found[code] = min(pgs)
for L, (lo, hi) in GUIDE.items():
    for k in range(1, TOC[L] + 1):
        code = f'{L}{k}'
        sections.append(('III', code, None, titles.get(code, ''), found.get(code, lo), code in found))
for key, (pg, t) in subs.items():
    code, s = key.split('.')
    sections.append(('III', code, int(s), t, pg, True))

# ---------- page text ----------
BULLET = re.compile(r'^\s*([-•*–>]|\(?\d{1,2}[.)]|\(?[A-Za-z][.)]|[IVX]+\.)\s')
is_columns = lambda t: sum(1 for l in t.split('\n') if re.search(r'\S {6,}\S', l)) >= 3
def reflow(txt):
    paras, cur = [], []
    def flush():
        nonlocal cur
        if cur:
            s = ''
            for l in cur: s = s + l if s.endswith('-') and l[:1].islower() else (s + ' ' + l if s else l)
            paras.append(re.sub(r'\s+', ' ', s).strip()); cur = []
    for line in txt.split('\n'):
        if not line.strip(): flush(); continue
        indent = len(line) - len(line.lstrip(' '))
        if (indent >= 3 or BULLET.match(line)) and cur: flush()
        cur.append(line.strip())
    flush()
    return '\n\n'.join(p for p in paras if p)
def lines_fmt(txt): return re.sub(r'\n{3,}', '\n\n', '\n'.join(re.sub(r'[ \t]+', ' ', l).strip() for l in txt.split('\n'))).strip()
def drop_footer(txt, n):
    ls = txt.rstrip().split('\n')
    if n and ls and ls[-1].strip() == n: ls = ls[:-1]
    return '\n'.join(ls)

if os.path.exists(OUT): os.remove(OUT)
db = sqlite3.connect(OUT)
db.executescript('''
CREATE TABLE staff_division (id INTEGER PRIMARY KEY, title TEXT NOT NULL, start_page INTEGER NOT NULL, end_page INTEGER NOT NULL);
CREATE TABLE staff_page (page INTEGER PRIMARY KEY, division_id INTEGER, label TEXT, fmt TEXT NOT NULL CHECK (fmt IN ('p','l')), text TEXT NOT NULL);
CREATE TABLE staff_section (part TEXT NOT NULL, code TEXT NOT NULL, sub INTEGER, title TEXT, page INTEGER, exact INTEGER NOT NULL);  -- part II = concordance, III = leaders guide
CREATE TABLE staff_meta (k TEXT PRIMARY KEY, v TEXT);
''')
for i, (t, a, b) in enumerate(divs, 1): db.execute('INSERT INTO staff_division VALUES (?,?,?,?)', (i, t, a, b))
for p in range(1, total + 1):
    l, rw = drop_footer(lay[p - 1], label.get(p)), drop_footer(raw[p - 1], label.get(p))
    if not l.strip() and not rw.strip(): fmt, text = 'p', ''
    elif is_columns(l): fmt, text = 'l', lines_fmt(rw)
    else: fmt, text = 'p', reflow(l)
    div = next((i for i, (_, a, b) in enumerate(divs, 1) if a <= p <= b), None)
    db.execute('INSERT INTO staff_page VALUES (?,?,?,?,?)', (p, div, label.get(p), fmt, text))
db.executemany('INSERT INTO staff_section VALUES (?,?,?,?,?,?)', [(a, b, c, d, e, int(f)) for a, b, c, d, e, f in sections if e])
db.executemany('INSERT INTO staff_meta VALUES (?,?)', [('title', "The Shepherd's Staff"), ('edition', 'Corrected Edition'), ('editor', 'Ralph Mahoney, World MAP, 1993 (4th reprint, rev. 1999)'), ('pages', str(total))])
db.commit(); db.execute('VACUUM'); db.close()
ex = collections.Counter((s[0], s[5]) for s in sections if s[2] is None)
print(OUT, round(os.path.getsize(OUT) / 1e6, 2), 'MB;', total, 'pages;', len(divs), 'divisions; sections:', dict(ex), '; guide sub-sections:', len(subs))
