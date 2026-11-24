// Bundles Yjs and its sync/presence protocols into one ES module for the window.
'use strict';
const path = require('path');
require('esbuild').buildSync({
  stdin: {
    contents: "export * as Y from 'yjs'; export * as sync from 'y-protocols/sync'; export * as awareness from 'y-protocols/awareness'; export * as encoding from 'lib0/encoding'; export * as decoding from 'lib0/decoding';",
    resolveDir: path.join(__dirname, '..'), loader: 'js'
  },
  bundle: true, format: 'esm', minify: true, target: 'chrome120',
  outfile: path.join(__dirname, '..', 'renderer', 'vendor', 'yjs.js'),
  legalComments: 'inline'
});
console.log('renderer/vendor/yjs.js built');
