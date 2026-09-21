// Copying text out of the app, with a fallback for when the async clipboard
// API is unavailable or refuses (older webviews, permissions, non-secure
// contexts). Returns true on success — callers show their own confirmation,
// and must tell the user on false rather than flashing "Copied" for nothing.
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path below.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const done = document.execCommand('copy');
    document.body.removeChild(area);
    return done;
  } catch {
    return false;
  }
}
