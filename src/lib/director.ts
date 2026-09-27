// The Director's debate: three storyboards proposed in parallel, each critiqued by three seats,
// and a majority vote (the Director breaks a three-way tie).
//
// Proposals come from small, capped subagents (propose_storyboards in aiTools.ts). The critique
// and the vote are deterministic, so the "fight" costs no tokens: each seat scores every
// proposal on what it cares about, writes why, and votes for its best.
//   · Director — the plan holds together: it covers the whole running time in 3–12 s beats,
//     with every field save_storyboard needs.
//   · Animator — it moves: a graphic on each beat, variety between neighbours, motion verbs.
//   · Story    — it follows the voice: beats start on spoken words, each beat quotes its
//     evidence and designs its sound.

export type ProposedScene = {
  start: number;
  end: number;
  intent?: string;
  visual?: string;
  audio?: string;
  evidence?: string;
  title?: string;
  mogrt?: unknown;
  [key: string]: unknown;
};

export type Proposal = { angle: string; scenes: ProposedScene[] };
export type Seat = 'director' | 'animator' | 'story';
export type Critique = { seat: Seat; proposal: number; score: number; notes: string[] };
export type Debate = { winner: number; votes: Record<Seat, number>; critiques: Critique[]; tally: number[] };

const MOTION_VERBS = /\b(type[sd]?|typing|zoom|push|pull|reveal|pops?|morph|wipe|draws?|drawing|camera|parallax|animat\w*|slides?|sweeps?|counts?|lifts?|spins?|bounce|whip|orbit|dolly|truck|write[sn]? on|assembles?)\b/i;

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const mogrtId = (scene: ProposedScene) => (scene.mogrt && typeof scene.mogrt === 'object' ? text((scene.mogrt as { template?: unknown; id?: unknown }).template ?? (scene.mogrt as { id?: unknown }).id) : text(scene.mogrt));

