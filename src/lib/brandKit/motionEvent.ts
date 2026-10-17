// "Add to timeline" from Brand Studio: the settings panel has no handle on the editor, so a small
// window event carries the request and App.tsx answers it with the same tool the AI uses.
//
//   window.dispatchEvent(new CustomEvent('bhippi:add-brand-motion', { detail: { kitId, id } }))
//
// `id` is a motion-pack id from `packItems(kit)` (e.g. "sting-clean", "lower-third-panel") or "reel"
// for the whole brand film. App.tsx runs `brand_motion_pack {action:"use", id, kitId, start}` at the
// playhead, so the scene is built at the comp's own size and lands exactly as an AI-placed one.

export const ADD_BRAND_MOTION_EVENT = 'bhippi:add-brand-motion';

export type AddBrandMotionDetail = { kitId: string; id: string; /** Optional wording (name, tagline, person, role, headline, cta, handle). */ copy?: Record<string, string> };

/** Fires the request; false when there is nothing to add. */
export function requestAddBrandMotion(detail: AddBrandMotionDetail): boolean {
  if (!detail.kitId || !detail.id) return false;
  window.dispatchEvent(new CustomEvent<AddBrandMotionDetail>(ADD_BRAND_MOTION_EVENT, { detail }));
  return true;
}
