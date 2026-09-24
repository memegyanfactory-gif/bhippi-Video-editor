//! System and developer tools for Helios AI: file reading/writing/editing, directory listing,
//! glob/grep search, and terminal command execution.
//!
//! These tools provide parity with the toolsets of Claude Code and Codex, allowing any AI
//! model inside Helios (API, local, or CLI) to inspect projects, write code/scripts/assets,
//! and run terminal commands.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant, UNIX_EPOCH};
use tokio::io::{AsyncRead, AsyncReadExt};

#[cfg(windows)]
#[allow(unused_imports)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// ───────────────────────────── 1. read_file ─────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadFileResult {
    pub path: String,
    pub content: String,
    pub total_lines: usize,
    pub start_line: usize,
    pub end_line: usize,
    pub size_bytes: u64,
    /// No `endLine` was given and the file goes on past the default window; page on with
    /// `startLine = endLine + 1`.
    #[serde(default)]
    pub truncated: bool,
}

/// How much a read with no `endLine` returns: every tool result stays in the conversation for
/// the rest of the turn, so a whole log must not land in it by default. The byte cap sits well
/// under chat's 48 KB result budget (JSON escaping included), or the window it returns would be
/// cut in the middle there.
const READ_DEFAULT_LINES: usize = 400;
const READ_DEFAULT_BYTES: usize = 32 * 1024;

pub fn read_file(
    path: &str,
    start_line: Option<usize>,
    end_line: Option<usize>,
) -> Result<ReadFileResult, String> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(format!("File does not exist: {path}"));
    }
    if !p.is_file() {
        return Err(format!("Path is not a file: {path}"));
    }

    let metadata = fs::metadata(p).map_err(|e| format!("Could not read metadata: {e}"))?;
    let size_bytes = metadata.len();
    if size_bytes > 20 * 1024 * 1024 {
        return Err(format!(
            "File is too large to read into context ({} MB). Limit is 20 MB.",
            size_bytes / (1024 * 1024)
        ));
    }

    let raw = fs::read(p).map_err(|e| format!("Failed to read file: {e}"))?;
    let text = String::from_utf8(raw)
        .map_err(|_| "File appears to be binary or contains invalid UTF-8 characters".to_string())?;

    let all_lines: Vec<&str> = text.lines().collect();
    let total_lines = all_lines.len();

    let start = start_line.unwrap_or(1).max(1);
    let end = end_line.unwrap_or(total_lines).min(total_lines);

    if start > total_lines && total_lines > 0 {
        return Err(format!(
            "start_line ({start}) is beyond total lines in file ({total_lines})"
        ));
    }

    let slice = if total_lines == 0 {
        Vec::new()
    } else {
        let s_idx = start - 1;
        let e_idx = end.min(total_lines).max(s_idx);
        all_lines[s_idx..e_idx].to_vec()
    };

    let mut numbered_content = String::new();
    let mut last_line = start - 1;
    for (i, line) in slice.iter().enumerate() {
        let line_num = start + i;
        let numbered = format!("{:5}: {}\n", line_num, line);
        let full = i >= READ_DEFAULT_LINES || (i > 0 && numbered_content.len() + numbered.len() > READ_DEFAULT_BYTES);
        if end_line.is_none() && full {
            break;
        }
        numbered_content.push_str(&numbered);
        last_line = line_num;
    }

    Ok(ReadFileResult {
        path: path.to_string(),
        content: numbered_content,
        total_lines,
        start_line: start,
        end_line: last_line,
        size_bytes,
        truncated: last_line < end,
    })
}

// ───────────────────────────── 2. write_file ─────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteFileResult {
    pub path: String,
    pub bytes_written: usize,
    pub lines: usize,
}

pub fn write_file(
    path: &str,
    content: &str,
    overwrite: Option<bool>,
) -> Result<WriteFileResult, String> {
    let p = Path::new(path);
    if p.exists() && overwrite == Some(false) {
        return Err(format!(
            "File already exists and overwrite is set to false: {path}"
        ));
    }

    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Could not create parent directories: {e}"))?;
        }
    }

    fs::write(p, content).map_err(|e| format!("Failed to write file: {e}"))?;

    let lines = content.lines().count();
    let bytes_written = content.len();

    Ok(WriteFileResult {
        path: path.to_string(),
        bytes_written,
        lines,
    })
}

