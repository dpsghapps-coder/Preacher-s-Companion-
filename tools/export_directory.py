"""Export the PCG minister directory (MySQL pcg_minister_db on localhost:3308) to app/directory.db.

PRIVACY: the app is public, so only names, titles, roles, congregations and their
presbytery/district are exported. Phone numbers and email addresses are NOT exported.

    python tools/export_directory.py            # host 127.0.0.1, port 3308, user root, no password
    MYSQL_PWD=... python tools/export_directory.py
"""
import os, re, sqlite3, unicodedata, pathlib
import pymysql

OUT = pathlib.Path(__file__).resolve().parent.parent / 'app' / 'directory.db'

def fold(s):
    s = unicodedata.normalize('NFKD', (s or '').lower().replace('ɔ', 'o').replace('ɛ', 'e'))
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()

src = pymysql.connect(host=os.environ.get('MYSQL_HOST', '127.0.0.1'), port=int(os.environ.get('MYSQL_PORT', 3308)),
                      user=os.environ.get('MYSQL_USER', 'root'), password=os.environ.get('MYSQL_PWD', ''),
                      database='pcg_minister_db', charset='utf8mb4')
cur = src.cursor()
cur.execute('SELECT id, name FROM presbyteries ORDER BY name')
presb = cur.fetchall()
cur.execute('SELECT id, presbytery_id, name, area_type FROM areas')
areas = cur.fetchall()
# deliberately no email column and no minister_phones join
cur.execute('SELECT id, area_id, title, full_name, category, role, is_district_minister, congregation FROM ministers')
people = cur.fetchall()
src.close()

OUT.unlink(missing_ok=True)
db = sqlite3.connect(OUT)
db.executescript('''
CREATE TABLE presbytery(id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE area(id INTEGER PRIMARY KEY, presbytery_id INTEGER NOT NULL, name TEXT NOT NULL, type TEXT);
CREATE TABLE person(id INTEGER PRIMARY KEY, area_id INTEGER NOT NULL, title TEXT, name TEXT NOT NULL, category TEXT,
                    role TEXT, is_dm INTEGER, congregation TEXT, norm TEXT NOT NULL);
CREATE INDEX person_area ON person(area_id);
CREATE INDEX area_presb ON area(presbytery_id);
''')
db.executemany('INSERT INTO presbytery VALUES(?,?)', presb)
db.executemany('INSERT INTO area VALUES(?,?,?,?)', areas)
amap = {a[0]: a for a in areas}; pmap = dict(presb)
rows = []
for (i, aid, title, name, cat, role, dm, cong) in people:
    a = amap.get(aid)
    norm = ' '.join(fold(x) for x in (title, name, role, cong, a and a[2], a and pmap.get(a[1])) if x)
    rows.append((i, aid, title, name.strip(), cat, role, dm, cong, ' ' + norm + ' '))
db.executemany('INSERT INTO person VALUES(?,?,?,?,?,?,?,?,?)', rows)
db.commit(); db.execute('VACUUM'); db.close()
print(f'{OUT}: {len(presb)} presbyteries, {len(areas)} areas, {len(rows)} people ({OUT.stat().st_size // 1024} KB), no phones/emails')
