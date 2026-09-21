import { describe, expect, it } from 'vitest';
import {
  evaluateChoice,
  evaluateScore,
  evaluateNoul,
  decideEditAction,
  rankBrollCandidates,
  decideRhythmCut,
} from '../src/lib/typedDecisions';
import { runTool, type ToolHost } from '../src/lib/aiTools';
import type { Comp, Project } from '../src/lib/types';

function createMockHost(): ToolHost {
  const comp: Comp = {
    id: 'test-comp',
    name: 'Sequence 1',
    width: 1920,
    height: 1080,
    fps: 30,
    tracks: [
      { id: 'v1', kind: 'video', name: 'V1', locked: false, hidden: false, muted: false, solo: false, targeted: true, syncLock: true, height: 64 },
    ],
    clips: [],
    markers: [],
    transitions: [],
    inPoint: null,
    outPoint: null,
    sourceVideo: null,
    sourceAudio: null,
    folderId: null,
  };
  let project: Project = {
    version: 3,
    name: 'Test Project',
    comps: [comp],
    items: [],
    folders: [],
    media: [],
    activeCompId: 'test-comp',
    openCompIds: ['test-comp'],
    captionStyle: null,
  };

  return {
    history: {
      current: () => project,
      commit: (change: (p: Project) => Project) => { project = change(project); },
      undo: () => {},
      redo: () => {},
      canUndo: () => false,
      canRedo: () => false,
      subscribe: () => () => {},
    },
    assets: () => new Map(),
    activeCompId: () => comp.id,
    playheadTime: () => 0,
    selection: () => [],
    setSelection: () => {},
    importMedia: async () => [],
    ask: async () => '',
    speak: () => {},
  } as unknown as ToolHost;
}

