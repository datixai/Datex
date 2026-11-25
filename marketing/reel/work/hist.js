(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));const S=window.__datex.S;const ed=monaco.editor.getEditors()[0];
ed.executeEdits('d',[{range:new monaco.Range(27,1,27,1),text:'We evaluate the method on three public datasets.\n'}]);await s(1500);
await window.datex.call('history:snapshot',S.root,'Added evaluation paragraph');
ed.executeEdits('d',[{range:new monaco.Range(31,1,31,1),text:'The results improve on the baseline in every case.\n'}]);await s(1500);
await window.datex.call('history:snapshot',S.root,'Submitted draft v1');
window.__datex.openPanel('history');await s(1500);return 'ok'})()
