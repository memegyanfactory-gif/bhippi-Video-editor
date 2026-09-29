// Which editing workflow a message runs in when the composer is on Auto.
//
// Full (plan → gather → edit → polish, with analysis, storyboard, Judge and council) is for making
// a video. A targeted change — trim this, add a title, louder music, a note on one layer — runs as
// a Quick edit, so it is not put through the whole production pipeline. The user picks Auto, Full
// or Quick in the composer; the model never chooses its own workflow (docs/EDITORIAL-WORKFLOW-PLAN.md).

export type WorkflowChoice = 'auto' | 'full' | 'quick';
export type WorkflowMode = 'full' | 'quick';

const MAKE = /\b(make|create|produce|build|generate|plan|script|storyboard|assemble|cut together|edit together|turn)\b/i;
const PIECE = /\b(video|reel|reels|short|shorts|tiktok|film|movie|ad|advert|commercial|explainer|intro|outro|trailer|teaser|promo|vlog|documentary|montage|highlight reel|recap|music video|launch video|story)\b/i;
const WHOLE = /\b(from scratch|full (edit|production|video)|whole (video|edit)|start to finish|end to end|rough cut|first cut|final cut)\b/i;

/** Whether a message asks for a video to be made, rather than a change to one. */
export function asksForProduction(message: string): boolean {
  const text = message.trim();
  if (WHOLE.test(text)) return true;
  // "make a 40 s reel from this footage", "create an explainer about…", "turn this into a short".
  const make = MAKE.exec(text);
  return !!make && PIECE.test(text.slice(make.index));
}

/** "Carry on", "continue", "keep going", "finish it": a message that only resumes the job before it. */
const CONTINUE = /^\s*(please\s+)?(carry on|continue|keep going|go on|go ahead|resume|finish( it| the (job|task|video|edit))?|do it|proceed|pick up where)\b/i;
const LINK = /\bhttps?:\/\/\S+/i;
/** Long enough to be a brief (a script, a treatment), not a one-line change. */
const BRIEF_CHARS = 280;

/** Whether a message only resumes the job before it, rather than asking something new. */
export function continuesTheJob(message: string): boolean {
  const text = message.trim();
  return text.length <= 160 && CONTINUE.test(text);
}

/** What Auto reads besides the words: the state of the project and of the conversation. */
export type RouteSignals = {
  /** A planned production is under way on the open comp (its phases are the pipeline). */
  productionActive: boolean;
  /** The turn this message carries on (the Continue button, a retry): its workflow is kept. */
  continues?: WorkflowMode | null;
  /**
   * The last answer did not finish: its workflow (null on turns saved before it was recorded) and
   * the request it was working on. A "carry on" message resumes that job in the same workflow.
   */
  unfinished?: { mode: WorkflowMode | null; ask: string | null } | null;
  /** The message points at one place: monitor annotations, or a timeline selection sent to chat. */
  scoped?: boolean;
  /** The open comp has no picture yet (empty, or audio only): nothing exists to make a quick change to. */
  blank?: boolean;
};

/**
 * The workflow for one turn. Auto, in order:
 * - a turn that carries on another keeps that turn's workflow (a handover must not drop a
 *   production to Quick because "carry on" names no video);
 * - a production under way, or a message asking for a video to be made, runs Full;
 * - a message pointing at one place (annotation, selected layer) runs Quick;
 * - a brief or a reference link on a comp with no picture yet runs Full: there is nothing to change;
 * - anything else is a targeted change: Quick.
 */
export function routeWorkflow(choice: WorkflowChoice, message: string, signals: boolean | RouteSignals): WorkflowMode {
  if (choice !== 'auto') return choice;
  const s: RouteSignals = typeof signals === 'boolean' ? { productionActive: signals } : signals;
  if (s.continues) return s.continues;
  if (s.unfinished && continuesTheJob(message)) {
    if (s.unfinished.mode) return s.unfinished.mode;
    // An older turn with no recorded workflow: route the request it was working on instead.
    if (s.unfinished.ask) return routeWorkflow('auto', s.unfinished.ask, { ...s, unfinished: null });
  }
  if (s.productionActive || asksForProduction(message)) return 'full';
  if (s.scoped) return 'quick';
  if (s.blank && (LINK.test(message) || message.trim().length >= BRIEF_CHARS)) return 'full';
  return 'quick';
}

const KEY = 'bhippi.workflowChoice';

/** The composer's last choice (a per-machine convenience; Auto when unset or unreadable). */
export function savedWorkflowChoice(): WorkflowChoice {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'full' || value === 'quick' || value === 'auto' ? value : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveWorkflowChoice(choice: WorkflowChoice) {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
}
