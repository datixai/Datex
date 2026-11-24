// Live co-editing in the window: share panel, join dialog, editor binding and remote cursors.
import { Session, Y, COLORS, deltaToEdits } from './collab.js';

let ctx = null;          // hooks and state from app.js
let session = null;      // active Session
let role = null;         // 'host' | 'guest'
let info = null;         // host address details
const bound = new Map(); // path -> { dispose }
let cursorDeco = null;
const pendingWrites = new Map();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function initLive(c) {
  ctx = c;
  const st = document.createElement('style');
  st.textContent = COLORS.map((col, i) => `.rc-caret-${i}{border-left:2px solid ${col};margin-left:-1px}.rc-sel-${i}{background:${col}33}.peer-dot.c${i}{background:${col}}`).join('\n');
  document.head.appendChild(st);
  ctx.editor.onDidChangeCursorSelection(() => sendCursor());
}
export const isActive = () => !!session;

function me() {
  const name = ctx.settings().userName && ctx.settings().userName !== 'Me' ? ctx.settings().userName : 'User ' + Math.floor(Math.random() * 90 + 10);
  return { name, color: Math.floor(Math.random() * COLORS.length) };
}

// ---------- host ----------
async function startHosting() {
  const { S, api } = ctx;
  await ctx.saveAll();
  const files = {};
  for (const p of ctx.allFiles().filter(f => ctx.TEXT_EXT.test(f))) {
    const f = S.files.get(p);
    files[p] = f ? f.model.getValue() : await api('fs:read', S.root, p);
  }
  info = await api('collab:host', S.root);
  session = new Session({ url: `ws://127.0.0.1:${info.port}/?code=${info.code}`, user: me(), onStatus: onStatus });
  session.seed(S.name, S.main, files, S.comments);
  await session.connect();
  role = 'host';
  attach();
  ctx.toast('Live session started');
}

// ---------- guest ----------
export async function joinDialog() {
  const c = ctx.modal(`<h2>Join a live session</h2>
    <p class="muted">Ask the host for the address and code shown in their Share panel. Both PCs must be on the same network.</p>
    <label>Host address</label><input id="jnHost" placeholder="192.168.1.20:7337" value="${esc(localStorage.getItem('datex.lastHost') || '')}">
    <label>Session code</label><input id="jnCode" placeholder="A1B2C3" style="text-transform:uppercase">
    <div id="jnMsg" class="muted small" style="margin-top:8px"></div>
    <div class="modal-actions"><button class="btn ghost" id="jnNo">Cancel</button><button class="btn primary" id="jnOk">Join</button></div>`);
  c.querySelector('#jnNo').onclick = ctx.closeModal;
  c.querySelector('#jnCode').focus();
  c.querySelector('#jnOk').onclick = async () => {
    const host = c.querySelector('#jnHost').value.trim(), code = c.querySelector('#jnCode').value.trim().toUpperCase();
    if (!host || !code) return;
    const addr = /:\d+$/.test(host) ? host : host + ':7337';
    c.querySelector('#jnMsg').textContent = 'Connecting...';
    try { await join(addr, code); localStorage.setItem('datex.lastHost', host); ctx.closeModal(); }
    catch (e) { c.querySelector('#jnMsg').textContent = e.message; if (session) { session.close(); session = null; } }
  };
}

async function join(addr, code) {
  if (session) await end();
  const { api } = ctx;
  let dir = null;
  const binaries = new Promise(res => {
    session = new Session({
      url: `ws://${addr}/?code=${encodeURIComponent(code)}`, user: me(), onStatus,
      onFiles: async (list) => { res(list); },
      onFile: async (m) => { if (dir) { await api('fs:writeBase64', dir, m.path, m.data); ctx.refreshTree(); } }
    });
  });
  await session.connect();
  await session.whenSynced();
  const name = session.meta.get('name') || 'Shared project';
  dir = await api('collab:guestDir', name);
  for (const [p, t] of session.files) await api('fs:write', dir, p, t.toString());
  session.requestBinaryFiles();
  const list = await Promise.race([binaries, new Promise(r => setTimeout(() => r([]), 20000))]);
  for (const f of list) await api('fs:writeBase64', dir, f.path, f.data);
  await api('project:config', dir, { main: session.meta.get('main') });
  role = 'guest'; info = { addr };
  await ctx.openProject(dir);
  attach();
  ctx.toast('Joined ' + name);
}

