// Visual mode: show LaTeX source the way it will read (headings, bold, bullets, citation chips)
// without changing a character of it. This file only works out WHAT to style on each line; the
// editor applies it as decorations. The line the cursor is on is left as plain code, so anything
// can still be edited exactly. Works in the window and in Node (tests).

const HEAD = { part: 'vz-h1', chapter: 'vz-h1', section: 'vz-h1', subsection: 'vz-h2', subsubsection: 'vz-h3', paragraph: 'vz-h3' };
const STYLE = { textbf: 'vz-b', textit: 'vz-i', emph: 'vz-i', underline: 'vz-u', texttt: 'vz-tt', textsc: 'vz-sc', title: 'vz-h1', author: 'vz-i', caption: 'vz-i' };
const CHIP = new Set(['cite', 'citep', 'citet', 'parencite', 'textcite', 'autocite', 'ref', 'eqref', 'cref', 'Cref', 'autoref', 'pageref']);
const QUIET = new Set(['label', 'bibliography', 'bibliographystyle', 'addbibresource', 'input', 'include', 'includegraphics', 'usepackage', 'documentclass', 'vspace', 'hspace']);

// Index of the brace that closes the one at `open`, or -1.
export function matchBrace(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) return i;
  }
  return -1;
}
// Where a comment starts on the line (an unescaped %), or -1.
export function commentStart(s) {
  for (let i = 0; i < s.length; i++) { if (s[i] === '\\') { i++; continue; } if (s[i] === '%') return i; }
  return -1;
}

// Marks for one line of the document body. Columns are 0-based, end exclusive.
// kind: 'hide' (not shown), 'style' (shown with class cls), 'bullet' (a bullet drawn before start).
export function lineMarks(text) {
  const marks = [];
  const cut = commentStart(text);
  const s = cut < 0 ? text : text.slice(0, cut);
  if (cut >= 0) marks.push({ kind: 'style', start: cut, end: text.length, cls: 'vz-dim' });
  const re = /\\([A-Za-z]+)(\*?)/g;
  let m;
  while ((m = re.exec(s))) {
    const name = m[1], at = m.index, after = at + m[0].length;
    if (name === 'item') {
      // "\item " becomes a bullet; an optional [label] stays visible.
      let end = after; while (s[end] === ' ') end++;
      marks.push({ kind: 'hide', start: at, end }, { kind: 'bullet', start: at });
      continue;
    }
    if (name === 'begin' || name === 'end') {
      const close = s[after] === '{' ? matchBrace(s, after) : -1;
      if (close > 0) { marks.push({ kind: 'style', start: at, end: close + 1, cls: 'vz-env' }); re.lastIndex = close + 1; }
      continue;
    }
    // Skip an optional [..] argument, then expect {..}.
    let open = after;
    if (s[open] === '[') { const sq = s.indexOf(']', open); if (sq > 0) open = sq + 1; }
    if (s[open] !== '{') continue;
    const close = matchBrace(s, open);
    if (close < 0) continue;
    const cls = HEAD[name] || STYLE[name];
    if (cls) {
      marks.push({ kind: 'hide', start: at, end: open + 1 }, { kind: 'style', start: open + 1, end: close, cls }, { kind: 'hide', start: close, end: close + 1 });
      re.lastIndex = open + 1; // styles inside (bold in a heading) are found too
    } else if (CHIP.has(name)) {
      marks.push({ kind: 'hide', start: at, end: open + 1 }, { kind: 'style', start: open + 1, end: close, cls: /ref$/i.test(name) ? 'vz-chip vz-ref' : 'vz-chip' }, { kind: 'hide', start: close, end: close + 1 });
      re.lastIndex = close + 1;
    } else if (QUIET.has(name)) {
      marks.push({ kind: 'style', start: at, end: close + 1, cls: 'vz-dim' });
      re.lastIndex = close + 1;
    }
  }
  // Inline math: $...$ (not \$ and not $$).
  for (const d of s.matchAll(/(^|[^\\$])\$(?!\$)((?:\\.|[^$\\])+?)\$/g)) {
    const start = d.index + d[1].length;
    marks.push({ kind: 'style', start, end: start + d[2].length + 2, cls: 'vz-math' });
  }
  return marks.filter(k => k.kind === 'bullet' || k.end > k.start);
}

// Marks for a whole document. Lines before \begin{document} (the preamble) are shown small and
// dimmed as a block; `skipLine` (1-based, the cursor line) is left untouched.
export function documentMarks(lines, skipLine) {
  const out = [];
  let body = lines.findIndex(l => /^[^%]*\\begin\{document\}/.test(l));
  const hasPreamble = body >= 0 && lines.slice(0, body).some(l => /\\documentclass/.test(l));
  if (!hasPreamble) body = -1; // a chapter file: everything is body
  for (let i = 0; i < lines.length; i++) {
    const line = i + 1;
    if (line === skipLine) continue;
    if (i < body) { if (lines[i].length) out.push({ line, kind: 'style', start: 0, end: lines[i].length, cls: 'vz-pre' }); continue; }
    for (const k of lineMarks(lines[i])) out.push({ line, ...k });
  }
  return out;
}
