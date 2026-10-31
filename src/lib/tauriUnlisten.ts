// Tauri 2.11 throws "Cannot read properties of undefined (reading 'handlerId')" when a listener is
// removed after it is already gone (removed twice, or its page reloaded): its unregister script
// reads the listener without checking it is there. Tauri 2.12 checks first; this is that check
// until Bhippi moves to 2.12. The throw comes before the unlisten reaches Rust, so swallowing it
// lets the rest of the unlisten run.

type EventInternals = { unregisterListener?: (event: string, eventId: number) => void };

/** Makes removing an already-removed Tauri event listener a no-op. Safe to call more than once. */
export function guardTauriUnlisten(win: object) {
  const internals = (win as { __TAURI_EVENT_PLUGIN_INTERNALS__?: EventInternals }).__TAURI_EVENT_PLUGIN_INTERNALS__;
  const unregister = internals?.unregisterListener;
  if (!internals || !unregister || (unregister as { guarded?: boolean }).guarded) return;
  const guarded = (event: string, eventId: number) => {
    try {
      unregister(event, eventId);
    } catch {
      // Already unregistered.
    }
  };
  internals.unregisterListener = Object.assign(guarded, { guarded: true });
}
