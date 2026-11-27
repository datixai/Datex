// AI Build chat: reading edit blocks out of a model reply and applying them to project files.
import test from 'node:test';
import assert from 'node:assert';
import { parseSearches, papersMessage, parseEdits, applyOps, progress, wholeDocument, safePath, minimalEdit, buildContext, diffStat } from '../renderer/aibuild.js';

const reply = [
  'I will add a methods section and a new chapter file.',
  '',
  'FILE: main.tex',
  '<<<<<<< SEARCH',
  '\\section{Introduction}',
  '=======',
  '\\section{Introduction}',
  '',
  '\\section{Methods}',
  'We did things.',
  '>>>>>>> REPLACE',
  '',
  '### FILE: `chapters/results.tex`',
  '<<<<<<< WRITE',
  '\\chapter{Results}',
  'Text.',
  '>>>>>>> END',
  'Done.'
].join('\n');

test('parseEdits reads replace and write blocks', () => {
  const ops = parseEdits(reply);
  assert.equal(ops.length, 2);
  assert.deepEqual(ops[0], { path: 'main.tex', kind: 'replace', search: '\\section{Introduction}', replace: '\\section{Introduction}\n\n\\section{Methods}\nWe did things.' });
  assert.equal(ops[1].path, 'chapters/results.tex');
  assert.equal(ops[1].kind, 'write');
});

test('applyOps edits, creates and reports blocks it cannot place', () => {
  const texts = { 'main.tex': '\\begin{document}\r\n  \\section{Introduction}\r\nHello.\r\n\\end{document}\r\n', 'chapters/results.tex': null };
  const ops = [...parseEdits(reply), { path: 'main.tex', kind: 'replace', search: 'not in the file', replace: 'x' }];
  const r = applyOps(texts, ops);
  assert.equal(r.failed.length, 1);
  const main = r.files.find(f => f.path === 'main.tex');
  assert.match(main.after, /  \\section\{Introduction\}\n\n\\section\{Methods\}\nWe did things\.\nHello\./);
  assert.equal(main.created, false);
  assert.equal(main.added, 3);
  assert.equal(main.removed, 0);
  // Different indentation and trailing spaces in the SEARCH text: the lines are still found.
  const loose = applyOps({ 'a.tex': 'x\n    \\item one\n    \\item two\ny\n' }, [{ path: 'a.tex', kind: 'replace', search: '\\item one  \n\\item two', replace: '\\item 1' }]);
  assert.equal(loose.files[0].after, 'x\n\\item 1\ny\n');
  const res = r.files.find(f => f.path === 'chapters/results.tex');
  assert.equal(res.created, true);
  assert.equal(res.after, '\\chapter{Results}\nText.\n');
});

test('blocks closed with the wrong marker are still read', () => {
  // What a small local model really produced: WRITE closed with a separator and a bare END.
  const sloppy = ['Adding an appendix.', '', 'FILE: sections/appendix.tex', '<<<<<<< WRITE', '\\section{Appendix}', 'More.', '=======', '', 'END', '',
    'FILE: main.tex', '<<<<<<< SEARCH', '\\bibliographystyle{plain}', '=======', '\\input{sections/appendix}', '\\bibliographystyle{plain}', '>>>>>>>', 'Done.'].join('\n');
  const ops = parseEdits(sloppy);
  assert.equal(ops.length, 2);
  assert.deepEqual(ops[0], { path: 'sections/appendix.tex', kind: 'write', content: '\\section{Appendix}\nMore.' });
  assert.equal(ops[1].replace, '\\input{sections/appendix}\n\\bibliographystyle{plain}');
  assert.equal(progress(sloppy).prose, 'Adding an appendix.\n\nDone.');
  // No closing marker at all: the block ends where the next file's block starts.
  const open = ['FILE: a.tex', '<<<<<<< WRITE', 'A', '', 'FILE: b.tex', '<<<<<<< WRITE', 'B', '>>>>>>> END'].join('\n');
  assert.deepEqual(parseEdits(open).map(o => [o.path, o.content]), [['a.tex', 'A'], ['b.tex', 'B']]);
  // A reply cut off in the middle of a block applies nothing from that block.
  assert.equal(parseEdits('FILE: a.tex\n<<<<<<< WRITE\nhalf a file').length, 0);
});

