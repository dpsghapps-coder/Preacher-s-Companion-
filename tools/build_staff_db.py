"""The Shepherd's Staff (PDF) -> app/staff.db: one row per PDF page, searchable in the app.
usage: python3 tools/build_staff_db.py The_Shepherds_Staff.pdf app/staff.db"""
import re, sqlite3, subprocess, sys, os
PDF, OUT = sys.argv[1], sys.argv[2]
run = lambda *a: subprocess.run(a, capture_output=True, text=True, check=True).stdout
lay = run('pdftotext', '-layout', PDF, '-').split('\f')
raw = run('pdftotext', PDF, '-').split('\f')
n = min(len(lay), len(raw))
if n and not lay[n - 1].strip(): pass

# official bookmarks give the main divisions
import pypdf
r = pypdf.PdfReader(PDF)
marks = [(re.sub(r'\s+', ' ', o.title).strip(), r.get_destination_page_number(o) + 1) for o in r.outline if not isinstance(o, list)]
marks.sort(key=lambda m: m[1])
total = len([p for p in lay if True]) - 1 if lay and not lay[-1].strip() else len(lay)
pretty = {'A LEADERS BASIC TRAINING': 'A. Leaders Basic Training', 'B VICTORIOUS CHRISTIAN LEADERSHIP': 'B. Victorious Christian Leadership',
          'C WHAT LEADERS NEED TO KNOW ABOUT ...': 'C. What Leaders Need to Know About …', 'D HOW LEADERS CAN ...': 'D. How Leaders Can …',
          'E HOW JESUS BUILDS HIS CHURCH THROUGH ...': 'E. How Jesus Builds His Church Through …', 'F REWARDS / JUDGMENTS': 'F. Rewards / Judgments',
          'G ESCHATOLOGY': 'G. Eschatology', 'Topical Concordance': 'II. Topical Concordance', 'New Believers Bible Study': 'I. New Believers Bible Study',
          'Table of Contents': 'Contents'}
divs = []
if marks and marks[0][1] > 1: divs.append(('Front matter', 1))
for t, p in marks: divs.append((pretty.get(t, t), p))
divs = [(t, p, (divs[i + 1][1] - 1 if i + 1 < len(divs) else total)) for i, (t, p) in enumerate(divs)]

BULLET = re.compile(r'^\s*([-•*–]|\(?\d{1,2}[.)]|\(?[A-Za-z][.)]|[IVX]+\.)\s')
def is_columns(txt):
    return sum(1 for l in txt.split('\n') if re.search(r'\S {6,}\S', l)) >= 3

def reflow(txt):
    paras, cur = [], []
    def flush():
        nonlocal cur
        if cur:
            s = ''
            for l in cur:
                s = s + l if s.endswith('-') and l[:1].islower() else (s + ' ' + l if s else l)
            paras.append(re.sub(r'\s+', ' ', s).strip()); cur = []
    for line in txt.split('\n'):
        if not line.strip(): flush(); continue
        indent = len(line) - len(line.lstrip(' '))
        if (indent >= 3 or BULLET.match(line)) and cur: flush()
        cur.append(line.strip())
    flush()
    return '\n\n'.join(p for p in paras if p)

def lines_fmt(txt):
    out = [re.sub(r'[ \t]+', ' ', l).strip() for l in txt.split('\n')]
    return '\n'.join(re.sub(r'\n{3,}', '\n\n', '\n'.join(out)).split('\n')).strip()

if os.path.exists(OUT): os.remove(OUT)
db = sqlite3.connect(OUT)
db.executescript('''
CREATE TABLE staff_division (id INTEGER PRIMARY KEY, title TEXT NOT NULL, start_page INTEGER NOT NULL, end_page INTEGER NOT NULL);
CREATE TABLE staff_page (page INTEGER PRIMARY KEY, division_id INTEGER, fmt TEXT NOT NULL CHECK (fmt IN ('p','l')), text TEXT NOT NULL);
CREATE TABLE staff_meta (k TEXT PRIMARY KEY, v TEXT);
''')
for i, (t, a, b) in enumerate(divs, 1): db.execute('INSERT INTO staff_division VALUES (?,?,?,?)', (i, t, a, b))
for p in range(1, total + 1):
    l, rw = lay[p - 1], raw[p - 1]
    if not l.strip() and not rw.strip(): fmt, text = 'p', ''
    elif is_columns(l): fmt, text = 'l', lines_fmt(rw)
    else: fmt, text = 'p', reflow(l)
    div = next((i for i, (_, a, b) in enumerate(divs, 1) if a <= p <= b), None)
    db.execute('INSERT INTO staff_page VALUES (?,?,?,?)', (p, div, fmt, text))
db.executemany('INSERT INTO staff_meta VALUES (?,?)', [('title', "The Shepherd's Staff"), ('editor', 'Ralph Mahoney, World MAP, 1993 (4th reprint, rev. 1999)'), ('pages', str(total))])
db.commit(); db.execute('VACUUM'); db.close()
print(OUT, round(os.path.getsize(OUT) / 1e6, 2), 'MB;', total, 'pages;', len(divs), 'divisions')
