// ToonKit: the library + director an AI uses to make 3D toon shots.
// A shot is JSON: actors (CharacterSpec + start), beats (actor does a named MOVE from the library),
// camera beats (named CAMERA moves), prop beats (named PROP actions) and fx beats (named FX).
// Everything is a pure function of time, so shots can be scrubbed, previewed and exported frame-exact.
(function(){
const {T,V3,toon,withInk,makeHand,pinchPoint,shared,clamp,lerp}=Toon3D;
// engine dispatch: sculpted glTF characters (Rig3D) when loaded, else the procedural toon builder
const useRig=spec=>!!(window.Rig3D&&Rig3D.ready&&(!spec||spec.engine!=='toon'));
const buildCharacter=spec=>useRig(spec)?Rig3D.buildCharacter(spec):Toon3D.buildCharacter(spec);
const poseCharacter=(C,P)=>C.rig3d?Rig3D.poseCharacter(C,P):Toon3D.poseCharacter(C,P);
const collarPoint=C=>C.rig3d?Rig3D.collarPoint(C):Toon3D.collarPoint(C);
const E={linear:x=>x,inOut:x=>x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2,out:x=>1-Math.pow(1-x,3),in:x=>x*x*x,back:x=>{const c=1.6;return 1+(c+1)*Math.pow(x-1,3)+c*Math.pow(x-1,2);}};
const seg=(t,a,b)=>clamp((t-a)/(b-a));
const spr=(tau,amp,k,d)=>tau<0?0:amp*Math.exp(-d*tau)*Math.cos(k*tau);
const vec=a=>Array.isArray(a)?V3(a[0]||0,a[1]||0,a[2]||0):a.clone();

// ---------------- the move library ----------------
// f(ctx) mutates ctx.P (the pose) and ctx.root ({pos:Vector3, yaw}); ctx = {R, tau, dur, p (params), start ({pos,yaw}), t}
function rest(R){return{pelvisH:R.leg-.02,spine:[0,0],head:[0,0,0],hands:{L:V3(R.sw+.04,R.leg-.04,.05),R:V3(-R.sw-.04,R.leg-.04,.05)},feet:{L:V3(R.hw*.62,.07,.02),R:V3(-R.hw*.62,.07,.04)},expr:'normal',look:[0,0],handPose:{L:[.35,.1,.2,0],R:[.35,.1,.2,0]},squash:1,legScale:1,mouth:null};}
const face=(root,to)=>Math.atan2(to.x-root.x,to.z-root.z);
const MOVES={
  idle:{doc:'Stand and breathe with a slow weight shift and blinks.',params:{},loop:true,f(c){const{P,R,tau}=c;P.pelvisH-=Math.abs(Math.sin(tau*1.9))*.012;P.spine=[.02*Math.sin(tau*1.9),.03*Math.sin(tau*.7)];P.head=[.1*Math.sin(tau*.6),0,.04*Math.sin(tau*.7)];}},
  walk:{doc:'Walk to a floor point at a steady pace, turning to face it.',params:{to:'[x, z] floor point',speed:'m/s (default 1.3)'},travel:true,dur:c=>{const d=Math.hypot(c.p.to[0]-c.start.pos.x,c.p.to[1]-c.start.pos.z);return d/(c.p.speed||1.3);},
    f(c){gait(c,c.p.speed||1.3,1);}},
  run:{doc:'Run to a floor point, leaning forward with big arm swings.',params:{to:'[x, z]',speed:'m/s (default 3.4)'},travel:true,dur:c=>Math.hypot(c.p.to[0]-c.start.pos.x,c.p.to[1]-c.start.pos.z)/(c.p.speed||3.4),f(c){gait(c,c.p.speed||3.4,2);}},
  jump:{doc:'Anticipation crouch, stretched jump, squash on landing, spring settle.',params:{height:'metres (default .7)'},dur:()=>1.4,f(c){const{P,R,tau}=c;const h=c.p.height||.7;
    if(tau<.25){const k=E.out(tau/.25);P.pelvisH-=R.leg*.25*k;P.squash=1-.12*k;P.hands.L.y-=.1*k;P.hands.R.y-=.1*k;}
    else if(tau<.85){const u=(tau-.25)/.6;c.root.pos.y=c.start.pos.y+h*4*u*(1-u);P.squash=1+.18*Math.sin(u*Math.PI);P.hands.L.set(R.sw+.25,R.leg+R.torso+.25,.1);P.hands.R.set(-R.sw-.25,R.leg+R.torso+.25,.1);P.handPose={L:[0,1,0,0],R:[0,1,0,0]};P.expr='happy';P.feet.L.y+=.15*Math.sin(u*Math.PI);P.feet.R.y+=.15*Math.sin(u*Math.PI);}
    else{const s=tau-.85;P.squash=1-spr(s,.3,15,5.5);P.pelvisH-=Math.max(0,spr(s,.22,11,4.5))*R.leg;P.expr='happy';}}},
  'drop-in':{doc:'Falls into frame from above, legs first: legs stretch ~1.6x and touch down before the body, then squash and spring.',params:{from_height:'metres above the floor (default 3.2)',stretch:'leg stretch (default 1.6)'},dur:()=>1.9,
    f(c){const{P,R,tau}=c;const st=c.p.stretch||1.6,T1=.7,T2=.95;
      if(tau<T1){const u=tau/T1;P.pelvisH=lerp(R.leg*st+(c.p.from_height||3.2),R.leg*st,E.in(u));P.legScale=st;P.squash=1.18;P.expr='surprised';P.mouth='o';P.hands.L.set(R.sw+.28,P.pelvisH+R.torso*1.5+Math.sin(tau*24)*.1,.1);P.hands.R.set(-R.sw-.28,P.pelvisH+R.torso*1.5-Math.sin(tau*24)*.1,.1);P.handPose={L:[0,1,0,0],R:[0,1,0,0]};P.feet.L.y+=Math.sin(tau*20)*.04;}
      else if(tau<T2){const u=(tau-T1)/(T2-T1);P.pelvisH=lerp(R.leg*st,R.leg*.58,E.in(u));P.legScale=lerp(st,1,E.out(u));P.expr='happy';}
      else{const s=tau-T2;P.squash=1-spr(s,.34,15,5.5);P.pelvisH=R.leg-.02-Math.max(-.04,spr(s+.05,.3,11,4.5))*R.leg*.9;const arm=spr(s,.5,9,3.5);P.hands.L.y+=.1+arm*.9;P.hands.R.y+=.1+arm*.9;P.expr=s<.8?'happy':'normal';}}},
  land:{doc:'Big squash on contact then a springy settle (use after a fall).',params:{squash:'0..0.5 (default .38)'},dur:()=>1.1,f(c){const{P,R,tau}=c;P.squash=1-spr(tau,c.p.squash||.38,15,5.5);P.pelvisH-=Math.max(0,spr(tau+.05,.28,11,4.5))*R.leg;const a=spr(tau,.5,9,3.5);P.hands.L.y+=.1+a*.8;P.hands.R.y+=.1+a*.8;}},
  wave:{doc:'Wave hello with one hand, happy face.',params:{hand:'"right" | "left"'},dur:()=>1.6,loop:true,f(c){const{P,R,tau}=c;const k=c.p.hand==='left'?'L':'R',sd=k==='L'?1:-1;const w=seg(tau,0,.2);P.hands[k]=P.hands[k].clone().lerp(V3(sd*(R.sw+.28),R.leg+R.torso+.3,.2),w);P.hands[k].x+=Math.sin(tau*16)*.1*w;P.handPose[k]=[0,.8,0,0];P.expr='happy';P.head=[-sd*.12*w,0,sd*.06*w];}},
  point:{doc:'Point at a world point and look at it.',params:{at:'[x, y, z]',hand:'"right" | "left"'},dur:()=>1.5,f(c){const{P,R,tau}=c;const at=vec(c.p.at||[2,1.4,0]);const k=c.p.hand==='left'?'L':'R',sd=k==='L'?1:-1;const w=E.back(seg(tau,0,.3));
    const local=at.clone().sub(c.root.pos).applyAxisAngle(V3(0,1,0),-c.root.yaw);const dir=local.clone().sub(V3(sd*R.sw,R.leg+R.torso,0)).normalize();
    P.hands[k]=P.hands[k].clone().lerp(V3(sd*R.sw,R.leg+R.torso-.05,0).addScaledVector(dir,R.upper+R.fore-.05),w);P.handPose[k]=[.9,0,.4,0];P.head=[clamp(Math.atan2(local.x,local.z),-.9,.9)*w,-.2*w];P.look=[Math.sign(local.x)*w,-.3*w];}},
  shrug:{doc:'Shoulders up, palms out, one brow up.',params:{},dur:()=>1.4,f(c){const{P,R,tau}=c;const w=E.back(seg(tau,0,.3))*(1-seg(tau,1.1,1.4));P.hands.L.lerp(V3(R.sw+.45,R.leg+R.torso*.45,.25),w);P.hands.R.lerp(V3(-R.sw-.45,R.leg+R.torso*.45,.25),w);P.handPose={L:[0,1,.2,0],R:[0,1,.2,0]};P.head=[0,.08*w,.15*w];P.expr='normal';P.spine=[0,0];}},
  cheer:{doc:'Arms up with little celebration hops.',params:{},dur:()=>2,loop:true,f(c){const{P,R,tau}=c;const b=Math.abs(Math.sin(tau*6));c.root.pos.y=c.start.pos.y+b*.12;P.squash=1+(b-.5)*.1;P.hands.L.set(R.sw+.22,R.leg+R.torso+.4,.1);P.hands.R.set(-R.sw-.22,R.leg+R.torso+.4,.1);P.handPose={L:[.9,0,.4,0],R:[.9,0,.4,0]};P.expr='happy';}},
  surprised:{doc:'A cartoon take: tiny anticipation squash, then a stretched pop with wide eyes and an "o" mouth.',params:{},dur:()=>1.3,f(c){const{P,R,tau}=c;if(tau<.12){P.squash=1-.15*tau/.12;P.pelvisH-=.05;}else{const s=tau-.12;P.squash=1+spr(s,.22,14,4);c.root.pos.y=c.start.pos.y+Math.max(0,spr(s,.12,7,6));P.hands.L.set(R.sw+.4,R.leg+R.torso*.9,.2);P.hands.R.set(-R.sw-.4,R.leg+R.torso*.9,.2);P.handPose={L:[0,1,0,0],R:[0,1,0,0]};}P.expr='surprised';P.mouth='o';}},
  'look-at':{doc:'Turn the head (and eyes) toward a world point.',params:{at:'[x, y, z]'},dur:()=>1.2,f(c){const{P}=c;const at=vec(c.p.at||[0,3,0]);const local=at.clone().sub(c.root.pos).applyAxisAngle(V3(0,1,0),-c.root.yaw);const w=E.out(seg(c.tau,0,.35));const up=Math.atan2(local.y-1.5,Math.hypot(local.x,local.z));
    P.head=[clamp(Math.atan2(local.x,local.z),-1,1)*w,clamp(-up,-.7,.5)*w];P.look=[Math.sign(local.x)*w,clamp(-up*1.5,-1,1)*w];}},
  dance:{doc:'A bouncy groove on the beat: bob, hip sway, arms pumping.',params:{bpm:'beats per minute (default 120)'},dur:()=>4,loop:true,f(c){const{P,R,tau}=c;const b=(c.p.bpm||120)/60*Math.PI;const s=Math.sin(tau*b);P.pelvisH-=Math.abs(s)*.08;P.spine=[.05,.12*s];P.head=[.2*s,.05,-.1*s];
    P.hands.L.set(R.sw+.2,R.leg+R.torso*.6+Math.max(0,s)*.35,.25);P.hands.R.set(-R.sw-.2,R.leg+R.torso*.6+Math.max(0,-s)*.35,.25);P.handPose={L:[.9,0,.4,0],R:[.9,0,.4,0]};P.feet.L.y+=Math.max(0,s)*.1;P.feet.R.y+=Math.max(0,-s)*.1;P.expr='happy';}},
  spin:{doc:'Spin in place with arms out.',params:{turns:'number (default 1)'},dur:c=>.9*(c.p.turns||1),f(c){const{P,R,tau,dur}=c;c.root.yaw=c.start.yaw+E.inOut(clamp(tau/dur))*TAU*(c.p.turns||1);P.hands.L.set(R.sw+.4,R.leg+R.torso*.8,0);P.hands.R.set(-R.sw-.4,R.leg+R.torso*.8,0);P.handPose={L:[0,1,0,0],R:[0,1,0,0]};P.expr='happy';}},
  'turn-to':{doc:'Turn the whole body to face a floor point.',params:{at:'[x, z]'},dur:()=>.6,f(c){const to=V3(c.p.at[0],0,c.p.at[1]);c.root.yaw=lerp(c.start.yaw,face(c.start.pos,to),E.inOut(clamp(c.tau/.6)));}},
  dangle:{doc:'Hanging from the collar (used while a prop holds the actor): limp legs, flailing arms, worried face.',params:{},loop:true,dur:()=>2,f(c){const{P,R,tau}=c;P.spine=[.28,0];P.feet.L.y-=.05;P.feet.R.y-=.05;const fl=Math.sin(tau*14);P.hands.L.set(R.sw+.3,R.leg+R.torso*.95+fl*.12,.18);P.hands.R.set(-R.sw-.3,R.leg+R.torso*.95-fl*.12,.18);P.handPose={L:[0,1,0,0],R:[0,1,0,0]};P.head=[Math.sin(tau*2.3)*.35,.25];P.look=[Math.sin(tau*2.3),.4];P.expr='surprised';}},
  kick:{doc:'Kick the legs in the air (pairs with dangle).',params:{},loop:true,dur:()=>2,f(c){MOVES.dangle.f(c);const{P,R,tau}=c;const ph=tau*10.5;P.feet.L.set(R.hw*.5,.02+Math.max(0,Math.sin(ph))*.22,.08+Math.sin(ph)*.2);P.feet.R.set(-R.hw*.5,.02+Math.max(0,Math.sin(ph+Math.PI))*.22,.08+Math.sin(ph+Math.PI)*.2);P.expr=Math.floor(tau*1.5)%2?'angry':'surprised';}},
  talk:{doc:'Chatty talking: mouth flaps, small gestures.',params:{},loop:true,dur:()=>2,f(c){const{P,R,tau}=c;P.mouth=['open','smile','o','grin','open'][Math.floor(tau*9)%5];P.hands.R.set(-R.sw-.2,R.leg+R.torso*.4+Math.sin(tau*5)*.08,.3);P.handPose.R=[.1,.6,0,0];P.head=[.1*Math.sin(tau*2),0,.05*Math.sin(tau*3)];}},
};
const TAU=Math.PI*2;
function gait(c,speed,kind){const{P,R,tau}=c;const to=V3(c.p.to[0],0,c.p.to[1]);const from=c.start.pos.clone();const dist=Math.hypot(to.x-from.x,to.z-from.z);const d=Math.min(dist,tau*speed);
  const dir=dist>1e-3?V3(to.x-from.x,0,to.z-from.z).normalize():V3(0,0,1);c.root.pos.copy(from).addScaledVector(dir,d);c.root.yaw=Math.atan2(dir.x,dir.z);
  const moving=d<dist-1e-3;const ph=tau*speed*(kind===2?2.6:3.2);const amp=moving?1:0;const step=(kind===2?.32:.2)*amp;
  P.feet.L.set(R.hw*.55,.07+Math.max(0,Math.sin(ph))*.14*amp*(kind===2?1.6:1),Math.cos(ph)*step);P.feet.R.set(-R.hw*.55,.07+Math.max(0,Math.sin(ph+Math.PI))*.14*amp*(kind===2?1.6:1),Math.cos(ph+Math.PI)*step);
  P.pelvisH-=Math.abs(Math.sin(ph))*.035*amp;c.root.pos.y=0;P.spine=[(kind===2?.28:.05)*amp,0];
  P.hands.L.z=Math.cos(ph+Math.PI)*(kind===2?.35:.18)*amp+.05;P.hands.R.z=Math.cos(ph)*(kind===2?.35:.18)*amp+.05;if(kind===2){P.hands.L.y+=.15;P.hands.R.y+=.15;P.handPose={L:[.9,0,.4,0],R:[.9,0,.4,0]};P.expr='happy';}}

// ---------------- camera library ----------------
const CAMERA={
  set:{doc:'Cut: place the camera instantly.',params:{pos:'[x,y,z]',look:'[x,y,z] or actor id',fov:'degrees'}},
  move:{doc:'Glide to a new position / target / lens over dur seconds.',params:{pos:'[x,y,z]',look:'[x,y,z] or actor id',fov:'degrees',ease:'linear | inOut | out | in | back'}},
  'push-in':{doc:'Move toward the target by a factor of the distance (0.5 = halfway).',params:{amount:'0..0.9',ease:'...'}},
  'pull-out':{doc:'Move away from the target by a factor (1 = double the distance).',params:{amount:'0..3',ease:'...'}},
  orbit:{doc:'Circle around the target by an angle, keeping height and distance.',params:{angle:'degrees (+ = counter-clockwise)',ease:'...'}},
  follow:{doc:'Keep looking at an actor (with an offset) for dur seconds.',params:{actor:'id',offset:'[x,y,z] look offset (default [0,1.1,0])'}},
  'dolly-zoom':{doc:'The "vertigo" move: push in while widening the lens so the subject stays the same size.',params:{amount:'-0.8..0.8 (+ = push in)'}},
  shake:{doc:'A decaying camera shake (impacts).',params:{amp:'metres (default .05)'}},
};
// ---------------- props, fx ----------------
const PROPS={'giant-hand':{doc:'A 10× hand that reaches in, pinches an actor by the jacket collar, lifts, drops or exits.',actions:{enter:'{actor} hover above the actor',grab:'{actor} pinch the collar (the actor dangles from here on)',lift:'{dy} raise by dy metres',lower:'{dy}',drop:'{} let go (actor falls to the floor)',exit:'{} leave the frame'},params:{scale:'default 10',color:'skin hex (default: actor skin)'}}};
const FX={impact:{doc:'Anime impact flash (two frames).'},dust:{doc:'Dust puffs at an actor\'s feet.'},'speed-lines':{doc:'Streaks: "down" for falls, "radial" for zooms.',params:{dir:'down | radial'}},exclaim:{doc:'A popping "!" over an actor\'s head.'},sweat:{doc:'Nervous sweat drops.'},stars:{doc:'Dizzy stars circling the head.'},hearts:{doc:'Floating hearts.'}};

// ---------------- validation (clear errors the AI can fix) ----------------
function validate(shot){const errs=[];if(!shot||typeof shot!=='object')return['The shot must be a JSON object.'];
  const ids=new Set((shot.actors||[]).map(a=>a.id));if(!ids.size)errs.push('Add at least one actor: {"id":"kai","preset":"Kai","at":[0,0]}.');
  (shot.beats||[]).forEach((b,i)=>{if(b.actor&&!ids.has(b.actor))errs.push(`beats[${i}]: unknown actor "${b.actor}".`);if(b.do&&!MOVES[b.do])errs.push(`beats[${i}]: unknown move "${b.do}". Moves: ${Object.keys(MOVES).join(', ')}.`);
    if((b.do==='walk'||b.do==='run')&&!(b.params&&Array.isArray(b.params.to)))errs.push(`beats[${i}]: ${b.do} needs params.to [x, z].`);});
  (shot.camera||[]).forEach((b,i)=>{if(!CAMERA[b.move])errs.push(`camera[${i}]: unknown camera move "${b.move}". Moves: ${Object.keys(CAMERA).join(', ')}.`);});
  (shot.props||[]).forEach((b,i)=>{if(!PROPS[b.prop])errs.push(`props[${i}]: unknown prop "${b.prop}".`);else if(!PROPS[b.prop].actions[b.action])errs.push(`props[${i}]: ${b.prop} has no action "${b.action}". Actions: ${Object.keys(PROPS[b.prop].actions).join(', ')}.`);});
  (shot.fx||[]).forEach((b,i)=>{if(!FX[b.fx])errs.push(`fx[${i}]: unknown fx "${b.fx}". FX: ${Object.keys(FX).join(', ')}.`);});
  return errs;}

// ---------------- the director ----------------
class Director{
  constructor(scene,presets){this.scene=scene;this.presets=presets;this.actors={};this.hands={};}
  load(shot){this.clear();this.shot=JSON.parse(JSON.stringify(shot));const S=this.shot;S.beats=(S.beats||[]).slice().sort((a,b)=>a.t-b.t);S.camera=(S.camera||[]).slice().sort((a,b)=>a.t-b.t);S.props=(S.props||[]).slice().sort((a,b)=>a.t-b.t);S.fx=S.fx||[];
    (S.actors||[]).forEach(a=>{const spec=a.spec||this.presets[a.preset]||Object.values(this.presets)[0];const C=buildCharacter({species:'human',...spec});this.scene.add(C.root);
      const beats=S.beats.filter(b=>b.actor===a.id);const start={pos:V3(a.at?a.at[0]:0,0,a.at?a.at[1]:0),yaw:(a.facing||0)*Math.PI/180};
      // chain start states: each beat starts where the previous move ended
      let st={pos:start.pos.clone(),yaw:start.yaw};beats.forEach((b,i)=>{b._start={pos:st.pos.clone(),yaw:st.yaw};b._dur=this.durOf(C.R,b);const end=Math.min(b._dur,(beats[i+1]?beats[i+1].t:b.t+b._dur)-b.t);const r=this.evalMove(C.R,b,Math.max(0,end));st={pos:r.root.pos.clone().setY(0),yaw:r.root.yaw};});
      this.actors[a.id]={C,beats,start,spec};});
    S.props.forEach(p=>{if(p.prop==='giant-hand'&&!this.hands[p.id||'hand']){const who=this.actors[p.actor]||Object.values(this.actors)[0];const H=makeHand(p.color||(who?who.spec.skin:'#D99A70'),(who?who.C.R.hand:1.2)*(p.scale||10),2.4);this.scene.add(H);this.hands[p.id||'hand']={H,beats:[]};}if(p.prop==='giant-hand')this.hands[p.id||'hand'].beats.push(p);});
    this.duration=S.duration||Math.max(4,...S.beats.map(b=>b.t+(b._dur||1)),...S.camera.map(b=>b.t+(b.dur||0)),...S.props.map(b=>b.t+(b.dur||1)));}
  clear(){Object.values(this.actors).forEach(a=>this.scene.remove(a.C.root));Object.values(this.hands).forEach(h=>this.scene.remove(h.H));this.actors={};this.hands={};}
  durOf(R,b){const M=MOVES[b.do];return b.dur||(M.dur?M.dur({p:b.params||{},start:b._start,R}):2);}
  evalMove(R,b,tau){const P=rest(R);const root={pos:b._start.pos.clone(),yaw:b._start.yaw};const M=MOVES[b.do];const dur=b._dur||2;const tt=M.loop?tau:Math.min(tau,dur);M.f({P,R,tau:tt,dur,p:b.params||{},start:b._start,root});return{P,root};}
  poseActor(id,t){const A=this.actors[id];const R=A.C.R;let r;const bs=A.beats;let i=-1;for(let k=0;k<bs.length;k++)if(bs[k].t<=t)i=k;
    if(i<0){r={P:rest(R),root:{pos:A.start.pos.clone(),yaw:A.start.yaw}};MOVES.idle.f({P:r.P,R,tau:t,p:{},start:A.start,root:r.root});}
    else{r=this.evalMove(R,bs[i],t-bs[i].t);const bl=bs[i].blend??.22;if(i>0&&t-bs[i].t<bl){const q=this.evalMove(R,bs[i-1],t-bs[i-1].t);blendPose(q,r,E.inOut((t-bs[i].t)/bl));r=q;}}
    if(this.override){r.P.head=this.override.head.concat([0]);r.P.look=this.override.look;}
    return r;}
  cameraAt(t){const S=this.shot;let st={pos:V3(0,1.5,7),look:V3(0,1.1,0),fov:40};let shake=0;
    const lookOf=(v,t2)=>typeof v==='string'&&this.actors[v]?this.actorCenter(v,t2):vec(v);
    for(const b of S.camera){if(b.t>t)break;const p=b.params||{};const u=b.dur?clamp((t-b.t)/b.dur):1;const e=(E[p.ease||'inOut']||E.inOut)(u);
      if(b.move==='shake'){const s=t-b.t;shake+=(p.amp||.05)*Math.exp(-s*7);continue;}
      const from={pos:st.pos.clone(),look:st.look.clone(),fov:st.fov};const to={pos:from.pos.clone(),look:from.look.clone(),fov:from.fov};
      if(b.move==='set'||b.move==='move'){if(p.pos)to.pos=vec(p.pos);if(p.look!=null)to.look=lookOf(p.look,t);if(p.fov)to.fov=p.fov;}
      if(b.move==='push-in'||b.move==='pull-out'){const d=from.pos.clone().sub(from.look);to.pos=from.look.clone().addScaledVector(d,b.move==='push-in'?1-(p.amount??.4):1+(p.amount??.8));}
      if(b.move==='orbit'){const d=from.pos.clone().sub(from.look);d.applyAxisAngle(V3(0,1,0),(p.angle??90)*Math.PI/180*e);st={pos:from.look.clone().add(d),look:from.look,fov:from.fov};continue;}
      if(b.move==='follow'){const c=this.actorCenter(p.actor,t).add(vec(p.offset||[0,0,0]));to.look=c;st={pos:from.pos,look:from.look.clone().lerp(c,Math.min(1,u*4)),fov:from.fov};continue;}
      if(b.move==='dolly-zoom'){const d=from.pos.clone().sub(from.look);const L0=d.length(),k=1-(p.amount??.5);to.pos=from.look.clone().addScaledVector(d,k);const h=L0*Math.tan(from.fov*Math.PI/360);to.fov=2*Math.atan(h/(L0*k))*180/Math.PI;}
      if(b.move==='set'){st=to;continue;}
      st={pos:from.pos.clone().lerp(to.pos,e),look:from.look.clone().lerp(to.look,e),fov:lerp(from.fov,to.fov,e)};}
    if(shake){st.pos.x+=Math.sin(t*93)*shake;st.pos.y+=Math.cos(t*71)*shake;}return st;}
  actorCenter(id,t){const A=this.actors[id];if(!A)return V3(0,1,0);const v=V3();A.C.head.getWorldPosition(v);return v.y>0?v.add(V3(0,-.35,0)):V3(0,1.1,0);}
  // evaluate everything at time t (characters on twos when tp is quantised by the caller)
  apply(t){const heldBy={};
    // actor poses
    for(const id in this.actors){const A=this.actors[id],C=A.C;const r=this.poseActor(id,t);const P=r.P;
      C.root.position.copy(r.root.pos);C.root.rotation.set(0,r.root.yaw,0);const s=P.squash||1;C.body.scale.set(1/Math.sqrt(s),s,1/Math.sqrt(s));
      P.blink=(t%3.3)>3.18&&P.expr!=='surprised';poseCharacter(C,P);C.root.updateMatrixWorld(true);}
    // giant hands (and the actors they hold)
    for(const hid in this.hands){const{H,beats}=this.hands[hid];let state={p:V3(7,12,-3),vis:false,grab:0,held:null,dy:0};
      let collarOf=id=>collarPoint(this.actors[id].C);
      for(const b of beats){if(b.t>t)break;const u=clamp((t-b.t)/(b.dur||1));const a=b.actor||Object.keys(this.actors)[0];
        if(b.action==='enter'){state.vis=true;const hov=collarOf(a).add(V3(.05,.55,-.12));state.p=V3(7,12,-3).lerp(hov,E.back(u));}
        if(b.action==='grab'){const c=collarOf(a);state.p=state.p.clone().lerp(c,E.inOut(u));state.grab=E.inOut(u);if(u>=1){state.held=a;state.heldAt=b.t+(b.dur||1);}}
        if(b.action==='lift'||b.action==='lower'){const dy=(b.params&&b.params.dy!=null?b.params.dy:2)*(b.action==='lower'?-1:1);state.dy+=dy*E.inOut(u)-(state._last||0);state._last=0;state.p=state.p.clone();state.p.y+=dy*E.inOut(u);if(u<1){state._pending=true;}}
        if(b.action==='drop'){state.grab=1-E.out(u);if(u>.2){state.dropAt=b.t+.2;state.dropped=state.held;state.held=null;}}
        if(b.action==='exit'){state.p=state.p.clone().lerp(V3(7,12,-3),E.in(u));state.grab=0;if(u>=1)state.vis=false;}}
      H.visible=state.vis;H.userData.pose(.8*state.grab,.9*(1-state.grab),.5*(1-state.grab),state.grab,true);H.rotation.set(-.22,.18,.05);H.position.set(0,0,0);H.updateMatrixWorld(true);
      const off=pinchPoint(H);H.position.copy(state.p).sub(off);H.updateMatrixWorld(true);
      if(state.held){const C=this.actors[state.held].C;heldBy[state.held]=true;const pin=pinchPoint(H);const tau=t-state.heldAt;
        const swx=.3*Math.exp(-1.1*tau)*Math.sin(4.4*tau),swz=.1*Math.exp(-1.3*tau)*Math.sin(3.1*tau+.8);
        const c0=collarPoint(C);C.root.position.add(pin.clone().sub(c0));C.root.updateMatrixWorld(true);C.root.rotation.x+=swx;C.root.rotation.z+=swz;C.root.updateMatrixWorld(true);const c1=collarPoint(C);C.root.position.add(pin.clone().sub(c1));C.root.updateMatrixWorld(true);}
      if(state.dropped&&!state.held){const C=this.actors[state.dropped].C;const fall=t-state.dropAt;if(fall>0){const pin=pinchPoint(H);const c0=collarPoint(C);const y0=pin.y-(c0.y-C.root.position.y);const y=Math.max(0,y0-4.9*fall*fall);C.root.position.y=y;C.root.updateMatrixWorld(true);}}}
    return heldBy;}
}
function blendPose(a,b,k){const A=a.P,B=b.P;const L=(x,y)=>x+(y-x)*k;
  A.pelvisH=L(A.pelvisH,B.pelvisH);A.squash=L(A.squash||1,B.squash||1);A.legScale=L(A.legScale||1,B.legScale||1);A.spine=[L(A.spine[0],B.spine[0]),L(A.spine[1],B.spine[1])];A.head=[L(A.head[0],B.head[0]),L(A.head[1],B.head[1]),L(A.head[2]||0,B.head[2]||0)];
  ['L','R'].forEach(s=>{A.hands[s].lerp(B.hands[s],k);A.feet[s].lerp(B.feet[s],k);A.handPose[s]=A.handPose[s].map((v,i)=>L(v,B.handPose[s][i]));});A.look=[L(A.look[0],B.look[0]),L(A.look[1],B.look[1])];
  if(k>.5){A.expr=B.expr;A.mouth=B.mouth;}a.root.pos.lerp(b.root.pos,k);let dy=b.root.yaw-a.root.yaw;while(dy>Math.PI)dy-=TAU;while(dy<-Math.PI)dy+=TAU;a.root.yaw+=dy*k;}

// ---------------- the AI tool surface ----------------
function catalog(){const m=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,{doc:v.doc,params:v.params||{},...(v.actions?{actions:v.actions}:{})}]));
  return{moves:m(MOVES),camera:m(CAMERA),props:m(PROPS),fx:m(FX),units:'metres; y up; the floor is y=0; actors face +z (toward the default camera) when facing is 0',timing:'characters on twos (12 poses/s), camera on ones'};}
