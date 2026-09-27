// Shared, seekable 2D animation. Coordinates are engine pixels, seconds and radians.
// The caller applies root translation; the renderer applies only the local pose.
(function(){
'use strict';
const E=window.CharEngine, TAU=Math.PI*2;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:a));
const mix=(a,b,k)=>a+(b-a)*k, smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
const frac=x=>x-Math.floor(x), copy=o=>JSON.parse(JSON.stringify(o));
const hash=x=>frac(Math.sin(x*127.1+311.7)*43758.5453123);
const entries=[['idle','Breathe',3.6],['wave','Wave',2.4],['point','Point',2.2],['look','Look',2.2],['hop','Hop',1.35],['leap','Leap',1.65],['walk','Walk',3.6],['sneak','Sneak',4],['run','Run',2.6],['celebrate','Celebrate',2.8],['shrug','Shrug',2],['nod','Nod',1.4],['shake','Shake',1.6],['facepalm','Facepalm',2.5],['surprise','Surprise',1.6],['think','Think',3],['type','Type',3],['talk','Talk',2.8],['turn','Turn',1.2]];
const ACTIONS=entries.map(([id,label,duration])=>({id,label,duration}));
const durations=Object.fromEntries(entries.map(([id,,d])=>[id,d]));
const name=a=>({happy:'celebrate',jump:'hop'}[(typeof a==='string'?a:a.do)]||(typeof a==='string'?a:a.do));
function duration(a){if(typeof a==='object'){if(Number.isFinite(a.duration)&&a.duration>0)return a.duration;
    if(name(a)==='talk'&&Array.isArray(a.words)&&a.words.length)return Math.max(.2,...a.words.map(w=>w.end-(a.t||0)));
    if(name(a)==='talk'&&a.text)return Math.max(1.2,String(a.text).trim().split(/\s+/).length/2.7);}
  return durations[name(a)]||2.8;}
function sampleTime(t,timing='smooth',step){t=Math.max(0,Number.isFinite(t)?t:0);const fps=step===1?0:step?30/clamp(step,2,3):timing==='drawn'?12:timing==='film'?24:0;return fps?Math.floor((t+1e-9)*fps)/fps:t;}
function stepTime(t,direction,timing='smooth'){const fps=timing==='drawn'?12:timing==='film'?24:60,now=Math.max(0,Number.isFinite(t)?t:0),index=timing==='smooth'?Math.round(now*fps):Math.floor(now*fps+1e-8);return Math.max(0,index+direction)/fps;}
// Recursive interpolation keeps every numeric channel continuous, including a
// captured interrupted pose. Discrete hand drawings change at the midpoint.
function blend(a,b,k){k=clamp(k);if(k===0)return copy(a);if(k===1)return copy(b);
  function walk(x,y){if(typeof x==='number'&&typeof y==='number')return mix(x,y,k);if(Array.isArray(x)&&Array.isArray(y))return y.map((v,i)=>walk(x[i]??v,v));
    if(x&&y&&typeof x==='object'&&typeof y==='object'){const out={};for(const key of new Set([...Object.keys(x),...Object.keys(y)]))out[key]=walk(x[key]??y[key],y[key]??x[key]);return out;}return k<.5?(x??y):(y??x);}
  return walk(a,b);}
function blinkAt(t,seed){const period=3.7+hash(seed+4)*1.4,phase=frac((t+.6+hash(seed)*1.2)/period)*period;
  if(phase<.075)return smooth(phase/.075);if(phase<.105)return 1;if(phase<.235)return 1-smooth((phase-.105)/.13);return 0;}
function stancePose(s,r,stance,t){const p=E.poseTargets(s,r,{stance,t});return{hands:copy(p.hands),poles:copy(p.poles),handKinds:p.hk.slice(),handHidden:p.hide.slice(),
  feet:[[-r.hw*.55,-16,0],[r.hw*.55,-16,0]],footPitch:[0,0],handRoll:[0,0],shoulderLift:[0,0],lean:.022,hipDrop:1.5,headRoll:0,hairSwing:0,bounce:0,squash:0};}
