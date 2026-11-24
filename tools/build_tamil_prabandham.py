"""Build src/texts/<id>.js for a Tamil divya prabandham from a prapatti.com PDF.

First repair the PDF text with extract_pdf.py, then:

  # a whole work: its taniyans, then every pāsuram (e.g. tiruppaavai.pdf)
  python tools/build_tamil_prabandham.py tiruppaavai.txt tiruppavai > src/texts/tiruppavai.js

  # one decade out of a larger work (e.g. Periyāḻvār Tirumoḻi 2.7, pūccūṭṭal), optionally with
  # the work's taniyans in front
  python tools/build_tamil_prabandham.py periyaazvaartirumozi.txt puccuttal --section 2.7 > src/texts/puccuttal.js
  python tools/build_tamil_prabandham.py periyaazvaartirumozi.txt tirupallandu --section 1.1 --taniyans > ...

Verses are numbered 1, 2, 3 … in the output. Taniyans get negative numbers (-1, -2, …) and the
label தனியன். A pāsuram whose first line starts with ‡ is chanted twice, so it appears twice in
`order`. Grantha subscripts (₂ ₃ ₄) in the Sanskrit taniyans are kept as prapatti.com prints them.
"""
import argparse, json, re, sys

ap = argparse.ArgumentParser()
ap.add_argument('text'); ap.add_argument('id')
ap.add_argument('--section', help='decade number, e.g. 2.7, to take just that decade')
ap.add_argument('--taniyans', action='store_true', help='with --section: put the work\'s taniyans first')
ap.add_argument('--extra-taniyans', metavar='TEXT:FIRST-LAST',
                help='put numbered taniyans from another repaired text first, e.g. '
                     'naalaayirattaniyangal_vad.txt:1-5 (chanted before the work\'s own taniyans)')
ap.add_argument('--taniyans-file', metavar='TEXT',
                help='with --section: take the taniyans from this separate repaired text (e.g. nttaniyan.txt)')
ap.add_argument('--desika', action='store_true',
                help='a Dēśika prabandham PDF: no "தனியன்கள்" heading; everything before pāsuram 1 is taniyans')
ap.add_argument('--drop-taniyans', metavar='N,N',
                help='leave out these taniyans (1 = the first one printed, or "all"), when the recording skips them')
ap.add_argument('--no-repeat', metavar='N,N',
                help='pāsurams marked ‡ that the recording nevertheless chants only once')
ap.add_argument('--andadi', action='store_true',
                help='an andādi: pāsuram 1 is chanted once more after the last pāsuram')
ap.add_argument('--join', metavar='A,B',
                help='show verses A and B (as the PDF numbers them) as one verse A, renumbering the ones after; '
                     'the playback order is kept (Tirupallāṇḍu 1,2)')
ap.add_argument('--keep-timings-before', metavar='REV:VERSE',
                help='with a new --revision: timings synced to revision REV stay right up to pāsuram VERSE '
                     '(the lines before it are unchanged), so only the rest needs syncing again')
ap.add_argument('--revision', type=int, default=1,
                help='bump when the lines change, so the app drops timings synced to the old lines')
args = ap.parse_args()

raw = [l.strip() for l in open(args.text, encoding='utf-8').read().splitlines()]

JUNK = re.compile(r'^(ஶ்ரீ:|ஶ்ரீமதே .*நம:|www\.prapatti\.com|\d+|Sunder Kidāmbi|This document has been prepared by|'
                  r'with the blessings of|His Holiness .*|ஶ்ரீ ரங்க₃ராமாநுஜ மஹாதே₃ஶிகன்|தனியன்(கள்)?|.* அருளிச்செய்த.*|'
                  r'.*திருவடிகளே சரணம்.*|\d+(\.\d+)* – .*|.*\. \. \. .*)$')
SANSKRIT = re.compile(r'[₁₂₃₄ஶஸஷஜஹ]')
VERSE_END = re.compile(r'॥\s*॥\s*([\d.]+)\s*॥\s*॥\s*$')

def taniyans_after(start):
    """Taniyan blocks from the line after `start` up to the first line starting with ‡ (pāsuram 1)."""
    blocks, cur, k = [], [], start + 1
    while k < len(raw) and not raw[k].startswith('‡') and not raw[k].endswith('முற்றிற்று'):
        l = raw[k]; k += 1
        if not l or JUNK.match(l) or l in titles:
            continue
        cur.append(l)
        sanskrit = SANSKRIT.search(cur[0]) is not None
        # a Sanskrit taniyan ends with "॥ ॥"; a Tamil one at its first line without ⋆
        if (sanskrit and l.endswith('॥ ॥')) or (not sanskrit and not l.endswith('⋆') and not l.endswith('॥')):
            blocks.append(cur); cur = []
    if cur:
        blocks.append(cur)
    return blocks

