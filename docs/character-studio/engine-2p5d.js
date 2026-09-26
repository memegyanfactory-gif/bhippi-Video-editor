// 2.5D character engine: every body part is a simple 3D volume (lathe slices, capsules, small hulls),
// every face / hair / clothing detail lives ON those surfaces, and each frame is rotated and drawn
// flat (cel fills, colour linework, a light-side shade band). So the body turns a full 360°, the head
// looks anywhere (yaw + pitch), and eyes, mouth, hairline and buttons wrap around the forms as they turn.
// Space: x right, y down, z toward the viewer; origin between the feet.
(function(){
const TAU=Math.PI*2, f=n=>Math.round(n*10)/10, clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x)), lerp=(a,b,t)=>a+(b-a)*t;
function hex2rgb(h){h=h.replace('#','');return[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];}
function mix(a,b,k){const A=hex2rgb(a),B=hex2rgb(b);return'#'+A.map((v,i)=>Math.round(v+(B[i]-v)*k).toString(16).padStart(2,'0')).join('');}
const shade=(c,k=.16)=>mix(c,'#3a1f3a',k), tint=(c,k=.3)=>mix(c,'#ffffff',k), lineOf=c=>mix(c,'#2a1426',.55);

// ---------- catalogue ----------
const CAT={
  age:['kid','teen','adult','senior'], body:['masc','fem','neutral'], build:['slim','average','round'], style:['pop','flat','ink'],
  skin:['#FFE3D1','#F9CDB1','#EDB48E','#D99A70','#BD7E55','#9C603E','#7A4630','#55321F'],
  fantasy:['#9BD35A','#6FC2E8','#B58CF0','#F0685A','#F2C94C','#E8E8F0'],
  shape:['classic','noodle','chunky','tall','tiny'], ears:['round','big','pointy'],
  hairColor:['#1D1A1A','#3B2419','#6B3F22','#9C3D1E','#E07B2E','#F2C14E','#EDE3C7','#C4C4C4','#3D6FE0','#F07AA8'],
  cloth:['#F5F1E8','#2B2D33','#E4574C','#F6A623','#F2D34F','#3FBF7F','#1FA3A0','#3F7FC1','#6B5CE0','#E06FA6','#8A6E52','#7FB3E8'],
  eyeColor:['#5A3A22','#3F7FC1','#3E8E5A','#8A7A3A','#6E7A86'],
  faceShape:['round','oval','square','heart','box','bean'], eyes:['toon','dot','almond','sleepy','happy'], brows:['soft','thick','arched','flat','none'],
  nose:['button','small','round','long','pointy','bulb'], mouth:['smile','grin','teeth','open','smirk','flat','tongue','fangs'], facialHair:['none','stubble','mustache','beard','goatee'],
  hair:['short','sidepart','bowl','messy','buzz','curly','afro','long','bob','ponytail','pigtails','bun','bald'],
  top:['none','tee','longsleeve','tank','hoodie','shirt','sweater','dress'], outer:['none','jacket','denim','cardigan'],
  bottom:['shorts','jeans','trousers','skirt','overalls'], shoes:['barefoot','sneakers','hightops','boots','flats'],
  pattern:['plain','stripes','dots','hearts','plaid','camo'], stance:['relaxed','hip','peace','pocket','hold'],
  acc:{head:['cap','beanie','headband','bow','headphones','horns','bolts'],face:['glasses','squares','sunglasses','hoops','studs','nosering','freckles','blush','lipstick','eyebags','stitches'],neck:['chain','pendant','tie'],wrist:['bangles','watch'],body:['backpack'],hand:['phone','cup','book']},
};
function defaults(){return{name:'',style:'pop',shape:'classic',age:'adult',body:'masc',build:'average',height:1,skin:CAT.skin[1],
  face:{shape:'round',ears:'round',eyes:'toon',eyeColor:CAT.eyeColor[0],brows:'soft',nose:'button',mouth:'smile',facialHair:'none'},
  hair:{style:'short',color:CAT.hairColor[1]},top:{kind:'none',color:CAT.cloth[7],pattern:'plain'},outer:{kind:'none',color:CAT.cloth[1]},
  bottom:{kind:'shorts',color:CAT.cloth[9],pattern:'plain'},shoes:{kind:'barefoot',color:CAT.cloth[2]},acc:[],stance:'relaxed'};}

// ---------- vector + geometry helpers ----------
function rotP(p,yaw,pitch){let[x,y,z]=p;if(pitch){const c=Math.cos(pitch),s=Math.sin(pitch);[y,z]=[y*c-z*s,y*s+z*c];}const c=Math.cos(yaw),s=Math.sin(yaw);return[x*c+z*s,y,-x*s+z*c];}
function hull(pts){const P=pts.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);if(P.length<3)return P;const cr=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const lo=[],up=[];for(const p of P){while(lo.length>=2&&cr(lo[lo.length-2],lo[lo.length-1],p)<=0)lo.pop();lo.push(p);}for(let i=P.length-1;i>=0;i--){const p=P[i];while(up.length>=2&&cr(up[up.length-2],up[up.length-1],p)<=0)up.pop();up.push(p);}
  up.pop();lo.pop();return lo.concat(up);}
function smooth(pts,closed=true,k=.5){ // Catmull-Rom → cubic Béziers
  const n=pts.length;if(n<2)return'';if(n<3)return`M${f(pts[0][0])} ${f(pts[0][1])}L${f(pts[1][0])} ${f(pts[1][1])}`;
  const g=i=>closed?pts[(i+n)%n]:pts[clamp(i,0,n-1)];let d=`M${f(pts[0][0])} ${f(pts[0][1])}`;const m=closed?n:n-1;
  for(let i=0;i<m;i++){const p0=g(i-1),p1=g(i),p2=g(i+1),p3=g(i+2);d+=`C${f(p1[0]+(p2[0]-p0[0])*k/3)} ${f(p1[1]+(p2[1]-p0[1])*k/3)} ${f(p2[0]-(p3[0]-p1[0])*k/3)} ${f(p2[1]-(p3[1]-p1[1])*k/3)} ${f(p2[0])} ${f(p2[1])}`;}
  return d+(closed?'Z':'');}
const circ=(x,y,r)=>`M${f(x-r)} ${f(y)}a${f(r)} ${f(r)} 0 1 0 ${f(2*r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2*r)} 0Z`;
// lathe: slices [{y,a,b,z0,x0}], world transform: yaw about the vertical axis through (ox,·,oz)
function sliceAt(S,y){if(y<=S[0].y)return S[0];for(let i=1;i<S.length;i++){if(y<=S[i].y){const A=S[i-1],B=S[i],t=(y-A.y)/(B.y-A.y||1);return{y,a:lerp(A.a,B.a,t),b:lerp(A.b,B.b,t),z0:lerp(A.z0||0,B.z0||0,t),x0:lerp(A.x0||0,B.x0||0,t)};}}return S[S.length-1];}
function latheSil(S,yaw,O){const L=[],R=[],c=Math.cos(yaw),s=Math.sin(yaw);
  const dense=[];for(let i=0;i<S.length-1;i++){for(let k=0;k<3;k++)dense.push(sliceAt(S,lerp(S[i].y,S[i+1].y,k/3)));}dense.push(S[S.length-1]);
  for(const q of dense){const e=Math.sqrt(q.a*q.a*c*c+q.b*q.b*s*s),cx=(q.x0||0)*c+(q.z0||0)*s;R.push([O[0]+cx+e,O[1]+q.y]);L.push([O[0]+cx-e,O[1]+q.y]);}
  return R.concat(L.reverse());}
// point on a lathe surface at (alpha around, y); returns world-projected point + facing
function lathePt(S,al,y,off,yaw,O,pitch=0,C0=[0,0,0]){const q=sliceAt(S,y);const n=[Math.sin(al)/q.a,0,Math.cos(al)/q.b],nl=Math.hypot(n[0],n[2])||1;
  const p=[(q.x0||0)+q.a*Math.sin(al)+n[0]/nl*off,y,(q.z0||0)+q.b*Math.cos(al)+n[2]/nl*off];
  const r=rotP([p[0]-C0[0],p[1]-C0[1],p[2]-C0[2]],yaw,pitch),rn=rotP([n[0]/nl,0,n[2]/nl],yaw,pitch);
  return{x:O[0]+r[0],y:O[1]+r[1],z:r[2],face:rn[2]};}
// project a decal region, clamping hidden points onto the silhouette
function decal(S,pts,off,yaw,O,pitch,C0){const out=[];const front=-yaw;
  for(const[al,y]of pts){let p=lathePt(S,al,y,off,yaw,O,pitch,C0);
    if(p.face<0){let lo=0,hi=1;const tgt=[front,pitch?0:y];for(let i=0;i<12;i++){const m=(lo+hi)/2;const q=lathePt(S,al+(angDiff(tgt[0],al))*m,lerp(y,tgt[1],m),off,yaw,O,pitch,C0);if(q.face<0)lo=m;else hi=m;}
      p=lathePt(S,al+angDiff(front,al)*hi,lerp(y,pitch?0:y,hi),off,yaw,O,pitch,C0);}
    out.push([p.x,p.y]);}
  return out;}
const angDiff=(a,b)=>{let d=(a-b)%TAU;if(d>Math.PI)d-=TAU;if(d<-Math.PI)d+=TAU;return d;};
// 3D two-bone IK with a pole
function ik3(s,t,a,b,pole){const d=[t[0]-s[0],t[1]-s[1],t[2]-s[2]];let dist=Math.hypot(...d);dist=clamp(dist,Math.abs(a-b)+1e-3,a+b-1e-3);
  const dn=d.map(v=>v/(Math.hypot(...d)||1));let pd=pole.map((v,i)=>v-dn[i]*(pole[0]*dn[0]+pole[1]*dn[1]+pole[2]*dn[2]));const pl=Math.hypot(...pd)||1;pd=pd.map(v=>v/pl);
  const cosA=clamp((a*a+dist*dist-b*b)/(2*a*dist),-1,1),sinA=Math.sqrt(1-cosA*cosA);
  return{joint:[s[0]+a*(cosA*dn[0]+sinA*pd[0]),s[1]+a*(cosA*dn[1]+sinA*pd[1]),s[2]+a*(cosA*dn[2]+sinA*pd[2])],end:[s[0]+dn[0]*dist,s[1]+dn[1]*dist,s[2]+dn[2]*dist]};}