// ───────────────────────────── 3. edit_file ─────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditFileResult {
    pub path: String,
    pub replacements: usize,
    pub total_lines: usize,
}

pub fn edit_file(
    path: &str,
    old_string: &str,
    new_string: &str,
    allow_multiple: Option<bool>,
) -> Result<EditFileResult, String> {
    let p = Path::new(path);
    if !p.exists() || !p.is_file() {
        return Err(format!("File does not exist: {path}"));
    }

    let raw = fs::read(p).map_err(|e| format!("Failed to read file: {e}"))?;
    let content = String::from_utf8(raw)
        .map_err(|_| "File contains invalid UTF-8 characters".to_string())?;

    let count = content.matches(old_string).count();
    if count == 0 {
        return Err(format!(
            "Target string to replace was not found in file: {path}"
        ));
    }

    let allow_mult = allow_multiple.unwrap_or(false);
    if count > 1 && !allow_mult {
        return Err(format!(
            "Target string appears {count} times in {path}. Provide a more specific string or set allow_multiple: true."
        ));
    }

    let new_content = if count == 1 {
        content.replacen(old_string, new_string, 1)
    } else {
        content.replace(old_string, new_string)
    };

    fs::write(p, &new_content).map_err(|e| format!("Failed to write modified file: {e}"))?;
    let total_lines = new_content.lines().count();

    Ok(EditFileResult {
        path: path.to_string(),
        replacements: count,
        total_lines,
    })
}

// ───────────────────────────── 4. list_directory ─────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntryInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size_bytes: u64,
    pub modified_epoch: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListDirectoryResult {
    pub path: String,
    pub entries: Vec<DirEntryInfo>,
    pub total_found: usize,
}

pub fn list_directory(
    path: &str,
    recursive: Option<bool>,
    max_depth: Option<usize>,
    limit: Option<usize>,
) -> Result<ListDirectoryResult, String> {
    let root = Path::new(path);
    if !root.exists() {
        return Err(format!("Directory does not exist: {path}"));
    }
    if !root.is_dir() {
        return Err(format!("Path is not a directory: {path}"));
    }

    let is_rec = recursive.unwrap_or(false);
    let depth_limit = max_depth.unwrap_or(if is_rec { 3 } else { 1 });
    let max_entries = limit.unwrap_or(300);

    let mut entries = Vec::new();
    collect_entries(root, 1, depth_limit, max_entries, &mut entries)?;

    // Sort directories first, then alphabetical by name
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    let total = entries.len();
    Ok(ListDirectoryResult {
        path: path.to_string(),
        entries,
        total_found: total,
    })
}

fn collect_entries(
    dir: &Path,
    current_depth: usize,
    max_depth: usize,
    limit: usize,
    out: &mut Vec<DirEntryInfo>,
) -> Result<(), String> {
    if current_depth > max_depth || out.len() >= limit {
        return Ok(());
    }

    let read_dir = match fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return Ok(()), // skip unreadable directories
    };

    for entry in read_dir.flatten() {
        if out.len() >= limit {
            break;
        }

        let p = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // Symlinks and junctions are listed but never entered: Windows profiles carry
        // self-referencing junctions ("Application Data") that would loop.
        let is_link = entry.file_type().is_ok_and(|kind| kind.is_symlink());
        let metadata = entry.metadata().ok();
        let is_dir = !is_link && metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        if is_dir && is_skipped_dir(&name) {
            continue;
        }
        let size_bytes = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
        let modified_epoch = metadata
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs());

        out.push(DirEntryInfo {
            name,
            path: p.to_string_lossy().replace('\\', "/"),
            is_dir,
            size_bytes,
            modified_epoch,
        });

        if is_dir && current_depth < max_depth {
            collect_entries(&p, current_depth + 1, max_depth, limit, out)?;
        }
    }

    Ok(())
}

