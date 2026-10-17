//! "In use": which downloaded model Bhippi's AI reaches for in each job (video, image, audio, voice,
//! speech, roto, local language model). The choice is kept in the library's `state.json` and also
//! written onto the settings the older features already read, so they follow it:
//!
//! | job | settings it sets |
//! |---|---|
//! | `video` | `localVideoModel` (`ltx` · `wan` · `wan22` · `ltx23`) for a local-media model; MiniMax H3 only the record |
//! | `image` | `localImageModel` (`sdxl` · `flux`) |
//! | `speech` | `speech.transcribeModel` (the Model Center id of the Whisper size) |
//! | `voice` | `speech.voice` (`kokoro:<speaker>` for Kokoro v1.0, `sherpa:<pack>/<voice>` for every other voice pack) |
//! | `roto` | `localRotoEngine` (`rvm` · `sam2-vitmatte`) |
//! | `audio`, `llm` | the record only |
//!
//! `disableLocalGeneration` follows the video and image choices: off exactly when one of them is a
//! local-media model. The functions here are pure (no app handle) so they can be tested.

use super::{install_of, is_file_runtime, DefaultRecord, LibraryEntry, LibraryState, StateFile};
use crate::settings::Settings;
use serde::Serialize;
use std::collections::BTreeMap;

pub(super) const CAPABILITIES: [&str; 7] = ["video", "image", "audio", "voice", "speech", "roto", "llm"];

/// The Kokoro speaker used when the voice was not a Kokoro one and the person puts Kokoro in use.
const DEFAULT_KOKORO_VOICE: &str = "kokoro:af_heart";

/// A voice that runs on this PC (Kokoro v1.0 or another downloaded voice pack), as `speech.voice` stores it.
fn is_local_voice(voice: &str) -> bool {
    voice.starts_with("kokoro:") || voice.starts_with("sherpa:")
}

/// The Model Center id a saved local voice belongs to: `kokoro-v1` for `kokoro:…`, the pack's id for `sherpa:…`.
fn center_of_voice(voice: &str) -> Option<String> {
    if voice.starts_with("kokoro:") {
        return Some("kokoro-v1".to_owned());
    }
    crate::kokoro::voices::pack_of_voice_id(voice).map(str::to_owned)
}

/// The Model Center id one downloaded size (or the whole model) of a library card installs.
fn center_of_candidate(entries: &[LibraryEntry], candidate: &Candidate) -> Option<String> {
    let entry = entries.iter().find(|entry| entry.id == candidate.model_id)?;
    install_of(entry, candidate.variant.as_deref()).and_then(|install| install.model_center_id.clone())
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub model_id: String,
    pub name: String,
    pub variant: Option<String>,
    pub variant_label: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityChoice {
    pub capability: String,
    pub model_id: Option<String>,
    pub variant: Option<String>,
    pub candidates: Vec<Candidate>,
    pub note: String,
}

/// The job a model can do, if it is one of the seven.
fn capability_of(entry: &LibraryEntry) -> Option<&'static str> {
    match entry.kind.as_str() {
        "video" => Some("video"),
        "image" => Some("image"),
        "audio" => Some("audio"),
        "voice" => Some("voice"),
        "speech" => Some("speech"),
        "llm" => Some("llm"),
        "matte" if entry.tasks.iter().any(|task| task == "roto") => Some("roto"),
        _ => None,
    }
}

fn is_local_media(entries: &[LibraryEntry], id: &str) -> bool {
    entries.iter().any(|entry| entry.id == id && entry.runtime == "local-media")
}

/// The older setting value of a local-media model: `ltx`, `wan`, `wan22`, `ltx23`, `sdxl` or `flux`.
fn local_kind(entry: &LibraryEntry) -> Option<&'static str> {
    match entry.install.as_ref()?.task.as_deref()? {
        "video-ltx" => Some("ltx"),
        "video-wan" => Some("wan"),
        "video-wan22" => Some("wan22"),
        "video-ltx23" => Some("ltx23"),
        "image" => Some("sdxl"),
        "image-flux" => Some("flux"),
        _ => None,
    }
}

