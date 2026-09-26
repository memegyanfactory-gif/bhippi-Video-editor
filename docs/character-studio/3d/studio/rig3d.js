// Rig3D: sculpted, skinned glTF characters (built in Blender) driven by the same pose object as Toon3D.
// Needs window.THREE plus window.__GLTF = {GLTFLoader, DRACOLoader, SkeletonUtils} (set by the page's module bootstrap).
(function(){
const T=THREE;const V3=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const FINGERS=['thumb','index','middle','ring','pinky'];
const R3={ready:false,templates:{},
  async load(urls,opt={}){
    const {GLTFLoader,DRACOLoader}=window.__GLTF;const L=new GLTFLoader();
    const dr=new DRACOLoader();dr.setDecoderPath(opt.draco||'./draco/');if(opt.dracoType)dr.setDecoderConfig({type:opt.dracoType});L.setDRACOLoader(dr);
    // .json = glTF with its binary embedded as base64: rebuild a GLB in memory so nothing fetches a data: URI (blocked by strict CSPs)
    const toGLB=js=>{const uri=js.buffers[0].uri;const b64=uri.slice(uri.indexOf(',')+1);const bin=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));delete js.buffers[0].uri;delete js.images;delete js.textures;delete js.samplers;(js.materials||[]).forEach(m=>{if(m.pbrMetallicRoughness)delete m.pbrMetallicRoughness.baseColorTexture;});
      const jb=new TextEncoder().encode(JSON.stringify(js));const jl=(jb.length+3)&~3,bl=(bin.length+3)&~3;const out=new Uint8Array(12+8+jl+8+bl);const dv=new DataView(out.buffer);
      dv.setUint32(0,0x46546C67,true);dv.setUint32(4,2,true);dv.setUint32(8,out.length,true);dv.setUint32(12,jl,true);dv.setUint32(16,0x4E4F534A,true);out.fill(0x20,20,20+jl);out.set(jb,20);
      dv.setUint32(20+jl,bl,true);dv.setUint32(24+jl,0x004E4942,true);out.set(bin,28+jl);return out.buffer;};
    const get=async u=>{if(/\.json$/.test(u)){const js=await (await fetch(u)).json();return await new Promise((res,rej)=>L.parse(toGLB(js),'',res,rej));}return await new Promise((res,rej)=>L.load(u,res,undefined,rej));};
    const keys=Object.keys(urls);const G=await Promise.all(keys.map(k=>get(urls[k])));
    keys.forEach((k,i)=>{this.templates[k]=analyse(G[i].scene);});
    this.ready=true;return this;},
  buildCharacter,poseCharacter,collarPoint};
// ---------- template analysis: rest pose in model space ----------
function bonesOf(root){const B={};root.traverse(o=>{if(o.isBone)B[o.name.replace(/\.\d+$/,'')]=o;});return B;}
function analyse(scene){
  scene.updateMatrixWorld(true);const B=bonesOf(scene);const rest={};
  for(const n in B){const b=B[n];rest[n]={q:b.getWorldQuaternion(new T.Quaternion()),p:b.getWorldPosition(V3()),lq:b.quaternion.clone(),lp:b.position.clone()};}
  const P=n=>rest[n].p;const dir=(a,b)=>P(b).clone().sub(P(a)).normalize();
  const R0={leg:(P('thighL').y+P('thighR').y)/2,sh:P('upperarmL').y,sw:Math.abs(P('upperarmL').x),hipX:Math.abs(P('thighL').x),
    upper:P('upperarmL').distanceTo(P('forearmL')),fore:P('forearmL').distanceTo(P('handL')),thigh:P('thighL').distanceTo(P('shinL')),shin:P('shinL').distanceTo(P('footL')),ankle:P('footL').y,
    neck:P('neck').clone(),head:P('head').clone()};
  const D={};
  for(const s of['L','R']){const sd=s==='L'?1:-1;
    D['upperarm'+s]={a:dir('upperarm'+s,'forearm'+s),pole:V3(0,0,-1)};D['forearm'+s]={a:dir('forearm'+s,'hand'+s),pole:V3(0,0,-1)};
    D['thigh'+s]={a:dir('thigh'+s,'shin'+s),pole:V3(0,0,1)};D['shin'+s]={a:dir('shin'+s,'foot'+s),pole:V3(0,0,1)};
    // finger curl axes (model space) and sign: curl rotates fingertips toward the palm (medial side in A-pose)
    const fdir=dir('middle1'+s,'middle2'+s);const palm=V3(-sd,0,0).addScaledVector(fdir,sd*fdir.x).normalize();
    const across=V3().crossVectors(fdir,palm).normalize();
    for(const f of FINGERS)for(let j=1;j<=3;j++){const n=f+j+s;if(!rest[n])continue;
      const ax=f==='thumb'?V3().crossVectors(dir('thumb1'+s,'thumb2'+s),palm).normalize():across.clone();
      D[n]={ax,axLocal:ax.clone().applyQuaternion(rest[n].q.clone().invert())};}}
  return{scene,rest,R0,D};}
