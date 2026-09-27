// Toon3D: 3D characters that read as hand-drawn animation.
// Real meshes + perspective camera (so things can rush the lens, get grabbed, swing), rendered with
// stepped toon lighting and inverted-hull ink lines whose weight follows the light and boils per drawing.
// Characters are built from the same CharacterSpec the Character room edits.
(function(){
const T=THREE, V3=(x,y,z)=>new T.Vector3(x,y,z), TAU=Math.PI*2;
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x)), lerp=(a,b,t)=>a+(b-a)*t;
function hex(c){return new T.Color(c);}
function mixc(a,b,k){return hex(a).lerp(hex(b),k);}
const INKC='#231421';

// ---------------- materials ----------------
const LIGHT=V3(-.55,.72,.42).normalize();
const shared={seed:{value:0},light:{value:LIGHT}};
function toon(color,opt={}){
  const base=hex(color),sh=opt.shade?hex(opt.shade):base.clone().lerp(hex('#3a1f4a'),.34);
  return new T.ShaderMaterial({
    uniforms:{uBase:{value:base},uShade:{value:sh},uLight:shared.light,uMap:{value:opt.map||null},uHasMap:{value:opt.map?1:0},uGloss:{value:opt.gloss||0},uSeed:shared.seed},
    vertexShader:`varying vec3 vN;varying vec2 vUv;varying vec3 vW;void main(){vUv=uv;vN=normalize(mat3(modelMatrix)*normal);vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
    fragmentShader:`uniform vec3 uBase;uniform vec3 uShade;uniform vec3 uLight;uniform sampler2D uMap;uniform float uHasMap;uniform float uGloss;uniform float uSeed;varying vec3 vN;varying vec2 vUv;varying vec3 vW;
      float h(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719))+uSeed*1.37)*43758.5453);}
      void main(){vec3 n=normalize(vN);if(!gl_FrontFacing)n=-n;float d=dot(n,uLight);
        float edge=.06+(h(floor(vW*40.))-.5)*.05; float lit=smoothstep(edge-.015,edge+.015,d);
        vec3 b=uBase,s=uShade;if(uHasMap>.5){vec4 t=texture2D(uMap,vUv);b=t.rgb;s=mix(t.rgb,vec3(.23,.12,.29),.34);}
        vec3 c=mix(s,b,lit);
        if(uGloss>0.){float g=smoothstep(.78,.8,d)*uGloss;c=mix(c,vec3(1.),g*.35);}
        if(!gl_FrontFacing)c=s*.85;
        gl_FragColor=vec4(c,1.);
        #include <colorspace_fragment>
      }`,
    side:opt.double?T.DoubleSide:T.FrontSide});
}
function inkMat(width,color){
  return new T.ShaderMaterial({uniforms:{uW:{value:width},uC:{value:hex(color||INKC)},uSeed:shared.seed,uBoil:{value:1}},
    vertexShader:`uniform float uW;uniform float uSeed;uniform float uBoil;
      float h(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719))+uSeed*1.37)*43758.5453);}
      float n3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);float a=h(i),b=h(i+vec3(1,0,0)),c=h(i+vec3(0,1,0)),d=h(i+vec3(1,1,0));float e=h(i+vec3(0,0,1)),g=h(i+vec3(1,0,1)),k=h(i+vec3(0,1,1)),l=h(i+vec3(1,1,1));
        return mix(mix(mix(a,b,f.x),mix(c,d,f.x),f.y),mix(mix(e,g,f.x),mix(k,l,f.x),f.y),f.z);}
      void main(){vec4 mv=modelViewMatrix*vec4(position,1.);vec3 n=normalize(normalMatrix*normal);
        vec3 wn=normalize(mat3(modelMatrix)*normal);float sh=clamp(dot(n.xy,normalize(vec2(.45,-.9))),-1.,1.);
        float w=uW*(.35+1.25*pow(max(0.,sh+.15)/1.15,.9)+ (n3(position*9.)-.5)*.7*uBoil + (n3(position*2.3+uSeed)-.5)*.35);
        w=max(w,uW*.05);mv.xyz+=n*w*(-mv.z)*.0062;gl_Position=projectionMatrix*mv;}`,
    fragmentShader:`uniform vec3 uC;void main(){gl_FragColor=vec4(uC,1.);
#include <colorspace_fragment>
}`,side:T.BackSide});
}
function withInk(mesh,width=1,color){const o=new T.Mesh(mesh.geometry,inkMat(width,color));o.renderOrder=-1;mesh.add(o);return mesh;}

// ---------------- geometry builders ----------------
// lathe of elliptical rings: slices [{y,a,b,z0,x0}], optional angular range [a0,a1] (open jacket), uv: u=angle, v=y
function latheGeo(S,N=28,range=null,uvY=null){
  const pos=[],uv=[],idx=[];const a0=range?range[0]:-Math.PI,a1=range?range[1]:Math.PI,closed=!range;const cols=closed?N:N+1;
  S.forEach((q,j)=>{for(let i=0;i<cols;i++){const al=a0+(a1-a0)*i/N;pos.push((q.x0||0)+q.a*Math.sin(al),q.y,(q.z0||0)+q.b*Math.cos(al));uv.push((al+Math.PI)/TAU,uvY?uvY(q.y):j/(S.length-1));}});
  for(let j=0;j<S.length-1;j++)for(let i=0;i<(closed?N:N);i++){const i2=closed?(i+1)%N:i+1;const A=j*cols+i,B=j*cols+i2,Cc=(j+1)*cols+i,D=(j+1)*cols+i2;idx.push(A,Cc,B,B,Cc,D);}
  if(closed){[0,S.length-1].forEach((j,k)=>{const q=S[j];const c=pos.length/3;pos.push(q.x0||0,q.y,q.z0||0);uv.push(.5,uvY?uvY(q.y):k);for(let i=0;i<N;i++){const A=j*cols+i,B=j*cols+(i+1)%N;if(k===0)idx.push(c,A,B);else idx.push(c,B,A);}});}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();
  // flip winding if normals face inward (rings go around +y consistently)
  return g;}
function sliceAt(S,y){if(y>=S[0].y)return S[0];for(let i=1;i<S.length;i++){if(y>=S[i].y){const A=S[i-1],B=S[i],t=(A.y-y)/(A.y-B.y||1);return{y,a:lerp(A.a,B.a,t),b:lerp(A.b,B.b,t),z0:lerp(A.z0||0,B.z0||0,t),x0:lerp(A.x0||0,B.x0||0,t)};}}return S[S.length-1];}
// a tube along a path with varying radius and round caps; update() rewrites vertices in place
class Tube{constructor(nPath=14,nRad=12,caps=3){this.nP=nPath;this.nR=nRad;this.caps=caps;this.rings=nPath+caps*2;
  const g=new T.BufferGeometry();const vc=this.rings*nRad+2;g.setAttribute('position',new T.BufferAttribute(new Float32Array(vc*3),3));const idx=[];
  for(let j=0;j<this.rings-1;j++)for(let i=0;i<nRad;i++){const a=j*nRad+i,b=j*nRad+(i+1)%nRad,c=(j+1)*nRad+i,d=(j+1)*nRad+(i+1)%nRad;idx.push(a,b,c,b,d,c);}
  const s0=this.rings*nRad,s1=s0+1;for(let i=0;i<nRad;i++){idx.push(s0,(i+1)%nRad,i);const L=(this.rings-1)*nRad;idx.push(s1,L+i,L+(i+1)%nRad);}
  g.setIndex(idx);this.geo=g;}
  update(pts,rad){const nP=this.nP,nR=this.nR,P=this.geo.attributes.position.array;const tang=[];
    for(let k=0;k<nP;k++){const a=pts[Math.max(0,k-1)],b=pts[Math.min(nP-1,k+1)];tang.push(b.clone().sub(a).normalize());}
    let nrm=Math.abs(tang[0].y)<.9?V3(0,1,0).cross(tang[0]).normalize():V3(1,0,0).cross(tang[0]).normalize();
    const frames=[];for(let k=0;k<nP;k++){if(k>0){const ax=tang[k-1].clone().cross(tang[k]);const s=ax.length();if(s>1e-6){ax.normalize();const ang=Math.asin(clamp(s,-1,1));nrm.applyAxisAngle(ax,ang);}}const bin=tang[k].clone().cross(nrm).normalize();frames.push([nrm.clone(),bin]);}
    const rings=[];const c=this.caps;
    for(let i=c;i>=1;i--){const ang=i/c*Math.PI/2;rings.push({p:pts[0].clone().addScaledVector(tang[0],-rad[0]*Math.sin(ang)*.9),r:rad[0]*Math.cos(ang),f:frames[0]});}
    for(let k=0;k<nP;k++)rings.push({p:pts[k],r:rad[k],f:frames[k]});
    for(let i=1;i<=c;i++){const ang=i/c*Math.PI/2;rings.push({p:pts[nP-1].clone().addScaledVector(tang[nP-1],rad[nP-1]*Math.sin(ang)*.9),r:rad[nP-1]*Math.cos(ang),f:frames[nP-1]});}
    let o=0;rings.forEach(R=>{for(let i=0;i<nR;i++){const t=i/nR*TAU,cs=Math.cos(t),sn=Math.sin(t);P[o++]=R.p.x+(R.f[0].x*cs+R.f[1].x*sn)*R.r;P[o++]=R.p.y+(R.f[0].y*cs+R.f[1].y*sn)*R.r;P[o++]=R.p.z+(R.f[0].z*cs+R.f[1].z*sn)*R.r;}});
    const a=rings[0].p,b=rings[rings.length-1].p;P[o++]=a.x;P[o++]=a.y;P[o++]=a.z;P[o++]=b.x;P[o++]=b.y;P[o++]=b.z;
    this.geo.attributes.position.needsUpdate=true;this.geo.computeVertexNormals();this.geo.computeBoundingSphere();}}
function bendPath(s,j,e,n,bend=.6){const m=s.clone().add(e).multiplyScalar(.5);const c=m.clone().add(j.clone().sub(m).multiplyScalar(1+bend));const o=[];for(let k=0;k<n;k++){const t=k/(n-1),u=1-t;o.push(s.clone().multiplyScalar(u*u).addScaledVector(c,2*u*t).addScaledVector(e,t*t));}return o;}
function ik3(s,t,a,b,pole){const d=t.clone().sub(s);let dist=clamp(d.length(),Math.abs(a-b)+1e-4,a+b-1e-4);const dn=d.clone().normalize();
  const pd=pole.clone().sub(dn.clone().multiplyScalar(pole.dot(dn))).normalize();const cosA=clamp((a*a+dist*dist-b*b)/(2*a*dist),-1,1),sinA=Math.sqrt(1-cosA*cosA);
  return{joint:s.clone().addScaledVector(dn,a*cosA).addScaledVector(pd,a*sinA),end:s.clone().addScaledVector(dn,dist)};}
function ell(rx,ry,rz,col,ink=1,seg=20){const g=new T.SphereGeometry(1,seg,Math.round(seg*.7));g.scale(rx,ry,rz);return withInk(new T.Mesh(g,toon(col)),ink);}

// ---------------- 3D hands ----------------
// fingers: [baseX, baseZ, length, radius]; pose: curl 0..1 per finger, thumb in/out, pinch
function makeHand(col,scale=1,inkW=1){
  const g=new T.Group();const palm=ell(.045,.05,.022,col,inkW);palm.position.set(0,-.045,0);g.add(palm);
  const F=[[-.03,.0,.055,.0115],[-.01,.004,.063,.012],[.011,.004,.06,.0118],[.03,0,.048,.0105]];
  const fingers=F.map(([x,z,L,r])=>{const root=new T.Group();root.position.set(x,-.09,z);const s1=new T.Group();root.add(s1);
    const c1=withInk(new T.Mesh(new T.CapsuleGeometry(r,L*.5,4,8),toon(col)),inkW);c1.position.y=-L*.28;s1.add(c1);
    const s2=new T.Group();s2.position.y=-L*.55;s1.add(s2);const c2=withInk(new T.Mesh(new T.CapsuleGeometry(r*.92,L*.4,4,8),toon(col)),inkW);c2.position.y=-L*.22;s2.add(c2);
    g.add(root);return{root,s1,s2,L};});
  const th=new T.Group();th.position.set(-.042,-.05,.02);const t1=withInk(new T.Mesh(new T.CapsuleGeometry(.013,.035,4,8),toon(col)),inkW);t1.position.y=-.025;th.add(t1);
  const th2=new T.Group();th2.position.y=-.05;th.add(th2);const t2=withInk(new T.Mesh(new T.CapsuleGeometry(.012,.028,4,8),toon(col)),inkW);t2.position.y=-.02;th2.add(t2);g.add(th);
  g.scale.setScalar(scale);
  g.userData={fingers,th,th2,pose(curl=0,spread=0,thumb=0,pinch=0,grip=false){fingers.forEach((f,i)=>{const c=i===0?(grip?pinch*.55:Math.max(curl,pinch*.55)):curl;f.root.rotation.x=c*1.25;f.s2.rotation.x=c*1.35;f.root.rotation.z=(i-1.5)*spread*.18;});
    th.rotation.set(.5*thumb+pinch*.9,0,-.5+thumb*.4+pinch*.35);th2.rotation.x=pinch*.5;}};
  return g;}
// the point between the thumb tip and the index tip (hand-local), used for pinching
function pinchPoint(hand){hand.updateMatrixWorld(true);const a=V3(0,-.045,0);hand.userData.th2.localToWorld(a);const b=V3(0,-.06,0);hand.userData.fingers[0].s2.localToWorld(b);return a.add(b).multiplyScalar(.5);}

// ---------------- face texture (drawn in angle/height space, wraps around the head) ----------------
const FW=1024,FH=424,FPX=163/47; // canvas px per head-px at the front
function faceCanvas(){const c=document.createElement('canvas');c.width=FW;c.height=FH;return c;}
function drawFace(ctx,spec,st){
  const S=spec.skin,F=spec.face||{},X=al=>FW/2+al*163,Y=y=>(y+66)*FPX,ink='#231a22';
  ctx.fillStyle=S;ctx.fillRect(0,0,FW,FH);
  const kid=spec.age==='kid',ey=kid?8:4,ea=.37;
  const blush=(al)=>{ctx.fillStyle='rgba(240,132,138,.5)';ctx.beginPath();ctx.ellipse(X(al),Y(22),26,20,0,0,TAU);ctx.fill();};
  blush(-.62);blush(.62);
  const brush=(pts,w,col)=>{ctx.strokeStyle=col;ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=w;ctx.beginPath();pts.forEach(([a,y],i)=>i?ctx.lineTo(X(a),Y(y)):ctx.moveTo(X(a),Y(y)));ctx.stroke();};
  const look=st.look||[0,0];
  [-1,1].forEach(sd=>{const al=sd*ea;
    if(st.blink||st.expr==='happy'){brush(st.blink?[[al-.18,ey],[al,ey+3],[al+.18,ey]]:[[al-.18,ey+3],[al,ey-7],[al+.18,ey+3]],11,ink);return;}
    const wide=st.expr==='surprised';const rx=.33*163*(wide?1.12:1),ry=19*FPX*(wide?1.15:1);
    ctx.fillStyle='#fff';ctx.strokeStyle=ink;ctx.lineWidth=9;ctx.beginPath();ctx.ellipse(X(al),Y(ey),rx,ry,0,0,TAU);ctx.fill();ctx.stroke();
    const ir=wide?.55:1,ix=X(al+look[0]*.09),iy=Y(ey+2+look[1]*4);
    const gr=ctx.createLinearGradient(0,iy-ry*.6,0,iy+ry*.6);gr.addColorStop(0,'#2a1810');gr.addColorStop(.6,F.eyeColor||'#5A3A22');gr.addColorStop(1,'#c99a6a');
    ctx.fillStyle=gr;ctx.beginPath();ctx.ellipse(ix,iy,rx*.62*ir,ry*.66*ir,0,0,TAU);ctx.fill();
    ctx.fillStyle=ink;ctx.beginPath();ctx.ellipse(ix,iy,rx*.34*ir,ry*.38*ir,0,0,TAU);ctx.fill();
    ctx.fillStyle='#fff';ctx.beginPath();ctx.ellipse(ix+rx*.2,iy-ry*.25,rx*.17,ry*.17,0,0,TAU);ctx.fill();ctx.beginPath();ctx.ellipse(ix-rx*.18,iy+ry*.28,rx*.08,ry*.08,0,0,TAU);ctx.fill();
    brush([[al-.3,ey-6],[al-.1,ey-16],[al+.14,ey-16],[al+.3,ey-7],[al+sd*.38*sd,ey-12]],14,ink);
  });
  const by=ey-(st.expr==='surprised'?30:24),bc='#2a1c18';
  [-1,1].forEach(sd=>{const al=sd*ea;const up=st.expr==='surprised'?-5:st.expr==='angry'?4:0;brush([[al-sd*.17,by+up*(sd>0?1:1)],[al,by-4+up],[al+sd*.17,by-1+(st.expr==='angry'?-6:0)]],10,bc);});
  const my=kid?36:34,mc='#7A2A34',m=st.mouth||(st.expr==='happy'?'grin':st.expr==='surprised'?'o':F.mouth||'smile');
  if(m==='o'){ctx.fillStyle=mc;ctx.beginPath();ctx.ellipse(X(0),Y(my+5),30,34,0,0,TAU);ctx.fill();ctx.fillStyle='#EE6F7C';ctx.beginPath();ctx.ellipse(X(0),Y(my+12),18,12,0,0,TAU);ctx.fill();}
  else if(m==='grin'||m==='open'){ctx.fillStyle=mc;ctx.beginPath();ctx.moveTo(X(-.3),Y(my-2));ctx.quadraticCurveTo(X(0),Y(my+2),X(.3),Y(my-2));ctx.quadraticCurveTo(X(.22),Y(my+15),X(0),Y(my+15));ctx.quadraticCurveTo(X(-.22),Y(my+15),X(-.3),Y(my-2));ctx.fill();
    ctx.fillStyle='#fff';ctx.fillRect(X(-.24),Y(my-1),X(.24)-X(-.24),10);ctx.fillStyle='#EE6F7C';ctx.beginPath();ctx.ellipse(X(0),Y(my+11),24,10,0,0,TAU);ctx.fill();}
  else brush([[-.22,my],[0,my+7],[.22,my]],10,mc);
  // nose shadow + ear hint are geometry; add a soft nose shade
  ctx.fillStyle='rgba(120,60,50,.18)';ctx.beginPath();ctx.ellipse(X(.03),Y(20),16,12,0,0,TAU);ctx.fill();
}

// ---------------- hairlines (from the 2.5D engine) ----------------
const HL={
  short:al=>{const c=Math.cos(al);return c>0?lerp(-2,-34,Math.pow(c,1.5)):lerp(-2,30,-c);},
  messy:al=>{const c=Math.cos(al);return c>0?lerp(0,-22,c)+6*Math.sin(al*14):lerp(0,32,-c);},
  sidepart:al=>{const c=Math.cos(al);return c>0?lerp(0,-30,Math.pow(c,1.2))+(al>-.2&&al<.7?10*Math.sin((al+.2)*3.4):0):lerp(0,32,-c);},
  bowl:al=>{const c=Math.cos(al);return c>0?lerp(8,-12,Math.pow(c,.8))+3*Math.sin(al*18):lerp(8,34,-c);},
  long:al=>{const c=Math.cos(al);return c>0?lerp(34,-36,Math.pow(c,2.2)):lerp(34,50,-c);},
  bob:al=>{const c=Math.cos(al);return c>0?lerp(30,-14,Math.pow(c,1.6)):lerp(30,44,-c);},
  ponytail:al=>{const c=Math.cos(al);return c>0?lerp(4,-34,Math.pow(c,1.4)):lerp(4,22,-c);},
  bun:al=>{const c=Math.cos(al);return c>0?lerp(-2,-36,Math.pow(c,1.3)):lerp(-2,22,-c);},
  curly:al=>{const c=Math.cos(al);return c>0?lerp(6,-24,c):lerp(6,36,-c);},
  afro:al=>{const c=Math.cos(al);return c>0?lerp(8,-26,c):lerp(8,40,-c);},
};

// ---------------- base meshes: one male, one female ----------------
// Anime-proportioned bodies (~6.5 heads). Torso = sculpted ring slices (width a, depth b, front offset z0);
// limbs = tubes whose radius follows a muscle profile; head = large cranium, small lower face.
const BASES={
  masc:{H:1.72,head:.315,torso:.53,leg:.83,neck:.075,sw:.205,hw:.15,
    torsoS:t=>[{y:t+.03,a:.052,b:.05,z0:-.004},{y:t-.005,a:.115,b:.068,z0:-.012},{y:t-.035,a:.2,b:.092,z0:-.006},{y:t-.085,a:.192,b:.115,z0:.012},{y:t-.16,a:.178,b:.122,z0:.02},{y:t-.24,a:.158,b:.112,z0:.013},{y:t-.33,a:.138,b:.097,z0:.006},{y:.11,a:.142,b:.1,z0:.008},{y:.02,a:.152,b:.1,z0:-.004},{y:-.05,a:.146,b:.098,z0:-.012},{y:-.1,a:.085,b:.062,z0:-.008}],
    armProf:[[0,.058],[.1,.056],[.3,.047],[.5,.036],[.62,.042],[.85,.032],[1,.027]],legProf:[[0,.088],[.25,.076],[.48,.054],[.52,.052],[.66,.058],[.9,.036],[1,.033]],
    headS:[[64,4,4,-4],[60,30,31,-4],[50,45,46,-4],[32,50,50,-4],[12,50,49,-3],[-4,47,46,-1],[-18,43,41,1],[-30,37,33,3],[-40,29,26,6],[-48,17,17,8],[-52,4,4,8]]},
  fem:{H:1.64,head:.31,torso:.49,leg:.82,neck:.066,sw:.168,hw:.172,
    torsoS:t=>[{y:t+.03,a:.044,b:.042,z0:-.004},{y:t-.005,a:.098,b:.058,z0:-.01},{y:t-.03,a:.165,b:.08,z0:-.006},{y:t-.075,a:.158,b:.1,z0:.01},{y:t-.14,a:.156,b:.132,z0:.032},{y:t-.2,a:.132,b:.102,z0:.014},{y:t-.29,a:.112,b:.085,z0:.002},{y:.08,a:.148,b:.098,z0:-.002},{y:.0,a:.172,b:.112,z0:-.012},{y:-.06,a:.158,b:.108,z0:-.022},{y:-.1,a:.085,b:.062,z0:-.012}],
    armProf:[[0,.048],[.1,.045],[.3,.039],[.5,.031],[.62,.034],[.85,.027],[1,.023]],legProf:[[0,.094],[.25,.078],[.48,.05],[.52,.048],[.66,.053],[.9,.031],[1,.028]],
    headS:[[64,4,4,-4],[60,30,31,-4],[50,45,46,-4],[32,50,50,-4],[12,49,49,-3],[-4,45,45,-1],[-18,40,40,1],[-30,32,31,4],[-40,22,22,7],[-48,11,13,9],[-52,3,3,9]]},
};
const prof=(P,u)=>{for(let i=1;i<P.length;i++)if(u<=P[i][0]){const a=P[i-1],b=P[i],k=(u-a[0])/(b[0]-a[0]||1);const s=k*k*(3-2*k);return lerp(a[1],b[1],s);}return P[P.length-1][1];};
// hair: tapered locks (tubes) grown from the scalp, plus a thin cap to fill between them
function lockGeo(pts,r0){const tb=new Tube(pts.length,8,2);tb.update(pts,pts.map((_,i)=>r0*Math.pow(1-i/(pts.length-1),.8)+r0*.06));return tb.geo;}
function hairLocks(style,hs,HS,gender,capped){const L=[];const surf=(al,yup,off=0)=>{const q=sliceAt(HS,yup);const n=Math.hypot(Math.sin(al)/q.a,Math.cos(al)/q.b);return V3(((q.x0||0)+q.a*Math.sin(al)+Math.sin(al)/q.a/n*off)*hs,yup*hs,((q.z0||0)+q.b*Math.cos(al)+Math.cos(al)/q.b/n*off)*hs);};
  const lock=(al,yup,dir,len,r,bend=[0,-1,0],n=9)=>{const p0=surf(al,yup,2);const pts=[];let p=p0.clone(),d=dir.clone().normalize();for(let i=0;i<n;i++){pts.push(p.clone());d.addScaledVector(V3(...bend),.18).normalize();p.addScaledVector(d,len/(n-1));}L.push({pts,r});};
  const out=(al,yup)=>{const s=surf(al,yup,0).normalize();return s;};
  const R=hs; // px → m
  if(['short','messy','sidepart','buzz','curly'].includes(style)){const sp=style==='messy'?1.3:style==='buzz'?.45:1;
    if(!capped)for(let i=0;i<14;i++){const al=-Math.PI+i/14*TAU;const y=40;const o=out(al,y);o.y=0;const back=Math.cos(al)<0;lock(al,y,o.multiplyScalar(.7).add(V3(0,.55,0)).add(back?V3(0,-.4,-.1):V3(0,0,0)),(34+6*Math.sin(i*2.3))*R*sp,15*R,[0,-.55,back?-.2:.1],7);}
    for(let i=0;i<6;i++){const al=-.55+i*.22;lock(al,46,V3(Math.sin(al)*.2,.1,1),(38+6*Math.sin(i*3))*R*(style==='sidepart'?1.15:1),13*R,[style==='sidepart'?.3:0,-1.3,.05],8);}
    if(!capped)for(let i=0;i<4;i++){const al=-.45+i*.3;lock(al,60,V3(0,1,-.35),(26+6*Math.sin(i*5))*R*sp,15*R,[0,-.25,-.35],6);}}
  if(['long','bob','ponytail','bun','bowl'].includes(style)){const len=style==='long'?150:style==='bob'?58:40;
    for(let i=0;i<9;i++){const al=-.75+i*.19;lock(al,42,V3(Math.sin(al)*.25,-.3,1),(style==='bowl'?46:40+6*Math.sin(i*2.1))*R,10*R,[Math.sin(al)*.1,-1.3,.15],8);}
    if(style!=='ponytail'&&style!=='bun'){for(let i=0;i<18;i++){const al=Math.PI*.38+i/17*Math.PI*1.24;const o=out(al,20);o.y=0;lock(al,30,o.multiplyScalar(.22).add(V3(0,-1,0)),len*R*(.85+.2*Math.sin(i*1.9)),15*R,[0,-.4,0],10);}
      [-1,1].forEach(sd=>{for(let k=0;k<3;k++){const al=sd*(.95+k*.2);lock(al,24,V3(sd*.12,-1,.12),len*R*(k?.95:.8),13*R,[0,-.3,.02],10);}});}
    else{const tip=style==='bun'?null:V3(0,-.1,-1);if(tip)for(let k=0;k<5;k++)lock(Math.PI+(k-2)*.12,30,V3((k-2)*.1,-.2,-1),80*R,13*R,[0,-1.2,-.2],10);}}
  if(capped)return L.filter(l=>l.pts[0].y<34*hs||l.pts[l.pts.length-1].y<l.pts[0].y-20*hs).map(l=>({pts:l.pts,r:l.r*.9}));
  return L;}
function buildCharacter(spec){
  const G=spec.body==='fem'?'fem':'masc',B=BASES[G],kid=spec.age==='kid',teen=spec.age==='teen',shp=spec.shape||'classic';
  const SHP={classic:{h:1,l:1,w:1,hd:1},noodle:{h:1,l:1.08,w:.72,hd:1.04},chunky:{h:1,l:.86,w:1.3,hd:.98},tall:{h:1.06,l:1.1,w:.92,hd:.94},tiny:{h:.86,l:.8,w:1,hd:1.15}}[shp]||{h:1,l:1,w:1,hd:1};
  const K=(kid?.68:teen?.92:1)*SHP.h,KW=K*SHP.w;
  const R={headH:B.head*(kid?1.08:1)*SHP.hd,leg:B.leg*K*SHP.l,torso:B.torso*K,sw:B.sw*KW,hw:B.hw*KW,limb:.048*KW,hand:(G==='fem'?1.05:1.18)*K,shoe:(G==='fem'?1.05:1.18)*K,neck:B.neck*K};
  R.upper=R.torso*.6;R.fore=R.torso*.55;R.thigh=R.leg*.5;R.shin=R.leg*.5;
  const armP=u=>prof(B.armProf,u)*KW,legP=u=>prof(B.legProf,u)*KW;
  const root=new T.Group(),body=new T.Group();root.add(body);
  const S=spec.skin,fem=G==='fem';const hasTop=spec.top&&spec.top.kind&&spec.top.kind!=='none';
  const topCol=hasTop?spec.top.color:null,outer=spec.outer&&spec.outer.kind!=='none'?spec.outer:null,btm=spec.bottom&&spec.bottom.kind!=='none'?spec.bottom:null;
  const t=R.torso;const scaleS=s=>s.map(q=>({y:q.y===t+.03||q.y>t-.2?q.y*K/(K):q.y,a:q.a*KW,b:q.b*KW,z0:(q.z0||0)*KW}));
  const tS=pad=>B.torsoS(B.torso).map(q=>({y:q.y*(t/B.torso),a:q.a*KW+pad,b:q.b*KW+pad,z0:(q.z0||0)*KW}));
  const torso=new T.Group();body.add(torso);
  torso.add(withInk(new T.Mesh(latheGeo(tS(0),40),toon(S)),1));
  const garment=(pad,y0,y1,col,ink=1,range=null)=>{const all=tS(pad);const sl=all.filter(q=>q.y<y0&&q.y>y1);sl.unshift({...sliceAt(all,y0),y:y0});sl.push({...sliceAt(all,y1),y:y1});const m=withInk(new T.Mesh(latheGeo(sl,40,range),toon(col,{double:!!range})),ink);torso.add(m);return m;};
  // underwear base when nothing is worn
  if(!hasTop&&fem)garment(.006,t-.1,t-.235,'#EDEFF5');
  if(!btm)garment(.007,.05,-.1,fem?'#EDEFF5':'#3a3f55');
  if(hasTop)garment(.012,t+.03,-.035,topCol);
  if(btm)garment(.016,t*.24,-.1,btm.color);
  if(outer){garment(.03,t+.03,-.09,outer.color,1.1,[.34,TAU-.34]);
    const col=withInk(new T.Mesh(latheGeo([{y:t+.05,a:R.neck*.72+.035,b:R.neck*.72+.03,z0:-.01},{y:t-.01,a:R.sw*.62,b:R.sw*.42,z0:-.01}],28,[.5,TAU-.5]),toon(outer.color,{double:true})),1);torso.add(col);}
  // neck: a tapered lathe blending into the trapezius
  const neck=withInk(new T.Mesh(latheGeo([{y:R.neck+.05,a:R.neck*.46,b:R.neck*.5,z0:0},{y:R.neck*.5,a:R.neck*.5,b:R.neck*.54,z0:-.003},{y:0,a:R.neck*.62,b:R.neck*.6,z0:-.008}],20),toon(S)),1);torso.add(neck);neck.position.y=t;
  // head
  const head=new T.Group();torso.add(head);const hs=R.headH/116;
  const HS=B.headS.map(([y,a,b,z0])=>({y,a:a*(kid?1.04:1),b,z0}));const HSm=HS.map(q=>({y:q.y*hs,a:q.a*hs,b:q.b*hs,z0:q.z0*hs}));
  const fc=faceCanvas(),fctx=fc.getContext('2d'),ftex=new T.CanvasTexture(fc);ftex.colorSpace=T.SRGBColorSpace;
  head.add(withInk(new T.Mesh(latheGeo(HSm,44,null,y=>1-((-y/hs)+66)/122),toon(S,{map:ftex})),1));
  head.position.y=t+R.neck+R.headH*.42;
  const nose=ell(.009*R.headH/.27,.012*R.headH/.27,.011*R.headH/.27,S,.7);nose.position.set(0,-16*hs,47*hs);head.add(nose);
  [-1,1].forEach(sd=>{const e=ell(.011,.024,.013,S,.9);e.position.set(sd*48*hs,-2*hs,-3*hs);e.rotation.y=sd*.4;head.add(e);});
  // hair
  const hc=spec.hair&&spec.hair.color||'#3B2419',hst=spec.hair&&spec.hair.style||'short',hl=HL[hst]||HL.short;
  const capped=(spec.acc||[]).some(a=>a==='cap'||a==='capback');
  if(hst!=='bald'){const NA=56,NY=10,pos=[],idx=[];const inf=4;
    for(let i=0;i<=NA;i++){const al=-Math.PI+i/NA*TAU;const yb=Math.min(hl(al),52);for(let j=0;j<=NY;j++){const yd=lerp(-66,yb,j/NY);const q=sliceAt(HS,-yd);const n=Math.hypot(Math.sin(al)/q.a,Math.cos(al)/q.b);
      pos.push(((q.x0||0)+q.a*Math.sin(al)+Math.sin(al)/q.a/n*inf)*hs,-yd*hs+(j===0?3*hs:0),((q.z0||0)+q.b*Math.cos(al)+Math.cos(al)/q.b/n*inf)*hs);}}
    for(let i=0;i<NA;i++)for(let j=0;j<NY;j++){const a=i*(NY+1)+j,b=(i+1)*(NY+1)+j;idx.push(a,b,a+1,b,b+1,a+1);}
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setIndex(idx);g.computeVertexNormals();head.add(withInk(new T.Mesh(g,toon(hc,{double:true,gloss:.9})),.8));
    const hm=toon(hc,{gloss:.9});hairLocks(hst,hs,HS,G,capped).forEach(l=>head.add(withInk(new T.Mesh(lockGeo(l.pts,l.r),hm),.9)));
    if(hst==='afro'){for(let i=0;i<40;i++){const al=i*2.4,y=10+((i*37)%50);const p=V3(Math.sin(al)*56*hs,y*hs,Math.cos(al)*54*hs-4*hs);const b=ell(.05,.05,.05,hc,.9);b.position.copy(p);head.add(b);}}
    if(hst==='bun'){const b=ell(.05,.045,.05,hc,1);b.position.set(0,56*hs,-40*hs);head.add(b);}}
  if((spec.acc||[]).some(a=>a==='cap'||a==='capback')){const back=(spec.acc||[]).includes('capback');const cc=topCol||'#F2D34F';const dome=withInk(new T.Mesh(new T.SphereGeometry(1,24,12,0,TAU,0,Math.PI/2),toon(cc,{double:true})),1);dome.scale.set(60*hs,54*hs,62*hs);dome.position.set(0,24*hs,-4*hs);const btn=ell(.012,.008,.012,cc,.8);btn.position.set(0,78*hs,-4*hs);head.add(btn);head.add(dome);
    const brim=withInk(new T.Mesh(new T.CylinderGeometry(1,1,.006,24,1,false,-.9,1.8),toon(cc)),1);brim.scale.set(60*hs,1,84*hs);brim.position.set(0,26*hs,back?-26*hs:26*hs);brim.rotation.x=back?-.12:.12;if(back)brim.rotation.y=Math.PI;head.add(brim);}
  // limbs
  const mk=(col,w=1,n=16)=>{const tb=new Tube(n,14,3);const m=withInk(new T.Mesh(tb.geo,toon(col)),w);body.add(m);return{tb,m};};
  const limbs={armL:mk(S),armR:mk(S),legL:mk(S),legR:mk(S)};
  const slCol=outer?outer.color:topCol;const topK=spec.top&&spec.top.kind;const slT=outer?.97:hasTop?(['longsleeve','hoodie','sweater'].includes(topK)?.97:['tank'].includes(topK)?0:.36):0;
  const sleeves={L:mk(slCol||S,1,12),R:mk(slCol||S,1,12)};
  const longLeg=btm&&['jeans','trousers','overalls','cargo'].includes(btm.kind),shortLeg=btm&&btm.kind==='shorts';
  const trou={L:mk(btm?btm.color:S,1,14),R:mk(btm?btm.color:S,1,14)};
  const hands={L:makeHand(S,R.hand),R:makeHand(S,R.hand)};body.add(hands.L);body.add(hands.R);
  const shoeCol=spec.shoes&&spec.shoes.color||'#E4574C',bare=!spec.shoes||spec.shoes.kind==='barefoot';
  const shoes=[0,1].map(()=>{const g=new T.Group();if(bare){const f=ell(.04*R.shoe,.03*R.shoe,.085*R.shoe,S,1);f.position.set(0,.03,.04*R.shoe);g.add(f);}
    else{const up=ell(.052*R.shoe,.048*R.shoe,.095*R.shoe,shoeCol,1.1);up.position.set(0,.045*R.shoe,.045*R.shoe);g.add(up);const sole=ell(.058*R.shoe,.022*R.shoe,.105*R.shoe,'#F5F1E8',1.1);sole.position.set(0,.014,.05*R.shoe);g.add(sole);const toe=ell(.046*R.shoe,.03*R.shoe,.04*R.shoe,'#F5F1E8',.9);toe.position.set(0,.03,.12*R.shoe);g.add(toe);}
    body.add(g);return g;});
  const face={ctx:fctx,tex:ftex,key:''};
  return{root,body,torso,head,face,limbs,sleeves,trou,hands,shoes,R,spec,armP,legP,slT,longLeg,shortLeg,hasBtm:!!btm};
}

// pose → meshes. P: {pelvisH, spine:[pitch,roll], head:[yaw,pitch,roll], hands:{L,R} (body space), handPose, feet:{L,R} (body space), expr, look, blink, mouth, legScale}
function poseCharacter(C,P){
  const R=C.R;const pel=V3(0,P.pelvisH,0);
  C.torso.position.copy(pel);C.torso.rotation.set(P.spine[0],0,P.spine[1]);C.torso.updateMatrixWorld(true);
  C.head.rotation.set(P.head[1],P.head[0],P.head[2]||0);
  const toBody=v=>{const w=v.clone();C.torso.localToWorld(w);C.body.worldToLocal(w);return w;};
  const along=(pts,u)=>{const idx=u*(pts.length-1);const a=Math.floor(idx),b=Math.min(pts.length-1,a+1);return pts[a].clone().lerp(pts[b],idx-a);};
  ['L','R'].forEach(k=>{const sd=k==='L'?1:-1;const sh=toBody(V3(sd*(R.sw-C.armP(0)*.55),R.torso-.045,-.012));const tgt=P.hands[k];
    const ik=ik3(sh,tgt,R.upper,R.fore,P.armPole?P.armPole[k]:V3(sd*.6,-.1,-.8));const pts=bendPath(sh,ik.joint,ik.end,16,.35);
    C.limbs['arm'+k].tb.update(pts,pts.map((_,j)=>C.armP(j/15)));
    if(C.slT>0){const n=12,sp=[],sr=[];for(let j=0;j<n;j++){const u=j/(n-1)*C.slT;sp.push(along(pts,u));sr.push(C.armP(u)+.011+(C.slT>.9&&j===n-1?.005:0));}C.sleeves[k].tb.update(sp,sr);C.sleeves[k].m.visible=true;}else C.sleeves[k].m.visible=false;
    const hand=C.hands[k];hand.position.copy(ik.end);const dir=ik.end.clone().sub(pts[13]).normalize();
    hand.quaternion.copy(new T.Quaternion().setFromUnitVectors(V3(0,-1,0),dir));hand.rotateY(-sd*(P.handRoll||.4));if(k==='L')hand.scale.x=-Math.abs(hand.scale.x);
    const hp=(P.handPose&&P.handPose[k])||[.35,.1,.2,0];hand.userData.pose(...hp);});
  ['L','R'].forEach((k,i)=>{const sd=k==='L'?1:-1;const hip=toBody(V3(sd*R.hw*.52,-.035,0));const ft=P.feet[k];const ls=P.legScale||1;
    const ik=ik3(hip,ft,R.thigh*ls,R.shin*ls,P.legPole?P.legPole[k]:V3(0,0,1));const pts=bendPath(hip,ik.joint,ik.end,16,.2);
    C.limbs['leg'+k].tb.update(pts,pts.map((_,j)=>C.legP(j/15)*(ls>1?1.08:1)));
    const tr=C.trou[k];if(C.longLeg||C.shortLeg||!C.hasBtm){const L=C.longLeg?.97:C.shortLeg?.36:.14;const sp=[],sr=[];for(let j=0;j<14;j++){const u=j/13*L;sp.push(along(pts,u));sr.push(C.legP(u)*(ls>1?1.08:1)+(C.hasBtm?.016:.007)+(C.longLeg&&j===13?.006:0));}tr.tb.update(sp,sr);tr.m.visible=true;}else tr.m.visible=false;
    const sh=C.shoes[i];sh.position.copy(ik.end).add(V3(0,-.035,0));const fwd=(P.footDir&&P.footDir[k])||V3(0,0,1);sh.lookAt(sh.position.clone().add(V3(fwd.x,0,fwd.z).normalize()));});
  const key=[P.expr,P.blink?1:0,P.mouth||'',(P.look||[0,0]).map(v=>v.toFixed(2)).join(',')].join('|');
  if(key!==C.face.key){C.face.key=key;drawFace(C.face.ctx,C.spec,{expr:P.expr,blink:P.blink,look:P.look,mouth:P.mouth});C.face.tex.needsUpdate=true;}
}

// world-space point of the back of the jacket collar (where a giant hand pinches)
function collarPoint(C){const p=V3(0,C.R.torso+.03,-C.R.sw*.42);C.torso.localToWorld(p);return p;}

window.Toon3D={T,V3,toon,inkMat,withInk,ell,latheGeo,Tube,bendPath,ik3,makeHand,pinchPoint,buildCharacter,poseCharacter,collarPoint,shared,LIGHT,clamp,lerp,mixc};
})();
