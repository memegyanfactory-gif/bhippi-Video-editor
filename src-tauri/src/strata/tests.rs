use super::*;
use std::sync::atomic::AtomicUsize;

fn scratch(name: &str) -> PathBuf {
    static COUNTER: AtomicUsize = AtomicUsize::new(0);
    let dir = std::env::temp_dir().join(format!("bhippi-strata-{name}-{}-{}", std::process::id(), COUNTER.fetch_add(1, Ordering::Relaxed)));
    let _ignored = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

// ── which model: names Strata's setup writes ──

#[test]
fn tasks_become_strata_names() {
    let original = Task::parse("qwen:IQ2_XS").unwrap();
    assert_eq!((original.tag().as_str(), original.script_name().as_str(), original.config_name().as_str()), ("IQ2_XS", "run-iq2_xs.bat", "strata-iq2_xs.json"));
    let swift = Task::parse("swift:IQ2_XS").unwrap();
    assert_eq!((swift.tag().as_str(), swift.script_name().as_str()), ("swift-IQ2_XS", "run-swift-iq2_xs.bat"));
    let coder = Task::parse("coder:IQ1_M").unwrap();
    assert_eq!((coder.tag().as_str(), coder.script_name().as_str(), coder.config_name().as_str()), ("coder-IQ1_M", "run-coder-iq1_m.bat", "strata-coder-iq1_m.json"));
    assert_eq!(Task::parse("qwen:q2_0").unwrap().tag(), "Q2_0", "the size is matched without regard to case");
}

#[test]
fn unknown_tasks_are_refused() {
    assert!(Task::parse("IQ2_XS").is_err());
    assert!(Task::parse("llama:IQ2_XS").is_err());
    assert!(Task::parse("swift:Q2_0").is_err(), "Swift has no Q2_0 size");
    assert!(Task::parse("coder:IQ2_XS").is_err());
    assert!(Task::parse("qwen:UD-IQ4_XS").is_err(), "the Unsloth sizes are not offered");
}

#[test]
fn setup_arguments_are_the_unattended_ones() {
    let task = Task::parse("qwen:IQ2_XS").unwrap();
    let args = task.setup_args(Path::new("D:/Models/strata-data"), 8123, false);
    assert_eq!(
        args,
        ["--yes", "--family", "qwen", "--model", "IQ2_XS", "--no-start", "--no-browser", "--vision", "no", "--data-dir", "D:/Models/strata-data", "--port", "8123"]
    );
    assert!(task.setup_args(Path::new("D:/x"), 1, true).windows(2).any(|pair| pair == ["--vision", "yes"]));
    let coder = Task::parse("coder:IQ1_M").unwrap().setup_args(Path::new("D:/x"), 1, false);
    assert!(coder.windows(2).any(|pair| pair == ["--family", "coder"]) && coder.windows(2).any(|pair| pair == ["--model", "IQ1_M"]));
}

#[test]
fn the_catalog_card_is_served_by_strata() {
    let entry = model_library::find_entry(ENTRY_ID).unwrap();
    assert_eq!(entry.runtime, "strata");
    assert!(is_strata(ENTRY_ID) && !is_strata("qwen3.5-4b") && !is_strata("nothing"));
    let mut tags = Vec::new();
    for variant in &entry.variants {
        let task = task_of(entry, &variant.id).unwrap();
        tags.push(task.tag());
        assert!(variant.files.is_empty() && variant.approx_bytes.is_some_and(|bytes| bytes > MTP_BYTES), "{} lists its size", variant.id);
        assert!(variant.min_vram_gb >= 8.0 && variant.rec_vram_gb >= 12.0 && variant.min_ram_gb >= 32.0, "{} needs", variant.id);
        let shape = variant.llm.as_ref().unwrap();
        assert!(shape.moe && shape.total_params_b == 125.0 && shape.layers == 48);
    }
    tags.sort();
    tags.dedup();
    assert_eq!(tags.len(), entry.variants.len(), "every size is its own install");
    assert_eq!(entry.variants.iter().filter(|variant| variant.default == Some(true)).count(), 1);
    assert_eq!(entry.variants.iter().find(|variant| variant.default == Some(true)).unwrap().id, "iq2_xs");
}

// ── setup output ──

#[test]
fn lines_split_at_returns_and_newlines() {
    let mut splitter = LineSplitter::default();
    let mut lines = splitter.push(b"  file.gguf:  1.00 / 66.40 GB (2%)   \r  file.gguf:  2.00 / 66.40 GB (3%)   \r\n=== Step 6: preparing");
    lines.extend(splitter.push(b" the model for Strata ===\r\n\r\nlast"));
    assert_eq!(lines, ["file.gguf:  1.00 / 66.40 GB (2%)", "file.gguf:  2.00 / 66.40 GB (3%)", "=== Step 6: preparing the model for Strata ==="]);
    assert_eq!(splitter.finish().as_deref(), Some("last"));
    assert_eq!(splitter.finish(), None);
}

#[test]
fn a_character_split_across_two_reads_survives() {
    let text = "Prüfung läuft".as_bytes();
    let mut splitter = LineSplitter::default();
    let mut lines = splitter.push(&text[..3]);
    lines.extend(splitter.push(&text[3..]));
    lines.extend(splitter.push(b"\n"));
    assert_eq!(lines, ["Prüfung läuft"]);
}

#[test]
fn setup_lines_are_understood() {
    assert_eq!(classify("=== Step 5: downloading Qwen3.8-Flash-Next IQ2_XS ==="), Line::Step(5));
    assert_eq!(classify("Qwen3.8-Flash-Next-GSQ-RCO-IQ2_XS-00001-of-00002.gguf:   12.34 / 66.40 GB (19%)"), Line::Download { have_gb: 12.34, total_gb: 66.4 });
    assert_eq!(classify("  [ok] model files present"), Line::Ok("model files present".to_owned()));
    assert_eq!(classify("  [!]  Windows' page file is 4.0 GB"), Line::Warn("Windows' page file is 4.0 GB".to_owned()));
    assert_eq!(classify("  [X]  not enough free disk space"), Line::Fail("not enough free disk space".to_owned()));
    // An MB-only line has no total and a sentence with a colon is not a download.
    assert!(matches!(classify("vision encoder:  123.4 MB"), Line::Text(_)));
    assert!(matches!(classify("  Converting the Q2_0 experts: one time, 2-5 min"), Line::Text(_)));
    assert!(matches!(classify("=== Step x: nonsense ==="), Line::Text(_)));
}

#[test]
fn progress_follows_the_steps_and_the_bytes() {
    let model = 68_000_000_000;
    let at = |step, bytes| estimate(step, bytes, model);
    assert!(at(0, 0) < at(3, 0) && at(3, 0) < at(4, 0) && at(4, 0) < at(5, 0));
    assert!((at(5, 0) - 0.1).abs() < 1e-9);
    assert!(at(5, model / 2) > at(5, model / 4));
    assert!((at(5, model * 2) - 0.88).abs() < 1e-9, "more than the model on disk stays at the end of the step");
    assert!(at(6, 0) > at(5, model) && at(7, 0) > at(6, 0) && at(7, 0) < 1.0);
    assert_eq!(estimate(5, 10, 0), 0.1, "an unknown size never divides by zero");
}

#[test]
fn only_sentences_of_the_preparing_step_are_shown() {
    assert_eq!(readable("  Converting the Q2_0 experts for the AVX-512 kernel (one time, ~40 GB written, 2-5 min) ...").as_deref(), Some("Converting the Q2_0 experts for the AVX-512 kernel (one time, ~40 GB written, 2-5 min) ..."));
    assert_eq!(readable("  > C:/x/python.exe tools/iq_pack.py --gguf a --out b"), None);
    assert_eq!(readable("  [ok] model prepared: D:\\x"), None);
    assert_eq!(readable("done"), None);
    assert!(readable(&"word ".repeat(80)).unwrap().ends_with('…'));
}

#[test]
fn a_stopped_setup_explains_itself() {
    let lines = vec!["not enough free disk space in D:\\x: need ~80 GB".to_owned(), "use --models-dir on a bigger drive".to_owned(), "Setup stopped. Fix the item above and run it again".to_owned()];
    let text = failure_text(&lines);
    assert!(text.starts_with("Strata's setup stopped: not enough free disk space in D:\\x: need ~80 GB."), "{text}");
    assert!(text.contains("choose a bigger drive") && !text.contains("Fix the item above"), "{text}");
    let driver = failure_text(&["the NVIDIA driver is too old".to_owned()]);
    assert!(driver.contains("Update your NVIDIA driver"), "{driver}");
    assert!(failure_text(&["could not download".to_owned()]).contains("press Download again"));
}

// ── checks ──

#[test]
fn the_driver_must_be_580_or_newer() {
    assert_eq!(parse_driver_major("610.88\n"), Some(610));
    assert_eq!(parse_driver_major("\n  576.02 \r\n"), Some(576));
    assert_eq!(parse_driver_major("N/A"), None);
    assert_eq!(parse_driver_major(""), None);
    assert!(driver_problem(610).is_none() && driver_problem(580).is_none());
    assert!(driver_problem(576).unwrap().contains("580"));
}

#[test]
fn space_needs_the_download_plus_ten_gigabytes() {
    let folder = Path::new("D:/strata-data");
    assert!(check_space(70_000_000_000, Some(81_000_000_000), folder).is_ok());
    let short = check_space(70_000_000_000, Some(79_000_000_000), folder).unwrap_err();
    assert!(short.contains("80.0 GB") && short.contains("79.0 GB"), "{short}");
    assert!(check_space(70_000_000_000, None, folder).is_ok(), "an unreadable drive does not block");
    assert!(check_space(0, Some(10_000_000_000), folder).is_ok(), "a finished download still needs its working room");
}

/// What PowerShell prints on the user's PC: Windows manages a 4 GB page file.
const MANAGED: &str = r#"{"auto":true,"settings":[],"usage":[{"name":"C:\\pagefile.sys","sizeMb":4096}]}"#;

#[test]
fn a_windows_managed_page_file_is_warned_about() {
    let page = parse_page_file(MANAGED).unwrap();
    assert_eq!(page, PageFile { managed: true, current_mb: 4096, grows: false });
    let warning = page_file_warning(&page).unwrap();
    assert!(warning.managed_by_windows && warning.current_gb == 4.0);
    assert!(warning.summary.contains("manages the page file itself") && warning.summary.contains("4.0 GB") && warning.summary.contains("does not change this"));
    assert_eq!(warning.steps.len(), 5);
    assert!(warning.steps[0].contains("Advanced system settings") && warning.steps[3].contains("65536") && warning.steps[4].contains("Restart"));
}

#[test]
fn a_fixed_large_page_file_is_fine() {
    let fixed = r#"{"auto":false,"settings":[{"name":"D:\\pagefile.sys","initialMb":65536,"maxMb":65536}],"usage":{"name":"D:\\pagefile.sys","sizeMb":65536}}"#;
    let page = parse_page_file(fixed).unwrap();
    assert_eq!(page, PageFile { managed: false, current_mb: 65536, grows: false });
    assert!(page_file_warning(&page).is_none());
}

#[test]
fn a_growing_or_small_page_file_is_warned_about() {
    // PowerShell prints one setting as an object, not a list.
    let growing = r#"{"auto":false,"settings":{"name":"C:\\pagefile.sys","initialMb":16000,"maxMb":64000},"usage":[{"sizeMb":16000}]}"#;
    let page = parse_page_file(growing).unwrap();
    assert!(page.grows);
    assert!(page_file_warning(&page).unwrap().summary.contains("grows your page file"));
    let small = parse_page_file(r#"{"auto":false,"settings":[{"initialMb":8192,"maxMb":8192}],"usage":[{"sizeMb":8192}]}"#).unwrap();
    assert!(page_file_warning(&small).unwrap().summary.contains("8.0 GB"));
    let none = parse_page_file(r#"{"auto":false,"settings":[],"usage":[]}"#).unwrap();
    assert!(page_file_warning(&none).is_some(), "no page file at all");
    assert!(parse_page_file("not json").is_none() && parse_page_file("[]").is_none());
}

#[test]
fn plans_are_honest_about_this_pc() {
    // The user's PC: an RTX 3080 with 10 GB and 64 GB of RAM.
    let (verdict, note) = plan_text(48.0, 63.8, 10.0, Some("NVIDIA GeForce RTX 3080"));
    assert_eq!(verdict, Verdict::Slow);
    assert!(note.contains("RTX 3080") && note.contains("10 GB") && note.contains("more slowly"), "{note}");
    assert_eq!(plan_text(48.0, 63.8, 12.0, Some("RTX 5070")).0, Verdict::Great);
    let (verdict, note) = plan_text(62.0, 48.0, 12.0, Some("RTX 5070"));
    assert_eq!(verdict, Verdict::No);
    assert!(note.contains("62 GB of RAM") && note.contains("48 GB"), "{note}");
    assert_eq!(plan_text(32.0, 32.0, 6.0, Some("GTX 1660")).0, Verdict::No);
    assert!(plan_text(32.0, 32.0, 0.0, None).1.contains("none was found"));
}

// ── installed detection and removal ──

/// What setup leaves for IQ2_XS: the run script, its configuration, a whole first model file with its
/// finish mark, and a prepared copy.
fn fake_install(root: &Path, data: &Path, task: &Task) -> PathBuf {
    let folder = data.join("models").join(task.tag());
    std::fs::create_dir_all(&folder).unwrap();
    let native = folder.join("Qwen3.8-Flash-Next-GSQ-RCO-IQ2_XS-00001-of-00002.gguf");
    std::fs::write(&native, b"gguf").unwrap();
    std::fs::write(done_mark(&native), b"2026-10-17").unwrap();
    let pack = data.join("packs").join(task.tag().to_ascii_lowercase());
    std::fs::create_dir_all(&pack).unwrap();
    std::fs::write(pack.join("index.txt"), b"x").unwrap();
    let config = serde_json::json!({ "exe": "engine/strata.exe", "args": ["--pack", pack.display().to_string(), "--native", native.display().to_string(), "--max-context", "32768"], "port": 8080 });
    // Strata writes its configuration with a byte order mark on some versions.
    std::fs::write(root.join(task.config_name()), format!("\u{feff}{config}")).unwrap();
    std::fs::write(root.join(task.script_name()), "@echo off\r\n").unwrap();
    std::fs::write(root.join(format!("strata-{}.log", task.tag().to_ascii_lowercase())), "log").unwrap();
    native
}

#[test]
fn a_model_is_installed_when_setup_finished() {
    let (root, data) = (scratch("root"), scratch("data"));
    let task = Task::parse("qwen:IQ2_XS").unwrap();
    assert!(installed_in(&root, &task).is_none(), "nothing there");
    let native = fake_install(&root, &data, &task);
    let found = installed_in(&root, &task).unwrap();
    assert_eq!(found.native, native);
    assert!(found.pack.unwrap().ends_with("iq2_xs"));
    // Another size is not installed by this one.
    assert!(installed_in(&root, &Task::parse("qwen:Q2_0").unwrap()).is_none());
    // No finish mark: the download is not whole.
    std::fs::remove_file(done_mark(&native)).unwrap();
    assert!(installed_in(&root, &task).is_none());
    std::fs::write(done_mark(&native), b"x").unwrap();
    assert!(installed_in(&root, &task).is_some());
    // No start script: setup stopped before its last step.
    std::fs::remove_file(root.join(task.script_name())).unwrap();
    assert!(installed_in(&root, &task).is_none());
}

#[test]
fn a_broken_configuration_is_not_an_install() {
    let (root, data) = (scratch("root-bad"), scratch("data-bad"));
    let task = Task::parse("qwen:IQ2_XS").unwrap();
    fake_install(&root, &data, &task);
    std::fs::write(root.join(task.config_name()), "{ not json").unwrap();
    assert!(installed_in(&root, &task).is_none());
    std::fs::write(root.join(task.config_name()), r#"{"args":["--max-context","32768"]}"#).unwrap();
    assert!(installed_in(&root, &task).is_none(), "no --native file named");
}

#[test]
fn removing_a_model_takes_its_files_and_keeps_the_rest() {
    let (root, data) = (scratch("root-del"), scratch("data-del"));
    let task = Task::parse("qwen:IQ2_XS").unwrap();
    let other = Task::parse("qwen:Q2_0").unwrap();
    fake_install(&root, &data, &task);
    // The speed-up layer and another size sit beside it.
    std::fs::create_dir_all(data.join("mtp").join("rt")).unwrap();
    std::fs::write(data.join("mtp").join("rt").join("experts.bin"), b"mtp").unwrap();
    let other_folder = data.join("models").join(other.tag());
    std::fs::create_dir_all(&other_folder).unwrap();
    std::fs::write(other_folder.join("keep.gguf"), b"keep").unwrap();
    remove_installed(&root, &task, &[data.clone()]).unwrap();
    assert!(installed_in(&root, &task).is_none());
    assert!(!data.join("models").join("IQ2_XS").exists() && !data.join("packs").join("iq2_xs").exists());
    assert!(!root.join(task.script_name()).exists() && !root.join(task.config_name()).exists() && !root.join("strata-iq2_xs.log").exists());
    assert!(data.join("mtp").join("rt").join("experts.bin").exists() && other_folder.join("keep.gguf").exists());
}

#[test]
fn removing_never_leaves_the_data_folder() {
    let (root, data, elsewhere) = (scratch("root-out"), scratch("data-out"), scratch("elsewhere"));
    let task = Task::parse("qwen:IQ2_XS").unwrap();
    let native = fake_install(&root, &elsewhere, &task);
    // The configuration points outside every folder Bhippi may clean: the files stay, the scripts go.
    remove_installed(&root, &task, &[data]).unwrap();
    assert!(native.is_file(), "a folder outside the data folders is not touched");
    assert!(!root.join(task.script_name()).exists());
}

// ── the server ──

#[test]
fn health_says_when_the_model_is_loaded() {
    let loaded = r#"{"status": "ok", "max_context": 32768, "model": "qwen3.8-flash-next-iq2_xs", "images": false, "api_key": false, "image_generation": false, "loaded": true, "service": "strata"}"#;
    assert_eq!(parse_health(loaded), Some(Health { loaded: true, model: Some("qwen3.8-flash-next-iq2_xs".to_owned()) }));
    assert_eq!(parse_health(r#"{"status":"ok","loaded":false}"#), Some(Health { loaded: false, model: None }));
    assert_eq!(parse_health(r#"{"status":"starting"}"#), None);
    assert_eq!(parse_health("<html>"), None);
}

const RUN_SCRIPT: &str = "@echo off\r\ntitle Strata IQ2_XS\r\ncd /d \"D:\\Bhippi Models\\runtime\\strata\\Strata-0.1.44.1\"\r\n\"D:\\Bhippi Models\\runtime\\strata\\Strata-0.1.44.1\\.venv\\Scripts\\python.exe\" \"D:\\Bhippi Models\\runtime\\strata\\Strata-0.1.44.1\\serve\\server.py\" --engine strata --config \"D:\\Bhippi Models\\runtime\\strata\\Strata-0.1.44.1\\strata-iq2_xs.json\" --port 8080 --open\r\nif errorlevel 1 pause\r\n";

#[test]
fn the_run_script_is_read_back_into_a_command() {
    let words = parse_run_script(RUN_SCRIPT).unwrap();
    assert_eq!(words[0], "D:\\Bhippi Models\\runtime\\strata\\Strata-0.1.44.1\\.venv\\Scripts\\python.exe");
    assert!(words[1].ends_with("serve\\server.py"));
    assert_eq!(&words[2..5], ["--engine", "strata", "--config"]);
    assert!(words[5].ends_with("strata-iq2_xs.json"));
    assert_eq!(&words[6..], ["--port", "8080", "--open"]);
    assert_eq!(parse_run_script("@echo off\r\nexit\r\n"), None);
}

#[test]
fn the_command_runs_on_our_port_without_opening_a_browser() {
    let words = with_port(&parse_run_script(RUN_SCRIPT).unwrap(), 51234);
    assert_eq!(&words[words.len() - 2..], ["--port", "51234"]);
    assert_eq!(words.iter().filter(|word| *word == "--port").count(), 1);
    assert!(!words.iter().any(|word| word == "--open"));
    assert!(words[5].ends_with("strata-iq2_xs.json"), "the other words are kept as they were");
    assert_eq!(with_port(&["python".to_owned(), "server.py".to_owned()], 9), ["python", "server.py", "--port", "9"]);
}

#[test]
fn start_failures_are_explained() {
    let page_file = explain_failure("ExpertCache: cudaMalloc(1073741824) failed: out of memory\nengine exited");
    assert!(page_file.contains("page file") && page_file.contains("65536"), "{page_file}");
    assert!(explain_failure("std::bad_alloc").contains("ran out of memory"));
    assert!(explain_failure("the NVIDIA driver is too old").contains("580"));
    assert!(explain_failure("OSError: address already in use").contains("port"));
    let other = explain_failure("line one\n\nline two\nline three\nline four\nline five");
    assert!(other.contains("line two | line three | line four | line five") && !other.contains("line one"), "{other}");
    assert!(explain_failure("").contains("without saying why"));
}

#[test]
fn setup_in_progress_is_listed_as_the_download() {
    assert!(active_download(ENTRY_ID).is_none());
    let done = Arc::new(AtomicU64::new(5_000));
    *active_lock() = Some(Active { entry_id: ENTRY_ID.to_owned(), job_id: "job-1".to_owned(), variant: "iq2_xs".to_owned(), total: 10_000, done: done.clone() });
    let download = active_download(ENTRY_ID).unwrap();
    assert_eq!((download.job_id.as_str(), download.variant.as_str(), download.bytes_done, download.bytes_total), ("job-1", "iq2_xs", 5_000, 10_000));
    assert!(active_download("qwen3.5-4b").is_none());
    done.store(50_000, Ordering::Relaxed);
    assert_eq!(active_download(ENTRY_ID).unwrap().bytes_done, 10_000, "never more than the total");
    drop(ActiveGuard);
    assert!(active_download(ENTRY_ID).is_none());
}

#[test]
fn a_card_under_12_gb_is_called_experimental_and_given_a_fallback() {
    let (verdict, note) = plan_text(48.0, 63.8, 10.0, Some("NVIDIA GeForce RTX 3080"));
    assert_eq!(verdict, Verdict::Slow);
    assert!(note.starts_with("Experimental on cards under 12 GB"), "{note}");
    assert!(note.contains("Qwen3.6 35B A3B through llama.cpp"), "{note}");
    // A 12 GB card is the supported case.
    assert!(!plan_text(48.0, 63.8, 12.0, Some("RTX 5070")).1.contains("Experimental"));
}

#[test]
fn out_of_memory_failures_suggest_the_llama_cpp_model() {
    for text in ["ExpertCache: cudaMalloc(1073741824) failed: out of memory", "std::bad_alloc"] {
        let said = explain_failure(text);
        assert!(said.contains("Qwen3.6 35B A3B through llama.cpp") && said.contains("under 12 GB"), "{said}");
    }
    assert!(!explain_failure("the NVIDIA driver is too old").contains("Qwen3.6"));
}

#[test]
fn measured_speeds_are_kept_per_size_and_card() {
    let root = scratch("speeds");
    std::fs::create_dir_all(root.join("library")).unwrap();
    let check = |variant: &str, gpu: &str, decode: f64, at: u64| SpeedCheck {
        model_id: ENTRY_ID.to_owned(),
        variant: variant.to_owned(),
        gpu: gpu.to_owned(),
        vram_mb: 10_240,
        decode_tokens_per_second: Some(decode),
        prefill_tokens_per_second: None,
        measured_at: at,
    };
    assert!(load_speeds(&root).is_empty());
    save_speed(&root, check("iq2_xs", "RTX 3080", 20.0, 1)).unwrap();
    save_speed(&root, check("iq3_xxs", "RTX 3080", 15.0, 2)).unwrap();
    save_speed(&root, check("iq2_xs", "RTX 3080", 24.0, 3)).unwrap();
    save_speed(&root, check("iq2_xs", "RTX 4090", 90.0, 4)).unwrap();
    let all = load_speeds(&root);
    assert_eq!(all.len(), 3, "a new check replaces the old one for the same size and card");
    assert_eq!(all.iter().find(|item| item.variant == "iq2_xs" && item.gpu == "RTX 3080").unwrap().decode_tokens_per_second, Some(24.0));
    std::fs::write(speeds_path(&root), "not json").unwrap();
    assert!(load_speeds(&root).is_empty(), "a damaged file is an empty list");
    let _ignored = std::fs::remove_dir_all(&root);
}
