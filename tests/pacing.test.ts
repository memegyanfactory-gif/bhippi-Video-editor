import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../src/lib/ipc', () => ({
  api: { rotoRead: vi.fn(async () => null), transcriptsCached: vi.fn(async () => []) },
  errorText: (e: unknown) => String(e),
  fileSrc: (p: string) => p,
}));

import { beatSync, summarizeProfile, type MotionProfile } from '../src/lib/referenceMotion';
import { GENERIC_TARGET, pacingReport } from '../src/lib/pacing';
import { PLAYBOOKS } from '../src/lib/motionDirection';
import { runMotionTool, type MotionToolContext } from '../src/lib/motionTools';
import { newProject, updateComp } from '../src/lib/timeline';
import type { Project } from '../src/lib/types';

const workly = JSON.parse(readFileSync(new URL('./fixtures/workly-motion-profile.json', import.meta.url), 'utf-8')) as MotionProfile;
const peaksBytes = new Uint8Array(readFileSync(new URL('./fixtures/workly-peaks.bin', import.meta.url)));

describe('reference motion profile', () => {
  it('turns the Workly measurement into a headline, a tempo and a ±25% pacing target', () => {
    const summary = summarizeProfile(workly, { data: peaksBytes, buckets: peaksBytes.length / 2 });
    expect(summary.headline).toContain('blur-bridge');
    expect(summary.pacingTarget.swapGap![0]).toBeCloseTo(workly.cadence.medianGap * 0.75, 2);
    expect(summary.pacingTarget.swapGap![1]).toBeCloseTo(workly.cadence.medianGap * 1.25, 2);
    expect(summary.pacingTarget.eases?.[0]).toBe('house');
    expect(summary.tempo?.bpm).toBeGreaterThan(60);
    expect(summary.cutSync?.chance).toBeGreaterThan(0);
  });

  it('beat sync counts times within the tolerance and knows the chance baseline', () => {
    const beats = Array.from({ length: 20 }, (_, i) => i * 0.5);
    const sync = beatSync([1.0, 2.02, 3.3, 4.49], beats, 2 / 30);
    expect(sync.onBeat).toBe(3);
    expect(sync.chance).toBeCloseTo((2 * 2) / 30 / 0.5, 3);
  });
});

describe('pacing QA', () => {
  function harness(project: Project) {
    let current = project;
    const ctx = {
      get project() { return current; },
      assets: new Map(),
      commit: (change: (p: Project) => Project) => { current = change(current); },
      editComp: (c: Project['comps'][number], change: (c: Project['comps'][number]) => Project['comps'][number]) => { current = updateComp(current, c.id, change); },
      pickComp: (p: Project) => p.comps[0],
      current: () => current,
    } as unknown as MotionToolContext;
    return { ctx, get: () => current };
  }
  const beat = (text: string, dur: number, entrance: number) => ({ scene: { duration: dur, layers: [
    { id: 't', type: 'text', text: { text }, transform: { opacity: { k: [{ t: 0, v: 0 }, { t: entrance, v: 100 }] } } },
  ] } });

  it('flags slow entrances, unreadable text and a sluggish cadence, and passes a well-paced edit', async () => {
    const { ctx, get } = harness(newProject());
    await runMotionTool('create_motion_sequence', { beats: [beat('Meet your new workspace for every team today', 1.2, 2.5), beat('Two', 9, 2.4), beat('Three', 9, 2.6)], transitions: ['cut', 'cut'] }, ctx);
    const slow = pacingReport(get(), get().comps[0], PLAYBOOKS.find((p) => p.id === 'saas-explainer')!.pacing!);
    const byToken = Object.fromEntries(slow.checks.map((c) => [c.token, c]));
    expect(byToken['entrances'].ok).toBe(false);
    expect(byToken['reading holds'].ok).toBe(false);
    expect(byToken['swap cadence'].ok).toBe(false);
    expect(slow.ok).toBe(false);

    const good = harness(newProject());
    await runMotionTool('create_motion_sequence', { beats: [beat('One', 3.5, 0.4), beat('Two', 3.5, 0.3), beat('Three', 3.5, 0.5), beat('Four', 3.5, 0.4)], transitions: ['cut', 'cut', 'cut'] }, good.ctx);
    const report = pacingReport(good.get(), good.get().comps[0], PLAYBOOKS.find((p) => p.id === 'saas-explainer')!.pacing!);
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
    expect(report.events.length).toBeGreaterThanOrEqual(4);
  });

  it('scores cuts on the beat when beats are given', async () => {
    const { ctx, get } = harness(newProject());
    await runMotionTool('create_motion_sequence', { beats: [beat('A', 2, 0.3), beat('B', 2, 0.3), beat('C', 2, 0.3)], transitions: ['cut', 'cut'] }, ctx);
    const onGrid = pacingReport(get(), get().comps[0], GENERIC_TARGET, Array.from({ length: 16 }, (_, i) => i * 0.5));
    expect(onGrid.checks.find((c) => c.token === 'on the beat')?.ok).toBe(true);
    const offGrid = pacingReport(get(), get().comps[0], GENERIC_TARGET, Array.from({ length: 16 }, (_, i) => i * 0.5 + 0.23));
    expect(offGrid.checks.find((c) => c.token === 'on the beat')?.ok).toBe(false);
  });

  it('check_pacing reads a genre or a reference target', async () => {
    const { ctx } = harness(newProject());
    await runMotionTool('create_motion_sequence', { beats: [beat('A', 3, 0.4), beat('B', 3, 0.4)], transitions: ['cut'] }, ctx);
    const genre = await runMotionTool('check_pacing', { genre: 'saas-explainer' }, ctx) as { ok: boolean; summary: string; checks: unknown[] };
    expect(genre.summary).toContain('genre saas-explainer');
    const ref = await runMotionTool('check_pacing', { target: { swapGap: [0.5, 1] } }, ctx) as { summary: string };
    expect(ref.summary).toContain('swap cadence');
    const bad = await runMotionTool('check_pacing', { genre: 'opera' }, ctx) as { error: string };
    expect(bad.error).toContain('saas-explainer');
  });

  it('every genre playbook except sound carries a pacing target', () => {
    for (const book of PLAYBOOKS) if (book.id !== 'sound') expect(book.pacing?.swapGap, book.id).toBeTruthy();
  });
});
