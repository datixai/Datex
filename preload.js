// Safe bridge between the window and the main process.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = async (ch, ...a) => {
  const r = await ipcRenderer.invoke(ch, ...a);
  if (!r.ok) throw new Error(r.error);
  return r.data;
};
const on = (ch, fn) => { const h = (_e, d) => fn(d); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); };

contextBridge.exposeInMainWorld('datex', {
  call,
  onMenu: fn => on('menu', fn),
  onCompileOutput: fn => on('compile:output', fn),
  onAiChunk: fn => on('ai:chunk', fn),
  onAiDone: fn => on('ai:done', fn),
  onTexProgress: fn => on('tex:progress', fn),
  onUpdate: fn => on('update:status', fn)
});
