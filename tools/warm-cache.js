// Compiles every template and the common package list with the built-in engine,
// so the installer ships with those packages already cached (works offline from day one).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const exe = path.join(root, 'bin', 'tectonic.exe');
const cache = path.join(root, 'tex-cache');
const env = { ...process.env, TECTONIC_CACHE_DIR: cache };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'datex-warm-'));

const jobs = [];
for (const d of fs.readdirSync(path.join(root, 'templates'))) {
  const dir = path.join(root, 'templates', d);
  if (fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, 'main.tex'))) jobs.push([dir, 'main.tex', d]);
}
jobs.push([path.join(root, 'templates'), 'packages.tex', 'packages']);
// Extra sets (journal classes, fonts, languages, biblatex styles, Beamer themes) from tools/warm.
// A failure there is only a warning, so one missing package never blocks a build.
const extra = path.join(__dirname, 'warm');
const optional = new Set();
if (fs.existsSync(extra)) for (const f of fs.readdirSync(extra).filter(f => f.endsWith('.tex'))) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'datex-w-'));
  fs.copyFileSync(path.join(extra, f), path.join(d, f));
  jobs.push([d, f, 'warm/' + f]); optional.add('warm/' + f);
}

let failed = 0;
for (const [dir, file, name] of jobs) {
  const out = path.join(tmp, name);
  fs.cpSync(dir, out, { recursive: true });
  try {
    execFileSync(exe, ['-X', 'compile', file, '--outdir', out], { cwd: out, env, stdio: 'pipe' });
    console.log('ok  ', name);
  } catch (e) {
    if (!optional.has(name)) failed++;
    console.log('FAIL', name, String(e.stderr || e.message).split('\n').filter(l => /error/i.test(l)).slice(0, 3).join(' | '));
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log('Cache size:', (dirSize(cache) / 1e6).toFixed(0), 'MB');
if (failed) process.exit(1);

function dirSize(p) { let n = 0; for (const e of fs.readdirSync(p, { withFileTypes: true })) n += e.isDirectory() ? dirSize(path.join(p, e.name)) : fs.statSync(path.join(p, e.name)).size; return n; }
