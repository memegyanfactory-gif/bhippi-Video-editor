/** Provider marks are inline vectors so they stay sharp at every DPI and work offline.
    Adapted from the Bhippi desktop app's ProviderLogo. */

import { FALLBACK_MARKS, VECTOR_MARKS } from "../lib/providerMarks";

type LogoProps = { id: string; size?: number; transparent?: boolean; className?: string };

export function ProviderLogo({ id, size = 20, transparent = false, className }: LogoProps) {
  const normalized = id.toLowerCase();

  // 1. Google Antigravity (Official gradient arch)
  if (normalized === "antigravity" || normalized === "agy") {
    const bg = transparent ? "transparent" : "#0B0E14";
    return (
      <span
        className={`provider-logo provider-logo-vector${className ? ` ${className}` : ""}`}
        style={{ width: size, height: size, background: bg }}
        aria-hidden="true"
        title="Google Antigravity"
      >
        <svg viewBox="10 14 92 84" focusable="false" style={{ width: "100%", height: "100%" }}>
          <defs>
            <linearGradient id="agy-arch-grad" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#2563EB" />
              <stop offset="30%" stopColor="#3B82F6" />
              <stop offset="52%" stopColor="#10B981" />
              <stop offset="75%" stopColor="#F59E0B" />
              <stop offset="90%" stopColor="#EA4335" />
              <stop offset="100%" stopColor="#9333EA" />
            </linearGradient>
          </defs>
          <path
            d="M89.7 93.7C94.4 97.2 101.4 94.9 94.9 88.4C75.7 69.8 79.8 18.4 55.9 18.4C31.9 18.4 36 69.8 16.8 88.4C9.8 95.4 17.4 97.2 22 93.7C40.1 81.4 38.9 59.9 55.9 59.9C72.8 59.9 71.6 81.4 89.7 93.7Z"
            fill="url(#agy-arch-grad)"
          />
        </svg>
      </span>
    );
  }

  // Bhippi itself: the app's own mark (public/bhippi.png), the orange ring and B on a dark tile.
  if (normalized === "bhippi") {
    return (
      <span
        className={`provider-logo provider-logo-vector${className ? ` ${className}` : ""}`}
        style={{ width: size, height: size, background: transparent ? "transparent" : "#16161b" }}
        aria-hidden="true"
        title="Bhippi"
      >
        <img src="/bhippi.png" alt="" style={{ width: "72%", height: "72%" }} />
      </span>
    );
  }

  // 2. OpenCode (Exact screenshot design: white wireframe window + blue 'OP' badge)
  if (normalized === "opencode" || normalized === "opencode-zen") {
    const bg = transparent ? "transparent" : "#0C0D0F";
    return (
      <span
        className={`provider-logo provider-logo-vector${className ? ` ${className}` : ""}`}
        style={{ width: size, height: size, background: bg }}
        aria-hidden="true"
        title="OpenCode"
      >
        <svg viewBox="0 0 24 24" focusable="false" style={{ width: "100%", height: "100%" }}>
          <rect x="2" y="3" width="14" height="14" rx="2.5" stroke="#FFFFFF" strokeWidth="2" fill="none" />
          <rect x="9" y="9.5" width="13.5" height="12" rx="2.5" fill="#2563EB" />
          <text
            x="15.75"
            y="18.6"
            fill="#FFFFFF"
            fontSize="8"
            fontWeight="800"
            fontFamily="system-ui, -apple-system, sans-serif"
            textAnchor="middle"
          >
            OP
          </text>
        </svg>
      </span>
    );
  }

  const vector = VECTOR_MARKS[normalized] ?? VECTOR_MARKS[id];
  if (vector) {
    const isClaude = normalized === "claude" || normalized === "anthropic";
    const bg = transparent ? "transparent" : vector.bg;
    const fg = transparent && isClaude ? "#D97757" : vector.fg;

    return (
      <span
        className={`provider-logo provider-logo-vector${className ? ` ${className}` : ""}`}
        style={{ width: size, height: size, background: bg, color: fg }}
        aria-hidden="true"
      >
        <svg viewBox={vector.viewBox ?? "0 0 24 24"} focusable="false">
          {vector.paths.map((path) => (
            <path key={path} d={path} fill="currentColor" />
          ))}
        </svg>
      </span>
    );
  }

  const mark = FALLBACK_MARKS[normalized] ?? FALLBACK_MARKS[id] ?? { bg: "#262320", fg: "#9A938A", glyph: "?" };
  return (
    <span
      className={`provider-logo${className ? ` ${className}` : ""}`}
      style={{
        width: size,
        height: size,
        background: transparent ? "transparent" : mark.bg,
        color: mark.fg,
        fontSize: Math.round(size * 0.52),
      }}
      aria-hidden="true"
    >
      {mark.glyph}
    </span>
  );
}
