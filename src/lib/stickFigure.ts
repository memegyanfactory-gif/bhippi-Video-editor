import {newComp,newClip,newTrack} from './timeline';
import {uid} from './editor';
import type {Comp,Keyframe} from './types';
export type Point={x:number;y:number};
export type FigureMotion='idle'|'walk'|'wave';
/** Analytic two-bone IK. Targets are clamped inside the reachable annulus. */
export function twoBone(root:Point,target:Point,upper:number,lower:number,bend=1):{joint:Point;end:Point}{
  if(![root.x,root.y,target.x,target.y,upper,lower].every(Number.isFinite)||upper<=0||lower<=0)throw new Error('Invalid limb geometry');
  const dx=target.x-root.x,dy=target.y-root.y,raw=Math.hypot(dx,dy),distance=Math.max(Math.abs(upper-lower)+.001,Math.min(upper+lower-.001,raw));
  const angle=raw<.00001?Math.PI/2:Math.atan2(dy,dx),offset=Math.acos(Math.max(-1,Math.min(1,(upper*upper+distance*distance-lower*lower)/(2*upper*distance))));
  return {joint:{x:root.x+upper*Math.cos(angle+Math.sign(bend||1)*offset),y:root.y+upper*Math.sin(angle+Math.sign(bend||1)*offset)},end:{x:root.x+distance*Math.cos(angle),y:root.y+distance*Math.sin(angle)}};
}
export function figurePose(time:number,motion:FigureMotion,duration:number):Record<string,Point>{
  const moving=motion==='walk',travel=moving?80*(time-duration/2):0;
  const hip={x:travel,y:520+(moving?5*Math.cos(time*4*Math.PI):0)},shoulder={x:travel,y:370+(hip.y-520)};
  const foot=(offset:number)=>{if(!moving)return{x:travel+(offset?60:-60),y:760};const cycle=Math.floor(time+offset),phase=time+offset-cycle,p=Math.max(0,(phase-.6)/.4),ease=p*p*(3-2*p);return{x:80*(cycle-offset-duration/2)+40+80*ease,y:760-50*Math.sin(Math.PI*p)};};
  const left=twoBone(hip,foot(0),125,125,moving?-1:1),right=twoBone(hip,foot(.5),125,125,-1);
  const leftArm=twoBone(shoulder,{x:travel-95-(moving?35*Math.sin(time*2*Math.PI):0),y:525},100,95,1);
  const rightArm=twoBone(shoulder,motion==='wave'?{x:travel+110+25*Math.sin(time*5),y:245}:{x:travel+95+(moving?35*Math.sin(time*2*Math.PI):0),y:525},100,95,1);
  return{hip,shoulder,neck:{x:shoulder.x,y:shoulder.y-27},head:{x:shoulder.x,y:shoulder.y-65},leftKnee:left.joint,leftFoot:left.end,rightKnee:right.joint,rightFoot:right.end,leftElbow:leftArm.joint,leftHand:leftArm.end,rightElbow:rightArm.joint,rightHand:rightArm.end};
}
/** Native shape layers with sampled transform keys, so preview/export use the existing compositor. */
export function makeStickFigure(width:number,height:number,fps:number,motion:FigureMotion,duration=5,color='#ffffff',thickness=12):Comp {
  if(!['idle','walk','wave'].includes(motion)||!Number.isFinite(duration)||duration<1||duration>15||!/^#[0-9a-f]{6}$/i.test(color)||!Number.isFinite(thickness)||thickness<2||thickness>40)throw new Error('Invalid figure settings');
  const comp=newComp({name:'Stick figure · '+motion,width,height,fps});comp.tracks=[];const groupId=uid();
  const bones=[['Neck','shoulder','neck'],['Torso','hip','shoulder'],['Left upper arm','shoulder','leftElbow'],['Left forearm','leftElbow','leftHand'],['Right upper arm','shoulder','rightElbow'],['Right forearm','rightElbow','rightHand'],['Left thigh','hip','leftKnee'],['Left shin','leftKnee','leftFoot'],['Right thigh','hip','rightKnee'],['Right shin','rightKnee','rightFoot'],['Head','head','head']];
  for(const[name,a,b]of bones){const track={...newTrack('video'),name};comp.tracks.push(track);const first=figurePose(0,motion,duration),head=a==='head';const length=head?76:Math.hypot(first[b].x-first[a].x,first[b].y-first[a].y);
    const clip=newClip({trackId:track.id,start:0,duration,name,groupId,source:{type:'shape',shape:head?'ellipse':'rectangle',sides:4,fill:head?null:color,stroke:head?color:null,strokeWidth:head?thickness*height/1080:0,width:(head?76:thickness)*height/1080,height:length*height/1080,cornerRadius:head?0:thickness*height/2160}});
    const x:Keyframe[]=[],y:Keyframe[]=[],rotation:Keyframe[]=[];let previous=0;
    const frames=Math.ceil(duration*fps);
    for(let frame=0;frame<=frames;frame++){const time=Math.min(duration,frame/fps),pose=figurePose(time,motion,duration),p=pose[a],q=pose[b];let angle=head?0:Math.atan2(q.y-p.y,q.x-p.x)*180/Math.PI-90;
      if(frame){while(angle-previous>180)angle-=360;while(angle-previous<-180)angle+=360;}previous=angle;
      x.push({time,value:(p.x+q.x)/2/1080/(width/height),easing:'linear'});y.push({time,value:((p.y+q.y)/2-540)/1080,easing:'linear'});rotation.push({time,value:angle,easing:'linear'});
    }
    clip.keyframes={...clip.keyframes,x,y,rotation};comp.clips.push(clip);
  }
  comp.sourceVideo=comp.tracks[0].id;comp.sourceAudio=null;return comp;
}
