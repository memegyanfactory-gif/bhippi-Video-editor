// The film benchmark's bookkeeping (scripts/film-bench.ts, docs/benchmark/README.md): the critics'
// cards add up the way the film lab added them, the blind order hides the tiers, costs come from the
// turn traces, and the targets and regressions read the same numbers every round.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { blindOrder, cardScore, CRITERIA, loadFilms, regressions, resultsMarkdown, scoreRows, summariseTurns, TARGETS, tierVerdicts, type Card, type KeyEntry, type Row } from '../scripts/film-bench.ts';
import catalogue from '../src/lib/ai-tools.json';
import { playbook } from '../src/lib/motionDirection';

const card = (blind: string, critic: string, each: number, extra: Partial<Card> = {}): Card => ({ blind, critic, scores: Object.fromEntries(CRITERIA.map((name) => [name, each])), ...extra });

describe('film benchmark: scoring', () => {
  it('adds a card the way the film-lab critics did: ten criteria, less a stated deduction', () => {
    // crimson-explainer v2: the criteria summed to 76.5 and the critic took a little off for the unheard mix.
    const crimson: Card = { blind: 'F01', critic: 'a', scores: { look: 7.5, faithfulness: 8, camera: 7.5, type: 8, sync: 8.5, clarity: 7.5, flow: 7.5, polish: 7, originality: 7.5, audio: 7.5 }, deduction: 1.5, why: 'the mix was never heard; busy frames' };
    expect(cardScore(crimson)).toBe(75);
    expect(() => cardScore({ ...crimson, deduction: 1.5, why: '' })).toThrow(/why/);
    expect(() => cardScore({ ...crimson, deduction: 3 })).toThrow(/0–2/);
    expect(() => cardScore({ ...crimson, scores: { ...crimson.scores, sync: 8.3 } })).toThrow(/half points/);
    expect(() => cardScore({ ...crimson, scores: { ...crimson.scores, audio: undefined as never } })).toThrow(/audio/);
  });

  it('shuffles the blind order the same way for the same seed, and differently for another', () => {
    const items = Array.from({ length: 22 }, (_, i) => i);
    expect(blindOrder(items, 42)).toEqual(blindOrder(items, 42));
    expect(blindOrder(items, 42)).not.toEqual(blindOrder(items, 43));
    expect([...blindOrder(items, 42)].sort((a, b) => a - b)).toEqual(items);
  });

  it('averages the critics, flags a split panel and a critic off calibration', () => {
    const films = loadFilms();
    const key: KeyEntry[] = [
      { blind: 'F01', film: 'crimson-explainer', tier: 'opus', video: 'a.mp4' },
      { blind: 'F02', film: 'crimson-explainer', tier: 'free', video: 'b.mp4' },
      { blind: 'F03', film: 'glass-identity', tier: 'small', video: 'c.mp4' },
    ];
    const cards = [card('F01', 'a', 8.5), card('F01', 'b', 9), card('F02', 'a', 9), card('F03', 'a', 6), card('F03', 'b', 7)];
    const rows = scoreRows(key, cards, [], films);
    expect(rows[0].score).toBe(87.5);
    expect(rows[0].note).toEqual([]);
    // The crimson render is on record at 75: a critic giving it 90 is not measuring the same way.
    expect(rows[1].note.join()).toMatch(/calibration: the recorded score is 75/);
    expect(rows[2].spread).toBe(10);
    expect(rows[2].note.join()).toMatch(/third critic/);
  });

  it('passes a tier only on all six films, a mean at the target and no film more than 5 under', () => {
    const films = loadFilms();
    const rows = (scores: number[], tier: Row['tier']): Row[] => films.map((film, i) => ({ film: film.id, tier, blind: `F${i}`, score: scores[i], critics: [scores[i]], spread: 0, cost: null, note: [] }));
    const verdict = (all: Row[]) => tierVerdicts(all, films.length);
    expect(verdict(rows([86, 86, 86, 86, 86, 86], 'opus'))[0]).toMatchObject({ tier: 'opus', mean: 86, passed: true });
    expect(verdict(rows([95, 95, 95, 95, 95, 79], 'opus'))[0].passed).toBe(false);
    expect(verdict(rows([86, 86, 86, 86, 86], 'opus'))[0].passed).toBe(false);
    expect(verdict(rows([70, 70, 71, 72, 70, 69], 'small'))[2]).toMatchObject({ tier: 'small', target: TARGETS.small, passed: true });
  });

  it('calls a lower score, or more tokens or minutes, a regression', () => {
    const cost = (tokens: number, activeMinutes: number) => ({ turns: 3, input: tokens, output: 0, tokens, activeMinutes, wallMinutes: activeMinutes, calls: 10, failed: 0, judge: [], models: [], tiers: [], efforts: [], playbooks: [] });
    const row = (score: number, tokens: number, minutes: number): Row => ({ film: 'white-saas', tier: 'mid', blind: 'F1', score, critics: [score], spread: 0, cost: cost(tokens, minutes), note: [] });
    expect(regressions([row(80, 100_000, 30)], [row(80, 95_000, 29)])).toEqual([]);
    const worse = regressions([row(78, 120_000, 40)], [row(80, 100_000, 30)]);
    expect(worse).toHaveLength(3);
    expect(worse[0]).toMatch(/score 80 → 78/);
  });

  it('writes a results table with every film, tier and verdict', () => {
    const films = loadFilms();
    const text = resultsMarkdown('2026-10-01', [], films, tierVerdicts([], films.length), []);
    for (const film of films) expect(text).toContain(`| ${film.id} |`);
    expect(text).toMatch(/\| opus \| – \| 0\/6 \|.*incomplete/);
  });
});

