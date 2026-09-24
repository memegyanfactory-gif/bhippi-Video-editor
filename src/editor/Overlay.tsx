// Text graphics drawn over the program monitor. Sizes are fractions of the frame and the motion
// mirrors src-tauri/src/subtitles.rs and caption_styles.rs, so the preview matches the export.
//
// Animations are always paused and driven by delays computed from the playhead: scrubbing and
// playback then show exactly the frame for that moment. The fade-out lives on a wrapper so it
// never fights the entrance animation over the same property.
import type { CSSProperties, ReactNode } from 'react';
import { findStyle, wordStates } from '../lib/captionStyles';
import { findRbCard, parseRbStyle, rbEntrance } from '../lib/reactbits';
import type { Graphic } from '../lib/types';
import { StyledCaptionText } from './StyledCaption';

const FADE = 0.16;

const paused = (delay: number, duration: number): CSSProperties => ({
  animationDelay: `${delay}s`,
  animationDuration: `${duration}s`,
  animationPlayState: 'paused',
});

function Frame({ graphic, elapsed, placement, fade = FADE, children }: { graphic: Graphic; elapsed: number; placement: string; fade?: number; children: ReactNode }) {
  return (
    <div className={`ov ${placement}`} style={paused(graphic.duration - fade - elapsed, fade)}>
      {children}
    </div>
  );
}

/**
 * The point a text clip's transform scales and turns about, as a CSS `transform-origin` on the
 * full-frame layer: its preset's anchor, as the export places it (render/text.rs `anchor`,
 * caption_styles.rs `\an5\pos`, subtitles.rs lower thirds) — the frame's centre for titles and
 * kinetic lines, the style's line for a styled caption, 9 % above the bottom for a plain caption,
 * the panel's corner for a lower third. Scaled about the frame's centre instead, an 80 % styled
 * caption drifted ~55 px up the monitor from where the export put it.
 */
export function textAnchor(preset: Graphic['preset'], style: string | null): string {
  if (preset === 'caption') {
    const styled = findStyle(parseRbStyle(style).base ?? style ?? undefined);
    return styled ? `50% ${styled.posY}%` : '50% 91%';
  }
  if (preset === 'lower-third') return '6% 88%';
  return '50% 50%';
}

/** One text clip at `time` (the stage sets `--short` and `--h`). */
export function TextLayer({ graphic, time }: { graphic: Graphic; time: number }) {
  const elapsed = time - graphic.start;
  const subtitle = graphic.subtitle ? <div className="ov-sub">{graphic.subtitle}</div> : null;
  // The style field may carry a React-Bits motion suffix ("Hormozi+rb-scramble")
  // or a bare motion/card id ("rb-decrypted", "rb-spotlight-card") for any preset.
  const { base, motionId } = parseRbStyle(graphic.style);
  const card = findRbCard(graphic.style);
  const cardClass = card ? ` rb-card rb-card-${card.treatment}` : '';
  const captionStyle = graphic.preset === 'caption' ? findStyle(base ?? graphic.style) : undefined;
  if (captionStyle) {
    return (
      <Frame graphic={graphic} elapsed={elapsed} placement="ov-styled" fade={0.14}>
        <div className="cap-anchor" style={{ top: `${captionStyle.posY}%` }}>
          <StyledCaptionText style={captionStyle} words={wordStates(graphic, captionStyle, time)} elapsed={elapsed} motionId={motionId} />
        </div>
      </Frame>
    );
  }
  // Word-level entrance shared by the plain presets: the catalogue animation by
  // default, the React-Bits motion when one is named. Paused + negative delay,
  // so playback and scrubbing show exactly the frame for the moment.
  const wordEntrance = (index: number, step: number, duration: number): CSSProperties =>
    motionId ? rbEntrance(motionId, index * step - elapsed, duration) : paused(index * step - elapsed, duration);
  switch (graphic.preset) {
    case 'title':
      return (
        <Frame graphic={graphic} elapsed={elapsed} placement="ov-center">
          <div className={`ov-title${cardClass}`} style={{ color: graphic.color, ...wordEntrance(0, 0, 0.24) }}>
            {graphic.text}
            {subtitle}
          </div>
        </Frame>
      );
    case 'caption':
      return (
        <Frame graphic={graphic} elapsed={elapsed} placement="ov-bottom">
          <div className={`ov-caption${cardClass}`} style={wordEntrance(0, 0, FADE)}>
            {graphic.text}
            {subtitle}
          </div>
        </Frame>
      );
    case 'lower-third':
      return (
        <Frame graphic={graphic} elapsed={elapsed} placement="ov-lower">
          <div className={`ov-lower-third${cardClass}`} style={{ ...wordEntrance(0, 0, 0.32), ['--accent' as string]: graphic.color }}>
            <div className="ov-lower-name">{graphic.text}</div>
            {subtitle}
          </div>
        </Frame>
      );
    case 'kinetic': {
      const words = graphic.text.split(/\s+/).filter(Boolean);
      const step = (Math.max(0.2, graphic.duration) * 0.6) / Math.max(1, words.length);
      return (
        <Frame graphic={graphic} elapsed={elapsed} placement="ov-center">
          <div className={`ov-kinetic${cardClass}`} style={{ color: graphic.color }}>
            <div className="ov-words">
              {words.map((word, index) => (
                <span key={`${word}-${index}`} className="ov-word" style={wordEntrance(index, step, 0.18)}>
                  {word}
                </span>
              ))}
            </div>
            {subtitle}
          </div>
        </Frame>
      );
    }
  }
}

export function Overlay({ graphics, time }: { graphics: Graphic[]; time: number }) {
  const active = graphics.filter((graphic) => time >= graphic.start && time < graphic.start + graphic.duration);
  return (
    <div className="overlay" aria-hidden="true">
      {active.map((graphic) => (
        <TextLayer key={graphic.id} graphic={graphic} time={time} />
      ))}
    </div>
  );
}
