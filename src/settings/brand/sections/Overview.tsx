import type { BrandPersonality } from '../../../lib/brandKit';
import { PERSONALITY_AXES, personalityOf, personalityPhrase } from '../../../lib/brandKit/studio';
import type { BrandHealth, HealthCheck } from '../../../lib/brandKit/health';
import { HealthCard } from '../HealthCard';
import { ChipsInput, Field, Group, faceStyle, type SectionProps } from '../shared';

const VALUE_IDEAS = ['Craft', 'Clarity', 'Curiosity', 'Care', 'Courage', 'Speed', 'Trust', 'Play'];

export function Overview({ kit, onPatch, onReplace, health, onJump }: SectionProps & { health: BrandHealth; onJump: (s: HealthCheck['section']) => void }) {
  const personality = personalityOf(kit);
  const setAxis = (key: keyof BrandPersonality, value: number) => onPatch('identity', { personality: { ...personality, [key]: Math.round(value * 100) / 100 } });
  return (
    <div className="bs-overview">
      <div className="bs-ov-main">
        <div className="bs-ov-name">
          <input className="bs-name-input" style={faceStyle(kit.typography.display)} value={kit.name} aria-label="Brand name" placeholder="Brand name" onChange={(e) => onPatch('identity', { name: e.target.value })} />
          <input className="bs-tag-input" style={{ fontFamily: kit.typography.body.family }} value={kit.tagline} aria-label="Tagline" placeholder="A tagline that says it in a line" onChange={(e) => onPatch('identity', { tagline: e.target.value })} />
        </div>
        <Field label="Description">
          <textarea className="bs-text" rows={3} value={kit.description} placeholder="What the brand does and why it exists." onChange={(e) => onPatch('identity', { description: e.target.value })} />
        </Field>
        <div className="bs-two">
          <Field label="Audience"><input className="bs-input" value={kit.audience} placeholder="Who it is for" onChange={(e) => onPatch('identity', { audience: e.target.value })} /></Field>
          <Field label="Industry"><input className="bs-input" value={kit.industry} placeholder="Where it lives" onChange={(e) => onPatch('identity', { industry: e.target.value })} /></Field>
        </div>
        <Group label="Values" hint="What it stands for. The AI writes toward these.">
          <ChipsInput value={kit.values} onChange={(values) => onPatch('identity', { values: values.slice(0, 8) })} placeholder="Add a value" suggestions={VALUE_IDEAS} />
        </Group>
        <Group label="Personality" hint={`Reads as ${personalityPhrase(personality)}.`}>
          <div className="bs-axes">
            {PERSONALITY_AXES.map(({ key, left, right }) => (
              <div key={key} className="bs-axis">
                <div className="bs-axis-ends"><span className={personality[key] < 0.4 ? 'on' : ''}>{left}</span><span className={personality[key] > 0.6 ? 'on' : ''}>{right}</span></div>
                <div className="bs-axis-track">
                  <input type="range" min={0} max={1} step={0.01} value={personality[key]} aria-label={`${left} to ${right}`} onChange={(e) => setAxis(key, Number(e.target.value))} />
                  <i className="bs-axis-mid" />
                  <b className="bs-axis-dot" style={{ left: `${personality[key] * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Group>
        <Field label="One-line character" hint="what the AI is told">
          <input className="bs-input" value={kit.voice} onChange={(e) => onPatch('identity', { voice: e.target.value })} />
        </Field>
      </div>
      <aside className="bs-ov-side">
        <HealthCard kit={kit} health={health} onReplace={onReplace} onJump={onJump} />
      </aside>
    </div>
  );
}
