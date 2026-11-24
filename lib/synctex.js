// Built-in SyncTeX reader, so source <-> PDF jumping works without an external synctex tool.
'use strict';
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const SP_PER_BP = 65781.76; // TeX scaled points per PDF point

function parseSynctex(text, baseDir) {
  const inputs = {}; const recs = [];
  let unit = 1, xo = 0, yo = 0, mag = 1000, page = 0;
  for (const line of text.split('\n')) {
    const c = line[0];
    if (c === 'I' && line.startsWith('Input:')) {
      const m = line.match(/^Input:(\d+):(.*)$/);
      if (m) inputs[m[1]] = path.resolve(baseDir, m[2].trim());
    } else if (line.startsWith('Unit:')) unit = +line.slice(5) || 1;
    else if (line.startsWith('X Offset:')) xo = +line.slice(9) || 0;
    else if (line.startsWith('Y Offset:')) yo = +line.slice(9) || 0;
    else if (line.startsWith('Magnification:')) mag = +line.slice(14) || 1000;
    else if (c === '{') page = +line.slice(1);
    else if ('[(hvxkg$'.includes(c) && page) {
      const m = line.match(/^.(\d+),(\d+)(?::-?\d+)?:(-?\d+),(-?\d+)(?::(-?\d+),(-?\d+),(-?\d+))?/);
      if (!m) continue;
      const k = unit * (mag / 1000) / SP_PER_BP;
      recs.push({
        type: c, tag: m[1], line: +m[2], page,
        x: (+m[3] + xo) * k, y: (+m[4] + yo) * k,
        w: m[5] ? +m[5] * k : 0, h: m[6] ? +m[6] * k : 0
      });
    }
  }
  return { inputs, recs };
}

function load(pdfPath) {
  const base = pdfPath.replace(/\.pdf$/i, '');
  let txt = null;
  if (fs.existsSync(base + '.synctex.gz')) txt = zlib.gunzipSync(fs.readFileSync(base + '.synctex.gz')).toString('utf8');
  else if (fs.existsSync(base + '.synctex')) txt = fs.readFileSync(base + '.synctex', 'utf8');
  return txt ? txt : null;
}

const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

function forward(data, file, line) {
  const tags = Object.keys(data.inputs).filter(t => same(data.inputs[t], file));
  if (!tags.length) return null;
  let best = null, bestD = Infinity;
  for (const r of data.recs) {
    if (!tags.includes(r.tag)) continue;
    const d = Math.abs(r.line - line) * 2 + (r.line < line ? 1 : 0);
    if (d < bestD || (d === bestD && best && r.page === best.page && r.y < best.y)) { best = r; bestD = d; }
  }
  return best ? { page: best.page, x: best.x, y: best.y } : null;
}

function backward(data, page, x, y) {
  let best = null, bestD = Infinity;
  for (const r of data.recs) {
    if (r.page !== page || !r.line) continue;
    // Prefer small boxes and glue near the clicked point; large vboxes are poor matches.
    let dy = y - r.y; // record y is the baseline
    if (r.h) dy = (y > r.y - r.h && y < r.y + 2) ? 0 : Math.min(Math.abs(y - r.y), Math.abs(y - (r.y - r.h)));
    const dx = r.w ? (x >= r.x && x <= r.x + r.w ? 0 : Math.min(Math.abs(x - r.x), Math.abs(x - r.x - r.w))) : Math.abs(x - r.x);
    const d = Math.abs(dy) * 4 + dx * 0.5 + (r.type === '[' ? 40 : 0);
    if (d < bestD) { bestD = d; best = r; }
  }
  return best ? { file: data.inputs[best.tag], line: best.line } : null;
}

module.exports = { parseSynctex, load, forward, backward };
