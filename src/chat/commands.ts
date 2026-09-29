// Slash commands for the chat, in the shape of Claude Code's: type `/`, pick from the panel.
//
// Every one of these does something real. A command that only printed a message would be worse
// than not offering it, because the panel is a promise about what the chat can do.
import { TOOL_SPECS } from '../lib/aiTools';
import { EFFORTS, PERMISSION_MODES, type Effort, type PermissionMode } from '../lib/permissions';
import { STYLES, findStyle, type StyleId } from '../lib/styles';

export type CommandGroup = 'Chat' | 'Project' | 'Settings';

/** What a command may do to the chat and the editor around it. */
export type CommandContext = {
  /** Start a new conversation. */
  clear: () => void;
  /** Ask the model for a recap, then keep only that — Claude Code's /compact. */
  compact: () => void;
  /** Write a message into the transcript without sending anything. */
  say: (text: string) => void;
  /** Send a message as if typed. */
  send: (text: string) => void;
  undo: () => void;
  revertLastTurn: () => void;
  openModelPicker: () => void;
  openProviders: () => void;
  setEffort: (effort: Effort) => void;
  setPermission: (mode: PermissionMode) => void;
  /** Levels the current provider and model honour; empty when it has no such setting. */
  effortLevels: Effort[];
  permission: PermissionMode;
  effort: Effort;
  /** A short description of what the model is told about the project. */
  describeContext: () => string;
  /** Reference films on this machine, for `/ref`. */
  references: { id: string; name: string; pack: string | null; cutEvery: number }[];
  /** Edits from here on follow that reference; its guideline goes into every turn's context. */
  useReference: (id: string) => void;
  /** The edit style every turn works in (`@funny`), or null for none — src/lib/styles.ts. */
  editStyle: StyleId | null;
  setStyle: (id: StyleId | null) => void;
  canRevert: boolean;
  /** Brand kits on this machine, for `/train @Kit`. */
  brandKits: { id: string; name: string }[];
  /** Starts a turn showing `visible` as the user's message, with `hidden` instructions only the model reads (a quick edit). */
  sendInstructed: (visible: string, hidden: string) => void;
  /** Whether the composer holds attached files or images (they go with the turn). */
  hasAttachments: boolean;
};

export type Command = {
  name: string;
  /** What follows the name, when it takes something. */
  args?: string;
  summary: string;
  group: CommandGroup;
  /** Values the argument may take, offered in the panel. */
  options?: (context: CommandContext) => string[];
  /** Whether it can run right now, and why not. */
  disabled?: (context: CommandContext) => string | null;
  run: (context: CommandContext, argument: string) => void;
};

