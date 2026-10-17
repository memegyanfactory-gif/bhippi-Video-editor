use super::*;
use std::collections::BTreeSet;
use std::sync::atomic::AtomicUsize;
use tokio::io::AsyncReadExt;
use tokio::net::TcpListener;

fn sample(length: usize) -> Vec<u8> {
    (0..length).map(|index| (index.wrapping_mul(31).wrapping_add(7) % 251) as u8).collect()
}

fn sha_of(data: &[u8]) -> String {
    hex(&Sha256::digest(data))
}

fn file_for(url: &str, data: &[u8], with_sha: bool) -> LibraryFile {
    LibraryFile { url: url.to_owned(), dest: "x/model.bin".to_owned(), bytes: data.len() as u64, sha256: with_sha.then(|| sha_of(data)) }
}

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("bhippi-model-library-{name}-{}", ulid::Ulid::new()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// A tiny HTTP server: answers every GET with `data`, honouring `Range` when `ranges` is set.
/// Answers the offsets it was asked for through `seen`.
async fn serve(data: Vec<u8>, ranges: bool, seen: Arc<AtomicUsize>) -> String {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else { return };
            let data = data.clone();
            let seen = seen.clone();
            tokio::spawn(async move {
                let mut request = Vec::new();
                let mut buffer = [0u8; 1024];
                while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                    match socket.read(&mut buffer).await {
                        Ok(0) | Err(_) => return,
                        Ok(read) => request.extend_from_slice(&buffer[..read]),
                    }
                }
                let text = String::from_utf8_lossy(&request).to_ascii_lowercase();
                let start = text
                    .lines()
                    .find_map(|line| line.strip_prefix("range: bytes="))
                    .and_then(|value| value.trim_end_matches('-').parse::<usize>().ok());
                let (head, body) = match start {
                    Some(start) if ranges => {
                        seen.fetch_add(1, Ordering::Relaxed);
                        let body = data[start..].to_vec();
                        (format!("HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {start}-{}/{}\r\nConnection: close\r\n\r\n", body.len(), data.len() - 1, data.len()), body)
                    }
                    _ => (format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", data.len()), data.clone()),
                };
                let _ignored = socket.write_all(head.as_bytes()).await;
                let _ignored = socket.write_all(&body).await;
                let _ignored = socket.shutdown().await;
            });
        }
    });
    format!("http://127.0.0.1:{port}/file.bin")
}

async fn run(url: &str, file: &LibraryFile, target: &Path, start: u64, cancel: bool) -> (Result<(), DownloadError>, u64) {
    let (sender, receiver) = watch::channel(cancel);
    let done = AtomicU64::new(start);
    let mut ticks = || ();
    let client = http_client().unwrap();
    let mut file = file.clone();
    file.url = url.to_owned();
    let result = download_file(&client, &file, target, &receiver, &done, &mut ticks).await;
    drop(sender);
    (result, done.load(Ordering::Relaxed))
}

// ── catalog ──

#[test]
fn every_catalog_file_parses_and_entries_are_sound() {
    let mut ids = BTreeSet::new();
    for (name, text) in CATALOG_SOURCES {
        let entries = parse_source(text).unwrap_or_else(|error| panic!("{name} does not parse: {error}"));
        for entry in entries {
            assert!(ids.insert(entry.id.clone()), "duplicate id {}", entry.id);
            assert!(!entry.variants.is_empty(), "{} has no variants", entry.id);
            let defaults = entry.variants.iter().filter(|variant| variant.default == Some(true)).count();
            assert!(defaults <= 1, "{} flags {defaults} default variants", entry.id);
            assert!(["comfyui", "llama-cpp", "strata", "local-media", "model-center"].contains(&entry.runtime.as_str()), "{} runtime", entry.id);
            match entry.runtime.as_str() {
                "local-media" => assert!(entry.install.as_ref().is_some_and(|install| install.task.is_some()), "{} needs install.task", entry.id),
                "model-center" => assert!(
                    entry.variants.iter().all(|variant| install_of(&entry, Some(&variant.id)).is_some_and(|install| install.model_center_id.is_some())),
                    "{} needs install.modelCenterId on the entry or on every size",
                    entry.id
                ),
                "strata" => assert!(
                    entry.variants.iter().all(|variant| install_of(&entry, Some(&variant.id)).and_then(|install| install.task.as_deref()).is_some_and(|task| crate::strata::Task::parse(task).is_ok())),
                    "{} needs a family:size install.task on every size that Strata's setup accepts",
                    entry.id
                ),
                _ => assert!(entry.variants.iter().all(|variant| !variant.files.is_empty()), "{} variants need files", entry.id),
            }
            let thumbnail = entry.thumbnail.as_ref().unwrap_or_else(|| panic!("{} has no thumbnail", entry.id));
            let src = thumbnail.src.as_deref().unwrap_or_else(|| panic!("{} has no bundled thumbnail", entry.id));
            assert!(src.starts_with("library-thumbs/") && (src.ends_with(".webp") || src.ends_with(".svg")), "{} thumbnail src {src}", entry.id);
            if let Some(url) = &thumbnail.url {
                assert!(url.starts_with("https://"), "{} thumbnail", entry.id);
            }
            let addon_files = entry.addons.iter().flatten().flat_map(|addon| addon.files.iter());
            for file in entry.variants.iter().flat_map(|variant| variant.files.iter()).chain(addon_files) {
                assert!(file.url.starts_with("https://"), "{} file url {}", entry.id, file.url);
                assert!(file.bytes > 0, "{} file {} has no size", entry.id, file.dest);
                assert!(safe_join(Path::new("/base"), &file.dest).is_ok(), "{} dest {}", entry.id, file.dest);
                if let Some(sha) = &file.sha256 {
                    assert!(sha.len() == 64 && sha.chars().all(|c| c.is_ascii_hexdigit()), "{} sha256 of {}", entry.id, file.dest);
                }
            }
        }
    }
    assert!(ids.contains("minimax-h3") && ids.contains("sdxl"));
    assert_eq!(catalog().len(), ids.len(), "the embedded catalog must hold every entry");
}

