import { describe, expect, it } from 'vitest';
import { genreChecks, inferGenres, judge, PASS_MARK } from '../src/lib/judge';
import type { CouncilReview } from '../src/lib/council';
import type { PacingReport } from '../src/lib/pacing';
import { newClip, newProject, tracksOf } from '../src/lib/timeline';
import type { Project } from '../src/lib/types';
import type { MotionScene } from '../src/motion/types';

const review = (over: Partial<CouncilReview> = {}): CouncilReview => ({
  notes: [], motionDensity: 0.9, frames: [90, 100],
  verdicts: { animator: 'approve', researcher: 'approve', audio: 'approve', director: 'approve', comedian: 'approve' },
  ...over,
} as CouncilReview);
const pacing = (ok = true): PacingReport => ({ ok, summary: '', events: [], checks: [{ token: 'swap cadence', measured: '3 s', target: '2–5 s', ok }] });

function characterFilm(actions: { t: number; do: string }[]): Project {
  const project = newProject();
  const comp = project.comps[0];
  const scene: MotionScene = {
    version: 1, width: 1920, height: 1080, duration: 10,
    layers: [{ id: 'char-kai', name: 'Kai', type: 'character', character: { kind: 'studio', spec: { name: 'Kai' }, actions } } as never],
  };
  comp.clips.push(newClip({ trackId: tracksOf(comp, 'video')[0].id, start: 0, duration: 10, source: { type: 'motion', scene } }));
  comp.storyboard = [{ start: 0, end: 10, intent: 'Kai meets the boss', visual: 'Kai', audio: '', evidence: '' } as never];
  return project;
}

describe('the Judge', () => {
  it('fails a character video whose character only stands there, and says why', () => {
    const project = characterFilm([]);
    const comp = project.comps[0];
    expect(inferGenres(project, comp)).toContain('character2d');
    const verdict = judge({ project, comp, review: review({ motionDensity: 0.3 }), pacing: pacing(false), qa: { ran: true, issues: [{ kind: 'outside-safe', a: 'title' }] }, genres: ['character2d'] });
    expect(verdict.pass).toBe(false);
    expect(verdict.score).toBeLessThan(PASS_MARK);
    expect(verdict.fixes.join('\n')).toContain('every character acts');
  });

  it('passes a clean, acting, on-pace character film', () => {
    const project = characterFilm([{ t: 0.2, do: 'wave' }, { t: 1.5, do: 'walk' }, { t: 3, do: 'celebrate' }]);
    const comp = project.comps[0];
    const checks = genreChecks(project, comp, 'character2d');
    expect(checks.every(([, met]) => met)).toBe(true);
    const verdict = judge({ project, comp, review: review(), pacing: pacing(true), qa: { ran: true, issues: [] }, genres: ['character2d'] });
    expect(verdict.score).toBeGreaterThanOrEqual(PASS_MARK);
    expect(verdict.pass).toBe(true);
  });

  it('never passes with a council block or unchecked frames', () => {
    const project = characterFilm([{ t: 0.2, do: 'wave' }, { t: 1.5, do: 'walk' }]);
    const comp = project.comps[0];
    const blocked = judge({ project, comp, review: review({ notes: [{ member: 'audio', severity: 'block', text: 'no music bed', fix: 'add one' } as never] }), pacing: pacing(), qa: { ran: true, issues: [] }, genres: ['character2d'] });
    expect(blocked.pass).toBe(false);
    const unseen = judge({ project, comp, review: review(), pacing: pacing(), qa: { ran: false, issues: [] }, genres: ['character2d'] });
    expect(unseen.criteria.find((c) => c.id === 'frames')?.score).toBe(0);
  });

  it('asks a SaaS ad for its UI and its call to action', () => {
    const project = newProject();
    const checks = genreChecks(project, project.comps[0], 'saas');
    expect(checks.map(([what]) => what).join(' ')).toContain('UI');
    expect(checks.some(([, met]) => met)).toBe(false);
  });
});

describe('the Editor: type a phone can read', () => {
  it('flags a text box shorter than ~2% of the frame, not a normal title', async () => {
    const { frameQa } = await import('../src/lib/production');
    const comp = newProject().comps[0];
    const tiny = { clipId: 'a', name: 'tiny label', kind: 'text' as const, box: { x: 0.2, y: 0.5, width: 0.2, height: 0.012 }, from: 0, to: 5 };
    const title = { clipId: 'b', name: 'Title', kind: 'text' as const, box: { x: 0.2, y: 0.2, width: 0.5, height: 0.08 }, from: 0, to: 5 };
    const issues = frameQa(comp, [tiny, title], [1]);
    expect(issues.filter((i) => i.kind === 'small-text').map((i) => i.a)).toEqual(['tiny label']);
  });
});
