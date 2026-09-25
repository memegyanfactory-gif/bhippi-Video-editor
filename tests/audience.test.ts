import { describe, expect, it } from 'vitest';
import { audienceArg, compAudience, detectAudience, memeAudienceErrors, memeFitsAudience } from '../src/lib/roast/audience';

describe('reading who a video is for', () => {
  it('hears an Indian video in Devanagari or Hinglish', () => {
    expect(detectAudience(['भाई ये तो कमाल हो गया, उसने ज़हर डाल दिया']).audience).toBe('IN');
    const hinglish = detectAudience(['bhai ye kya ho raha hai yaar, matlab sab log pagal hai', 'usne bola main nahi karunga aur phir kiya']);
    expect(hinglish.audience).toBe('IN');
    expect(hinglish.signals.join(' ')).toContain('Hinglish');
  });

  it('hears an English video as global, even one that mentions India once', () => {
    const english = detectAudience([
      'So this guy on YouTube claims he made a million dollars in one week selling courses.',
      'And honestly, I have never seen a more confident man be so completely wrong about everything.',
      'He even flew to Mumbai for a conference and the whole thing fell apart on stage in front of everyone.',
      'Anyway, let us look at the receipts, because the comments section had a field day with this one.',
    ]);
    expect(english.audience).toBe('global');
    expect(english.confidence).toBeGreaterThan(0.5);
    // English words that are also Hinglish words ("do", "par", "ho") do not tip it.
    expect(detectAudience(['Do it for the ho ho holidays, par for the course, do not stop']).audience).toBe('global');
  });

  it('is unsure with almost nothing to read', () => {
    const tiny = detectAudience(['okay']);
    expect(tiny.audience).toBe('global');
    expect(tiny.confidence).toBeLessThan(0.5);
  });

  it('keeps Indian memes to Indian videos unless they crossed over', () => {
    expect(memeFitsAudience({ region: 'IN' }, 'global')).toBe(false);
    expect(memeFitsAudience({ region: 'IN', crossover: true }, 'global')).toBe(true);
    expect(memeFitsAudience({ region: 'global' }, 'global')).toBe(true);
    expect(memeFitsAudience({ region: 'IN' }, 'IN')).toBe(true);
    expect(memeFitsAudience({ region: 'global' }, 'IN')).toBe(true);
  });

  it('keeps any country\'s local memes to its own viewers', () => {
    expect(memeFitsAudience({ region: 'BR' }, 'BR')).toBe(true);
    expect(memeFitsAudience({ region: 'BR' }, 'IN')).toBe(false);
    expect(memeFitsAudience({ region: 'IN' }, 'BR')).toBe(false);
    expect(memeFitsAudience({ region: 'BR', crossover: true }, 'JP')).toBe(true);
  });

  it('hears a country in a script only it writes', () => {
    expect(detectAudience(['이거 진짜 말도 안 돼, 완전 대박이다']).audience).toBe('KR');
    expect(detectAudience(['これは本当にやばいですね、まじで']).audience).toBe('JP');
    expect(detectAudience(['อันนี้ตลกมากเลยนะ']).audience).toBe('TH');
  });

  it('reads the comp\'s audience: set, else from its beat sheet, else unknown', () => {
    expect(compAudience({ roast: { audience: { audience: 'IN', confidence: 1, signals: [], source: 'user' }, beatSheet: { beats: [{ text: 'hello there everyone' }] } } })).toBe('IN');
    expect(compAudience({ roast: { beatSheet: { beats: [{ text: 'bhai kya scene hai yaar, sab log hass rahe hai' }] } } })).toBe('IN');
    expect(compAudience({})).toBeNull();
    expect(audienceArg('Indian')).toBe('IN');
    expect(audienceArg('GLOBAL')).toBe('global');
    expect(audienceArg('auto')).toBe('auto');
    expect(audienceArg(undefined)).toBeNull();
    expect(audienceArg('us')).toBe('US');
    expect(audienceArg('Brazil')).toBe('BR');
    expect(audienceArg('usa')).toBe('US');
    expect(audienceArg('united states of nowhere')).toBe('bad');
  });

  it('lists the memes a global audience would not recognise, once each', async () => {
    const library: Record<string, { name: string; region: string; crossover?: boolean }> = {
      kheer: { name: 'Zeher wali kheer', region: 'IN' },
      wow: { name: 'Just looking like a wow', region: 'IN', crossover: true },
      fine: { name: 'This is fine', region: 'global' },
    };
    const get = async (id: string) => library[id] ?? null;
    const errors = await memeAudienceErrors(['kheer', 'wow', 'fine', 'kheer', 'unknown'], 'global', get);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Zeher wali kheer');
    expect(await memeAudienceErrors(['kheer'], 'IN', get)).toEqual([]);
    expect(await memeAudienceErrors(['kheer'], null, get)).toEqual([]);
  });
});
