// node montage.mjs out.png height img1 img2 ...  (row of images, same height)
import { chromium } from 'playwright';import fs from 'fs';import path from 'path';
const [out,h,...imgs]=process.argv.slice(2);const H=+h;
const html=`<body style="margin:0;background:#222;display:inline-flex;gap:4px">${imgs.map(f=>`<img style="height:${H}px" src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}">`).join('')}</body>`;
const b=await chromium.launch();const p=await b.newPage({viewport:{width:4000,height:H}});await p.setContent(html);
await p.waitForTimeout(200);const w=await p.evaluate(()=>[...document.images].reduce((s,i)=>s+i.getBoundingClientRect().width+4,0));await p.setViewportSize({width:Math.ceil(w),height:H});await p.screenshot({path:out});await b.close();
