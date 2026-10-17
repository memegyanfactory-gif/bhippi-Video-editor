//! "Tune for this PC": a short measured sweep that finds the fastest settings of one installed model
//! on this machine, and the store that remembers them.
//!
//! Two phases, because llama.cpp's benchmark tool (`llama-bench`) knows the split and batch size
//! but not the expert cache or speculative decoding:
//!   1. `llama-bench` (reading = pp512, writing = tg128) over how many blocks keep their experts in
//!      RAM (the plan's number and a step either side) and the physical batch size (`-ub`);
//!   2. a real `llama-server` at the real context for the expert cache (off and two sizes, each paid
//!      for by moving blocks to RAM so video memory stays the same) and for speculation, timed with
//!      one completion each.
//! Everything is picked by one rule ([`choose`]): the fastest writing that keeps reading within 10
//! percent of the best, and the plan's own settings unless something wins by more than 3 percent.
//! The result is stored per model, size, graphics card, memory and llama.cpp build in
//! `<models>/library/llm-tuning.json`, and `llm_start` uses it when it applies.
//!
//! The pure parts (argument building, parsing, sweeps, selection, the store) are tested; the benchmark
//! is never run in tests.

use super::*;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};

/// Where results are kept, under `<models>/library`.
const TUNING_FILE: &str = "llm-tuning.json";
/// A change must write at least this much faster than the plan to be kept (benchmark noise is a few percent).
const MIN_GAIN: f64 = 1.03;
/// Reading speed may fall this far below the best candidate's before a candidate is ruled out.
const PREFILL_KEEP: f64 = 0.9;
/// The whole run gives up on optional steps after this long.
const BUDGET: Duration = Duration::from_secs(15 * 60);
/// One benchmark process may not run longer than this (loading a 60 GB model included).
const BENCH_LIMIT: Duration = Duration::from_secs(6 * 60);
const BLOCK_STEP: u32 = 4;
const UBATCHES: [u32; 2] = [1024, 2048];
const CACHE_SIZES_MIB: [u32; 2] = [1024, 2048];
/// llama.cpp's own default; the baseline of the batch-size sweep.
const BASE_UBATCH: u32 = 512;

static TUNING: AtomicBool = AtomicBool::new(false);

// ---------------------------------------------------------------------------------------------
// What is stored
// ---------------------------------------------------------------------------------------------

/// The knobs a tuning run settles.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunedSettings {
    /// Blocks whose experts stay in RAM (`--n-cpu-moe`); 0 for a dense model.
    pub cpu_moe_blocks: u32,
    /// GPU cache for those experts in MiB (`--moe-cache-mib`); 0 = off.
    pub moe_cache_mib: u32,
    /// Physical batch size (`-ub`).
    pub ubatch: u32,
    /// "mtp" or "eagle3" when speculation was measured to help, else None.
    pub speculative: Option<String>,
}

/// What a tuning run found for one model on one PC.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TuneRecord {
    pub model_id: String,
    pub variant: String,
    pub gpu: String,
    /// The card's total memory in MiB.
    pub vram_mb: u64,
    pub ram_gb: u32,
    /// The llama.cpp tag it was measured with.
    pub build: String,
    pub context_tokens: u32,
    /// How many blocks the plan itself kept in RAM when this was measured. When the plan now needs
    /// more (the card is busier than it was), the result no longer applies.
    pub plan_cpu_moe_blocks: u32,
    pub settings: TunedSettings,
    /// Reading speed in tokens a second, as measured with the chosen settings.
    pub prefill_tokens_per_second: f64,
    /// Writing speed in tokens a second.
    pub decode_tokens_per_second: f64,
    /// Seconds since 1970.
    pub measured_at: u64,
    /// What was tried, in plain words.
    pub notes: Vec<String>,
}

/// What a result is stored under: the model and size, and everything about the PC and the program
/// that changes the numbers.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TuneKey {
    pub model_id: String,
    pub variant: String,
    pub gpu: String,
    pub vram_mb: u64,
    pub ram_gb: u32,
    pub build: String,
}

impl TuneKey {
    pub fn new(model_id: &str, variant: &str, machine: &Machine, build: &str) -> Self {
        Self {
            model_id: model_id.to_owned(),
            variant: variant.to_owned(),
            gpu: machine.gpu_name.clone().unwrap_or_default(),
            vram_mb: (machine.vram_total_gb * 1024.0).round() as u64,
            ram_gb: machine.ram_gb.round() as u32,
            build: build.to_owned(),
        }
    }
}

impl TuneRecord {
    pub fn matches(&self, key: &TuneKey) -> bool {
        self.model_id == key.model_id && self.variant == key.variant && self.gpu == key.gpu && self.vram_mb == key.vram_mb && self.ram_gb == key.ram_gb && self.build == key.build
    }
}

fn tuning_path(models: &Path) -> PathBuf {
    models.join("library").join(TUNING_FILE)
}

/// Every stored result; a missing or damaged file is an empty list.
pub fn load(models: &Path) -> Vec<TuneRecord> {
    std::fs::read_to_string(tuning_path(models)).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
}

/// Stores a result, replacing an earlier one for the same key and context.
pub fn save(models: &Path, record: TuneRecord) -> Result<(), String> {
    let mut all = load(models);
    all.retain(|old| !(same_slot(old, &record) && old.context_tokens == record.context_tokens));
    all.push(record);
    crate::store::write_json(&tuning_path(models), &all)
}

fn same_slot(a: &TuneRecord, b: &TuneRecord) -> bool {
    a.model_id == b.model_id && a.variant == b.variant && a.gpu == b.gpu && a.vram_mb == b.vram_mb && a.ram_gb == b.ram_gb && a.build == b.build
}

/// The result that applies to a start: same key and context, and not made for a roomier card than the
/// plan has now.
pub fn find(models: &Path, key: &TuneKey, context_tokens: u32, plan_cpu_moe_blocks: u32) -> Option<TuneRecord> {
    load(models).into_iter().find(|record| record.matches(key) && record.context_tokens == context_tokens && plan_cpu_moe_blocks <= record.plan_cpu_moe_blocks)
}

/// The newest result for a model on this PC at any context (what the screen shows).
pub fn find_latest(models: &Path, key: &TuneKey) -> Option<TuneRecord> {
    load(models).into_iter().filter(|record| record.matches(key)).max_by_key(|record| record.measured_at)
}

/// What a start adds for a stored result: the tuned numbers, and speculation if it was measured to
/// help and its pieces are on disk.
pub fn speedups_from(record: &TuneRecord, plan_cpu_moe_blocks: u32, variant: &CatalogVariant, entry: &CatalogEntry, folder: &Path) -> Speedups {
    Speedups {
        cpu_moe_blocks: Some(record.settings.cpu_moe_blocks).filter(|blocks| *blocks != plan_cpu_moe_blocks),
        moe_cache_mib: record.settings.moe_cache_mib,
        ubatch: if record.settings.ubatch == BASE_UBATCH { 0 } else { record.settings.ubatch },
        speculative: speculation_named(record.settings.speculative.as_deref(), variant, entry, folder),
    }
}

