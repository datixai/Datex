// Datex main process. Developed by Datix AI (datixai.com).
'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, protocol, net } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

// Serve the app's own files over app:// so ES modules and workers (pdf.js, Monaco) load reliably.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const fs = require('fs');
const fsp = fs.promises;
const { spawn, execFile } = require('child_process');
const { parseLog } = require('./lib/latexlog');
const { parseBib } = require('./lib/bibtex');
const synctex = require('./lib/synctex');

const APP_DIR = __dirname;
// Tests can run several isolated copies of the app side by side.
if (process.env.DATEX_USERDATA) app.setPath('userData', process.env.DATEX_USERDATA);
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = {
  projectsDir: process.env.DATEX_USERDATA ? path.join(process.env.DATEX_USERDATA, 'Projects') : path.join(app.getPath('documents'), 'Datex Projects'),
  engine: 'auto', autoCompile: true, compileTimeout: 0,
  fontSize: 14, wordWrap: true, theme: 'system', userName: 'Me', spellLang: 'en-GB',
  ollamaUrl: 'http://127.0.0.1:11434', aiModel: 'gpt-oss:20b',
  recent: []
};
let settings = { ...DEFAULTS };
let win = null;
const running = new Map(); // root -> child process

function loadSettings() {
  try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')) }; } catch { settings = { ...DEFAULTS }; }
  // Older versions saved 'dark' by default; switch everyone once to follow Windows.
  if (!settings.themeV2) { settings.theme = 'system'; settings.themeV2 = true; }
}
function saveSettings() {
  fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2));
}

// Every file operation must stay inside the open project.
function inside(root, rel) {
  const full = path.resolve(root, rel || '.');
  const r = path.resolve(root);
  if (full !== r && !full.startsWith(r + path.sep)) throw new Error('Path is outside the project');
  return full;
}

function run(cmd, args, opts = {}) {
  return new Promise(resolve => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true, ...opts }, (err, stdout, stderr) =>
      resolve({ ok: !err, code: err ? err.code : 0, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 920, minWidth: 980, minHeight: 600,
    title: 'Datex', backgroundColor: '#000000', show: false,
    icon: path.join(APP_DIR, 'build', 'icon.png'),
    webPreferences: { preload: path.join(APP_DIR, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false }
  });
  win.loadURL('app://datex/renderer/index.html');
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
  buildMenu();
  if (process.env.DATEX_SELFTEST) selfTest();
}

// Developer self-test: DATEX_SELFTEST=<project dir> opens it, compiles, saves a screenshot and quits.
function selfTest() {
  const wc = win.webContents;
  wc.on('console-message', (e) => console.log('[renderer]', e.level, e.message));
  wc.once('did-finish-load', async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    if (process.env.DATEX_SPLASHSHOT) { await wait(1300); fs.writeFileSync(process.env.DATEX_SPLASHSHOT, (await wc.capturePage()).toPNG()); }
    await wait(2500);
    const js = c => wc.executeJavaScript(c).catch(err => 'ERR ' + err.message);
    console.log('open:', await js(`window.__datex.openProject(${JSON.stringify(process.env.DATEX_SELFTEST)}).then(()=>'ok')`));
    await wait(2000);
    console.log('engine:', process.env.DATEX_ENGINE || 'auto');
    if (process.env.DATEX_ENGINE) await js(`document.querySelector('#engineSel').value=${JSON.stringify(process.env.DATEX_ENGINE)}`);
    console.log('compile:', await js(`(async()=>{while(window.__datex.S.compiling) await new Promise(r=>setTimeout(r,500)); await window.__datex.compile(); while(window.__datex.S.compiling) await new Promise(r=>setTimeout(r,500));})().then(()=>JSON.stringify({status:document.querySelector('#status').textContent, pages:window.__datex.S.pages.length, issues:window.__datex.S.issues.filter(i=>i.level==='error').map(i=>i.message)}))`));
    await wait(2500);
    console.log('sync:', await js(`(async()=>{const S=window.__datex.S;return JSON.stringify(await window.datex.call('synctex:forward',S.root,S.main,S.main,30,1))})()`));
    if (process.env.DATEX_SCRIPT) console.log('script:', await js(fs.readFileSync(process.env.DATEX_SCRIPT, 'utf8')));
    if (process.env.DATEX_PANEL) { await js(`window.__datex.openPanel(${JSON.stringify(process.env.DATEX_PANEL)})`); await wait(1500); }
    const img = await wc.capturePage();
    fs.writeFileSync(process.env.DATEX_SHOT || path.join(app.getPath('temp'), 'datex-shot.png'), img.toPNG());
    console.log('shot saved');
    app.quit();
  });
}

function send(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }

