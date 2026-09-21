// Undo/redo over whole-project snapshots. Continuous gestures (dragging, typing) update the
// present in place and commit once, so one drag is one undo step. Which comps are open in the
// timeline is view state: it rides along unchanged through undo and redo, and changing it is
// never an undo step.
import { useCallback, useMemo, useRef, useState } from 'react';
import { healProject } from './timeline';
import type { Project } from './types';

const LIMIT = 300;

type Entry = { project: Project; label: string };
type State = { past: Entry[]; present: Project; presentLabel: string; future: Entry[]; pending: Project | null };

/** Keeps the open tabs of `view` on `project`, as far as those comps still exist. */
function withView(project: Project, view: Project): Project {
  const ids = new Set(project.comps.map((comp) => comp.id));
  const open = view.openCompIds.filter((id) => ids.has(id));
  const active = view.activeCompId && ids.has(view.activeCompId) ? view.activeCompId : (open[0] ?? project.comps[0]?.id ?? null);
  if (active === project.activeCompId && open.join() === project.openCompIds.join()) return project;
  return { ...project, activeCompId: active, openCompIds: active && !open.includes(active) ? [...open, active] : open };
}

export function useHistory(initial: Project) {
  const [state, setState] = useState<State>({ past: [], present: initial, presentLabel: 'Open', future: [], pending: null });
  const stateRef = useRef(state);
  stateRef.current = state;

  /** A finished edit: becomes one undo step.
   *
   * Healed on the way in. This is the one place every finished edit passes through, whoever
   * made it — a drag, a tool call, the assistant — so it is the only place that can promise
   * the project on screen is one the backend will accept. Without that promise a single bad
   * edit stops every autosave from then on. A gesture in flight is left alone: `preview` can
   * overlap freely, and `settle` is where it has to be true again. */
  const commit = useCallback((next: Project | ((current: Project) => Project), label = 'Edit') => {
    setState((current) => {
      const value = healProject(typeof next === 'function' ? next(current.present) : next);
      if (value === current.present) return current.pending ? { ...current, pending: null } : current;
      const base = current.pending ?? current.present;
      return { past: [...current.past, { project: base, label: current.presentLabel }].slice(-LIMIT), present: value, presentLabel: label, future: [], pending: null };
    });
  }, []);

  /** A step inside a gesture: shows immediately, undoes together with the gesture's settle. */
  const preview = useCallback((next: Project | ((current: Project) => Project)) => {
    setState((current) => {
      const value = typeof next === 'function' ? next(current.present) : next;
      if (value === current.present) return current;
      return { ...current, present: value, pending: current.pending ?? current.present };
    });
  }, []);

  /** Ends a gesture started with `preview`. */
  const settle = useCallback((label = 'Edit') => {
    setState((current) => {
      if (!current.pending || current.pending === current.present) return { ...current, pending: null };
      const present = healProject(current.present);
      return { past: [...current.past, { project: current.pending, label: current.presentLabel }].slice(-LIMIT), present, presentLabel: label, future: [], pending: null };
    });
  }, []);

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

  const undo = useCallback(() => {
    setState((current) => {
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
    });
  }, []);

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
      current: () => stateRef.current.present,
      gesture: () => stateRef.current.pending !== null,
    }),
    [state, commit, preview, settle, cancel, view, reset, undo, redo, jump],
  );
}

export type History = ReturnType<typeof useHistory>;
