#!/usr/bin/env node
// Builds the Samsung Smart TV (Tizen) app from the shared src/ plus the TV layer in tv/.
//
//   node tv/build.js                    stage tv/dist/app/ (and run `tizen build-web` if the CLI is found)
//   node tv/build.js --profile NAME     … then sign and package it as tv/dist/SlokamPlayer.wgt
//   node tv/build.js --stage-only       only stage, never call the Tizen CLI
//
// The profile is a certificate profile made in Tizen Studio's Certificate Manager (TIZEN_PROFILE in
// the environment works too). Nothing here creates or stores certificates.
//
// tv/dist/ is a build output (git-ignored): never edit it, edit src/ or tv/ and build again.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const TV = __dirname;
const DIST = path.join(TV, 'dist');
const APP = path.join(DIST, 'app');
const WGT_NAME = 'SlokamPlayer.wgt';

const args = process.argv.slice(2);
const argVal = (name) => { const k = args.indexOf(name); return k >= 0 ? args[k + 1] : undefined; };
const stageOnly = args.includes('--stage-only');
const profile = argVal('--profile') || process.env.TIZEN_PROFILE;

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
}

// The TV page is the desktop page (so every text the desktop loads, the TV loads too) with the TV
// layer added: tv.css after style.css, tv.js before app.js, and the body in TV full-screen mode.
function tvPage(html) {
  const edits = [
    ['<meta charset="utf-8">', '<meta charset="utf-8">\n  <meta name="viewport" content="width=1920, user-scalable=no">'],
    ['<link rel="stylesheet" href="style.css">', '<link rel="stylesheet" href="style.css">\n  <link rel="stylesheet" href="tv/tv.css">'],
    ['<body>', '<body class="tv fullscreen">'],
    ['<script src="app.js"></script>', '<script src="tv/tv.js"></script>\n  <script src="app.js"></script>'],
  ];
  for (const [from, to] of edits) {
    if (html.split(from).length !== 2) throw new Error(`src/index.html: expected exactly one ${from} — update tv/build.js`);
    html = html.replace(from, to);
  }
  return html;
}

function stage() {
  fs.rmSync(APP, { recursive: true, force: true });
  copyDir(SRC, APP);
  fs.writeFileSync(path.join(APP, 'index.html'), tvPage(fs.readFileSync(path.join(SRC, 'index.html'), 'utf8')));
  fs.mkdirSync(path.join(APP, 'tv'), { recursive: true });
  for (const f of ['tv.js', 'tv.css']) fs.copyFileSync(path.join(TV, f), path.join(APP, 'tv', f));
  // the launcher icon: assets/logo-1024.png on the app's background, 512×423 as Tizen TV expects
  // (convert assets/logo-1024.png -resize 380x380 -background 'rgb(14,12,18)' -gravity center -extent 512x423 tv/icon.png)
  fs.copyFileSync(path.join(TV, 'icon.png'), path.join(APP, 'icon.png'));
  fs.copyFileSync(path.join(TV, 'config.xml'), path.join(APP, 'config.xml'));
  console.log(`Staged the TV app in ${path.relative(ROOT, APP)}${path.sep}`);
}

const tizen = (cmdArgs) => spawnSync('tizen', cmdArgs, { stdio: 'inherit', shell: process.platform === 'win32' });
const haveTizen = () => {
  const r = spawnSync('tizen', ['version'], { stdio: 'ignore', shell: process.platform === 'win32' });
  return !r.error && r.status === 0;
};

function nextSteps(what) {
  console.log(`
${what}

To make the .wgt and put it on a TV:
  1. Install Tizen Studio with the TV extensions (Package Manager → Extension SDK → "TV Extensions"),
     and put <tizen-studio>/tools/ide/bin and <tizen-studio>/tools on your PATH (for "tizen" and "sdb").
  2. On the TV: Apps → press 1 2 3 4 5 on the remote → Developer mode On, Host PC IP = this PC → restart the TV.
  3. Connect:   sdb connect <TV-IP>   (or Tizen Studio → Device Manager → Remote Device Manager → +)
  4. Tizen Studio → Tools → Certificate Manager → "+" → Samsung → TV, sign in with a Samsung account, and
     add the connected TV's DUID to the distributor certificate. Name the profile, e.g. SlokamTV.
     Keep the certificates and their passwords out of this repository.
  5. Build and sign:  node tv/build.js --profile SlokamTV
  6. Install:         tizen install -n ${WGT_NAME} -- tv/dist
     (or: sdb devices, then tizen install -n ${WGT_NAME} -s <serial> -- tv/dist)
`);
}

stage();
if (stageOnly) process.exit(0);
if (!haveTizen()) {
  nextSteps('The Tizen CLI ("tizen") is not on PATH, so the build stopped after staging.');
  process.exit(0);
}
const BUILD = path.join(APP, '.buildResult');
fs.rmSync(BUILD, { recursive: true, force: true });
if (tizen(['build-web', '-out', '.buildResult', '--', APP]).status !== 0) { console.error('tizen build-web failed'); process.exit(1); }
if (!profile) {
  nextSteps('Built with "tizen build-web". No certificate profile given (--profile NAME or TIZEN_PROFILE), so nothing was signed or packaged.');
  process.exit(0);
}
if (tizen(['package', '-t', 'wgt', '-s', profile, '-o', DIST, '--', BUILD]).status !== 0) { console.error('tizen package failed'); process.exit(1); }
// tizen package names the file after the app's name; give it a stable name
const made = fs.readdirSync(DIST).filter((f) => f.endsWith('.wgt'));
if (made.length === 1 && made[0] !== WGT_NAME) fs.renameSync(path.join(DIST, made[0]), path.join(DIST, WGT_NAME));
console.log(`Packaged ${path.relative(ROOT, path.join(DIST, WGT_NAME))}. Install it with: tizen install -n ${WGT_NAME} -- tv/dist`);