describe('film benchmark: the six films', () => {
  it('each has one brief every tier gets, a playbook that exists and inputs to put in the project', () => {
    const films = loadFilms();
    expect(films.map((f) => f.id)).toEqual(['bhippi-15s', 'crimson-explainer', 'glass-identity', 'white-saas', 'fluid-saas', 'apple-launch']);
    for (const film of films) {
      expect(playbook(film.playbook), film.id).not.toBeNull();
      expect(film.brief).toMatch(/15-second/);
      expect(film.brief).toMatch(/1920x1080 at 30 fps/);
      expect(film.inputs.length, film.id).toBeGreaterThan(0);
      // Offered, never forced: a brief never names a tool or a template, so every tier chooses its own way.
      const names = (catalogue as { tools: { name: string }[] }).tools.map((t) => t.name);
      for (const name of [...names, ...(playbook(film.playbook)!.templates ?? [])]) expect(film.brief.includes(name), `${film.id} names ${name}`).toBe(false);
    }
  });
});

describe('film benchmark: costs from the turn traces', () => {
  it('sums every turn of a film: tokens, active and wall minutes, calls, the judge, and the tier Bhippi used', () => {
    const turn = (t0: number, input: number, output: number, ms: number, tools: { status: string; judge?: number }[]) => [
      { ev: 'turn_start', t: t0, model: 'claude-opus-5-5' },
      { ev: 'turn_sent', t: t0 + 10, model: 'claude-opus-5-5', tier: 'full', effort: 'max', playbook: 'launch-film' },
      ...tools.map((tool, i) => ({ ev: 'tool', t: t0 + 100 + i, name: 'x', status: tool.status, ...(tool.judge ? { judge: { score: tool.judge } } : {}) })),
      { ev: 'turn_end', t: t0 + ms, elapsedMs: ms, usage: { inputTokens: input, outputTokens: output } },
    ];
    const cost = summariseTurns([turn(0, 40_000, 2_000, 120_000, [{ status: 'done' }, { status: 'error' }]), turn(600_000, 60_000, 3_000, 180_000, [{ status: 'done', judge: 81 }])]);
    expect(cost).toMatchObject({ turns: 2, input: 100_000, output: 5_000, tokens: 105_000, activeMinutes: 5, wallMinutes: 13, calls: 3, failed: 1, judge: [81], tiers: ['full'], efforts: ['max'], playbooks: ['launch-film'] });
  });

  it('runs a round end to end: plan, record from traces, blind, score', () => {
    const home = mkdtempSync(join(tmpdir(), 'film-bench-'));
    const run = join(home, 'round');
    const data = join(home, 'appdata');
    const project = join(home, 'projects', 'white-saas-opus');
    const traces = join(data, 'traces', 'p-0000000000000001');
    mkdirSync(traces, { recursive: true });
    writeFileSync(join(traces, 'project.txt'), project.replace(/\\/g, '/'));
    writeFileSync(join(traces, 'turn-1.jsonl'), [
      { ev: 'turn_sent', t: 1, model: 'claude-opus-5-5', tier: 'full', effort: 'max' },
      { ev: 'turn_end', t: 60_001, elapsedMs: 60_000, usage: { inputTokens: 50_000, outputTokens: 1_000 } },
    ].map((e) => JSON.stringify(e)).join('\n'));
    const video = join(home, 'white-saas-opus.mp4');
    writeFileSync(video, 'not really a film');
    const cli = (...args: string[]) => execFileSync(process.execPath, ['scripts/film-bench.ts', ...args], { env: { ...process.env, BHIPPI_DATA: data }, encoding: 'utf8' });
    cli('plan', run);
    expect(JSON.parse(readFileSync(join(run, 'runs.json'), 'utf8'))).toHaveLength(18);
    expect(readFileSync(join(run, 'briefs', 'white-saas.txt'), 'utf8')).toMatch(/one real job/);
    expect(cli('record', run, 'white-saas', 'opus', '--project', project, '--film', video)).toMatch(/51,000 tokens, 1 min active/);
    cli('blind', run, '--seed', '7', '--no-free');
    const { key } = JSON.parse(readFileSync(join(run, 'key.json'), 'utf8')) as { key: KeyEntry[] };
    expect(key).toEqual([{ blind: 'F01', film: 'white-saas', tier: 'opus', video }]);
    expect(existsSync(join(run, 'blind', 'F01.mp4'))).toBe(true);
    expect(existsSync(join(run, 'blind', 'rubric.md'))).toBe(true);
    const blank = JSON.parse(readFileSync(join(run, 'blind', 'F01.card.json'), 'utf8'));
    expect(JSON.stringify(blank)).not.toMatch(/opus/);
    mkdirSync(join(run, 'scores', 'critic-a'), { recursive: true });
    writeFileSync(join(run, 'scores', 'critic-a', 'F01.json'), JSON.stringify({ ...blank, scores: Object.fromEntries(CRITERIA.map((name) => [name, 8.5])) }));
    const results = cli('score', run);
    expect(results).toMatch(/\| white-saas \| \*\*85\*\* · 51 K · 1 min \|/);
    expect(readFileSync(join(run, 'results.md'), 'utf8')).toBe(results.trimEnd() + '\n');
  });
});
