//! Offline speech models: the catalogue Helios can fetch, what is already on this machine,
//! and the download itself.
//!
//! Transcription and voice each need two things — a small runtime binary (whisper.cpp, Piper)
//! and the weights. Neither ships with Helios: together they are gigabytes and most people
//! only ever want one language. So both are listed here, downloaded on demand into the Helios
//! data folder, and detected wherever the user already has them.

use crate::jobs::JobHandle;
use futures_util::StreamExt;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tokio::io::AsyncWriteExt;

pub const MODELS_EVENT: &str = "helios://models";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Kind {
    /// whisper.cpp — the program that runs a speech model.
    SttRuntime,
    /// Whisper weights, in GGML form.
    SttModel,
    /// Piper — the program that runs a voice.
    TtsRuntime,
    /// One Piper voice: an ONNX file and its config.
    TtsVoice,
    /// A matting model: separates the subject from the background, frame by frame.
    Matte,
    /// A research candidate requiring an explicit runtime and license benchmark.
    MatteCandidate,
}

/// One file to fetch, and where it lands under the models folder.
struct Source {
    url: &'static str,
    path: &'static str,
}

struct Entry {
    id: &'static str,
    kind: Kind,
    label: &'static str,
    detail: &'static str,
    /// BCP-47-ish tags the UI filters on; `hinglish` is a Helios label, not a language code.
    languages: &'static [&'static str],
    size_mb: u32,
    files: &'static [Source],
    /// Archives are unpacked where they land; the binary inside is then searched for.
    archive: bool,
    /// Relative to the models folder: the file that proves the entry is here. For an archive,
    /// the folder to search under.
    marker: &'static str,
    recommended: bool,
    license: &'static str,
}

/// The hosts every catalogue URL is built from. `concat!` needs literals, so the macros spell
/// them out and the test checks each one against these.
#[cfg(test)]
const HF_WHISPER: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";
#[cfg(test)]
const HF_PIPER: &str = "https://huggingface.co/rhasspy/piper-voices/resolve/main";

macro_rules! whisper_model {
    ($id:literal, $file:literal, $label:literal, $detail:literal, $size:literal, $langs:expr, $rec:literal) => {
        Entry {
            id: $id,
            kind: Kind::SttModel,
            label: $label,
            detail: $detail,
            languages: $langs,
            size_mb: $size,
            files: &[Source {
                url: concat!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/", $file),
                path: concat!("stt/", $file),
            }],
            archive: false,
            marker: concat!("stt/", $file),
            recommended: $rec,
            license: "MIT · OpenAI Whisper weights",
        }
    };
}

macro_rules! piper_voice {
    ($id:literal, $dir:literal, $name:literal, $label:literal, $detail:literal, $size:literal, $langs:expr, $rec:literal) => {
        Entry {
            id: $id,
            kind: Kind::TtsVoice,
            label: $label,
            detail: $detail,
            languages: $langs,
            size_mb: $size,
            files: &[
                Source {
                    url: concat!("https://huggingface.co/rhasspy/piper-voices/resolve/main/", $dir, "/", $name, ".onnx"),
                    path: concat!("tts/", $name, ".onnx"),
                },
                Source {
                    url: concat!("https://huggingface.co/rhasspy/piper-voices/resolve/main/", $dir, "/", $name, ".onnx.json"),
                    path: concat!("tts/", $name, ".onnx.json"),
                },
            ],
            archive: false,
            marker: concat!("tts/", $name, ".onnx"),
            recommended: $rec,
            license: "MIT · Piper voices",
        }
    };
}

/// The whisper.cpp build for this platform. Only Windows gets an official prebuilt zip, so
/// elsewhere the entry exists to be *detected*, not downloaded.
const WHISPER_RUNTIME_FILES: &[Source] = if cfg!(windows) {
    &[Source {
        url: "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip",
        path: "bin/whisper/whisper-bin-x64.zip",
    }]
} else {
    &[]
};

