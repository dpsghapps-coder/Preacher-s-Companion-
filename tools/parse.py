"""Stage 2: ordered text lines -> structured hymns (JSON).

usage: parse.py en|tw build/<lang>_lines.json build/<lang>_hymns.json
"""
import sys, re, json, statistics

LANG, SRC, DST = sys.argv[1], sys.argv[2], sys.argv[3]
pages = json.load(open(SRC))

END_MARK = {'en': r'^INDEX TO THE HYMNS', 'tw': r'^Nnwom no Nhwehw'}[LANG]
HDR_MIN = 10.5 if LANG == 'en' else 11.5          # hymn-number header font size
AUTHOR_MAX = 8.0                                  # italic below this = author/composer line

# --- Twi legacy-font decoding (Capecoast font stores special letters as ASCII) ---
TW_MAP = str.maketrans({'4': 'ɔ', '1': 'ɛ', '$': 'Ɔ'})


def fix_tw(text):
    out = []
    for t in text.split(' '):
        if re.match(r'^[\"“‘\'(]?!(?=[A-Za-z])', t):
            t = t.replace('!', 'Ɛ', 1)
        t = re.sub(r'(?<=[A-Za-z])!(?=[A-Za-z])', 'Ɛ', t)      # capital Ɛ inside a word
        if re.search(r'[A-Za-z]', t):
            m = re.match(r'^(\d{1,2}\.)(.*)$', t)           # keep leading verse number
            t = m.group(1) + m.group(2).translate(TW_MAP) if m else t.translate(TW_MAP)
        out.append(t)
    return ' '.join(out)


def clean(text):
    t = text.replace(' ', ' ').strip()
    t = re.sub(r'\s+', ' ', t)
    if LANG == 'tw':
        t = t.replace('å', '').replace('â', '')   # stray glyph artefacts
    return t


def is_page_no(l):
    return re.fullmatch(r'[0-9]{1,3}|[ivxlc]{1,6}', l['text'].strip()) and l['size'] <= 9.5 and \
        (l['top'] < 60 if LANG == 'en' else l['top'] < 176)


ROMAN = r'[IVXL]+'


def centred(l):
    return abs((l['x0'] + l['x1']) / 2 - 297.5) < 14


def tw_theme_line(l):
    """Twi section ('II. ONYANKOPƆN HO NNWOM') / sub-section ('3. Onyame Su ne ne Tebea') titles."""
    if 'Capecoast' not in l['font']:
        return None
    t = clean(fix_tw(l['text']))
    if l['size'] >= 9.9 and re.match(rf'^{ROMAN}\.\s+[^a-z]+$', t):
        return ('section', *re.match(rf'^({ROMAN})\.\s+(.*)$', t).groups())
    if l['size'] < 12.1 and centred(l) and 188 < l['top'] < 199 and len(t) <= 60 and re.match(r'^\d+\.?\s+\S', t):
        return ('sub', *re.match(r'^(\d+)\.?\s+(.*)$', t).groups())
    return None


# ---------------------------------------------------------------- stream -> hymns
hymns, cur, last = [], None, 0
state = dict(section=None, sub=None)
stop = False
allflat = []
for p in pages:
    for l in p['lines']:
        if re.match(END_MARK, l['text']):
            stop = True
        if stop:
            break
        if not is_page_no(l):
            allflat.append(l)
    if stop:
        break


def starts_hymn(l, last_):
    m_ = re.match(r'^(\d+(?:\s\d+){0,2})\.?(?:\s|$)', l['text'].strip())
    if not m_ or not (HDR_MIN <= l['size'] <= 12.5):
        return False
    g = m_.group(1).split()
    return any(last_ < int(''.join(g[:k])) <= last_ + 6 for k in range(1, len(g) + 1))


for idx, l in enumerate(allflat):
    if True:
        txt = l['text'].strip()
        # ---- hymn number header (sequence aware; tolerates "43 1", "3." and bold)
        m = re.match(r'^(\d+(?:\s\d+){0,2})\.?(?:\s+(.*))?$', txt)
        if m and HDR_MIN <= l['size'] <= 12.5:
            groups = m.group(1).split()
            cands = []
            for k in range(1, len(groups) + 1):
                n_ = int(''.join(groups[:k]))
                if last < n_ <= last + 6:
                    cands.append((n_ - last, k, n_))
            if cands:
                _, k, num = min(cands)
                rest = (' '.join(groups[k:]) + ' ' + (m.group(2) or '')).strip()
                cur = dict(number=num, page=l['page'], header=[rest], lines=[], hdr_open=True,
                           theme=state['section'], sub=state['sub'])
                hymns.append(cur)
                last = num
                continue
        # ---- theme titles
        if LANG == 'tw':
            th = tw_theme_line(l)
            if not th and l['font'].endswith('Capecoast') and l['size'] < 12.1 and centred(l) \
                    and re.match(r'^\d+\.\s+\S', l['text']) \
                    and len(l['text']) <= 60 and idx > 0 and ('Italic' in allflat[idx - 1]['font'] or
                                                        (tw_theme_line(allflat[idx - 1]) or ('',))[0] == 'section') \
                    and idx + 1 < len(allflat) and starts_hymn(allflat[idx + 1], last):
                mm = re.match(r'^(\d+)\.\s+(.*)$', clean(fix_tw(l['text'])))
                th = ('sub', mm.group(1), mm.group(2))
            if th:
                if th[0] == 'section':
                    state['section'], state['sub'] = (th[1], th[2]), None
                else:
                    state['sub'] = (th[1], th[2])
                continue
        elif 'Bold' in l['font']:
            continue                                       # English running/inline theme titles (use TOC)
        if cur is None:
            continue
        # ---- wrapped scripture reference belonging to the header
        if cur['hdr_open']:
            if (l['size'] >= HDR_MIN and not re.match(r'^\d{1,2}\.\s', l['text'])) or \
                    (not cur['header'][0] and re.search(r'\bvs\.|\bvs\b', l['text'])):
                cur['header'].append(l['text'].strip())
                continue
            if re.match(r'^[1-3]?\s?[A-Z][a-z]+\.?\s+\d+[\s,:;.]', l['text']) and re.search(r'vs\.|:\d', l['text']) \
                    and not cur['lines']:
                cur['header'].append(l['text'].strip())
                continue
        cur['hdr_open'] = False
        cur['lines'].append(l)


