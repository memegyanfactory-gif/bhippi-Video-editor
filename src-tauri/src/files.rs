//! `.helios` project files, media relinking, voice-over recordings, and the two analysis passes
//! the editor asks FFmpeg for: Scene Edit Detection and audio peak levels.

use crate::library::Asset;
use crate::project::Project;
use crate::tools::Tools;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Project files are JSON; anything larger than this is not one of ours.
const MAX_DOCUMENT: u64 = 256 * 1024 * 1024;
pub const EXTENSION: &str = "helios";

/// What a `.helios` file holds: the project plus the media it references, so another session on
/// this machine can relink it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub format: String,
    pub version: u32,
    #[serde(default)]
    pub saved_at: String,
    pub project: Project,
    #[serde(default)]
    pub assets: Vec<Asset>,
}

fn check_extension(path: &Path) -> Result<(), String> {
    if path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case(EXTENSION)) {
        Ok(())
    } else {
        Err(format!("Helios projects are .{EXTENSION} files"))
    }
}

/// Reads a project file, refusing anything that is not one.
pub fn read_document(path: &Path) -> Result<Document, String> {
    check_extension(path)?;
    let size = std::fs::metadata(path).map_err(|error| format!("cannot open {}: {error}", path.display()))?.len();
    if size > MAX_DOCUMENT {
        return Err("that file is too large to be a Helios project".to_owned());
    }
    let text = std::fs::read_to_string(path).map_err(|error| format!("cannot read it: {error}"))?;
    let mut document: Document = serde_json::from_str(&text).map_err(|error| format!("that is not a Helios project: {error}"))?;
    if document.format != "helios" {
        return Err("that JSON file is not a Helios project".to_owned());
    }
    document.project.sanitize();
    document.project.validate_shape()?;
    Ok(document)
}

/// Writes a project file atomically, after checking the project it carries.
pub fn write_document(path: &Path, document: &Document) -> Result<(), String> {
    check_extension(path)?;
    let mut doc = document.clone();
    doc.project.sanitize();
    doc.project.validate_shape()?;
    if let Some(parent) = path.parent().filter(|parent| !parent.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent).map_err(|error| format!("cannot create {}: {error}", parent.display()))?;
    }
    crate::store::write_json(path, &doc)
}

/// A child process that never flashes a console window, with both streams captured.
fn command(program: &Path) -> tokio::process::Command {
    let mut command = tokio::process::Command::new(program);
    command.stdin(std::process::Stdio::null());
    command.kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    command
}

