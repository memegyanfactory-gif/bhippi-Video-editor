//! Finding FFmpeg and running it without a console window, with progress and cancellation.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::watch;

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    /// Whether the build carries libx264; without it exports fall back to a slower encoder.
    pub x264: bool,
}

#[derive(Clone, Debug, Default)]
pub struct Tools {
    pub ffmpeg: Option<PathBuf>,
    pub ffprobe: Option<PathBuf>,
    pub status: ToolStatus,
}

impl Tools {
    pub fn ffmpeg(&self) -> Result<&Path, String> {
        self.ffmpeg.as_deref().ok_or_else(missing)
    }

    pub fn ffprobe(&self) -> Result<&Path, String> {
        self.ffprobe.as_deref().ok_or_else(missing)
    }
}

fn missing() -> String {
    "FFmpeg was not found. Install it (for example `winget install Gyan.FFmpeg`) or set its \
     path in Settings › Media, then try again."
        .to_owned()
}

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_owned()
    }
}

/// Every directory worth looking in, most specific first.
fn candidate_dirs(explicit: Option<&str>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(path) = explicit.map(str::trim).filter(|path| !path.is_empty()) {
        let path = PathBuf::from(path);
        if path.is_file() {
            if let Some(parent) = path.parent() {
                dirs.push(parent.to_path_buf());
            }
        } else {
            dirs.push(path.join("bin"));
            dirs.push(path);
        }
    }
    if let Some(env) = std::env::var_os("HELIOS_FFMPEG") {
        let path = PathBuf::from(env);
        dirs.push(if path.is_file() {
            path.parent().map(Path::to_path_buf).unwrap_or_default()
        } else {
            path
        });
    }
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    if cfg!(windows) {
        if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
            dirs.push(local.join("Microsoft").join("WinGet").join("Links"));
            // WinGet packages land in versioned folders that a desktop process launched
            // before the install never sees on PATH.
            let packages = local.join("Microsoft").join("WinGet").join("Packages");
            if let Ok(entries) = std::fs::read_dir(&packages) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
                    if !name.contains("ffmpeg") {
                        continue;
                    }
                    if let Ok(inner) = std::fs::read_dir(entry.path()) {
                        for build in inner.flatten() {
                            dirs.push(build.path().join("bin"));
                        }
                    }
                    dirs.push(entry.path().join("bin"));
                }
            }
        }
        for root in ["C:\\ffmpeg\\bin", "C:\\Program Files\\ffmpeg\\bin"] {
            dirs.push(PathBuf::from(root));
        }
        if let Some(profile) = std::env::var_os("USERPROFILE").map(PathBuf::from) {
            dirs.push(profile.join("scoop").join("shims"));
        }
        if let Some(data) = std::env::var_os("ProgramData").map(PathBuf::from) {
            dirs.push(data.join("chocolatey").join("bin"));
        }
    } else {
        for root in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
            dirs.push(PathBuf::from(root));
        }
    }
    dirs
}

/// Finds an executable by name across standard directories.
pub fn find_tool(name: &str, explicit: Option<&str>) -> Option<PathBuf> {
    if let Some(path) = explicit.map(str::trim).filter(|p| !p.is_empty()) {
        let p = PathBuf::from(path);
        if p.is_file() {
            return Some(p);
        }
    }
    let target = exe(name);
    candidate_dirs(explicit).into_iter().find_map(|dir| {
        let path = dir.join(&target);
        path.is_file().then_some(path)
    })
}