/// What a start does with no stored result: the plan alone, plus the model's own MTP head when its file has one.
pub fn default_speedups(variant: &CatalogVariant) -> Speedups {
    Speedups { speculative: has_mtp(variant).then_some(Speculation::Mtp), ..Speedups::default() }
}

fn has_mtp(variant: &CatalogVariant) -> bool {
    variant.llm.as_ref().and_then(|shape| shape.speculative.as_deref()) == Some("mtp")
}

/// The EAGLE3 helper file of a model, when it was downloaded whole.
pub(super) fn eagle3_file(entry: &CatalogEntry, folder: &Path) -> Option<PathBuf> {
    let addon = entry.addons.iter().find(|addon| addon.id == "eagle3")?;
    let file = addon.files.first()?;
    let path = folder.join(&file.dest);
    std::fs::metadata(&path).is_ok_and(|meta| meta.len() == file.bytes).then_some(path)
}

fn speculation_named(name: Option<&str>, variant: &CatalogVariant, entry: &CatalogEntry, folder: &Path) -> Option<Speculation> {
    match name? {
        "mtp" if has_mtp(variant) => Some(Speculation::Mtp),
        "eagle3" => eagle3_file(entry, folder).map(|draft| Speculation::Eagle3 { draft }),
        _ => None,
    }
}

// ---------------------------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------------------------

/// Block counts to try for `--n-cpu-moe`: the plan's, then a step more in RAM and a step fewer. Fewer
/// blocks in RAM means more video memory in use, so the benchmark (which allocates no long context)
/// may accept a number the real server cannot; a real start at full context checks it afterwards.
/// A plan that already fits everything on the card has nothing to sweep.
pub fn block_candidates(plan_blocks: u32, layers: u32) -> Vec<u32> {
    if plan_blocks == 0 {
        return vec![0];
    }
    let mut out = vec![plan_blocks];
    for candidate in [plan_blocks.saturating_add(BLOCK_STEP), plan_blocks.saturating_sub(BLOCK_STEP)] {
        if candidate <= layers && !out.contains(&candidate) && candidate != plan_blocks {
            out.push(candidate);
        }
    }
    out
}

/// After the first sweep: when a neighbour beat the plan, one more step the same way (two steps from the plan).
pub fn extend_blocks(results: &[(u32, f64)], plan_blocks: u32, layers: u32) -> Vec<u32> {
    let Some(best) = results.iter().max_by(|a, b| a.1.total_cmp(&b.1)) else { return Vec::new() };
    let next = if best.0 == plan_blocks.saturating_add(BLOCK_STEP) {
        plan_blocks.saturating_add(2 * BLOCK_STEP)
    } else if plan_blocks > BLOCK_STEP && best.0 == plan_blocks - BLOCK_STEP {
        plan_blocks - 2 * BLOCK_STEP
    } else {
        return Vec::new();
    };
    if next <= layers && !results.iter().any(|(blocks, _)| *blocks == next) {
        vec![next]
    } else {
        Vec::new()
    }
}

/// Expert cache sizes to try as `(blocks in RAM, cache MiB)`: each cache is paid for by moving enough
/// blocks' experts to RAM, so the card's memory use stays what it was. Nothing for a model with no
/// experts in RAM.
pub fn cache_candidates(per_block_mib: f64, blocks: u32, layers: u32) -> Vec<(u32, u32)> {
    if blocks == 0 || per_block_mib <= 1.0 {
        return Vec::new();
    }
    CACHE_SIZES_MIB
        .iter()
        .filter_map(|mib| {
            let moved = (f64::from(*mib) / per_block_mib).ceil() as u32;
            let total = blocks + moved;
            (total <= layers).then_some((total, *mib))
        })
        .collect()
}

/// One measured candidate. The first in a list is the baseline.
#[derive(Clone, Debug, PartialEq)]
pub struct Measured<T> {
    pub settings: T,
    /// Reading speed, tokens a second.
    pub prefill: f64,
    /// Writing speed, tokens a second.
    pub decode: f64,
}

/// The index of the winner. The fastest writing among those that read within 10 percent of the best
/// reader; the baseline (index 0) unless the winner writes at least 3 percent faster.
pub fn choose<T>(points: &[Measured<T>]) -> Option<usize> {
    if points.is_empty() {
        return None;
    }
    let best_prefill = points.iter().map(|point| point.prefill).fold(0.0, f64::max);
    let mut winner: Option<usize> = None;
    for (at, point) in points.iter().enumerate() {
        if point.prefill < best_prefill * PREFILL_KEEP {
            continue;
        }
        if winner.map_or(true, |current| point.decode > points[current].decode) {
            winner = Some(at);
        }
    }
    let winner = winner?;
    let baseline = &points[0];
    if winner != 0 && baseline.prefill >= best_prefill * PREFILL_KEEP && points[winner].decode < baseline.decode * MIN_GAIN {
        return Some(0);
    }
    Some(winner)
}

// ---------------------------------------------------------------------------------------------
// llama-bench: arguments and output
// ---------------------------------------------------------------------------------------------

pub fn bench_exe(models: &Path) -> PathBuf {
    runtime_dir(models).join(if cfg!(windows) { "llama-bench.exe" } else { "llama-bench" })
}

/// Arguments of one `llama-bench` run: flash attention and an 8-bit cache as the server uses them,
/// reading 512 tokens and writing 128, JSON on standard output. `blocks` is `--n-cpu-moe` for a MoE
/// model; a dense model passes `None` and its GPU layer count in `gpu_layers`.
pub fn bench_args(model: &Path, gpu_layers: u32, blocks: Option<u32>, ubatch: u32) -> Vec<String> {
    let mut args: Vec<String> = vec!["-m".into(), model.display().to_string(), "-ngl".into(), gpu_layers.to_string()];
    if let Some(blocks) = blocks {
        args.extend(["-ncmoe".into(), blocks.to_string()]);
    }
    args.extend(["-ub".into(), ubatch.to_string(), "-fa".into(), "1".into(), "-ctk".into(), "q8_0".into(), "-ctv".into(), "q8_0".into()]);
    args.extend(["-p".into(), "512".into(), "-n".into(), "128".into(), "-r".into(), "1".into(), "-o".into(), "json".into()]);
    args
}

