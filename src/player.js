// Playback sources for the widget.
//  * YouTubePlayer — plays the recording through YouTube's embedded player (exact timing).
//  * PagePlayer    — for videos whose uploader turned embedding off: the Electron main process
//                    plays the normal YouTube page in its own window and reports the position.
//  * AudioPlayer   — an MP3 file played directly (AudioListPlayer: several, back to back).
//  * ClockPlayer   — last-resort stopwatch if YouTube can't be reached; the user presses
//                    play at the same moment they start the video elsewhere.
// All expose: time(), duration(), playing(), play(), pause(), seek(sec), destroy(), and fire onState().
// Set `loop = true` to restart from 0:00 automatically when the recording ends.

class ClockPlayer {
  constructor(duration) {
    this.kind = 'clock';
    this._dur = duration; this._base = 0; this._startedAt = null; this.onState = () => {}; this.loop = true;
  }
  time() {
    let t = this._startedAt == null ? this._base : this._base + (performance.now() - this._startedAt) / 1000;
    if (this.loop && this._startedAt != null && t >= this._dur) {
      this._base = 0; this._startedAt = performance.now(); t = 0;
      this.onLoop && this.onLoop();
    }
    return Math.min(t, this._dur);
  }
  duration() { return this._dur; }
  playing() { return this._startedAt != null && this.time() < this._dur; }
  play() { if (this._startedAt == null) { this._startedAt = performance.now(); this.onState(); } }
  pause() { if (this._startedAt != null) { this._base = this.time(); this._startedAt = null; this.onState(); } }
  seek(t) { this._base = Math.max(0, Math.min(t, this._dur)); if (this._startedAt != null) this._startedAt = performance.now(); this.onState(); }
  destroy() { this._startedAt = null; }
}

class AudioPlayer {
  // a plain audio file (MP3), e.g. from prapatti.com/slokas/mp3/
  constructor(url, duration, { onReady, onError }) {
    this.kind = 'audio';
    this._dur = duration; this.onState = () => {}; this.loop = true;
    this.a = new Audio(); this.a.preload = 'auto'; this.a.src = url;
    this.a.addEventListener('loadedmetadata', () => { if (this.a.duration) this._dur = this.a.duration; onReady && onReady(); }, { once: true });
    this.a.addEventListener('error', () => onError && onError(this.a.error ? this.a.error.code : 0), { once: true });
    this.a.addEventListener('play', () => this.onState());
    this.a.addEventListener('pause', () => this.onState());
    this.a.addEventListener('ended', () => {
      if (this.loop) { this.a.currentTime = 0; this.a.play(); this.onLoop && this.onLoop(); }
      else this.onState();
    });
  }
  time() { return this.a.currentTime || 0; }
  duration() { return this.a.duration || this._dur; }
  playing() { return !this.a.paused && !this.a.ended; }
  play() { const r = this.a.play(); if (r && r.catch) r.catch(() => {}); }
  pause() { this.a.pause(); }
  seek(t) { this.a.currentTime = Math.max(0, Math.min(t, this.duration() || t)); }
  destroy() { this.a.pause(); this.a.removeAttribute('src'); this.a.load(); }
}

