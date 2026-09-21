import {gradeTables,curveValue} from './colorGrade';
import {normalizeEffectClip} from './effectState';
import type {AppliedEffect,Project} from './types';
import { RENDERED_EFFECTS } from './effectSupport';
export { RENDERED_EFFECTS } from './effectSupport';
export function exportTables(fx:AppliedEffect):string[][]|null {
  const p=fx.params,n=(key:string,fallback:number)=>typeof p[key]==='number'&&Number.isFinite(p[key])?p[key] as number:fallback;
  if(fx.effectId==='lumetri-color')return gradeTables(p).map(s=>s.split(' '));
  if(!['curves','levels','brightness-contrast'].includes(fx.effectId))return null;
  return ['r','g','b','a'].map(channel=>Array.from({length:256},(_,i)=>{
    const x=i/255;
    if(fx.effectId==='curves')return String(curveValue(p[channel+'Table']??(channel==='a'?undefined:p.tableValues),x));
    if(channel==='a')return String(x);
    if(fx.effectId==='brightness-contrast')return String(Math.max(0,Math.min(1,(x-.5)*Math.max(0,1+n('contrast',0)/100)+.5+n('brightness',0)/100)));
    const black=Math.max(0,Math.min(254,n('inputBlack',0)))/255,white=Math.max(black+1/255,Math.min(255,n('inputWhite',255))/255);
    const value=Math.pow(Math.max(0,Math.min(1,(x-black)/(white-black))),1/Math.max(.1,n('gamma',1)));
    return String(Math.max(0,Math.min(1,n('outputBlack',0)/255+value*(n('outputWhite',255)-n('outputBlack',0))/255)));
  }));
}
export function prepareEffectExport(project:Project,compId?:string):Project {
  const reachable=new Set<string>();
  const visit=(id:string)=>{if(reachable.has(id))return;reachable.add(id);for(const clip of project.comps.find(c=>c.id===id)?.clips||[])if(clip.enabled&&clip.source.type==='comp')visit(clip.source.compId);};
  if(compId)visit(compId);else project.comps.forEach(c=>visit(c.id));
  return {...project,comps:project.comps.map(comp=>({...comp,clips:comp.clips.map(original=>{
    const clip=normalizeEffectClip(original);
    return {...clip,appliedEffects:clip.appliedEffects?.map(fx=>{
      if(reachable.has(comp.id)&&clip.enabled&&fx.enabled&&!RENDERED_EFFECTS.has(fx.effectId))throw new Error(fx.name+' is not implemented for export. Bypass or remove it before exporting.');
      const tables=exportTables(fx);return tables?{...fx,params:{...fx.params,_exportTables:JSON.stringify(tables)}}:fx;
    })};
  })}))};
}