const PIPER_RUNTIME_FILES: &[Source] = if cfg!(windows) {
    &[Source {
        url: "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip",
        path: "bin/piper/piper_windows_amd64.zip",
    }]
} else if cfg!(target_os = "macos") {
    &[Source {
        url: "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_macos_x64.tar.gz",
        path: "bin/piper/piper_macos_x64.tar.gz",
    }]
} else {
    &[Source {
        url: "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz",
        path: "bin/piper/piper_linux_x86_64.tar.gz",
    }]
};

const WHISPER_NAMES: &[&str] = &["whisper-cli", "whisper", "whisper-cpp", "main"];
const PIPER_NAMES: &[&str] = &["piper"];

/// Robust Video Matting. Chosen over a photo matting model because it carries recurrent state
/// from frame to frame: the matte is steady where a per-frame model crawls and flickers, which is
/// the whole difference between a usable roto and a rejected one. The frontend runs it — see
/// `src/lib/roto.ts` — so the desktop binary needs no inference runtime of its own.
macro_rules! matte_model {
    ($id:literal, $file:literal, $label:literal, $detail:literal, $size:literal, $rec:literal) => {
        Entry {
            id: $id,
            kind: Kind::Matte,
            label: $label,
            detail: $detail,
            languages: &["any"],
            size_mb: $size,
            files: &[Source {
                url: concat!("https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/", $file),
                path: concat!("matte/", $file),
            }],
            archive: false,
            marker: concat!("matte/", $file),
            recommended: $rec,
            license: "GPL-3.0 - Robust Video Matting (Peter Lin)",
        }
    };
}

