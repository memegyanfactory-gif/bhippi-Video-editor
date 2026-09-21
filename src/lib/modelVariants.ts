import type {Effort} from './permissions';
const order:Effort[]=['low','medium','high','max'];
export function splitVariant(id:string):{base:string;effort:Effort}|null {
  const match=id.match(/^(.*?)(?:[- #]|\s*\()(low|medium|high|max|xhigh)\)?$/i);
  return match?{base:match[1],effort:match[2].toLowerCase()==='xhigh'?'max':match[2].toLowerCase() as Effort}:null;
}
export function modelVariants(models:string[],chosen:string|null):{id:string;effort:Effort}[] {
  if(!chosen)return [];
  const base=splitVariant(chosen)?.base||chosen;
  return models.flatMap(id=>{const variant=splitVariant(id);return variant?.base===base?[{id,effort:variant.effort}]:[];}).sort((a,b)=>order.indexOf(a.effort)-order.indexOf(b.effort));
}
export function pickerModels(models:string[]):string[] {
  const seen=new Set<string>();return models.filter(id=>{const base=splitVariant(id)?.base||id;if(seen.has(base))return false;seen.add(base);return true;});
}
export function variantModel(models:string[],chosen:string|null,effort:Effort):string|null {
  const variants=modelVariants(models,chosen);return variants.find(v=>v.effort===effort)?.id||chosen;
}
