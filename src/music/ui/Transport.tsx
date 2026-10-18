// Live read-outs for the Music Studio's top bar: the position display and the master level meter.
// Both repaint every animation frame from the engine without re-rendering React.
import { useRef } from 'react';
import { useActions, useStudio } from './ctx';
import { barBeatStep, clockText, meterLevel } from './format';
import { useRaf } from './studioUtil';

export function Readout() {
  const { song, ui } = useStudio();
  const { engine } = useActions();
  const bars = useRef<HTMLSpanElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  useRaf(true, () => {
    const pos = ui.playing ? engine.position() : song.view.mode === 'song' ? ui.playFrom : 0;
    if (bars.current) bars.current.textContent = barBeatStep(song, pos);
    if (clock.current) clock.current.textContent = clockText(song, pos);
  });
  return (
    <div className="ms-readout" role="timer" aria-label="Position" title="Position (bar:beat:step and minutes:seconds)">
      <span ref={bars} className="ms-readout-main">1:1:1</span>
      <span ref={clock} className="ms-readout-sub">0:00.0</span>
    </div>
  );
}

export function MasterMeter() {
  const { engine } = useActions();
  const l = useRef<HTMLDivElement>(null);
  const r = useRef<HTMLDivElement>(null);
  const held = useRef([0, 0]);
  useRaf(true, () => {
    const m = engine.meters()[0];
    held.current = [Math.max(meterLevel(m?.peakL ?? 0), held.current[0] * 0.92), Math.max(meterLevel(m?.peakR ?? 0), held.current[1] * 0.92)];
    if (l.current) l.current.style.transform = `scaleX(${held.current[0]})`;
    if (r.current) r.current.style.transform = `scaleX(${held.current[1]})`;
  });
  return (
    <div className="ms-master-meter" role="meter" aria-label="Master level" title="Master level">
      <div><div ref={l} className="ms-meter-fill h" /></div>
      <div><div ref={r} className="ms-meter-fill h" /></div>
    </div>
  );
}
