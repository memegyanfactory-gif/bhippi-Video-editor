// template-lab.html: every house template under the eval's inputs (clean, a bit long, extra slots),
// auto-fixed and built as the tool builds it, drawn at its hold frame with the layout check's
// findings outlined. `?profile=longish` shows one profile; `?json` prints the findings for scripts.
import { CRIMSON_TEMPLATES } from './motionGuide';
import { buildMotionGraphic } from './motionGraphics';
import { layoutIssues, type LayoutIssue } from './graphicCheck';
import { checkGraphic, refit } from './graphicCheckRun';
import { evalCases } from './templateEval';
import { fitScales, fixTemplateArgs } from './templateFix';
import { CRIMSON_SLOTS } from './templateSlots';
import { CRIMSON_EXAMPLES } from './templateExamples';
import { findArchetype } from './brandKit/archetypes';
import { kitFromArchetype, retintGraphicHtml } from './brandKit/build';
import '../fonts/fiwn.css';

const params = new URLSearchParams(location.search);
const only = params.get('profile');
const profiles = only ? [only] : ['clean', 'longish', 'extra-slots'];
const canvas = { width: 1920, height: 1080 };
const scale = 0.3;
const report: { id: string; issues: LayoutIssue[]; error?: string }[] = [];
/** `?kit=<archetype id>`: every graphic retinted by that brand kit, as the tool does with a kit active. */
const archetype = params.get('kit') ? findArchetype(params.get('kit')) : undefined;
const kit = archetype ? kitFromArchetype(archetype) : null;
const branded = (html: string) => (kit ? retintGraphicHtml(html, kit) : html);

document.body.style.cssText = 'margin:0;background:#1b1b1b;color:#ddd;font:12px system-ui;display:flex;flex-wrap:wrap;gap:10px;padding:10px';

async function main() {
  await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 3000))]);
  const cases = params.get('profile') === 'examples'
    ? Object.entries(CRIMSON_EXAMPLES).map(([id, args]) => ({ id: `${id}/example`, template: id, args: { template: id, ...args } }))
    : evalCases().filter((c) => c.tool === 'create_motion_graphic' && profiles.includes(c.profile) && CRIMSON_TEMPLATES.some((t) => t.id === c.template));
  for (const c of cases) {
    const { template, ...rest } = c.args as { template: string } & Record<string, unknown>;
    const fixed = fixTemplateArgs(template, CRIMSON_SLOTS[template], rest, { plate: '#100607' });
    const cell = document.createElement('div');
    cell.style.cssText = `width:${canvas.width * scale}px`;
    const label = document.createElement('div');
    label.textContent = c.id;
    cell.appendChild(label);
    document.body.appendChild(cell);
    if (fixed.error) { label.textContent += ` — refused: ${fixed.error.slice(0, 80)}`; report.push({ id: c.id, issues: [], error: fixed.error }); continue; }
    const a = fixed.args as Record<string, never>;
    const bundle = buildMotionGraphic({ template, ...a, canvas, fit: fitScales(fixed.adjustments) });
    const frame = document.createElement('div');
    frame.style.cssText = `position:relative;width:${canvas.width * scale}px;height:${canvas.height * scale}px;overflow:hidden;background:linear-gradient(135deg,#3a3f4a,#20242b)`;
    const host = document.createElement('div');
    host.className = 'mgt-layer';
    const seconds = bundle.seconds ?? 5;
    host.style.cssText = `position:absolute;left:0;top:0;width:${canvas.width}px;height:${canvas.height}px;transform:scale(${scale});transform-origin:0 0;--elapsed:${(seconds * 0.72).toFixed(2)};--duration:${seconds}s;--u:1`;
    host.innerHTML = `<style>${bundle.css}</style><div class="mgt-canvas" style="position:absolute;inset:0">${branded(bundle.html)}</div>`;
    frame.appendChild(host);
    cell.appendChild(frame);
    await new Promise((r) => setTimeout(r, 30));
    const stage = host.querySelector('.mgt-canvas') as HTMLElement;
    const issues = layoutIssues(stage, canvas);
    report.push({ id: c.id, issues });
    if (issues.length) {
      frame.style.outline = '3px solid #ff3b3b';
      label.textContent += ` — ${issues.map((i) => `${i.slot ?? i.text.slice(0, 12)} ${i.problem} ${i.by}px`).join(', ')}`;
      label.style.color = '#ff8080';
    }
  }
  const out = document.createElement('pre');
  out.id = 'report';
  out.style.cssText = 'width:100%;white-space:pre-wrap';
  out.textContent = JSON.stringify(report.filter((r) => r.issues.length || r.error));
  document.body.appendChild(out);
  document.title = 'done';
}
/** `?mode=retry`: the a-bit-long cases built with no fit, then the tool's check → refit → rebuild loop. */
async function retry() {
  const cases = evalCases().filter((c) => c.tool === 'create_motion_graphic' && c.profile === 'longish');
  const rows: { id: string; before: number; after: number | null; fit?: Record<string, number> }[] = [];
  for (const c of cases) {
    const { template, ...rest } = c.args as { template: string } & Record<string, unknown>;
    const fixed = fixTemplateArgs(template, CRIMSON_SLOTS[template], rest, { plate: '#100607' });
    if (fixed.error) continue;
    const opts = { template, ...(fixed.args as Record<string, never>), canvas };
    const first = buildMotionGraphic(opts);
    const issues = (await checkGraphic(first, canvas, first.seconds ?? 5)) ?? [];
    const present = Object.keys(CRIMSON_SLOTS[template]).filter((slot) => { const v = (fixed.args as Record<string, unknown>)[slot]; return Array.isArray(v) ? v.length > 0 : !!v; });
    const again = issues.length ? refit({}, issues, canvas, present) : null;
    const second = again ? buildMotionGraphic({ ...opts, fit: again }) : null;
    const left = second ? (await checkGraphic(second, canvas, second.seconds ?? 5)) ?? [] : null;
    rows.push({ id: c.id, before: issues.length, after: left ? left.length : null, ...(again ? { fit: again } : {}), issues } as never);
  }
  const out = document.createElement('pre');
  out.id = 'report';
  out.textContent = JSON.stringify(rows.filter((r) => r.before));
  document.body.appendChild(out);
  document.title = 'done';
}

/** `?thumb=<id>`: one house template's example (templateExamples.ts) filling a 320×180 page, for its thumbnail. */
async function thumb(id: string) {
  document.body.style.cssText = 'margin:0;overflow:hidden;background:#20242b';
  await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 3000))]);
  const bundle = buildMotionGraphic({ template: id, ...(CRIMSON_EXAMPLES[id] as Record<string, never>), canvas });
  const seconds = bundle.seconds ?? 5;
  const k = 320 / canvas.width;
  const frame = document.createElement('div');
  frame.style.cssText = 'position:relative;width:320px;height:180px;overflow:hidden;background:linear-gradient(135deg,#3a3f4a,#20242b)';
  frame.innerHTML = `<div class="mgt-layer" style="position:absolute;left:0;top:0;width:${canvas.width}px;height:${canvas.height}px;transform:scale(${k});transform-origin:0 0;--elapsed:${(seconds * 0.72).toFixed(2)};--duration:${seconds}s;--u:1"><style>${bundle.css}</style><div class="mgt-canvas" style="position:absolute;inset:0">${bundle.html}</div></div>`;
  document.body.appendChild(frame);
  document.title = 'done';
}

void (params.get('thumb') ? thumb(params.get('thumb')!) : params.get('mode') === 'retry' ? retry() : main());
