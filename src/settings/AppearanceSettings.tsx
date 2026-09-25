// Settings › Appearance: the theme picker and, when Glass is on, what shows through it — a
// gradient preset, one of six pictures or the user's own — with tint, blur and pane opacity.
// Surface only: none of it changes what Bhippi does. The look itself is painted by lib/theme.ts.
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Check, ImagePlus, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Toggle, useToast } from '../components/ui';
import { api, errorText } from '../lib/ipc';
import { applyTheme, glassBackdrop, glassImageUrl, glassMesh, GLASS_DEFAULTS, GLASS_GRADIENTS, GLASS_IMAGES, GLASS_TINTS, resolveGlass, resolveMotion, resolveTheme, THEMES } from '../lib/theme';
import type { GlassPrefs, Settings } from '../lib/types';
import { Row, Section, SettingsHeader, Slider } from './SettingsLayout';

type Props = { settings: Settings; onSettings: (settings: Settings) => void };

export function AppearanceSettings({ settings, onSettings }: Props) {
  const current = resolveTheme(settings);
  const [glass, setGlass] = useState(() => resolveGlass(settings));

  return (
    <div className="appearance-settings">
      <SettingsHeader title="Appearance">Surface only — the theme changes how Bhippi looks, never what it does.</SettingsHeader>

      <section className="set-section">
        <div className="set-section-head"><h4 className="set-section-title">Theme</h4></div>
        <div className="theme-grid" role="radiogroup" aria-label="Color theme">
          {THEMES.map((theme) => {
            const selected = current === theme.id;
            const p = theme.preview;
            const bg = theme.id === 'glass' ? glassBackdrop(glass, true) : p.bg;
            const vars = { '--m-bg': bg, '--m-chrome': p.chrome, '--m-slab': p.slab, '--m-panel': p.panel, '--m-edge': p.edge, '--m-accent': p.accent, '--m-text': p.text } as CSSProperties;
            return (
              <label key={theme.id} className={`theme-tile${selected ? ' selected' : ''}`}>
                <input type="radio" name="theme" checked={selected} onChange={() => onSettings({ ...settings, theme: theme.id })} />
                <span className={`theme-mini ${theme.kind}`} style={vars} aria-hidden="true">
                  <span className="theme-mini-bar"><i /><i /><i /></span>
                  <span className="theme-mini-chat"><i /><i /><i /></span>
                  <span className="theme-mini-slab"><span className="theme-mini-pane" /><span className="theme-mini-pane track"><i /><i /></span></span>
                </span>
                {selected && <span className="theme-tile-check"><Check size={12} strokeWidth={3} /></span>}
                <span className="theme-tile-copy">
                  <span className="theme-tile-head"><span className="theme-tile-name">{theme.name}</span><span className={`theme-tile-kind kind-${theme.kind}`}>{theme.kind}</span></span>
                  <span className="theme-tile-detail">{theme.detail}</span>
                </span>
              </label>
            );
          })}
        </div>
      </section>

      {THEMES.find((theme) => theme.id === current)?.kind !== 'solid' && (
        <Section title="Motion">
          <Row title="Animated background" hint={current === 'glass' && glass.source !== 'gradient' ? 'Gradient backgrounds drift and glow slowly. Pictures stay still.' : 'The gradient drifts and glows slowly behind the panes. Turn it off for a still background.'}>
            <Toggle checked={resolveMotion(settings)} onChange={(on) => onSettings({ ...settings, appearance: { ...settings.appearance, motion: on } })} label="Animated background" />
          </Row>
        </Section>
      )}

      {current === 'glass'
        ? <GlassOptions glass={glass} onGlass={setGlass} settings={settings} onSettings={onSettings} />
        : <p className="set-note">Pick <strong>Glass</strong> to choose its background — gradients, pictures or your own image — and set its tint, blur and opacity.</p>}
    </div>
  );
}

