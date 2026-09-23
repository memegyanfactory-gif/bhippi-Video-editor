// The project folder's documents and saved paths — the frontend half of src-tauri/src/bundle.rs.
//
// On save the backend gathers every file the project uses into the project folder and answers
// with old → new paths; `rewritePaths` points the open project at them. `storyboardDocs` turns
// each comp's plan into Markdown filed under Storyboard/, so the plan can be read (and deleted)
// from Explorer like everything else. Pure, so tests can pin them.
import type { ProjectDoc, ProjectDocFile } from './ipc';
import type { Comp, Project, ProductionBeat } from './types';

/** Fields that hold words, never paths — mirrors TEXT_KEYS in bundle.rs. */
const TEXT_KEYS = new Set([
  'text', 'subtitle', 'html', 'css', 'js', 'script', 'narration', 'prompt', 'negativePrompt', 'notes', 'note', 'visual', 'audio', 'intent',
  'evidence', 'description', 'query', 'url', 'mediaUrl', 'title', 'name', 'label', 'headline', 'kicker', 'goal',
]);

/**
 * The project with every path the save moved replaced by its new location. Untouched branches
 * keep their identity, so nothing re-renders (and nothing looks edited) when nothing moved.
 */
export function rewritePaths<T>(value: T, rewrites: { from: string; to: string }[]): T {
  if (!rewrites.length) return value;
  const map = new Map(rewrites.map((entry) => [entry.from, entry.to]));
  const visit = (node: unknown, key: string): unknown => {
    if (typeof node === 'string') return TEXT_KEYS.has(key) ? node : map.get(node) ?? node;
    if (Array.isArray(node)) {
      let changed = false;
      const next = node.map((item) => {
        const out = visit(item, key);
        if (out !== item) changed = true;
        return out;
      });
      return changed ? next : node;
    }
    if (node && typeof node === 'object') {
      let changed = false;
      const next: Record<string, unknown> = {};
      for (const [name, child] of Object.entries(node)) {
        const out = visit(child, name);
        if (out !== child) changed = true;
        next[name] = out;
      }
      return changed ? next : node;
    }
    return node;
  };
  return visit(value, '') as T;
}

