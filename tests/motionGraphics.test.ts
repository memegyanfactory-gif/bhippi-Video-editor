import { describe, expect, it } from 'vitest';
import { buildMotionGraphic, createMotionGraphicComp } from '../src/lib/motionGraphics';
import type { Comp, Project } from '../src/lib/types';
import { runTool, type ToolHost } from '../src/lib/aiTools';

function createDummyProject(): Project {
  const comp: Comp = {
    id: 'main-seq',
    name: 'Sequence 01',
    width: 1920,
    height: 1080,
    fps: 30,
    tracks: [
      { id: 'v1', kind: 'video', name: 'Video 1', locked: false, hidden: false, muted: false, solo: false, targeted: true, syncLock: true, height: 64 },
      { id: 'a1', kind: 'audio', name: 'Audio 1', locked: false, hidden: false, muted: false, solo: false, targeted: true, syncLock: true, height: 64 },
    ],
    clips: [
      {
        id: 'vid-1',
        trackId: 'v1',
        start: 0,
        duration: 10,
        in: 0,
        speed: 1,
        source: { type: 'media', assetId: 'footage-1' },
        linkId: null,
        enabled: true,
        name: 'Interview.mp4',
        volume: 1,
        transform: { fit: 'fit', x: 0, y: 0, scale: 100, rotation: 0, opacity: 1, cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0 },
        effects: { brightness: 0, contrast: 0, saturation: 100, blur: 0, hue: 0, invert: 0, flipH: false, flipV: false },
        label: null,
        groupId: null,
        reverse: false,
        maintainPitch: true,
        hold: null,
        interpolation: 'sampling',
        deinterlace: false,
        adjustment: false,
        mask: null,
        keyframes: { x: [], y: [], scale: [], rotation: [], opacity: [], volume: [] },
        channels: 'stereo',
        enhanceSpeech: false,
        audioType: null,
      },
    ],
    markers: [],
    transitions: [],
    inPoint: null,
    outPoint: null,
    sourceVideo: null,
    sourceAudio: null,
    folderId: null,
  };

  return {
    version: 3,
    name: 'Motion Test',
    comps: [comp],
    items: [],
    media: [],
    folders: [],
    activeCompId: 'main-seq',
    openCompIds: ['main-seq'],
    captionStyle: null,
  };
}

describe('Motion Graphics Templates', () => {
  it('builds a sleek lower-third template with glassmorphism', () => {
    const bundle = buildMotionGraphic({
      template: 'lower-third',
      title: 'Elena Rostova',
      subtitle: 'Chief AI Architect',
      accentColor: '#10b981',
      badge: 'SPEAKER',
    });

    expect(bundle.template).toBe('lower-third');
    expect(bundle.html).toContain('Elena Rostova');
    expect(bundle.html).toContain('Chief AI Architect');
    expect(bundle.html).toContain('SPEAKER');
    expect(bundle.css).toContain('backdrop-filter');
    expect(bundle.css).toContain('#10b981');
    expect(bundle.js).toContain('gsap');
  });

  it('builds a kinetic title with individual word animations', () => {
    const bundle = buildMotionGraphic({
      template: 'kinetic-title',
      title: 'THE FUTURE OF VIDEO',
      subtitle: 'Generative Non-Linear Editing',
      accentColor: '#f43f5e',
    });

    expect(bundle.template).toBe('kinetic-title');
    expect(bundle.html).toContain('THE');
    expect(bundle.html).toContain('FUTURE');
    expect(bundle.html).toContain('VIDEO');
    expect(bundle.css).toContain('mgt-kinetic-headline');
  });

  it('builds stat callouts with metrics and progress tracks', () => {
    const bundle = buildMotionGraphic({
      template: 'stat-callout',
      title: 'Active Subscribers',
      metric: '+450K',
      badge: 'VERIFIED',
    });

    expect(bundle.template).toBe('stat-callout');
    expect(bundle.html).toContain('+450K');
    expect(bundle.html).toContain('Active Subscribers');
    expect(bundle.html).toContain('mgt-progress-track');
  });

  it('supports custom agent-authored HTML/CSS/GSAP', () => {
    const customHtml = '<div class="neon-box"><h1>CYBER</h1></div>';
    const customCss = '.neon-box { color: cyan; }';
    const customJs = 'gsap.to(".neon-box", { rotation: 360 });';

    const bundle = buildMotionGraphic({
      template: 'custom',
      title: 'Cyber Box',
      html: customHtml,
      css: customCss,
      js: customJs,
    });

    expect(bundle.template).toBe('custom');
    expect(bundle.html).toBe(customHtml);
    expect(bundle.css).toBe(customCss);
    expect(bundle.js).toBe(customJs);
  });
});