/// The downloaded, whole models that can do `capability`, one per size where sizes matter.
pub(super) fn candidates(capability: &str, entries: &[LibraryEntry], states: &BTreeMap<String, LibraryState>) -> Vec<Candidate> {
    let mut out = Vec::new();
    for entry in entries {
        if capability_of(entry) != Some(capability) {
            continue;
        }
        // ViTMatte only works together with SAM 2.1, so the pair is one choice, listed as SAM 2.1.
        if capability == "roto" && entry.id == "vitmatte" {
            continue;
        }
        let Some(state) = states.get(&entry.id) else { continue };
        if state.broken.is_some() || state.installed_variants.is_empty() {
            continue;
        }
        if capability == "roto" && entry.id == "sam2" && states.get("vitmatte").map_or(true, |other| other.installed_variants.is_empty() || other.broken.is_some()) {
            continue;
        }
        let name = if capability == "roto" && entry.id == "sam2" { "SAM 2.1 + ViTMatte (tracked Roto)".to_owned() } else { entry.name.clone() };
        let sized = entry.variants.len() > 1 || is_file_runtime(entry);
        if !sized {
            out.push(Candidate { model_id: entry.id.clone(), name, variant: None, variant_label: None });
            continue;
        }
        for size in &state.installed_variants {
            let label = entry.variants.iter().find(|variant| &variant.id == size).map(|variant| variant.label.clone());
            out.push(Candidate { model_id: entry.id.clone(), name: name.clone(), variant: Some(size.clone()), variant_label: label });
        }
    }
    out
}

fn find_candidate<'a>(list: &'a [Candidate], id: &str, variant: Option<&str>) -> Option<&'a Candidate> {
    list.iter().find(|candidate| candidate.model_id == id && (variant.is_none() || candidate.variant.as_deref() == variant))
}

/// The model in use for a job: the recorded choice when it is still downloaded, else what the older
/// settings say. Returns the model id and size.
fn effective(
    capability: &str,
    records: &BTreeMap<String, DefaultRecord>,
    list: &[Candidate],
    entries: &[LibraryEntry],
    settings: &Settings,
) -> Option<(String, Option<String>)> {
    let local_off = settings.disable_local_generation.unwrap_or(true);
    let gated = capability == "video" || capability == "image";
    if let Some(record) = records.get(capability) {
        let Some(id) = &record.model_id else { return None };
        if let Some(found) = find_candidate(list, id, record.variant.as_deref()) {
            // The old "local generation" switch still turns a local-media model off.
            if gated && local_off && is_local_media(entries, id) {
                return None;
            }
            return Some((found.model_id.clone(), found.variant.clone()));
        }
    }
    let by_task = |task: &str| entries.iter().find(|entry| entry.install.as_ref().and_then(|install| install.task.as_deref()) == Some(task) && entry.runtime == "local-media");
    let pick = |entry: Option<&LibraryEntry>| entry.and_then(|entry| find_candidate(list, &entry.id, None)).map(|found| (found.model_id.clone(), found.variant.clone()));
    match capability {
        "video" if !local_off => match settings.local_video_model.as_deref() {
            Some("custom") => None,
            Some(kind) => pick(by_task(&format!("video-{kind}"))),
            None => ["video-ltx23", "video-wan", "video-ltx"].into_iter().find_map(|task| pick(by_task(task))),
        },
        "image" if !local_off => pick(by_task(if settings.local_image_model.as_deref() == Some("flux") { "image-flux" } else { "image" })),
        "audio" => list.first().map(|found| (found.model_id.clone(), found.variant.clone())),
        "voice" => {
            // The saved voice says which downloaded voice pack is speaking.
            let center = center_of_voice(settings.speech.voice.as_deref()?)?;
            list.iter().find(|candidate| center_of_candidate(entries, candidate).as_deref() == Some(center.as_str())).map(|found| (found.model_id.clone(), found.variant.clone()))
        }
        "speech" => {
            let chosen = settings.speech.transcribe_model.as_deref().filter(|id| !id.is_empty())?;
            let whisper = entries.iter().find(|entry| entry.id == "whisper")?;
            let size = whisper.variants.iter().find(|variant| install_of(whisper, Some(&variant.id)).and_then(|install| install.model_center_id.as_deref()) == Some(chosen))?;
            find_candidate(list, "whisper", Some(&size.id)).map(|found| (found.model_id.clone(), found.variant.clone()))
        }
        "roto" => {
            if settings.local_roto_engine.as_deref() == Some("sam2-vitmatte") {
                if let Some(found) = find_candidate(list, "sam2", None) {
                    return Some((found.model_id.clone(), None));
                }
            }
            find_candidate(list, "rvm", None).map(|found| (found.model_id.clone(), found.variant.clone()))
        }
        _ => None,
    }
}

