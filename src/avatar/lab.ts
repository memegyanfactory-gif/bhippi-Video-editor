// Avatar Lab (avatar-lab.html): every animation playing side by side at 4×, for tuning the art.
// `?stage` swaps to a stand-in workspace that drives the real engine (stageLab.ts); `?settings`
// opens the real Settings modal on the Avatar tab (settingsLab.tsx); `?who=cat` plays another character.
import { ANIMS, poseAt, type AnimName } from './poses';
import { ART_H, ART_W, paint, type Character } from './sprite';

const params = new URLSearchParams(location.search);

if (params.has('stage')) {
  void import('./stageLab');
} else if (params.has('settings')) {
  void import('./settingsLab');
} else {
  const grid = document.getElementById('grid')!;
  const scale = Number(params.get('scale') ?? 4);
  const only = params.get('only')?.split(',');
  const frozen = params.get('t');
  const character = (params.get('who') ?? 'heli') as Character;
  const cells = (Object.keys(ANIMS) as AnimName[]).filter((name) => !only || only.includes(name)).map((name) => {
    const cell = document.createElement('div');
    cell.className = 'cell';
    const canvas = document.createElement('canvas');
    canvas.width = ART_W;
    canvas.height = ART_H;
    canvas.style.width = `${ART_W * scale}px`;
    canvas.style.height = `${ART_H * scale}px`;
    const label = document.createElement('div');
    label.textContent = name;
    cell.append(canvas, label);
    grid.append(cell);
    return { name, ctx: canvas.getContext('2d')! };
  });
  const start = performance.now();
  const frame = () => {
    const t = frozen !== null ? Number(frozen) : (performance.now() - start) / 1000;
    for (const { name, ctx } of cells) paint(ctx, poseAt(name, ['kick', 'slap', 'place', 'land'].includes(name) ? t % 1.6 : name === 'celebrate' ? t % 2.6 : t, { color: '#6fa8ff', character }));
    requestAnimationFrame(frame);
  };
  frame();
}