// 2D ribbon along a quadratic through a joint
const V2={add:(a,b)=>[a[0]+b[0],a[1]+b[1]],sub:(a,b)=>[a[0]-b[0],a[1]-b[1]],mul:(a,k)=>[a[0]*k,a[1]*k],norm:a=>{const l=Math.hypot(a[0],a[1])||1;return[a[0]/l,a[1]/l];},lerp:(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]};
const curve=(s,j,e,b=.7)=>{const m=V2.lerp(s,e,.5);return{s,c:V2.add(m,V2.mul(V2.sub(j,m),1+b)),e};};
const qAt=(q,t)=>{const u=1-t;return[u*u*q.s[0]+2*u*t*q.c[0]+t*t*q.e[0],u*u*q.s[1]+2*u*t*q.c[1]+t*t*q.e[1]];};
const qTan=(q,t)=>V2.norm([2*(1-t)*(q.c[0]-q.s[0])+2*t*(q.e[0]-q.c[0]),2*(1-t)*(q.c[1]-q.s[1])+2*t*(q.e[1]-q.c[1])]);
function ribbon(q,t0,t1,w0,w1,capS='round',capE='round',n=16,shift=0){const L=[],R=[];
  for(let i=0;i<=n;i++){const t=t0+(t1-t0)*i/n,p=qAt(q,t),tg=qTan(q,t),nm=[-tg[1],tg[0]],w=(w0+(w1-w0)*i/n)/2,c=V2.add(p,V2.mul(nm,shift));L.push(V2.add(c,V2.mul(nm,w)));R.push(V2.sub(c,V2.mul(nm,w)));}
  const cap=(p,tg,w)=>{const o=[],a0=Math.atan2(tg[1],tg[0]);for(let k=1;k<10;k++){const a=a0+(Math.PI/2-Math.PI*k/10);o.push([p[0]+Math.cos(a)*w,p[1]+Math.sin(a)*w]);}return o;};
  let pts=[...L];if(capE==='round')pts.push(...cap(qAt(q,t1),qTan(q,t1),w1/2));pts.push(...R.reverse());if(capS==='round'){const tg=qTan(q,t0);pts.push(...cap(qAt(q,t0),[-tg[0],-tg[1]],w0/2));}
  return'M'+pts.map(p=>f(p[0])+' '+f(p[1])).join('L')+'Z';}

// ---------- drawing context ----------
let C;
function part(d,fill,opt={}){ // outline pass then fill (+ pattern)
  let s='';const lc=opt.line||C.lc(fill);
  if(C.LW&&!opt.noLine) s+=`<path d="${d}" fill="${lc}" stroke="${lc}" stroke-width="${f(2*C.LW)}" stroke-linejoin="round"/>`;
  s+=`<path d="${d}" fill="${fill}"/>`;
  if(opt.pat&&opt.pat!=='plain') s+=`<path d="${d}" fill="url(#${pat(opt.pat,fill)})"/>`;
  return s;}
function merged(list){let s='';if(C.LW)s+=list.filter(x=>!x.noLine).map(x=>`<path d="${x.d}" fill="${C.lc(x.fill)}" stroke="${C.lc(x.fill)}" stroke-width="${f(2*C.LW)}" stroke-linejoin="round"${x.tf?` transform="${x.tf}"`:''}/>`).join('');
  return s+list.map(x=>`<path d="${x.d}" fill="${x.fill}"${x.tf?` transform="${x.tf}"`:''}/>`).join('');}
const ln=(pts,w,col,op)=>`<path d="${Array.isArray(pts)?smooth(pts,false):pts}" fill="none" stroke="${col}" stroke-width="${f(w)}" stroke-linecap="round" stroke-linejoin="round"${op?` opacity="${op}"`:''}/>`;
function clipTo(d,inner){const id=`c${C.id}_${C.n++}`;C.defs.push(`<clipPath id="${id}"><path d="${d}"/></clipPath>`);return`<g clip-path="url(#${id})">${inner}</g>`;}
function pat(kind,base){const id=`p${C.id}-${kind}-${base.slice(1)}`;if(C.pats[id])return id;
  const d=shade(base,.28),l=tint(base,.55);let body='',w=16,h=16;
  if(kind==='stripes'){w=h=14;body=`<rect width="14" height="6" fill="${l}" opacity=".7"/>`;}
  if(kind==='dots'){body=`<circle cx="4" cy="4" r="2.4" fill="${l}"/><circle cx="12" cy="12" r="2.4" fill="${l}"/>`;}
  if(kind==='hearts'){w=h=22;body=`<path d="M11 16C4 11 5 6 8 6C9.6 6 10.6 7 11 8C11.4 7 12.4 6 14 6C17 6 18 11 11 16Z" fill="${mix(base,'#E4404F',.75)}"/>`;}
  if(kind==='plaid'){w=h=24;body=`<rect width="24" height="7" fill="${l}" opacity=".55"/><rect width="7" height="24" fill="${l}" opacity=".55"/><rect y="15" width="24" height="2" fill="${d}" opacity=".5"/><rect x="15" width="2" height="24" fill="${d}" opacity=".5"/>`;}
  if(kind==='camo'){w=h=40;body=`<path d="M2 6C8 0 16 4 14 10C12 16 4 14 2 6Z" fill="${d}" opacity=".6"/><path d="M22 20C30 14 38 20 34 28C30 34 20 30 22 20Z" fill="${d}" opacity=".6"/><path d="M8 26C12 22 18 26 16 32C14 36 6 34 8 26Z" fill="${l}" opacity=".5"/>`;}
  C.pats[id]=`<pattern id="${id}" width="${w}" height="${h}" patternUnits="userSpaceOnUse">${body}</pattern>`;return id;}
// light from upper-left-front; shade band on the far side of any lathe
const LIGHT_AL=-0.75;
function latheShade(S,yaw,O,col,y0,y1,pitch=0,C0=[0,0,0],off=0){
  if(C.style==='ink')return'';const term=LIGHT_AL+Math.PI/2+.35-(-yaw)*0; // world α of the terminator
  const ys=[];const n=10;for(let i=0;i<=n;i++)ys.push(lerp(y0,y1,i/n));
  const edge=ys.map(y=>[term-yaw,y]);const far=ys.slice().reverse().map(y=>[term-yaw+1.9,y]);
  const pts=decal(S,[...edge,...far],off,yaw,O,pitch,C0);return`<path d="${smooth(pts,true,.3)}" fill="${col}" opacity=".9"/>`;}

// ---------- rig ----------
function rigFor(s){
  const A={kid:{H:450,hs:1.34,leg:.45,neck:8},teen:{H:570,hs:1.2,leg:.53,neck:12},adult:{H:650,hs:1.14,leg:.55,neck:14},senior:{H:620,hs:1.14,leg:.54,neck:12}}[s.age];
  const SH={classic:{head:1,tw:1,lw:1,leg:1,hand:1.3,shoe:1.18,H:1},noodle:{head:1.06,tw:.82,lw:.6,leg:1.1,hand:1.5,shoe:1.32,H:1.02},chunky:{head:.94,tw:1.4,lw:1.25,leg:.8,hand:1.45,shoe:1.4,H:1},tall:{head:.84,tw:.9,lw:.85,leg:1.18,hand:1.12,shoe:1.15,H:1.08},tiny:{head:1.28,tw:1.02,lw:1.05,leg:.78,hand:1.25,shoe:1.2,H:.86}}[s.shape||'classic'];
  const H=A.H*(s.height||1)*SH.H,hs=A.hs*SH.head,headH=118*hs,B=H-(headH-10)-A.neck;
  const legLen=B*Math.min(.66,A.leg*SH.leg),torso=B-legLen,bw={slim:.9,average:1,round:1.17}[s.build];
  const G={masc:{sw:.6,cw:.55,ww:.47,hw:.46,th:.21},fem:{sw:.48,cw:.48,ww:.37,hw:.53,th:.225},neutral:{sw:.54,cw:.5,ww:.42,hw:.49,th:.215}}[s.body];
  const k=headH*(s.age==='kid'?.9:1),hipY=-legLen,neckY=hipY-torso;
  const kk=118*(s.age==='kid'?.92:1);
  return{H,hs,headH,legLen,torso,hipY,neckY,neck:A.neck,sw:G.sw*kk*(bw*.4+.6)*SH.tw,cw:G.cw*kk*bw*SH.tw,ww:G.ww*kk*bw*(s.build==='round'?1.14:1)*SH.tw,hw:G.hw*kk*bw*Math.sqrt(SH.tw),
    legR:G.th*kk*bw*SH.lw,armW:.2*kk*bw*SH.lw,wristW:.13*kk*Math.max(.8,SH.lw),upper:torso*.47*(SH.leg>1?1.05:1),fore:torso*.42*(SH.leg>1?1.05:1),nr:headH*.11*Math.max(.8,SH.lw),handK:(s.age==='kid'?.85:1)*SH.hand,shoeK:SH.shoe,
    headC:[0,neckY-A.neck-50*hs,0],lean:s.age==='senior'?.06:0};}
let LAT=0;
function torsoSlices(r,s,pad=0,y1){const S0=torsoSlices0(r,s,pad,y1);S0.forEach(q=>{q.x0=(q.y<r.hipY?(r.hipY-q.y)*LAT:0);});return S0;}
function torsoSlices0(r,s,pad=0,y1){const fem=s.body==='fem',y0=r.neckY;const bust=fem&&s.age!=='kid'?1:0;
  const S=[{y:y0-4,a:r.nr+2+pad,b:r.nr+2+pad,z0:-2},{y:y0+6,a:r.sw*.72+pad,b:r.sw*.42+pad,z0:-3},{y:y0+20,a:r.sw+pad,b:r.sw*.5+pad,z0:-3},
    {y:y0+r.torso*.34,a:r.cw+pad,b:r.cw*.6+pad+bust*6,z0:bust*4},{y:y0+r.torso*.64,a:r.ww+pad,b:r.ww*.74+pad,z0:0},
    {y:r.hipY-4,a:r.hw+pad,b:r.hw*.7+pad,z0:-3},{y:r.hipY+14,a:r.hw*.94+pad,b:r.hw*.64+pad,z0:-4},{y:r.hipY+26,a:r.hw*.6+pad,b:r.hw*.42+pad,z0:-3}];
  if(y1!=null){const out=S.filter(q=>q.y<y1);out.push(sliceAt(S,y1));return out;}return S;}
