// Undo/redo over whole-project snapshots. Continuous gestures (dragging, typing) update the
// present in place and commit once, so one drag is one undo step. Which comps are open in the
// timeline is view state: it rides along unchanged through undo and redo, and changing it is
// never an undo step.
import { useCallback, useMemo, useRef, useState } from 'react';
import { healProject } from './timeline';
import type { Project } from './types';
import { actionLogger } from './actionLogger';

const LIMIT = 300;

type Entry = { project: Project; label: string };
export type HistoryState = { past: Entry[]; present: Project; presentLabel: string; future: Entry[]; pending: Project | null };
type State = HistoryState;
/** A gesture step: from the present, or from `start` — where the gesture began, with any edit made since. */
type Step = Project | ((present: Project, start: Project) => Project);

export const historyStart = (project: Project): State => ({ past: [], present: project, presentLabel: 'Open', future: [], pending: null });

/**
 * A finished edit: becomes one undo step.
 *
 * Healed on the way in. This is the one place every finished edit passes through, whoever
 * made it — a drag, a tool call, the assistant — so it is the only place that can promise
 * the project on screen is one the backend will accept. Without that promise a single bad
 * edit stops every autosave from then on.
 *
 * During a gesture the edit is rebased instead of ending it: it applies to where the gesture
 * started and to what it shows now, and becomes its own undo step under the gesture's. A
 * gesture that rebuilds each step from its start (`preview`'s second argument) then keeps the
 * edit — the assistant's work is not lost to a drag that happened to be in flight.
 */
export function commitStep(current: State, next: Project | ((current: Project) => Project), label: string): State {
  const change = (project: Project) => healProject(typeof next === 'function' ? next(project) : next);
  if (current.pending) {
    const pending = change(current.pending);
    const present = change(current.present);
    if (pending === current.pending && present === current.present) return current;
    return { past: [...current.past, { project: current.pending, label: current.presentLabel }].slice(-LIMIT), present, presentLabel: label, future: [], pending };
  }
  const value = change(current.present);
  if (value === current.present) return current;
  return { past: [...current.past, { project: current.present, label: current.presentLabel }].slice(-LIMIT), present: value, presentLabel: label, future: [], pending: null };
}

/** A step inside a gesture: shows immediately, undoes together with the gesture's settle. */
export function previewStep(current: State, next: Step): State {
  const value = typeof next === 'function' ? next(current.present, current.pending ?? current.present) : next;
  if (value === current.present) return current;
  return { ...current, present: value, pending: current.pending ?? current.present };
}

/** Ends a gesture started with `preview`. */
export function settleStep(current: State, label: string): State {
  if (!current.pending || current.pending === current.present) return { ...current, pending: null };
  const present = healProject(current.present);
  return { past: [...current.past, { project: current.pending, label: current.presentLabel }].slice(-LIMIT), present, presentLabel: label, future: [], pending: null };
}

/**
 * Folds every undo step made since the project was `before` into one, named `label`: a plugin's
 * `bhippi.batch` runs many tools and the user undoes them together. Nothing happens during a
 * gesture, or when `before` has already left the history.
 */
export function squashStep(current: State, before: Project, label: string): State {
  if (current.pending || current.present === before) return current;
  let at = -1;
  for (let index = current.past.length - 1; index >= 0; index--) {
    if (current.past[index].project === before) {
      at = index;
      break;
    }
  }
  if (at < 0) return current;
  return { ...current, past: current.past.slice(0, at + 1), presentLabel: label, future: [] };
}

/**
 * An AI turn's steps folded into one undo step named `label` — but only when every step since
 * `before` is the assistant's (`AI: …`). A user edit made while the turn ran keeps the steps
 * apart, so undoing the turn can never take the user's own work with it.
 */
export function squashTurnStep(current: State, before: Project, label: string): State {
  if (current.pending || current.present === before) return current;
  let at = -1;
  for (let index = current.past.length - 1; index >= 0; index--) {
    if (current.past[index].project === before) {
      at = index;
      break;
    }
  }
  if (at < 0) return current;
  const folded = [...current.past.slice(at + 1).map((entry) => entry.label), current.presentLabel];
  if (!folded.every((name) => name.startsWith('AI: '))) return current;
  return squashStep(current, before, label);
}

