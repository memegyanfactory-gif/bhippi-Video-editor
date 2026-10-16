// The mark of the program a tool call is running, for the System panel (and later the chat).
//
// Each one is a small inline vector drawn here, in the program's own colours, so it stays sharp at
// 14 to 20 px, works offline and needs no files. They are simplified on purpose: the silhouette and
// the colour are what people recognise at that size. Bhippi's own mark reuses the app's vector.
import { Globe, SquareTerminal } from 'lucide-react';
import type { ReactNode } from 'react';
import { BhippiMark } from '../chat/BhippiMark';
import type { AppId } from '../lib/commandApps';

/** What each app is called, for the accessible name. */
const NAMES: Record<AppId, string> = {
  blender: 'Blender',
  ffmpeg: 'FFmpeg',
  python: 'Python',
  node: 'Node.js',
  powershell: 'PowerShell',
  cmd: 'Command Prompt',
  git: 'Git',
  browser: 'Browser',
  npm: 'npm',
  cargo: 'Cargo',
  'yt-dlp': 'yt-dlp',
  magick: 'ImageMagick',
  whisper: 'Whisper',
  bhippi: 'Bhippi',
  terminal: 'Terminal',
};

/** The artwork on a 24 by 24 grid. */
const art = (app: AppId): ReactNode => {
  switch (app) {
    case 'blender':
      // Orange wing, white ring, blue lens: the Blender silhouette.
      return (
        <>
          <path d="M3.2 14.6c.2-1.7 1-3.1 2.2-4.2l5.4-4.4c1-.8 2.2-1.2 3.4-1.2 1.4 0 2.6.5 3.6 1.4l1.2 1.1H11.6c-.6 0-1.1.2-1.5.6L8.4 9.5H4.7l-1.5 5.1z" fill="#ea7600" />
          <path d="M3 15c.1 1.9 1 3.7 2.6 5 1.6 1.3 3.6 1.9 5.7 1.7 2.1-.2 4-1.1 5.3-2.7 1.3-1.5 1.9-3.4 1.7-5.3-.1-.8-.4-1.5-.7-2.1H9.5L3 15z" fill="#f5792a" />
          <circle cx="12.6" cy="14.4" r="4.7" fill="#fff" />
          <circle cx="12.6" cy="14.4" r="3.2" fill="#265787" />
          <circle cx="12.6" cy="14.4" r="1.7" fill="#8dc2f0" />
        </>
      );
    case 'ffmpeg':
      return (
        <>
          <rect x="2.5" y="2.5" width="19" height="19" rx="4" fill="#0b7a3b" />
          <path d="M6.5 7h11M6.5 12h8M6.5 17h5" stroke="#8be0a7" strokeWidth="2.4" strokeLinecap="round" />
        </>
      );
    case 'python':
      return (
        <>
          <path d="M11.9 2.5c-4.2 0-4 1.8-4 1.8v1.9h4.1v.6H6.2S3 6.5 3 11s2.8 4.3 2.8 4.3h1.7v-2.1s-.1-2.8 2.8-2.8h4.1s2.7 0 2.7-2.6V5s.4-2.5-5.2-2.5zM9.2 4c.5 0 .9.4.9.9s-.4.9-.9.9-.9-.4-.9-.9.4-.9.9-.9z" fill="#3a76a8" />
          <path d="M12.1 21.5c4.2 0 4-1.8 4-1.8v-1.9H12v-.6h5.8s3.2.4 3.2-4.1-2.8-4.3-2.8-4.3h-1.7v2.1s.1 2.8-2.8 2.8H9.600s-2.7 0-2.7 2.600V19s-.4 2.500 5.200 2.500zm2.700-1.500c-.5 0-.9-.4-.9-.9s.4-.9.9-.9.9.4.9.9-.4.9-.9.9z" fill="#ffd43b" />
        </>
      );
    case 'node':
      return (
        <>
          <path d="M12 2l8.500 4.900v10.200L12 22l-8.500-4.900V6.900z" fill="#3c873a" />
          <path d="M14.800 15.300c-.7.600-1.500.800-2.500.800-2 0-3.100-1.200-3.100-3.100 0-2 1.100-3.300 3.200-3.300 1.500 0 2.300.600 2.600 1.800h-1.500c-.2-.4-.5-.6-1.100-.6-1 0-1.500.7-1.500 2 0 1.200.5 1.900 1.500 1.900.6 0 1-.2 1.200-.7h1.200z" fill="#fff" />
        </>
      );
    case 'powershell':
      return (
        <>
          <rect x="2" y="4" width="20" height="16" rx="3" fill="#2671be" />
          <path d="M7 8.500l5 3.500-5 3.500" stroke="#fff" strokeWidth="2.200" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d="M13 16h4.500" stroke="#fff" strokeWidth="2.200" strokeLinecap="round" />
        </>
      );
    case 'git':
      return (
        <>
          <path d="M21.500 11.100L12.900 2.500a1.500 1.500 0 0 0-2.100 0L9 4.300l2.300 2.300a1.800 1.800 0 0 1 2.300 2.300l2.200 2.200a1.800 1.800 0 1 1-1 1l-2-2v5.400a1.800 1.800 0 1 1-1.500 0V9.900a1.800 1.800 0 0 1-1-2.400L8 5.300 2.500 10.800a1.500 1.500 0 0 0 0 2.100l8.600 8.600a1.500 1.500 0 0 0 2.100 0l8.300-8.300a1.500 1.500 0 0 0 0-2.100z" fill="#f05133" />
        </>
      );
    case 'npm':
      return (
        <>
          <rect x="2" y="6" width="20" height="12" rx="1.200" fill="#cb3837" />
          <path d="M4.500 16V8h6.500v8H9.200v-6.300H7.500V16zM12.500 8H20v8h-1.800V9.700h-1.700V16h-1.700V9.700h-2.300z" fill="#fff" />
        </>
      );
    case 'cargo':
      return (
        <>
          <circle cx="12" cy="12" r="6.500" fill="none" stroke="#dea584" strokeWidth="3" strokeDasharray="2.600 1.700" />
          <circle cx="12" cy="12" r="6.800" fill="#c8561c" />
          <circle cx="12" cy="12" r="2.800" fill="#fff4e8" />
        </>
      );
    case 'yt-dlp':
      return (
        <>
          <rect x="2" y="5" width="20" height="14" rx="4" fill="#e02a2a" />
          <path d="M10 9l5 3-5 3z" fill="#fff" />
        </>
      );
    case 'magick':
      return (
        <>
          <path d="M12 2.500l1.900 5.100 5.100 1.900-5.100 1.900L12 16.500l-1.900-5.100L5 9.500l5.100-1.900z" fill="#2b91d0" />
          <path d="M18.500 14.500l.9 2.100 2.100.9-2.100.9-.9 2.100-.9-2.100-2.100-.9 2.100-.9z" fill="#6cc24a" />
        </>
      );
    case 'whisper':
      return (
        <>
          <rect x="2" y="2" width="20" height="20" rx="5" fill="#2b2e36" />
          <path d="M6 10v4M9 7.500v9M12 5v14M15 8.500v7M18 10.500v3" stroke="#e7e9ee" strokeWidth="1.800" strokeLinecap="round" />
        </>
      );
    default:
      return null;
  }
};

/** One app's mark. Browser, Command Prompt and Terminal use a plain line glyph; Bhippi uses the app's own mark. */
export function AppLogo({ app, size = 16, className }: { app: AppId; size?: number; className?: string }) {
  const label = NAMES[app];
  const cls = `app-logo${className ? ` ${className}` : ''}`;
  if (app === 'bhippi') {
    return (
      <span className={cls} style={{ width: size, height: size }} role="img" aria-label={label}>
        <BhippiMark size={size} />
      </span>
    );
  }
  if (app === 'browser' || app === 'cmd' || app === 'terminal') {
    const Glyph = app === 'browser' ? Globe : SquareTerminal;
    return (
      <span className={cls} style={{ width: size, height: size }} role="img" aria-label={label}>
        <Glyph size={size} strokeWidth={1.8} aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className={cls} style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">{art(app)}</svg>
    </span>
  );
}