/// Finds a matching ffmpeg/ffprobe pair and reads its version.
pub async fn resolve(explicit: Option<&str>) -> Tools {
    let (ffmpeg_name, ffprobe_name) = (exe("ffmpeg"), exe("ffprobe"));
    let pair = candidate_dirs(explicit).into_iter().find_map(|dir| {
        let ffmpeg = dir.join(&ffmpeg_name);
        let ffprobe = dir.join(&ffprobe_name);
        (ffmpeg.is_file() && ffprobe.is_file()).then_some((ffmpeg, ffprobe))
    });
    let Some((ffmpeg, ffprobe)) = pair else {
        return Tools::default();
    };
    let version = run(&ffmpeg, &["-hide_banner", "-version"], None)
        .await
        .ok()
        .and_then(|out| out.lines().next().map(str::to_owned))
        .map(|line| {
            line.trim_start_matches("ffmpeg version ")
                .split(" Copyright")
                .next()
                .unwrap_or_default()
                .to_owned()
        });
    let x264 = run(&ffmpeg, &["-hide_banner", "-encoders"], None)
        .await
        .is_ok_and(|out| out.contains("libx264"));
    Tools {
        status: ToolStatus {
            found: true,
            path: Some(ffmpeg.display().to_string()),
            version,
            x264,
        },
        ffmpeg: Some(ffmpeg),
        ffprobe: Some(ffprobe),
    }
}

fn command(program: &Path, cwd: Option<&Path>) -> tokio::process::Command {
    let mut command = tokio::process::Command::new(program);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(dir) = cwd {
        command.current_dir(dir);
    }
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    command
}

/// Runs a tool and hands its stdout to `sink` in chunks. Unlike [`run`], nothing is buffered:
/// decoding an hour of audio to raw samples would otherwise cost tens of megabytes of memory.
/// stderr is discarded — a full pipe nobody reads would deadlock the child.
pub async fn run_streaming(
    program: &Path,
    args: &[&str],
    mut sink: impl FnMut(&[u8]),
) -> Result<(), String> {
    use tokio::io::AsyncReadExt;

    let mut child = command(program, None)
        .args(args)
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("could not start {}: {error}", program.display()))?;
    let Some(mut stdout) = child.stdout.take() else {
        return Err("the tool produced no output stream".to_owned());
    };
    let mut buffer = vec![0_u8; 64 * 1024];
    loop {
        let read = stdout
            .read(&mut buffer)
            .await
            .map_err(|error| format!("could not read from {}: {error}", program.display()))?;
        if read == 0 {
            break;
        }
        sink(&buffer[..read]);
    }
    let status = child
        .wait()
        .await
        .map_err(|error| format!("could not wait for {}: {error}", program.display()))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("{} exited with {status}", program.display()))
    }
}

/// Runs a tool and hands each stderr line to `on_line` as it arrives, so a long job can
/// report progress instead of going quiet for minutes. stdout is dropped.
pub async fn run_watching_stderr(
    program: &Path,
    args: &[&str],
    cwd: Option<&Path>,
    mut on_line: impl FnMut(&str),
) -> Result<(), String> {
    let mut child = command(program, cwd)
        .args(args)
        .stdout(Stdio::null())
        .spawn()
        .map_err(|error| format!("could not start {}: {error}", program.display()))?;
    let mut tail: Vec<String> = Vec::new();
    if let Some(stderr) = child.stderr.take() {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            on_line(&line);
            tail.push(line);
            if tail.len() > 40 {
                tail.remove(0);
            }
        }
    }
    let status = child
        .wait()
        .await
        .map_err(|error| format!("could not wait for {}: {error}", program.display()))?;
    if status.success() {
        Ok(())
    } else {
        Err(stderr_tail(tail.join("
").as_bytes()))
    }
}

/// Runs a tool with `input` on its stdin and returns stdout. Piper takes the line to speak
/// that way, which keeps a script with quotes, newlines and Devanagari out of the argv.
pub async fn run_with_input(program: &Path, args: &[&str], input: &str, cwd: Option<&Path>) -> Result<String, String> {
    use tokio::io::AsyncWriteExt;

    let mut child = command(program, cwd)
        .args(args)
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|error| format!("could not start {}: {error}", program.display()))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(input.as_bytes())
            .await
            .map_err(|error| format!("could not send the text to {}: {error}", program.display()))?;
        // The child waits for end-of-input before it starts; dropping the pipe is that signal.
        drop(stdin);
    }
    let output = child
        .wait_with_output()
        .await
        .map_err(|error| format!("could not wait for {}: {error}", program.display()))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        Err(stderr_tail(&output.stderr))
    }
}

