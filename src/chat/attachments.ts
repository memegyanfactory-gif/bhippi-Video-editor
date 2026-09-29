// Files attached to a chat message: the limits, how a pasted picture is made sendable, and what
// the model is told about each file (ChatPanel.tsx attaches them; chat_prepare_attachments reads them).
import type { ChatAttachment } from '../lib/ipc';

/** Pictures one message carries: its own, a video's frames and annotation snapshots together. */
export const MAX_CHAT_IMAGES = 8;
/** What the paperclip offers. */
export const ATTACHABLE = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif', 'heic', 'mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'wmv', 'mts', 'mpg', 'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'];

/** A file attached to a message: `assetId` once a video or audio file is in the project. */
export type ChatFile = { name: string; kind: ChatAttachment['kind']; path: string; assetId?: string; duration?: number; times?: number[]; frames: number };

export const samePath = (a: string, b: string) => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();

/** A browser File (a pasted screenshot) as a data URL the providers accept: shrunk to JPEG when needed. */
export async function pictureUrl(file: File): Promise<string> {
  const read = (blob: Blob) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`could not read ${file.name || 'the picture'}`));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
  if (['image/png', 'image/jpeg', 'image/webp'].includes(file.type) && file.size <= 3_500_000) return read(file);
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.86);
}

/** What the model is told about the files, in words: kind, length, where it is and how to use it. */
export function filesBrief(files: ChatFile[]): string {
  if (!files.length) return '';
  const lines = files.map((file) => {
    const length = file.duration ? `, ${file.duration.toFixed(1)} s` : '';
    if (file.kind === 'image') return `- ${file.name}: a picture (attached above), on disk at ${file.path}. To use it in the edit, import_media it.`;
    const where = file.assetId ? `imported into the project as media ${file.assetId} (place_clip {"source":{"mediaId":"${file.assetId}"}})` : `on disk at ${file.path} (import_media it to use it)`;
    const frames = file.frames ? `; ${file.frames} frame${file.frames === 1 ? '' : 's'} from it attached above, at ${(file.times ?? []).map((t) => `${t.toFixed(1)} s`).join(', ')}` : '';
    return `- ${file.name}: ${file.kind === 'other' ? 'a file' : file.kind === 'audio' ? 'an audio file' : 'a video file'}${length}, ${where}${frames}.`;
  });
  return `Files the user attached to this message:\n${lines.join('\n')}`;
}
