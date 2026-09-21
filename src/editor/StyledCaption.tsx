// WatchFIWN caption styles in the preview. Every number here mirrors src-tauri/src/caption_styles.rs
// so the exported caption matches what the editor shows: sizes are fractions of the frame height
// (`--h`), boxes pad by 0.32em, highlight chips by 0.16em, and animations run per word or letter
// with the style's stagger.
import type { CSSProperties } from 'react';
import { baseFill, type CaptionStyle, type WordState } from '../lib/captionStyles';
import { rbEntrance } from '../lib/reactbits';

const HEAVY = ['Segoe UI Black', 'Arial Black', 'Impact'];

function fontWeight(style: CaptionStyle) {
  if (HEAVY.includes(style.font)) return 400;
  return style.weight >= 600 ? 700 : 400;
}

/** Negative delays on paused animations show exactly the frame for the current time. */
function entrance(style: CaptionStyle, delay: number): CSSProperties {
  if (style.anim.preset === 'none') return {};
  return {
    animationName: `cap-${style.anim.preset}`,
    animationDuration: `${Math.max(0.05, style.anim.duration)}s`,
    animationDelay: `${delay}s`,
    animationPlayState: 'paused',
    animationFillMode: 'both',
    animationTimingFunction: 'cubic-bezier(.2,.9,.3,1)',
  };
}

type Props = {
  style: CaptionStyle;
  words: WordState[];
  /** Seconds since the caption started, or null for a still sample. */
  elapsed: number | null;
  /** Optional React-Bits motion id (`rb-scramble`): overrides the style entrance. */
  motionId?: string | null;
};

/** The caption's text block. The parent sets `--h` (frame height in px) and positions it. */
export function StyledCaptionText({ style, words, elapsed, motionId }: Props) {
  const fill = baseFill(style);
  const fontSize = `calc(var(--h) * ${style.size / 100})`;
  const stroke = style.outline ? `calc(var(--h) * ${(style.size / 100) * 0.05 * style.outlineWidth} * 2)` : '0px';
  const shadows: string[] = [];
  if (style.glow) {
    const glow = `calc(var(--h) * ${(style.glowSize / 1080) * 0.6})`;
    shadows.push(`0 0 ${glow} ${style.glow}`, `0 0 calc(${glow} * 0.5) ${style.glow}`);
  }
  if (style.shadow) shadows.push(`calc(${fontSize} * 0.06) calc(${fontSize} * 0.06) 0 rgba(0,0,0,0.44)`);
  const letterUnit = style.anim.unit === 'letter';
  let unit = 0;
  const intensity = Math.min(2, Math.max(0.3, style.anim.intensity));

  return (
    <div
      className="cap-block"
      style={{
        fontFamily: `"${style.font}", "Segoe UI", sans-serif`,
        fontWeight: fontWeight(style),
        fontStyle: style.italic ? 'italic' : 'normal',
        fontSize,
        lineHeight: 1.18,
        color: fill,
        textShadow: shadows.join(', ') || undefined,
        maxWidth: `${style.maxWidth * 100}%`,
        ['--stroke' as string]: stroke,
        ['--outline' as string]: style.outline ?? 'transparent',
        ['--int' as string]: intensity,
        ['--fs' as string]: fontSize,
      }}
    >
      <span className={`cap-line${style.background ? ' boxed' : ''}`} style={style.background ? { background: style.background } : undefined}>
        {words.map((word) => {
          let color = style.wordAlt && word.index % 2 === 1 && style.color2 ? style.color2 : fill;
          if (word.lit && style.highlight) color = style.highlight;
          const chip = word.active && style.highlightBox && style.highlightText;
          if (chip) color = style.highlightText ?? color;
          const scale = word.active ? style.highlightScale * (style.pop ? 1.12 : 1) : 1;
          const units = letterUnit ? [...word.text] : [word.text];
          return (
            <span key={word.index}>
              {word.index > 0 ? ' ' : ''}
              <span
                className={`cap-word${chip ? ' chip' : ''}`}
                style={{
                  color,
                  transform: scale !== 1 ? `scale(${scale})` : undefined,
                  background: chip ? style.highlightBox ?? undefined : undefined,
                  fontFamily: word.active && style.highlightFont ? `"${style.highlightFont}", cursive` : undefined,
                  fontStyle: word.active && (style.highlightItalic || style.highlightFont) ? 'italic' : undefined,
                }}
              >
                {units.map((piece, index) => {
                  const delay = elapsed === null ? -10 : unit * style.anim.stagger - elapsed;
                  unit++;
                  // A React-Bits motion id replaces the catalogue entrance but keeps the
                  // same stagger/duration contract, so scrubbing stays exact and export
                  // still degrades to the motion's libass base (see reactbits.ts).
                  const unitStyle = motionId ? rbEntrance(motionId, delay, style.anim.duration, style.anim.intensity) : entrance(style, delay);
                  return (
                    <span key={index} className="cap-unit" style={unitStyle}>
                      {piece}
                    </span>
                  );
                })}
              </span>
            </span>
          );
        })}
      </span>
    </div>
  );
}
