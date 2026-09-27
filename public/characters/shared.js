// Shared by the 2D room and the 3D studio inside Bhippi's Characters window (src/characters).
// Both pages are same-origin frames of the editor, so they share one character library in
// localStorage, read the editor's theme tokens straight from the parent document, and hand a
// finished character to the editor with postMessage.
(function(){
const KEY='bhippi.characters.v3';
const clone=o=>JSON.parse(JSON.stringify(o));
const host=window.parent!==window?window.parent:null;

// ---------- theme: copy the editor's tokens, and follow it when the user switches theme ----------
const TOKENS=['--app','--seam','--panel','--panel-2','--panel-3','--panel-4','--field','--line','--line-strong','--line-hi','--text','--text-dim','--text-faint',
  '--blue','--blue-hi','--blue-soft','--blue-line','--accent','--accent-grad','--accent-grad-hi','--on-accent','--green','--red','--radius','--font','--mono','--lift'];
function syncTheme(){
  if(!host)return;
  try{
    const root=host.document.documentElement,cs=host.getComputedStyle(root),me=document.documentElement;
    for(const t of TOKENS){const v=cs.getPropertyValue(t).trim();if(v)me.style.setProperty(t,v);}
    me.style.colorScheme=cs.colorScheme||'dark';
  }catch(e){/* opened on its own, outside the editor */}
}
syncTheme();
try{if(host)new host.MutationObserver(syncTheme).observe(host.document.documentElement,{attributes:true,attributeFilter:['data-theme','data-surface','style','class']});}catch(e){}

// ---------- the library ----------
function load(){try{const v=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(v)?v.filter(c=>c&&typeof c.name==='string'):[];}catch(e){return[];}}
function save(list){try{localStorage.setItem(KEY,JSON.stringify(list));}catch(e){}}
/** Adds or replaces a character by name (case-insensitive); newest first. */
function upsert(spec){const list=load();const i=list.findIndex(c=>c.name.toLowerCase()===spec.name.toLowerCase());const item={...clone(spec),updatedAt:new Date().toISOString()};
  if(i>=0)list.splice(i,1);list.unshift(item);save(list);return list;}
function remove(name){const list=load().filter(c=>c.name.toLowerCase()!==String(name).toLowerCase());save(list);return list;}
/** The other page saved or deleted a character. */
function onChange(cb){window.addEventListener('storage',e=>{if(e.key===KEY)cb(load());});}

// ---------- one spec, two engines ----------
const isObj=v=>v&&typeof v==='object'&&!Array.isArray(v);
function merge(base,over){const out=clone(base);for(const k of Object.keys(over||{})){const v=over[k];out[k]=isObj(v)&&isObj(out[k])?merge(out[k],v):clone(v);}return out;}
const H2N={short:.92,average:1,tall:1.08};
/** A spec the 2D room can draw: every field filled from its defaults. */
function to2D(spec,defaults){const s=merge(defaults,spec||{});
  if(!spec||!spec.outer)s.outer={kind:'none',color:(defaults.outer&&defaults.outer.color)||'#2B2D33'};
  if(s.build==='heavy')s.build='round';
  if(typeof s.height==='string')s.height=H2N[s.height]||1;
  return s;}
/** A spec the 3D studio can build: no "none" jacket, its own build and height names. */
function to3D(spec){const s=clone(spec||{});
  s.face=s.face||{};s.hair=s.hair||{style:'short',color:'#1D1A1A'};s.top=s.top||{kind:'tee',color:'#F5F1E8'};s.bottom=s.bottom||{kind:'jeans',color:'#3F7FC1'};s.shoes=s.shoes||{kind:'sneakers',color:'#F5F1E8'};s.acc=s.acc||[];
  if(s.outer&&(!s.outer.kind||s.outer.kind==='none'))s.outer=null;
  if(s.build==='round')s.build='heavy';
  if(typeof s.height==='number')s.height=s.height<.97?'short':s.height>1.03?'tall':'average';
  if(!['kid','teen','adult'].includes(s.age))s.age=s.age==='senior'?'adult':'adult';
  if(!['masc','fem','neutral'].includes(s.body))s.body='masc';
  return s;}

// ---------- the editor ----------
let seq=0;const waiting=new Map();
window.addEventListener('message',e=>{const d=e.data;if(!d||d.source!=='bhippi-characters-host')return;const w=waiting.get(d.id);if(!w)return;waiting.delete(d.id);d.ok?w.resolve(d):w.reject(new Error(d.error||'The editor could not add it.'));});
/** Sends a finished character (a PNG data URL plus its spec) to the editor's project. */
function useInProject(payload){
  if(!host)return Promise.reject(new Error('Open Characters from inside Bhippi to add it to a project.'));
  const id=++seq;
  return new Promise((resolve,reject)=>{waiting.set(id,{resolve,reject});host.postMessage({source:'bhippi-characters',type:'use',id,...payload},location.origin==='null'?'*':location.origin);
    setTimeout(()=>{if(waiting.has(id)){waiting.delete(id);reject(new Error('The editor did not answer.'));}},30000);});
}
/** Tells the editor a character was saved, so it can say so. */
function notify(type,data){if(host)try{host.postMessage({source:'bhippi-characters',type,...data},location.origin==='null'?'*':location.origin);}catch(e){}}

window.BhippiChars={KEY,load,save,upsert,remove,onChange,to2D,to3D,useInProject,notify,inEditor:!!host,clone};
})();
