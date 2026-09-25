// Properties (Premiere's Effect Controls): what the selected clip, transition or comp is, with
// keyframable Motion and Opacity, Crop, Mask, Effects, Speed, Audio and Text.
import { ChevronDown, ChevronRight, Circle, Clapperboard, Clock, Diamond, FolderOpen, Music2, RotateCcw, Sparkles, Square, Timer, Type, Video, Volume2, VolumeX, Wand2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ColorSwatches } from '../components/ui';
import { ScrubNumber } from '../components/workspace';
import { MotionInspector } from './MotionInspector';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { CAPTION_STYLES, styleLabel } from '../lib/captionStyles';
import { clamp, DEFAULT_EFFECTS, DEFAULT_TRANSFORM, gainToDb, parseTimecode, presetLabel, timecode } from '../lib/editor';
import type { History } from '../lib/history';
import { api } from '../lib/ipc';
import { removeKey, setKey, valueAt } from '../lib/keyframes';
import { playhead, usePlayhead } from '../lib/playhead';
import { clipEnd, clipName, COMP_PRESETS, focusClip, FRAME_RATES, ITEM_LABEL, moveClipTo, slipClip, sourceInfo, sourceLimit, trackLabel, transitionLabel, transitionWindow, updateComp, type AssetMap } from '../lib/timeline';
import type { Clip, Comp, Effects, Keyframe, KeyframedProperty as Property, Mask, Project, Transform, Transition } from '../lib/types';

type Props = {
  project: Project;
  comp: Comp | undefined;
  assets: AssetMap;
  history: History;
  selection: string[];
  transition: string | null;
  onOpenGraphics: () => void;
  onSpeedDialog: () => void;
  onAudioGain: () => void;
};

function Section({ title, icon, onReset, children, defaultOpen = true }: { title: string; icon?: ReactNode; onReset?: () => void; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="prop-section">
      <div className="prop-section-head">
        <button type="button" className="prop-toggle" onClick={() => setOpen((value) => !value)}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {icon} {title}
        </button>
        {onReset && <button type="button" className="icon-btn small" onClick={onReset} title={`Reset ${title}`}><RotateCcw size={12} /></button>}
      </div>
      {open && <div className="prop-rows">{children}</div>}
    </div>
  );
}

const Row = ({ label, children, extra }: { label: string; children: ReactNode; extra?: ReactNode }) => (
  <div className="prop-row">
    <span className="prop-label">{label}{extra}</span>
    <div className="prop-value">{children}</div>
  </div>
);

export function PropertiesPanel(props: Props) {
  const { comp, selection, transition } = props;
  if (comp && transition) {
    const found = comp.transitions.find((item) => item.id === transition);
    if (found) return <TransitionProperties {...props} comp={comp} transition={found} />;
  }
  if (comp) {
    const focus = focusClip(comp, selection);
    if (focus) return <ClipProperties {...props} comp={comp} clip={focus} />;
    const clips = comp.clips.filter((clip) => selection.includes(clip.id));
    if (clips.length > 1) return <ManyClips {...props} comp={comp} clips={clips} />;
  }
  return comp ? <CompProperties {...props} comp={comp} /> : <div className="props"><div className="props-note">Open a comp to see its properties.</div></div>;
}

