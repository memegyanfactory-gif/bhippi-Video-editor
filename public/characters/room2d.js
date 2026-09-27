(function(){
const E=window.CharEngine, M=window.CharMotion, CAT=E.CAT;
const clone=o=>JSON.parse(JSON.stringify(o));
const KEY='bhippi.characters.v3';
const EXAMPLES=window.CharPresets.EXAMPLES;
const C=window.BhippiChars;const norm=c=>C.to2D(c,E.defaults());
let saved=C.load().map(norm);
let spec=clone(saved[0]||EXAMPLES[0]); let current=spec.name||'';
const reduceQuery=matchMedia('(prefers-reduced-motion: reduce)');
let tab='motion';
const playback={type:'idle',time:0,duration:M.duration('idle'),playing:!reduceQuery.matches,loop:true,speed:1,onion:false,transition:null};
const view={yaw:0,spin:false,follow:true,mx:0,my:0,hy:0,hp:0,look:null,drag:null,last:0,dirty:true,lastKey:'',lastPose:null,transportKey:''};
function motionSettings(){const value=spec.motion2d||{};return{timing:['smooth','film','drawn'].includes(value.timing)?value.timing:'smooth',energy:Number.isFinite(value.energy)?Math.max(.35,Math.min(1.6,value.energy)):1,secondary:Number.isFinite(value.secondary)?Math.max(0,Math.min(1.5,value.secondary)):1,ink:value.ink!==false};}
function changeMotion(key,value){spec.motion2d={...motionSettings(),[key]:value};playback.transition=null;view.dirty=true;syncTransport();}
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const LBL={kid:'Kid',teen:'Teen',adult:'Adult',senior:'Senior',masc:'Masculine',fem:'Feminine',neutral:'Neutral',slim:'Slim',average:'Average',round:'Round',pop:'Colour line',flat:'Flat',ink:'Ink line',human:'Human',skeleton:'Skeleton',classic:'Classic',noodle:'Noodle',chunky:'Chunky',tall:'Tall',tiny:'Tiny'};
function persist(){C.save(saved);}
function toast(msg,err){const t=$('toast');t.textContent=msg;t.classList.toggle('err',!!err);t.hidden=false;clearTimeout(toast.h);toast.h=setTimeout(()=>t.hidden=true,err?4000:2200);}
function cmdName(n){return n?(/\s/.test(n)?`/character "${n}"`:`/character ${n}`):'/character …';}

// ---------- header ----------
$('name').value=spec.name||'';
function syncHeader(){const n=$('name').value.trim();$('stageTitle').textContent=n||'New character';
  const ex=list().find(c=>c.name.toLowerCase()===n.toLowerCase());$('saveLabel').textContent=ex&&!ex.example?'Update':'Save';$('del').disabled=!(ex&&!ex.example);
  $('stageSub').textContent=`${LBL[spec.shape||'classic']} · ${LBL[spec.age]} · ${LBL[spec.body]} · ${spec.hair.style} hair · ${spec.top.kind==='none'?'base outfit':spec.top.kind}`;}
$('name').addEventListener('input',syncHeader);
$('save').onclick=()=>{const n=$('name').value.trim();if(!n){toast('Give your character a name first');$('name').focus();return;}
  spec.name=n;const i=saved.findIndex(c=>c.name.toLowerCase()===n.toLowerCase());if(i>=0)saved[i]=clone(spec);else saved.unshift(clone(spec));
  persist();current=n;renderSaved();syncHeader();C.notify('saved',{name:n,mode:'2d'});toast(`Saved ${n}. It is in 3D too.`);};
$('del').onclick=()=>{const n=$('name').value.trim();const i=saved.findIndex(c=>c.name.toLowerCase()===n.toLowerCase());if(i<0)return;
  if(!confirm(`Delete "${saved[i].name}" from your characters?`))return;saved.splice(i,1);persist();spec=clone(saved[0]||EXAMPLES[0]);current=spec.name||'';$('name').value=current;refreshAll();toast(`Deleted ${n}`);};
// A still of the character on a transparent background, for the project's media.
function snapshot(){return new Promise((resolve,reject)=>{const R=E.rigFor(spec),hg=R.H+250,W=hg*1.24,Hh=hg;
  const pose=samplePreview(playback.time,true);
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-W/2} ${-hg+46} ${W} ${Hh}" width="${Math.round(1400*W/Hh)}" height="1400">${drawPose(pose)}</svg>`;
  const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));const img=new Image();
  img.onload=()=>{try{const c=document.createElement('canvas');c.width=img.width;c.height=img.height;c.getContext('2d').drawImage(img,0,0);URL.revokeObjectURL(url);resolve(c.toDataURL('image/png'));}catch(e){reject(e);}};
  img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Could not draw the character.'));};img.src=url;});}
$('use').onclick=async()=>{const n=$('name').value.trim()||spec.name||'Character';const b=$('use');b.disabled=true;
  try{const png=await snapshot();await C.useInProject({name:n,spec:clone({...spec,name:n}),png,mode:'2d'});toast(`${n} added to the project`);}
  catch(e){toast(e.message||String(e),true);}finally{b.disabled=false;}};
C.onChange(list=>{saved=list.map(norm);renderSaved();syncHeader();});
$('new').onclick=()=>{spec=E.defaults();current='';$('name').value='';refreshAll();};

// ---------- saved rail ----------
function list(){const names=new Set(saved.map(c=>c.name.toLowerCase()));return[...saved,...EXAMPLES.filter(c=>!names.has(c.name.toLowerCase())).map(c=>({...c,example:1}))];}
function portrait(s,cls){const r=E.rigFor(s);const R=95*r.hs;return`<svg class="${cls}" viewBox="${Math.round(-R)} ${Math.round(r.headC[1]-R*.95)} ${Math.round(2*R)} ${Math.round(2*R)}">${E.render(s,{t:0,stance:'relaxed',fast:true})}</svg>`;}
function renderSaved(){$('saved').innerHTML=list().map((c,i)=>`<button class="saved-item${c.name===current?' on':''}" data-i="${i}">${portrait(c,'av')}<div><b>${esc(c.name)}</b><small>${LBL[c.age]}${c.example?'<span class="tag">Example</span>':''}</small></div></button>`).join('');
  $('saved').querySelectorAll('.saved-item').forEach(b=>b.onclick=()=>{const c=list()[+b.dataset.i];spec=clone(c);delete spec.example;delete spec.updatedAt;current=c.name;$('name').value=c.name;refreshAll();});}

// ---------- identity bar ----------
function segCtl(label,key,opts){return`<div class="ctl"><span>${label}</span><div class="seg">${opts.map(o=>`<button data-k="${key}" data-v="${o}" class="${spec[key]===o?'on':''}">${LBL[o]||o}</button>`).join('')}</div></div>`;}
function renderId(){
  $('idbar').innerHTML=segCtl('Type','species',CAT.species)+segCtl('Shape','shape',CAT.shape)+segCtl('Age','age',CAT.age)+segCtl('Body','body',CAT.body)+segCtl('Build','build',CAT.build)+
    `<div class="ctl"><span>Skin</span><div class="sw">${[...CAT.skin,...CAT.fantasy].map(c=>`<button data-skin="${c}" style="background:${c}" class="${spec.skin===c?'on':''}" aria-label="Skin ${c}"></button>`).join('')}</div></div>`+
    segCtl('Style','style',CAT.style)+`<button class="btn" id="rand"><i data-lucide="dices"></i>Surprise me</button>`;
  $('idbar').querySelectorAll('[data-k]').forEach(b=>b.onclick=()=>{spec[b.dataset.k]=b.dataset.v;refreshAll();});
  $('idbar').querySelectorAll('[data-skin]').forEach(b=>b.onclick=()=>{spec.skin=b.dataset.skin;refreshAll();});
  $('rand').onclick=()=>{const n=$('name').value;spec=E.randomSpec();spec.name=n;refreshAll();startAction('hop');};
}

// ---------- action bar ----------
const STANCES=[['relaxed','Relaxed'],['hip','Hand on hip'],['peace','Peace'],['pocket','Pockets'],['cross','Arms crossed'],['think','Thinking'],['shrug','Shrug'],['hold','Holding']];
function renderAct(){
  $('actbar').innerHTML=`<label for="stance" class="hint">Rest pose</label><select id="stance">${STANCES.map(([k,l])=>`<option value="${k}"${spec.stance===k?' selected':''}>${l}</option>`).join('')}</select><label class="turn" for="turn"><span class="hint">Turn</span><input type="range" id="turn" min="0" max="360" value="${((Math.round(view.yaw*180/Math.PI)%360)+360)%360}"></label><button class="chip${view.spin?' on':''}" id="spin" aria-pressed="${view.spin}" title="Rotate the preview"><i data-lucide="rotate-3d"></i>Spin</button><button class="chip${view.follow?' on':''}" id="follow" aria-pressed="${view.follow}"><i data-lucide="eye"></i>Follow cursor</button>`;
  $('stance').onchange=e=>{const previous=samplePreview(playback.time);spec.stance=e.target.value;playback.type='idle';playback.time=0;playback.duration=M.duration('idle');playback.transition=playback.playing&&!reduceQuery.matches?{from:previous,time:0}:null;view.dirty=true;if(tab==='motion')renderWard();syncTransport();};
  $('turn').oninput=e=>{view.yaw=(+e.target.value)*Math.PI/180;view.spin=false;view.dirty=true;$('spin').classList.remove('on');$('spin').setAttribute('aria-pressed','false');};
  $('spin').onclick=()=>{view.spin=!view.spin;renderAct();icons();view.dirty=true;};
  $('follow').onclick=()=>{view.follow=!view.follow;if(!view.follow){view.look=null;view.hy=0;view.hp=0;}renderAct();icons();view.dirty=true;};
}

// ---------- wardrobe ----------
const TABS=[['face','smile','Face'],['hair','scissors','Hair'],['top','shirt','Tops'],['bottom','layers','Bottoms'],['shoes','footprints','Shoes'],['acc','sparkles','Extras'],['motion','clapperboard','Motion']];
const MOVES=[['idle','wind','Idle','Breath & weight shift'],['wave','hand','Wave','Lift, greet & settle'],['hop','arrow-up','Hop','Anticipate & land'],['walk','footprints','Walk','Contact & passing'],['run','move-right','Run','Drive & follow-through'],['celebrate','party-popper','Celebrate','A full-body cheer'],['talk','message-circle','Talk','Expression & gestures'],['point','pointer','Point','Lead with the eyes'],['surprise','zap','Surprise','Anticipation & a take'],['nod','check','Nod','Head & hair overlap'],['shrug','move-horizontal','Shrug','Shoulders & palms'],['think','lightbulb','Think','Settle into a thought']];
function renderMotion(){const settings=motionSettings();return `<div class="motion-intro"><h2>Bring them to life.</h2><p>Preview an action, tune its character, then pause and inspect every drawing.</p></div>`+
  section('Performance','<span class="hint">Click to preview</span>',`<div class="move-grid">${MOVES.map(([id,ic,name,desc])=>`<button class="move-card${playback.type===id?' on':''}" data-move="${id}" aria-pressed="${playback.type===id}"><i data-lucide="${ic}"></i><span><strong>${name}</strong><small>${desc}</small></span></button>`).join('')}</div>`)+
  section('Motion feel','<span class="hint">Saved with character</span>',`<label class="motion-setting"><span>Drawing cadence</span><select id="cadence" class="motion-select"><option value="smooth"${settings.timing==='smooth'?' selected':''}>Smooth</option><option value="film"${settings.timing==='film'?' selected':''}>24 fps · fluid drawings</option><option value="drawn"${settings.timing==='drawn'?' selected':''}>12 fps · held drawings</option></select></label><label class="motion-setting"><span>Energy</span><input id="energy" type="range" min="0.35" max="1.6" step="0.05" value="${settings.energy}"><output id="energyValue">${Math.round(settings.energy*100)}%</output></label><label class="motion-setting"><span>Follow-through</span><input id="secondary" type="range" min="0" max="1.5" step="0.05" value="${settings.secondary}"><output id="secondaryValue">${Math.round(settings.secondary*100)}%</output></label><label class="motion-setting"><span>Contours</span><select id="ink" class="motion-select"><option value="drawn"${settings.ink?' selected':''}>Drawn</option><option value="clean"${settings.ink?'':' selected'}>Clean</option></select></label><p class="motion-help">Smooth timing keeps the arcs fluid. Held drawings change the rhythm. Follow-through adds a delayed response to the head and hair.</p>`)+
  section('Inspect the drawings','',`<label class="motion-setting"><span>Onion skin when paused</span><input id="onion" type="checkbox"${playback.onion?' checked':''}></label><p class="motion-help">Pause or drag the timeline. Use the arrow buttons to step through adjacent drawings; ghost poses reveal the movement arc. Space plays or pauses when focus is on the stage.</p><div class="motion-summary"><span id="performanceNote">Shared 2D motion engine</span><span>Preview speed only</span></div>`);}
function crop(kind,s){const r=E.rigFor(s);
  if(kind==='head'){const R=112*r.hs;return[-R,r.headC[1]-R*1.25,2*R,2*R];}
  if(kind==='top'){const y=r.neckY-50;const h=r.torso+130;return[-h/2,y,h,h];}
  if(kind==='bottom'){const y=r.hipY-40;const h=r.legLen+60;return[-h/2,y,h,h];}
  if(kind==='feet'){return[-120,-150,240,180];}
  return[-400,-760,800,800];}
function tile(label,s,kind,on,attrs){const vb=crop(kind,s).map(n=>Math.round(n)).join(' ');
  return`<button class="tile${on?' on':''}" ${attrs} title="${esc(label)}"><svg viewBox="${vb}" preserveAspectRatio="xMidYMid meet">${E.render(s,{t:0,stance:'relaxed',fast:true})}</svg><span>${esc(label)}</span></button>`;}
function variant(fn){const s=clone(spec);fn(s);return s;}
function swatches(key,colors,cur){return`<div class="sw">${colors.map(c=>`<button data-col="${key}" data-v="${c}" style="background:${c}" class="${cur===c?'on':''}" aria-label="${key} colour ${c}"></button>`).join('')}</div>`;}
function pats(key,cur){return`<div class="pats">${CAT.pattern.map(p=>`<button class="chip${cur===p?' on':''}" data-pat="${key}" data-v="${p}">${p}</button>`).join('')}</div>`;}
function section(title,right,body){return`<div class="sec"><div class="sec-head"><h3>${title}</h3>${right||''}</div>${body}</div>`;}
function renderWard(){
  $('tabs').innerHTML=TABS.map(([k,ic,l])=>`<button class="${tab===k?'on':''}" data-tab="${k}"><i data-lucide="${ic}"></i>${l}</button>`).join('');
  $('tabs').querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;renderWard();});
  let h='';
  if(tab==='motion')h=renderMotion();
  const faceGrid=(title,key,opts,kind='head')=>section(title,'',`<div class="tiles">${opts.map(o=>tile(o,variant(s=>{s.face[key]=o;if(key!=='facialHair')s.acc=s.acc.filter(a=>!['sunglasses'].includes(a));}),kind,spec.face[key]===o,`data-face="${key}" data-v="${o}"`)).join('')}</div>`);
  if(tab==='face'){h+=faceGrid('Face shape','shape',CAT.faceShape)+faceGrid('Ears','ears',CAT.ears)+faceGrid('Eyes','eyes',CAT.eyes)+section('Eye colour','',swatches('eyeColor',CAT.eyeColor,spec.face.eyeColor))+faceGrid('Eyebrows','brows',CAT.brows)+faceGrid('Nose','nose',CAT.nose)+faceGrid('Mouth','mouth',CAT.mouth)+faceGrid('Facial hair','facialHair',CAT.facialHair);}
  if(tab==='hair'){h+=section('Hair colour','',swatches('hair',CAT.hairColor,spec.hair.color))+section('Hairstyle','',`<div class="tiles">${CAT.hair.map(o=>tile(o,variant(s=>{s.hair.style=o;s.acc=s.acc.filter(a=>!['cap','beanie'].includes(a));}),'head',spec.hair.style===o,`data-hair="${o}"`)).join('')}</div>`);}
  if(tab==='top'){h+=section('Top','',`<div class="tiles">${CAT.top.map(o=>tile(o==='none'?'base':o,variant(s=>{s.top.kind=o;s.outer.kind='none';}),'top',spec.top.kind===o,`data-top="${o}"`)).join('')}</div>`)+
    section('Colour','',swatches('top',CAT.cloth,spec.top.color))+section('Pattern','',pats('top',spec.top.pattern))+
    section('Jacket','',`<div class="tiles">${CAT.outer.map(o=>tile(o,variant(s=>{s.outer.kind=o;}),'top',spec.outer.kind===o,`data-outer="${o}"`)).join('')}</div>`)+section('Jacket colour','',swatches('outer',CAT.cloth,spec.outer.color));}
  if(tab==='bottom'){h+=section('Bottoms','',`<div class="tiles">${CAT.bottom.map(o=>tile(o,variant(s=>{s.bottom.kind=o;if(s.top.kind==='dress')s.top.kind='tee';}),'bottom',spec.bottom.kind===o&&spec.top.kind!=='dress',`data-bottom="${o}"`)).join('')}</div>`)+
    section('Colour','',swatches('bottom',CAT.cloth,spec.bottom.color))+section('Pattern','',pats('bottom',spec.bottom.pattern))+(spec.top.kind==='dress'?`<p class="hint">A dress covers the bottoms. Pick a bottom to switch the dress to a tee.</p>`:'');}
  if(tab==='shoes'){h+=section('Shoes','',`<div class="tiles">${CAT.shoes.map(o=>tile(o,variant(s=>{s.shoes.kind=o;}),'feet',spec.shoes.kind===o,`data-shoes="${o}"`)).join('')}</div>`)+section('Colour','',swatches('shoes',CAT.cloth,spec.shoes.color));}
  if(tab==='acc'){const G={head:'Hats & headwear',hairacc:'Hair accessories',face:'Face',neck:'Neck',wrist:'Hands & wrists',body:'Bags',hand:'In hand'};
    const kindOf={head:'head',hairacc:'head',face:'head',neck:'top',wrist:'top',body:'top',hand:'top'};
    Object.entries(CAT.acc).forEach(([g,items])=>{h+=section(G[g],g==='hand'?'<span class="hint">shows with the Holding pose</span>':'',`<div class="tiles">${items.map(o=>tile(o,variant(s=>{if(!s.acc.includes(o)){if(g==='hand')s.acc=s.acc.filter(x=>!CAT.acc.hand.includes(x));if(g==='head')s.acc=s.acc.filter(x=>!CAT.acc.head.includes(x));s.acc.push(o);}if(g==='hand')s.stance='hold';}),kindOf[g],spec.acc.includes(o),`data-acc="${o}" data-g="${g}"`)).join('')}</div>`);});}
  $('ward').innerHTML=h;
  const W=$('ward');
  W.querySelectorAll('[data-move]').forEach(b=>b.onclick=()=>startAction(b.dataset.move));
  if(tab==='motion'){
    $('cadence').onchange=e=>changeMotion('timing',e.target.value);
    ['energy','secondary'].forEach(key=>{$(key).oninput=e=>{changeMotion(key,+e.target.value);$(key+'Value').textContent=Math.round(+e.target.value*100)+'%';};});
    $('ink').onchange=e=>changeMotion('ink',e.target.value==='drawn');
    $('onion').onchange=e=>{playback.onion=e.target.checked;view.dirty=true;};
  }
  W.querySelectorAll('[data-face]').forEach(b=>b.onclick=()=>{spec.face[b.dataset.face]=b.dataset.v;refreshAll();});
  W.querySelectorAll('[data-hair]').forEach(b=>b.onclick=()=>{spec.hair.style=b.dataset.hair;refreshAll();});
  W.querySelectorAll('[data-top]').forEach(b=>b.onclick=()=>{spec.top.kind=b.dataset.top;refreshAll();});
  W.querySelectorAll('[data-outer]').forEach(b=>b.onclick=()=>{spec.outer.kind=b.dataset.outer;refreshAll();});
  W.querySelectorAll('[data-bottom]').forEach(b=>b.onclick=()=>{spec.bottom.kind=b.dataset.bottom;if(spec.top.kind==='dress')spec.top.kind='tee';refreshAll();});
  W.querySelectorAll('[data-shoes]').forEach(b=>b.onclick=()=>{spec.shoes.kind=b.dataset.shoes;refreshAll();});
  W.querySelectorAll('[data-acc]').forEach(b=>b.onclick=()=>{const o=b.dataset.acc,g=b.dataset.g;const i=spec.acc.indexOf(o);
    if(i>=0)spec.acc.splice(i,1);else{if(g==='hand'){spec.acc=spec.acc.filter(x=>!CAT.acc.hand.includes(x));spec.stance='hold';}if(g==='head')spec.acc=spec.acc.filter(x=>!CAT.acc.head.includes(x));spec.acc.push(o);}refreshAll();});
  W.querySelectorAll('[data-col]').forEach(b=>b.onclick=()=>{const k=b.dataset.col,v=b.dataset.v;
    if(k==='eyeColor')spec.face.eyeColor=v;else if(k==='hair')spec.hair.color=v;else spec[k].color=v;refreshAll();});
  W.querySelectorAll('[data-pat]').forEach(b=>b.onclick=()=>{spec[b.dataset.pat].pattern=b.dataset.v;refreshAll();});
  icons();
}
function icons(){try{window.lucide&&lucide.createIcons({attrs:{'stroke-width':1.8}});}catch(e){}}
function refreshAll(){playback.transition=null;view.dirty=true;renderId();renderAct();renderWard();renderSaved();syncHeader();syncTransport();icons();}

