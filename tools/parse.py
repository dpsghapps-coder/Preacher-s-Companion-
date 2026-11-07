"""Stage 2: ordered text lines -> structured hymns (JSON).

usage: parse.py en|tw build/<lang>_lines.json build/<lang>_hymns.json
"""
import sys, re, json, statistics

LANG, SRC, DST = sys.argv[1], sys.argv[2], sys.argv[3]
pages = json.load(open(SRC))

END_MARK = {'en': r'(?i)^index to the hymns', 'tw': r'^Nnwom no Nhwehw'}[LANG]
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
    if l['size'] >= 11.5 and l['top'] < 200 and re.match(r'^[^a-z0-9.]{4,}$', t) and centred(l):
        return ('sectioncont', '', t)                     # second line of a two-line section title
    if l['size'] >= 9.9 and re.match(rf'^{ROMAN}\.\s+[^a-z]+$', t):
        return ('section', *re.match(rf'^({ROMAN})\.\s+(.*)$', t).groups())
    if l['size'] < 12.1 and centred(l) and 188 < l['top'] < 207 and len(t) <= 60 and re.match(r'^\d+\.?\s+\S', t):
        return ('sub', *re.match(r'^(\d+)\.?\s+(.*)$', t).groups())
    return None


# ---------------------------------------------------------------- stream -> hymns
hymns, cur, last = [], None, 0
state = dict(section=None, sub=None)
stop = False
allflat = []
for p in pages:
    for l in p['lines']:
        if p['page'] > 400 and re.match(END_MARK, l['text'].strip()):
            stop = True
        if stop:
            break
        if not is_page_no(l):
            allflat.append(l)
    if stop:
        break


def _norm(t):
    return re.sub(r'[^a-zɔɛ]', '', t.lower())


KNOWN_SUBS = set()
if LANG == 'tw':
    for _l in allflat:
        _th = tw_theme_line(_l)
        if _th and _th[0] == 'sub':
            KNOWN_SUBS.add(_norm(_th[2]))


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
                    and len(l['text']) <= 45 and l['tag'] == 'F' \
                    and idx + 1 < len(allflat) and starts_hymn(allflat[idx + 1], last):
                mm = re.match(r'^(\d+)\.\s+(.*)$', clean(fix_tw(l['text'])))
                th = ('sub', mm.group(1), mm.group(2))
            if not th and l['font'].endswith('Capecoast') or not th and 'Times' in l['font']:
                mm = re.match(r'^(\d+)\.?\s+(.*)$', clean(fix_tw(l['text'])))
                if mm and len(l['text']) <= 60 and _norm(mm.group(2)) in KNOWN_SUBS and l['size'] < 12.1 \
                        and _norm(mm.group(2)):
                    th = ('sub', mm.group(1), mm.group(2))
            if th:
                if th[0] == 'sectioncont':
                    if state['section']:
                        state['section'] = (state['section'][0], state['section'][1].split(' – ')[0] + ' – ' + th[2])
                    continue
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
        if cur['hdr_open'] and not cur['lines'] and LANG == 'tw' and len(l['text']) <= 40 and l['size'] < HDR_MIN and \
                re.match(r'^[1-3I]?\s?[A-Z][a-z]+\.?\s*\d+[\d:;,.\- ]*$', l['text'].strip()):
            cur['header'].append(l['text'].strip())      # scripture reference printed below the number line
            continue
        cur['hdr_open'] = False
        mv = re.match(rf"^{cur['number']}\s*([A-Za-z])\b", l['text'].strip())
        if mv and l['size'] >= HDR_MIN:
            cur['variant'] = mv.group(1).upper()
            continue
        l = dict(l, variant=cur.get('variant'))
        cur['lines'].append(l)


