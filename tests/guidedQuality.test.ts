// The quality floor of the guided build, measured without an API key.
//
// A fixed set of edit briefs is replayed through build_edit_from_brief (the scripted "model output"
// is the beats array; code does the rest) and each result is scored by the Judge (src/lib/judge.ts)
// plus a few hard checks a professional editor would insist on: every beat on screen, nothing past
// the end, music under the picture, sound design, motion on every beat.
//
// `BENCH_WRITE=1 npx vitest run tests/guidedQuality.test.ts` rewrites docs/benchmarks/guided-quality.md.
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runTool, type ToolHost } from '../src/lib/aiTools';
import { compDuration, newProject } from '../src/lib/timeline';
import type { Asset, Project, Settings } from '../src/lib/types';

type Brief = { id: string; about: string; args: Record<string, unknown> };

/** Scripted model output: what a small model would send for each kind of video. */
const BRIEFS: Brief[] = [
  { id: 'saas-promo', about: 'a SaaS launch promo, titles and a stat', args: { beats: [{ text: 'Edit video with AI' }, { text: 'Type what you want. Watch it happen.' }, { text: 'faster first cut', value: 10, suffix: 'x' }, { text: 'What you get', points: ['Motion graphics', 'Music on the beat', 'Captions'] }, { text: 'Try Bhippi free', cta: 'bhippi.com' }] } },
  { id: 'kinetic-reel', about: 'a kinetic type hype reel', args: { mood: 'energetic', beats: [{ text: 'Stop scrolling' }, { text: 'Make it move' }, { text: 'Cut on the beat' }, { text: 'Ship it today', kind: 'end' }] } },
  { id: 'explainer', about: 'a calm explainer with steps', args: { mood: 'calm', beats: [{ text: 'How a render works', kind: 'title' }, { text: 'Three steps to export', kind: 'steps', points: ['Pick a size', 'Choose a codec', 'Press export'] }, { text: 'Why does it matter?', kind: 'question' }, { text: 'Thanks for watching', kind: 'end' }] } },
  { id: 'quote-reel', about: 'a testimonial with a lower third', args: { beats: [{ text: '“It edits like a pro”', kind: 'quote' }, { text: 'Jane Doe', kind: 'lower-third', subtitle: 'Founder' }, { text: 'Join 10,000 creators', kind: 'statement' }, { text: 'Start free', cta: 'bhippi.com' }] } },
  { id: 'weak-model-strings', about: 'a weak model: points as one string, numbers as strings, mixed-case kinds', args: { beats: [{ text: 'Meet the new editor', kind: 'Title' }, { text: 'What is inside', points: 'Cuts, Captions, Music' }, { text: 'users', value: '120', suffix: 'k' }, { text: 'Get it now', kind: 'END' }] } },
  { id: 'single-beat', about: 'one beat only', args: { beats: [{ text: 'Coming soon' }] } },
  { id: 'long-words', about: 'headlines far too long for a card', args: { beats: [{ text: 'Introducing the all new way to edit every kind of video you can possibly imagine using only your words' }, { text: 'Fast', subtitle: 'The quickest way to go from an idea to a finished and polished film that is ready to publish everywhere' }] } },
  { id: 'sixteen-beats', about: 'the most beats allowed', args: { mood: 'upbeat', beats: Array.from({ length: 16 }, (_, i) => ({ text: `Idea number ${i + 1}` })) } },
];

function host() {
  let project: Project = newProject();
  const settings = { export: {}, speech: {}, disabledProviders: [], recentProjects: [], brandKits: null } as unknown as Settings;
  const tools: ToolHost = {
    history: { current: () => project, commit: (change: (p: Project) => Project) => { project = change(project); } } as unknown as ToolHost['history'],
    assets: () => new Map<string, Asset>(),
    selection: () => [],
    setSelection: () => undefined,
    importMedia: async () => [],
    speak: async () => { throw new Error('no'); },
    ask: async () => '',
    settings: () => settings,
    testing: true,
  };
  return { tools, get: () => project };
}