const CATALOG: &[Entry] = &[
    Entry {
        id: "whisper-runtime",
        kind: Kind::SttRuntime,
        label: "whisper.cpp",
        detail: "Runs Whisper on this computer — no key, no upload, no length limit. Needed before any offline transcription model can be used.",
        languages: &["multilingual"],
        size_mb: 28,
        files: WHISPER_RUNTIME_FILES,
        archive: true,
        marker: "bin/whisper",
        recommended: true,
        license: "MIT",
    },
    matte_model!(
        "matte-rvm",
        "rvm_mobilenetv3_fp32.onnx",
        "Robust Video Matting",
        "Separates a person from the background across a whole clip, keeping the edge steady from frame to frame. Runs on this computer.",
        15,
        true
    ),
    matte_model!(
        "matte-rvm-fp16",
        "rvm_mobilenetv3_fp16.onnx",
        "Robust Video Matting (half precision)",
        "The same model at half the size and roughly twice the speed, with a slightly softer edge.",
        8,
        false
    ),
    // SAM 2.1 and ViTMatte use the live Local Media installer and CUDA worker.
    // Do not duplicate them here as non-downloadable research candidates.
    Entry { id: "sam3.1", kind: Kind::MatteCandidate, label: "SAM 3.1 (evaluation only)", detail: "Separate evaluation slot. Helios will not enable this model until its runtime, checkpoint terms and commercial license are verified.", languages: &["restricted"], size_mb: 0, files: &[], archive: false, marker: "candidates/sam3.1", recommended: false, license: "License/runtime review required before commercial use" },
    Entry { id: "matanyone2", kind: Kind::MatteCandidate, label: "MatAnyone2 (restricted candidate)", detail: "Restricted research candidate. Kept visible for review only; never downloaded or enabled automatically.", languages: &["restricted"], size_mb: 0, files: &[], archive: false, marker: "candidates/matanyone2", recommended: false, license: "Commercial-use permission required" },
    Entry { id: "videomama", kind: Kind::MatteCandidate, label: "VideoMaMa (restricted candidate)", detail: "Restricted research candidate. Kept visible for review only; never downloaded or enabled automatically.", languages: &["restricted"], size_mb: 0, files: &[], archive: false, marker: "candidates/videomama", recommended: false, license: "Commercial-use permission required" },
    Entry { id: "corridorkey", kind: Kind::MatteCandidate, label: "CorridorKey (review required)", detail: "Separate commercial integration review required before any runtime or checkpoint can be used.", languages: &["review"], size_mb: 0, files: &[], archive: false, marker: "candidates/corridorkey", recommended: false, license: "Commercial integration review required" },
    whisper_model!("whisper-base", "ggml-base.bin", "Whisper base", "Quick and tiny. Fine for clear English; it will mangle Hindi.", 148, &["en"], false),
    whisper_model!("whisper-small", "ggml-small.bin", "Whisper small", "A good balance for English. Hindi is hit and miss.", 488, &["en", "hi"], false),
    whisper_model!("whisper-medium", "ggml-medium.bin", "Whisper medium", "Solid Hindi and English, but slower than turbo for no real gain.", 1530, &["en", "hi", "hinglish"], false),
    whisper_model!(
        "whisper-large-v3-turbo-q5",
        "ggml-large-v3-turbo-q5_0.bin",
        "Whisper large v3 turbo (q5)",
        "The one to pick. Large-v3 accuracy several times faster, and it keeps up with Hindi, English and code-switched Hinglish.",
        574,
        &["en", "hi", "hinglish"],
        true
    ),
    whisper_model!(
        "whisper-large-v3-q5",
        "ggml-large-v3-q5_0.bin",
        "Whisper large v3 (q5)",
        "The most accurate model that still fits in a sane amount of memory. Slower than turbo.",
        1080,
        &["en", "hi", "hinglish"],
        false
    ),
    whisper_model!(
        "whisper-large-v3",
        "ggml-large-v3.bin",
        "Whisper large v3 (full)",
        "Full precision — the best Hindi and Hinglish there is offline, but it is 3 GB and wants a strong machine.",
        3100,
        &["en", "hi", "hinglish"],
        false
    ),
    Entry {
        id: "piper-runtime",
        kind: Kind::TtsRuntime,
        label: "Piper",
        detail: "A fast neural voice engine that runs on the CPU. Needed before any offline voice can speak.",
        languages: &["multilingual"],
        size_mb: 22,
        files: PIPER_RUNTIME_FILES,
        archive: true,
        marker: "bin/piper",
        recommended: true,
        license: "MIT",
    },
    piper_voice!(
        "piper-hi-priyamvada",
        "hi/hi_IN/priyamvada/medium",
        "hi_IN-priyamvada-medium",
        "Priyamvada — Hindi, female",
        "Warm Hindi narration. The Hindi half of the default Hinglish pair.",
        64,
        &["hi", "hinglish"],
        true
    ),
    piper_voice!(
        "piper-hi-pratham",
        "hi/hi_IN/pratham/medium",
        "hi_IN-pratham-medium",
        "Pratham — Hindi, male",
        "Clear Hindi male read, good for explainers.",
        64,
        &["hi", "hinglish"],
        false
    ),
    piper_voice!(
        "piper-hi-rohan",
        "hi/hi_IN/rohan/medium",
        "hi_IN-rohan-medium",
        "Rohan — Hindi, male",
        "Brighter, younger Hindi male voice.",
        64,
        &["hi", "hinglish"],
        false
    ),
    piper_voice!(
        "piper-en-hfc-female",
        "en/en_US/hfc_female/medium",
        "en_US-hfc_female-medium",
        "HFC Female — English (US)",
        "The most natural of the Piper English voices, and the English half of the default Hinglish pair.",
        64,
        &["en", "hinglish"],
        true
    ),
    piper_voice!(
        "piper-en-ryan",
        "en/en_US/ryan/high",
        "en_US-ryan-high",
        "Ryan — English (US), high",
        "Higher-quality English male voice; a larger file and a little slower.",
        114,
        &["en", "hinglish"],
        false
    ),
    piper_voice!(
        "piper-en-amy",
        "en/en_US/amy/medium",
        "en_US-amy-medium",
        "Amy — English (US)",
        "Light, friendly English female voice.",
        64,
        &["en", "hinglish"],
        false
    ),
    piper_voice!(
        "piper-en-gb-alba",
        "en/en_GB/alba/medium",
        "en_GB-alba-medium",
        "Alba — English (UK)",
        "Scottish-accented English female voice.",
        64,
        &["en"],
        false
    ),
];

