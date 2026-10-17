/** HTML labels laid over the canvas: a pool of elements moved with transforms, never recreated per frame. */

export type Slot = {
  el: HTMLDivElement;
  w: number;
  h: number;
  x: number;
  y: number;
  opacity: number;
  on: boolean;
  frame: number;
};

export class LabelPool {
  private slots = new Map<string, Slot>();
  private taken = new Float32Array(4 * 400);
  private count = 0;
  private frame = 0;

  constructor(private host: HTMLElement) {}

  begin() {
    this.frame += 1;
    this.count = 0;
  }

  /** The slot for a key; the element is created (and measured once) the first time. */
  slot(key: string, className: string, html: string): Slot {
    let slot = this.slots.get(key);
    if (!slot) {
      const el = document.createElement('div');
      el.className = className;
      el.innerHTML = html;
      el.style.opacity = '0';
      this.host.appendChild(el);
      slot = { el, w: el.offsetWidth, h: el.offsetHeight, x: 0, y: 0, opacity: 0, on: false, frame: 0 };
      this.slots.set(key, slot);
    }
    return slot;
  }

  setClass(slot: Slot, className: string) {
    if (slot.el.className !== className) slot.el.className = className;
  }

  /** Whether a box is clear of everything already placed and inside the stage. */
  free(x: number, y: number, w: number, h: number, width: number, height: number) {
    if (x < 2 || y < 2 || x + w > width - 2 || y + h > height - 2) return false;
    const t = this.taken;
    for (let i = 0; i < this.count; i += 1) {
      const o = i * 4;
      if (x < t[o] + t[o + 2] && x + w > t[o] && y < t[o + 1] + t[o + 3] && y + h > t[o + 1]) return false;
    }
    return true;
  }

  claim(x: number, y: number, w: number, h: number) {
    if (this.count >= 400) return;
    const o = this.count * 4;
    this.taken[o] = x; this.taken[o + 1] = y; this.taken[o + 2] = w; this.taken[o + 3] = h;
    this.count += 1;
  }

  show(slot: Slot, x: number, y: number, opacity: number) {
    const rx = Math.round(x * 2) / 2;
    const ry = Math.round(y * 2) / 2;
    if (rx !== slot.x || ry !== slot.y) {
      slot.el.style.transform = `translate3d(${rx}px,${ry}px,0)`;
      slot.x = rx; slot.y = ry;
    }
    const o = Math.round(opacity * 50) / 50;
    if (o !== slot.opacity) { slot.el.style.opacity = String(o); slot.opacity = o; }
    slot.on = true;
    slot.frame = this.frame;
  }

  /** Fade out whatever this frame did not ask for; forget labels unused for a while. */
  end() {
    for (const [key, slot] of this.slots) {
      if (slot.frame === this.frame) continue;
      if (slot.opacity !== 0) { slot.el.style.opacity = '0'; slot.opacity = 0; }
      slot.on = false;
      if (this.frame - slot.frame > 900 && this.slots.size > 90) { slot.el.remove(); this.slots.delete(key); }
    }
  }

  dispose() {
    for (const slot of this.slots.values()) slot.el.remove();
    this.slots.clear();
  }
}
