import gsap from 'gsap';
import { describe, expect, it } from 'vitest';
import { adoptLooseTweens, seekLooseAnimations } from '../src/lib/htmlTime';

describe('HTML graphics stay on the playhead', () => {
  it('moves tweens a script started on its own into the paused timeline, delays kept', () => {
    const box = { x: 0 };
    const timeline = gsap.timeline({ paused: true });
    adoptLooseTweens(gsap, timeline, () => { gsap.to(box, { x: 100, duration: 1, delay: 0.5, ease: 'none' }); });
    timeline.seek(0.25, false);
    expect(box.x).toBe(0);
    timeline.seek(1, false);
    expect(box.x).toBeCloseTo(50, 5);
    timeline.seek(0, false);
    expect(box.x).toBe(0);
    timeline.kill();
  });

  it('seeks animations running on their own and leaves ones a stylesheet holds paused', () => {
    const make = (playState: string) => ({ playState, currentTime: 0 as number | null, pause() { this.playState = 'paused'; } });
    const loose = make('running'), held = make('paused');
    const root = { getAnimations: () => [loose, held] } as unknown as Element;
    const taken = new WeakSet<Animation>();
    seekLooseAnimations(root, 1.5, taken);
    expect(loose.currentTime).toBe(1500);
    expect(held.currentTime).toBe(0);
    // Once taken over it keeps following the playhead, though it is paused now.
    seekLooseAnimations(root, 0.2, taken);
    expect(loose.currentTime).toBe(200);
  });
});

describe('a graphic that draws its own frames', () => {
  it('passes the script\'s render function through, so every frame can call it', async () => {
    const { frameRender } = await import('../src/lib/htmlTime');
    const seen: number[] = [];
    const timeline = gsap.timeline({ paused: true });
    const render = frameRender(adoptLooseTweens(gsap, timeline, () => (time: number) => { seen.push(time); }));
    render?.(1.25, 0.5);
    expect(seen).toEqual([1.25]);
    expect(frameRender(undefined)).toBeNull();
    timeline.kill();
  });
});
