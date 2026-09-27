// Character Studio 3D, started by boot3d.js once the sculpted characters have loaded.
window.__studioMain=function(){
const {T,V3,toon,withInk,shared,clamp,lerp}=Toon3D;const K=ToonKit;
const $=id=>document.getElementById(id);
// ---------- presets (same spec format as the Character room) ----------
const PRE={
  Kai:{shape:'classic',age:'teen',body:'masc',skin:'#BD7E55',face:{eyeColor:'#5A3A22',mouth:'smirk'},hair:{style:'messy',color:'#1D1A1A'},top:{kind:'hoodie',color:'#3FBF7F'},outer:{kind:'bomber',color:'#E4574C'},bottom:{kind:'jeans',color:'#2B3E6B'},shoes:{kind:'sneakers',color:'#F5F1E8'},acc:['capback']},
  Mira:{shape:'classic',age:'teen',body:'fem',skin:'#F9CDB1',face:{eyeColor:'#3F7FC1',mouth:'grin'},hair:{style:'ponytail',color:'#E07B2E'},top:{kind:'tee',color:'#F2D34F'},outer:{kind:'denim',color:'#4F86C6'},bottom:{kind:'jeans',color:'#3F7FC1'},shoes:{kind:'sneakers',color:'#1FA3A0'},acc:[]},
  Zed:{shape:'noodle',age:'teen',body:'masc',skin:'#9BD35A',face:{eyeColor:'#5A3A22',mouth:'open'},hair:{style:'short',color:'#3D6FE0'},top:{kind:'tee',color:'#F0685A'},outer:{kind:'varsity',color:'#6B5CE0'},bottom:{kind:'jeans',color:'#2B2D33'},shoes:{kind:'sneakers',color:'#F6A623'},acc:[]},
  Nora:{shape:'tall',age:'adult',body:'fem',skin:'#F9CDB1',face:{eyeColor:'#6E7A86',mouth:'smirk'},hair:{style:'bob',color:'#1D1A1A'},top:{kind:'tee',color:'#E4574C'},outer:{kind:'leather',color:'#2B2D33'},bottom:{kind:'jeans',color:'#2B2D33'},shoes:{kind:'boots',color:'#2B2D33'},acc:[]},
  Franky:{shape:'chunky',age:'adult',body:'masc',skin:'#F0685A',face:{eyeColor:'#5A3A22',mouth:'grin'},hair:{style:'curly',color:'#8A5CF6'},top:{kind:'tee',color:'#4B2A6B'},outer:{kind:'jacket',color:'#6B5CE0'},bottom:{kind:'jeans',color:'#B58CF0'},shoes:{kind:'boots',color:'#5B2E86'},acc:[]},
  Leo:{shape:'classic',age:'kid',body:'masc',skin:'#7A4630',face:{eyeColor:'#5A3A22',mouth:'grin'},hair:{style:'afro',color:'#1D1A1A'},top:{kind:'tee',color:'#F6A623'},outer:null,bottom:{kind:'shorts',color:'#3F7FC1'},shoes:{kind:'sneakers',color:'#E4574C'},acc:[]},
  Priya:{shape:'tall',age:'adult',body:'fem',skin:'#9C603E',face:{eyeColor:'#5A3A22',mouth:'smile'},hair:{style:'bun',color:'#1D1A1A'},top:{kind:'shirt',color:'#F5F1E8'},outer:{kind:'blazer',color:'#1F3A6B'},bottom:{kind:'trousers',color:'#1F3A6B'},shoes:{kind:'heels',color:'#E4405F'},acc:[]},
};
const CLOTH=['#F5F1E8','#2B2D33','#E4574C','#F6A623','#F2D34F','#3FBF7F','#1FA3A0','#3F7FC1','#6B5CE0','#E06FA6','#8A6E52','#7FB3E8'];
const SKIN=['#FFE3D1','#F9CDB1','#EDB48E','#D99A70','#BD7E55','#9C603E','#7A4630','#55321F','#9BD35A','#6FC2E8','#B58CF0','#F0685A'];
const HAIRC=['#1D1A1A','#3B2419','#6B3F22','#9C3D1E','#E07B2E','#F2C14E','#EDE3C7','#C4C4C4','#3D6FE0','#F07AA8'];
const HAIRS=['short','messy','sidepart','bowl','long','bob','ponytail','bun','curly','afro','bald'];
const TOPS=['tee','shirt','tank','longsleeve','sweater','hoodie'],BOTTOMS=['jeans','trousers','shorts','skirt'];
const clone=o=>JSON.parse(JSON.stringify(o));
/** A random character built only from parts the sculpted models can wear. */
function randomSpec(){const pick=a=>a[Math.floor(Math.random()*a.length)];const colours=n=>[...CLOTH].sort(()=>Math.random()-.5).slice(0,n);
  const body=pick(['masc','fem','neutral']),age=pick(['kid','teen','adult','adult']),[top,bottom,jacket,shoes]=colours(4);
  const hair=body==='fem'?pick(['long','bob','ponytail','bun','curly','afro']):body==='masc'?pick(['short','messy','sidepart','bowl','curly','afro',...(age==='adult'?['bald']:[])]):pick(HAIRS.filter(h=>h!=='bald'));
  return{shape:'classic',age,body,build:pick(['slim','average','average','heavy']),height:pick(['short','average','average','tall']),skin:Math.random()<.15?pick(SKIN.slice(8)):pick(SKIN.slice(0,8)),
    face:{eyeColor:pick(['#5A3A22','#3F7FC1','#6E7A86','#3FBF7F']),mouth:pick(['smile','grin','smirk','open'])},hair:{style:hair,color:pick(HAIRC.slice(0,age==='kid'?6:10))},
    top:{kind:pick(TOPS),color:top},outer:Math.random()<.45?{kind:pick(['jacket','bomber','denim','varsity','leather','blazer']),color:jacket}:null,
    bottom:{kind:pick(body==='fem'?BOTTOMS:BOTTOMS.filter(b=>b!=='skirt')),color:bottom},shoes:{kind:pick(['sneakers','sneakers','boots']),color:shoes},acc:[]};}
const C=window.BhippiChars;let saved=C.load();
let spec=saved[0]?C.to3D(saved[0]):clone(PRE.Kai),specName=saved[0]?saved[0].name:'Kai';delete spec.updatedAt;
function toast(msg,err){const t=$('toast');t.textContent=msg;t.classList.toggle('err',!!err);t.hidden=false;clearTimeout(toast.h);toast.h=setTimeout(()=>t.hidden=true,err?4000:2200);}
const esc=v=>String(v).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const findSaved=n=>saved.find(c=>c.name.toLowerCase()===String(n).trim().toLowerCase());
// ---------- example shots (written only with library names, exactly as an AI would) ----------
const EXAMPLES={
 'Grab gag':{duration:8.6,actors:[{id:'kai',preset:'Kai',at:[0,2.05]}],
  beats:[{t:.1,actor:'kai',do:'drop-in'},{t:2.0,actor:'kai',do:'wave',dur:1.3},{t:3.4,actor:'kai',do:'idle'},{t:3.7,actor:'kai',do:'look-at',params:{at:[.3,3.4,1.6]}},{t:4.0,actor:'kai',do:'surprised'},{t:4.5,actor:'kai',do:'dangle',blend:.1},{t:5.2,actor:'kai',do:'kick'}],
  camera:[{t:0,move:'set',params:{pos:[0,.36,3.45],look:[0,1.18,2.0],fov:84}},{t:1.05,move:'shake',params:{amp:.05}},{t:2.2,move:'move',dur:1.3,params:{pos:[.5,1.8,10.2],look:[0,1.9,1.8],fov:44}},{t:4.3,move:'move',dur:2,params:{pos:[.7,3.6,8.6],look:[0,3.75,1.8],fov:42}}],
  props:[{t:3.35,prop:'giant-hand',action:'enter',actor:'kai',dur:1},{t:4.35,prop:'giant-hand',action:'grab',actor:'kai',dur:.2},{t:4.6,prop:'giant-hand',action:'lift',dur:1.6,params:{dy:2.3}}],
  fx:[{t:.1,fx:'speed-lines',dur:.7,params:{dir:'down'}},{t:1.05,fx:'impact'},{t:1.05,fx:'dust',actor:'kai'},{t:3.95,fx:'exclaim',actor:'kai',dur:.9},{t:4.9,fx:'sweat',actor:'kai',dur:3.5}]},
 'Friends meet':{duration:8,actors:[{id:'mira',preset:'Mira',at:[-3.2,0],facing:90},{id:'kai',preset:'Kai',at:[1.2,0],facing:-30}],
  beats:[{t:0,actor:'mira',do:'walk',params:{to:[-.8,0]}},{t:0,actor:'kai',do:'idle'},{t:1.2,actor:'kai',do:'surprised'},{t:2.3,actor:'kai',do:'wave'},{t:2.1,actor:'mira',do:'turn-to',params:{at:[1.2,0]}},{t:2.8,actor:'mira',do:'talk',dur:1.6},{t:4.4,actor:'mira',do:'dance'},{t:4.5,actor:'kai',do:'dance',params:{bpm:120}},{t:6.8,actor:'kai',do:'cheer'},{t:6.8,actor:'mira',do:'jump'}],
  camera:[{t:0,move:'set',params:{pos:[-1,1.3,6.5],look:[-.8,1,0],fov:40}},{t:1.2,move:'push-in',dur:.4,params:{amount:.3,ease:'out'}},{t:2.4,move:'move',dur:1.4,params:{pos:[0,1.4,6.8],look:[.2,1,0],fov:38}},{t:4.4,move:'orbit',dur:3.4,params:{angle:-70}}],
  fx:[{t:1.25,fx:'exclaim',actor:'kai',dur:.8},{t:4.4,fx:'hearts',actor:'mira',dur:2.5}]},
 'Speedy exit':{duration:6,actors:[{id:'zed',preset:'Zed',at:[0,0]}],
  beats:[{t:0,actor:'zed',do:'idle'},{t:.6,actor:'zed',do:'look-at',params:{at:[3,1.4,1]}},{t:1.4,actor:'zed',do:'surprised'},{t:2.6,actor:'zed',do:'run',params:{to:[-9,1]}}],
  camera:[{t:0,move:'set',params:{pos:[0,1.3,5],look:'zed',fov:38}},{t:1.4,move:'dolly-zoom',dur:.9,params:{amount:.5}},{t:2.6,move:'follow',dur:2.4,params:{actor:'zed'}}],
  fx:[{t:1.45,fx:'exclaim',actor:'zed',dur:.8},{t:2.7,fx:'speed-lines',dur:2,params:{dir:'radial'}},{t:2.6,fx:'dust',actor:'zed'}]},
};
// ---------- renderer ----------
const stage=$('stage'),gl=$('gl'),fx=$('fx'),fxc=fx.getContext('2d');
const R=new T.WebGLRenderer({canvas:gl,antialias:true,alpha:true});R.setPixelRatio(Math.min(2,window.devicePixelRatio||1));
const scene=new T.Scene(),cam=new T.PerspectiveCamera(40,16/9,.03,200);R.toneMapping=T.ACESFilmicToneMapping;R.toneMappingExposure=1.05;
scene.add(new T.HemisphereLight(0xfff8f2,0x8a7f9a,1.35));{const k=new T.DirectionalLight(0xfff0e0,2.3);k.position.set(-2.5,4,3.5);scene.add(k);const r=new T.DirectionalLight(0xd8e4ff,1.4);r.position.set(3,2.5,-3.5);scene.add(r);}
function resize(){const w=stage.clientWidth,h=stage.clientHeight;R.setSize(w,h,false);fx.width=w*R.getPixelRatio();fx.height=h*R.getPixelRatio();cam.aspect=w/h;cam.updateProjectionMatrix();}
new ResizeObserver(resize).observe(stage);
const fc=document.createElement('canvas');fc.width=fc.height=512;const g2=fc.getContext('2d');g2.fillStyle='#E2D6EE';g2.fillRect(0,0,512,512);g2.strokeStyle='rgba(120,90,150,.22)';g2.lineWidth=2;
for(let i=0;i<=8;i++){g2.beginPath();g2.moveTo(i*64+Math.sin(i)*2,0);g2.lineTo(i*64-Math.sin(i*2)*2,512);g2.stroke();g2.beginPath();g2.moveTo(0,i*64);g2.lineTo(512,i*64+Math.cos(i)*2);g2.stroke();}
const ft=new T.CanvasTexture(fc);ft.wrapS=ft.wrapT=T.RepeatWrapping;ft.repeat.set(10,10);ft.offset.set(.05,.05);ft.colorSpace=T.SRGBColorSpace;
const floor=new T.Mesh(new T.PlaneGeometry(40,40),toon('#E2D6EE',{map:ft}));floor.rotation.x=-Math.PI/2;scene.add(floor);
const decor=[floor];function prop(geo,col,x,y,z,ry=0){const m=withInk(new T.Mesh(geo,toon(col)),1.3);m.position.set(x,y,z);m.rotation.y=ry;scene.add(m);decor.push(m);}
prop(new T.BoxGeometry(1,1,1),'#F2C94C',-3.2,.5,-3.5,.4);prop(new T.BoxGeometry(.7,.7,.7),'#F07AA8',-2.3,.35,-2.6,.9);prop(new T.CylinderGeometry(.45,.35,.9,20),'#3FBF7F',3.1,.45,-3);prop(new T.SphereGeometry(.55,20,14),'#6FC2E8',3.2,1.35,-3);
prop(new T.BoxGeometry(.5,2.4,.5),'#B58CF0',-4.6,1.2,-6);prop(new T.BoxGeometry(.5,1.6,.5),'#6B5CE0',4.8,.8,-6.5);
const D=new K.Director(scene,PRE);
// ---------- state ----------
let mode='char',playing=true,tNow=0,last=performance.now(),twos=true,lastDrawing=-1,shot=null,orbit={yaw:.35,pitch:.12,dist:4.4},look={x:0,y:0,on:false},moveSel='wave',fxBeats=[];
function charShot(){return{duration:1e9,actors:[{id:'a',spec,at:[0,0]}],beats:[{t:0,actor:'a',do:'idle'}]};}
function moveShot(){const p={walk:{to:[2.2,0]},run:{to:[4,0]},point:{at:[2,1.6,1]},'look-at':{at:[1.5,3,1]},'turn-to':{at:[2,0]}}[moveSel]||{};const M=K.MOVES[moveSel];
  const s={actors:[{id:'a',spec,at:moveSel==='walk'||moveSel==='run'?[-1.8,0]:[0,0]}],beats:[{t:0,actor:'a',do:moveSel,params:p}]};D.load(s);const d=D.actors.a.beats[0]._dur||2;s.duration=d+.8;return s;}
function loadShot(s){shot=s;D.load(s);fxBeats=s.fx||[];tNow=0;lastDrawing=-1;}
// ---------- side panels ----------
function segCtl(label,key,opts,cur,labels={}){return`<div class="row"><h3>${label}</h3><div class="seg">${opts.map(o=>`<button data-k="${key}" data-v="${o}" class="${cur===o?'on':''}">${labels[o]||o}</button>`).join('')}</div></div>`;}
function sw(label,key,cols,cur){return`<div class="row"><h3>${label}</h3><div class="sw">${cols.map(c=>`<button data-c="${key}" data-v="${c}" style="background:${c}" class="${cur===c?'on':''}" aria-label="${label} ${c}"></button>`).join('')}</div></div>`;}
function renderSide(){const S=$('side');
  if(mode==='char'){const card=(title,body)=>`<section class="card"><div class="card-title">${title}</div>${body}</section>`;
    const pick=(label,id,opts,cur)=>`<div class="row"><h3>${label}</h3><select id="${id}">${opts.map(o=>`<option ${cur===o?'selected':''}>${o}</option>`).join('')}</select></div>`;
    S.innerHTML=card('Library',`<div class="row"><h3>My characters</h3>${saved.length?`<div class="saved">${saved.map((c,i)=>`<button class="saved-item${c.name===specName?' on':''}" data-si="${i}"><span style="display:flex;align-items:center;gap:8px"><span class="dot" style="background:${esc(c.skin||'#ccc')}"></span>${esc(c.name)}</span><small>${esc(c.age||'')}</small></button>`).join('')}</div>`:'<div class="empty">Nothing saved yet. Name a character and press Save, or roll a Random one. Characters saved in 2D show here too.</div>'}</div>
      <div class="row"><h3>Start from</h3><div class="presets">${Object.keys(PRE).map(k=>`<button data-pre="${k}" class="${k===specName?'on':''}">${k}</button>`).join('')}</div></div>`)+
    card('Body',segCtl('Build','build',['slim','average','heavy'],spec.build||({noodle:'slim',chunky:'heavy'}[spec.shape])||'average',{slim:'Slim',average:'Average',heavy:'Heavy'})+segCtl('Height','height',['short','average','tall'],spec.height||'average',{short:'Short',average:'Average',tall:'Tall'})+segCtl('Age','age',['kid','teen','adult'],spec.age,{kid:'Kid',teen:'Teen',adult:'Adult'})+segCtl('Body','body',['masc','fem','neutral'],spec.body,{masc:'Masculine',fem:'Feminine',neutral:'Neutral'})+sw('Skin','skin',SKIN,spec.skin))+
    card('Hair',pick('Style','hair',HAIRS,spec.hair.style)+sw('Colour','hair',HAIRC,spec.hair.color))+
    card('Outfit',pick('Top','topKind',TOPS,spec.top.kind)+sw('Top colour','top',CLOTH,spec.top.color)+`<div class="row"><h3>Jacket</h3><div class="seg"><button id="jOn" class="${spec.outer?'on':''}">On</button><button id="jOff" class="${spec.outer?'':'on'}">Off</button></div></div>`+(spec.outer?sw('Jacket colour','outer',CLOTH,spec.outer.color):'')+
      pick('Bottoms','bottomKind',BOTTOMS,spec.bottom.kind)+sw('Bottoms colour','bottom',CLOTH,spec.bottom.color)+sw('Shoes','shoes',CLOTH,spec.shoes.color))+
    `<p class="note">A saved character works in both 2D and 3D. <b>Add to project</b> puts a transparent PNG of the current view into the project's media.</p>`;
    S.querySelectorAll('[data-si]').forEach(b=>b.onclick=()=>{const c=saved[+b.dataset.si];spec=C.to3D(c);delete spec.updatedAt;specName=c.name;$('name').value=c.name;syncHeader();rebuild();});
    S.querySelectorAll('[data-pre]').forEach(b=>b.onclick=()=>{specName=b.dataset.pre;spec=clone(PRE[specName]);$('name').value='';syncHeader();rebuild();});
    S.querySelectorAll('[data-k]').forEach(b=>b.onclick=()=>{spec[b.dataset.k]=b.dataset.v;rebuild();});
    S.querySelectorAll('[data-c]').forEach(b=>b.onclick=()=>{const k=b.dataset.c,v=b.dataset.v;if(k==='skin')spec.skin=v;else spec[k].color=v;rebuild();});
    S.querySelector('#hair').onchange=e=>{spec.hair.style=e.target.value;rebuild();};
    S.querySelector('#topKind').onchange=e=>{spec.top.kind=e.target.value;rebuild();};
    S.querySelector('#bottomKind').onchange=e=>{spec.bottom.kind=e.target.value;rebuild();};
    S.querySelector('#jOn').onclick=()=>{spec.outer={kind:'jacket',color:'#E4574C'};rebuild();};S.querySelector('#jOff').onclick=()=>{spec.outer=null;rebuild();};}
  if(mode==='moves'){S.innerHTML=`<div class="row"><h3>Move library · ${Object.keys(K.MOVES).length} moves</h3><div class="moves">${Object.entries(K.MOVES).map(([k,m])=>`<button class="mv ${k===moveSel?'on':''}" data-mv="${k}"><b>${k}</b><span>${m.doc}</span></button>`).join('')}</div></div>
    <div class="row"><h3>Camera moves</h3><div class="moves">${Object.entries(K.CAMERA).map(([k,m])=>`<div class="mv"><b>${k}</b><span>${m.doc}</span></div>`).join('')}</div></div>
    <div class="row"><h3>Props &amp; FX</h3><div class="moves">${[...Object.entries(K.PROPS),...Object.entries(K.FX)].map(([k,m])=>`<div class="mv"><b>${k}</b><span>${m.doc}</span></div>`).join('')}</div></div>`;
    S.querySelectorAll('[data-mv]').forEach(b=>b.onclick=()=>{moveSel=b.dataset.mv;loadShot(moveShot());renderSide();});}
  if(mode==='shots'){S.innerHTML=`<div class="row"><h3>Example shots</h3><select id="ex">${Object.keys(EXAMPLES).map(k=>`<option>${k}</option>`).join('')}</select></div>
    <div class="row"><h3>Shot script</h3><textarea id="src" spellcheck="false" aria-label="Shot script JSON"></textarea><div style="display:flex;gap:6px"><button class="btn primary" id="run">Run shot</button><button class="btn" id="copy">Copy</button></div><div class="errs" id="errs"></div></div>
    <details><summary>AI tools (what the model is given)</summary><pre id="tools"></pre></details><details><summary>Library catalogue (list_toon_library)</summary><pre id="cat"></pre></details>`;
    const src=S.querySelector('#src');const setEx=k=>{src.value=JSON.stringify(EXAMPLES[k],null,1);run();};
    const run=()=>{let s;try{s=JSON.parse(src.value);}catch(e){$('errs').innerHTML=`<div>JSON error: ${e.message}</div>`;return;}const errs=K.validate(s);
      $('errs').innerHTML=errs.length?errs.map(e=>`<div>${e.replace(/</g,'&lt;')}</div>`).join(''):`<span class="ok">Valid · ${s.actors.length} actor(s), ${(s.beats||[]).length} beats, ${(s.camera||[]).length} camera moves</span>`;if(!errs.length){loadShot(s);playing=true;$('play').textContent='Pause';}};
    S.querySelector('#ex').onchange=e=>setEx(e.target.value);S.querySelector('#run').onclick=run;
    S.querySelector('#copy').onclick=()=>{try{navigator.clipboard.writeText(src.value).catch(()=>src.select());}catch(e){src.select();}};
    S.querySelector('#tools').textContent=JSON.stringify(K.TOOLS,null,1);S.querySelector('#cat').textContent=JSON.stringify(K.catalog(),null,1);setEx(Object.keys(EXAMPLES)[0]);}
}
function icons(){try{window.lucide&&lucide.createIcons({attrs:{'stroke-width':1.8}});}catch(e){}}
function rebuild(){if(mode==='char')loadShot(charShot());else if(mode==='moves')loadShot(moveShot());renderSide();}
$('modes').querySelectorAll('button').forEach(b=>b.onclick=()=>{mode=b.dataset.m;$('modes').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));
  $('hint').textContent=mode==='char'?'Drag to orbit · move the pointer and they look at it':mode==='moves'?'Click a move to preview it · drag to orbit':'Scripts use only library names, which is what the AI writes';
  if(mode==='char')loadShot(charShot());if(mode==='moves')loadShot(moveShot());renderSide();});
