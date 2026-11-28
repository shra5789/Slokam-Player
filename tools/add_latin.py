"""Give each line of a src/texts/<id>.js file its Latin-script form ("lat"), for the app's script setting.

Sanskrit and Vēdam: the builders (build_sanskrit_stotra.py, build_vedam.py) now output "lat" next to
"text": the line as prapatti.com's romanised edition prints it. Rather than rebuilding a text (which
would lose hand edits), this copies "lat" across from a fresh build, line by line, matching on the
Devanagari:

  python tools/build_sanskrit_stotra.py sriistuti.pdf x > /tmp/build.js
  python tools/add_latin.py src/texts/sristuti.js /tmp/build.js [more builds …]

Lines it can't match are listed and left without "lat" (the app then shows the original script).
"""
import json, re, sys

LINE = re.compile(r'^(\s*)(\{"v".*\}),\s*$')

def lines_of(path):
    return [json.loads(m.group(2)) for m in map(LINE.match, open(path, encoding='utf-8').read().split('\n')) if m]

def key(t):
    # match on the letters alone: ignore daṇḍas, spaces and hyphens
    return re.sub(r'[\s।॥|\-]', '', t)

def main(target, builds):
    found = {}
    for b in builds:
        for o in lines_of(b):
            if 'lat' in o:
                found.setdefault(key(o['text']), o['lat'])
    out, missing, n = [], [], 0
    for raw in open(target, encoding='utf-8').read().split('\n'):
        m = LINE.match(raw)
        if m:
            o = json.loads(m.group(2))
            lat = found.get(key(o['text']))
            if lat is not None:
                # keep the line's own closing daṇḍa (a hand edit may have changed । to ॥)
                end = re.search(r'\s*([।॥\s]*)$', o['text']).group(1).split()
                lat = re.sub(r'[\s|]+$', '', lat) + (' ' + ' '.join('||' if d == '॥' else '|' for d in end) if end else '')
                o['lat'] = lat; n += 1
            elif 'lat' not in o:
                missing.append(o['text'])
            raw = m.group(1) + json.dumps(o, ensure_ascii=False) + ','
        out.append(raw)
    open(target, 'w', encoding='utf-8').write('\n'.join(out))
    print(f'{target}: {n} lines given Latin', file=sys.stderr)
    for t in missing:
        print('  no match:', t, file=sys.stderr)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2:])
