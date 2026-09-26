// Settings › Avatar: Heli, the pixel producer who acts out what Bhippi AI is doing (or one of the
// other characters — Settings.avatarCharacter), its colours (Settings.avatarColors), and the council
// seats it dresses up as. The switch is Settings.avatar (off until the user turns it on); the stage plays
// the same poses the editor's avatar uses (src/avatar/poses.ts), so what you see here is what
// walks around the timeline.

import { useEffect, useRef, useState } from 'react';
import { Toggle } from '../components/ui';
import { COUNCIL, type CouncilRole } from '../lib/council';
import { poseAt, type AnimName } from '../avatar/poses';
import { ART_H, ART_W, CHARACTERS, COLOUR_SLOTS, paint, slotDefault, type Character } from '../avatar/sprite';
import type { Settings } from '../lib/types';
import '../styles/avatar.css';

type Props = { settings: Settings; onSettings: (settings: Settings) => void };

type Move = { anim: AnimName; label: string; when: string; color?: string };

const MOVES: Move[] = [
  { anim: 'research', label: 'Research', when: 'Glasses on, cross-legged at a laptop — web research, reading pages, finding licence-clear media.' },
  { anim: 'cut', label: 'Cut', when: 'Walks to the cut and snips it with scissors — every split the AI makes.' },
  { anim: 'carry', label: 'Add a clip', when: 'Carries the new clip in and puts it down where it lands on the timeline.', color: '#6fa8ff' },
  { anim: 'kick', label: 'Delete', when: 'Kicks the deleted clip off the timeline.' },
  { anim: 'draw', label: 'Animate', when: 'Eyeshade on, drawing frame after frame — motion scenes, keyframes, titles.' },
  { anim: 'mix', label: 'Mix', when: 'Headphones on at a mixer, nodding on the beat — levels, music, sound effects.' },
  { anim: 'direct', label: 'Direct', when: 'Beret on, framing the shot and slating it — layout, transitions, the plan.' },
  { anim: 'polish', label: 'Polish', when: 'Wipes the timeline down with a cloth — frame QA, the brand check, the council review.' },
  { anim: 'talk', label: 'Reply', when: 'Turns to the chat and talks with its hands while Bhippi AI writes its answer.' },
  { anim: 'ask', label: 'Question', when: 'Hand up, waiting on you, when Bhippi AI asks you something in the chat.' },
  { anim: 'dangle', label: 'Picked up', when: 'Grab Heli with the mouse: AHAHAHA — it wriggles to get loose until you let go, then lands where you drop it.' },
  { anim: 'slap', label: 'No no no', when: 'Touch a clip, a layer or a setting while the AI is working and Heli slaps your cursor away: no no no.' },
  { anim: 'celebrate', label: 'Done', when: 'A fist pump and a thumbs-up when the turn finishes.' },
  { anim: 'sleep', label: 'Nap', when: 'Nods off after a minute with nothing to do; wakes when you send a message.' },
];

const SEAT_ANIM: Record<CouncilRole, AnimName> = { researcher: 'research', animator: 'draw', audio: 'mix', director: 'direct', comedian: 'celebrate' };

/** One-shot moves loop on their own length so they keep playing on the stage. */
const LOOP: Partial<Record<AnimName, number>> = { slap: 1.6, kick: 1.6, place: 1.6, celebrate: 2.6, land: 1 };

export function PixelStage({ anim, scale, color, character, className }: { anim: AnimName; scale: number; color?: string; character?: Character; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    const start = performance.now();
    let raf = 0;
    let last = '';
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const t = (performance.now() - start) / 1000;
      const local = LOOP[anim] ? t % LOOP[anim]! : t;
      const key = `${Math.floor(local * 12)}`;
      if (key === last) return;
      last = key;
      paint(ctx, poseAt(anim, local, { color, character }));
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [anim, color, character]);
  return <canvas ref={canvas} className={className} width={ART_W} height={ART_H} style={{ width: ART_W * scale, height: ART_H * scale }} />;
}