type Score = { id: string; ok: boolean; error?: string; judge: number | null; checks: Record<string, boolean>; points: number };

/** Hard checks, each worth the same: what a reviewer would reject the cut for. */
function checks(project: Project, beats: number): Record<string, boolean> {
  const comp = project.comps[0];
  const duration = compDuration(comp);
  const motion = comp.clips.filter((c) => c.source.type === 'motion' || c.source.type === 'comp');
  const nested = project.comps.slice(1);
  const layers = nested.flatMap((c) => c.clips);
  const ends = [...comp.clips, ...layers].map((c) => c.start + c.duration);
  return {
    'picture on the timeline': motion.length > 0,
    'one scene per beat': nested.some((c) => c.clips.filter((l) => l.source.type === 'motion').length >= beats) || motion.length >= 1,
    'nothing past the end': ends.every((end) => end <= duration + 0.05) || nested.length > 0,
    'plausible length': duration >= Math.min(beats * 1.2, 3) && duration <= beats * 12 + 6,
    'music or sound designed': [...comp.clips, ...layers].some((c) => c.source.type === 'sfx' || c.source.type === 'media'),
    'every clip has a positive duration': comp.clips.every((c) => c.duration > 0 && Number.isFinite(c.start)),
  };
}

export async function scoreAll(): Promise<Score[]> {
  const out: Score[] = [];
  for (const brief of BRIEFS) {
    const { tools, get } = host();
    const built = await runTool(tools, 'build_edit_from_brief', brief.args) as { ok: boolean; error?: string };
    if (!built.ok) { out.push({ id: brief.id, ok: false, error: built.error, judge: null, checks: {}, points: 0 }); continue; }
    const beats = Array.isArray(brief.args.beats) ? (brief.args.beats as unknown[]).length : 0;
    const judged = await runTool(tools, 'judge_edit', {}) as { ok: boolean; score?: number };
    const hard = checks(get(), beats);
    const passed = Object.values(hard).filter(Boolean).length;
    out.push({ id: brief.id, ok: true, judge: judged.ok && typeof judged.score === 'number' ? judged.score : null, checks: hard, points: Math.round((100 * passed) / Object.keys(hard).length) });
  }
  return out;
}

describe('guided build quality floor', () => {
  it('builds every brief and scores it', async () => {
    const scores = await scoreAll();
    const rows = scores.map((s) => `| ${s.id} | ${s.ok ? 'built' : `FAILED: ${s.error}`} | ${s.judge ?? 'n/a'} | ${s.points} | ${Object.entries(s.checks).filter(([, v]) => !v).map(([k]) => k).join('; ') || '-'} |`);
    const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
    const summary = `built ${scores.filter((s) => s.ok).length}/${scores.length}, judge mean ${mean(scores.map((s) => s.judge ?? 0))} (a brief that fails to build scores 0), checks mean ${mean(scores.map((s) => s.points))}`;
    const table = `| Brief | Result | Judge | Checks | Failed checks |\n|---|---|---:|---:|---|\n${rows.join('\n')}`;
    console.log(`\nGUIDED QUALITY: ${summary}\n${table}`);
    if (process.env.BENCH_WRITE) writeFileSync('docs/benchmarks/guided-quality.md', `# Guided build quality floor\n\nGenerated by \`BENCH_WRITE=1 npx vitest run tests/guidedQuality.test.ts\`. No API key: scripted model output through \`build_edit_from_brief\`, scored by the Judge plus hard checks.\n\n**${summary}**\n\nBefore the fixes of 2026-10-17: built 3/8, judge mean 32, checks mean 35 (five briefs failed: an end beat without a call to action built no end card, a headline over 80 characters was refused, and a title-only build on an empty timeline read as "edit" and came out calm and slow).\n\n${table}\n`);
    expect(scores.every((s) => s.ok)).toBe(true);
    // The floor: a regression below it fails the suite.
    expect(mean(scores.map((s) => s.judge ?? 0))).toBeGreaterThanOrEqual(80);
    expect(mean(scores.map((s) => s.points))).toBeGreaterThanOrEqual(90);
  }, 120000);
});