// ───────────────────────────── what the UI sees ─────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub kind: Kind,
    pub label: String,
    pub detail: String,
    pub languages: Vec<String>,
    pub size_mb: u32,
    pub installed: bool,
    /// The weights, or the runtime's program, once it is here.
    pub path: Option<String>,
    pub recommended: bool,
    /// False when no prebuilt exists for this platform — then it can only be detected.
    pub downloadable: bool,
    pub license: String,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub found: bool,
    pub path: Option<String>,
    /// `downloaded` · `custom` · `system` — where it was found, so the UI can say.
    pub source: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechStatus {
    pub models: Vec<ModelInfo>,
    pub whisper: RuntimeStatus,
    pub piper: RuntimeStatus,
    /// Where downloads land, for the "Open folder" button.
    pub folder: String,
}

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_owned()
    }
}

fn exe_names(names: &[&str]) -> Vec<String> {
    names.iter().map(|name| exe(name)).collect()
}

/// Looks for `names` anywhere under `dir`, at most `depth` levels down, in the order given.
/// Release archives nest their binaries differently from build to build, so this assumes no
/// layout — and the order matters: whisper.cpp still ships a `main.exe` that does nothing but
/// print "use whisper-cli instead", and it sorts first in the same folder.
fn find_under(dir: &Path, names: &[String], depth: usize) -> Option<PathBuf> {
    names.iter().find_map(|name| find_named(dir, name, depth))
}

fn find_named(dir: &Path, name: &str, depth: usize) -> Option<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return None;
    };
    let mut dirs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if entry.file_name().to_string_lossy().eq_ignore_ascii_case(name) {
                return Some(path);
            }
        } else if path.is_dir() {
            dirs.push(path);
        }
    }
    if depth == 0 {
        return None;
    }
    dirs.sort();
    dirs.into_iter().find_map(|child| find_named(&child, name, depth - 1))
}

/// The first of `names`, in the order given, found on PATH.
fn on_path(names: &[String]) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    let dirs: Vec<PathBuf> = std::env::split_paths(&path).collect();
    names
        .iter()
        .find_map(|name| dirs.iter().map(|dir| dir.join(name)).find(|candidate| candidate.is_file()))
}

/// Where a runtime is: the explicit setting first, then Helios' own download, then PATH.
fn locate(root: &Path, folder: &str, names: &[&str], explicit: Option<&str>) -> RuntimeStatus {
    let names = exe_names(names);
    if let Some(given) = explicit.map(str::trim).filter(|value| !value.is_empty()) {
        let path = PathBuf::from(given);
        let found = if path.is_file() { Some(path) } else { find_under(&path, &names, 2) };
        if let Some(path) = found {
            return RuntimeStatus { found: true, path: Some(path.display().to_string()), source: "custom".to_owned() };
        }
    }
    if let Some(path) = find_under(&root.join(folder), &names, 3) {
        return RuntimeStatus { found: true, path: Some(path.display().to_string()), source: "downloaded".to_owned() };
    }
    if let Some(path) = on_path(&names) {
        return RuntimeStatus { found: true, path: Some(path.display().to_string()), source: "system".to_owned() };
    }
    RuntimeStatus::default()
}

/// The whisper.cpp program to run, if there is one. Older builds call it `main`.
pub fn whisper_binary(root: &Path, explicit: Option<&str>) -> Option<PathBuf> {
    locate(root, "bin/whisper", WHISPER_NAMES, explicit).path.map(PathBuf::from)
}

pub fn piper_binary(root: &Path, explicit: Option<&str>) -> Option<PathBuf> {
    locate(root, "bin/piper", PIPER_NAMES, explicit).path.map(PathBuf::from)
}

fn entry(id: &str) -> Option<&'static Entry> {
    CATALOG.iter().find(|entry| entry.id == id)
}

fn installed_path(root: &Path, item: &Entry) -> Option<PathBuf> {
    if item.archive {
        let names = exe_names(if item.kind == Kind::SttRuntime { WHISPER_NAMES } else { PIPER_NAMES });
        return find_under(&root.join(item.marker), &names, 3);
    }
    // A download still in flight is a `.part`; only a renamed file counts as installed.
    let path = root.join(item.marker);
    path.is_file().then_some(path)
}