function headSlices(s){const sh=s.face.shape,kid=s.age==='kid';
  if(sh==='box')return[{y:-68,a:30,b:30,z0:-4},{y:-64,a:44,b:40,z0:-4},{y:-54,a:48,b:44,z0:-4},{y:-10,a:49,b:45,z0:-3},{y:30,a:48,b:42,z0:0},{y:46,a:44,b:36,z0:2},{y:54,a:34,b:26,z0:4},{y:57,a:10,b:8,z0:5}];
  if(sh==='bean')return[{y:-70,a:8,b:8,z0:-6},{y:-62,a:30,b:30,z0:-6},{y:-46,a:40,b:40,z0:-5},{y:-20,a:44,b:44,z0:-3},{y:10,a:50,b:46,z0:0},{y:32,a:52,b:44,z0:3},{y:48,a:44,b:34,z0:5},{y:58,a:26,b:20,z0:6},{y:62,a:6,b:6,z0:6}];
  const jaw={round:1,oval:.86,square:1.1,heart:.78}[sh],w={round:1.02,oval:.94,square:1,heart:.98}[sh]*(kid?1.06:1);
  return[{y:-66,a:5,b:5,z0:-4},{y:-60,a:28*w,b:30,z0:-4},{y:-48,a:42*w,b:44,z0:-4},{y:-30,a:47*w,b:48,z0:-4},{y:-10,a:48*w,b:47,z0:-3},
    {y:8,a:46*w,b:44,z0:-1},{y:22,a:43*w*jaw,b:39,z0:1},{y:34,a:36*w*jaw,b:31,z0:3},{y:44,a:(sh==='heart'?20:26)*w*jaw,b:23,z0:5},{y:51,a:(sh==='heart'?8:15)*jaw,b:14,z0:6},{y:55,a:4,b:4,z0:6}];}

// ---------- hands (2D swap drawings) ----------
function handShapes(kind,S){const sh=[],det=[];const dl=shade(S,.3);
  const cap=(a,b,w0,w1)=>ribbon({s:a,c:V2.lerp(a,b,.5),e:b},0,1,w0,w1,'round','round',6);
  sh.push({d:cap([0,-20],[0,-2],14,17),fill:S});
  const palm='M-14-6C-16 4-16 16-13 24C-8 30 8 30 13 24C16 16 16 4 14-6C8-10-8-10-14-6Z';
  if(kind==='open'){sh.push({d:palm,fill:S});[[[-9,20],[-13,44]],[[-1,22],[-1,48]],[[8,20],[12,43]]].forEach(([p,q])=>sh.push({d:cap(p,q,11,10),fill:S}));sh.push({d:cap([-12,4],[-26,16],11,10),fill:S});
    det.push(ln('M-5 26L-6 34M3 27L3 34',1.4,dl));}
  else if(kind==='relax'){sh.push({d:palm,fill:S});[[[-8,20],[-10,40]],[[0,22],[0,44]],[[8,20],[9,39]]].forEach(([p,q])=>sh.push({d:cap(p,q,10.5,9.5),fill:S}));sh.push({d:cap([-12,2],[-18,18],10.5,9.5),fill:S});det.push(ln('M-4 24L-5 38M4 24L4.5 37',1.4,dl));}
  else if(kind==='fist'){sh.push({d:'M-15-6C-17 6-16 22-12 28C-6 33 8 33 13 28C17 22 17 6 15-6C8-10-8-10-15-6Z',fill:S});sh.push({d:cap([12,0],[16,18],11,10),fill:S});det.push(ln('M-11 14H6M-11 21H6',1.5,dl));}
  else if(kind==='peace'){sh.push({d:palm,fill:S});sh.push({d:cap([-6,20],[-14,46],11,10),fill:S});sh.push({d:cap([4,20],[8,48],11,10),fill:S});sh.push({d:cap([13,6],[4,18],11,10),fill:S});}
  return{sh,det:det.join('')};}

