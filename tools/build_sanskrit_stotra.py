"""Build src/texts/<id>.js for a Sanskrit Dēśika stōtra from prapatti.com's romanised PDF.

The Devanagari PDFs on prapatti.com use a broken font encoding, so their text can't be
extracted. The romanised (ISO 15919) editions extract cleanly, so they are converted to
Devanagari here with `indic-transliteration` (pip install indic-transliteration pymupdf).

Usage: python tools/build_sanskrit_stotra.py <romanised pdf> <id> [--prakrit | --gadyam] > src/texts/<id>.js
  e.g. python tools/build_sanskrit_stotra.py dayaashatakam.pdf dayasatakam > src/texts/dayasatakam.js
       (https://www.prapatti.com/slokas/english/desika-stotramaala/dayaashatakam.pdf)

Includes the opening taniyan (v = 0) and the closing taniyan (v = last ślōka + 1).
The first and last ślōkas are chanted twice, so they appear twice in `order`.
"""
import argparse, json, re, sys, unicodedata
from collections import Counter
import pymupdf
from indic_transliteration import sanscript

ap = argparse.ArgumentParser()
ap.add_argument('pdf'); ap.add_argument('id')
ap.add_argument('--prakrit', action='store_true', help='Prakrit work: keep the Prakrit, drop each Sanskrit chāyā')
ap.add_argument('--gadyam', action='store_true', help='prose work (Raghuvīra Gadyam): "!"-phrases grouped by kāṇḍa')
ap.add_argument('--repeat-closing-phrases', type=int, default=0, metavar='N',
                help='gadyam: the last N prose phrases are chanted twice together '
                     '(Raghuvīra Gadyam: 2, śrīrāmabhadra ! namastē punastē namaḥ !)')
ap.add_argument('--keep-timings-before', metavar='REV:VERSE',
                help='timings synced at revision REV are still right for every line before ślōka VERSE '
                     '(when only the order from VERSE on changed); the app keeps them and asks to sync the rest')
ap.add_argument('--no-first-repeat', action='store_true',
                help='the first ślōka is chanted only once (Ṣōḍaśāyudhastōtram)')
ap.add_argument('--drop-appendix', action='store_true',
                help='leave out unnumbered ślōkas printed after the numbered ones (Dēśikamaṅgaḷam\'s saptati ratna mālikā)')
ap.add_argument('--closing-taniyans', type=int, metavar='N',
                help='keep only the first N closing taniyans (Dēśikamaṅgaḷam: 1)')
ap.add_argument('--no-opening-taniyan', action='store_true',
                help='leave out the opening taniyan (śrīmān vēṅkaṭanāthāryaḥ …) when the recording skips it')
ap.add_argument('--one-line', metavar='N,N',
                help='show these ślōkas each as a single line (Garuḍa Daṇḍakam: 2,3,4,5, the daṇḍaka sections)')
ap.add_argument('--repeat-last', type=int, default=1, metavar='N',
                help='how many final ślōkas are chanted twice (Garuḍa Daṇḍakam: 2)')
ap.add_argument('--revision', type=int, default=1,
                help='bump when the lines or order change, so the app drops timings synced to the old ones')
ARGS = ap.parse_args()

# ---- extract PDF lines. Rebuild each page's lines from all its characters by vertical position:
# the daṇḍa glyphs (Á) are in another font that the PDF stores as separate text blocks.
# Spaces are inserted where the PDF only leaves a gap between glyphs.
lines = []
for page in pymupdf.open(ARGS.pdf):
    chars = [c for b in page.get_text('rawdict')['blocks'] for l in b.get('lines', [])
             for s in l['spans'] for c in s['chars'] if c['c'].strip()]
    rows = []
    for c in sorted(chars, key=lambda c: (c['bbox'][1] + c['bbox'][3]) / 2):
        y = (c['bbox'][1] + c['bbox'][3]) / 2
        if rows and abs(rows[-1][0] - y) < 4:
            rows[-1][1].append(c)
        else:
            rows.append([y, [c]])
    for _, row in rows:
        out, prev = '', None
        for c in sorted(row, key=lambda c: c['bbox'][0]):
            if prev is not None and c['bbox'][0] - prev['bbox'][2] > 1.5:
                out += ' '
            out += c['c']; prev = c
        lines.append(re.sub(r'Á\s+Á', 'ÁÁ', re.sub(r'\s+', ' ', out)).strip())

SKIP = re.compile(r'^(www\.prapatti\.com.*|\d+|Sunder Kidāmbi|śrīdēśikastōtrāṇi.*|śrīḥ|śrīmatē .*namaḥ|\(.*\)|saptati ratna mālikā)$')
# page headers repeat the stōtra's title on every page
titles = {l for l, n in Counter(l for l in lines if 'Á' not in l).items() if n >= 3}
heading = next((re.sub(r'[Á\s]', '', l) for l in lines if re.fullmatch(r'ÁÁ\s*[^\dÁ]+ÁÁ', l)), None)
start = next(k for k, l in enumerate(lines) if l.startswith('śrīmān vēṅkaṭanāthāryaḥ'))
body = [l for l in lines[start:] if l and not SKIP.match(l) and l not in titles
        and re.sub(r'\s', '', l) != heading]

