// Chat harnesses other than the timeline editor (docs/PLUGIN-PLATFORM-PLAN.md). Each one's tools
// (harnesses.json, which the backend reads too) are the only tools its turns may call. The backend
// already keeps every other tool out of the model's sight and refuses it (src-tauri/src/harness.rs);
// this is the same check on the app side, so a call is refused here too whatever path it took.

import catalog from './ai-tools.json';
import harnesses from './harnesses.json';
import type { Toolset } from './toolRouter';

export type HarnessId = keyof typeof harnesses.harnesses;

const known = new Set((catalog as unknown as { tools: { name: string }[] }).tools.map((tool) => tool.name));

/** A harness's tools, as the backend loads them: names missing from the catalogue are dropped. */
export function harnessTools(id: HarnessId): ReadonlySet<string> {
  return new Set(harnesses.harnesses[id].tools.filter((name) => known.has(name)));
}

/** Why a harness turn may not call `name`, or null. */
export function harnessRefusal(id: HarnessId, name: string): string | null {
  if (harnessTools(id).has(name)) return null;
  return `${name} is not available in the ${harnesses.harnesses[id].label}. Only its own tools can be used here.`;
}

/** The toolset a harness's chat sends: its tools whole, no genres, no playbook. */
export function harnessToolset(id: HarnessId): Toolset {
  return { genres: [], full: [...harnessTools(id)] };
}
