// React Bits — Micro (33), rebuilt for video.
//
// Micro-interactions: switches, buttons, toasts, dials, loaders. Each one is a scripted UI moment:
// the control appears, a cursor (or a schedule) performs the interaction once, the control responds,
// and the state holds. They are small by design — place them in a corner slot, or centre them as a
// beat in a software explainer. All copy comes from `text` / `subtitle` / `rows`.

import {
  N, P_ACCENT, P_ROWS, P_SUBTITLE, P_TEXT, S,
  accentStyle, bit, d, esc, hash, pointerMoment, px, rng, rowsOf, scene, svg, textOf,
  type Bit,
} from './core';

const P_AT = { name: 'at', type: 'number' as const, default: 0.9, about: 'Seconds into the clip when the interaction happens.' };
const at = (p: Record<string, unknown>) => Math.max(0.2, N(p, 'at', 0.9));
const CHECK = '<svg viewBox="0 0 24 24" style="width:100%;height:100%;fill:none;stroke:#fff;stroke-width:3;stroke-linecap:round;stroke-linejoin:round"><path class="a draw chk" pathLength="1" d="M5 12.5 L10 17 L19 7"/></svg>';
const CHECK_CSS = '.rbx .chk{animation-duration:.4s}';
const HEART = '<svg viewBox="0 0 24 24" style="width:100%;height:100%"><path d="M12 21s-7.5-4.6-9.5-9.2C1 8 3.4 4.5 7 4.5c2 0 3.6 1.1 5 2.8 1.4-1.7 3-2.8 5-2.8 3.6 0 6 3.5 4.5 7.3C19.5 16.4 12 21 12 21z"/></svg>';
const BELL = '<svg viewBox="0 0 24 24" style="width:100%;height:100%;fill:currentColor"><path d="M12 2a6 6 0 0 0-6 6v3.6L4 15v1h16v-1l-2-3.4V8a6 6 0 0 0-6-6zm0 20a3 3 0 0 0 3-3H9a3 3 0 0 0 3 3z"/></svg>';

