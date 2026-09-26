import {bakeGrade,curveValue} from './colorGrade';
import {encodeLut,resolveLut,syncProjectLuts} from './luts';
import {normalizeEffectClip} from './effectState';
import type {AppliedEffect,Project} from './types';
import { RENDERED_EFFECTS } from './effectSupport';
export { RENDERED_EFFECTS } from './effectSupport';
export function exportTables(fx:AppliedEffect):string[][]|null {
  const p=fx.params,n=(key:string,fallback:number)=>typeof p[key]==='number'&&Number.isFinite(p[key])?p[key] as number:fallback;
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
/** The Color Studio grade baked for the export: the same 33³ LUT the preview's GPU pass samples. */
export function exportGrade(fx:AppliedEffect):{_exportLut3d:string;_lutSize:number}|null {
  if(fx.effectId!=='lumetri-color')return null;
  const lutId=typeof fx.params.lutId==='string'?fx.params.lutId:'';
  if(lutId&&!resolveLut(lutId))throw new Error(`${fx.name} uses a LUT that is not in this project. Pick another LUT or remove it before exporting.`);
  const lut=bakeGrade(fx.params,resolveLut);
  return {_exportLut3d:encodeLut(lut),_lutSize:lut.size};
}
export function prepareEffectExport(project:Project,compId?:string):Project {
  syncProjectLuts(project);
  const reachable=new Set<string>();
  const visit=(id:string)=>{if(reachable.has(id))return;reachable.add(id);for(const clip of project.comps.find(c=>c.id===id)?.clips||[])if(clip.enabled&&clip.source.type==='comp')visit(clip.source.compId);};
  if(compId)visit(compId);else project.comps.forEach(c=>visit(c.id));
  // One bake per distinct grade: a look copied across a hundred clips is baked once.
  const baked=new Map<string,{_exportLut3d:string;_lutSize:number}|null>();
  const grade=(fx:AppliedEffect)=>{const key=JSON.stringify(fx.params);if(!baked.has(key))baked.set(key,exportGrade(fx));return baked.get(key)!;};
  return {...project,comps:project.comps.map(comp=>({...comp,clips:comp.clips.map(original=>{
    const clip=normalizeEffectClip(original);
    return {...clip,appliedEffects:clip.appliedEffects?.map(fx=>{
      const live=reachable.has(comp.id)&&clip.enabled&&fx.enabled;
      if(live&&!RENDERED_EFFECTS.has(fx.effectId))throw new Error(fx.name+' is not implemented for export. Bypass or remove it before exporting.');
      if(fx.effectId==='lumetri-color'){const {_exportTables:_old,...params}=fx.params;void _old;const lut=live?grade(fx):null;return lut?{...fx,params:{...params,...lut}}:{...fx,params};}
      const tables=exportTables(fx);return tables?{...fx,params:{...fx.params,_exportTables:JSON.stringify(tables)}}:fx;
    })};
  })}))};
}
