import {it,expect} from 'vitest';
import {modelVariants,pickerModels,variantModel} from '../src/lib/modelVariants';
it('groups discovered variants without inventing models',()=>{const models=['gemini-3.8-flash-low','gemini-3.8-flash-high','other'];expect(pickerModels(models)).toHaveLength(2);expect(modelVariants(models,models[0]).map(v=>v.effort)).toEqual(['low','high']);expect(variantModel(models,models[0],'high')).toBe(models[1]);expect(variantModel(models,models[0],'medium')).toBe(models[0]);});
it('keeps unrelated provider models untouched',()=>{expect(modelVariants(['claude-sonnet-4-5'],'claude-sonnet-4-5')).toEqual([]);});
