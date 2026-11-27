// Prompt-to-document engine for the AI Build chat: the model reads the project and answers with
// edit blocks, which Datex applies to the files. Works in the window and in Node (tests), so it
// has no editor code in it.

// Files the AI may read and change.
export const EDITABLE = /\.(tex|bib|sty|cls|bst|txt|md|csv|dat|ltx|bbx|cbx|lbx)$/i;

export const BUILD_SYS = `You are Datex AI, a LaTeX expert built into the Datex editor by Datix AI. You build and change the user's LaTeX project directly: you are given the project files and you answer with edits that Datex applies for the user.

Start with one or two plain sentences that say what you are changing. Then give the edits in exactly this format.

To change part of an existing file:

FILE: path/of/file.tex
<<<<<<< SEARCH
lines copied exactly from the file
=======
the lines that replace them
>>>>>>> REPLACE

To create a new file, or to rewrite a whole file:

FILE: path/of/file.tex
<<<<<<< WRITE
the complete new content of the file
>>>>>>> END

Rules:
- SEARCH must be copied character for character from the current file, as whole lines, and be long enough to match one place only. Keep it short: a few lines around the change.
- Use several SEARCH blocks for several changes, each under its own FILE line. To add text, SEARCH for the line it goes after and repeat that line in the replacement.
- Use WRITE for new files and for short files you are rewriting completely. Never use WRITE on a file shown as shortened.
- Do not put edit blocks inside code fences and do not repeat unchanged files.
- The document must still compile. Load every package you use in the preamble of the main file. Close every environment you open.
- Never invent references. Cite only keys that exist in the project's .bib files. If a reference is needed and missing, write the text without \\cite and say so.
- Do not include image files that are not in the file list. Draw with TikZ, or leave a framed placeholder box.
- Do not invent results, numbers or data. Where the user must supply facts, write a clear placeholder such as [TODO: add result].
- When the request needs published work that is not in the project's .bib files (related work, a literature review, "find papers", "add citations"), do not cite from memory. Reply with only one to three lines of the form
ARXIV: a few search words
and nothing else. Datex searches arXiv and sends you the papers it finds. Then cite only those papers or keys already in the project, and add the BibTeX of every paper you cite to the project's .bib file with an empty SEARCH block. Use ARXIV at most once per request.
- When pictures are attached, turn what they show (handwritten or printed equations, tables, diagrams, notes) into LaTeX and put it where the user asks, or at the cursor if they do not say. Draw diagrams with TikZ.
- If the user only asks a question, answer in plain words with no edit blocks.`;

