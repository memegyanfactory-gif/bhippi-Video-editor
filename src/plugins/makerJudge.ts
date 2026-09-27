// The Plugin Maker's Judge: one score for a plugin, from its draft's static checks
// (drafts.ts validateDraft) and a test run against a scratch project (testRunner.ts). Everything
// is measured, so the score is free, repeatable and cannot be talked up. Pass mark 80; the Maker's
// prompt stops after 3 rounds either way.

import type { DraftCheck } from './drafts';

export const PLUGIN_PASS_MARK = 80;

/** What a test run saw (testRunner.ts). */
export type TestReport = {
  loaded: boolean;
  loadMs: number | null;
  errors: string[];
  warnings: number;
  checks: { name: string; ok: boolean; error?: string; ms: number }[];
  /** Calls refused by the plugin's permissions or the user's permission mode. */
  refused: { name: string; error: string }[];
  /** Calls not really run during a test (they would touch files, the network or the shell). */
  skipped: string[];
  calls: number;
  /** Undo steps the plugin made on the scratch project. */
  edits: number;
  actions: string[];
  logs: string[];
};

export type Criterion = { id: string; label: string; weight: number; score: number; note: string };
export type PluginVerdict = { score: number; pass: boolean; criteria: Criterion[]; fixes: string[] };

const has = (warnings: string[], text: RegExp) => warnings.some((warning) => text.test(warning));

export function judgePlugin(check: DraftCheck | null, run: TestReport): PluginVerdict {
  const criteria: Criterion[] = [];
  const fixes: string[] = [];
  const add = (id: string, label: string, weight: number, score: number, note: string, fix?: string) => {
    criteria.push({ id, label, weight, score: Math.max(0, Math.min(1, score)), note });
    if (fix && score < 1) fixes.push(fix);
  };

  add('loads', 'Loads', 20, run.loaded ? 1 : 0, run.loaded ? `connected in ${run.loadMs} ms` : 'never connected to Bhippi',
    'It never loaded: a syntax error or a script that throws before the SDK starts. Read the errors below and plugin_logs.');

  const errors = run.errors.length;
  add('console', 'Clean console', 15, errors === 0 ? 1 : errors === 1 ? 0.5 : 0, errors ? `${errors} error${errors === 1 ? '' : 's'}` : 'no errors',
    `Fix the console error${errors === 1 ? '' : 's'}: ${run.errors.slice(0, 3).join(' | ')}`);

  const total = run.checks.length;
  const passed = run.checks.filter((item) => item.ok).length;
  const failed = run.checks.filter((item) => !item.ok);
  add('checks', 'Acceptance checks', 25, total ? passed / total : 0, total ? `${passed}/${total} pass` : 'none written',
    total
      ? `Make the failing checks pass: ${failed.slice(0, 3).map((item) => `“${item.name}”: ${item.error ?? 'failed'}`).join(' | ')}`
      : "Write the spec's acceptance checks as bhippi.test() calls in app.js.");

  const refused = run.refused.length;
  add('calls', 'Calls honoured', 10, refused ? 0 : 1, refused ? `${refused} refused` : `${run.calls} call${run.calls === 1 ? '' : 's'}, none refused`,
    `Calls were refused: ${run.refused.slice(0, 3).map((item) => `${item.name} (${item.error})`).join(' | ')}. Add the tool to permissions, or handle the refusal in the UI.`);

  if (check) {
    const permissionIssues = check.missing.length + (check.unused.length ? 1 : 0) + (check.manifest?.permissions.tools.includes('*') ? 1 : 0);
    add('permissions', 'Least permissions', 10, 1 - permissionIssues * 0.5, permissionIssues ? `${permissionIssues} issue${permissionIssues === 1 ? '' : 's'}` : 'exactly what it calls',
      'Trim permissions to exactly the tools the code calls (plugin_validate lists them).');

    const craft = [/bhippi\.ready/, /error handling/i, /CSS variables/, /code still has TODOs/, /computed tool name/].filter((text) => has(check.warnings, text));
    add('craft', 'Craft', 10, 1 - craft.length * 0.25, craft.length ? `${craft.length} gap${craft.length === 1 ? '' : 's'}` : 'ready, errors shown, themed',
      `Fix the craft warnings from plugin_validate: ${check.warnings.filter((warning) => craft.some((text) => text.test(warning))).join(' ')}`);

    const specMissing = has(check.warnings, /No spec\.md/);
    const specGaps = has(check.warnings, /spec\.md is missing|spec\.md still has TODOs/);
    add('spec', 'Spec', 10, specMissing ? 0 : specGaps ? 0.5 : 1, specMissing ? 'no spec.md' : specGaps ? 'incomplete' : 'complete',
      'Finish spec.md: what it does, UI, tools, permissions and acceptance checks, with no TODOs.');
  } else {
    add('permissions', 'Least permissions', 10, 0, 'no draft to check', 'Open the draft (plugin_list_files) so its permissions and spec can be checked.');
    add('craft', 'Craft', 10, 0, 'no draft to check');
    add('spec', 'Spec', 10, 0, 'no draft to check');
  }

  const score = Math.round(criteria.reduce((sum, item) => sum + item.score * item.weight, 0));
  return { score, pass: score >= PLUGIN_PASS_MARK, criteria, fixes };
}