#[test]
fn existing_install_ids_are_real_installers() {
    // Strata sizes are `family:size` tasks of its own setup, checked in the catalog test above.
    for entry in catalog().iter().filter(|entry| entry.runtime != "strata") {
        let installs = entry.install.iter().chain(entry.variants.iter().filter_map(|variant| variant.install.as_ref()));
        for install in installs {
            if let Some(task) = &install.task {
                let known = crate::LOCAL_INSTALL_TASKS.contains(&task.as_str()) || task == "video-ltx23";
                assert!(known, "{} uses an unknown local-media task {task}", entry.id);
            }
            if let Some(center) = &install.model_center_id {
                assert!(models::label_of(center).is_some(), "{} uses an unknown model center id {center}", entry.id);
            }
        }
    }
}

// ── merged cards, sizes, hub models ──

#[test]
fn whisper_and_rvm_are_one_card_with_sizes() {
    let whisper = find_entry("whisper").unwrap();
    let sizes: Vec<&str> = whisper.variants.iter().map(|variant| variant.id.as_str()).collect();
    assert_eq!(
        sizes,
        [
            "tiny",
            "tiny-en",
            "base",
            "base-en",
            "small",
            "small-en",
            "medium",
            "medium-en",
            "large-v3-turbo-q5",
            "large-v3-turbo-q8",
            "large-v3-turbo",
            "large-v3-q5",
            "large-v3",
            "distil-large-v3",
            "distil-large-v3-5"
        ]
    );
    assert_eq!(default_variant(whisper).unwrap().id, "large-v3-turbo-q5", "the recommended size is unchanged");
    assert_eq!(whisper.kind, "speech");
    for old in ["whisper-base", "whisper-small", "whisper-medium", "whisper-large-v3", "whisper-large-v3-q5", "whisper-large-v3-turbo-q5", "matte-rvm", "matte-rvm-fp16"] {
        assert!(find_entry(old).is_err(), "{old} is now a size, not a card");
    }
    let rvm = find_entry("rvm").unwrap();
    assert_eq!(rvm.variants.len(), 2);
    assert_eq!(install_of(rvm, Some("fp16")).unwrap().model_center_id.as_deref(), Some("matte-rvm-fp16"));
}

#[test]
fn every_whisper_size_is_a_real_whisper_cpp_model_with_its_own_installer() {
    let whisper = find_entry("whisper").unwrap();
    for size in &whisper.variants {
        let center = install_of(whisper, Some(&size.id)).and_then(|install| install.model_center_id.clone()).unwrap();
        assert_eq!(models::kind_of(&center), Some(models::Kind::SttModel), "{} must install a Whisper model", size.id);
        assert!(size.approx_bytes.unwrap_or(0) > 30_000_000, "{} needs a believable size", size.id);
        // English-only sizes say so on the card, because they cannot read Hindi.
        let english_only = center.ends_with("-en") || center.contains("distil");
        assert_eq!(english_only, size.label.contains("English only"), "{} label and file disagree", size.id);
        if english_only {
            assert_eq!(models::languages_of(&center).unwrap(), ["en"], "{center}");
        }
    }
}

#[test]
fn voice_cards_install_real_packs_the_speech_engine_can_load() {
    let voice_cards: Vec<&LibraryEntry> = catalog().iter().filter(|entry| entry.kind == "voice").collect();
    assert!(voice_cards.len() >= 9, "Kokoro v1.0 and v1.1, Kitten, Matcha and the Piper cards");
    let mut seen_packs = BTreeSet::new();
    for entry in voice_cards {
        for size in &entry.variants {
            let center = install_of(entry, Some(&size.id)).and_then(|install| install.model_center_id.clone()).unwrap();
            assert!(models::is_voice(&center), "{} / {} must install a voice", entry.id, size.id);
            if center != "kokoro-v1" {
                assert!(crate::kokoro::voices::pack(&center).is_some(), "{center} has no speaker table in kokoro/voices.rs");
            }
            assert!(seen_packs.insert(center.clone()), "{center} is offered twice");
            assert!(size.approx_bytes.unwrap_or(0) > 10_000_000, "{center} needs a size");
        }
        assert_eq!(entry.runtime, "model-center");
        assert!(entry.thumbnail.as_ref().and_then(|thumbnail| thumbnail.src.as_deref()).is_some_and(|src| src.starts_with("library-thumbs/")));
        assert!(!entry.license.summary.is_empty(), "{} must state its licence", entry.id);
    }
    // Every pack in the speaker table is on a card, so none is unreachable.
    for pack in crate::kokoro::voices::PACKS {
        assert!(seen_packs.contains(pack.id), "{} is in the speaker table but on no card", pack.id);
    }
    // The Hindi Piper voices and the Mandarin Matcha voice are non-commercial: accepting is required.
    for id in ["piper-hindi-south-asia", "matcha-tts"] {
        let entry = find_entry(id).unwrap();
        assert!(entry.license.requires_acceptance, "{id} must be accepted before download");
        assert!(entry.license.summary.iter().any(|line| line.contains("non-commercial") || line.contains("Non-commercial")), "{id} must say it is non-commercial");
    }
    assert!(!find_entry("piper-english-us").unwrap().license.requires_acceptance);
}

#[test]
fn a_size_install_beats_the_model_install() {
    let whisper = find_entry("whisper").unwrap();
    assert_eq!(install_of(whisper, Some("medium")).unwrap().model_center_id.as_deref(), Some("whisper-medium"));
    assert_eq!(install_of(whisper, None).map(|install| install.model_center_id.clone()), None);
    // A model with one install for every size falls back to it.
    let kokoro = find_entry("kokoro-v1").unwrap();
    assert_eq!(install_of(kokoro, Some("standard")).unwrap().model_center_id.as_deref(), Some("kokoro-v1"));
    let mut mixed = kokoro.clone();
    mixed.variants[0].install = Some(Install { task: None, model_center_id: Some("other".to_owned()) });
    assert_eq!(install_of(&mixed, Some("standard")).unwrap().model_center_id.as_deref(), Some("other"));
}

