(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));const ed=monaco.editor.getEditors()[0];ed.setSelection(new monaco.Range(16,1,16,200));
window.__datex.openPanel('ai');await s(1500);document.querySelector('.chip[data-a="1"]').click();
for(let i=0;i<150;i++){await s(1000);if([...document.querySelectorAll('.ai-msg button')].length)break;}await s(500);return 'ai done'})()