const clock = (seconds: number) => {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

const line = (label: string, value: string | number | undefined | null) =>
  value === undefined || value === null || value === '' ? null : `- **${label}:** ${String(value).replace(/\s*\n\s*/g, ' ')}`;

function beatLines(beat: ProductionBeat): string[] {
  const out: (string | null)[] = [];
  if (beat.framing) out.push(line('Framing', beat.framing));
  if (beat.mogrt) out.push(line('Motion graphic', [beat.mogrt.template, beat.mogrt.headline, beat.mogrt.layout].filter(Boolean).join(' · ')));
  if (beat.transition) out.push(line('Transition in', `${beat.transition.kind}${beat.transition.onBeat ? ' (on the beat)' : ''}`));
  if (beat.sfx?.length) out.push(line('Sound', beat.sfx.join('; ')));
  for (const shot of beat.shots ?? []) {
    const what = shot.prompt || shot.url || shot.query || shot.script || '';
    out.push(`- **Shot (${shot.kind})${shot.status ? ` — ${shot.status}` : ''}:** ${what.replace(/\s*\n\s*/g, ' ')}`);
  }
  return out.filter((entry): entry is string => !!entry);
}

/** One comp's plan as a readable Markdown document; null when the comp has no plan. */
export function storyboardMarkdown(comp: Comp): string | null {
  const production = comp.production ?? null;
  const blueprint = comp.videoBlueprint ?? null;
  const board = comp.storyboard ?? [];
  if (!production && !board.length && !blueprint?.scenes?.length) return null;
  const out: string[] = [`# ${comp.name} — storyboard`, ''];
  const facts = [
    production ? (production.mode === 'scratch' ? 'From scratch' : 'Edit of footage') : null,
    production ? `phase: ${production.phase}` : null,
    `${comp.width}×${comp.height} · ${comp.fps} fps`,
    production?.guideline ? `guideline: ${production.guideline}` : null,
  ].filter(Boolean);
  out.push(`_${facts.join(' · ')}_`, '');
  const brief = production?.brief;
  if (brief && Object.values(brief).some((value) => value !== undefined && value !== '')) {
    out.push('## Brief', '', ...[line('Goal', brief.goal), line('Audience', brief.audience), line('Platform', brief.platform), line('Aspect', brief.aspect), line('Target length', brief.targetSeconds ? `${brief.targetSeconds} s` : null)].filter((entry): entry is string => !!entry), '');
  }
  const script = production?.script || blueprint?.script;
  if (script?.trim()) out.push('## Script', '', script.trim(), '');
  if (blueprint?.scenes?.length) {
    out.push('## Scenes', '');
    blueprint.scenes.forEach((scene, index) => {
      out.push(`### ${index + 1}. ${scene.title || scene.visual.slice(0, 60) || 'Scene'} (${clock(scene.start)}–${clock(scene.end)})`, '');
      out.push(...[line('Narration', scene.narration), line('Visual', scene.visual), line('Audio', scene.audio), line('Media', scene.mediaSource), line('Prompt', scene.visualPrompt), line('Download', scene.mediaUrl), line('Picture', scene.thumbnail?.split(/[\\/]/).pop())].filter((entry): entry is string => !!entry));
      out.push(...beatLines(scene), '');
    });
  }
  if (board.length) {
    out.push(blueprint?.scenes?.length ? '## Storyboard' : '## Scenes', '');
    board.forEach((scene, index) => {
      out.push(`### ${index + 1}. ${scene.title || scene.intent.slice(0, 60) || 'Beat'} (${clock(scene.start)}–${clock(scene.end)})`, '');
      out.push(...[line('Intent', scene.intent), line('Visual', scene.visual), line('Audio', scene.audio), line('Evidence', scene.evidence), line('Picture', scene.thumbnail?.split(/[\\/]/).pop())].filter((entry): entry is string => !!entry));
      out.push(...beatLines(scene), '');
    });
  }
  const music = production?.music;
  if (music && music.source !== 'none') {
    out.push('## Music', '', ...[line('Source', music.source), line('Prompt', music.prompt), line('Link', music.url), line('Tempo', music.bpm ? `${music.bpm} BPM` : null), line('Status', music.status)].filter((entry): entry is string => !!entry), '');
  }
  const research = production?.research;
  if (research && (research.sources.length || research.facts.length)) {
    out.push('## Research', '');
    if (research.query) out.push(`_${research.query}_`, '');
    for (const source of research.sources) out.push(`- [${source.title || source.url}](${source.url})${source.note ? ` — ${source.note}` : ''}`);
    if (research.sources.length) out.push('');
    if (research.facts.length) out.push('**Facts relied on**', '', ...research.facts.map((fact) => `- ${fact}`), '');
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/** Every comp's plan, as documents for the save to file under Storyboard/. */
export function storyboardDocs(project: Project): ProjectDocFile[] {
  const docs: ProjectDocFile[] = [];
  const used = new Set<string>();
  for (const comp of project.comps) {
    const content = storyboardMarkdown(comp);
    if (!content) continue;
    let name = `${comp.name} storyboard`;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${comp.name} storyboard (${n})`;
    used.add(name.toLowerCase());
    docs.push({ category: 'storyboard', name, content });
  }
  return docs;
}

/** Task-list boxes as glyphs: the Markdown renderer strips form inputs. */
export function checklistGlyphs(markdown: string): string {
  return markdown.replace(/^(\s*[-*+]\s+)\[( |x|X)\]\s/gm, (_match, bullet: string, mark: string) => `${bullet}${mark === ' ' ? '☐' : '☑'} `);
}

/** Documents grouped by folder, in the order the backend listed them (Guidelines first). */
export function groupDocs(docs: ProjectDoc[]): { folder: string; legacy: boolean; docs: ProjectDoc[] }[] {
  const groups: { folder: string; legacy: boolean; docs: ProjectDoc[] }[] = [];
  for (const doc of docs) {
    const group = groups.find((entry) => entry.folder === doc.folder);
    if (group) group.docs.push(doc);
    else groups.push({ folder: doc.folder, legacy: doc.legacy, docs: [doc] });
  }
  return groups;
}

/** A document's title: its first heading, else its file name without the extension. */
export function docTitle(doc: Pick<ProjectDoc, 'name'>, text?: string | null): string {
  const heading = text ? /^#\s+(.+)$/m.exec(text)?.[1]?.trim() : null;
  return heading || doc.name.replace(/\.(md|markdown|txt)$/i, '');
}