function buildMenu() {
  const cmd = c => () => send('menu', c);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'New Project...', accelerator: 'Ctrl+Shift+N', click: cmd('newProject') },
      { label: 'Open Project Folder...', accelerator: 'Ctrl+Shift+O', click: cmd('openProject') },
      { label: 'Import Project from ZIP...', click: cmd('importZip') },
      { label: 'Project Dashboard', accelerator: 'Ctrl+Shift+D', click: cmd('dashboard') },
      { type: 'separator' },
      { label: 'Save', accelerator: 'Ctrl+S', click: cmd('save') },
      { label: 'Export PDF...', accelerator: 'Ctrl+Shift+E', click: cmd('exportPdf') },
      { label: 'Export Word Document (.docx)', accelerator: 'Ctrl+Shift+W', click: cmd('exportWord') },
      { label: 'Export Word Document As...', click: cmd('exportWordAs') },
      { label: 'Export Project as ZIP...', click: cmd('exportZip') },
      { type: 'separator' },
      { label: 'Settings', accelerator: 'Ctrl+,', click: cmd('settings') },
      { role: 'quit' }
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      { type: 'separator' }, { label: 'Find in Project', accelerator: 'Ctrl+Shift+F', click: cmd('search') }] },
    { label: 'Build', submenu: [
      { label: 'Recompile', accelerator: 'Ctrl+Enter', click: cmd('compile') },
      { label: 'Stop Compile', click: cmd('stop') },
      { label: 'Clear Build Files', click: cmd('clean') },
      { label: 'Jump to PDF (SyncTeX)', accelerator: 'Ctrl+Alt+J', click: cmd('syncForward') }
    ] },
    { label: 'Review', submenu: [
      { label: 'Track Changes', accelerator: 'Ctrl+Shift+R', click: cmd('review') },
      { label: 'Comments', click: cmd('comments') },
      { label: 'History', accelerator: 'Ctrl+H', click: cmd('history') },
      { label: 'Word Count', click: cmd('wordcount') }
    ] },
    { label: 'Tools', submenu: [
      { label: 'AI Assistant', accelerator: 'Ctrl+Shift+A', click: cmd('ai') },
      { label: 'References', accelerator: 'Ctrl+Shift+B', click: cmd('refs') },
      { label: 'Symbol Palette', click: cmd('symbols') },
      { label: 'Git, GitHub and Cloud Backup', click: cmd('git') },
      { label: 'Clone from GitHub...', click: cmd('cloneRepo') },
      { label: 'TeX Packages...', click: cmd('packages') }
    ] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { role: 'togglefullscreen' }] },
    { label: 'Help', submenu: [
      { label: 'LaTeX Quick Guide', click: cmd('guide') },
      { label: 'Visit datixai.com', click: () => shell.openExternal('https://datixai.com') },
      { label: 'About Datex', click: cmd('about') }
    ] }
  ]));
}

// ---------- TeX detection ----------
async function texStatus() {
  const r = await run('latexmk', ['-v']);
  systemTex = r.ok;
  return { system: r.ok, builtin: fs.existsSync(tectonicExe()), version: (r.stdout.match(/Version\s+\S+/) || [''])[0] };
}

// Optional: pre-download the common package set (templates/packages.tex) so most documents compile offline.
let fullDownload = null;
handle('tex:downloadAll', async () => {
  if (fullDownload) return 'running';
  const tmp = path.join(app.getPath('temp'), 'datex-full');
  await fsp.mkdir(tmp, { recursive: true });
  await fsp.writeFile(path.join(tmp, 'all.tex'), await fsp.readFile(path.join(APP_DIR, 'templates', 'packages.tex'), 'utf8'));
  fullDownload = spawn(tectonicExe(), ['-X', 'compile', 'all.tex', '--outdir', tmp], { cwd: tmp, windowsHide: true, env: { ...process.env, TECTONIC_CACHE_DIR: texCacheDir() } });
  fullDownload.stdout.on('data', d => send('tex:progress', String(d)));
  fullDownload.stderr.on('data', d => send('tex:progress', String(d)));
  fullDownload.on('close', c => { fullDownload = null; send('tex:progress', c === 0 ? '\nDone. Common packages are now available offline.\n' : '\nStopped (code ' + c + ').\n'); });
  return 'started';
});

// ---------- Projects ----------
async function listProjects() {
  await fsp.mkdir(settings.projectsDir, { recursive: true });
  const items = [];
  const seen = new Set();
  const add = async (dir) => {
    if (seen.has(dir)) return; seen.add(dir);
    try {
      const st = await fsp.stat(dir); if (!st.isDirectory()) return;
      const files = await fsp.readdir(dir);
      if (!files.some(f => f.endsWith('.tex'))) return;
      let mtime = st.mtimeMs;
      for (const f of files) { try { mtime = Math.max(mtime, (await fsp.stat(path.join(dir, f))).mtimeMs); } catch {} }
      items.push({ name: path.basename(dir), dir, modified: mtime });
    } catch {}
  };
  for (const d of await fsp.readdir(settings.projectsDir)) await add(path.join(settings.projectsDir, d));
  for (const d of settings.recent) await add(d);
  return items.sort((a, b) => b.modified - a.modified);
}

async function listTemplates() {
  const dir = path.join(APP_DIR, 'templates');
  const out = [];
  for (const d of await fsp.readdir(dir)) {
    try { out.push({ id: d, ...JSON.parse(await fsp.readFile(path.join(dir, d, 'template.json'), 'utf8')) }); } catch {}
  }
  return out.sort((a, b) => (a.order || 99) - (b.order || 99));
}

async function copyDir(src, dst) {
  await fsp.mkdir(dst, { recursive: true });
  for (const e of await fsp.readdir(src, { withFileTypes: true })) {
    if (e.name === 'template.json') continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d); else await fsp.copyFile(s, d);
  }
}