#[test]
fn runtimes_come_first_for_whisper_and_kokoro() {
    assert_eq!(runtime_for("whisper-medium"), Some("whisper-runtime"));
    assert_eq!(runtime_for("kokoro-v1"), Some("kokoro-runtime"));
    assert_eq!(runtime_for("matte-rvm"), None);
    assert_eq!(runtime_for("whisper-runtime"), None);
    assert!(models::label_of("whisper-runtime").is_some() && models::label_of("kokoro-runtime").is_some());
    // Every other offline voice runs on the same engine.
    for center in ["kokoro-v1_1", "kitten-mini-v0_8", "piper-hi_IN-rohan-medium", "matcha-en-ljspeech"] {
        assert_eq!(runtime_for(center), Some("kokoro-runtime"), "{center}");
    }
    assert_eq!(runtime_for("whisper-distil-large-v3-5"), Some("whisper-runtime"));
}

#[test]
fn newer_whisper_sizes_and_other_voices_are_put_in_use_through_the_settings_the_code_reads() {
    let states = states_with(&[
        ("whisper", &["base", "distil-large-v3-5", "tiny-en"]),
        ("kokoro-v1", &["standard"]),
        ("piper-hindi-south-asia", &["hi_IN-rohan-medium", "ur_PK-fasih-medium"]),
        ("kitten-tts", &["mini"]),
        ("matcha-tts", &["en-ljspeech"]),
    ]);
    let mut file = StateFile::default();
    let mut prefs = crate::settings::Settings::default();
    let set = |file: &mut StateFile, prefs: &mut crate::settings::Settings, job: &str, id: Option<&str>, size: Option<&str>| defaults::apply(job, id, size, catalog(), &states, file, prefs);

    // Transcription: the size's Model Center id lands in speech.transcribeModel, which transcribe.rs reads.
    set(&mut file, &mut prefs, "speech", Some("whisper"), Some("distil-large-v3-5")).unwrap();
    assert_eq!(prefs.speech.transcribe_model.as_deref(), Some("whisper-distil-large-v3-5"));
    let list = defaults::compute(catalog(), &states, &file.defaults, &prefs);
    assert_eq!(choice(&list, "speech").variant.as_deref(), Some("distil-large-v3-5"));
    assert!(choice(&list, "speech").candidates.iter().any(|candidate| candidate.variant.as_deref() == Some("tiny-en")));
    assert!(set(&mut file, &mut prefs, "speech", Some("whisper"), Some("medium-en")).is_err(), "a size that is not downloaded cannot be used");

    // Voice: Kokoro keeps `kokoro:`; every other pack is `sherpa:<pack>/<voice>`, and the choice reads back from it.
    set(&mut file, &mut prefs, "voice", Some("piper-hindi-south-asia"), Some("hi_IN-rohan-medium")).unwrap();
    assert_eq!(prefs.speech.voice.as_deref(), Some("sherpa:piper-hi_IN-rohan-medium/rohan"));
    let list = defaults::compute(catalog(), &states, &file.defaults, &prefs);
    assert_eq!((choice(&list, "voice").model_id.as_deref(), choice(&list, "voice").variant.as_deref()), (Some("piper-hindi-south-asia"), Some("hi_IN-rohan-medium")));
    assert!(choice(&list, "voice").candidates.len() >= 5, "Kokoro, two Piper voices, Kitten and Matcha are all candidates");

    // The settings screen can pick the other voice; the library then follows it.
    prefs.speech.voice = Some("sherpa:kitten-mini-v0_8/bella".to_owned());
    let list = defaults::compute(catalog(), &states, &BTreeMap::new(), &prefs);
    assert_eq!((choice(&list, "voice").model_id.as_deref(), choice(&list, "voice").variant.as_deref()), (Some("kitten-tts"), Some("mini")));
    // Putting the same pack in use again keeps the speaker the person picked.
    set(&mut file, &mut prefs, "voice", Some("kitten-tts"), Some("mini")).unwrap();
    assert_eq!(prefs.speech.voice.as_deref(), Some("sherpa:kitten-mini-v0_8/bella"));
    set(&mut file, &mut prefs, "voice", Some("matcha-tts"), None).unwrap();
    assert_eq!(prefs.speech.voice.as_deref(), Some("sherpa:matcha-en-ljspeech/ljspeech"));
    set(&mut file, &mut prefs, "voice", Some("kokoro-v1"), None).unwrap();
    assert_eq!(prefs.speech.voice.as_deref(), Some("kokoro:af_heart"));
    assert!(set(&mut file, &mut prefs, "voice", Some("piper-hindi-south-asia"), Some("hi_IN-priyamvada-medium")).is_err());

    // Deleting a voice that is not the one in use leaves the voice alone; deleting the one in use clears it.
    set(&mut file, &mut prefs, "voice", Some("piper-hindi-south-asia"), Some("ur_PK-fasih-medium")).unwrap();
    assert_eq!(prefs.speech.voice.as_deref(), Some("sherpa:piper-ur_PK-fasih-medium/fasih"));
    defaults::clear(catalog(), &mut file, &mut prefs, "piper-hindi-south-asia", Some("hi_IN-rohan-medium"));
    assert_eq!(prefs.speech.voice.as_deref(), Some("sherpa:piper-ur_PK-fasih-medium/fasih"));
    defaults::clear(catalog(), &mut file, &mut prefs, "piper-hindi-south-asia", Some("ur_PK-fasih-medium"));
    assert_eq!(prefs.speech.voice, None);

    // None means the AI does not voice locally, and a sherpa voice is cleared like a Kokoro one.
    prefs.speech.voice = Some("sherpa:kitten-mini-v0_8/bella".to_owned());
    set(&mut file, &mut prefs, "voice", None, None).unwrap();
    assert_eq!(prefs.speech.voice, None);
    let list = defaults::compute(catalog(), &states, &file.defaults, &prefs);
    assert_eq!(choice(&list, "voice").model_id, None);
    assert!(choice(&list, "voice").note.contains("No offline voice"));
}