// ---------- shared wiring ----------
function attach() {
  const { S } = ctx;
  for (const [p, f] of S.files) bindModel(p, f);
  session.files.observeDeep(onRemoteFiles);
  session.meta.observe(ev => {
    if (ev.transaction.local || !ev.keysChanged.has('comments')) return;
    try { S.comments = JSON.parse(session.meta.get('comments') || '[]'); } catch { return; }
    ctx.api('comments:save', S.root, S.comments); ctx.applyCommentDecorations(); ctx.refreshPanel('comments');
  });
  session.awareness.on('change', () => { renderPeers(); renderCursors(); });
  sendCursor(); renderPeers(); ctx.refreshPanel('share');
}

function onStatus(state, reason) {
  if (state === 'closed' && session) {
    const was = role;
    cleanup();
    ctx.toast(was === 'guest' ? 'Live session ended: ' + (reason || 'connection lost') : 'Live session stopped', was === 'guest');
  }
}

export function bindModel(rel, f) {
  if (!session || bound.has(rel)) return;
  const yt = session.files.get(rel);
  if (!yt) return;
  const model = f.model;
  let applying = false;
  if (model.getValue() !== yt.toString()) { applying = true; model.setValue(yt.toString()); applying = false; }
  const sub = model.onDidChangeContent(e => {
    if (applying) return;
    session.doc.transact(() => {
      for (const ch of [...e.changes].sort((a, b) => b.rangeOffset - a.rangeOffset)) {
        if (ch.rangeLength) yt.delete(ch.rangeOffset, ch.rangeLength);
        if (ch.text) yt.insert(ch.rangeOffset, ch.text);
      }
    }, 'local');
  });
  const obs = (ev, tr) => {
    if (tr.origin === 'local') return;
    applying = true;
    try {
      for (const ed of deltaToEdits(ev.delta)) {
        const a = model.getPositionAt(ed.index), b = model.getPositionAt(ed.index + ed.deleteCount);
        model.applyEdits([{ range: new ctx.monaco.Range(a.lineNumber, a.column, b.lineNumber, b.column), text: ed.insert }]);
      }
    } finally { applying = false; }
    f.dirty = true; ctx.autosave(); renderCursors();
  };
  yt.observe(obs);
  bound.set(rel, { dispose: () => { sub.dispose(); try { yt.unobserve(obs); } catch {} } });
}

// Remote changes to files that are not open in an editor go straight to disk.
function onRemoteFiles(events, tr) {
  if (tr.origin === 'local' || !session) return;
  const { S, api } = ctx;
  for (const ev of events) {
    if (ev.target === session.files) {
      for (const [key, ch] of ev.changes.keys) {
        if (ch.action === 'add') { api('fs:write', S.root, key, session.files.get(key).toString()).then(() => ctx.refreshTree()); }
      }
    } else {
      const rel = ev.path[0];
      if (!S.files.has(rel)) scheduleWrite(rel);
    }
  }
}
function scheduleWrite(rel) {
  clearTimeout(pendingWrites.get(rel));
  pendingWrites.set(rel, setTimeout(() => {
    const t = session && session.files.get(rel);
    if (t) ctx.api('fs:write', ctx.S.root, rel, t.toString());
  }, 700));
}

// ---------- hooks called by app.js ----------
export function fileCreated(rel, text) {
  if (!session || session.files.has(rel)) return;
  session.doc.transact(() => { const t = new Y.Text(); t.insert(0, text || ''); session.files.set(rel, t); }, 'local');
  const f = ctx.S.files.get(rel); if (f) bindModel(rel, f);
}
export function fileDeleted(rel) {
  if (!session) return;
  bound.get(rel)?.dispose(); bound.delete(rel);
  session.doc.transact(() => session.files.delete(rel), 'local');
}
export function fileRenamed(oldRel, newRel, text) { fileDeleted(oldRel); fileCreated(newRel, text); }
export async function uploaded(rels) {
  if (!session) return;
  for (const r of rels) {
    if (ctx.TEXT_EXT.test(r)) fileCreated(r, await ctx.api('fs:read', ctx.S.root, r));
    else session.pushBinaryFile(r, await ctx.api('fs:readBase64', ctx.S.root, r));
  }
}
export function commentsChanged() { if (session) session.doc.transact(() => session.meta.set('comments', JSON.stringify(ctx.S.comments)), 'local'); }