// ───────────────────────────── 5. glob_search ─────────────────────────────

/// Directories the searches never descend into: VCS metadata, dependency and build trees.
fn is_skipped_dir(name: &str) -> bool {
    matches!(name, ".git" | "node_modules" | "target" | ".gemini" | "$Recycle.Bin" | "System Volume Information")
}

/// How much of the disk one search may touch. A search rooted at a home folder or a drive
/// would otherwise walk millions of entries; past the budget it stops and says so.
const WALK_MAX_ENTRIES: usize = 200_000;
const WALK_MAX_TIME: Duration = Duration::from_secs(20);

struct WalkBudget {
    started: Instant,
    visited: usize,
    exhausted: bool,
}

impl WalkBudget {
    fn new() -> Self {
        Self { started: Instant::now(), visited: 0, exhausted: false }
    }

    /// Counts one entry; false once the search has used up its budget.
    fn tick(&mut self) -> bool {
        self.visited += 1;
        if self.visited > WALK_MAX_ENTRIES || (self.visited % 512 == 0 && self.started.elapsed() > WALK_MAX_TIME) {
            self.exhausted = true;
        }
        !self.exhausted
    }
}

/// Calls `visit` for every file under `dir` (depth first), skipping heavy directories and never
/// following symlinks or junctions. `visit` returns false to stop the walk.
fn walk_files(dir: &Path, budget: &mut WalkBudget, visit: &mut dyn FnMut(&Path, &str) -> bool) -> bool {
    let Ok(read_dir) = fs::read_dir(dir) else {
        return true;
    };
    for entry in read_dir.flatten() {
        if !budget.tick() {
            return false;
        }
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_symlink() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let keep_going = if kind.is_dir() {
            is_skipped_dir(&name) || walk_files(&entry.path(), budget, visit)
        } else {
            visit(&entry.path(), &name)
        };
        if !keep_going {
            return false;
        }
    }
    true
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobSearchResult {
    pub base_path: String,
    pub pattern: String,
    pub matches: Vec<String>,
    pub total_matches: usize,
    /// The walk hit its entry or time budget, so files may exist that were not searched.
    pub truncated: bool,
}

pub fn glob_search(
    path: &str,
    pattern: &str,
    limit: Option<usize>,
) -> Result<GlobSearchResult, String> {
    let base = Path::new(path);
    if !base.exists() {
        return Err(format!("Path does not exist: {path}"));
    }

    let max_matches = limit.unwrap_or(200);
    let mut matches = Vec::new();
    let mut budget = WalkBudget::new();
    walk_files(base, &mut budget, &mut |file, name| {
        let relative = file.strip_prefix(base).unwrap_or(file).to_string_lossy().replace('\\', "/");
        if match_pattern(name, pattern) || match_pattern(&relative, pattern) {
            matches.push(file.to_string_lossy().replace('\\', "/"));
        }
        matches.len() < max_matches
    });

    let total = matches.len();
    Ok(GlobSearchResult {
        base_path: path.to_string(),
        pattern: pattern.to_string(),
        matches,
        total_matches: total,
        truncated: budget.exhausted,
    })
}

/// Glob match, case-insensitive: `*` is any run within one path segment, `**` any run across
/// segments, `?` one character. Callers try it against both the file name and the path
/// relative to the search root, so `**/clip*.mp4` and `media/*.mp4` both work.
fn match_pattern(candidate: &str, pattern: &str) -> bool {
    let cand: Vec<char> = candidate.to_lowercase().chars().collect();
    let pat = pattern.replace('\\', "/").to_lowercase();
    let pat = pat.trim_start_matches("./");
    let pat = pat.strip_prefix("**/").unwrap_or(pat);
    let pat: Vec<char> = pat.chars().collect();
    wildcard(&pat, &cand)
}

fn wildcard(pat: &[char], text: &[char]) -> bool {
    match pat.first() {
        None => text.is_empty(),
        Some('*') if pat.get(1) == Some(&'*') => {
            // `**/` may also stand for no directories at all.
            let rest = &pat[2..];
            let rest_no_slash = rest.strip_prefix(&['/']).unwrap_or(rest);
            (0..=text.len()).any(|skip| wildcard(rest, &text[skip..]) || wildcard(rest_no_slash, &text[skip..]))
        }
        Some('*') => {
            let rest = &pat[1..];
            let segment = text.iter().position(|&c| c == '/').unwrap_or(text.len());
            (0..=segment).any(|skip| wildcard(rest, &text[skip..]))
        }
        Some('?') => text.first().is_some_and(|&c| c != '/') && wildcard(&pat[1..], &text[1..]),
        Some(&c) => text.first() == Some(&c) && wildcard(&pat[1..], &text[1..]),
    }
}

// ───────────────────────────── 6. grep_search ─────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepMatch {
    pub file: String,
    pub line_number: usize,
    pub line_content: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepSearchResult {
    pub query: String,
    pub matches: Vec<GrepMatch>,
    pub total_matches: usize,
    /// The walk hit its entry or time budget, so files may exist that were not searched.
    pub truncated: bool,
}

/// Text files larger than this are not grepped: they are logs or data, and reading them
/// whole would stall the search.
const GREP_MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;

pub fn grep_search(
    path: &str,
    query: &str,
    file_pattern: Option<&str>,
    max_matches: Option<usize>,
) -> Result<GrepSearchResult, String> {
    let base = Path::new(path);
    if !base.exists() {
        return Err(format!("Path does not exist: {path}"));
    }

    let limit = max_matches.unwrap_or(100);
    let mut matches = Vec::new();
    let q_lower = query.to_lowercase();
    let mut budget = WalkBudget::new();
    walk_files(base, &mut budget, &mut |file, name| {
        if file_pattern.is_some_and(|pat| !match_pattern(name, pat)) || is_binary_extension(name) {
            return true;
        }
        if fs::metadata(file).map_or(true, |meta| meta.len() > GREP_MAX_FILE_BYTES) {
            return true;
        }
        if let Ok(content) = fs::read_to_string(file) {
            for (idx, line) in content.lines().enumerate() {
                if matches.len() >= limit {
                    break;
                }
                if line.to_lowercase().contains(&q_lower) {
                    matches.push(GrepMatch {
                        file: file.to_string_lossy().replace('\\', "/"),
                        line_number: idx + 1,
                        line_content: line.chars().take(200).collect(),
                    });
                }
            }
        }
        matches.len() < limit
    });

    let total = matches.len();
    Ok(GrepSearchResult {
        query: query.to_string(),
        matches,
        total_matches: total,
        truncated: budget.exhausted,
    })
}

fn is_binary_extension(name: &str) -> bool {
    let lower = name.to_lowercase();
    let exts = [
        ".mp4", ".mov", ".avi", ".mkv", ".webm", ".wav", ".mp3", ".flac", ".aac", ".ogg", ".png",
        ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".ico", ".tiff", ".pdf", ".zip", ".tar",
        ".gz", ".7z", ".exe", ".dll", ".dylib", ".so", ".bin", ".iso", ".dat",
    ];
    exts.iter().any(|ext| lower.ends_with(ext))
}

// ───────────────────────────── 7. run_command ─────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunCommandResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub duration_ms: u64,
}

