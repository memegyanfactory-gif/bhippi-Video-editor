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
  /** Whether it may offer messages for the Bhippi AI chat (`bhippi.chat()`); the user sends them. */
  chat: boolean;
  /**
   * Bhippi services beyond the tools that cost the user something (capabilities.ts): `transcribe`
   * (new transcriptions) and `ai` (questions to the user's AI model). Absent means none.
   */
  services?: string[];
};

/** An earlier version of a plugin's page, kept so a change can be taken back. */
export type PluginRevision = { at: string; html: string; note: string };

/** Where an installed package came from, and which version of it is running (package.ts). */
export type PluginPackage = {
  /** Semver of the running version. */
  version: string;
  author?: string;
  source: 'local' | 'file' | 'marketplace';
  installedAt: string;
  /** SHA-256 of the running version's manifest.lock: which exact files run. */
  lockHash: string;
};

export type Plugin = {
  version: 1;
  /**
   * 2 for a plugin built from Plugin Maker drafts or installed from a package: it runs under the
   * strict page policy (its own code only, no CDN scripts, no eval). Absent for older plugins.
   */
  format?: 2;
  /** Set when the plugin was installed from a .bhippi-plugin package. */
  pkg?: PluginPackage;
  /** Pulled from the marketplace (its signed revocation list): off, and it cannot be turned on. */
  revoked?: { reason: string; at: number };
  /** Lower-case letters, digits, dashes, underscores; it names the page file. */
  id: string;
  name: string;
  description: string;
  /** One emoji or a short glyph for the panel tab. */
  icon?: string;
  /** The uploaded logo (the draft's logo.svg, src/plugins/logo.ts) as a PNG/JPEG data URL; shown instead of `icon`. */
  logo?: string;
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

/** One setting of a plugin clip, as the Properties panel shows it (bhippi.generator's params). */
export type GeneratorParam =
  | { type: 'number'; label?: string; default?: number; min?: number; max?: number; step?: number }
  | { type: 'color'; label?: string; default?: string }
  | { type: 'boolean'; label?: string; default?: boolean }
  | { type: 'select'; label?: string; default?: string; options: string[] }
  | { type: 'text'; label?: string; default?: string };

/** A kind of clip a running plugin draws (`bhippi.generator()`). */
export type PluginGenerator = { plugin: string; name: string; label: string; description: string; params: Record<string, GeneratorParam> };

/** Something a running plugin offers Bhippi AI (`bhippi.expose()`). */
export type PluginAction = { plugin: string; name: string; description: string; params?: Record<string, unknown> };