describe('Laya MLX Typed Decisions', () => {
  describe('evaluateChoice', () => {
    it('evaluates choices and produces calibrated probability distribution summing to 1', () => {
      const decision = evaluateChoice({
        premise: 'The audio speaker is introducing a new topic and speech energy spikes.',
        choices: [
          'cut to close-up camera angle to emphasize topic change',
          'insert title card overlay with topic headline',
          'keep wide shot with no edit',
        ],
        temperature: 0.5,
      });

      expect(decision.type).toBe('choice');
      expect(decision.options.length).toBe(3);
      const sumProb = decision.distribution.reduce((acc, p) => acc + p.probability, 0);
      expect(sumProb).toBeCloseTo(1, 3);
      expect(decision.confidence).toBeGreaterThan(0);
      expect(decision.confidence).toBeLessThanOrEqual(1);
      expect(typeof decision.decision).toBe('string');
      expect(decision.decision).toBe(decision.distribution[0].option);
    });

    it('handles temperature adjustments correctly', () => {
      const cold = evaluateChoice({
        premise: 'High tempo music transition point',
        choices: ['whip-pan transition', 'hard cut', 'dissolve'],
        temperature: 0.2,
      });

      const warm = evaluateChoice({
        premise: 'High tempo music transition point',
        choices: ['whip-pan transition', 'hard cut', 'dissolve'],
        temperature: 1.5,
      });

      // Lower temperature makes top choice sharper / higher confidence
      expect(cold.distribution[0].probability).toBeGreaterThanOrEqual(warm.distribution[0].probability - 0.05);
    });
  });

  describe('evaluateScore', () => {
    it('evaluates rubrics and calculates calibrated expected score', () => {
      const scored = evaluateScore({
        premise: 'Clip color balance has warm skin tones and balanced contrast under daylight',
        rubric: ['poor', 'acceptable', 'good', 'exceptional'],
        minScore: 1,
        maxScore: 10,
      });

      expect(scored.type).toBe('score');
      expect(scored.score).toBeGreaterThanOrEqual(1);
      expect(scored.score).toBeLessThanOrEqual(10);
      expect(scored.levels.length).toBe(4);
      const sumProb = scored.levels.reduce((acc, l) => acc + l.probability, 0);
      expect(sumProb).toBeCloseTo(1, 3);
    });
  });

  describe('evaluateNoul', () => {
    it('verifies conditions with calibrated probability and truth threshold', () => {
      const verification = evaluateNoul({
        premise: 'Clip speech segment contains a pause longer than 1.2 seconds.',
        condition: 'Speaker pause warrants jump-cut removal',
        threshold: 0.5,
      });

      expect(verification.type).toBe('noul');
      expect(typeof verification.result).toBe('boolean');
      expect(verification.pTrue).toBeGreaterThanOrEqual(0);
      expect(verification.pTrue).toBeLessThanOrEqual(1);
      expect(verification.result).toBe(verification.pTrue >= 0.5);
    });
  });

  describe('Domain helpers', () => {
    it('decideEditAction selects action based on context and goals', () => {
      const action = decideEditAction({
        context: 'Hook section 0-3s has declining viewer retention.',
        goal: 'Increase visual pacing and dynamism',
        options: ['add motion typography', 'cut to fast B-roll montage', 'add sound effect riser'],
      });

      expect(['add motion typography', 'cut to fast B-roll montage', 'add sound effect riser']).toContain(action.decision);
      expect(action.confidence).toBeGreaterThan(0.3);
    });

    it('rankBrollCandidates orders footage candidates by relevance', () => {
      const candidates = [
        { id: 'b1', description: 'Office worker typing on mechanical keyboard' },
        { id: 'b2', description: 'Aerial cityscape sunset drone footage' },
        { id: 'b3', description: 'Software code editor scrolling fast' },
      ];

      const ranked = rankBrollCandidates('Software engineer debugging code in an office', candidates);
      expect(ranked.length).toBe(3);
      expect(ranked[0].candidate.id).toBeDefined();
      expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
      expect(ranked[1].score).toBeGreaterThanOrEqual(ranked[2].score);
    });

    it('decideRhythmCut analyzes audio beats and speech boundaries', () => {
      const cut = decideRhythmCut({
        timeSeconds: 4.25,
        isAudioBeat: true,
        isSpeechPause: true,
        minShotDuration: 1.0,
        currentShotDuration: 2.5,
      });

      expect(typeof cut.shouldCut).toBe('boolean');
      expect(cut.confidence).toBeGreaterThan(0);
      expect(cut.reason).toBeDefined();
    });
  });

  describe('AI Tool Integration (typed_decision)', () => {
    it('executes typed_decision tool via runTool', async () => {
      const host = createMockHost();
      const result = await runTool(
        host,
        'typed_decision',
        {
          mode: 'choice',
          premise: 'Select the optimal motion graphic style for a tech startup product reveal',
          choices: ['cyberpunk neon glitched', 'minimalist sleek glassmorphism', 'playful organic cartoon'],
        },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error);
      expect(result.summary).toContain('Decided:');
      expect(result.summary).toContain('Confidence:');
      expect((result as any).decision).toBeDefined();
      expect((result as any).decision.type).toBe('choice');
    });

    it('executes typed_decision score mode', async () => {
      const host = createMockHost();
      const result = await runTool(
        host,
        'typed_decision',
        {
          mode: 'score',
          premise: 'Evaluate pacing match between music BPM 120 and rapid cut transitions',
          rubric: ['poor', 'decent', 'tight rhythmic sync', 'frame-accurate perfection'],
          minScore: 1,
          maxScore: 100,
        },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error);
      expect(result.summary).toContain('Score:');
      expect((result as any).decision.score).toBeGreaterThan(0);
    });

    it('executes typed_decision noul mode', async () => {
      const host = createMockHost();
      const result = await runTool(
        host,
        'typed_decision',
        {
          mode: 'noul',
          premise: 'The frame has low contrast and high noise in the shadows',
          condition: 'Requires denoising and black level lift before grading',
          threshold: 0.5,
        },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error);
      expect(result.summary).toContain('Condition:');
      expect(result.summary).toContain('P(true):');
      expect(typeof (result as any).decision.result).toBe('boolean');
    });
  });
});
