'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseLog } = require('../lib/latexlog');
const { parseBib, searchBib } = require('../lib/bibtex');

test('parseLog finds file-line errors and warnings', () => {
  const log = [
    './main.tex:12: Undefined control sequence.',
    'l.12 \\foo',
    'LaTeX Warning: Citation `x\' on page 1 undefined on input line 20.',
    'Overfull \\hbox (3.0pt too wide) in paragraph at lines 30--31'
  ].join('\n');
  const r = parseLog(log);
  assert.equal(r[0].level, 'error');
  assert.equal(r[0].line, 12);
  assert.equal(r[0].file, 'main.tex');
  assert.equal(r[1].level, 'warning');
  assert.equal(r[1].line, 20);
  assert.equal(r[2].level, 'typesetting');
  assert.equal(r[2].line, 30);
});

test('parseBib reads entries and fields', () => {
  const bib = '@article{smith2020, title={Deep {L}earning}, author="Smith, J. and Doe, A.", year=2020}\n@book{lee19,title={Books},year={2019}}';
  const e = parseBib(bib);
  assert.equal(e.length, 2);
  assert.equal(e[0].key, 'smith2020');
  assert.equal(e[0].fields.title, 'Deep Learning');
  assert.equal(e[0].fields.year, '2020');
  assert.equal(searchBib(e, 'smith 2020').length, 1);
  assert.equal(searchBib(e, 'books').length, 1);
});

const { arxivQuery, arxivResults } = require('../lib/arxiv');
test('arXiv: query words, parsed entries, keys and BibTeX', () => {
  assert.equal(arxivQuery('Find recent papers on the attention mechanism in transformers!'), 'all:attention AND all:mechanism AND all:transformers');
  const xml = `<feed><entry><id>http://arxiv.org/abs/1706.03762v7</id><published>2017-06-12T17:57:34Z</published>
    <title>Attention Is All
      You Need</title><summary> We propose the Transformer &amp; more. </summary>
    <author><name>Ashish Vaswani</name></author><author><name>Noam Shazeer</name></author>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.CL" scheme="x"/></entry>
    <entry><id>http://arxiv.org/abs/2001.00001v1</id><published>2017-01-01T00:00:00Z</published><title>Attention again</title><summary>s</summary><author><name>José Vaswani</name></author></entry></feed>`;
  const r = arxivResults(xml, ['vaswani2017attention']);
  assert.equal(r.length, 2);
  assert.equal(r[0].id, '1706.03762');
  assert.equal(r[0].title, 'Attention Is All You Need');
  assert.equal(r[0].summary, 'We propose the Transformer & more.');
  // The plain key is already used in the project, so the new entries get the next free ones.
  assert.equal(r[0].key, 'vaswani2017attention2');
  assert.equal(r[1].key, 'vaswani2017attention3');
  assert.match(r[0].bibtex, /^@article\{vaswani2017attention2,\n  title = \{\{Attention Is All You Need\}\},\n  author = \{Ashish Vaswani and Noam Shazeer\},\n  year = \{2017\}/);
  assert.match(r[0].bibtex, /eprint = \{1706\.03762\}/);
  assert.equal(parseBib(r[0].bibtex)[0].fields.title, 'Attention Is All You Need');
});