/** A keyframable row: the value, a stopwatch, and keyframe navigation at the playhead. */
function Animated({ clip, comp, history, property, label, value, onChange, format, parse, step = 1, min = -Infinity, max = Infinity, decimals = 1, suffix = '', disabled }: {
  clip: Clip;
  comp: Comp;
  history: History;
  property: Property;
  label: string;
  value: number;
  onChange: (value: number, commit: boolean) => void;
  format?: (value: number) => string;
  parse?: (text: string) => number | null;
  step?: number;
  min?: number;
  max?: number;
  decimals?: number;
  suffix?: string;
  disabled?: boolean;
}) {
  const time = usePlayhead();
  const local = clamp(time - clip.start, 0, clip.duration);
  const keys = clip.keyframes[property];
  const animated = keys.length > 0;
  const shown = animated ? (valueAt(keys, local) ?? value) : value;
  const at = keys.some((key) => Math.abs(key.time - local) < 0.5 / comp.fps);
  const setKeys = (next: Keyframe[], label_: string) =>
    history.commit((current) => updateComp(current, comp.id, (target) => ({ ...target, clips: target.clips.map((item) => (item.id === clip.id ? { ...item, keyframes: { ...item.keyframes, [property]: next } } : item)) })), label_);

  return (
    <Row
      label={label}
      extra={
        <span className="prop-keys">
          <button type="button" className={`stopwatch${animated ? ' on' : ''}`} disabled={disabled} title={animated ? 'Stop animating (keeps the current value)' : 'Animate this property'}
            onClick={() => (animated ? setKeys([], `${label} Static`) : setKeys([{ time: local, value: shown, easing: 'linear' }], `Animate ${label}`))}>
            <Timer size={11} />
          </button>
          {animated && (
            <>
              <button type="button" className="key-nav" title="Previous keyframe" onClick={() => {
                const previous = [...keys].reverse().find((key) => key.time < local - 1e-4);
                if (previous) playhead.seek(clip.start + previous.time);
              }}>‹</button>
              <button type="button" className={`key-dot${at ? ' on' : ''}`} title={at ? 'Remove keyframe here' : 'Add keyframe here'}
                onClick={() => setKeys(at ? removeKey(keys, local, comp.fps) : setKey(keys, local, shown, comp.fps), at ? 'Remove Keyframe' : 'Add Keyframe')}>
                <Diamond size={9} fill={at ? 'currentColor' : 'none'} />
              </button>
              <button type="button" className="key-nav" title="Next keyframe" onClick={() => {
                const next = keys.find((key) => key.time > local + 1e-4);
                if (next) playhead.seek(clip.start + next.time);
              }}>›</button>
            </>
          )}
        </span>
      }
    >
      <ScrubNumber
        value={shown}
        step={step}
        min={min}
        max={max}
        decimals={decimals}
        suffix={suffix}
        format={format}
        parse={parse}
        disabled={disabled}
        onChange={(next) => {
          if (animated) {
            history.preview((current) => updateComp(current, comp.id, (target) => ({ ...target, clips: target.clips.map((item) => (item.id === clip.id ? { ...item, keyframes: { ...item.keyframes, [property]: setKey(keys, local, next, comp.fps) } } : item)) })));
          } else onChange(next, false);
        }}
        onCommit={() => history.settle(label)}
      />
    </Row>
  );
}