// ---------- live stage ----------
const stageEl=$('stage');
stageEl.tabIndex=0;
stageEl.setAttribute('aria-label','Character stage. Drag to turn. Space to play or pause. Arrow keys step through drawings.');
stageEl.addEventListener('pointermove',e=>{const r=stageEl.getBoundingClientRect();view.mx=clamp((e.clientX-r.left)/r.width*2-1,-1,1);view.my=clamp((e.clientY-r.top)/r.height*2-1,-1,1);view.inside=true;
  if(view.drag!=null){view.yaw=view.dragYaw+(e.clientX-view.drag)*.012;view.spin=false;const t=$('turn');if(t)t.value=((Math.round(view.yaw*180/Math.PI)%360)+360)%360;$('spin').classList.remove('on');$('spin').setAttribute('aria-pressed','false');view.dirty=true;}});
stageEl.addEventListener('pointerleave',()=>{view.inside=false;});
stageEl.addEventListener('pointerdown',e=>{view.drag=e.clientX;view.dragYaw=view.yaw;stageEl.setPointerCapture(e.pointerId);});
stageEl.addEventListener('pointerup',()=>{view.drag=null;});stageEl.addEventListener('pointercancel',()=>{view.drag=null;view.inside=false;});stageEl.addEventListener('lostpointercapture',()=>{view.drag=null;});
function clamp(x,a,b){return Math.max(a,Math.min(b,x));}
function actionForPreview(){const a={do:playback.type,t:0,duration:playback.duration};
  if(['walk','run','sneak','leap'].includes(a.do))a.to=0;
  if(a.do==='point')a.to=[280,-E.rigFor(spec).H*.64];
  if(a.do==='talk')a.text='Hello there! Let us make something wonderful together.';
  return a;}