# page headers repeat the work's title; collect lines that occur on many pages
from collections import Counter
counts = Counter(l for l in raw if l and '⋆' not in l and '॥' not in l)
titles = {l for l, n in counts.items() if n >= 3 and not JUNK.match(l)}

taniyan_blocks, verse_lines = [], []
if args.section:
    head = re.compile(r'^' + re.escape(args.section) + r' – ')
    start = next(k for k, l in enumerate(raw) if head.match(l) and '. .' not in l)
    any_head = re.compile(r'^\d+\.\d+ – ')
    end = next((k for k in range(start + 1, len(raw)) if any_head.match(raw[k]) and not head.match(raw[k])), len(raw))
    body = raw[start + 1:end]
    if args.taniyans:
        t = next(k for k, l in enumerate(raw) if l == 'தனியன்கள்')
        taniyan_blocks = taniyans_after(t)
    if args.taniyans_file:
        # the work's taniyans are in their own PDF (Nācciyār Tirumoḻi's nttaniyan.pdf)
        saved_raw, saved_titles = raw, titles
        raw = [l.strip() for l in open(args.taniyans_file, encoding='utf-8').read().splitlines()]
        titles = saved_titles | {l for l in raw if 'தனியன்கள்' in l and l != 'தனியன்கள்'}
        t = next(k for k, l in enumerate(raw) if l == 'தனியன்கள்')
        taniyan_blocks = taniyans_after(t)
        raw, titles = saved_raw, saved_titles
elif args.desika:
    doc_title = next(l for l in raw if l and not JUNK.match(l))
    clean_raw = [l for l in raw if l and not JUNK.match(l) and l not in titles and l != doc_title]
    k1 = next(k for k, l in enumerate(clean_raw) if (m := VERSE_END.search(l)) and m.group(1) == '1')
    blocks, cur = [], []
    for l in clean_raw[:k1 + 1]:
        cur.append(l)
        sanskrit = SANSKRIT.search(cur[0]) is not None
        # a Sanskrit taniyan ends with "॥ ॥"; a Tamil one (four lines) at a line without ⋆
        if VERSE_END.search(l) or (sanskrit and l.endswith('॥ ॥')) or \
                (not sanskrit and len(cur) >= 4 and not l.endswith('⋆') and not l.endswith('॥')):
            blocks.append(cur); cur = []
    taniyan_blocks, verse1 = blocks[:-1], blocks[-1]
    rest = clean_raw[k1 + 1:]
    end = next((k for k, l in enumerate(rest) if l.endswith('முற்றிற்று') or l.startswith('அடிவரவு')), len(rest))
    body = verse1 + rest[:end]
else:
    t = next(k for k, l in enumerate(raw) if l in ('தனியன்கள்', 'தனியன்'))
    taniyan_blocks = taniyans_after(t)
    first = next(k for k in range(t, len(raw)) if raw[k].startswith('‡'))
    end = next(k for k in range(first, len(raw)) if raw[k].endswith('முற்றிற்று') or raw[k].startswith('அடிவரவு'))
    body = raw[first:end]

out, repeated, verse, buf = [], set(), 1, []
reading = []          # verse ids in the order they're printed (and chanted)
extras = []           # verses the PDF doesn't number: chanted once, labelled without a number

def star_lines(lines_):
    """A Tamil verse's lines end at each ⋆, not where the PDF happens to wrap them (Tiruvezukūṟṟirukkai's
    "… அரவோடு ⋆ ஆறு பொதி சடையோன் …" is printed across a line break). Blocks without any ⋆, such as the
    Sanskrit taniyans, keep the PDF's lines."""
    lines_ = [re.sub(r'॥\s*॥\s*[\d.]+\s*॥\s*॥\s*$', '', l) for l in lines_]
    if not any('⋆' in l for l in lines_):
        return lines_
    return [x.strip() for x in re.split(r'⋆+', ' '.join(lines_)) if x.strip()]

def emit(lines_, v):
    for k, b in enumerate(star_lines(lines_)):
        text = re.sub(r'॥.*$', '', b)
        text = re.sub(r'[⋆‡]', '', text)
        o = {'v': v, 'text': re.sub(r'\s+', ' ', text).strip()}
        # ‡ partway through a pāsuram marks a single line that is chanted twice
        # (Tiruvezukūṟṟirukkai's செல்வம் மல்கு தென் திருக்குடந்தை)
        if k > 0 and b.startswith('‡'):
            o['rep'] = 1
        out.append(o)
    reading.append(v)

for l in body:
    if not l or JUNK.match(l) or l in titles or l.startswith('அடிவரவு') or l.endswith('முற்றிற்று'):
        continue
    if not buf and l.startswith('‡'):
        repeated.add(verse)
    buf.append(l)
    if buf[0].startswith('(') and l.endswith(')'):
        # a bracketed, unnumbered verse between two pāsurams (Adhikāra Saṅgraham)
        ex = 1000 + len(extras) + 1; extras.append(ex)
        repeated.discard(verse)
        emit(buf, ex); buf = []
    elif VERSE_END.search(l):
        emit(buf, verse)
        verse += 1; buf = []