export function undoStep(current: State): State {
  const base = current.pending ?? current.present;
  if (current.past.length === 0) return current.pending ? { ...current, present: base, pending: null } : current;
  const previous = current.past[current.past.length - 1];
  return {
    past: current.past.slice(0, -1),
    present: withView(previous.project, current.present),
    presentLabel: previous.label,
    future: [{ project: base, label: current.presentLabel }, ...current.future],
    pending: null,
  };
}

/** Keeps the open tabs of `view` on `project`, as far as those comps still exist. */
function withView(project: Project, view: Project): Project {
  const ids = new Set(project.comps.map((comp) => comp.id));
  const open = view.openCompIds.filter((id) => ids.has(id));
  const active = view.activeCompId && ids.has(view.activeCompId) ? view.activeCompId : (open[0] ?? project.comps[0]?.id ?? null);
  if (active === project.activeCompId && open.join() === project.openCompIds.join()) return project;
  return { ...project, activeCompId: active, openCompIds: active && !open.includes(active) ? [...open, active] : open };
}

export function useHistory(initial: Project) {
  const [state, setState] = useState<State>(() => historyStart(initial));
  const stateRef = useRef(state);
  stateRef.current = state;

  /** A finished edit: becomes one undo step (see `commitStep`). */
  const commit = useCallback((next: Project | ((current: Project) => Project), label = 'Edit') => {
    actionLogger.log(
      label.startsWith('AI: ') ? 'ai' : 'user',
      'info',
      label.startsWith('AI: ') ? label : `User Edit: ${label}`
    );
    setState((current) => commitStep(current, next, label));
  }, []);

  /** A step inside a gesture: shows immediately, undoes together with the gesture's settle. */
  const preview = useCallback((next: Step) => setState((current) => previewStep(current, next)), []);

  /** Ends a gesture started with `preview`. */
  const settle = useCallback((label = 'Edit') => setState((current) => settleStep(current, label)), []);

  /** Abandons a gesture: back to how it started. */
  const cancel = useCallback(() => {
    setState((current) => (current.pending ? { ...current, present: current.pending, pending: null } : current));
  }, []);

  /** View-only change (open tabs, active comp): no undo step. */
  const view = useCallback((change: (current: Project) => Project) => {
    setState((current) => ({ ...current, present: change(current.present) }));
  }, []);

  /** Replaces everything (opening a project): no undo across the boundary. */
  const reset = useCallback(
    (project: Project) => setState({ past: [], present: healProject(project), presentLabel: 'Open', future: [], pending: null }),
    [],
  );

  const undo = useCallback(() => setState(undoStep), []);

  /** Makes everything since `before` one undo step (see `squashStep`). */
  const squash = useCallback((before: Project, label: string) => setState((current) => squashStep(current, before, label)), []);

  /** Makes an AI turn one undo step, when nobody else edited meanwhile (see `squashTurnStep`). */
  const squashTurn = useCallback((before: Project, label: string) => setState((current) => squashTurnStep(current, before, label)), []);

  const redo = useCallback(() => {
    setState((current) => {
      if (current.future.length === 0) return current;
      const [next, ...rest] = current.future;
      return { past: [...current.past, { project: current.present, label: current.presentLabel }], present: withView(next.project, current.present), presentLabel: next.label, future: rest, pending: null };
    });
  }, []);

  /** Steps back (negative) or forward to a point in the History panel. */
  const jump = useCallback((steps: number) => {
    for (let index = 0; index < Math.abs(steps); index++) (steps < 0 ? undo : redo)();
  }, [undo, redo]);

  return useMemo(
    () => ({
      project: state.present,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      undoLabel: state.presentLabel,
      redoLabel: state.future[0]?.label ?? '',
      steps: { past: state.past.map((entry) => entry.label), present: state.presentLabel, future: state.future.map((entry) => entry.label) },
      commit,
      preview,
      settle,
      cancel,
      view,
      reset,
      undo,
      redo,
      jump,
      squash,
      squashTurn,
      current: () => stateRef.current.present,
      gesture: () => stateRef.current.pending !== null,
    }),
    [state, commit, preview, settle, cancel, view, reset, undo, redo, jump, squash, squashTurn],
  );
}

export type History = ReturnType<typeof useHistory>;
