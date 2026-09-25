// A plugin: a small web app that lives inside Bhippi. It is one HTML document (with its own
// scripts and styles) that runs in a sandboxed frame and reaches the editor only through the
// `bhippi` SDK (src/plugins/sdk.ts) — so everything it does passes the same rules as Bhippi AI.

export type PluginPermissions = {
  /**
   * Bhippi tools the plugin may run through `bhippi.tool()`. Tools that only read are always
   * allowed. `'*'` covers every other tool except the sensitive ones (shell, file writes, deletes),
   * which have to be named one by one.
   */
  tools: string[];
  /** Hosts the plugin may talk to (fetch / WebSocket). Empty means no network at all. */
  network: string[];
  /** Whether it may send messages to the Bhippi AI chat (`bhippi.chat()`). */
  chat: boolean;
};

/** An earlier version of a plugin's page, kept so a change can be taken back. */
export type PluginRevision = { at: string; html: string; note: string };

export type Plugin = {
  version: 1;
  /** Lower-case letters, digits, dashes, underscores; it names the page file. */
  id: string;
  name: string;
  description: string;
  /** One emoji or a short glyph for the panel tab. */
  icon?: string;
  /** The plugin's page: an HTML document or fragment with inline <script> and <style>. */
  html: string;
  permissions: PluginPermissions;
  /** Keep running while the panel is not showing it — for automations that react to events. */
  background: boolean;
  /** Off: never loaded, not listed to the AI. */
  enabled: boolean;
  /** Shown as a tab in the Plugins panel. */
  panel: boolean;
  author: 'ai' | 'user';
  createdAt: string;
  updatedAt: string;
  revision: number;
  /** The last few pages before this one, newest first. */
  revisions?: PluginRevision[];
};

/** One line from a running plugin's console, or a call it made. */
export type PluginLog = { at: number; level: 'log' | 'info' | 'warn' | 'error' | 'call'; text: string };

/** Something a running plugin offers Bhippi AI (`bhippi.expose()`). */
export type PluginAction = { plugin: string; name: string; description: string; params?: Record<string, unknown> };