// ---------- presence ----------
function sendCursor() {
  if (!session) return;
  const m = ctx.editor.getModel(), sel = ctx.editor.getSelection();
  if (!m || !sel || !ctx.S.active) return;
  session.awareness.setLocalStateField('cursor', { path: ctx.S.active, anchor: m.getOffsetAt(sel.getStartPosition()), head: m.getOffsetAt(sel.getEndPosition()) });
}
function renderCursors() {
  if (!ctx.editor) return;
  const m = ctx.editor.getModel(); const list = [];
  if (session && m) {
    for (const p of session.peers()) {
      if (p.self || !p.cursor || p.cursor.path !== ctx.S.active) continue;
      const a = m.getPositionAt(p.cursor.anchor), b = m.getPositionAt(p.cursor.head);
      const R = ctx.monaco.Range;
      if (p.cursor.anchor !== p.cursor.head) list.push({ range: new R(a.lineNumber, a.column, b.lineNumber, b.column), options: { className: 'rc-sel-' + p.color } });
      list.push({ range: new R(b.lineNumber, b.column, b.lineNumber, b.column), options: { beforeContentClassName: 'rc-caret-' + p.color, hoverMessage: { value: p.name }, stickiness: 1 } });
    }
  }
  if (cursorDeco) cursorDeco.clear();
  cursorDeco = ctx.editor.createDecorationsCollection(list);
}
function renderPeers() {
  const el = document.querySelector('#peerDots'); if (!el) return;
  const peers = session ? session.peers() : [];
  el.innerHTML = peers.length > 1 ? peers.map(p => `<span class="peer-dot c${p.color}" title="${esc(p.name)}${p.self ? ' (you)' : ''}">${esc(p.name.slice(0, 1).toUpperCase())}</span>`).join('') : '';
  if (ctx.S.panel === 'share') ctx.refreshPanel('share');
}
export function rebindActive() { renderCursors(); sendCursor(); }

// ---------- panel ----------
export function sharePanel(el) {
  if (!session) {
    el.innerHTML = `<p class="muted">Edit this project together with others on your office network, at the same time. Everyone sees each other's cursors and changes live, and each person compiles the PDF on their own PC.</p>
      <button class="btn primary" id="lvStart">Start live session</button>
      <button class="btn" id="lvJoin">Join someone else's session</button>
      <p class="muted small">The first time you start a session, Windows may ask to allow Datex on private networks. Allow it so others can connect.</p>`;
    el.querySelector('#lvStart').onclick = async () => { try { await startHosting(); } catch (e) { ctx.toast(e.message, true); } };
    el.querySelector('#lvJoin').onclick = joinDialog;
    return;
  }
  const peers = session.peers();
  el.innerHTML = (role === 'host'
    ? `<div class="card"><div class="muted small">Give these to the people joining</div>
        <div style="margin-top:6px">Address: ${info.addresses.map(a => `<b class="mono">${esc(a)}:${info.port}</b>`).join(' or ') || '<b>No network found</b>'}</div>
        <div>Code: <b class="mono" style="font-size:18px;letter-spacing:2px">${esc(info.code)}</b> <button class="btn sm" id="lvCopy">Copy</button></div></div>`
    : `<div class="card">Connected to <b class="mono">${esc(info.addr)}</b>. Your copy is saved in this project folder, so you keep it after the session.</div>`) +
    `<div class="sym-cat">In this session (${peers.length})</div>` +
    peers.map(p => `<div class="row"><span class="peer-dot c${p.color}">${esc(p.name.slice(0, 1).toUpperCase())}</span> ${esc(p.name)}${p.self ? ' <span class="muted">(you)</span>' : ''}${p.cursor ? ` <span class="muted small">${esc(p.cursor.path)}</span>` : ''}</div>`).join('') +
    `<button class="btn ${role === 'host' ? 'danger' : ''}" id="lvEnd">${role === 'host' ? 'Stop session for everyone' : 'Leave session'}</button>`;
  el.querySelector('#lvCopy')?.addEventListener('click', () => navigator.clipboard.writeText(`Datex live session\nAddress: ${info.addresses.map(a => a + ':' + info.port).join(' or ')}\nCode: ${info.code}`).then(() => ctx.toast('Copied')));
  el.querySelector('#lvEnd').onclick = () => end();
}

export async function end() {
  if (!session) return;
  const wasHost = role === 'host';
  cleanup();
  if (wasHost) await ctx.api('collab:stop');
}
function cleanup() {
  for (const b of bound.values()) b.dispose();
  bound.clear();
  const s = session; session = null; role = null;
  if (s) s.close();
  if (cursorDeco) cursorDeco.clear();
  renderPeers(); ctx.refreshPanel('share');
}