/// One plain sentence on what the choice means for the AI.
fn note_for(capability: &str, chosen: Option<&Candidate>, any_downloaded: bool) -> String {
    let named = chosen.map(|found| match &found.variant_label {
        Some(label) => format!("{} ({label})", found.name),
        None => found.name.clone(),
    });
    match (capability, named) {
        ("video", Some(name)) => format!("Bhippi's AI makes video with {name}."),
        ("video", None) => "The AI won't make video on this PC.".to_owned(),
        ("image", Some(name)) => format!("Bhippi's AI makes images with {name}."),
        ("image", None) => "The AI won't make images on this PC.".to_owned(),
        ("audio", Some(name)) => format!("Bhippi's AI makes sound effects and music with {name}."),
        ("audio", None) => "The AI won't make sound effects or music on this PC.".to_owned(),
        ("voice", Some(name)) => format!("Bhippi's AI reads scripts aloud offline with {name}."),
        ("voice", None) => "No offline voice is chosen, so Bhippi uses a cloud voice or the best one it finds.".to_owned(),
        ("speech", Some(name)) => format!("Bhippi transcribes speech on this PC with {name}."),
        ("speech", None) => "No Whisper size is chosen, so Bhippi uses a cloud transcriber or the best Whisper it finds.".to_owned(),
        ("roto", Some(name)) => format!("Roto cuts out people with {name}."),
        ("roto", None) if any_downloaded => "No Roto model is chosen; Roto uses the built-in default.".to_owned(),
        ("roto", None) => "No Roto model is downloaded yet.".to_owned(),
        ("llm", Some(name)) => format!("Bhippi's local assistant is {name}; start it from the language models page."),
        ("llm", None) => "No local language model is chosen.".to_owned(),
        _ => String::new(),
    }
}

/// Every job with its downloaded choices and what is in use now.
pub(super) fn compute(entries: &[LibraryEntry], states: &BTreeMap<String, LibraryState>, records: &BTreeMap<String, DefaultRecord>, settings: &Settings) -> Vec<CapabilityChoice> {
    CAPABILITIES
        .iter()
        .map(|capability| {
            let list = candidates(capability, entries, states);
            let chosen = effective(capability, records, &list, entries, settings);
            let found = chosen.as_ref().and_then(|(id, variant)| find_candidate(&list, id, variant.as_deref()));
            CapabilityChoice {
                capability: (*capability).to_owned(),
                model_id: chosen.as_ref().map(|(id, _)| id.clone()),
                variant: chosen.as_ref().and_then(|(_, variant)| variant.clone()),
                note: note_for(capability, found, !list.is_empty()),
                candidates: list,
            }
        })
        .collect()
}

fn switch_on(entries: &[LibraryEntry], file: &mut StateFile, id: &str) {
    let file_runtime = entries.iter().find(|entry| entry.id == id).is_some_and(is_file_runtime);
    let record = file.models.entry(id.to_owned()).or_default();
    if file_runtime {
        record.enabled = true;
    } else {
        record.off = false;
    }
}

/// `disableLocalGeneration` is off exactly when the video or the image job uses a local-media model.
fn sync_local_generation(entries: &[LibraryEntry], file: &StateFile, prefs: &mut Settings) {
    // Only when a record exists for one of the two: otherwise the older switch alone decides.
    if !["video", "image"].iter().any(|job| file.defaults.contains_key(*job)) {
        return;
    }
    let local = ["video", "image"].iter().any(|job| file.defaults.get(*job).and_then(|record| record.model_id.as_deref()).is_some_and(|id| is_local_media(entries, id)));
    prefs.disable_local_generation = Some(!local);
}

