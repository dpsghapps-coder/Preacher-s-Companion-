"""gospel_lyrics.sqlite (posts table: title + link per blog post) -> tools/gospel_songs.json
usage: python3 tools/build_gospel.py path/to/gospel_lyrics.sqlite
Only titles, language and the link to the original post are kept (the source file has no lyrics text)."""
import sqlite3, json, re, sys, collections
src = sqlite3.connect(f'file:{sys.argv[1]}?mode=ro', uri=True)
rows = src.execute("select source_id, title, source_url, categories_json, published_at, rights_status, review_status from posts order by source_id").fetchall()
SKIP = {'the genesis', 'twi gospel mantra series'}            # blog intro / series page, not songs
def clean(t):
    t = t.replace('ε', 'ɛ').replace('Ε', 'Ɛ')                    # Greek epsilon typed for Twi ɛ
    return re.sub(r'\s+', ' ', t).strip()
def lang(cats, title):
    names = set(json.loads(cats or '{}'))
    if 'Akan Gospel Songs' in names: return 'ak'
    if 'English Gospel Songs' in names: return 'en'
    return 'ak' if re.search(r'[ɔɛƆƐεΕ]', title) else None        # the few uncategorised Twi titles
key = lambda t: re.sub(r'[^a-z0-9]+', ' ', t.lower().replace('ɔ', 'o').replace('ɛ', 'e')).strip()
groups, skipped = collections.OrderedDict(), []
for sid, title, url, cats, pub, rights, review in rows:
    t = clean(title); l = lang(cats, title)
    if key(t) in SKIP or not l or not t: skipped.append(t); continue
    k = (key(t), l)
    if k in groups: groups[k]['also'].append(url)                  # same title posted more than once
    else: groups[k] = dict(title=t, language=l, year=int(pub[:4]) if pub else None, url=url, also=[], source_id=sid, rights=rights, review=review)
songs = sorted(groups.values(), key=lambda s: (key(s['title']), s['language']))
json.dump(songs, open('tools/gospel_songs.json', 'w'), ensure_ascii=False, indent=0)
print(len(rows), 'posts ->', len(songs), 'songs;', collections.Counter(s['language'] for s in songs), 'skipped:', skipped, 'merged duplicates:', sum(len(s['also']) for s in songs))
