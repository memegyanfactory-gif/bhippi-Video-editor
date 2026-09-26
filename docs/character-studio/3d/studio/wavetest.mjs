import { chromium } from 'playwright';
const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});const p=await b.newPage({viewport:{width:1800,height:700}});
p.on('pageerror',e=>console.log('ERR',e.message));p.on('console',m=>{if(/CAM/.test(m.text()))console.log(m.text());});
const shots=[];for(const t of process.argv.slice(3)){await p.goto('http://localhost:8765/rigtest.html?z=3.4&ly=1.35&m='+process.argv[2]+'&t='+t);await p.waitForFunction(()=>window.done,null,{timeout:120000});await p.screenshot({path:'wave_'+t+'.png'});}
await b.close();