// Literature searches the model asked for (lines "ARXIV: words"), three at most.
export function parseSearches(text) {
  const out = [];
  for (const m of String(text).matchAll(/^\s*\**ARXIV\**\s*:\s*\**\s*(.+?)\s*\**\s*$/gim)) {
    const q = m[1].replace(/^["'`]|["'`]$/g, '').trim();
    if (q && !out.includes(q)) out.push(q);
  }
  return out.slice(0, 3);
}

// The search results as the model reads them: what each paper is, and the BibTeX to add if cited.
export function papersMessage(papers, bibFile) {
  if (!papers.length) return 'arXiv returned no papers for those searches. Carry out the request without new citations: do not invent any, and say in your first sentence that no papers were found.';
  return 'Papers found on arXiv:\n\n' + papers.map(p =>
    `[${p.key}] ${p.title}\n${p.authors.slice(0, 4).join(', ')}${p.authors.length > 4 ? ' et al.' : ''} (${p.year})\nAbstract: ${p.summary.slice(0, 450)}\nBibTeX:\n${p.bibtex}`).join('\n\n') +
    `\n\nNow carry out the request with edit blocks. Cite only these papers (by the key in square brackets) or keys already in the project, and only papers that really fit. Describe each paper only by what its abstract says. Add the BibTeX of every paper you cite to ${bibFile || 'references.bib'} with an empty SEARCH block${bibFile ? '' : ', and make sure the main file loads that bibliography'}. Do not use ARXIV again.`;
}

const RE_FILE = /^\s*(?:#{1,6}\s*)?\**\s*FILE\s*:\s*\**\s*`?([^`*\r\n]+?)`?\s*\**\s*$/i;
const RE_SEARCH = /^\s*<{3,}\s*SEARCH\s*$/i;
const RE_WRITE = /^\s*<{3,}\s*WRITE\s*$/i;
const RE_MID = /^\s*={5,}\s*$/;
// Small local models often get the closing marker wrong, so any of these closes a block.
const RE_CLOSE = /^\s*>{3,}\s*(?:END|WRITE|REPLACE|SEARCH)?\s*$/i;
const RE_BARE_END = /^\s*END\s*$/;
const RE_FENCE = /^\s*```[\w-]*\s*$/;
// Take stray separator lines and blank lines off the end of a block's content.
const trimTail = lines => { const l = [...lines]; while (l.length && (!l[l.length - 1].trim() || RE_MID.test(l[l.length - 1]))) l.pop(); return l; };

// A path the model named: forward slashes, inside the project, an editable text file.
export function safePath(p) {
  let s = String(p || '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^["']|["']$/g, '');
  if (!s || s.startsWith('/') || /^[A-Za-z]:/.test(s) || s.split('/').some(x => x === '..' || x === '' || x.startsWith('.'))) return null;
  if (/[<>:"|?*]/.test(s) || !EDITABLE.test(s)) return null;
  return s;
}

// Walk the reply once. Returns the edit blocks, the plain words around them, and the file being
// written when the reply stops in the middle of a block (while it is still streaming).
function scan(text) {
  const ops = [], prose = [];
  let path = null, mode = null, a = [], b = [];
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const close = () => {
    if (mode === 'write') ops.push({ path, kind: 'write', content: trimTail(a).join('\n') });
    else if (mode === 'replace') ops.push({ path, kind: 'replace', search: a.join('\n'), replace: b.join('\n') });
    mode = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (mode) {
      // A block that was never closed ends where the next file's block begins,
      // or at a bare END that follows a separator line.
      let n = i + 1; while (n < lines.length && !lines[n].trim()) n++;
      const nextOpens = n < lines.length && (RE_SEARCH.test(lines[n]) || RE_WRITE.test(lines[n]));
      let k = (mode === 'replace' ? b : a).length - 1; const cur = mode === 'replace' ? b : a;
      while (k >= 0 && !cur[k].trim()) k--;
      const afterSeparator = k >= 0 && RE_MID.test(cur[k]);
      if (mode !== 'search' && ((RE_FILE.test(line) && nextOpens) || (RE_BARE_END.test(line) && afterSeparator))) {
        if (mode === 'replace') b = trimTail(b);
        close();
        if (RE_BARE_END.test(line)) continue;
      }
    }
    if (!mode) {
      const f = line.match(RE_FILE);
      if (f) { path = f[1].trim(); continue; }
      if (RE_SEARCH.test(line) && path) { mode = 'search'; a = []; b = []; continue; }
      if (RE_WRITE.test(line) && path) { mode = 'write'; a = []; continue; }
      if (!RE_FENCE.test(line)) prose.push(line);
    } else if (mode === 'search') {
      if (RE_MID.test(line)) mode = 'replace'; else a.push(line);
    } else if (mode === 'replace') {
      if (RE_CLOSE.test(line)) close(); else b.push(line);
    } else if (mode === 'write') {
      if (RE_CLOSE.test(line)) close(); else a.push(line);
    }
  }
  return { ops, prose: prose.join('\n').replace(/\n{3,}/g, '\n\n').trim(), writing: mode ? path : null };
}

// The edits in a finished reply. Blocks with a path outside the project are dropped.
export function parseEdits(text) {
  const out = [];
  for (const op of scan(text).ops) {
    const p = safePath(op.path);
    if (!p) continue;
    // A model sometimes wraps the content of a block in a code fence: take the fence off.
    const strip = s => { const l = s.split('\n'); if (l.length >= 2 && RE_FENCE.test(l[0]) && RE_FENCE.test(l[l.length - 1])) return l.slice(1, -1).join('\n'); return s; };
    out.push(op.kind === 'write' ? { path: p, kind: 'write', content: strip(op.content) } : { path: p, kind: 'replace', search: strip(op.search), replace: strip(op.replace) });
  }
  return out;
}

// What to show while the reply streams in: the plain words, and which files are being edited.
export function progress(text) {
  const s = scan(text);
  const files = [...new Set(s.ops.map(o => safePath(o.path)).filter(Boolean))];
  return { prose: s.prose, files, writing: s.writing ? safePath(s.writing) : null };
}

// A model that ignores the format and answers with one complete document in a code fence.
export function wholeDocument(text) {
  for (const m of String(text).matchAll(/```(?:latex|tex)?\s*\n([\s\S]*?)```/g)) {
    if (/\\documentclass/.test(m[1]) && /\\end\{document\}/.test(m[1])) return m[1].trim() + '\n';
  }
  return null;
}

// Find `search` in `text`: exactly first, then line by line ignoring indentation and trailing spaces.
function locate(text, search) {
  const at = text.indexOf(search);
  if (at >= 0) return { start: at, end: at + search.length };
  const want = search.split('\n').map(l => l.trim());
  while (want.length && !want[0]) want.shift();
  while (want.length && !want[want.length - 1]) want.pop();
  if (!want.length) return null;
  const lines = text.split('\n'), have = lines.map(l => l.trim());
  for (let i = 0; i + want.length <= have.length; i++) {
    let ok = true;
    for (let k = 0; k < want.length; k++) if (have[i + k] !== want[k]) { ok = false; break; }
    if (!ok) continue;
    const start = lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0);
    const end = start + lines.slice(i, i + want.length).join('\n').length;
    return { start, end };
  }
  return null;
}

// Apply edits to the project. `texts` maps each path to its current text, or null when the file
// does not exist yet. Returns the files that changed and the blocks that could not be placed.
export function applyOps(texts, ops) {
  const now = new Map(), failed = [];
  const get = p => now.has(p) ? now.get(p) : (texts[p] == null ? null : String(texts[p]).replace(/\r\n/g, '\n'));
  for (const op of ops) {
    const cur = get(op.path);
    if (op.kind === 'write') { now.set(op.path, op.content.replace(/\s*$/, '') + '\n'); continue; }
    if (!op.search.trim()) {
      // Nothing to search for: add the text at the end (or start the file with it).
      now.set(op.path, (cur ? cur.replace(/\s*$/, '') + '\n\n' : '') + op.replace.replace(/\s*$/, '') + '\n');
      continue;
    }
    if (cur == null) { failed.push({ path: op.path, why: 'The file does not exist', search: op.search }); continue; }
    const hit = locate(cur, op.search);
    if (!hit) { failed.push({ path: op.path, why: 'The text to replace was not found', search: op.search }); continue; }
    now.set(op.path, cur.slice(0, hit.start) + op.replace + cur.slice(hit.end));
  }
  const files = [];
  for (const [p, after] of now) {
    const before = texts[p] == null ? null : String(texts[p]).replace(/\r\n/g, '\n');
    if (before === after) continue;
    files.push({ path: p, before, after, created: before == null, ...diffStat(before || '', after) });
  }
  return { files, failed };
}

// Lines added and removed, counted without regard to order (enough for a "+12 −3" label).
export function diffStat(before, after) {
  const count = new Map();
  const A = before ? before.split('\n') : [], B = after ? after.split('\n') : [];
  for (const l of A) count.set(l, (count.get(l) || 0) + 1);
  let added = 0;
  for (const l of B) { const n = count.get(l) || 0; if (n) count.set(l, n - 1); else added++; }
  let removed = 0;
  for (const n of count.values()) removed += n;
  return { added, removed };
}

// The smallest single replacement that turns `before` into `after` (keeps undo and live sync small).
export function minimalEdit(before, after) {
  let s = 0;
  const max = Math.min(before.length, after.length);
  while (s < max && before[s] === after[s]) s++;
  let e = 0;
  while (e < max - s && before[before.length - 1 - e] === after[after.length - 1 - e]) e++;
  return { start: s, end: before.length - e, text: after.slice(s, after.length - e) };
}

// A long .bib file is shown as its keys only, which is all the model needs in order to cite.
function bibKeys(text) {
  const out = [];
  for (const m of text.matchAll(/@(\w+)\s*\{\s*([^,\s]+)\s*,([\s\S]*?)(?=\n@|$)/g)) {
    if (/^(comment|string|preamble)$/i.test(m[1])) continue;
    const field = n => ((m[3].match(new RegExp('\\b' + n + '\\s*=\\s*[{"]?([^\\n]*)', 'i')) || [])[1] || '').replace(/[{}"]/g, '').replace(/,\s*$/, '').trim();
    out.push(`${m[2]}: ${field('title').slice(0, 90)}${field('year') ? ' (' + field('year') + ')' : ''}`);
  }
  return out;
}

// The project as the model sees it: the file list, then the files, most relevant first, within a
// size budget. Files that do not fit are shortened and marked, so the model does not rewrite them.
export function buildContext({ files, main, active, selection, cursorLine, issues = [], budget = 60000 }) {
  const rank = f => f.path === main ? 0 : f.path === active ? 1 : /\.tex$/i.test(f.path) ? 2 : /\.bib$/i.test(f.path) ? 3 : 4;
  const sorted = [...files].sort((x, y) => rank(x) - rank(y) || x.path.localeCompare(y.path));
  const parts = [`Project files: ${files.map(f => f.path).join(', ') || '(none)'}`, `Main file (the one that is compiled): ${main}`];
  if (active) parts.push(`File open in the editor: ${active}${cursorLine ? ` (the cursor is at line ${cursorLine})` : ''}`);
  let left = budget;
  for (const f of sorted) {
    let body = f.text.replace(/\r\n/g, '\n'), note = '';
    if (/\.bib$/i.test(f.path) && body.length > 4000) {
      body = bibKeys(body).join('\n'); note = ' (shortened: citation keys only; add new entries with an empty SEARCH block)';
    }
    if (body.length > left) {
      if (left < 400) { parts.push(`\n===== ${f.path} (not shown: too large) =====`); continue; }
      body = body.slice(0, left); note = ' (shortened: only the beginning is shown; do not use WRITE on it)';
    }
    left -= body.length;
    parts.push(`\n===== ${f.path}${note} =====\n${body}`);
  }
  if (selection) parts.push(`\n===== Text the user has selected in ${active} =====\n${selection.slice(0, 6000)}`);
  const errs = issues.filter(i => i.level === 'error').slice(0, 8);
  if (errs.length) parts.push('\n===== Current compile errors =====\n' + errs.map(e => `${e.file || main}${e.line ? ':' + e.line : ''}: ${e.message}${e.detail ? ' ' + e.detail : ''}`).join('\n'));
  return parts.join('\n');
}

// Context window to ask the local model for: room for the prompt and a long answer.
export function contextTokens(chars) {
  return Math.min(32768, Math.max(8192, Math.ceil(chars / 3) + 6144));
}
