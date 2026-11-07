"""Make the browser copy of the database: no FTS5 (sql.js lacks it), plus a folded search table."""
import sqlite3, shutil, re, unicodedata, sys
SRC, DST = 'hymnal.db', 'app/hymnal.db'
shutil.copy(SRC, DST)
db = sqlite3.connect(DST)
db.executescript('DROP TABLE IF EXISTS stanza_fts;')  # drops the FTS5 shadow tables too


def fold(t):
    t = t.lower().replace('ɔ', 'o').replace('ɛ', 'e')
    t = unicodedata.normalize('NFD', t)
    t = ''.join(c for c in t if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9 ]+', ' ', t.replace('’', '').replace("'", ''))


db.execute('CREATE TABLE hymn_search (hymn_number INTEGER, language TEXT, norm TEXT)')
rows = db.execute("""SELECT ht.hymn_number, ht.language, group_concat(l.text, ' ')
    FROM hymn_text ht JOIN stanza s ON s.hymn_text_id = ht.id JOIN line l ON l.stanza_id = s.id
    GROUP BY ht.id""").fetchall()
db.executemany('INSERT INTO hymn_search VALUES (?,?,?)',
               [(n, lg, re.sub(r'\s+', ' ', fold(t))) for n, lg, t in rows])
db.execute('CREATE INDEX idx_hs ON hymn_search(language)')
db.commit(); db.execute('VACUUM'); db.close()
import os; print(DST, round(os.path.getsize(DST) / 1e6, 2), 'MB')
