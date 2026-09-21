import {ALL_EFFECTS} from './effectsCatalog';
import {DEFAULT_EFFECTS} from './editor';
import type {Clip,Effects,AppliedEffect} from './types';
export function cleanLegacy(base:Effects,stack:AppliedEffect[]):Effects {
  const next={...base};
  for(const fx of stack){if(fx.stackOnly)continue;const preset=ALL_EFFECTS.find(e=>e.id===fx.effectId)?.apply||{};
    for(const [key,value] of Object.entries(preset)){const field=key as keyof Effects;if(key in DEFAULT_EFFECTS&&next[field]===value)Object.assign(next,{[key]:DEFAULT_EFFECTS[field]});}
  }return next;
}
export function normalizeEffectClip(clip:Clip):Clip {return {...clip,effects:cleanLegacy(clip.effects,clip.appliedEffects||[]),appliedEffects:(clip.appliedEffects||[]).map(fx=>({...fx,name:ALL_EFFECTS.find(e=>e.id===fx.effectId)?.label||fx.name,stackOnly:true}))};}