/// The JSON objects in a text, found by their braces. `llama-bench` prints an array one test at a
/// time, so a run that dies half way still leaves the finished tests readable.
pub fn json_objects(text: &str) -> Vec<Value> {
    let mut out = Vec::new();
    let mut depth = 0_u32;
    let mut start = 0_usize;
    let mut in_string = false;
    let mut escaped = false;
    for (at, character) in text.char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                in_string = false;
            }
            continue;
        }
        match character {
            '"' if depth > 0 => in_string = true,
            '{' => {
                if depth == 0 {
                    start = at;
                }
                depth += 1;
            }
            '}' if depth > 0 => {
                depth -= 1;
                if depth == 0 {
                    if let Ok(value) = serde_json::from_str::<Value>(&text[start..=at]) {
                        out.push(value);
                    }
                }
            }
            _ => {}
        }
    }
    out
}

/// What one `llama-bench` run measured.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BenchPoint {
    pub prefill: f64,
    pub decode: f64,
}

/// Reading and writing speed from `llama-bench -o json` output: the test with only a prompt is
/// reading, the one with only generation is writing. Both are needed.
pub fn parse_bench(text: &str) -> Option<BenchPoint> {
    let mut prefill = None;
    let mut decode = None;
    for object in json_objects(text) {
        let speed = object["avg_ts"].as_f64().filter(|speed| *speed > 0.0)?;
        let prompt = object["n_prompt"].as_u64().unwrap_or(0);
        let generated = object["n_gen"].as_u64().unwrap_or(0);
        if prompt > 0 && generated == 0 {
            prefill = Some(speed);
        } else if generated > 0 && prompt == 0 {
            decode = Some(speed);
        }
    }
    Some(BenchPoint { prefill: prefill?, decode: decode? })
}

// ---------------------------------------------------------------------------------------------
// llama-server: timings and metrics
// ---------------------------------------------------------------------------------------------

/// Reading and writing speed seen in one request, plus how much the server drafted ahead.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Timing {
    pub prefill: Option<f64>,
    pub decode: Option<f64>,
    /// Draft tokens proposed and accepted, when speculation ran.
    pub drafted: Option<(u64, u64)>,
}

/// A prompt shorter than this says nothing about reading speed.
const MIN_PROMPT_TOKENS: u64 = 16;

/// The speeds in a `timings` object from a llama-server response (`prompt_per_second`,
/// `predicted_per_second`). Reading speed is only taken from a prompt of some length.
pub fn parse_timings(timings: &Value) -> Option<Timing> {
    if !timings.is_object() {
        return None;
    }
    let positive = |key: &str| timings[key].as_f64().filter(|speed| *speed > 0.0);
    let prompt_tokens = timings["prompt_n"].as_u64().unwrap_or(0);
    let prefill = positive("prompt_per_second").filter(|_| prompt_tokens >= MIN_PROMPT_TOKENS);
    let decode = positive("predicted_per_second");
    let drafted = timings["draft_n"].as_u64().filter(|drafted| *drafted > 0).map(|drafted| (drafted, timings["draft_n_accepted"].as_u64().unwrap_or(0)));
    (prefill.is_some() || decode.is_some()).then_some(Timing { prefill, decode, drafted })
}

/// A whole response: its `timings`, or, from a server that reports none, the tokens written over the
/// time the request took (writing only, and only when there were enough tokens to mean something).
pub fn timing_of_response(value: &Value, elapsed_seconds: f64) -> Option<Timing> {
    if let Some(timing) = parse_timings(&value["timings"]) {
        return Some(timing);
    }
    let written = value["usage"]["completion_tokens"].as_f64().or_else(|| value["tokens_predicted"].as_f64()).filter(|tokens| *tokens >= 8.0)?;
    Some(Timing { prefill: None, decode: Some(written / elapsed_seconds.max(0.05)), drafted: None })
}

/// Speeds the server reports on `/metrics` over its recent requests (`prompt_tokens_seconds`,
/// `predicted_tokens_seconds`); 0 means no requests yet and reads as None.
pub fn parse_metrics(text: &str) -> Timing {
    let mut timing = Timing::default();
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('#') {
            continue;
        }
        let mut parts = line.split_whitespace();
        let (Some(name), Some(value)) = (parts.next(), parts.next()) else { continue };
        let Ok(value) = value.parse::<f64>() else { continue };
        if value <= 0.0 || !value.is_finite() {
            continue;
        }
        let name = name.rsplit(':').next().unwrap_or(name);
        match name {
            "prompt_tokens_seconds" => timing.prefill = Some(value),
            "predicted_tokens_seconds" => timing.decode = Some(value),
            _ => {}
        }
    }
    timing
}

/// A passage to read, then a request to continue it: long enough that reading speed means something,
/// plain prose so speculation is not flattered by repetition.
pub const MEASURE_PROMPT: &str = "The harbour town of Velmar sat where two rivers met the sea, and for three centuries its fortunes had followed the tides. \
In spring the fishing fleet left before dawn and came back heavy with herring, and the whole quay smelled of salt, smoke and tar. \
In summer the merchants arrived from the inland cities with wagons of grain, wool and glass, and the tavern keepers worked until the lamps burned low. \
Autumn brought storms that tore at the roofs and kept the boats ashore for days, and the old women said that the sea was settling its accounts. \
Winter was quiet. The rivers slowed under thin ice, the lighthouse keeper trimmed his wick twice each night, and the children learned their letters from the \
harbour master's wife, who kept a slate by the stove and a jar of dried apples for those who answered well. \
It was in such a winter that a stranger walked into Velmar from the north road, carrying a leather case and wearing boots that had seen far too many miles. \
Nobody knew his name, and he did not offer it. He took a room above the chandler's shop, paid for a month in old silver coins, and asked only that no one disturb him \
between sunset and midnight. Within a week the whole town was talking about him. Write the next part of this story in detail, describing what the stranger does \
on his first evening and what the townspeople notice.";

/// A short prompt that warms the server up before it is timed.
pub const WARMUP_PROMPT: &str = "Say hello in five words.";

// ---------------------------------------------------------------------------------------------
// Words for the result
// ---------------------------------------------------------------------------------------------

/// "Tuned: 38 words/s writing · 1,450 tokens/s reading": a token is about three quarters of a word.
pub fn summary_line(decode_tokens_per_second: f64, prefill_tokens_per_second: f64) -> String {
    let words = (decode_tokens_per_second * 0.75).round().max(1.0) as u64;
    let reading = prefill_tokens_per_second.round().max(1.0) as u64;
    format!("Tuned: {words} words/s writing \u{b7} {} tokens/s reading", thousands(reading))
}

fn thousands(value: u64) -> String {
    let digits = value.to_string();
    let mut out = String::new();
    for (at, digit) in digits.chars().enumerate() {
        if at > 0 && (digits.len() - at) % 3 == 0 {
            out.push(',');
        }
        out.push(digit);
    }
    out
}

fn words_per_second(tokens_per_second: f64) -> u64 {
    (tokens_per_second * 0.75).round().max(1.0) as u64
}

// ---------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------

