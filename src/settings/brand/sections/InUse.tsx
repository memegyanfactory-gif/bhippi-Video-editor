// "Brand in use": the kit's tokens worn by the things a brand actually ships — thumbnails, banners,
// vertical video, posts, an end screen, a lower third and a title slide. Every mockup is live: change
// a colour, a font or the logo and they all follow.

import type { CSSProperties, ReactNode } from 'react';
import { fontStack, type BrandKit } from '../../../lib/brandKit';
import { onColor } from '../../../lib/brandKit/studio';
import { SAMPLE_FRAMES } from '../helpers';
import { LogoMark, Scaled, faceStyle, tokenHex, useKitVars } from '../shared';

const [F_PORTRAIT, F_SCENE, F_FUN] = SAMPLE_FRAMES;
const photo = (src: string, shade = 0.35): CSSProperties => ({ backgroundImage: `linear-gradient(rgba(0,0,0,${shade}), rgba(0,0,0,${shade})), url(${src})`, backgroundSize: 'cover', backgroundPosition: 'center' });

/** The last word of a line in the accent colour. */
function Accented({ text, accent }: { text: string; accent: string }) {
  const words = text.trim().split(/\s+/);
  const last = words.pop() ?? '';
  return <>{words.join(' ')}{words.length ? ' ' : ''}<span style={{ color: accent }}>{last}</span></>;
}

/** The logo on a plate, so a mark that matches the field still reads. */
function Plate({ kit, height, bg }: { kit: BrandKit; height: number; bg: string }) {
  return <span style={{ display: 'inline-flex', padding: height * 0.34, borderRadius: height * 0.5, background: bg, boxShadow: '0 12px 40px #0006' }}><LogoMark kit={kit} height={height} /></span>;
}

function Mock({ title, size, span, children, w, h, className }: { title: string; size: string; span: number; w: number; h: number; children: ReactNode; className?: string }) {
  return (
    <figure className={`bs-mock span-${span} ${className ?? ''}`}>
      <Scaled w={w} h={h} className="bs-mock-stage">{children}</Scaled>
      <figcaption><b>{title}</b><span>{size}</span></figcaption>
    </figure>
  );
}