$('name').value=saved[0]?saved[0].name:'';
// A brand-new character with a name nobody uses yet, so Save adds it rather than overwriting one.
$('rand').onclick=()=>{spec=randomSpec();specName=C.randomName([...saved.map(c=>c.name),...Object.keys(PRE),$('name').value]);$('name').value=specName;syncHeader();
  if(mode==='shots')document.querySelector('[data-m="char"]').click();else rebuild();
  const b=$('rand');b.classList.remove('rolling');void b.offsetWidth;b.classList.add('rolling');setTimeout(()=>b.classList.remove('rolling'),400);};
function syncHeader(){const ex=findSaved($('name').value);$('save').textContent=ex?'Update':'Save';$('del').disabled=!ex;}
$('name').addEventListener('input',syncHeader);syncHeader();
$('save').onclick=()=>{const n=$('name').value.trim();if(!n){toast('Give your character a name first',true);$('name').focus();return;}
  const prev=findSaved(n);spec.name=n;saved=C.upsert(prev?{...prev,...spec,outer:spec.outer||{kind:'none',color:'#2B2D33'},name:n}:{...spec,outer:spec.outer||{kind:'none',color:'#2B2D33'},name:n});specName=n;
  C.notify('saved',{name:n,mode:'3d'});toast(`Saved ${n}. It is in 2D too.`);syncHeader();if(mode==='char')renderSide();};
