import { describe, expect, it } from 'vitest';
import { identifyCommand } from '../src/lib/commandApps';

const run = (command: string, cwd?: string) => identifyCommand('run_command', `command: ${command}${cwd ? ` · cwd: ${cwd}` : ''}`);

describe('identifyCommand: shell commands', () => {
  it('finds Blender behind Start-Process and describes the render', () => {
    expect(run('Start-Process -WindowStyle Hidden "C:\\Program Files\\Blender Foundation\\Blender 4.5\\blender.exe" -b E:\\watchfiwn2\\scene.blend -a', 'E:\\watchf…')).toEqual({ app: 'blender', label: 'Blender', action: 'Rendering scene.blend' });
  });

  it('reads a single frame, and a script run inside a scene', () => {
    expect(run('"C:\\Program Files\\Blender Foundation\\Blender 4.5\\blender.exe" -b E:\\p\\scene.blend -f 12')?.action).toBe('Rendering frame 12 of scene.blend');
    expect(run('blender -b scene.blend --python E:\\p\\build_scene.py')?.action).toBe('Running build_scene.py in scene.blend');
    expect(run('Start-Process blender -ArgumentList "-b","a.blend","-a"')).toEqual({ app: 'blender', label: 'Blender', action: 'Rendering a.blend' });
  });

  it('names the output file for FFmpeg, through the & call operator and quoted paths', () => {
    expect(run('& "C:\\ffmpeg\\bin\\ffmpeg.exe" -i in.mov -c:v libx264 out.mp4')).toEqual({ app: 'ffmpeg', label: 'FFmpeg', action: 'Encoding out.mp4' });
    expect(run('ffmpeg -y -i "D:\\my clips\\a b.mov" "D:\\out dir\\final cut.mp4"')?.action).toBe('Encoding final cut.mp4');
    expect(run('ffprobe -i in.mov')?.action).toBe('Inspecting in.mov');
  });

  it('reads Python and Node scripts, even with an unquoted path containing a space', () => {
    expect(run('python -u E:\\proj\\AI Work\\make.py')).toEqual({ app: 'python', label: 'Python', action: 'Running make.py' });
    expect(run('python -m http.server 8000')?.action).toBe('Running module http.server');
    expect(run('node scripts/render.mjs --fast')).toEqual({ app: 'node', label: 'Node.js', action: 'Running render.mjs' });
    expect(run('"C:\\Program Files\\nodejs\\node.exe" "D:\\x y\\go.cjs"')?.action).toBe('Running go.cjs');
  });

  it('prefers what is inside a wrapper over the wrapper', () => {
    expect(run('cmd /c npm run build')).toEqual({ app: 'npm', label: 'npm', action: 'Running build' });
    expect(run('powershell -NoProfile -Command "python x.py"')).toEqual({ app: 'python', label: 'Python', action: 'Running x.py' });
    expect(run('npx tsx tools/make.ts')).toEqual({ app: 'npm', label: 'npm', action: 'Running tsx' });
  });

  it('keeps the wrapper when nothing more specific is inside', () => {
    expect(run('powershell -File C:\\scripts\\clean.ps1')).toEqual({ app: 'powershell', label: 'PowerShell', action: 'Running clean.ps1' });
    expect(run('cmd /c dir C:\\temp')?.app).toBe('cmd');
    expect(run('Get-ChildItem E:\\renders -Recurse')?.app).toBe('powershell');
  });

  it('reads git subcommands and skips global options', () => {
    expect(run('git -C D:\\x status')).toEqual({ app: 'git', label: 'Git', action: 'git status' });
    expect(run('git commit -m "fix ffmpeg path"')?.app).toBe('git');
  });

  it('handles the other tools by name', () => {
    expect(run('cargo build --release')).toEqual({ app: 'cargo', label: 'Cargo', action: 'cargo build' });
    expect(run('yt-dlp -f best https://www.youtube.com/watch?v=abc')).toEqual({ app: 'yt-dlp', label: 'yt-dlp', action: 'Downloading from youtube.com' });
    expect(run('magick in.png -resize 50% out.jpg')).toEqual({ app: 'magick', label: 'ImageMagick', action: 'Processing out.jpg' });
    expect(run('whisper-cli -m model.bin -f talk.wav')).toEqual({ app: 'whisper', label: 'Whisper', action: 'Transcribing talk.wav' });
    expect(run('Start-Process msedge https://bhippi.com/docs')).toEqual({ app: 'browser', label: 'Edge', action: 'Opening bhippi.com' });
  });

  it('falls back to Terminal with a short command, never a long path', () => {
    expect(run('dir')).toEqual({ app: 'terminal', label: 'Terminal', action: 'dir' });
    expect(run('copy C:\\very\\long\\folder\\path\\a.txt D:\\other\\b.txt')?.action).toBe('copy a.txt b.txt');
    expect(identifyCommand('run_command', '')).toEqual({ app: 'terminal', label: 'Terminal', action: 'Running a command' });
    const long = run(`echo ${'word '.repeat(40)}`)!;
    expect(long.action.length).toBeLessThanOrEqual(60);
  });

  it('does not mistake a word in an argument or a folder for the program', () => {
    expect(run('echo ffmpeg is installed')?.app).toBe('terminal');
    expect(run('python make_blender.py')?.app).toBe('python');
    expect(run('cd "D:\\Bhippi Video editor"; npm test')?.app).toBe('npm');
  });

  it('survives a request cut off mid-quote by the stored ellipsis', () => {
    expect(run('Start-Process -WindowStyle Hidden "C:\\Progra…')?.app).toBe('powershell');
    expect(run('"C:\\Program Files\\Blender Foundation\\Blender 4.5\\blend…')?.app).toBe('blender');
  });
});

describe('identifyCommand: other tools', () => {
  it('maps Blender tools, and returns null for tools that run no app', () => {
    expect(identifyCommand('run_blender_script', 'script: build.py')).toEqual({ app: 'blender', label: 'Blender', action: 'Run Blender script' });
    expect(identifyCommand('generate_media', 'prompt: a fox')).toBeNull();
    expect(identifyCommand('read_file', 'path: a.txt')).toBeNull();
  });

  it('maps an export that says it uses ffmpeg', () => {
    expect(identifyCommand('export_video', 'engine: ffmpeg · file: out.mp4')?.app).toBe('ffmpeg');
    expect(identifyCommand('export_video', 'file: out.mp4')).toBeNull();
  });
});
