"""Give each line of a Tamil src/texts/<id>.js file its Latin-script form ("lat"), from prapatti.com's
romanised ("english") edition of the same work, for the app's script setting.

The romanised PDFs print the same verses, but don't always break lines (or place ⋆) where the Tamil
edition does, so the romanised text is read as one stream of words and each Tamil line is found in
it, in order: the run of words that sounds most like it. Both are reduced to a rough skeleton
(k/g, c/j/ś, t/d, p/b … counted as one) and compared. Lines that match poorly are listed.

  python tools/add_latin_tamil.py src/texts/tiruppavai.js tiruppaavai_en.pdf
  # taniyans from another PDF come first, as in the Tamil text:
  python tools/add_latin_tamil.py src/texts/tirupallandu.js naalaayirattaniyangal_vad_en.pdf periyaazvaartirumozi_en.pdf

(https://www.prapatti.com/slokas/english/… — the same path as the Tamil PDF, with english for tamil)
"""
import difflib, json, re, sys, unicodedata
from collections import Counter
import pymupdf
from indic_transliteration import sanscript

LINE = re.compile(r'^(\s*)(\{"v".*\}),\s*$')
END = re.compile(r'(ÁÁ|॥).*?(ÁÁ|॥)\s*$|ÁÁ\s*$|॥\s*$')

def pdf_lines(path):
    # read glyph by glyph: the PDF often leaves only a gap between words, which plain text
    # extraction drops ("idamidaṃbhūya")
    out = []
    for page in pymupdf.open(path):
        for b in page.get_text('rawdict')['blocks']:
            for l in b.get('lines', []):
                t, prev = '', None
                for c in (c for sp in l['spans'] for c in sp['chars']):
                    if prev is not None and c['c'] != ' ' and not t.endswith(' ') \
                            and c['bbox'][0] - prev['bbox'][2] > 1.5 and not unicodedata.combining(c['c']):
                        t += ' '
                    t += c['c']
                    if not unicodedata.combining(c['c']):
                        prev = c
                t = unicodedata.normalize('NFC', re.sub(r'\s+', ' ', t)).strip()
                if t:
                    out.append(t)
    return out

def words(lines, drop_repeated=True):
    """The romanised text as one stream of words, in reading order, without page furniture, verse
    numbers or the ⋆ ‡ marks. Each word remembers the line break after it is irrelevant: the Tamil
    lines decide where lines end."""
    # page headings: lines printed on (nearly) every page. A caller whose text has refrains printed on a
    # line of their own (Sudarśanāṣṭakam's ஜய ஜய ஶ்ரீஸுத₃ர்ஶந) drops its headings itself instead.
    common = {l for l, n in Counter(lines).items() if n >= 3 and 'Á' not in l and '⋆' not in l} if drop_repeated else set()
    junk = re.compile(r'^(\d+|www\.prapatti\.com|Sunder Kidāmbi|This document has been prepared by|with the blessings of|'
                      r'His Holiness .*|.*\. \. \. .*)$')
    out = []
    for l in lines:
        if l in common or junk.match(l):
            continue
        l = re.sub(r'ÁÁ.*?ÁÁ|ÁÁ|Á', ' ', l)
        l = re.sub(r'[‡⋆]', ' ', l)
        for w in l.split():
            # punctuation printed on its own ("pāvāy !") stays with the word before it
            if out and not re.search(r'\w', w):
                out[-1] += ' ' + w
            else:
                out.append(w)
    return out

FOLD = str.maketrans({'g': 'k', 'j': 's', 'c': 's', 'ś': 's', 'ṣ': 's', 'ḍ': 't', 'ṭ': 't', 'd': 't', 'b': 'p',
                      'ḻ': 'l', 'ḷ': 'l', 'z': 'l', 'ṟ': 'r', 'ṛ': 'r', 'ṉ': 'n', 'ṇ': 'n', 'ñ': 'n', 'ṅ': 'n',
                      'ṃ': 'm', 'ṁ': 'm', 'h': None, 'ē': 'e', 'ō': 'o', 'ā': 'a', 'ī': 'i', 'ū': 'u', 'ḥ': None,
                      'y': None, 'v': None, 'w': None})

def skeleton(t):
    t = unicodedata.normalize('NFD', t.lower())
    t = ''.join(c for c in t if not unicodedata.combining(c) or c in '̱')
    t = unicodedata.normalize('NFC', t).translate(FOLD)
    return re.sub(r'[^a-z]', '', t)