#[test]
fn every_variant_without_files_has_a_size() {
    for entry in catalog() {
        for variant in &entry.variants {
            assert!(variant_bytes(variant) > 0, "{} / {} would show 0 B", entry.id, variant.id);
            if variant.files.is_empty() {
                assert!(variant.approx_bytes.is_some_and(|bytes| bytes > 0), "{} / {} needs approxBytes", entry.id, variant.id);
            }
        }
    }
    // Real sizes: Whisper small is 488 MB in models.rs.
    let small = find_entry("whisper").unwrap().variants.iter().find(|variant| variant.id == "small").unwrap();
    assert_eq!(variant_bytes(small), 488 * 1_048_576);
}

fn hub_entry(id: &str) -> serde_json::Value {
    let mut entry: serde_json::Value = serde_json::from_str(include_str!("../../catalog/library/llm.json")).map(|all: Vec<serde_json::Value>| all[0].clone()).unwrap();
    entry["id"] = serde_json::Value::String(id.to_owned());
    entry["source"] = serde_json::Value::String("huggingface".to_owned());
    entry
}

#[test]
fn hub_models_join_the_catalog_and_tolerate_a_bad_file() {
    let dir = scratch("hub");
    let file = dir.join("hub-models.json");
    let embedded = embedded_catalog().len();
    // Missing file: only the embedded entries.
    assert_eq!(build_catalog(Some(&file)).len(), embedded);
    assert_eq!(build_catalog(None).len(), embedded);
    // Two good entries, one that is not an entry, one that repeats an embedded id.
    let text = serde_json::json!([hub_entry("hub-one"), hub_entry("hub-two"), { "nonsense": true }, hub_entry("qwen3.5-4b")]).to_string();
    std::fs::write(&file, text).unwrap();
    let merged = build_catalog(Some(&file));
    assert_eq!(merged.len(), embedded + 2);
    let added = merged.iter().find(|entry| entry.id == "hub-one").unwrap();
    assert_eq!(added.source.as_deref(), Some("huggingface"));
    assert!(plan_files(added, &added.variants[0].id, &[]).is_ok());
    // Broken JSON and the wrong shape add nothing and do not panic.
    std::fs::write(&file, "{ not json").unwrap();
    assert_eq!(build_catalog(Some(&file)).len(), embedded);
    std::fs::write(&file, "{\"a\":1}").unwrap();
    assert_eq!(build_catalog(Some(&file)).len(), embedded);
    let _ignored = std::fs::remove_dir_all(&dir);
}

#[test]
fn plan_lists_a_shared_destination_once() {
    let entry = find_entry("minimax-h3").unwrap();
    let plain = plan_files(entry, "standard", &[]).unwrap();
    assert_eq!(plain.len(), 4);
    let with_addons = plan_files(entry, "standard", &["turbo".to_owned(), "ref2va".to_owned()]).unwrap();
    assert_eq!(with_addons.len(), 4 + 1 + 2);
    let dests: BTreeSet<&str> = with_addons.iter().map(|file| file.dest.as_str()).collect();
    assert_eq!(dests.len(), with_addons.len());
    // The compact and standard sizes share three files; all variants together list each once.
    let every: Vec<&LibraryFile> = all_files(entry);
    let unique: BTreeSet<&str> = every.iter().map(|file| file.dest.as_str()).collect();
    assert_eq!(unique.len(), every.len());
    assert!(plan_files(entry, "nope", &[]).is_err());
    assert!(plan_files(entry, "standard", &["nope".to_owned()]).is_err());
}

#[test]
fn destinations_cannot_leave_the_storage_folder() {
    let base = Path::new("base");
    assert!(safe_join(base, "comfyui/vae/x.safetensors").is_ok());
    for bad in ["../x", "a/../../x", "/etc/x", "", "C:/x"] {
        assert!(safe_join(base, bad).is_err(), "{bad} must be refused");
    }
}

// ── rules ──

#[test]
fn range_header_and_content_range() {
    assert_eq!(range_header(0), None);
    assert_eq!(range_header(1024).as_deref(), Some("bytes=1024-"));
    assert_eq!(content_range_start("bytes 100-999/1000"), Some(100));
    assert_eq!(content_range_start("bytes */1000"), None);
    assert_eq!(response_mode(100, 206, Some(100)), ResponseMode::Append);
    assert_eq!(response_mode(100, 206, Some(0)), ResponseMode::Retry);
    assert_eq!(response_mode(100, 200, None), ResponseMode::Restart);
    assert_eq!(response_mode(100, 416, None), ResponseMode::Retry);
    assert_eq!(response_mode(0, 404, None), ResponseMode::Refused);
}