function ClipProperties({ project, comp, clip, assets, history, onOpenGraphics, onSpeedDialog, onAudioGain }: Omit<Props, 'comp'> & { comp: Comp; clip: Clip }) {
  const track = comp.tracks.find((item) => item.id === clip.trackId);
  const isAudio = track?.kind === 'audio';
  const disabled = !!track?.locked;
  const info = sourceInfo(project, assets, clip.source);
  const source = clip.source;
  const asset = source.type === 'media' ? assets.get(source.assetId) : undefined;
  const item = source.type === 'item' ? project.items.find((entry) => entry.id === source.itemId) : undefined;
  const nested = source.type === 'comp' ? project.comps.find((entry) => entry.id === source.compId) : undefined;

  const patch = (change: Partial<Clip>, label = 'Properties', commit = true) => {
    const apply = (current: Project) => updateComp(current, comp.id, (target) => ({ ...target, clips: target.clips.map((entry) => (entry.id === clip.id ? { ...entry, ...change } : entry)) }));
    if (commit) history.commit(apply, label);
    else history.preview(apply);
  };
  /**
   * Start and Source In edit the clip as the timeline would — linked partners along, overwriting
   * what it lands on — and each step starts again from where the scrub began, so an overwrite
   * does not pile up on the neighbour step after step.
   */
  const timing = (change: (base: Comp) => Comp | null) =>
    history.preview((present, start) => {
      const base = start.comps.find((entry) => entry.id === comp.id);
      const next = base && change(base);
      return next ? updateComp(present, comp.id, () => next) : present;
    });
  const setTransform = (change: Partial<Transform>, commit = false) => patch({ transform: { ...clip.transform, ...change } }, 'Motion', commit);
  const setEffects = (change: Partial<Effects>, commit = true) => patch({ effects: { ...clip.effects, ...change } }, 'Effects', commit);
  const setMask = (change: Partial<Mask> | null, commit = true) =>
    patch({ mask: change === null ? null : { shape: 'rectangle', x: 0.2, y: 0.2, width: 0.6, height: 0.6, points: [], feather: 10, inverted: false, ...clip.mask, ...change } }, 'Mask', commit);
  const setSource = (change: Record<string, unknown>, commit = true) => patch({ source: { ...source, ...change } as Clip['source'] }, 'Text', commit);

  const [w, h] = [comp.width, comp.height];
  const db = gainToDb(clip.volume);
  const limit = sourceLimit(project, assets, clip);

  return (
    <div className="props">
      <div className="props-head">
        {source.type === 'text' ? <Type size={14} /> : source.type === 'comp' ? <Clapperboard size={14} /> : source.type === 'shape' ? <Square size={14} /> : source.type === 'html' ? <Sparkles size={14} /> : isAudio ? <Music2 size={14} /> : <Video size={14} />}
        <span className="props-name" title={asset?.path}>{clipName(project, assets, clip)}</span>
        {asset && <button type="button" className="icon-btn small" onClick={() => void api.revealPath(asset.path)} title="Reveal in Explorer"><FolderOpen size={13} /></button>}
      </div>
      <div className="props-sub">
        {trackLabel(comp, clip.trackId)} · {timecode(clip.start, comp.fps)} → {timecode(clipEnd(clip), comp.fps)} · {timecode(clip.duration, comp.fps)}
        {asset && ` · ${asset.width}×${asset.height}${asset.fps ? ` · ${Math.round(asset.fps)} fps` : ''}`}
        {nested && ` · comp ${nested.width}×${nested.height}`}
      </div>
      {disabled && <div className="props-note">{trackLabel(comp, clip.trackId)} is locked — unlock it in the timeline to edit.</div>}

      {!isAudio && (
        <>
          <Section title="Motion" onReset={() => patch({ transform: { ...DEFAULT_TRANSFORM, fit: clip.transform.fit } }, 'Reset Motion')}>
            <div className="fit-toggle">
              <button type="button" className={clip.transform.fit === 'fill' ? 'active' : ''} onClick={() => setTransform({ fit: 'fill' }, true)} disabled={disabled}>Fill</button>
              <button type="button" className={clip.transform.fit === 'fit' ? 'active' : ''} onClick={() => setTransform({ fit: 'fit' }, true)} disabled={disabled}>Fit</button>
            </div>
            <Animated clip={clip} comp={comp} history={history} property="x" label="Position X" value={clip.transform.x} disabled={disabled}
              format={(value) => `${Math.round(w / 2 + value * w)} px`} parse={(text) => (Number.isFinite(Number(text)) ? (Number(text) - w / 2) / w : null)} step={1 / w} decimals={4}
              onChange={(value) => setTransform({ x: value })} />
            <Animated clip={clip} comp={comp} history={history} property="y" label="Position Y" value={clip.transform.y} disabled={disabled}
              format={(value) => `${Math.round(h / 2 + value * h)} px`} parse={(text) => (Number.isFinite(Number(text)) ? (Number(text) - h / 2) / h : null)} step={1 / h} decimals={4}
              onChange={(value) => setTransform({ y: value })} />
            <Animated clip={clip} comp={comp} history={history} property="scale" label="Scale" value={clip.transform.scale} min={0} max={10000} step={0.5} suffix=" %" disabled={disabled}
              onChange={(value) => setTransform({ scale: value })} />
            <Animated clip={clip} comp={comp} history={history} property="rotation" label="Rotation" value={clip.transform.rotation} min={-3600} max={3600} step={0.5} suffix=" °" disabled={disabled}
              onChange={(value) => setTransform({ rotation: value })} />
          </Section>

          <Section title="Opacity" onReset={() => setTransform({ opacity: 100 }, true)}>
            <Animated clip={clip} comp={comp} history={history} property="opacity" label="Opacity" value={clip.transform.opacity} min={0} max={100} step={0.5} suffix=" %" disabled={disabled}
              onChange={(value) => setTransform({ opacity: value })} />
            <Row label="Mask">
              <select className="prop-select" value={clip.mask ? clip.mask.shape : 'none'} disabled={disabled}
                onChange={(event) => (event.target.value === 'none' ? setMask(null) : setMask({ shape: event.target.value as Mask['shape'] }))}>
                <option value="none">None</option>
                <option value="rectangle">Rectangle</option>
                <option value="ellipse">Ellipse</option>
                <option value="polygon" disabled={!clip.mask || clip.mask.points.length < 3}>Polygon (drawn)</option>
              </select>
            </Row>
            {clip.mask && (
              <>
                <Row label="Feather"><ScrubNumber value={clip.mask.feather} min={0} max={400} step={0.5} suffix=" px" disabled={disabled} onChange={(feather) => setMask({ feather }, false)} onCommit={() => history.settle('Mask')} /></Row>
                <Row label="Inverted">
                  <button type="button" className={`btn btn-small${clip.mask.inverted ? ' btn-primary' : ''}`} disabled={disabled} onClick={() => setMask({ inverted: !clip.mask?.inverted })}>{clip.mask.inverted ? 'Inverted' : 'Normal'}</button>
                </Row>
              </>
            )}
            <Row label="Roto matte">
              {clip.rotoMatte ? <button type="button" className="btn btn-small btn-primary" disabled={disabled} onClick={() => patch({ rotoMatte: null }, 'Remove Roto Matte')} title="Remove the cached animated subject matte from this layer">Applied · Remove</button> : <span className="props-note">None — use Roto tool</span>}
            </Row>
            {clip.rotoCorrections?.length ? <Row label="Roto corrections"><button type="button" className="btn btn-small" disabled={disabled} onClick={() => patch({ rotoCorrections: [] }, 'Clear Roto Corrections')}>{clip.rotoCorrections.length} clicks · Clear</button></Row> : null}
          </Section>

          <Section title="Crop" onReset={() => setTransform({ cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0 }, true)} defaultOpen={false}>
            {(['cropLeft', 'cropTop', 'cropRight', 'cropBottom'] as const).map((key) => (
              <Row key={key} label={key.replace('crop', '')}>
                <ScrubNumber value={clip.transform[key]} min={0} max={95} step={0.25} suffix=" %" disabled={disabled}
                  onChange={(value) => {
                    const opposite = { cropLeft: clip.transform.cropRight, cropRight: clip.transform.cropLeft, cropTop: clip.transform.cropBottom, cropBottom: clip.transform.cropTop }[key];
                    setTransform({ [key]: Math.min(value, 95 - opposite) });
                  }} onCommit={() => history.settle('Crop')} />
              </Row>
            ))}
          </Section>

          <Section title="Effects" onReset={() => setEffects({ ...DEFAULT_EFFECTS })} defaultOpen={false}>
            <Row label="Brightness"><ScrubNumber value={clip.effects.brightness} min={-100} max={100} step={0.5} disabled={disabled} onChange={(brightness) => setEffects({ brightness }, false)} onCommit={() => history.settle('Effects')} /></Row>
            <Row label="Contrast"><ScrubNumber value={clip.effects.contrast} min={-100} max={100} step={0.5} disabled={disabled} onChange={(contrast) => setEffects({ contrast }, false)} onCommit={() => history.settle('Effects')} /></Row>
            <Row label="Saturation"><ScrubNumber value={clip.effects.saturation} min={0} max={300} step={0.5} suffix=" %" disabled={disabled} onChange={(saturation) => setEffects({ saturation }, false)} onCommit={() => history.settle('Effects')} /></Row>
            <Row label="Hue"><ScrubNumber value={clip.effects.hue} min={-180} max={180} step={0.5} suffix=" °" disabled={disabled} onChange={(hue) => setEffects({ hue }, false)} onCommit={() => history.settle('Effects')} /></Row>
            <Row label="Invert"><ScrubNumber value={clip.effects.invert} min={0} max={100} step={1} suffix=" %" disabled={disabled} onChange={(invert) => setEffects({ invert }, false)} onCommit={() => history.settle('Effects')} /></Row>
            <Row label="Blur"><ScrubNumber value={clip.effects.blur} min={0} max={200} step={0.5} suffix=" px" disabled={disabled} onChange={(blur) => setEffects({ blur }, false)} onCommit={() => history.settle('Effects')} /></Row>
            <Row label="Flip">
              <button type="button" className={`btn btn-small${clip.effects.flipH ? ' btn-primary' : ''}`} disabled={disabled} onClick={() => setEffects({ flipH: !clip.effects.flipH })}>Horizontal</button>
              <button type="button" className={`btn btn-small${clip.effects.flipV ? ' btn-primary' : ''}`} disabled={disabled} onClick={() => setEffects({ flipV: !clip.effects.flipV })}>Vertical</button>
            </Row>
            <Row label="Adjustment">
              <button type="button" className={`btn btn-small${clip.adjustment ? ' btn-primary' : ''}`} disabled={disabled} onClick={() => patch({ adjustment: !clip.adjustment }, 'Adjustment Layer')} title="Apply this clip's effects to every track below it">
                {clip.adjustment ? 'Adjustment layer' : 'Normal layer'}
              </button>
            </Row>
          </Section>
        </>
      )}

      {source.type === 'text' && (
        <Section title="Text" icon={<Type size={12} />}>
          <textarea className="prop-textarea" rows={3} value={source.text} disabled={disabled} onChange={(event) => setSource({ text: event.target.value }, false)} onBlur={() => history.settle('Edit Text')} />
          {(source.preset === 'lower-third' || source.preset === 'title') && (
            <input className="prop-input" placeholder="Subtitle" value={source.subtitle} disabled={disabled} onChange={(event) => setSource({ subtitle: event.target.value }, false)} onBlur={() => history.settle('Edit Text')} />
          )}
          <Row label="Preset">
            <select className="prop-select" value={source.preset} disabled={disabled} onChange={(event) => setSource({ preset: event.target.value })}>
              {(['title', 'kinetic', 'lower-third', 'caption'] as const).map((preset) => <option key={preset} value={preset}>{presetLabel(preset)}</option>)}
            </select>
          </Row>
          {source.preset === 'caption' && (
            <Row label="Caption style">
              <select className="prop-select" value={source.style ?? ''} disabled={disabled} onChange={(event) => setSource({ style: event.target.value || null })}>
                <option value="">Bhippi basic</option>
                {CAPTION_STYLES.map((style) => <option key={style.id} value={style.id}>{style.label}</option>)}
              </select>
              <button type="button" className="btn btn-small btn-ghost" onClick={onOpenGraphics}>Browse…</button>
            </Row>
          )}
          <Row label="Vertical">
            <button type="button" className={`btn btn-small${source.vertical ? ' btn-primary' : ''}`} disabled={disabled} onClick={() => setSource({ vertical: !source.vertical })}>{source.vertical ? 'Vertical type' : 'Horizontal type'}</button>
          </Row>
          <Row label="Color"><ColorSwatches value={source.color} onChange={(color) => setSource({ color })} /></Row>
        </Section>
      )}

      {source.type === 'shape' && (
        <Section title="Shape" icon={source.shape === 'ellipse' ? <Circle size={12} /> : <Square size={12} />}>
          <Row label="Width"><ScrubNumber value={source.width} min={1} max={16384} step={1} decimals={0} suffix=" px" disabled={disabled} onChange={(width) => setSource({ width }, false)} onCommit={() => history.settle('Shape')} /></Row>
          <Row label="Height"><ScrubNumber value={source.height} min={1} max={16384} step={1} decimals={0} suffix=" px" disabled={disabled} onChange={(height) => setSource({ height }, false)} onCommit={() => history.settle('Shape')} /></Row>
          {source.shape === 'rectangle' && <Row label="Corner radius"><ScrubNumber value={source.cornerRadius} min={0} max={4000} step={1} decimals={0} suffix=" px" disabled={disabled} onChange={(cornerRadius) => setSource({ cornerRadius }, false)} onCommit={() => history.settle('Shape')} /></Row>}
          {source.shape === 'polygon' && <Row label="Sides"><ScrubNumber value={source.sides} min={3} max={64} step={1} decimals={0} disabled={disabled} onChange={(sides) => setSource({ sides: Math.round(sides) }, false)} onCommit={() => history.settle('Shape')} /></Row>}
          <Row label="Fill"><ColorSwatches value={source.fill ?? '#3D7BFF'} onChange={(fill) => setSource({ fill })} /></Row>
          <Row label="Stroke">
            <ScrubNumber value={source.strokeWidth} min={0} max={400} step={0.5} suffix=" px" disabled={disabled} onChange={(strokeWidth) => setSource({ strokeWidth, stroke: source.stroke ?? '#FFFFFF' }, false)} onCommit={() => history.settle('Shape')} />
            {source.strokeWidth > 0 && <ColorSwatches value={source.stroke ?? '#FFFFFF'} onChange={(stroke) => setSource({ stroke })} />}
          </Row>
        </Section>
      )}

      {item && (
        <Section title={ITEM_LABEL[item.kind]} icon={<Wand2 size={12} />}>
          <Row label="Name"><span className="prop-readout">{item.name}</span></Row>
          {item.kind === 'color-matte' || item.kind === 'countdown' ? (
            <Row label="Color">
              <ColorSwatches value={item.color} onChange={(color) => history.commit((current) => ({ ...current, items: current.items.map((entry) => (entry.id === item.id ? { ...entry, color } : entry)) }), 'Item Color')} />
            </Row>
          ) : null}
          <Row label="Frame"><span className="prop-readout">{item.width}×{item.height}</span></Row>
        </Section>
      )}

      {source.type === 'motion' && <ErrorBoundary scope="Motion inspector"><MotionInspector clip={clip} comp={comp} history={history} disabled={disabled} Section={Section} Row={Row} /></ErrorBoundary>}

      {source.type === 'html' && (
        <Section title="Motion Graphic" icon={<Sparkles size={12} />}>
          <Row label="Template"><span className="prop-readout">{source.title || 'HTML/GSAP'}</span></Row>
          <Row label="Engine"><span className="prop-readout">{source.js ? 'HTML + CSS + GSAP' : 'HTML + CSS'}</span></Row>
        </Section>
      )}

      <Section title="Speed / Duration" icon={<Clock size={12} />} defaultOpen={!isAudio}>
        <Row label="Speed"><span className="prop-readout">{Math.round(clip.speed * 100)} %{clip.reverse ? ' · reversed' : ''}</span></Row>
        <Row label="Duration"><span className="prop-readout">{timecode(clip.duration, comp.fps)}</span></Row>
        <Row label="Frame hold"><span className="prop-readout">{clip.hold === null ? 'off' : timecode(clip.hold, comp.fps)}</span></Row>
        <button type="button" className="btn btn-small" onClick={onSpeedDialog} disabled={disabled}><Clock size={12} /> Adjust speed…</button>
      </Section>

      {(isAudio || info.hasAudio) && (
        <Section title="Audio" icon={<Volume2 size={12} />} onReset={() => patch({ volume: 1, channels: 'stereo', enhanceSpeech: false }, 'Reset Audio')}>
          <Animated clip={clip} comp={comp} history={history} property="volume" label="Level" value={clip.volume} min={0} max={8} step={0.01} disabled={disabled}
            format={(value) => (value > 0 ? `${gainToDb(value) >= 0 ? '+' : ''}${gainToDb(value).toFixed(1)} dB` : '−∞ dB')}
            parse={(text) => (Number.isFinite(Number(text.replace(/[^\d.+-]/g, ''))) ? 10 ** (Number(text.replace(/[^\d.+-]/g, '')) / 20) : null)}
            onChange={(volume) => patch({ volume }, 'Level', false)} />
          <Row label="Mute">
            <button type="button" className={`btn btn-small${clip.volume === 0 ? ' btn-primary' : ''}`} disabled={disabled} onClick={() => patch({ volume: clip.volume === 0 ? 1 : 0 }, 'Mute Clip')}>
              {clip.volume === 0 ? <VolumeX size={12} /> : <Volume2 size={12} />} {clip.volume === 0 ? 'Muted' : 'Mute clip'}
            </button>
          </Row>
          <Row label="Channels">
            <select className="prop-select" value={clip.channels} disabled={disabled} onChange={(event) => patch({ channels: event.target.value as Clip['channels'] }, 'Audio Channels')}>
              <option value="stereo">Stereo</option>
              <option value="mono">Mono (sum)</option>
              <option value="left">Left only</option>
              <option value="right">Right only</option>
              <option value="swap">Swap L/R</option>
            </select>
          </Row>
          <Row label="Enhance Speech">
            <button type="button" className={`btn btn-small${clip.enhanceSpeech ? ' btn-primary' : ''}`} disabled={disabled} onClick={() => patch({ enhanceSpeech: !clip.enhanceSpeech }, 'Enhance Speech')} title="High-pass, denoise and gentle compression">
              {clip.enhanceSpeech ? 'On' : 'Off'}
            </button>
          </Row>
          <button type="button" className="btn btn-small" onClick={onAudioGain} disabled={disabled}>Audio Gain…</button>
        </Section>
      )}

      <Section title="Timing" defaultOpen={false}>
        <Row label="Start"><ScrubNumber value={clip.start} min={0} step={1 / comp.fps} format={(value) => timecode(value, comp.fps)} parse={(text) => parseTimecode(text, comp.fps)} disabled={disabled} onChange={(start) => timing((base) => moveClipTo(base, clip.id, start))} onCommit={() => history.settle('Move')} /></Row>
        <Row label="Source In"><ScrubNumber value={clip.in} min={0} max={Math.max(0, limit - clip.duration * clip.speed)} step={1 / comp.fps} format={(value) => timecode(value, comp.fps)} parse={(text) => parseTimecode(text, comp.fps)} disabled={disabled} onChange={(value) => timing((base) => slipClip(base, clip.id, value - (base.clips.find((item) => item.id === clip.id)?.in ?? value), (item) => sourceLimit(project, assets, item)))} onCommit={() => history.settle('Slip')} /></Row>
        <Row label="Level meter"><span className="prop-readout">{Number.isFinite(db) ? `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB` : '−∞'}</span></Row>
      </Section>
    </div>
  );
}