def tamil_skeleton(t):
    t = re.sub(r'[₁₂₃₄]', '', t)
    return skeleton(sanscript.transliterate(t, sanscript.TAMIL, sanscript.ISO))

def sim(a, b):
    return difflib.SequenceMatcher(None, a, b, autojunk=False).ratio()

def main(target, pdfs):
    ws = [w for p in pdfs for w in words(pdf_lines(p))]
    wk = [skeleton(w) for w in ws]
    raw = open(target, encoding='utf-8').read().split('\n')
    objs = [(k, LINE.match(r)) for k, r in enumerate(raw)]
    objs = [(k, m, json.loads(m.group(2))) for k, m in objs if m]

    def span(a, n):
        return ''.join(wk[a:a + n])

    ptr, weak, spans = 0, [], []
    for k, m, o in objs:
        ts = tamil_skeleton(o['text'])
        nw = len(o['text'].split())
        lengths = range(max(1, nw - 3), nw + 4)
        best, ba, bn = 0, None, None
        # the line usually starts at the next word (or a few later, past a heading)
        for a in range(ptr, min(len(ws), ptr + 30)):
            for n in lengths:
                r = sim(ts, span(a, n))
                if r > best: best, ba, bn = r, a, n
            if best >= 0.92: break
        if best < 0.7:
            # the start of a decade (or the work's own taniyans) further on in the PDF
            for a in range(ptr, len(ws)):
                r = sim(ts, span(a, nw))
                if r > best + 0.15 or (r > best and ba is not None and ba >= ptr + 30):
                    best, ba, bn = r, a, nw
            if ba is not None and ba >= ptr + 30:
                for n in lengths:
                    r = sim(ts, span(ba, n))
                    if r > best: best, bn = r, n
        if ba is not None:
            # don't take in a neighbouring word (a heading's "namaḥ") that doesn't make the match better
            while bn > 1 and sim(ts, span(ba + 1, bn - 1)) >= best - 0.01:
                ba, bn = ba + 1, bn - 1; best = max(best, sim(ts, span(ba, bn)))
            while bn > 1 and sim(ts, span(ba, bn - 1)) >= best - 0.01:
                bn -= 1; best = max(best, sim(ts, span(ba, bn)))
        if ba is None or best < 0.6:
            weak.append((round(best, 2), o['text'], ' '.join(ws[ba:ba + bn]) if ba is not None else None)); continue
        if best < 0.8:
            weak.append((round(best, 2), o['text'], ' '.join(ws[ba:ba + bn])))
        spans.append([k, m, o, ts, ba, bn]); ptr = ba + bn
    # second pass: where two lines meet, move the break a word or two either way if that suits both
    # lines better (a word at the edge can sound about as much like either line)
    for _ in range(2):
        for x, y in zip(spans, spans[1:]):
            if x[4] + x[5] != y[4]:
                continue
            cut0, end = y[4], y[4] + y[5]
            best = (sim(x[3], span(x[4], cut0 - x[4])) + sim(y[3], span(cut0, end - cut0)), cut0)
            for cut in range(max(x[4] + 1, cut0 - 2), min(end - 1, cut0 + 2) + 1):
                r = sim(x[3], span(x[4], cut - x[4])) + sim(y[3], span(cut, end - cut))
                if r > best[0] + 0.02: best = (r, cut)
            cut = best[1]
            x[5] = cut - x[4]; y[4], y[5] = cut, end - cut
    for x, y in zip(spans, spans[1:]):
        gap = ws[x[4] + x[5]:y[4]]
        if gap and x[2]['v'] == y[2]['v'] and len(gap) < 6:
            weak.append(('gap', ' '.join(gap), 'between ' + x[2]['text'] + ' / ' + y[2]['text']))
    for k, m, o, ts, ba, bn in spans:
        o['lat'] = ' '.join(ws[ba:ba + bn])
        raw[k] = m.group(1) + json.dumps(o, ensure_ascii=False) + ','
    open(target, 'w', encoding='utf-8').write('\n'.join(raw))
    n = sum(1 for _, _, o in objs if 'lat' in o)
    print(f'{target}: {n}/{len(objs)} lines given Latin', file=sys.stderr)
    for r, t, s_ in weak:
        print(f'  {r}  {t}  →  {s_}', file=sys.stderr)   # a 'gap': words left between two lines of a verse

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2:])
