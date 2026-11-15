"""Fetch lyrics ONLY for the songs listed in tools/gospel_pd.json (old hymns whose authors died long ago),
and keep a song only if the blog text really is that hymn (opening words match). Everything else stays link-only.
usage: python3 tools/fetch_gospel_pd.py   -> tools/gospel_lyrics.json"""
import json, re, html, urllib.request, sys, time
songs = json.load(open('tools/gospel_songs.json')); rules = json.load(open('tools/gospel_pd.json'))
norm = lambda t: re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9]+', ' ', t.lower())).strip()
def fetch(sid):
    url = f'https://public-api.wordpress.com/rest/v1.1/sites/82040680/posts/{sid}?fields=title,content'
    for i in range(3):
        try: return json.load(urllib.request.urlopen(url, timeout=30))
        except Exception as e: time.sleep(2)
    return None
def to_lines(content):
    t = re.sub(r'(?i)<br\s*/?>', '\n', content); t = re.sub(r'(?i)</p>', '\n\n', t); t = re.sub(r'<[^>]+>', '', t)
    t = html.unescape(t).replace('\ufeff', '').replace('\r', '').replace('\xa0', ' ')
    raw = [re.sub(r'[ \t]+', ' ', l).strip() for l in t.split('\n')]
    text = [l for l in raw if l]
    blanks = sum(1 for i in range(1, len(raw)) if not raw[i] and raw[i - 1])
    double_spaced = blanks >= 0.7 * len(text)            # many posts put a blank line after every lyric line
    label = re.compile(r'^(verse\s*\d*|chorus|refrain|bridge)(\s+of song)?\s*:?$', re.I)
    out, prev_blank = [], False
    for l in raw:
        if not l:
            prev_blank = True; continue
        if label.match(l) or (not double_spaced and prev_blank and out):
            if out and out[-1] != '': out.append('')     # a new stanza starts here
        out.append(l); prev_blank = False
    # the blog sometimes repeats a verse number ("Verse 2" twice): renumber the verse labels in order
    n = 0 if (out and label.match(out[0]) and re.match(r'verse', out[0], re.I)) else 1
    for i, l in enumerate(out):
        if re.match(r'^verse\s*\d*(\s+of song)?\s*:?$', l, re.I):
            n += 1; out[i] = f'Verse {n}'
    return re.sub(r'\n{3,}', '\n\n', '\n'.join(out)).strip()
out, rejected = {}, []
for s in songs:
    if s['language'] != 'en': continue
    rule = next((r for r in rules if re.search(r['match'], s['title'])), None)
    if not rule: continue
    d = fetch(s['source_id'])
    text = to_lines(d['content']) if d else ''
    rep = rule.get('repair')
    if rep and text.startswith(rep['startswith']): text = rep['prefix'] + text                 # the blog post lost its first words
    ops = rule['opening'] if isinstance(rule['opening'], list) else [rule['opening']]
    ok = bool(text) and any(o in norm(text)[:max(len(o) * 3, 150)] for o in ops)
    if ok and rule.get('also'): ok = any(m in norm(text) for m in rule['also'])          # second phrase of the real hymn must be there too
    (out.__setitem__(s['source_id'], dict(title=s['title'], lyrics=text, basis=rule['basis'])) if ok else rejected.append((s['title'], norm(text)[:70])))
json.dump(out, open('tools/gospel_lyrics.json', 'w'), ensure_ascii=False, indent=1)
print(len(out), 'verified;', len(rejected), 'rejected (left as links):'); [print('  -', r) for r in rejected]
