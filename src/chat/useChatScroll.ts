// How the transcript scrolls: it holds your place the way ChatGPT and Codex do.
//
// When you send, your message glides to the top of the panel and the answer grows into room held
// open beneath it (the reserve, a spacer after the last message), so you read from the start of
// the reply instead of chasing its tail. Once the answer is taller than the panel, the view follows
// its newest line with a spring rather than jumping to it.
//
// It lets go the moment you scroll up — a wheel turn, a drag on the bar, a key, a touch — and a
// "Jump to latest" pill takes you back. Scrolling down to the end by hand picks it up again. Only a
// move made while the content kept its height counts as you: when a step list folds, the browser
// shortens the page and pulls the scroll position up with it, and that must not read as "I scrolled
// up". The reserve stays until the next message, so the view never snaps back when a turn ends.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** use-stick-to-bottom's spring (StackBlitz): smooth, and it never overshoots the end. */
const DAMPING = 0.7;
const STIFFNESS = 0.05;
const MASS = 1.25;
/** Space kept above your message when it sits at the top, and below the newest line when following. */
const TOP_ROOM = 12;
const BOTTOM_ROOM = 16;

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function useChatScroll(listRef: RefObject<HTMLDivElement | null>, reserveRef: RefObject<HTMLDivElement | null>) {
  const [away, setAway] = useState(false);
  const state = useRef({
    /** Your newest message, held at the top while its answer is shorter than the panel. */
    anchor: null as HTMLElement | null,
    pendingAnchor: false,
    attached: true,
    /** Jump rather than glide: opening a conversation should not scroll through it. */
    instant: true,
    velocity: 0,
    carry: 0,
    /** The scroll position this hook last wrote, and the content height at the last scroll event. */
    last: 0,
    lastHeight: 0,
    frame: 0,
    away: false,
  });
  const scheduleRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const st = state.current;

    const offsetOf = (element: HTMLElement) => {
      let y = 0;
      for (let node: HTMLElement | null = element; node && node !== list; node = node.offsetParent as HTMLElement | null) y += node.offsetTop;
      return y;
    };
    /** Where the last message ends: the reserve's top, which sits right under it. */
    const contentBottom = () => reserveRef.current?.offsetTop ?? list.scrollHeight;
    const anchorTop = () => (st.anchor ? Math.max(0, offsetOf(st.anchor) - TOP_ROOM) : 0);
    const goal = () => {
      const max = Math.max(0, list.scrollHeight - list.clientHeight);
      if (!st.anchor) return max;
      return Math.min(max, Math.max(anchorTop(), contentBottom() + BOTTOM_ROOM - list.clientHeight));
    };
    const layoutReserve = () => {
      const reserve = reserveRef.current;
      if (!reserve) return;
      const need = st.anchor ? Math.max(0, Math.round(anchorTop() + list.clientHeight - (list.scrollHeight - reserve.offsetHeight))) : 0;
      if (reserve.offsetHeight !== need) reserve.style.height = `${need}px`;
    };

    const tick = () => {
      st.frame = 0;
      if (st.pendingAnchor) {
        const sent = list.querySelectorAll<HTMLElement>('.msg-user-row');
        const newest = sent[sent.length - 1];
        if (newest) {
          st.anchor = newest;
          st.pendingAnchor = false;
          st.attached = true;
          st.velocity = st.carry = 0;
        }
      }
      if (st.anchor && !st.anchor.isConnected) st.anchor = null;
      layoutReserve();
      let moving = false;
      if (st.attached) {
        const target = goal();
        const from = list.scrollTop;
        const distance = target - from;
        if (Math.abs(distance) > 0.6 || Math.abs(st.velocity) > 0.2) {
          if (st.instant || reducedMotion()) {
            list.scrollTop = target;
            st.velocity = st.carry = 0;
          } else {
            st.velocity = (DAMPING * st.velocity + STIFFNESS * distance) / MASS;
            st.carry += st.velocity;
            list.scrollTop = from + st.carry;
            // Sub-pixel steps pile up until the browser actually moves.
            if (list.scrollTop !== from) st.carry = 0;
            moving = true;
          }
          st.last = list.scrollTop;
        } else {
          st.velocity = 0;
        }
        if (list.scrollHeight > list.clientHeight) st.instant = false;
      }
      if (st.lastHeight !== list.scrollHeight && Math.abs(list.scrollTop - st.last) <= 2) st.lastHeight = list.scrollHeight;
      const below = contentBottom() - (list.scrollTop + list.clientHeight) > 24;
      const show = !st.attached && below;
      if (show !== st.away) {
        st.away = show;
        setAway(show);
      }
      if (moving) schedule();
    };
    const schedule = () => {
      if (!st.frame) st.frame = requestAnimationFrame(tick);
    };
    scheduleRef.current = schedule;

    const detach = () => {
      if (!st.attached) return;
      st.attached = false;
      st.velocity = st.carry = 0;
      schedule();
    };
    const onScroll = () => {
      const top = list.scrollTop;
      const height = list.scrollHeight;
      if (Math.abs(top - st.last) > 2 && height === st.lastHeight) {
        const atEnd = top >= contentBottom() + BOTTOM_ROOM - list.clientHeight - 4;
        if (top < st.last) detach();
        else if (atEnd) {
          if (!st.attached) {
            st.attached = true;
            st.velocity = st.carry = 0;
          }
        } else detach();
      }
      st.last = top;
      st.lastHeight = height;
      schedule();
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) detach();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'Home') detach();
    };
    // Opening a step or a code window is reading, not following: the view stays where you put it.
    const onPointer = (event: PointerEvent) => {
      if ((event.target as HTMLElement | null)?.closest('button, summary, a')) detach();
    };

    const sizes = new ResizeObserver(schedule);
    sizes.observe(list);
    const watchChildren = () => {
      for (const child of Array.from(list.children)) sizes.observe(child);
    };
    const content = new MutationObserver(() => {
      watchChildren();
      schedule();
    });
    content.observe(list, { childList: true, subtree: true, characterData: true });
    watchChildren();
    list.addEventListener('scroll', onScroll, { passive: true });
    list.addEventListener('wheel', onWheel, { passive: true });
    list.addEventListener('touchstart', detach, { passive: true });
    list.addEventListener('keydown', onKey);
    list.addEventListener('pointerdown', onPointer);
    list.addEventListener('load', schedule, true);
    list.addEventListener('transitionend', schedule, true);
    schedule();
    return () => {
      if (st.frame) cancelAnimationFrame(st.frame);
      st.frame = 0;
      sizes.disconnect();
      content.disconnect();
      list.removeEventListener('scroll', onScroll);
      list.removeEventListener('wheel', onWheel);
      list.removeEventListener('touchstart', detach);
      list.removeEventListener('keydown', onKey);
      list.removeEventListener('pointerdown', onPointer);
      list.removeEventListener('load', schedule, true);
      list.removeEventListener('transitionend', schedule, true);
    };
  }, [listRef, reserveRef]);

  /** A message was just sent: hold it at the top and grow its answer beneath it. */
  const anchorNext = useCallback(() => {
    const st = state.current;
    st.pendingAnchor = true;
    st.attached = true;
    scheduleRef.current();
  }, []);
  /** Back to the newest line, gliding. */
  const jump = useCallback(() => {
    const st = state.current;
    st.attached = true;
    st.velocity = st.carry = 0;
    scheduleRef.current();
  }, []);
  /** A different conversation: forget the held message and land on the end without scrolling through. */
  const reset = useCallback(() => {
    const st = state.current;
    st.anchor = null;
    st.pendingAnchor = false;
    st.attached = true;
    st.instant = true;
    scheduleRef.current();
  }, []);

  return { away, anchorNext, jump, reset };
}