test('an empty SEARCH adds to the end of the file', () => {
  const r = applyOps({ 'refs.bib': '@book{a,title={A}}\n' }, [{ path: 'refs.bib', kind: 'replace', search: '', replace: '@book{b,title={B}}' }]);
  assert.equal(r.files[0].after, '@book{a,title={A}}\n\n@book{b,title={B}}\n');
});

test('paths outside the project or of other file types are refused', () => {
  assert.equal(safePath('../secret.tex'), null);
  assert.equal(safePath('C:\\Windows\\x.tex'), null);
  assert.equal(safePath('/etc/x.tex'), null);
  assert.equal(safePath('.git/config.txt'), null);
  assert.equal(safePath('run.exe'), null);
  assert.equal(safePath('.\\chapters\\one.tex'), 'chapters/one.tex');
  assert.equal(parseEdits('FILE: ../../x.tex\n<<<<<<< WRITE\nhi\n>>>>>>> END').length, 0);
});

test('progress hides blocks and names the file being written', () => {
  const half = reply.split('\n').slice(0, 16).join('\n');
  const p = progress(half);
  assert.equal(p.prose, 'I will add a methods section and a new chapter file.');
  assert.deepEqual(p.files, ['main.tex']);
  assert.equal(p.writing, 'chapters/results.tex');
  assert.equal(progress(reply).writing, null);
});

test('wholeDocument finds a full document given in a code fence', () => {
  assert.equal(wholeDocument('Here:\n```latex\n\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n```'), '\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n');
  assert.equal(wholeDocument('```latex\n\\section{x}\n```'), null);
});

test('minimalEdit and diffStat', () => {
  const a = 'one\ntwo\nthree\n', b = 'one\nTWO\nthree\n';
  const e = minimalEdit(a, b);
  assert.equal(a.slice(0, e.start) + e.text + a.slice(e.end), b);
  assert.equal(e.text, 'TWO');
  assert.deepEqual(diffStat(a, b), { added: 1, removed: 1 });
  const same = minimalEdit('aaa', 'aaaa');
  assert.equal('aaa'.slice(0, same.start) + same.text + 'aaa'.slice(same.end), 'aaaa');
});

test('buildContext puts the main file first and shortens what does not fit', () => {
  const ctx = buildContext({
    files: [{ path: 'z.tex', text: 'Z'.repeat(5000) }, { path: 'main.tex', text: '\\documentclass{article}' }],
    main: 'main.tex', active: 'z.tex', selection: 'picked', issues: [{ level: 'error', file: 'main.tex', line: 3, message: 'Undefined control sequence' }], budget: 1000
  });
  assert.ok(ctx.indexOf('===== main.tex =====') < ctx.indexOf('===== z.tex'));
  assert.match(ctx, /z\.tex \(shortened/);
  assert.match(ctx, /main\.tex:3: Undefined control sequence/);
  assert.match(ctx, /picked/);
});

test('literature search requests and the results message', () => {
  assert.deepEqual(parseSearches('ARXIV: solar water pumps efficiency\n**ARXIV:** "photovoltaic irrigation"\nARXIV: solar water pumps efficiency\nARXIV: c\nARXIV: d'), ['solar water pumps efficiency', 'photovoltaic irrigation', 'c']);
  assert.deepEqual(parseSearches('I looked on arxiv: nothing is needed here.'), []);
  const msg = papersMessage([{ key: 'lee2020solar', title: 'Solar pumps', authors: ['A Lee', 'B Kim', 'C Roe', 'D Poe', 'E Moe'], year: '2020', summary: 'We test pumps.', bibtex: '@article{lee2020solar,\n  title = {Solar pumps}\n}' }], 'refs.bib');
  assert.match(msg, /\[lee2020solar\] Solar pumps\nA Lee, B Kim, C Roe, D Poe et al\. \(2020\)/);
  assert.match(msg, /to refs\.bib with an empty SEARCH block\./);
  assert.match(papersMessage([], null), /no papers/);
  assert.match(buildContext({ files: [], main: 'main.tex', active: 'a.tex', cursorLine: 12 }), /a\.tex \(the cursor is at line 12\)/);
});