/// Puts `model_id` in use for `capability` (or none), switching it on and setting what the older
/// features read. Nothing is changed when it fails.
pub(super) fn apply(
    capability: &str,
    model_id: Option<&str>,
    variant: Option<&str>,
    entries: &[LibraryEntry],
    states: &BTreeMap<String, LibraryState>,
    file: &mut StateFile,
    prefs: &mut Settings,
) -> Result<(), String> {
    let Some(capability) = CAPABILITIES.iter().copied().find(|known| *known == capability) else {
        return Err(format!("Bhippi's AI has no job called {capability}."));
    };
    let was_off = prefs.disable_local_generation.unwrap_or(true);
    let Some(requested) = model_id else {
        file.defaults.insert(capability.to_owned(), DefaultRecord::default());
        match capability {
            "speech" => prefs.speech.transcribe_model = None,
            "voice" => {
                if prefs.speech.voice.as_deref().is_some_and(is_local_voice) {
                    prefs.speech.voice = None;
                }
            }
            "roto" => prefs.local_roto_engine = None,
            _ => {}
        }
        if capability == "video" || capability == "image" {
            sync_local_generation(entries, file, prefs);
        }
        return Ok(());
    };
    // ViTMatte is chosen together with SAM 2.1.
    let id = if capability == "roto" && requested == "vitmatte" { "sam2" } else { requested };
    let entry = entries.iter().find(|entry| entry.id == id).ok_or_else(|| format!("There is no model called {id} in the library."))?;
    if capability_of(entry) != Some(capability) {
        return Err(format!("{} cannot do that job.", entry.name));
    }
    let list = candidates(capability, entries, states);
    let found = match variant {
        Some(size) => find_candidate(&list, id, Some(size)),
        None => {
            // No size named: the model's own default size when it is downloaded, else the first one that is.
            let default_size = entry.variants.iter().find(|size| size.default == Some(true)).or_else(|| entry.variants.first()).map(|size| size.id.as_str());
            find_candidate(&list, id, default_size).or_else(|| find_candidate(&list, id, None))
        }
    }
    .cloned()
    .ok_or_else(|| match variant {
        Some(size) => format!("{} ({size}) is not downloaded yet. Download it first.", entry.name),
        None => format!("{} is not downloaded yet. Download it first.", entry.name),
    })?;

    file.defaults.insert(capability.to_owned(), DefaultRecord { model_id: Some(id.to_owned()), variant: found.variant.clone() });
    switch_on(entries, file, id);
    match capability {
        "video" => {
            if let Some(kind) = local_kind(entry) {
                prefs.local_video_model = Some(kind.to_owned());
            }
        }
        "image" => {
            if let Some(kind) = local_kind(entry) {
                prefs.local_image_model = Some(kind.to_owned());
            }
        }
        "speech" => {
            let center = install_of(entry, found.variant.as_deref()).and_then(|install| install.model_center_id.clone());
            prefs.speech.transcribe_model = center;
        }
        // A voice that runs through ComfyUI is chosen by the record alone; no older voice setting follows it.
        "voice" if entry.runtime == "comfyui" => {}
        "voice" => {
            let center = install_of(entry, found.variant.as_deref()).and_then(|install| install.model_center_id.clone());
            let current = prefs.speech.voice.clone();
            if center.as_deref() == Some("kokoro-v1") || center.is_none() {
                if !current.as_deref().is_some_and(|voice| voice.starts_with("kokoro:")) {
                    prefs.speech.voice = Some(DEFAULT_KOKORO_VOICE.to_owned());
                }
            } else if let Some(first) = center.as_deref().and_then(crate::kokoro::voices::default_voice_id) {
                // Keep the speaker the person already picked in this pack; otherwise its first one.
                if current.as_deref().and_then(center_of_voice) != center {
                    prefs.speech.voice = Some(first);
                }
            }
        }
        "roto" => prefs.local_roto_engine = Some(if id == "sam2" { "sam2-vitmatte" } else { "rvm" }.to_owned()),
        _ => {}
    }
    // Turning local generation on for one job must not quietly turn it on for the other.
    if was_off && is_local_media(entries, id) && (capability == "video" || capability == "image") {
        let other = if capability == "video" { "image" } else { "video" };
        file.defaults.entry(other.to_owned()).or_default();
    }
    if capability == "video" || capability == "image" {
        sync_local_generation(entries, file, prefs);
    }
    Ok(())
}

/// Takes a model (or one of its sizes) out of every job it was in use for, and undoes what that
/// choice wrote into the settings.
pub(super) fn clear(entries: &[LibraryEntry], file: &mut StateFile, prefs: &mut Settings, id: &str, size: Option<&str>) {
    let held: Vec<String> = file
        .defaults
        .iter()
        .filter(|(_, record)| record.model_id.as_deref() == Some(id) && (size.is_none() || record.variant.as_deref() == size))
        .map(|(job, _)| job.clone())
        .collect();
    if held.is_empty() {
        return;
    }
    let entry = entries.iter().find(|entry| entry.id == id);
    for job in &held {
        file.defaults.insert(job.clone(), DefaultRecord::default());
        match job.as_str() {
            "speech" => {
                let center = entry.and_then(|entry| size.and_then(|size| install_of(entry, Some(size))).or(entry.install.as_ref()).and_then(|install| install.model_center_id.clone()));
                if center.is_none() || prefs.speech.transcribe_model == center {
                    prefs.speech.transcribe_model = None;
                }
            }
            "voice" if entry.is_some_and(|entry| entry.runtime == "comfyui") => {}
            "voice" => {
                // Only the voice this model or size provides goes; a voice from another pack stays.
                let centers: Vec<String> = entry
                    .map(|entry| {
                        let sized = entry.variants.iter().filter(|variant| size.is_none() || Some(variant.id.as_str()) == size);
                        sized.filter_map(|variant| install_of(entry, Some(&variant.id)).and_then(|install| install.model_center_id.clone())).collect()
                    })
                    .unwrap_or_default();
                let current = prefs.speech.voice.as_deref().filter(|voice| is_local_voice(voice));
                if current.is_some() && (centers.is_empty() || current.and_then(center_of_voice).is_some_and(|center| centers.contains(&center))) {
                    prefs.speech.voice = None;
                }
            }
            "roto" => prefs.local_roto_engine = None,
            _ => {}
        }
    }
    if held.iter().any(|job| job == "video" || job == "image") {
        sync_local_generation(entries, file, prefs);
    }
}