describe('createMotionGraphicComp', () => {
  it('creates a dedicated MOGRT comp and overlays it on Track V2', () => {
    const project = createDummyProject();
    const result = createMotionGraphicComp(project, {
      template: 'lower-third',
      title: 'Alex Mercer',
      subtitle: 'Lead Director',
      duration: 5,
      asNestedComp: true,
    });

    // 1. Project should contain the new MOGRT comp
    expect(result.mogrtComp).toBeDefined();
    expect(result.project.comps.length).toBe(2);
    expect(result.mogrtComp?.name).toContain('Alex Mercer');

    // 2. The inner MOGRT comp contains the HTML clip
    const innerClip = result.mogrtComp?.clips[0];
    expect(innerClip).toBeDefined();
    expect(innerClip?.source.type).toBe('html');
    if (innerClip?.source.type === 'html') {
      expect(innerClip.source.html).toContain('Alex Mercer');
    }

    // 3. The target comp received track V2 and a comp-overlay clip
    const updatedTargetComp = result.project.comps.find((c) => c.id === 'main-seq');
    expect(updatedTargetComp).toBeDefined();
    const v2Track = updatedTargetComp?.tracks.find((t) => t.id === 'v2');
    expect(v2Track).toBeDefined();

    const overlayClip = updatedTargetComp?.clips.find((c) => c.id === result.newClipId);
    expect(overlayClip).toBeDefined();
    expect(overlayClip?.trackId).toBe('v2');
    expect(overlayClip?.source.type).toBe('comp');
    if (overlayClip?.source.type === 'comp') {
      expect(overlayClip.source.compId).toBe(result.mogrtComp?.id);
    }
  });

  it('can insert direct HTML clips when asNestedComp is false', () => {
    const project = createDummyProject();
    const result = createMotionGraphicComp(project, {
      template: 'feature-badge',
      title: '4K PROXY READY',
      asNestedComp: false,
    });

    expect(result.mogrtComp).toBeUndefined();
    expect(result.project.comps.length).toBe(1);

    const updatedComp = result.project.comps[0];
    const clip = updatedComp.clips.find((c) => c.id === result.newClipId);
    expect(clip).toBeDefined();
    expect(clip?.source.type).toBe('html');
  });
});

describe('AI Tool create_motion_graphic', () => {
  it('successfully invokes create_motion_graphic through runTool', async () => {
    let currentProject = createDummyProject();
    let selected: string[] = [];

    const host = {
      project: () => currentProject,
      assets: () => new Map(),
      offline: () => new Set(),
      selection: () => selected,
      setSelection: (ids: string[]) => { selected = ids; },
      history: {
        current: () => currentProject,
        commit: (change: (p: Project) => Project) => {
          currentProject = typeof change === 'function' ? change(currentProject) : change;
        },
      },
      activeComp: () => currentProject.comps[0],
      setActiveComp: () => {},
      openComps: () => currentProject.comps,
      openComp: () => {},
      closeComp: () => {},
    } as unknown as ToolHost;

    const response = await runTool(host, 'create_motion_graphic', {
      template: 'lower-third',
      title: 'Steve Jobs',
      subtitle: 'Co-founder, Apple',
      accentColor: '#00e5ff',
    });

    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error);
    expect(response.summary).toContain('Steve Jobs');
    expect(selected.length).toBe(1);

    // Verify commit in history
    expect(currentProject.comps.length).toBe(2);
    const mainSeq = currentProject.comps.find((c) => c.id === 'main-seq');
    const overlay = mainSeq?.clips.find((c) => c.id === selected[0]);
    expect(overlay).toBeDefined();
    expect(overlay?.source.type).toBe('comp');
  });
});

describe('motion graphic visibility', () => {
  it('creates clips at full opacity so nested comps are not empty/invisible', () => {
    const nested = createMotionGraphicComp(createDummyProject(), { template: 'lower-third', title: 'Name', asNestedComp: true });
    expect(nested.mogrtComp).toBeDefined();
    const inner = nested.mogrtComp!.clips;
    expect(inner).toHaveLength(1);
    expect(inner[0].source.type).toBe('html');
    // Opacity is a 0–100 percent scale (see DEFAULT_TRANSFORM): 1 renders at
    // 1% and reads as an empty nested comp with a lagging preview.
    for (const clip of [...inner, ...nested.project.comps.flatMap((comp) => comp.clips.filter((entry) => entry.id === nested.newClipId))]) {
      expect(clip.transform.opacity).toBe(100);
      expect(clip.transform.scale).toBe(100);
    }
    const direct = createMotionGraphicComp(createDummyProject(), { template: 'lower-third', title: 'Name', asNestedComp: false });
    const placed = direct.project.comps[0].clips.find((clip) => clip.id === direct.newClipId);
    expect(placed?.transform.opacity).toBe(100);
  });
});
