// A plugin's own logo: an image the user uploads in the Plugin Maker (Details, or while
// publishing). Packages only carry UTF-8 text files, so the picture is redrawn as a 256×256 PNG
// and wrapped in one fixed SVG shape — logo.svg in the draft, hashed in the lock and shipped in
// the package like any other file. Only that exact shape is accepted back, so a package cannot
// smuggle script or remote loads in through its "logo".

export const LOGO_FILE = 'logo.svg';
const SIZE = 256;
/** The wrapped logo's text; a 256px PNG of a real logo is far below this. */
export const MAX_LOGO_BYTES = 300 * 1024;
const WRAPPED = /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 256 256" width="256" height="256"><image href="(data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2})" width="256" height="256"\/><\/svg>\n?$/;

/** The logo file's text for a PNG or JPEG data URL. */
const wrap = (dataUrl: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}"><image href="${dataUrl}" width="${SIZE}" height="${SIZE}"/></svg>\n`;

/** The picture inside a logo file, as a data URL an <img> can show; null for anything else. */
export function logoImage(text: string | undefined): string | null {
  if (!text || text.length > MAX_LOGO_BYTES) return null;
  return WRAPPED.exec(text)?.[1] ?? null;
}

/**
 * An uploaded image (PNG, JPEG, WebP, GIF or SVG) as a logo file: cropped to a centred square,
 * scaled to 256×256 and redrawn, so nothing of the original file but its pixels is kept.
 */
export async function logoFromFile(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type)) throw new Error('Choose a PNG, JPEG, WebP, GIF or SVG image for the logo.');
  if (file.size > 8 * 1024 * 1024) throw new Error('That image is larger than 8 MB. Choose a smaller one.');
  const url = URL.createObjectURL(file);
  try {
    const picture = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('That image could not be read.'));
      image.src = url;
    });
    const width = picture.naturalWidth || SIZE;
    const height = picture.naturalHeight || SIZE;
    const side = Math.min(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The logo could not be drawn.');
    context.imageSmoothingQuality = 'high';
    context.drawImage(picture, (width - side) / 2, (height - side) / 2, side, side, 0, 0, SIZE, SIZE);
    let text = wrap(canvas.toDataURL('image/png'));
    // A busy photo can come out large as PNG; JPEG keeps it small (a logo on a square tile needs no alpha then).
    if (text.length > MAX_LOGO_BYTES) text = wrap(canvas.toDataURL('image/jpeg', 0.86));
    if (text.length > MAX_LOGO_BYTES) throw new Error('That image is too detailed to use as a logo. Try a simpler one.');
    return text;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Asks for an image file and resolves with it as a logo file, or null when nothing was chosen. */
export function pickLogo(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      logoFromFile(file).then(resolve, reject);
    };
    input.click();
  });
}