# a closing verse the PDF leaves unnumbered (Tiruvezukūṟṟirukkai's இடங்கொண்ட நெஞ்சத்து …): chanted once
if buf and any(b.endswith('⋆') for b in buf):   # verse lines carry ⋆; leftover index lines don't
    ex = 1000 + len(extras) + 1; extras.append(ex)
    emit(buf, ex)

if args.extra_taniyans:
    path, rng = args.extra_taniyans.rsplit(':', 1)
    first_n, last_n = map(int, rng.split('-'))
    extra, cur = {}, []
    for l in (x.strip() for x in open(path, encoding='utf-8').read().splitlines()):
        if not l or JUNK.match(l) or 'தனியன்கள்' in l or 'ஸம்ப்ரதாய' in l:
            continue
        cur.append(l)
        m = VERSE_END.search(l)
        if m:
            extra[int(m.group(1))] = [re.sub(r'\s*॥.*$', '', x) for x in cur]; cur = []
    taniyan_blocks = [extra[k] for k in range(first_n, last_n + 1)] + taniyan_blocks

if args.drop_taniyans:
    drop = set(range(1, len(taniyan_blocks) + 1)) if args.drop_taniyans == 'all' else {int(x) for x in args.drop_taniyans.split(',')}
    taniyan_blocks = [b for k, b in enumerate(taniyan_blocks, 1) if k not in drop]

lines = []
for n, block in enumerate(taniyan_blocks, 1):
    for l in star_lines(block):
        text = re.sub(r'\s+', ' ', re.sub(r'[⋆‡॥]', '', l)).strip()
        text = re.sub(r'\s+-$', '-', text)  # a compound running on into the next line keeps its hyphen attached
        for a, b in {'பாரொன்ற ச்சொன்ன': 'பாரொன்றச் சொன்ன', 'வானேற ப்போமளவும்': 'வானேறப் போமளவும்'}.items():
            text = text.replace(a, b)  # glyph-gap glitches in Swami Dēśikan's taniyan
        lines.append({'v': -n, 'text': text})
lines += out

if args.no_repeat:
    repeated -= {int(x) for x in args.no_repeat.split(',')}
body_order = [v for v in reading for _ in range(2 if v in repeated else 1)]
if args.join:
    # joined verses that both repeat are chanted together twice: A B A B, not A A B B (Tirupallāṇḍu)
    a_, b_ = map(int, args.join.split(','))
    if a_ in repeated and b_ in repeated:
        k = body_order.index(a_)
        body_order[k:k + 4] = [a_, b_, a_, b_]
order = [-n for n in range(1, len(taniyan_blocks) + 1)] + body_order
if args.andadi:
    order.append(reading[0])   # an andādi closes the circle: pāsuram 1 once more at the end
labels = {str(-n): 'தனியன்' for n in range(1, len(taniyan_blocks) + 1)}
for ex in extras:
    labels[str(ex)] = 'பாசுரம்'
numbered_count = len([v for v in reading if v not in extras])
# shown numbers, when they differ from the PDF's (--join)
num = {}
if args.join:
    a_, b_ = map(int, args.join.split(','))
    for v in reading:
        if v in extras: continue
        shown = a_ if v == b_ else (v - 1 if v > b_ else v)
        if shown != v: num[str(v)] = shown
    numbered_count -= 1

src = args.text.rsplit('/', 1)[-1]
print(f'// Generated by tools/build_tamil_prabandham.py from prapatti.com\'s {src.replace(".txt", ".pdf")}'
      + (f' (decade {args.section})' if args.section else '') + '.')
print('// v = pāsuram number (negative = taniyan). order: verses in the order they are chanted;')
print('// pāsurams marked ‡ in the PDF are said twice; a line with rep: 1 is said twice in a row.')
print('window.SLOKAM_TEXTS = window.SLOKAM_TEXTS || {};')
print(f'window.SLOKAM_TEXTS[{json.dumps(args.id)}] = {{')
print(f'  revision: {args.revision},')
if args.keep_timings_before:
    r_, v_ = args.keep_timings_before.split(':')
    print('  keepTimingsBefore: { %s: %s },   // revision: pāsuram — older timings stay right before this pāsuram' % (r_, v_))
print(f'  verseWord: "பாசுரம்", verseCount: {numbered_count}, labels: {json.dumps(labels, ensure_ascii=False)},')
if num:
    print(f'  num: {json.dumps(num)},   // number shown for a verse, where it differs from v')
print(f'  order: {json.dumps(order)},')
print('  lines: [')
for o in lines:
    print('    ' + json.dumps(o, ensure_ascii=False) + ',')
print('  ],')
print('};')
