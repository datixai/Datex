// Downloads the Tectonic TeX engine (MIT licensed) into bin/ so it ships inside the installer.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const VERSION = '0.15.0';
const URL = `https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${VERSION}/tectonic-${VERSION}-x86_64-pc-windows-msvc.zip`;
const bin = path.join(__dirname, '..', 'bin');
const exe = path.join(bin, 'tectonic.exe');

(async () => {
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