export const COMMANDS: Command[] = [
  {
    name: '/clear',
    summary: 'Start a new conversation',
    group: 'Chat',
    run: (context) => context.clear(),
  },
  {
    name: '/compact',
    summary: 'Replace the history with a short recap and carry on',
    group: 'Chat',
    run: (context) => context.compact(),
  },
  {
    name: '/model',
    summary: 'Choose the provider and model',
    group: 'Settings',
    run: (context) => context.openModelPicker(),
  },
  {
    name: '/effort',
    args: 'level',
    summary: 'How hard the model should think',
    group: 'Settings',
    options: (context) => context.effortLevels,
    disabled: (context) => (context.effortLevels.length ? null : 'This provider takes no thinking level'),
    run: (context, argument) => {
      const wanted = argument.trim().toLowerCase();
      const level = context.effortLevels.find((item) => item === wanted || EFFORTS.find((entry) => entry.id === item)?.label.toLowerCase() === wanted);
      if (level) context.setEffort(level);
      else context.say(`Thinking levels for this model: ${context.effortLevels.join(', ') || 'none'}.`);
    },
  },
  {
    name: '/permission',
    args: 'mode',
    summary: 'What Bhippi AI may change on its own',
    group: 'Settings',
    options: () => PERMISSION_MODES.map((mode) => mode.id),
    run: (context, argument) => {
      const wanted = argument.trim().toLowerCase();
      const mode = PERMISSION_MODES.find((item) => item.id === wanted || item.label.toLowerCase() === wanted);
      if (mode) context.setPermission(mode.id);
      else context.say(`Permission modes: ${PERMISSION_MODES.map((item) => `${item.id} — ${item.hint}`).join('\n')}`);
    },
  },
  {
    name: '/providers',
    summary: 'Manage AI providers and keys',
    group: 'Settings',
    run: (context) => context.openProviders(),
  },
  {
    name: '/undo',
    summary: 'Undo the last edit',
    group: 'Project',
    run: (context) => context.undo(),
  },
  {
    name: '/revert',
    summary: "Put the project back to before the last turn's edits",
    group: 'Project',
    disabled: (context) => (context.canRevert ? null : 'No AI edits to revert'),
    run: (context) => context.revertLastTurn(),
  },
  {
    name: '/context',
    summary: 'Show what the model is told about this project',
    group: 'Project',
    run: (context) => context.say(context.describeContext()),
  },
  {
    name: '/tools',
    summary: `List the ${TOOL_SPECS.length} tools the assistant can call`,
    group: 'Project',
    run: (context) => {
      const lines = TOOL_SPECS.map((tool) => `· **${tool.name}** — ${tool.description.split('.')[0]}`);
      context.say(`I can call ${TOOL_SPECS.length} tools on this project:\n\n${lines.join('\n')}`);
    },
  },
  {
    name: '/train',
    args: '[@Kit] link, website or note',
    summary: 'Teach a brand kit from a reference — a video, link, website, images or this timeline',
    group: 'Project',
    options: (context) => context.brandKits.map((kit) => `@${kit.name.replace(/\s+/g, '')}`),
    run: (context, argument) => {
      const plan = trainingRequest(argument, context.brandKits, context.hasAttachments);
      if ('error' in plan) {
        context.say(plan.error);
        return;
      }
      context.sendInstructed(plan.visible, plan.hidden);
    },
  },
  {
    name: '/ref',
    args: 'name',
    summary: 'Edit to a reference film — its look, its pacing, its hook',
    group: 'Project',
    options: (context) => context.references.map((item) => item.name),
    run: (context, argument) => {
      const wanted = argument.trim().toLowerCase();
      if (!wanted) {
        const lines = context.references.map((item) => `· **${item.name}** — ${item.pack ?? 'no pack'}, a cut every ${item.cutEvery.toFixed(1)}s`);
        context.say(lines.length
          ? `References on this machine:\n\n${lines.join('\n')}\n\nUse \`/ref <name>\` to edit to one, or drop a video on the chat to add another.`
          : 'There are no references yet. Drop a video on the chat and Bhippi will read it frame by frame.');
        return;
      }
      const found = context.references.find((item) => item.name.toLowerCase() === wanted);
      if (!found) {
        context.say(`There is no reference called "${argument.trim()}". ${context.references.length ? `There is ${context.references.map((item) => item.name).join(', ')}.` : ''}`);
        return;
      }
      context.useReference(found.id);
    },
  },
  {
    name: '/style',
    args: 'id|off',
    summary: 'Edit in a style until you turn it off — @funny: roast / meme edit',
    group: 'Project',
    options: () => [...STYLES.map((style) => style.id), 'off'],
    run: (context, argument) => {
      const wanted = argument.trim().toLowerCase();
      if (!wanted) {
        const lines = STYLES.map((style) => `· **${style.label}** — ${style.description}${style.id === context.editStyle ? ' (on)' : ''}`);
        context.say(`Edit styles:\n\n${lines.join('\n')}\n\nUse \`/style <id>\` or type \`@${STYLES[0].id}\` to switch one on, \`/style off\` to go back to the house style.`);
        return;
      }
      if (['off', 'none', 'clear'].includes(wanted)) {
        if (!context.editStyle) context.say('No edit style is on.');
        context.setStyle(null);
        return;
      }
      const style = findStyle(wanted);
      // No message on success: the chip above the composer says so, as it does for a reference.
      if (style) context.setStyle(style.id);
      else context.say(`There is no "${argument.trim()}" style. Styles: ${STYLES.map((item) => item.label).join(', ')}.`);
    },
  },
  {
    name: '/shorts',
    args: 'portrait|landscape',
    summary: 'Find the best moments of the video and make each one a rated, edited short',
    group: 'Project',
    options: () => ['portrait', 'landscape'],
    run: (context, argument) => {
      const wanted = argument.trim().toLowerCase();
      const screen = wanted.startsWith('p') ? ' in portrait (9:16)' : wanted.startsWith('l') ? ' in landscape (16:9)' : '';
      context.send(`Make shorts from this video${screen}: read the whole transcript, pick the best standalone moments, rate each one, and edit every short fully.`);
    },
  },
  {
    name: '/help',
    summary: 'List these commands',
    group: 'Chat',
    run: (context) => {
      const lines = COMMANDS.map((command) => `· **${command.name}${command.args ? ` ${command.args}` : ''}** — ${command.summary}`);
      context.say(`Commands:\n\n${lines.join('\n')}`);
    },
  },
];