#[test]
fn verification_checks_size_then_checksum() {
    let data = b"abc";
    assert_eq!(sha_of(data), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    let good = sha_of(data);
    assert!(verify_download(3, Some(&good), 3, Some(&good)).is_ok());
    assert!(verify_download(3, Some(&good.to_uppercase()), 3, Some(&good)).is_ok());
    assert!(verify_download(0, None, 99, None).is_ok());
    assert!(verify_download(3, Some(&good), 2, Some(&good)).unwrap_err().contains("bytes"));
    assert!(verify_download(3, Some(&good), 3, Some(&sha_of(b"abd"))).unwrap_err().contains("checksum"));
}

#[test]
fn space_check_keeps_two_gb_spare() {
    let folder = Path::new("D:\\Models");
    let gb = 1_073_741_824u64;
    assert!(check_space(10 * gb, Some(12 * gb), folder).is_ok());
    let error = check_space(10 * gb, Some(11 * gb), folder).unwrap_err();
    assert!(error.contains("not enough free space"));
    assert!(check_space(10 * gb, None, folder).is_ok());
    assert_eq!(parse_space("123456 7890123\r\n"), Some((123_456, 7_890_123)));
    assert_eq!(parse_space("nonsense"), None);
}

#[test]
fn state_file_round_trips_and_names_are_camel_case() {
    let mut state = StateFile::default();
    state.storage_dir = Some("D:\\Models".to_owned());
    state.older_dirs.push("C:\\old".to_owned());
    state.models.insert(
        "minimax-h3".to_owned(),
        ModelRecord {
            installed_variant: Some("standard".to_owned()),
            installed_addons: vec!["turbo".to_owned()],
            enabled: true,
            accepted: Some(Accepted { at: "2026-10-17T00:00:00+00:00".to_owned(), territory_confirmed: true }),
            folder: Some("D:\\Models".to_owned()),
            off: false,
        },
    );
    let text = serde_json::to_string(&state).unwrap();
    assert!(text.contains("installedVariant") && text.contains("territoryConfirmed") && text.contains("olderDirs"));
    let back: StateFile = serde_json::from_str(&text).unwrap();
    assert_eq!(back.storage_dir.as_deref(), Some("D:\\Models"));
    assert_eq!(back.models["minimax-h3"].installed_addons, vec!["turbo".to_owned()]);
    // An old or partial file still loads.
    let partial: StateFile = serde_json::from_str("{\"models\":{\"a\":{\"enabled\":true}}}").unwrap();
    assert!(partial.models["a"].enabled && partial.older_dirs.is_empty());
}

#[test]
fn licence_gate_and_territory_rule() {
    let entry = find_entry("minimax-h3").unwrap();
    assert!(gate_download(entry, None).unwrap_err().contains("accept"));
    let unconfirmed = Accepted { at: "now".to_owned(), territory_confirmed: false };
    let confirmed = Accepted { at: "now".to_owned(), territory_confirmed: true };
    let blocked = gate_download(entry, Some(&unconfirmed)).unwrap_err();
    assert!(blocked.contains("platform.minimax.io/h3-license") && blocked.contains("cloud"), "{blocked}");
    assert!(gate_download(entry, Some(&confirmed)).is_ok());
    assert!(check_territory(entry, false).is_err());
    assert!(check_territory(entry, true).is_ok());
    // A model without the acceptance requirement downloads straight away.
    let open = find_entry("sdxl").unwrap();
    assert!(gate_download(open, None).is_ok());
    assert!(check_territory(open, false).is_ok());
}

#[test]
fn enable_rules() {
    let base = LibraryState { installed_variant: None, installed_variants: vec![], installed_addons: vec![], enabled: false, accepted: None, download: None, partial_bytes: 0, broken: None };
    assert!(enable_check(&base, "X").unwrap_err().contains("Download X"));
    let installed = LibraryState { installed_variant: Some("standard".to_owned()), ..base.clone() };
    assert!(enable_check(&installed, "X").is_ok());
    let broken = LibraryState { broken: Some("a.safetensors is missing.".to_owned()), ..installed };
    assert!(enable_check(&broken, "X").unwrap_err().contains("missing"));
}

#[test]
fn broken_installs_are_found_by_size() {
    let entry = find_entry("minimax-h3").unwrap();
    let folder = scratch("broken");
    let record = ModelRecord { installed_variant: Some("standard".to_owned()), folder: Some(folder.display().to_string()), ..ModelRecord::default() };
    assert!(broken_reason(entry, &record, &folder).unwrap().contains("missing"));
    let first = plan_files(entry, "standard", &[]).unwrap().remove(0);
    let path = safe_join(&folder, &first.dest).unwrap();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, b"short").unwrap();
    assert!(broken_reason(entry, &record, &folder).unwrap().contains("right size"));
    assert_eq!(partial_bytes(entry, &folder), 0);
    std::fs::write(part_path(&path), b"12345").unwrap();
    assert_eq!(partial_bytes(entry, &folder), 5);
    let _ignored = std::fs::remove_dir_all(&folder);
}

#[test]
fn thumbnail_extension_from_url() {
    assert_eq!(thumbnail_extension("https://x/y/a.webp"), "webp");
    assert_eq!(thumbnail_extension("https://x/y/a.PNG?raw=1"), "png");
    assert_eq!(thumbnail_extension("https://x/y/a"), "webp");
}

// ── downloads over a local server ──