// ---------- per-character instance ----------
function eyeTexture(col){const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d');
  g.fillStyle='#f2eee7';g.fillRect(0,0,256,256);const cx=128,cy=128;
  const gr=g.createRadialGradient(cx,cy,16,cx,cy,84);gr.addColorStop(0,shade(col,-.35));gr.addColorStop(.55,col);gr.addColorStop(.9,shade(col,.12));gr.addColorStop(1,shade(col,-.5));
  g.fillStyle=gr;g.beginPath();g.arc(cx,cy,84,0,Math.PI*2);g.fill();
  g.strokeStyle='rgba(255,255,255,.12)';g.lineWidth=2;for(let i=0;i<40;i++){const a=i/40*Math.PI*2;g.beginPath();g.moveTo(cx+Math.cos(a)*40,cy+Math.sin(a)*40);g.lineTo(cx+Math.cos(a)*78,cy+Math.sin(a)*78);g.stroke();}
  g.fillStyle='#0d0b10';g.beginPath();g.arc(cx,cy,36,0,Math.PI*2);g.fill();
  g.fillStyle='#fff';g.beginPath();g.arc(cx-24,cy-26,13,0,Math.PI*2);g.fill();
  const t=new T.CanvasTexture(c);t.flipY=false;t.colorSpace=T.SRGBColorSpace;return t;}
