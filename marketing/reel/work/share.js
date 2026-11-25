(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));window.__datex.openPanel('share');await s(500);document.querySelector('#lvStart').click();await s(2500);
const c=document.querySelector('.card div:nth-child(2)');if(c)c.innerHTML='Address: <b class="mono">192.168.1.20:7337</b>';return 'ok'})()
