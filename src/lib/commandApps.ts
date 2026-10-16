// What a running tool call is actually running, in words and with a name a person recognises.
//
// The System panel (and later the chat) shows a call like `run_command` with a wall of text:
// `Start-Process -WindowStyle Hidden "C:\Program Files\Blender Foundation\Blender 4.5\blender.exe" -b scene.blend`.
// Nobody reads that at a glance. This reads the request text, finds the program that is really being
// run even when it is wrapped in PowerShell, cmd or Start-Process, and gives back the product ("Blender")
// plus a plain description ("Rendering scene.blend"). It is pure text work: no React, no I/O.
//
// The request is the argument text the app stores per call (`command: … · cwd: …`, built by
// describeArgs in App.tsx). A command keeps its first 300 characters there, so the program is
// almost always in it, but a very long one can still end mid-path with a trailing "…". Everything
// here tolerates that: a cut-off quote, a missing file name and so on still give a sensible answer.

export type AppId = 'blender' | 'ffmpeg' | 'python' | 'node' | 'powershell' | 'cmd' | 'git' | 'browser' | 'npm' | 'cargo' | 'yt-dlp' | 'magick' | 'whisper' | 'bhippi' | 'terminal';
export type CommandApp = { app: AppId; label: string; action: string };

const MAX_ACTION = 60;
/** Marks a shell separator (`;`, `|`, `&`, `&&`) in the token list, so arguments stop where the next command begins. */
const SEP = '\u0000';

type Program = { app: AppId; label: string; wrapper?: boolean };

/** Reads a program's name (no folder, no .exe) as one of the apps we know, or null. Lower-case in. */
const programOf = (name: string): Program | null => {
  if (name === 'blender' || name === 'blender-launcher') return { app: 'blender', label: 'Blender' };
  if (name === 'ffmpeg' || name === 'ffprobe' || name === 'ffplay') return { app: 'ffmpeg', label: 'FFmpeg' };
  if (/^(python|python3|pythonw|py|pip|pip3)(\d+(\.\d+)*)?$/.test(name)) return { app: 'python', label: 'Python' };
  if (name === 'node' || name === 'nodejs') return { app: 'node', label: 'Node.js' };
  if (name === 'npm' || name === 'npx') return { app: 'npm', label: 'npm' };
  if (name === 'pnpm') return { app: 'npm', label: 'pnpm' };
  if (name === 'yarn') return { app: 'npm', label: 'Yarn' };
  if (name === 'git') return { app: 'git', label: 'Git' };
  if (name === 'cargo' || name === 'rustc' || name === 'rustup') return { app: 'cargo', label: 'Cargo' };
  if (name === 'yt-dlp' || name === 'youtube-dl') return { app: 'yt-dlp', label: 'yt-dlp' };
  if (name === 'magick') return { app: 'magick', label: 'ImageMagick' };
  if (/^(faster-)?whisper([-_.](cli|cpp|main|server))?$/.test(name)) return { app: 'whisper', label: 'Whisper' };
  if (name === 'chrome' || name === 'google-chrome') return { app: 'browser', label: 'Chrome' };
  if (name === 'msedge') return { app: 'browser', label: 'Edge' };
  if (name === 'firefox') return { app: 'browser', label: 'Firefox' };
  if (name === 'brave') return { app: 'browser', label: 'Brave' };
  if (name === 'powershell' || name === 'pwsh') return { app: 'powershell', label: 'PowerShell', wrapper: true };
  if (name === 'cmd') return { app: 'cmd', label: 'Command Prompt', wrapper: true };
  return null;
};

/** A program name cut off by the stored ellipsis ("blend…") read as the app it starts. */
const programOfCutOff = (name: string): Program | null => {
  if (name.length < 3) return null;
  const full = ['blender', 'ffmpeg', 'python', 'node', 'git', 'cargo', 'yt-dlp', 'magick', 'whisper', 'chrome', 'msedge', 'firefox'].find((candidate) => candidate.startsWith(name));
  return full ? programOf(full) : null;
};