# After "iti … samāptam" come the closing taniyans, from kavitārkikasiṃhāya … on (Dēśikamaṅgaḷam
# has two: kavitārkikasiṃhāya … and vādidvipaśirōbhaṅga …).
cut = next((k for k, l in enumerate(body) if l.startswith('ÁÁ iti')), None)
closing_lines = []
if cut is not None:
    tail = body[cut + 1:]
    k = next((j for j, l in enumerate(tail) if l.startswith('kavitārkikasiṃhāya')), None)
    if k is not None:
        closing_lines = tail[k:]
        if ARGS.closing_taniyans:
            # each taniyan ends with "ÁÁ"; keep the first N
            kept, n_ = [], 0
            for l in closing_lines:
                if n_ >= ARGS.closing_taniyans: break
                kept.append(l)
                if re.search(r'ÁÁ\s*$', l): n_ += 1
            closing_lines = kept
    body = body[:cut]

# ---- group into display lines. Each PDF line is normally one line of the ślōka; in long metres
# (e.g. Dayāśatakam 107) the PDF splits every pāda over two lines, so those are paired back up.
END = re.compile(r'(ÁÁ\s*(\d+)\s*ÁÁ|ÁÁ)\s*$')
units, labels, appendix = [], {0: 'तनियन्'}, set()

def clean(raw):
    text = re.sub(r'(ÁÁ\s*\d+\s*ÁÁ|ÁÁ|Á)\s*$', '', raw).strip()
    text = re.sub(r'\s*-\s+', '', text)  # word broken across PDF lines: "vyatiṣajat - svargā…"
    return re.sub(r'\s*-$', '-', text)    # compound running on into the next line

