//! Kokoro, the offline voice: an 82M-parameter model that reads English about as naturally as
//! the paid cloud voices, and Hindi through espeak-ng's Hindi rules.
//!
//! It runs through sherpa-onnx's C library, loaded at run time by the `bhippi-kokoro` crate (the one
//! place `unsafe` is allowed). Two things decide *how* it runs:
//!
//! - The library is driven in a child process — this same executable started with
//!   [`WORKER_FLAG`] — so a crash inside native code can never take the editor down with it.
//! - The text travels over stdin as UTF-8 JSON. sherpa-onnx's own command-line tool reads its
//!   text from `argv`, and on Windows that is the ANSI code page: every Devanagari letter
//!   arrives as `?`. Going through the C API sidesteps that entirely.
//!
//! One worker reads every part of a take, keeping one loaded model per language, so a Hinglish
//! line that switches language five times still loads the weights at most twice.

pub use bhippi_kokoro::{Job, Part, Reading};
use std::path::Path;

/// Starts this executable as a Kokoro worker instead of the editor.
pub const WORKER_FLAG: &str = "--kokoro-worker";

/// One Kokoro speaker: its id inside `voices.bin`, and how Bhippi presents it.
pub struct Speaker {
    pub name: &'static str,
    pub sid: i32,
    pub label: &'static str,
    /// `en` (American), `en-gb` (British) or `hi`.
    pub lang: &'static str,
    pub detail: &'static str,
}

/// The speakers worth offering, best first within each language. The ids are the positions in
/// kokoro-multi-lang-v1_0's `voices.bin`; the rest of its 53 are other languages or weaker reads.
pub const SPEAKERS: &[Speaker] = &[
    Speaker { name: "af_heart", sid: 3, label: "Heart — English (US), female", lang: "en", detail: "The most natural Kokoro voice: warm, clear narration." },
    Speaker { name: "af_bella", sid: 2, label: "Bella — English (US), female", lang: "en", detail: "Bright and expressive, good for shorts and hooks." },
    Speaker { name: "am_michael", sid: 16, label: "Michael — English (US), male", lang: "en", detail: "Calm, steady male narrator." },
    Speaker { name: "am_fenrir", sid: 14, label: "Fenrir — English (US), male", lang: "en", detail: "Deeper, confident male read." },
    Speaker { name: "am_puck", sid: 18, label: "Puck — English (US), male", lang: "en", detail: "Lively, youthful male voice." },
    Speaker { name: "af_nicole", sid: 6, label: "Nicole — English (US), female", lang: "en", detail: "Soft, close-mic whisper style." },
    Speaker { name: "af_sarah", sid: 9, label: "Sarah — English (US), female", lang: "en", detail: "Friendly, conversational read." },
    Speaker { name: "bf_emma", sid: 21, label: "Emma — English (UK), female", lang: "en-gb", detail: "Polished British narration." },
    Speaker { name: "bm_george", sid: 26, label: "George — English (UK), male", lang: "en-gb", detail: "Classic British documentary voice." },
    Speaker { name: "bm_fable", sid: 25, label: "Fable — English (UK), male", lang: "en-gb", detail: "Storyteller tone." },
    Speaker { name: "hf_alpha", sid: 31, label: "Alpha — Hindi, female", lang: "hi", detail: "Hindi narration; also reads Hinglish with a natural Indian-English accent." },
    Speaker { name: "hf_beta", sid: 32, label: "Beta — Hindi, female", lang: "hi", detail: "Softer Hindi female voice." },
    Speaker { name: "hm_omega", sid: 33, label: "Omega — Hindi, male", lang: "hi", detail: "Hindi male narrator; reads Hinglish naturally." },
    Speaker { name: "hm_psi", sid: 34, label: "Psi — Hindi, male", lang: "hi", detail: "Younger Hindi male voice." },
];

pub fn speaker(name: &str) -> Option<&'static Speaker> {
    SPEAKERS.iter().find(|speaker| speaker.name == name)
}

/// File names of the sherpa-onnx C library on this platform.
pub fn library_names() -> &'static [&'static str] {
    if cfg!(windows) {
        &["sherpa-onnx-c-api.dll"]
    } else if cfg!(target_os = "macos") {
        &["libsherpa-onnx-c-api.dylib"]
    } else {
        &["libsherpa-onnx-c-api.so"]
    }
}

/// Reads every part of `job` in a worker process. The library's folder is put on the loader's
/// search path so its onnxruntime sibling is found.
pub async fn run(job: &Job) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|error| format!("cannot find Bhippi's own program: {error}"))?;
    let input = serde_json::to_string(job).map_err(|error| error.to_string())?;
    let lib_dir = job.library.parent().map(Path::to_path_buf).unwrap_or_default();
    let (variable, separator) = if cfg!(windows) {
        ("PATH", ";")
    } else if cfg!(target_os = "macos") {
        ("DYLD_LIBRARY_PATH", ":")
    } else {
        ("LD_LIBRARY_PATH", ":")
    };
    let search = match std::env::var(variable) {
        Ok(existing) if !existing.is_empty() => format!("{}{separator}{existing}", lib_dir.display()),
        _ => lib_dir.display().to_string(),
    };

    use tokio::io::AsyncWriteExt;
    let mut command = tokio::process::Command::new(&exe);
    command
        .arg(WORKER_FLAG)
        .env(variable, search)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        // No console window flashing up for a background voice read.
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn().map_err(|error| format!("could not start the voice engine: {error}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(input.as_bytes()).await.map_err(|error| format!("could not send the script to the voice engine: {error}"))?;
        drop(stdin);
    }
    let output = child.wait_with_output().await.map_err(|error| format!("the voice engine stopped: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let said = String::from_utf8_lossy(&output.stderr);
    let reason = said.lines().rev().find(|line| !line.trim().is_empty()).unwrap_or("it exited without saying why").trim();
    Err(format!("Kokoro could not read that script: {reason}"))
}

/// The worker's whole life: read a [`Job`] from stdin, write every part, exit. Returns the
/// process exit code.
pub fn worker_main() -> i32 {
    let mut input = String::new();
    if let Err(error) = std::io::Read::read_to_string(&mut std::io::stdin(), &mut input) {
        eprintln!("no job on stdin: {error}");
        return 2;
    }
    let job: Job = match serde_json::from_str(&input) {
        Ok(job) => job,
        Err(error) => {
            eprintln!("unreadable job: {error}");
            return 2;
        }
    };
    match bhippi_kokoro::speak(&job) {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("{error}");
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{speaker, SPEAKERS};

    #[test]
    fn every_speaker_is_unique_and_named_for_its_language() {
        let mut names: Vec<&str> = SPEAKERS.iter().map(|speaker| speaker.name).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), SPEAKERS.len());
        for entry in SPEAKERS {
            let prefix = &entry.name[..1];
            let expected = match entry.lang {
                "en" => "a",
                "en-gb" => "b",
                "hi" => "h",
                other => panic!("unexpected language {other}"),
            };
            assert_eq!(prefix, expected, "{} is filed under the wrong language", entry.name);
            assert!((0..53).contains(&entry.sid));
        }
        assert_eq!(speaker("af_heart").map(|s| s.sid), Some(3));
        assert_eq!(speaker("hf_alpha").map(|s| s.sid), Some(31));
    }
}