/// The weights for one installed model, by catalogue id.
pub fn model_path(root: &Path, id: &str) -> Option<PathBuf> {
    entry(id).filter(|item| !item.archive).and_then(|item| installed_path(root, item))
}

/// Every installed entry of one kind, in catalogue order.
pub fn installed(root: &Path, kind: Kind) -> Vec<(&'static str, PathBuf)> {
    CATALOG
        .iter()
        .filter(|item| item.kind == kind)
        .filter_map(|item| installed_path(root, item).map(|path| (item.id, path)))
        .collect()
}

/// The label the catalogue gives an id, for naming a voice in the UI.
pub fn label_of(id: &str) -> Option<&'static str> {
    entry(id).map(|item| item.label)
}

pub fn languages_of(id: &str) -> &'static [&'static str] {
    entry(id).map(|item| item.languages).unwrap_or(&[])
}

pub fn status(root: &Path, whisper_path: Option<&str>, piper_path: Option<&str>) -> SpeechStatus {
    let models = CATALOG
        .iter()
        .map(|item| {
            let path = installed_path(root, item);
            ModelInfo {
                id: item.id.to_owned(),
                kind: item.kind,
                label: item.label.to_owned(),
                detail: item.detail.to_owned(),
                languages: item.languages.iter().map(|language| (*language).to_owned()).collect(),
                size_mb: item.size_mb,
                installed: path.is_some(),
                path: path.map(|path| path.display().to_string()),
                recommended: item.recommended,
                downloadable: !item.files.is_empty(),
                license: item.license.to_owned(),
            }
        })
        .collect();
    SpeechStatus {
        models,
        whisper: locate(root, "bin/whisper", WHISPER_NAMES, whisper_path),
        piper: locate(root, "bin/piper", PIPER_NAMES, piper_path),
        folder: root.display().to_string(),
    }
}

// ───────────────────────────── downloading ─────────────────────────────

