/* Slokam Player — renderer */
(function () {
  const $ = (id) => document.getElementById(id);
  const LIB = window.SLOKAM_LIBRARY;
  const TEXTS = window.SLOKAM_TEXTS || {};
  const REPEAT_WORD = { ta: 'மீண்டும்', sa: 'पुनः' };

  // every library entry, with its category's language, by id (the text key, or "n<number>")
  const ITEMS = {};
  LIB.forEach((cat) => cat.items.forEach((it) => {
    it.lang = cat.lang; it.cat = cat;
    it.id = it.text || `n${it.n}`;
    it.available = !!(it.text && TEXTS[it.text] && (it.youtube || it.audio));
    ITEMS[it.id] = it;
  }));
  const DEFAULT_ID = 'mummanikkovai';
  // Anadhyayanam mode: the Divya Prabandhams aren't recited then, so they can't be played.
  // Mārgaḻi mode (only with Anadhyayanam on) lets Tiruppāvai and Tiruppaḷḷiyezucci through.
  const MARGAZHI = ['tiruppavai', 'tiruppalliyezucci'];
  const isOff = (it) => !!S.anadhyayanam && it.cat.id === 'divya' && !(S.margazhi && MARGAZHI.includes(it.id));
  const canPlay = (it) => !!it && it.available && !isOff(it);

  // settings live in the Electron main process; fall back to localStorage when opened in a plain browser
  const store = window.widget || {
    getSettings: async () => { try { return JSON.parse(localStorage.getItem('mmk') || '{}'); } catch { return {}; } },
    setSettings: (p) => { try { const s = JSON.parse(localStorage.getItem('mmk') || '{}'); localStorage.setItem('mmk', JSON.stringify({ ...s, ...p })); } catch {} },
    setCompact: (on) => applyCompact(on), hide: () => {}, quit: () => window.close(),
    setFullscreen: (on) => { try { on ? document.documentElement.requestFullscreen() : document.exitFullscreen(); } catch {} applyFullscreen(on); },
    onCompactChanged: () => {}, onCommand: () => {},
    onFullscreenChanged: (fn) => document.addEventListener('fullscreenchange', () => fn(!!document.fullscreenElement)),
  };

  // S.slokams[id] = { seq, timings, offset } — synced timings and offset, per slokam
  const S = { opacity: 0.55, font: 1, video: false, loop: true, current: DEFAULT_ID, slokams: {} };

  // The slokam on screen. Playback follows a *timeline*: every recited line in the order the
  // recording says it, so repeated verses appear more than once. seq[e] is the line shown for
  // timeline entry e and times[e] is when it starts.
  let item = null, T = null;
  let seq = [], times = [], estimatedFor = null; // estimatedFor = duration the estimates were made for (null when synced)
  let player = null;
  let entry = -2;       // current timeline entry
  let activeLine = -2;  // line currently highlighted
  let userScrollUntil = 0;
  let sync = null;      // { next, marks: [time | null (skipped)] } while in sync mode

  // ---------- helpers ----------
  const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const mine = () => (S.slokams[item.id] = S.slokams[item.id] || {});
  const offset = () => mine().offset || 0;
  const t0 = (e) => times[e] + offset();
  function entryAt(t) {
    let lo = 0, hi = times.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (t0(m) <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans;
  }
  const isRepeat = (e) => seq.slice(0, e).includes(seq[e]); // a line already recited earlier
  // Tamil works mark a verse that is chanted more than once with ↻ beside its number
  // (Sanskrit works don't get the mark)
  const REPEAT_MARK = '↻';
  // the number shown for a verse (texts can show two printed verses as one, e.g. Tirupallāṇḍu 1)
  const shownNum = (v) => (T.num && T.num[v] != null ? T.num[v] : v);
  function chantedAgain(v) {
    if (item.lang !== 'ta' || !(v > 0)) return false;
    const firstLine = T.lines.findIndex((l) => l.v === v);
    return seq.filter((i) => i === firstLine).length > 1;
  }
  function label(e) {
    if (e < 0 || e >= seq.length) return '';
    const v = T.lines[seq[e]].v;
    const num = chantedAgain(v) ? `${shownNum(v)} ${REPEAT_MARK}` : shownNum(v);
    const name = (T.labels && T.labels[v]) || `${T.verseWord} ${num} / ${T.verseCount}`.trim();
    return name + (isRepeat(e) ? ' · ' + REPEAT_WORD[item.lang] : '');
  }
  let toastTimer;
  function toast(msg, ms = 3500) {
    const el = $('toast'); el.textContent = msg; el.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
  }
  function save(patch) { Object.assign(S, patch); store.setSettings(patch); }
  const saveMine = (patch) => { Object.assign(mine(), patch); save({ slokams: S.slokams }); };

  // default playback order: each verse in `order`, all of its lines
  // (a line marked rep — Tiruvezukūṟṟirukkai's செல்வம் மல்கு — is chanted twice in a row)
  // (a line marked group: n starts n lines chanted twice together — Raghuvīra Gadyam's
  //  श्रीरामभद्र ! नमस्ते पुनस्ते नमः !)
  function defaultSeq() {
    return T.order.flatMap((v) => {
      const idx = T.lines.map((l, i) => (l.v === v ? i : -1)).filter((i) => i >= 0);
      const out = [];
      for (let k = 0; k < idx.length; k++) {
        const l = T.lines[idx[k]];
        if (l.group) { const g = idx.slice(k, k + l.group); out.push(...g, ...g); k += l.group - 1; }
        else if (l.rep) out.push(idx[k], idx[k]);
        else out.push(idx[k]);
      }
      return out;
    });
  }

  // Estimated start times, spread over the recording by how many letters each line has,
  // with a short pause between verses. Sync mode replaces these with exact ones.
  function estimate(s, dur) {
    const letters = (txt) => (txt.match(/\p{L}/gu) || []).length;
    const gap = (k) => (k > 0 && s[k] !== s[k - 1] + 1 && s[k] !== s[k - 1] ? 8 : 0);
    const w = s.map((i, k) => letters(T.lines[i].text) + 3 + gap(k));
    const start = Math.min(3, dur * 0.01), end = dur - Math.min(6, dur * 0.015);
    const scale = (end - start) / w.reduce((a, b) => a + b, 0);
    let t = start;
    return s.map((i, k) => { t += gap(k) * scale; const at = t; t += (w[k] - gap(k)) * scale; return Math.round(at * 100) / 100; });
  }
  const knownDuration = () => (player && player.duration() > 1 ? player.duration() : item.duration || 600);

  // a text's `revision` goes up when its lines change; timings synced to an older revision point
  // at the wrong lines, so they're dropped
  const revision = () => T.revision || 1;
  let keptNotice = false;   // loadTimings just kept older timings and said so; skip the generic reminder
  function loadTimings() {
    const m = mine();
    const has = Array.isArray(m.timings) && Array.isArray(m.seq);
    let stale = has && (m.rev || 1) !== revision();
    // A text update that moved lines about, added some or took some out, with the recording unchanged:
    // lineMap[oldRev][old line index] = new line index (-1: taken out). Old timings follow their lines;
    // entries for new lines get times spread over the gap they fall in (estimates, until re-synced).
    const lineMap = stale && T.lineMap && T.lineMap[m.rev || 1];
    if (lineMap && m.timings.length === m.seq.length) {
      const done = m.full === false ? (m.synced || 0) : m.seq.length;
      const old = [];
      m.seq.forEach((i, k) => { const j = lineMap[i]; if (j != null && j >= 0) old.push({ i: j, t: m.timings[k], done: k < done }); });
      const known = new Set(lineMap.filter((j) => j != null && j >= 0));
      const out = []; let o = 0;
      for (const i of defaultSeq()) {
        if (!known.has(i)) out.push({ i, t: null, done: true });
        else if (o < old.length && old[o].i === i) out.push(old[o++]);
        // else: a line the old sync skipped stays skipped
      }
      while (o < old.length) out.push(old[o++]);
      // spread the new entries evenly between the known times around them
      for (let k = 0; k < out.length; k++) {
        if (out[k].t != null) continue;
        let e = k; while (e < out.length && out[e].t == null) e++;
        const a = k > 0 ? out[k - 1].t : 0, b = e < out.length ? out[e].t : a + 4 * (e - k + 1);
        for (let x = k; x < e; x++) out[x].t = Math.round((a + (b - a) * (x - k + 1) / (e - k + 1)) * 100) / 100;
        k = e;
      }
      let synced2 = 0; while (synced2 < out.length && out[synced2].done) synced2++;
      saveMine({ seq: out.map((x) => x.i), timings: out.map((x) => x.t), rev: revision(), synced: m.full === false ? synced2 : out.length, full: m.full });
      stale = false; keptNotice = true;
      setTimeout(() => toast(`${item.iast} was updated. Your timings are kept; any new lines have estimated times — re-sync if they’re off.`, 8000), 600);
    }
    // A text update that only took some lines out (a taniyan the recording doesn't recite) leaves the
    // recording as it was: drop those lines' timings and keep all the others, pointed at the new lines.
    const removed = stale && T.removedLines && T.removedLines[m.rev || 1];
    if (removed && m.timings.length === m.seq.length) {
      // [first old line index, count], or a list of them
      const ranges = Array.isArray(removed[0]) ? removed : [removed];
      const gone = (i) => ranges.some(([at, n]) => i >= at && i < at + n);
      const shift = (i) => ranges.reduce((d, [at, n]) => d + (i >= at + n ? n : 0), 0);
      const done = m.full === false ? (m.synced || 0) : m.seq.length;
      const seq2 = [], times2 = []; let synced2 = 0;
      m.seq.forEach((i, k) => {
        if (gone(i)) return;
        seq2.push(i - shift(i)); times2.push(m.timings[k]);
        if (k < done) synced2++;
      });
      saveMine({ seq: seq2, timings: times2, rev: revision(), synced: synced2, full: m.full });
      stale = false; keptNotice = true;
      setTimeout(() => toast(`Some lines that aren’t recited were taken out of ${item.iast}. Your timings for the rest are kept.`, 7000), 600);
    }
    // A text update that only changed the order near the end can say that older timings are still
    // right up to a given verse: keep those and leave the rest to be synced (as a partial sync).
    const keepBefore = stale && T.keepTimingsBefore && T.keepTimingsBefore[m.rev || 1];
    if (keepBefore && m.timings.length === m.seq.length) {
      const firstLine = T.lines.findIndex((l) => l.v === keepBefore);
      let k = 0;
      while (k < m.seq.length && m.seq[k] < firstLine && m.seq[k] >= 0) k++;
      const fresh = defaultSeq();
      const from = fresh.findIndex((i) => i >= firstLine);
      if (k > 0 && from >= 0) {
        const keptSeq = m.seq.slice(0, k), keptTimes = m.timings.slice(0, k);
        const restSeq = fresh.slice(from);
        const est = estimate(fresh, knownDuration()).slice(from);
        const shift = Math.max(0, keptTimes[k - 1] + 2 - est[0]);   // keep the rest after what's kept
        const wasDone = m.full === false ? Math.min(m.synced || 0, k) : k;
        saveMine({
          seq: keptSeq.concat(restSeq), timings: keptTimes.concat(est.map((t) => Math.round((t + shift) * 100) / 100)),
          rev: revision(), synced: wasDone, full: false,
        });
        stale = false; keptNotice = true;
        setTimeout(() => toast(`${item.iast} was updated from ${T.verseWord} ${keepBefore} on. Your timings before that are kept — press R to sync the rest.`, 9000), 600);
      }
    }
    if (stale) {
      saveMine({ timings: null, seq: null, rev: null });
      setTimeout(() => toast(`The text of ${item.iast} was updated, so your synced timings for it no longer fit. Please run Sync timings again.`, 9000), 600);
    }
    const ok = !stale && has && m.timings.length === m.seq.length && m.seq.length > 0
      && m.seq.every((i) => Number.isInteger(i) && i >= 0 && i < T.lines.length);
    if (ok) { seq = m.seq.slice(); times = m.timings.slice(); estimatedFor = null; }
    else { seq = defaultSeq(); const d = knownDuration(); times = estimate(seq, d); estimatedFor = d; }
  }

  // ---------- render lyrics ----------
  let lis = [];
  function buildLines() {
    const ol = $('lines'); ol.innerHTML = ''; lis = [];
    ol.lang = item.lang;
    T.lines.forEach((ln, i) => {
      const li = document.createElement('li');
      li.className = 'line';
      if (i === 0 || (T.lines[i - 1].v !== ln.v && (ln.v < 0 || shownNum(T.lines[i - 1].v) !== shownNum(ln.v)))) {
        li.classList.add('verse-start');
        li.dataset.v = ln.v;
      }
      // inline span: when a line wraps, its background is laid out as one continuous strip,
      // so the highlight sweeps the first row and then the second instead of both at once
      if (ln.rep) li.classList.add('line-repeat'); // shown with ↻ in front
      const txt = document.createElement('span'); txt.className = 'txt'; txt.textContent = ln.text;
      li.appendChild(txt);
      li.addEventListener('click', () => {
        if (sync || !player) return;
        // a repeated line has several timeline entries: jump to the one nearest the current position
        const now = player.time();
        let best = -1;
        seq.forEach((l, e) => { if (l === i && (best < 0 || Math.abs(t0(e) - now) < Math.abs(t0(best) - now))) best = e; });
        if (best >= 0) { player.seek(t0(best) + 0.01); player.play(); userScrollUntil = 0; }
      });
      ol.appendChild(li); lis.push(li);
    });
    markVerses();
  }
  // the small verse number shown above each verse, with ↻ when it's chanted again
  function markVerses() {
    lis.forEach((li) => {
      if (li.dataset.v === undefined) return;
      const v = +li.dataset.v;
      const base = (T.labels && T.labels[v]) || shownNum(v);
      li.dataset.verse = chantedAgain(v) ? `${base} ${REPEAT_MARK}` : base;
    });
  }

  function scrollToLine(line, smooth) {
    const vp = $('viewport');
    const li = lis[Math.max(line, 0)];
    if (!li) return;
    // keep the whole line (even when it wraps) clear of the faded top edge
    const top = li.offsetTop - (isFull() ? vp.clientHeight * 0.36 : Math.max(vp.clientHeight * 0.24, 30));
    vp.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
  }

  // highlight timeline entry e; `scrollLine` overrides which line to keep in view (used by sync mode)
  function setEntry(e, scrollLine) {
    if (e === entry && scrollLine === undefined) return;
    const changed = e !== entry;
    entry = e;
    const line = e < 0 ? -1 : seq[e];
    const prevLine = activeLine;
    activeLine = line;
    lis.forEach((li, k) => {
      li.classList.toggle('active', k === line);
      li.classList.toggle('past', k < line); // on a repeat, lines after it light back up as "to come"
    });
    $('verseLabel').textContent = label(e);
    $('pillText').textContent = line < 0 ? item.native : T.lines[line].text;
    if (changed && performance.now() > userScrollUntil) {
      const target = scrollLine ?? line;
      scrollToLine(target, Math.abs(target - prevLine) < 14);
    }
  }

  // ---------- main loop ----------
  let adShown = false;
  let wasPlaying = false;
  let dragFrac = null;   // 0–1 while the seek dot is being dragged
  function tick() {
    if (player && item) {
      const t = player.time();
      const dur = player.duration();
      // estimates were spread over a guessed length: redo them once the real length is known
      if (estimatedFor != null && dur > 1 && Math.abs(dur - estimatedFor) > 1 && !sync) {
        times = estimate(seq, dur); estimatedFor = dur; entry = -2;
      }
      const ad = player.adPlaying && player.adPlaying();
      if (ad && !adShown) toast('An ad is playing on YouTube — the lyrics will continue when it ends.', 6000);
      adShown = ad;
      if (sync && !player.playing() && t >= dur - 0.5) finishSync(); // recording ended mid-sync
      // with looping off, a slokam that plays to the end is followed by the next one
      const nowPlaying = player.playing();
      if (wasPlaying && !nowPlaying && !sync && !S.loop && dur > 1 && t >= dur - 1) {
        wasPlaying = false;
        stepTrack(1, true);
        return requestAnimationFrame(tick);
      }
      wasPlaying = nowPlaying;
      if (sync) {
        const targetLine = seq[sync.next];
        if (sync.shown !== sync.next) {
          sync.shown = sync.next;
          entry = -2; // force refresh
          setEntry(sync.next - 1, targetLine ?? undefined);
          lis.forEach((li, k) => li.classList.toggle('target', k === targetLine));
          $('syncNext').textContent = sync.next < seq.length ? 'Next: ' + label(sync.next) : '';
        }
      } else {
        const e = entryAt(t);
        setEntry(e);
        if (e >= 0) {
          const end = e + 1 < times.length ? t0(e + 1) : Math.min(t0(e) + 6, dur);
          const p = Math.max(0, Math.min(1, (t - t0(e)) / Math.max(0.3, end - t0(e))));
          lis[seq[e]].style.setProperty('--p', (p * 100).toFixed(2) + '%');
        }
      }
      if (player.playing() !== document.body.classList.contains('playing')) updatePlayButtons();
      $('time').textContent = fmt(t);
      $('duration').textContent = fmt(dur);
      // while the dot is being dragged, show where it is rather than where playback is
      const frac = dragFrac != null ? dragFrac : (dur > 0 ? t / dur : 0);
      $('progressFill').style.width = (100 * frac).toFixed(2) + '%';
      $('progressKnob').style.left = (100 * frac).toFixed(2) + '%';
      if (dragFrac != null) $('time').textContent = fmt(dragFrac * dur);
    }
    requestAnimationFrame(tick);
  }

  function updatePlayButtons() {
    const on = !!(player && player.playing());
    const icon = on ? '❚❚' : '▶';
    document.body.classList.toggle('playing', on);
    $('btnPlay').textContent = icon; $('pillPlay').textContent = icon;
  }
  function togglePlay() { if (!player) return; player.playing() ? player.pause() : player.play(); setTimeout(updatePlayButtons, 50); }
  function jumpLine(d) {
    if (!player) return;
    const base = entry < 0 ? -1 : entry;
    const target = Math.max(0, Math.min(times.length - 1, base + d));
    // "previous" restarts the current line if we're more than 2s into it
    const e = d < 0 && entry >= 0 && player.time() - t0(entry) > 2 ? entry : target;
    player.seek(t0(e) + 0.01); userScrollUntil = 0;
    setEntry(e); // update now so quick repeated presses keep stepping
  }

  // ---------- sync mode ----------
  // Walks the timeline in playback order (repeats included). Space marks the start of the
  // highlighted line; S skips it if the recording doesn't actually say it there.
  // resume = carry on from where a partial sync stopped, keeping the lines already marked
  function startSync(resume) {
    if (!player) return;
    closeSheet();
    const done = resume === true ? syncedCount() : 0;
    sync = { next: done, marks: times.slice(0, done).map((t, k) => t0(k)), shown: -1 };
    document.body.classList.add('syncing');
    $('syncBanner').classList.remove('hidden');
    player.loop = false;
    // replay from the start of the last line already marked, so the next one can be caught as it begins
    player.seek(done > 0 ? t0(done - 1) : 0); player.play();
    userScrollUntil = 0;
  }
  // how many lines at the start of the timeline have been marked by hand, for a partial sync
  function syncedCount() {
    const m = mine();
    if (!Array.isArray(m.timings) || m.full !== false) return 0;
    return Math.min(m.synced || 0, seq.length);
  }
  function lastMark() {
    for (let k = sync.marks.length - 1; k >= 0; k--) if (sync.marks[k] != null) return sync.marks[k];
    return null;
  }
  function mark() {
    if (!sync) return;
    const prev = lastMark();
    sync.marks[sync.next] = prev == null ? player.time() : Math.max(player.time(), prev + 0.1);
    sync.next++;
    if (sync.next >= seq.length) finishSync();
  }
  function skip() {
    if (!sync) return;
    sync.marks[sync.next] = null;
    sync.next++;
    if (sync.next >= seq.length) finishSync();
  }
  function undoMark() {
    if (!sync || sync.next === 0) return;
    const wasMark = sync.marks[sync.next - 1] != null;
    sync.next--; sync.marks.length = sync.next;
    // replay from the start of the last kept line so the redone mark lands after it
    if (wasMark) player.seek(lastMark() ?? 0);
  }
  function finishSync(discard) {
    if (!sync) return;
    const n = sync.marks.length;
    const total = seq.length;
    const skipped = sync.marks.filter((m) => m == null).length;
    if (n > 0 && !discard) {
      const newSeq = [], newTimes = [];
      let delta = 0;
      for (let k = 0; k < n; k++) {
        if (sync.marks[k] == null) continue; // skipped: not in this recording
        newSeq.push(seq[k]); newTimes.push(sync.marks[k]);
        delta = sync.marks[k] - t0(k);
      }
      // shift the not-yet-synced lines so they keep their relative spacing
      for (let k = n; k < seq.length; k++) { newSeq.push(seq[k]); newTimes.push(t0(k) + delta); }
      seq = newSeq;
      times = newTimes.map((t) => Math.round(t * 100) / 100);
      estimatedFor = null;
      const marked = sync.marks.filter((m) => m != null).length;
      saveMine({ timings: times, seq, offset: 0, rev: revision(), synced: marked, full: n === total });
      markVerses();
      $('offVal').textContent = '0.0s';
      toast((n === total ? 'Timings saved for every line ✓' : `Saved ${n} of ${total} lines — run Sync again later to finish.`)
        + (skipped ? ` Skipped ${skipped} line${skipped > 1 ? 's' : ''} not in the recording.` : ''));
    }
    sync = null;
    document.body.classList.remove('syncing');
    $('syncBanner').classList.add('hidden');
    lis.forEach((li) => li.classList.remove('target'));
    entry = -2;
    if (player) player.loop = !!S.loop;
    updateTimingNote();
  }

  // ---------- settings sheet ----------
  function applyLook() {
    document.documentElement.style.setProperty('--bg-a', S.opacity);
    document.documentElement.style.setProperty('--scale', S.font);
    document.body.classList.toggle('show-video', !!S.video);
    if (item) $('offVal').textContent = (offset() >= 0 ? '+' : '') + offset().toFixed(1) + 's';
    if (player) {
      player.loop = !!S.loop && !sync;
      if (player.show) player.show(!!S.video);
    }
    entry = -2; // refresh pill text
  }
  function updateTimingNote() {
    const part = syncedCount();
    $('btnResume').classList.toggle('hidden', !part);
    if (part) $('btnResume').textContent = `Resume sync (${part} of ${seq.length} lines done)`;
    if (part) { $('timingNote').textContent = `${item.iast} is partly synced: ${part} of ${seq.length} lines. “Resume sync” carries on from there (or press R).`; return; }
    $('timingNote').textContent = estimatedFor == null
      ? `Using your synced timings for ${item.iast}.`
      : `Timings for ${item.iast} are estimates. Use “Sync timings” once — tap Space as each line begins — to make them exact.`;
  }
  function openSheet() {
    closeLibrary();
    $('optOpacity').value = S.opacity; $('optFont').value = S.font; $('optVideo').checked = !!S.video; $('optLoop').checked = !!S.loop; $('optAnadhyayanam').checked = !!S.anadhyayanam; $('optMargazhi').checked = !!S.margazhi;
    $('margazhiRow').classList.toggle('hidden', !S.anadhyayanam);
    updateTimingNote();
    $('sheet').classList.remove('hidden');
  }
  function closeSheet() { $('sheet').classList.add('hidden'); }

  // ---------- library menu ----------
  function buildLibrary() {
    const list = $('libList'); list.innerHTML = '';
    LIB.forEach((cat) => {
      // each category in its own section, so its sticky heading only stays pinned while it's in view
      const sec = document.createElement('section');
      sec.className = 'lib-section';
      list.appendChild(sec);
      const h = document.createElement('div');
      h.className = 'lib-cat';
      // original script (Tamil or Devanagari) first, IAST under it
      const [main, sub] = [cat.native, cat.iast];
      h.innerHTML = `<span class="lib-main"></span><span class="lib-sub"></span>`;
      h.children[0].textContent = main; h.children[1].textContent = sub;
      h.children[0].lang = cat.lang;
      sec.appendChild(h);
      cat.items.forEach((it) => {
        const b = document.createElement('button');
        b.className = 'lib-item' + (it.available ? '' : ' soon') + (isOff(it) ? ' off' : '') + (item && it.id === item.id ? ' current' : '');
        b.disabled = !canPlay(it);
        if (isOff(it)) b.title = 'Anadhyayanam mode is on (⚙ Settings)';
        const [m, s] = [it.native, it.iast];
        b.innerHTML = '<span class="lib-n"></span><span class="lib-names"><span class="lib-main"></span><span class="lib-sub"></span></span><span class="lib-tag"></span>';
        b.querySelector('.lib-n').textContent = it.n;
        b.querySelector('.lib-main').textContent = m;
        b.querySelector('.lib-sub').textContent = s;
        b.querySelector('.lib-main').lang = cat.lang;
        b.querySelector('.lib-tag').textContent = !it.available ? 'soon' : isOff(it) ? '' : (item && it.id === item.id ? '♪' : '');
        const st = isSynced(it);
        if (st) {
          const ok = document.createElement('span');
          ok.className = 'lib-synced ' + st; ok.textContent = '✓';
          ok.title = st === 'full' ? 'Timings synced' : 'Partly synced: open it and press R (or ⚙ → Resume sync) to carry on';
          b.querySelector('.lib-tag').before(ok);
        }
        if (canPlay(it)) b.onclick = () => { closeLibrary(); selectSlokam(it.id, { play: true }); };
        sec.appendChild(b);
      });
    });
  }
  // a work you've synced by hand: timings saved for the current revision of its text
  function isSynced(it) {
    const m = S.slokams[it.id];
    const t = TEXTS[it.text];
    if (!(m && Array.isArray(m.timings) && m.timings.length && t && (m.rev || 1) === (t.revision || 1))) return null;
    return m.full === false ? 'partial' : 'full';
  }
  function openLibrary() {
    closeSheet(); buildLibrary();
    $('library').classList.remove('hidden');
    const cur = $('libList').querySelector('.current');
    if (cur) cur.scrollIntoView({ block: 'center' });
  }
  function closeLibrary() { $('library').classList.add('hidden'); }

  // ---------- full screen / compact ----------
  const isFull = () => document.body.classList.contains('fullscreen');
  function applyFullscreen(on) {
    document.body.classList.toggle('fullscreen', on);
    $('btnFull').textContent = on ? '🗗' : '⛶';
    $('btnFull').title = on ? 'Exit full screen (F or Esc)' : 'Full screen (F)';
    entry = -2; activeLine = -2; // re-highlight and re-scroll for the new layout
  }
  const toggleFullscreen = () => store.setFullscreen(!isFull());

  function applyCompact(on) {
    document.body.classList.toggle('compact', on);
    if (!on) { entry = -2; activeLine = -2; } // next frame re-highlights and scrolls to the current line
  }

  // ---------- wire up ----------
  function bind() {
    $('btnPlay').onclick = togglePlay; $('pillPlay').onclick = togglePlay;
    $('btnPrev').onclick = () => prevTrack(); $('btnNext').onclick = () => nextTrack();
    $('btnPrev').addEventListener('mouseenter', showPrevPreview);
    $('btnPrev').addEventListener('mouseleave', () => $('prevPreview').classList.add('hidden'));
    $('btnPrev').addEventListener('click', () => $('prevPreview').classList.add('hidden'));
    $('btnNext').addEventListener('mouseenter', showNextPreview);
    $('btnNext').addEventListener('mouseleave', () => $('nextPreview').classList.add('hidden'));
    $('btnNext').addEventListener('click', () => $('nextPreview').classList.add('hidden'));
    $('btnShuffle').onclick = () => { save({ shuffle: !S.shuffle }); upcoming = null; applyShuffle(); toast(S.shuffle ? 'Shuffle on: ⏭ and the next slokam after one ends are picked at random.' : 'Shuffle off.', 2500); };
    $('btnMin').onclick = () => store.setCompact(true);
    $('btnFull').onclick = toggleFullscreen;
    $('btnRestore').onclick = () => store.setCompact(false);
    $('pillText').ondblclick = () => store.setCompact(false);
    $('btnClose').onclick = () => store.hide();
    $('btnLibrary').onclick = () => ($('library').classList.contains('hidden') ? openLibrary() : closeLibrary());
    $('btnLibClose').onclick = closeLibrary;
    $('btnSettings').onclick = () => ($('sheet').classList.contains('hidden') ? openSheet() : closeSheet());
    $('btnSheetClose').onclick = closeSheet;
    $('optOpacity').oninput = (e) => { save({ opacity: +e.target.value }); applyLook(); };
    $('optFont').oninput = (e) => { save({ font: +e.target.value }); applyLook(); };
    $('optVideo').onchange = (e) => { save({ video: e.target.checked }); applyLook(); };
    $('optLoop').onchange = (e) => { save({ loop: e.target.checked }); applyLook(); };
    function modeChanged(msg) {
      upcoming = null;
      $('margazhiRow').classList.toggle('hidden', !S.anadhyayanam);
      if (isOff(item)) {
        // the Divya Prabandham that's open now can't play: move on to the next slokam that can
        const next = step(1);
        if (player) player.pause();
        selectSlokam(next.id);
        toast(`${msg} ${item.iast} is up instead.`, 5000);
      } else toast(msg, 3500);
    }
    $('optAnadhyayanam').onchange = (e) => {
      save({ anadhyayanam: e.target.checked });
      modeChanged(!e.target.checked ? 'Anadhyayanam mode off.'
        : S.margazhi ? 'Anadhyayanam mode, Mārgaḻi: only Tiruppāvai and Tiruppaḷḷiyezucci of the Divya Prabandhams will play.'
          : 'Anadhyayanam mode: the Divya Prabandhams won’t play.');
    };
    $('optMargazhi').onchange = (e) => {
      save({ margazhi: e.target.checked });
      modeChanged(e.target.checked ? 'Mārgaḻi mode: Tiruppāvai and Tiruppaḷḷiyezucci can play.'
        : 'Mārgaḻi mode off: no Divya Prabandhams.');
    };
    $('offMinus').onclick = () => { saveMine({ offset: Math.round((offset() - 0.5) * 10) / 10 }); applyLook(); };
    $('offPlus').onclick = () => { saveMine({ offset: Math.round((offset() + 0.5) * 10) / 10 }); applyLook(); };
    $('btnSync').onclick = () => startSync(false);
    $('btnResume').onclick = () => startSync(true);
    $('btnMark').onclick = mark;
    $('btnSkip').onclick = skip;
    $('btnReset').onclick = () => {
      saveMine({ timings: null, seq: null, offset: 0 }); loadTimings(); markVerses(); applyLook(); updateTimingNote();
      toast('Timings reset to the built-in estimates.');
    };
    $('btnQuit').onclick = () => store.quit();

    // seek: click anywhere on the line, or drag the dot
    const bar = $('progress');
    const fracAt = (e) => { const r = bar.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
    bar.addEventListener('pointerdown', (e) => {
      if (!player) return;
      bar.setPointerCapture(e.pointerId);
      dragFrac = fracAt(e); bar.classList.add('dragging');
    });
    bar.addEventListener('pointermove', (e) => { if (dragFrac != null) dragFrac = fracAt(e); });
    const endDrag = (e) => {
      if (dragFrac == null) return;
      const f = e.type === 'pointerup' ? fracAt(e) : dragFrac;
      dragFrac = null; bar.classList.remove('dragging');
      if (player) player.seek(f * player.duration());
      userScrollUntil = 0;
    };
    bar.addEventListener('pointerup', endDrag);
    bar.addEventListener('pointercancel', endDrag);
    $('viewport').addEventListener('wheel', () => { userScrollUntil = performance.now() + 4000; }, { passive: true });

    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (sync) {
        if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); mark(); }
        else if (e.code === 'KeyS') { e.preventDefault(); skip(); }
        else if (e.code === 'Backspace') { e.preventDefault(); undoMark(); }
        else if (e.code === 'Escape') finishSync();
        return;
      }
      switch (e.code) {
        case 'Space': e.preventDefault(); togglePlay(); break;
        case 'ArrowUp': e.preventDefault(); jumpLine(-1); break;
        case 'ArrowDown': e.preventDefault(); jumpLine(1); break;
        case 'ArrowLeft': prevTrack(); break;
        case 'ArrowRight': nextTrack(); break;
        case 'KeyM': store.setCompact(!document.body.classList.contains('compact')); break;
        case 'KeyF': toggleFullscreen(); break;
        case 'KeyL': $('btnLibrary').click(); break;
        case 'KeyN': $('btnSettings').click(); break;
        case 'KeyR': if (syncedCount()) startSync(true); break;
        case 'KeyQ': store.quit(); break;
        case 'Escape':
          if (!$('sheet').classList.contains('hidden')) closeSheet();
          else if (!$('library').classList.contains('hidden')) closeLibrary();
          else if (isFull()) store.setFullscreen(false);
          break;
      }
    });
    store.onCompactChanged(applyCompact);
    store.onFullscreenChanged(applyFullscreen);
    store.onCommand((cmd) => { if (cmd === 'toggle-play') togglePlay(); });
  }

  // ---------- players ----------
  let loadToken = 0, ytTimeout = null;
  const ytApiReady = () => !!(window.YT && window.YT.Player);
  function onLoop() { entry = -2; userScrollUntil = 0; }
  let autoplay = false; // start the next player as soon as it's ready (after ⏮ / ⏭ while playing)
  function adopt(p) {
    // only parts of a longer recording (Vāraṇamāyiram out of all of Nācciyār Tirumoḻi)
    if (item.segments) p = new SegmentPlayer(p, item.segments);
    player = p;
    p.onState = updatePlayButtons; p.onLoop = onLoop; p.loop = !!S.loop && !sync;
    if (autoplay) { autoplay = false; p.play(); }
    updatePlayButtons();
  }
  function dropPlayer() {
    clearTimeout(ytTimeout);
    if (player) { try { player.pause(); } catch {} player.destroy && player.destroy(); }
    player = null;
    document.body.classList.remove('clock-mode', 'page-mode');
    $('videoBox').innerHTML = '<div id="yt"></div>';
    updatePlayButtons();
  }
  function useClock(reason) {
    // with parts of a longer recording, the stopwatch has to reach the end of the last part
    adopt(new ClockPlayer(item.segments ? Math.max(...item.segments.map((x) => x[1])) + 5 : item.duration || 1800));
    document.body.classList.add('clock-mode');
    toast(reason + ' Using a stopwatch instead: press ▶ at the same moment you start the video.', 9000);
  }
  function usePage(token) {
    if (token !== loadToken) return;
    document.body.classList.add('page-mode');
    adopt(new PagePlayer(window.widget.ytPage, item.youtube, item.duration || 0, {
      show: !!S.video,
      onNeedsUser: () => toast('YouTube is showing a page that needs a click (sign-in or cookies). It’s open in a separate window.', 9000),
    }));
    toast('This video can’t be embedded, so it’s playing from the YouTube page in the background. Turn on “Show video” to see it.', 6000);
  }
  function loadPlayer() {
    const token = ++loadToken;
    dropPlayer();
    if (item.audio) {
      // an MP3 recording (prapatti.com) instead of a YouTube video
      // a list of MP3s plays back to back as one track (the Periya Tirumoḻi taniyans, then the decade)
      const ap = new (Array.isArray(item.audio) ? AudioListPlayer : AudioPlayer)(...(Array.isArray(item.audio) ? [item.audio] : [item.audio, item.duration || 0]), {
        onReady: () => { if (token === loadToken) adopt(ap); },
        onError: (code) => { if (token === loadToken) { try { ap.destroy(); } catch {} useClock(`Couldn’t load the recording (error ${code}).`); } },
      });
      return;
    }
    if (!ytApiReady()) {
      ytTimeout = setTimeout(() => { if (token === loadToken && !player) useClock('Couldn’t reach YouTube.'); }, 10000);
      return; // onYouTubeIframeAPIReady calls back here
    }
    ytTimeout = setTimeout(() => { if (token === loadToken && !player) useClock('YouTube didn’t respond.'); }, 15000);
    const yp = new YouTubePlayer('yt', item.youtube, item.duration || 0, {
      onReady: () => { if (token !== loadToken) return; clearTimeout(ytTimeout); adopt(yp); },
      onError: (code) => {
        if (token !== loadToken) return;
        clearTimeout(ytTimeout);
        try { yp.destroy(); } catch {}
        if (player === yp) player = null;
        // 101 / 150 / 153: the uploader doesn't allow embedding — play the YouTube page instead
        if ([101, 150, 152, 153].includes(code) && window.widget && window.widget.ytPage) usePage(token);
        else useClock(`YouTube can’t play the video here (error ${code}).`);
      },
    });
  }
  window.onYouTubeIframeAPIReady = () => { if (item && !item.audio && !player) loadPlayer(); };

  // ---------- choosing a slokam ----------
  // ⏮ / ⏭ step through the playable slokams in menu order, wrapping around at the ends
  const ALL_PLAYABLE = Object.values(ITEMS).filter((it) => it.available).sort((a, b) => a.n - b.n);
  // what ⏮ / ⏭ / shuffle step through: the playable slokams, less the Divya Prabandhams in Anadhyayanam mode
  const playable = () => ALL_PLAYABLE.filter((it) => !isOff(it));
  // the position of the current slokam in that list (or where it would be, if it's left out)
  const posOf = (list, it) => { const k = list.findIndex((x) => x.id === it.id); return k >= 0 ? k : list.findIndex((x) => x.n > it.n) - 0.5; };
  // With shuffle on, "next" is a random other slokam, and "previous" walks back through the ones played.
  const history = [];
  const pruneHistory = () => { for (let k = history.length - 1; k >= 0; k--) if (!canPlay(ITEMS[history[k]])) history.splice(k, 1); };
  // what ⏭ (or the end of a slokam, with looping off) will play next. With shuffle on it's picked
  // ahead of time, so the preview above ⏭ shows what will really play.
  let upcoming = null;
  // the slokam d places before or after the current one, wrapping around at the ends
  function step(d) {
    const list = playable(), k = posOf(list, item), L = list.length;
    const j = Number.isInteger(k) ? k + d : (d > 0 ? Math.ceil(k) : Math.floor(k));
    return list[((j % L) + L) % L];
  }
  function upNext() {
    if (S.shuffle) {
      if (!upcoming || upcoming.id === item.id || isOff(upcoming)) {
        const others = playable().filter((it) => it.id !== item.id);
        upcoming = others[Math.floor(Math.random() * others.length)];
      }
      return upcoming;
    }
    return step(1);
  }
  // what ⏮ will do: restart this slokam when more than 3 s in, otherwise go back to the previous one
  function showPrevPreview() {
    let label, it;
    if (player && player.time() > 3) { label = 'Back to the start'; it = item; }
    else if (S.shuffle && (pruneHistory(), history.length)) { label = 'Previous (shuffle)'; it = ITEMS[history[history.length - 1]]; }
    else {
      label = 'Previous'; it = step(-1);
    }
    $('prevLabel').textContent = label;
    $('prevName').textContent = it.native; $('prevName').lang = it.lang;
    $('prevIast').textContent = it.iast;
    $('prevPreview').classList.remove('hidden');
  }
  function showNextPreview() {
    const n = upNext();
    $('nextName').textContent = n.native;
    $('nextName').lang = n.lang;
    $('nextIast').textContent = n.iast;
    $('nextLabel').textContent = S.shuffle ? 'Up next (shuffle)' : 'Up next';
    $('nextPreview').classList.remove('hidden');
  }
  function stepTrack(d, play) {
    const keepPlaying = play ?? !!(player && player.playing());
    let next;
    if (S.shuffle && d > 0) {
      next = upNext();
      upcoming = null;
    } else if (S.shuffle && d < 0 && (pruneHistory(), history.length)) {
      return selectSlokam(history.pop(), { play: keepPlaying, back: true });
    } else {
      next = step(d);
    }
    selectSlokam(next.id, { play: keepPlaying });
  }
  const nextTrack = () => stepTrack(1);
  function prevTrack() {
    // like a music player: restart the slokam, or go to the previous one if it has only just started
    if (player && player.time() > 3) { player.seek(0); userScrollUntil = 0; entry = -2; }
    else stepTrack(-1);
  }
  function applyShuffle() {
    $('btnShuffle').classList.toggle('on', !!S.shuffle);
    $('btnShuffle').title = S.shuffle ? 'Shuffle is on' : 'Shuffle is off';
  }

  function selectSlokam(id, { play = false, back = false } = {}) {
    if (item && !back && id !== item.id) { history.push(item.id); if (history.length > 50) history.shift(); }
    const it = canPlay(ITEMS[id]) ? ITEMS[id] : canPlay(ITEMS[DEFAULT_ID]) ? ITEMS[DEFAULT_ID] : playable()[0];
    if (sync) finishSync(true);
    item = it; T = TEXTS[it.text];
    save({ current: it.id });
    document.body.dataset.lang = it.lang;
    document.body.dataset.cat = it.cat.id;   // Vēdam lyrics use a font made for svara marks
    $('slokaTitle').textContent = it.native;
    $('slokaTitle').lang = it.lang;
    $('slokaTitle').title = it.iast;
    loadTimings();
    buildLines();
    entry = -2; activeLine = -2;
    setEntry(-1);
    $('viewport').scrollTop = 0;
    applyLook();
    autoplay = play;
    loadPlayer();
    setTimeout(() => { keptNotice = false; }, 0);
    const part = syncedCount();
    if (part && !keptNotice) setTimeout(() => toast(`Partly synced (${part} of ${seq.length} lines). Press R or ⚙ → Resume sync to carry on.`, 6000), 800);
  }

  // ---------- start ----------
  (async () => {
    Object.assign(S, await store.getSettings());
    S.slokams = S.slokams || {};
    // settings from before the library existed belonged to Mummanikkovai
    if (S.timings || S.seq || S.offset) {
      if (!S.slokams.mummanikkovai) S.slokams.mummanikkovai = { timings: S.timings, seq: S.seq, offset: S.offset || 0 };
      save({ slokams: S.slokams, timings: null, seq: null, offset: null });
    }
    bind();
    applyShuffle();
    selectSlokam(S.current || DEFAULT_ID);
    requestAnimationFrame(tick);
  })();
})();