function samplePreview(t,camera=false){const settings=motionSettings();let a=M.sample(spec,{t,actions:[actionForPreview()],stance:spec.stance,motion:settings});
  if(playback.transition){const p=clamp(playback.transition.time/.24,0,1);a=M.blend(playback.transition.from,a,p*p*(3-2*p));}
  if(camera){a={...a,yaw:(a.yaw||0)+view.yaw,headYaw:(a.headYaw||0)+view.hy,headPitch:(a.headPitch||0)+view.hp};
    if(view.look)a.look=view.look.slice();}
  return{...a,hand:settings.ink,boil:0,rough:0};}
function drawPose(a){const root=a.root||{x:0,y:0};return`<g transform="translate(${root.x} ${root.y})">${E.render(spec,a)}</g>`;}
function startAction(type){const old=samplePreview(playback.time);const wasPlaying=playback.playing;playback.type=type;playback.time=0;playback.duration=M.duration(type);playback.playing=true;
  playback.transition=wasPlaying&&!reduceQuery.matches?{from:old,time:0}:null;view.dirty=true;
  $('ward').querySelectorAll('[data-move]').forEach(b=>{const on=b.dataset.move===type;b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));});syncTransport();}
function syncTransport(){
  const timing=motionSettings().timing;
  const transportKey=[playback.playing,playback.time.toFixed(2),playback.duration,playback.type,timing].join('|');
  if(view.transportKey===transportKey)return;view.transportKey=transportKey;
  $('play').setAttribute('aria-label',playback.playing?'Pause animation':'Play animation');
  const icon=playback.playing?'pause':'play';if($('play').dataset.icon!==icon){$('play').dataset.icon=icon;$('play').innerHTML=`<i data-lucide="${icon}"></i>`;icons();}
  $('scrub').max=String(playback.duration);$('scrub').value=String(playback.time);$('scrub').setAttribute('aria-valuetext',`${playback.time.toFixed(2)} seconds`);
  $('time').textContent=`${playback.time.toFixed(2)} / ${playback.duration.toFixed(2)} s`;
  const label={smooth:'Smooth',film:'24 fps',drawn:'12 fps'}[timing];const move=MOVES.find(m=>m[0]===playback.type)?.[2]||playback.type;
  $('motionBadge').textContent=`${label} · ${move}${playback.playing?'':' · Paused'}`;
}
function togglePlay(){playback.playing=!playback.playing;if(playback.playing&&playback.time>=playback.duration){playback.time=0;playback.transition=null;}view.dirty=true;syncTransport();}
function seek(t){playback.playing=false;playback.time=clamp(t,0,playback.duration);playback.transition=null;view.dirty=true;syncTransport();}
function drawingStep(){return 1/({smooth:60,film:24,drawn:12}[motionSettings().timing]);}
function stepDrawing(direction){seek(M.stepTime(playback.time,direction,motionSettings().timing));}
$('play').onclick=togglePlay;$('restart').onclick=()=>{playback.time=0;playback.transition=null;view.dirty=true;syncTransport();};
$('prevFrame').onclick=()=>stepDrawing(-1);$('nextFrame').onclick=()=>stepDrawing(1);
$('scrub').oninput=e=>seek(+e.target.value);$('speed').onchange=e=>{playback.speed=+e.target.value;};
$('loop').onclick=()=>{playback.loop=!playback.loop;$('loop').classList.toggle('on',playback.loop);$('loop').setAttribute('aria-pressed',String(playback.loop));};
stageEl.addEventListener('keydown',e=>{if(e.code==='Space'){e.preventDefault();togglePlay();}else if(e.code==='ArrowLeft'||e.code==='ArrowRight'){e.preventDefault();stepDrawing(e.code==='ArrowRight'?1:-1);}});
reduceQuery.addEventListener('change',()=>{if(reduceQuery.matches){playback.playing=false;view.spin=false;playback.transition=null;view.look=null;view.hy=0;view.hp=0;view.dirty=true;renderAct();syncTransport();}});
let request=0,renderCost=0,frames=0,embeddedVisible=true;
function frame(now){
  if(document.hidden||!embeddedVisible){view.last=0;request=0;return;}
  const dt=Math.min(.1,(now-(view.last||now))/1000);view.last=now;
  if(playback.playing){const previousTime=playback.time;playback.time+=dt*playback.speed;if(playback.time>=playback.duration){if(playback.loop){const from=samplePreview(previousTime);playback.time%=playback.duration;playback.transition=reduceQuery.matches?null:{from,time:0};}else{playback.time=playback.duration;playback.playing=false;}}
    if(playback.transition){playback.transition.time+=dt;if(playback.transition.time>=.24)playback.transition=null;}}
  if(view.spin&&!reduceQuery.matches){view.yaw+=dt*.7;$('turn').value=((Math.round(view.yaw*180/Math.PI)%360)+360)%360;}
  const following=view.follow&&view.inside&&!reduceQuery.matches&&playback.playing;
  const tgtY=following?view.mx*.7:0,tgtP=following?view.my*.22:0,follow=1-Math.exp(-dt*7);
  // Freeze the exact displayed pose during frame inspection; camera dragging still works.
  if(playback.playing){view.hy+=(tgtY-view.hy)*follow;view.hp+=(tgtP-view.hp)*follow;view.look=following?[view.mx,view.my]:null;}
  const t=M.sampleTime(playback.time,motionSettings().timing);
  const key=[t.toFixed(5),view.yaw.toFixed(4),view.hy.toFixed(4),view.hp.toFixed(4),following?view.mx.toFixed(3):0,following?view.my.toFixed(3):0,playback.transition?.time||0,playback.playing].join('|');
  if(view.dirty||key!==view.lastKey){const start=performance.now();const a=samplePreview(playback.time,true);let ghosts='';
    if(playback.onion&&!playback.playing){const step=drawingStep();for(const [offset,opacity]of[[-step,.14],[step,.1]]){const ghost=samplePreview(clamp(playback.time+offset,0,playback.duration),true);ghosts+=`<g opacity="${opacity}">${drawPose(ghost)}</g>`;}}
    $('stageSvg').innerHTML=`<ellipse cx="0" cy="10" rx="300" ry="37" fill="var(--floor)" opacity=".65"/>${ghosts}${drawPose(a)}`;
    const r=E.rigFor(spec),hg=r.H+250;$('stageSvg').setAttribute('viewBox',`${-hg*.46} ${-hg+46} ${hg*.92} ${hg}`);
    $('stageSvg').dataset.time=String(t);$('stageSvg').dataset.action=playback.type;view.lastPose=a;view.lastKey=key;view.dirty=false;
    renderCost+=(performance.now()-start-renderCost)*.08;frames++;
    if(frames%30===0&&$('performanceNote'))$('performanceNote').textContent=`Drawing ${renderCost.toFixed(1)} ms`;
  }
  syncTransport();request=requestAnimationFrame(frame);
}
function syncVisibility(){view.last=0;if(document.hidden||!embeddedVisible){cancelAnimationFrame(request);request=0;}else if(!request){view.dirty=true;request=requestAnimationFrame(frame);}}
document.addEventListener('visibilitychange',syncVisibility);
window.addEventListener('message',event=>{const data=event.data;if(event.source!==window.parent||!data||data.source!=='bhippi-characters-host'||data.type!=='2d-visibility')return;embeddedVisible=data.visible!==false;syncVisibility();});
refreshAll();request=requestAnimationFrame(frame);
})();