pub async fn run_command(
    command: &str,
    cwd: Option<&str>,
    timeout_secs: Option<u64>,
) -> Result<RunCommandResult, String> {
    let work_dir = if let Some(d) = cwd {
        let p = PathBuf::from(d);
        if !p.exists() {
            return Err(format!("Working directory does not exist: {d}"));
        }
        p
    } else {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    };

    let timeout_duration = Duration::from_secs(timeout_secs.unwrap_or(60).clamp(1, 600));
    let start_time = Instant::now();

    let shell = |program: &str, args: &[&str]| {
        let mut c = tokio::process::Command::new(program);
        #[cfg(windows)]
        c.creation_flags(CREATE_NO_WINDOW);
        c.args(args);
        c.current_dir(&work_dir);
        c.stdin(Stdio::null());
        c.stdout(Stdio::piped());
        c.stderr(Stdio::piped());
        // A command that is abandoned mid-way must not outlive its call.
        c.kill_on_drop(true);
        c.spawn()
    };

    #[cfg(windows)]
    let spawned = shell("pwsh", &["-NoProfile", "-NonInteractive", "-Command", command])
        .or_else(|_| shell("powershell", &["-NoProfile", "-NonInteractive", "-Command", command]))
        .or_else(|_| shell("cmd", &["/C", command]));

    #[cfg(not(windows))]
    let spawned = shell("sh", &["-c", command]);

    let mut child = spawned.map_err(|e| format!("Failed to execute command: {e}"))?;
    let pid = child.id();
    // Both pipes drain while the command runs; a full pipe would stall it.
    let (mut stdout_task, mut stderr_task) = (drain(child.stdout.take()), drain(child.stderr.take()));
    let finished = tokio::time::timeout(timeout_duration, async {
        let status = child.wait().await?;
        let stdout = (&mut stdout_task).await.unwrap_or_default();
        let stderr = (&mut stderr_task).await.unwrap_or_default();
        Ok::<_, std::io::Error>((status, stdout, stderr))
    })
    .await;
    let (status, stdout, stderr) = match finished {
        Ok(res) => res.map_err(|e| format!("Failed to execute command: {e}"))?,
        Err(_) => {
            // The shell may have started ffmpeg, python or a server: the whole tree goes, before
            // the shell itself, while its children can still be found through it.
            kill_tree(pid).await;
            let _ = child.kill().await;
            stdout_task.abort();
            stderr_task.abort();
            return Err(format!(
                "Command timed out after {} seconds and was stopped",
                timeout_duration.as_secs()
            ));
        }
    };

    let duration_ms = start_time.elapsed().as_millis() as u64;
    let stdout = String::from_utf8_lossy(&stdout).to_string();
    let stderr = String::from_utf8_lossy(&stderr).to_string();
    let exit_code = status.code().unwrap_or(-1);

    Ok(RunCommandResult {
        stdout,
        stderr,
        exit_code,
        duration_ms,
    })
}