function ManyClips({ project, comp, clips, assets, history, onSpeedDialog, onAudioGain }: Omit<Props, 'comp'> & { comp: Comp; clips: Clip[] }) {
  const patchAll = (change: Partial<Clip>, label: string) =>
    history.commit((current) => updateComp(current, comp.id, (target) => ({ ...target, clips: target.clips.map((clip) => (clips.some((item) => item.id === clip.id) ? { ...clip, ...change } : clip)) })), label);
  return (
    <div className="props">
      <div className="props-head"><Video size={14} /><span className="props-name">{clips.length} clips selected</span></div>
      <div className="props-sub">{clips.map((clip) => clipName(project, assets, clip)).slice(0, 4).join(', ')}{clips.length > 4 ? '…' : ''}</div>
      <Section title="All selected">
        <Row label="Opacity"><ScrubNumber value={clips[0].transform.opacity} min={0} max={100} step={1} suffix=" %" onChange={(opacity) => history.preview((current) => updateComp(current, comp.id, (target) => ({ ...target, clips: target.clips.map((clip) => (clips.some((item) => item.id === clip.id) ? { ...clip, transform: { ...clip.transform, opacity } } : clip)) })))} onCommit={() => history.settle('Opacity')} /></Row>
        <Row label="Level"><ScrubNumber value={clips[0].volume} min={0} max={8} step={0.01} format={(value) => (value > 0 ? `${gainToDb(value).toFixed(1)} dB` : '−∞')} onChange={(volume) => history.preview((current) => updateComp(current, comp.id, (target) => ({ ...target, clips: target.clips.map((clip) => (clips.some((item) => item.id === clip.id) ? { ...clip, volume } : clip)) })))} onCommit={() => history.settle('Level')} /></Row>
        <Row label="Enabled">
          <button type="button" className="btn btn-small" onClick={() => patchAll({ enabled: !clips.every((clip) => clip.enabled) }, 'Enable')}>{clips.every((clip) => clip.enabled) ? 'Disable all' : 'Enable all'}</button>
        </Row>
        <div className="prop-actions">
          <button type="button" className="btn btn-small" onClick={onSpeedDialog}>Speed / Duration…</button>
          <button type="button" className="btn btn-small" onClick={onAudioGain}>Audio Gain…</button>
        </div>
      </Section>
    </div>
  );
}