export function AvatarSettings({ settings, onSettings }: Props) {
  const on = settings.avatar === true;
  const [move, setMove] = useState<Move>(MOVES[0]);
  const [seat, setSeat] = useState<CouncilRole | null>(null);
  const member = COUNCIL.find((entry) => entry.id === seat);
  const who = CHARACTERS.find((entry) => entry.id === settings.avatarCharacter) ?? CHARACTERS[0];
  const name = who.name;
  const colours = settings.avatarColors?.[who.id] ?? {};
  const custom = Object.keys(colours).length > 0;
  const setColours = (next: Record<string, string>) => {
    const all = { ...(settings.avatarColors ?? {}) };
    if (Object.keys(next).length) all[who.id] = next;
    else delete all[who.id];
    onSettings({ ...settings, avatarColors: all });
  };

  return (
    <div className="avatar-settings">
      <div className="settings-intro">
        <div>
          <h3>Avatar</h3>
          <p>{name} lives on your timeline and mirrors the chat: whatever Bhippi AI is doing right now — a tool, a search, writing its reply, thinking — {name} does, and when you press Stop, {name} stops too.</p>
        </div>
      </div>

      <div className="avatar-switch">
        <div className="avatar-switch-copy">
          <strong>Show {name} in the editor</strong>
          <span>{on ? `On — ${name} walks the timeline while Bhippi AI works.` : 'Off — nothing is drawn and nothing runs.'}</span>
        </div>
        <Toggle checked={on} onChange={(next) => onSettings({ ...settings, avatar: next })} label="Show the avatar" />
      </div>

      <h4>Character</h4>
      <div className="avatar-characters" role="radiogroup" aria-label="Choose the avatar">
        {CHARACTERS.map((entry) => (
          <button key={entry.id} type="button" role="radio" aria-checked={entry.id === who.id} className={`avatar-character${entry.id === who.id ? ' active' : ''}`}
            title={entry.title} onClick={() => onSettings({ ...settings, avatarCharacter: entry.id })}>
            <PixelStage anim={entry.id === who.id ? 'wave' : 'idle'} character={entry.id} scale={1.5} />
            <strong>{entry.name}</strong>
            <span>{entry.title}</span>
          </button>
        ))}
      </div>

      <div className="avatar-colours">
        <div className="avatar-colours-head">
          <h4>{name}’s colours</h4>
          {custom && <button type="button" className="btn btn-ghost btn-small" onClick={() => setColours({})}>Reset to original</button>}
        </div>
        <p className="muted small">Make {name} yours: every change is saved as your default and shows everywhere {name} appears. Each character keeps its own colours.</p>
        <div className="avatar-swatches">
          {COLOUR_SLOTS[who.id].map((slot) => (
            <label key={slot.id} className={`avatar-swatch${colours[slot.id] ? ' changed' : ''}`} title={colours[slot.id] ? `${slot.label}: your colour` : `${slot.label}: original`}>
              <input type="color" value={colours[slot.id] ?? slotDefault(who.id, slot)} onChange={(event) => setColours({ ...colours, [slot.id]: event.target.value })} aria-label={`${name} ${slot.label} colour`} />
              <span>{slot.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="avatar-stage-row">
        <div className="avatar-stage">
          <span className="avatar-stage-caption">{member ? `${member.name} — “${member.motto}”` : move.when}</span>
          <PixelStage anim={member ? SEAT_ANIM[member.id] : move.anim} color={move.color} character={who.id} scale={3} />
        </div>
        <div className="avatar-moves-col">
          <h4>What {name} does</h4>
          <div className="avatar-moves" role="group" aria-label="Preview a move">
            {MOVES.map((entry) => (
              <button key={entry.anim} type="button" className={`btn btn-small${!member && entry.anim === move.anim ? ' active' : ''}`} onClick={() => { setMove(entry); setSeat(null); }}>
                {entry.label}
              </button>
            ))}
          </div>
          <ul className="avatar-tips">
            <li><strong>Drag {name}</strong> anywhere: it laughs and wriggles to get loose, falls where you let go and makes that its new spot.</li>
            <li><strong>Click {name}</strong> for a giggle.</li>
            <li><strong>Hands off while it works:</strong> clips, layers and settings are {name}’s until Bhippi AI finishes. Playing, scrolling and zooming are fine.</li>
          </ul>
        </div>
      </div>

      <h4>The council</h4>
      <p className="muted small avatar-council-intro">
        Five specialists hold every video to their craft. When one of their tools runs — or Bhippi AI spawns one as a worker — {name} puts on that seat’s gear and its name tag.
      </p>
      <div className="avatar-council">
        {COUNCIL.map((entry) => (
          <button key={entry.id} type="button" className={`avatar-seat${seat === entry.id ? ' active' : ''}`} style={{ ['--seat' as string]: entry.color }} onClick={() => setSeat(entry.id)}>
            <PixelStage anim={SEAT_ANIM[entry.id]} character={who.id} scale={1} />
            <div>
              <strong>{entry.name}</strong>
              <span>{entry.title}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