/// Reads a child's pipe to the end on its own task.
fn drain(pipe: Option<impl AsyncRead + Unpin + Send + 'static>) -> tokio::task::JoinHandle<Vec<u8>> {
    tokio::spawn(async move {
        let mut bytes = Vec::new();
        if let Some(mut pipe) = pipe {
            let _ = pipe.read_to_end(&mut bytes).await;
        }
        bytes
    })
}

/// Stops a process and everything it started.
#[cfg(windows)]
async fn kill_tree(pid: Option<u32>) {
    let Some(pid) = pid else {
        return;
    };
    let mut taskkill = tokio::process::Command::new("taskkill");
    taskkill.creation_flags(CREATE_NO_WINDOW);
    taskkill.args(["/T", "/F", "/PID", &pid.to_string()]);
    taskkill.stdout(Stdio::null());
    taskkill.stderr(Stdio::null());
    let _ = tokio::time::timeout(Duration::from_secs(10), taskkill.status()).await;
}

#[cfg(not(windows))]
async fn kill_tree(_pid: Option<u32>) {}

#[cfg(test)]
mod tests {
    use super::{glob_search, match_pattern, read_file, run_command};

    /// With no range, a long file comes back one window at a time, saying where it stopped.
    #[test]
    fn read_file_without_a_range_stops_at_the_default_window() {
        let path = std::env::temp_dir().join(format!("helios-read-{}.log", std::process::id()));
        let text: String = (1..=5000).map(|line| format!("line {line}
")).collect();
        std::fs::write(&path, text).unwrap();
        let whole = read_file(path.to_str().unwrap(), None, None).unwrap();
        let ranged = read_file(path.to_str().unwrap(), Some(4990), Some(5000)).unwrap();
        let paged = read_file(path.to_str().unwrap(), Some(4900), None).unwrap();
        let _ = std::fs::remove_file(&path);
        assert_eq!(whole.content.lines().count(), 400);
        assert_eq!((whole.end_line, whole.total_lines, whole.truncated), (400, 5000, true));
        assert_eq!((ranged.content.lines().count(), ranged.end_line, ranged.truncated), (11, 5000, false));
        assert_eq!((paged.end_line, paged.truncated), (5000, false));
    }

    #[test]
    fn read_file_without_a_range_stops_at_32_kb() {
        let path = std::env::temp_dir().join(format!("helios-read-wide-{}.txt", std::process::id()));
        let text: String = (0..300).map(|_| format!("{}
", "w".repeat(1000))).collect();
        std::fs::write(&path, text).unwrap();
        let read = read_file(path.to_str().unwrap(), None, None).unwrap();
        let _ = std::fs::remove_file(&path);
        assert!(read.content.len() <= 32 * 1024, "{}", read.content.len());
        assert!(read.truncated && read.end_line < 300, "{}", read.end_line);
        assert_eq!(read.content.lines().count(), read.end_line);
    }

    /// A timed-out command is stopped with everything it started, not left running behind the
    /// error.
    #[cfg(windows)]
    #[tokio::test]
    async fn a_timed_out_command_is_stopped_with_its_children() {
        let marker = format!("helios-timeout-{}", std::process::id());
        let command = format!("powershell -NoProfile -NonInteractive -Command 'Start-Sleep 30 # {marker}'; Start-Sleep 30");
        let started = std::time::Instant::now();
        let error = run_command(&command, None, Some(2)).await.expect_err("times out");
        assert!(error.contains("timed out after 2 seconds and was stopped"), "{error}");
        assert!(started.elapsed() < std::time::Duration::from_secs(20));
        // The query splits the marker so its own command line does not match it.
        let (head, tail) = marker.split_at(6);
        let query = format!(
            "@(Get-CimInstance Win32_Process | Where-Object {{ $_.CommandLine -like ('*' + '{head}' + '{tail}' + '*') }}).Count"
        );
        let mut remaining = String::new();
        for _ in 0..10 {
            let output = std::process::Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", &query])
                .output()
                .expect("query processes");
            remaining = String::from_utf8_lossy(&output.stdout).trim().to_owned();
            if remaining == "0" {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(300));
        }
        assert_eq!(remaining, "0", "a process from the timed-out command is still running");
    }

    #[test]
    fn globs_match_wildcards_anywhere_in_the_name() {
        assert!(match_pattern("Herdr Copy Mode.mp4", "**/herdr*.mp4"));
        assert!(match_pattern("clip.MP4", "*.mp4"));
        assert!(match_pattern("clip_01.mov", "clip_??.mov"));
        assert!(match_pattern("notes.md", "notes.md"));
        assert!(!match_pattern("herdr.mp4.part", "herdr*.mp4"));
        assert!(!match_pattern("other.mp4", "herdr*.mp4"));
    }

    #[test]
    fn slash_patterns_match_the_relative_path() {
        assert!(match_pattern("media/a.mp4", "media/*.mp4"));
        assert!(!match_pattern("media/deep/a.mp4", "media/*.mp4"));
        assert!(match_pattern("media/deep/a.mp4", "media/**/*.mp4"));
        assert!(match_pattern("media/a.mp4", "media/**/*.mp4"));
    }

    #[test]
    fn glob_search_finds_nested_files_and_skips_heavy_dirs() {
        let root = std::env::temp_dir().join(format!("helios-glob-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("a/b")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/x")).unwrap();
        std::fs::write(root.join("a/b/Herdr Copy.mp4"), b"").unwrap();
        std::fs::write(root.join("node_modules/x/herdr.mp4"), b"").unwrap();
        let found = glob_search(root.to_str().unwrap(), "**/herdr*.mp4", Some(10)).unwrap();
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(found.total_matches, 1, "{:?}", found.matches);
        assert!(found.matches[0].ends_with("a/b/Herdr Copy.mp4"));
        assert!(!found.truncated);
    }
}