# ---------------------------------------------------------------- stanzas
def build(h):
    items, authors, prev, pending_num = [], [], None, None
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
        if re.fullmatch(r'\d{1,2}\.', t):
            pending_num = int(t[:-1])
            continue
        m = re.match(r'^(\d{1,2})\.\s*(\S.*)$', t)
        if m is None and not pending_num:
            mm_ = re.match(r'^(\d{1,2})\s+([A-Z“‘].*)$', t)
            prev_v = max([i['num'] for i in items if i['num']] or [0])
            if mm_ and int(mm_.group(1)) == prev_v + 1:
                m = mm_
        if m is None and pending_num is not None:
            m = re.match(r'^()(.*)$', t)
        newcol = prev is None or prev['page'] != l['page'] or prev['tag'] != l['tag']
        gap = None if newcol else l['top'] - prev['top']
        num_ = int(m.group(1)) if (m and m.group(1)) else pending_num
        pending_num = None
        items.append(dict(variant=l.get('variant'), text=(m.group(2) if m else t).strip(), num=num_,
                          top=l['top'], page=l['page'], tag=l['tag'], gap=gap, newcol=newcol))
        prev = l
    gaps = [i['gap'] for i in items if i['gap'] and i['gap'] < 16]
    pitch = statistics.median(gaps) if gaps else 10.0
    stanzas, cur_s = [], None
    for it in items:
        brk = it['gap'] is not None and it['gap'] > pitch * 1.35
        if it['num'] is not None:
            cur_s = dict(kind='verse', verse=it['num'], lines=[it['text']], flags=[], variant=it['variant'])
            stanzas.append(cur_s)
        elif cur_s is None:
            cur_s = dict(kind='verse', verse=1, lines=[it['text']], flags=[], variant=it['variant'])
            stanzas.append(cur_s)
        elif brk:
            cur_s = dict(kind='refrain', verse=None, lines=[it['text']], flags=[], variant=it['variant'])
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
                s = dict(kind='refrain', verse=None, lines=pend, flags=['note: column-top text treated as refrain'], variant=s.get('variant'))
        out.append(s)
    return out, authors


def postprocess(st):
    notes = []
    # a bare "Refrain"/"Chorus" label line: text after it is the refrain, a trailing label just means "sing the refrain"
    # Twi "Nnyeso:" = refrain label (also printed "Nyeso:" / "N nyeso:"): lines from it to the end of the block are the refrain
    NN = re.compile(r'(?i)^n\s?n?yeso\s*:\s*')
    pre = []
    for x in st:
        idx = next((i for i, t in enumerate(x['lines']) if NN.match(t.strip())), None)
        if idx is None:
            pre.append(x)
            continue
        head, tail = x['lines'][:idx], x['lines'][idx:]
        tail[0] = NN.sub('', tail[0].strip())
        if head:
            pre.append(dict(x, lines=head))
            pre.append(dict(x, kind='refrain', verse=None, lines=[t for t in tail if t], flags=[]))
        else:
            pre.append(dict(x, kind='refrain', verse=None, lines=[t for t in tail if t]))
    st = pre
    out_ = []
    for x in st:
        idx = next((i for i, t in enumerate(x['lines']) if re.fullmatch(r'(?i)(refrain|chorus)\.?:?', t.strip())), None)
        if idx is None:
            out_.append(x)
        elif idx == len(x['lines']) - 1:
            x['lines'] = x['lines'][:-1] or x['lines']
            out_.append(x)
        else:
            head, tail = x['lines'][:idx], x['lines'][idx + 1:]
            out_.append(dict(x, lines=head))
            out_.append(dict(x, kind='refrain', verse=None, lines=tail, flags=[]))
    st = out_
    vl_ = [len(x['lines']) for x in st if x['kind'] == 'verse']
    # verse 1 much longer than the others: the refrain printed straight after it
    if len(vl_) >= 3:
        rest = vl_[1:]
        if len(set(rest)) == 1 and vl_[0] >= rest[0] + 2 and st[0]['kind'] == 'verse' and \
                not any(x['kind'] == 'refrain' for x in st[:3]):
            t = rest[0]
            first = st[0]
            st = [dict(first, lines=first['lines'][:t]),
                  dict(first, kind='refrain', verse=None, lines=first['lines'][t:], flags=[])] + st[1:]
            notes.append('note: refrain split off verse 1 by length')
    # two verses fused because the second number was not printed/seen
    vs_ = [x for x in st if x['kind'] == 'verse']
    if len(vs_) >= 2:
        _l = [len(x['lines']) for x in vs_]
        typ_ = min(_l) if len(set(_l)) == len(_l) else statistics.mode(_l)
        new, prevn = [], 0
        for i, x in enumerate(st):
            if x['kind'] == 'verse':
                nxt = next((y['verse'] for y in st[i + 1:] if y['kind'] == 'verse'), None)
                k = len(x['lines']) // typ_ if typ_ else 1
                if k >= 2 and len(x['lines']) % typ_ == 0 and nxt is not None and nxt - x['verse'] == k:
                    for j in range(k):
                        new.append(dict(x, verse=x['verse'] + j, lines=x['lines'][j * typ_:(j + 1) * typ_]))
                    notes.append(f"note: split fused verses {x['verse']}-{x['verse'] + k - 1}")
                    continue
            new.append(x)
        st = new
    for x in st:
        if x['lines'] and re.match(r'(?i)^(refrain|chorus|response)\s*:', x['lines'][0]):
            x['lines'][0] = re.sub(r'(?i)^(refrain|chorus|response)\s*:\s*', '', x['lines'][0])
            x['kind'], x['verse'] = 'refrain', None
    if any(x.get('variant') for x in st):
        for x in st:
            x['variant'] = x.get('variant') or 'A'
    # two-column interleaving: verses come out as a permutation of 1..n -> restore order (refrains stay with their verse)
    verses = [x for x in st if x['kind'] == 'verse']
    typ = statistics.mode([len(x['lines']) for x in verses]) if verses else 0
    if typ >= 3:
        keep, seen, prevn = [], set(), 0
        for x in st:
            if x['kind'] == 'verse' and len(x['lines']) == 1 and x['verse'] in seen:
                notes.append(f"note: dropped one-line numbered heading '{x['lines'][0][:40]}'")
                continue
            if x['kind'] == 'verse':
                seen.add(x['verse'])
                prevn = x['verse']
            keep.append(x)
        st = keep
    groups, curg = [], None
    for x in st:
        if x['kind'] == 'verse':
            curg = [x]
            groups.append(curg)
        elif curg is not None:
            curg.append(x)
        else:
            groups.append([x])
    vs = [g[0]['verse'] for g in groups if g[0]['kind'] == 'verse']
    lens = [len(g[0]['lines']) for g in groups if g[0]['kind'] == 'verse']
    if vs and not any(x.get('variant') for x in st) and vs != sorted(vs) and sorted(vs) == list(range(1, len(vs) + 1)):
        if True:
            groups.sort(key=lambda g: g[0]['verse'] if g[0]['kind'] == 'verse' else 0)
            st = [x for g in groups for x in g]
            notes.append('note: verse order restored from two-column layout')
    return st, notes


