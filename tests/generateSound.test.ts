import{describe,it,expect}from'vitest';
import{generateSelectionSound}from'../src/lib/generateSound';
import{newComp,newClip}from'../src/lib/timeline';
describe('sound for selection',()=>{
it('preserves original audio and places bounded editable accents on new tracks',()=>{const comp=newComp({name:'Test'});const a=newClip({trackId:comp.tracks[0].id,start:2,duration:1,source:{type:'media',assetId:'a'}});const audio=newClip({trackId:comp.tracks[3].id,start:2,duration:1,source:{type:'media',assetId:'a'}});comp.clips=[a,audio];const result=generateSelectionSound(comp,[a.id,audio.id],'impact');expect(result.ids).toHaveLength(1);expect(result.comp.clips.slice(0,2)).toEqual(comp.clips);const clip=result.comp.clips[2];expect(clip.start).toBe(2);expect(clip.duration).toBe(1);expect(comp.tracks.some(t=>t.id===clip.trackId)).toBe(false);expect(clip.keyframes.volume.at(-1)?.value).toBe(0);});
it('rejects empty selections and invalid gain',()=>{const c=newComp({name:'Test'});expect(()=>generateSelectionSound(c,[],'pop')).toThrow();expect(()=>generateSelectionSound(c,[],'pop',20)).toThrow();});
});