export function InUseBoard({ kit }: { kit: BrandKit }) {
  const vars = useKitVars(kit);
  const bg = tokenHex(kit, 'background', '#101114');
  const surface = tokenHex(kit, 'surface', '#1b1d22');
  const fg = tokenHex(kit, 'text', '#ffffff');
  const muted = tokenHex(kit, 'muted', '#9aa0aa');
  const primary = tokenHex(kit, 'primary', '#2d8ceb');
  const accent = tokenHex(kit, 'accent', '#ff5d5d');
  const grad = kit.colors.gradients[0];
  const brandGrad = grad ? `linear-gradient(${grad.angle}deg, ${grad.stops.join(', ')})` : `linear-gradient(135deg, ${primary}, ${bg})`;
  const display = faceStyle(kit.typography.display);
  const heading = faceStyle(kit.typography.heading);
  const body = { fontFamily: fontStack(kit.typography.body), fontWeight: kit.typography.body.weight } as CSSProperties;
  const caption = faceStyle(kit.typography.caption);
  const headline = kit.tagline || 'Made to be remembered';
  const handle = `@${kit.name.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'brand'}`;
  const radius = Math.round(kit.layout.radius * 1080);
  const sample = kit.voiceGuide.samples[0] ?? headline;
  const lt = kit.layout.lowerThird;
  const bug = kit.layout.logoBug;
  const bugPos = (m: number): CSSProperties => (bug === 'center' ? { top: '50%', left: '50%', transform: 'translate(-50%,-50%)' } : { [bug.startsWith('top') ? 'top' : 'bottom']: m, [bug.endsWith('left') ? 'left' : 'right']: m });
  const btn = { background: accent, color: onColor(accent), borderRadius: radius * 0.7 + 8 } as CSSProperties;

  return (
    <div className="bs-mocks" style={vars}>
      {/* YouTube thumbnail */}
      <Mock title="YouTube thumbnail" size="1280 × 720" span={6} w={1280} h={720}>
        <div className="bsm" style={{ ...photo(F_SCENE, 0.15) }}>
          <div className="bsm-fill" style={{ background: `linear-gradient(90deg, ${bg}f2 0%, ${bg}b8 46%, transparent 78%)` }} />
          <div className="bsm-abs" style={{ left: 72, top: 70 }}><LogoMark kit={kit} height={64} /></div>
          <div className="bsm-abs" style={{ left: 72, top: 200, width: 700, color: fg, fontSize: headline.length > 26 ? 84 : 104, lineHeight: 1, ...display }}><Accented text={headline} accent={accent} /></div>
          <div className="bsm-abs" style={{ left: 72, bottom: 72, ...btn, padding: '14px 30px', fontSize: 34, ...heading, textTransform: 'uppercase' }}>Watch now</div>
          <div className="bsm-abs" style={{ right: 28, bottom: 24, background: '#000c', color: '#fff', padding: '4px 12px', borderRadius: 8, fontSize: 28, ...body }}>12:04</div>
        </div>
      </Mock>

      {/* lower third over a video frame */}
      <Mock title="Lower third" size="1920 × 1080" span={6} w={1920} h={1080}>
        <div className="bsm" style={photo(F_PORTRAIT, 0.1)}>
          <div className="bsm-abs" style={{ ...bugPos(kit.layout.safeMargin * 1080), }}><LogoMark kit={kit} height={64} /></div>
          <div className="bsm-abs bsm-lt" style={{ bottom: kit.layout.safeMargin * 1080 + (bug.startsWith('bottom') ? 150 : 40), ...(lt === 'bottom-left' ? { left: kit.layout.safeMargin * 1080 } : lt === 'bottom-right' ? { right: kit.layout.safeMargin * 1080 } : { left: '50%', transform: 'translateX(-50%)' }), background: surface, color: fg, borderRadius: radius, boxShadow: '0 20px 60px #0008' }}>
            <i style={{ background: accent }} />
            <div><b style={{ fontSize: 56, lineHeight: 1.05, display: 'block', ...heading }}>{kit.name}</b><span style={{ fontSize: 32, color: muted, ...body }}>{kit.tagline || kit.industry || 'Brand in use'}</span></div>
          </div>
        </div>
      </Mock>

      {/* channel banner */}
      <Mock title="Channel banner" size="2048 × 338" span={12} w={2048} h={338}>
        <div className="bsm" style={{ background: brandGrad }}>
          <div className="bsm-fill" style={{ background: `radial-gradient(60% 140% at 85% 0%, ${accent}55, transparent 70%)` }} />
          <div className="bsm-abs" style={{ left: 300, top: 0, bottom: 0, display: 'flex', alignItems: 'center', gap: 56 }}>
            <Plate kit={kit} height={110} bg={surface} />
            <div>
              <div style={{ fontSize: 108, lineHeight: 1, ...display, color: fg }}>{kit.name}</div>
              <div style={{ fontSize: 40, marginTop: 14, opacity: 0.85, color: fg, ...body }}>{headline}</div>
            </div>
          </div>
          <div className="bsm-abs" style={{ right: 300, bottom: 36, color: fg, fontSize: 34, opacity: 0.75, ...caption }}>{handle}</div>
        </div>
      </Mock>

      {/* Shorts / Reels */}
      <Mock title="Shorts and Reels" size="1080 × 1920" span={3} w={1080} h={1920}>
        <div className="bsm" style={photo(F_PORTRAIT, 0.22)}>
          <div className="bsm-abs" style={{ ...bugPos(kit.layout.safeMargin * 1080 + 40), top: bug.startsWith('top') ? 150 : undefined }}><LogoMark kit={kit} height={76} /></div>
          <div className="bsm-abs bsm-rail">{[0, 1, 2].map((i) => <i key={i} />)}</div>
          <div className="bsm-abs" style={{ left: 60, right: 190, bottom: 330, color: '#fff', fontSize: 78, lineHeight: 1.12, textShadow: '0 4px 24px #000a', ...caption, textTransform: kit.typography.caption.transform }}>
            <Accented text={sample.length > 44 ? sample.slice(0, 44) : sample} accent={accent} />
          </div>
          <div className="bsm-abs" style={{ left: 60, bottom: 200, color: '#fff', fontSize: 38, ...body }}>{handle}</div>
          <div className="bsm-abs" style={{ left: 60, right: 60, bottom: 130, height: 6, borderRadius: 3, background: '#fff4' }}><i style={{ display: 'block', width: '38%', height: '100%', borderRadius: 3, background: accent }} /></div>
        </div>
      </Mock>

      {/* Instagram story */}
      <Mock title="Instagram story" size="1080 × 1920" span={3} w={1080} h={1920}>
        <div className="bsm" style={{ background: brandGrad }}>
          <div className="bsm-fill" style={{ ...photo(F_FUN, 0), opacity: 0.0 }} />
          <div className="bsm-abs" style={{ left: 0, right: 0, top: 170, display: 'flex', justifyContent: 'center' }}><Plate kit={kit} height={80} bg={surface} /></div>
          <div className="bsm-abs" style={{ left: 80, right: 80, top: 600, color: fg, fontSize: 116, lineHeight: 1, textAlign: 'center', ...display }}><Accented text={headline} accent={accent} /></div>
          <div className="bsm-abs bsm-sticker" style={{ left: 120, right: 120, bottom: 360, background: surface, color: fg, borderRadius: radius + 20 }}>
            <b style={{ ...heading, fontSize: 48 }}>What should we make next?</b>
            <div><span style={{ background: primary, color: onColor(primary) }}>Yes please</span><span style={{ background: bg, color: fg }}>Surprise me</span></div>
          </div>
        </div>
      </Mock>

      {/* Instagram post */}
      <Mock title="Instagram post" size="1080 × 1080" span={3} w={1080} h={1080}>
        <div className="bsm" style={{ background: surface }}>
          <div className="bsm-abs" style={{ left: 0, right: 0, top: 0, height: 640, ...photo(F_FUN, 0.05) }} />
          <div className="bsm-abs" style={{ left: 60, top: 60 }}><LogoMark kit={kit} height={64} /></div>
          <div className="bsm-abs" style={{ left: 60, right: 60, top: 690, color: fg, fontSize: 84, lineHeight: 1.02, ...display }}><Accented text={headline} accent={accent} /></div>
          <div className="bsm-abs" style={{ left: 60, bottom: 60, color: muted, fontSize: 34, ...body }}>{handle} · {kit.industry || 'brand'}</div>
          <div className="bsm-abs" style={{ right: 60, bottom: 50, padding: '12px 28px', fontSize: 32, ...btn, ...heading }}>Learn more</div>
        </div>
      </Mock>

      {/* profile */}
      <Mock title="Social profile" size="avatar + bio" span={3} w={1080} h={1080}>
        <div className="bsm" style={{ background: bg, color: fg }}>
          <div className="bsm-abs" style={{ left: 0, right: 0, top: 0, height: 330, background: brandGrad }} />
          <div className="bsm-abs bsm-avatar" style={{ left: 70, top: 215, background: bg, border: `10px solid ${bg}` }}><div style={{ background: surface }}><LogoMark kit={kit} height={70} /></div></div>
          <div className="bsm-abs" style={{ left: 70, top: 540, fontSize: 84, ...display }}>{kit.name}</div>
          <div className="bsm-abs" style={{ left: 70, top: 650, fontSize: 36, color: muted, ...body }}>{handle}</div>
          <div className="bsm-abs" style={{ left: 70, right: 70, top: 730, fontSize: 40, lineHeight: 1.35, ...body }}>{sample.length > 110 ? `${sample.slice(0, 110)}…` : sample}</div>
          <div className="bsm-abs" style={{ left: 70, bottom: 70, padding: '16px 44px', fontSize: 38, ...btn, ...heading }}>Follow</div>
        </div>
      </Mock>

      {/* end screen */}
      <Mock title="End screen" size="1920 × 1080" span={6} w={1920} h={1080}>
        <div className="bsm" style={{ background: brandGrad }}>
          <div className="bsm-fill" style={{ background: `linear-gradient(90deg, ${bg}e6, ${bg}40)` }} />
          <div className="bsm-abs" style={{ left: 120, top: 150, width: 900, display: 'flex', flexDirection: 'column', gap: 30, alignItems: 'flex-start', color: fg }}>
            <LogoMark kit={kit} height={110} />
            <div style={{ fontSize: 96, lineHeight: 1, ...display }}><Accented text={headline} accent={accent} /></div>
            <div style={{ ...btn, padding: '18px 52px', fontSize: 44, ...heading }}>Subscribe</div>
          </div>
          <div className="bsm-abs bsm-end" style={{ right: 100, top: 170, ...photo(F_SCENE, 0.15), borderRadius: radius }}><span style={{ background: surface, color: fg, ...heading }}>Watch next</span></div>
          <div className="bsm-abs bsm-end" style={{ right: 100, top: 610, ...photo(F_FUN, 0.15), borderRadius: radius }}><span style={{ background: surface, color: fg, ...heading }}>Latest</span></div>
        </div>
      </Mock>

      {/* title slide */}
      <Mock title="Presentation title slide" size="1920 × 1080" span={6} w={1920} h={1080}>
        <div className="bsm" style={{ background: bg, color: fg }}>
          <div className="bsm-abs" style={{ right: 0, top: 0, bottom: 0, width: 560, background: brandGrad }} />
          <div className="bsm-abs" style={{ left: 140, top: 330, width: 1060, fontSize: 150, lineHeight: 0.98, ...display }}><Accented text={kit.name} accent={accent} /></div>
          <div className="bsm-abs" style={{ left: 140, top: 330 + 330, height: 8, width: 160, background: accent, borderRadius: 4 }} />
          <div className="bsm-abs" style={{ left: 140, top: 720, width: 1000, fontSize: 52, lineHeight: 1.3, color: muted, ...body }}>{headline}</div>
          <div className="bsm-abs" style={{ left: 140, bottom: 100 }}><LogoMark kit={kit} height={64} /></div>
          <div className="bsm-abs" style={{ right: 100, bottom: 100, fontSize: 36, color: fg, opacity: 0.8, ...caption }}>01</div>
        </div>
      </Mock>
    </div>
  );
}