// ---------- the head (drawn in its own rotation: body yaw + head yaw, head pitch) ----------
function drawHead(s,r,a,O,yaw,pitch){
  const S=headSlices(s),F=s.face,skin=s.skin,hc=s.hair.color,kid=s.age==='kid',old=s.age==='senior',st=s.hair.style;
  const P=(al,y,off=0)=>lathePt(S,al,y,off,yaw,O,pitch),D=(pts,off=0)=>decal(S,pts,off,yaw,O,pitch);
  const ring=(n,fn)=>{const o=[];for(let i=0;i<n;i++)o.push(fn(i/n*TAU));return o;};
  const sample=(off,filter)=>{const pts=[];for(const q of S)for(let i=0;i<30;i++){const al=i/30*TAU;if(filter&&!filter(al,q.y))continue;const p=P(al,q.y,off);pts.push([p.x,p.y]);}return pts;};
  const headD=smooth(hull(sample(0)),true,.55);
  // region of the screen above the visible part of a ring on the (inflated) head: used to clip hair caps and hats
  const above=(fn,off)=>{const N=96,pts=[];for(let i=0;i<N;i++){const al=-Math.PI+i/N*TAU;const p=P(al,fn(al),off);pts.push(p);}
    let st=-1;for(let i=0;i<N;i++){if(pts[i].face>0&&pts[(i+N-1)%N].face<=0){st=i;break;}}
    if(st<0){if(pts[0].face>0)return 'M-5000-5000H5000V5000H-5000Z';return'';}
    const run=[];for(let k=0;k<N;k++){const p=pts[(st+k)%N];if(p.face<=0)break;run.push([p.x,p.y]);}
    if(run.length<2)return'';const A=run[0],B=run[run.length-1],dir=Math.sign(B[0]-A[0])||1;
    const poly=[...run,[B[0]+dir*4000,B[1]],[B[0]+dir*4000,-9000],[A[0]-dir*4000,-9000],[A[0]-dir*4000,A[1]]];
    return 'M'+poly.map(p=>f(p[0])+' '+f(p[1])).join('L')+'Z';};
  const infHull=off=>smooth(hull(sample(off)),true,.55);
  const clipRegionInv=(region,inner)=>{if(!region)return inner;const id=`m${C.id}_${C.n++}`;C.defs.push(`<mask id="${id}" maskUnits="userSpaceOnUse" x="-9000" y="-9000" width="18000" height="18000"><rect x="-9000" y="-9000" width="18000" height="18000" fill="#fff"/><path d="${region}" fill="#000"/></mask>`);return`<g mask="url(#${id})">${inner}</g>`;};
  const clipRegion=(region,inner)=>{if(!region)return'';const id=`c${C.id}_${C.n++}`;C.defs.push(`<clipPath id="${id}"><path d="${region}"/></clipPath>`);return`<g clip-path="url(#${id})">${inner}</g>`;};
  const layers={back:'',mid:'',front:''}; // back = behind the head, front = after
  // --- hair volumes ---
  const inf={buzz:3,short:7,sidepart:8,bowl:10,messy:9,curly:12,afro:26,long:9,bob:11,ponytail:7,pigtails:7,bun:7,bald:3}[st]||8;
  const backLen={buzz:26,short:30,sidepart:32,bowl:34,messy:32,curly:36,afro:44,long:50,bob:44,ponytail:28,pigtails:28,bun:26,bald:30}[st];
  const sway=Math.sin(a.t*2.2)*.12;
  const hairParts=[]; // {z, svg}
  if(st!=='bald'){
    let hp=sample(inf,(al,y)=>{const c=Math.cos(al);return c>.35?y<-26:y<=lerp(backLen,st==='afro'?20:8,clamp(c+.2))});
    if(st==='afro'||st==='curly'){const hh=hull(hp),cx=hh.reduce((s,p)=>s+p[0],0)/hh.length,cy=hh.reduce((s,p)=>s+p[1],0)/hh.length;
      let bumps='';const R=st==='afro'?15:10;for(let i=0;i<hh.length;i+=1){const p=hh[i];bumps+=circ(p[0],p[1],R);}
      layers.back+=part(smooth(hh,true,.55)+bumps,hc);}
    else if(st==='messy'){const hh=hull(hp),cx=hh.reduce((s,p)=>s+p[0],0)/hh.length,cy=hh.reduce((s,p)=>s+p[1],0)/hh.length;
      const sp=hh.map((p,i)=>{const dx=p[0]-cx,dy=p[1]-cy;const top=dy<-10?1:0;const k=1+(i%2?.13:0)*top;return[cx+dx*k,cy+dy*k];});layers.back+=part(smooth(sp,true,.2),hc);}
    else layers.back+=part(smooth(hull(hp),true,.55),hc);
  }
  // long hair sheet / bob / tails / bun: separate 3D volumes sorted by depth
  if(st==='long'||st==='bob'){const len=st==='long'?150:48;const SS=[{y:-20,a:52,b:46,z0:-6},{y:20,a:54,b:44,z0:-10},{y:20+len*.5,a:st==='long'?52:50,b:34,z0:-14},{y:20+len,a:st==='long'?44:48,b:26,z0:-18}];
    const sil=latheSil(SS,yaw,O);const z=rotP([0,0,-16],yaw,pitch)[2];hairParts.push({z,svg:part(smooth(sil,true,.5),hc)});}
  if(st==='ponytail'){const b0=rotP([0,-44,-50],yaw,pitch),b1=rotP([sway*40,20,-70],yaw,pitch),b2=rotP([sway*70,80,-62],yaw,pitch);
    const q=curve([O[0]+b0[0],O[1]+b0[1]],[O[0]+b1[0],O[1]+b1[1]],[O[0]+b2[0],O[1]+b2[1]],.5);hairParts.push({z:b1[2],svg:part(ribbon(q,0,1,30,12),hc)+(b0[2]>-10?'':`<circle cx="${f(O[0]+b0[0])}" cy="${f(O[1]+b0[1])}" r="7" fill="#E4574C"/>`)});}
  if(st==='pigtails')[-1,1].forEach(sd=>{const b0=rotP([sd*50,-10,-14],yaw,pitch),b1=rotP([sd*70,20,-20+sway*30],yaw,pitch),b2=rotP([sd*64,64,-16+sway*50],yaw,pitch);
    const q=curve([O[0]+b0[0],O[1]+b0[1]],[O[0]+b1[0],O[1]+b1[1]],[O[0]+b2[0],O[1]+b2[1]],.4);hairParts.push({z:b1[2]-10,svg:part(ribbon(q,0,1,26,12),hc)+`<circle cx="${f(O[0]+b0[0])}" cy="${f(O[1]+b0[1])}" r="6" fill="#E4574C"/>`});});
  if(st==='bun'){const c=rotP([0,-66,-26],yaw,pitch);hairParts.push({z:c[2]-6,svg:part(circ(O[0]+c[0],O[1]+c[1],22),hc)});}
  // --- ears (behind or in front of the head) ---
  const EK=F.ears||'round';const ear=sd=>{const pts=(EK==='pointy'?[[sd*44,-4,2],[sd*62,-16,-4],[sd*86,-38,-10],[sd*60,12,-6],[sd*46,24,-2],[sd*43,18,0]]:EK==='big'?[[sd*44,-14,2],[sd*62,-18,-2],[sd*72,6,-6],[sd*60,32,-6],[sd*44,28,-2]]:[[sd*44,-8,2],[sd*55,-6,-2],[sd*58,10,-6],[sd*50,26,-6],[sd*43,22,-2]]).map(p=>{const q=rotP([p[0]*(S[4].a/48),p[1],p[2]],yaw,pitch);return[O[0]+q[0],O[1]+q[1],q[2]];});
    const z=pts.reduce((s,p)=>s+p[2],0)/pts.length;return{z,d:smooth(hull(pts.map(p=>[p[0],p[1]])),true,.6)};};
  const ears=[ear(-1),ear(1)];
  let back=layers.back, mid='';
  ears.forEach(e=>{if(e.z<-2)back=part(e.d,skin)+back;});
  mid+=part(headD,skin);
  mid+=clipTo(headD,latheShade(S,yaw,O,shade(skin,.1),-66,56,pitch));
  // --- face decals ---
  const ey=kid?8:4,ea=kid?.4:.37;
  const vis=(al,y)=>P(al,y).face>.12;
  const fe=(al,y)=>clamp((P(al,y).face-.1)/.35); // fade near the silhouette
  if(F.facialHair==='stubble') mid+=`<path d="${smooth(D([...Array(13)].map((_,i)=>[-1.1+i*2.2/12,18+Math.sin(i/12*Math.PI)*16]).concat([[1.1,40],[0,58],[-1.1,40]])),true,.4)}" fill="${hc}" opacity=".16"/>`;
  if(F.facialHair==='beard') mid+=part(smooth(D([...Array(9)].map((_,i)=>[-1.35+i*2.7/8,10+Math.sin(i/8*Math.PI)*16]).concat([[1.3,30],[.8,48],[0,60],[-.8,48],[-1.3,30]]),1),true,.45),hc);
  if(s.acc.includes('blush')||kid||F.eyes==='toon') [-1,1].forEach(sd=>{const al=sd*.62;if(vis(al,22))mid+=`<path d="${smooth(D(ring(14,t=>[al+Math.cos(t)*.17,22+Math.sin(t)*6])),true)}" fill="#F0848A" opacity="${.5*fe(al,22)}"/>`;});
  if(s.acc.includes('freckles'))[-1,1].forEach(sd=>[[.5,16],[.6,19],[.42,20],[.55,24]].forEach(([u,v])=>{const p=P(sd*u,v,.5);if(p.face>.2)mid+=`<circle cx="${f(p.x)}" cy="${f(p.y)}" r="1.5" fill="${shade(skin,.45)}"/>`;}));
  if(old) mid+=ln(D([[-.3,-32],[0,-34],[.3,-32]]),1.4,shade(skin,.35))+[-1,1].map(sd=>vis(sd*.34,32)?ln(D([[sd*.3,26],[sd*.26,36],[sd*.18,42]]),1.4,shade(skin,.3)):'').join('');
  const ink='#231a22',look=a.look||[0,0];
  if(s.acc.includes('eyebags'))[-1,1].forEach(sd=>{const al=sd*ea;if(vis(al,ey))mid+=`<path d="${smooth(D(ring(16,t=>[al+Math.cos(t)*.3,ey+2+Math.sin(t)*16]),.2),true)}" fill="${shade(skin,.28)}" opacity="${.75*fe(al,ey)}"/>`;});
  const eyeStyle=a.expr==='happy'?'happy':F.eyes;
  [-1,1].forEach(sd=>{const al=sd*ea;if(!vis(al,ey))return;const k=fe(al,ey);const la=al+look[0]*.12,ly=ey+look[1]*3;
    if(a.blink||eyeStyle==='happy'){mid+=ln(D(a.blink?[[al-.14,ey],[al,ey+3],[al+.14,ey]]:[[al-.14,ey+2],[al,ey-6],[al+.14,ey+2]]),2.8,ink,k);return;}
    if(eyeStyle==='dot'){const rr=kid?1.2:1;mid+=`<path d="${smooth(D(ring(12,t=>[la+Math.cos(t)*.1*rr,ly+Math.sin(t)*5.6*rr])),true)}" fill="${ink}" opacity="${k}"/>`;const h=P(la+.03,ly-2.2,1);mid+=`<circle cx="${f(h.x)}" cy="${f(h.y)}" r="1.7" fill="#fff" opacity="${k}"/>`;}
    if(eyeStyle==='toon'){const E2=kid?1.12:1;mid+=`<path d="${smooth(D(ring(18,t=>[al+Math.cos(t)*.25*E2,ey+Math.sin(t)*14*E2]),.5),true)}" fill="#fff" stroke="${ink}" stroke-width="2.6" opacity="${k}"/>`;
      const lx=clamp(look[0],-1,1)*.1,lyy=clamp(look[1],-1,1)*4;mid+=`<path d="${smooth(D(ring(14,t=>[al+lx+Math.cos(t)*.16*E2,ey+2+lyy+Math.sin(t)*9*E2]),1),true)}" fill="${F.eyeColor}" opacity="${k}"/><path d="${smooth(D(ring(12,t=>[al+lx+Math.cos(t)*.1*E2,ey+2+lyy+Math.sin(t)*5.8*E2]),1.2),true)}" fill="${ink}" opacity="${k}"/>`;const h=P(al+lx+.06,ey-2+lyy,1.5),h2=P(al+lx-.05,ey+6+lyy,1.5);mid+=`<circle cx="${f(h.x)}" cy="${f(h.y)}" r="3" fill="#fff" opacity="${k}"/><circle cx="${f(h2.x)}" cy="${f(h2.y)}" r="1.5" fill="#fff" opacity="${k}"/>`+ln(D([[al-.24*E2,ey-6],[al,ey-15*E2],[al+.24*E2,ey-6]],.6),3.2,ink,k);}
    if(eyeStyle==='almond'){const up=[...Array(9)].map((_,i)=>{const u=-1+i/4;return[al+u*.2,ey-Math.cos(u*Math.PI/2)*8+1];}),dn=[...Array(9)].map((_,i)=>{const u=1-i/4;return[al+u*.2,ey+Math.cos(u*Math.PI/2)*6+1];});
      mid+=`<path d="${smooth(D([...up,...dn]),true,.3)}" fill="#fff" opacity="${k}"/><path d="${smooth(D(ring(12,t=>[la+Math.cos(t)*.1,ly+Math.sin(t)*4.8]),.5),true)}" fill="${F.eyeColor}" opacity="${k}"/><path d="${smooth(D(ring(10,t=>[la+Math.cos(t)*.05,ly+Math.sin(t)*2.4]),.6),true)}" fill="${ink}" opacity="${k}"/>`+ln(D(up),2.6,ink,k)+ln(D([[al+sd*.2,ey-1],[al+sd*.28,ey-5]]),2,ink,k);}
    if(eyeStyle==='sleepy'){mid+=`<path d="${smooth(D(ring(12,t=>[la+Math.cos(t)*.1,ly+1+Math.sin(t)*5]),.3),true)}" fill="${ink}" opacity="${k}"/>`+`<path d="${smooth(D([[al-.18,ey-10],[al+.18,ey-10],[al+.18,ey-1],[al,ey],[al-.18,ey-1]]),true,.2)}" fill="${skin}" opacity="${k}"/>`+ln(D([[al-.16,ey-1],[al,ey+1],[al+.16,ey-1]]),2.6,ink,k);}
  });
  // brows
  const bc=mix(hc,'#1a1414',.35),by=ey-(F.eyes==='toon'?24:16);
  const BR={soft:[2.8,[0,-4,-1]],thick:[5.2,[0,-3,0]],arched:[3,[1,-7,-1]],flat:[3.6,[0,0,0]]};
  if(F.brows!=='none')[-1,1].forEach(sd=>{const al=sd*ea;if(!vis(al,by))return;const[w,h]=BR[F.brows];const ang=a.expr==='angry'?4:0;
    mid+=ln(D([[al-sd*.17,by+h[0]+ang],[al,by+h[1]],[al+sd*.17,by+h[2]-ang]]),w*fe(al,by)+.5,bc);});
  // nose: a small 3D hull that sticks out in profile
  const nz=sliceAt(S,16),nS={button:[.8,5],small:[.6,3],round:[1.15,6],long:[.9,12],pointy:[.8,14],bulb:[1.6,12]}[F.nose];
  const nosePts=[[0,-8,nz.b-3],[0,14,nz.b+nS[1]],[-8*nS[0],16,nz.b-2],[8*nS[0],16,nz.b-2],[0,20,nz.b+1],[-5*nS[0],19,nz.b+2],[5*nS[0],19,nz.b+2]].map(p=>{const q=rotP([p[0],p[1],p[2]+nz.z0],yaw,pitch);return[O[0]+q[0],O[1]+q[1],q[2]];});
  const nf=P(0,14).face;
  if(nf>-.35){const nd=smooth(hull(nosePts.map(p=>[p[0],p[1]])),true,.7);const col=shade(skin,nf>.6?.12:.04);
    if(F.nose==='bulb'){const c=rotP([0,12,nz.b+10+nz.z0],yaw,pitch);mid+=part(smooth(hull(nosePts.map(p=>[p[0],p[1]])),true,.7)+circ(O[0]+c[0],O[1]+c[1],12),mix(skin,'#E06FA6',.35));}
    else mid+=nf>.75?`<path d="${nd}" fill="${col}"/>`:part(nd,skin,{line:lineOf(skin)})+`<path d="${nd}" fill="${shade(skin,.06)}"/>`;}
  if(s.acc.includes('nosering')){const p=P(.14,20,1);if(p.face>.2)mid+=`<circle cx="${f(p.x)}" cy="${f(p.y)}" r="3.3" fill="none" stroke="#E2B53E" stroke-width="1.8"/>`;}
  // mouth
  const my=kid?36:34,mc='#7A2A34',lip=s.acc.includes('lipstick')?'#C8364E':null,m=a.mouth||(a.expr==='happy'?'grin':F.mouth);
  if(F.facialHair==='mustache'||F.facialHair==='beard'){if(vis(0,my-8))mid+=part(smooth(D([[-.34,my-3],[-.2,my-12],[0,my-8],[.2,my-12],[.34,my-3],[.16,my-6],[0,my-5],[-.16,my-6]],1.5),true,.35),hc);}
  if(vis(0,my)){const k=fe(0,my);
    const MO={smile:()=>ln(D([[-.22,my],[0,my+7],[.22,my]]),2.8,lip||mc,k),flat:()=>ln(D([[-.16,my+2],[.16,my+2]]),2.8,lip||mc,k),smirk:()=>ln(D([[-.16,my+2],[.06,my+4],[.2,my-3]]),2.8,lip||mc,k),
      grin:()=>`<path d="${smooth(D([[-.3,my-2],[0,my+1],[.3,my-2],[.22,my+9],[0,my+14],[-.22,my+9]]),true,.4)}" fill="${mc}" opacity="${k}"/><path d="${smooth(D([[-.26,my-1],[0,my+2],[.26,my-1],[.22,my+3],[-.22,my+3]],.3),true,.3)}" fill="#fff" opacity="${k}"/><path d="${smooth(D([[-.12,my+10],[0,my+8],[.12,my+10],[0,my+13]],.3),true)}" fill="#EE6F7C" opacity="${k}"/>`,
      open:()=>`<path d="${smooth(D([[-.2,my-2],[0,my-3],[.2,my-2],[.14,my+9],[0,my+12],[-.14,my+9]]),true,.4)}" fill="${mc}" opacity="${k}"/><path d="${smooth(D([[-.1,my+8],[0,my+6],[.1,my+8],[0,my+11]],.3),true)}" fill="#EE6F7C" opacity="${k}"/>`,
      teeth:()=>{const o=D([[-.36,my-2],[0,my+2],[.36,my-2],[.3,my+10],[0,my+13],[-.3,my+10]]);let t=`<path d="${smooth(o,true,.35)}" fill="#fff" stroke="${ink}" stroke-width="2.4" opacity="${k}"/>`;[-.2,-.07,.07,.2].forEach(u=>t+=ln(D([[u,my-1],[u,my+11]]),1.6,ink,k));return t+ln(D([[-.33,my+4],[0,my+6],[.33,my+4]]),1.6,ink,k);},
      fangs:()=>ln(D([[-.24,my],[0,my+6],[.24,my]]),2.8,mc,k)+[-1,1].map(sd=>`<path d="${smooth(D([[sd*.12,my+3],[sd*.2,my+2],[sd*.16,my+11]]),true,.1)}" fill="#fff" stroke="${ink}" stroke-width="1.4" opacity="${k}"/>`).join(''),
      tongue:()=>ln(D([[-.22,my],[0,my+7],[.22,my]]),2.8,mc,k)+`<path d="${smooth(D([[.02,my+4],[.14,my+4],[.12,my+12],[.06,my+13]],.5),true)}" fill="#EE6F7C" opacity="${k}"/>`};
    mid+=(MO[m]||MO.smile)();
    if(lip&&['smile','flat','smirk'].includes(m)) mid+=`<path d="${smooth(D([[-.2,my+1],[-.08,my-3],[0,my],[.08,my-3],[.2,my+1],[0,my+7]],.3),true,.4)}" fill="${lip}" opacity="${k}"/>`;}
  // front hair cap (a region on the inflated skull above the hairline)
  const HL={
    short:al=>{const c=Math.cos(al);return c>0?lerp(-2,-34,Math.pow(c,1.5))+(Math.abs(al)<.5?-4*Math.cos(al*6):0):lerp(-2,30,-c);},
    sidepart:al=>{const c=Math.cos(al);return c>0?lerp(0,-30,Math.pow(c,1.2))+(al>-.2&&al<.7?10*Math.sin((al+.2)*3.4):0):lerp(0,32,-c);},
    bowl:al=>{const c=Math.cos(al);return c>0?lerp(8,-12,Math.pow(c,.8))+3*Math.sin(al*18):lerp(8,34,-c);},
    messy:al=>{const c=Math.cos(al);return c>0?lerp(0,-22,c)+6*Math.sin(al*14):lerp(0,32,-c);},
    buzz:al=>{const c=Math.cos(al);return c>0?lerp(-6,-36,c):lerp(-6,26,-c);},
    curly:al=>{const c=Math.cos(al);return c>0?lerp(6,-24,c):lerp(6,36,-c);},
    afro:al=>{const c=Math.cos(al);return c>0?lerp(8,-26,c):lerp(8,40,-c);},
    long:al=>{const c=Math.cos(al);return c>0?lerp(34,-36,Math.pow(c,2.2))-(Math.abs(al)<.12?0:0):lerp(34,50,-c);},
    bob:al=>{const c=Math.cos(al);return c>0?lerp(30,-14,Math.pow(c,1.6)):lerp(30,44,-c);},
    ponytail:al=>{const c=Math.cos(al);return c>0?lerp(4,-34,Math.pow(c,1.4)):lerp(4,22,-c);},
    pigtails:al=>{const c=Math.cos(al);return c>0?lerp(6,-34,Math.pow(c,1.4))+(Math.abs(al)<.06?8:0):lerp(6,22,-c);},
    bun:al=>{const c=Math.cos(al);return c>0?lerp(-2,-36,Math.pow(c,1.3)):lerp(-2,22,-c);},
  }[st];
  let front='';
  if(HL){const off=inf*.7,capD=infHull(off);const reg=above(al=>Math.min(HL(al),60),off);
    let inner=part(capD,hc);
    if(C.style!=='ink'){inner+=clipTo(capD,latheShade(S,yaw,O,shade(hc,.18),-70,60,pitch,[0,0,0],off));const hl=D([[-.9,-50],[-.45,-58],[0,-60],[.35,-57]],off+1);inner+=ln(hl,4,tint(hc,.3),.8);}
    front+=clipRegion(reg,inner);
    // outline along the hairline so the fringe edge reads clearly
    if(C.LW){const N=96,seg=[];let cur=[];for(let i=0;i<=N;i++){const al=-Math.PI+i/N*TAU,p=P(al,Math.min(HL(al),60),off);if(p.face>0.02)cur.push([p.x,p.y]);else if(cur.length){seg.push(cur);cur=[];}}if(cur.length)seg.push(cur);
      seg.forEach(sg=>{if(sg.length>1)front+=ln(sg,C.LW,C.lc(hc));});}
    if(st==='curly'||st==='afro'){let bb='';const R=st==='afro'?9:7;for(let i=0;i<=72;i+=3){const al=-Math.PI+i/72*TAU;const p=P(al,Math.min(HL(al),60),off);if(p.face>0)bb+=circ(p.x,p.y,R);}front+=part(bb,hc);}
  } else if(st==='bald'){front+=[-1,1].map(sd=>part(smooth(D([[sd*1.25,-8],[sd*1.9,-10],[sd*2.6,4],[sd*2.6,26],[sd*1.9,26],[sd*1.3,14]],2),true,.4),hc)).join('');}
  ears.forEach(e=>{if(e.z>=-2)front=part(e.d,skin)+`<path d="${e.d}" fill="${shade(skin,.08)}" transform="translate(0 0)"/>`+front;});
  if(s.acc.includes('stitches')&&vis(.2,-30)){front+=ln(D([[-.5,-38],[0,-34],[.6,-40]],1),2.4,ink);[-.4,-.2,0,.2,.4].forEach(u=>front+=ln(D([[u,-42+Math.abs(u)*6],[u,-29+Math.abs(u)*6]],1),2,ink));}
  if(s.acc.includes('horns'))[-1,1].forEach(sd=>{const b0=[sd*26,-58,6],tip=[sd*52,-100,-4];const pts=[[b0[0]-10,b0[1],b0[2]],[b0[0]+10,b0[1],b0[2]],[b0[0],b0[1],b0[2]+10],[b0[0],b0[1],b0[2]-10],[sd*40,-84,2],tip].map(p=>{const q=rotP(p,yaw,pitch);return[O[0]+q[0],O[1]+q[1]];});const d=part(smooth(hull(pts),true,.5),'#F5E6C8');if(rotP(b0,yaw,pitch)[2]>-20)front+=d;else back=d+back;});
  if(s.acc.includes('bolts'))[-1,1].forEach(sd=>{const q=rotP([sd*52,40,-2],yaw,pitch),q2=rotP([sd*66,40,-2],yaw,pitch);const d=part(ribbon({s:[O[0]+q[0],O[1]+q[1]],c:[O[0]+(q[0]+q2[0])/2,O[1]+(q[1]+q2[1])/2],e:[O[0]+q2[0],O[1]+q2[1]]},0,1,12,12,'flat','flat',4),'#9AA3AE')+part(circ(O[0]+q2[0],O[1]+q2[1],8),'#C8CED6');if(q[2]>-10)front+=d;else back=d+back;});
  // earrings
  ears.forEach((e,i)=>{const sd=i?1:-1;const q=rotP([sd*51*(S[4].a/48),28,-4],yaw,pitch);const x=O[0]+q[0],y=O[1]+q[1];
    const add=(s.acc.includes('hoops')?`<circle cx="${f(x)}" cy="${f(y+6)}" r="7" fill="none" stroke="#E2B53E" stroke-width="2.6"/>`:'')+(s.acc.includes('studs')?`<circle cx="${f(x)}" cy="${f(y)}" r="3" fill="#F4F0FF"/>`:'');
    if(add){if(q[2]>=-2)front+=add;else back=add+back;}});
  // glasses (rims on the face surface, temples toward the ears)
  if(s.acc.includes('glasses')||s.acc.includes('squares')||s.acc.includes('sunglasses')){const gc='#2A2230';
    [-1,1].forEach(sd=>{const al=sd*ea;if(P(al,ey).face<-.1)return;const sq=s.acc.includes('squares'),sun=s.acc.includes('sunglasses');
      const rim=D(ring(20,t=>[al+Math.cos(t)*(sq?.3:.28)*(1+.15*Math.pow(Math.abs(Math.cos(t)),6)*(sq?1:0)),ey+Math.sin(t)*(sq?10:12.5)]),4);
      front+=sun?`<path d="${smooth(rim,true,.4)}" fill="#1E1A24" stroke="${gc}" stroke-width="2.6"/>`:`<path d="${smooth(rim,true,.4)}" fill="#fff" fill-opacity=".12" stroke="${gc}" stroke-width="${sq?3:2.6}"/>`;
      const t0=P(al+sd*.3,ey-2,4),t1=P(sd*1.45,ey-4,2);if(t1.face>-.2)front+=ln([[t0.x,t0.y],[t1.x,t1.y]],2.4,gc);});
    if(P(0,ey).face>0)front+=ln(D([[-ea+.28,ey-2],[0,ey-5],[ea-.28,ey-2]],5),2.4,gc);}
  // headwear
  const hcol=s.top.kind!=='none'?s.top.color:'#F2D34F';
  if(s.acc.includes('cap')){const cD=infHull(inf+4),reg=above(()=>-24,inf+4);
    front+=clipRegion(reg,part(cD,hcol)+clipTo(cD,latheShade(S,yaw,O,shade(hcol,.16),-70,-20,pitch,[0,0,0],inf+4)));
    const brim=[];for(let i=0;i<=12;i++){const al=-1+i/6;const q=sliceAt(S,-24);[0,1].forEach(o=>{const R=o?1.75:1.02;const p=rotP([q.a*Math.sin(al)*(o?1.05:1.02),-24+o*2,q.b*Math.cos(al)*R+(o?6:0)],yaw,pitch);brim.push([O[0]+p[0],O[1]+p[1]]);});}
    const bz=rotP([0,-24,60],yaw,pitch)[2];const bd=part(smooth(hull(brim),true,.4),shade(hcol,.1));if(bz>0)front+=bd;else back=bd+back;}
  if(s.acc.includes('beanie')){const bD=infHull(inf+6);front+=clipRegion(above(()=>-16,inf+6),part(bD,'#E4574C',{pat:'stripes'}));
    const band=clipRegion(above(()=>-16,inf+9),'')+'';const bandReg=above(()=>-16,inf+9),bandReg2=above(()=>-30,inf+9);
    if(bandReg&&bandReg2){front+=clipRegion(bandReg,`<g>${clipRegionInv(bandReg2,part(infHull(inf+9),shade('#E4574C',.1)))}</g>`);}
    const pp=rotP([0,-80-inf,0],yaw,pitch);front+=part(circ(O[0]+pp[0],O[1]+pp[1],12),'#F5F1E8');}
  if(s.acc.includes('headband')) front+=ln(D([...Array(15)].map((_,i)=>[-1.5+i*3/14,-38-Math.sin(i/14*Math.PI)*16]),inf+2),7,'#F5F1E8');
  if(s.acc.includes('bow')){const c=P(.5,-50,inf+2);if(c.face>-.3)front+=part(`M${f(c.x)} ${f(c.y)}c-22-20-30 8-4 10ZM${f(c.x)} ${f(c.y)}c22-20 30 8 4 10Z`,'#F2D34F')+part(circ(c.x,c.y+1,6),shade('#F2D34F',.12));}
  if(s.acc.includes('headphones')){front+=ln(D([...Array(15)].map((_,i)=>[-1.57+i*3.14/14,-20-Math.sin(i/14*Math.PI)*44]),inf+6),7,'#2B2D33');
    ears.forEach((e,i)=>{const sd=i?1:-1;const q=rotP([sd*62,8,-2],yaw,pitch);const d=circ(O[0]+q[0],O[1]+q[1],15);if(q[2]>=-6)front+=part(d,'#1FA3A0');else back=part(d,'#1FA3A0')+back;});}
  return{back,mid,front,hairParts,z:0};
}

