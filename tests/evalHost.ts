// Runs one eval case (src/lib/templateEval.ts) through the real tool on a fresh project and reads
// back what it built. Shared by the fixed eval and the live-model eval.
import { runTool, type ToolHost } from '../src/lib/aiTools';
import type { Asset, Project, Settings } from '../src/lib/types';
import { newProject } from '../src/lib/timeline';
import { visibleTexts, type Adjustment, type EvalCase, type Outcome } from '../src/lib/templateEval';

export async function runCase(c: EvalCase): Promise<Outcome> {
  let project: Project = newProject();
  const before = new Set(project.comps.flatMap((comp) => comp.clips.map((clip) => clip.id)));
  const settings = { export: {}, speech: {}, disabledProviders: [], recentProjects: [], brandKits: null } as unknown as Settings;
  const host: ToolHost = {
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
  const result = await runTool(host, c.tool, c.args);
  if (!result.ok) return { ok: false, error: result.error, texts: [] };
  const added = project.comps.flatMap((comp) => comp.clips.filter((clip) => !before.has(clip.id)));
  const json = JSON.stringify(added);
  const main = project.comps[0].clips.find((clip) => !before.has(clip.id));
  const accent = /--mg-accent:(#[0-9a-fA-F]{6})/.exec(json)?.[1];
  return { ok: true, summary: result.summary, texts: visibleTexts(json), accent, duration: main?.duration, adjustments: (result as unknown as { adjustments?: Adjustment[] }).adjustments };
}