/** Pulls the storyboard out of a proposer's reply: the first JSON object with a scenes array. */
export function parseProposal(reply: string, angle: string): Proposal | null {
  const tryParse = (raw: string) => {
    try {
      const value: unknown = JSON.parse(raw);
      const scenes = Array.isArray(value) ? value : value && typeof value === 'object' ? (value as { scenes?: unknown }).scenes : null;
      if (!Array.isArray(scenes)) return null;
      const clean = scenes.filter((s): s is ProposedScene => !!s && typeof s === 'object' && Number.isFinite(Number((s as ProposedScene).start)) && Number.isFinite(Number((s as ProposedScene).end)))
        .map((s) => ({ ...s, start: Number(s.start), end: Number(s.end) }));
      return clean.length ? { angle, scenes: clean } : null;
    } catch {
      return null;
    }
  };
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    const found = tryParse(fenced[1]);
    if (found) return found;
  }
  const start = reply.search(/[[{]/);
  if (start < 0) return null;
  for (let end = reply.length; end > start; end = reply.lastIndexOf(reply[start] === '{' ? '}' : ']', end - 1)) {
    const found = tryParse(reply.slice(start, end + 1));
    if (found) return found;
    if (end <= start) break;
  }
  return null;
}

function directorSeat(p: Proposal, duration: number): { score: number; notes: string[] } {
  const notes: string[] = [];
  const scenes = [...p.scenes].sort((a, b) => a.start - b.start);
  let covered = 0;
  let cursor = 0;
  for (const scene of scenes) {
    const from = Math.max(cursor, scene.start);
    if (scene.end > from) covered += Math.min(scene.end, duration) - from;
    cursor = Math.max(cursor, scene.end);
  }
  const coverage = duration > 0 ? Math.min(1, covered / duration) : 0;
  if (coverage < 0.95) notes.push(`covers ${Math.round(coverage * 100)}% of the ${duration.toFixed(1)} s`);
  const badLength = scenes.filter((s) => s.end - s.start < 3 || s.end - s.start > 12).length;
  if (badLength) notes.push(`${badLength} beat(s) outside 3–12 s`);
  const incomplete = scenes.filter((s) => text(s.intent).length < 20 || text(s.visual).length < 120 || text(s.audio).length < 40).length;
  if (incomplete) notes.push(`${incomplete} beat(s) too thin for save_storyboard (intent ≥20, visual ≥120, audio ≥40 chars)`);
  const score = coverage * 0.45 + (1 - badLength / Math.max(1, scenes.length)) * 0.2 + (1 - incomplete / Math.max(1, scenes.length)) * 0.35;
  return { score, notes: notes.length ? notes : ['holds together: full coverage, well-sized beats, complete fields'] };
}

function animatorSeat(p: Proposal): { score: number; notes: string[] } {
  const notes: string[] = [];
  const scenes = p.scenes;
  const withGraphic = scenes.filter((s) => mogrtId(s)).length;
  const moving = scenes.filter((s) => MOTION_VERBS.test(text(s.visual))).length;
  let repeats = 0;
  for (let i = 1; i < scenes.length; i++) if (mogrtId(scenes[i]) && mogrtId(scenes[i]) === mogrtId(scenes[i - 1])) repeats++;
  const distinct = new Set(scenes.map(mogrtId).filter(Boolean)).size;
  if (withGraphic < scenes.length) notes.push(`${scenes.length - withGraphic} beat(s) without a designed graphic`);
  if (moving < scenes.length) notes.push(`${scenes.length - moving} beat(s) that do not say what moves`);
  if (repeats) notes.push(`${repeats} neighbour(s) reuse the same template`);
  const n = Math.max(1, scenes.length);
  const score = (withGraphic / n) * 0.35 + (moving / n) * 0.35 + (1 - repeats / n) * 0.15 + Math.min(1, distinct / Math.max(1, Math.ceil(n * 0.6))) * 0.15;
  return { score, notes: notes.length ? notes : ['every beat moves, with variety'] };
}

function storySeat(p: Proposal, wordStarts: number[]): { score: number; notes: string[] } {
  const notes: string[] = [];
  const scenes = p.scenes;
  const n = Math.max(1, scenes.length);
  const onWord = wordStarts.length ? scenes.filter((s) => wordStarts.some((t) => Math.abs(t - s.start) <= 0.35)).length : n;
  const quoted = scenes.filter((s) => /["“'‘]|\d+(\.\d+)?\s*s\b/.test(text(s.evidence)) && text(s.evidence).length >= 12).length;
  const sound = scenes.filter((s) => /\b(sfx|whoosh|hit|tick|riser|swell|duck|music|bed|glint|pop|click|impact|beat)\b/i.test(text(s.audio))).length;
  if (onWord < n) notes.push(`${n - onWord} beat(s) start between spoken words`);
  if (quoted < n) notes.push(`${n - quoted} beat(s) without a quoted line as evidence`);
  if (sound < n) notes.push(`${n - sound} beat(s) with no sound design named`);
  const score = (onWord / n) * 0.4 + (quoted / n) * 0.3 + (sound / n) * 0.3;
  return { score, notes: notes.length ? notes : ['follows the voice, beat by beat'] };
}

/** Every seat scores every proposal, then votes; majority wins, the Director breaks a tie. */
export function debate(proposals: Proposal[], duration: number, wordStarts: number[] = []): Debate {
  const critiques: Critique[] = [];
  for (const [i, p] of proposals.entries()) {
    critiques.push({ seat: 'director', proposal: i, ...directorSeat(p, duration) });
    critiques.push({ seat: 'animator', proposal: i, ...animatorSeat(p) });
    critiques.push({ seat: 'story', proposal: i, ...storySeat(p, wordStarts) });
  }
  const best = (seat: Seat) => critiques.filter((c) => c.seat === seat).reduce((top, c) => (c.score > top.score ? c : top)).proposal;
  const votes: Record<Seat, number> = { director: best('director'), animator: best('animator'), story: best('story') };
  const tally = proposals.map((_, i) => Object.values(votes).filter((v) => v === i).length);
  const most = Math.max(...tally);
  const leaders = tally.flatMap((count, i) => (count === most ? [i] : []));
  const winner = leaders.length === 1 ? leaders[0] : votes.director;
  return { winner, votes, critiques: critiques.map((c) => ({ ...c, score: Math.round(c.score * 100) / 100 })), tally };
}

/** The three angles the proposers take, each a different idea of what makes this video good. */
export const ANGLES: { id: string; persona: string }[] = [
  { id: 'story-first', persona: 'You are a story director. You build the film around the voice-over: every beat is one spoken idea, the hook lands in the first 2 seconds, the emotional turn and the payoff are clear, and each beat quotes the line it illustrates.' },
  { id: 'motion-first', persona: 'You are a motion designer. You build the film from striking, varied motion: every beat has a designed graphic (a template or scene) that moves, no two neighbours look alike, camera moves and hidden transitions carry the eye.' },
  { id: 'product-first', persona: 'You are a performance-ad strategist. You build the film to sell: the problem is felt, the product is shown in use early, proof lands on a number, and the offer and call to action are unmissable.' },
];