const TOOLS=[
  {name:'list_toon_library',description:'Read the 3D toon library: every move, camera move, prop and FX with its parameters. Call this before writing a shot.',input_schema:{type:'object',properties:{}}},
  {name:'create_character3d',description:'Build or recolour a 3D toon character from a CharacterSpec (the same spec the Character room saves) or a saved name.',input_schema:{type:'object',properties:{name:{type:'string'},spec:{type:'object'}},required:['name']}},
  {name:'direct_shot',description:'Stage and animate a 3D toon shot from a script: actors, timed move beats, camera beats, prop beats and fx. Returns validation errors to fix, or a preview.',input_schema:{type:'object',properties:{shot:{type:'object',properties:{duration:{type:'number'},actors:{type:'array',items:{type:'object',properties:{id:{type:'string'},preset:{type:'string'},spec:{type:'object'},at:{type:'array',items:{type:'number'}},facing:{type:'number'}}}},beats:{type:'array',items:{type:'object',properties:{t:{type:'number'},actor:{type:'string'},do:{type:'string'},params:{type:'object'},dur:{type:'number'},blend:{type:'number'}}}},camera:{type:'array',items:{type:'object',properties:{t:{type:'number'},move:{type:'string'},params:{type:'object'},dur:{type:'number'}}}},props:{type:'array',items:{type:'object',properties:{t:{type:'number'},prop:{type:'string'},action:{type:'string'},actor:{type:'string'},params:{type:'object'},dur:{type:'number'}}}},fx:{type:'array',items:{type:'object',properties:{t:{type:'number'},fx:{type:'string'},actor:{type:'string'},dur:{type:'number'},params:{type:'object'}}}}}}},required:['shot']}},
  {name:'preview_shot',description:'Render stills of the current shot at the given times (seconds) so you can check framing before exporting.',input_schema:{type:'object',properties:{times:{type:'array',items:{type:'number'}}},required:['times']}},
  {name:'export_shot',description:'Render the shot to the timeline as a clip (24 fps, characters on twos).',input_schema:{type:'object',properties:{name:{type:'string'}}}},
];
window.ToonKit={MOVES,CAMERA,PROPS,FX,Director,validate,catalog,TOOLS,E};
})();