/** What the panel should show for `draft`, or null when it is not a command being typed. */
export function matchCommands(draft: string): { query: string; argument: string; matches: Command[] } | null {
  if (!draft.startsWith('/')) return null;
  const space = draft.indexOf(' ');
  // Once there is a space the name is settled; the panel then offers that command's values.
  const query = (space === -1 ? draft : draft.slice(0, space)).toLowerCase();
  const argument = space === -1 ? '' : draft.slice(space + 1);
  const exact = COMMANDS.find((command) => command.name === query);
  if (exact && space !== -1) return { query, argument, matches: [exact] };
  const matches = COMMANDS.filter((command) => command.name.startsWith(query) || command.name.slice(1).startsWith(query.slice(1)));
  return { query, argument, matches };
}

export const GROUP_ORDER: CommandGroup[] = ['Chat', 'Project', 'Settings'];

/**
 * What `/train` asks for: the kit (`@Name`, else the project's), what to learn from (a link, a
 * website, "this timeline", or the attached files), the message the user sees and the instructions
 * the model follows. Pure, so it is tested.
 */
export function trainingRequest(argument: string, kits: { id: string; name: string }[], hasAttachments: boolean): { visible: string; hidden: string; kitId: string | null } | { error: string } {
  let rest = argument.trim();
  let kit: { id: string; name: string } | null = null;
  const tag = rest.match(/^@(\S+)\s*/);
  if (tag) {
    const wanted = tag[1].toLowerCase();
    kit = kits.find((entry) => entry.name.replace(/\s+/g, '').toLowerCase() === wanted) ?? kits.find((entry) => entry.name.toLowerCase().startsWith(wanted)) ?? null;
    if (!kit) return { error: `There is no brand kit called "${tag[1]}". ${kits.length ? `There is ${kits.map((entry) => `@${entry.name.replace(/\s+/g, '')}`).join(', ')}.` : 'Make one in Settings › Brand kit first.'}` };
    rest = rest.slice(tag[0].length).trim();
  }
  const url = rest.match(/https?:\/\/\S+/)?.[0] ?? null;
  const timeline = /\b(this )?timeline\b|\bthis (edit|video|comp)\b/i.test(rest);
  if (!url && !timeline && !hasAttachments) {
    return { error: 'What should the kit learn from? Paste a link (YouTube, Instagram, TikTok, a website), attach videos or images, or write `/train this timeline`.' };
  }
  const from = url ?? (hasAttachments ? 'the attached files' : 'this timeline');
  const kitWords = kit ? `the brand kit "${kit.name}" (id ${kit.id})` : "the project's brand kit (list_brand_kits if unsure which)";
  const visible = `/train ${kit ? `@${kit.name} ` : ''}— learn from ${from}${rest && rest !== url ? `: ${rest.replace(url ?? '', '').trim()}` : ''}`.trim();
  const hidden = [
    `TRAINING (/train). Study the reference and teach ${kitWords}. Do not change the timeline.`,
    'Measure first:',
    '- a video file or a video link (YouTube, Instagram, TikTok, X, direct): if it is a link, download_online_media with asReference true; then analyze_reference_video on it and keep the reference id it returns;',
    '- a website: extract_brand_from_url;',
    '- images: look at them closely;',
    '- "this timeline": get_comp, then inspect_clip_frames on a few representative shots.',
    'Then call train_brand_kit ONCE with source {kind, label: what the user gave, ref}, referenceId when you have one (its measured cut rate and palette are added for you), and 3–12 learnings: short, specific, reusable rules across pacing, color, type, layout, motion, captions, audio, voice, do, dont — taken from what you measured and saw, never generic advice. Put measured numbers or hex colours in value.',
    'End with two lines: what the kit learned, and that the user can review or undo it in the card below.',
    rest ? `The user added: ${rest}` : '',
  ].filter(Boolean).join('\n');
  return { visible, hidden, kitId: kit?.id ?? null };
}

