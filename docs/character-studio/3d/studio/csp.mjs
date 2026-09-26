import { chromium } from 'playwright';
const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});const p=await b.newPage({viewport:{width:1300,height:800}});
p.on('pageerror',e=>console.log('ERR',e.message));p.on('console',m=>{if(!/GL Driver|GPU stall|swiftshader|GroupMarker/.test(m.text()))console.log(m.type(),m.text().slice(0,250));});
await p.goto('http://localhost:8765/'+process.argv[2]);await p.waitForTimeout(12000);
console.log('READY',await p.evaluate(()=>!!(window.Rig3D&&Rig3D.ready)),await p.evaluate(()=>document.getElementById('hint').textContent));
await p.screenshot({path:'csp.png'});await b.close();