class AudioListPlayer {
  // several MP3 files played back to back as one track: e.g. the Periya Tirumoḻi taniyans and then
  // a decade (aṅgaṇ ñālam), each a separate recording. Time, length, seeking and looping are all in
  // the joined-up time.
  constructor(urls, { onReady, onError }) {
    this.kind = 'audio'; this.loop = true; this.onState = () => {};
    this.i = 0; this._switching = false;
    this.parts = urls.map((u) => { const a = new Audio(); a.preload = 'auto'; a.src = u; return a; });
    let pending = this.parts.length;
    this.parts.forEach((a, k) => {
      a.addEventListener('loadedmetadata', () => { if (--pending === 0) onReady && onReady(); }, { once: true });
      a.addEventListener('error', () => onError && onError(a.error ? a.error.code : 0), { once: true });
      a.addEventListener('play', () => { if (k === this.i) this.onState(); });
      a.addEventListener('pause', () => { if (k === this.i && !this._switching) this.onState(); });
      a.addEventListener('ended', () => this._ended(k));
    });
  }
  _off(k) { let o = 0; for (let j = 0; j < k; j++) o += this.parts[j].duration || 0; return o; }
  _start(a) { const r = a.play(); if (r && r.catch) r.catch(() => {}); }
  _ended(k) {
    if (k !== this.i) return;
    if (k + 1 < this.parts.length) {           // on to the next recording
      this._switching = true; this.i = k + 1;
      const n = this.parts[this.i]; n.currentTime = 0; this._start(n);
      this._switching = false;
    } else if (this.loop) {
      this.i = 0; const n = this.parts[0]; n.currentTime = 0; this._start(n);
      this.onLoop && this.onLoop();
    } else this.onState();
  }
  time() { return this._off(this.i) + (this.parts[this.i].currentTime || 0); }
  duration() { return this._off(this.parts.length); }
  playing() { const a = this.parts[this.i]; return !a.paused && !a.ended; }
  play() {
    if (this.i === this.parts.length - 1 && this.parts[this.i].ended) this.seek(0);
    this._start(this.parts[this.i]);
  }
  pause() { this.parts.forEach((a) => a.pause()); }
  seek(t) {
    t = Math.max(0, Math.min(t, this.duration() - 0.05));
    let k = 0;
    while (k < this.parts.length - 1 && t >= this._off(k + 1)) k++;
    const was = this.playing();
    if (k !== this.i) { this._switching = true; this.parts[this.i].pause(); this.i = k; this._switching = false; }
    this.parts[k].currentTime = t - this._off(k);
    if (was) this._start(this.parts[k]);
  }
  destroy() { this.parts.forEach((a) => { a.pause(); a.removeAttribute('src'); a.load(); }); }
}

class PagePlayer {
  // `api` is window.widget.ytPage from the preload script
  constructor(api, videoId, duration, { show, onNeedsUser }) {
    this.kind = 'page';
    this.api = api; this._dur = duration; this.onState = () => {}; this.loop = true;
    this._t = 0; this._at = performance.now(); this._paused = true; this._ad = false; this._dead = false;
    this._unsub = api.onState((st) => {
      if (this._dead) return;
      if (st.needsUser) return onNeedsUser && onNeedsUser();
      if (!st.found) return;
      const wasPlaying = this.playing();
      this._ad = st.ad;
      if (!st.ad) {
        if (st.d) this._dur = st.d;
        this._t = st.t; this._at = performance.now(); this._paused = st.paused;
        if ((st.ended || (st.d && st.t >= st.d - 0.25)) && !st.paused && this.loop) {
          this.seek(0); this.play(); this.onLoop && this.onLoop();
        }
      }
      if (wasPlaying !== this.playing()) this.onState();
    });
    api.open(videoId, show);
  }
  time() {
    if (this._paused || this._ad) return this._t;
    return Math.min(this._t + Math.min((performance.now() - this._at) / 1000, 0.5), this._dur);
  }
  duration() { return this._dur; }
  playing() { return !this._paused && !this._ad; }
  adPlaying() { return this._ad; }
  play() { this.api.cmd('play'); this._paused = false; this._at = performance.now(); this.onState(); }
  pause() { this.api.cmd('pause'); this._t = this.time(); this._paused = true; this.onState(); }
  seek(t) { t = Math.max(0, t); this.api.cmd('seek', t); this._t = t; this._at = performance.now(); }
  show(on) { this.api.cmd('show', on); }
  destroy() { this._dead = true; if (typeof this._unsub === 'function') this._unsub(); this.api.close(); }
}

