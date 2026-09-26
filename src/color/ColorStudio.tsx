// The Color Studio panel: a grading page in the Effect Controls card of a clip or adjustment
// layer. Primaries (Lift/Gamma/Gain/Offset wheels and the primary bars), Tone, Curves (custom
// YRGB plus the five hue/lum/sat curves), Color Slice (seven colour vectors) and LUT.
//
// Everything edits the params of one `lumetri-color` effect; lib/colorGrade.ts turns them into
// the grade both the preview and the export apply.

import { FileUp, RotateCcw, Trash2, Wand2 } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { CurvesEditor } from '../components/CurvesEditor';
import { ParamRow, ParamSlider } from '../components/FxParam';
import { GRADE_CONTROL_MAP, HUE_CURVE_LABELS, HUE_CURVES, number, SLICES, sliceKey, WHEELS, type HueCurve } from '../lib/colorGrade';
import { autoBalance } from '../lib/colorScopes';
import { BUILTIN_LUTS, importCube, lutName, lutsInUse } from '../lib/luts';
import type { AppliedEffect, Project, ProjectLut } from '../lib/types';
import { ColorWheel } from './ColorWheel';
import { HueCurveEditor } from './HueCurve';

type Tab = 'primaries' | 'tone' | 'curves' | 'slice' | 'lut';
const TABS: { id: Tab; label: string; keys: string[] }[] = [
  { id: 'primaries', label: 'Primaries', keys: [...WHEELS.flatMap((w) => ['Y', 'R', 'G', 'B'].map((c) => w + c)), 'temperature', 'tint', 'contrast', 'pivot', 'saturation', 'vibrance', 'hue'] },
  { id: 'tone', label: 'Tone', keys: ['exposure', 'highlights', 'shadows', 'whites', 'blacks', 'softClipHigh', 'softClipLow'] },
  { id: 'curves', label: 'Curves', keys: ['rTable', 'gTable', 'bTable', 'curvesJson', ...HUE_CURVES] },
  { id: 'slice', label: 'Color Slice', keys: SLICES.flatMap((s) => (['Hue', 'Sat', 'Den'] as const).map((w) => sliceKey(s.id, w))) },
  { id: 'lut', label: 'LUT', keys: ['lutId', 'lutAmount', 'lutStage'] },
];
const LEGACY = ['shadow', 'midtone', 'highlight'].flatMap((band) => ['Hue', 'Amount', 'Luma'].map((w) => band + w));

let lastTab: Tab = 'primaries';
let lastCurve: HueCurve | 'custom' = 'custom';

type Patch = Record<string, number | string | boolean>;