async fn ffmpeg_stdout(tools: &Tools, args: &[String]) -> Result<String, String> {
    let ffmpeg = tools.ffmpeg()?;
    let output = command(ffmpeg)
        .args(["-hide_banner", "-nostdin", "-loglevel", "error"])
        .args(args)
        .output()
        .await
        .map_err(|error| format!("could not start FFmpeg: {error}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail: Vec<&str> = stderr.lines().filter(|line| !line.trim().is_empty()).collect();
        Err(tail[tail.len().saturating_sub(4)..].join(" · "))
    }
}

/// Scene Edit Detection: the source times where the picture changes, in seconds.
///
/// The analysis runs on a small scaled copy — it only has to find cuts, not look at them — and
/// FFmpeg's scene score is printed as frame metadata so it comes back on stdout.
pub async fn detect_scenes(tools: &Tools, path: &Path, start: f64, end: f64, sensitivity: f64) -> Result<Vec<f64>, String> {
    let span = (end - start).max(0.0);
    if span < 0.5 {
        return Ok(Vec::new());
    }
    let threshold = (0.45 - 0.35 * sensitivity.clamp(0.0, 1.0)).clamp(0.04, 0.6);
    let filter = format!("scale=320:-2,select='gt(scene,{threshold:.3})',metadata=print:file=-");
    let args = [
        "-ss".to_owned(),
        format!("{:.4}", start.max(0.0)),
        "-t".to_owned(),
        format!("{span:.4}"),
        "-i".to_owned(),
        path.display().to_string(),
        "-an".to_owned(),
        "-sn".to_owned(),
        "-vf".to_owned(),
        filter,
        "-f".to_owned(),
        "null".to_owned(),
        "-".to_owned(),
    ];
    let printed = ffmpeg_stdout(tools, &args).await?;
    let mut times = Vec::new();
    for line in printed.lines() {
        // `frame:12 pts:12000 pts_time:12.012`
        if let Some(rest) = line.split("pts_time:").nth(1) {
            if let Ok(time) = rest.split_whitespace().next().unwrap_or("").parse::<f64>() {
                let at = start.max(0.0) + time;
                if times.last().is_none_or(|last: &f64| at - last > 0.25) {
                    times.push(at);
                }
            }
        }
    }
    Ok(times)
}

/// The loudest peak of a media range in dBFS (−∞ when it is silent).
pub async fn audio_peak(tools: &Tools, path: &Path, start: f64, end: f64) -> Result<f64, String> {
    let span = (end - start).max(0.0);
    if span <= 0.0 {
        return Err("that clip has no length to measure".to_owned());
    }
    let args = [
        "-ss".to_owned(),
        format!("{:.4}", start.max(0.0)),
        "-t".to_owned(),
        format!("{span:.4}"),
        "-i".to_owned(),
        path.display().to_string(),
        "-vn".to_owned(),
        "-af".to_owned(),
        "astats=metadata=1:reset=0,ametadata=print:key=lavfi.astats.Overall.Peak_level:file=-".to_owned(),
        "-f".to_owned(),
        "null".to_owned(),
        "-".to_owned(),
    ];
    let printed = ffmpeg_stdout(tools, &args).await?;
    let mut peak = f64::NEG_INFINITY;
    for line in printed.lines() {
        if let Some(value) = line.split('=').nth(1) {
            if let Ok(level) = value.trim().parse::<f64>() {
                peak = peak.max(level);
            }
        }
    }
    if peak.is_finite() {
        Ok(peak)
    } else {
        Err("that clip has no measurable sound".to_owned())
    }
}

/// Saves a voice-over recording from the browser and converts it to a WAV the editor can read.
pub async fn save_recording(tools: &Tools, dir: &Path, bytes: &[u8], extension: &str) -> Result<PathBuf, String> {
    if bytes.is_empty() {
        return Err("the recording is empty".to_owned());
    }
    if bytes.len() > 512 * 1024 * 1024 {
        return Err("that recording is too long".to_owned());
    }
    let ext: String = extension.chars().filter(|c| c.is_ascii_alphanumeric()).take(8).collect();
    std::fs::create_dir_all(dir).map_err(|error| format!("cannot create {}: {error}", dir.display()))?;
    let stamp = chrono::Local::now().format("%Y-%m-%d %H-%M-%S");
    let raw = dir.join(format!("voice-over {stamp}.{}", if ext.is_empty() { "webm".to_owned() } else { ext }));
    std::fs::write(&raw, bytes).map_err(|error| format!("cannot write the recording: {error}"))?;
    let wav = dir.join(format!("voice-over {stamp}.wav"));
    let args = [
        "-y".to_owned(),
        "-i".to_owned(),
        raw.display().to_string(),
        "-vn".to_owned(),
        "-ac".to_owned(),
        "1".to_owned(),
        "-ar".to_owned(),
        "48000".to_owned(),
        "-c:a".to_owned(),
        "pcm_s16le".to_owned(),
        wav.display().to_string(),
    ];
    match ffmpeg_stdout(tools, &args).await {
        Ok(_) => {
            let _ignored = std::fs::remove_file(&raw);
            Ok(wav)
        }
        // Without FFmpeg the original still plays in the webview, so keep it rather than fail.
        Err(reason) => {
            tracing::warn!(%reason, "could not convert the recording to WAV");
            Ok(raw)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{read_document, write_document, Document};
    use crate::project::Project;

    #[test]
    fn a_project_file_round_trips_and_other_files_are_refused() {
        let dir = std::env::temp_dir().join(format!("helios-doc-{}", crate::store::new_id()));
        std::fs::create_dir_all(&dir).expect("dir");
        let path = dir.join("My Story.helios");
        let document = Document { format: "helios".to_owned(), version: 3, saved_at: "now".to_owned(), project: Project::default(), assets: Vec::new() };
        write_document(&path, &document).expect("write");
        let read = read_document(&path).expect("read");
        assert_eq!(read.project.name, Project::default().name);

        let wrong = dir.join("notes.txt");
        std::fs::write(&wrong, "hi").expect("write");
        assert!(read_document(&wrong).expect_err("refused").contains(".helios"));

        let bogus = dir.join("Other.helios");
        std::fs::write(&bogus, r#"{"format":"premiere","version":1,"project":{}}"#).expect("write");
        assert!(read_document(&bogus).is_err());
        let _ignored = std::fs::remove_dir_all(dir);
    }

    /// Scene detection and peak measurement against the real FFmpeg, on media we synthesise.
    #[tokio::test]
    async fn scenes_and_peaks_come_back_from_ffmpeg() {
        let tools = crate::tools::resolve(None).await;
        let Ok(ffmpeg) = tools.ffmpeg() else {
            eprintln!("FFmpeg not installed; skipping");
            return;
        };
        let dir = std::env::temp_dir().join(format!("helios-analysis-{}", crate::store::new_id()));
        std::fs::create_dir_all(&dir).expect("dir");
        let clip = dir.join("cuts.mp4");
        // Three one-second blocks of very different colour: two cuts in the middle.
        let status = std::process::Command::new(ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=320x180:d=1", "-f", "lavfi", "-i", "color=c=white:s=320x180:d=1", "-f", "lavfi", "-i", "color=c=red:s=320x180:d=1"])
            .args(["-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1[v]", "-map", "[v]", "-r", "25", "-pix_fmt", "yuv420p"])
            .arg(clip.to_str().expect("utf8"))
            .status()
            .expect("ffmpeg runs");
        assert!(status.success());
        let cuts = super::detect_scenes(&tools, &clip, 0.0, 3.0, 0.6).await.expect("scenes");
        assert!(cuts.len() >= 2, "found {cuts:?}");
        assert!(cuts.iter().any(|at| (at - 1.0).abs() < 0.2) && cuts.iter().any(|at| (at - 2.0).abs() < 0.2), "{cuts:?}");

        let tone = dir.join("tone.wav");
        let status = std::process::Command::new(ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-af", "volume=-6dB"])
            .arg(tone.to_str().expect("utf8"))
            .status()
            .expect("ffmpeg runs");
        assert!(status.success());
        // FFmpeg's `sine` source peaks at 1/8 of full scale (−18 dB), so −6 dB of gain lands on −24.
        let peak = super::audio_peak(&tools, &tone, 0.0, 2.0).await.expect("peak");
        assert!((peak + 24.1).abs() < 1.0, "peak {peak} should be about −24 dB");
        let _ignored = std::fs::remove_dir_all(dir);
    }
}
