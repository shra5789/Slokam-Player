/* Slokam Player — Samsung Smart TV (Tizen) layer.
 *
 * Loaded before the shared src/app.js on the TV page that tv/build.js makes from src/index.html. It
 *  - stands in for the Electron bridge (window.widget): settings in the TV's localStorage, always full
 *    screen, "Quit" exits the Tizen app — and it offers no YouTube page player (that needs Electron), so
 *    videos that can't be embedded fall back to the shared stopwatch, with a notice;
 *  - drives everything from the remote: D-pad focus movement, Enter, Back (10009, or Escape in a
 *    browser), and the media keys, registered through tizen.tvinputdevice;
 *  - never syncs: the TV only plays, with each text's estimated timings. The sync and timing controls
 *    stay in the shared page (the Windows app uses them) but are hidden here, and their keys do nothing.
 *
 * Written for older TV web engines too (Tizen 5.5, Chromium 69): no ?. or ??, no class fields.
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var body = document.body;
  var app = function () { return window.SlokamApp; };   // set by app.js
  var noop = function () {};

  // ---------- the bridge app.js would get from Electron ----------
  function loadSettings() { try { return JSON.parse(localStorage.getItem('mmk') || '{}'); } catch (e) { return {}; } }
  function exitApp() {
    try { window.tizen.application.getCurrentApplication().exit(); }
    catch (e) { window.tvExitRequested = true; }   // in a browser there's nothing to exit
  }
  window.widget = {
    getSettings: function () { return Promise.resolve(loadSettings()); },
    setSettings: function (patch) {
      try {
        var s = loadSettings();
        Object.keys(patch).forEach(function (k) { s[k] = patch[k]; });
        localStorage.setItem('mmk', JSON.stringify(s));
      } catch (e) { /* storage full or blocked: settings last until the app closes */ }
    },
    setCompact: noop, hide: noop, quit: exitApp,
    setFullscreen: noop,                                       // always full screen
    onFullscreenChanged: function (fn) { fn(true); },
    onCompactChanged: noop, onCommand: noop,
    // no ytPage: there's no page player on the TV
  };

  // ---------- remote keys ----------
  var MEDIA = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind',
    'MediaTrackNext', 'MediaTrackPrevious', 'ChannelUp', 'ChannelDown'];
  // Tizen's key codes (replaced by tizen.tvinputdevice's own where it has them)
  var CODES = {
    MediaPlayPause: 10252, MediaPlay: 415, MediaPause: 19, MediaStop: 413, MediaFastForward: 417,
    MediaRewind: 412, MediaTrackNext: 10233, MediaTrackPrevious: 10232, ChannelUp: 427, ChannelDown: 428,
  };
  try {
    var tid = window.tizen && window.tizen.tvinputdevice;
    if (tid) {
      MEDIA.forEach(function (name) {
        try { tid.registerKey(name); var k = tid.getKey(name); if (k && k.code) CODES[name] = k.code; } catch (e) { /* not on this remote */ }
      });
    }
  } catch (e) { /* not on a TV */ }
  var BACK = 10009;
  function keyName(e) {
    if (e.keyCode === BACK || e.key === 'Escape' || e.key === 'XF86Back' || e.key === 'GoBack') return 'Back';
    if (MEDIA.indexOf(e.key) >= 0) return e.key;
    for (var n in CODES) if (CODES[n] === e.keyCode) return n;
    if (e.keyCode === 179) return 'MediaPlayPause';
    if (e.key === 'MediaTrackPrevious' || e.key === 'MediaTrackNext') return e.key;
    var arrows = { 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown', 13: 'Enter' };
    return arrows[e.keyCode] || e.key;
  }

  // ---------- focus ----------
  var SELECT = 'button, input, [data-tv-focus]';
  function openSheet() {
    if (!$('library').classList.contains('hidden')) return $('library');
    if (!$('sheet').classList.contains('hidden')) return $('sheet');
    return null;
  }
  function shown(el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  // what the D-pad can reach: an open sheet's controls, or else the main screen's
  function focusables(scope) {
    var all = (scope || $('panel')).querySelectorAll(SELECT);
    return Array.prototype.filter.call(all, function (el) {
      if (el.disabled) return false;
      if (!scope && el.closest('.sheet, .pill, .video-box, #syncBanner')) return false;
      return shown(el);
    });
  }
  function focusEl(el) {
    if (!el) return;
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    if (el.closest('.lib-list, .sheet')) {
      try { el.scrollIntoView({ block: 'center' }); } catch (e) { el.scrollIntoView(false); }
    }
  }
  var gap = function (a1, a2, b1, b2) { return b2 < a1 ? a1 - b2 : b1 > a2 ? b1 - a2 : 0; };
  // The next control in that direction. ↑ / ↓ go to the nearest row (controls within 24 px of the
  // closest one) and pick the one in it most nearly in line; ← / → stay within the row (controls
  // that overlap vertically) and take the nearest. Nothing there: the focus stays put.
  function move(dir) {
    var scope = openSheet(), list = focusables(scope), cur = document.activeElement;
    if (list.indexOf(cur) < 0) return focusDefault();
    var a = cur.getBoundingClientRect(), acx = a.left + a.width / 2, acy = a.top + a.height / 2;
    var vertical = dir === 'ArrowUp' || dir === 'ArrowDown';
    var cands = [];
    list.forEach(function (el) {
      if (el === cur) return;
      var b = el.getBoundingClientRect(), bcx = b.left + b.width / 2, bcy = b.top + b.height / 2;
      var along, side;
      if (dir === 'ArrowDown') { if (bcy <= acy + 1) return; along = b.top - a.bottom; }
      else if (dir === 'ArrowUp') { if (bcy >= acy - 1) return; along = a.top - b.bottom; }
      else if (dir === 'ArrowRight') { if (bcx <= acx + 1) return; along = b.left - a.right; }
      else { if (bcx >= acx - 1) return; along = a.left - b.right; }
      if (vertical) side = gap(a.left, a.right, b.left, b.right) + 0.01 * Math.abs(bcx - acx);
      else { if (gap(a.top, a.bottom, b.top, b.bottom) > 0) return; side = Math.abs(bcy - acy); }
      cands.push({ el: el, along: Math.max(0, along), side: side });
    });
    if (!cands.length) return;
    var nearest = Math.min.apply(null, cands.map(function (c) { return c.along; }));
    var row = cands.filter(function (c) { return c.along <= nearest + 24; });
    row.sort(function (x, y) { return vertical ? x.side - y.side || x.along - y.along : x.along - y.along || x.side - y.side; });
    focusEl(row[0].el);
  }
  var opener = null;
  function focusDefault() {
    var s = openSheet();
    if (s === $('library')) {
      var cur = $('libList').querySelector('.lib-item.current:not(:disabled)');
      return focusEl(cur || $('libList').querySelector('.lib-item:not(:disabled)') || $('btnLibClose'));
    }
    if (s) return focusEl(focusables(s).filter(function (el) { return el.id !== 'btnSheetClose'; })[0] || $('btnSheetClose'));
    focusEl(opener && shown(opener) ? opener : $('btnPlay'));
  }
  // after a key: a sheet that just opened gets the focus, one that just closed gives it back
  var lastScope = null;
  function settle() {
    var s = openSheet();
    if (s !== lastScope) {
      if (s && !lastScope) opener = document.activeElement;
      lastScope = s;
      focusDefault();
      if (!s) opener = null;
    } else if (focusables(s).indexOf(document.activeElement) < 0) focusDefault();
  }

  // ---------- controls fade while playing; any key brings them back ----------
  var idleTimer = null;
  function wake() {
    var wasIdle = body.classList.contains('tv-idle');
    body.classList.remove('tv-idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      if (!openSheet() && app() && app().playing()) body.classList.add('tv-idle');
    }, 6000);
    return wasIdle && body.classList.contains('playing');
  }

  function activate(el) {
    if (!el || el.disabled) return;
    if (el.id === 'progress') return app() && app().togglePlay();
    if (el.type === 'range') return;
    if (el.classList.contains('lib-item')) opener = $('btnPlay');   // a work picked: back to Play
    el.click();   // buttons, and checkboxes (Enter doesn't tick a checkbox by itself)
  }
  function stepRange(el, d) {
    if (d > 0) el.stepUp(); else el.stepDown();
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  window.addEventListener('keydown', function (e) {
    // every key stops here: app.js's desktop keys (sync marks, R, F, M, Q, arrows for lines/tracks) don't apply
    e.stopPropagation();
    var k = keyName(e), A = app(), el = document.activeElement, sheet = openSheet();
    var media = {
      MediaPlayPause: function () { A.togglePlay(); }, MediaPlay: function () { A.play(); },
      MediaPause: function () { A.pause(); }, MediaStop: function () { A.stop(); },
      MediaFastForward: function () { A.seekBy(10); }, MediaRewind: function () { A.seekBy(-10); },
      MediaTrackNext: function () { A.nextTrack(); }, MediaTrackPrevious: function () { A.prevTrack(); },
      ChannelUp: function () { A.jumpLine(-1); }, ChannelDown: function () { A.jumpLine(1); },
    };
    if (media[k]) { e.preventDefault(); if (A) media[k](); wake(); return; }
    if (k === 'Back') {
      e.preventDefault(); wake();
      if (sheet) { (sheet.id === 'library' ? $('btnLibClose') : $('btnSheetClose')).click(); settle(); }
      else exitApp();
      return;
    }
    var nav = k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight';
    if (!nav && k !== 'Enter') { if (k === ' ' || k === 'Backspace') e.preventDefault(); return; }
    e.preventDefault();
    if (wake()) return;   // the first press only brings the controls back
    if (k === 'Enter') { activate(el); setTimeout(settle, 0); return; }
    if ((k === 'ArrowLeft' || k === 'ArrowRight') && el) {
      var d = k === 'ArrowRight' ? 1 : -1;
      if (el.type === 'range') return stepRange(el, d);
      if (el.id === 'progress') { if (A) A.seekBy(10 * d); return; }
    }
    move(k);
  }, true);

  // ---------- the page ----------
  function setUp() {
    // the seek line on a row of its own above the buttons: ↑ ↓ move between header, seek line and buttons
    var controls = document.querySelector('.controls');
    var row = document.createElement('div');
    row.className = 'tv-seekrow';
    ['time', 'progress', 'duration'].forEach(function (id) { row.appendChild($(id)); });
    controls.parentNode.insertBefore(row, controls);
    var bar = $('progress');
    bar.setAttribute('data-tv-focus', ''); bar.tabIndex = 0;
    bar.title = '◀ ▶ seek 10 s · OK play / pause';
    // the shuffle button sits with the transport buttons
    controls.insertBefore($('btnShuffle'), controls.firstChild);
    // what isn't for the TV: the window buttons, and every sync and timing control
    var hide = function (el) { if (el) el.classList.add('tv-hidden'); };
    ['btnFull', 'btnMin', 'btnClose', 'syncBanner', 'btnResume', 'btnSync', 'btnReset', 'timingNote'].forEach(function (id) { hide($(id)); });
    hide(document.querySelector('.pill'));
    hide($('offMinus').closest('label'));    // timing offset
    hide($('optOpacity').closest('label'));  // background transparency: the TV is always solid
    $('btnQuit').textContent = 'Exit';
    // the up-next previews show while ⏮ / ⏭ have the focus (on the desktop they show on hover)
    ['btnPrev', 'btnNext'].forEach(function (id) {
      var b = $(id);
      b.addEventListener('focus', function () { b.dispatchEvent(new Event('mouseenter')); });
      b.addEventListener('blur', function () { b.dispatchEvent(new Event('mouseleave')); });
    });
    // no sync messages on the TV (it keeps no synced timings, but a toast could still mention them)
    var toastEl = $('toast');
    new MutationObserver(function () {
      if (/sync|timings|press R/i.test(toastEl.textContent)) toastEl.classList.add('hidden');
    }).observe(toastEl, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    // a video that can't play here: the shared code falls back to a stopwatch; say so plainly
    var notice = document.createElement('div');
    notice.id = 'tvNotice'; notice.className = 'tv-notice tv-hidden';
    notice.textContent = 'This recording can’t be played on the TV (YouTube doesn’t allow it here, or can’t be reached). '
      + 'The lyrics follow a stopwatch instead: press ▶ when you start the recording on another device.';
    $('panel').appendChild(notice);
    new MutationObserver(function () {
      notice.classList.toggle('tv-hidden', !body.classList.contains('clock-mode'));
    }).observe(body, { attributes: true, attributeFilter: ['class'] });
    // the selected work: focus Play once the page is up
    setTimeout(function () { focusEl($('btnPlay')); wake(); }, 0);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setUp); else setUp();
})();