$('del').onclick=()=>{const ex=findSaved($('name').value);if(!ex||!confirm(`Delete "${ex.name}" from your characters?`))return;saved=C.remove(ex.name);toast(`Deleted ${ex.name}`);$('name').value='';syncHeader();if(mode==='char')renderSide();};
// A still of the current view with the floor and set pieces hidden, on a transparent background.
function snapshot(){const vis=decor.map(m=>m.visible);decor.forEach(m=>m.visible=false);R.setClearColor(0x000000,0);R.render(scene,cam);const png=gl.toDataURL('image/png');decor.forEach((m,i)=>m.visible=vis[i]);R.render(scene,cam);return png;}
$('use').onclick=async()=>{const n=$('name').value.trim()||specName||'Character';const b=$('use');b.disabled=true;
  try{await C.useInProject({name:n,spec:clone({...spec,name:n}),png:snapshot(),mode:'3d'});toast(`${n} added to the project`);}catch(e){toast(e.message||String(e),true);}finally{b.disabled=false;}};
C.onChange(list=>{saved=list;syncHeader();if(mode==='char')renderSide();});
// ---------- stage interaction ----------
let drag=null;stage.addEventListener('pointerdown',e=>{if(mode==='shots')return;drag={x:e.clientX,y:e.clientY,yaw:orbit.yaw,pitch:orbit.pitch};stage.setPointerCapture(e.pointerId);});
stage.addEventListener('pointermove',e=>{const r=stage.getBoundingClientRect();look.x=clamp((e.clientX-r.left)/r.width*2-1,-1,1);look.y=clamp((e.clientY-r.top)/r.height*2-1,-1,1);look.on=true;
  if(drag){orbit.yaw=drag.yaw-(e.clientX-drag.x)*.008;orbit.pitch=clamp(drag.pitch+(e.clientY-drag.y)*.004,-.1,.8);}});
