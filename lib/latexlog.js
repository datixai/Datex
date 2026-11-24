// Parse a LaTeX .log file (compiled with -file-line-error) into errors and warnings.
'use strict';

function parseLog(text) {
  const out = [];
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m = l.match(/^(?:\.\/|\.\\)?([^:\s][^:]*\.(?:tex|sty|cls|bib|bbl)):(\d+): (.*)$/);
    if (m) {
      // Context lines follow an error: "l.12 <text>" helps the user.
      let detail = '';
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        if (/^l\.\d+/.test(lines[j])) { detail = lines[j].trim(); break; }
      }
      out.push({ level: 'error', file: m[1].replace(/\\/g, '/'), line: +m[2], message: m[3].trim(), detail });
      continue;
    }
    if (/^! /.test(l)) {
      out.push({ level: 'error', file: null, line: null, message: l.slice(2).trim(), detail: '' });
      continue;
    }
    m = l.match(/^(?:LaTeX|Package (\S+)) Warning: (.*)$/);
    if (m) {
      let msg = m[2];
      let j = i + 1;
      while (j < lines.length && /^\s{2,}|^\(\S+\)\s/.test(lines[j]) && j < i + 5) { msg += ' ' + lines[j].replace(/^\(\S+\)/, '').trim(); j++; }
      const ln = msg.match(/on input line (\d+)/);
      out.push({ level: 'warning', file: null, line: ln ? +ln[1] : null, message: (m[1] ? m[1] + ': ' : '') + msg.trim(), detail: '' });
      continue;
    }
    if (/^(Overfull|Underfull) \\[hv]box/.test(l)) {
      const ln = l.match(/at lines? (\d+)/);
      out.push({ level: 'typesetting', file: null, line: ln ? +ln[1] : null, message: l.trim(), detail: '' });
    }
  }
  return out;
}

module.exports = { parseLog };
