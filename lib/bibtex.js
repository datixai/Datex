// Small BibTeX reader: enough for citation autocomplete and reference search.
'use strict';

function parseBib(text) {
  const entries = [];
  const src = String(text || '');
  const re = /@(\w+)\s*\{\s*([^,\s]+)\s*,/g;
  let m;
  while ((m = re.exec(src))) {
    const type = m[1].toLowerCase();
    if (type === 'comment' || type === 'string' || type === 'preamble') continue;
    // Find the matching closing brace of this entry.
    let depth = 1, i = re.lastIndex;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
    }
    const body = src.slice(re.lastIndex, i - 1);
    entries.push({ type, key: m[2], fields: parseFields(body), raw: src.slice(m.index, i) });
    re.lastIndex = i;
  }
  return entries;
}

function parseFields(body) {
  const fields = {};
  const re = /(\w+)\s*=\s*/g;
  let m;
  while ((m = re.exec(body))) {
    let i = re.lastIndex, val = '';
    if (body[i] === '{') {
      let depth = 0, start = i;
      for (; i < body.length; i++) {
        if (body[i] === '{') depth++;
        else if (body[i] === '}' && --depth === 0) break;
      }
      val = body.slice(start + 1, i); i++;
    } else if (body[i] === '"') {
      const end = body.indexOf('"', i + 1);
      val = body.slice(i + 1, end < 0 ? body.length : end); i = end + 1;
    } else {
      const end = body.slice(i).search(/[,\n]/);
      val = body.slice(i, end < 0 ? body.length : i + end); i = end < 0 ? body.length : i + end;
    }
    fields[m[1].toLowerCase()] = val.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
    re.lastIndex = i;
  }
  return fields;
}

function searchBib(entries, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return entries;
  return entries.filter(e => {
    const hay = [e.key, e.fields.title, e.fields.author, e.fields.year, e.fields.journal, e.fields.booktitle, e.fields.keywords].join(' ').toLowerCase();
    return words.every(w => hay.includes(w));
  });
}

module.exports = { parseBib, searchBib };