function rest(s,r,t,stance,energy,secondary,seed){const phase=hash(seed+9)*TAU,breath=Math.sin(t*1.65+phase),weight=Math.sin(t*.78+phase);
  const pose=stancePose(s,r,stance,t);pose.lean+=weight*.011*energy;pose.hipDrop+=breath*1.35*energy;
  pose.headRoll=-weight*.018*energy;pose.hairSwing=(Math.sin(t*.78+phase-.65)*.055+Math.sin(t*1.65+phase-.8)*.025)*secondary;
  pose.shoulderLift=[-breath*1.1*energy,-breath*1.1*energy];pose.hands.forEach((h,i)=>{if(stance==='relaxed'){h[0]+=Math.sin(t*1.65+phase+i*.4)*1.8*energy;h[2]+=Math.sin(t*.78+phase+i)*2*energy;}});
  return{t,yaw:0,headYaw:Math.sin(t*.43+phase)*.035*energy,headPitch:Math.sin(t*1.65+phase-.3)*.015*energy,look:[Math.sin(t*.43+phase)*.09*energy,0],blink:blinkAt(t,seed),mouthOpen:0,mouthWeight:0,pose,root:{x:0,y:0},hand:true,shadow:false,boil:0,rough:0};}
function selectPose(out,s,r,stance,t){const target=E.poseTargets(s,r,{stance,t});out.pose.hands=copy(target.hands);out.pose.poles=copy(target.poles);out.pose.handKinds=target.hk.slice();out.pose.handHidden=target.hide.slice();}
function expression(out,expr){if(expr==='happy'){out.expr='happy';out.mouth='grin';}else if(expr==='closed'){out.blink=1;}else if(expr==='wide'){out.brow='up';out.mouth='o';out.mouthOpen=.8;out.mouthWeight=1;}else if(expr==='determined'){out.brow='down';}else if(expr==='sad'){out.brow='think';out.mouth='flat';out.headPitch=.08;}else if(expr==='unsure'){out.brow='think';out.mouth='smirk';}else if(expr==='side'){out.look=[.7,0];}}
function clip(base,s,r,a,time,energy,secondary){const out=copy(base),p=out.pose,d=duration(a),local=clamp(time-(a.t||0),0,d),u=local/d,id=name(a),sd=a.hand==='left'?-1:1,hand=sd<0?0:1;
  const wave=(hz,phase=0)=>Math.sin(local*TAU*hz+phase),settle=(x,strength=1)=>x<0?0:Math.sin(x*16)*Math.exp(-x*7)*strength;
  // Full-body moves author their arms from neutral. The enclosing clip blend
  // still eases out of, and back into, the character's saved resting stance.
  if(['walk','run','sneak','hop','leap'].includes(id))selectPose(out,s,r,'relaxed',local);
  if(id==='wave'){
    const swing=wave(2.15)*smooth(local/.38),lift=r.neckY-66;
    p.hands[hand]=[sd*(r.sw+42+swing*20*energy),lift+Math.cos(local*TAU*2.15)*5,r.cw*.25];p.poles[hand]=[sd,.1,-.2];p.handKinds[hand]='open';p.handHidden[hand]=0;
    p.handRoll[hand]=swing*.23;p.lean-=sd*.026*energy;p.headRoll+=sd*.07*energy;out.headYaw+=sd*.055;out.brow='up';out.mouth='smile';p.hairSwing+=wave(2.15,-.75)*.07*secondary;
  }else if(id==='hop'||id==='leap'){
    const big=id==='leap',flight0=.2,flight1=.73,height=r.H*(big?.255:.145)*energy,crouch=r.legLen*(big?.15:.1);
    if(u<flight0){const k=smooth(u/flight0);p.hipDrop+=crouch*k;p.squash=.055*k;p.hands.forEach((h,i)=>{h[0]+=(i?1:-1)*12*k;h[2]-=26*k;});out.headPitch+=.07*k;}
    else if(u<flight1){const v=(u-flight0)/(flight1-flight0),arc=4*v*(1-v),tuck=Math.sin(v*Math.PI),crouchRemain=1-smooth(v/.18),armUp=smooth(v/.27)*(1-smooth((v-.68)/.32));
      out.root.y=-height*arc;p.hipDrop+=crouch*crouchRemain-6*tuck;p.squash=.055*crouchRemain-.055*tuck;p.feet.forEach((f,i)=>{f[1]-=(big?38:24)*tuck;f[2]+=(i?1:-1)*16*tuck;});p.footPitch=[-.12*tuck,-.12*tuck];
      p.hands=p.hands.map((h,i)=>[h[0]+(i?1:-1)*(12*crouchRemain+r.torso*.22*armUp),mix(h[1],r.neckY+r.torso*.28,armUp),h[2]-26*crouchRemain+(r.cw*.15-h[2])*armUp]);
      if(armUp>.2){p.handKinds=['open','open'];p.handHidden=[0,0];}out.headPitch+=.07*crouchRemain-.065*tuck;p.hairSwing+=Math.sin(v*TAU)*tuck*.32*secondary;}
    else{const v=(u-flight1)/(1-flight1),k=Math.sin(Math.PI*v)*Math.exp(-v*1.3);p.hipDrop+=r.legLen*.14*k;p.squash=.095*k;p.hands.forEach(h=>{h[1]-=14*k;});p.headRoll+=settle((u-flight1)*d,.045);p.hairSwing+=settle((u-flight1)*d,.32)*secondary;}
  }else if(['walk','run','sneak'].includes(id)){
    const run=id==='run',sneak=id==='sneak',hz=run?1.65:sneak?.57:.92,stride=r.legLen*(run?.265:sneak?.14:.21)*energy,lift=(run?52:sneak?17:34)*r.H/650*energy,contact=run?.43:.62;
    const gait=local*hz,sw=Math.sin(gait*TAU);p.hipDrop+=(sneak?22:run?5:3)+Math.cos(gait*TAU*2)*(run?4:2)*energy;p.lean+=(run?.065:sneak?.04:.01)*energy;
    p.headRoll=-sw*(run?.035:.02);out.headPitch+=sneak?.08:run?-.045:0;
    p.feet=p.feet.map((foot,i)=>{const ph=frac(gait+i*.5);let z,y=-16,pitch=0;
      if(ph<contact){const v=ph/contact;z=mix(stride,-stride,v);pitch=v<.13?mix(-.1,0,v/.13):v>.8?(v-.8)*.7:0;}
      else{const v=(ph-contact)/(1-contact);z=mix(-stride,stride,smooth(v));y-=Math.pow(Math.sin(Math.PI*v),1.35)*lift;pitch=-.18*Math.sin(Math.PI*v);}
      p.footPitch[i]=pitch;return[foot[0],y,z];});
    p.hands.forEach((h,i)=>{const sign=i?1:-1;h[2]-=sign*sw*r.torso*(run?.31:.2)*energy;h[1]-=run?r.torso*.27:sneak?r.torso*.3:Math.abs(sw)*6;h[0]+=sign*(run?12:sneak?6:3);});
    p.handKinds=run?['fist','fist']:sneak?['relax','relax']:p.handKinds;p.handHidden=[0,0];p.hairSwing+=(Math.sin(gait*TAU-.8)*.12+Math.sin(gait*TAU*2-.6)*.08)*(run?1.7:1)*secondary;
  }else if(id==='celebrate'){
    const beat=Math.max(0,Math.sin((local-.2)*TAU*1.35)),rise=smooth(local/.45);p.hands=p.hands.map((h,i)=>[(i?1:-1)*(r.sw+42),r.neckY-66-30*beat,r.cw*.15]);p.poles=[[-1,.1,-.3],[1,.1,-.3]];p.handKinds=['open','open'];p.handHidden=[0,0];out.root.y=-beat*28*energy*rise;p.hipDrop+=7*(1-beat);p.squash=(1-beat)*.035-beat*.025;p.headRoll=wave(.8)*.085*energy;p.hairSwing+=wave(1.35,-.6)*.22*secondary;out.expr='happy';out.mouth='grin';
  }else if(id==='point'){
    const to=Array.isArray(a.to)?a.to:[sd*r.H*.65,r.neckY+10],shoulder=[sd*r.sw,r.neckY+20],dx=to[0]-shoulder[0],dy=to[1]-shoulder[1],l=Math.hypot(dx,dy)||1,reach=(r.upper+r.fore)*.91;
    p.hands[hand]=[shoulder[0]+dx/l*reach,shoulder[1]+dy/l*reach,r.cw*.2];p.poles[hand]=[sd,.65,-.35];p.handKinds[hand]='point';p.handHidden[hand]=0;out.headYaw=clamp(to[0]/r.H,-.7,.7);out.look=[clamp(to[0]/r.H,-1,1),clamp((to[1]-r.headC[1])/r.H,-1,1)];p.headRoll=-sd*.055;p.lean+=sd*.025;
  }else if(id==='look'){
    const to=Array.isArray(a.to)?a.to:[sd*r.H*.5,r.headC[1]],x=clamp(to[0]/r.H,-1,1),y=clamp((to[1]-r.headC[1])/r.H,-1,1);out.look=[x,y];out.headYaw=x*.65;out.headPitch=y*.28;p.headRoll=-x*.04;
  }else if(id==='shrug'){selectPose(out,s,r,'shrug',local);p.shoulderLift=[-10,-10];p.headRoll=wave(.55)*.09;out.brow='up';out.mouth='smirk';}
  else if(id==='think'||id==='facepalm'){
    selectPose(out,s,r,'think',local);out.headPitch=id==='facepalm'?.13:-.055;out.headYaw=.15;p.headRoll=id==='facepalm'?-.12:.075;out.brow='think';out.mouth='flat';
    if(id==='facepalm'){p.hands[1]=[r.sw*.05,r.headC[1]-10,r.cw+44];p.handKinds[1]='open';p.handHidden[1]=0;out.blink=.92;p.lean-=.028;}
    if(a.hand==='left'){p.hands=p.hands.slice().reverse().map(h=>[-h[0],h[1],h[2]]);p.poles=p.poles.slice().reverse().map(v=>[-v[0],v[1],v[2]]);p.handKinds.reverse();p.handHidden.reverse();out.headYaw*=-1;p.headRoll*=-1;}
  }else if(id==='nod'){out.headPitch+=wave(1.7)*.16*energy;p.headRoll+=wave(.85)*.025;p.hairSwing+=wave(1.7,-.8)*.13*secondary;}
  else if(id==='shake'){out.headYaw+=wave(1.85)*.25*energy;p.headRoll-=wave(1.85)*.045;p.hairSwing+=wave(1.85,-.7)*.22*secondary;}
  else if(id==='surprise'){
    const anticipation=Math.sin(clamp(u/.24)*Math.PI),snap=smooth(clamp((u-.12)/.14)),rebound=settle(Math.max(0,local-d*.28),.06);p.hipDrop+=12*anticipation-6*snap;p.squash=.035*anticipation-.035*snap+rebound;
    p.hands=p.hands.map((h,i)=>[(i?1:-1)*(r.sw+35),r.neckY+r.torso*.28,r.cw*.45]);p.handKinds=['open','open'];p.handHidden=[0,0];out.brow='up';out.blink=0;out.mouth='o';out.mouthOpen=.8;out.mouthWeight=1;out.headPitch=-.09;p.hairSwing+=rebound*4*secondary;
  }else if(id==='type'){
    p.hands=[[-r.sw*.38,r.neckY+r.torso*.6+wave(3.8)*3,r.cw+44],[r.sw*.38,r.neckY+r.torso*.6-wave(3.8)*3,r.cw+44]];p.poles=[[-1,.6,-.2],[1,.6,-.2]];p.handKinds=['relax','relax'];p.handHidden=[0,0];out.headPitch=.12;out.look=[0,.35];p.lean+=.035;
  }else if(id==='talk'){
    let speaking=1,phoneme=local*9;
    if(Array.isArray(a.words)&&a.words.length){const word=a.words.find(w=>time>=w.t&&time<=w.end);speaking=word?smooth((time-word.t)/.04)*(1-smooth((time-word.end+.065)/.065)):0;phoneme=word?(time-word.t)*10:0;}
    out.mouthOpen=speaking*(.2+.65*Math.pow(Math.sin(phoneme*Math.PI),2));out.mouthWeight=1;out.headPitch+=wave(1.2)*.025*speaking;p.headRoll+=wave(.65)*.04*energy;
    p.hands[1]=[r.sw+22+wave(.8)*13,r.hipY-r.torso*.3+wave(1.3)*7,r.cw+24];p.poles[1]=[1,.5,-.4];p.handKinds[1]='open';p.handHidden[1]=0;p.hairSwing+=wave(.65,-.7)*.065*secondary;
  }
  return out;
}
function sample(s,options={}){
  const settings={timing:'smooth',energy:1,secondary:1,...s.motion2d,...options.motion},energy=clamp(settings.energy,.2,1.6),secondary=clamp(settings.secondary,0,1.5);
  const t=sampleTime(options.t||0,settings.timing,options.step),seed=Number.isFinite(options.seed)?options.seed:23,r=E.rigFor(s),stance=options.stance||s.stance||'relaxed';
  let out=rest(s,r,t,stance,energy,secondary,seed);if(options.blink===false)out.blink=0;const facing=options.facing===-1?-1:1;out.yaw=facing*.28;
  const actions=(options.actions||[]).filter(a=>a&&typeof a.do==='string').slice().sort((a,b)=>(a.t||0)-(b.t||0));
  const heldExpression=actions.filter(a=>a.do==='expression'&&(a.t||0)<=t).pop();if(heldExpression?.expression)expression(out,heldExpression.expression);
  // Travel is kept independent of the local pose blend, including after a clip ends.
  let rootX=0,rootY=0,yaw=out.yaw;
  for(const a of actions){const id=name(a);if(t<(a.t||0)||!['walk','run','sneak','leap'].includes(id))continue;
    const u=clamp((t-(a.t||0))/duration(a)),travel=id==='leap'?smooth((u-.2)/.53):smooth(u),dx=typeof a.to==='number'?a.to:Array.isArray(a.to)?a.to[0]:0,dy=Array.isArray(a.to)?a.to[1]||0:0;rootX+=dx*travel;rootY+=dy*travel;}
  for(const a of actions){const start=a.t||0;if(t<start)continue;const id=name(a),d=duration(a),local=t-start,u=clamp(local/d);
    if(id==='expression')continue;
    if(['walk','run','sneak','leap'].includes(id)){const dx=typeof a.to==='number'?a.to:Array.isArray(a.to)?a.to[0]:0;
      if(dx&&local<=d){const e=smooth(local/.3)*(1-smooth((local-d+.3)/.3));yaw=mix(yaw,Math.sign(dx)*1.12,e);}}
    if(id==='turn'){const target=clamp(a.amount??(typeof a.to==='number'?a.to:1),-1,1)*1.12;yaw=mix(yaw,target,smooth(u));continue;}
    if(local>d||id==='idle')continue;
    const localAction=['point','look'].includes(id)&&Array.isArray(a.to)?{...a,to:[a.to[0]-rootX,a.to[1]-rootY]}:a;
    const target=clip(out,s,r,localAction,t,energy,secondary),edge=Math.min(.28,d*.19),weight=smooth(local/edge)*(1-smooth((local-d+edge)/edge));
    out=blend(out,target,weight);
  }
  out.root.x+=rootX;out.root.y+=rootY;out.yaw=yaw;
  if(typeof options.blink==='number')out.blink=clamp(options.blink);
  out.pose.hairSwing=clamp(out.pose.hairSwing,-.75,.75);out.pose.squash=clamp(out.pose.squash,-.12,.18);
  // Mouth weight fades the animated drawing over the character's designed mouth.
  out.drawing=Math.floor(t*12);return out;
}
window.CharMotion={ACTIONS,duration,sampleTime,stepTime,sample,blend,blinkAt};
})();