#[tokio::test]
async fn downloads_a_whole_file_and_checks_it() {
    let data = sample(300_000);
    let url = serve(data.clone(), true, Arc::new(AtomicUsize::new(0))).await;
    let dir = scratch("fresh");
    let target = dir.join("x/model.bin");
    let (result, counted) = run(&url, &file_for(&url, &data, true), &target, 0, false).await;
    result.unwrap();
    assert_eq!(std::fs::read(&target).unwrap(), data);
    assert!(!part_path(&target).exists());
    assert_eq!(counted, data.len() as u64);
    let _ignored = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn resumes_from_the_part_file_with_a_range_request() {
    let data = sample(300_000);
    let seen = Arc::new(AtomicUsize::new(0));
    let url = serve(data.clone(), true, seen.clone()).await;
    let dir = scratch("resume");
    let target = dir.join("x/model.bin");
    std::fs::create_dir_all(target.parent().unwrap()).unwrap();
    std::fs::write(part_path(&target), &data[..120_000]).unwrap();
    let (result, counted) = run(&url, &file_for(&url, &data, true), &target, 120_000, false).await;
    result.unwrap();
    assert_eq!(seen.load(Ordering::Relaxed), 1, "the server should have been asked for a range");
    assert_eq!(std::fs::read(&target).unwrap(), data);
    assert_eq!(counted, data.len() as u64);
    let _ignored = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn restarts_when_the_server_ignores_the_range() {
    let data = sample(300_000);
    let url = serve(data.clone(), false, Arc::new(AtomicUsize::new(0))).await;
    let dir = scratch("restart");
    let target = dir.join("x/model.bin");
    std::fs::create_dir_all(target.parent().unwrap()).unwrap();
    std::fs::write(part_path(&target), vec![9u8; 50_000]).unwrap();
    let (result, counted) = run(&url, &file_for(&url, &data, true), &target, 50_000, false).await;
    result.unwrap();
    assert_eq!(std::fs::read(&target).unwrap(), data);
    assert_eq!(counted, data.len() as u64, "the discarded part must not be counted twice");
    let _ignored = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn a_wrong_checksum_deletes_the_file() {
    let data = sample(10_000);
    let url = serve(data.clone(), true, Arc::new(AtomicUsize::new(0))).await;
    let dir = scratch("badsum");
    let target = dir.join("x/model.bin");
    let mut file = file_for(&url, &data, true);
    file.sha256 = Some(sha_of(b"something else"));
    let (result, _) = run(&url, &file, &target, 0, false).await;
    assert!(matches!(result, Err(DownloadError::Failed(message)) if message.contains("checksum")));
    assert!(!target.exists() && !part_path(&target).exists());
    let _ignored = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn cancel_keeps_the_part_file_for_a_later_resume() {
    let data = sample(10_000);
    let url = serve(data.clone(), true, Arc::new(AtomicUsize::new(0))).await;
    let dir = scratch("cancel");
    let target = dir.join("x/model.bin");
    let (result, _) = run(&url, &file_for(&url, &data, true), &target, 0, true).await;
    assert!(matches!(result, Err(DownloadError::Cancelled)));
    assert!(!target.exists());
    let _ignored = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn a_full_size_part_file_is_only_verified() {
    let data = sample(5_000);
    let dir = scratch("complete-part");
    let target = dir.join("x/model.bin");
    std::fs::create_dir_all(target.parent().unwrap()).unwrap();
    std::fs::write(part_path(&target), &data).unwrap();
    // The URL is unreachable on purpose: no request may be made.
    let (result, _) = run("http://127.0.0.1:1/never", &file_for("http://127.0.0.1:1/never", &data, true), &target, 5_000, false).await;
    result.unwrap();
    assert_eq!(std::fs::read(&target).unwrap(), data);
    let _ignored = std::fs::remove_dir_all(&dir);
}

// ── in use (defaults) ──

/// A state for every catalog entry: the named ones installed (with the named sizes), the rest not.
fn states_with(installed: &[(&str, &[&str])]) -> BTreeMap<String, LibraryState> {
    catalog()
        .iter()
        .map(|entry| {
            let sizes: Vec<String> = installed.iter().find(|(id, _)| *id == entry.id).map(|(_, sizes)| sizes.iter().map(|size| (*size).to_owned()).collect()).unwrap_or_default();
            let state = LibraryState {
                installed_variant: sizes.first().cloned(),
                installed_variants: sizes,
                installed_addons: vec![],
                enabled: false,
                accepted: None,
                download: None,
                partial_bytes: 0,
                broken: None,
            };
            (entry.id.clone(), state)
        })
        .collect()
}

fn choice(list: &[defaults::CapabilityChoice], job: &str) -> defaults::CapabilityChoice {
    list.iter().find(|choice| choice.capability == job).unwrap().clone()
}

#[test]
fn candidates_are_only_downloaded_models_of_that_job() {
    let states = states_with(&[("minimax-h3", &["standard"]), ("ltx-video-2b", &["standard"]), ("whisper", &["base", "large-v3"]), ("sam2", &["standard"]), ("rvm", &["fp32"])]);
    let list = defaults::compute(catalog(), &states, &BTreeMap::new(), &crate::settings::Settings::default());
    let video_choice = choice(&list, "video");
    let video: Vec<&str> = video_choice.candidates.iter().map(|c| c.model_id.as_str()).collect();
    assert_eq!(video, ["minimax-h3", "ltx-video-2b"]);
    let h3 = &video_choice.candidates[0];
    assert_eq!((h3.variant.as_deref(), h3.variant_label.as_deref()), (Some("standard"), Some("Standard")));
    assert_eq!(video_choice.candidates[1].variant, None);
    assert_eq!(choice(&list, "speech").candidates.len(), 2, "one candidate per downloaded Whisper size");
    // SAM 2.1 alone is not a roto engine: it needs ViTMatte too.
    let roto: Vec<String> = choice(&list, "roto").candidates.iter().map(|c| c.model_id.clone()).collect();
    assert_eq!(roto, ["rvm"]);
    assert!(choice(&list, "image").candidates.is_empty() && choice(&list, "llm").candidates.is_empty());
}

#[test]
fn comfyui_image_and_audio_models_are_candidates_by_kind() {
    let states = states_with(&[("z-image-turbo", &["light"]), ("qwen-image-edit-2511", &["standard"]), ("ace-step-1-5-xl-turbo", &["standard"]), ("stable-audio-3-medium", &["standard"])]);
    let list = defaults::compute(catalog(), &states, &BTreeMap::new(), &crate::settings::Settings::default());
    let images = choice(&list, "image");
    let image: Vec<&str> = images.candidates.iter().map(|c| c.model_id.as_str()).collect();
    assert_eq!(image, ["z-image-turbo", "qwen-image-edit-2511"]);
    let sounds = choice(&list, "audio");
    let audio: Vec<&str> = sounds.candidates.iter().map(|c| c.model_id.as_str()).collect();
    assert_eq!(audio, ["ace-step-1-5-xl-turbo", "stable-audio-3-medium"]);
    // Putting one in use records it without touching the older local-media settings, and None clears it.
    let mut file = StateFile::default();
    let mut prefs = crate::settings::Settings::default();
    defaults::apply("image", Some("z-image-turbo"), None, catalog(), &states, &mut file, &mut prefs).unwrap();
    defaults::apply("audio", Some("stable-audio-3-medium"), None, catalog(), &states, &mut file, &mut prefs).unwrap();
    assert_eq!(prefs.local_image_model, None);
    let list = defaults::compute(catalog(), &states, &file.defaults, &prefs);
    assert_eq!(choice(&list, "image").model_id.as_deref(), Some("z-image-turbo"));
    assert_eq!(choice(&list, "image").variant.as_deref(), Some("light"));
    assert_eq!(choice(&list, "audio").model_id.as_deref(), Some("stable-audio-3-medium"));
    assert!(file.models["z-image-turbo"].enabled && file.models["stable-audio-3-medium"].enabled);
    // An audio model cannot be put in use for images, and a model that is not downloaded cannot be put in use at all.
    assert!(defaults::apply("image", Some("ace-step-1-5-xl-turbo"), None, catalog(), &states, &mut file, &mut prefs).unwrap_err().contains("cannot do that job"));
    assert!(defaults::apply("image", Some("ernie-image-turbo"), None, catalog(), &states, &mut file, &mut prefs).unwrap_err().contains("not downloaded"));
    defaults::apply("image", None, None, catalog(), &states, &mut file, &mut prefs).unwrap();
    let list = defaults::compute(catalog(), &states, &file.defaults, &prefs);
    assert_eq!(choice(&list, "image").model_id, None);
    assert_eq!(choice(&list, "image").note, "The AI won't make images on this PC.");
}

#[test]
fn the_comfy_catalog_points_at_real_templates_and_loaders() {
    // Every ComfyUI entry names a template per task, and the slots its tasks write exist.
    let mut seen = 0;
    for entry in catalog().iter().filter(|entry| entry.id != "minimax-h3" && entry.runtime == "comfyui") {
        let comfy = entry.comfy.as_ref().unwrap_or_else(|| panic!("{} has no comfy block", entry.id));
        let templates = comfy["templates"].as_object().unwrap_or_else(|| panic!("{} has no templates", entry.id));
        assert!(!templates.is_empty());
        for (task, template) in templates {
            assert!(entry.tasks.contains(task), "{} lists a template for {task} but not the task", entry.id);
            let name = template.as_str().unwrap();
            let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/comfy-templates").join(format!("{name}.json"));
            assert!(path.is_file(), "{} uses the missing template {name}", entry.id);
            let spec = &comfy["tasks"][task];
            assert!(spec["slots"]["prompt"].is_object() || spec["slots"]["tags"].is_object(), "{} {task} has no prompt slot", entry.id);
            assert!(spec["loaders"].is_object(), "{} {task} has no loaders", entry.id);
        }
        seen += 1;
    }
    assert!(seen >= 8, "the comfy catalog shrank to {seen} models");
}

#[test]
fn installed_strata_sizes_are_language_model_candidates() {
    let states = states_with(&[("qwen3.8-flash-next", &["iq2_xs", "iq3_s"]), ("qwen3.5-4b", &["q4"])]);
    let list = defaults::compute(catalog(), &states, &BTreeMap::new(), &crate::settings::Settings::default());
    let llm = choice(&list, "llm");
    let strata: Vec<(&str, &str)> = llm.candidates.iter().filter(|c| c.model_id == "qwen3.8-flash-next").map(|c| (c.variant.as_deref().unwrap(), c.variant_label.as_deref().unwrap())).collect();
    assert_eq!(strata, [("iq2_xs", "Recommended"), ("iq3_s", "Best quality")]);
    assert!(llm.candidates.iter().any(|c| c.model_id == "qwen3.5-4b"));
    // Putting one size in use records the size, and takes it out again with the model.
    let mut file = StateFile::default();
    let mut prefs = crate::settings::Settings::default();
    defaults::apply("llm", Some("qwen3.8-flash-next"), Some("iq3_s"), catalog(), &states, &mut file, &mut prefs).unwrap();
    assert_eq!(file.defaults["llm"], DefaultRecord { model_id: Some("qwen3.8-flash-next".to_owned()), variant: Some("iq3_s".to_owned()) });
    assert!(defaults::apply("llm", Some("qwen3.8-flash-next"), Some("coder-iq1_m"), catalog(), &states, &mut file, &mut prefs).is_err(), "a size that is not downloaded cannot be put in use");
    defaults::clear(catalog(), &mut file, &mut prefs, "qwen3.8-flash-next", Some("iq3_s"));
    assert_eq!(file.defaults["llm"], DefaultRecord::default());
}

#[test]
fn defaults_map_into_the_settings_older_features_read() {
    let states = states_with(&[
        ("ltx-video-2b", &["standard"]),
        ("wan22-5b", &["standard"]),
        ("flux-schnell", &["standard"]),
        ("whisper", &["base", "medium"]),
        ("kokoro-v1", &["standard"]),
        ("sam2", &["standard"]),
        ("vitmatte", &["standard"]),
        ("rvm", &["fp32"]),
        ("minimax-h3", &["standard"]),
    ]);
    let mut file = StateFile::default();
    let mut prefs = crate::settings::Settings::default();
    assert_eq!(prefs.disable_local_generation, None);
    let set = |file: &mut StateFile, prefs: &mut crate::settings::Settings, job: &str, id: Option<&str>, size: Option<&str>| defaults::apply(job, id, size, catalog(), &states, file, prefs);

    set(&mut file, &mut prefs, "video", Some("wan22-5b"), None).unwrap();
    assert_eq!(prefs.local_video_model.as_deref(), Some("wan22"));
    assert_eq!(prefs.disable_local_generation, Some(false));
    // Turning local generation on for video did not quietly turn it on for images.
    let list = defaults::compute(catalog(), &states, &file.defaults, &prefs);
    assert_eq!(choice(&list, "video").model_id.as_deref(), Some("wan22-5b"));
    assert_eq!(choice(&list, "image").model_id, None);
    assert_eq!(choice(&list, "video").note, "Bhippi's AI makes video with Wan 2.2 · 5B.");
    assert_eq!(choice(&list, "image").note, "The AI won't make images on this PC.");

    set(&mut file, &mut prefs, "image", Some("flux-schnell"), None).unwrap();
    assert_eq!(prefs.local_image_model.as_deref(), Some("flux"));
    set(&mut file, &mut prefs, "speech", Some("whisper"), Some("medium")).unwrap();
    assert_eq!(prefs.speech.transcribe_model.as_deref(), Some("whisper-medium"));
    set(&mut file, &mut prefs, "voice", Some("kokoro-v1"), None).unwrap();
    assert!(prefs.speech.voice.as_deref().unwrap().starts_with("kokoro:"));
    set(&mut file, &mut prefs, "roto", Some("vitmatte"), None).unwrap();
    assert_eq!(prefs.local_roto_engine.as_deref(), Some("sam2-vitmatte"));
    assert_eq!(file.defaults["roto"].model_id.as_deref(), Some("sam2"));
    set(&mut file, &mut prefs, "roto", Some("rvm"), None).unwrap();
    assert_eq!(prefs.local_roto_engine.as_deref(), Some("rvm"));

    // MiniMax H3 is recorded and switched on; the local-media setting is left as it was.
    set(&mut file, &mut prefs, "video", Some("minimax-h3"), None).unwrap();
    assert_eq!(file.defaults["video"], DefaultRecord { model_id: Some("minimax-h3".to_owned()), variant: Some("standard".to_owned()) });
    assert!(file.models["minimax-h3"].enabled);
    assert_eq!(prefs.local_video_model.as_deref(), Some("wan22"));
    assert_eq!(prefs.disable_local_generation, Some(false), "images still use a local model");
    let list = defaults::compute(catalog(), &states, &file.defaults, &prefs);
    assert_eq!(choice(&list, "video").note, "Bhippi's AI makes video with MiniMax H3 (Standard).");

    // Choosing a local-media model switches it on for the AI too.
    file.models.entry("ltx-video-2b".to_owned()).or_default().off = true;
    set(&mut file, &mut prefs, "video", Some("ltx-video-2b"), None).unwrap();
    assert!(!file.models["ltx-video-2b"].off);

    // None for both local jobs turns local generation off.
    set(&mut file, &mut prefs, "video", None, None).unwrap();
    set(&mut file, &mut prefs, "image", None, None).unwrap();
    assert_eq!(prefs.disable_local_generation, Some(true));
    let list = defaults::compute(catalog(), &states, &file.defaults, &prefs);
    assert_eq!(choice(&list, "video").model_id, None);
    assert_eq!(choice(&list, "video").note, "The AI won't make video on this PC.");

    // Refusals change nothing.
    let before = file.defaults.clone();
    assert!(set(&mut file, &mut prefs, "video", Some("sdxl"), None).unwrap_err().contains("cannot do that job"));
    assert!(set(&mut file, &mut prefs, "image", Some("sdxl"), None).unwrap_err().contains("not downloaded"));
    assert!(set(&mut file, &mut prefs, "speech", Some("whisper"), Some("large-v3")).unwrap_err().contains("not downloaded"));
    assert!(set(&mut file, &mut prefs, "nonsense", None, None).is_err());
    assert_eq!(file.defaults, before);
}

#[test]
fn the_old_settings_decide_until_something_is_chosen() {
    let states = states_with(&[("ltx-video-2b", &["standard"]), ("sdxl", &["standard"]), ("whisper", &["small"])]);
    let mut prefs = crate::settings::Settings::default();
    // Local generation is off by default: nothing local is in use for video or images.
    let list = defaults::compute(catalog(), &states, &BTreeMap::new(), &prefs);
    assert_eq!(choice(&list, "video").model_id, None);
    prefs.disable_local_generation = Some(false);
    prefs.local_video_model = Some("ltx".to_owned());
    prefs.speech.transcribe_model = Some("whisper-small".to_owned());
    let list = defaults::compute(catalog(), &states, &BTreeMap::new(), &prefs);
    assert_eq!(choice(&list, "video").model_id.as_deref(), Some("ltx-video-2b"));
    assert_eq!(choice(&list, "image").model_id.as_deref(), Some("sdxl"));
    assert_eq!(choice(&list, "speech").variant.as_deref(), Some("small"));
    // The person's "none" wins over the setting, and the old switch still turns local media off.
    let mut records = BTreeMap::new();
    records.insert("video".to_owned(), DefaultRecord::default());
    assert_eq!(choice(&defaults::compute(catalog(), &states, &records, &prefs), "video").model_id, None);
    prefs.disable_local_generation = Some(true);
    assert_eq!(choice(&defaults::compute(catalog(), &states, &BTreeMap::new(), &prefs), "image").model_id, None);
}

#[test]
fn deleting_or_switching_off_clears_what_it_held() {
    let states = states_with(&[("ltx-video-2b", &["standard"]), ("sdxl", &["standard"]), ("whisper", &["base", "medium"]), ("kokoro-v1", &["standard"]), ("sam2", &["standard"]), ("vitmatte", &["standard"])]);
    let mut file = StateFile::default();
    let mut prefs = crate::settings::Settings::default();
    for (job, id, size) in [("video", "ltx-video-2b", None), ("image", "sdxl", None), ("speech", "whisper", Some("medium")), ("voice", "kokoro-v1", None), ("roto", "sam2", None)] {
        defaults::apply(job, Some(id), size, catalog(), &states, &mut file, &mut prefs).unwrap();
    }
    assert_eq!(prefs.disable_local_generation, Some(false));
    // Deleting a different Whisper size leaves the chosen one alone.
    defaults::clear(catalog(), &mut file, &mut prefs, "whisper", Some("base"));
    assert_eq!(file.defaults["speech"].variant.as_deref(), Some("medium"));
    assert_eq!(prefs.speech.transcribe_model.as_deref(), Some("whisper-medium"));
    defaults::clear(catalog(), &mut file, &mut prefs, "whisper", Some("medium"));
    assert_eq!(file.defaults["speech"].model_id, None);
    assert_eq!(prefs.speech.transcribe_model, None);
    // Video goes, images still hold a local model: generation stays on, then goes off with the last one.
    defaults::clear(catalog(), &mut file, &mut prefs, "ltx-video-2b", None);
    assert_eq!(file.defaults["video"].model_id, None);
    assert_eq!(prefs.disable_local_generation, Some(false));
    defaults::clear(catalog(), &mut file, &mut prefs, "sdxl", None);
    assert_eq!(prefs.disable_local_generation, Some(true));
    defaults::clear(catalog(), &mut file, &mut prefs, "kokoro-v1", None);
    assert_eq!(prefs.speech.voice, None);
    defaults::clear(catalog(), &mut file, &mut prefs, "sam2", None);
    assert_eq!(prefs.local_roto_engine, None);
    // Clearing a model that held nothing is a no-op.
    let before = file.defaults.clone();
    defaults::clear(catalog(), &mut file, &mut prefs, "flux-schnell", None);
    assert_eq!(file.defaults, before);
}

#[test]
fn defaults_survive_in_state_json() {
    let mut file = StateFile::default();
    file.defaults.insert("video".to_owned(), DefaultRecord { model_id: Some("minimax-h3".to_owned()), variant: Some("standard".to_owned()) });
    file.defaults.insert("image".to_owned(), DefaultRecord::default());
    let text = serde_json::to_string(&file).unwrap();
    assert!(text.contains("\"defaults\"") && text.contains("modelId"));
    let back: StateFile = serde_json::from_str(&text).unwrap();
    assert_eq!(back.defaults, file.defaults);
    // An older state.json without defaults still loads.
    let old: StateFile = serde_json::from_str("{\"models\":{}}").unwrap();
    assert!(old.defaults.is_empty());
}