/// What a tuning run needs to know about the model it tunes.
pub(super) struct Prepared {
    pub entry: CatalogEntry,
    pub variant: CatalogVariant,
    pub shape: ModelShape,
    pub folder: PathBuf,
    pub model: PathBuf,
    pub projector: Option<PathBuf>,
    pub build: String,
}

/// Checks what can be checked before a job is started, so the screen gets a plain answer at once.
pub(super) fn prepare(models: &Path, id: &str, variant: Option<&str>) -> Result<Prepared, String> {
    let entry = find_entry(models, id).ok_or_else(|| format!("Bhippi has no local language model called {id}."))?;
    if !is_curated(&entry) {
        return Err("Tuning is for Bhippi's own picks. A model added from Hugging Face is split between the graphics card and RAM by llama.cpp itself when it starts.".into());
    }
    let marker = installed_marker(models).ok_or("Install the llama.cpp runtime first (Settings, Model Library).")?;
    if !supports_speedups(&marker.tag) || !bench_exe(models).is_file() {
        return Err("The installed llama.cpp is too old to tune with. Update the runtime and try again.".into());
    }
    let (found, folder) = installed_variant(models, &entry).ok_or_else(|| format!("Download {} first (Settings, Model Library).", entry.name))?;
    if let Some(wanted) = variant {
        if wanted != found.id {
            return Err("Tune the size that is downloaded; this one is not.".into());
        }
    }
    let found = found.clone();
    let shape = shape_of(&entry, &found).ok_or("This catalog entry does not say how the model is built.")?;
    for file in &found.files {
        if std::fs::metadata(folder.join(&file.dest)).map_or(true, |meta| meta.len() != file.bytes) {
            return Err(format!("{} is missing or incomplete. Download the model again.", folder.join(&file.dest).display()));
        }
    }
    let first = folder.join(&found.files.iter().find(|file| !is_projector(&file.dest)).ok_or("This version lists no files.")?.dest);
    let projector = found.files.iter().find(|file| is_projector(&file.dest)).map(|file| folder.join(&file.dest));
    Ok(Prepared { entry, variant: found, shape, folder, model: first, projector, build: marker.tag })
}

fn is_curated(entry: &CatalogEntry) -> bool {
    !entry.id.starts_with("hf:") && catalog().iter().any(|known| known.id == entry.id)
}

/// Ends a run's claim on the "one tuning at a time" flag, whichever way it ends.
struct Claim;
impl Drop for Claim {
    fn drop(&mut self) {
        TUNING.store(false, Ordering::SeqCst);
    }
}

pub(super) fn claim() -> Result<impl Drop, String> {
    TUNING.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).map_err(|_| "A model is already being tuned; follow it in the jobs list.".to_owned())?;
    Ok(Claim)
}

/// Runs one `llama-bench` process and reads its result; a run that fails (out of memory, a number the
/// card cannot hold) is an error the sweep skips.
async fn bench_once(models: &Path, args: &[String], job: &JobHandle) -> Result<BenchPoint, String> {
    let mut command = tokio::process::Command::new(bench_exe(models));
    command.args(args).current_dir(runtime_dir(models)).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null()).kill_on_drop(true);
    hide(&mut command);
    if !args.iter().any(|arg| arg == "-t" || arg == "--threads") {
        command.args(["-t", crate::resources::current().threads().to_string().as_str()]);
    }
    let child = command.spawn().map_err(|error| format!("could not start llama-bench: {error}"))?;
    crate::resources::contain(&child);
    let waiting = child.wait_with_output();
    tokio::pin!(waiting);
    let started = Instant::now();
    let output = loop {
        tokio::select! {
            result = &mut waiting => break result.map_err(|error| error.to_string())?,
            () = tokio::time::sleep(Duration::from_millis(500)) => {
                if *job.cancel.borrow() {
                    return Err("Cancelled".into());
                }
                if started.elapsed() > BENCH_LIMIT {
                    return Err("the benchmark took too long".into());
                }
            }
        }
    };
    let text = String::from_utf8_lossy(&output.stdout);
    parse_bench(&text).ok_or_else(|| if output.status.success() { "the benchmark printed no result".to_owned() } else { "the benchmark failed (probably out of memory)".to_owned() })
}

/// What a tuning run's server steps need.
struct ServerRun<'a> {
    state: &'a Arc<AppState>,
    prep: &'a Prepared,
    plan: &'a LlmPlan,
}

/// Starts a real server with `speed`, times one completion at full context and stops it again.
async fn server_run(run: &ServerRun<'_>, speed: &Speedups, job: &JobHandle, base: f64, span: f64, label: &str) -> Result<Timing, String> {
    let models = run.state.paths.models.clone();
    let port = free_port()?;
    let tuning = Tuning::Planned { moe: run.prep.shape.moe };
    let args = server_args_with(&run.prep.model, &run.prep.entry.id, run.plan, tuning, run.prep.projector.as_deref(), port, speed);
    let expected = 20.0 + run.prep.shape.file_gb * 3.0;
    let mut child = spawn_and_wait(&models, &args, job, label, expected, base, span * 0.8, "tune-server.log").await?;
    job.progress(base + span * 0.85, format!("Timing {label}"));
    let client = reqwest::Client::new();
    let result = async {
        measure_completion(&client, port, WARMUP_PROMPT, 4, 300).await;
        measure_completion(&client, port, MEASURE_PROMPT, 128, 600).await.ok_or_else(|| "the server did not answer the timing request".to_owned())
    }
    .await;
    let _ignored = child.kill();
    let _ignored = child.wait();
    tokio::time::sleep(Duration::from_millis(1500)).await;
    result
}

fn spent(started: Instant) -> bool {
    started.elapsed() > BUDGET
}

fn settings_of(blocks: u32, cache: u32, ubatch: u32, speculative: Option<&Speculation>) -> TunedSettings {
    TunedSettings { cpu_moe_blocks: blocks, moe_cache_mib: cache, ubatch, speculative: speculative.map(|kind| kind.kind().to_owned()) }
}

fn speedups_of(settings: &TunedSettings, speculative: Option<Speculation>) -> Speedups {
    Speedups { cpu_moe_blocks: Some(settings.cpu_moe_blocks), moe_cache_mib: settings.moe_cache_mib, ubatch: if settings.ubatch == BASE_UBATCH { 0 } else { settings.ubatch }, speculative }
}