type Token = { text: string; quoted: boolean };

/**
 * Splits a command line into words the way a shell would, close enough for reading: quotes group
 * (and are dropped), `;` `|` `&` become separators, and a quote cut off by truncation just runs to the end.
 */
const tokenize = (input: string): Token[] => {
  const tokens: Token[] = [];
  let current = '';
  let quoted = false;
  let has = false;
  const flush = () => {
    if (has) tokens.push({ text: current, quoted });
    current = '';
    quoted = false;
    has = false;
  };
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"' || (ch === "'" && !has)) {
      const end = input.indexOf(ch, i + 1);
      const stop = end === -1 ? input.length : end;
      current += input.slice(i + 1, stop);
      quoted = true;
      has = true;
      i = stop;
    } else if (/\s/.test(ch)) {
      flush();
    } else if (ch === ';' || ch === '|' || ch === '&') {
      flush();
      while (input[i + 1] === ch) i++;
      tokens.push({ text: SEP, quoted: false });
    } else if (ch === ',' && (!has || quoted || /["'s]/.test(input[i + 1] ?? ' '))) {
      // PowerShell's -ArgumentList "-b","x.blend": the comma only joins items.
      flush();
    } else {
      current += ch;
      has = true;
    }
  }
  flush();
  // A trailing comma left on a word ("-b",) is a list joiner too.
  return tokens.map((token) => (token.quoted ? token : { ...token, text: token.text.replace(/,+$/, '') })).filter((token) => token.text !== '');
};

/** Flags after which a quoted string is itself a command line (`powershell -Command "python x.py"`). */
const COMMAND_FLAGS = new Set(['-command', '-c', '/c', '/k', '-cmd']);

/** The tokens, with any quoted command-line after -Command / /c opened up into its own words. */
const expand = (tokens: Token[], depth = 0): Token[] => {
  const out: Token[] = [];
  tokens.forEach((token, index) => {
    const previous = index > 0 ? tokens[index - 1].text.toLowerCase() : '';
    if (depth < 2 && token.quoted && COMMAND_FLAGS.has(previous) && /\s/.test(token.text)) out.push(...expand(tokenize(token.text), depth + 1));
    else out.push(token);
  });
  return out;
};

