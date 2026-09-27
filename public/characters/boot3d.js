// Loads the sculpted characters (Draco-compressed .glb), then starts the studio. Everything is
// served from the editor itself, so the 3D section works offline.
(async function(){
  const hint=document.getElementById('hint');
  try{
    await Rig3D.load({masc:'models/male.glb',fem:'models/female.glb',masc_slim:'models/male_slim.glb',fem_slim:'models/female_slim.glb',masc_heavy:'models/male_heavy.glb',fem_heavy:'models/female_heavy.glb'},{draco:'vendor/draco/',dracoType:'js'});
  }catch(e){
    console.error('Sculpted characters failed to load',e);
    const b=document.createElement('div');b.setAttribute('role','alert');
    b.style.cssText='position:fixed;left:50%;top:64px;transform:translateX(-50%);z-index:9;background:#3a1f1f;color:#ffd9d4;border:1px solid #8a3b33;border-radius:8px;padding:10px 14px;font:13px var(--font);max-width:min(560px,90vw)';
    b.textContent='The sculpted 3D characters did not load ('+(e&&e.message||e)+'). Showing the simpler toon builder instead.';document.body.appendChild(b);
  }
  window.__studioMain();
  if(hint)hint.textContent=window.Rig3D&&Rig3D.ready?'Drag to orbit · scroll to zoom':'Drag to orbit (toon builder: sculpted models could not load)';
})();
