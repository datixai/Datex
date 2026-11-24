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