function TransitionProperties({ comp, transition, history }: Omit<Props, 'transition'> & { comp: Comp; transition: Transition }) {
  const window = transitionWindow(comp, transition);
  const patch = (change: Partial<Transition>, label = 'Transition') =>
    history.commit((current) => updateComp(current, comp.id, (target) => ({ ...target, transitions: target.transitions.map((item) => (item.id === transition.id ? { ...item, ...change } : item)) })), label);
  return (
    <div className="props">
      <div className="props-head"><Wand2 size={14} /><span className="props-name">{transitionLabel(transition.kind)}</span></div>
      <div className="props-sub">{trackLabel(comp, transition.trackId)} · {window ? `${timecode(window.start, comp.fps)} → ${timecode(window.end, comp.fps)}` : ''}</div>
      <Section title="Transition">
        <Row label="Duration">
          <ScrubNumber value={transition.duration} min={1 / comp.fps} max={600} step={1 / comp.fps} format={(value) => timecode(value, comp.fps)} parse={(text) => parseTimecode(text, comp.fps)}
            onChange={(duration) => history.preview((current) => updateComp(current, comp.id, (target) => ({ ...target, transitions: target.transitions.map((item) => (item.id === transition.id ? { ...item, duration } : item)) })))}
            onCommit={() => history.settle('Transition Duration')} />
        </Row>
        <Row label="Alignment">
          <select className="prop-select" value={transition.alignment} disabled={!transition.fromClip || !transition.toClip} onChange={(event) => patch({ alignment: event.target.value as Transition['alignment'] })}>
            <option value="center">Center at Cut</option>
            <option value="start">Start at Cut</option>
            <option value="end">End at Cut</option>
          </select>
        </Row>
        <Row label="Kind"><span className="prop-readout">{transitionLabel(transition.kind)}</span></Row>
      </Section>
    </div>
  );
}