res = []
for h in hymns:
    st, au = build(h)
    st, extra = postprocess(st)
    vnums = [s['verse'] for s in st if s['kind'] == 'verse']
    review = list(extra)
    if not st:
        review.append('no stanzas')
    variants = sorted({x.get('variant') for x in st if x.get('variant')})
    if variants:
        review.append('note: hymn printed in versions ' + '/'.join(variants))
        for v_ in variants:
            vn = [x['verse'] for x in st if x['kind'] == 'verse' and x.get('variant') == v_]
            if vn != list(range(vn[0], vn[0] + len(vn))):
                review.append(f'verse numbering {v_} {vn}')
    elif vnums and vnums != list(range(vnums[0], vnums[0] + len(vnums))):
        review.append(f'verse numbering {vnums}')
    vl = [len(x['lines']) for x in st if x['kind'] == 'verse']
    if len(vl) >= 3 and not variants:
        md = statistics.mode(vl)
        odd = [i + 1 for i, n in enumerate(vl) if md >= 4 and (n < 0.6 * md or n > 1.6 * md)]
        if odd:
            review.append(f'verse lengths uneven (verses {odd} vs typical {md} lines)')
    for s in st:
        review += [f for f in s['flags'] if f != 'verse 1 unnumbered' or LANG == 'en']
    header = clean(' '.join(x for x in h['header'] if x))
    theme = None
    res.append(dict(number=h['number'], page=h['page'], header=header, authors=au,
                    twi_section=h['theme'], twi_sub=h['sub'],
                    stanzas=[dict(kind=s['kind'], verse=s['verse'], lines=s['lines'], variant=s.get('variant')) for s in st],
                    review=sorted(set(review))))

json.dump(dict(hymns=res), open(DST, 'w'), ensure_ascii=False, indent=0)
print(LANG, 'hymns parsed:', len(res), 'with review flags:', sum(1 for r in res if r['review']))
nums = {r['number'] for r in res}
print('missing numbers:', [n for n in range(1, 851) if n not in nums])
