import { brandKitTheme, fontStack, logoMarkup, type BrandKit } from '../../lib/brandKit';
import { flattenLogo } from './helpers';

/** A small static picture of a kit: field, logo or monogram, name in the display face, swatches. */
export function KitThumb({ kit }: { kit: BrandKit }) {
  const theme = brandKitTheme(kit);
  const primary = kit.colors.tokens.find((t) => t.role === 'primary')?.hex ?? theme.accent;
  const display = kit.typography.display;
  return (
    <div className="bk-thumb" style={{ background: `linear-gradient(160deg, ${theme.bg}, ${theme.card})`, color: theme.fg, ['--bk-primary' as string]: primary, ['--accent' as string]: theme.accent, ['--bk-display' as string]: fontStack(display) }}>
      <div className="bk-thumb-top">
        <span className="bk-thumb-logo" dangerouslySetInnerHTML={{ __html: flattenLogo(logoMarkup(kit, 'any', 22)) }} />
        <span className="bk-thumb-name" style={{ fontFamily: fontStack(display), fontWeight: display.weight, letterSpacing: display.letterSpacing, textTransform: display.transform }}>{kit.name}</span>
      </div>
      <div className="bk-thumb-swatches">{kit.colors.tokens.slice(0, 7).map((t, i) => <i key={`${t.name}-${i}`} style={{ background: t.hex }} title={`${t.name} ${t.hex}`} />)}</div>
    </div>
  );
}
