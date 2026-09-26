import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';import fs from 'fs';
const jobs=JSON.parse(fs.readFileSync(process.argv[2]));
const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});const p=await b.newPage();
p.on('pageerror',e=>console.log('ERR',e.message));
await p.addInitScript(j=>{window.JOBS=j;},jobs);
await p.goto('http://localhost:8765/thumbs.html');await p.waitForFunction(()=>window.done,null,{timeout:600000});
const out=await p.evaluate(()=>window.OUT);fs.mkdirSync('thumbs',{recursive:true});
for(const [k,v] of Object.entries(out))fs.writeFileSync('thumbs/'+k+(v.startsWith('data:image/png')?'.png':'.jpg'),Buffer.from(v.split(',')[1],'base64'));
console.log(Object.keys(out).length);await b.close();
