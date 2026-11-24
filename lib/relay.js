// Live session relay for Datex. The host runs it; every participant (the host included) connects
// with the session code. Binary messages (Yjs sync and presence) are passed on to everyone else.
// Text messages are small JSON requests answered by the relay itself.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const TEXT_EXT = /\.(tex|bib|sty|cls|bst|txt|md|csv|dat|lua|py|r|json|xml|ya?ml|cfg|def|ltx|dtx|ins|bbx|cbx|lbx)$/i;
const MAX_FILE = 25 * 1024 * 1024;

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

// Non-text project files (images, PDFs, fonts) that Yjs does not carry.
function binaryFiles(root) {
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(r);
      else if (!TEXT_EXT.test(e.name)) {
        const full = path.join(root, r);
        if (fs.statSync(full).size <= MAX_FILE) out.push({ path: r, data: fs.readFileSync(full).toString('base64') });
      }
    }
  };
  walk('');
  return out;
}

function startRelay({ root, port = 7337, code }) {
  code = code || crypto.randomBytes(3).toString('hex').toUpperCase();
  return new Promise((resolve, reject) => {
    const tryPort = (p, left) => {
      const wss = new WebSocketServer({ port: p, maxPayload: 200 * 1024 * 1024 });
      wss.once('error', (e) => { if (e.code === 'EADDRINUSE' && left > 0) tryPort(p + 1, left - 1); else reject(e); });
      wss.once('listening', () => {
        wss.on('connection', (ws, req) => {
          const q = new URL(req.url, 'http://x').searchParams;
          if (q.get('code') !== code) { ws.close(4001, 'Wrong session code'); return; }
          ws.on('message', (data, isBinary) => {
            if (isBinary) {
              for (const c of wss.clients) if (c !== ws && c.readyState === 1) c.send(data, { binary: true });
              return;
            }
            let msg; try { msg = JSON.parse(String(data)); } catch { return; }
            if (msg.t === 'files') {
              try { ws.send(JSON.stringify({ t: 'files', files: binaryFiles(root) })); } catch (e) { ws.send(JSON.stringify({ t: 'error', message: e.message })); }
            } else if (msg.t === 'file' && typeof msg.path === 'string' && typeof msg.data === 'string') {
              // A participant added an image or other binary file: pass it on.
              for (const c of wss.clients) if (c !== ws && c.readyState === 1) c.send(JSON.stringify(msg));
            }
          });
        });
        resolve({
          port: p, code, addresses: lanAddresses(),
          count: () => wss.clients.size,
          close: () => new Promise(r => { for (const c of wss.clients) c.close(4000, 'Session ended by host'); wss.close(() => r()); })
        });
      });
    };
    tryPort(port, 10);
  });
}

module.exports = { startRelay, binaryFiles, lanAddresses, TEXT_EXT };
