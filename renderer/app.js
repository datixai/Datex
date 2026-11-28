// Datex renderer. Developed by Datix AI (datixai.com) and XactGen AI (xactgenai.com).
import * as pdfjsLib from '../node_modules/pdfjs-dist/build/pdf.mjs';
import { LATEX_COMMANDS, ENVIRONMENTS, SYMBOLS, AI_ACTIONS } from './data.js';
import * as live from './live.js';
import { BUILD_SYS, EDITABLE, parseSearches, papersMessage, parseEdits, applyOps, progress, wholeDocument, minimalEdit, buildContext, contextTokens } from './aibuild.js';
import { starfield } from './stars.js';
import { documentMarks } from './visual.js';
const splashStart = performance.now();
const stopSplashStars = starfield(document.querySelector('#splash .sky'), { density: 0.00028 });

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;

const api = (ch, ...a) => window.datex.call(ch, ...a);
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const TEXT_EXT = /\.(tex|bib|sty|cls|bst|txt|md|csv|dat|lua|py|R|json|xml|yaml|yml|cfg|def|ltx|dtx|ins|bbx|cbx|lbx)$/i;
const IMG_EXT = /\.(png|jpe?g|gif|svg|bmp|webp)$/i;

let monaco, editor;
let settings = {};
let tex = {};
const S = {
  root: null, name: '', main: 'main.tex', engine: 'auto',
  files: new Map(), active: null, tree: [], issues: [],
  pdf: null, pdfPath: null, pages: [], zoom: 'fit',
  comments: [], bib: [], labels: [], lastSnap: 0, compiling: false, panel: null
};

