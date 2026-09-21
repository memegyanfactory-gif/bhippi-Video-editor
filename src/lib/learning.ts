import type { ReferenceFilm } from './ipc';
import type { Program } from './editProgram';
export type LearningSkill = {
  version: 1; id: string; name: string; reference: ReferenceFilm; rights: string;
  goals: string[]; scope: 'personal' | 'project'; projectName: string | null;
  status: 'Analyzed' | 'Reconstructed' | 'Needs Review' | 'Validated' | 'Available';
  evidence: {start:number;end:number;observation:string}[];
  inference: string; confidence: number; durations: number[]; graph: Program;
  limitations: string[]; tags: string[]; maxAttempts: number; attempts: number;
  reconstructionCompId?: string; previewPath?: string; previewJobId?: string;
  validations: {at:string;accepted:boolean;reason:string;preview:string}[];
  outcomes: {at:string;mediaId:string;reason:string}[];
};
export function learnCutRhythm(reference: ReferenceFilm, rights: string, goals: string[]): LearningSkill {
  if (!rights.trim()) throw new Error('Record permission or ownership for this reference.');
  if (!(reference.seconds > 0 && reference.fps > 0)) throw new Error('Import a measured video reference first.');
  const end = Math.min(reference.seconds,30);
  const cuts = [...new Set(reference.cuts.filter(t=>Number.isFinite(t)&&t>0&&t<end))].sort((a,b)=>a-b).slice(0,39);
  const points = [0,...cuts,end];
  const durations = points.slice(1).map((t,i)=>t-points[i]);
  if (durations.some(t=>t<1/reference.fps)) throw new Error('Detected cuts contain subframe segments; review the source first.');
  const id = crypto.randomUUID();
  return {version:1,id,name:reference.name+' — cut rhythm',reference,rights: rights.trim(),goals,scope:'personal',projectName:null,status:'Analyzed',
    evidence:durations.map((_,i)=>({start:points[i],end:points[i+1],observation:'Shot interval measured by local scene-change detection.'})),
    inference:'Use these shot durations as an editable cutting recipe. Scene detection is evidence of visual change, not proof of the original edit construction.',
    confidence:cuts.length?0.6:0.2,durations,graph:rhythmProgram(durations,'$media',reference.fps,0),
    limitations:['Automatic analysis measures shot rhythm only; typography, motion, roto, and sound require separate evidence and review.','Scene detection can mistake flashes or camera motion for cuts.','No provider training or weight updates occur.','Analysis is limited to the first 30 seconds and 40 shots.'],tags:['editing','rhythm'],maxAttempts:3,attempts:0,validations:[],outcomes:[]};
}
export function rhythmProgram(durations:number[], mediaId:string, fps:number, sourceStart=0):Program {
  if (!Number.isFinite(fps)||fps<=0||!Number.isFinite(sourceStart)||sourceStart<0) throw new Error('Invalid timebase or source start.');
  if (!durations.length||durations.length>40||durations.some(d=>!Number.isFinite(d)||d<=0))throw new Error('Invalid shot intervals.');
  let cursor=0;
  return {label:'Apply learned cut rhythm',ops:durations.map(duration=>{const frames=Math.max(1,Math.round(duration*fps));const span=frames/fps;const op={op:'place' as const,media:mediaId,at:cursor,in:sourceStart+cursor,duration:span};cursor+=span;return op;})};
}
export function reviewSkill(skill:LearningSkill,accepted:boolean,reason:string):LearningSkill {
  if(skill.status!=='Needs Review'||!skill.previewPath)throw new Error('Render a successful preview before reviewing.');
  if(!reason.trim())throw new Error('Record what you checked or why you rejected it.');
  return {...skill,status:accepted?'Available':'Analyzed',validations:[...skill.validations,{at:new Date().toISOString(),accepted,reason:reason.trim(),preview:skill.previewPath}]};
}

/** Spread shots across different source ranges so the adaptation has actual discontinuities. */
export function adaptRhythmProgram(durations:number[],mediaId:string,fps:number,available:number):Program {
  const program=rhythmProgram(durations,mediaId,fps);
  const required=program.ops.reduce((sum,op)=>sum+('duration'in op?op.duration||0:0),0);
  if(!Number.isFinite(available)||available<required)throw new Error('Target footage is too short.');
  const gaps=durations.length-1;
  if(gaps&&available-required<gaps/fps)throw new Error('Choose longer footage so separated source ranges can create visible cuts.');
  const gapFrames=gaps?Math.floor((available-required)*fps/gaps):0;
  return {...program,label:'Adapt learned cut rhythm',ops:program.ops.map((op,i)=>op.op==='place'?{...op,in:(op.in||0)+i*gapFrames/fps}:op)};
}
