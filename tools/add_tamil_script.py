"""Give each line of a Dēśika stōtra (src/texts/<id>.js) its Tamil-script form ("tam"), from prapatti.com's
Tamil edition of the same stōtra (Sanskrit in Tamil letters, with ₂ ₃ ₄ for the aspirated and voiced
consonants), for the app's "Dēśika stōtras in Tamil script" setting.

  python tools/extract_pdf.py sriistuti_tamil.pdf > sriistuti_tamil.txt
  python tools/add_tamil_script.py src/texts/sristuti.js sriistuti_tamil.txt
  (https://www.prapatti.com/slokas/tamil/desika-stotramaala/sriistuti.pdf)

The Tamil edition breaks lines in its own places, so — as tools/add_latin_tamil.py does — its text is
read as one stream of words and each Devanagari line is found in it by sound. The line's own closing
daṇḍa is kept. Three ligatures the PDF's font encodes oddly are repaired here: Ȍ (ஷு's ு), Ȇ (க்ஷீ) and
ǈ (க்ஷ, with or without a following pulli: whichever matches the Devanagari).
"""
import difflib, importlib.util, json, os, re, sys, unicodedata
from indic_transliteration import sanscript

spec = importlib.util.spec_from_file_location('alt', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'add_latin_tamil.py'))
alt = importlib.util.module_from_spec(spec); spec.loader.exec_module(alt)

LINE = re.compile(r'^(\s*)(\{"v".*\}),\s*$')

def text_lines(path):
    src = open(path, encoding='utf-8').read().split('\n')
    # the stōtra's name, printed as its heading (॥ ॥ ஶ்ரீஸ்துதி: ॥ ॥) and at the top of every page
    title = next((m.group(1).strip() for m in (re.match(r'^॥\s*॥\s*(.+?)\s*॥\s*॥$', l.strip()) for l in src) if m), None)
    out = []
    for l in src:
        if title and l.strip() in (title, f'॥ ॥ {title} ॥ ॥'):
            continue
        l = l.replace('Ȍ', 'ு').replace('Ȇ', 'க்ஷீ')
        l = re.sub(r'॥\s*॥\s*[\d.]*\s*॥\s*॥|॥|।', ' Á ', l)   # verse ends, as add_latin_tamil.words() expects
        l = unicodedata.normalize('NFC', re.sub(r'\s+', ' ', l)).strip()
        if l:
            out.append(l)
    return out

def iso_dev(t):
    return sanscript.transliterate(re.sub(r'[।॥|]', ' ', t), sanscript.DEVANAGARI, sanscript.ISO)

def iso_tam(t):
    return sanscript.transliterate(re.sub(r'[₁₂₃₄’]', '', t), sanscript.TAMIL, sanscript.ISO)

ASPIRATE = {'': '₂', '₁': '₂', '₃': '₄'}
def rejoin(tam):
    """The Tamil edition breaks a long word at the end of a printed line with " - " ("மிஷதா - மந்தரங்கை₃"):
    join it up again. Its typesetting sometimes splits an aspirate there — प्रधावन् as "ப்ரத்₃ - ஹாவந்" (d | h)
    — so a break into ஹ is written back as the aspirated letter (ப்ரதா₄வந்). A "-" ending the line itself is a
    compound running on into the next line, as in the Devanagari, and stays."""
    def join(m):
        left, right = m.group(1), m.group(2)
        k = re.match(r'^(.*?)([க-ஹ])்([₁₂₃₄]?)$', left)
        h = re.match(r'^ஹ([ா-ௌ]?)(்?)(.*)$', right)
        if k and h and k.group(3) in ASPIRATE:
            return k.group(1) + k.group(2) + h.group(1) + h.group(2) + ASPIRATE[k.group(3)] + h.group(3)
        return left + right
    tam = re.sub(r'(\S+) - (\S+)', join, tam)
    return re.sub(r'\s+-$', '-', tam)

def settle_ksha(tam, dev):
    """ǈ is க்ஷ; the PDF doesn't say whether a pulli follows. Choose, ǈ by ǈ, what sounds like the Devanagari."""
    target = re.sub(r'\s', '', iso_dev(dev)).replace('h', '')
    while 'ǈ' in tam:
        a, b = tam.replace('ǈ', 'க்ஷ', 1), tam.replace('ǈ', 'க்ஷ்', 1)
        ra = difflib.SequenceMatcher(None, re.sub(r'\s', '', iso_tam(a)), target, autojunk=False).ratio()
        rb = difflib.SequenceMatcher(None, re.sub(r'\s', '', iso_tam(b)), target, autojunk=False).ratio()
        tam = a if ra >= rb else b
    return tam

