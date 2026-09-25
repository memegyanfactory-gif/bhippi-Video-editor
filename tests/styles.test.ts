// Edit styles: the `@funny` tag, its registry, the /style command and the brief chat.rs sends.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { COMMANDS, type CommandContext } from '../src/chat/commands';
import { COUNCIL } from '../src/lib/council';
import { FUNNY_BAND, ROAST_TOOL_NAMES } from '../src/lib/roast/types';
import { STYLES, findStyle, isStyleId, styleInMessage, stylesMatching } from '../src/lib/styles';
import catalogue from '../src/lib/ai-tools.json';

const root = join(__dirname, '..');
const brief = readFileSync(join(root, 'src-tauri', 'prompts', 'styles', 'funny.md'), 'utf8');

describe('the style registry', () => {
  it('has @funny, with its persona, band and a council seat that exists', () => {
    const funny = findStyle('funny');
    expect(funny).toMatchObject({ id: 'funny', label: '@funny', councilSeat: 'comedian' });
    expect(funny?.band).toBe(FUNNY_BAND);
    const sentences = funny?.persona.split(/(?<=\.)\s+/) ?? [];
    expect(sentences.length).toBeGreaterThanOrEqual(2);
    expect(sentences.length).toBeLessThanOrEqual(4);
    for (const style of STYLES) {
      expect(style.label).toBe(`@${style.id}`);
      expect(COUNCIL.some((member) => member.id === style.councilSeat)).toBe(true);
    }
  });

  it('finds a style by id, with or without its @, in any case', () => {
    expect(findStyle('@FUNNY')?.id).toBe('funny');
    expect(findStyle(' funny ')?.id).toBe('funny');
    expect(findStyle('documentary')).toBeUndefined();
    expect(findStyle(null)).toBeUndefined();
    expect(findStyle('')).toBeUndefined();
    expect(isStyleId('funny')).toBe(true);
    expect(isStyleId('@funny')).toBe(false);
  });

  it('offers every style for a bare @ and narrows as the name is typed', () => {
    expect(stylesMatching('')).toEqual(STYLES);
    expect(stylesMatching('fu').map((style) => style.id)).toEqual(['funny']);
    expect(stylesMatching('@FUN').map((style) => style.id)).toEqual(['funny']);
    expect(stylesMatching('x')).toEqual([]);
  });

  it('spots a whole @funny token in a sent message, and nothing else', () => {
    expect(styleInMessage('@funny roast this video')?.id).toBe('funny');
    expect(styleInMessage('make it @funny.')?.id).toBe('funny');
    expect(styleInMessage('(@Funny) please')?.id).toBe('funny');
    expect(styleInMessage('@funnyman is a reference')).toBeUndefined();
    expect(styleInMessage('mail me@funny.com')).toBeUndefined();
    expect(styleInMessage('make it funny')).toBeUndefined();
  });
});

describe('/style', () => {
  function context(editStyle: 'funny' | null = null) {
    return { say: vi.fn(), setStyle: vi.fn(), editStyle } as unknown as CommandContext & { say: ReturnType<typeof vi.fn>; setStyle: ReturnType<typeof vi.fn> };
  }
  const command = COMMANDS.find((item) => item.name === '/style')!;

  it('switches a style on and off, and lists them', () => {
    expect(command.options?.(context())).toEqual(['funny', 'off']);
    const on = context();
    command.run(on, '@funny');
    expect(on.setStyle).toHaveBeenCalledWith('funny');
    expect(on.say).not.toHaveBeenCalled();
    const off = context('funny');
    command.run(off, 'off');
    expect(off.setStyle).toHaveBeenCalledWith(null);
    const list = context('funny');
    command.run(list, '');
    expect(list.say.mock.calls[0][0]).toContain('**@funny**');
    expect(list.say.mock.calls[0][0]).toContain('(on)');
    const unknown = context();
    command.run(unknown, 'documentary');
    expect(unknown.setStyle).not.toHaveBeenCalled();
    expect(unknown.say.mock.calls[0][0]).toContain('There is no "documentary" style');
  });
});

describe('the @funny brief (src-tauri/prompts/styles/funny.md)', () => {
  it('carries the same persona chat.rs leads with', () => {
    expect(brief).toContain(`\nPersona: ${findStyle('funny')?.persona}\n`);
    expect(brief).not.toContain('{{');
    expect(brief.split('\n').length).toBeLessThanOrEqual(200);
  });

  it('walks the pipeline in order with the real tool names', () => {
    const known = new Set<string>([...catalogue.tools.map((tool: { name: string }) => tool.name), ...ROAST_TOOL_NAMES]);
    const pipeline = [
      'key_green_screen', 'rotoscope_clip', 'analyze_clip_speech', 'save_beat_sheet', 'search_memes', 'find_memes_online', 'save_meme', 'get_meme_media',
      'find_receipt', 'download_online_media', 'online_research', 'scrape_web_page', 'cutout_image', 'search_sfx', 'validate_roast_edl', 'apply_roast_edl',
      'analyze_music_beats', 'snap_cuts_to_beats', 'edit_dna', 'consult_council', 'verify_edit_workflow',
    ];
    let last = -1;
    for (const name of pipeline) {
      expect(known.has(name), `${name} is a real tool`).toBe(true);
      // In order: each named after the one before it (a tool may also appear earlier, in passing).
      const at = brief.indexOf(`\`${name}\``, last + 1);
      expect(at, `${name} is in the brief after the step before it`).toBeGreaterThan(-1);
      last = at;
    }
    for (const name of ['roast_move', 'ask_user', 'spawn_subagent', 'wait_subagent', 'track_people', 'detect_faces', 'level_audio', 'run_frame_qa']) {
      expect(known.has(name), `${name} is a real tool`).toBe(true);
      expect(brief).toContain(`\`${name}\``);
    }
  });

  it('names every move, the band numbers and the failures to avoid', () => {
    const moves = ['meme_cutaway', 'receipt', 'side_cutout', 'host_on_bg', 'keyword_pop', 'emoji_pop', 'sticker', 'overlay_fx', 'card', 'title_card', 'cta', 'zoom_punch', 'shake', 'whip', 'bw_freeze', 'label', 'head_paste', 'bleep', 'music_sting', 'sfx'];
    for (const move of moves) expect(brief, move).toContain(`\`${move}\``);
    expect(brief).toContain('20–30 in the first 3 minutes, never below 12');
    expect(brief).toContain('2–2.5 s');
    expect(brief).toContain(`${FUNNY_BAND.maxStaticSeconds} s at most`);
    expect(brief).toContain('6–12 a minute');
    expect(brief).toContain('20–35 %');
    expect(brief).toContain('60 % or more');
    expect(brief).toMatch(/## Never do this[\s\S]*1\. Leave the green screen unkeyed[\s\S]*6\. Run a music bed under everything/);
    for (const rule of ['plus 0–100 ms', 'dontUseWhen', 'At least 30 %', 'at most 3 times', '−20 LU', '0.3–0.6 s before each punchline', 'keep, bleep, or mute', 'Devanagari', 'provenance']) {
      expect(brief, rule).toContain(rule);
    }
  });
});
