//! System and developer tools for Helios AI: file reading/writing/editing, directory listing,
//! glob/grep search, and terminal command execution.
//!
//! These tools provide parity with the toolsets of Claude Code and Codex, allowing any AI
//! model inside Helios (API, local, or CLI) to inspect projects, write code/scripts/assets,
//! and run terminal commands.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, UNIX_EPOCH};

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
}

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
        let e_idx = end.min(total_lines);
        all_lines[s_idx..e_idx].to_vec()
    };

    let mut numbered_content = String::new();
    for (i, line) in slice.iter().enumerate() {
        let line_num = start + i;
        numbered_content.push_str(&format!("{:5}: {}\n", line_num, line));
    }

    Ok(ReadFileResult {
        path: path.to_string(),
        content: numbered_content,
        total_lines,
        start_line: start,
        end_line: end,
        size_bytes,
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

        // Skip internal/heavy directories unless root
        if p.is_dir() && (name == ".git" || name == "node_modules" || name == "target") {
            continue;
        }

        let metadata = entry.metadata().ok();
        let is_dir = metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false);
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

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobSearchResult {
    pub base_path: String,
    pub pattern: String,
    pub matches: Vec<String>,
    pub total_matches: usize,
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
    let pat_lower = pattern.to_lowercase();

    walk_glob(base, &pat_lower, max_matches, &mut matches);

    let total = matches.len();
    Ok(GlobSearchResult {
        base_path: path.to_string(),
        pattern: pattern.to_string(),
        matches,
        total_matches: total,
    })
}

fn walk_glob(dir: &Path, pattern: &str, limit: usize, matches: &mut Vec<String>) {
    if matches.len() >= limit {
        return;
    }
    let read_dir = match fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return,
    };

    for entry in read_dir.flatten() {
        if matches.len() >= limit {
            break;
        }
        let p = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if p.is_dir() {
            if name == ".git" || name == "node_modules" || name == "target" {
                continue;
            }
            walk_glob(&p, pattern, limit, matches);
        } else if match_pattern(&name, pattern)
            || match_pattern(&p.to_string_lossy().replace('\\', "/"), pattern)
        {
            matches.push(p.to_string_lossy().replace('\\', "/"));
        }
    }
}

fn match_pattern(candidate: &str, pattern: &str) -> bool {
    let cand = candidate.to_lowercase();
    let pat = pattern.trim_start_matches("**/").to_lowercase();

    if pat.starts_with('*') && pat.ends_with('*') && pat.len() > 2 {
        let sub = &pat[1..pat.len() - 1];
        cand.contains(sub)
    } else if pat.starts_with('*') {
        let ext = &pat[1..];
        cand.ends_with(ext)
    } else if pat.ends_with('*') {
        let pre = &pat[..pat.len() - 1];
        cand.starts_with(pre)
    } else {
        cand == pat || cand.ends_with(&format!("/{}", pat))
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
}

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

    walk_grep(base, &q_lower, file_pattern, limit, &mut matches);

    let total = matches.len();
    Ok(GrepSearchResult {
        query: query.to_string(),
        matches,
        total_matches: total,
    })
}

fn walk_grep(
    dir: &Path,
    query_lower: &str,
    file_pat: Option<&str>,
    limit: usize,
    matches: &mut Vec<GrepMatch>,
) {
    if matches.len() >= limit {
        return;
    }
    let read_dir = match fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return,
    };

    for entry in read_dir.flatten() {
        if matches.len() >= limit {
            break;
        }
        let p = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if p.is_dir() {
            if name == ".git" || name == "node_modules" || name == "target" || name == ".gemini" {
                continue;
            }
            walk_grep(&p, query_lower, file_pat, limit, matches);
        } else {
            // Check file pattern if provided
            if let Some(pat) = file_pat {
                if !match_pattern(&name, pat) {
                    continue;
                }
            }
            // Skip known binary formats
            if is_binary_extension(&name) {
                continue;
            }
            // Read file lines
            if let Ok(content) = fs::read_to_string(&p) {
                for (idx, line) in content.lines().enumerate() {
                    if matches.len() >= limit {
                        break;
                    }
                    if line.to_lowercase().contains(query_lower) {
                        matches.push(GrepMatch {
                            file: p.to_string_lossy().replace('\\', "/"),
                            line_number: idx + 1,
                            line_content: line.chars().take(200).collect(),
                        });
                    }
                }
            }
        }
    }
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

    #[cfg(windows)]
    let run_future = async {
        let mut c = tokio::process::Command::new("pwsh");
        c.creation_flags(CREATE_NO_WINDOW);
        c.args(["-NoProfile", "-NonInteractive", "-Command", command]);
        c.current_dir(&work_dir);
        match c.output().await {
            Ok(out) => Ok(out),
            Err(_) => {
                let mut fallback = tokio::process::Command::new("powershell");
                fallback.creation_flags(CREATE_NO_WINDOW);
                fallback.args(["-NoProfile", "-NonInteractive", "-Command", command]);
                fallback.current_dir(&work_dir);
                match fallback.output().await {
                    Ok(out) => Ok(out),
                    Err(_) => {
                        let mut cmd_fallback = tokio::process::Command::new("cmd");
                        cmd_fallback.creation_flags(CREATE_NO_WINDOW);
                        cmd_fallback.args(["/C", command]);
                        cmd_fallback.current_dir(&work_dir);
                        cmd_fallback.output().await
                    }
                }
            }
        }
    };

    #[cfg(not(windows))]
    let run_future = async {
        let mut c = tokio::process::Command::new("sh");
        c.args(["-c", command]);
        c.current_dir(&work_dir);
        c.output().await
    };

    let output = match tokio::time::timeout(timeout_duration, run_future).await {
        Ok(res) => res.map_err(|e| format!("Failed to execute command: {e}"))?,
        Err(_) => {
            return Err(format!(
                "Command timed out after {} seconds",
                timeout_duration.as_secs()
            ))
        }
    };

    let duration_ms = start_time.elapsed().as_millis() as u64;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    Ok(RunCommandResult {
        stdout,
        stderr,
        exit_code,
        duration_ms,
    })
}