# ---------------------------------------------------------------- stanzas
def build(h):
    items, authors, prev = [], [], None
    for l in h['lines']:
        raw = l['text']
        t = clean(fix_tw(raw) if LANG == 'tw' and 'Italic' not in l['font'] else raw)
        if not t:
            continue
        if 'Italic' in l['font'] and l['size'] <= AUTHOR_MAX:
            authors.append(t)
            continue
        t = t.replace(']', '') if '[' not in t else t
        if t.startswith('[') and items:
            items[-1]['text'] += ' ' + t.strip('[]').strip()
            if t.endswith(']'):
                items[-1]['text'] = items[-1]['text'].rstrip(']')
            prev = l
            continue
        m = re.match(r'^(\d{1,2})\.\s*(\S.*)$', t)
        newcol = prev is None or prev['page'] != l['page'] or prev['tag'] != l['tag']
        gap = None if newcol else l['top'] - prev['top']
        items.append(dict(text=(m.group(2) if m else t).strip(), num=int(m.group(1)) if m else None,
                          top=l['top'], page=l['page'], tag=l['tag'], gap=gap, newcol=newcol))
        prev = l
    gaps = [i['gap'] for i in items if i['gap'] and i['gap'] < 16]
    pitch = statistics.median(gaps) if gaps else 10.0
    stanzas, cur_s = [], None
    for it in items:
        brk = it['gap'] is not None and it['gap'] > pitch * 1.35
        if it['num'] is not None:
            cur_s = dict(kind='verse', verse=it['num'], lines=[it['text']], flags=[])
            stanzas.append(cur_s)
        elif cur_s is None:
            cur_s = dict(kind='verse', verse=1, lines=[it['text']], flags=['verse 1 unnumbered'])
            stanzas.append(cur_s)
        elif brk:
            cur_s = dict(kind='refrain', verse=None, lines=[it['text']], flags=[])
            stanzas.append(cur_s)
        elif it['newcol'] and it['gap'] is None:
            cur_s.setdefault('pending', []).append(it['text'])
        else:
            (cur_s.setdefault('pending', []) if cur_s.get('pending') else cur_s['lines']).append(it['text'])
    vlens = [len(s['lines']) for s in stanzas if s['kind'] == 'verse' and not s.get('pending')]
    typical = statistics.mode(vlens) if vlens else 0
    out = []
    for s in stanzas:
        pend = s.pop('pending', None)
        if pend:
            if len(s['lines']) < typical:
                s['lines'] += pend
            else:
                out.append(s)
                s = dict(kind='refrain', verse=None, lines=pend, flags=['column-top text: refrain or continuation?'])
        out.append(s)
    return out, authors


res = []
for h in hymns:
    st, au = build(h)
    vnums = [s['verse'] for s in st if s['kind'] == 'verse']
    review = []
    if not st:
        review.append('no stanzas')
    if vnums and vnums != list(range(vnums[0], vnums[0] + len(vnums))):
        review.append(f'verse numbering {vnums}')
    for s in st:
        review += [f for f in s['flags'] if f != 'verse 1 unnumbered' or LANG == 'en']
    header = clean(' '.join(x for x in h['header'] if x))
    theme = None
    res.append(dict(number=h['number'], page=h['page'], header=header, authors=au,
                    twi_section=h['theme'], twi_sub=h['sub'],
                    stanzas=[dict(kind=s['kind'], verse=s['verse'], lines=s['lines']) for s in st],
                    review=sorted(set(review))))

json.dump(dict(hymns=res), open(DST, 'w'), ensure_ascii=False, indent=0)
print(LANG, 'hymns parsed:', len(res), 'with review flags:', sum(1 for r in res if r['review']))
nums = {r['number'] for r in res}
print('missing numbers:', [n for n in range(1, 851) if n not in nums])
