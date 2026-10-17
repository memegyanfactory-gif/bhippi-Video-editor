// "Talk to your brand": Brand Studio's prompt bar asks Bhippi's AI to change a kit through one small
// window event, so the settings panel never needs a handle on the chat.
//
//   window.dispatchEvent(new CustomEvent('bhippi:brand-prompt', { detail: { kitId, kitName, text } }))
//
// App.tsx listens and sends `brandPromptMessage(...)` to the chat in Quick mode; the AI answers with
// its existing brand-kit tools (update_brand_kit …) and the studio animates whatever changes.

export const BRAND_PROMPT_EVENT = 'bhippi:brand-prompt';

export type BrandPromptDetail = { kitId: string; kitName: string; text: string };

/** The one-line framing the chat turn starts from. */
export const brandPromptMessage = (detail: BrandPromptDetail): string =>
  `Update brand kit ${detail.kitName} (${detail.kitId}): ${detail.text.trim()}. Use the brand kit tools; change only what's asked.`;

/** Fires the request; false when the text is empty. */
export function requestBrandChange(detail: BrandPromptDetail): boolean {
  if (!detail.text.trim()) return false;
  window.dispatchEvent(new CustomEvent<BrandPromptDetail>(BRAND_PROMPT_EVENT, { detail }));
  return true;
}
