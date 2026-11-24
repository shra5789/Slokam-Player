"""Build src/texts/<id>.js for a Vēdic sūktam from prapatti.com's romanised PDF, keeping the svaras.

prapatti.com's Devanagari PDFs use a broken font encoding, so the romanised (ISO 15919) edition is
read and converted to Devanagari with `indic-transliteration`
(pip install indic-transliteration pymupdf). That edition carries the Taittirīya svara marks:
anudātta ॒ and svarita ॑ as Unicode characters, and the dīrgha svarita ᳚ as the private-use
character U+F203. All three are kept on the syllable they follow. Other Vēdic spellings:
  ġ  → ग्ं   (the Taittirīya "gum", as prapatti.com's Devanagari edition writes it)
  ŗ ņ → र् न्  (a consonant that carries its own svara mark)

Text printed in red (alternate readings) is left out. Vēdam is chanted straight through:
nothing is repeated.

Usage: python tools/build_vedam.py purushasuuktam.pdf purushasuktam [revision] > src/texts/purushasuktam.js
       (https://www.prapatti.com/slokas/english/purushasuuktam.pdf)
"""
import json, re, sys, unicodedata
from collections import Counter
import pymupdf
from indic_transliteration import sanscript

# ---- extract PDF lines in the PDF's own character order, which keeps every svara mark on the
# syllable it follows. Spaces are inserted where the PDF only leaves a gap between glyphs; the marks
# have no width, so the gap is measured from the last letter.
MARKS = '\u0951\u0952\u1cda\uf203'
lines = []
for page in pymupdf.open(sys.argv[1]):
    for b in page.get_text('rawdict')['blocks']:
        for l in b.get('lines', []):
            out, prev = '', None
            # text printed in red is an alternate reading, not what is chanted: skip it
            for c in (c for s in l['spans'] if s['color'] == 0 for c in s['chars']):
                if prev is not None and c['c'] not in MARKS and c['c'] != ' ' and not out.endswith(' ') \
                        and c['bbox'][0] - prev['bbox'][2] > 1.5:
                    out += ' '
                out += c['c']
                if c['c'] not in MARKS:
                    prev = c
            out = re.sub(r'Á\s+Á', 'ÁÁ', re.sub(r'\s+', ' ', out)).strip()
            # a mark the PDF wraps onto the next line belongs to the end of the previous one
            while out and out[0] in MARKS and lines:
                lines[-1][1] += out[0]; out = out[1:].lstrip()
            if out:
                lines.append([round(l['bbox'][0]), out])

# A long line that doesn't fit is continued on the next printed line, indented a little past the
# left margin (Śrīsūktam's "… vṛkṣō'tha / bilvaḥ"): join it back onto the line it belongs to.
margin = Counter(x for x, _ in lines).most_common(1)[0][0]
joined = []
for x, t in lines:
    if joined and margin + 6 < x < margin + 40:
        joined[-1][1] += ' ' + t
    else:
        joined.append([x, t])
lines = [t for _, t in joined]

SKIP = re.compile(r'^(www\.prapatti\.com.*|\d+|Sunder Kidāmbi|śrīḥ|śrīmatē .*namaḥ|ÁÁ .* ÁÁ|There could be .*)$')
titles = {l for l, n in Counter(l for l in lines if 'Á' not in l).items() if n >= 3}
# the text starts after the title line ("ÁÁ puruṣasūktam ÁÁ") of the first page that isn't the cover
heads = [k for k, l in enumerate(lines) if re.fullmatch(r'ÁÁ\s*[^\dÁ]*sūkt[^\dÁ]*ÁÁ', l)]
start = heads[1] + 1 if len(heads) > 1 else heads[0] + 1
has_opening = 'hariḥ' in lines[start]            # Puruṣasūktam opens with "hariḥ ō(4)m"
if not has_opening:
    start -= 1
end = next(k for k, l in enumerate(lines) if l.startswith('ÁÁ iti'))
opening = re.sub(r'Á', '', lines[start]).strip() if has_opening else None
body = [l for l in lines[start + 1:end] if l and not SKIP.match(l) and l not in titles]

def dev(t):
    t = unicodedata.normalize('NFC', t)
    for a, b in [('\uf203', '\u1cda'), ('ŗ', 'r'), ('ņ', 'n'), ('ġ', 'g\ue000'),
                 ('ṃ', 'ṁ'), ('ṛ', 'r̥'), ('ṝ', 'r̥̄'), ('ḻ', 'ḷ'), ('’', "'")]:
        t = t.replace(a, b)
    d = sanscript.transliterate(t, sanscript.ISO, sanscript.DEVANAGARI).replace('\ue000', 'ं')
    d = re.sub('([\u0951\u0952\u1cda])ं', 'ं\\1', d)   # svara mark after the anusvara: दे॒वानां᳚
    for a, b in FIXES.items():
        d = d.replace(a, b)
    return d

# The PDF leaves a word-sized gap inside this compound (स॒हस्र॑शीर्षा॒ is one word).
FIXES = {'स॒हस्र॑ शीर्षा॒': 'स॒हस्र॑शीर्षा॒'}

END = re.compile(r'ÁÁ\s*(\d+)\s*ÁÁ\s*$')
out, verse, group = ([{'v': 0, 'text': dev(opening)}] if opening else []), 1, []

def flush(group, verse):
    for idx, raw in enumerate(group):
        text = re.sub(r'(ÁÁ\s*\d+\s*ÁÁ|ÁÁ|Á)\s*$', '', raw).strip()
        # every line of the sūktam ends with "।", and the last line of a section with "॥"
        out.append({'v': verse, 'text': dev(text) + (' ॥' if idx == len(group) - 1 else ' ।')})

for l in body:
    group.append(l)
    m = END.search(l)
    if m:
        flush(group, verse)
        verse = int(m.group(1)) + 1; group = []
if group:            # a last section the PDF doesn't number (Nīḻāsūktam)
    flush(group, verse)

verses = sorted({o['v'] for o in out if o['v'] > 0})
order = ([0] if opening else []) + verses   # Vēdam: no repeats

ID = sys.argv[2]
# optional 3rd argument: the text's revision; bump it when lines change, so the app drops timings
# synced to the old lines
REVISION = int(sys.argv[3]) if len(sys.argv) > 3 else 1
print('// Generated by tools/build_vedam.py from prapatti.com\'s %s (romanised edition, converted to' % sys.argv[1].rsplit('/', 1)[-1])
print('// Devanagari with the svara marks ॒ ॑ ᳚ kept). v = section number; 0 = "hariḥ ōm".')
print('// order: sections in the order they are chanted. Vēdam has no repeats.')
print('window.SLOKAM_TEXTS = window.SLOKAM_TEXTS || {};')
print('window.SLOKAM_TEXTS[%s] = {' % json.dumps(ID))
if REVISION > 1:
    print('  revision: %d,' % REVISION)
print('  verseWord: "", verseCount: %d, labels: %s,' % (len(verses), '{ 0: "हरिः ओम्" }' if opening else '{}'))
print('  order: %s,' % json.dumps(order))
print('  lines: [')
for o in out:
    print('    ' + json.dumps(o, ensure_ascii=False) + ',')
print('  ],')
print('};')