// ---------------- UI helpers ----------------
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), err ? 6000 : 2800);
}
function status(msg) { $('#status').textContent = msg; }
function modal(html, wide) {
  const card = $('#modalCard'); card.className = 'modal-card' + (wide ? ' wide' : ''); card.innerHTML = html;
  $('#modal').classList.remove('hidden'); return card;
}
function closeModal() { $('#modal').classList.add('hidden'); $('#modalCard').innerHTML = ''; closeModal.onClose && closeModal.onClose(); closeModal.onClose = null; }
function promptModal(title, label, value = '') {
  return new Promise(res => {
    const c = modal(`<h2>${esc(title)}</h2><label>${esc(label)}</label><input id="pmVal" value="${esc(value)}">
      <div class="modal-actions"><button class="btn ghost" id="pmNo">Cancel</button><button class="btn primary" id="pmOk">OK</button></div>`);
    const inp = c.querySelector('#pmVal'); inp.focus(); inp.select();
    const done = v => { closeModal(); res(v); };
    c.querySelector('#pmOk').onclick = () => done(inp.value.trim() || null);
    c.querySelector('#pmNo').onclick = () => done(null);
    inp.onkeydown = e => { if (e.key === 'Enter') done(inp.value.trim() || null); if (e.key === 'Escape') done(null); };
  });
}
function confirmModal(title, text, ok = 'OK', danger) {
  return new Promise(res => {
    const c = modal(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="modal-actions"><button class="btn ghost" id="cmNo">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" id="cmOk">${esc(ok)}</button></div>`);
    c.querySelector('#cmOk').onclick = () => { closeModal(); res(true); };
    c.querySelector('#cmNo').onclick = () => { closeModal(); res(false); };
  });
}
// Theme: 'system' follows Windows light/dark mode, or the user picks 'light' or 'dark' in Settings.
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
const isDark = () => settings.theme === 'dark' || (settings.theme !== 'light' && systemDark.matches);
function applyTheme() {
  document.body.className = isDark() ? 'dark' : 'light';
  if (monaco) monaco.editor.setTheme(isDark() ? 'datex-dark' : 'datex-light');
  // The switch shows what a click will change to.
  for (const b of document.querySelectorAll('.theme-btn')) b.innerHTML = b.closest('.topbar') ? (isDark() ? '&#9728;' : '&#9790;') : (isDark() ? '&#9728; Light mode' : '&#9790; Dark mode');
}
systemDark.addEventListener('change', () => applyTheme());
const fmtTime = t => new Date(t).toLocaleString();

// ---------------- Monaco ----------------
function loadMonaco() {
  return new Promise(res => {
    window.require.config({ paths: { vs: '../node_modules/monaco-editor/min/vs' } });
    window.require(['vs/editor/editor.main'], () => res(window.monaco));
  });
}

function setupLanguages() {
  monaco.languages.register({ id: 'latex', extensions: ['.tex', '.sty', '.cls', '.ltx'] });
  monaco.languages.setLanguageConfiguration('latex', {
    comments: { lineComment: '%' },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [{ open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' }, { open: '$', close: '$' }],
    surroundingPairs: [{ open: '{', close: '}' }, { open: '[', close: ']' }, { open: '$', close: '$' }],
    wordPattern: /\\?[A-Za-z@]+\*?/
  });
  monaco.languages.setMonarchTokensProvider('latex', {
    tokenizer: {
      root: [
        [/%.*$/, 'comment'],
        [/(\\(?:begin|end))(\{)([^}]*)(\})/,['keyword.control', 'delimiter.bracket', 'type', 'delimiter.bracket']],
        [/\\(section|subsection|subsubsection|chapter|part|paragraph)\*?/, 'keyword.control'],
        [/\\[a-zA-Z@]+\*?/, 'keyword'],
        [/\\./, 'keyword'],
        [/\$\$/, { token: 'string', next: '@mathd' }],
        [/\$/, { token: 'string', next: '@math' }],
        [/\\\[/, { token: 'string', next: '@mathb' }],
        [/[{}]/, 'delimiter.bracket'], [/[\[\]]/, 'delimiter.square'], [/&/, 'operator']
      ],
      math: [[/\$/, { token: 'string', next: '@pop' }], [/\\[a-zA-Z]+/, 'variable'], [/%.*$/, 'comment'], [/[^\\$%]+/, 'string'], [/./, 'string']],
      mathd: [[/\$\$/, { token: 'string', next: '@pop' }], [/\\[a-zA-Z]+/, 'variable'], [/[^\\$]+/, 'string'], [/./, 'string']],
      mathb: [[/\\\]/, { token: 'string', next: '@pop' }], [/\\[a-zA-Z]+/, 'variable'], [/[^\\]+/, 'string'], [/./, 'string']]
    }
  });
  monaco.languages.register({ id: 'bibtex', extensions: ['.bib'] });
  monaco.languages.setLanguageConfiguration('bibtex', { comments: { lineComment: '%' }, brackets: [['{', '}']], autoClosingPairs: [{ open: '{', close: '}' }, { open: '"', close: '"' }] });
  monaco.languages.setMonarchTokensProvider('bibtex', {
    tokenizer: { root: [[/%.*$/, 'comment'], [/@\w+/, 'keyword'], [/\w+(?=\s*=)/, 'attribute.name'], [/"[^"]*"/, 'string'], [/[{}]/, 'delimiter.bracket'], [/\d+/, 'number']] }
  });

  monaco.editor.defineTheme('datex-dark', { base: 'vs-dark', inherit: true, rules: [
    { token: '', foreground: 'd9d9d9' }, { token: 'keyword', foreground: 'ffffff' }, { token: 'keyword.control', foreground: 'ffffff', fontStyle: 'bold' },
    { token: 'type', foreground: 'ffffff', fontStyle: 'underline' }, { token: 'string', foreground: 'b3b3b3', fontStyle: 'italic' }, { token: 'variable', foreground: 'cfcfcf' },
    { token: 'delimiter', foreground: '8a8a8a' }, { token: 'delimiter.bracket', foreground: '8a8a8a' }, { token: 'delimiter.square', foreground: '8a8a8a' }, { token: 'comment', foreground: '6a6a6a', fontStyle: 'italic' }],
    colors: { 'editor.background': '#000000', 'editorGutter.background': '#000000', 'editor.lineHighlightBackground': '#111111', 'editorLineNumber.foreground': '#4d4d4d', 'editorLineNumber.activeForeground': '#ffffff', 'editorCursor.foreground': '#ffffff', 'editor.selectionBackground': '#3a3a3a', 'minimap.background': '#000000', 'editorBracketHighlight.foreground1': '#8a8a8a', 'editorBracketHighlight.foreground2': '#8a8a8a', 'editorBracketHighlight.foreground3': '#8a8a8a', 'editorBracketHighlight.foreground4': '#8a8a8a', 'editorBracketHighlight.foreground5': '#8a8a8a', 'editorBracketHighlight.foreground6': '#8a8a8a', 'editorBracketHighlight.unexpectedBracket.foreground': '#8a8a8a' } });
  monaco.editor.defineTheme('datex-light', { base: 'vs', inherit: true, rules: [
    { token: '', foreground: '262626' }, { token: 'keyword', foreground: '000000' }, { token: 'keyword.control', foreground: '000000', fontStyle: 'bold' },
    { token: 'type', foreground: '000000', fontStyle: 'underline' }, { token: 'string', foreground: '555555', fontStyle: 'italic' }, { token: 'variable', foreground: '333333' },
    { token: 'delimiter', foreground: '777777' }, { token: 'delimiter.bracket', foreground: '777777' }, { token: 'delimiter.square', foreground: '777777' }, { token: 'comment', foreground: '9a9a9a', fontStyle: 'italic' }],
    colors: { 'editor.background': '#ffffff', 'editor.lineHighlightBackground': '#f4f4f4', 'editorCursor.foreground': '#000000', 'editor.selectionBackground': '#d6d6d6', 'editorBracketHighlight.foreground1': '#777777', 'editorBracketHighlight.foreground2': '#777777', 'editorBracketHighlight.foreground3': '#777777', 'editorBracketHighlight.foreground4': '#777777', 'editorBracketHighlight.foreground5': '#777777', 'editorBracketHighlight.foreground6': '#777777', 'editorBracketHighlight.unexpectedBracket.foreground': '#777777' } });

  const K = monaco.languages.CompletionItemKind, R = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
  monaco.languages.registerCompletionItemProvider('latex', {
    triggerCharacters: ['\\', '{', ','],
    provideCompletionItems(model, pos) {
      const before = model.getValueInRange({ startLineNumber: pos.lineNumber, startColumn: 1, endLineNumber: pos.lineNumber, endColumn: pos.column });
      const word = model.getWordUntilPosition(pos);
      const range = { startLineNumber: pos.lineNumber, endLineNumber: pos.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
      const argRange = m => ({ startLineNumber: pos.lineNumber, endLineNumber: pos.lineNumber, startColumn: pos.column - m.length, endColumn: pos.column });
      let m;
      if ((m = before.match(/\\(?:no)?cite[a-zA-Z]*\*?(?:\[[^\]]*\])*\{(?:[^}]*,)?\s*([^,}]*)$/))) {
        return { suggestions: S.bib.map(b => ({ label: b.key, kind: K.Reference, insertText: b.key, range: argRange(m[1]),
          detail: (b.fields.author || '').split(' and ')[0] + (b.fields.year ? ' (' + b.fields.year + ')' : ''), documentation: b.fields.title || '' })) };
      }
      if ((m = before.match(/\\(?:ref|eqref|autoref|cref|Cref|pageref|nameref|vref)\{([^}]*)$/))) {
        return { suggestions: S.labels.map(l => ({ label: l.label, kind: K.Reference, insertText: l.label, range: argRange(m[1]), detail: l.file + ':' + l.line })) };
      }
      if ((m = before.match(/\\includegraphics(?:\[[^\]]*\])?\{([^}]*)$/))) {
        return { suggestions: allFiles().filter(f => /\.(png|jpe?g|pdf|eps|svg)$/i.test(f)).map(f => ({ label: f, kind: K.File, insertText: f, range: argRange(m[1]) })) };
      }
      if ((m = before.match(/\\(?:input|include|subfile)\{([^}]*)$/))) {
        return { suggestions: allFiles().filter(f => /\.tex$/i.test(f)).map(f => ({ label: f, kind: K.File, insertText: f.replace(/\.tex$/, ''), range: argRange(m[1]) })) };
      }
      if ((m = before.match(/\\(?:bibliography|addbibresource)\{([^}]*)$/))) {
        return { suggestions: allFiles().filter(f => /\.bib$/i.test(f)).map(f => ({ label: f, kind: K.File, insertText: f, range: argRange(m[1]) })) };
      }
      if ((m = before.match(/\\begin\{([^}]*)$/))) {
        return { suggestions: ENVIRONMENTS.map(e => ({ label: e, kind: K.Module, insertText: e + '}\n\t$0\n\\end{' + e, insertTextRules: R, range: argRange(m[1]) })) };
      }
      if (/\\[a-zA-Z]*$/.test(before)) {
        const r = { ...range, startColumn: range.startColumn > 1 && before.endsWith('\\') ? pos.column - 1 : range.startColumn };
        const typed = before.match(/\\[a-zA-Z]*$/)[0];
        r.startColumn = pos.column - typed.length;
        return { suggestions: [
          ...LATEX_COMMANDS.map(([label, snip, doc]) => ({ label, kind: K.Function, insertText: snip, insertTextRules: R, range: r, documentation: doc || '' })),
          ...ENVIRONMENTS.map(e => ({ label: '\\begin{' + e + '}', kind: K.Snippet, insertText: '\\begin{' + e + '}\n\t$0\n\\end{' + e + '}', insertTextRules: R, range: r, sortText: 'z' + e }))
        ] };
      }
      return { suggestions: [] };
    }
  });
  monaco.languages.registerCodeActionProvider('latex', {
    provideCodeActions(model, range, ctx) {
      const actions = [];
      for (const mk of ctx.markers.filter(x => x.owner === 'spell' || x.source === 'spell')) {
        const w = model.getValueInRange(mk);
        for (const s of (spellBad[w] || [])) actions.push({ title: `Change to "${s}"`, kind: 'quickfix', diagnostics: [mk], edit: { edits: [{ resource: model.uri, textEdit: { range: mk, text: s }, versionId: model.getVersionId() }] } });
        actions.push({ title: `Add "${w}" to dictionary`, kind: 'quickfix', diagnostics: [mk], command: { id: addWordCmd, title: 'Add', arguments: [w] } });
      }
      return { actions, dispose() {} };
    }
  });
}
let addWordCmd = null;

function createEditor() {
  editor = monaco.editor.create($('#editor'), {
    theme: isDark() ? 'datex-dark' : 'datex-light', automaticLayout: true,
    fontSize: settings.fontSize || 14, fontFamily: 'Cascadia Code, Consolas, monospace', wordWrap: settings.wordWrap ? 'on' : 'off',
    minimap: { enabled: true, renderCharacters: false }, glyphMargin: true, lineNumbersMinChars: 4,
    bracketPairColorization: { enabled: false }, matchBrackets: 'always', smoothScrolling: true, scrollBeyondLastLine: false,
    quickSuggestions: { other: true, comments: false, strings: true }, suggestOnTriggerCharacters: true, tabSize: 2, unicodeHighlight: { ambiguousCharacters: false }
  });
  addWordCmd = editor.addCommand(0, async (_a, w) => { await api('spell:add', w); delete spellBad[w]; spellCheck(); });
  const KM = monaco.KeyMod, KC = monaco.KeyCode;
  editor.addCommand(KM.CtrlCmd | KC.Enter, () => compile());
  editor.addCommand(KM.CtrlCmd | KC.KeyS, () => { saveAll(); compile(); });
  editor.addCommand(KM.CtrlCmd | KC.KeyK, () => $('#promptIn').focus());
  editor.addCommand(KM.CtrlCmd | KC.KeyB, () => wrap('\\textbf{', '}'));
  editor.addCommand(KM.CtrlCmd | KC.KeyI, () => wrap('\\textit{', '}'));
  editor.addCommand(KM.CtrlCmd | KM.Alt | KC.KeyJ, () => syncForward());
  editor.onDidChangeCursorPosition(e => { $('#cursorPos').textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`; });
  editor.onDidChangeModelContent(() => {
    const f = S.files.get(S.active); if (!f) return;
    f.dirty = true; renderTabs(); autosave(); if ($('#autoChk').checked) autoCompile();
    liveStats();
  });
}

function wrap(pre, post) {
  const sel = editor.getSelection(); const txt = editor.getModel().getValueInRange(sel);
  editor.executeEdits('datex', [{ range: sel, text: pre + txt + post, forceMoveMarkers: true }]);
  if (!txt) { const p = editor.getPosition(); editor.setPosition({ lineNumber: p.lineNumber, column: p.column - post.length }); }
  editor.focus();
}
function insertText(text) {
  const sel = editor.getSelection();
  if (/\$\d|\$\{/.test(text)) { editor.focus(); editor.getContribution('snippetController2').insert(text); return; }
  editor.executeEdits('datex', [{ range: sel, text, forceMoveMarkers: true }]); editor.focus();
}

// ---------------- Formatting toolbar (WinEdt style) ----------------
const FMT = [
  ['B', 'Bold (Ctrl+B)', () => wrap('\\textbf{', '}')], ['I', 'Italic (Ctrl+I)', () => wrap('\\textit{', '}')],
  ['U', 'Underline', () => wrap('\\underline{', '}')], ['TT', 'Monospace', () => wrap('\\texttt{', '}')], ['|'],
  ['H1', 'Section', () => wrap('\\section{', '}')], ['H2', 'Subsection', () => wrap('\\subsection{', '}')], ['H3', 'Subsubsection', () => wrap('\\subsubsection{', '}')], ['|'],
  ['• List', 'Bulleted list', () => insertText('\\begin{itemize}\n\t\\item $0\n\\end{itemize}')],
  ['1. List', 'Numbered list', () => insertText('\\begin{enumerate}\n\t\\item $0\n\\end{enumerate}')], ['|'],
  ['$x$', 'Inline math', () => wrap('$', '$')], ['Eq', 'Equation', () => insertText('\\begin{equation}\n\t$1\n\t\\label{eq:$2}\n\\end{equation}')],
  ['Align', 'Aligned equations', () => insertText('\\begin{align}\n\t$1 &= $2 \\\\\\\\\n\t$3 &= $4\n\\end{align}')],
  ['a/b', 'Fraction', () => insertText('\\frac{$1}{$2}')], ['|'],
  ['Figure', 'Insert figure', () => insertText('\\begin{figure}[htbp]\n\t\\centering\n\t\\includegraphics[width=0.8\\linewidth]{$1}\n\t\\caption{$2}\n\t\\label{fig:$3}\n\\end{figure}')],
  ['Table', 'Insert table', () => tableWizard()],
  ['Cite', 'Citation', () => insertText('\\cite{$1}')], ['Ref', 'Cross reference', () => insertText('\\ref{$1}')],
  ['Link', 'Hyperlink', () => insertText('\\href{$1}{$2}')], ['Note', 'Footnote', () => wrap('\\footnote{', '}')], ['|'],
  ['%', 'Comment / uncomment lines (Ctrl+/)', () => editor.trigger('datex', 'editor.action.commentLine')],
  ['Find', 'Find and replace (Ctrl+H)', () => editor.trigger('datex', 'editor.action.startFindReplaceAction')]
];
function buildFmtBar() {
  const bar = document.createElement('div'); bar.className = 'fmtbar';
  // Code shows the LaTeX source as typed; Visual shows the same text the way it reads.
  const seg = document.createElement('div'); seg.className = 'seg mode'; seg.id = 'modeSeg';
  seg.innerHTML = '<button data-m="code" title="Code editor: the LaTeX source as typed (Ctrl+Shift+V)">Code</button><button data-m="visual" title="Visual editor: headings, bold, lists and citations shown as they read. The line you are on shows its code. (Ctrl+Shift+V)">Visual</button>';
  seg.onclick = e => { if (e.target.dataset.m) setEditorMode(e.target.dataset.m); };
  bar.appendChild(seg);
  for (const [label, title, fn] of FMT) {
    if (label === '|') { const s = document.createElement('span'); s.className = 'sep'; bar.appendChild(s); continue; }
    const b = document.createElement('button'); b.className = 'fmt'; b.textContent = label; b.title = title; b.onclick = fn; bar.appendChild(b);
  }
  $('#tabs').before(bar);
}
async function tableWizard() {
  const c = modal(`<h2>Insert table</h2><div class="row"><label>Rows <input id="tr" type="number" value="3" min="1" max="50"></label><label>Columns <input id="tc" type="number" value="3" min="1" max="20"></label></div>
    <label><input type="checkbox" id="tb" checked> Use booktabs style</label>
    <div class="modal-actions"><button class="btn ghost" id="tn">Cancel</button><button class="btn primary" id="ty">Insert</button></div>`);
  c.querySelector('#tn').onclick = closeModal;
  c.querySelector('#ty').onclick = () => {
    const r = Math.max(1, +c.querySelector('#tr').value), k = Math.max(1, +c.querySelector('#tc').value), bt = c.querySelector('#tb').checked;
    closeModal();
    const row = i => Array.from({ length: k }, (_, j) => i === 0 ? 'Header ' + (j + 1) : 'Cell').join(' & ') + ' \\\\';
    const body = Array.from({ length: r }, (_, i) => '\t\t' + row(i) + (i === 0 ? (bt ? '\n\t\t\\midrule' : ' \\hline') : '')).join('\n');
    const text = `\\begin{table}[htbp]\n\t\\centering\n\t\\caption{Caption}\n\t\\label{tab:label}\n\t\\begin{tabular}{${'l'.repeat(k)}}\n\t\t${bt ? '\\toprule' : '\\hline'}\n${body}\n\t\t${bt ? '\\bottomrule' : '\\hline'}\n\t\\end{tabular}\n\\end{table}\n`;
    editor.executeEdits('datex', [{ range: editor.getSelection(), text }]);
    if (bt && !hasPackage('booktabs')) toast('Tip: add \\usepackage{booktabs} to your preamble');
  };
}
function hasPackage(p) { const f = S.files.get(S.main); return f ? new RegExp('\\\\usepackage(\\[[^\\]]*\\])?\\{[^}]*' + p).test(f.model.getValue()) : true; }

// ---------------- Dashboard ----------------
async function showDashboard() {
  await live.end();
  if (S.root) await leaveProject();
  $('#editorView').classList.add('hidden'); $('#dashboard').classList.remove('hidden');
  document.title = 'Datex';
  renderProjects();
}
async function renderProjects() {
  const list = await api('projects:list');
  const q = $('#projSearch').value.toLowerCase();
  const rows = list.filter(p => p.name.toLowerCase().includes(q));
  $('#projEmpty').classList.toggle('hidden', rows.length > 0);
  $('#projList').innerHTML = rows.map((p, i) => `<tr><td><span class="pname" data-i="${i}">${esc(p.name)}</span></td><td class="ploc">${esc(p.dir)}</td><td>${fmtTime(p.modified)}</td>
    <td style="text-align:right"><button class="btn sm" data-open="${i}">Open</button> <button class="btn sm ghost" data-reveal="${i}">Show in folder</button> <button class="btn sm ghost" data-trash="${i}">Delete</button></td></tr>`).join('');
  $('#projList').onclick = async e => {
    const t = e.target, i = t.dataset.i ?? t.dataset.open;
    if (i !== undefined) return openProject(rows[i].dir);
    if (t.dataset.reveal !== undefined) return api('project:reveal', rows[t.dataset.reveal].dir);
    if (t.dataset.trash !== undefined && await api('project:trash', rows[t.dataset.trash].dir)) renderProjects();
  };
}
async function newProject() {
  const tpls = await api('templates:list');
  let sel = tpls[0]?.id;
  const c = modal(`<h2>New project</h2><label>Project name</label><input id="npName" placeholder="My paper">
    <label>Template</label><div class="tpl-grid">${tpls.map(t => `<div class="tpl${t.id === sel ? ' sel' : ''}" data-id="${t.id}"><b>${esc(t.name)}</b><small>${esc(t.description)}</small></div>`).join('')}</div>
    <div class="modal-actions"><button class="btn ghost" id="npNo">Cancel</button><button class="btn primary" id="npOk">Create</button></div>`, false);
  c.style.width = '760px';
  c.querySelector('.tpl-grid').onclick = e => { const d = e.target.closest('.tpl'); if (!d) return; sel = d.dataset.id; c.querySelectorAll('.tpl').forEach(x => x.classList.toggle('sel', x === d)); };
  c.querySelector('#npNo').onclick = closeModal;
  c.querySelector('#npName').focus();
  const go = async () => {
    try { const dir = await api('project:create', c.querySelector('#npName').value, sel); closeModal(); openProject(dir); }
    catch (e) { toast(e.message, true); }
  };
  c.querySelector('#npOk').onclick = go;
  c.querySelector('#npName').onkeydown = e => { if (e.key === 'Enter') go(); };
}
async function importZip(file) {
  status('Importing ZIP...');
  try { const d = await api('project:importZip', file || null); if (d) { toast('Project imported'); if (S.root) await showDashboard(); openProject(d); } else status('Ready'); }
  catch (e) { status('Ready'); toast(e.message, true); }
}
async function openFolder() { const d = await api('project:pick'); if (d) openProject(d); }

// ---------------- Project ----------------
async function openProject(dir) {
  try {
    const p = await api('project:open', dir);
    Object.assign(S, { root: p.dir, name: p.name, main: p.main, engine: p.engine, files: new Map(), active: null, issues: [], pdf: null, pdfPath: null, pages: [], lastSnap: Date.now() });
    for (const m of monaco.editor.getModels()) m.dispose();
    resetAi();
    $('#dashboard').classList.add('hidden'); $('#editorView').classList.remove('hidden');
    $('#projName').textContent = p.name; document.title = 'Datex  |  ' + p.name;
    $('#engineSel').value = S.engine; $('#autoChk').checked = settings.autoCompile !== false;
    $('#pdfView').innerHTML = '<div class="pdf-empty">Compiling...</div>';
    $('#tabs').innerHTML = ''; setIssues([]);
    await refreshTree();
    await openFile(S.main);
    S.comments = await api('comments:load', S.root);
    await refreshRefs(); scanLabels();
    const pdf = S.root + '\\.datex\\build\\' + S.main.replace(/\.tex$/i, '.pdf');
    try { await loadPdf(pdf); } catch { compile(); }
  } catch (e) { toast(e.message, true); }
}
async function leaveProject() {
  await saveAll();
  await api('history:snapshot', S.root, 'Autosave on close').catch(() => {});
  S.root = null;
}
async function refreshTree() { S.tree = await api('fs:tree', S.root); renderTree(); renderMainSel(); }
function allFiles(nodes = S.tree, out = []) { for (const n of nodes) n.dir ? allFiles(n.children, out) : out.push(n.path); return out; }
function renderMainSel() {
  const texes = allFiles().filter(f => /\.tex$/i.test(f));
  $('#mainSel').innerHTML = texes.map(f => `<option${f === S.main ? ' selected' : ''}>${esc(f)}</option>`).join('');
}
const openDirs = new Set();
function renderTree() {
  const icon = n => n.dir ? (openDirs.has(n.path) ? '&#128194;' : '&#128193;') : /\.tex$/i.test(n.name) ? '&#128221;' : /\.bib$/i.test(n.name) ? '&#128218;' : IMG_EXT.test(n.name) ? '&#128444;' : '&#128196;';
  const html = (nodes, depth) => nodes.map(n => `<div class="node${n.path === S.active ? ' active' : ''}${n.path === S.main ? ' main' : ''}" data-path="${esc(n.path)}" data-dir="${n.dir ? 1 : ''}" style="padding-left:${8 + depth * 14}px">${icon(n)} ${esc(n.name)}</div>` +
    (n.dir && openDirs.has(n.path) ? html(n.children, depth + 1) : '')).join('');
  $('#tree').innerHTML = html(S.tree, 0);
}
function treeEvents() {
  $('#tree').onclick = e => {
    const n = e.target.closest('.node'); if (!n) return;
    if (n.dataset.dir) { openDirs.has(n.dataset.path) ? openDirs.delete(n.dataset.path) : openDirs.add(n.dataset.path); renderTree(); }
    else openFile(n.dataset.path);
  };
  $('#tree').oncontextmenu = e => {
    const n = e.target.closest('.node'); if (!n) return; e.preventDefault();
    const p = n.dataset.path, isDir = !!n.dataset.dir;
    ctxMenu(e.clientX, e.clientY, [
      !isDir && /\.tex$/i.test(p) && ['Set as main document', () => setMain(p)],
      !isDir && /\.docx$/i.test(p) && ['Convert to LaTeX', () => wordToLatex(S.root + '/' + p, S.root)],
      isDir && ['New file here', () => newFile(p)],
      ['Rename', () => renameNode(p)],
      ['Delete (Recycle Bin)', () => deleteNode(p)]
    ].filter(Boolean));
  };
}
function ctxMenu(x, y, items) {
  document.querySelector('.ctx')?.remove();
  const m = document.createElement('div'); m.className = 'ctx'; m.style.left = x + 'px'; m.style.top = y + 'px';
  for (const [label, fn] of items) { const d = document.createElement('div'); d.textContent = label; d.onclick = () => { m.remove(); fn(); }; m.appendChild(d); }
  document.body.appendChild(m);
  setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }), 0);
}
// ---------------- Word to LaTeX ----------------
function wordMenu() {
  const b = $('#wordBtn').getBoundingClientRect();
  ctxMenu(b.left, b.bottom + 4, [
    ['Export this project to Word (.docx)', () => exportWord(false)],
    ['Export to Word as...', () => exportWord(true)],
    ['Convert a Word file to a new LaTeX project...', () => wordToLatex(null, null)],
    ['Add a Word file to this project as LaTeX...', () => wordToLatex(null, S.root)]
  ]);
}
function offerWordFile(rel) {
  const c = modal(`<h2>Word document</h2><p><b>${esc(rel)}</b> is a Word file. Datex can turn it into LaTeX: headings, lists, tables, images, equations, links and footnotes are kept.</p>
    <div class="modal-actions"><button class="btn" id="owNo">Cancel</button><button class="btn" id="owNew">Convert to a new project</button><button class="btn primary" id="owHere">Convert into this project</button></div>`);
  c.querySelector('#owNo').onclick = closeModal;
  c.querySelector('#owNew').onclick = () => { closeModal(); wordToLatex(S.root + '/' + rel, null); };
  c.querySelector('#owHere').onclick = () => { closeModal(); wordToLatex(S.root + '/' + rel, S.root); };
}
async function wordToLatex(docx, into) {
  status('Converting Word to LaTeX...');
  let r;
  try { r = await api('word:toLatex', docx, into); } catch (e) { status('Ready'); return toast(e.message, true); }
  if (!r) return status('Ready');
  const note = r.warnings.length ? ` ${r.warnings.length} image(s) are in a Word-only format and are marked in the text.` : '';
  if (r.newProject) {
    if (S.root) await showDashboard();
    await openProject(r.dir);
    toast('Converted to LaTeX' + (r.images ? `, ${r.images} image(s)` : '') + '.' + note, !!note);
    compile();
  } else {
    await refreshTree(); await openFile(r.tex);
    const c = modal(`<h2>Converted to LaTeX</h2><p>Saved as <b>${esc(r.tex)}</b>${r.images ? ` with ${r.images} image(s)` : ''}. It is a complete document with its own preamble.${esc(note)}</p>
      <div class="modal-actions"><button class="btn" id="wcKeep">Keep current main file</button><button class="btn primary" id="wcMain">Make it the main document and compile</button></div>`);
    c.querySelector('#wcKeep').onclick = closeModal;
    c.querySelector('#wcMain').onclick = () => { closeModal(); setMain(r.tex); };
    status('Ready');
  }
}
async function setMain(p) { S.main = p; await api('project:config', S.root, { main: p }); renderTree(); renderMainSel(); compile(); }
async function newFile(dir = '') {
  const name = await promptModal('New file', 'File name (for example chapter1.tex)', 'chapter.tex'); if (!name) return;
  const rel = (dir ? dir + '/' : '') + name;
  if (allFiles().includes(rel)) return toast('That file already exists', true);
  const init = /\.tex$/i.test(name) ? '% ' + name + '\n\n' : '';
  await api('fs:write', S.root, rel, init);
  live.fileCreated(rel, init);
  if (dir) openDirs.add(dir);
  await refreshTree(); openFile(rel);
}
async function newFolder() { const name = await promptModal('New folder', 'Folder name', 'figures'); if (name) { await api('fs:mkdir', S.root, name); refreshTree(); } }
async function renameNode(p) {
  const name = await promptModal('Rename', 'New name', p.split('/').pop()); if (!name) return;
  const np = p.split('/').slice(0, -1).concat(name).join('/');
  await saveAll(); await api('fs:rename', S.root, p, np);
  if (live.isActive() && TEXT_EXT.test(np)) live.fileRenamed(p, np, await api('fs:read', S.root, np));
  const f = S.files.get(p); if (f) { f.model.dispose(); S.files.delete(p); }
  if (S.main === p) await setMain(np);
  await refreshTree(); if (S.active === p) openFile(np);
}
async function deleteNode(p) {
  if (!await confirmModal('Delete', `Move "${p}" to the Recycle Bin?`, 'Delete', true)) return;
  await api('fs:trash', S.root, p);
  live.fileDeleted(p);
  closeTab(p, true); refreshTree();
}
async function upload() { const r = await api('fs:upload', S.root, ''); if (r.length) { toast('Uploaded ' + r.length + ' file(s)'); await refreshTree(); live.uploaded(r); } }

// ---------------- Files & tabs ----------------
async function openFile(rel, line) {
  if (!rel) return;
  if (IMG_EXT.test(rel)) return showImage(rel);
  if (/\.pdf$/i.test(rel)) return toast('PDF files are shown when you include them in your document');
  if (/\.docx$/i.test(rel)) return offerWordFile(rel);
  if (/\.(zip|doc|xlsx?|pptx?|exe|gz|eps|ttf|otf|woff2?)$/i.test(rel)) return toast('This file type cannot be edited in Datex');
  $('#imageView').classList.add('hidden'); $('#editor').classList.remove('hidden');
  let f = S.files.get(rel);
  if (!f) {
    let text = '';
    try { text = await api('fs:read', S.root, rel); } catch (e) { return toast('Cannot open ' + rel + ': ' + e.message, true); }
    const lang = /\.(tex|sty|cls|ltx)$/i.test(rel) ? 'latex' : /\.bib$/i.test(rel) ? 'bibtex' : /\.md$/i.test(rel) ? 'markdown' : /\.py$/i.test(rel) ? 'python' : 'plaintext';
    const model = monaco.editor.createModel(text, lang, monaco.Uri.file('/' + rel));
    f = { model, dirty: false, open: true, view: null }; S.files.set(rel, f);
    live.bindModel(rel, f);
  }
  f.open = true;
  if (S.active && S.files.get(S.active)) S.files.get(S.active).view = editor.saveViewState();
  S.active = rel; editor.setModel(f.model);
  if (f.view) editor.restoreViewState(f.view);
  if (line) { editor.revealLineInCenter(line); editor.setPosition({ lineNumber: line, column: 1 }); }
  editor.focus();
  renderTabs(); renderTree(); renderOutline(); applyIssueMarkers(); applyCommentDecorations(); liveStats(); spellCheck(); live.rebindActive();
}
async function showImage(rel) {
  const bytes = await api('fs:readBinary', S.root + '\\' + rel.replace(/\//g, '\\'));
  const url = URL.createObjectURL(new Blob([bytes], { type: rel.endsWith('.svg') ? 'image/svg+xml' : 'image/' + rel.split('.').pop() }));
  $('#editor').classList.add('hidden'); const v = $('#imageView'); v.classList.remove('hidden'); v.innerHTML = `<img src="${url}">`;
}
function renderTabs() {
  const open = [...S.files.entries()].filter(([, f]) => f.open);
  $('#tabs').innerHTML = open.map(([p, f]) => `<div class="tab${p === S.active ? ' active' : ''}${f.dirty ? ' dirty' : ''}" data-p="${esc(p)}"><span class="name">${esc(p.split('/').pop())}</span><span class="x" data-x="${esc(p)}">&times;</span></div>`).join('');
}
function closeTab(p, force) {
  const f = S.files.get(p); if (!f) return;
  if (f.dirty && !force) saveFile(p);
  f.open = false;
  if (force) { f.model.dispose(); S.files.delete(p); }
  if (S.active === p) { const next = [...S.files.entries()].find(([, x]) => x.open); next ? openFile(next[0]) : (S.active = null, editor.setModel(null)); }
  renderTabs();
}
async function saveFile(p) {
  const f = S.files.get(p); if (!f || !f.dirty) return;
  f.dirty = false;
  try { await api('fs:write', S.root, p, f.model.getValue()); } catch (e) { f.dirty = true; toast('Save failed: ' + e.message, true); }
  renderTabs();
}
async function saveAll() { for (const p of S.files.keys()) await saveFile(p); }
const autosave = debounce(async () => { await saveAll(); status('All changes saved'); scanLabels(); renderOutline(); spellCheck(); if (S.active?.endsWith('.bib')) refreshRefs(); }, 900);
const autoCompile = debounce(() => compile(), 2500);

// ---------------- Outline, labels, word count ----------------
function renderOutline() {
  const f = S.files.get(S.active);
  if (!f || f.model.getLanguageId() !== 'latex') { $('#outline').innerHTML = ''; return; }
  const lvl = { part: 0, chapter: 0, section: 1, subsection: 2, subsubsection: 3, paragraph: 4 };
  const items = [];
  f.model.getLinesContent().forEach((l, i) => {
    const m = l.match(/^\s*\\(part|chapter|section|subsection|subsubsection|paragraph)\*?(?:\[[^\]]*\])?\{/);
    if (!m) return;
    // Title is the balanced {...} group, so a \label after it on the same line is not shown.
    let d = 1, j = m[0].length;
    for (; j < l.length && d; j++) { if (l[j] === '\\') { j++; continue; } if (l[j] === '{') d++; else if (l[j] === '}') d--; }
    items.push({ d: lvl[m[1]], t: l.slice(m[0].length, d ? l.length : j - 1), line: i + 1 });
  });
  $('#outline').innerHTML = items.map(x => `<div class="node" data-line="${x.line}" style="padding-left:${8 + x.d * 12}px">${esc(x.t)}</div>`).join('') || '<div class="node muted">No sections</div>';
  $('#outline').onclick = e => { const n = e.target.closest('[data-line]'); if (n) { editor.revealLineInCenter(+n.dataset.line); editor.setPosition({ lineNumber: +n.dataset.line, column: 1 }); editor.focus(); } };
}
async function scanLabels() {
  const labels = [];
  for (const p of allFiles().filter(f => /\.tex$/i.test(f))) {
    const f = S.files.get(p);
    let text = f ? f.model.getValue() : null;
    if (text === null) { try { text = await api('fs:read', S.root, p); } catch { continue; } }
    text.split('\n').forEach((l, i) => { for (const m of l.matchAll(/\\label\{([^}]+)\}/g)) labels.push({ label: m[1], file: p, line: i + 1 }); });
  }
  S.labels = labels;
}
function countWords(text) {
  let t = text.replace(/(^|[^\\])%.*$/gm, '$1');
  const b = t.indexOf('\\begin{document}'); if (b >= 0) t = t.slice(b + 16);
  t = t.replace(/\\end\{document\}[\s\S]*/, '')
    .replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$|\\\[[\s\S]*?\\\]/g, ' ')
    .replace(/\\begin\{(equation|align|gather|multline|figure|table|tikzpicture)\*?\}[\s\S]*?\\end\{\1\*?\}/g, ' ')
    .replace(/\\(cite\w*|ref|eqref|label|includegraphics|usepackage|input|include|bibliography\w*|url|href)\*?(\[[^\]]*\])*\{[^}]*\}/g, ' ')
    .replace(/\\[a-zA-Z@]+\*?/g, ' ').replace(/[{}\[\]&~\\]/g, ' ');
  return (t.match(/[A-Za-z\u00C0-\uFFFF0-9][\w'\u00C0-\uFFFF-]*/g) || []).length;
}
const liveStats = debounce(() => { const f = S.files.get(S.active); $('#wordCount').textContent = f && f.model.getLanguageId() === 'latex' ? countWords(f.model.getValue()) + ' words' : ''; }, 400);
async function wordCountDialog() {
  await saveAll();
  const rows = [];
  for (const p of allFiles().filter(f => /\.tex$/i.test(f))) rows.push([p, countWords(await api('fs:read', S.root, p))]);
  const total = rows.reduce((a, r) => a + r[1], 0);
  const c = modal(`<h2>Word count</h2><table class="proj-table">${rows.map(r => `<tr><td>${esc(r[0])}</td><td style="text-align:right">${r[1]}</td></tr>`).join('')}<tr><td><b>Total</b></td><td style="text-align:right"><b>${total}</b></td></tr></table>
    <p class="muted small">Counts text in the document body. Math, figures, tables and commands are left out.</p><div class="modal-actions"><button class="btn primary" id="wcOk">Close</button></div>`);
  c.querySelector('#wcOk').onclick = closeModal;
}

// ---------------- Spell check ----------------
let spellBad = {};
const spellCheck = debounce(async () => {
  const f = S.files.get(S.active);
  if (!f || f.model.getLanguageId() !== 'latex' || settings.spellcheck === false) { if (f) monaco.editor.setModelMarkers(f.model, 'spell', []); return; }
  const lines = f.model.getLinesContent(); const found = []; const words = new Set();
  let inBody = !lines.some(l => l.includes('\\begin{document}')); let math = false;
  lines.forEach((l, i) => {
    if (l.includes('\\begin{document}')) { inBody = true; return; }
    if (!inBody) return;
    let s = l.replace(/(^|[^\\])%.*$/, '$1');
    // Blank out things that are not prose, keeping column positions.
    s = s.replace(/\\begin\{[^}]*\}(\[[^\]]*\])?(\{[^}]*\})?/g, m => ' '.repeat(m.length)).replace(/\[[^\]]*\]/g, m => ' '.repeat(m.length));
    s = s.replace(/\\(cite\w*|ref|eqref|label|includegraphics|usepackage|input|include|url|href|begin|end|documentclass|bibliography\w*|cref|autoref)\*?(\[[^\]]*\])*\{[^}]*\}/g, m => ' '.repeat(m.length))
      .replace(/\\[a-zA-Z@]+\*?/g, m => ' '.repeat(m.length))
      .replace(/\$[^$]*\$/g, m => ' '.repeat(m.length));
    if (/\\begin\{(equation|align|gather|multline|tikzpicture|verbatim|lstlisting|minted)/.test(l)) math = true;
    if (math) { if (/\\end\{(equation|align|gather|multline|tikzpicture|verbatim|lstlisting|minted)/.test(l)) math = false; return; }
    for (const m of s.matchAll(/[A-Za-z][A-Za-z']*[A-Za-z]/g)) {
      if (m[0].length < 3 || /[A-Z].*[A-Z]/.test(m[0])) continue;
      found.push({ w: m[0], line: i + 1, col: m.index + 1 }); words.add(m[0]);
    }
  });
  try { spellBad = { ...spellBad, ...(await api('spell:check', [...words])) }; } catch { return; }
  const markers = found.filter(x => spellBad[x.w]).slice(0, 1000).map(x => ({
    startLineNumber: x.line, endLineNumber: x.line, startColumn: x.col, endColumn: x.col + x.w.length,
    message: 'Possible spelling mistake' + (spellBad[x.w].length ? '. Suggestions: ' + spellBad[x.w].join(', ') : ''), severity: monaco.MarkerSeverity.Info, source: 'spell'
  }));
  monaco.editor.setModelMarkers(f.model, 'spell', markers);
}, 700);

// ---------------- Compile ----------------
async function compile() {
  if (!S.root || S.compiling) { if (S.compiling) compile.again = true; return; }
  S.compiling = true; compile.again = false;
  $('#compileBtn').innerHTML = '&#9203; Compiling...'; status('Compiling ' + S.main + '...');
  await saveAll();
  if (Date.now() - S.lastSnap > 10 * 60 * 1000) { S.lastSnap = Date.now(); api('history:snapshot', S.root, 'Autosave ' + new Date().toLocaleTimeString()).catch(() => {}); }
  let r;
  const only = $('#draftChk').checked && S.active && S.active !== S.main && /\.tex$/i.test(S.active) ? S.active : null;
  try { r = await api('compile:run', S.root, S.main, $('#engineSel').value, only); }
  catch (e) { r = { ok: false, issues: [{ level: 'error', message: e.message, file: S.main }], log: '', output: e.message }; }
  S.compiling = false; $('#compileBtn').innerHTML = '&#9654; Recompile';
  $('#rawLog').textContent = (r.log || '') + '\n\n---- Output ----\n' + (r.output || '');
  setIssues(r.issues || []);
  S.pdfMain = r.draft ? '_datex_draft.tex' : S.main;
  const errs = S.issues.filter(i => i.level === 'error').length;
  status((errs ? `Compiled with ${errs} error(s)` : 'Compiled') + (r.ms ? ` in ${(r.ms / 1000).toFixed(1)} s` : '') + (r.engine ? ` (${r.engine === 'builtin' ? 'Datex TeX' : r.engine})` : '') + (r.draft ? ` · draft: ${r.draft} only` : only ? ' · this file is not part of the main document, so the whole document was built' : ''));
  if (r.pdf && r.fresh !== false) { try { await loadPdf(r.pdf); } catch (e) { toast('Could not show PDF: ' + e.message, true); } }
  else if (!r.pdf) { $('#pdfView').innerHTML = '<div class="pdf-empty">No PDF was produced. Open Logs to see what went wrong.</div>'; $('#logs').classList.remove('hidden'); }
  if (r.ok && r.pdf && !r.draft) api('project:config', S.root, {}).then(c => { if (c.wordAuto) exportWord(false, true); }).catch(() => {});
  if (!r.ok) offerMissingPackages((r.log || '') + '\n' + (r.output || '') + '\n' + (r.issues || []).map(i => i.message).join('\n'), r.engine);
  if (compile.again) compile();
}
// When a compile stops because a package is missing, offer to install every package the
// project uses in one click, then compile again with Datex TeX (which can fetch packages itself).
async function offerMissingPackages(text, engine) {
  const missing = [...new Set([...text.matchAll(/(?:File `|unable to locate file "|file ')([A-Za-z0-9-]+)\.sty/g)].map(m => m[1]))];
  if (!missing.length || S.pkgOffered === missing.join()) return;
  S.pkgOffered = missing.join();
  const used = await api('tex:scan', S.root).catch(() => []);
  const names = [...new Set([...missing, ...used])];
  const system = engine && engine !== 'builtin';
  const c = modal(`<h2>Packages needed</h2>
    <p>This document needs <b>${missing.map(esc).join(', ')}</b>, which ${missing.length > 1 ? 'are' : 'is'} not on this PC yet.</p>
    <p class="muted small">One click installs all ${names.length} packages this project uses (internet needed this once), then compiles again.${system ? ' The project will switch to the Auto engine (Datex TeX), which installs packages by itself from now on.' : ''}</p>
    <pre id="mpOut" class="mono small hidden" style="max-height:160px;overflow:auto;white-space:pre-wrap;background:var(--bg3);padding:8px;border-radius:6px"></pre>
    <div class="modal-actions"><button class="btn" id="mpNo">Not now</button><button class="btn primary" id="mpGo">Install all and compile</button></div>`);
  const o = c.querySelector('#mpOut');
  closeModal.onClose = window.datex.onTexProgress(tx => { o.textContent += tx; o.scrollTop = o.scrollHeight; });
  c.querySelector('#mpNo').onclick = closeModal;
  c.querySelector('#mpGo').onclick = async () => {
    const b = c.querySelector('#mpGo'); b.disabled = true; b.textContent = 'Installing...'; o.classList.remove('hidden');
    try {
      const r = await api('tex:install', names);
      if (system) { S.engine = 'auto'; $('#engineSel').value = 'auto'; await api('project:config', S.root, { engine: 'auto' }); }
      closeModal(); S.pkgOffered = '';
      toast(`Installed ${r.installed.length} package(s)` + (r.failed.length ? `. Not found: ${r.failed.join(', ')}` : ''), !!r.failed.length);
      compile();
    } catch (e) { o.textContent += '\n' + e.message; b.disabled = false; b.textContent = 'Try again'; }
  };
}
function setIssues(list) {
  S.issues = list;
  const e = list.filter(i => i.level === 'error').length, w = list.filter(i => i.level === 'warning').length;
  const b = $('#issueCount'); b.textContent = e || w || ''; b.className = e ? 'err' : w ? 'warn' : '';
  $('#issues').innerHTML = list.length ? list.slice(0, 300).map((i, k) => `<div class="issue ${i.level}" data-k="${k}"><b>${i.level === 'typesetting' ? 'Layout' : i.level[0].toUpperCase() + i.level.slice(1)}</b> ${i.file ? esc(i.file) : ''}${i.line ? ':' + i.line : ''}<br>${esc(i.message)}${i.detail ? `<small>${esc(i.detail)}</small>` : ''}</div>`).join('') : '<div class="issue" style="border-color:var(--accent2)">No errors or warnings.</div>';
  applyIssueMarkers();
}
function applyIssueMarkers() {
  for (const [p, f] of S.files) {
    const ms = S.issues.filter(i => i.line && (i.file === p || i.file === './' + p)).map(i => ({
      startLineNumber: i.line, endLineNumber: i.line, startColumn: 1, endColumn: f.model.getLineMaxColumn(Math.min(i.line, f.model.getLineCount())),
      message: i.message, severity: i.level === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning
    })).filter(m => m.startLineNumber <= f.model.getLineCount());
    monaco.editor.setModelMarkers(f.model, 'latex', ms);
  }
}

// ---------------- PDF viewer ----------------
let renderToken = 0;
async function loadPdf(file) {
  const bytes = await api('fs:readBinary', file);
  const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
  if (S.pdf) S.pdf.destroy();
  S.pdf = doc; S.pdfPath = file;
  api('pdf:windowRefresh', file).catch(() => {}); // the separate PDF window, when it is open
  await renderPdf();
}
async function renderPdf() {
  const view = $('#pdfView'); if (!S.pdf) return;
  const token = ++renderToken;
  const ratio = view.scrollHeight > view.clientHeight ? view.scrollTop / (view.scrollHeight - view.clientHeight) : 0;
  const frag = document.createElement('div'); const pages = [];
  const dpr = window.devicePixelRatio || 1;
  for (let n = 1; n <= S.pdf.numPages; n++) {
    const page = await S.pdf.getPage(n); if (token !== renderToken) return;
    const base = page.getViewport({ scale: 1 });
    const scale = S.zoom === 'fit' ? (view.clientWidth - 34) / base.width : +S.zoom * 1.333;
    const vp = page.getViewport({ scale });
    const div = document.createElement('div'); div.className = 'pdf-page'; div.style.width = vp.width + 'px'; div.style.height = vp.height + 'px'; div.dataset.page = n;
    const cv = document.createElement('canvas'); cv.width = Math.floor(vp.width * dpr); cv.height = Math.floor(vp.height * dpr); cv.style.width = vp.width + 'px'; cv.style.height = vp.height + 'px';
    div.appendChild(cv); frag.appendChild(div);
    pages.push({ div, scale, page, cv, vp, done: false });
  }
  view.innerHTML = ''; view.appendChild(frag); S.pages = pages;
  view.scrollTop = ratio * (view.scrollHeight - view.clientHeight);
  // Render visible pages first, then the rest.
  const order = [...pages].sort((a, b) => Math.abs(a.div.offsetTop - view.scrollTop) - Math.abs(b.div.offsetTop - view.scrollTop));
  for (const p of order) {
    if (token !== renderToken) return;
    try { await p.page.render({ canvasContext: p.cv.getContext('2d'), viewport: p.vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise; }
    catch (e) { if (token !== renderToken || /cancel|destroy/i.test(e?.name + e?.message)) return; throw e; }
  }
  updatePageInfo();
}
function updatePageInfo() {
  const v = $('#pdfView'); let cur = 1;
  for (const p of S.pages) if (p.div.offsetTop - 60 <= v.scrollTop) cur = +p.div.dataset.page;
  $('#pageInfo').style.visibility = S.pages.length ? '' : 'hidden';
  if (document.activeElement !== $('#pageNum')) $('#pageNum').value = S.pages.length ? cur : '';
  $('#pageTotal').textContent = S.pages.length ? ` / ${S.pages.length}` : '';
}
// Type a page number in the counter and press Enter to jump to that page.
function goToPage(n) {
  const p = S.pages[Math.min(Math.max(1, n | 0), S.pages.length) - 1]; if (!p) return;
  $('#pdfView').scrollTop = p.div.offsetTop - 8;
  updatePageInfo();
}
function setZoom(z) { S.zoom = z; $('#zoomSel').value = z; renderPdf(); }
function zoomStep(d) {
  const steps = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
  const cur = S.zoom === 'fit' ? (S.pages[0]?.scale || 1.333) / 1.333 : +S.zoom;
  let i = steps.findIndex(s => s >= cur - 0.01); if (i < 0) i = steps.length - 1;
  setZoom(String(steps[Math.max(0, Math.min(steps.length - 1, i + d))]));
}
async function syncForward() {
  if (!S.active || !/\.tex$/i.test(S.active)) return;
  const pos = editor.getPosition();
  const r = await api('synctex:forward', S.root, S.pdfMain || S.main, S.active, pos.lineNumber, pos.column).catch(() => null);
  if (!r) return toast('Compile first, then try again');
  const p = S.pages[r.page - 1]; if (!p) return;
  const y = r.y * p.scale;
  $('#pdfView').scrollTop = p.div.offsetTop + y - 120;
  const mark = document.createElement('div'); mark.className = 'sync-mark'; mark.style.top = (y - 16) + 'px'; p.div.appendChild(mark);
  setTimeout(() => mark.remove(), 2300);
}
async function syncBackward(e) {
  const div = e.target.closest('.pdf-page'); if (!div) return;
  const p = S.pages[div.dataset.page - 1]; const rect = div.getBoundingClientRect();
  const x = (e.clientX - rect.left) / p.scale, y = (e.clientY - rect.top) / p.scale;
  const r = await api('synctex:backward', S.root, S.pdfMain || S.main, +div.dataset.page, x, y).catch(() => null);
  if (r) { await refreshTree(); openFile(r.file, r.line); editor.setSelection({ startLineNumber: r.line, startColumn: 1, endLineNumber: r.line, endColumn: editor.getModel().getLineMaxColumn(r.line) }); }
}

// ---------------- Drawer panels ----------------
function openPanel(name) {
  if (S.panel === name && !$('#drawer').classList.contains('hidden')) return closePanel();
  S.panel = name;
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.panel === name));
  $('#drawer').classList.remove('hidden');
  const P = { review: ['Track changes', reviewPanel], comments: ['Comments', commentsPanel], history: ['History', historyPanel], refs: ['References', refsPanel],
    git: ['Git, GitHub and Cloud', gitPanel], ai: ['AI assistant', aiPanel], share: ['Share', sharePanel], live: ['Live session (same network)', live.sharePanel], symbols: ['Symbol palette', symbolsPanel], search: ['Search project', searchPanel] }[name];
  $('#drawerTitle').textContent = P[0]; $('#drawerBody').innerHTML = ''; P[1]($('#drawerBody'));
}
function refreshPanel(name) { if (S.panel === name && !$('#drawer').classList.contains('hidden')) { const P = { live: live.sharePanel, comments: commentsPanel }[name]; if (P) { $('#drawerBody').innerHTML = ''; P($('#drawerBody')); } } }
function closePanel() { $('#drawer').classList.add('hidden'); S.panel = null; document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active')); }

// Track changes: compare the working copy with the last saved version (snapshot); accept or reject each change.
async function reviewPanel(el) {
  el.innerHTML = `<p class="muted">See every change made since the last saved version, then accept or reject each one.</p>
    <button class="btn primary" id="rvOpen">Review changes in ${esc(S.active || '')}</button>
    <button class="btn" id="rvAccept">Accept all changes (save version)</button>
    <p class="muted small">Datex saves a version automatically every 10 minutes while you compile, and when you close the project. You can also save one in History.</p>`;
  el.querySelector('#rvOpen').onclick = () => reviewDialog(S.active);
  el.querySelector('#rvAccept').onclick = async () => { await saveAll(); const name = settings.userName || 'Me'; await api('history:snapshot', S.root, 'Changes accepted by ' + name); S.lastSnap = Date.now(); toast('All changes accepted'); };
}
async function reviewDialog(rel, hash = 'HEAD', title) {
  if (!rel) return;
  await saveAll();
  const orig = await api('history:fileAt', S.root, hash, rel);
  let f = S.files.get(rel); if (!f) { await openFile(rel); f = S.files.get(rel); }
  const c = modal(`<div class="row" style="margin-bottom:10px"><h2 style="margin:0;flex:1">${esc(title || 'Track changes: ' + rel)}</h2>
    <span class="muted" id="rvCount"></span><button class="btn" id="rvPrev">&uarr; Prev</button><button class="btn" id="rvNext">&darr; Next</button>
    <button class="btn danger" id="rvReject">Reject this change</button><button class="btn ghost" id="rvRejectAll">Reject all</button><button class="btn primary" id="rvDone">Done</button></div>
    <div class="row muted small" style="margin-bottom:6px"><span style="flex:1">Left: saved version (${esc(hash === 'HEAD' ? 'last snapshot' : hash.slice(0, 7))})</span><span style="flex:1">Right: your current text (editable)</span></div>
    <div class="diff-host" id="diffHost"></div>`, true);
  const om = monaco.editor.createModel(orig, f.model.getLanguageId());
  const de = monaco.editor.createDiffEditor(c.querySelector('#diffHost'), { automaticLayout: true, originalEditable: false, renderSideBySide: true, theme: isDark() ? 'datex-dark' : 'datex-light', fontSize: settings.fontSize || 14, wordWrap: 'on' });
  de.setModel({ original: om, modified: f.model });
  let idx = 0;
  const changes = () => de.getLineChanges() || [];
  const show = () => {
    const ch = changes(); c.querySelector('#rvCount').textContent = ch.length ? `Change ${Math.min(idx + 1, ch.length)} of ${ch.length}` : 'No changes';
    const x = ch[idx]; if (x) de.getModifiedEditor().revealLineInCenter(Math.max(1, x.modifiedStartLineNumber));
  };
  de.onDidUpdateDiff(() => { idx = Math.min(idx, Math.max(0, changes().length - 1)); show(); });
  c.querySelector('#rvNext').onclick = () => { idx = Math.min(idx + 1, changes().length - 1); show(); };
  c.querySelector('#rvPrev').onclick = () => { idx = Math.max(idx - 1, 0); show(); };
  c.querySelector('#rvReject').onclick = () => { const x = changes()[idx]; if (x) rejectChange(f.model, om, x); };
  c.querySelector('#rvRejectAll').onclick = async () => { if (await confirmModalInline('Reject all changes in this file?')) f.model.pushEditOperations([], [{ range: f.model.getFullModelRange(), text: orig }], () => null); };
  c.querySelector('#rvDone').onclick = closeModal;
  closeModal.onClose = () => { de.dispose(); om.dispose(); editor.setModel(S.files.get(S.active)?.model || null); };
}
function confirmModalInline(q) { return Promise.resolve(window.confirm(q)); }
function rejectChange(model, orig, ch) {
  const oS = ch.originalStartLineNumber, oE = ch.originalEndLineNumber, mS = ch.modifiedStartLineNumber, mE = ch.modifiedEndLineNumber;
  const text = oE === 0 ? '' : orig.getLinesContent().slice(oS - 1, oE).join('\n');
  let range, t = text;
  if (mE === 0) { // lines were deleted: put them back after line mS
    if (mS === 0) { range = new monaco.Range(1, 1, 1, 1); t = text + '\n'; }
    else { const c = model.getLineMaxColumn(mS); range = new monaco.Range(mS, c, mS, c); t = '\n' + text; }
  } else if (oE === 0) { // lines were added: remove them
    if (mE < model.getLineCount()) range = new monaco.Range(mS, 1, mE + 1, 1);
    else if (mS > 1) range = new monaco.Range(mS - 1, model.getLineMaxColumn(mS - 1), mE, model.getLineMaxColumn(mE));
    else range = new monaco.Range(mS, 1, mE, model.getLineMaxColumn(mE));
    t = '';
  } else range = new monaco.Range(mS, 1, mE, model.getLineMaxColumn(mE));
  model.pushEditOperations([], [{ range, text: t }], () => null);
}

// Comments anchored to text, with replies and resolve.
function commentsPanel(el) {
  const draw = () => {
    const open = S.comments.filter(c => !c.resolved), done = S.comments.filter(c => c.resolved);
    const card = c => `<div class="card click${c.resolved ? ' resolved' : ''}" data-id="${c.id}"><div class="row"><b>${esc(c.author)}</b><span class="muted small" style="flex:1">${esc(c.file)}:${c.line} · ${fmtTime(c.time)}</span></div>
      ${c.quote ? `<div class="muted small mono">"${esc(c.quote.slice(0, 120))}"</div>` : ''}<div>${esc(c.text)}</div>
      ${(c.replies || []).map(r => `<div class="small" style="margin-top:6px;padding-left:8px;border-left:2px solid var(--line)"><b>${esc(r.author)}</b>: ${esc(r.text)}</div>`).join('')}
      <div class="row" style="margin-top:6px"><button class="btn sm" data-reply="${c.id}">Reply</button><button class="btn sm" data-resolve="${c.id}">${c.resolved ? 'Reopen' : 'Resolve'}</button><button class="btn sm ghost" data-del="${c.id}">Delete</button></div></div>`;
    el.innerHTML = `<button class="btn primary" id="cmAdd">+ Comment on selected text</button>
      <div class="muted small">${open.length} open, ${done.length} resolved</div>${open.map(card).join('')}${done.length ? '<div class="sym-cat">Resolved</div>' + done.map(card).join('') : ''}`;
  };
  draw();
  el.onclick = async e => {
    const t = e.target;
    if (t.id === 'cmAdd') {
      const sel = editor.getSelection(); if (!S.active || !sel || sel.isEmpty()) return toast('Select some text in the editor first');
      const text = await promptModal('Add comment', 'Comment'); if (!text) return;
      S.comments.push({ id: Date.now().toString(36), file: S.active, line: sel.startLineNumber, endLine: sel.endLineNumber, quote: editor.getModel().getValueInRange(sel), text, author: settings.userName || 'Me', time: Date.now(), replies: [], resolved: false });
    } else if (t.dataset.reply) {
      const text = await promptModal('Reply', 'Your reply'); if (!text) return;
      S.comments.find(c => c.id === t.dataset.reply).replies.push({ author: settings.userName || 'Me', text, time: Date.now() });
    } else if (t.dataset.resolve) { const c = S.comments.find(c => c.id === t.dataset.resolve); c.resolved = !c.resolved; }
    else if (t.dataset.del) { S.comments = S.comments.filter(c => c.id !== t.dataset.del); }
    else { const cd = t.closest('.card'); if (cd) { const c = S.comments.find(x => x.id === cd.dataset.id); if (c) openFile(c.file, anchorLine(c)); } return; }
    await api('comments:save', S.root, S.comments); draw(); applyCommentDecorations(); live.commentsChanged();
  };
}
function anchorLine(c) {
  const f = S.files.get(c.file); if (!f || !c.quote) return c.line;
  const m = f.model.findMatches(c.quote.split('\n')[0], false, false, true, null, false);
  if (!m.length) return c.line;
  return m.sort((a, b) => Math.abs(a.range.startLineNumber - c.line) - Math.abs(b.range.startLineNumber - c.line))[0].range.startLineNumber;
}
let commentDeco = null;
function applyCommentDecorations() {
  if (!editor || !S.active) return;
  const list = S.comments.filter(c => c.file === S.active && !c.resolved).map(c => {
    const l = anchorLine(c);
    return { range: new monaco.Range(l, 1, l + Math.max(0, (c.endLine || c.line) - c.line), 1), options: { isWholeLine: true, className: 'comment-range', glyphMarginClassName: 'comment-glyph', glyphMarginHoverMessage: { value: '**' + c.author + '**: ' + c.text } } };
  });
  if (commentDeco) commentDeco.clear();
  commentDeco = editor.createDecorationsCollection(list);
}

// History: snapshots of the whole project (stored with git inside the project).
async function historyPanel(el) {
  el.innerHTML = `<div class="row"><input id="hsMsg" placeholder="Describe this version (optional)"><button class="btn primary" id="hsSave">Save version</button></div><div id="hsList" class="muted">Loading...</div>`;
  const load = async () => {
    const list = await api('history:list', S.root);
    el.querySelector('#hsList').innerHTML = list.map(h => `<div class="card"><div><b>${esc(h.message)}</b></div><div class="muted small">${fmtTime(h.time)} · ${esc(h.author)} · ${h.hash.slice(0, 7)}</div>
      <div class="row" style="margin-top:6px"><button class="btn sm" data-files="${h.hash}">View changes</button><button class="btn sm" data-label="${h.hash}">Label</button><button class="btn sm ghost" data-restore="${h.hash}">Restore</button></div><div data-fl="${h.hash}"></div></div>`).join('') || 'No versions yet.';
  };
  el.querySelector('#hsSave').onclick = async () => { await saveAll(); const r = await api('history:snapshot', S.root, el.querySelector('#hsMsg').value || 'Saved by ' + (settings.userName || 'Me')); S.lastSnap = Date.now(); toast(r.changed ? 'Version saved' : 'No changes since the last version'); el.querySelector('#hsMsg').value = ''; load(); };
  el.onclick = async e => {
    const t = e.target;
    if (t.dataset.files) {
      const box = el.querySelector(`[data-fl="${t.dataset.files}"]`);
      const files = await api('history:files', S.root, t.dataset.files);
      box.innerHTML = files.map(f => `<div class="node" data-cmp="${esc(f.file)}" data-h="${t.dataset.files}">${esc(f.status)} ${esc(f.file)}</div>`).join('') || '<div class="muted small">No file changes</div>';
    } else if (t.dataset.cmp) {
      if (!TEXT_EXT.test(t.dataset.cmp)) return toast('Only text files can be compared');
      reviewDialog(t.dataset.cmp, t.dataset.h, `Compare ${t.dataset.cmp}: version ${t.dataset.h.slice(0, 7)} (left) with now (right)`);
    } else if (t.dataset.label) {
      const name = await promptModal('Label version', 'Label (for example Submitted v1)'); if (name) { await api('history:label', S.root, t.dataset.label, name); toast('Label added'); }
    } else if (t.dataset.restore) {
      if (!await confirmModal('Restore version', 'Restore the whole project to this version? Your current state is saved first, so you can come back to it.', 'Restore')) return;
      await saveAll(); await api('history:restore', S.root, t.dataset.restore);
      for (const [, f] of S.files) f.model.dispose(); S.files.clear(); S.active = null;
      await refreshTree(); await openFile(S.main); compile(); load(); toast('Version restored');
    }
  };
  load();
}

// References: project .bib files, DOI lookup, Zotero import, advanced search.
async function refreshRefs() { try { S.bib = await api('refs:project', S.root); } catch { S.bib = []; } }
function refsPanel(el) {
  el.innerHTML = `<div class="row"><input id="rfQ" placeholder="Search by author, title, year, keyword..."></div>
    <div class="row"><input id="rfDoi" placeholder="Add by DOI, for example 10.1038/nature14539"><button class="btn primary" id="rfAdd">Add</button></div>
    <div class="row"><input id="rfAx" placeholder="Find papers on arXiv, for example: solar water pumping"><button class="btn" id="rfAxGo">Search</button></div>
    <div class="row"><button class="btn" id="rfZot">Import from Zotero</button><button class="btn ghost" id="rfNew">New .bib file</button></div>
    <div id="rfList"></div>`;
  let source = 'project', zot = [];
  const list = () => {
    const q = el.querySelector('#rfQ').value.toLowerCase().split(/\s+/).filter(Boolean);
    const all = source === 'project' ? S.bib : zot;
    const ext = source !== 'project';
    const res = all.filter(b => { const h = [b.key, b.fields.title, b.fields.author, b.fields.year, b.fields.journal, b.fields.booktitle, b.fields.keywords].join(' ').toLowerCase(); return q.every(w => h.includes(w)); }).slice(0, 200);
    el.querySelector('#rfList').innerHTML = `<div class="muted small">${source === 'zotero' ? 'Zotero library' : source === 'arxiv' ? 'arXiv results' : 'This project'}: ${res.length} of ${all.length}${ext ? ' · <a href="#" id="rfBack">back to project</a>' : ''}</div>` +
      res.map((b, i) => `<div class="card"><div class="mono">${esc(b.key)}</div><div>${esc(b.fields.title || '(no title)')}</div><div class="muted small">${esc((b.fields.author || '').slice(0, 120))} ${b.fields.year ? '· ' + esc(b.fields.year) : ''}</div>${b.summary ? `<div class="muted small" style="margin-top:4px">${esc(b.summary.slice(0, 260))}${b.summary.length > 260 ? '...' : ''}</div>` : ''}
        <div class="row" style="margin-top:6px">${ext ? `<button class="btn sm primary" data-imp="${i}">Add to project</button>${b.url ? `<button class="btn sm ghost" data-link="${esc(b.url)}">Open on arXiv</button>` : ''}` : `<button class="btn sm primary" data-cite="${esc(b.key)}">Insert \\cite</button><button class="btn sm ghost" data-goto="${esc(b.file)}" data-key="${esc(b.key)}">Open</button>`}</div></div>`).join('');
    el.querySelector('#rfList').dataset.res = '';
    list.res = res;
  };
  list();
  el.querySelector('#rfQ').oninput = debounce(list, 150);
  const bibFile = async () => { const b = allFiles().find(f => /\.bib$/i.test(f)); if (b) return b; await api('fs:write', S.root, 'references.bib', ''); await refreshTree(); return 'references.bib'; };
  const appendBib = async (raw) => {
    const file = await bibFile(); await saveFile(file);
    const cur = await api('fs:read', S.root, file);
    const f = S.files.get(file); const text = cur.trimEnd() + (cur.trim() ? '\n\n' : '') + raw.trim() + '\n';
    if (f) f.model.setValue(text); else await api('fs:write', S.root, file, text);
    await saveAll(); await refreshRefs();
  };
  el.querySelector('#rfAdd').onclick = async () => {
    const doi = el.querySelector('#rfDoi').value; if (!doi) return;
    try { const raw = await api('refs:doi', doi); await appendBib(raw); el.querySelector('#rfDoi').value = ''; toast('Reference added'); source = 'project'; list(); }
    catch (e) { toast(e.message, true); }
  };
  // arXiv search: only the words typed here are sent to arxiv.org.
  const axGo = async () => {
    const q = el.querySelector('#rfAx').value.trim(); if (!q) return;
    const b = el.querySelector('#rfAxGo'); b.disabled = true; b.textContent = 'Searching...';
    try {
      zot = (await api('refs:arxiv', q, S.bib.map(x => x.key))).map(p => ({ key: p.key, raw: p.bibtex, url: p.url, summary: p.summary, fields: { title: p.title, author: p.authors.join(', '), year: p.year } }));
      source = 'arxiv'; el.querySelector('#rfQ').value = ''; list();
    } catch (e) { toast(e.message, true); }
    b.disabled = false; b.textContent = 'Search';
  };
  el.querySelector('#rfAxGo').onclick = axGo;
  el.querySelector('#rfAx').onkeydown = e => { if (e.key === 'Enter') axGo(); };
  el.querySelector('#rfZot').onclick = async () => { try { zot = await api('refs:zotero'); source = 'zotero'; list(); } catch (e) { toast(e.message, true); } };
  el.querySelector('#rfNew').onclick = async () => { const n = await promptModal('New bibliography', 'File name', 'references.bib'); if (n) { await api('fs:write', S.root, n.endsWith('.bib') ? n : n + '.bib', ''); refreshTree(); } };
  el.querySelector('#rfList').onclick = async e => {
    const t = e.target;
    if (t.id === 'rfBack') { e.preventDefault(); source = 'project'; return list(); }
    if (t.dataset.cite) {
      const pos = editor.getPosition(); const line = editor.getModel()?.getLineContent(pos.lineNumber) || '';
      const before = line.slice(0, pos.column - 1);
      insertText(/\\cite\w*\{[^}]*$/.test(before) ? (before.endsWith('{') ? '' : ',') + t.dataset.cite : '\\cite{' + t.dataset.cite + '}');
    }
    if (t.dataset.goto) { await openFile(t.dataset.goto); const m = editor.getModel().findMatches('{' + t.dataset.key + ',', false, false, true, null, false)[0]; if (m) editor.revealLineInCenter(m.range.startLineNumber); }
    if (t.dataset.imp) { const b = list.res[+t.dataset.imp]; if (S.bib.some(x => x.key === b.key)) return toast('Already in the project'); await appendBib(b.raw); toast('Added ' + b.key); }
  };
}

// AI assistant using local models through Ollama.
// Two modes. Build: the AI reads the whole project and changes the files itself (you can review
// or undo every change). Ask: a plain chat that only answers; you insert what you want.
const SYS = 'You are Datex AI, a LaTeX expert built into the Datex editor by Datix AI and XactGen AI. Be concise and accurate. When you give LaTeX, put it in one ```latex code block. Never invent citations or references.';
let aiHistory = [], buildHistory = [], aiBusy = false;
// The conversation stays when the panel is closed or another panel is opened.
const aiLogEl = document.createElement('div'); aiLogEl.id = 'aiLog'; aiLogEl.className = 'ai-log';
const aiMode = () => settings.aiMode === 'ask' ? 'ask' : 'build';
function resetAi() { aiHistory = []; buildHistory = []; aiImages.length = 0; aiLogEl.innerHTML = ''; }
// Pictures waiting to go with the next message (a photo of a whiteboard, a screenshot of a table).
const aiImages = [];
// Read a picture, shrink it so its long side is at most 1568 px, and keep it as JPEG.
async function readPicture(file) {
  let bmp; try { bmp = await createImageBitmap(file); } catch { throw new Error('Could not read ' + (file.name || 'the picture') + '. Use a PNG or JPEG file.'); }
  const k = Math.min(1, 1568 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(bmp.width * k)); cv.height = Math.max(1, Math.round(bmp.height * k));
  const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(bmp, 0, 0, cv.width, cv.height);
  return { mime: 'image/jpeg', data: cv.toDataURL('image/jpeg', 0.9).split(',')[1], name: file.name || 'picture' };
}
function aiSay(cls, text) { const d = document.createElement('div'); d.className = cls; d.textContent = text; aiLogEl.appendChild(d); d.scrollIntoView({ block: 'end' }); return d; }

async function aiPanel(el) {
  const cloud = isCloud();
  const models = await api('ai:models').catch(() => []);
  const picked = cloud ? settings.cloudModel : settings.aiModel;
  el.innerHTML = `<div class="row"><div class="seg" id="aiModeSeg"><button data-m="build" title="The AI changes your files itself. Every change can be reviewed or undone.">Build</button><button data-m="ask" title="The AI only answers. Nothing is changed unless you insert it.">Ask</button></div>
      <select id="aiProv" title="Where the AI runs"><option value="local">Local (this PC)</option><option value="claude"${cloud ? ' selected' : ''}>Claude (cloud)</option></select></div>
    <div class="row"><select id="aiModel">${models.map(m => `<option${m === picked ? ' selected' : ''}>${esc(m)}</option>`).join('') || `<option value="">${cloud ? 'No API key set' : 'Local AI is not running'}</option>`}</select>${cloud ? '<button class="btn sm ghost" id="aiKey" title="Change or remove the Claude API key">API key</button>' : ''}</div>
    <div class="chips">${AI_ACTIONS.map((a, i) => `<span class="chip" data-a="${i}" title="${esc(a.hint)}">${esc(a.label)}</span>`).join('')}</div>
    <div id="aiLogHost"></div>
    <div id="aiPics" class="ai-pics"></div>
    <textarea id="aiIn" rows="3"></textarea>
    <div class="row"><button class="btn ai" id="aiSend">Send</button><button class="btn ghost" id="aiStop">Stop</button><button class="btn ghost" id="aiPic" title="Attach a photo or screenshot of an equation, table, diagram or notes and the AI turns it into LaTeX. You can also paste a picture into the box.">+ Picture</button><button class="btn ghost" id="aiClear">New chat</button></div>
    <input type="file" id="aiPicFile" accept="image/*" multiple class="hidden">
    <p class="muted small">${cloud ? '<b>Cloud model.</b> Each request sends the text of this project\'s files (.tex, .bib and similar) to Anthropic over the internet, and is charged to your API key. Switch to Local to keep everything on this PC.' : 'Runs on this computer with local models. Your document never leaves your PC.'}</p>`;
  el.querySelector('#aiLogHost').replaceWith(aiLogEl);
  aiLogEl.querySelector('.ai-setup')?.remove();
  if (!models.length) aiLogEl.insertAdjacentHTML('afterbegin', cloud
    ? '<div class="card ai-setup">No Claude API key is set. Click <b>API key</b> above to add one, or switch back to Local.</div>'
    : '<div class="card ai-setup">The AI assistant is optional and is not set up on this PC. Everything else in Datex works without it. To use AI, install <a href="#" data-link="https://ollama.com">Ollama</a>, then pull a model (for example <span class="mono">ollama pull qwen2.5:7b</span>). Or choose Claude (cloud) above.</div>');
  else if (!models.includes(picked)) settings = await api('settings:set', { [cloud ? 'cloudModel' : 'aiModel']: el.querySelector('#aiModel').value });
  const redraw = () => { el.innerHTML = ''; aiPanel(el); };
  el.querySelector('#aiProv').onchange = async e => {
    if (e.target.value === 'claude' && !(await api('ai:cloudStatus')).ready) { if (!await cloudKeyDialog()) { e.target.value = 'local'; return; } }
    else if (e.target.value === 'claude' && !settings.cloudOk && !await confirmModal('Use a cloud model?', 'With Claude (cloud), each AI request sends the text of this project\'s files to Anthropic over the internet and is charged to your API key. Nothing is sent while Local is selected.', 'Use Claude')) { e.target.value = 'local'; return; }
    settings = await api('settings:set', { aiProvider: e.target.value, ...(e.target.value === 'claude' ? { cloudOk: true } : {}) });
    redraw();
  };
  if (cloud) el.querySelector('#aiKey').onclick = async () => { await cloudKeyDialog(); if (!(await api('ai:cloudStatus')).ready) settings = await api('settings:set', { aiProvider: 'local' }); redraw(); };
  const showMode = () => {
    el.querySelectorAll('#aiModeSeg button').forEach(b => b.classList.toggle('on', b.dataset.m === aiMode()));
    el.querySelector('#aiIn').placeholder = aiMode() === 'build'
      ? 'Describe what to build or change, for example: "Add a methods section with a table of the three experiments". Ctrl+Enter to send.'
      : 'Ask anything about LaTeX or your document. Ctrl+Enter to send.';
  };
  showMode();
  el.querySelector('#aiModeSeg').onclick = async e => { const m = e.target.dataset.m; if (!m) return; settings = await api('settings:set', { aiMode: m }); showMode(); };
  el.querySelector('#aiModel').onchange = e => api('settings:set', { [cloud ? 'cloudModel' : 'aiModel']: e.target.value }).then(s => settings = s);
  el.querySelector('.chips').onclick = e => { const i = e.target.dataset.a; if (i !== undefined) runAction(AI_ACTIONS[i], el); };
  const drawPics = () => {
    el.querySelector('#aiPics').innerHTML = aiImages.map((p, i) => `<span class="ai-pic"><img src="data:${p.mime};base64,${p.data}" alt=""><b data-rm="${i}" title="Remove">&times;</b></span>`).join('');
  };
  drawPics();
  const addPics = async files => { for (const f of files) { if (aiImages.length >= 4) { toast('Four pictures at most'); break; } try { aiImages.push(await readPicture(f)); } catch (e) { toast(e.message, true); } } drawPics(); };
  el.querySelector('#aiPics').onclick = e => { if (e.target.dataset.rm !== undefined) { aiImages.splice(+e.target.dataset.rm, 1); drawPics(); } };
  el.querySelector('#aiPic').onclick = () => el.querySelector('#aiPicFile').click();
  el.querySelector('#aiPicFile').onchange = async e => { await addPics([...e.target.files]); e.target.value = ''; };
  el.querySelector('#aiIn').onpaste = e => { const pics = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/')); if (pics.length) { e.preventDefault(); addPics(pics); } };
  el.querySelector('#aiSend').onclick = async () => {
    let v = el.querySelector('#aiIn').value.trim(); if (!v && !aiImages.length) return;
    if (aiBusy) return toast('The AI is still working on the last request');
    if (aiImages.length && !await api('ai:vision', el.querySelector('#aiModel').value).catch(() => false))
      return toast('This local model cannot read pictures. Choose a vision model in the list, or Claude (cloud).', true);
    const pics = aiImages.splice(0); drawPics();
    if (!v) v = aiMode() === 'build' ? 'Turn what the attached picture shows into LaTeX and add it at the cursor.' : 'Write what the attached picture shows as LaTeX.';
    el.querySelector('#aiIn').value = '';
    aiMode() === 'build' ? buildAsk(v, null, 0, pics) : aiAsk(el, v, v, null, pics);
  };
  el.querySelector('#aiIn').onkeydown = e => { if (e.key === 'Enter' && e.ctrlKey) el.querySelector('#aiSend').click(); };
  el.querySelector('#aiStop').onclick = () => aiAsk.id && api('ai:stop', aiAsk.id);
  el.querySelector('#aiClear').onclick = () => resetAi();
}
const isCloud = () => settings.aiProvider === 'claude';
// Ask for the Claude API key. It goes straight to the main process, which stores it encrypted;
// the window never reads it back. Resolves true when a key was saved.
function cloudKeyDialog() {
  return new Promise(async res => {
    const st = await api('ai:cloudStatus').catch(() => ({}));
    const c = modal(`<h2>Claude (cloud) API key</h2>
      <p>With a cloud model, each AI request sends the text of this project's files (.tex, .bib and similar) to Anthropic over the internet. Requests are charged to your Anthropic account. Nothing is sent while Local is selected.</p>
      <label>Anthropic API key</label><input id="ckKey" type="password" autocomplete="off" placeholder="${st.stored ? 'A key is saved. Paste a new one to replace it.' : 'sk-ant-...'}">
      <p class="muted small">Get a key at <a href="#" data-link="https://console.anthropic.com/settings/keys">console.anthropic.com</a>. It is stored encrypted on this PC with Windows' own protection and is used only to call the Claude API.</p>
      <div class="modal-actions">${st.stored ? '<button class="btn danger" id="ckDel">Remove key</button>' : ''}<button class="btn ghost" id="ckNo">Cancel</button><button class="btn primary" id="ckOk">Save key</button></div>`);
    c.style.width = '560px';
    let done = false; const finish = v => { if (done) return; done = true; closeModal(); res(v); };
    closeModal.onClose = () => { if (!done) { done = true; res(false); } };
    c.querySelector('#ckKey').focus();
    c.querySelector('#ckNo').onclick = () => finish(false);
    if (st.stored) c.querySelector('#ckDel').onclick = async () => { await api('ai:cloudKey', ''); toast('Claude API key removed'); finish(false); };
    c.querySelector('#ckOk').onclick = async () => {
      const k = c.querySelector('#ckKey').value.trim(); if (!k) return toast('Paste the API key first', true);
      try { await api('ai:cloudKey', k); toast('Claude API key saved'); finish(true); } catch (e) { toast(e.message, true); }
    };
  });
}
function selectionText() { const s = editor.getSelection(); return s && !s.isEmpty() && editor.getModel() ? editor.getModel().getValueInRange(s) : ''; }
async function runAction(a, el) {
  const sel = selectionText();
  if (a.needsSel && !sel) return toast('Select some text in the editor first');
  let extra = '';
  if (a.id === 'fix') {
    const errs = S.issues.filter(i => i.level === 'error').slice(0, 5);
    if (!errs.length) return toast('No compile errors to fix');
    // In Build mode the AI corrects the files itself.
    if (aiMode() === 'build') return buildAsk('Fix the compile errors listed above. Change as little as possible.', 'Fix compile errors');
    for (const er of errs) {
      const f = S.files.get(er.file) || S.files.get(S.main);
      const lines = f ? f.model.getLinesContent() : [];
      const ln = er.line || 1;
      extra += `\nError in ${er.file}${er.line ? ' line ' + er.line : ''}: ${er.message} ${er.detail}\nNearby code:\n${lines.slice(Math.max(0, ln - 6), ln + 4).map((l, i) => (Math.max(0, ln - 6) + i + 1) + ': ' + l).join('\n')}\n`;
    }
  }
  let input = '';
  if (a.ask) { input = await promptModal(a.label, a.ask); if (!input) return; }
  const main = S.files.get(S.main)?.model.getValue() || '';
  const prompt = a.prompt.replace('{sel}', sel).replace('{input}', input).replace('{errors}', extra).replace('{doc}', main.slice(0, 12000));
  aiAsk(el, prompt, a.label + (input ? ': ' + input : ''), a.replace && sel ? editor.getSelection() : null);
}
// Buttons under an answer that holds LaTeX: put it in the document or copy it.
function codeButtons(out, text, replaceRange) {
  const code = (text.match(/```(?:latex|tex)?\n([\s\S]*?)```/) || [])[1];
  const bar = document.createElement('div'); bar.className = 'row'; bar.style.marginTop = '6px';
  const btn = (l, fn) => { const b = document.createElement('button'); b.className = 'btn sm'; b.textContent = l; b.onclick = fn; bar.appendChild(b); };
  const payload = (code || text).trim();
  if (replaceRange) btn('Replace selection', () => { editor.executeEdits('datex-ai', [{ range: replaceRange, text: payload }]); toast('Replaced'); });
  btn('Insert at cursor', () => insertPlain(payload));
  btn('Copy', () => navigator.clipboard.writeText(payload).then(() => toast('Copied')));
  out.appendChild(bar);
}
// Send messages to the model and collect the streamed answer. stopped: the user pressed Stop.
function aiStream(messages, onText, opts) {
  return new Promise(resolve => {
    const id = 'ai' + Date.now() + Math.random().toString(36).slice(2, 6); aiAsk.id = id; let text = '';
    const offC = window.datex.onAiChunk(d => { if (d.id === id) { text += d.text; onText(text, d.thinking); } });
    const offD = window.datex.onAiDone(d => { if (d.id !== id) return; offC(); offD(); resolve({ text, error: d.error || null, stopped: d.error === null }); });
    api('ai:chat', id, messages, $('#aiModel')?.value || (isCloud() ? settings.cloudModel : settings.aiModel), opts).catch(e => { offC(); offD(); resolve({ text, error: e.message, stopped: false }); });
  });
}
const picNote = pics => pics && pics.length ? `  [${pics.length} picture${pics.length > 1 ? 's' : ''} attached]` : '';
async function aiAsk(el, prompt, shown, replaceRange, pics) {
  if (aiBusy) return toast('The AI is still working on the last request');
  aiBusy = true;
  aiSay('ai-msg user', shown.slice(0, 400) + picNote(pics));
  const out = aiSay('ai-msg', '...');
  const mine = { role: 'user', content: prompt, ...(pics && pics.length ? { images: pics } : {}) };
  aiHistory.push(mine);
  const r = await aiStream([{ role: 'system', content: SYS }, ...aiHistory.slice(-10)], (t, thinking) => { out.textContent = t || (thinking ? 'Thinking...' : '...'); out.scrollIntoView({ block: 'end' }); });
  aiBusy = false;
  delete mine.images; // Pictures are sent once, not again with every later message.
  if (r.error) { out.textContent = r.error; return; }
  aiHistory.push({ role: 'assistant', content: r.text });
  if (r.text.trim()) codeButtons(out, r.text, replaceRange);
}
function insertPlain(t) { editor.executeEdits('datex-ai', [{ range: editor.getSelection(), text: t, forceMoveMarkers: true }]); editor.focus(); }

// ---------------- AI Build: the prompt chat that writes the document ----------------
// Everything the model needs to see: the project's text files, the open file, the selection
// and the current compile errors.
async function projectContext() {
  const files = [];
  for (const p of allFiles().filter(p => EDITABLE.test(p))) {
    const f = S.files.get(p);
    let text; try { text = f ? f.model.getValue() : await api('fs:read', S.root, p); } catch { continue; }
    if (text.length <= 600000) files.push({ path: p, text });
  }
  return buildContext({ files, main: S.main, active: S.active, selection: selectionText(), cursorLine: S.active && editor.getPosition() ? editor.getPosition().lineNumber : null, issues: S.issues, budget: isCloud() ? 400000 : settings.aiContextChars || 60000 });
}
const posAt = (text, off) => { const before = text.slice(0, off); const l = before.split('\n').length; return { l, c: off - before.lastIndexOf('\n') }; };
let aiMarks = null;
// Put new text into a project file through the editor, so undo (Ctrl+Z), autosave, auto compile
// and live sessions all see it as a normal edit.
async function setFileText(rel, text, created) {
  if (created) {
    await api('fs:write', S.root, rel, text); live.fileCreated(rel, text);
    const d = rel.split('/').slice(0, -1); for (let i = 1; i <= d.length; i++) openDirs.add(d.slice(0, i).join('/'));
    return;
  }
  await openFile(rel);
  const f = S.files.get(rel); if (!f) return;
  const before = f.model.getValue(monaco.editor.EndOfLinePreference.LF);
  const e = minimalEdit(before, text); if (e.start === e.end && !e.text) return;
  const a = posAt(before, e.start), b = posAt(before, e.end);
  f.model.pushStackElement();
  f.model.pushEditOperations([], [{ range: new monaco.Range(a.l, a.c, b.l, b.c), text: e.text }], () => null);
  f.model.pushStackElement();
  // Show where the change is for a few seconds.
  const last = Math.min(f.model.getLineCount(), a.l + e.text.split('\n').length - 1);
  aiMarks?.clear();
  aiMarks = editor.createDecorationsCollection([{ range: new monaco.Range(a.l, 1, last, 1), options: { isWholeLine: true, className: 'ai-changed', linesDecorationsClassName: 'ai-changed-bar' } }]);
  const mine = aiMarks; setTimeout(() => mine.clear(), 8000);
  editor.revealLineInCenterIfOutsideViewport(a.l);
}
// Apply the model's edits. A version is saved first, so History always has the text from before.
async function applyBuild(ops, label) {
  await api('history:snapshot', S.root, 'Before AI: ' + label.slice(0, 60)).catch(() => {}); S.lastSnap = Date.now();
  const base = (await api('history:list', S.root).catch(() => []))[0]?.hash || 'HEAD';
  const existing = new Set(allFiles()), texts = {};
  for (const p of new Set(ops.map(o => o.path))) {
    const f = S.files.get(p);
    texts[p] = f ? f.model.getValue() : existing.has(p) ? await api('fs:read', S.root, p) : null;
  }
  const res = applyOps(texts, ops);
  const was = S.active;
  for (const f of res.files) await setFileText(f.path, f.after, f.created);
  if (res.files.some(f => f.created)) await refreshTree();
  const show = res.files.find(f => f.path === was) || res.files.find(f => !f.created) || res.files[0];
  if (show && S.active !== show.path) await openFile(show.path);
  await saveAll();
  return { ...res, base };
}
async function undoBuild(res) {
  for (const f of res.files) {
    if (f.created) { await api('fs:trash', S.root, f.path).catch(() => {}); live.fileDeleted(f.path); if (S.files.has(f.path)) closeTab(f.path, true); }
    else await setFileText(f.path, f.before, false);
  }
  await refreshTree(); await saveAll(); compile();
}
// The list of changed files under an answer: open, review (accept or reject each change), undo.
function changeCard(res) {
  const d = document.createElement('div'); d.className = 'ai-changes';
  d.innerHTML = res.files.map((f, i) => `<div class="ai-file"><span class="nm" data-open="${i}" title="Open this file">${esc(f.path)}</span>${f.created ? '<span class="tag">new</span>' : ''}<span class="add">+${f.added}</span><span class="del">&minus;${f.removed}</span><button class="btn sm" data-rv="${i}" title="See each change and reject the ones you do not want">Review</button></div>`).join('')
    + (res.failed.length ? `<div class="ai-fail">${res.failed.length} change${res.failed.length > 1 ? 's' : ''} could not be placed (${esc([...new Set(res.failed.map(f => f.path))].join(', '))}): the text to replace was not found. Ask again, or try a larger model.</div>` : '')
    + (res.files.length ? '<div class="row"><button class="btn sm ghost" data-undo="1">Undo all</button><span class="muted small">Applied to your files. A version from before is in History.</span></div>' : '<div class="muted small">Nothing was changed.</div>');
  d.onclick = async e => {
    const t = e.target;
    if (t.dataset.open !== undefined) return openFile(res.files[t.dataset.open].path);
    if (t.dataset.rv !== undefined) { const f = res.files[t.dataset.rv]; return reviewDialog(f.path, res.base, 'AI changes: ' + f.path); }
    if (t.dataset.undo) { t.disabled = true; await undoBuild(res); t.textContent = 'Undone'; toast('AI changes undone'); }
  };
  return d;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function compileAndWait() { while (S.compiling) await sleep(300); await compile(); while (S.compiling) await sleep(300); }

// One turn of the Build chat: send the project and the request, apply the edits that come back,
// compile, and if the new text does not compile let the AI correct it (twice at most).
// Run the arXiv searches the AI asked for and show what was found. Only the search words leave
// the PC, and the user is asked before the first search. Returns the text that goes back to the AI.
async function literatureSearch(queries, out) {
  if (!settings.aiArxiv) {
    const ok = await confirmModal('Search arXiv for papers?', `The AI wants to look for papers on arXiv with these words: ${queries.map(q => '"' + q + '"').join(', ')}. Only the search words are sent to arxiv.org, not your document. Datex will not ask again.`, 'Search arXiv');
    if (!ok) { out.textContent = 'Literature search was not allowed, so no new papers were looked up.'; return { keys: [], text: 'The user did not allow a literature search. Carry out the request without new citations: do not invent any, and say in your first sentence that no papers were looked up.' }; }
    settings = await api('settings:set', { aiArxiv: true });
  }
  const papers = [], taken = S.bib.map(b => b.key), lines = [];
  for (const q of queries) {
    out.textContent = lines.concat('Searching arXiv: ' + q + '...').join('\n');
    try {
      // Six papers in all at most: enough to choose from, small enough for a local model to read.
      const found = (await api('refs:arxiv', q, taken)).filter(p => !papers.some(x => x.id === p.id)).slice(0, Math.max(0, 6 - papers.length));
      for (const p of found) { papers.push(p); taken.push(p.key); }
      lines.push(`Searched arXiv: ${q} (${found.length} paper${found.length === 1 ? '' : 's'})`);
    } catch (e) { lines.push(`Searched arXiv: ${q} (failed: ${e.message})`); }
  }
  out.textContent = lines.join('\n');
  if (papers.length) {
    const list = document.createElement('div'); list.className = 'ai-papers';
    list.innerHTML = papers.map(p => `<a href="#" data-link="${esc(p.url)}" title="Open on arxiv.org">${esc(p.title)}</a><span class="muted small"> ${esc((p.authors[0] || '').split(' ').pop())}${p.authors.length > 1 ? ' et al.' : ''} ${esc(p.year)}</span>`).map(h => `<div>${h}</div>`).join('');
    out.appendChild(list);
  }
  return { keys: papers.map(p => p.key), text: papersMessage(papers, allFiles().find(f => /\.bib$/i.test(f)) || null) };
}
const bibKeysIn = text => [...String(text || '').matchAll(/@(\w+)\s*\{\s*([^,\s]+)\s*,/g)].filter(m => !/^(comment|string|preamble)$/i.test(m[1])).map(m => m[2]);
// References the AI added to .bib files that did not come from a search in this request.
function unverifiedRefs(res, found) {
  const out = [];
  for (const f of res.files) {
    if (!/\.bib$/i.test(f.path)) continue;
    const had = new Set(bibKeysIn(f.before));
    for (const k of bibKeysIn(f.after)) if (!had.has(k) && !found.includes(k) && !out.includes(k)) out.push(k);
  }
  return out;
}
async function buildAsk(prompt, shown, round = 0, pics) {
  if (!S.root) return toast('Open a project first');
  if (aiBusy) return toast('The AI is still working on the last request');
  if (S.panel !== 'ai' || $('#drawer').classList.contains('hidden')) openPanel('ai');
  aiBusy = true;
  let fix = 0;
  aiSay('ai-msg user', (shown || prompt).slice(0, 600) + picNote(pics));
  let out = aiSay('ai-msg', 'Reading the project...');
  try {
    await saveAll();
    const messages = [{ role: 'system', content: BUILD_SYS }, ...buildHistory.slice(-6), { role: 'user', content: (await projectContext()) + '\n\n===== Request =====\n' + prompt, ...(pics && pics.length ? { images: pics } : {}) }];
    let r, searched = false, found = [];
    for (;;) {
      const chars = messages.reduce((n, m) => n + m.content.length, 0);
      const box = out;
      r = await aiStream(messages, (t, thinking) => {
        const p = progress(t);
        // A reply that only asks for a literature search is shown as that, not as raw lines.
        const asking = !p.files.length && !p.writing && parseSearches(t).length;
        box.textContent = asking ? 'Looking for papers...' : (p.prose || (thinking ? 'Thinking...' : '...')) + p.files.map(f => '\n✓ ' + f).join('') + (p.writing ? '\n✎ Writing ' + p.writing + '...' : '');
        box.scrollIntoView({ block: 'end' });
      }, { numCtx: contextTokens(chars), temperature: 0.2 });
      if (r.error || r.stopped || searched) break;
      const queries = parseSearches(r.text);
      if (!queries.length) break;
      // The AI asked for papers: search, hand it the results and let it continue. Edits written
      // in the same reply are dropped, because they were made before it had seen any paper.
      searched = true;
      const results = await literatureSearch(queries, out);
      found = results.keys;
      messages.push({ role: 'assistant', content: queries.map(q => 'ARXIV: ' + q).join('\n') }, { role: 'user', content: results.text });
      out = aiSay('ai-msg', 'Reading the papers...');
    }
    if (r.error) { out.textContent = r.error; return; }
    let p = progress(r.text);
    if (r.stopped) { out.textContent = (p.prose ? p.prose + '\n\n' : '') + 'Stopped. Nothing was changed.'; return; }
    let ops = parseEdits(r.text);
    if (!ops.length) {
      // A model that answered with one complete document instead of edit blocks.
      const doc = wholeDocument(r.text);
      if (doc) { ops = [{ path: S.main, kind: 'write', content: doc }]; p = { ...p, prose: r.text.split('```')[0].trim() }; }
    }
    buildHistory.push({ role: 'user', content: prompt }, { role: 'assistant', content: (p.prose || 'Done.') + (ops.length ? '\n[Files edited: ' + [...new Set(ops.map(o => o.path))].join(', ') + ']' : '') });
    if (!ops.length) {
      // Edit blocks that could not be read: say so plainly instead of showing the raw markers.
      if (/^\s*<{3,}\s*(SEARCH|WRITE)/im.test(r.text)) out.textContent = (p.prose ? p.prose + '\n\n' : '') + 'The model did not give its changes in a form Datex can apply, so nothing was changed. Ask again, or choose a larger model.';
      else { out.textContent = r.text.trim() || 'The model gave no answer. Try again or choose another model.'; if (/```/.test(r.text)) codeButtons(out, r.text); }
      return;
    }
    out.textContent = p.prose || 'Done.';
    const res = await applyBuild(ops, shown || prompt);
    if (res.files.some(f => /\.bib$/i.test(f.path))) await refreshRefs();
    const loose = unverifiedRefs(res, found);
    if (loose.length) aiSay('ai-note warn', `Check ${loose.length === 1 ? 'this reference' : 'these references'}: ${loose.join(', ')}. The AI wrote ${loose.length === 1 ? 'it' : 'them'} from memory, not from a search, so the details may be wrong or the paper may not exist.`);
    out.appendChild(changeCard(res)); out.scrollIntoView({ block: 'end' });
    if (!res.files.length) return;
    await compileAndWait();
    const errs = S.issues.filter(i => i.level === 'error').length;
    if (!errs) aiSay('ai-note', 'Compiled without errors.');
    else if (round < 2 && settings.aiAutoFix !== false && $('#modal').classList.contains('hidden')) fix = errs;
    else aiSay('ai-note', `The document has ${errs} compile error${errs > 1 ? 's' : ''}. Open Logs to see them, or use Undo all above.`);
  } catch (e) { out.textContent = 'Could not finish: ' + e.message; }
  finally { aiBusy = false; }
  if (fix) return buildAsk('The document does not compile after the last change. Fix the compile errors listed above with the smallest possible edits.', `Fixing ${fix} compile error${fix > 1 ? 's' : ''}`, round + 1);
}
// The prompt box under the editor (Ctrl+K): type what you want and the AI builds it.
function sendPromptBar() {
  const inp = $('#promptIn'), v = inp.value.trim(); if (!v) return;
  if (aiBusy) return toast('The AI is still working on the last request');
  inp.value = ''; buildAsk(v);
}
// Dashboard: describe a document and get a new project with a first full draft.
async function aiNewProject() {
  const tpls = await api('templates:list');
  const c = modal(`<h2>Build a document with AI</h2>
    <label>Project name</label><input id="abName" placeholder="My paper">
    <label>What should the document be?</label><textarea id="abWhat" rows="6" placeholder="For example: A 6-page report on solar water pumps for small farms, with an introduction, how the pumps work, a cost comparison table, and a conclusion."></textarea>
    <label>Start from</label><select id="abTpl">${tpls.map(t => `<option value="${esc(t.id)}"${t.id === 'blank' ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
    <p class="muted small">The AI writes a first draft into the project. ${isCloud() ? 'It uses the Claude (cloud) model chosen in the AI panel, so your description and the project text are sent to Anthropic.' : 'It uses the local model chosen in the AI panel, so nothing leaves this PC.'} Check every fact it writes.</p>
    <div class="modal-actions"><button class="btn ghost" id="abNo">Cancel</button><button class="btn primary" id="abOk">Create and build</button></div>`);
  c.style.width = '620px';
  c.querySelector('#abName').focus();
  c.querySelector('#abNo').onclick = closeModal;
  c.querySelector('#abOk').onclick = async () => {
    const what = c.querySelector('#abWhat').value.trim();
    if (!what) return toast('Describe the document first', true);
    if (!(await api('ai:models').catch(() => [])).length) return toast(isCloud() ? 'No Claude API key is set. Open a project and add one in the AI panel.' : 'Local AI is not running. Install Ollama and pull a model first.', true);
    try {
      const dir = await api('project:create', c.querySelector('#abName').value, c.querySelector('#abTpl').value);
      closeModal(); await openProject(dir);
      buildAsk(`Build this document: ${what}\n\nWrite the complete document now: a suitable document class and packages, a title, and every section with real draft text. Replace any template placeholder text. Keep the main file name.`, what);
    } catch (e) { toast(e.message, true); }
  };
}

function symbolsPanel(el) {
  el.innerHTML = `<input id="syQ" placeholder="Search symbols (alpha, arrow, sum...)"><div id="syList"></div>`;
  const draw = () => {
    const q = el.querySelector('#syQ').value.toLowerCase();
    el.querySelector('#syList').innerHTML = Object.entries(SYMBOLS).map(([cat, list]) => {
      const items = list.filter(([g, c]) => !q || c.toLowerCase().includes(q) || cat.toLowerCase().includes(q));
      return items.length ? `<div class="sym-cat">${esc(cat)}</div><div class="sym-grid">${items.map(([g, c]) => `<div class="sym" title="${esc(c)}" data-c="${esc(c)}">${g}</div>`).join('')}</div>` : '';
    }).join('');
  };
  draw();
  el.querySelector('#syQ').oninput = draw;
  el.querySelector('#syList').onclick = e => { const c = e.target.dataset.c; if (c) insertPlain(c + (/[a-zA-Z]$/.test(c) ? ' ' : '')); };
}

function searchPanel(el) {
  el.innerHTML = `<div class="row"><input id="srQ" placeholder="Search all files in the project"></div><div id="srList"></div>`;
  const go = debounce(async () => {
    await saveAll();
    const res = await api('fs:search', S.root, el.querySelector('#srQ').value);
    el.querySelector('#srList').innerHTML = `<div class="muted small">${res.length} result(s)</div>` + res.map(r => `<div class="card click" data-f="${esc(r.file)}" data-l="${r.line}"><div class="muted small">${esc(r.file)}:${r.line}</div><div class="mono">${esc(r.text)}</div></div>`).join('');
  }, 250);
  el.querySelector('#srQ').oninput = go; el.querySelector('#srQ').focus();
  el.querySelector('#srList').onclick = e => { const c = e.target.closest('.card'); if (c) openFile(c.dataset.f, +c.dataset.l); };
}

// Share the PDF, Word file or whole project: email, Gmail, Google Drive, OneDrive, Dropbox, WhatsApp, copy, save.
function sharePanel(el) {
  const kind = sharePanel.kind || 'pdf';
  const T = [['email', '&#9993;', 'Email', 'Opens a new email with the file attached (Outlook), or your mail app'],
    ['gmail', 'G', 'Gmail', 'Opens Gmail in your browser; drag the file in'],
    ['gdrive', '&#9650;', 'Google Drive', 'Puts the file in your Drive folder, or opens Drive to upload'],
    ['onedrive', '&#9729;', 'OneDrive', 'Puts the file in your OneDrive folder, or opens OneDrive'],
    ['dropbox', '&#9671;', 'Dropbox', 'Puts the file in your Dropbox folder, or opens Dropbox'],
    ['whatsapp', '&#9742;', 'WhatsApp', 'Opens WhatsApp Web; drag the file into a chat'],
    ['copy', '&#10697;', 'Copy file', 'Copies the file so you can paste it into Teams, Slack, an email or a folder'],
    ['save', '&#8681;', 'Save a copy', 'Save to the Desktop, a USB drive or any folder']];
  el.innerHTML = `<p class="muted small">Send your work to anyone, even people who do not use LaTeX.</p>
    <label>What to share</label>
    <div class="seg" id="shKind">${[['pdf', 'PDF'], ['word', 'Word (.docx)'], ['zip', 'Project (.zip)']].map(([k, l]) => `<button class="btn sm ${k === kind ? 'primary' : ''}" data-k="${k}">${l}</button>`).join('')}</div>
    <div class="share-grid">${T.map(([k, i, l, d]) => `<button class="share-opt" data-t="${k}" title="${d}"><span class="ico">${i}</span><span>${l}</span></button>`).join('')}</div>
    <div id="shMsg" class="card small hidden"></div>`;
  el.querySelectorAll('#shKind [data-k]').forEach(b => b.onclick = () => { sharePanel.kind = b.dataset.k; el.innerHTML = ''; sharePanel(el); });
  const msg = el.querySelector('#shMsg');
  const say = h => { msg.innerHTML = h; msg.classList.remove('hidden'); };
  el.querySelectorAll('.share-opt').forEach(b => b.onclick = async () => {
    const what = { pdf: 'PDF', word: 'Word file', zip: 'project ZIP' }[kind];
    say(`Preparing the ${what}...`);
    try {
      if (kind !== 'pdf') await saveAll();
      const file = await api('share:prepare', S.root, S.main, kind);
      const r = await api('share:send', file, b.dataset.t);
      if (!r) return msg.classList.add('hidden');
      const name = esc(file.split(/[\/]/).pop());
      say({ attached: `A new email is open with <b>${name}</b> attached. Add the address and send.`,
        copied: `<b>${name}</b> is copied. Paste it (Ctrl+V) into an email, chat or folder.`,
        saved: `Saved to <b>${esc(r.path || '')}</b>.`, shown: `<b>${name}</b> is shown in its folder.`,
        synced: `<b>${name}</b> is in your ${esc(r.service)} folder (Datex Shared) and uploads by itself. To send a link, right-click it there and choose Share.`,
        drag: `The page is open in your browser and <b>${name}</b> is shown in its folder. Drag the file into the page to attach or upload it.` }[r.how] || 'Done.');
    } catch (e) { say(esc(e.message)); }
  });
}
async function gitPanel(el) {
  const st = await api('git:status', S.root);
  const cfg = await api('project:config', S.root, {});
  const clouds = await api('cloud:detect');
  el.innerHTML = `<div class="sym-cat">Cloud backup</div>
    <p class="muted small">Keeps a copy of this project in your Google Drive, OneDrive or Dropbox folder. The cloud app on this PC uploads it.</p>
    <select id="clSel">${clouds.map(c => `<option value="${esc(c.path)}"${c.path === cfg.cloud ? ' selected' : ''}>${esc(c.name)} (${esc(c.path)})</option>`).join('')}${cfg.cloud && !clouds.some(c => c.path === cfg.cloud) ? `<option value="${esc(cfg.cloud)}" selected>${esc(cfg.cloud)}</option>` : ''}<option value="__pick">Choose another folder...</option></select>
    ${clouds.length ? '' : '<div class="muted small">No Google Drive, OneDrive or Dropbox folder found. Install <a href="#" data-link="https://www.google.com/drive/download/">Google Drive for desktop</a>, or choose any folder.</div>'}
    <label class="row"><input type="checkbox" id="clAuto" ${cfg.cloudAuto !== false ? 'checked' : ''}> Back up automatically each time a version is saved</label>
    <div class="row"><button class="btn primary" id="clNow">Back up now</button></div>
    <div class="sym-cat">Git and GitHub</div>
    <p class="muted">Every project keeps its own version history. Connect it to GitHub, GitLab or any Git server to sync and back up.</p>
    <label class="muted">Remote URL</label><div class="row"><input id="gtUrl" value="${esc(st.remote)}" placeholder="https://github.com/you/paper.git"><button class="btn" id="gtSet">Save</button></div>
    <div class="muted small">Branch: ${esc(st.branch || 'none yet')}</div>
    <div class="row"><button class="btn primary" id="gtPush">Push to remote</button><button class="btn" id="gtPull">Pull from remote</button></div>
    <pre id="gtOut" class="mono small" style="white-space:pre-wrap"></pre>
    <p class="muted small">Sign-in is handled by Git Credential Manager (included with Git for Windows). The first push opens a browser sign-in window.</p>`;
  const out = el.querySelector('#gtOut');
  const sel = el.querySelector('#clSel');
  const saveCloud = async () => {
    if (sel.value === '__pick') { const p = await api('cloud:pick'); if (!p) { sel.value = cfg.cloud || sel.options[0].value; return; } sel.insertAdjacentHTML('afterbegin', `<option value="${esc(p)}">${esc(p)}</option>`); sel.value = p; }
    await api('project:config', S.root, { cloud: sel.value, cloudAuto: el.querySelector('#clAuto').checked });
  };
  sel.onchange = saveCloud; el.querySelector('#clAuto').onchange = saveCloud;
  el.querySelector('#clNow').onclick = async () => {
    if (!sel.value || sel.value === '__pick') return toast('Choose a cloud folder first');
    await saveCloud(); await saveAll();
    try { const d = await api('cloud:backup', S.root, sel.value); toast('Backed up to ' + d); } catch (e) { toast(e.message, true); }
  };
  el.querySelector('#gtSet').onclick = async () => { try { await api('git:setRemote', S.root, el.querySelector('#gtUrl').value.trim()); toast('Remote saved'); } catch (e) { toast(e.message, true); } };
  el.querySelector('#gtPush').onclick = async () => { out.textContent = 'Pushing...'; try { await saveAll(); out.textContent = await api('git:push', S.root) || 'Done'; } catch (e) { out.textContent = e.message; } };
  el.querySelector('#gtPull').onclick = async () => {
    out.textContent = 'Pulling...';
    try { await saveAll(); out.textContent = await api('git:pull', S.root) || 'Done'; for (const [, f] of S.files) f.model.dispose(); S.files.clear(); S.active = null; await refreshTree(); await openFile(S.main); }
    catch (e) { out.textContent = e.message; }
  };
}

// ---------------- Settings, about ----------------
async function settingsDialog() {
  const s = settings;
  const c = modal(`<h2>Settings</h2>
    <label>Your name (shown on comments and versions)</label><input id="stName" value="${esc(s.userName || 'Me')}">
    <label>Projects folder</label><input id="stDir" value="${esc(s.projectsDir)}">
    <div class="row"><div style="flex:1"><label>Theme</label><select id="stTheme"><option value="system">Same as Windows (automatic)</option><option value="light">Light</option><option value="dark">Dark</option></select></div>
      <div style="flex:1"><label>Editor font size</label><input id="stFont" type="number" min="10" max="28" value="${s.fontSize}"></div></div>
    <div class="row"><div style="flex:1"><label>Default engine</label><select id="stEngine"><option value="auto">Auto</option><option value="builtin">Built-in (Datex TeX)</option><option value="pdflatex">pdfLaTeX</option><option value="xelatex">XeLaTeX</option><option value="lualatex">LuaLaTeX</option></select></div>
      <div style="flex:1"><label>Compile time limit (seconds, 0 = none)</label><input id="stTime" type="number" min="0" value="${s.compileTimeout}"></div></div>
    <label><input type="checkbox" id="stAuto" ${s.autoCompile !== false ? 'checked' : ''}> Compile automatically while typing</label>
    <label><input type="checkbox" id="stWrap" ${s.wordWrap ? 'checked' : ''}> Wrap long lines</label>
    <label><input type="checkbox" id="stUpd" ${s.autoUpdate !== false ? 'checked' : ''}> Keep Datex up to date automatically (checks for new versions and installs them when Datex closes)</label>
    <div class="row"><label style="flex:1"><input type="checkbox" id="stSpell" ${s.spellcheck !== false ? 'checked' : ''}> Check spelling</label><select id="stLang" style="flex:1"><option value="en-GB">English (UK)</option><option value="en-US">English (US)</option></select></div>
    <label>Local AI server (Ollama)</label><input id="stOllama" value="${esc(s.ollamaUrl)}">
    <label>TeX packages</label>
    <div class="muted small">Engine: ${tex.builtin ? 'Datex TeX built in' : 'built-in engine missing'}${tex.system ? ' · system TeX found (' + esc(tex.version) + ')' : ''}. Missing packages install automatically the first time a document needs them.</div>
    <div class="row" style="margin-top:6px"><button class="btn" id="stPk">Download common packages for offline use</button></div><pre id="stPkOut" class="mono small hidden" style="max-height:140px;overflow:auto;white-space:pre-wrap"></pre>
    <div class="modal-actions"><button class="btn ghost" id="stNo">Cancel</button><button class="btn primary" id="stOk">Save</button></div>`);
  c.querySelector('#stTheme').value = s.theme || 'system'; c.querySelector('#stLang').value = s.spellLang || 'en-GB'; c.querySelector('#stEngine').value = s.engine;
  c.querySelector('#stNo').onclick = closeModal;
  c.querySelector('#stPk').onclick = async () => {
    const o = c.querySelector('#stPkOut'); o.classList.remove('hidden'); o.textContent = 'Starting...\n';
    const off = window.datex.onTexProgress(t => { o.textContent += t; o.scrollTop = o.scrollHeight; if (/Done\.|Stopped/.test(t)) off(); });
    try { await api('tex:downloadAll'); } catch (e) { o.textContent += e.message; }
  };
  c.querySelector('#stOk').onclick = async () => {
    settings = await api('settings:set', { userName: c.querySelector('#stName').value || 'Me', projectsDir: c.querySelector('#stDir').value, theme: c.querySelector('#stTheme').value,
      fontSize: +c.querySelector('#stFont').value || 14, engine: c.querySelector('#stEngine').value, compileTimeout: +c.querySelector('#stTime').value || 0,
      autoCompile: c.querySelector('#stAuto').checked, wordWrap: c.querySelector('#stWrap').checked, spellcheck: c.querySelector('#stSpell').checked, autoUpdate: c.querySelector('#stUpd').checked, spellLang: c.querySelector('#stLang').value, ollamaUrl: c.querySelector('#stOllama').value });
    applyTheme(); applyEditorMode();
    $('#autoChk').checked = settings.autoCompile; spellBad = {}; spellCheck(); closeModal(); toast('Settings saved');
    if (!S.root) renderProjects();
  };
}
async function cloneRepo() {
  const url = await promptModal('Clone from GitHub', 'Repository URL (GitHub, GitLab, Bitbucket or any Git server)', 'https://github.com/');
  if (!url) return;
  toast('Cloning...');
  try { const dir = await api('repo:clone', url); if (S.root) await showDashboard(); openProject(dir); }
  catch (e) { toast(e.message, true); }
}
async function packagesDialog() {
  const t = await api('tex:info');
  const c = modal(`<h2>TeX packages</h2>
    <p>Datex has its own TeX engine built in, so no MiKTeX or TeX Live install is needed.</p>
    <div class="card small">
      <div><b>1. Already included:</b> the common packages (amsmath, graphicx, tikz, pgfplots, biblatex styles, hyperref, booktabs, IEEEtran, beamer and more) ship inside Datex and work offline.</div>
      <div style="margin-top:6px"><b>2. Installed automatically:</b> when a document uses any other package, Datex downloads it from the TeX Live archive during the compile and keeps it. The status bar shows "Installing packages" while this happens. It needs internet only that first time.</div>
      <div style="margin-top:6px"><b>3. Install ahead of time:</b> type package names below to download them now, for example before going offline.</div>
    </div>
    <div class="muted small" style="margin-top:8px">Engine: ${t.builtin ? 'Datex TeX (built in)' : 'built-in engine missing'}${t.system ? ' · also found ' + esc(t.version || 'a system TeX') : ''} · Package store: ${t.cacheMB} MB</div>
    <label>Install packages</label><div class="row"><input id="pkNames" placeholder="for example: siunitx, chemfig, tcolorbox"><button class="btn primary" id="pkGo">Install</button></div>
    <div class="row" style="margin-top:8px"><button class="btn" id="pkCommon">Download the common set again</button></div>
    <pre id="pkOut" class="mono small hidden" style="max-height:180px;overflow:auto;white-space:pre-wrap;background:var(--bg3);padding:8px;border-radius:6px"></pre>
    <div class="modal-actions"><button class="btn primary" id="pkClose">Close</button></div>`);
  const o = c.querySelector('#pkOut');
  const show = () => o.classList.remove('hidden');
  const off = window.datex.onTexProgress(tx => { o.textContent += tx; o.scrollTop = o.scrollHeight; });
  closeModal.onClose = off;
  c.querySelector('#pkClose').onclick = closeModal;
  c.querySelector('#pkGo').onclick = async () => {
    show(); o.textContent = 'Installing...\n';
    try { const l = await api('tex:install', c.querySelector('#pkNames').value); o.textContent += '\nInstalled: ' + l.installed.join(', ') + (l.failed.length ? '\nNot found: ' + l.failed.join(', ') : '') + '\n'; toast('Packages installed'); }
    catch (e) { o.textContent += '\n' + e.message + '\n'; }
  };
  c.querySelector('#pkCommon').onclick = async () => { show(); o.textContent = 'Starting...\n'; try { await api('tex:downloadAll'); } catch (e) { o.textContent += e.message; } };
  if (S.root) {
    // One click: every package the open project uses.
    const pb = document.createElement('button'); pb.className = 'btn primary'; pb.textContent = 'Install everything this project needs';
    c.querySelector('#pkCommon').before(pb);
    pb.onclick = async () => {
      show(); pb.disabled = true; o.textContent = 'Reading the project...\n';
      try {
        const names = await api('tex:scan', S.root);
        if (!names.length) { o.textContent += 'This project does not load any packages.\n'; return; }
        o.textContent += 'Installing ' + names.length + ' packages: ' + names.join(', ') + '\n';
        const l = await api('tex:install', names);
        o.textContent += '\nDone. Installed ' + l.installed.length + ' package(s).' + (l.failed.length ? '\nNot found: ' + l.failed.join(', ') : '') + '\n'; toast('Project packages installed');
      } catch (e) { o.textContent += '\n' + e.message + '\n'; } finally { pb.disabled = false; }
    };
  }
}
// Word export: the same LaTeX project as an editable Word document, for readers who do not use LaTeX.
async function exportWord(pick, quiet) {
  if (!S.root) return;
  await saveAll();
  const btn = $('#wordBtn'); btn.disabled = true; btn.innerHTML = '<b>W</b> Making...';
  try {
    const r = await api('word:export', S.root, S.main, !!pick);
    if (!r) return;
    if (quiet) { status('Word file updated: ' + r.file.split(/[\\/]/).pop()); return; }
    const cfg = await api('project:config', S.root, {});
    const c = modal(`<h2>Word document ready</h2>
      <p>Your LaTeX project is now also a Word file that anyone can open and edit, no LaTeX needed. Headings, lists, tables, figures, equations (as editable Word equations), citations and the reference list are kept.</p>
      <div class="card mono small">${esc(r.file)}</div>
      ${r.warnings.length ? `<details style="margin-top:8px"><summary class="muted small">${r.warnings.length} note(s) about parts Word cannot show</summary><div class="mono small muted">${r.warnings.map(esc).join('<br>')}</div></details>` : ''}
      <label style="margin-top:12px"><input type="checkbox" id="wdAuto" ${cfg.wordAuto ? 'checked' : ''}> Update this Word file automatically after every compile</label>
      <div class="modal-actions"><button class="btn ghost" id="wdFolder">Show in folder</button><button class="btn ghost" id="wdClose">Close</button><button class="btn primary" id="wdOpen">Open in Word</button></div>`);
    c.querySelector('#wdAuto').onchange = e => api('project:config', S.root, { wordAuto: e.target.checked });
    c.querySelector('#wdOpen').onclick = () => { api('file:open', r.file).catch(e => toast(e.message, true)); closeModal(); };
    c.querySelector('#wdFolder').onclick = () => api('file:reveal', r.file);
    c.querySelector('#wdClose').onclick = closeModal;
  } catch (e) { quiet ? status('Word update failed: ' + e.message) : toast(e.message, true); }
  finally { btn.disabled = false; btn.innerHTML = '<b>W</b> Word'; }
}
async function aboutDialog() {
  const info = await api('app:info');
  const c = modal(`<div class="about"><img src="assets/datex-icon.png" class="app-logo xl" alt=""><h2 style="margin:10px 0 2px">Datex</h2><div class="muted">Version ${esc(info.version)}</div>
    <p>A complete LaTeX writing studio for Windows: editor, TeX engine, PDF viewer, version history, track changes, references and local AI in one app.</p>
    <div class="credit-big" style="margin:14px auto 0"><img src="assets/datix-mark.png" alt=""><span>Developed by <a href="#" data-link="https://datixai.com" title="Visit datixai.com"><b>Datix AI</b></a> &amp; <a href="#" data-link="https://xactgenai.com" title="Visit xactgenai.com"><b>XactGen AI</b></a></span></div><div class="muted small" style="margin-top:6px"><a href="#" data-link="https://datixai.com" title="Visit datixai.com">datixai.com</a> &nbsp;·&nbsp; <a href="#" data-link="https://xactgenai.com" title="Visit xactgenai.com">xactgenai.com</a></div>
    <div class="muted small" id="abUpd" style="margin-top:12px"></div>
    <div class="modal-actions" style="justify-content:center"><button class="btn" id="abChk">Check for updates</button><button class="btn primary" id="abOk">Close</button></div></div>`);
  c.querySelector('#abOk').onclick = closeModal;
  const u = c.querySelector('#abUpd');
  const show = s => { u.textContent = updateText(s); };
  show(await api('update:status'));
  const off = window.datex.onUpdate(show); closeModal.onClose = off;
  c.querySelector('#abChk').onclick = async () => { u.textContent = 'Checking for updates...'; show(await api('update:check')); };
  if (aboutDialog.check) { aboutDialog.check = false; c.querySelector('#abChk').click(); }
}
function updateText(s) {
  return ({ checking: 'Checking for updates...', downloading: `Downloading Datex ${s.version || ''}... ${s.percent || 0}%`, latest: 'You have the latest version.',
    ready: `Datex ${s.version} is ready. It installs when you restart Datex.`, error: 'Could not check for updates (' + (s.message || 'no internet') + ').', dev: s.message }[s.state]) || '';
}
// A bar at the bottom when a new version has been downloaded.
function updateBar(s) {
  if (s.state !== 'ready' || document.querySelector('#updBar')) return;
  const b = document.createElement('div'); b.id = 'updBar'; b.className = 'upd-bar';
  b.innerHTML = `<span>Datex ${esc(s.version)} is ready to install.</span><button class="btn primary sm" id="updNow">Restart now</button><button class="btn ghost sm" id="updLater">Later</button>`;
  document.body.appendChild(b);
  b.querySelector('#updNow').onclick = async () => { await saveAll().catch(() => {}); if (S.root) await api('history:snapshot', S.root, 'Before update').catch(() => {}); api('update:install'); };
  b.querySelector('#updLater').onclick = () => b.remove();
}
function guideDialog() {
  const c = modal(`<h2>LaTeX quick guide</h2><div class="mono small" style="white-space:pre-wrap;line-height:1.7">\\section{Title}            Start a section
\\textbf{bold}  \\textit{italic}  \\underline{text}
$x^2 + y_1$               Inline math
\\begin{equation} ... \\end{equation}   Numbered equation
\\begin{itemize} \\item ... \\end{itemize}   Bullet list
\\includegraphics[width=\\linewidth]{file}   Image (needs graphicx)
\\cite{key}  \\ref{label}  \\label{label}   Citations and references
</div><p class="muted">Shortcuts: Ctrl+Enter compile · Ctrl+S save · Ctrl+B bold · Ctrl+I italic · Ctrl+/ comment · Ctrl+H replace · Ctrl+Alt+J jump to PDF · double-click PDF to jump to source.</p>
<div class="modal-actions"><button class="btn primary" id="gdOk">Close</button></div>`);
  c.querySelector('#gdOk').onclick = closeModal;
}

// ---------------- Layout, focus mode, Help ----------------
// A drop-down under a toolbar button. Items: { label, fn, on (tick mark), key (shortcut text) } or '-'.
function menuAt(btn, items) {
  document.querySelector('.ctx')?.remove();
  const r = btn.getBoundingClientRect();
  const m = document.createElement('div'); m.className = 'ctx';
  for (const it of items) {
    const d = document.createElement('div');
    if (it === '-') { d.className = 'line'; m.appendChild(d); continue; }
    d.textContent = it.label; if (it.on !== undefined) d.className = it.on ? 'on' : 'off';
    if (it.key) { const s = document.createElement('small'); s.textContent = it.key; d.appendChild(s); }
    d.onclick = () => { m.remove(); it.fn(); };
    m.appendChild(d);
  }
  document.body.appendChild(m);
  m.style.top = r.bottom + 4 + 'px'; m.style.left = Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8)) + 'px';
  setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }), 0);
}
// Layout: 'split' (editor and PDF side by side), 'editor' (editor only) or 'pdf' (PDF only).
function setLayout(mode, save = true) {
  S.layout = mode;
  const w = $('#workspace'); w.classList.toggle('lay-editor', mode === 'editor'); w.classList.toggle('lay-pdf', mode === 'pdf');
  if (save) api('settings:set', { layout: mode }).then(s => settings = s);
  if (mode !== 'editor' && S.pdf && S.zoom === 'fit') setTimeout(renderPdf, 80);
  if (mode !== 'pdf') setTimeout(() => editor.focus(), 0);
}
// Focus mode: nothing on screen but the text. Ctrl+Shift+M or Esc leaves it.
function focusMode(on = !document.body.classList.contains('focus')) {
  if (on && !S.root) return;
  document.body.classList.toggle('focus', on); $('#focusExit').classList.toggle('hidden', !on);
  if (on) { closePanel(); editor.focus(); } else if (S.pdf && S.zoom === 'fit') setTimeout(renderPdf, 80);
}
async function pdfWindow() {
  if (!S.pdfPath) return toast('Compile first');
  try { await api('pdf:window', S.pdfPath); toast('The PDF is open in its own window. It updates after each compile.'); } catch (e) { toast(e.message, true); }
}
function layoutMenu() {
  const L = S.layout || 'split';
  menuAt($('#layoutBtn'), [
    { label: 'Split view', on: L === 'split', fn: () => setLayout('split') },
    { label: 'Editor only', on: L === 'editor', fn: () => setLayout('editor') },
    { label: 'PDF only', on: L === 'pdf', fn: () => setLayout('pdf') },
    { label: 'Open PDF in separate window', on: false, fn: pdfWindow },
    '-',
    { label: 'Focus mode', on: false, key: 'Ctrl Shift M', fn: () => focusMode(true) }
  ]);
}
// Contact us: the two companies behind Datex.
function contactDialog() {
  const c = modal(`<h2>Contact us</h2><p>Datex is developed by Datix AI and XactGen AI. Reach either team through its website.</p>
    <div class="row"><button class="btn" data-link="https://datixai.com">Datix AI &middot; datixai.com</button><button class="btn" data-link="https://xactgenai.com">XactGen AI &middot; xactgenai.com</button></div>
    <div class="modal-actions"><button class="btn primary" id="ctOk">Close</button></div>`);
  c.querySelector('#ctOk').onclick = closeModal;
}
function helpMenu() {
  menuAt($('#helpBtn'), [
    { label: 'Keyboard shortcuts', key: 'F1', fn: shortcutsDialog },
    { label: 'Documentation', fn: guideDialog },
    '-',
    { label: 'Contact us', fn: contactDialog }
  ]);
}
const SHORTCUTS = [
  ['Document', [['Ctrl+Enter', 'Recompile'], ['Ctrl+S', 'Save and recompile'], ['Ctrl+Alt+J', 'Jump from the code to the PDF'], ['Double-click the PDF', 'Jump from the PDF to the code'], ['Ctrl+Shift+E', 'Export PDF'], ['Ctrl+Shift+W', 'Export Word document']]],
  ['Editing', [['Ctrl+B', 'Bold'], ['Ctrl+I', 'Italic'], ['Ctrl+/', 'Comment or uncomment lines'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Ctrl+F', 'Find'], ['Ctrl+H', 'Find and replace'], ['Ctrl+Shift+F', 'Find in the whole project'], ['Ctrl+D', 'Select the next match of the selected word'], ['Alt+Up / Alt+Down', 'Move the line up or down'], ['Ctrl+Space', 'Show suggestions']]],
  ['AI', [['Ctrl+K', 'Ask AI to build or change the document'], ['Ctrl+Shift+A', 'Open the AI assistant'], ['Ctrl+Enter (in the AI box)', 'Send']]],
  ['View', [['Ctrl+Shift+V', 'Switch between Code and Visual editor'], ['Ctrl+Shift+M', 'Focus mode'], ['Esc', 'Leave focus mode, close a dialog'], ['Ctrl+Shift+L', 'Light or dark mode'], ['Ctrl+Mouse wheel on the PDF', 'Zoom the PDF'], ['F11', 'Full screen']]],
  ['Panels and project', [['Ctrl+Shift+R', 'Track changes'], ['Ctrl+Shift+B', 'References'], ['Ctrl+Shift+N', 'New project'], ['Ctrl+Shift+O', 'Open a project folder'], ['Ctrl+Shift+D', 'Project dashboard'], ['Ctrl+,', 'Settings'], ['F1', 'This list']]]
];
function shortcutsDialog() {
  const c = modal(`<h2>Keyboard shortcuts</h2><input id="kbQ" placeholder="Search shortcuts..." style="width:100%;margin-bottom:6px">
    <div style="max-height:60vh;overflow:auto"><table class="keys">${SHORTCUTS.map(([g, rows]) => `<tbody><tr><th colspan="2">${esc(g)}</th></tr>${rows.map(([k, d]) => `<tr><td>${k.split(' / ').map(x => `<kbd>${esc(x)}</kbd>`).join(' ')}</td><td>${esc(d)}</td></tr>`).join('')}</tbody>`).join('')}</table></div>
    <div class="modal-actions"><button class="btn primary" id="kbOk">Close</button></div>`);
  c.style.width = '620px';
  c.querySelector('#kbOk').onclick = closeModal;
  const q = c.querySelector('#kbQ'); q.focus();
  q.oninput = () => { const w = q.value.toLowerCase(); c.querySelectorAll('.keys tbody').forEach(tb => { let any = false; tb.querySelectorAll('tr').forEach((tr, i) => { if (!i) return; const hit = tr.textContent.toLowerCase().includes(w); tr.style.display = hit ? '' : 'none'; any = any || hit; }); tb.style.display = any ? '' : 'none'; }); };
}

// ---------------- Share dialog ----------------
// Datex has no server: people edit together through a live session between PCs on the same
// network, and anyone else gets a copy (PDF, Word or ZIP). This dialog puts both in one place.
function shareDetails(st) {
  const where = st.role === 'host' ? st.addresses.map(a => a + ':' + st.port).join(' or ') : st.addr;
  return { where, text: `Datex live session for "${S.name}"\nAddress: ${where}\nCode: ${st.code || '(ask the host)'}` };
}
function shareDialog() {
  const st = live.status();
  const d = st ? shareDetails(st) : null;
  const c = modal(`<h2>Share ${esc(S.name)}</h2>
    <label>Enter emails separated by commas</label>
    <div class="row"><input id="shEmails" placeholder="name@example.com, colleague@example.com"><button class="btn primary" id="shInvite">Invite</button></div>
    <div class="share-state">${st ? `<b>Live sharing is on</b> &nbsp; <a href="#" id="shOff">${st.role === 'host' ? 'Turn off live sharing' : 'Leave the session'}</a>` : '<b>Live sharing is off</b> &nbsp; <a href="#" id="shOn">Turn on live sharing</a>'}</div>
    ${st ? `<div class="share-box"><div class="muted small">People join in Datex with <b>Join Live Session</b> on the Dashboard, using:</div><div style="margin-top:6px">Address: <b class="mono">${esc(d.where || 'No network found')}</b></div>${st.code ? `<div>Code: <b class="mono" style="font-size:16px;letter-spacing:2px">${esc(st.code)}</b></div>` : ''}</div>` : ''}
    <div class="sym-cat">Project access</div>
    <div class="share-people">${st ? st.peers.map(p => `<div class="row"><span class="peer-dot c${p.color}">${esc(p.name.slice(0, 1).toUpperCase())}</span> ${esc(p.name)}${p.self ? ' <span class="muted">(you)</span>' : ''}</div>`).join('') : '<div class="row muted">&#128101; No one invited yet</div>'}</div>
    <div class="row" style="margin-top:6px">&#128274; <b>Only people with the session code</b></div>
    <p class="muted small">Live sharing works between PCs on the same network (office or home Wi-Fi); each person needs Datex. For anyone else, send a copy.</p>
    <div class="modal-actions"><button class="btn ghost" id="shCopy"${st ? '' : ' disabled'}>Copy sharing details</button><button class="btn" id="shSend">Send a copy (PDF, Word, ZIP)</button><button class="btn primary" id="shClose">Close</button></div>`);
  c.style.width = '600px';
  const on = async () => { try { await live.host(); } catch (e) { toast(e.message, true); return null; } return live.status(); };
  c.querySelector('#shClose').onclick = closeModal;
  c.querySelector('#shSend').onclick = () => { closeModal(); if (S.panel !== 'share') openPanel('share'); };
  c.querySelector('#shCopy').onclick = () => navigator.clipboard.writeText(d.text).then(() => toast('Sharing details copied'));
  c.querySelector('#shOn')?.addEventListener('click', async e => { e.preventDefault(); if (await on()) shareDialog(); });
  c.querySelector('#shOff')?.addEventListener('click', async e => { e.preventDefault(); await live.end(); shareDialog(); });
  const invite = async () => {
    const emails = c.querySelector('#shEmails').value.trim();
    if (!emails) return toast('Enter at least one email address', true);
    const now = live.status() || await on(); if (!now) return;
    const info = shareDetails(now), me = settings.userName && settings.userName !== 'Me' ? settings.userName : 'A colleague';
    const body = `${me} invited you to edit the project "${S.name}" together in Datex.\n\nHow to join:\n1. Open Datex on a PC on the same network.\n2. On the Dashboard, click "Join Live Session".\n3. Address: ${info.where}\n4. Code: ${now.code || '(ask the host)'}\n\nThe session stays open while ${me}'s Datex is running.`;
    try { const n = await api('share:invite', emails, `Invitation to edit "${S.name}" in Datex`, body); toast(`Your email program opened with the invitation for ${n} ${n === 1 ? 'person' : 'people'}. Press Send there.`); shareDialog(); }
    catch (e) { toast(e.message, true); }
  };
  c.querySelector('#shInvite').onclick = invite;
  c.querySelector('#shEmails').onkeydown = e => { if (e.key === 'Enter') invite(); };
}

// ---------------- Code / Visual editor ----------------
// Visual shows the same LaTeX text the way it reads: headings look like headings, bold is bold,
// \item is a bullet, \cite is a small tag. Nothing in the file changes, and the line with the
// cursor always shows its real code, so everything stays editable.
let vzMarks = null, vzLine = 0;
const isVisual = () => settings.editorMode === 'visual';
function applyEditorMode() {
  const v = isVisual(), size = settings.fontSize || 14;
  editor.updateOptions(v
    ? { fontFamily: 'Georgia, Cambria, "Times New Roman", serif', fontSize: size + 2, lineHeight: Math.round((size + 2) * 1.65), lineNumbers: 'off', minimap: { enabled: false }, wordWrap: 'on', wrappingStrategy: 'advanced', glyphMargin: false, folding: false, renderLineHighlight: 'none', padding: { top: 14 } }
    : { fontFamily: 'Cascadia Code, Consolas, monospace', fontSize: size, lineHeight: 0, lineNumbers: 'on', minimap: { enabled: true, renderCharacters: false }, wordWrap: settings.wordWrap ? 'on' : 'off', wrappingStrategy: 'simple', glyphMargin: true, folding: true, renderLineHighlight: 'line', padding: { top: 0 } });
  document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('on', (b.dataset.m === 'visual') === v));
  drawVisual();
}
function drawVisual() {
  if (vzMarks) { vzMarks.clear(); vzMarks = null; }
  const m = editor.getModel();
  if (!isVisual() || !m || m.getLanguageId() !== 'latex' || m.getLineCount() > 8000) return;
  vzLine = editor.getPosition()?.lineNumber || 0;
  const R = monaco.Range, list = [];
  for (const k of documentMarks(m.getLinesContent(), vzLine)) {
    if (k.kind === 'bullet') list.push({ range: new R(k.line, k.start + 1, k.line, k.start + 1), options: { before: { content: '•', inlineClassName: 'vz-bullet' } } });
    else list.push({ range: new R(k.line, k.start + 1, k.line, k.end + 1), options: { inlineClassName: k.kind === 'hide' ? 'vz-hide' : k.cls } });
  }
  vzMarks = editor.createDecorationsCollection(list);
}
const drawVisualSoon = debounce(drawVisual, 120);
async function setEditorMode(mode) { settings = await api('settings:set', { editorMode: mode }); applyEditorMode(); editor.focus(); }

// ---------------- Commands & wiring ----------------
const CMDS = {
  newProject, exportWord: () => exportWord(false), wordMenu: () => wordMenu(), wordToLatex: () => wordToLatex(null, null), exportWordAs: () => exportWord(true), joinSession: () => live.joinDialog(), packages: () => packagesDialog(), cloneRepo: () => cloneRepo(), openProject: openFolder, importZip: () => importZip(), dashboard: showDashboard, settings: settingsDialog, about: aboutDialog, liveSession: () => S.root ? openPanel('live') : toast('Open a project first'), toggleTheme: async () => { settings = await api('settings:set', { theme: isDark() ? 'light' : 'dark' }); applyTheme(); }, checkUpdates: () => { aboutDialog.check = true; aboutDialog(); }, guide: guideDialog,
  save: () => saveAll().then(() => toast('Saved')), compile: () => compile(),
  stop: () => api('compile:stop', S.root), clean: async () => { await api('compile:clean', S.root); toast('Build files cleared'); },
  syncForward, zoomIn: () => zoomStep(1), zoomOut: () => zoomStep(-1),
  exportPdf: async () => { if (!S.pdfPath) return toast('Compile first'); const p = await api('pdf:export', S.pdfPath, S.name); if (p) toast('Saved ' + p); },
  exportZip: async () => { if (!S.root) return; await saveAll(); const p = await api('project:zip', S.root); if (p) toast('Saved ' + p); },
  newFile: () => newFile(), newFolder, upload, refreshTree: () => refreshTree(),
  review: () => openPanel('review'), comments: () => openPanel('comments'), history: () => openPanel('history'), refs: () => openPanel('refs'),
  layoutMenu, helpMenu, contact: contactDialog, shareDialog, shortcuts: shortcutsDialog, pdfWindow, focusMode: () => focusMode(),
  layoutSplit: () => setLayout('split'), layoutEditor: () => setLayout('editor'), layoutPdf: () => setLayout('pdf'),
  toggleVisual: () => setEditorMode(isVisual() ? 'code' : 'visual'),
  ai: () => openPanel('ai'), aiPrompt: () => $('#promptIn').focus(), aiNewProject: async () => { if (S.root) await showDashboard(); aiNewProject(); }, symbols: () => openPanel('symbols'), git: () => openPanel('git'), search: () => openPanel('search'), wordcount: wordCountDialog
};
const needsProject = new Set(['exportWord', 'exportWordAs', 'save', 'compile', 'stop', 'clean', 'syncForward', 'exportPdf', 'exportZip', 'review', 'comments', 'history', 'refs', 'ai', 'aiPrompt', 'layoutMenu', 'shareDialog', 'pdfWindow', 'focusMode', 'layoutSplit', 'layoutEditor', 'layoutPdf', 'toggleVisual', 'symbols', 'git', 'search', 'wordcount', 'newFile', 'newFolder', 'upload']);
function runCmd(c) { if (needsProject.has(c) && !S.root) return toast('Open a project first'); CMDS[c] && CMDS[c](); }

function wire() {
  document.addEventListener('click', e => {
    const c = e.target.closest('[data-cmd]'); if (c) runCmd(c.dataset.cmd);
    const p = e.target.closest('[data-panel]'); if (p) openPanel(p.dataset.panel);
    const l = e.target.closest('[data-link]'); if (l) { e.preventDefault(); api('shell:open', l.dataset.link); }
  });
  window.datex.onMenu(runCmd);
  window.datex.onUpdate(updateBar);
  window.datex.onCompileOutput(t => { const m = String(t).match(/downloading\s+[`'"]?([^\s`'"]+)/i); if (m && S.compiling) status('Installing packages: ' + m[1]); });
  $('#projSearch').oninput = debounce(renderProjects, 150);
  $('#drawerClose').onclick = closePanel;
  $('#promptGo').onclick = sendPromptBar;
  $('#promptIn').onkeydown = e => { if (e.key === 'Enter') sendPromptBar(); else if (e.key === 'Escape') editor.focus(); };
  $('#modal').onclick = e => { if (e.target.id === 'modal') closeModal(); };
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('#modal').classList.contains('hidden')) closeModal();
    else if (document.body.classList.contains('focus')) focusMode(false);
  });
  $('#tabs').onclick = e => { const x = e.target.dataset.x; if (x) return closeTab(x); const t = e.target.closest('.tab'); if (t) openFile(t.dataset.p); };
  $('#tabs').onauxclick = e => { const t = e.target.closest('.tab'); if (t && e.button === 1) closeTab(t.dataset.p); };
  $('#mainSel').onchange = e => setMain(e.target.value);
  $('#draftChk').onchange = () => compile();
  $('#pageNum').onkeydown = e => { if (e.key === 'Enter') { goToPage(+e.target.value); e.target.blur(); } else if (e.key === 'Escape') { e.target.blur(); updatePageInfo(); } };
  $('#pageNum').onfocus = e => e.target.select();
  $('#pageNum').onblur = () => updatePageInfo();
  $('#engineSel').onchange = e => { S.engine = e.target.value; api('project:config', S.root, { engine: S.engine }); compile(); };
  $('#autoChk').onchange = e => api('settings:set', { autoCompile: e.target.checked }).then(s => settings = s);
  $('#zoomSel').onchange = e => setZoom(e.target.value);
  $('#logsBtn').onclick = () => $('#logs').classList.toggle('hidden');
  $('#rawLogBtn').onclick = () => $('#rawLog').classList.toggle('hidden');
  $('#aiFixBtn').onclick = () => { openPanel('ai'); setTimeout(() => runAction(AI_ACTIONS.find(a => a.id === 'fix'), $('#drawerBody')), 300); };
  $('#issues').onclick = e => { const d = e.target.closest('[data-k]'); if (!d) return; const i = S.issues[+d.dataset.k]; if (i.file) openFile(i.file.replace(/^\.\//, ''), i.line); };
  $('#pdfView').ondblclick = syncBackward;
  $('#pdfView').onscroll = debounce(updatePageInfo, 80);
  $('#pdfView').addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); zoomStep(e.deltaY < 0 ? 1 : -1); } }, { passive: false });
  new ResizeObserver(debounce(() => { if (S.zoom === 'fit' && S.pdf) renderPdf(); }, 250)).observe($('#pdfView'));
  treeEvents();
  // Resizable panes
  document.querySelectorAll('.gutter').forEach(g => g.onmousedown = e => {
    const target = $('#' + g.dataset.resize), startX = e.clientX, startW = target.getBoundingClientRect().width, fromRight = g.dataset.resize === 'pdfPane';
    const move = ev => { target.style.flex = '0 0 ' + Math.max(150, startW + (fromRight ? startX - ev.clientX : ev.clientX - startX)) + 'px'; };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.body.style.userSelect = ''; };
    document.body.style.userSelect = 'none'; document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  });
  window.addEventListener('beforeunload', () => { if (S.root) saveAll(); });
}

async function main() {
  const info = await api('app:info');
  settings = info.settings; tex = info.tex;
  applyTheme();
  monaco = await loadMonaco();
  setupLanguages(); createEditor(); buildFmtBar(); applyTheme(); wire();
  applyEditorMode(); setLayout(settings.layout || 'split', false);
  editor.onDidChangeModel(() => drawVisual());
  editor.onDidChangeModelContent(() => { if (isVisual()) drawVisualSoon(); });
  editor.onDidChangeCursorPosition(e => { if (isVisual() && e.position.lineNumber !== vzLine) drawVisualSoon(); });
  live.initLive({ S, api, monaco, editor, toast, modal, closeModal, openProject, refreshTree, allFiles, saveAll, autosave, applyCommentDecorations, refreshPanel, TEXT_EXT, settings: () => settings });
  if (!tex.builtin && !tex.system) {
    const w = $('#texWarning'); w.classList.remove('hidden');
    w.innerHTML = 'No TeX engine was found. Reinstall Datex to restore the built-in engine, or install <a href="#" data-link="https://miktex.org/download">MiKTeX</a>.';
  }
  showDashboard();
  // Keep the opening screen up long enough to read, then fade it out.
  setTimeout(() => { const sp = $('#splash'); sp.classList.add('out'); setTimeout(() => { sp.remove(); stopSplashStars(); }, 800); }, Math.max(0, 2600 - (performance.now() - splashStart)));
}
window.__datex = { S, openProject, compile, openFile, openPanel, syncForward, newProject, live, buildAsk, aiBusy: () => aiBusy, runCmd: c => runCmd(c), editor: () => editor };
main().catch(e => { document.body.innerHTML = '<pre style="padding:20px;color:#f88">Datex failed to start:\n' + esc(e.stack || e.message) + '</pre>'; });