async function createProject(name, templateId) {
  const safe = String(name).replace(/[<>:"/\\|?*]/g, '').trim();
  if (!safe) throw new Error('Please enter a project name');
  const dir = path.join(settings.projectsDir, safe);
  if (fs.existsSync(dir)) throw new Error('A project with this name already exists');
  await copyDir(path.join(APP_DIR, 'templates', templateId || 'blank'), dir);
  await ensureGit(dir);
  await snapshot(dir, 'Project created');
  return dir;
}

function rememberProject(dir) {
  settings.recent = [dir, ...settings.recent.filter(d => d !== dir)].slice(0, 30);
  saveSettings();
}

async function projectConfig(root) {
  try { return JSON.parse(await fsp.readFile(path.join(root, '.datex', 'project.json'), 'utf8')); } catch { return {}; }
}
async function saveProjectConfig(root, cfg) {
  await fsp.mkdir(path.join(root, '.datex'), { recursive: true });
  await fsp.writeFile(path.join(root, '.datex', 'project.json'), JSON.stringify(cfg, null, 2));
}

async function guessMain(root) {
  const cfg = await projectConfig(root);
  if (cfg.main && fs.existsSync(path.join(root, cfg.main))) return cfg.main;
  const texes = (await fsp.readdir(root)).filter(f => f.endsWith('.tex'));
  for (const f of texes) {
    if (/\\documentclass/.test(await fsp.readFile(path.join(root, f), 'utf8'))) return f;
  }
  return texes[0] || 'main.tex';
}

async function tree(root, rel = '') {
  const out = [];
  const entries = await fsp.readdir(inside(root, rel), { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) out.push({ name: e.name, path: p, dir: true, children: await tree(root, p) });
    else out.push({ name: e.name, path: p, dir: false });
  }
  return out.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
}

// ---------- Compile ----------
// Engines: 'builtin' = bundled Tectonic (no TeX install needed, packages fetched and cached automatically).
// pdflatex / xelatex / lualatex use a TeX distribution on the PC (MiKTeX or TeX Live) through latexmk.
const ENGINES = { pdflatex: '-pdf', xelatex: '-xelatex', lualatex: '-lualatex' };
const resDir = () => app.isPackaged ? process.resourcesPath : APP_DIR;
const tectonicExe = () => path.join(resDir(), 'bin', 'tectonic.exe');
const texCacheDir = () => path.join(app.getPath('userData'), 'tex-cache');
let systemTex = null;

// Seed the writable package cache from the cache shipped in the installer (first run only).
async function seedTexCache() {
  const dst = texCacheDir(); const src = path.join(resDir(), 'tex-cache');
  if (fs.existsSync(dst) || !fs.existsSync(src)) return;
  await fsp.cp(src, dst, { recursive: true });
}

async function resolveEngine(engine) {
  if (systemTex === null) systemTex = (await run('latexmk', ['-v'])).ok;
  const hasBuiltin = fs.existsSync(tectonicExe());
  if (engine === 'builtin' || engine === 'auto' || !engine) return hasBuiltin ? 'builtin' : (systemTex ? 'pdflatex' : null);
  if (!systemTex) return hasBuiltin ? 'builtin' : null;
  return engine;
}

function compile(root, main, requested) {
  return new Promise(async resolve => {
    stopCompile(root);
    const outdir = path.join(root, '.datex', 'build');
    fs.mkdirSync(outdir, { recursive: true });
    // \include{dir/file} writes dir/file.aux into the build folder, so mirror the project's folders there.
    const mirror = (rel) => {
      for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
        if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
        const r = path.join(rel, e.name); fs.mkdirSync(path.join(outdir, r), { recursive: true }); mirror(r);
      }
    };
    try { mirror(''); } catch {}
    const engine = await resolveEngine(requested);
    if (!engine) return resolve({ ok: false, code: -1, pdf: null, issues: [{ level: 'error', file: main, line: null, message: 'No TeX engine found. Reinstall Datex or install MiKTeX.', detail: '' }], log: '', output: '', ms: 0 });
    let cmd, args, env = process.env;
    if (engine === 'builtin') {
      await seedTexCache();
      cmd = tectonicExe();
      args = ['-X', 'compile', main, '--synctex', '--keep-logs', '--keep-intermediates', '--outdir', outdir];
      env = { ...process.env, TECTONIC_CACHE_DIR: texCacheDir() };
    } else {
      cmd = 'latexmk';
      args = [ENGINES[engine] || '-pdf', '-synctex=1', '-interaction=nonstopmode', '-file-line-error', '-f', '-outdir=' + outdir, main];
    }
    const t0 = Date.now();
    const child = spawn(cmd, args, { cwd: root, windowsHide: true, env });
    running.set(root, child);
    let output = '';
    const onData = d => { output += d; send('compile:output', String(d)); };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    let timer = null;
    if (settings.compileTimeout > 0) timer = setTimeout(() => { output += '\n[Datex] Compile stopped: time limit reached.\n'; child.kill(); }, settings.compileTimeout * 1000);
    child.on('error', err => { output += '\n' + err.message; });
    child.on('close', async code => {
      clearTimeout(timer); running.delete(root);
      const base = main.replace(/\.tex$/i, '');
      const pdf = path.join(outdir, base + '.pdf');
      let log = '';
      try { log = await fsp.readFile(path.join(outdir, base + '.log'), 'latin1'); } catch {}
      const issues = parseLog(log).map(i => ({ ...i, file: i.file || main }));
      const pdfOk = fs.existsSync(pdf) && fs.statSync(pdf).mtimeMs >= t0 - 1000;
      // Tectonic prints errors to its output rather than a file-line-error log.
      if (engine === 'builtin' && code !== 0 && !issues.some(i => i.level === 'error')) {
        for (const l of output.split(/\r?\n/)) {
          const m = l.match(/^error: (?:(.+?\.tex):(\d+): )?(.*)$/);
          if (m && !/halted|failed to process|^an error occurred/i.test(m[3])) issues.push({ level: 'error', file: m[1] || main, line: m[2] ? +m[2] : null, message: m[3], detail: '' });
        }
      }
      syncCache.delete(pdf);
      resolve({ ok: code === 0, code, engine, pdf: fs.existsSync(pdf) ? pdf : null, fresh: pdfOk, issues, log, output, ms: Date.now() - t0 });
    });
  });
}
function stopCompile(root) {
  const c = running.get(root);
  if (c) { try { spawn('taskkill', ['/pid', String(c.pid), '/T', '/F'], { windowsHide: true }); } catch { c.kill(); } running.delete(root); }
}

// ---------- SyncTeX ----------
const syncCache = new Map();
function syncData(root, main) {
  const pdf = path.join(root, '.datex', 'build', main.replace(/\.tex$/i, '.pdf'));
  if (!syncCache.has(pdf)) {
    const txt = synctex.load(pdf);
    if (!txt) return null;
    syncCache.set(pdf, synctex.parseSynctex(txt, root));
  }
  return syncCache.get(pdf);
}
async function syncForward(root, main, file, line) {
  const d = syncData(root, main);
  return d ? synctex.forward(d, path.join(root, file), line) : null;
}
async function syncBackward(root, main, page, x, y) {
  const d = syncData(root, main);
  const r = d && synctex.backward(d, page, x, y);
  if (!r || !r.file) return null;
  return { file: path.relative(root, r.file).replace(/\\/g, '/'), line: r.line };
}

// ---------- History (git) ----------
async function git(root, args) { return run('git', args, { cwd: root }); }
async function ensureGit(root) {
  if (!fs.existsSync(path.join(root, '.git'))) await git(root, ['init', '-q']);
  const gi = path.join(root, '.gitignore');
  let txt = fs.existsSync(gi) ? await fsp.readFile(gi, 'utf8') : '';
  if (!txt.includes('.datex/build')) {
    txt += (txt && !txt.endsWith('\n') ? '\n' : '') + '.datex/build/\n*.aux\n*.log\n*.synctex.gz\n*.fdb_latexmk\n*.fls\n*.out\n*.toc\n*.bbl\n*.blg\n';
    await fsp.writeFile(gi, txt);
  }
}
async function snapshot(root, message) {
  await ensureGit(root);
  await git(root, ['add', '-A']);
  const st = await git(root, ['status', '--porcelain']);
  if (!st.stdout.trim()) return { ok: true, changed: false };
  // Use the user's own git identity; fall back to a neutral local name if git has none.
  const who = (await git(root, ['config', 'user.name'])).stdout.trim();
  const id = who ? [] : ['-c', 'user.name=Datex User', '-c', 'user.email=user@datex.local'];
  const r = await git(root, [...id, 'commit', '-q', '-m', message || 'Snapshot']);
  return { ok: r.ok, changed: true, error: r.stderr };
}
async function historyList(root) {
  await ensureGit(root);
  const r = await git(root, ['log', '--pretty=format:%H%x1f%an%x1f%at%x1f%s', '-n', '300']);
  if (!r.ok) return [];
  return r.stdout.split('\n').filter(Boolean).map(l => { const [hash, author, t, msg] = l.split('\x1f'); return { hash, author, time: +t * 1000, message: msg }; });
}
async function historyFiles(root, hash) {
  const r = await git(root, ['show', '--name-status', '--pretty=format:', hash]);
  return r.stdout.split('\n').filter(Boolean).map(l => { const [s, f] = l.split('\t'); return { status: s, file: f }; });
}
async function fileAt(root, hash, file) {
  const r = await git(root, ['show', `${hash}:${file}`]);
  return r.ok ? r.stdout : '';
}

// ---------- References ----------
async function fetchText(url, headers = {}) {
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.text();
}
async function bibFromDoi(doi) {
  const clean = String(doi).trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  if (!/^10\.\S+\/\S+$/.test(clean)) throw new Error('That does not look like a DOI (10.xxxx/...)');
  return (await fetchText('https://doi.org/' + encodeURI(clean), { Accept: 'application/x-bibtex; charset=utf-8' })).trim();
}
async function zoteroLibrary() {
  // Zotero 7 local API (Settings > Advanced > "Allow other applications on this computer to communicate with Zotero").
  try { return await fetchText('http://127.0.0.1:23119/api/users/0/items?format=bibtex&limit=500'); }
  catch { throw new Error('Could not reach Zotero. Open Zotero 7 and enable its local API in Settings > Advanced.'); }
}
async function projectBib(root) {
  const out = [];
  const walk = async (rel) => {
    for (const e of await fsp.readdir(inside(root, rel), { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith('.bib')) for (const b of parseBib(await fsp.readFile(inside(root, p), 'utf8'))) out.push({ ...b, file: p });
    }
  };
  await walk('');
  return out;
}

// ---------- AI (local Ollama) ----------
const aiJobs = new Map();
async function aiModels() {
  try { const r = await fetch(settings.ollamaUrl + '/api/tags'); const j = await r.json(); return (j.models || []).map(m => m.name); }
  catch { return []; }
}
async function aiChat(id, messages, model) {
  const ctrl = new AbortController();
  aiJobs.set(id, ctrl);
  try {
    const res = await fetch(settings.ollamaUrl + '/api/chat', {
      method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model || settings.aiModel, messages, stream: true })
    });
    if (!res.ok) throw new Error('AI model error (' + res.status + ')');
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        const j = JSON.parse(line);
        if (j.message && j.message.content) send('ai:chunk', { id, text: j.message.content });
      }
    }
    send('ai:done', { id });
  } catch (e) {
    send('ai:done', { id, error: e.name === 'AbortError' ? null : 'Local AI is not available: ' + e.message });
  } finally { aiJobs.delete(id); }
}