stage.addEventListener('pointerup',()=>drag=null);stage.addEventListener('pointerleave',()=>{drag=null;look.on=false;});
stage.addEventListener('wheel',e=>{if(mode==='shots')return;e.preventDefault();orbit.dist=clamp(orbit.dist*(1+e.deltaY*.001),1.6,12);},{passive:false});
// ---------- 2D FX on twos ----------
function scr(v){const p=v.clone().project(cam);return[(p.x*.5+.5)*fx.width,(-p.y*.5+.5)*fx.height];}
function headOf(id){const A=D.actors[id]||Object.values(D.actors)[0];const v=V3();A.C.head.getWorldPosition(v);return v;}
function footOf(id){const A=D.actors[id]||Object.values(D.actors)[0];return A.C.root.position.clone();}
function drawFX(t,dw){const W=fx.width,H=fx.height,s=W/1280;fxc.clearRect(0,0,W,H);const rnd=i=>{const x=Math.sin(i*127.1+dw*311.7)*43758.5453;return x-Math.floor(x);};const ink='rgba(35,20,33,';
  for(const b of fxBeats){const d=b.dur||(b.fx==='impact'?.17:b.fx==='dust'?.65:1);const u=(t-b.t)/d;if(u<0||u>1)continue;const p=b.params||{};
    if(b.fx==='speed-lines'){const[cx,cy]=scr(headOf(b.actor));for(let i=0;i<24;i++){fxc.strokeStyle=ink+(.2+rnd(i+3)*.3)+')';fxc.lineWidth=(1.5+rnd(i+7)*3)*s;fxc.beginPath();
      if(p.dir==='radial'){const a=rnd(i)*Math.PI*2,r0=Math.max(W,H)*(.45+rnd(i+50)*.2),r1=r0*(.72+rnd(i+9)*.1);fxc.moveTo(cx+Math.cos(a)*r0,cy+Math.sin(a)*r0);fxc.lineTo(cx+Math.cos(a)*r1,cy+Math.sin(a)*r1);}
      else{const x=cx+(rnd(i)-.5)*W*.5,y0=rnd(i+30)*H*.7,L=H*(.12+rnd(i+9)*.22);fxc.moveTo(x,y0);fxc.lineTo(x,y0+L);}fxc.stroke();}}
    if(b.fx==='impact'){fxc.fillStyle=`rgba(255,255,255,${u<.5?.75:.35})`;fxc.fillRect(0,0,W,H);}
    if(b.fx==='dust'){const[x,y]=scr(footOf(b.actor));for(let i=0;i<7;i++){const a=Math.PI+(i/6)*Math.PI;const dd=(40+u*150)*s*(.7+rnd(i)*.5);const r=(24+rnd(i+2)*18)*s*(1-u*.6);fxc.beginPath();fxc.arc(x+Math.cos(a)*dd*1.3,y+Math.sin(a)*dd*.25-6*s,r,0,Math.PI*2);fxc.fillStyle=`rgba(250,244,255,${.95*(1-u)})`;fxc.fill();fxc.lineWidth=2.5*s;fxc.strokeStyle=ink+(1-u)+')';fxc.stroke();}}
    if(b.fx==='exclaim'){const[x,y]=scr(headOf(b.actor).add(V3(.18,.36,0)));const k=s*(1+Math.max(0,.25-u*d)*3);fxc.save();fxc.translate(x,y);fxc.rotate(.18);fxc.font=`800 ${Math.round(64*k)}px Fredoka, Inter, sans-serif`;fxc.textAlign='center';fxc.lineWidth=8*k;fxc.strokeStyle='#231421';fxc.strokeText('!',0,0);fxc.fillStyle='#FFD34D';fxc.fillText('!',0,0);fxc.restore();}
    if(b.fx==='sweat'){const[x,y]=scr(headOf(b.actor).add(V3(-.2,.12,.1)));[0,1].forEach(k=>{const dy=((t*1.6+k*.5)%1)*40*s;const px=x-k*22*s,py=y+dy;fxc.beginPath();fxc.moveTo(px,py-14*s);fxc.quadraticCurveTo(px+9*s,py,px,py+6*s);fxc.quadraticCurveTo(px-9*s,py,px,py-14*s);fxc.fillStyle='#8FD3FF';fxc.fill();fxc.lineWidth=2.4*s;fxc.strokeStyle='#231421';fxc.stroke();});}
    if(b.fx==='stars'){const[x,y]=scr(headOf(b.actor).add(V3(0,.3,0)));for(let i=0;i<4;i++){const a=t*4+i*Math.PI/2;const px=x+Math.cos(a)*50*s,py=y+Math.sin(a)*14*s;star(px,py,11*s);}}
    if(b.fx==='hearts'){const[x,y]=scr(headOf(b.actor).add(V3(0,.35,0)));for(let i=0;i<3;i++){const k=((t*.8+i/3)%1);heart(x+(i-1)*34*s+Math.sin(t*3+i)*8*s,y-k*90*s,(12+6*(1-k))*s,1-k);}}}}