/// Runs a short tool invocation and returns stdout, or the tail of stderr on failure.
pub async fn run(program: &Path, args: &[&str], cwd: Option<&Path>) -> Result<String, String> {
    let output = command(program, cwd)
        .args(args)
        .output()
        .await
        .map_err(|error| format!("could not start {}: {error}", program.display()))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        Err(stderr_tail(&output.stderr))
    }
}

fn stderr_tail(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    let lines: Vec<&str> = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    let tail = lines[lines.len().saturating_sub(6)..].join("\n");
    if tail.is_empty() {
        "the tool failed without saying why".to_owned()
    } else {
        tail
    }
}

/// Environment an FFmpeg child needs: a fontconfig file so libass can find system fonts
/// on Windows builds that ship fontconfig without a default configuration.
pub struct FfmpegEnv {
    pub fontconfig_file: Option<PathBuf>,
}

/// Runs FFmpeg with `-progress pipe:1`, reporting a 0–1 fraction of `total_seconds` and
/// stopping (killing the child) when `cancel` flips to true.
pub async fn run_ffmpeg_with_progress(
    ffmpeg: &Path,
    args: &[String],
    cwd: Option<&Path>,
    env: &FfmpegEnv,
    total_seconds: f64,
    mut cancel: watch::Receiver<bool>,
    mut on_progress: impl FnMut(f64) + Send,
) -> Result<(), String> {
    let mut command = command(ffmpeg, cwd);
    command.args(["-hide_banner", "-nostats", "-progress", "pipe:1", "-y"]);
    command.args(args);
    if let Some(file) = &env.fontconfig_file {
        command.env("FONTCONFIG_FILE", file);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("could not start FFmpeg: {error}"))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stderr_task = tokio::spawn(async move {
        let mut buffer = Vec::new();
        if let Some(stderr) = stderr {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                buffer.extend_from_slice(line.as_bytes());
                buffer.push(b'\n');
                if buffer.len() > 64_000 {
                    buffer.drain(..32_000);
                }
            }
        }
        buffer
    });

    if let Some(stdout) = stdout {
        let mut lines = BufReader::new(stdout).lines();
        loop {
            tokio::select! {
                changed = cancel.changed() => {
                    if changed.is_ok() && *cancel.borrow() {
                        let _ignored = child.start_kill();
                        let _ignored = child.wait().await;
                        return Err("cancelled".to_owned());
                    }
                }
                line = lines.next_line() => {
                    match line {
                        Ok(Some(line)) => {
                            if let Some(seconds) = progress_seconds(&line) {
                                if total_seconds > 0.0 {
                                    on_progress((seconds / total_seconds).clamp(0.0, 1.0));
                                }
                            }
                        }
                        _ => break,
                    }
                }
            }
        }
    }
    let status = child
        .wait()
        .await
        .map_err(|error| format!("FFmpeg did not finish: {error}"))?;
    let stderr = stderr_task.await.unwrap_or_default();
    if status.success() {
        Ok(())
    } else {
        Err(stderr_tail(&stderr))
    }
}

/// `out_time_us=12345678` (or the misnamed `out_time_ms`, also microseconds) → seconds.
fn progress_seconds(line: &str) -> Option<f64> {
    let value = line
        .strip_prefix("out_time_us=")
        .or_else(|| line.strip_prefix("out_time_ms="))?;
    let micros: f64 = value.trim().parse().ok()?;
    (micros >= 0.0).then_some(micros / 1_000_000.0)
}

#[cfg(test)]
mod tests {
    use super::progress_seconds;

    #[test]
    fn progress_lines_are_read_in_microseconds() {
        assert_eq!(progress_seconds("out_time_us=2500000"), Some(2.5));
        assert_eq!(progress_seconds("out_time_ms=1000000"), Some(1.0));
        assert_eq!(progress_seconds("out_time_us=N/A"), None);
        assert_eq!(progress_seconds("frame=12"), None);
    }
}
