import { chromium } from 'playwright';
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});const p=await b.newPage({viewport:{width:+process.argv[4],height:+process.argv[5]}});
p.on('pageerror',e=>console.log('ERR',e.message));p.on('console',m=>console.log(m.type(),m.text().slice(0,300)));
await p.goto('http://localhost:8765/'+process.argv[2]);await p.waitForFunction(()=>window.done,null,{timeout:120000});await p.waitForTimeout(300);await p.screenshot({path:process.argv[3]});await b.close();
