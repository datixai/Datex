// arXiv literature search: build the query, read the Atom answer and write BibTeX entries.
// Only the search words go to arxiv.org, never the document.
'use strict';

const STOP = new Set('a an and are as at be by for from in into is it of on or that the this to with about using use via paper papers work works study studies recent related find search literature research'.split(' '));

// Turn a phrase into an arXiv API query: the meaningful words, all required.
function arxivQuery(text) {
  const words = String(text || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !STOP.has(w)).slice(0, 7);
  return words.map(w => 'all:' + w).join(' AND ');
}
function arxivUrl(text, max = 6) {
  const q = arxivQuery(text);
  if (!q) throw new Error('Enter a few words to search for');
  return 'https://export.arxiv.org/api/query?search_query=' + encodeURIComponent(q) + '&start=0&max_results=' + Math.max(1, Math.min(20, max)) + '&sortBy=relevance&sortOrder=descending';
}

const unxml = s => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const tag = (xml, name) => { const m = xml.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>')); return m ? unxml(m[1]) : ''; };

function parseArxiv(xml) {
  const out = [];
  for (const m of String(xml || '').matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const id = (tag(e, 'id').match(/abs\/(.+?)(?:v\d+)?$/) || [])[1];
    if (!id) continue;
    out.push({
      id, url: 'https://arxiv.org/abs/' + id,
      title: tag(e, 'title'),
      authors: [...e.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)].map(a => unxml(a[1])),
      year: (tag(e, 'published').match(/^\d{4}/) || [''])[0],
      summary: tag(e, 'summary'),
      category: (e.match(/<arxiv:primary_category[^>]*term="([^"]+)"/) || [])[1] || '',
      doi: tag(e, 'arxiv:doi'), journal: tag(e, 'arxiv:journal_ref')
    });
  }
  return out;
}

const ascii = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '');
// A citation key such as vaswani2017attention that is not already taken.
function bibKey(p, taken = new Set()) {
  const last = ascii((p.authors[0] || 'anon').trim().split(/\s+/).pop()).toLowerCase() || 'anon';
  const word = ascii((p.title.split(/\s+/).find(w => w.length > 3 && !STOP.has(w.toLowerCase())) || 'paper')).toLowerCase();
  const base = last + (p.year || '') + word;
  let key = base;
  for (let n = 2; taken.has(key); n++) key = base + n;
  taken.add(key);
  return key;
}
const texEscape = s => String(s).replace(/([&%#_$])/g, '\\$1');
function toBibtex(p, key) {
  const f = [
    ['title', '{' + texEscape(p.title) + '}'],
    ['author', p.authors.map(texEscape).join(' and ')],
    ['year', p.year],
    p.journal ? ['journal', texEscape(p.journal)] : ['journal', 'arXiv preprint arXiv:' + p.id],
    ['eprint', p.id], ['archivePrefix', 'arXiv'],
    p.category && ['primaryClass', p.category],
    p.doi && ['doi', p.doi],
    ['url', p.url]
  ].filter(Boolean);
  return `@article{${key},\n${f.map(([k, v]) => `  ${k} = {${v}}`).join(',\n')}\n}`;
}

// Parse a search answer and give every paper a key (avoiding `taken`) and its BibTeX.
function arxivResults(xml, taken = []) {
  const used = new Set(taken);
  return parseArxiv(xml).map(p => { const key = bibKey(p, used); return { ...p, key, bibtex: toBibtex(p, key) }; });
}

module.exports = { arxivQuery, arxivUrl, parseArxiv, bibKey, toBibtex, arxivResults };