/** A path's file name, with a cut-off ellipsis and stray quotes removed. */
const baseName = (path: string) => path.replace(/[…"']+$/, '').split(/[\\/]/).filter(Boolean).pop() ?? path;
const stem = (path: string) => baseName(path).toLowerCase().replace(/\.(exe|cmd|bat|com|ps1)$/, '');
const hasPathOrExe = (text: string) => /[\\/]/.test(text) || /\.(exe|cmd|bat|com)$/i.test(text);

/** Start-Process style launchers: whatever non-flag word follows them may be the program. */
const LAUNCHERS = new Set(['start-process', 'start', 'saps', 'call', 'exec', 'sudo', 'env', 'time', 'command', 'invoke-expression', 'iex', 'wsl']);

const isFlag = (text: string) => /^[-/][A-Za-z]/.test(text) && !/^[A-Za-z]:[\\/]/.test(text) && !/^\/[^/\s]*\/|^\/[^/]+\.[a-z0-9]+$/i.test(text);

/** Finds the program being run: the first recognised app that is in command position or named by an .exe/path; wrappers only if nothing else is. */
const findProgram = (tokens: Token[]): { program: Program; index: number } | null => {
  let wrapper: { program: Program; index: number } | null = null;
  let segmentStart = 0;
  for (let i = 0; i < tokens.length; i++) {
    const text = tokens[i].text;
    if (text === SEP) {
      segmentStart = i + 1;
      continue;
    }
    if (isFlag(text) && !hasPathOrExe(text)) continue;
    const previous = i > segmentStart ? tokens[i - 1].text.toLowerCase() : '';
    const first = tokens[segmentStart]?.text.toLowerCase() ?? '';
    const atCommand =
      i === segmentStart ||
      LAUNCHERS.has(previous) ||
      COMMAND_FLAGS.has(previous) ||
      previous === '-filepath' ||
      (LAUNCHERS.has(first) && i > segmentStart);
    if (!atCommand && !hasPathOrExe(text)) continue;
    const name = stem(text);
    const program = programOf(name) ?? (text.endsWith('…') ? programOfCutOff(name) : null);
    if (!program) continue;
    if (program.wrapper) {
      if (!wrapper) wrapper = { program, index: i };
      continue;
    }
    return { program, index: i };
  }
  return wrapper;
};

/** The words after the program, up to the next separator. */
const argsAfter = (tokens: Token[], index: number): string[] => {
  const args: string[] = [];
  for (let i = index + 1; i < tokens.length && tokens[i].text !== SEP; i++) args.push(tokens[i].text);
  return args;
};

const clip = (text: string, max = MAX_ACTION) => {
  const clean = text.replace(/\s+/g, ' ').replace(/…$/, '').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
};

/** A command line shortened for reading: long paths become file names, then the whole is clipped. */
const shortCommand = (tokens: Token[]): string =>
  clip(tokens.map((token) => (token.text === SEP ? ';' : /[\\/]/.test(token.text) && !/\s{2,}/.test(token.text) ? baseName(token.text) : token.text)).join(' ').replace(/ ; /g, '; '));

const fileWith = (args: string[], pattern: RegExp, from = 0): string | null => {
  for (let i = from; i < args.length; i++) if (pattern.test(args[i].replace(/…$/, ''))) return baseName(args[i]);
  return null;
};

const valueAfter = (args: string[], flags: string[]): string | null => {
  const at = args.findIndex((arg) => flags.includes(arg.toLowerCase()));
  return at >= 0 && at + 1 < args.length ? args[at + 1] : null;
};

const blenderAction = (args: string[]): string => {
  const file = fileWith(args, /\.blend$/i);
  const lower = args.map((arg) => arg.toLowerCase());
  const script = valueAfter(args, ['--python', '-p']);
  const frame = valueAfter(args, ['-f', '--render-frame']);
  const target = file ?? 'the scene';
  if (lower.includes('-a') || lower.includes('--render-anim')) return clip(`Rendering ${target}`);
  if (frame) return clip(`Rendering frame ${frame.replace(/^\+/, '')} of ${target}`);
  if (script) return clip(`Running ${baseName(script)}${file ? ` in ${file}` : ''}`);
  if (lower.includes('--python-expr')) return clip(`Running a script${file ? ` in ${file}` : ''}`);
  if (file) return clip(lower.includes('-b') || lower.includes('--background') ? `Working on ${file}` : `Opening ${file}`);
  return 'Running Blender';
};

const MEDIA_FILE = /\.(mp4|mov|mkv|webm|avi|gif|mp3|wav|m4a|aac|flac|ogg|opus|png|jpe?g|webp|m3u8|ts|mxf|flv|wmv|mpe?g|m4v|srt|ass|vtt)$/i;

const ffmpegAction = (args: string[], tool: string): string => {
  const outputs: string[] = [];
  const inputs: string[] = [];
  args.forEach((arg, i) => {
    if (!MEDIA_FILE.test(arg.replace(/…$/, ''))) return;
    if (args[i - 1]?.toLowerCase() === '-i') inputs.push(arg);
    else outputs.push(arg);
  });
  if (tool === 'ffprobe') return clip(`Inspecting ${baseName(inputs[0] ?? outputs[0] ?? 'a file')}`);
  if (tool === 'ffplay') return clip(`Playing ${baseName(inputs[0] ?? outputs[0] ?? 'a file')}`);
  if (outputs.length) return clip(`Encoding ${baseName(outputs[outputs.length - 1])}`);
  if (inputs.length) return clip(`Processing ${baseName(inputs[0])}`);
  return 'Running FFmpeg';
};

const scriptAction = (args: string[], kind: 'python' | 'node', tool: string): string => {
  if (kind === 'python' && /^pip/.test(tool)) {
    const words = args.filter((arg) => !arg.startsWith('-'));
    return clip(`pip ${words.slice(0, 2).join(' ')}`.trim());
  }
  const module = valueAfter(args, ['-m']);
  if (module) return clip(`Running module ${module}`);
  const script = fileWith(args, kind === 'python' ? /\.pyw?$/i : /\.(mjs|cjs|js|jsx|ts|tsx)$/i);
  if (script) return clip(`Running ${script}`);
  const inline = args.some((arg) => arg === '-c' || arg === '-e' || arg === '--eval' || arg === '-p');
  if (inline) return 'Running an inline script';
  // `node --import tsx x.ts` and the like are covered above; anything else is a bare interpreter.
  return kind === 'python' ? 'Running Python' : 'Running Node.js';
};

const npmAction = (args: string[], tool: string): string => {
  const words = args.filter((arg) => !arg.startsWith('-'));
  if (tool === 'npx') return clip(words.length ? `Running ${words[0]}` : 'Running npx');
  const [sub, ...rest] = words;
  if (!sub) return `Running ${tool}`;
  if (sub === 'run' || sub === 'run-script') return clip(rest.length ? `Running ${rest[0]}` : `Running ${tool} script`);
  if (sub === 'install' || sub === 'i' || sub === 'ci' || sub === 'add') return 'Installing packages';
  if (sub === 'test' || sub === 't') return 'Running tests';
  return clip(`${tool} ${words.slice(0, 2).join(' ')}`);
};

const gitAction = (args: string[]): string => {
  const rest = [...args];
  // Skip global options so `git -C D:\x status` reads as "git status".
  while (rest.length && rest[0].startsWith('-')) {
    const option = rest.shift()!;
    if ((option === '-C' || option === '-c') && rest.length) rest.shift();
  }
  return rest.length ? clip(`git ${rest[0]}`) : 'Running git';
};

const cargoAction = (args: string[], tool: string): string => {
  const words = args.filter((arg) => !arg.startsWith('-') && !arg.startsWith('+'));
  return clip(words.length ? `${tool} ${words[0]}` : `Running ${tool}`);
};

const hostOf = (url: string): string => url.replace(/^[a-z]+:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0].replace(/…$/, '');

const downloadAction = (args: string[]): string => {
  const url = args.find((arg) => /^https?:\/\//i.test(arg));
  return url ? clip(`Downloading from ${hostOf(url)}`) : 'Downloading media';
};

const magickAction = (args: string[]): string => {
  const files = args.filter((arg) => /\.(png|jpe?g|webp|gif|tiff?|bmp|psd|exr|avif|heic|svg|pdf)$/i.test(arg.replace(/…$/, '')));
  return files.length ? clip(`Processing ${baseName(files[files.length - 1])}`) : 'Processing images';
};

const whisperAction = (args: string[]): string => {
  const file = fileWith(args, /\.(wav|mp3|m4a|aac|flac|ogg|opus|mp4|mov|mkv|webm|avi)$/i);
  return file ? clip(`Transcribing ${file}`) : 'Transcribing audio';
};

const browserAction = (args: string[]): string => {
  const url = args.find((arg) => /^https?:\/\//i.test(arg));
  return url ? clip(`Opening ${hostOf(url)}`) : 'Opening the browser';
};

const powershellAction = (tokens: Token[], args: string[]): string => {
  const script = valueAfter(args, ['-file']);
  if (script) return clip(`Running ${baseName(script)}`);
  const at = args.findIndex((arg) => COMMAND_FLAGS.has(arg.toLowerCase()));
  const body = at >= 0 ? args.slice(at + 1) : args.filter((arg) => !isFlag(arg));
  return body.length ? shortCommand(body.map((text) => ({ text, quoted: false }))) : shortCommand(tokens);
};

/** Reads the shell command out of a stored request: the `command:` part, without `cwd:` and friends. */
const commandText = (request: string): string => {
  const segments = request.split(' · ');
  const hit = segments.find((segment) => /^(command|cmd|script|shell)\s*:/i.test(segment));
  const chosen = hit ?? segments[0];
  return chosen.replace(/^(command|cmd|script|shell)\s*:\s*/i, '').trim();
};

const SHELL_TOOL = /(^|_)(command|shell|bash|powershell|terminal|cmd|exec)(_|$)/i;

const describeProgram = (found: { program: Program; index: number }, tokens: Token[]): CommandApp => {
  const { program, index } = found;
  const args = argsAfter(tokens, index);
  const tool = stem(tokens[index].text);
  let action: string;
  switch (program.app) {
    case 'blender': action = blenderAction(args); break;
    case 'ffmpeg': action = ffmpegAction(args, tool); break;
    case 'python': action = scriptAction(args, 'python', tool); break;
    case 'node': action = scriptAction(args, 'node', tool); break;
    case 'npm': action = npmAction(args, tool); break;
    case 'git': action = gitAction(args); break;
    case 'cargo': action = cargoAction(args, tool); break;
    case 'yt-dlp': action = downloadAction(args); break;
    case 'magick': action = magickAction(args); break;
    case 'whisper': action = whisperAction(args); break;
    case 'browser': action = browserAction(args); break;
    case 'powershell': action = powershellAction(tokens, args); break;
    default: action = shortCommand(args.map((text) => ({ text, quoted: false })).filter((token) => !COMMAND_FLAGS.has(token.text.toLowerCase())));
  }
  return { app: program.app, label: program.label, action: action || `Running ${program.label}` };
};

/** Turns a tool name into words: `run_blender_script` becomes "Run blender script". */
const nameWords = (toolName: string) => {
  const words = toolName.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * Reads what a tool call is running from its tool name and its request text. Shell tools give the
 * program found in the command line (or "Terminal" when nothing is recognised). Other tools only
 * answer when their name or request obviously names an app (a Blender tool, an export that says
 * ffmpeg); otherwise null, so the caller keeps showing the tool's own name.
 */
export function identifyCommand(toolName: string, request: string): CommandApp | null {
  const name = (toolName ?? '').toLowerCase();
  const text = request ?? '';
  const isShell = SHELL_TOOL.test(name);
  const tokens = expand(tokenize(isShell ? commandText(text) : text));
  const found = findProgram(tokens);

  if (isShell) {
    if (found) return describeProgram(found, tokens);
    const body = commandText(text);
    if (!body) return { app: 'terminal', label: 'Terminal', action: 'Running a command' };
    // A bare cmdlet (Get-ChildItem, Start-Process…) is PowerShell even without the powershell word.
    const cmdlet = /^[A-Z][a-z]+-[A-Z][A-Za-z]+/.test(body);
    return cmdlet
      ? { app: 'powershell', label: 'PowerShell', action: shortCommand(tokens) }
      : { app: 'terminal', label: 'Terminal', action: shortCommand(tokens) || 'Running a command' };
  }

  if (name.includes('blender')) {
    if (found?.program.app === 'blender') return describeProgram(found, tokens);
    return { app: 'blender', label: 'Blender', action: clip(nameWords(name.replace(/blender/g, 'Blender'))) };
  }
  if (/ffmpeg/i.test(text) && /render|export|encode|transcode|convert|compress|trim|concat/.test(name)) {
    if (found?.program.app === 'ffmpeg') return describeProgram(found, tokens);
    return { app: 'ffmpeg', label: 'FFmpeg', action: clip(nameWords(name)) };
  }
  if (name.includes('bhippi')) return { app: 'bhippi', label: 'Bhippi', action: clip(nameWords(name.replace(/bhippi_?/g, ''))) || 'Working' };
  return null;
}