class YouTubePlayer {
  constructor(elementId, videoId, duration, { onReady, onError }) {
    this.kind = 'youtube';
    this._dur = duration; this._ready = false; this.onState = () => {}; this.loop = true;
    // getCurrentTime() only updates every ~100-250 ms; interpolate between updates for smooth highlighting
    this._lastT = 0; this._lastAt = performance.now(); this._state = -1;
    this.p = new YT.Player(elementId, {
      videoId,
      width: 320, height: 180,
      playerVars: { autoplay: 0, controls: 1, rel: 0, playsinline: 1, modestbranding: 1, origin: location.origin },
      events: {
        onReady: () => { this._ready = true; const d = this.p.getDuration(); if (d) this._dur = d; onReady && onReady(); },
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.ENDED && this.loop) {
            this.p.seekTo(0, true); this.p.playVideo();
            this._lastT = 0; this._lastAt = performance.now();
            this.onLoop && this.onLoop();
            return;
          }
          this._state = e.data; this._sample(true); this.onState();
        },
        onError: (e) => onError && onError(e.data),
      },
    });
  }
  _sample(force) {
    if (!this._ready) return;
    const t = this.p.getCurrentTime() || 0;
    if (force || t !== this._lastT) { this._lastT = t; this._lastAt = performance.now(); }
  }
  time() {
    if (!this._ready) return 0;
    this._sample(false);
    if (this._state !== YT.PlayerState.PLAYING) return this._lastT;
    const extra = (performance.now() - this._lastAt) / 1000;
    return this._lastT + Math.min(extra, 0.5);
  }
  duration() { return this._dur; }
  playing() { return this._state === 1 || this._state === 3; }
  play() { this._ready && this.p.playVideo(); }
  pause() { this._ready && this.p.pauseVideo(); }
  seek(t) { if (this._ready) { this.p.seekTo(Math.max(0, t), true); this._lastT = t; this._lastAt = performance.now(); } }
  destroy() { try { this.p.destroy(); } catch {} }
}

class SegmentPlayer {
  // Plays only some parts of a longer recording, back to back, as if they were one track:
  // e.g. Vāraṇamāyiram's taniyan (0:00–0:20) and pāsurams (21:37–25:06) out of the whole of
  // Nācciyār Tirumoḻi. `segs` is [[start, end], …] in seconds of the real recording. Time, length,
  // seeking and looping are all in the joined-up ("virtual") time.
  constructor(inner, segs) {
    this.inner = inner; this.kind = inner.kind;
    this.segs = segs.map(([a, b]) => ({ a, b }));
    let off = 0;
    for (const s of this.segs) { s.off = off; off += s.b - s.a; }
    this._dur = off; this._ended = false; this.loop = true; this.onState = () => {};
    inner.loop = false;
    inner.onState = () => this.onState();
    inner.onLoop = null;
  }
  _segAt(r) { // the part a real time falls in (or the next one, if it's in a gap)
    for (let i = 0; i < this.segs.length; i++) if (r < this.segs[i].b) return i;
    return this.segs.length;
  }
  time() {
    if (this._ended) return this._dur;
    const r = this.inner.time();
    const i = this._segAt(r);
    if (i >= this.segs.length) {
      // past the end of the last part: the "track" is over
      if (this.inner.playing()) {
        if (this.loop) { this.seek(0); this.onLoop && this.onLoop(); return 0; }
        this.inner.pause(); this._ended = true; this.onState();
      }
      return this._dur;
    }
    const s = this.segs[i];
    if (r < s.a - 0.25) {
      // in a gap before this part (or before the first): jump to where it starts
      if (this.inner.playing()) this.inner.seek(s.a);
      return s.off;
    }
    return s.off + Math.max(0, r - s.a);
  }
  duration() { return this._dur; }
  playing() { return !this._ended && this.inner.playing(); }
  play() { if (this._ended) { this._ended = false; this.seek(0); } this.inner.play(); }
  pause() { this.inner.pause(); }
  seek(v) {
    v = Math.max(0, Math.min(v, this._dur - 0.05));
    this._ended = false;
    const s = this.segs.find((x) => v < x.off + (x.b - x.a)) || this.segs[this.segs.length - 1];
    this.inner.seek(s.a + (v - s.off));
  }
  adPlaying() { return this.inner.adPlaying ? this.inner.adPlaying() : false; }
  show(on) { if (this.inner.show) this.inner.show(on); }
  destroy() { this.inner.destroy && this.inner.destroy(); }
}