function GlassOptions({ glass, onGlass, settings, onSettings }: Props & { glass: GlassPrefs; onGlass: (glass: GlassPrefs) => void }) {
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  // Sliders repaint the window on every step but save once the hand stops; the latest settings
  // are read at save time so a save never puts back a value changed elsewhere meanwhile.
  const latest = useRef(settings);
  latest.current = settings;
  const pending = useRef<GlassPrefs | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const frame = useRef(0);

  const flush = () => {
    window.clearTimeout(timer.current);
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    const next = pending.current;
    if (next) applyTheme('glass', next, resolveMotion(latest.current));
    pending.current = null;
    if (next) onSettings({ ...latest.current, appearance: { ...latest.current.appearance, glass: next } });
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);

  /** Shows a change at once (painted on the next frame, however many steps arrive before it). */
  const preview = (patch: Partial<GlassPrefs>) => {
    const next = { ...(pending.current ?? glass), ...patch };
    onGlass(next);
    pending.current = next;
    if (!frame.current) {
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        if (pending.current) applyTheme('glass', pending.current, resolveMotion(latest.current));
      });
    }
    // A slider saves when it is let go; this is the safety net if that never arrives.
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => flushRef.current(), 1500);
  };
  /** A click choice: shown and saved straight away. */
  const update = (patch: Partial<GlassPrefs>) => {
    preview(patch);
    flushRef.current();
  };
  const commit = () => flushRef.current();

  const upload = async () => {
    const picked = await openDialog({ title: 'Choose a background image', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }] });
    if (typeof picked !== 'string') return;
    setUploading(true);
    try {
      const copy = await api.appearanceImageImport(picked);
      update({ source: 'custom', customImage: copy });
    } catch (error) {
      toast({ tone: 'error', title: 'Could not use that image', body: errorText(error) });
    } finally {
      setUploading(false);
    }
  };

  const imageMode = glass.source !== 'gradient';

  return (
    <Section title="Glass" actions={<button type="button" className="btn btn-ghost btn-small" onClick={() => update({ ...GLASS_DEFAULTS, customImage: glass.customImage })}><RotateCcw size={12} /> Reset</button>}>
      <Row stack title="Background" hint={imageMode ? 'A picture behind the panes. Blur and tint below keep it from competing with your footage.' : 'A colour mesh behind the panes; each one brings its own accent colour.'}>
        <div className="segmented" role="tablist" aria-label="Background type">
          <button type="button" role="tab" aria-selected={!imageMode} className={!imageMode ? 'active' : ''} onClick={() => update({ source: 'gradient' })}>Gradients</button>
          <button type="button" role="tab" aria-selected={imageMode} className={imageMode ? 'active' : ''} onClick={() => imageMode || update({ source: glass.customImage ? 'custom' : 'image' })}>Images</button>
        </div>
      </Row>
      <div className="glass-picks" role="radiogroup" aria-label={imageMode ? 'Background image' : 'Background gradient'}>
        {!imageMode && GLASS_GRADIENTS.map((item) => (
          <GlassPick key={item.id} name={item.name} selected={glass.gradient === item.id} background={glassMesh(item, true)} onPick={() => update({ source: 'gradient', gradient: item.id })} />
        ))}
        {imageMode && GLASS_IMAGES.map((item) => (
          <GlassPick key={item.id} name={item.name} selected={glass.source === 'image' && glass.image === item.id} background={`url("${glassImageUrl(item.id, true)}") center / cover`} onPick={() => update({ source: 'image', image: item.id })} />
        ))}
        {imageMode && glass.customImage && (
          <GlassPick name="Your image" selected={glass.source === 'custom'} background={glassBackdrop({ ...glass, source: 'custom' }, true)} onPick={() => update({ source: 'custom' })}
            onRemove={() => update({ customImage: null, source: 'image' })} />
        )}
        {imageMode && (
          <button type="button" className="glass-pick glass-upload" onClick={() => void upload()} disabled={uploading}>
            <span className="glass-pick-swatch">{uploading ? <LoaderCircle size={18} className="spin" /> : <ImagePlus size={18} />}</span>
            <span className="glass-pick-name">{glass.customImage ? 'Replace image' : 'Upload image'}</span>
          </button>
        )}
      </div>

      <Row title="Tint" hint="Washes the backdrop and the panes with a colour.">
        <div className="tint-swatches" role="radiogroup" aria-label="Tint colour">
          {GLASS_TINTS.map((color) => (
            <button key={color} type="button" role="radio" aria-checked={glass.tint === color} aria-label={color} className={`tint-swatch${glass.tint === color ? ' active' : ''}`} style={{ background: color }}
              onClick={() => update({ tint: color, tintAmount: glass.tintAmount || 30 })} />
          ))}
          <label className={`tint-swatch tint-custom${GLASS_TINTS.includes(glass.tint) ? '' : ' active'}`} title="Any colour" style={GLASS_TINTS.includes(glass.tint) ? undefined : { background: glass.tint }}>
            <input type="color" value={glass.tint} onChange={(event) => preview({ tint: event.target.value, tintAmount: glass.tintAmount || 30 })} onBlur={commit} aria-label="Custom tint colour" />
          </label>
        </div>
      </Row>
      <Row title="Tint strength" hint="0% leaves the background's own colours.">
        <Slider label="Tint strength" value={glass.tintAmount} min={0} max={100} unit="%" onChange={(tintAmount) => preview({ tintAmount })} onCommit={commit} />
      </Row>
      <Row title="Background blur" hint="Softens the backdrop so text and clips stay easy to read.">
        <Slider label="Background blur" value={glass.blur} min={0} max={40} unit="px" onChange={(blur) => preview({ blur })} onCommit={commit} />
      </Row>
      <Row title="Panel opacity" hint="How solid the panes are. Higher is calmer and easier to read.">
        <Slider label="Panel opacity" value={glass.opacity} min={0} max={100} unit="%" onChange={(opacity) => preview({ opacity })} onCommit={commit} />
      </Row>
    </Section>
  );
}

function GlassPick({ name, selected, background, onPick, onRemove }: { name: string; selected: boolean; background: string; onPick: () => void; onRemove?: () => void }) {
  return (
    <div className={`glass-pick${selected ? ' selected' : ''}`}>
      <button type="button" role="radio" aria-checked={selected} className="glass-pick-hit" onClick={onPick}>
        <span className="glass-pick-swatch" style={{ background }}>{selected && <span className="glass-pick-check"><Check size={11} strokeWidth={3} /></span>}</span>
        <span className="glass-pick-name">{name}</span>
      </button>
      {onRemove && <button type="button" className="glass-pick-remove" title="Remove your image" aria-label="Remove your image" onClick={onRemove}><X size={11} /></button>}
    </div>
  );
}
