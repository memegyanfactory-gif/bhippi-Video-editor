import {describe,it,expect} from 'vitest';
import {learnCutRhythm,rhythmProgram,adaptRhythmProgram,reviewSkill} from '../src/lib/learning';
const reference={id:'r',name:'Reference',source:'video.mp4',width:1920,height:1080,fps:30,seconds:5,cuts:[1,3],cutEvery:2,palette:[],sheets:[],notes:'',pack:null,addedAt:''};
describe('reference learning',()=>{
it('keeps timestamped evidence separate from inferred construction',()=>{const s=learnCutRhythm(reference,'Owned by test author',['editing']);expect(s.durations).toEqual([1,2,2]);expect(s.status).toBe('Analyzed');expect(s.evidence[1]).toMatchObject({start:1,end:3});expect(s.graph.ops[0]).toMatchObject({media:'$media'});});
it('retargets the operation graph to different footage and timebase',()=>{const p=rhythmProgram([1.01,2.03],'new-footage',24);expect(p.ops[0]).toMatchObject({media:'new-footage',duration:1});expect(p.ops[1]).toMatchObject({at:1,in:1,duration:49/24});});
it('does not accept an unrendered or self-rated candidate',()=>{const s=learnCutRhythm(reference,'Owned',['editing']);expect(()=>reviewSkill(s,true,'Looks good')).toThrow(/Render/);const rendered={...s,status:'Needs Review' as const,previewPath:'preview.mp4'};expect(()=>reviewSkill(rendered,true,'')).toThrow(/Record/);expect(reviewSkill(rendered,true,'Compared all cut onsets').status).toBe('Available');});
it('creates discontinuous source ranges while preserving learned cut times',()=>{const p=adaptRhythmProgram([1,2,2],'different',30,9);expect(p.ops[1]).toMatchObject({at:1,in:3,duration:2});expect(p.ops[2]).toMatchObject({at:3,in:7,duration:2});expect(()=>adaptRhythmProgram([1,2,2],'different',30,5)).toThrow(/longer/);});
it('rejects invalid time ranges',()=>{expect(()=>rhythmProgram([NaN],'x',30)).toThrow();expect(()=>learnCutRhythm(reference,'',[])).toThrow();});
});