// ---------- the body ----------
function poseTargets(s,r,a){ // body-local 3D hand targets + hand kinds
  const hy=r.hipY,st=a.stance||s.stance;
  const T={hands:[[-r.sw-20,hy-2,12],[r.sw+20,hy-2,12]],hk:['relax','relax'],hide:[0,0]};
  if(st==='hip'||st==='peace'){T.hands[0]=[-r.ww-10,hy-r.torso*.24,-4];T.hk[0]='fist';}
  if(st==='peace'){T.hands[1]=[r.sw+30,r.neckY-30,18];T.hk[1]='peace';}
  if(st==='pocket'){T.hands=[[-r.hw+4,hy+6,6],[r.hw-4,hy+6,6]];T.hide=[1,1];}
  if(st==='hold'){T.hands[1]=[r.sw*.3,r.neckY+r.torso*.42,r.cw+24];T.hk[1]='fist';}
  if(st==='wave'){T.hands[1]=[r.sw+50+Math.sin(a.t*14)*16,r.neckY-110,18];T.hk[1]='open';}
  return T;}

function render(s,a={}){
  a={t:0,yaw:0,headYaw:0,headPitch:0,...a};
  const r=rigFor(s);C={id:(render.n=(render.n||0)+1),n:0,defs:[],pats:{},style:s.style,LW:s.style==='flat'?0:s.style==='ink'?2.6:2.3,lc:s.style==='ink'?(()=>'#1E1A22'):lineOf};
  const yaw=a.yaw, cy=Math.cos(yaw), sy=Math.sin(yaw);
  const W=p=>{const q=rotP(p,yaw,0);return[q[0],q[1]-(a.hop||0),q[2]];}; // body-local → world
  const skin=s.skin, fem=s.body==='fem', breath=Math.sin(a.t*TAU/3.2);
  const stn0=a.stance||s.stance, cp=a.walk||a.hop?0:1;LAT=cp*(.03+Math.sin(a.t*.7)*.006)*(stn0==='hold'?.6:1);const bx=y=>(y<r.hipY?(r.hipY-y)*LAT:0);
  const items=[]; // {z, svg}
  const O0=[0,-(a.hop||0)];
  // walking (legs + arms swing in z)
  const walk=a.walk?a.t*TAU*0.9:null, sw=walk!=null?Math.sin(walk):0;
  // --- legs ---
  const legs=[0,1].map(i=>{const sd=i?1:-1;const hip=[sd*r.hw*.5,r.hipY+8+cp*sd*5,0];const lift=walk!=null?Math.max(0,Math.sin(walk+(i?Math.PI:0)))*28:0;
    const free=cp&&i===1;const ank=[sd*(r.hw*.55)-(free?r.hw*.14:0),-16-lift-(free?2:0),walk!=null?(i?-1:1)*sw*r.legLen*.28:(free?r.legLen*.05:0)];const d=Math.hypot(ank[0]-hip[0],ank[1]-hip[1],ank[2]-hip[2])*(free?1.035:1.004);
    const k=ik3(hip,ank,d*.51,d*.495,[0,0,1]);return{sd,hip,knee:k.joint,ank:k.end};});
  const btm=s.top.kind==='dress'?{kind:'dress',color:s.top.color,pattern:s.top.pattern}:s.bottom;
  const longLeg=['jeans','trousers','overalls'].includes(btm.kind), shortLeg=btm.kind==='shorts';
  legs.forEach(L=>{const hp=W(L.hip),kn=W(L.knee),an=W(L.ank);const q=curve([hp[0],hp[1]],[kn[0],kn[1]],[an[0],an[1]],.35);
    let g=part(ribbon(q,0,1,r.legR*2,r.legR*1.25),skin);
    if(C.style!=='ink'&&!longLeg) g+=`<path d="${ribbon(q,.05,.98,r.legR*.7,r.legR*.45,'flat','flat',12,r.legR*.55*(cy>=0?1:-1))}" fill="${shade(skin,.09)}"/>`;
    if(longLeg||shortLeg){const t1=longLeg?.94:.36;const lw=r.legR*2+9;g+=part(ribbon(q,-.02,t1,lw,longLeg?r.legR*1.25+10:lw-2,'round','flat'),btm.color,{pat:btm.pattern});
      if(C.style!=='ink')g+=`<path d="${ribbon(q,.02,t1,lw*.34,lw*.28,'flat','flat',12,lw*.3*(cy>=0?1:-1))}" fill="${shade(btm.color,.12)}"/>`;
      if(longLeg){g+=part(ribbon(q,.86,.95,r.legR*1.25+14,r.legR*1.25+14,'flat','flat',4),tint(btm.color,.15));}}
    // foot / shoe: a small 3D hull around the ankle
    const shoe=s.shoes.kind,fw=Math.max(12,r.legR*.9)*r.shoeK*(shoe==='boots'?1.12:1),fl=Math.max(30,r.legR*2.3)*r.shoeK;
    const foot=[[-fw,0,-10],[fw,0,-10],[-fw,-2,fl],[fw,-2,fl],[-fw*.8,-16,-8],[fw*.8,-16,-8],[0,-14,fl*.7],[-fw*.6,0,fl+6],[fw*.6,0,fl+6],[0,-22,0]].map(p=>W([L.ank[0]+p[0],L.ank[1]+16+p[1]+(L.ank[1]+16<0?0:0),L.ank[2]+p[2]]));
    const fd=smooth(hull(foot.map(p=>[p[0],p[1]])),true,.6);
    if(shoe==='barefoot') g+=part(fd,skin);
    else{const infl=foot.map(p=>[p[0],p[1]]);const cx=infl.reduce((s,p)=>s+p[0],0)/infl.length,cyy=infl.reduce((s,p)=>s+p[1],0)/infl.length;
      const big=infl.map(p=>[cx+(p[0]-cx)*1.18,cyy+(p[1]-cyy)*1.12-3]);if(shoe==='hightops'||shoe==='boots'){const up=W([L.ank[0],L.ank[1]-(shoe==='boots'?40:24),L.ank[2]]);big.push([up[0]-fw,up[1]],[up[0]+fw,up[1]]);}
      const sd2=smooth(hull(big),true,.55);g+=part(sd2,s.shoes.color);
      if(shoe==='sneakers'||shoe==='hightops'){const sole=foot.filter((_,i)=>[0,1,2,3,7,8].includes(i)).map(p=>[cx+(p[0]-cx)*1.2,p[1]+1]);const so=sole.concat(sole.map(p=>[p[0],p[1]-6]));g+=part(smooth(hull(so),true,.5),'#F5F1E8');
        const lc=W([L.ank[0],L.ank[1]+6,L.ank[2]+fl*.4]);if(rotP([0,0,1],yaw,0)[2]>-.3)g+=ln([[lc[0]-7,lc[1]-4],[lc[0]+7,lc[1]-4]],2.2,'#F5F1E8')+ln([[lc[0]-7,lc[1]+2],[lc[0]+7,lc[1]+2]],2.2,'#F5F1E8');}
      if(shoe==='boots')g+=ln([[big[0][0],foot[0][1]-3],[big[1][0],foot[1][1]-3]],0,'none');}
    items.push({z:hp[2]+an[2]*.3-4,svg:g});});
  // --- torso, pelvis, garments ---
  const Ob=[0,-(a.hop||0)];
  const lean=r.lean; const tS=torsoSlices(r,s,0).map(q=>({...q,b:q.b,z0:(q.z0||0)+(q.y<r.hipY?(r.hipY-q.y)*lean:0)}));
  // breathing: widen chest slices slightly
  tS.forEach(q=>{if(q.y<r.hipY-20)q.a*=1+breath*.008;});
  let torsoSvg='';
  const tD=smooth(latheSil(tS,yaw,Ob),true,.5);
  torsoSvg+=part(tD,skin)+clipTo(tD,latheShade(tS,yaw,Ob,shade(skin,.1),r.neckY-4,r.hipY+26));
  const topKind=s.top.kind==='none'&&s.body!=='masc'?'crop':s.top.kind==='dress'?'dress':s.top.kind;
  const topCol=s.top.kind==='none'?'#EDEFF5':s.top.color,topPat=s.top.kind==='none'?'plain':s.top.pattern;
  if(s.top.kind==='none'&&!fem){const TD=(pts)=>decal(tS,pts,0,yaw,Ob);torsoSvg+=[-1,1].map(sd=>ln(TD([[sd*.1,r.neckY+r.torso*.33],[sd*.4,r.neckY+r.torso*.38],[sd*.72,r.neckY+r.torso*.34]]),2,shade(skin,.25))).join('');}
  // bottoms: pelvis block
  if(btm.kind!=='dress'&&btm.kind!=='skirt'){const pS=torsoSlices(r,s,3).filter(q=>q.y>=r.neckY+r.torso*.6);const pD=smooth(latheSil(pS,yaw,Ob),true,.5);
    torsoSvg+=part(pD,btm.color,{pat:btm.pattern})+clipTo(pD,latheShade(pS,yaw,Ob,shade(btm.color,.14),pS[0].y,r.hipY+26,0,[0,0,0],3));
    const wb=decal(pS,[...Array(25)].map((_,i)=>[-Math.PI+i/24*TAU,pS[0].y+6]),3,yaw,Ob);torsoSvg+=ln(wb,2,shade(btm.color,.3));}
  // top garment
  const hemY={tee:r.hipY+12,longsleeve:r.hipY+12,tank:r.hipY+8,hoodie:r.hipY+24,shirt:r.hipY+14,sweater:r.hipY+20,dress:r.hipY-2,crop:r.neckY+r.torso*.48}[topKind];
  let gS=null;
  if(topKind!=='none'){gS=torsoSlices(r,s,4,hemY).map(q=>({...q,z0:(q.z0||0)+(q.y<r.hipY?(r.hipY-q.y)*lean:0)}));gS.forEach(q=>{if(q.y<r.hipY-20)q.a*=1+breath*.008;});
    const gD=smooth(latheSil(gS,yaw,Ob),true,.5);torsoSvg+=part(gD,topCol,{pat:topPat})+clipTo(gD,latheShade(gS,yaw,Ob,shade(topCol,.14),r.neckY-4,hemY,0,[0,0,0],4));
    const GD=(pts,off=4)=>decal(gS,pts,off,yaw,Ob),gv=(al,y)=>lathePt(gS,al,y,4,yaw,Ob).face>.1;
    torsoSvg+=ln(GD([...Array(25)].map((_,i)=>[-Math.PI+i/24*TAU,hemY-(topKind==='hoodie'||topKind==='sweater'?12:1)])),2,shade(topCol,.3));
    if(topKind==='shirt'){torsoSvg+=gv(0,r.neckY+30)?ln(GD([[0,r.neckY+10],[0,hemY-2]]),2,shade(topCol,.3)):'';[.25,.45,.65,.85].forEach(k=>{const p=lathePt(gS,.06,lerp(r.neckY+10,hemY,k),5,yaw,Ob);if(p.face>.15)torsoSvg+=`<circle cx="${f(p.x)}" cy="${f(p.y)}" r="2.3" fill="${shade(topCol,.35)}"/>`;});
      [-1,1].forEach(sd=>{if(gv(sd*.3,r.neckY+8))torsoSvg+=part(smooth(GD([[0,r.neckY+12],[sd*.55,r.neckY-2],[sd*.62,r.neckY+10],[sd*.2,r.neckY+26]],6),true,.2),tint(topCol,.55));});}
    if(topKind==='hoodie'){if(gv(0,hemY-40))torsoSvg+=part(smooth(GD([[-.55,hemY-58],[.55,hemY-58],[.45,hemY-22],[-.45,hemY-22]],5),true,.2),shade(topCol,.08));
      const hood=decal(gS,[...Array(25)].map((_,i)=>[-Math.PI+i/24*TAU,r.neckY+(Math.cos(-Math.PI+i/24*TAU)>0?10:-10)]),10,yaw,Ob);torsoSvg+=ln(hood,9,shade(topCol,.1));
      [-1,1].forEach(sd=>{if(gv(sd*.18,r.neckY+30))torsoSvg+=ln(GD([[sd*.14,r.neckY+10],[sd*.16+Math.sin(a.t*3+sd)*.02,r.neckY+34],[sd*.15,r.neckY+48]],6),2.4,'#F5F1E8');});}
    if(topKind==='sweater'&&gv(0,r.neckY+r.torso*.3))torsoSvg+=ln(GD([...Array(9)].map((_,i)=>[-.8+i*.2,r.neckY+r.torso*.3+(i%2?10:0)]),5),4,tint(topCol,.5));
    if(topKind==='dress'||topKind==='crop'||topKind==='tank'){}
  }
  if(btm.kind==='overalls'){const oS=torsoSlices(r,s,6);const OD=(pts)=>decal(oS,pts,6,yaw,Ob);const by=r.neckY+r.torso*.42;
    const bib=OD([[-.55,by],[.55,by],[.62,r.hipY-8],[-.62,r.hipY-8]]);if(lathePt(oS,0,by+20,6,yaw,Ob).face>-.2)torsoSvg+=part(smooth(bib,true,.1),btm.color,{pat:btm.pattern})+part(smooth(OD([[-.3,by+14],[.3,by+14],[.3,by+40],[0,by+48],[-.3,by+40]]),true,.2),tint(btm.color,.15));
    [-1,1].forEach(sd=>{torsoSvg+=ln(OD([[sd*.5,by+2],[sd*.62,r.neckY+18],[sd*1.2,r.neckY+6],[sd*2.4,r.neckY+20],[sd*2.8,by+30]]),9,btm.color);});}
  // outer layer (open jacket)
  const O=s.outer;const oc=O.kind==='denim'?'#4F86C6':O.color;
  if(O.kind!=='none'){const jS=torsoSlices(r,s,8,r.hipY+(O.kind==='cardigan'?30:20)).map(q=>({...q,z0:(q.z0||0)+(q.y<r.hipY?(r.hipY-q.y)*lean:0)}));const jD=smooth(latheSil(jS,yaw,Ob),true,.5);
    torsoSvg+=part(jD,oc)+clipTo(jD,latheShade(jS,yaw,Ob,shade(oc,.14),r.neckY-4,r.hipY+30,0,[0,0,0],8));
    const JD=(pts,off)=>decal(jS,pts,off,yaw,Ob);const y2=r.hipY+(O.kind==='cardigan'?28:18);
    if(lathePt(jS,0,r.neckY+60,9,yaw,Ob).face>-.3){torsoSvg+=part(smooth(JD([[-.3,r.neckY],[.3,r.neckY],[.36,y2],[-.36,y2]],9),true,.15),topKind!=='none'&&topKind!=='crop'?topCol:skin,{pat:topKind!=='none'?topPat:'plain'});
      [-1,1].forEach(sd=>torsoSvg+=part(smooth(JD([[sd*.3,r.neckY-2],[sd*.62,r.neckY+6],[sd*.52,r.neckY+r.torso*.3],[sd*.33,r.neckY+r.torso*.44]],10),true,.15),shade(oc,.12)));}}
  // neck accessories
  const NS=torsoSlices(r,s,topKind!=='none'?6:2);
  if(s.acc.includes('chain')&&lathePt(NS,0,r.neckY+20,4,yaw,Ob).face>0)torsoSvg+=`<path d="${smooth(decal(NS,[...Array(11)].map((_,i)=>[-.7+i*.14,r.neckY+6+Math.sin(i/10*Math.PI)*22]),4,yaw,Ob),false)}" fill="none" stroke="#E2B53E" stroke-width="3" stroke-dasharray="4 2"/>`;
  if(s.acc.includes('pendant')&&lathePt(NS,0,r.neckY+20,4,yaw,Ob).face>0){torsoSvg+=`<path d="${smooth(decal(NS,[...Array(11)].map((_,i)=>[-.6+i*.12,r.neckY+6+Math.sin(i/10*Math.PI)*18]),4,yaw,Ob),false)}" fill="none" stroke="#E2B53E" stroke-width="1.8"/>`;const p=lathePt(NS,0,r.neckY+26,5,yaw,Ob);torsoSvg+=`<circle cx="${f(p.x)}" cy="${f(p.y)}" r="5" fill="#1FA3A0" stroke="#E2B53E" stroke-width="2"/>`;}
  if(s.acc.includes('tie')&&lathePt(NS,0,r.neckY+40,6,yaw,Ob).face>.1)torsoSvg+=part(smooth(decal(NS,[[-.08,r.neckY+8],[.08,r.neckY+8],[.12,r.neckY+r.torso*.6],[0,r.neckY+r.torso*.68],[-.12,r.neckY+r.torso*.6]],7,yaw,Ob),true,.1),'#E4574C',{pat:'stripes'});
  // skirt / dress skirt: a cone lathe over the legs
  if(btm.kind==='skirt'||btm.kind==='dress'){const y0=btm.kind==='dress'?r.hipY-24:r.hipY-22,y1=r.hipY+r.legLen*(btm.kind==='dress'?.44:.38);
    const kS=[{y:y0,a:r.ww+6,b:r.ww*.75+6,z0:0},{y:r.hipY,a:r.hw+8,b:r.hw*.72+8,z0:-2},{y:y1,a:r.hw+34,b:r.hw*.7+28,z0:-2}];const kD=smooth(latheSil(kS,yaw,Ob),true,.35);
    const sk=part(kD,btm.color,{pat:btm.pattern})+clipTo(kD,latheShade(kS,yaw,Ob,shade(btm.color,.14),y0,y1))+ln(decal(kS,[...Array(25)].map((_,i)=>[-Math.PI+i/24*TAU,y1-2]),0,yaw,Ob),2,shade(btm.color,.3));
    items.push({z:6,svg:sk});}
  // backpack (behind)
  if(s.acc.includes('backpack')){const bp=[[-r.sw*.8,r.neckY+22,-r.cw*.55],[r.sw*.8,r.neckY+22,-r.cw*.55],[-r.sw*.8,r.hipY+4,-r.cw*.55],[r.sw*.8,r.hipY+4,-r.cw*.55],[-r.sw*.7,r.neckY+26,-r.cw*1.25],[r.sw*.7,r.neckY+26,-r.cw*1.25],[-r.sw*.7,r.hipY,-r.cw*1.25],[r.sw*.7,r.hipY,-r.cw*1.25]].map(W);
    items.push({z:W([0,0,-r.cw*.9])[2],svg:part(smooth(hull(bp.map(p=>[p[0],p[1]])),true,.35),'#E4574C')});
    if(topKind!=='none'||true)torsoSvg+=[-1,1].map(sd=>{const p=decal(torsoSlices(r,s,6),[[sd*.62,r.neckY+6],[sd*.72,r.neckY+r.torso*.3],[sd*.66,r.neckY+r.torso*.62]],6,yaw,Ob);return ln(p,7,shade('#E4574C',.2));}).join('');}
  items.push({z:0,svg:torsoSvg});
  // --- neck ---
  const nb=W([bx(r.neckY+10),r.neckY+10,0]),nt=W([bx(r.neckY-r.neck-14)*.9,r.neckY-r.neck-14,0]);
  items.push({z:1,svg:part(ribbon({s:[nb[0],nb[1]],c:[(nb[0]+nt[0])/2,(nb[1]+nt[1])/2],e:[nt[0],nt[1]]},0,1,r.nr*2,r.nr*2,'flat','round',4),skin)+`<path d="${ribbon({s:[nt[0],nt[1]],c:[nt[0],nt[1]+6],e:[nt[0],nt[1]+14]},0,1,r.nr*2,r.nr*2,'flat','flat',4)}" fill="${shade(skin,.12)}"/>`,neck:1});
  // --- arms ---
  const T=poseTargets(s,r,a);
  const sleeveT={tee:.36,longsleeve:.96,tank:0,hoodie:.95,shirt:.4,sweater:.95,dress:.08,crop:.0,none:0}[topKind];
  const oSl=O.kind!=='none'?.96:0,slT=Math.max(sleeveT,oSl),slCol=oSl?oc:topCol;
  [0,1].forEach(i=>{const sd=i?1:-1;const sh=[sd*(r.sw-r.armW*.5)+bx(r.neckY+20),r.neckY+20+cp*sd*-3,-3];
    let tgt=T.hands[i].slice();tgt[0]+=bx(tgt[1])*.7;if(walk!=null&&!['wave','peace','hold'].includes(a.stance||s.stance)){tgt[2]+=(i?1:-1)*sw*-r.torso*.35;tgt[1]-=Math.abs(sw)*8;}
    const stn=a.stance||s.stance;const pole=(stn==='hip'||stn==='peace')&&i===0?[sd,0,-.25]:stn==='pocket'?[sd,0,-.3]:[sd*.6,.1,-.7];const k=ik3(sh,tgt,r.upper,r.fore,pole);const S0=W(sh),J=W(k.joint),E=W(k.end);
    const q=curve([S0[0],S0[1]],[J[0],J[1]],[E[0],E[1]],.6);
    const shapes=[{d:ribbon(q,.1,.99,r.armW*2*.62,r.wristW),fill:skin}];let det='';
    const tg=qTan(q,.98),ang=Math.atan2(tg[0],tg[1])*-180/Math.PI;
    const facing=cy*(1)>0?1:-1;const mir=sd*facing;
    if(!T.hide[i]){const {sh:hs,det:hd}=handShapes(T.hk[i],skin);const tf=`translate(${f(E[0])} ${f(E[1])}) rotate(${f(ang)}) scale(${f(-mir*r.handK)} ${f(r.handK)})`;shapes.push(...hs.map(x=>({...x,tf})));det+=`<g transform="${tf}">${hd}</g>`;}
    else det+=ln([[E[0]-r.wristW*.9,E[1]+2],[E[0],E[1]+5],[E[0]+r.wristW*.9,E[1]+2]],2.2,shade(btm.color||skin,.35));
    let g=merged(shapes)+det;
    if(C.style!=='ink')g+=`<path d="${ribbon(q,.12,.95,r.armW*.5,r.wristW*.35,'flat','flat',12,r.armW*.35*(cy>=0?1:-1)*sd*-1)}" fill="${shade(skin,.08)}"/>`;
    if(slT>0){const w0=r.armW*2*.62+11;g+=part(ribbon(q,-.05,slT,w0,slT>.9?r.wristW+12:w0+2,'round','flat'),slCol,{pat:oSl?'plain':topPat});
      if(C.style!=='ink')g+=`<path d="${ribbon(q,0,slT,w0*.32,w0*.26,'flat','flat',12,w0*.3*(cy>=0?1:-1)*sd*-1)}" fill="${shade(slCol,.14)}"/>`;
      if(slT>.9){const p=qAt(q,slT-.05),t=qTan(q,slT-.05),n=[-t[1],t[0]],w=(r.wristW+12)/2;g+=ln([[p[0]+n[0]*w,p[1]+n[1]*w],[p[0]-n[0]*w,p[1]-n[1]*w]],2,shade(slCol,.3));}}
    // joint cover so the shoulder never shows a seam
    const capCol=slT>0?slCol:topKind!=='none'?topCol:skin;g+=`<path d="${circ(S0[0],S0[1],Math.max(1,(slT>0?(r.armW*2*.62+11):r.armW*2*.62)/2-C.LW))}" fill="${capCol}"/>`;
    // wrist accessories
    const wp=qAt(q,.93),wt=qTan(q,.93),wa=Math.atan2(wt[1],wt[0])*180/Math.PI+90;
    if(i===0&&s.acc.includes('bangles')&&slT<.9)g+=[0,1,2].map(kk=>`<ellipse cx="${f(wp[0]-wt[0]*kk*5)}" cy="${f(wp[1]-wt[1]*kk*5)}" rx="${f(r.wristW*.62)}" ry="3" transform="rotate(${f(wa)} ${f(wp[0]-wt[0]*kk*5)} ${f(wp[1]-wt[1]*kk*5)})" fill="none" stroke="${['#E2B53E','#E06FA6','#1FA3A0'][kk]}" stroke-width="3"/>`).join('');
    if(i===1&&s.acc.includes('watch')&&slT<.9)g+=`<g transform="translate(${f(wp[0])} ${f(wp[1])}) rotate(${f(wa)})"><rect x="${f(-r.wristW*.6)}" y="-4" width="${f(r.wristW*1.2)}" height="8" rx="3" fill="#2B2D33"/><rect x="-6" y="-7" width="12" height="14" rx="3" fill="#7FB3E8" stroke="#2B2D33" stroke-width="2"/></g>`;
    if(i===1&&(a.stance||s.stance)==='hold'){const e=E;let pr='';
      if(s.acc.includes('cup'))pr=part(`M${f(e[0]-12)} ${f(e[1]-6)}h26l-3 38q-1 6-6 6h-8q-5 0-6-6Z`,'#F07A8A')+part(`M${f(e[0]-14)} ${f(e[1]-12)}h30v7h-30Z`,'#F5F1E8')+ln([[e[0]+4,e[1]-12],[e[0]+10,e[1]-30]],3,'#F5F1E8');
      else if(s.acc.includes('phone'))pr=part(`M${f(e[0]-12)} ${f(e[1]-20)}h24v44h-24Z`,'#2B2D33')+`<rect x="${f(e[0]-10)}" y="${f(e[1]-16)}" width="20" height="34" rx="2" fill="#7FB3E8"/>`;
      else if(s.acc.includes('book'))pr=part(`M${f(e[0]-24)} ${f(e[1]-22)}h44v52h-44Z`,'#3FBF7F')+`<rect x="${f(e[0]-18)}" y="${f(e[1]-12)}" width="30" height="5" fill="#F5F1E8"/>`;
      g=pr?g.replace(/^/,'')+pr+merged(shapes.slice(1))+det:g;}
    const z=Math.max(J[2],E[2])+r.cw*.75;items.push({z,svg:g,arm:i,handZ:E[2]});});
  // --- head ---
  const hc=W([r.headC[0]+bx(r.headC[1])*.8,r.headC[1],r.headC[2]]);const HO=[hc[0],hc[1]];
  const hy=yaw+a.headYaw,hp=a.headPitch;
  const H=drawHead(s,r,{...a,roll:-LAT*.6},HO,hy,hp);
  const hsT=`translate(${f(HO[0])} ${f(HO[1])}) scale(${f(r.hs)}) translate(${f(-HO[0])} ${f(-HO[1])})`;
  H.hairParts.forEach(p=>items.push({z:p.z+hc[2]-8,svg:`<g transform="${hsT}">${p.svg}</g>`}));
  items.push({z:20,svg:`<g transform="${hsT}">${H.back+H.mid+H.front}</g>`,head:1});
  // sort: painter's algorithm
  items.sort((A,B)=>A.z-B.z);
  // a hand held in front of the face goes last
  const hi=items.findIndex(it=>it.head);items.forEach((it,i)=>{if(it.arm!=null&&it.handZ>30&&i<hi)it.z=99;});items.sort((A,B)=>A.z-B.z);
  let out=`<ellipse cx="0" cy="4" rx="${f(r.hw*2.1)}" ry="13" fill="#1E1A22" opacity=".12"/>`;
  out+=`<g transform="${a.squash?`translate(0 0) scale(${1+a.squash} ${1-a.squash})`:''}">${items.map(i=>i.svg).join('')}</g>`;
  return`<defs>${C.defs.join('')}${Object.values(C.pats).join('')}</defs>`+out;
}