/// The tuning run itself. Stops whatever is running (the card must be free), measures, stores the
/// result, and starts the model again if it was the one running.
#[allow(clippy::too_many_lines)]
pub(super) async fn run(app: &AppHandle, state: &Arc<AppState>, prep: Prepared, job: &JobHandle) -> Result<(String, TuneRecord), String> {
    let models = state.paths.models.clone();
    let was_running = running_now().is_some_and(|running| running.model_id == prep.entry.id);
    let began = Instant::now();
    job.progress(0.01, "Stopping the running model to free the graphics card");
    stop_server(app, state, "llm-stopped").await;
    crate::strata::stop_server(app, state, "llm-stopped").await;
    tokio::time::sleep(Duration::from_millis(1500)).await;

    let machine = read_machine(state).await;
    if machine.gpu_name.is_none() || machine.vram_total_gb < MIN_USEFUL_VRAM_GB {
        return Err("Tuning needs a graphics card; none was found.".into());
    }
    let pc = pc_from(&machine, false);
    let plan = plan(&prep.shape, &pc, None);
    if plan.verdict == Verdict::No {
        return Err(plan.note);
    }
    let layers = prep.shape.layers;
    let moe = prep.shape.moe;
    let plan_blocks = if moe { plan.cpu_moe_blocks } else { 0 };
    let gpu_layers = if moe || plan.gpu_layers >= layers { 999 } else { plan.gpu_layers };
    let blocks_arg = |blocks: u32| moe.then_some(blocks);
    let mut notes: Vec<String> = Vec::new();

    // Phase 1: llama-bench over the split and the batch size.
    let mut queue = block_candidates(plan_blocks, layers);
    let total_bench = queue.len() as f64 + 1.0 + UBATCHES.len() as f64;
    let mut done_bench = 0.0_f64;
    let mut by_blocks: Vec<Measured<u32>> = Vec::new();
    let mut tried: Vec<(u32, f64)> = Vec::new();
    let mut next = 0;
    while next < queue.len() {
        let blocks = queue[next];
        next += 1;
        if *job.cancel.borrow() {
            return Err("Cancelled".into());
        }
        if next > 1 && spent(began) {
            notes.push("Stopped the sweep early to keep the run short.".into());
            break;
        }
        job.progress(0.04 + 0.4 * (done_bench / total_bench).min(1.0), if moe { format!("Measuring with experts of {blocks} blocks in RAM") } else { "Measuring the model".to_owned() });
        match bench_once(&models, &bench_args(&prep.model, gpu_layers, blocks_arg(blocks), BASE_UBATCH), job).await {
            Ok(point) => {
                if moe {
                    notes.push(format!("{blocks} blocks in RAM: {} words/s writing, {} tokens/s reading", words_per_second(point.decode), point.prefill.round()));
                }
                tried.push((blocks, point.decode));
                by_blocks.push(Measured { settings: blocks, prefill: point.prefill, decode: point.decode });
            }
            Err(error) if error == "Cancelled" => return Err(error),
            Err(error) => notes.push(format!("{blocks} blocks in RAM: skipped ({error})")),
        }
        done_bench += 1.0;
        if next == queue.len() && queue.len() <= 3 {
            queue.extend(extend_blocks(&tried, plan_blocks, layers));
        }
    }
    if by_blocks.is_empty() {
        return Err("The measuring tool could not run this model. Close other programs that use the graphics card and try again.".into());
    }
    // The plan's own number is the baseline when it ran; otherwise the first that did.
    if let Some(plan_at) = by_blocks.iter().position(|point| point.settings == plan_blocks) {
        by_blocks.swap(0, plan_at);
    }
    let best_blocks = choose(&by_blocks).map_or(plan_blocks, |at| by_blocks[at].settings);
    let baseline_point = by_blocks.iter().find(|point| point.settings == best_blocks).cloned().ok_or("No measurement to start from.")?;

    // Batch size at the chosen split; one that does not fit simply drops out.
    let mut by_ubatch = vec![Measured { settings: BASE_UBATCH, prefill: baseline_point.prefill, decode: baseline_point.decode }];
    for ubatch in UBATCHES {
        if *job.cancel.borrow() {
            return Err("Cancelled".into());
        }
        if spent(began) {
            break;
        }
        job.progress(0.04 + 0.4 * (done_bench / total_bench).min(1.0), format!("Measuring with a batch size of {ubatch}"));
        match bench_once(&models, &bench_args(&prep.model, gpu_layers, blocks_arg(best_blocks), ubatch), job).await {
            Ok(point) => {
                notes.push(format!("Batch size {ubatch}: {} words/s writing, {} tokens/s reading", words_per_second(point.decode), point.prefill.round()));
                by_ubatch.push(Measured { settings: ubatch, prefill: point.prefill, decode: point.decode });
            }
            Err(error) if error == "Cancelled" => return Err(error),
            Err(error) => notes.push(format!("Batch size {ubatch}: skipped ({error})")),
        }
        done_bench += 1.0;
    }
    let best_ubatch = choose(&by_ubatch).map_or(BASE_UBATCH, |at| by_ubatch[at].settings);
    let from_bench = by_ubatch.iter().find(|point| point.settings == best_ubatch).cloned().ok_or("No measurement to start from.")?;

    // Phase 2: a real server for the expert cache and speculation, and to confirm the split at full context.
    let experts_mib = prep.shape.file_gb * expert_share(prep.shape.total_params_b, prep.shape.active_params_b, moe) * 1024.0;
    let per_block_mib = experts_mib / f64::from(layers.max(1));
    let caches = if moe && supports_speedups(&prep.build) { cache_candidates(per_block_mib, best_blocks, layers) } else { Vec::new() };
    let speculation: Option<Speculation> = if has_mtp(&prep.variant) {
        Some(Speculation::Mtp)
    } else {
        eagle3_file(&prep.entry, &prep.folder).map(|draft| Speculation::Eagle3 { draft })
    };
    let plan_settings = settings_of(plan_blocks, 0, BASE_UBATCH, None);
    let mut chosen = settings_of(best_blocks, 0, best_ubatch, None);
    let needs_server = !caches.is_empty() || speculation.is_some() || chosen != plan_settings;
    let mut final_speed = Timing { prefill: Some(from_bench.prefill), decode: Some(from_bench.decode), drafted: None };
    let mut final_speculation: Option<Speculation> = None;
    if needs_server {
        let runner = ServerRun { state, prep: &prep, plan: &plan };
        job.progress(0.46, "Starting the model at full context to confirm the settings");
        let mut base_timing = server_run(&runner, &speedups_of(&chosen, None), job, 0.46, 0.08, "the model").await;
        if let Err(error) = &base_timing {
            if error == "Cancelled" {
                return Err(error.clone());
            }
            if chosen != plan_settings {
                notes.push("The best split from the benchmark did not start at full context; went back to the plan's split.".into());
                chosen = plan_settings.clone();
                base_timing = server_run(&runner, &speedups_of(&chosen, None), job, 0.46, 0.08, "the model").await;
            }
        }
        let base_timing = base_timing?;
        let (Some(base_prefill), Some(base_decode)) = (base_timing.prefill, base_timing.decode) else {
            return Err("The model started but its speed could not be read from the server.".into());
        };
        let mut points = vec![Measured { settings: (chosen.clone(), None::<Speculation>), prefill: base_prefill, decode: base_decode }];
        notes.push(format!("At full context: {} words/s writing, {} tokens/s reading", words_per_second(base_decode), base_prefill.round()));
        let mut step = 0.54;
        let each = 0.4 / (caches.len() as f64 + 1.0 + f64::from(u8::from(speculation.is_some())));
        for (blocks, mib) in caches {
            if *job.cancel.borrow() {
                return Err("Cancelled".into());
            }
            if spent(began) {
                notes.push("Skipped the remaining expert cache sizes to keep the run short.".into());
                break;
            }
            let candidate = settings_of(blocks, mib, chosen.ubatch, None);
            match server_run(&runner, &speedups_of(&candidate, None), job, step, each, &format!("an expert cache of {} GB", f64::from(mib) / 1024.0)).await {
                Ok(timing) => match (timing.prefill, timing.decode) {
                    (Some(prefill), Some(decode)) => {
                        notes.push(format!("Expert cache of {:.0} GB: {} words/s writing, {} tokens/s reading", f64::from(mib) / 1024.0, words_per_second(decode), prefill.round()));
                        points.push(Measured { settings: (candidate, None), prefill, decode });
                    }
                    _ => notes.push(format!("Expert cache of {:.0} GB: no reading", f64::from(mib) / 1024.0)),
                },
                Err(error) if error == "Cancelled" => return Err(error),
                Err(error) => notes.push(format!("Expert cache of {:.0} GB: did not start ({error})", f64::from(mib) / 1024.0)),
            }
            step += each;
        }
        if let Some(kind) = speculation.clone() {
            let leader = choose(&points).map_or(0, |at| at);
            if *job.cancel.borrow() {
                return Err("Cancelled".into());
            }
            if spent(began) {
                notes.push("Skipped the speculation check to keep the run short.".into());
            } else {
                let mut candidate = points[leader].settings.0.clone();
                candidate.speculative = Some(kind.kind().to_owned());
                let label = if kind.kind() == "mtp" { "the model's own draft head (MTP)" } else { "the EAGLE3 helper" };
                match server_run(&runner, &speedups_of(&candidate, Some(kind.clone())), job, step, each, label).await {
                    Ok(timing) => match (timing.prefill, timing.decode) {
                        (Some(prefill), Some(decode)) => {
                            let leader_decode = points[leader].decode;
                            let accepted = timing.drafted.filter(|(drafted, _)| *drafted > 0).map(|(drafted, accepted)| format!(", {}% of drafted words kept", (accepted as f64 / drafted as f64 * 100.0).round()));
                            notes.push(format!("With {label}: {} words/s writing (without: {}){}", words_per_second(decode), words_per_second(leader_decode), accepted.unwrap_or_default()));
                            // Speculation is compared with the best without it, as a candidate after the baseline.
                            let mut compare = vec![points[leader].clone()];
                            compare.push(Measured { settings: (candidate, Some(kind.clone())), prefill, decode });
                            if choose(&compare) == Some(1) {
                                points.push(compare.remove(1));
                            }
                        }
                        _ => notes.push(format!("With {label}: no reading")),
                    },
                    Err(error) if error == "Cancelled" => return Err(error),
                    Err(error) => notes.push(format!("With {label}: did not start ({error})")),
                }
            }
        }
        // Speculation, when it won, is last in the list and beats the best without it; otherwise the choice is among the rest.
        let winner = choose(&points).unwrap_or(0);
        let picked = &points[winner];
        chosen = picked.settings.0.clone();
        final_speculation = picked.settings.1.clone();
        final_speed = Timing { prefill: Some(picked.prefill), decode: Some(picked.decode), drafted: None };
    }

    let decode = final_speed.decode.unwrap_or(from_bench.decode);
    let prefill = final_speed.prefill.unwrap_or(from_bench.prefill);
    let record = TuneRecord {
        model_id: prep.entry.id.clone(),
        variant: prep.variant.id.clone(),
        gpu: machine.gpu_name.clone().unwrap_or_default(),
        vram_mb: (machine.vram_total_gb * 1024.0).round() as u64,
        ram_gb: machine.ram_gb.round() as u32,
        build: prep.build.clone(),
        context_tokens: plan.context_tokens,
        plan_cpu_moe_blocks: plan_blocks,
        settings: TunedSettings { speculative: final_speculation.as_ref().map(|kind| kind.kind().to_owned()), ..chosen },
        prefill_tokens_per_second: (prefill * 10.0).round() / 10.0,
        decode_tokens_per_second: (decode * 10.0).round() / 10.0,
        measured_at: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |since| since.as_secs()),
        notes,
    };
    save(&models, record.clone())?;
    let mut summary = summary_line(record.decode_tokens_per_second, record.prefill_tokens_per_second);
    if was_running {
        job.progress(0.97, "Starting the model again with the tuned settings");
        if let Err(error) = start_inner(app.clone(), state.clone(), prep.entry.id.clone(), None, false, None).await {
            summary.push_str(&format!(". It could not be started again: {error}"));
        }
    }
    let _ignored = app.emit(LIBRARY_EVENT, serde_json::json!({ "id": prep.entry.id, "reason": "llm-tuned" }));
    Ok((summary, record))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    /// What `llama-bench -o json -p 512 -n 128` prints: one object per test (shortened to the fields that matter).
    const BENCH_OUTPUT: &str = r#"[
  {
    "build_commit": "27c7a769",
    "build_number": 11703,
    "gpu_info": "NVIDIA GeForce RTX 3080",
    "model_filename": "D:\\models\\llm\\q\\Qwen3.6-35B-A3B-UD-Q4_K_M.gguf",
    "n_cpu_moe": 28,
    "n_ubatch": 512,
    "tensor_buft_overrides": "none",
    "n_prompt": 512,
    "n_gen": 0,
    "avg_ns": 410000000,
    "avg_ts": 1248.5,
    "stddev_ts": 11.2,
    "samples_ts": [1240.1, 1256.9]
  },
  {
    "build_commit": "27c7a769",
    "build_number": 11703,
    "model_filename": "a {weird} \"name\".gguf",
    "n_prompt": 0,
    "n_gen": 128,
    "avg_ns": 3100000000,
    "avg_ts": 41.3,
    "stddev_ts": 0.4,
    "samples_ts": [41.0, 41.6]
  }
]
"#;

    fn point<T>(settings: T, prefill: f64, decode: f64) -> Measured<T> {
        Measured { settings, prefill, decode }
    }

    #[test]
    fn bench_output_gives_reading_and_writing_speed() {
        let point = parse_bench(BENCH_OUTPUT).unwrap();
        assert_eq!(point, BenchPoint { prefill: 1248.5, decode: 41.3 });
    }

    #[test]
    fn bench_output_that_stopped_half_way_is_not_a_result() {
        // The first test finished, the process died before the second: reading alone is no result.
        let cut = &BENCH_OUTPUT[..BENCH_OUTPUT.find("\"n_gen\": 128").unwrap()];
        assert_eq!(parse_bench(cut), None);
        assert_eq!(parse_bench(""), None);
        assert_eq!(parse_bench("ggml_cuda_init: found 1 CUDA devices\n"), None);
        // The finished object is still read out of a cut-off array.
        assert_eq!(json_objects(cut).len(), 1);
    }

    #[test]
    fn json_objects_handle_braces_inside_strings() {
        let found = json_objects(r#"noise {"a": "x}{y", "b": {"c": 1}} more {"d": 2}"#);
        assert_eq!(found.len(), 2);
        assert_eq!(found[0]["b"]["c"], 1);
        assert_eq!(found[1]["d"], 2);
        assert!(json_objects("[{\"broken\": ").is_empty());
    }

    #[test]
    fn bench_arguments_match_how_the_server_runs() {
        let moe = bench_args(Path::new("D:/m/model.gguf"), 999, Some(28), 1024).join(" ");
        assert_eq!(moe, "-m D:/m/model.gguf -ngl 999 -ncmoe 28 -ub 1024 -fa 1 -ctk q8_0 -ctv q8_0 -p 512 -n 128 -r 1 -o json");
        let dense = bench_args(Path::new("m.gguf"), 20, None, 512).join(" ");
        assert!(dense.starts_with("-m m.gguf -ngl 20 -ub 512") && !dense.contains("-ncmoe"), "{dense}");
    }

    #[test]
    fn the_block_sweep_goes_a_step_each_way_and_stays_in_range() {
        assert_eq!(block_candidates(28, 40), vec![28, 32, 24]);
        assert_eq!(block_candidates(38, 40), vec![38, 34], "no more blocks than the model has");
        assert_eq!(block_candidates(2, 40), vec![2, 6, 0], "a step fewer stops at nothing in RAM, never below");
        assert_eq!(block_candidates(0, 40), vec![0], "nothing in RAM, nothing to sweep");
        assert_eq!(block_candidates(36, 36), vec![36, 32]);
    }

    #[test]
    fn a_winning_neighbour_gets_one_more_step() {
        assert_eq!(extend_blocks(&[(28, 40.0), (32, 44.0), (24, 36.0)], 28, 40), vec![36]);
        assert_eq!(extend_blocks(&[(28, 40.0), (32, 38.0), (24, 43.0)], 28, 40), vec![20]);
        assert!(extend_blocks(&[(28, 40.0), (32, 38.0), (24, 36.0)], 28, 40).is_empty(), "the plan won");
        assert!(extend_blocks(&[(28, 40.0), (32, 44.0), (36, 45.0)], 28, 40).is_empty(), "already tried");
        assert!(extend_blocks(&[(34, 40.0), (38, 44.0)], 34, 40).is_empty(), "past the last block");
        assert!(extend_blocks(&[], 28, 40).is_empty());
    }

    #[test]
    fn each_cache_is_paid_for_with_blocks_moved_to_ram() {
        // 40 blocks of 480 MiB of experts: a 1 GB cache costs three blocks, 2 GB five.
        assert_eq!(cache_candidates(480.0, 28, 40), vec![(31, 1024), (33, 2048)]);
        assert!(cache_candidates(480.0, 38, 40).is_empty(), "too few blocks left for either cache");
        assert!(cache_candidates(480.0, 0, 40).is_empty(), "nothing in RAM, nothing to cache");
        assert!(cache_candidates(0.5, 20, 40).is_empty());
    }

    #[test]
    fn the_baseline_stays_unless_something_writes_clearly_faster() {
        // 2 percent faster is noise.
        let noise = [point("plan", 1000.0, 40.0), point("other", 1000.0, 40.8)];
        assert_eq!(choose(&noise), Some(0));
        // 8 percent faster wins.
        let better = [point("plan", 1000.0, 40.0), point("other", 1000.0, 43.2)];
        assert_eq!(choose(&better), Some(1));
        assert_eq!(choose::<u8>(&[]), None);
    }

    #[test]
    fn writing_speed_never_costs_more_than_a_tenth_of_reading_speed() {
        // The fastest writer reads 30 percent slower than the best reader: ruled out.
        let points = [point("plan", 1000.0, 40.0), point("fast writer, slow reader", 700.0, 60.0), point("best reader", 1400.0, 41.0)];
        assert_eq!(choose(&points), Some(2));
        // Within 10 percent of the best reader is allowed.
        let points = [point("plan", 1000.0, 40.0), point("fast writer", 950.0, 60.0), point("best reader", 1000.0, 41.0)];
        assert_eq!(choose(&points), Some(1));
        // A baseline that reads too slowly can lose to a candidate that is only a little faster at writing.
        let points = [point("plan", 600.0, 40.0), point("quick", 1200.0, 40.5)];
        assert_eq!(choose(&points), Some(1));
    }

    #[test]
    fn timings_are_read_from_a_server_response() {
        let response: Value = serde_json::from_str(
            r#"{"content": "x", "timings": {"cache_n": 236, "prompt_n": 410, "prompt_ms": 280.5, "prompt_per_second": 1461.7, "predicted_n": 128, "predicted_ms": 3100.0, "predicted_per_second": 41.29, "draft_n": 90, "draft_n_accepted": 66}}"#,
        )
        .unwrap();
        let timing = parse_timings(&response["timings"]).unwrap();
        assert_eq!(timing.prefill, Some(1461.7));
        assert_eq!(timing.decode, Some(41.29));
        assert_eq!(timing.drafted, Some((90, 66)));
        // A one-token prompt says nothing about reading speed.
        let tiny: Value = serde_json::from_str(r#"{"prompt_n": 1, "prompt_per_second": 32.3, "predicted_n": 35, "predicted_per_second": 20.1}"#).unwrap();
        assert_eq!(parse_timings(&tiny), Some(Timing { prefill: None, decode: Some(20.1), drafted: None }));
        assert_eq!(parse_timings(&Value::Null), None);
        assert_eq!(parse_timings(&serde_json::json!({})), None);
    }

    #[test]
    fn a_server_without_timings_is_timed_by_the_clock() {
        let chat: Value = serde_json::from_str(r#"{"usage": {"completion_tokens": 48, "prompt_tokens": 20}}"#).unwrap();
        let timing = timing_of_response(&chat, 2.0).unwrap();
        assert_eq!(timing.decode, Some(24.0));
        assert_eq!(timing.prefill, None);
        let few: Value = serde_json::from_str(r#"{"usage": {"completion_tokens": 3}}"#).unwrap();
        assert_eq!(timing_of_response(&few, 1.0), None, "three tokens prove nothing");
    }

    #[test]
    fn metrics_give_the_speeds_of_real_requests() {
        let text = "# HELP llamacpp:prompt_tokens_seconds Average prompt throughput in tokens/s\n# TYPE llamacpp:prompt_tokens_seconds gauge\nllamacpp:prompt_tokens_seconds 1304.5\nllamacpp:predicted_tokens_seconds 38.25\nllamacpp:requests_processing 0\n";
        let timing = parse_metrics(text);
        assert_eq!((timing.prefill, timing.decode), (Some(1304.5), Some(38.25)));
        // Before any request both are 0, which reads as no measurement.
        let idle = parse_metrics("llamacpp:prompt_tokens_seconds 0\nllamacpp:predicted_tokens_seconds 0\n");
        assert_eq!((idle.prefill, idle.decode), (None, None));
        assert_eq!(parse_metrics("garbage\n\n"), Timing::default());
    }

    #[test]
    fn the_result_reads_in_words() {
        assert_eq!(summary_line(51.0, 1450.0), "Tuned: 38 words/s writing \u{b7} 1,450 tokens/s reading");
        assert_eq!(summary_line(0.4, 12.0), "Tuned: 1 words/s writing \u{b7} 12 tokens/s reading");
        assert_eq!(thousands(1_234_567), "1,234,567");
        assert_eq!(thousands(999), "999");
    }

    fn machine(gpu: &str, vram: f64, ram: f64) -> Machine {
        Machine { gpu_name: Some(gpu.to_owned()), vram_total_gb: vram, vram_free_gb: vram, ram_gb: ram }
    }

    fn record(model: &str, variant: &str, build: &str, decode: f64) -> TuneRecord {
        let key = TuneKey::new(model, variant, &machine("NVIDIA GeForce RTX 3080", 10.0, 63.8), build);
        TuneRecord {
            model_id: key.model_id,
            variant: key.variant,
            gpu: key.gpu,
            vram_mb: key.vram_mb,
            ram_gb: key.ram_gb,
            build: key.build,
            context_tokens: 16_384,
            plan_cpu_moe_blocks: 28,
            settings: TunedSettings { cpu_moe_blocks: 31, moe_cache_mib: 1024, ubatch: 1024, speculative: Some("mtp".into()) },
            prefill_tokens_per_second: 1450.0,
            decode_tokens_per_second: decode,
            measured_at: 1_760_000_000,
            notes: vec!["a".into()],
        }
    }

    fn scratch(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("bhippi-tune-{name}-{}", std::process::id()));
        let _ignored = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("library")).unwrap();
        root
    }

    #[test]
    fn results_are_kept_per_model_size_card_memory_and_build() {
        let root = scratch("store");
        let pc = machine("NVIDIA GeForce RTX 3080", 10.0, 63.8);
        save(&root, record("qwen3.6-35b-a3b", "q4", "b11703", 50.0)).unwrap();
        save(&root, record("qwen3.6-35b-a3b", "q4-mtp", "b11703", 70.0)).unwrap();
        save(&root, record("gpt-oss-20b", "q4", "b11703", 90.0)).unwrap();
        // A newer measurement of the same slot replaces the older one.
        save(&root, record("qwen3.6-35b-a3b", "q4", "b11703", 55.0)).unwrap();
        assert_eq!(load(&root).len(), 3);
        let key = TuneKey::new("qwen3.6-35b-a3b", "q4", &pc, "b11703");
        assert_eq!(find(&root, &key, 16_384, 28).unwrap().decode_tokens_per_second, 55.0);
        // Another size, another card, another amount of memory or another build: not the same result.
        assert_eq!(find(&root, &TuneKey::new("qwen3.6-35b-a3b", "q4-mtp", &pc, "b11703"), 16_384, 28).unwrap().decode_tokens_per_second, 70.0);
        assert!(find(&root, &TuneKey::new("qwen3.6-35b-a3b", "q8", &pc, "b11703"), 16_384, 28).is_none());
        assert!(find(&root, &TuneKey::new("qwen3.6-35b-a3b", "q4", &machine("NVIDIA GeForce RTX 4090", 24.0, 63.8), "b11703"), 16_384, 28).is_none());
        assert!(find(&root, &TuneKey::new("qwen3.6-35b-a3b", "q4", &machine("NVIDIA GeForce RTX 3080", 10.0, 32.0), "b11703"), 16_384, 28).is_none());
        assert!(find(&root, &TuneKey::new("qwen3.6-35b-a3b", "q4", &pc, "b11800"), 16_384, 28).is_none(), "a new llama.cpp build asks for a new measurement");
        // Another context length is another measurement.
        assert!(find(&root, &key, 32_768, 28).is_none());
        // A card that is busier now (the plan needs more blocks in RAM) cannot use a result made when it was roomier.
        assert!(find(&root, &key, 16_384, 33).is_none());
        assert!(find(&root, &key, 16_384, 20).is_some(), "a roomier card still can");
        assert!(find_latest(&root, &key).is_some());
        // A damaged file is an empty store, and saving heals it.
        std::fs::write(tuning_path(&root), "{ not json").unwrap();
        assert!(load(&root).is_empty());
        save(&root, record("gpt-oss-20b", "q4", "b11703", 90.0)).unwrap();
        assert_eq!(load(&root).len(), 1);
        let _ignored = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_stored_result_shows_in_the_server_arguments() {
        let entry = catalog().iter().find(|entry| entry.id == "qwen3.6-35b-a3b").unwrap();
        let mtp = entry.variants.iter().find(|variant| variant.id == "q4-mtp").expect("the MTP size is in the catalog");
        let plain = entry.variants.iter().find(|variant| variant.id == "q4").unwrap();
        let folder = Path::new("D:/none");
        let stored = record("qwen3.6-35b-a3b", "q4-mtp", "b11703", 70.0);
        let speed = speedups_from(&stored, 28, mtp, entry, folder);
        assert_eq!(speed, Speedups { cpu_moe_blocks: Some(31), moe_cache_mib: 1024, ubatch: 1024, speculative: Some(Speculation::Mtp) });
        // The same result on a size whose file has no MTP head cannot turn speculation on.
        assert_eq!(speedups_from(&stored, 28, plain, entry, folder).speculative, None);
        // Measured as not helping: off, even on an MTP file.
        let mut off = stored.clone();
        off.settings.speculative = None;
        assert_eq!(speedups_from(&off, 28, mtp, entry, folder).speculative, None);
        // With no stored result an MTP file starts with its head on, a plain one with the plan alone.
        assert_eq!(default_speedups(mtp).speculative, Some(Speculation::Mtp));
        assert_eq!(default_speedups(plain), Speedups::default());
        // The plan's own block count and the default batch size add no flags.
        let mut same = stored.clone();
        same.settings = TunedSettings { cpu_moe_blocks: 28, moe_cache_mib: 0, ubatch: 512, speculative: None };
        assert_eq!(speedups_from(&same, 28, plain, entry, folder), Speedups::default());
    }
}