export function ColorStudio({ fx, project, onPatch, onCommit, onProjectLuts, sample }: {
  fx: AppliedEffect;
  project: Project;
  /** Merges params into the effect; `commit` false previews inside a gesture. */
  onPatch: (patch: Patch, commit: boolean) => void;
  /** Ends a previewed gesture as one undo step. */
  onCommit: (label: string) => void;
  onProjectLuts: (luts: ProjectLut[], label: string) => void;
  /** The ungraded picture this grade applies to, small, for Auto Balance. */
  sample: () => ImageData | null;
}) {
  const [tab, setTabState] = useState<Tab>(lastTab);
  const [curve, setCurveState] = useState<HueCurve | 'custom'>(lastCurve);
  const [notice, setNotice] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const setTab = (next: Tab) => { lastTab = next; setTabState(next); };
  const setCurve = (next: HueCurve | 'custom') => { lastCurve = next; setCurveState(next); };
  const p = fx.params;

  const isChanged = (key: string) => {
    const control = GRADE_CONTROL_MAP.get(key);
    if (control) return Math.abs(number(p, key, control.defaultValue) - control.defaultValue) > 1e-6;
    return typeof p[key] === 'string' && p[key] !== '' && key !== 'lutStage';
  };
  const tabChanged = (entry: typeof TABS[number]) => entry.keys.some(isChanged);

  const slider = (key: string, label?: string) => {
    const control = GRADE_CONTROL_MAP.get(key)!;
    return (
      <ParamSlider
        key={key}
        label={label ?? control.name}
        hint={control.hint}
        value={number(p, key, control.defaultValue)}
        min={control.min}
        max={control.max}
        step={control.step}
        unit={control.unit}
        defaultValue={control.defaultValue}
        onPreview={(value) => onPatch({ [key]: value }, false)}
        onCommit={() => onCommit(`Color: ${control.name}`)}
      />
    );
  };

  const resetTab = () => {
    const entry = TABS.find((t) => t.id === tab)!;
    const patch: Patch = {};
    for (const key of entry.keys) {
      const control = GRADE_CONTROL_MAP.get(key);
      patch[key] = control ? control.defaultValue : key === 'lutStage' ? 'output' : '';
    }
    onPatch(patch, true);
  };

  const auto = () => {
    const image = sample();
    if (!image) { setNotice('Auto Balance needs the clip on screen in the Program monitor at the playhead.'); return; }
    onPatch(autoBalance(image), true);
    setNotice('Balanced from the frame at the playhead: black and white points on Lift/Gain, the neutral cast taken out with Gain. Fine-tune from here.');
  };

  const legacy = LEGACY.some((key) => number(p, key) !== 0);

  return (
    <div className="cs-studio">
      <div className="cs-tabs" role="tablist">
        {TABS.map((entry) => (
          <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id} className={`cs-tab${tab === entry.id ? ' active' : ''}`} onClick={() => setTab(entry.id)}>
            {entry.label}{tabChanged(entry) && <span className="cs-dot" aria-label="changed" />}
          </button>
        ))}
      </div>
      <div className="cs-toolbar">
        <button type="button" className="btn btn-small" onClick={auto} title="Set black/white points and neutralise the colour cast from the frame at the playhead"><Wand2 size={11} /> Auto Balance</button>
        <span className="toolbar-spacer" />
        <button type="button" className="btn btn-small" onClick={resetTab} disabled={!tabChanged(TABS.find((t) => t.id === tab)!)} title="Reset this tab's controls"><RotateCcw size={11} /> Reset {TABS.find((t) => t.id === tab)!.label}</button>
      </div>
      {notice && <div className="cs-notice" onClick={() => setNotice(null)} role="status">{notice}</div>}

      {tab === 'primaries' && (
        <>
          <div className="cs-wheels">
            {WHEELS.map((wheel) => (
              <ColorWheel
                key={wheel}
                wheel={wheel}
                values={{ Y: number(p, wheel + 'Y'), R: number(p, wheel + 'R'), G: number(p, wheel + 'G'), B: number(p, wheel + 'B') }}
                onPreview={(patch) => onPatch(patch, false)}
                onCommit={() => onCommit(`Color: ${wheel} wheel`)}
              />
            ))}
          </div>
          {legacy && (
            <div className="cs-notice">
              This grade also carries colour from the older three-way controls.
              <button type="button" className="btn btn-small" onClick={() => onPatch(Object.fromEntries(LEGACY.map((key) => [key, 0])), true)}>Clear them</button>
            </div>
          )}
          <Section title="White Balance">{slider('temperature')}{slider('tint')}</Section>
          <Section title="Primary Bars">{slider('contrast')}{slider('pivot')}{slider('saturation')}{slider('vibrance')}{slider('hue')}</Section>
        </>
      )}

      {tab === 'tone' && (
        <>
          <Section title="Exposure">{slider('exposure')}</Section>
          <Section title="Tonal Range">{slider('highlights')}{slider('shadows')}{slider('whites')}{slider('blacks')}</Section>
          <Section title="Soft Clip">{slider('softClipHigh')}{slider('softClipLow')}</Section>
        </>
      )}

      {tab === 'curves' && (
        <>
          <div className="cs-pills">
            {(['custom', ...HUE_CURVES] as const).map((id) => (
              <button key={id} type="button" className={`cs-pill${curve === id ? ' active' : ''}`} onClick={() => setCurve(id)}>
                {id === 'custom' ? 'Custom' : HUE_CURVE_LABELS[id]}
                {(id === 'custom' ? ['rTable', 'gTable', 'bTable'].some(isChanged) : isChanged(id)) && <span className="cs-dot" />}
              </button>
            ))}
          </div>
          {curve === 'custom'
            ? <CurvesEditor allowAlpha={false} params={p} onChange={() => undefined} onPatch={(patch, commit) => onPatch(patch, commit)} onCommit={() => onCommit('Color: curves')} />
            : <HueCurveEditor curve={curve} value={p[curve]} onPreview={(text) => onPatch({ [curve]: text }, false)} onCommit={() => onCommit(`Color: ${HUE_CURVE_LABELS[curve]}`)} />}
        </>
      )}

      {tab === 'slice' && (
        <div className="cs-slice">
          <div className="cs-slice-row cs-slice-head"><span /><span>Hue</span><span>Sat</span><span>Density</span></div>
          {SLICES.map((s) => (
            <div key={s.id} className="cs-slice-row">
              <span className="cs-slice-name"><i style={{ background: s.swatch }} />{s.label}</span>
              {(['Hue', 'Sat', 'Den'] as const).map((what) => {
                const key = sliceKey(s.id, what);
                const control = GRADE_CONTROL_MAP.get(key)!;
                const value = number(p, key);
                return (
                  <MiniSlider
                    key={key}
                    label={control.name}
                    value={value}
                    min={control.min}
                    max={control.max}
                    unit={what === 'Hue' ? '°' : ''}
                    onPreview={(next) => onPatch({ [key]: next }, false)}
                    onCommit={() => onCommit(`Color: ${control.name}`)}
                  />
                );
              })}
            </div>
          ))}
          <p className="field-hint">Each vector moves only its own colours: Hue turns them, Sat makes them richer or quieter, Density darkens (+) or lightens (−) them. Greys are never touched.</p>
        </div>
      )}

      {tab === 'lut' && (
        <LutTab
          fx={fx}
          project={project}
          onPatch={onPatch}
          onCommit={onCommit}
          onImport={() => file.current?.click()}
          onProjectLuts={onProjectLuts}
          slider={slider}
        />
      )}
      <input
        ref={file}
        type="file"
        accept=".cube"
        hidden
        onChange={async (event) => {
          const chosen = event.target.files?.[0];
          event.target.value = '';
          if (!chosen) return;
          try {
            const lut = importCube(await chosen.text(), chosen.name);
            onProjectLuts([...(project.luts ?? []), lut], `Import LUT ${lut.name}`);
            onPatch({ lutId: lut.id, lutAmount: 100 }, true);
            setNotice(`Imported “${lut.name}” and applied it to this grade.`);
          } catch (error) {
            setNotice(`Could not import ${chosen.name}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="cs-section">
      <div className="cs-section-title">{title}</div>
      {children}
    </div>
  );
}

function MiniSlider({ label, value, min, max, unit, onPreview, onCommit }: { label: string; value: number; min: number; max: number; unit: string; onPreview: (value: number) => void; onCommit: () => void }) {
  const at = (x: number) => ((x - min) / (max - min)) * 100;
  const from = Math.min(at(0), at(value)), to = Math.max(at(0), at(value));
  return (
    <span className={`cs-mini${value !== 0 ? ' changed' : ''}`} title={`${label} · double-click to reset`} onDoubleClick={() => { onPreview(0); onCommit(); }}>
      <input
        type="range"
        className="fx-slider"
        min={min}
        max={max}
        step={1}
        value={value}
        aria-label={label}
        style={{ ['--fill-from' as string]: `${from}%`, ['--fill-to' as string]: `${to}%` }}
        onChange={(event) => onPreview(Number(event.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
      />
      <b>{value > 0 && unit !== '°' ? '+' : ''}{value}{unit}</b>
    </span>
  );
}

function LutTab({ fx, project, onPatch, onCommit, onImport, onProjectLuts, slider }: {
  fx: AppliedEffect;
  project: Project;
  onPatch: (patch: Patch, commit: boolean) => void;
  onCommit: (label: string) => void;
  onImport: () => void;
  onProjectLuts: (luts: ProjectLut[], label: string) => void;
  slider: (key: string, label?: string) => ReactNode;
}) {
  void onCommit;
  const lutId = typeof fx.params.lutId === 'string' ? fx.params.lutId : '';
  const stage = fx.params.lutStage === 'input' ? 'input' : 'output';
  const missing = lutId && !lutName(lutId);
  const used = lutsInUse(project);
  const imported = project.luts ?? [];
  return (
    <div className="cs-lut">
      <ParamRow label="LUT" hint="A LUT is applied only when you choose one">
        <select className="prop-select" value={missing ? '__missing' : lutId} onChange={(event) => onPatch({ lutId: event.target.value, ...(event.target.value && !lutId ? { lutAmount: 100 } : {}) }, true)}>
          <option value="">None</option>
          {missing && <option value="__missing" disabled>Missing LUT</option>}
          <optgroup label="Camera → Rec.709">
            {BUILTIN_LUTS.filter((l) => l.group === 'Camera').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </optgroup>
          <optgroup label="Creative looks">
            {BUILTIN_LUTS.filter((l) => l.group === 'Creative').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </optgroup>
          {imported.length > 0 && (
            <optgroup label="Imported">
              {imported.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </optgroup>
          )}
        </select>
      </ParamRow>
      {lutId && (
        <>
          {slider('lutAmount')}
          <ParamRow label="Applied" hint="Input: before the grade (camera log conversions). Output: after it (creative looks).">
            <div className="cs-seg">
              {(['input', 'output'] as const).map((value) => (
                <button key={value} type="button" className={stage === value ? 'active' : ''} onClick={() => onPatch({ lutStage: value }, true)}>
                  {value === 'input' ? 'Before grade' : 'After grade'}
                </button>
              ))}
            </div>
          </ParamRow>
          <p className="field-hint">{BUILTIN_LUTS.find((l) => l.id === lutId)?.hint ?? (missing ? 'This LUT is not in the project any more; choose another or None.' : 'Imported .cube LUT.')}</p>
        </>
      )}
      {missing && <p className="field-hint warn">The chosen LUT is missing. The export will stop until you pick another LUT or None.</p>}
      <div className="cs-lut-actions">
        <button type="button" className="btn btn-small" onClick={onImport}><FileUp size={11} /> Import .cube…</button>
        {lutId && <button type="button" className="btn btn-small" onClick={() => onPatch({ lutId: '' }, true)}>Remove LUT</button>}
      </div>
      {imported.length > 0 && (
        <div className="cs-lut-list">
          <div className="cs-section-title">Imported into this project</div>
          {imported.map((l) => (
            <div key={l.id} className="cs-lut-item">
              <span>{l.name}</span>
              <small>{l.size}³</small>
              <button
                type="button"
                className="icon-btn small danger"
                disabled={used.has(l.id)}
                title={used.has(l.id) ? 'In use by a grade — remove it there first' : 'Remove from project'}
                onClick={() => onProjectLuts(imported.filter((entry) => entry.id !== l.id), `Remove LUT ${l.name}`)}
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="field-hint">Built-in camera conversions follow the manufacturers' published log curves and gamut matrices; for a camera's official LUT, import its .cube. Bhippi AI only adds a LUT when you ask it to.</p>
    </div>
  );
}
