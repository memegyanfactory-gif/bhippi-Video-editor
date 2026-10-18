// Live read-outs for the Music Studio's top bar: the LCD position display and the master LED meter.
// Both repaint every animation frame from the engine without re-rendering React.
import { useRef } from 'react';
import { LedMeter } from './Meters';
import { useActions, useStudio } from './ctx';
import { lcdClock, lcdPosition } from './format';
import { useRaf } from './studioUtil';

export function Readout() {
  const { song, ui } = useStudio();
  const { engine } = useActions();
  const bars = useRef<HTMLSpanElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  useRaf(true, () => {
    const pos = engine.playing ? engine.position() : song.view.mode === 'song' ? ui.playFrom : 0;
    if (bars.current) bars.current.textContent = lcdPosition(song, pos);
    if (clock.current) clock.current.textContent = lcdClock(song, pos);
  });
  return (
    <div className="ms-lcd ms-lcd-pos" role="timer" aria-label="Position" title="Position: bar:beat:tick and minutes:seconds.milliseconds">
      <span className="ms-lcd-label">Position</span>
      <span ref={bars} className="ms-lcd-main">001:1:00</span>
      <span ref={clock} className="ms-lcd-sub">0:00.000</span>
    </div>
  );
}

export function MasterMeter() {
  return (
    <div className="ms-master-meter" role="meter" aria-label="Master level" title="Master level">
      <LedMeter insert={0} className="ms-led-master" />
    </div>
  );
}
