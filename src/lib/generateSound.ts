import {SFX_LENGTH} from './editor';
import {SFX_GAIN_DB,sfxName} from './sfxLevels';
import {newClip,newTrack,clipEnd} from './timeline';
import type {Comp,SfxKind,Track,Clip} from './types';
/** Deterministic local sound accents. Original tracks and audio are never edited. */
export function generateSelectionSound(comp:Comp,selected:string[],kind:SfxKind,gainDb=SFX_GAIN_DB[kind]):{comp:Comp;ids:string[]} {
  if(!Object.hasOwn(SFX_LENGTH,kind))throw new Error('Choose a supported procedural sound.');
  if(!Number.isFinite(gainDb)||gainDb<-60||gainDb>0)throw new Error('Gain must be between -60 and 0 dB.');
  const sources=comp.clips.filter(c=>selected.includes(c.id)&&c.enabled).sort((a,b)=>a.start-b.start);
  if(!sources.length)throw new Error('Select at least one enabled clip.');
  if(sources.length>100)throw new Error('Generate sound for at most 100 clips at once.');
  const tracks:Track[]=[],clips:Clip[]=[];
  // Linked picture/audio clips at the same cut share a single accent.
  const seen=new Set<number>();
  for(const source of sources){const frame=Math.round(source.start*comp.fps);if(seen.has(frame))continue;seen.add(frame);
    let track=tracks.find(t=>!clips.some(c=>c.trackId===t.id&&clipEnd(c)>source.start));
    if(!track){track={...newTrack('audio'),name:'Generated sound · '+kind};tracks.push(track);}
    const duration=Math.min(SFX_LENGTH[kind],source.duration),volume=Math.pow(10,gainDb/20),fade=Math.min(.03,duration/4);
    const clip=newClip({trackId:track.id,start:source.start,duration,source:{type:'sfx',kind},name:sfxName(kind,'cut accent'),volume,audioType:'sfx'});
    clip.keyframes={...clip.keyframes,volume:[{time:0,value:0,easing:'linear'},{time:fade,value:volume,easing:'linear'},{time:Math.max(fade,duration-fade),value:volume,easing:'linear'},{time:duration,value:0,easing:'linear'}]};
    clips.push(clip);
  }
  return{comp:{...comp,tracks:[...comp.tracks,...tracks],clips:[...comp.clips,...clips]},ids:clips.map(c=>c.id)};
}
