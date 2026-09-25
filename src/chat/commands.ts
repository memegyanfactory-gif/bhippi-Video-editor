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
  toggleAwesome: () => void;
  awesome: boolean;
  /** Reference films on this machine, for `/ref`. */
  references: { id: string; name: string; pack: string | null; cutEvery: number }[];
  /** Edits from here on follow that reference; its guideline goes into every turn's context. */
  useReference: (id: string) => void;
  /** The edit style every turn works in (`@funny`), or null for none — src/lib/styles.ts. */
  editStyle: StyleId | null;
  setStyle: (id: StyleId | null) => void;
  canRevert: boolean;
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
    name: '/awesome',
    summary: 'Turn the animated look on or off',
    group: 'Settings',
    run: (context) => context.toggleAwesome(),
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
