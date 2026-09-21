import {useEffect,useState} from 'react';
import {open,save} from '@tauri-apps/plugin-dialog';
import {api,errorText,fileSrc,type ReferenceFilm} from '../lib/ipc';
import {learnCutRhythm,rhythmProgram,adaptRhythmProgram,reviewSkill,type LearningSkill} from '../lib/learning';
import {runProgram} from '../lib/editProgram';
import {newComp,type AssetMap} from '../lib/timeline';
import type {History} from '../lib/history';
import type {Job,Project} from '../lib/types';
export function LearningWorkspace({project,assets,history,jobs,onClose}:{project:Project;assets:AssetMap;history:History;jobs:Job[];onClose:()=>void}) {
  const [skills,setSkills]=useState<LearningSkill[]>([]),[refs,setRefs]=useState<ReferenceFilm[]>([]),[selected,setSelected]=useState('');
  const [rights,setRights]=useState(''),[reason,setReason]=useState(''),[media,setMedia]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loaded,setLoaded]=useState(false);
  const skill=skills.find(s=>s.id===selected);
  useEffect(()=>{Promise.all([api.learningLoad(),api.refsList()]).then(([s,r])=>{setSkills(s);setRefs(r);setLoaded(true);}).catch(e=>setError(errorText(e)));},[]);
  async function persist(next:LearningSkill[]) {await api.learningSave(next);setSkills(next);}
  async function update(next:LearningSkill){await persist(skills.map(s=>s.id===next.id?next:s));}
  async function act(fn:()=>Promise<void>){setError('');setBusy(true);try{await fn();}catch(e){setError(errorText(e));}finally{setBusy(false);}}
  useEffect(()=>{if(!skill?.previewJobId)return;const job=jobs.find(j=>j.id===skill.previewJobId);if(!job||job.status==='running')return;
    const next={...skill,previewJobId:undefined,status:job.status==='done'?'Needs Review' as const:'Reconstructed' as const,previewPath:job.status==='done'?job.result?.path:undefined};
    void update(next).catch(e=>setError(errorText(e)));
  },[jobs,skill?.previewJobId]);
  async function reconstruct(apply:boolean){
    if(!skill) return;
    if(apply && skill.status!=='Available')throw new Error('Review and accept a rendered reconstruction first.');
    if(!apply && skill.attempts>=skill.maxAttempts)throw new Error('The three-attempt reconstruction budget is exhausted.');
    let asset=assets.get(media);
    if(!apply){const result=await api.libraryImport([skill.reference.source]);asset=result.imported[0]||result.existing[0];}
    if(!asset)throw new Error('Choose imported target footage.');
    if(apply && asset.path===skill.reference.source)throw new Error('Choose different footage to test adaptation.');
    const comp=newComp({name:(apply?'Adapted: ':'Reconstruction: ')+skill.name,width:skill.reference.width,height:skill.reference.height,fps:skill.reference.fps});
    const program=apply?adaptRhythmProgram(skill.durations,asset.id,comp.fps,asset.duration):rhythmProgram(skill.durations,asset.id,comp.fps);
    const required=program.ops.reduce((sum,op)=>sum+('duration' in op?op.duration||0:0),0);
    if(asset.duration<required)throw new Error('The target must contain at least '+required.toFixed(2)+' seconds.');
    const map=new Map(assets);map.set(asset.id,asset);
    const outcome=runProgram(project,map,comp,program);
    if(!outcome.ok)throw new Error(outcome.error);
    history.commit(current=>({...current,comps:[...current.comps,outcome.comp],activeCompId:comp.id,openCompIds:[...current.openCompIds,comp.id],media:current.media.some(m=>m.assetId===asset.id)?current.media:[...current.media,{assetId:asset.id,folderId:null,offline:false}]}),program.label||'Learning reconstruction');
    await update(apply?{...skill,outcomes:[...skill.outcomes,{at:new Date().toISOString(),mediaId:asset.id,reason:'Applied as editable clips; awaiting outcome feedback.'}]}:{...skill,status:'Reconstructed',reconstructionCompId:comp.id,attempts:skill.attempts+1,previewPath:undefined,graph:program});
  }
  const previewJob=jobs.find(j=>j.id===skill?.previewJobId);
  return <div className="learning-overlay" role="dialog" aria-modal="true" aria-label="Learning workspace"><div className="learning-window">
    <header><h2>Learning</h2><button className="btn" onClick={onClose}>Back to editor</button></header>
    <p>Learn a measured cut rhythm from finished reference footage, reconstruct it, review a rendered preview, and apply it to different footage. Media stays local.</p>
    {error&&<p role="alert" className="learning-error">{error}</p>}
    <div className="learning-columns"><aside>
      <label>Reference permission / provenance<input value={rights} onChange={e=>setRights(e.target.value)} placeholder="Owned by me, or permission details"/></label>
      <button className="btn" disabled={busy||!loaded||!rights.trim()} onClick={()=>void act(async()=>{const path=await open({multiple:false,filters:[{name:'Video',extensions:['mp4','mov','mkv','webm']} ]});if(typeof path!=='string')return;const existing=refs.find(r=>r.source===path);const ref=existing||await api.refsIngest(path,null,rights);if(!existing)setRefs([...refs,ref]);const candidate=learnCutRhythm(ref,rights,['editing']);await persist([...skills,candidate]);setSelected(candidate.id);})}>Import reference and analyze</button>
      {skills.filter(s=>s.scope==='personal'||s.projectName===project.name).map(s=><button key={s.id} className={'learning-skill '+(s.id===selected?'selected':'')} onClick={()=>setSelected(s.id)}><strong>{s.name}</strong><span>{s.status}</span></button>)}
    </aside><section>{skill?<>
      <h3>{skill.name}</h3><p>{skill.status} · Reconstruction attempts {skill.attempts}/{skill.maxAttempts} · API cost $0</p>
      <label>Library scope<select value={skill.scope} disabled={busy} onChange={e=>void act(()=>update({...skill,scope:e.target.value as 'personal'|'project',projectName:e.target.value==='project'?project.name:null}))}><option value="personal">Personal library</option><option value="project">This project</option></select></label>
      <p>{skill.inference}</p><p>Provenance: {skill.rights}</p>
      <details><summary>Timestamped evidence and limitations</summary>{skill.evidence.map((e,i)=><p key={i}>{e.start.toFixed(3)}–{e.end.toFixed(3)} s: {e.observation}</p>)}{skill.limitations.map(l=><p key={l}>{l}</p>)}</details>
      <div className="learning-previews"><figure><figcaption>Reference</figcaption><video controls src={fileSrc(skill.reference.source)}/></figure><figure><figcaption>Rendered reconstruction</figcaption>{skill.previewPath?<video controls src={fileSrc(skill.previewPath)}/>:<p>Render before reviewing.</p>}</figure></div>
      <button className="btn" disabled={busy||!!skill.previewJobId} onClick={()=>void act(()=>reconstruct(false))}>Reconstruct editable timeline</button>
      <button className="btn" disabled={busy||!skill.reconstructionCompId||!!skill.previewJobId} onClick={()=>void act(async()=>{const output=await save({defaultPath:'learning-preview.mp4',filters:[{name:'Video',extensions:['mp4']}]});if(!output)return;const jobId=await api.exportStart(history.current(),{output,compId:skill.reconstructionCompId!,resolution:null,fps:null,quality:'standard',inToOut:false,format:'mp4'});await update({...skill,previewJobId:jobId,status:'Reconstructed'});})}>Render evaluation preview</button>
      {previewJob?.status==='running'&&<button className="btn" onClick={()=>void api.jobCancel(previewJob.id)}>Cancel render · {Math.round(previewJob.progress*100)}%</button>}
      <label>Review timing, event order, readability, and composition<textarea value={reason} onChange={e=>setReason(e.target.value)} placeholder="Record your comparison, corrections, or rejection reason"/></label>
      <button className="btn" disabled={busy||skill.status!=='Needs Review'||!reason.trim()} onClick={()=>void act(()=>update(reviewSkill(skill,true,reason)))}>Accept reviewed skill</button>
      <button className="btn" disabled={busy||skill.status!=='Needs Review'||!reason.trim()} onClick={()=>void act(()=>update(reviewSkill(skill,false,reason)))}>Reject with feedback</button>
      <label>Different target footage<select value={media} onChange={e=>setMedia(e.target.value)}><option value="">Choose footage</option>{[...assets.values()].filter(a=>a.kind==='video').map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <button className="btn" disabled={busy||skill.status!=='Available'||!media} onClick={()=>void act(()=>reconstruct(true))}>Apply to new editable composition</button>
      <button className="btn" disabled={busy} onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(skill,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='helios-skill-'+skill.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Export skill</button>
      <button className="btn" disabled={busy} onClick={()=>void act(async()=>{await persist(skills.filter(s=>s.id!==skill.id));setSelected('');})}>Delete skill</button>
      {!!skill.outcomes.length&&<><h4>Adaptation outcomes</h4>{skill.outcomes.map((outcome,i)=><p key={i}>{assets.get(outcome.mediaId)?.name||outcome.mediaId}: {outcome.reason}</p>)}<button className="btn" disabled={busy||!reason.trim()} onClick={()=>void act(()=>update({...skill,outcomes:skill.outcomes.map((outcome,i)=>i===skill.outcomes.length-1?{...outcome,at:new Date().toISOString(),reason:reason.trim()}:outcome)}))}>Save feedback on latest adaptation</button></>}
      {skill.validations.map((v,i)=><p key={i}>{v.accepted?'Accepted':'Rejected'} · {v.reason}</p>)}
    </>:<p>Import a reference you own or have permission to analyze. No local language model or automatic download is needed.</p>}</section></div>
  </div></div>;
}
