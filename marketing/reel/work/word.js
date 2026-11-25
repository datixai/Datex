(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));document.querySelector('#wordBtn').click();for(let i=0;i<60&&!document.querySelector('#wdOpen');i++)await s(500);return 'ok'})()
