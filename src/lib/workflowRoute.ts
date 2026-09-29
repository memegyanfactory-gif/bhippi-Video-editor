// Which editing workflow a message runs in when the composer is on Auto.
//
// Full (plan → gather → edit → polish, with analysis, storyboard, Judge and council) is for making
// a video. A targeted change — trim this, add a title, louder music — runs as a Quick edit, so it
// is not put through the whole production pipeline. The user picks Auto, Full or Quick in the
// composer; the model never chooses its own workflow (docs/EDITORIAL-WORKFLOW-PLAN.md).

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

/**
 * The workflow for one turn. Auto: Full while a planned production is under way (its phases are
 * the pipeline) or when the message asks for a video to be made; otherwise Quick.
 */
export function routeWorkflow(choice: WorkflowChoice, message: string, productionActive: boolean): WorkflowMode {
  if (choice !== 'auto') return choice;
  return productionActive || asksForProduction(message) ? 'full' : 'quick';
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
