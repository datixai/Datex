// Visual mode: which parts of a LaTeX line are hidden, styled or turned into bullets.
import test from 'node:test';
import assert from 'node:assert';
import { lineMarks, documentMarks, matchBrace, commentStart } from '../renderer/visual.js';

const B = String.fromCharCode(92); // a backslash
const shown = (text) => {
  // The line as Visual mode displays it: hidden ranges removed, a bullet where one is drawn.
  const marks = lineMarks(text); let out = '';
  for (let i = 0; i < text.length; i++) {
    if (marks.some(k => k.kind === 'bullet' && k.start === i)) out += '• ';
    if (!marks.some(k => k.kind === 'hide' && i >= k.start && i < k.end)) out += text[i];
  }
  return out;
};
const cls = (text, word) => lineMarks(text).filter(k => k.kind === 'style' && text.slice(k.start, k.end).includes(word)).map(k => k.cls);

test('headings and text styles lose their commands and keep their text', () => {
  assert.equal(shown(B + 'section{Results}'), 'Results');
  assert.deepEqual(cls(B + 'section{Results}', 'Results'), ['vz-h1']);
  assert.equal(shown(B + 'subsection*{More}'), 'More');
  assert.equal(shown('A ' + B + 'textbf{bold} and ' + B + 'emph{soft} word'), 'A bold and soft word');
  assert.deepEqual(cls('A ' + B + 'textbf{bold} x', 'bold'), ['vz-b']);
  // A style inside a heading is handled as well.
  assert.equal(shown(B + 'section{The ' + B + 'textit{big} one}'), 'The big one');
  // An unclosed command is left exactly as typed.
  assert.equal(shown(B + 'textbf{open'), B + 'textbf{open');
});

test('items become bullets, citations become chips, quiet commands are dimmed', () => {
  assert.equal(shown('  ' + B + 'item First point'), '  • First point');
  assert.equal(shown('See ' + B + 'cite{knuth1984} and Table~' + B + 'ref{tab:x}.'), 'See knuth1984 and Table~tab:x.');
  assert.deepEqual(cls('See ' + B + 'cite{knuth1984}', 'knuth'), ['vz-chip']);
  assert.deepEqual(cls('Table~' + B + 'ref{tab:x}', 'tab:x'), ['vz-chip vz-ref']);
  assert.deepEqual(cls(B + 'label{eq:main}', 'eq:main'), ['vz-dim']);
  assert.deepEqual(cls(B + 'begin{itemize}', 'itemize'), ['vz-env']);
  assert.equal(shown(B + 'begin{itemize}'), B + 'begin{itemize}');
});

test('math and comments are marked, escaped signs are not', () => {
  assert.deepEqual(cls('Energy $E = mc^2$ here', 'mc'), ['vz-math']);
  assert.deepEqual(cls('It costs ' + B + '$5 and ' + B + '$6', '5'), []);
  assert.deepEqual(cls('Text % a note', 'note'), ['vz-dim']);
  assert.equal(commentStart('50' + B + '% done % real'), 10);
  assert.equal(matchBrace('{a{b}c}d', 0), 6);
  assert.equal(matchBrace('{open', 0), -1);
});

test('the preamble is dimmed as a block and the cursor line is left alone', () => {
  const lines = [B + 'documentclass{article}', B + 'usepackage{amsmath}', B + 'begin{document}', B + 'section{One}', B + 'textbf{x}'];
  const marks = documentMarks(lines, 5);
  assert.deepEqual(marks.filter(k => k.cls === 'vz-pre').map(k => k.line), [1, 2]);
  assert.ok(marks.some(k => k.line === 4 && k.cls === 'vz-h1'));
  assert.equal(marks.filter(k => k.line === 5).length, 0);
  // A chapter file has no preamble: its first lines are styled as body text.
  assert.ok(documentMarks([B + 'section{Intro}'], 0).some(k => k.cls === 'vz-h1'));
});