export const MICRO_BITS: Bit[] = [
  bit({
    id: 'paper-crumple', name: 'Paper Crumple', category: 'micro', level: 'intermediate',
    about: 'A note crumples into a ball when dismissed.',
    video: 'A paper note with the copy; at the moment it crumples (irregular clip-path, scale, shadow, crease lines) and drops out of frame.',
    use: 'Dismissing a bad idea, "scrap that", comedy beats.',
    props: [P_TEXT, P_ACCENT, P_AT], example: { text: 'Plan A' }, seconds: 3.5, tags: ['paper', 'dismiss'],
    build: (p, ctx) => ({ html: scene(`<div class="fill center"><div class="a pop crumple" style="${d(0.05)};animation-name:rbx-pop,rbx-crumple;animation-duration:.5s,1.2s;animation-delay:calc(var(--t) + var(--at,0s)),calc(var(--t) + var(--at,0s) + ${at(p)}s)"><div class="heading" style="color:#222;font-size:${px(48)}">${esc(textOf(p, ctx))}</div>${svg('<path class="crease" d="M40,30 L160,120 L90,210 M260,40 L200,140 L300,230 M120,260 L220,180"/>', { vb: '0 0 340 280', style: 'fill:none;stroke:#0003;stroke-width:3' })}</div></div>`, 800, 460, accentStyle(p)), css: `.rbx .crumple{position:relative;width:${px(340)};height:${px(280)};padding:${px(40)};background:#fbf6ee;border-radius:${px(10)};box-shadow:0 ${px(16)} ${px(40)} #0007;overflow:hidden}.rbx .crease{opacity:0}@keyframes rbx-crumple{0%{clip-path:polygon(0 0,100% 0,100% 100%,0 100%);transform:scale(1) rotate(0)}40%{clip-path:polygon(8% 4%,52% 0,96% 10%,100% 48%,92% 92%,55% 100%,10% 94%,0 50%);transform:scale(.62) rotate(14deg)}70%{clip-path:polygon(14% 10%,50% 4%,90% 16%,98% 50%,88% 88%,52% 98%,14% 90%,4% 50%);transform:scale(.5) rotate(-6deg)}100%{clip-path:polygon(14% 10%,50% 4%,90% 16%,98% 50%,88% 88%,52% 98%,14% 90%,4% 50%);transform:scale(.45) translateY(${px(600)}) rotate(40deg)}}` }),
  }),
  bit({
    id: 'tear-ticket', name: 'Tear Ticket', category: 'micro', level: 'intermediate',
    about: 'A ticket stub tears off along a perforated line.',
    video: 'A two-part ticket; the scripted cursor drags the stub, which tears away along the perforation and drifts off.',
    use: 'Admissions, "you are in", event promos, redemption beats.',
    props: [P_TEXT, P_SUBTITLE, P_ACCENT, P_AT], example: { text: 'ADMIT ONE', subtitle: 'Row F · Seat 12' }, seconds: 4, tags: ['ticket'],
    build: (p, ctx) => {
      const ptr = pointerMoment('tear', [{ x: 650, y: 380 }, { x: 640, y: 240 }, { x: 760, y: 120 }], at(p) - 0.3, 1.2, false);
      return { html: scene(`<div class="fill center"><div class="a rise ticket" style="${d(0.05)}"><div class="tmain"><div class="kicker">TICKET</div><div class="heading" style="font-size:${px(52)}">${esc(textOf(p, ctx))}</div><div class="small">${esc(S(p, 'subtitle') || ctx.subtitle || '')}</div></div><div class="tperf"></div><div class="tstub a" style="${d(at(p))}"><div class="kicker" style="writing-mode:vertical-rl;transform:rotate(180deg)">STUB</div></div></div></div>${ptr.html}`, 800, 460, accentStyle(p)), css: `${ptr.css}.rbx .ticket{position:relative;display:flex;height:${px(220)}}.rbx .tmain{width:${px(420)};padding:${px(30)} ${px(36)};background:var(--accent);color:#fff;border-radius:${px(18)} 0 0 ${px(18)};display:flex;flex-direction:column;justify-content:center}.rbx .tmain .kicker,.rbx .tmain .small{color:#ffffffcc}.rbx .tperf{width:0;border-left:${px(3)} dashed #ffffff88}.rbx .tstub{width:${px(120)};background:var(--accent);filter:brightness(.85);color:#fff;border-radius:0 ${px(18)} ${px(18)} 0;display:flex;align-items:center;justify-content:center;transform-origin:0 100%;animation-name:rbx-tear;animation-duration:1.1s;animation-timing-function:var(--eo)}.rbx .tstub .kicker{color:#fff}@keyframes rbx-tear{0%{transform:rotate(0) translate(0,0);opacity:1}40%{transform:rotate(-14deg) translate(${px(10)},${px(-20)})}100%{transform:rotate(-40deg) translate(${px(220)},${px(-300)});opacity:0}}` };
    },
  }),
  bit({
    id: 'flip-card', name: 'Flip Card', category: 'micro', level: 'basic',
    about: 'A card flips over to show its back.',
    video: 'Front (text) flips on the Y axis at the moment to reveal the back (subtitle) with perspective.',
    use: 'Q&A, before/after, "the answer is…", flashcards.',
    props: [P_TEXT, P_SUBTITLE, P_ACCENT, P_AT], example: { text: 'Question?', subtitle: 'Answer.' }, seconds: 4, tags: ['card', 'flip'],
    build: (p, ctx) => ({ html: scene(`<div class="fill center" style="perspective:${px(1400)}"><div class="a pop flipwrap" style="${d(0.05)};animation-name:rbx-pop,rbx-flip;animation-duration:.5s,.9s;animation-delay:calc(var(--t) + var(--at,0s)),calc(var(--t) + var(--at,0s) + ${at(p)}s)"><div class="glass fface"><div class="heading">${esc(textOf(p, ctx))}</div></div><div class="glass fface fback"><div class="heading" style="color:#fff">${esc(S(p, 'subtitle') || ctx.subtitle || '…')}</div></div></div></div>`, 800, 460, accentStyle(p)), css: `.rbx .flipwrap{position:relative;width:${px(520)};height:${px(300)};transform-style:preserve-3d;animation-timing-function:var(--spring),var(--eo)}.rbx .fface{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:${px(30)};backface-visibility:hidden}.rbx .fback{transform:rotateY(180deg);background:var(--accent)}@keyframes rbx-flip{from{transform:rotateY(0)}to{transform:rotateY(180deg)}}` }),
  }),
  bit({
    id: 'branched-menu', name: 'Branched Menu', category: 'micro', level: 'intermediate',
    about: 'A menu that branches out from a root button.',
    video: 'The root button is pressed; connector lines draw to the options, which pop in one by one.',
    use: 'Decision trees, "your options", app menus.',
    props: [P_TEXT, P_ACCENT, P_ROWS, P_AT], example: { text: 'Export', rows: ['MP4', 'GIF', 'Frames', 'Audio'] }, seconds: 4, tags: ['menu', 'tree'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['One', 'Two', 'Three']).slice(0, 5);
      const t0 = at(p);
      const ptr = pointerMoment('branch', [{ x: 100, y: 400 }, { x: 150, y: 230 }], t0 - 0.7, 0.7, true);
      const gap = 300 / Math.max(1, rows.length - 1);
      const lines = rows.map((_, i) => `<path class="a draw bline" pathLength="1" d="M150,230 C300,230 320,${80 + i * gap} 470,${80 + i * gap}" style="${d(t0 + 0.1 + i * 0.1)}"/>`).join('');
      const nodes = rows.map((r, i) => `<div class="pill a pop" style="position:absolute;left:${px(470)};top:${px(80 + i * gap - 24)};${d(t0 + 0.4 + i * 0.1)}">${esc(r)}</div>`).join('');
      return { html: scene(`${svg(lines, { vb: '0 0 800 460', style: 'fill:none;stroke:var(--line);stroke-width:3' })}<div class="pill a pop press" style="position:absolute;left:${px(60)};top:${px(200)};font-size:${px(30)};padding:${px(16)} ${px(32)};${d(0.05)};animation-name:rbx-pop,rbx-press;animation-duration:.5s,.4s;animation-delay:calc(var(--t) + var(--at,0s)),calc(var(--t) + var(--at,0s) + ${t0}s)">${esc(textOf(p, ctx))} ▸</div>${nodes}${ptr.html}`, 800, 460, accentStyle(p)), css: `${ptr.css}.rbx .bline{animation-duration:.5s}` };
    },
  }),
  bit({
    id: 'folder-float', name: 'Folder Float', category: 'micro', level: 'basic',
    about: 'A folder icon floats and its lid lifts on hover.',
    video: 'A folder bobs gently; at the moment its lid lifts and a paper peeks out with the label.',
    use: 'Downloads, "in the project", file beats.',
    props: [P_TEXT, P_ACCENT, P_AT], example: { text: 'Assets' }, seconds: 3.5, tags: ['folder'],
    build: (p, ctx) => ({ html: scene(`<div class="fill center col" style="gap:${px(26)}"><div class="loop bob a" style="animation-duration:3s"><div class="ffwrap"><div class="ffback"></div><div class="ffpaper a" style="${d(at(p))}"></div><div class="fflid a" style="${d(at(p))}"></div></div></div><div class="body a rise" style="font-weight:700;${d(0.3)}">${esc(textOf(p, ctx))}</div></div>`, 800, 460, accentStyle(p)), css: `.rbx .ffwrap{position:relative;width:${px(220)};height:${px(160)}}.rbx .ffback,.rbx .fflid{position:absolute;left:0;right:0;bottom:0;border-radius:${px(14)};background:var(--accent)}.rbx .ffback{top:0;filter:brightness(.7)}.rbx .fflid{height:72%;transform-origin:50% 100%;animation-name:rbx-fflid;animation-duration:.6s;animation-timing-function:var(--spring)}.rbx .ffpaper{position:absolute;left:12%;right:12%;bottom:20%;height:70%;background:#fbf6ee;border-radius:${px(8)};animation-name:rbx-ffpaper;animation-duration:.6s;animation-timing-function:var(--spring)}@keyframes rbx-fflid{to{transform:perspective(600px) rotateX(-32deg)}}@keyframes rbx-ffpaper{to{transform:translateY(${px(-50)})}}` }),
  }),
  bit({
    id: 'refine-frame', name: 'Refine Frame', category: 'micro', level: 'intermediate',
    about: 'A selection frame with handles tightens around its subject.',
    video: 'A loose dashed frame with corner handles snaps tighter around the label at the moment, handles pulsing once.',
    use: 'Cropping demos, "focus on this", AI selection beats.',
    props: [P_TEXT, P_ACCENT, P_AT], example: { text: 'Subject' }, seconds: 3.5, tags: ['frame', 'select'],
    build: (p, ctx) => ({ html: scene(`<div class="fill center"><div class="rfframe a" style="${d(at(p))}">${['tl', 'tr', 'bl', 'br'].map((c) => `<i class="rfh ${c}"></i>`).join('')}</div><div class="pill a pop" style="font-size:${px(34)};padding:${px(18)} ${px(40)};${d(0.05)}">${esc(textOf(p, ctx))}</div></div>`, 800, 460, accentStyle(p)), css: `.rbx .rfframe{position:absolute;border:${px(2)} dashed var(--accent);animation-name:rbx-rfframe;animation-duration:.7s;animation-timing-function:var(--spring)}.rbx .rfh{position:absolute;width:${px(18)};height:${px(18)};background:#fff;border:${px(2)} solid var(--accent);border-radius:${px(3)}}.rbx .rfh.tl{left:${px(-10)};top:${px(-10)}}.rbx .rfh.tr{right:${px(-10)};top:${px(-10)}}.rbx .rfh.bl{left:${px(-10)};bottom:${px(-10)}}.rbx .rfh.br{right:${px(-10)};bottom:${px(-10)}}@keyframes rbx-rfframe{from{left:${px(60)};right:${px(60)};top:${px(50)};bottom:${px(50)}}to{left:${px(250)};right:${px(250)};top:${px(170)};bottom:${px(170)}}}` }),
  }),
  bit({
    id: 'thought-line', name: 'Thought Line', category: 'micro', level: 'basic',
    about: 'A line draws from a point to a thought bubble.',
    video: 'A dot pulses; a curved line draws up to a bubble that pops in with the copy.',
    use: 'Callouts on footage, "what they are thinking", annotations.',
    props: [P_TEXT, P_ACCENT, P_AT], example: { text: 'What if we cut this?' }, seconds: 3.5, tags: ['callout', 'annotation'],
    build: (p, ctx) => ({ html: scene(`<i class="tldot loop pulse" style="left:${px(120)};top:${px(380)}"></i>${svg(`<path class="a draw tline" pathLength="1" d="M120,380 C160,300 240,260 330,200" style="${d(at(p))}"/>`, { vb: '0 0 800 460', style: 'fill:none;stroke:var(--accent);stroke-width:3;stroke-linecap:round' })}<div class="glass a pop" style="position:absolute;left:${px(330)};top:${px(90)};padding:${px(22)} ${px(30)};max-width:${px(420)};${d(at(p) + 0.5)}"><div class="body">${esc(textOf(p, ctx))}</div></div>`, 800, 460, accentStyle(p)), css: `.rbx .tldot{position:absolute;width:${px(22)};height:${px(22)};margin:${px(-11)} 0 0 ${px(-11)};border-radius:50%;background:var(--accent);box-shadow:0 0 ${px(18)} var(--accent)}.rbx .tline{animation-duration:.6s}` }),
  }),
  bit({
    id: 'voice-pill', name: 'Voice Pill', category: 'micro', level: 'basic',
    about: 'A voice-recording pill with a live waveform.',
    video: 'A pill with a red dot and waveform bars bouncing on loops (seeded heights); the transcript line fades in under it.',
    use: 'Voice notes, "recording", podcast beats, AI speech demos.',
    props: [P_TEXT, P_ACCENT], example: { text: 'Recording voice-over…' }, seconds: 4, tags: ['audio', 'loop'],
    build: (p, ctx) => {
      const rand = rng(hash(textOf(p, ctx)));
      const bars = Array.from({ length: 22 }, () => `<i class="vbar loop" style="${d(rand() * 0.6)};animation-duration:${(0.5 + rand() * 0.5).toFixed(2)}s;--h:${(0.3 + rand() * 0.7).toFixed(2)}"></i>`).join('');
      return { html: scene(`<div class="fill center col" style="gap:${px(24)}"><div class="glass a pop vpill" style="${d(0.05)}"><i class="vdot loop blink"></i>${bars}<span class="small num">0:07</span></div><div class="body a rise" style="${d(0.5)}">${esc(textOf(p, ctx))}</div></div>`, 800, 460, accentStyle(p)), css: `.rbx .vpill{display:flex;align-items:center;gap:${px(5)};padding:${px(18)} ${px(28)};border-radius:999px}.rbx .vdot{width:${px(16)};height:${px(16)};border-radius:50%;background:#ff3b30;margin-right:${px(12)}}.rbx .vbar{width:${px(6)};height:${px(46)};border-radius:3px;background:var(--accent);transform-origin:50% 50%;animation-name:rbx-vbar;animation-timing-function:ease-in-out}@keyframes rbx-vbar{0%,100%{transform:scaleY(.2)}50%{transform:scaleY(var(--h,1))}}` };
    },
  }),
  bit({
    id: 'slosh-gauge', name: 'Slosh Gauge', category: 'micro', level: 'intermediate',
    about: 'A circular gauge whose liquid sloshes as it fills.',
    video: 'A round gauge fills with liquid to the value while the surface sloshes (a rotating wave layer), the percentage counting up.',
    use: 'Progress, battery, "how far along", stats with a real value.',
    props: [P_TEXT, P_ACCENT, { name: 'value', type: 'number', default: 72, about: 'Percent to fill (0–100).' }], example: { text: 'Storage used', value: 72 }, seconds: 4, tags: ['gauge', 'liquid'],
    build: (p, ctx) => {
      const v = Math.round(Math.min(100, Math.max(0, N(p, 'value', 72))));
      return { html: scene(`<div class="fill center col" style="gap:${px(20)}"><div class="gauge a pop" style="${d(0.05)}"><div class="gliquid a" style="--lvl:${100 - v}%;${d(0.3)}"><div class="gwave loop spin" style="animation-duration:5s"></div></div><div class="fill center heading num gpct" style="font-size:${px(56)}"><span class="cu-col"><span class="cu-strip a" style="--n:${Math.floor(v / 10)};${d(0.3)}">${'0123456789'.split('').map((n) => `<i>${n}</i>`).join('')}</span></span><span class="cu-col"><span class="cu-strip a" style="--n:${v % 10};${d(0.3)}">${'0123456789'.split('').map((n) => `<i>${n}</i>`).join('')}</span></span>%</div></div><div class="body a rise" style="${d(0.4)}">${esc(textOf(p, ctx))}</div></div>`, 800, 460, accentStyle(p)), css: `.rbx .gauge{position:relative;width:${px(260)};height:${px(260)};border-radius:50%;overflow:hidden;background:var(--card);border:${px(4)} solid var(--line)}.rbx .gliquid{position:absolute;left:0;right:0;bottom:0;top:100%;background:var(--accent);animation-name:rbx-gfill;animation-duration:1.6s;animation-timing-function:var(--eo)}.rbx .gwave{position:absolute;left:-50%;top:${px(-190)};width:200%;height:${px(220)};border-radius:42%;background:var(--card)}.rbx .gpct{mix-blend-mode:difference;color:#fff}.rbx .cu-col{display:inline-block;height:1em;line-height:1;overflow:hidden;vertical-align:top}.rbx .cu-strip{display:inline-flex;flex-direction:column;line-height:1;animation-name:rbx-roll;animation-duration:1.6s;animation-timing-function:var(--eo)}.rbx .cu-strip>i{display:block;height:1em;font-style:normal}@keyframes rbx-gfill{from{top:100%}to{top:var(--lvl)}}@keyframes rbx-roll{from{transform:translateY(0)}to{transform:translateY(calc(var(--n,0) * -1em))}}` };
    },
  }),
  bit({
    id: 'prompt-bar', name: 'Prompt Bar', category: 'micro', level: 'basic',
    about: 'An AI prompt input with attachments and a send button.',
    video: 'A prompt bar; the copy is typed in, then the send button presses and a "thinking" dot row appears.',
    use: 'AI product demos, "just ask", software explainers.',
    props: [P_TEXT, P_ACCENT, { name: 'cps', type: 'number', default: 20, about: 'Typing speed.' }], example: { text: 'Make a 15-second channel intro' }, seconds: 5, tags: ['ai', 'input'],
    build: (p, ctx) => {
      const t = textOf(p, ctx);
      const step = 1 / Math.max(4, N(p, 'cps', 20));
      const typed = Array.from(t).map((ch, i) => `<span class="a fade" style="${d(0.5 + i * step)};animation-duration:.04s">${ch === ' ' ? '&nbsp;' : esc(ch)}</span>`).join('');
      const end = 0.5 + t.length * step + 0.3;
      return { html: scene(`<div class="fill center col" style="gap:${px(24)}"><div class="glass a rise pbar" style="${d(0.05)}"><span class="pbplus">+</span><div class="body" style="flex:1;white-space:nowrap;overflow:hidden">${typed}<span class="loop blink" style="color:var(--accent)">|</span></div><div class="pbsend a press" style="${d(end)}">↑</div></div><div class="row a fade" style="gap:${px(10)};${d(end + 0.4)}">${[0, 1, 2].map((i) => `<i class="pbdot loop" style="${d(i * 0.2)}"></i>`).join('')}<span class="small" style="margin-left:${px(8)}">Thinking…</span></div></div>`, 800, 460, accentStyle(p)), css: `.rbx .pbar{display:flex;align-items:center;gap:${px(18)};width:${px(700)};padding:${px(16)} ${px(20)};border-radius:${px(28)}}.rbx .pbplus{width:${px(46)};height:${px(46)};border-radius:50%;border:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-size:${px(30)};color:var(--muted)}.rbx .pbsend{width:${px(52)};height:${px(52)};border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:${px(30)};font-weight:700}.rbx .pbdot{width:${px(12)};height:${px(12)};border-radius:50%;background:var(--accent);animation-name:rbx-pbdot;animation-duration:.9s;animation-timing-function:ease-in-out}@keyframes rbx-pbdot{0%,100%{transform:translateY(0);opacity:.5}50%{transform:translateY(${px(-8)});opacity:1}}` };
    },
  }),
  bit({
    id: 'swipe-toast', name: 'Swipe Toast', category: 'micro', level: 'basic',
    about: 'A toast notification you can swipe away.',
    video: 'A toast slides in from the right with an icon and message, holds, then the scripted swipe flicks it out.',
    use: 'Notifications, "saved", confirmations in app demos.',
    props: [P_TEXT, P_SUBTITLE, P_ACCENT, P_AT], example: { text: 'Export finished', subtitle: 'channel-intro.mp4 · 14.2 MB' }, seconds: 4, layout: 'top-right', tags: ['toast', 'notification'],
    build: (p, ctx) => {
      const t0 = at(p) + 1.2;
      return { html: `<div class="x"><div class="glass a toast" style="${d(0.05)};animation-name:rbx-slide-r,rbx-swipeout;animation-duration:.6s,.5s;animation-delay:calc(var(--t) + var(--at,0s)),calc(var(--t) + var(--at,0s) + ${t0}s);${accentStyle(p)}"><div class="ticon">${CHECK}</div><div><div class="body" style="font-weight:700">${esc(textOf(p, ctx))}</div>${S(p, 'subtitle') || ctx.subtitle ? `<div class="small">${esc(S(p, 'subtitle') || ctx.subtitle)}</div>` : ''}</div></div></div>`, css: `${CHECK_CSS}.rbx .toast{display:flex;align-items:center;gap:${px(20)};padding:${px(20)} ${px(28)};min-width:${px(480)};animation-timing-function:var(--eo),var(--ei);animation-fill-mode:both,forwards}.rbx .ticon{width:${px(52)};height:${px(52)};border-radius:50%;background:#1fbf75;padding:${px(12)};flex:none}@keyframes rbx-swipeout{to{opacity:0;transform:translateX(${px(500)})}}` };
    },
  }),
  bit({
    id: 'sling-button', name: 'Sling Button', category: 'micro', level: 'intermediate',
    about: 'A button pulled back and released like a slingshot.',
    video: 'The scripted cursor drags the button back; a rubber band stretches; release fires it forward with overshoot and a spark.',
    use: 'Launch buttons, "send it", playful CTAs.',
    props: [P_TEXT, P_ACCENT, P_AT], example: { text: 'Launch' }, seconds: 3.5, tags: ['button', 'spring'],
    build: (p, ctx) => {
      const t0 = at(p);
      const ptr = pointerMoment('sling', [{ x: 400, y: 240 }, { x: 250, y: 260 }], t0 - 0.6, 0.6, false);
      return { html: scene(`<div class="fill center"><div class="slingband a" style="${d(t0 - 0.6)}"></div><div class="pill a slingbtn" style="font-size:${px(34)};padding:${px(20)} ${px(48)};${d(t0 - 0.6)}">${esc(textOf(p, ctx))}</div></div>${ptr.html}`, 800, 460, accentStyle(p)), css: `${ptr.css}.rbx .slingbtn{animation-name:rbx-sling;animation-duration:1.4s;animation-timing-function:var(--spring)}.rbx .slingband{position:absolute;left:50%;top:50%;width:${px(4)};height:${px(4)};margin:${px(-2)};background:var(--accent2);animation-name:rbx-slingband;animation-duration:1.4s;animation-timing-function:var(--spring)}@keyframes rbx-sling{0%{transform:translateX(0)}42%{transform:translateX(${px(-150)}) scale(.96)}58%{transform:translateX(${px(260)}) scale(1.08,.92)}75%{transform:translateX(${px(190)})}100%{transform:translateX(${px(210)})}}@keyframes rbx-slingband{0%{width:${px(4)};transform:translateX(0)}42%{width:${px(160)};transform:translateX(${px(-150)})}58%,100%{width:${px(4)};transform:translateX(0);opacity:0}}` };
    },
  }),
  bit({
    id: 'bell-toggle', name: 'Bell Toggle', category: 'micro', level: 'basic',
    about: 'A notification bell that rings when toggled on.',
    video: 'The bell is pressed at the moment, swings, turns accent and a badge count pops in.',
    use: '"Turn on notifications", subscribe reminders.',
    props: [P_TEXT, P_ACCENT, P_AT, { name: 'count', type: 'number', default: 1, about: 'Badge number.' }], example: { text: 'Notifications on', count: 3 }, seconds: 3.5, tags: ['bell', 'toggle'],
    build: (p, ctx) => {
      const t0 = at(p);
      const ptr = pointerMoment('bell', [{ x: 150, y: 400 }, { x: 400, y: 200 }], t0 - 0.7, 0.7, true);
      return { html: scene(`<div class="fill center col" style="gap:${px(24)}"><div class="bellwrap a pop" style="${d(0.05)}"><div class="bell a" style="${d(t0)}">${BELL}</div><div class="pill a pop badge" style="${d(t0 + 0.3)}">${Math.round(N(p, 'count', 1))}</div></div><div class="body a rise" style="${d(t0 + 0.4)}">${esc(textOf(p, ctx))}</div></div>${ptr.html}`, 800, 460, accentStyle(p)), css: `${ptr.css}.rbx .bellwrap{position:relative;width:${px(120)};height:${px(120)}}.rbx .bell{width:100%;height:100%;color:var(--muted);transform-origin:50% 10%;animation-name:rbx-bellring;animation-duration:1s;animation-timing-function:ease-in-out}.rbx .badge{position:absolute;right:${px(-14)};top:${px(-6)};padding:${px(4)} ${px(14)};font-size:${px(22)};background:#ff3b30}@keyframes rbx-bellring{0%{transform:rotate(0);color:var(--muted)}15%{transform:rotate(18deg);color:var(--accent)}30%{transform:rotate(-14deg)}45%{transform:rotate(10deg)}60%{transform:rotate(-6deg)}75%{transform:rotate(3deg)}100%{transform:rotate(0);color:var(--accent)}}` };
    },
  }),
  bit({
    id: 'call-chip', name: 'Call Chip', category: 'micro', level: 'basic',
    about: 'An incoming-call chip with accept and decline.',
    video: 'A chip slides down with a pulsing avatar and caller name; the scripted cursor accepts and the chip turns into a timer.',
    use: 'Phone UI demos, "the call that changed it", story beats.',
    props: [P_TEXT, P_SUBTITLE, P_ACCENT, P_AT], example: { text: 'Ana Kapoor', subtitle: 'Incoming call…' }, seconds: 4, layout: 'top-left', tags: ['phone', 'chip'],
    build: (p, ctx) => {
      const t0 = at(p) + 0.6;
      const ptr = pointerMoment('call', [{ x: 120, y: 260 }, { x: 560, y: 60 }], t0 - 0.7, 0.7, true);
      return { html: `<div class="x" style="position:relative;width:${px(640)};height:${px(300)};${accentStyle(p)}"><div class="glass a drop callchip" style="${d(0.05)}"><div class="cavatar loop pulse"></div><div style="flex:1"><div class="body" style="font-weight:700">${esc(textOf(p, ctx))}</div><div class="small"><span class="a callsub" style="${d(t0)}">${esc(S(p, 'subtitle') || ctx.subtitle || 'Incoming call…')}</span><span class="a fade num" style="position:absolute;${d(t0 + 0.2)}">00:01</span></div></div><div class="cbtn2 a" style="background:#ff3b30;${d(t0)}">✕</div><div class="cbtn2 a press" style="background:#1fbf75;${d(t0)}">✓</div></div>${ptr.html}</div>`, css: `${ptr.css}.rbx .callchip{position:absolute;left:0;top:0;display:flex;align-items:center;gap:${px(18)};padding:${px(16)} ${px(22)};width:${px(600)}}.rbx .cavatar{width:${px(60)};height:${px(60)};border-radius:50%;background:linear-gradient(135deg,var(--accent2),var(--accent));flex:none}.rbx .cbtn2{width:${px(52)};height:${px(52)};border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:${px(26)};font-weight:800;flex:none}.rbx .callsub{position:relative;animation-name:rbx-fadeout;animation-duration:.2s}.rbx .cbtn2:nth-last-child(2){animation-name:rbx-fadeout;animation-duration:.3s}@keyframes rbx-fadeout{from{opacity:1}to{opacity:0}}` };
    },
  }),
  bit({
    id: 'status-mark', name: 'Status Mark', category: 'micro', level: 'basic',
    about: 'A status indicator that morphs from loading to success.',
    video: 'A spinning ring at the moment collapses into a filled circle and the check draws; the label changes.',
    use: '"Done", uploads, saves, processing beats.',
    props: [P_TEXT, P_SUBTITLE, P_ACCENT, P_AT], example: { text: 'Rendering…', subtitle: 'Exported' }, seconds: 3.5, tags: ['status', 'check'],
    build: (p, ctx) => {
      const t0 = at(p) + 0.4;
      return { html: scene(`<div class="fill center col" style="gap:${px(24)}"><div class="smark a pop" style="${d(0.05)}"><div class="fill smring loop spin a smdone" style="animation-duration:1s,.4s;animation-name:rbx-spin,rbx-smdone;animation-iteration-count:infinite,1;animation-delay:calc(var(--t) + var(--at,0s)),calc(var(--t) + var(--at,0s) + ${t0}s);animation-fill-mode:both,forwards"></div><div class="fill smfill a" style="${d(t0)}">${CHECK.replace('class="a draw chk"', `class="a draw chk" style="${d(t0 + 0.25)}"`)}</div></div><div class="body" style="position:relative;height:1.4em"><span class="a smlbl" style="position:absolute;left:50%;transform:translateX(-50%);white-space:nowrap;${d(t0)}">${esc(textOf(p, ctx))}</span><span class="a fade" style="position:absolute;left:50%;transform:translateX(-50%);white-space:nowrap;${d(t0 + 0.2)}">${esc(S(p, 'subtitle') || ctx.subtitle || 'Done')}</span></div></div>`, 800, 460, accentStyle(p)), css: `${CHECK_CSS}.rbx .smark{position:relative;width:${px(120)};height:${px(120)}}.rbx .smring{border-radius:50%;border:${px(8)} solid var(--line);border-top-color:var(--accent)}.rbx .smfill{border-radius:50%;background:#1fbf75;padding:${px(26)};transform:scale(0);animation-name:rbx-pop;animation-duration:.4s;animation-timing-function:var(--spring)}.rbx .smlbl{animation-name:rbx-fadeout;animation-duration:.2s}@keyframes rbx-smdone{to{opacity:0;transform:scale(.6)}}@keyframes rbx-fadeout{from{opacity:1}to{opacity:0}}` };
    },
  }),
  bit({
    id: 'glide-select', name: 'Glide Select', category: 'micro', level: 'basic',
    about: 'A select whose highlight glides between options.',
    video: 'A select opens; the highlight glides down to the chosen option; the menu closes showing the choice.',
    use: 'Settings demos, "choose your style".',
    props: [P_TEXT, P_ACCENT, P_ROWS, P_AT, { name: 'activeIndex', type: 'number', default: 2, about: 'Chosen option.' }], example: { text: 'Aspect ratio', rows: ['16:9', '1:1', '9:16', '4:5'], activeIndex: 2 }, seconds: 4, tags: ['select', 'dropdown'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['One', 'Two', 'Three']).slice(0, 6);
      const active = Math.min(rows.length - 1, Math.max(0, Math.round(N(p, 'activeIndex', 2))));
      const t0 = at(p);
      const rowH = 62;
      return { html: scene(`<div class="fill center col" style="gap:${px(14)};align-items:flex-start;padding-left:${px(200)}"><div class="kicker a rise" style="${d(0.05)}">${esc(textOf(p, ctx))}</div><div class="glass gsel a pop" style="${d(0.1)}"><div class="body gselval"><span class="a gsold" style="${d(t0 + 1.1)}">${esc(rows[0])}</span><span class="a fade" style="position:absolute;left:${px(24)};${d(t0 + 1.2)}">${esc(rows[active])}</span></div><span class="small">▾</span></div><div class="glass gsmenu a" style="${d(t0)};--h:${px(rows.length * rowH + 16)}"><div class="gshi a" style="${d(t0 + 0.3)};--end:${px(active * rowH)}"></div>${rows.map((r) => `<div class="body gsrow" style="height:${px(rowH)}">${esc(r)}</div>`).join('')}</div></div>`, 800, 460, accentStyle(p)), css: `.rbx .gsel{display:flex;align-items:center;justify-content:space-between;width:${px(400)};padding:${px(16)} ${px(24)};border-radius:${px(16)}}.rbx .gselval{position:relative}.rbx .gsold{animation-name:rbx-fadeout;animation-duration:.2s}.rbx .gsmenu{position:relative;width:${px(400)};padding:${px(8)};overflow:hidden;height:0;opacity:0;animation-name:rbx-gsmenu;animation-duration:1.4s;animation-timing-function:var(--eo);animation-fill-mode:forwards}.rbx .gsrow{position:relative;display:flex;align-items:center;padding:0 ${px(20)}}.rbx .gshi{position:absolute;left:${px(8)};right:${px(8)};top:${px(8)};height:${px(rowH)};border-radius:${px(10)};background:var(--accent);animation-name:rbx-gshi;animation-duration:.6s;animation-timing-function:var(--eo)}@keyframes rbx-gsmenu{0%{height:0;opacity:0}15%,80%{height:var(--h);opacity:1}100%{height:0;opacity:0}}@keyframes rbx-gshi{from{transform:translateY(0)}to{transform:translateY(var(--end))}}@keyframes rbx-fadeout{from{opacity:1}to{opacity:0}}` };
    },
  }),
  bit({
    id: 'swipe-row', name: 'Swipe Row', category: 'micro', level: 'basic',
    about: 'A list row swipes to reveal an action.',
    video: 'Three rows; the scripted swipe drags the middle row left to reveal a red delete action, which fires and the row collapses.',
    use: 'Inbox demos, "remove the noise", list editing.',
    props: [P_ACCENT, P_ROWS, P_AT], example: { rows: ['Keep this', 'Delete this', 'Keep this too'] }, seconds: 4, tags: ['list', 'swipe'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['One', 'Two', 'Three']).slice(0, 4);
      const t0 = at(p);
      const target = Math.min(1, rows.length - 1);
      return { html: scene(`<div class="fill center col" style="gap:${px(12)}">${rows.map((r, i) => `<div class="swrow a rise ${i === target ? 'swtarget' : ''}" style="${d(0.05 + i * 0.08)}${i === target ? `;--t0:${t0}s` : ''}"><div class="swdel">Delete</div><div class="glass swcard ${i === target ? 'a' : ''}" style="${i === target ? d(t0) : ''}"><i class="swdot"></i><span class="body">${esc(r)}</span></div></div>`).join('')}</div>`, 800, 460, accentStyle(p)), css: `.rbx .swrow{position:relative;width:${px(560)};height:${px(84)};overflow:hidden;border-radius:${px(18)}}.rbx .swdel{position:absolute;inset:0;background:#ff3b30;color:#fff;display:flex;align-items:center;justify-content:flex-end;padding-right:${px(28)};font-weight:700;font-size:${px(26)}}.rbx .swcard{position:absolute;inset:0;display:flex;align-items:center;gap:${px(16)};padding:0 ${px(22)};border-radius:${px(18)}}.rbx .swdot{width:${px(14)};height:${px(14)};border-radius:50%;background:var(--accent)}.rbx .swtarget .swcard{animation-name:rbx-swipecard;animation-duration:1.4s;animation-timing-function:var(--ei);animation-fill-mode:forwards}.rbx .swtarget{animation-name:rbx-rise,rbx-swcollapse;animation-duration:.6s,.4s;animation-delay:calc(var(--t) + var(--at,0s) + .13s),calc(var(--t) + var(--at,0s) + var(--t0) + 1.4s);animation-fill-mode:both,forwards}@keyframes rbx-swipecard{0%{transform:translateX(0)}40%,70%{transform:translateX(${px(-170)})}100%{transform:translateX(-110%)}}@keyframes rbx-swcollapse{to{height:0;opacity:0}}` };
    },
  }),
  bit({
    id: 'jelly-radio', name: 'Jelly Radio', category: 'micro', level: 'basic',
    about: 'Radio buttons whose selection jumps with a jelly squash.',
    video: 'A radio group; at the moment the selection blob squashes and jumps from the first option to the chosen one.',
    use: 'Choices, polls, "pick one".',
    props: [P_ACCENT, P_ROWS, P_AT, { name: 'activeIndex', type: 'number', default: 2, about: 'Chosen option.' }], example: { rows: ['Fast', 'Balanced', 'Best quality'], activeIndex: 2 }, seconds: 3.5, tags: ['radio', 'spring'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['One', 'Two', 'Three']).slice(0, 5);
      const active = Math.min(rows.length - 1, Math.max(0, Math.round(N(p, 'activeIndex', 2))));
      const rowH = 70;
      return { html: scene(`<div class="fill center"><div class="jrgroup a pop" style="${d(0.05)}"><i class="jrblob a" style="${d(at(p))};--end:${px(active * rowH)}"></i>${rows.map((r) => `<div class="row" style="height:${px(rowH)};gap:${px(18)}"><i class="jrring"></i><span class="body">${esc(r)}</span></div>`).join('')}</div></div>`, 800, 460, accentStyle(p)), css: `.rbx .jrgroup{position:relative}.rbx .jrring{width:${px(36)};height:${px(36)};border-radius:50%;border:${px(3)} solid var(--line);flex:none}.rbx .jrblob{position:absolute;left:${px(8)};top:${px(rowH / 2 - 10)};width:${px(20)};height:${px(20)};border-radius:50%;background:var(--accent);animation-name:rbx-jelly;animation-duration:.8s;animation-timing-function:var(--spring)}@keyframes rbx-jelly{0%{transform:translateY(0) scale(1)}30%{transform:translateY(calc(var(--end) * .3)) scale(.7,1.5)}70%{transform:translateY(var(--end)) scale(1.3,.7)}100%{transform:translateY(var(--end)) scale(1)}}` };
    },
  }),
  bit({
    id: 'comet-dial', name: 'Comet Dial', category: 'micro', level: 'intermediate',
    about: 'A dial whose indicator leaves a comet trail as it turns.',
    video: 'A round dial; the indicator sweeps to the value drawing a glowing arc trail behind it; the number counts.',
    use: 'Volume, temperature, intensity settings with a value.',
    props: [P_TEXT, P_ACCENT, { name: 'value', type: 'number', default: 68, about: 'Percent (0–100).' }], example: { text: 'Warmth', value: 68 }, seconds: 3.5, tags: ['dial', 'gauge'],
    build: (p, ctx) => {
      const v = Math.min(100, Math.max(0, N(p, 'value', 68)));
      const deg = -135 + (v / 100) * 270;
      return { html: scene(`<div class="fill center col" style="gap:${px(18)}"><div class="dial a pop" style="${d(0.05)};--deg:${deg.toFixed(1)}deg">${svg(`<circle cx="130" cy="130" r="104" style="stroke:var(--line);stroke-width:14;fill:none;stroke-dasharray:490 654;transform:rotate(135deg);transform-origin:130px 130px"/><circle class="a dialarc" cx="130" cy="130" r="104" pathLength="1" style="${d(0.3)};--len:${(v / 100 * 0.75).toFixed(3)}"/>`, { vb: '0 0 260 260', aspect: 'meet' })}<div class="dknob a" style="${d(0.3)}"><i></i></div><div class="fill center heading num" style="font-size:${px(52)}">${Math.round(v)}</div></div><div class="body a rise" style="${d(0.3)}">${esc(textOf(p, ctx))}</div></div>`, 800, 460, accentStyle(p)), css: `.rbx .dial{position:relative;width:${px(260)};height:${px(260)}}.rbx .dialarc{fill:none;stroke:var(--accent);stroke-width:14;stroke-linecap:round;transform:rotate(135deg);transform-origin:130px 130px;stroke-dasharray:var(--len) 1;filter:drop-shadow(0 0 8px var(--accent));animation-name:rbx-dialarc;animation-duration:1.4s;animation-timing-function:var(--eo)}.rbx .dknob{position:absolute;inset:${px(46)};border-radius:50%;background:var(--card);border:1px solid var(--line);animation-name:rbx-dknob;animation-duration:1.4s;animation-timing-function:var(--eo)}.rbx .dknob>i{position:absolute;left:50%;top:${px(10)};width:${px(6)};height:${px(28)};margin-left:${px(-3)};border-radius:3px;background:var(--accent)}@keyframes rbx-dialarc{from{stroke-dasharray:0 1}to{stroke-dasharray:var(--len) 1}}@keyframes rbx-dknob{from{transform:rotate(-135deg)}to{transform:rotate(var(--deg))}}` };
    },
  }),
  bit({
    id: 'wake-slider', name: 'Wake Slider', category: 'micro', level: 'basic',
    about: 'A "slide to unlock" control.',
    video: 'A track with a shimmering label; the scripted drag slides the thumb across; the label fades and the control lights up.',
    use: 'Openers, "slide to start", phone-UI beats.',
    props: [P_TEXT, P_ACCENT, P_AT], example: { text: 'slide to start' }, seconds: 3.5, tags: ['slider', 'unlock'],
    build: (p, ctx) => {
      const t0 = at(p);
      const ptr = pointerMoment('wake', [{ x: 170, y: 232 }, { x: 640, y: 232 }], t0, 1.1, false);
      return { html: scene(`<div class="fill center"><div class="glass a pop wtrack" style="${d(0.05)}"><div class="fill center body wlabel a" style="${d(t0 + 0.3)}"><span class="loop shimmer wshine">${esc(textOf(p, ctx))} ›››</span></div><div class="wthumb a" style="${d(t0)}">›</div><div class="fill wlit a" style="${d(t0 + 1.0)}"></div></div></div>${ptr.html}`, 800, 460, accentStyle(p)), css: `${ptr.css}.rbx .wtrack{position:relative;width:${px(560)};height:${px(84)};border-radius:999px;overflow:hidden}.rbx .wshine{background:linear-gradient(90deg,var(--muted) 40%,#fff 50%,var(--muted) 60%);background-size:250% 100%;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}.rbx .wlabel{animation-name:rbx-fadeout;animation-duration:.3s}.rbx .wthumb{position:absolute;left:${px(6)};top:${px(6)};width:${px(72)};height:${px(72)};border-radius:50%;background:#fff;color:#111;display:flex;align-items:center;justify-content:center;font-size:${px(34)};font-weight:800;z-index:2;animation-name:rbx-wthumb;animation-duration:1.1s;animation-timing-function:var(--ei)}.rbx .wlit{background:var(--accent);opacity:0;animation-name:rbx-fade;animation-duration:.3s;--alpha:.9}@keyframes rbx-wthumb{from{left:${px(6)}}to{left:${px(482)}}}@keyframes rbx-fadeout{from{opacity:1}to{opacity:0}}` };
    },
  }),
  bit({
    id: 'code-slots', name: 'Code Slots', category: 'micro', level: 'basic',
    about: 'One-time-code input slots that fill as you type.',
    video: 'Six slots; digits pop in one by one with the active slot ring moving along; on the last digit the row flashes green.',
    use: 'Sign-in demos, "enter the code", security beats.',
    props: [P_TEXT, P_ACCENT, { name: 'code', type: 'string', default: '482913', about: 'The digits shown (4–8).' }], example: { text: 'Enter the code', code: '482913' }, seconds: 4, tags: ['input', 'otp'],
    build: (p, ctx) => {
      const code = S(p, 'code', '482913').replace(/\D/g, '').slice(0, 8) || '4829';
      const slots = Array.from(code).map((ch, i) => `<div class="slotbox a" style="${d(0.8 + i * 0.28)}"><span class="a pop heading num" style="${d(0.8 + i * 0.28)}">${ch}</span></div>`).join('');
      const end = 0.8 + code.length * 0.28;
      return { html: scene(`<div class="fill center col" style="gap:${px(26)}"><div class="body a rise" style="${d(0.05)}">${esc(textOf(p, ctx))}</div><div class="row a fade slotrow" style="gap:${px(14)};${d(0.2)}">${slots}<div class="fill slotok a" style="${d(end + 0.1)}"></div></div></div>`, 800, 460, accentStyle(p)), css: `.rbx .slotrow{position:relative}.rbx .slotbox{width:${px(76)};height:${px(96)};border-radius:${px(14)};background:var(--card);border:${px(2)} solid var(--line);display:flex;align-items:center;justify-content:center;animation-name:rbx-slotring;animation-duration:.28s;animation-timing-function:linear;animation-fill-mode:none}.rbx .slotbox>span{font-size:${px(50)}}.rbx .slotok{border-radius:${px(18)};box-shadow:0 0 0 ${px(3)} #1fbf75;opacity:0;animation-name:rbx-slotok;animation-duration:.5s}@keyframes rbx-slotring{0%,100%{border-color:var(--accent);box-shadow:0 0 0 ${px(3)} var(--accent)}}@keyframes rbx-slotok{0%{opacity:0}30%{opacity:1}100%{opacity:1}}` };
    },
  }),
  bit({
    id: 'dodge-field', name: 'Dodge Field', category: 'micro', level: 'intermediate',
    about: 'A button that dodges the cursor.',
    video: 'The scripted cursor reaches for the button twice and it hops away each time; the third time it lets itself be pressed.',
    use: 'Comedy beats, "you cannot unsubscribe", playful CTAs.',
    props: [P_TEXT, P_ACCENT], example: { text: 'Unsubscribe' }, seconds: 5, tags: ['button', 'comedy'],
    build: (p, ctx) => {
      const ptr = pointerMoment('dodge', [{ x: 120, y: 400 }, { x: 320, y: 240 }, { x: 560, y: 260 }, { x: 420, y: 160 }, { x: 420, y: 170 }], 0.4, 3.2, true);
      return { html: scene(`<div class="pill a pop dodgebtn" style="font-size:${px(30)};padding:${px(18)} ${px(40)};${d(0.05)};animation-name:rbx-pop,rbx-dodge;animation-duration:.5s,3.2s;animation-delay:calc(var(--t) + var(--at,0s)),calc(var(--t) + var(--at,0s) + .4s)">${esc(textOf(p, ctx))}</div>${ptr.html}`, 800, 460, accentStyle(p)), css: `${ptr.css}.rbx .dodgebtn{position:absolute;left:${px(230)};top:${px(200)};animation-timing-function:var(--spring),var(--spring)}@keyframes rbx-dodge{0%,25%{transform:translate(0,0)}35%,50%{transform:translate(${px(240)},${px(20)})}60%,75%{transform:translate(${px(100)},${px(-80)})}90%{transform:translate(${px(100)},${px(-80)}) scale(.92)}100%{transform:translate(${px(100)},${px(-80)}) scale(1)}}` };
    },
  }),
  bit({
    id: 'lattice-loader', name: 'Lattice Loader', category: 'micro', level: 'basic',
    about: 'A lattice of dots pulsing in waves while loading.',
    video: 'A 5×5 dot lattice pulses in diagonal waves on a loop; the label sits under it.',
    use: 'Loading, "processing", waiting beats.',
    props: [P_TEXT, P_ACCENT], example: { text: 'Rendering frames…' }, seconds: 3, tags: ['loader', 'loop'],
    build: (p, ctx) => {
      const dots: string[] = [];
      for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) dots.push(`<i class="ldot loop" style="${d((r + c) * 0.1)}"></i>`);
      return { html: scene(`<div class="fill center col" style="gap:${px(26)}"><div class="lattice a pop" style="${d(0.05)}">${dots.join('')}</div><div class="small a rise" style="${d(0.3)}">${esc(textOf(p, ctx))}</div></div>`, 800, 460, accentStyle(p)), css: `.rbx .lattice{display:grid;grid-template-columns:repeat(5,${px(24)});gap:${px(14)}}.rbx .ldot{width:${px(24)};height:${px(24)};border-radius:50%;background:var(--accent);animation-name:rbx-ldot;animation-duration:1.2s;animation-timing-function:ease-in-out}@keyframes rbx-ldot{0%,100%{transform:scale(.5);opacity:.35}50%{transform:scale(1);opacity:1}}` };
    },
  }),
  bit({
    id: 'scrub-field', name: 'Scrub Field', category: 'micro', level: 'basic',
    about: 'A numeric field you scrub by dragging.',
    video: 'The scripted cursor drags across the field and the number rolls from the start to the end value with a ‹ › hint.',
    use: 'Editor demos, "dial it in", numeric settings.',
    props: [P_TEXT, P_ACCENT, { name: 'from', type: 'number', default: 0, about: 'Start value.' }, { name: 'to', type: 'number', default: 24, about: 'End value.' }, { name: 'unit', type: 'string', default: 'fps', about: 'Unit suffix.' }], example: { text: 'Frame rate', from: 0, to: 24, unit: 'fps' }, seconds: 3.5, tags: ['input', 'number'],
    build: (p, ctx) => {
      const from = Math.round(N(p, 'from', 0));
      const to = Math.round(N(p, 'to', 24));
      const steps = 12;
      const values = Array.from({ length: steps + 1 }, (_, i) => Math.round(from + ((to - from) * i) / steps));
      const ptr = pointerMoment('scrub', [{ x: 330, y: 250 }, { x: 560, y: 250 }], 0.6, 1.2, false);
      return { html: scene(`<div class="fill center col" style="gap:${px(16)}"><div class="kicker a rise" style="${d(0.05)}">${esc(textOf(p, ctx))}</div><div class="glass a pop scrub" style="${d(0.1)}"><span class="small">‹</span><div class="heading num scrubval">${values.map((v, i) => `<span class="a scrubv ${i === values.length - 1 ? '' : 'hold'}" style="${d(0.6 + (i * 1.2) / steps)};animation-duration:${(1.2 / steps).toFixed(3)}s">${v}</span>`).join('')}<span style="visibility:hidden">${to}</span></div><span class="small">${esc(S(p, 'unit', ''))}</span><span class="small">›</span></div></div>${ptr.html}`, 800, 460, accentStyle(p)), css: `${ptr.css}.rbx .scrub{display:flex;align-items:center;gap:${px(18)};padding:${px(14)} ${px(30)};border-radius:${px(16)}}.rbx .scrubval{position:relative;min-width:${px(120)};text-align:center}.rbx .scrubv{position:absolute;left:0;right:0;top:0;opacity:0;animation-name:rbx-slot;animation-timing-function:linear}` };
    },
  }),
  bit({
    id: 'fuse-button', name: 'Fuse Button', category: 'micro', level: 'intermediate',
    about: 'A button with a burning fuse that fires when it reaches the end.',
    video: 'A fuse line burns along the top of the button with a spark; when it reaches the end the button fires (pulses accent) and the label changes.',
    use: 'Countdown CTAs, "last chance", timed actions.',
    props: [P_TEXT, P_SUBTITLE, P_ACCENT, { name: 'seconds', type: 'number', default: 2, about: 'How long the fuse burns.' }], example: { text: 'Publish', subtitle: 'Published!' }, seconds: 4, tags: ['button', 'timer'],
    build: (p, ctx) => {
      const burn = Math.max(0.5, N(p, 'seconds', 2));
      return { html: scene(`<div class="fill center"><div class="fusebtn a pop" style="${d(0.05)}"><div class="fuse a" style="${d(0.4)};animation-duration:${burn}s"></div><i class="fusespark a" style="${d(0.4)};animation-duration:${burn}s"></i><span class="body a fuselbl" style="font-weight:700;${d(0.4 + burn)}">${esc(textOf(p, ctx))}</span><span class="body a fade" style="position:absolute;font-weight:700;${d(0.4 + burn + 0.1)}">${esc(S(p, 'subtitle') || ctx.subtitle || 'Done')}</span><div class="fill fusefire a" style="${d(0.4 + burn)}"></div></div></div>`, 800, 460, accentStyle(p)), css: `.rbx .fusebtn{position:relative;display:flex;align-items:center;justify-content:center;width:${px(360)};height:${px(96)};border-radius:${px(20)};background:var(--card);border:${px(2)} solid var(--line);overflow:hidden}.rbx .fuse{position:absolute;left:0;top:0;height:${px(6)};width:100%;background:var(--accent);transform-origin:right;animation-name:rbx-fuse;animation-timing-function:linear}.rbx .fusespark{position:absolute;top:${px(-6)};left:0;width:${px(18)};height:${px(18)};border-radius:50%;background:#fff;box-shadow:0 0 ${px(16)} ${px(4)} var(--accent2);animation-name:rbx-fusespark;animation-timing-function:linear}.rbx .fuselbl{animation-name:rbx-fadeout;animation-duration:.15s}.rbx .fusefire{background:var(--accent);opacity:0;animation-name:rbx-fusefire;animation-duration:.6s;z-index:-1}@keyframes rbx-fuse{from{transform:scaleX(1)}to{transform:scaleX(0)}}@keyframes rbx-fusespark{from{left:0}to{left:100%}}@keyframes rbx-fusefire{0%{opacity:0}30%{opacity:1}100%{opacity:.9}}@keyframes rbx-fadeout{from{opacity:1}to{opacity:0}}` };
    },
  }),
  bit({
    id: 'warm-tooltip', name: 'Warm Tooltip', category: 'micro', level: 'basic',
    about: 'A tooltip that pops in warmly on hover.',
    video: 'The scripted cursor hovers a chip; a tooltip pops above it with an arrow and the explanation.',
    use: 'Explaining a term in a UI, callouts on screenshots.',
    props: [P_TEXT, P_SUBTITLE, P_ACCENT, P_AT], example: { text: 'Roto', subtitle: 'Cutting the speaker out of the background' }, seconds: 3.5, tags: ['tooltip', 'hover'],
    build: (p, ctx) => {
      const t0 = at(p);
      const ptr = pointerMoment('tip', [{ x: 140, y: 400 }, { x: 410, y: 270 }], t0 - 0.7, 0.7, false);
      return { html: scene(`<div class="fill center"><div style="position:relative"><span class="pill a pop" style="font-size:${px(30)};padding:${px(16)} ${px(32)};${d(0.05)}">${esc(textOf(p, ctx))}</span><div class="glass a tooltip" style="${d(t0)}"><div class="body">${esc(S(p, 'subtitle') || ctx.subtitle || '…')}</div><i></i></div></div></div>${ptr.html}`, 800, 460, accentStyle(p)), css: `${ptr.css}.rbx .tooltip{position:absolute;left:50%;bottom:calc(100% + ${px(26)});width:${px(440)};padding:${px(18)} ${px(24)};transform:translateX(-50%);text-align:center;transform-origin:50% 100%;animation-name:rbx-tooltip;animation-duration:.5s;animation-timing-function:var(--spring)}.rbx .tooltip>i{position:absolute;left:50%;bottom:${px(-12)};width:${px(24)};height:${px(24)};margin-left:${px(-12)};background:var(--card);border-right:${px(2)} solid var(--line);border-bottom:${px(2)} solid var(--line);transform:rotate(45deg)}@keyframes rbx-tooltip{from{opacity:0;transform:translateX(-50%) translateY(${px(16)}) scale(.8)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}` };
    },
  }),
  bit({
    id: 'slide-commit', name: 'Slide Commit', category: 'micro', level: 'basic',
    about: 'Slide-to-confirm control that commits at the end.',
    video: 'The scripted drag pushes the handle across; the track fills, and at the end it turns green with a check and the label "confirmed".',
    use: 'Payments, "confirm", irreversible action demos.',
    props: [P_TEXT, P_SUBTITLE, P_ACCENT, P_AT], example: { text: 'Slide to export', subtitle: 'Exporting…' }, seconds: 3.5, tags: ['slider', 'confirm'],
    build: (p, ctx) => {
      const t0 = at(p);
      const ptr = pointerMoment('commit', [{ x: 170, y: 232 }, { x: 640, y: 232 }], t0, 1.1, false);
      return { html: scene(`<div class="fill center"><div class="glass a pop sctrack" style="${d(0.05)}"><div class="scfill a" style="${d(t0)}"></div><div class="fill center body" style="position:relative;z-index:1"><span class="a sclbl" style="${d(t0 + 1.0)}">${esc(textOf(p, ctx))}</span><span class="a fade" style="position:absolute;${d(t0 + 1.1)}">${esc(S(p, 'subtitle') || ctx.subtitle || 'Confirmed')}</span></div><div class="scthumb a" style="${d(t0)}"><span class="a scarrow" style="${d(t0 + 1.0)}">›</span><span class="fill a fade" style="padding:${px(16)};${d(t0 + 1.05)}">${CHECK}</span></div></div></div>${ptr.html}`, 800, 460, accentStyle(p)), css: `${ptr.css}${CHECK_CSS}.rbx .sctrack{position:relative;width:${px(560)};height:${px(84)};border-radius:999px;overflow:hidden}.rbx .scfill{position:absolute;left:0;top:0;bottom:0;width:${px(84)};border-radius:999px;background:var(--accent);animation-name:rbx-scfill;animation-duration:1.4s;animation-timing-function:var(--ei)}.rbx .scthumb{position:absolute;left:${px(6)};top:${px(6)};width:${px(72)};height:${px(72)};border-radius:50%;background:#fff;color:#111;display:flex;align-items:center;justify-content:center;font-size:${px(34)};font-weight:800;z-index:2;animation-name:rbx-scthumb;animation-duration:1.4s;animation-timing-function:var(--ei)}.rbx .sclbl,.rbx .scarrow{animation-name:rbx-fadeout;animation-duration:.2s}.rbx .scthumb .fill{color:#fff}@keyframes rbx-scfill{0%{width:${px(84)};background:var(--accent)}78%{width:100%;background:var(--accent)}100%{width:100%;background:#1fbf75}}@keyframes rbx-scthumb{0%{left:${px(6)};background:#fff}78%{left:${px(482)};background:#fff}100%{left:${px(482)};background:#17a862}}@keyframes rbx-fadeout{from{opacity:1}to{opacity:0}}` };
    },
  }),
  bit({
    id: 'rubber-segment', name: 'Rubber Segment', category: 'micro', level: 'basic',
    about: 'A segmented control whose indicator stretches like rubber between segments.',
    video: 'A segmented control; at the moment the indicator stretches toward the target segment, then snaps to size.',
    use: 'Mode switches, "toggle the view", tabs.',
    props: [P_ACCENT, P_ROWS, P_AT, { name: 'activeIndex', type: 'number', default: 2, about: 'Target segment.' }], example: { rows: ['Day', 'Week', 'Month'], activeIndex: 2 }, seconds: 3.5, tags: ['segment', 'spring'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['One', 'Two', 'Three']).slice(0, 5);
      const active = Math.min(rows.length - 1, Math.max(0, Math.round(N(p, 'activeIndex', 2))));
      const w = 100 / rows.length;
      return { html: scene(`<div class="fill center"><div class="glass a pop rseg" style="${d(0.05)}"><div class="rsegind a" style="${d(at(p))};--w:${w.toFixed(2)}%;--end:${(active * w).toFixed(2)}%;--stretch:${(w * (active + 1)).toFixed(2)}%"></div>${rows.map((r) => `<div class="body rsegitem" style="width:${w.toFixed(2)}%">${esc(r)}</div>`).join('')}</div></div>`, 800, 460, accentStyle(p)), css: `.rbx .rseg{position:relative;display:flex;width:${px(560)};padding:${px(8)};border-radius:${px(20)}}.rbx .rsegitem{position:relative;z-index:1;text-align:center;padding:${px(16)} 0;font-weight:600}.rbx .rsegind{position:absolute;top:${px(8)};bottom:${px(8)};left:${px(8)};width:calc(var(--w) - ${px(16)});border-radius:${px(14)};background:var(--accent);animation-name:rbx-rseg;animation-duration:.8s;animation-timing-function:var(--spring)}@keyframes rbx-rseg{0%{left:${px(8)};width:calc(var(--w) - ${px(16)})}45%{left:${px(8)};width:calc(var(--stretch) - ${px(16)})}100%{left:calc(var(--end) + ${px(8)});width:calc(var(--w) - ${px(16)})}}` };
    },
  }),
  bit({
    id: 'pulse-heart', name: 'Pulse Heart', category: 'micro', level: 'basic',
    about: 'A like button that pulses with rings when tapped.',
    video: 'The scripted cursor taps the heart; it fills red, pops, rings burst outward and the count ticks up by one.',
    use: '"Like this video", engagement beats, social demos.',
    props: [P_ACCENT, P_AT, { name: 'count', type: 'number', default: 1287, about: 'Likes before the tap.' }], example: { count: 1287 }, seconds: 3.5, tags: ['like', 'heart'],
    build: (p) => {
      const t0 = at(p);
      const count = Math.round(N(p, 'count', 1287));
      const ptr = pointerMoment('heart', [{ x: 160, y: 400 }, { x: 380, y: 240 }], t0 - 0.7, 0.7, true);
      return { html: scene(`<div class="fill center" style="gap:${px(26)}"><div class="heartwrap"><div class="heart a" style="${d(t0)}">${HEART}</div>${[0, 1].map((i) => `<i class="ring a hring" style="left:50%;top:50%;${d(t0 + i * 0.12)}"></i>`).join('')}</div><div class="heading num" style="position:relative;width:${px(220)}"><span class="a hold-old" style="position:absolute;${d(t0 + 0.15)}">${count.toLocaleString('en-US')}</span><span class="a slide-u" style="position:absolute;${d(t0 + 0.15)}">${(count + 1).toLocaleString('en-US')}</span></div></div>${ptr.html}`, 800, 460, accentStyle(p)), css: `${ptr.css}.rbx .heartwrap{position:relative;width:${px(120)};height:${px(120)}}.rbx .heart{width:100%;height:100%;fill:none;stroke:var(--muted);stroke-width:1.6;animation-name:rbx-heart;animation-duration:.6s;animation-timing-function:var(--spring)}.rbx .heart svg{fill:inherit;stroke:inherit}.rbx .hring{position:absolute;width:${px(120)};height:${px(120)};margin:${px(-60)} 0 0 ${px(-60)};border-radius:50%;border:${px(3)} solid #ff3b5c}.rbx .hold-old{animation-name:rbx-hup;animation-duration:.4s;animation-timing-function:var(--eo)}@keyframes rbx-heart{0%{fill:none;stroke:var(--muted);transform:scale(1)}30%{fill:#ff3b5c;stroke:#ff3b5c;transform:scale(1.35)}100%{fill:#ff3b5c;stroke:#ff3b5c;transform:scale(1)}}@keyframes rbx-hup{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(-100%)}}` };
    },
  }),
  bit({
    id: 'spring-check', name: 'Spring Check', category: 'micro', level: 'basic',
    about: 'A checkbox that ticks with a spring.',
    video: 'A checklist; each box is ticked in turn: the box springs, fills accent and the check draws itself.',
    use: 'Checklists, "done, done, done", progress beats.',
    props: [P_ACCENT, P_ROWS, P_AT], example: { rows: ['Script written', 'Shots gathered', 'Music placed', 'QA clear'] }, seconds: 4, tags: ['checkbox', 'list'],
    build: (p, ctx) => {
      const rows = rowsOf(p, ctx, ['One', 'Two', 'Three']).slice(0, 6);
      const t0 = at(p);
      return { html: scene(`<div class="fill center"><div class="col a pop" style="gap:${px(18)};${d(0.05)}">${rows.map((r, i) => `<div class="row" style="gap:${px(20)}"><div class="cbox a" style="${d(t0 + i * 0.45)}">${CHECK.replace('class="a draw chk"', `class="a draw chk" style="${d(t0 + i * 0.45 + 0.15)}"`)}</div><span class="body cblbl a" style="${d(t0 + i * 0.45 + 0.2)}">${esc(r)}</span></div>`).join('')}</div></div>`, 800, 460, accentStyle(p)), css: `${CHECK_CSS}.rbx .cbox{width:${px(52)};height:${px(52)};border-radius:${px(14)};border:${px(3)} solid var(--line);padding:${px(8)};animation-name:rbx-cbox;animation-duration:.5s;animation-timing-function:var(--spring)}.rbx .cblbl{animation-name:rbx-cblbl;animation-duration:.4s}@keyframes rbx-cbox{0%{transform:scale(1);background:transparent;border-color:var(--line)}40%{transform:scale(.8)}70%{transform:scale(1.15)}100%{transform:scale(1);background:var(--accent);border-color:var(--accent)}}@keyframes rbx-cblbl{to{color:var(--muted);text-decoration:line-through}}` };
    },
  }),
  bit({
    id: 'peek-rating', name: 'Peek Rating', category: 'micro', level: 'basic',
    about: 'A star rating where stars peek larger under the pointer.',
    video: 'Five outline stars; the scripted cursor sweeps across and stars fill one by one to the rating, each peeking larger as it fills.',
    use: 'Reviews, "rate it", testimonial beats.',
    props: [P_TEXT, P_ACCENT, P_AT, { name: 'value', type: 'number', default: 4, about: 'Stars (1–5).' }], example: { text: 'Loved it', value: 4 }, seconds: 3.5, tags: ['rating', 'stars'],
    build: (p, ctx) => {
      const v = Math.min(5, Math.max(1, Math.round(N(p, 'value', 4))));
      const t0 = at(p);
      const ptr = pointerMoment('rate', [{ x: 200, y: 330 }, { x: 200 + (v - 1) * 90 + 40, y: 250 }], t0 - 0.2, 0.9, false);
      return { html: scene(`<div class="fill center col" style="gap:${px(24)}"><div class="row a pop" style="gap:${px(14)};${d(0.05)}">${[0, 1, 2, 3, 4].map((i) => `<div class="star ${i < v ? 'a starfill' : ''}" style="${i < v ? d(t0 + i * 0.18) : ''}"><svg viewBox="0 0 24 24" style="width:100%;height:100%"><path d="M12 2.5l2.9 6.2 6.7.8-5 4.6 1.4 6.7L12 17.4l-6 3.4 1.4-6.7-5-4.6 6.7-.8z"/></svg></div>`).join('')}</div><div class="body a rise" style="${d(t0 + v * 0.18 + 0.2)}">${esc(textOf(p, ctx))}</div></div>${ptr.html}`, 800, 460, accentStyle(p)), css: `${ptr.css}.rbx .star{width:${px(76)};height:${px(76)};fill:none;stroke:var(--muted);stroke-width:1.4}.rbx .star svg{fill:inherit;stroke:inherit}.rbx .starfill{animation-name:rbx-star;animation-duration:.5s;animation-timing-function:var(--spring)}@keyframes rbx-star{0%{fill:none;transform:scale(1)}40%{fill:#f5b301;stroke:#f5b301;transform:scale(1.35)}100%{fill:#f5b301;stroke:#f5b301;transform:scale(1)}}` };
    },
  }),
  bit({
    id: 'hold-button', name: 'Hold Button', category: 'micro', level: 'basic',
    about: 'Hold-to-confirm: a ring fills while the button is held.',
    video: 'The scripted cursor presses and holds; a ring fills around the button over the hold time; at the end it turns green with a check.',
    use: 'Deletions, "hold to record", deliberate actions.',
    props: [P_TEXT, P_SUBTITLE, P_ACCENT, P_AT, { name: 'hold', type: 'number', default: 1.2, about: 'Seconds held.' }], example: { text: 'Hold to delete', subtitle: 'Deleted' }, seconds: 4, tags: ['button', 'hold'],
    build: (p, ctx) => {
      const t0 = at(p);
      const hold = Math.max(0.4, N(p, 'hold', 1.2));
      const ptr = pointerMoment('holdbtn', [{ x: 160, y: 420 }, { x: 410, y: 240 }], t0 - 0.7, 0.7, false);
      return { html: scene(`<div class="fill center col" style="gap:${px(24)}"><div class="holdwrap a pop" style="${d(0.05)}">${svg(`<circle cx="70" cy="70" r="62" style="fill:none;stroke:var(--line);stroke-width:6"/><circle class="a draw holdring" cx="70" cy="70" r="62" pathLength="1" style="${d(t0)};animation-duration:${hold}s"/>`, { vb: '0 0 140 140', aspect: 'meet' })}<div class="holdbtn a press holddone" style="${d(t0)};animation-name:rbx-press,rbx-holddone;animation-duration:.4s,.4s;animation-delay:calc(var(--t) + var(--at,0s) + ${t0}s),calc(var(--t) + var(--at,0s) + ${t0 + hold}s)"><span class="a holdlbl" style="${d(t0 + hold)}">●</span><span class="fill a fade" style="padding:${px(26)};${d(t0 + hold)}">${CHECK}</span></div></div><div class="body" style="position:relative;height:1.4em"><span class="a holdlbl" style="position:absolute;left:50%;transform:translateX(-50%);white-space:nowrap;${d(t0 + hold)}">${esc(textOf(p, ctx))}</span><span class="a fade" style="position:absolute;left:50%;transform:translateX(-50%);white-space:nowrap;${d(t0 + hold + 0.1)}">${esc(S(p, 'subtitle') || ctx.subtitle || 'Done')}</span></div></div>${ptr.html}`, 800, 460, accentStyle(p)), css: `${ptr.css}${CHECK_CSS}.rbx .holdwrap{position:relative;width:${px(140)};height:${px(140)}}.rbx .holdring{fill:none;stroke:var(--accent);stroke-width:6;stroke-linecap:round;transform:rotate(-90deg);transform-origin:70px 70px;animation-timing-function:linear}.rbx .holdbtn{position:absolute;inset:${px(16)};border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:${px(40)};animation-fill-mode:both,forwards}.rbx .holdlbl{animation-name:rbx-fadeout;animation-duration:.2s}@keyframes rbx-holddone{to{background:#1fbf75}}@keyframes rbx-fadeout{from{opacity:1}to{opacity:0}}` };
    },
  }),
  bit({
    id: 'squish-switch', name: 'Squish Switch', category: 'micro', level: 'basic',
    about: 'A toggle whose knob squishes as it flips.',
    video: 'A toggle switch; the scripted cursor taps it; the knob squashes wide, slides across and the track turns accent; the label updates.',
    use: 'Settings demos, "turn it on", feature flags.',
    props: [P_TEXT, P_SUBTITLE, P_ACCENT, P_AT], example: { text: 'Captions off', subtitle: 'Captions on' }, seconds: 3, tags: ['toggle', 'switch'],
    build: (p, ctx) => {
      const t0 = at(p);
      const ptr = pointerMoment('switch', [{ x: 160, y: 420 }, { x: 430, y: 235 }], t0 - 0.7, 0.7, true);
      return { html: scene(`<div class="fill center col" style="gap:${px(26)}"><div class="switch a pop" style="${d(0.05)};animation-name:rbx-pop,rbx-swtrack;animation-duration:.5s,.5s;animation-delay:calc(var(--t) + var(--at,0s)),calc(var(--t) + var(--at,0s) + ${t0}s);animation-fill-mode:both,forwards"><div class="knob a" style="${d(t0)}"></div></div><div class="body" style="position:relative;height:1.4em"><span class="a swlbl" style="position:absolute;left:50%;transform:translateX(-50%);white-space:nowrap;${d(t0 + 0.2)}">${esc(textOf(p, ctx))}</span><span class="a fade" style="position:absolute;left:50%;transform:translateX(-50%);white-space:nowrap;${d(t0 + 0.3)}">${esc(S(p, 'subtitle') || ctx.subtitle || 'On')}</span></div></div>${ptr.html}`, 800, 460, accentStyle(p)), css: `${ptr.css}.rbx .switch{position:relative;width:${px(160)};height:${px(84)};border-radius:999px;background:#ffffff26;animation-timing-function:var(--spring),var(--ei)}.rbx .knob{position:absolute;left:${px(8)};top:${px(8)};width:${px(68)};height:${px(68)};border-radius:999px;background:#fff;box-shadow:0 ${px(6)} ${px(16)} #0007;animation-name:rbx-knob;animation-duration:.6s;animation-timing-function:var(--spring)}.rbx .swlbl{animation-name:rbx-fadeout;animation-duration:.2s}@keyframes rbx-swtrack{to{background:var(--accent)}}@keyframes rbx-knob{0%{left:${px(8)};width:${px(68)}}45%{left:${px(8)};width:${px(100)}}100%{left:${px(84)};width:${px(68)}}}@keyframes rbx-fadeout{from{opacity:1}to{opacity:0}}` };
    },
  }),
];