function CompProperties({ project, comp, history }: Omit<Props, 'comp'> & { comp: Comp }) {
  const patch = (change: Partial<Comp>, label = 'Comp Settings') => history.commit((current) => updateComp(current, comp.id, (target) => ({ ...target, ...change })), label);
  const preset = COMP_PRESETS.find((item) => item.width === comp.width && item.height === comp.height);
  return (
    <div className="props">
      <div className="props-head"><Clapperboard size={14} /><span className="props-name">{comp.name}</span></div>
      <div className="props-sub">Comp · {comp.clips.length} clips · {comp.markers.length} markers</div>
      <Section title="Comp">
        <Row label="Name"><input className="prop-input" value={comp.name} onChange={(event) => { const name = event.target.value; history.preview((current) => updateComp(current, comp.id, (target) => ({ ...target, name }))); }} onBlur={() => history.settle('Rename Comp')} /></Row>
        <Row label="Frame size">
          <select className="prop-select" value={preset?.id ?? 'custom'} onChange={(event) => {
            const chosen = COMP_PRESETS.find((item) => item.id === event.target.value);
            if (chosen) patch({ width: chosen.width, height: chosen.height });
          }}>
            {COMP_PRESETS.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.width}×{item.height}</option>)}
            {!preset && <option value="custom">Custom · {comp.width}×{comp.height}</option>}
          </select>
        </Row>
        <Row label="Frame rate">
          <select className="prop-select" value={comp.fps} onChange={(event) => patch({ fps: Number(event.target.value) })}>
            {FRAME_RATES.map((rate) => <option key={rate} value={rate}>{rate} fps</option>)}
          </select>
        </Row>
        <Row label="Tracks"><span className="prop-readout">{comp.tracks.filter((track) => track.kind === 'video').length} video · {comp.tracks.filter((track) => track.kind === 'audio').length} audio</span></Row>
      </Section>
      <Section title="In / Out">
        <Row label="In"><span className="prop-readout">{comp.inPoint === null ? '—' : timecode(comp.inPoint, comp.fps)}</span></Row>
        <Row label="Out"><span className="prop-readout">{comp.outPoint === null ? '—' : timecode(comp.outPoint, comp.fps)}</span></Row>
        <button type="button" className="btn btn-small" onClick={() => patch({ inPoint: null, outPoint: null }, 'Clear In and Out')} disabled={comp.inPoint === null && comp.outPoint === null}>Clear In and Out</button>
      </Section>
      <Section title="Captions" defaultOpen={false}>
        <Row label="Default style">
          <select className="prop-select" value={project.captionStyle ?? ''} onChange={(event) => { const style = event.target.value || null; history.commit((current) => ({ ...current, captionStyle: style }), 'Caption Style'); }}>
            <option value="">Bhippi basic</option>
            {CAPTION_STYLES.map((style) => <option key={style.id} value={style.id}>{style.label}</option>)}
          </select>
        </Row>
        <Row label="In use"><span className="prop-readout">{styleLabel(project.captionStyle)}</span></Row>
      </Section>
    </div>
  );
}