def main(target, txt):
    ws = alt.words(text_lines(txt), drop_repeated=False)
    wk = [alt.skeleton(iso_tam(w.replace('ǈ', 'க்ஷ'))) for w in ws]
    raw = open(target, encoding='utf-8').read().split('\n')
    objs = [(k, LINE.match(r)) for k, r in enumerate(raw)]
    objs = [(k, m, json.loads(m.group(2))) for k, m in objs if m]
    span = lambda a, n: ''.join(wk[a:a + n])
    ptr, weak, spans = 0, [], []
    for k, m, o in objs:
        ts = alt.skeleton(iso_dev(o['text']))
        nw = len(o['text'].split())
        lengths = range(max(1, nw - 3), nw + 4)
        best, ba, bn = 0, None, None
        for a in range(ptr, min(len(ws), ptr + 30)):
            for n in lengths:
                r = alt.sim(ts, span(a, n))
                if r > best: best, ba, bn = r, a, n
            if best >= 0.92: break
        if best < 0.7:
            for a in range(ptr, len(ws)):
                r = alt.sim(ts, span(a, nw))
                if r > best + 0.15: best, ba, bn = r, a, nw
        if ba is not None:
            # drop a word at either edge only if the line then matches better (on a long daṇḍaka line a
            # short word like ஜய hardly moves the score, so "about as good" isn't enough)
            while bn > 1 and alt.sim(ts, span(ba + 1, bn - 1)) > best:
                ba, bn = ba + 1, bn - 1; best = alt.sim(ts, span(ba, bn))
            while bn > 1 and alt.sim(ts, span(ba, bn - 1)) > best:
                bn -= 1; best = alt.sim(ts, span(ba, bn))
        if ba is None or best < 0.6:
            weak.append((round(best, 2), o['text'], ' '.join(ws[ba:ba + bn]) if ba is not None else None)); continue
        if best < 0.8:
            weak.append((round(best, 2), o['text'], ' '.join(ws[ba:ba + bn])))
        spans.append([k, m, o, ts, ba, bn]); ptr = ba + bn
    for _ in range(2):   # settle each break between neighbouring lines
        for x, y in zip(spans, spans[1:]):
            if x[4] + x[5] != y[4]:
                continue
            cut0, end = y[4], y[4] + y[5]
            best = (alt.sim(x[3], span(x[4], cut0 - x[4])) + alt.sim(y[3], span(cut0, end - cut0)), cut0)
            for cut in range(max(x[4] + 1, cut0 - 2), min(end - 1, cut0 + 2) + 1):
                r = alt.sim(x[3], span(x[4], cut - x[4])) + alt.sim(y[3], span(cut, end - cut))
                if r > best[0] + 0.02: best = (r, cut)
            x[5] = best[1] - x[4]; y[4], y[5] = best[1], end - best[1]
    for x, y in zip(spans, spans[1:]):
        gap = ws[x[4] + x[5]:y[4]]
        if gap and x[2]['v'] == y[2]['v'] and len(gap) < 6:
            weak.append(('gap', ' '.join(gap), 'between ' + x[2]['text'] + ' / ' + y[2]['text']))
    for k, m, o, ts, ba, bn in spans:
        tam = settle_ksha(rejoin(' '.join(ws[ba:ba + bn])), o['text'])
        tam = re.sub(r'\s*[|।॥]+\s*$', '', tam).strip()
        end = re.search(r'\s*([।॥\s]*)$', o['text']).group(1).split()   # the line's own closing daṇḍa
        o['tam'] = tam + (' ' + ' '.join(end) if end else '')
        raw[k] = m.group(1) + json.dumps(o, ensure_ascii=False) + ','
    open(target, 'w', encoding='utf-8').write('\n'.join(raw))
    print(f'{target}: {len(spans)}/{len(objs)} lines given Tamil script', file=sys.stderr)
    for r, t, s_ in weak:
        print(f'  {r}  {t}  →  {s_}', file=sys.stderr)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