function star(x,y,r){fxc.beginPath();for(let i=0;i<10;i++){const a=i*Math.PI/5-Math.PI/2,rr=i%2?r*.45:r;fxc.lineTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr);}fxc.closePath();fxc.fillStyle='#FFD34D';fxc.fill();fxc.lineWidth=2;fxc.strokeStyle='#231421';fxc.stroke();}
function heart(x,y,r,a){fxc.globalAlpha=a;fxc.beginPath();fxc.moveTo(x,y+r*.9);fxc.bezierCurveTo(x-r*1.6,y-r*.1,x-r*.8,y-r*1.3,x,y-r*.4);fxc.bezierCurveTo(x+r*.8,y-r*1.3,x+r*1.6,y-r*.1,x,y+r*.9);fxc.fillStyle='#F07AA8';fxc.fill();fxc.lineWidth=2;fxc.strokeStyle='#231421';fxc.stroke();fxc.globalAlpha=1;}
// ---------- loop ----------
function frame(now){const dt=Math.min(.05,(now-last)/1000);last=now;const dur=shot?shot.duration||8:8;if(playing){tNow+=dt;if(tNow>dur)tNow=mode==='char'?tNow:0;}
  const dw=Math.floor(tNow*12),tp=twos?dw/12:tNow;
  if(!twos||dw!==lastDrawing||mode==='char'){
    if(mode==='char'){const A=D.actors.a;D.override=look.on?{head:[look.x*.9,look.y*.45],look:[look.x,look.y]}:null;}else D.override=null;
    D.apply(tp);shared.seed.value=dw%97;lastDrawing=dw;drawFX(tp,dw);}
  if(mode==='shots'){const c=D.cameraAt(tNow);cam.position.copy(c.pos);cam.fov=c.fov;cam.updateProjectionMatrix();cam.lookAt(c.look);}
  else{const A=Object.values(D.actors)[0];const c=A?A.C.root.position.clone().setY(0):V3();const tgt=c.clone().add(V3(0,.95,0));cam.fov=34;cam.updateProjectionMatrix();
    cam.position.set(tgt.x+Math.sin(orbit.yaw)*Math.cos(orbit.pitch)*orbit.dist,tgt.y+Math.sin(orbit.pitch)*orbit.dist,tgt.z+Math.cos(orbit.yaw)*Math.cos(orbit.pitch)*orbit.dist);cam.lookAt(tgt);}
  R.render(scene,cam);
  $('scrub').value=Math.round(tNow/(mode==='char'?1e9:dur)*1000);$('time').textContent=mode==='char'?'live':`${tNow.toFixed(2)} / ${dur.toFixed(1)} s`;
  $('cap').textContent=mode==='char'?($('name').value.trim()||specName):mode==='moves'?moveSel:'Shot';$('sub').textContent=mode==='char'?`${spec.build||'average'} build · ${spec.age} · ${spec.hair.style} hair`:mode==='moves'?(K.MOVES[moveSel].doc):'';
  requestAnimationFrame(frame);}
$('play').onclick=()=>{playing=!playing;$('play').textContent=playing?'Pause':'Play';};
$('scrub').oninput=()=>{if(mode==='char')return;tNow=$('scrub').value/1000*(shot.duration||8);lastDrawing=-1;playing=false;$('play').textContent='Play';};
$('twos').onclick=()=>{twos=true;$('twos').classList.add('on');$('ones').classList.remove('on');};$('ones').onclick=()=>{twos=false;$('ones').classList.add('on');$('twos').classList.remove('on');};
loadShot(charShot());renderSide();icons();resize();requestAnimationFrame(frame);
window.__studio={mode:m=>{document.querySelector(`[data-m="${m}"]`).click();},seek:t=>{tNow=t;lastDrawing=-1;playing=false;},pick:mv=>{moveSel=mv;loadShot(moveShot());renderSide();},example:k=>{const sel=document.getElementById('ex');sel.value=k;sel.onchange({target:sel});}};
};