def flush(group, verse):
    if len(group) == 8:
        group = [group[k] + ' ' + group[k + 1] for k in range(0, 8, 2)]
    # "।" ends the first half of a ślōka and "॥" the whole ślōka. They're placed by position
    # because the PDF leaves some of its daṇḍa glyphs out of the text layer.
    for idx, raw in enumerate(group):
        end = '॥' if idx == len(group) - 1 else ('।' if idx == len(group) // 2 - 1 else '')
        text = clean(raw)
        if text.endswith('-'):
            end = ''   # a word running on into the next line never takes a daṇḍa (Garuḍa Daṇḍakam)
        units.append({'v': verse, 'text': text, 'end': end})

if ARGS.gadyam:
    # Prose: phrases end with "!" and run over several PDF lines, under kāṇḍa headings. The
    # ślōkas at the start and end end with "॥". Lines are collected until one or the other ends
    # them (the PDF leaves some "।" out, so a ślōka's first line can't be recognised on its own).
    # Sections: 0 = taniyan, then one per ślōka and one per kāṇḍa.
    verse, buf = -1, []
    for l in body:
        if re.fullmatch(r'[a-zāīūṛṣṇśṭḍñṅēō]+kāṇḍam', l):
            verse += 1; labels[verse] = 'KANDA:' + l
            continue
        buf.append(l)
        if l.endswith('!'):
            units.append({'v': verse, 'text': ' '.join(buf), 'end': ''}); buf = []
        elif END.search(l):
            verse += 1; labels[verse] = 'तनियन्' if verse == 0 else 'श्लोकः'
            flush(buf, verse); buf = []
else:
    nxt, group, seen = 1, [], set()
    for l in body:
        group.append(l)
        m = END.search(l)
        if not m:
            continue
        n = int(m.group(2)) if m.group(2) else None
        if n is not None:
            # Prakrit works (Accuasaam) print every ślōka twice, Prakrit then its Sanskrit chāyā,
            # under the same number; only the Prakrit is chanted
            if not (ARGS.prakrit and n in seen):
                flush(group, n)
            seen.add(n); nxt = n + 1
        elif not seen:
            # unnumbered ślōkas before ślōka 1 are taniyans; a Prakrit taniyan's chāyā is dropped
            if not (ARGS.prakrit and sum(u['v'] == 0 for u in units) >= 4):
                flush(group, 0)
        else:
            # unnumbered ślōkas after the numbered ones (Dēśikamaṅgaḷam's saptati ratna mālikā):
            # one section each, outside the first/last repeat rule
            if not ARGS.drop_appendix:
                flush(group, nxt); appendix.add(nxt); labels[nxt] = 'श्लोकः'; nxt += 1
        group = []
    if group:
        flush(group, nxt)

closing = max(u['v'] for u in units) + 1 if closing_lines else None
if closing_lines:
    chunk = []
    for l in closing_lines:          # one taniyan at a time, so each gets its own । and ॥
        chunk.append(l)
        if END.search(l):
            flush(chunk, closing); chunk = []
    if chunk:
        flush(chunk, closing)
    labels[closing] = 'तनियन्'

def dev(t):
    t = unicodedata.normalize('NFC', t)
    for a, b in [('ṃ', 'ṁ'), ('ṛ', 'r̥'), ('ṝ', 'r̥̄'), ('ḻ', 'ḷ'), ('’', "'")]:
        t = t.replace(a, b)
    # ḷ is normally the consonant ळ (maṅgaḷam), but between two consonants it is the vowel ḷ:
    # kḷpta is कॢप्त, not क्ळ्प्त
    t = re.sub(r'(?<=[kgcjṭḍtdpbmyrvśṣsh])ḷ(?=[kgcjṭḍtdpbmnyrlvśṣsh])', 'l̥', t)
    return sanscript.transliterate(t, sanscript.ISO, sanscript.DEVANAGARI)

out = [{'v': u['v'], 'text': (dev(u['text']) + (' ' + u['end'] if u['end'] else '')).strip()} for u in units]
if ARGS.one_line:
    one = {int(x) for x in ARGS.one_line.split(',')}
    merged = []
    for o in out:
        if merged and o['v'] == merged[-1]['v'] and o['v'] in one:
            prev = merged[-1]['text']
            # a word broken across lines ("…कण्टक-" + "व्रात…") joins without the hyphen or a space
            merged[-1]['text'] = prev[:-1] + o['text'] if prev.endswith('-') else prev + ' ' + o['text']
        else:
            merged.append(dict(o))
    out = merged
if ARGS.repeat_closing_phrases:
    # the last prose phrases (lines without a daṇḍa) before the closing ślōkas, chanted twice as a group
    phrase_idx = [k for k, u in enumerate(units) if ARGS.gadyam and u['end'] == '' and labels.get(u['v'], '').startswith('KANDA:')]
    first_of_group = phrase_idx[-ARGS.repeat_closing_phrases]
    out[first_of_group]['group'] = ARGS.repeat_closing_phrases
labels = {k: (dev(v[6:]) if v.startswith('KANDA:') else v) for k, v in labels.items()}

# Sanskrit Dēśika stōtras: the first and last ślōkas are chanted twice.
verses = sorted({o['v'] for o in out if o['v'] not in (0, closing)})
numbered = [v for v in verses if v not in appendix]
first, last = numbered[0], numbered[-1]
twice = ({first} if not ARGS.no_first_repeat else set()) | set(numbered[-ARGS.repeat_last:])
if ARGS.gadyam:
    # Raghuvīra Gadyam: both closing ślōkas after the last kāṇḍa (caturmukhēśvara … and
    # kavikathakasiṃha …) are chanted twice
    last_kanda = max(k for k, v in labels.items() if v.startswith('KANDA:') or 'काण्ड' in v)
    twice |= {v for v in verses if v > last_kanda}
order = [0] + [v for v in verses for _ in range(2 if v in twice else 1)] + ([closing] if closing else [])
if ARGS.no_opening_taniyan:
    out = [o for o in out if o['v'] != 0]
    order = [v for v in order if v != 0]
    labels.pop(0, None)
if not ARGS.gadyam:
    labels = {k: v for k, v in labels.items() if v == 'तनियन्' or k in appendix}

print('// Generated by tools/build_sanskrit_stotra.py from prapatti.com\'s %s (romanised edition,' % ARGS.pdf.rsplit('/', 1)[-1])
print('// converted to Devanagari). v = %s; 0 = opening taniyan, %s = closing taniyan.'
      % ('section (kāṇḍa or ślōka)' if ARGS.gadyam else 'ślōka number', closing))
print('// order: in the order they are chanted (the first and last ślōkas are said twice).')
print('window.SLOKAM_TEXTS = window.SLOKAM_TEXTS || {};')
print('window.SLOKAM_TEXTS[%s] = {' % json.dumps(ARGS.id))
if ARGS.revision > 1:
    print('  revision: %d,' % ARGS.revision)
if ARGS.keep_timings_before:
    r_, v_ = ARGS.keep_timings_before.split(':')
    print('  keepTimingsBefore: { %s: %s },   // revision: ślōka — older timings stay right before this ślōka' % (r_, v_))
print('  verseWord: "श्लोकः", verseCount: %d, labels: %s,' % (len(numbered), json.dumps({str(k): v for k, v in labels.items()}, ensure_ascii=False)))
print('  order: %s,' % json.dumps(order))
print('  lines: [')
for o in out:
    print('    ' + json.dumps(o, ensure_ascii=False) + ',')
print('  ],')
print('};')