function shade(hex,k){const c=new T.Color(hex);const hsl={};c.getHSL(hsl);c.setHSL(hsl.h,hsl.s,clamp(hsl.l+k*.5,0,1));return '#'+c.getHexString();}
// body skin under worn garments is hidden per fragment (bit mask baked in Blender as the _gmask vertex attribute)
const GBITS=['tshirt','longsleeve','hoodie','jacket','jeans','shorts','skirt','sneakers'];
function maskMaterial(m,bits){m.userData.hide={value:bits};m.onBeforeCompile=sh=>{sh.uniforms.uHide=m.userData.hide;
  sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nattribute float _gmask;uniform int uHide;varying float vHide;').replace('#include <begin_vertex>','#include <begin_vertex>\nvHide=((int(_gmask+.5)&uHide)!=0)?1.:0.;');
  sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying float vHide;').replace('void main() {','void main() {\n\tif(vHide>.5)discard;');};
  m.customProgramCacheKey=()=>'gmask';return m;}
const TOPMAP={tee:'tshirt',shirt:'tshirt',tank:'tshirt',longsleeve:'longsleeve',sweater:'longsleeve',hoodie:'hoodie'};
const BTMMAP={jeans:'jeans',trousers:'jeans',cargo:'jeans',overalls:'jeans',shorts:'shorts',skirt:'skirt',dress:'skirt'};
function buildCharacter(spec){
  const key=spec.body==='fem'?'fem':'masc';const tp=R3.templates[key]||Object.values(R3.templates)[0];
  const model=window.__GLTF.SkeletonUtils.clone(tp.scene);
  const s=(spec.age==='kid'?.68:spec.age==='teen'?.93:1)*({tall:1.05,tiny:.85}[spec.shape]||1);
  const wide={chunky:1.18,noodle:.86}[spec.shape]||1;model.scale.set(s*wide,s,s*wide);
  const root=new T.Group(),body=new T.Group();root.add(body);body.add(model);
  const mats={};const mat=(o,col,rough=.55)=>{const m=new T.MeshStandardMaterial({color:new T.Color(col),roughness:rough,metalness:0});o.material=m;return m;};
  const want=new Set();const tk=spec.top&&spec.top.kind;if(TOPMAP[tk])want.add(TOPMAP[tk]);if(spec.outer)want.add('jacket');
  const bk=spec.bottom&&spec.bottom.kind;if(BTMMAP[bk])want.add(BTMMAP[bk]);if(spec.shoes&&spec.shoes.kind!=='barefoot')want.add('sneakers');
  const hairCol=(spec.hair&&spec.hair.color)||'#3B2419';
  const wkey=o=>{for(let p=o;p;p=p.parent)if(/^W_/.test(p.name))return p.name.replace(/^W_/,'').replace(/\d+$/,'').replace(/[._-]+$/,'');return null;};
  model.traverse(o=>{if(!o.isMesh)return;o.frustumCulled=false;o.castShadow=true;const n=wkey(o)?'W_'+wkey(o):o.name;
    if(/^GEO-body/.test(n)&&!/eye/.test(n)){const m=mat(o,spec.skin||'#E8B08A',.5);if(o.geometry.attributes._gmask){let bits=0;GBITS.forEach((g,i)=>{if(want.has(g)&&g!=='skirt')bits|=1<<i;});maskMaterial(m,bits);}}
    else if(/eye/.test(n)){o.material=new T.MeshStandardMaterial({map:eyeTexture((spec.face&&spec.face.eyeColor)||'#5A86B5'),roughness:.12});}
    else if(/^Hair|HairCap/.test(n)){mat(o,hairCol,.42);o.visible=!(spec.hair&&spec.hair.style==='bald');}
    else if(/^Brows/.test(n))mat(o,shade(hairCol,-.15),.5);
    else if(/^W_/.test(n)){const k=n.slice(2);o.visible=want.has(k);
      const col=k==='jacket'?spec.outer&&spec.outer.color:['tshirt','longsleeve','hoodie'].includes(k)?spec.top&&spec.top.color:k==='sneakers'?spec.shoes&&spec.shoes.color:spec.bottom&&spec.bottom.color;
      if(Array.isArray(o.material)){o.material=o.material.map((m,i)=>i===0?new T.MeshStandardMaterial({color:new T.Color(col||'#888'),roughness:.6}):new T.MeshStandardMaterial({color:new T.Color('#F4F1EA'),roughness:.6}));}
      else if(o.material&&/sole/i.test(o.material.name))mat(o,'#F4F1EA',.6);else mat(o,col||'#888',k==='jeans'?.8:.62);}
    else if(/^(Briefs|Top)/.test(n)){/* underwear keeps its own colours */const m=o.material;if(m){o.material=m.clone();}}
  });
  const B=bonesOf(model);const r0=tp.R0;
  // eyes: unskin into pivots on the head bone so they can look around
  model.updateMatrixWorld(true);const eyes=[];const eyeMeshes=[];model.traverse(o=>{if(o.isSkinnedMesh&&/eye/.test(o.name))eyeMeshes.push(o);});
  const headInv=new T.Matrix4().copy(B.head.matrixWorld).invert();
  for(const o of eyeMeshes){const g=o.geometry.clone();g.applyMatrix4(o.bindMatrix);g.applyMatrix4(o.matrixWorld);  // rest, world
    g.computeBoundingBox();const c=g.boundingBox.getCenter(V3());g.translate(-c.x,-c.y,-c.z);
    ['skinIndex','skinWeight'].forEach(a=>g.deleteAttribute(a));
    const m=new T.Mesh(g,o.material);const piv=new T.Object3D();piv.position.copy(c).applyMatrix4(headInv);
    // keep the eye's world orientation at rest: pivot rotation = inverse(head rest rotation)
    piv.quaternion.copy(B.head.getWorldQuaternion(new T.Quaternion()).invert());
    const aim=new T.Object3D();piv.add(aim);aim.add(m);B.head.add(piv);o.visible=false;eyes.push({piv,aim,mesh:m,side:c.x>0?1:-1});}
  const R={leg:r0.leg*s,torso:(r0.sh-r0.leg)*s+.05,sw:r0.sw*s*wide,hw:r0.hipX/.52*s*wide,upper:r0.upper*s,fore:r0.fore*s,thigh:r0.thigh*s,shin:r0.shin*s,hand:1.15*s,scale:s};
  const head=B.head;
  return{rig3d:true,root,body,model,bones:B,tp,R,spec,head,s,wide,eyes};
}
// ---------- posing ----------
const _q=new T.Quaternion(),_q2=new T.Quaternion(),_m=new T.Matrix4();
function frame(a,p){const x=a.clone().normalize();const y=p.clone().addScaledVector(x,-p.dot(x)).normalize();const z=V3().crossVectors(x,y);return new T.Matrix4().makeBasis(x,y,z);}
function rotBetweenFrames(a0,p0,a1,p1){const M=frame(a1,p1).multiply(frame(a0,p0).invert());return new T.Quaternion().setFromRotationMatrix(M);}
function setWorldQ(b,qw){b.parent.getWorldQuaternion(_q);b.quaternion.copy(_q.invert().multiply(qw));b.updateMatrixWorld(true);}
function ik(s,t,a,b,pole){const d=t.clone().sub(s);const dist=clamp(d.length(),Math.abs(a-b)+1e-4,a+b-1e-4);const dn=d.normalize();
  const pd=pole.clone().addScaledVector(dn,-pole.dot(dn)).normalize();const cosA=clamp((a*a+dist*dist-b*b)/(2*a*dist),-1,1),sinA=Math.sqrt(1-cosA*cosA);
  return{joint:s.clone().addScaledVector(dn,a*cosA).addScaledVector(pd,a*sinA),end:s.clone().addScaledVector(dn,dist),pd};}
function poseCharacter(C,P){
  const{bones:B,tp,s,wide}=C;const rest=tp.rest;const model=C.model;
  for(const n in B){const r=rest[n];if(!r)continue;B[n].quaternion.copy(r.lq);B[n].position.copy(r.lp);}
  model.updateMatrixWorld(true);
  const rootQ=model.getWorldQuaternion(new T.Quaternion());
  const toW=v=>C.body.localToWorld(v.clone());           // body space → world
  const dirW=v=>v.clone().applyQuaternion(rootQ);
  const restW=n=>rootQ.clone().multiply(rest[n].q);
  // pelvis height
  // pelvis height: move the hips bone in world units
  B.hips.position.copy(rest.hips.lp);{const w=B.hips.getWorldPosition(V3());w.y+=(P.pelvisH-(C.R.leg-.02))*C.body.getWorldScale(V3()).y;B.hips.parent.worldToLocal(w);B.hips.position.copy(w);}
  B.hips.updateMatrixWorld(true);
  const E=(x,y,z)=>new T.Quaternion().setFromEuler(new T.Euler(x,y,z,'YXZ'));
  const sp=P.spine||[0,0],hd=P.head||[0,0,0];
  const Dsp=E(sp[0]*.5,0,sp[1]*.5),Dch=E(sp[0],0,sp[1]);
  const inW=q=>rootQ.clone().multiply(q).multiply(rootQ.clone().invert());
  setWorldQ(B.spine,inW(Dsp).multiply(restW('spine')));setWorldQ(B.chest,inW(Dch).multiply(restW('chest')));
  const Dn=Dch.clone().multiply(E(hd[1]*.35,hd[0]*.35,(hd[2]||0)*.35)),Dh=Dch.clone().multiply(E(hd[1],hd[0],hd[2]||0));
  setWorldQ(B.neck,inW(Dn).multiply(restW('neck')));setWorldQ(B.head,inW(Dh).multiply(restW('head')));
  for(const k of['shoulderL','shoulderR'])setWorldQ(B[k],inW(Dch).multiply(restW(k)));
  // arms
  for(const k of['L','R']){const sd=k==='L'?1:-1;const up=B['upperarm'+k],fo=B['forearm'+k],ha=B['hand'+k];
    const sW=up.getWorldPosition(V3());const tW=toW(P.hands[k]);
    const a=up.getWorldPosition(V3()).distanceTo(fo.getWorldPosition(V3())),b=fo.getWorldPosition(V3()).distanceTo(ha.getWorldPosition(V3()));
    const pole=dirW(P.armPole&&P.armPole[k]?P.armPole[k]:V3(sd*.6,-.1,-.8));const S=ik(sW,tW,a,b,pole);
    const a1=S.joint.clone().sub(sW).normalize(),a2=S.end.clone().sub(S.joint).normalize();
    const Du=rotBetweenFrames(dirW(tp.D['upperarm'+k].a),dirW(tp.D['upperarm'+k].pole),a1,S.pd);
    setWorldQ(up,Du.clone().multiply(restW('upperarm'+k)));
    const Df=rotBetweenFrames(dirW(tp.D['forearm'+k].a),dirW(tp.D['forearm'+k].pole),a2,S.pd);
    // twist about the forearm (turns the palm): half on the forearm, all of it on the hand
    const tw=((P.handTwist&&P.handTwist[k])||0)*-sd,Tq=f=>new T.Quaternion().setFromAxisAngle(a2,tw*f);
    setWorldQ(fo,Tq(.5).multiply(Df).multiply(restW('forearm'+k)));
    setWorldQ(ha,Tq(1).multiply(Df).multiply(restW('hand'+k)));
    // fingers
    const hp=(P.handPose&&P.handPose[k])||[.35,.1,.2,0];const curl=hp[0],spread=hp[1]||0,thumb=hp[2]||0,pinch=hp[3]||0;
    FINGERS.forEach((f,fi)=>{for(let j=1;j<=3;j++){const n=f+j+k;const bn=B[n];if(!bn||!tp.D[n])continue;
      const pt=P.handPoint&&P.handPoint[k];let ang=f==='thumb'?(j===1?thumb*.3:(thumb*.7+curl*.25+pinch*.6)*(j===2?.9:1.1)):(fi===1?(pt?.05:Math.max(curl,pinch*.7)):curl)*(j===1?1.15:j===2?1.35:1.0);
      const q=new T.Quaternion().setFromAxisAngle(tp.D[n].axLocal,ang);bn.quaternion.copy(rest[n].lq).multiply(q);
      if(j===1&&f!=='thumb'&&spread){const sq=new T.Quaternion().setFromAxisAngle(V3(0,0,1),(fi-2.2)*spread*.12*sd);bn.quaternion.multiply(sq);}}});
    ha.updateMatrixWorld(true);}
  // legs
  const ls=P.legScale||1;
  for(const k of['L','R']){const th=B['thigh'+k],sh=B['shin'+k],ft=B['foot'+k];
    const hW=th.getWorldPosition(V3());const tgt=P.feet[k].clone();tgt.y+=(tp.R0.ankle-.07)*s;const tW=toW(tgt);
    const a=hW.distanceTo(sh.getWorldPosition(V3()))*ls,b=sh.getWorldPosition(V3()).distanceTo(ft.getWorldPosition(V3()))*ls;
    const pole=dirW(P.legPole&&P.legPole[k]?P.legPole[k]:V3(0,0,1));const S=ik(hW,tW,a,b,pole);
    const a1=S.joint.clone().sub(hW).normalize(),a2=S.end.clone().sub(S.joint).normalize();
    setWorldQ(th,rotBetweenFrames(dirW(tp.D['thigh'+k].a),dirW(tp.D['thigh'+k].pole),a1,S.pd).multiply(restW('thigh'+k)));
    if(ls!==1){th.scale.setScalar(1);sh.scale.setScalar(1);}
    setWorldQ(sh,rotBetweenFrames(dirW(tp.D['shin'+k].a),dirW(tp.D['shin'+k].pole),a2,S.pd).multiply(restW('shin'+k)));
    const fd=(P.footDir&&P.footDir[k])||V3(0,0,1);const yaw=Math.atan2(fd.x,fd.z);
    setWorldQ(ft,inW(new T.Quaternion().setFromAxisAngle(V3(0,1,0),yaw)).multiply(restW('foot'+k)));}
  const lk=P.look||[0,0];for(const e of C.eyes){e.aim.rotation.set(clamp(lk[1],-1,1)*.18,clamp(lk[0],-1,1)*.26,0);e.aim.scale.y=P.blink?.08:1;}
  model.updateMatrixWorld(true);
}
function collarPoint(C){const n=C.bones.neck.getWorldPosition(V3());const back=V3(0,-.03,-.075*C.s).applyQuaternion(C.root.getWorldQuaternion(new T.Quaternion()));return n.add(back);}
window.Rig3D=R3;
})();