fn human(bytes: u64) -> String {
    if bytes >= 1024 * 1024 * 1024 {
        format!("{:.1} GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
    } else {
        format!("{} MB", bytes / (1024 * 1024))
    }
}

/// Streams one file to disk through a `.part` sibling, so a cancelled or crashed download
/// never looks installed. Reports 0–1 within `span`, offset by `base`.
async fn fetch(url: &str, target: &Path, job: &JobHandle, base: f64, span: f64, label: &str) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("cannot create {}: {error}", parent.display()))?;
    }
    let response = reqwest::Client::builder()
        .user_agent(concat!("Helios/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("cannot start the download: {error}"))?
        .get(url)
        .send()
        .await
        .map_err(|error| format!("could not reach the download server: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("the download server refused this file ({}). Check your connection, then try again.", response.status()));
    }
    let total = response.content_length();
    let part = target.with_extension("part");
    let mut file = tokio::fs::File::create(&part)
        .await
        .map_err(|error| format!("cannot write {}: {error}", part.display()))?;
    let mut stream = response.bytes_stream();
    let mut done: u64 = 0;
    let mut reported: u64 = 0;
    while let Some(chunk) = stream.next().await {
        if *job.cancel.borrow() {
            drop(file);
            let _ignored = tokio::fs::remove_file(&part).await;
            return Err("cancelled".to_owned());
        }
        let chunk = chunk.map_err(|error| format!("the download broke off: {error}"))?;
        file.write_all(&chunk).await.map_err(|error| format!("cannot write {}: {error}", part.display()))?;
        done += chunk.len() as u64;
        // Reporting every chunk would flood the UI with events; every 2 MB is plenty.
        if done - reported > 2 * 1024 * 1024 {
            reported = done;
            let fraction = total.filter(|total| *total > 0).map_or(0.0, |total| done as f64 / total as f64);
            let of = total.map(|total| format!(" of {}", human(total))).unwrap_or_default();
            job.progress(base + span * fraction, format!("{label} — {}{of}", human(done)));
        }
    }
    file.flush().await.map_err(|error| format!("cannot finish {}: {error}", part.display()))?;
    drop(file);
    std::fs::rename(&part, target).map_err(|error| {
        let _ignored = std::fs::remove_file(&part);
        format!("cannot save {}: {error}", target.display())
    })
}

/// The `tar` to unpack with. Windows ships libarchive's, which reads zip as happily as tar.gz —
/// but a Git or MSYS install puts GNU tar on PATH first, and that one cannot read a zip and
/// reads `C:\…` as a remote host. So on Windows the system one is named outright.
fn tar_program() -> PathBuf {
    if cfg!(windows) {
        let system = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
        let bsdtar = system.join("System32").join("tar.exe");
        if bsdtar.is_file() {
            return bsdtar;
        }
    }
    PathBuf::from("tar")
}

/// Unpacks a zip or a tar.gz, keeping a whole archive crate (and its build) out of Helios.
/// PowerShell is the second try on Windows, for the builds where `tar.exe` is missing.
async fn unpack(archive: &Path, into: &Path) -> Result<(), String> {
    std::fs::create_dir_all(into).map_err(|error| format!("cannot create {}: {error}", into.display()))?;
    let (from, to) = (archive.display().to_string(), into.display().to_string());
    let first = crate::tools::run(&tar_program(), &["-xf", &from, "-C", &to], None).await;
    if first.is_ok() {
        return Ok(());
    }
    if cfg!(windows) && archive.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("zip")) {
        let script = format!("Expand-Archive -LiteralPath '{from}' -DestinationPath '{to}' -Force");
        let powershell = crate::tools::run(
            Path::new("powershell"),
            &["-NoProfile", "-NonInteractive", "-Command", &script],
            None,
        )
        .await;
        if powershell.is_ok() {
            return Ok(());
        }
    }
    Err(format!(
        "could not unpack {}: {}",
        archive.display(),
        first.err().unwrap_or_default()
    ))
}

/// Fetches one catalogue entry, reporting through `job`. Files already on disk are skipped,
/// so a retry after a broken download only fetches what is missing.
pub async fn download(root: &Path, id: &str, job: &JobHandle) -> Result<String, String> {
    let Some(item) = entry(id) else {
        return Err(format!("no such model: {id}"));
    };
    if item.files.is_empty() {
        return Err(format!(
            "{} has no prebuilt download for this platform. Install it yourself, then press Locate… in Settings › Speech & voice.",
            item.label
        ));
    }
    let count = item.files.len() as f64;
    for (index, file) in item.files.iter().enumerate() {
        let target = root.join(file.path);
        if target.is_file() && !item.archive {
            continue;
        }
        let base = index as f64 / count;
        job.progress(base, format!("Downloading {}", item.label));
        fetch(file.url, &target, job, base, 0.9 / count, item.label).await?;
        if item.archive {
            job.progress(base + 0.9 / count, format!("Unpacking {}", item.label));
            let into = target.parent().map(Path::to_path_buf).unwrap_or_else(|| root.to_path_buf());
            unpack(&target, &into).await?;
            // The archive is dead weight once unpacked, and it only confuses the size on disk.
            let _ignored = std::fs::remove_file(&target);
        }
    }
    match installed_path(root, item) {
        Some(path) => Ok(path.display().to_string()),
        None => Err(format!(
            "{} downloaded, but Helios could not find {} inside it. Press Locate… in Settings › Speech & voice to point at it.",
            item.label,
            if item.archive { "the program" } else { "the file" }
        )),
    }
}

/// Removes one entry's files. A runtime takes its whole folder with it.
pub fn remove(root: &Path, id: &str) -> Result<(), String> {
    let Some(item) = entry(id) else {
        return Err(format!("no such model: {id}"));
    };
    if item.archive {
        let dir = root.join(item.marker);
        if dir.is_dir() {
            std::fs::remove_dir_all(&dir).map_err(|error| format!("cannot remove {}: {error}", dir.display()))?;
        }
        return Ok(());
    }
    for file in item.files {
        let path = root.join(file.path);
        if path.is_file() {
            std::fs::remove_file(&path).map_err(|error| format!("cannot remove {}: {error}", path.display()))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{entry, exe, exe_names, find_under, human, installed_path, CATALOG, HF_PIPER, HF_WHISPER};

    #[test]
    fn every_catalogue_id_is_unique_and_downloads_over_https() {
        let mut ids: Vec<&str> = CATALOG.iter().map(|item| item.id).collect();
        ids.sort_unstable();
        let count = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), count, "catalogue ids must be unique");
        for item in CATALOG {
            assert!(!item.label.is_empty());
            assert!(!item.marker.is_empty());
            for file in item.files {
                assert!(file.url.starts_with("https://"), "{} must download over https", item.id);
                assert!(!file.path.starts_with('/'), "{} must land inside the models folder", item.id);
            }
        }
        // Every URL must come from one of the two hosts, so a typo cannot quietly point elsewhere.
        for item in CATALOG {
            for file in item.files {
                let hosted = file.url.starts_with(HF_WHISPER)
                    || file.url.starts_with(HF_PIPER)
                    || file.url.starts_with("https://github.com/ggml-org/whisper.cpp/releases/")
                    || file.url.starts_with("https://github.com/rhasspy/piper/releases/")
                    || file.url.starts_with("https://github.com/PeterL1n/RobustVideoMatting/releases/");
                assert!(hosted, "{} downloads from somewhere unexpected: {}", item.id, file.url);
            }
        }
    }

    #[test]
    fn a_model_counts_as_installed_only_once_its_file_is_renamed_into_place() {
        let root = std::env::temp_dir().join(format!("helios-models-{}", crate::store::new_id()));
        let item = entry("whisper-base").expect("catalogue entry");
        assert!(installed_path(&root, item).is_none());
        let target = root.join(item.marker);
        std::fs::create_dir_all(target.parent().expect("parent")).expect("dirs");
        // A download still in flight is a `.part`, and must not look ready.
        std::fs::write(target.with_extension("part"), b"half").expect("part");
        assert!(installed_path(&root, item).is_none());
        std::fs::write(&target, b"weights").expect("file");
        assert_eq!(installed_path(&root, item), Some(target));
        let _ignored = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_first_name_wins_even_when_a_later_one_sorts_ahead_of_it() {
        // whisper.cpp ships `main.exe` beside `whisper-cli.exe`; `main` only prints a notice
        // telling you to use the other one, and `main` sorts first.
        let root = std::env::temp_dir().join(format!("helios-order-{}", crate::store::new_id()));
        let dir = root.join("Release");
        std::fs::create_dir_all(&dir).expect("dirs");
        let stub = dir.join(exe("main"));
        let real = dir.join(exe("whisper-cli"));
        std::fs::write(&stub, b"deprecated").expect("stub");
        std::fs::write(&real, b"binary").expect("real");
        let names = exe_names(super::WHISPER_NAMES);
        assert_eq!(find_under(&root, &names, 3), Some(real));
        // With only the stub there, it is still better than nothing.
        std::fs::remove_file(dir.join(exe("whisper-cli"))).expect("remove");
        assert_eq!(find_under(&root, &names, 3), Some(stub));
        let _ignored = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_program_is_found_however_the_archive_nested_it() {
        let root = std::env::temp_dir().join(format!("helios-find-{}", crate::store::new_id()));
        let nested = root.join("Release").join("inner");
        std::fs::create_dir_all(&nested).expect("dirs");
        let wanted = nested.join(exe("piper"));
        std::fs::write(&wanted, b"binary").expect("write");
        let names = vec![exe("piper")];
        assert_eq!(find_under(&root, &names, 3), Some(wanted));
        // Out of reach of the search depth, it is not found.
        assert_eq!(find_under(&root, &names, 0), None);
        let _ignored = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn sizes_read_the_way_people_write_them() {
        assert_eq!(human(5 * 1024 * 1024), "5 MB");
        assert_eq!(human(3 * 1024 * 1024 * 1024 / 2), "1.5 GB");
    }
}