function randomSpec(seed){let x=seed||Math.floor(Math.random()*1e9);const R=()=>{x=(x*1664525+1013904223)%4294967296;return x/4294967296;};const pick=a=>a[Math.floor(R()*a.length)];
  const s=defaults();s.age=pick(['kid','teen','adult','adult','senior']);s.body=pick(CAT.body);s.build=pick(CAT.build);s.skin=pick(CAT.skin);
  s.face={shape:pick(CAT.faceShape),eyes:pick(['dot','dot','toon','almond','sleepy']),eyeColor:pick(CAT.eyeColor),brows:pick(CAT.brows.slice(0,4)),nose:pick(CAT.nose),mouth:pick(['smile','smile','grin','smirk','open']),facialHair:s.body==='masc'&&s.age!=='kid'&&R()<.4?pick(['stubble','mustache','beard','goatee']):'none'};
  const fh=['long','bob','ponytail','pigtails','bun','curly','afro'],mh=['short','sidepart','bowl','messy','buzz','curly','afro'];
  s.hair={style:s.body==='fem'?pick(fh):s.body==='masc'?pick(s.age==='senior'?[...mh,'bald']:mh):pick([...fh,...mh]),color:s.age==='senior'?pick(['#C4C4C4','#EDE3C7','#9A9A9A']):pick(CAT.hairColor.slice(0,8))};
  s.top={kind:pick(['tee','longsleeve','hoodie','shirt','sweater','tank',...(s.body!=='masc'?['dress']:[])]),color:pick(CAT.cloth),pattern:pick(['plain','plain','plain','stripes','dots','hearts','plaid','camo'])};
  s.outer={kind:R()<.3?pick(['jacket','denim','cardigan']):'none',color:pick(CAT.cloth)};
  s.bottom={kind:pick(s.body==='fem'?['jeans','skirt','shorts','overalls','trousers']:['jeans','trousers','shorts','overalls']),color:pick(CAT.cloth),pattern:R()<.2?pick(['plaid','stripes']):'plain'};
  s.shoes={kind:pick(['sneakers','sneakers','hightops','boots','flats']),color:pick(CAT.cloth)};
  const acc=[];if(R()<.4)acc.push(pick(['glasses','squares','sunglasses']));if(R()<.35)acc.push(pick(['cap','beanie','headband','bow','headphones']));if(R()<.3)acc.push(pick(['hoops','studs','nosering']));
  if(R()<.3)acc.push(pick(['chain','pendant']));if(R()<.3)acc.push(pick(['bangles','watch']));if(R()<.2)acc.push('backpack');if(R()<.3)acc.push('freckles');
  s.stance=pick(['relaxed','relaxed','hip','peace','pocket']);s.acc=acc;return s;}

window.CharEngine={CAT,defaults,render,rigFor,randomSpec,mix,shade,tint};
})();