// ---------- IPC ----------
function handle(ch, fn) {
  ipcMain.handle(ch, async (_e, ...a) => {
    try { return { ok: true, data: await fn(...a) }; } catch (e) { return { ok: false, error: e.message }; }
  });
}
handle('app:info', async () => ({ version: app.getVersion(), tex: await texStatus(), settings }));
handle('settings:set', async (patch) => { if (patch.spellLang && patch.spellLang !== settings.spellLang) speller = null; settings = { ...settings, ...patch }; saveSettings(); return settings; });
handle('projects:list', listProjects);
handle('templates:list', listTemplates);
handle('project:create', createProject);
handle('project:pick', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Open a LaTeX project folder' });
  return r.canceled ? null : r.filePaths[0];
});
// Import a project from a .zip file (for example one downloaded from Overleaf).
handle('project:importZip', async (zipPath) => {
  if (!zipPath) {
    const r = await dialog.showOpenDialog(win, { title: 'Import a LaTeX project from a ZIP file', filters: [{ name: 'ZIP files', extensions: ['zip'] }], properties: ['openFile'] });
    if (r.canceled) return null;
    zipPath = r.filePaths[0];
  }
  const base = path.basename(zipPath).replace(/\.zip$/i, '').replace(/[<>:"/\\|?*]+/g, ' ').trim() || 'Imported project';
  await fsp.mkdir(settings.projectsDir, { recursive: true });
  let dir = path.join(settings.projectsDir, base);
  for (let n = 2; fs.existsSync(dir); n++) dir = path.join(settings.projectsDir, `${base} (${n})`);
  const tmp = dir + '.importing';
  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.mkdir(tmp, { recursive: true });
  // Windows' own tar.exe reads ZIP files and refuses paths that would land outside the target folder.
  const t = await run(path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe'), ['-x', '-f', zipPath, '-C', tmp]);
  if (!t.ok) { await fsp.rm(tmp, { recursive: true, force: true }); throw new Error('Could not open the ZIP file. It may be damaged.'); }
  await fsp.rm(path.join(tmp, '__MACOSX'), { recursive: true, force: true });
  // If the ZIP holds a single folder, use that folder as the project.
  let src = tmp;
  for (;;) {
    const items = (await fsp.readdir(src, { withFileTypes: true })).filter(d => !/^\.DS_Store$/.test(d.name));
    if (items.length === 1 && items[0].isDirectory()) src = path.join(src, items[0].name); else break;
  }
  const texes = (await fsp.readdir(src)).filter(f => /\.tex$/i.test(f));
  if (!texes.length) { await fsp.rm(tmp, { recursive: true, force: true }); throw new Error('No .tex file was found in this ZIP, so it does not look like a LaTeX project.'); }
  await fsp.rename(src, dir);
  await fsp.rm(tmp, { recursive: true, force: true });
  // Choose the main file: main.tex first, then any file with \documentclass.
  let main = null;
  for (const f of texes.sort((a, b) => (b.toLowerCase() === 'main.tex') - (a.toLowerCase() === 'main.tex'))) {
    if (/\\documentclass/.test(await fsp.readFile(path.join(dir, f), 'utf8'))) { main = f; break; }
  }
  if (main) await saveProjectConfig(dir, { ...(await projectConfig(dir)), main });
  return dir;
});
handle('project:open', async (dir) => {
  if (!fs.existsSync(dir)) throw new Error('Folder not found');
  await ensureGit(dir); rememberProject(dir);
  await snapshot(dir, 'Opened in Datex');
  const cfg = await projectConfig(dir);
  return { dir, name: path.basename(dir), main: await guessMain(dir), engine: cfg.engine || settings.engine };
});
handle('project:config', async (dir, patch) => { const c = { ...(await projectConfig(dir)), ...patch }; await saveProjectConfig(dir, c); return c; });
handle('project:reveal', async (dir) => shell.openPath(dir));
handle('project:trash', async (dir) => {
  const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Move to Recycle Bin', 'Cancel'], defaultId: 1, cancelId: 1, message: `Move project "${path.basename(dir)}" to the Recycle Bin?` });
  if (r.response !== 0) return false;
  await shell.trashItem(dir); settings.recent = settings.recent.filter(d => d !== dir); saveSettings(); return true;
});
handle('fs:tree', (root) => tree(root));
handle('fs:read', (root, rel) => fsp.readFile(inside(root, rel), 'utf8'));
handle('fs:readBinary', async (file) => new Uint8Array(await fsp.readFile(file)));
handle('fs:write', async (root, rel, text) => { const f = inside(root, rel); await fsp.mkdir(path.dirname(f), { recursive: true }); await fsp.writeFile(f, text, 'utf8'); });
handle('fs:mkdir', (root, rel) => fsp.mkdir(inside(root, rel), { recursive: true }));
handle('fs:rename', (root, a, b) => fsp.rename(inside(root, a), inside(root, b)));
handle('fs:trash', (root, rel) => shell.trashItem(inside(root, rel)));
handle('fs:upload', async (root, relDir) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], title: 'Upload files to project' });
  if (r.canceled) return [];
  for (const f of r.filePaths) await fsp.copyFile(f, inside(root, (relDir ? relDir + '/' : '') + path.basename(f)));
  return r.filePaths.map(f => (relDir ? relDir + '/' : '') + path.basename(f));
});
handle('fs:search', async (root, q) => {
  const res = []; const needle = String(q).toLowerCase(); if (!needle) return res;
  const walk = async (rel) => {
    for (const e of await fsp.readdir(inside(root, rel), { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) await walk(p);
      else if (/\.(tex|bib|sty|cls|txt|md)$/i.test(e.name)) {
        (await fsp.readFile(inside(root, p), 'utf8')).split('\n').forEach((l, i) => { if (l.toLowerCase().includes(needle) && res.length < 500) res.push({ file: p, line: i + 1, text: l.trim().slice(0, 200) }); });
      }
    }
  };
  await walk(''); return res;
});
handle('compile:run', (root, main, engine) => compile(root, main, engine));
handle('compile:stop', async (root) => stopCompile(root));
handle('compile:clean', async (root) => { await fsp.rm(path.join(root, '.datex', 'build'), { recursive: true, force: true }); });
handle('pdf:export', async (src, name) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: name + '.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (r.canceled) return null; await fsp.copyFile(src, r.filePath); return r.filePath;
});
handle('project:zip', async (root) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.basename(root) + '.zip', filters: [{ name: 'ZIP', extensions: ['zip'] }] });
  if (r.canceled) return null;
  const files = (await git(root, ['ls-files', '-co', '--exclude-standard'])).stdout.split('\n').filter(Boolean);
  const list = path.join(app.getPath('temp'), 'datex-zip-' + Date.now() + '.txt');
  await fsp.writeFile(list, files.join('\n'));
  // Windows 10+ ships bsdtar, which can write zip files.
  const t = await run(path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe'), ['-a', '-c', '-f', r.filePath, '-T', list], { cwd: root });
  await fsp.rm(list, { force: true });
  if (!t.ok) throw new Error(t.stderr || 'Could not create ZIP');
  return r.filePath;
});
handle('synctex:forward', syncForward);
handle('synctex:backward', syncBackward);
handle('history:snapshot', async (root, message) => {
  const r = await snapshot(root, message);
  const cfg = await projectConfig(root);
  if (r.changed && cfg.cloud && cfg.cloudAuto !== false && fs.existsSync(cfg.cloud)) { try { await cloudBackup(root, cfg.cloud); } catch {} }
  return r;
});
handle('history:list', historyList);
handle('history:files', historyFiles);
handle('history:fileAt', fileAt);
handle('history:restore', async (root, hash) => {
  await snapshot(root, 'Before restore');
  const r = await git(root, ['checkout', hash, '--', '.']);
  if (!r.ok) throw new Error(r.stderr);
  return snapshot(root, 'Restored version ' + hash.slice(0, 7));
});
handle('history:label', async (root, hash, label) => git(root, ['tag', '-f', 'label/' + String(label).replace(/[^\w.-]+/g, '-'), hash]));
handle('git:status', async (root) => {
  const remote = (await git(root, ['remote', 'get-url', 'origin'])).stdout.trim();
  const branch = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
  return { remote, branch };
});
handle('git:setRemote', async (root, url) => {
  await git(root, ['remote', 'remove', 'origin']);
  const r = await git(root, ['remote', 'add', 'origin', url]); if (!r.ok) throw new Error(r.stderr); return true;
});
handle('git:push', async (root) => { await snapshot(root, 'Sync'); const r = await git(root, ['push', '-u', 'origin', 'HEAD']); if (!r.ok) throw new Error(r.stderr); return r.stderr || r.stdout; });
handle('git:pull', async (root) => { await snapshot(root, 'Before pull'); const r = await git(root, ['pull', '--no-rebase', 'origin', 'HEAD']); if (!r.ok) throw new Error(r.stderr); return r.stdout; });
handle('comments:load', async (root) => { try { return JSON.parse(await fsp.readFile(path.join(root, '.datex', 'comments.json'), 'utf8')); } catch { return []; } });
handle('comments:save', async (root, list) => { await fsp.mkdir(path.join(root, '.datex'), { recursive: true }); await fsp.writeFile(path.join(root, '.datex', 'comments.json'), JSON.stringify(list, null, 2)); });
handle('refs:project', projectBib);
handle('refs:doi', bibFromDoi);
handle('refs:zotero', async () => parseBib(await zoteroLibrary()));
handle('ai:models', aiModels);
handle('ai:chat', async (id, messages, model) => { aiChat(id, messages, model); return id; });
handle('ai:stop', async (id) => { const c = aiJobs.get(id); if (c) c.abort(); });
// ---------- TeX packages ----------
function dirSize(p) { let n = 0; try { for (const e of fs.readdirSync(p, { withFileTypes: true })) n += e.isDirectory() ? dirSize(path.join(p, e.name)) : fs.statSync(path.join(p, e.name)).size; } catch {} return n; }
handle('tex:info', async () => {
  await seedTexCache();
  const t = await texStatus();
  return { ...t, cacheDir: texCacheDir(), cacheMB: Math.round(dirSize(texCacheDir()) / 1e6) };
});
// Install packages by name: the built-in engine fetches whatever a tiny document needs.
// All packages in one go first; if that run stops early, each package on its own, so one bad
// package never blocks the rest. A package counts as failed only when its file could not be found.
async function texFetch(list, cls = 'article') {
  const tmp = path.join(app.getPath('temp'), 'datex-pkg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
  await fsp.mkdir(tmp, { recursive: true });
  await fsp.writeFile(path.join(tmp, 'p.tex'), `\\documentclass{${cls}}\n${list.map(n => `\\usepackage{${n}}`).join('\n')}\n\\begin{document}\nok\n\\end{document}\n`);
  const r = await new Promise(res => {
    const c = spawn(tectonicExe(), ['-X', 'compile', 'p.tex'], { cwd: tmp, windowsHide: true, env: { ...process.env, TECTONIC_CACHE_DIR: texCacheDir() } });
    let out = '';
    const on = d => { out += d; send('tex:progress', String(d)); };
    c.stdout.on('data', on); c.stderr.on('data', on);
    c.on('close', code => res({ code, out }));
  });
  await fsp.rm(tmp, { recursive: true, force: true });
  const notFound = [...r.out.matchAll(/File `([^']+?)\.(?:sty|cls)' not found|unable to locate file "([^"]+?)\.(?:sty|cls)"/g)].map(m => m[1] || m[2]);
  return { ok: r.code === 0, notFound, out: r.out };
}
handle('tex:install', async (names) => {
  const list = [...new Set((Array.isArray(names) ? names : String(names).split(/[\s,]+/)).map(s => String(s).trim()).filter(n => /^[A-Za-z0-9-]+$/.test(n)))];
  if (!list.length) throw new Error('Enter one or more package names, for example: tikz, siunitx');
  if (!fs.existsSync(tectonicExe())) throw new Error('The built-in engine is missing. Reinstall Datex.');
  await seedTexCache();
  const failed = new Set();
  const all = await texFetch(list);
  if (!all.ok) {
    if (/Failed to connect|Could not resolve|error sending request|network|dns error/i.test(all.out) && all.notFound.length) throw new Error('No internet connection. Connect to the internet once so Datex can download the packages.');
    for (const n of list) {
      send('tex:progress', `\nChecking ${n}...\n`);
      const one = await texFetch([n]);
      if (one.notFound.includes(n)) failed.add(n);
    }
  }
  const installed = list.filter(n => !failed.has(n));
  if (!installed.length) throw new Error('Could not install: ' + [...failed].join(', ') + '. Check the names and the internet connection.');
  return { installed, failed: [...failed] };
});
// Every package a project uses (\usepackage, \RequirePackage), minus the project's own .sty files.
handle('tex:scan', async (root) => {
  const pk = new Set(), own = new Set();
  const walk = async (dir, depth) => {
    for (const d of await fsp.readdir(dir, { withFileTypes: true })) {
      if (d.name.startsWith('.') || d.name === 'node_modules') continue;
      const f = path.join(dir, d.name);
      if (d.isDirectory()) { if (depth < 4) await walk(f, depth + 1); continue; }
      if (/\.(sty|cls)$/i.test(d.name)) own.add(d.name.replace(/\.(sty|cls)$/i, ''));
      if (!/\.(tex|sty|cls|ltx)$/i.test(d.name)) continue;
      const t = (await fsp.readFile(f, 'utf8')).replace(/(^|[^\\])%.*$/gm, '$1');
      for (const m of t.matchAll(/\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g))
        for (const n of m[1].split(',')) { const s = n.trim(); if (/^[A-Za-z0-9-]+$/.test(s)) pk.add(s); }
    }
  };
  await walk(root, 0);
  return [...pk].filter(n => !own.has(n)).sort();
});

// ---------- Word export (LaTeX to .docx with Pandoc) ----------
const pandocExe = () => path.join(resDir(), 'bin', 'pandoc', 'pandoc.exe');
// Pandoc runs outside Electron and cannot read inside app.asar, so copy its support files out first.
async function wordSupport() {
  const dst = path.join(app.getPath('userData'), 'word');
  await fsp.mkdir(dst, { recursive: true });
  for (const f of ['reference.docx', 'datex.lua', 'numeric.csl']) await fsp.copyFile(path.join(APP_DIR, 'templates', 'word', f), path.join(dst, f));
  return dst;
}
async function exportWord(root, main, outFile) {
  if (!fs.existsSync(pandocExe())) throw new Error('The Word converter is missing. Reinstall Datex.');
  const sup = await wordSupport();
  // Merge \input and \include files into one source, so every chapter reaches Word.
  const flatten = async (rel, depth) => {
    let text = await fsp.readFile(inside(root, rel), 'utf8');
    if (depth > 10) return text;
    const parts = []; let last = 0;
    for (const m of text.matchAll(/^([^%\n]*?)\\(input|include|subfile)\{([^}]+)\}/gm)) {
      let f = m[3].trim(); if (!/\.tex$/i.test(f)) f += '.tex';
      if (!fs.existsSync(path.join(root, f))) continue;
      const start = m.index + m[1].length;
      parts.push(text.slice(last, start), (m[2] === 'include' ? '\n\\clearpage\n' : '\n') + await flatten(f, depth + 1) + '\n');
      last = m.index + m[0].length;
    }
    parts.push(text.slice(last));
    return parts.join('');
  };
  const src = await flatten(main, 0);
  const flat = path.join('.datex', 'word-source.tex');
  await fsp.mkdir(path.join(root, '.datex'), { recursive: true });
  await fsp.writeFile(path.join(root, flat), src, 'utf8');
  const body = src.replace(/(^|[^\\])%.*$/gm, '$1');
  const args = [flat, '-f', 'latex+raw_tex', '-t', 'docx', '-o', outFile,
    '--reference-doc', path.join(sup, 'reference.docx'), '--lua-filter', path.join(sup, 'datex.lua'),
    '--resource-path', root, '--number-sections'];
  // Report and book classes start each chapter on a new page; the filter copies that.
  if (/\\documentclass(\[[^\]]*\])?\{(report|book|memoir|scrreprt|scrbook)\}/.test(body)) args.push('-M', 'datex-chapters=true');
  // Bibliography: the files the document names, else every .bib in the project when it cites anything.
  let bibs = [];
  for (const m of body.matchAll(/\\(?:bibliography|addbibresource)(?:\[[^\]]*\])?\{([^}]+)\}/g)) {
    for (const b of m[1].split(',')) { const f = b.trim().replace(/\.bib$/i, '') + '.bib'; if (fs.existsSync(path.join(root, f))) bibs.push(f); }
  }
  if (!bibs.length && /\\cite/.test(src)) bibs = (await projectBib(root)).map(e => e.file).filter((f, i, a) => a.indexOf(f) === i);
  if (bibs.length) {
    // Citations are resolved before the Datex filter runs, so the filter also sees the reference list.
    const cite = ['--citeproc', '-M', 'reference-section-title=' + (/datex-chapters/.test(args.join(' ')) ? 'Bibliography' : 'References')];
    for (const b of [...new Set(bibs)]) cite.push('--bibliography', b);
    // Numbered citation styles in LaTeX get numbered citations in Word too.
    if (/\\bibliographystyle\{(plain|unsrt|ieeetr|IEEEtran|abbrv|alpha|acm|siam|vancouver)\}|style\s*=\s*(numeric|ieee)/i.test(body)) cite.push('--csl', path.join(sup, 'numeric.csl'));
    args.splice(args.indexOf('--lua-filter'), 0, ...cite);
  }
  const r = await new Promise(res => execFile(pandocExe(), args, { cwd: root, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, so, se) => res({ ok: !err, err: String(se || (err && err.message) || '') })));
  if (!r.ok) {
    if (/permission denied|resource busy|being used/i.test(r.err)) throw new Error('The Word file is open in another program. Close it in Word and try again.');
    throw new Error(r.err.split('\n').filter(Boolean).slice(-2).join(' ') || 'Word export failed');
  }
  const warnings = r.err.split('\n').filter(l => /WARNING/.test(l)).map(l => l.replace(/^\[WARNING\]\s*/, '')).slice(0, 20);
  return { file: outFile, warnings };
}
handle('word:export', async (root, main, pick) => {
  let out = path.join(root, path.basename(root) + '.docx');
  if (pick) {
    const r = await dialog.showSaveDialog(win, { defaultPath: out, filters: [{ name: 'Word document', extensions: ['docx'] }] });
    if (r.canceled) return null; out = r.filePath;
  }
  return exportWord(root, main, out);
});
handle('file:open', async (f) => { const e = await shell.openPath(f); if (e) throw new Error(e); });
handle('file:reveal', async (f) => shell.showItemInFolder(f));

// ---------- GitHub clone and cloud backup ----------
handle('repo:clone', async (url) => {
  url = String(url || '').trim();
  if (!/^(https:\/\/|git@)[\w.@:/~-]+$/.test(url)) throw new Error('Enter a Git URL, for example https://github.com/user/paper.git');
  const name = url.split(/[/:]/).pop().replace(/\.git$/, '') || 'project';
  let dir = path.join(settings.projectsDir, name), i = 2;
  while (fs.existsSync(dir)) dir = path.join(settings.projectsDir, name + ' ' + i++);
  await fsp.mkdir(settings.projectsDir, { recursive: true });
  const r = await run('git', ['clone', url, dir]);
  if (!r.ok) throw new Error(r.stderr.split('\n').filter(Boolean).pop() || 'Clone failed');
  return dir;
});
function cloudFolders() {
  const out = []; const add = (name, p) => { if (p && fs.existsSync(p) && !out.some(o => o.path === p)) out.push({ name, path: p }); };
  for (const l of 'DEFGHIJKLMNOPQRSTUVWXYZ') add('Google Drive', l + ':\\My Drive');
  add('Google Drive', path.join(app.getPath('home'), 'Google Drive'));
  add('Google Drive', path.join(app.getPath('home'), 'My Drive'));
  add('OneDrive', process.env.OneDrive); add('OneDrive (work)', process.env.OneDriveCommercial);
  add('Dropbox', path.join(app.getPath('home'), 'Dropbox'));
  return out;
}
async function cloudBackup(root, target) {
  const dst = path.join(target, 'Datex Backups', path.basename(root));
  const skip = p => { const r = path.relative(root, p); return r === '.git' || r.startsWith('.git' + path.sep) || r.startsWith(path.join('.datex', 'build')); };
  await fsp.cp(root, dst, { recursive: true, force: true, filter: src => !skip(src) });
  return dst;
}
handle('cloud:detect', async () => cloudFolders());
handle('cloud:pick', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Choose your cloud folder (Google Drive, OneDrive, Dropbox)' }); return r.canceled ? null : r.filePaths[0]; });
handle('cloud:backup', cloudBackup);

// Spell checking (English), with a personal dictionary kept in settings.
let speller = null;
function getSpeller() {
  if (!speller) {
    const nspell = require('nspell');
    const d = path.join(APP_DIR, 'node_modules', settings.spellLang === 'en-US' ? 'dictionary-en' : 'dictionary-en-gb');
    speller = nspell(fs.readFileSync(path.join(d, 'index.aff')), fs.readFileSync(path.join(d, 'index.dic')));
    for (const w of settings.dictionary || []) speller.add(w);
  }
  return speller;
}
handle('spell:check', async (words) => {
  const sp = getSpeller(); const bad = {};
  for (const w of words.slice(0, 5000)) if (!sp.correct(w)) bad[w] = sp.suggest(w).slice(0, 5);
  return bad;
});
handle('spell:add', async (word) => {
  settings.dictionary = [...new Set([...(settings.dictionary || []), word])]; saveSettings();
  getSpeller().add(word); return true;
});
// ---------- Live sessions (co-editing on the local network) ----------
const { startRelay } = require('./lib/relay');
let relay = null;
handle('collab:host', async (root) => {
  if (relay) await relay.close();
  relay = await startRelay({ root });
  return { port: relay.port, code: relay.code, addresses: relay.addresses };
});
handle('collab:stop', async () => { if (relay) { await relay.close(); relay = null; } });
handle('collab:guestDir', async (name) => {
  const safe = String(name || 'Shared project').replace(/[<>:"/\|?*]/g, '').trim() + ' (shared)';
  const dir = path.join(settings.projectsDir, safe);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
});
handle('fs:writeBase64', async (root, rel, b64) => { const f = inside(root, rel); await fsp.mkdir(path.dirname(f), { recursive: true }); await fsp.writeFile(f, Buffer.from(b64, 'base64')); });
handle('fs:readBase64', async (root, rel) => (await fsp.readFile(inside(root, rel))).toString('base64'));
handle('shell:open', async (url) => { if (/^https?:\/\//.test(url)) await shell.openExternal(url); });

app.whenReady().then(() => {
  loadSettings();
  protocol.handle('app', (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '');
    const file = path.resolve(APP_DIR, rel);
    if (!file.startsWith(path.resolve(APP_DIR) + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (relay) relay.close(); for (const r of running.keys()) stopCompile(r); app.quit(); });
