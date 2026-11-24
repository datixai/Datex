// Live session core: a shared Yjs document synced through the host's relay.
// Works in the window and in Node (tests), so it has no editor code in it.
import { Y, sync, awareness as aw, encoding, decoding } from './vendor/yjs.js';

export { Y };
const MSG_SYNC = 0, MSG_AWARENESS = 1;
export const COLORS = ['#f97316', '#22c55e', '#a855f7', '#ec4899', '#14b8a6', '#eab308', '#ef4444', '#3b82f6'];

export class Session {
  constructor({ url, user, onStatus, onFile, onFiles }) {
    this.url = url; this.user = user;
    this.onStatus = onStatus || (() => {}); this.onFile = onFile || (() => {}); this.onFiles = onFiles || (() => {});
    this.doc = new Y.Doc();
    this.files = this.doc.getMap('files');
    this.meta = this.doc.getMap('meta');
    this.awareness = new aw.Awareness(this.doc);
    this.awareness.setLocalStateField('user', user);
    this.synced = false;
    this._syncWaiters = [];
    this.doc.on('update', (update, origin) => {
      if (origin === this) return;
      const e = encoding.createEncoder(); encoding.writeVarUint(e, MSG_SYNC); sync.writeUpdate(e, update); this._send(encoding.toUint8Array(e));
    });
    this.awareness.on('update', ({ added, updated, removed }, origin) => {
      if (origin === 'remote') return;
      this._sendAwareness([...added, ...updated, ...removed]);
    });
  }

  // Host only: put the project's text files into the shared document before anyone joins.
  seed(name, main, files, comments) {
    this.doc.transact(() => {
      for (const [p, text] of Object.entries(files)) { const t = new Y.Text(); t.insert(0, text); this.files.set(p, t); }
      this.meta.set('name', name); this.meta.set('main', main); this.meta.set('comments', JSON.stringify(comments || []));
    });
    this.synced = true;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = this.ws = new WebSocket(this.url);
      ws.binaryType = 'arraybuffer';
      let opened = false;
      ws.onopen = () => {
        opened = true; this.onStatus('connected');
        const e = encoding.createEncoder(); encoding.writeVarUint(e, MSG_SYNC); sync.writeSyncStep1(e, this.doc); this._send(encoding.toUint8Array(e));
        this._sendAwareness([this.doc.clientID]);
        resolve();
      };
      ws.onerror = () => { if (!opened) reject(new Error('Could not reach the session. Check the address and that both PCs are on the same network.')); };
      ws.onclose = (ev) => { const why = ev.reason || (ev.code === 4001 ? 'Wrong session code' : 'Connection closed'); this._syncWaiters.splice(0).forEach(w => w.rej(new Error(why))); this.onStatus('closed', ev.reason || (ev.code === 4001 ? 'Wrong session code' : 'Connection closed')); if (!opened) reject(new Error(ev.reason || 'Connection refused')); };
      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          let m; try { m = JSON.parse(ev.data); } catch { return; }
          if (m.t === 'files') this.onFiles(m.files);
          else if (m.t === 'file') this.onFile(m);
          return;
        }
        const d = decoding.createDecoder(new Uint8Array(ev.data));
        const type = decoding.readVarUint(d);
        if (type === MSG_SYNC) {
          const e = encoding.createEncoder(); encoding.writeVarUint(e, MSG_SYNC);
          const kind = sync.readSyncMessage(d, e, this.doc, this);
          if (encoding.length(e) > 1) this._send(encoding.toUint8Array(e));
          if (kind === sync.messageYjsSyncStep1) this._sendAwareness([this.doc.clientID]); // a new peer arrived: tell it who we are
          if (kind === sync.messageYjsSyncStep2 && !this.synced) { this.synced = true; this._syncWaiters.splice(0).forEach(w => w.res()); }
        } else if (type === MSG_AWARENESS) {
          aw.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(d), 'remote');
        }
      };
    });
  }

  whenSynced(timeoutMs = 15000) {
    if (this.synced) return Promise.resolve();
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('The host did not answer. Make sure the session is still running.')), timeoutMs);
      this._syncWaiters.push({ res: () => { clearTimeout(t); res(); }, rej: (e) => { clearTimeout(t); rej(e); } });
    });
  }

  requestBinaryFiles() { this._sendText({ t: 'files' }); }
  pushBinaryFile(path, base64) { this._sendText({ t: 'file', path, data: base64 }); }

  peers() {
    const out = [];
    this.awareness.getStates().forEach((s, id) => { if (s.user) out.push({ id, self: id === this.doc.clientID, ...s.user, cursor: s.cursor || null }); });
    return out;
  }

  close() {
    try { aw.removeAwarenessStates(this.awareness, [this.doc.clientID], 'local'); } catch {}
    try { this.ws && this.ws.close(); } catch {}
    this.doc.destroy();
  }

  _sendAwareness(ids) {
    const e = encoding.createEncoder(); encoding.writeVarUint(e, MSG_AWARENESS);
    encoding.writeVarUint8Array(e, aw.encodeAwarenessUpdate(this.awareness, ids));
    this._send(encoding.toUint8Array(e));
  }
  _send(buf) { if (this.ws && this.ws.readyState === 1) this.ws.send(buf); }
  _sendText(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }
}

// Turn a Yjs text delta into plain edits: [{ index, deleteCount, insert }], applied in order.
export function deltaToEdits(delta) {
  const edits = []; let index = 0;
  for (const op of delta) {
    if (op.retain) index += op.retain;
    else if (op.delete) edits.push({ index, deleteCount: op.delete, insert: '' });
    else if (typeof op.insert === 'string') { edits.push({ index, deleteCount: 0, insert: op.insert }); index += op.insert.length; }
  }
  return edits;
}
