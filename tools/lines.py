"""Stage 1: PDF -> text lines in reading order, cached as JSON.

Pages mix full-width lines (headers, single-column hymns) with two-column
bands. A row is "two-column" if the gap between its left-side and right-side
characters is >= GUTTER pt around the page centre; consecutive two-column rows
form a band that is read left column first, then right column.
"""
import sys, json, pdfplumber

GUTTER = 5.5


def dedupe(chars):
    """Drop faux-bold duplicates: same glyph redrawn a hair away on the same baseline."""
    seen, out = {}, []
    for c in sorted(chars, key=lambda c: (c['x0'], c['top'])):
        lst = seen.setdefault(c['text'], [])
        if c['text'].strip() and any(abs(c['x0'] - x) < 0.1 * c['size'] and abs(c['top'] - t) < 1.2 for x, t in lst[-40:]):
            continue
        lst.append((c['x0'], c['top']))
        out.append(c)
    return out


def mkline(rc, tag, page_no):
    rc = sorted(rc, key=lambda c: c['x0'])
    txt, prev, space = '', None, False
    for c in rc:
        if not c['text'].strip():
            space = True
            continue
        thr = 0.275 if 'Capecoast' in c['fontname'] else 0.22
        gap = (c['x0'] - prev['x1']) / c['size'] if prev is not None else 0
        # kerning after a capital ("H alleluya", "K risto") is not a word space
        cap_kern = (prev is not None and 'Capecoast' in c['fontname'] and prev['text'].isupper()
                    and c['text'].islower() and gap < 0.45 and not space)
        if prev is not None and not cap_kern and (space or gap > thr):
            txt += ' '
        txt += c['text']
        prev, space = c, False
    ink = [c for c in rc if c['text'].strip()]
    fonts = {}
    for c in ink:
        f = c['fontname'].split('+')[-1]
        fonts[f] = fonts.get(f, 0) + 1
    return dict(page=page_no, tag=tag, top=round(min(c['top'] for c in ink), 1), x0=round(ink[0]['x0'], 1),
                x1=round(ink[-1]['x1'], 1), size=round(ink[0]['size'], 1),
                font=max(fonts, key=fonts.get), text=txt)


def page_flow(pg, page_no):
    chars = dedupe(list(pg.chars))
    if not any(c['text'].strip() for c in chars):
        return []
    cx = pg.width / 2
    chars.sort(key=lambda c: c['top'])
    rows = []
    for c in chars:
        if rows and abs(rows[-1][0] - c['top']) < 3.5:
            rows[-1][1].append(c)
        else:
            rows.append([c['top'], [c]])
    out, bandL, bandR = [], [], []

    def flush():
        nonlocal bandL, bandR
        if len(bandL) <= 1 or len(bandR) <= 1:      # not really two columns: one wide, oddly spaced line each
            rows_ = sorted(bandL + bandR, key=lambda rc: min(c['top'] for c in rc))
            merged = []
            for rc in rows_:
                t = min(c['top'] for c in rc)
                if merged and abs(merged[-1][0] - t) < 3.5:
                    merged[-1][1].extend(rc)
                else:
                    merged.append([t, list(rc)])
            for t, rc in merged:
                out.append(mkline(rc, 'F', page_no))
            bandL, bandR = [], []
            return
        for rc in bandL:
            out.append(mkline(rc, 'L', page_no))
        for rc in bandR:
            out.append(mkline(rc, 'R', page_no))
        bandL, bandR = [], []

    # pass 1: per band (rows between big header rows) find where the right-hand column starts,
    # from verse numbers ("3.") that sit part-way along a row
    band_of, bid = [], 0
    for top, rc in rows:
        ink = [c for c in rc if c['text'].strip()]
        if ink and ink[0]['size'] >= 10.5 and 'Italic' not in ink[0]['fontname']:
            bid += 1
        band_of.append(bid)
    votes = {}
    for (top, rc), b_ in zip(rows, band_of):
        rc.sort(key=lambda c: c['x0'])
        ink = [c for c in rc if c['text'].strip()]
        if not ink or ink[0]['size'] >= 10.5:
            continue
        for i, c in enumerate(ink):
            if c['text'].isdigit() and i >= 5 and c['x0'] > cx - 50 and c['x0'] - ink[i - 1]['x1'] >= 1.5 and \
                    (i + 1 < len(ink) and (ink[i + 1]['text'] == '.' or ink[i + 1]['text'].isdigit())) and \
                    not ink[i - 1]['text'].isdigit():
                # must be a verse-number token: digits followed by '.'
                j = i
                while j + 1 < len(ink) and ink[j + 1]['text'].isdigit():
                    j += 1
                if j + 1 < len(ink) and ink[j + 1]['text'] == '.' and ink[j]['x1'] - ink[i]['x0'] < 12:
                    d = votes.setdefault(b_, {})
                    k = round(c['x0'])
                    d[k] = d.get(k, 0) + 1
                break
    band_split = {b_: max(d.items(), key=lambda kv: kv[1])[0] for b_, d in votes.items()}
    band_l0 = {}
    for (top, rc), b_ in zip(rows, band_of):
        ink = sorted((c for c in rc if c['text'].strip()), key=lambda c: c['x0'])
        if ink and ink[0]['size'] < 10.5 and 'Italic' not in ink[0]['fontname'] and ink[0]['text'] not in '[':
            band_l0[b_] = min(band_l0.get(b_, 1e9), ink[0]['x0'])

    for (top, rc), b_ in zip(rows, band_of):
        rc.sort(key=lambda c: c['x0'])
        ink = [c for c in rc if c['text'].strip()]
        if not ink:
            continue
        big = ink[0]['size'] >= 10.5 and 'Italic' not in ink[0]['fontname']
        if big:
            flush()
            out.append(mkline(rc, 'F', page_no))
            continue
        sx = band_split.get(b_)
        first = ink[0]
        txt_ = ''.join(c['text'] for c in ink)
        if sx is not None and first['x0'] > band_l0.get(b_, 0) + 25 and not (sx - 5.5 <= first['x0'] <= sx + 20) \
                and len(txt_) >= 10 and not txt_.startswith('[') and not txt_.endswith(']') \
                and 'Italic' not in first['fontname']:
            flush()                                   # centred title spanning both columns
            out.append(mkline(rc, 'F', page_no))
            continue
        if sx is not None:
            left = [c for c in rc if c['x0'] < sx - 5.5]
            right = [c for c in rc if c['x0'] >= sx - 5.5]
            link = [c for c in left if c['text'].strip()]
            rink = [c for c in right if c['text'].strip()]
        else:
            left = [c for c in rc if (c['x0'] + c['x1']) / 2 < cx]
            right = [c for c in rc if (c['x0'] + c['x1']) / 2 >= cx]
            link = [c for c in left if c['text'].strip()]
            rink = [c for c in right if c['text'].strip()]
            if link and rink and rink[0]['x0'] - link[-1]['x1'] < GUTTER:
                flush()
                out.append(mkline(rc, 'F', page_no))
                continue
        if link:
            bandL.append(left)
        if rink:
            bandR.append(right)
    flush()
    return out


if __name__ == '__main__':
    pdf_path, out = sys.argv[1], sys.argv[2]
    pdf = pdfplumber.open(pdf_path)
    data = []
    for i, pg in enumerate(pdf.pages):
        data.append(dict(page=i + 1, lines=page_flow(pg, i + 1)))
    json.dump(data, open(out, 'w'))
