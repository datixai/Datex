// Downloads the Tectonic TeX engine (MIT licensed) into bin/ so it ships inside the installer.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const VERSION = '0.15.0';
const URL = `https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${VERSION}/tectonic-${VERSION}-x86_64-pc-windows-msvc.zip`;
const bin = path.join(__dirname, '..', 'bin');
const exe = path.join(bin, 'tectonic.exe');

// Pandoc (GPL, run as a separate program) converts LaTeX projects to Word documents.
async function fetchPandoc() {
  const dir = path.join(bin, 'pandoc');
  if (fs.existsSync(path.join(dir, 'pandoc.exe'))) return console.log('Pandoc already present');
  const rel = await (await fetch('https://api.github.com/repos/jgm/pandoc/releases/latest', { headers: { 'User-Agent': 'datex-build' } })).json();
  const asset = (rel.assets || []).find(a => /windows-x86_64\.zip$/.test(a.name));
  if (!asset) throw new Error('Pandoc Windows build not found in the latest release');
  console.log('Downloading', asset.name, Math.round(asset.size / 1e6) + ' MB ...');
  const zip = path.join(bin, 'pandoc.zip');
  fs.writeFileSync(zip, Buffer.from(await (await fetch(asset.browser_download_url)).arrayBuffer()));
  const tmp = path.join(bin, 'pandoc-tmp'); fs.mkdirSync(tmp, { recursive: true });
  execFileSync(path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', tmp]);
  const inner = path.join(tmp, fs.readdirSync(tmp)[0]);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(inner)) fs.renameSync(path.join(inner, f), path.join(dir, f));
  fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(zip);
  console.log(execFileSync(path.join(dir, 'pandoc.exe'), ['--version']).toString().split(String.fromCharCode(10))[0]);
}

(async () => {
  fs.mkdirSync(bin, { recursive: true });
  await fetchPandoc();
  if (fs.existsSync(exe)) return console.log('Engine already present:', exe);
  fs.mkdirSync(bin, { recursive: true });
  console.log('Downloading Tectonic', VERSION, '...');
  const res = await fetch(URL);
  if (!res.ok) throw new Error('Download failed: ' + res.status);
  const zip = path.join(bin, 'tectonic.zip');
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  execFileSync(path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', bin]);
  fs.rmSync(zip);
  console.log(execFileSync(exe, ['--version']).toString().trim());
})().catch(e => { console.error(e.message); process.exit(1); });
