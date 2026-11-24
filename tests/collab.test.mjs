// End-to-end test of a live session: relay + host + two guests editing the same file.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Session, deltaToEdits } from '../renderer/collab.js';

const require = createRequire(import.meta.url);
const { startRelay } = require('../lib/relay.js');
const wait = ms => new Promise(r => setTimeout(r, ms));

test('host and guests stay in sync', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'datex-collab-'));
  fs.writeFileSync(path.join(root, 'logo.png'), Buffer.from([137, 80, 78, 71]));
  const relay = await startRelay({ root, port: 47337 });
  const url = `ws://127.0.0.1:${relay.port}/?code=${relay.code}`;

  const host = new Session({ url, user: { name: 'Host', color: '#f00' } });
  host.seed('Paper', 'main.tex', { 'main.tex': 'Hello world' }, []);
  await host.connect();

  let gotFiles = null;
  const g1 = new Session({ url, user: { name: 'Guest 1', color: '#0f0' }, onFiles: f => { gotFiles = f; } });
  await g1.connect(); await g1.whenSynced();
  assert.equal(g1.meta.get('name'), 'Paper');
  assert.equal(g1.files.get('main.tex').toString(), 'Hello world');

  const g2 = new Session({ url, user: { name: 'Guest 2', color: '#00f' } });
  await g2.connect(); await g2.whenSynced();

  // Edits at the same time from three people merge the same way everywhere.
  host.files.get('main.tex').insert(0, 'A: ');
  g1.files.get('main.tex').insert(11, '!');
  g2.files.get('main.tex').insert(5, ',');
  await wait(400);
  const texts = [host, g1, g2].map(s => s.files.get('main.tex').toString());
  assert.equal(texts[0], texts[1]); assert.equal(texts[1], texts[2]);
  assert.match(texts[0], /^A: Hello, world!?/);

  // New file from a guest reaches the host.
  g1.doc.transact(() => { const t = new (g1.files.get('main.tex').constructor)(); t.insert(0, 'x'); g1.files.set('ch1.tex', t); });
  await wait(300);
  assert.equal(host.files.get('ch1.tex').toString(), 'x');

  // Presence: everyone sees three people.
  await wait(300);
  assert.equal(g2.peers().length, 3);

  // Binary files come from the relay.
  g1.requestBinaryFiles(); await wait(300);
  assert.equal(gotFiles.length, 1); assert.equal(gotFiles[0].path, 'logo.png');

  // Wrong code is refused.
  const bad = new Session({ url: `ws://127.0.0.1:${relay.port}/?code=WRONG`, user: { name: 'X' } });
  await bad.connect(); await assert.rejects(bad.whenSynced(800));

  for (const s of [host, g1, g2, bad]) s.close();
  await relay.close();
});

test('deltaToEdits converts Yjs deltas', () => {
  assert.deepEqual(deltaToEdits([{ retain: 2 }, { delete: 3 }, { insert: 'ab' }]), [{ index: 2, deleteCount: 3, insert: '' }, { index: 2, deleteCount: 0, insert: 'ab' }]);
});
