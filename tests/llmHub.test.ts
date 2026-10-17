import { describe, expect, it } from 'vitest';
import { activeParamsIn, compact, contextLabel, hubCapabilities, looksMoe, paramsLabel, quantNeeds, readmeText, recommendQuant, relativeDate, searchText, type HubRow } from '../src/lib/llmHub';

const now = Date.parse('2026-10-17T00:00:00Z');

describe('llmHub helpers', () => {
  it('says how old a model is', () => {
    expect(relativeDate('2026-10-17T00:00:00Z', now)).toBe('today');
    expect(relativeDate('2026-10-16T00:00:00Z', now)).toBe('yesterday');
    expect(relativeDate('2026-08-15T00:00:00Z', now)).toBe('63 days ago');
    expect(relativeDate('2026-04-20T00:00:00Z', now)).toBe('6 months ago');
    expect(relativeDate('2024-04-20T00:00:00Z', now)).toBe('2 years ago');
    expect(relativeDate('nonsense', now)).toBe('');
  });

  it('formats numbers', () => {
    expect(compact(6663225)).toBe('6.7M');
    expect(compact(1200)).toBe('1.2K');
    expect(compact(42)).toBe('42');
    expect(paramsLabel(34.66)).toBe('35B');
    expect(paramsLabel(4.2)).toBe('4.2B');
    expect(paramsLabel(0.23)).toBe('230M');
    expect(contextLabel(262144)).toBe('256K');
    expect(contextLabel(1048576)).toBe('1M');
  });

  it('reads experts models from names and architectures', () => {
    expect(activeParamsIn('Qwen3.6-35B-A3B-GGUF')).toBe(3);
    expect(activeParamsIn('Mellum2.1-12B-A2.5B-Thinking')).toBe(2.5);
    expect(activeParamsIn('Qwen3-8B')).toBeNull();
    expect(looksMoe('qwen35moe', 'x')).toBe(true);
    expect(looksMoe('llama', 'Llama-3.1-8B')).toBe(false);
  });

  it('matches the Rust memory estimates', () => {
    expect(quantNeeds(20e9, 0, false)).toEqual({ minVramGb: 0, recVramGb: 22, minRamGb: 25 });
    expect(quantNeeds(20e9, 1e9, true)).toEqual({ minVramGb: 4, recVramGb: 23, minRamGb: 25 });
  });

  it('suggests the most accurate size that runs well, not past 6.7 bits', () => {
    const quants = [{ quant: 'Q2', bytes: 1, files: [], bits: 2.7 }, { quant: 'Q4', bytes: 2, files: [], bits: 4.8 }, { quant: 'Q6', bytes: 3, files: [], bits: 6.6 }, { quant: 'Q8', bytes: 4, files: [], bits: 8.5 }];
    expect(recommendQuant(quants, (quant) => (quant.quant === 'Q8' ? 'great' : quant.quant === 'Q6' ? 'slow' : 'great'))).toBe('Q4');
    expect(recommendQuant(quants, () => 'no')).toBeNull();
    expect(recommendQuant(quants, () => 'checking')).toBe('Q4');
  });

  it('reads capabilities and builds searches', () => {
    const model = { tags: ['tool-use', 'thinking'], pipelineTag: 'image-text-to-text', name: 'X-GGUF' } as Pick<HubRow, 'tags' | 'pipelineTag' | 'name'>;
    expect(hubCapabilities(model)).toEqual({ vision: true, tools: true, reasoning: true });
    expect(hubCapabilities({ tags: [], pipelineTag: 'text-generation', name: 'Plain-8B' })).toEqual({ vision: false, tools: false, reasoning: false });
    expect(searchText('qwen', new Set(['coding', 'vision']))).toBe('qwen coder');
    expect(searchText('', new Set(['uncensored']))).toBe('uncensored');
  });

  it('removes pictures from a README', () => {
    expect(readmeText('# T\n![a](http://x/y.png)\n<img src="z">\ntext')).toBe('# T\n\n\ntext'.replace(/\n{3,}/g, '\n\n'));
  });
});
