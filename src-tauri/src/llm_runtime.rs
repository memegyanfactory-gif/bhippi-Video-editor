//! Local LLMs through a Bhippi-managed llama.cpp server, tuned to the PC (MoE experts offloaded to
//! RAM so big models fit small GPUs). See docs/model-library.md.
//!
//! Three parts:
//!   1. the runtime: the official llama.cpp Windows release, pinned, installed under
//!      `<models>/runtime/llama` (CUDA 12 build plus its cudart package on an NVIDIA PC, CPU build
//!      otherwise);
//!   2. the plan: a pure function from a model's shape and this PC's memory to "keep the experts of N
//!      blocks in RAM", a memory estimate, a speed range and a verdict;
//!   3. the server: started with that plan on a free loopback port, one at a time, and offered to
//!      Bhippi's chat as the local llama.cpp provider while it runs.

use crate::{jobs::JobHandle, models, AppState};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

mod tune;

/// The release the runtime is pinned to. Its assets and SHA-256 sums are below.
const LLAMA_TAG: &str = "b11703";
const RELEASE_BASE: &str = "https://github.com/ggml-org/llama.cpp/releases/download";
/// Provider id of the llama.cpp row in `bhippi-providers`' catalogue.
const PROVIDER_ID: &str = "llamacpp";
const LIBRARY_EVENT: &str = "bhippi://model-library";
const CATALOG_JSON: &str = include_str!("../catalog/library/llm.json");

/// One file of the runtime: where it is published, its SHA-256 and size.
struct Pack {
    name: &'static str,
    /// Published under `releases/download/<tag>/`; `{tag}` in `name` is replaced.
    sha256: &'static str,
    bytes: u64,
}

const PACK_CUDA: Pack = Pack { name: "llama-{tag}-bin-win-cuda-12.4-x64.zip", sha256: "2f93aa90c8ec23b18ea7935e6e734514f2cf71a5f03130c060a8c65e46037b2b", bytes: 266_832_389 };
const PACK_CUDART: Pack = Pack { name: "cudart-llama-bin-win-cuda-12.4-x64.zip", sha256: "8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6", bytes: 391_443_627 };
const PACK_CPU: Pack = Pack { name: "llama-{tag}-bin-win-cpu-x64.zip", sha256: "cf3050ac140fb9d8c726cdea5e3c16b1879c86e41443aabb84c948e9e100b9de", bytes: 19_610_655 };

fn packs(cuda: bool) -> Vec<&'static Pack> {
    if cuda {
        vec![&PACK_CUDA, &PACK_CUDART]
    } else {
        vec![&PACK_CPU]
    }
}

fn pack_url(pack: &Pack) -> String {
    format!("{RELEASE_BASE}/{LLAMA_TAG}/{}", pack.name.replace("{tag}", LLAMA_TAG))
}

// ---------------------------------------------------------------------------------------------
// Shapes shared with the screen (src/lib/modelLibrary.ts)
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmRunning {
    pub model_id: String,
    pub variant: String,
    pub url: String,
    pub port: u16,
    pub args: Vec<String>,
    pub gpu_layers_note: String,
    /// Writing speed measured when the model started (kept for older screens).
    pub tokens_per_second: Option<f64>,
    /// Reading speed (prompt processing) in tokens a second: the server's own figure from real requests once there
    /// are some, else what the start-up check measured. None when nothing was measured.
    pub prefill_tokens_per_second: Option<f64>,
    /// Writing speed (generation) in tokens a second, measured the same way.
    pub decode_tokens_per_second: Option<f64>,
    /// The settings came from a tuning run on this PC ("Tune for this PC"), not only from the plan.
    pub tuned: bool,
    /// The speculative-decoding kind in use ("mtp" or "eagle3"), else None.
    pub speculative: Option<String>,
    /// The speed-ups this server was started with, as the screen names them ("Expert cache", "MTP", "Prompt cache").
    pub speedups: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmRuntimeStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub cuda: bool,
    pub running: Option<LlmRunning>,
    pub message: String,
    /// An older llama.cpp build is installed; installing again moves to the pinned one.
    pub update_available: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Verdict {
    Great,
    Ok,
    Slow,
    No,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmPlan {
    pub context_tokens: u32,
    /// Blocks whose MoE experts stay in system RAM (`--n-cpu-moe`); 0 = all on the GPU.
    pub cpu_moe_blocks: u32,
    pub gpu_layers: u32,
    pub vram_gb: f64,
    pub ram_gb: f64,
    pub est_tokens_per_second: Option<(f64, f64)>,
    pub verdict: Verdict,
    pub note: String,
    /// The verdict is No only because of the memory limit in Settings (the PC itself has enough):
    /// the UI offers a link to raise it.
    pub over_limit: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartResult {
    pub plan: LlmPlan,
    pub running: Option<LlmRunning>,
}

// ---------------------------------------------------------------------------------------------
// The plan: a pure function
// ---------------------------------------------------------------------------------------------

const GIB: f64 = 1_073_741_824.0;
/// A q8_0 KV cache takes 34 bytes per 32 values against 64 for f16.
const KV_Q8_RATIO: f64 = 0.53;
/// CUDA's compute buffers and the model's scratch space, on top of the weights and the cache.
const COMPUTE_GB: f64 = 0.5;
/// Left free on the card for Windows, the display and Bhippi's own preview.
const HEADROOM_GB: f64 = 1.0;
/// The operating system, llama.cpp's own buffers and a little slack, on top of the weights in RAM.
const RAM_OVERHEAD_GB: f64 = 4.0;
/// Aimed at by default: the chat sends a long system prompt and tool list, and 32K leaves room for
/// them, the project summary and the answer. Halved when the part that must sit in memory would not fit.
const DEFAULT_CONTEXT: u32 = 32_768;
const MIN_CONTEXT: u32 = 4_096;
/// What a desktop's system memory sustains while llama.cpp reads experts: dual-channel DDR4/DDR5
/// peaks at 50 to 90 GB/s and the CPU kernels reach roughly half of it. An assumption, not a reading.
const RAM_BANDWIDTH_GBS: f64 = 40.0;
/// How much of a mixture-of-experts model's per-token reading is routed experts (the rest is
/// attention, shared experts and the output head, which stay on the GPU). Models range from a third
/// (hybrid linear-attention ones) to 70 percent; this is the middle.
const EXPERT_READ_SHARE: f64 = 0.5;
/// Real speed against the bandwidth-only ideal: kernel overhead, cache misses, sampling.
const SPEED_LOW: f64 = 0.4;
const SPEED_HIGH: f64 = 0.75;
/// Below this free video memory the card is no use for offloading.
const MIN_USEFUL_VRAM_GB: f64 = 1.5;

/// What the plan needs to know about one model file set.
#[derive(Clone, Debug)]
pub struct ModelShape {
    pub total_params_b: f64,
    pub active_params_b: f64,
    pub moe: bool,
    pub layers: u32,
    pub context_max: u32,
    /// All GGUF parts together, in GiB.
    pub file_gb: f64,
    /// Bytes of f16 KV cache per token of context (K and V, every layer that keeps one).
    pub kv_bytes_per_token: f64,
    /// Context-independent cache (sliding-window layers), in bytes at f16.
    pub kv_fixed_bytes: f64,
    /// The picture reader (mmproj) of a vision model, in GiB; it sits on the GPU next to the weights.
    pub projector_gb: f64,
}

/// This PC, as far as the plan cares.
#[derive(Clone, Debug)]
pub struct Pc {
    /// Video memory Bhippi may use, in GiB; 0 when there is no usable GPU.
    pub vram_gb: f64,
    pub gpu_bandwidth_gbs: f64,
    /// Installed system memory, in GiB.
    pub ram_gb: f64,
    pub ram_bandwidth_gbs: f64,
    /// Memory Bhippi may use (Settings › Performance), in GiB; at most `ram_gb`.
    pub ram_cap_gb: f64,
    /// The share of the memory that cap is, for the notes.
    pub ram_percent: u8,
    /// Threads llama.cpp may use; the CPU-side speed scales with them up to the memory bandwidth.
    pub cpu_threads: usize,
}

/// Threads at which one desktop's CPU kernels already saturate the system memory's bandwidth;
/// below it, decode speed on the processor is roughly proportional to the threads used.
const BANDWIDTH_THREADS: f64 = 8.0;

impl Pc {
    /// System-memory bandwidth reachable with the threads the limit allows.
    fn cpu_bandwidth_gbs(&self) -> f64 {
        let share = (self.cpu_threads as f64 / BANDWIDTH_THREADS).clamp(1.0 / BANDWIDTH_THREADS, 1.0);
        self.ram_bandwidth_gbs.max(1.0) * share
    }
}

/// The share of a mixture-of-experts file that is routed experts (the part `--n-cpu-moe` moves to
/// RAM). An estimate from total against active parameters: the fewer parameters are active, the
/// more of the file is experts. Fitted to attention, shared and expert sizes of the models in the
/// catalog (0.90 to 0.97) and capped at 0.95 so the GPU-resident part is never underestimated.
pub fn expert_share(total_params_b: f64, active_params_b: f64, moe: bool) -> f64 {
    if !moe || total_params_b <= 0.0 {
        return 0.0;
    }
    (1.0 - 0.6 * (active_params_b / total_params_b)).clamp(0.5, 0.95)
}

fn kv_gb(shape: &ModelShape, context: u32) -> f64 {
    (shape.kv_bytes_per_token * f64::from(context) + shape.kv_fixed_bytes) * KV_Q8_RATIO / GIB
}

/// Memory bandwidth of common GeForce and Radeon cards, GB/s, by a word of their name. The first
/// match in this order wins, so longer names come before the names they contain.
const GPU_BANDWIDTH: &[(&str, f64)] = &[
    ("5090", 1792.0), ("5080", 960.0), ("5070 ti", 896.0), ("5070", 672.0), ("5060 ti", 448.0), ("5060", 448.0),
    ("4090", 1008.0), ("4080", 717.0), ("4070 ti super", 672.0), ("4070 ti", 504.0), ("4070 super", 504.0), ("4070", 504.0),
    ("4060 ti", 288.0), ("4060", 272.0),
    ("3090", 936.0), ("3080 ti", 912.0), ("3080", 760.0), ("3070 ti", 608.0), ("3070", 448.0), ("3060 ti", 448.0), ("3060", 360.0),
    ("2080 ti", 616.0), ("2080", 448.0), ("2070", 448.0), ("2060", 336.0),
    ("1080 ti", 484.0), ("1080", 320.0), ("1070", 256.0), ("1660", 192.0),
    ("a6000", 768.0), ("a5000", 768.0), ("a4000", 448.0), ("l40", 864.0), ("a100", 1555.0), ("h100", 3350.0),
    ("7900 xtx", 960.0), ("7900 xt", 800.0), ("7800 xt", 624.0), ("7700 xt", 432.0), ("6900", 512.0), ("6800", 512.0),
];

/// A card's memory bandwidth from its name; a middling guess when it is not in the table.
pub fn gpu_bandwidth_gbs(name: &str) -> f64 {
    let lower = name.to_ascii_lowercase();
    GPU_BANDWIDTH.iter().find(|(key, _)| lower.contains(key)).map_or(300.0, |(_, speed)| *speed)
}

/// How a model is split between the GPU and RAM at one context size.
struct Split {
    cpu_blocks: u32,
    gpu_layers: u32,
    vram_gb: f64,
    ram_gb: f64,
    /// The part that must sit on the GPU (shared weights and cache for MoE) fits.
    core_fits: bool,
}

fn split(shape: &ModelShape, pc: &Pc, context: u32) -> Split {
    let layers = shape.layers.max(1);
    let file = shape.file_gb;
    let kv = kv_gb(shape, context);
    let has_gpu = pc.vram_gb >= MIN_USEFUL_VRAM_GB;
    let budget = pc.vram_gb - HEADROOM_GB;
    if shape.moe {
        let share = expert_share(shape.total_params_b, shape.active_params_b, true);
        let shared = file * (1.0 - share);
        let experts = file * share;
        let per_block = experts / f64::from(layers);
        let fixed = shared + kv + COMPUTE_GB + shape.projector_gb;
        if !has_gpu {
            return Split { cpu_blocks: layers, gpu_layers: 0, vram_gb: 0.0, ram_gb: file + kv + RAM_OVERHEAD_GB, core_fits: true };
        }
        if fixed > budget {
            return Split { cpu_blocks: layers, gpu_layers: layers, vram_gb: fixed, ram_gb: experts + RAM_OVERHEAD_GB, core_fits: false };
        }
        let on_gpu = (((budget - fixed) / per_block).floor().max(0.0) as u32).min(layers);
        let cpu_blocks = layers - on_gpu;
        Split {
            cpu_blocks,
            gpu_layers: layers,
            vram_gb: fixed + per_block * f64::from(on_gpu),
            ram_gb: per_block * f64::from(cpu_blocks) + RAM_OVERHEAD_GB,
            core_fits: true,
        }
    } else {
        if !has_gpu {
            return Split { cpu_blocks: 0, gpu_layers: 0, vram_gb: 0.0, ram_gb: file + kv + RAM_OVERHEAD_GB, core_fits: true };
        }
        let available = budget - COMPUTE_GB - shape.projector_gb;
        if file + kv <= available {
            return Split { cpu_blocks: 0, gpu_layers: layers, vram_gb: file + kv + COMPUTE_GB + shape.projector_gb, ram_gb: RAM_OVERHEAD_GB, core_fits: true };
        }
        let per_layer = file * 0.92 / f64::from(layers) + kv / f64::from(layers);
        let on_gpu = (((available / per_layer).floor().max(0.0)) as u32).min(layers - 1);
        let cpu_share = 1.0 - f64::from(on_gpu) / f64::from(layers);
        Split {
            cpu_blocks: 0,
            gpu_layers: on_gpu,
            vram_gb: if on_gpu == 0 { 0.0 } else { per_layer * f64::from(on_gpu) + COMPUTE_GB + shape.projector_gb },
            ram_gb: (file + kv) * cpu_share + RAM_OVERHEAD_GB,
            core_fits: true,
        }
    }
}

/// Tokens per second if only memory bandwidth mattered.
fn ideal_speed(shape: &ModelShape, pc: &Pc, split: &Split) -> f64 {
    let layers = f64::from(shape.layers.max(1));
    let has_gpu = pc.vram_gb >= MIN_USEFUL_VRAM_GB;
    let gpu = pc.gpu_bandwidth_gbs.max(1.0);
    let ram = pc.cpu_bandwidth_gbs();
    let seconds = if shape.moe {
        let active = shape.file_gb * (shape.active_params_b / shape.total_params_b.max(0.1)).min(1.0);
        if !has_gpu {
            active / ram
        } else {
            let experts = active * EXPERT_READ_SHARE;
            let always = active - experts;
            let on_cpu = f64::from(split.cpu_blocks) / layers;
            always / gpu + experts * (on_cpu / ram + (1.0 - on_cpu) / gpu)
        }
    } else {
        let on_gpu = if has_gpu { f64::from(split.gpu_layers) / layers } else { 0.0 };
        shape.file_gb * on_gpu / gpu + shape.file_gb * (1.0 - on_gpu) / ram
    };
    1.0 / seconds.max(1e-6)
}

/// The note when a model fits the PC but not the memory limit.
fn limit_note(ram_gb: f64, pc: &Pc) -> String {
    format!(
        "Needs about {:.0} GB of memory; your limit is {:.0} GB ({}%, Settings \u{203a} Performance). Raise the limit or pick a smaller size.",
        ram_gb.ceil(),
        pc.ram_cap_gb.round(),
        pc.ram_percent
    )
}

fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

fn context_label(tokens: u32) -> String {
    if tokens % 1024 == 0 {
        format!("{}K", tokens / 1024)
    } else {
        tokens.to_string()
    }
}

fn words(range: (f64, f64)) -> String {
    let low = (range.0 * 0.75).round().max(1.0) as u32;
    let high = (range.1 * 0.75).round().max(f64::from(low)) as u32;
    if low == high {
        format!("about {low} {} a second", if low == 1 { "word" } else { "words" })
    } else {
        format!("about {low}\u{2013}{high} words a second")
    }
}

/// How one model runs on one PC: the split, the memory it takes, a speed range and a verdict,
/// before anything starts. With `requested_context` None it aims for 32K tokens and halves that
/// (down to 4K) when the part that must sit on the GPU would not fit; an explicit context is kept
/// as asked.
pub fn plan(shape: &ModelShape, pc: &Pc, requested_context: Option<u32>) -> LlmPlan {
    let max_context = shape.context_max.max(MIN_CONTEXT);
    let mut context = requested_context.unwrap_or(DEFAULT_CONTEXT).clamp(2_048, max_context);
    let mut at = split(shape, pc, context);
    let asked = requested_context.is_some();
    while !at.core_fits && !asked && context > MIN_CONTEXT {
        context = (context / 2).max(MIN_CONTEXT);
        at = split(shape, pc, context);
    }
    let shortened = !asked && context < DEFAULT_CONTEXT.min(max_context);
    let ideal = ideal_speed(shape, pc, &at);
    let range = (round1(ideal * SPEED_LOW), round1(ideal * SPEED_HIGH));
    let middle = (range.0 + range.1) / 2.0;
    let has_gpu = pc.vram_gb >= MIN_USEFUL_VRAM_GB;
    let layers = shape.layers.max(1);

    let make = |verdict: Verdict, estimate: Option<(f64, f64)>, note: String| LlmPlan {
        context_tokens: context,
        cpu_moe_blocks: at.cpu_blocks,
        gpu_layers: at.gpu_layers,
        vram_gb: round1(at.vram_gb),
        ram_gb: round1(at.ram_gb),
        est_tokens_per_second: estimate,
        verdict,
        note,
        over_limit: false,
    };

    if !at.core_fits {
        let note = format!(
            "Even with every expert in RAM, this model's shared weights and memory for {} tokens need about {:.1} GB of video memory, and this PC can offer {:.1} GB. Pick a smaller version or a shorter context.",
            context_label(context),
            at.vram_gb + HEADROOM_GB,
            pc.vram_gb
        );
        return make(Verdict::No, None, note);
    }
    if at.ram_gb > pc.ram_gb {
        let note = format!(
            "It needs about {:.0} GB of system memory and this PC has {:.0} GB. Pick a smaller version.",
            at.ram_gb.ceil(),
            pc.ram_gb.round()
        );
        return make(Verdict::No, None, note);
    }
    if at.ram_gb > pc.ram_cap_gb {
        let mut over = make(Verdict::No, None, limit_note(at.ram_gb, pc));
        over.over_limit = true;
        return over;
    }
    if middle < 1.5 {
        let note = format!("It would manage {}, which is too slow to be useful. Pick a smaller version.", words(range));
        return make(Verdict::No, Some(range), note);
    }
    let verdict = if middle >= 20.0 {
        Verdict::Great
    } else if middle >= 8.0 {
        Verdict::Ok
    } else {
        Verdict::Slow
    };
    let how = if shape.moe {
        if !has_gpu {
            "No graphics card was found, so it runs on the processor".to_owned()
        } else if at.cpu_blocks == 0 {
            "Everything fits on the graphics card".to_owned()
        } else if at.cpu_blocks >= layers {
            "All the experts stay in RAM; the graphics card holds the shared part".to_owned()
        } else {
            format!("Experts of {} of {} blocks stay in RAM", at.cpu_blocks, layers)
        }
    } else if !has_gpu {
        "No graphics card was found, so it runs on the processor".to_owned()
    } else if at.gpu_layers >= layers {
        "The whole model fits on the graphics card".to_owned()
    } else if at.gpu_layers == 0 {
        "None of its layers fit the graphics card, so it runs on the processor".to_owned()
    } else {
        format!("{} of {} layers run on the graphics card, the rest on the processor", at.gpu_layers, layers)
    };
    let mut note = format!("{how}; {} expected.", words(range));
    if shortened {
        note.push_str(&format!(" The context is shortened to {} tokens to fit.", context_label(context)));
    }
    make(verdict, Some(range), note)
}

/// The plan for a model nobody hand-tuned (anything added from Hugging Face): llama.cpp's own memory
/// fitting (`--fit on`) decides the split when it starts, so this only estimates what it will do from
/// the file size against this PC's video memory and RAM. It treats the model as dense, which is the
/// slow case, so a mixture-of-experts model usually does better than said here.
pub fn fit_plan(file_gb: f64, projector_gb: f64, pc: &Pc, requested_context: Option<u32>) -> LlmPlan {
    let mut context = requested_context.unwrap_or(DEFAULT_CONTEXT).clamp(2_048, 1_048_576);
    let mut plan = fit_plan_at(file_gb, projector_gb, pc, context);
    // Aims for 32K and halves (to 8K) only when the memory does not hold it; an explicit choice is kept.
    while requested_context.is_none() && plan.ram_gb > pc.ram_cap_gb.min(pc.ram_gb) && context > FIT_FLOOR_CONTEXT {
        context /= 2;
        plan = fit_plan_at(file_gb, projector_gb, pc, context);
    }
    if requested_context.is_none() && context < DEFAULT_CONTEXT && plan.verdict != Verdict::No {
        plan.note.push_str(&format!(" The context is shortened to {} tokens to fit.", context_label(context)));
    }
    plan
}

/// The smallest context [`fit_plan`] halves the default down to.
const FIT_FLOOR_CONTEXT: u32 = 8_192;

fn fit_plan_at(file_gb: f64, projector_gb: f64, pc: &Pc, context: u32) -> LlmPlan {
    // A rough cache size for a mid-sized model with grouped attention and an 8-bit cache.
    let kv = file_gb * 0.04 * f64::from(context) / 8_192.0;
    let has_gpu = pc.vram_gb >= MIN_USEFUL_VRAM_GB;
    let budget = (pc.vram_gb - HEADROOM_GB - COMPUTE_GB - projector_gb).max(0.0);
    let gpu_share = if has_gpu { ((budget - kv.min(budget)) / file_gb.max(0.1)).clamp(0.0, 1.0) } else { 0.0 };
    let on_gpu_gb = file_gb * gpu_share;
    let vram_gb = if has_gpu { (on_gpu_gb + kv.min(budget) + COMPUTE_GB + projector_gb).min(pc.vram_gb - HEADROOM_GB).max(0.0) } else { 0.0 };
    let ram_gb = file_gb * (1.0 - gpu_share) + if has_gpu { (kv - kv.min(budget)).max(0.0) } else { kv + projector_gb } + RAM_OVERHEAD_GB;
    let gpu = pc.gpu_bandwidth_gbs.max(1.0);
    let ram = pc.cpu_bandwidth_gbs();
    let seconds = on_gpu_gb / gpu + (file_gb - on_gpu_gb) / ram;
    let ideal = 1.0 / seconds.max(1e-6);
    let range = (round1(ideal * SPEED_LOW), round1(ideal * SPEED_HIGH));
    let middle = (range.0 + range.1) / 2.0;
    let make = |verdict: Verdict, estimate: Option<(f64, f64)>, note: String| LlmPlan {
        context_tokens: context,
        cpu_moe_blocks: 0,
        gpu_layers: if has_gpu { 999 } else { 0 },
        vram_gb: round1(vram_gb),
        ram_gb: round1(ram_gb),
        est_tokens_per_second: estimate,
        verdict,
        note,
        over_limit: false,
    };
    if ram_gb > pc.ram_gb {
        let note = format!("It needs about {:.0} GB between the graphics card and system memory, and this PC has {:.0} GB of RAM. Pick a smaller version.", (ram_gb + vram_gb).ceil(), pc.ram_gb.round());
        return make(Verdict::No, None, note);
    }
    if ram_gb > pc.ram_cap_gb {
        let mut over = make(Verdict::No, None, limit_note(ram_gb, pc));
        over.over_limit = true;
        return over;
    }
    let verdict = if middle >= 20.0 {
        Verdict::Great
    } else if middle >= 8.0 {
        Verdict::Ok
    } else {
        Verdict::Slow
    };
    let where_it_goes = if !has_gpu {
        format!("No graphics card was found, so it would run on the processor in about {:.0} GB of RAM", ram_gb.ceil())
    } else if gpu_share >= 0.99 {
        format!("It should fit the graphics card, about {:.1} GB of video memory", vram_gb)
    } else {
        format!("About {:.1} GB on the graphics card and {:.0} GB in RAM", vram_gb, ram_gb.ceil())
    };
    let note = format!("llama.cpp fits it to this PC when it starts. {where_it_goes}; {} expected, at least (a mixture-of-experts model is faster).", words(range));
    make(verdict, Some(range), note)
}

/// Bytes of f16 KV cache per token (and the fixed part, for sliding-window layers) for a catalog
/// model, from its configuration: K and V for every full-attention layer (a quarter of the layers
/// in Qwen3.5's hybrid design, 12 of 24 in gpt-oss, 5 of 30 in Gemma 4, a compressed 1088 values
/// per layer in GLM's latent attention). Models outside this table get a generous guess from the
/// layer count.
pub fn kv_profile(model_id: &str, layers: u32) -> (f64, f64) {
    match model_id {
        "qwen3.5-4b" | "qwen3.5-9b" => (32_768.0, 0.0),
        "gpt-oss-20b" => (24_576.0, 10_000_000.0),
        "gpt-oss-120b" => (36_864.0, 20_000_000.0),
        "gemma-4-26b-a4b" => (20_480.0, 250_000_000.0),
        "glm-4.7-flash" => (102_400.0, 0.0),
        "qwen3.5-35b-a3b" => (20_480.0, 100_000_000.0),
        "qwen3-coder-next" | "qwen3.5-122b-a10b" => (24_576.0, 100_000_000.0),
        // Full-attention layers only: 16 of 64 in Qwen3.8 27B (4 KV heads of 256), 10 of 40 in Qwen3.6 35B A3B.
        "qwen3.8-27b" => (65_536.0, 120_000_000.0),
        "qwen3.6-35b-a3b" => (20_480.0, 100_000_000.0),
        // Gemma 4 12B and 31B: a few global layers (one or four KV heads of 512) plus 40 or 50 sliding-window layers of 1024 tokens.
        "gemma-4-12b" => (16_384.0, 350_000_000.0),
        "gemma-4-31b" => (81_920.0, 850_000_000.0),
        // Nemotron 3 Nano Omni: 6 attention blocks (2 KV heads of 128) among 52 mostly Mamba and expert blocks.
        "nemotron-3-nano-omni" => (6_144.0, 80_000_000.0),
        _ => (f64::from(layers) * 4_096.0, 0.0),
    }
}

// ---------------------------------------------------------------------------------------------
// The catalog entries this module needs (llm.json, shared with the Model Library)
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Debug, Deserialize)]
struct CatalogFile {
    dest: String,
    bytes: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogShape {
    total_params_b: f64,
    active_params_b: f64,
    moe: bool,
    layers: u32,
    context_max: u32,
    #[allow(dead_code)]
    quant: String,
    /// "mtp": the file carries the model's own multi-token-prediction head (llama.cpp `--spec-type draft-mtp`).
    #[serde(default)]
    speculative: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogVariant {
    id: String,
    #[serde(default)]
    default: bool,
    files: Vec<CatalogFile>,
    llm: Option<CatalogShape>,
}

/// An optional extra download of a model (the EAGLE3 helper of gpt-oss 120B).
#[derive(Clone, Debug, Deserialize)]
struct CatalogAddon {
    id: String,
    files: Vec<CatalogFile>,
}

#[derive(Clone, Debug, Deserialize)]
struct CatalogEntry {
    id: String,
    name: String,
    #[serde(default)]
    addons: Vec<CatalogAddon>,
    /// Other engines' models (Strata) share llm.json; only llama.cpp's are this module's.
    #[serde(default)]
    runtime: Option<String>,
    variants: Vec<CatalogVariant>,
}

fn catalog() -> &'static [CatalogEntry] {
    static ENTRIES: OnceLock<Vec<CatalogEntry>> = OnceLock::new();
    ENTRIES.get_or_init(|| serde_json::from_str::<Vec<CatalogEntry>>(CATALOG_JSON).unwrap_or_default().into_iter().filter(|entry| entry.runtime.as_deref().map_or(true, |runtime| runtime == "llama-cpp")).collect())
}

/// The picture reader of a vision model is its own GGUF, named `mmproj-…` by every publisher.
fn is_projector(dest: &str) -> bool {
    Path::new(dest).file_name().and_then(|name| name.to_str()).is_some_and(|name| name.to_ascii_lowercase().starts_with("mmproj"))
}

/// The weights (every part of the model's own GGUF) and the picture reader, in GiB.
fn weight_sizes(variant: &CatalogVariant) -> (f64, f64) {
    let weights: u64 = variant.files.iter().filter(|file| !is_projector(&file.dest)).map(|file| file.bytes).sum();
    let projector: u64 = variant.files.iter().filter(|file| is_projector(&file.dest)).map(|file| file.bytes).sum();
    (weights as f64 / GIB, projector as f64 / GIB)
}

fn shape_of(entry: &CatalogEntry, variant: &CatalogVariant) -> Option<ModelShape> {
    let llm = variant.llm.as_ref()?;
    let (kv_bytes_per_token, kv_fixed_bytes) = kv_profile(&entry.id, llm.layers);
    let (file_gb, projector_gb) = weight_sizes(variant);
    Some(ModelShape {
        total_params_b: llm.total_params_b,
        active_params_b: llm.active_params_b,
        moe: llm.moe,
        layers: llm.layers,
        context_max: llm.context_max,
        file_gb,
        kv_bytes_per_token,
        kv_fixed_bytes,
        projector_gb,
    })
}

/// Models the user added from Hugging Face (written by `llm_hub.rs`). They are never hand-tuned, so
/// they start with llama.cpp's own memory fitting. An entry that does not read is skipped.
fn hub_entries(models: &Path) -> Vec<CatalogEntry> {
    let text = std::fs::read_to_string(models.join("library").join("hub-models.json")).unwrap_or_default();
    let Ok(items) = serde_json::from_str::<Vec<serde_json::Value>>(&text) else { return Vec::new() };
    items.into_iter().filter_map(|item| serde_json::from_value::<CatalogEntry>(item).ok()).collect()
}

/// A model of Bhippi's own picks, or one added from Hugging Face.
fn find_entry(models: &Path, id: &str) -> Option<CatalogEntry> {
    catalog().iter().find(|entry| entry.id == id).cloned().or_else(|| hub_entries(models).into_iter().find(|entry| entry.id == id))
}

/// Curated entries with a measured shape keep their tuned split; everything else (anything from
/// Hugging Face, or a pick without a shape) is left to llama.cpp's `--fit`.
fn is_tuned(entry: &CatalogEntry, variant: &CatalogVariant) -> bool {
    !entry.id.starts_with("hf:") && catalog().iter().any(|known| known.id == entry.id) && variant.llm.is_some()
}

/// How a model is started: with Bhippi's computed split, or with llama.cpp's automatic fitting.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tuning {
    /// `-ngl` and `--n-cpu-moe` from the plan; `moe` says whether the model is a mixture of experts.
    Planned { moe: bool },
    /// `--fit on`: llama.cpp decides the split from the memory it finds.
    Fitted,
}

/// The variant of a model that is on disk and the storage folder that holds it, from the Model
/// Library's `state.json` (`installedVariant`, `folder`, `storageDir`). The file is another
/// module's, so it is read loosely: models may sit under a `models` key or at the top, and when
/// no variant is recorded the first one whose files are all present wins.
fn installed_variant<'a>(models: &Path, entry: &'a CatalogEntry) -> Option<(&'a CatalogVariant, PathBuf)> {
    let library = models.join("library");
    let state: serde_json::Value = std::fs::read_to_string(library.join("state.json")).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or(serde_json::Value::Null);
    let record = state.get("models").and_then(|all| all.get(&entry.id)).or_else(|| state.get(&entry.id));
    let folder = record
        .and_then(|record| record.get("folder"))
        .and_then(|value| value.as_str())
        .or_else(|| state.get("storageDir").and_then(|value| value.as_str()))
        .map_or_else(|| library.clone(), PathBuf::from);
    let complete = |variant: &CatalogVariant, root: &Path| variant.files.iter().all(|file| std::fs::metadata(root.join(&file.dest)).is_ok_and(|meta| meta.len() == file.bytes));
    if let Some(wanted) = record.and_then(|record| record.get("installedVariant")).and_then(|value| value.as_str()) {
        if let Some(variant) = entry.variants.iter().find(|variant| variant.id == wanted) {
            return Some((variant, folder));
        }
    }
    for root in [folder.clone(), library] {
        if let Some(variant) = entry.variants.iter().find(|variant| complete(variant, &root)) {
            return Some((variant, root));
        }
    }
    None
}

// ---------------------------------------------------------------------------------------------
// This PC
// ---------------------------------------------------------------------------------------------

pub(crate) struct Machine {
    pub(crate) gpu_name: Option<String>,
    pub(crate) vram_total_gb: f64,
    pub(crate) vram_free_gb: f64,
    pub(crate) ram_gb: f64,
}

#[cfg(windows)]
fn hide(command: &mut tokio::process::Command) {
    command.creation_flags(0x0800_0000);
}
#[cfg(not(windows))]
fn hide(_command: &mut tokio::process::Command) {}

/// `nvidia-smi`'s first line: name, total and free memory in MiB.
fn parse_nvidia_memory(text: &str) -> Option<(String, f64, f64)> {
    let line = text.lines().map(str::trim).find(|line| !line.is_empty())?;
    let mut fields = line.rsplitn(3, ',').map(str::trim);
    let free = fields.next()?.parse::<f64>().ok()?;
    let total = fields.next()?.parse::<f64>().ok()?;
    let name = fields.next()?.to_owned();
    Some((name, total / 1024.0, free / 1024.0))
}

pub(crate) async fn read_machine(state: &AppState) -> Machine {
    let mut command = tokio::process::Command::new("nvidia-smi");
    command.args(["--query-gpu=name,memory.total,memory.free", "--format=csv,noheader,nounits"]).kill_on_drop(true);
    hide(&mut command);
    let smi = tokio::time::timeout(Duration::from_secs(8), command.output())
        .await
        .ok()
        .and_then(Result::ok)
        .filter(|out| out.status.success())
        .and_then(|out| parse_nvidia_memory(&String::from_utf8_lossy(&out.stdout)));
    let info = crate::hardware::inspect(&state.paths.models).await;
    let ram_gb = info["ramGb"].as_f64().filter(|ram| *ram > 0.0).unwrap_or(16.0);
    // Without NVIDIA's tool, the largest adapter the driver reports (integrated ones show a few hundred MB).
    let adapter = info["adapters"].as_array().and_then(|list| {
        list.iter()
            .filter_map(|adapter| Some((adapter["name"].as_str()?.to_owned(), adapter["vramMb"].as_f64()? / 1024.0)))
            .max_by(|a, b| a.1.total_cmp(&b.1))
    });
    match (smi, adapter) {
        (Some((name, total, free)), _) => Machine { gpu_name: Some(name), vram_total_gb: total, vram_free_gb: free, ram_gb },
        (None, Some((name, total))) => Machine { gpu_name: Some(name), vram_total_gb: total, vram_free_gb: total, ram_gb },
        (None, None) => Machine { gpu_name: None, vram_total_gb: 0.0, vram_free_gb: 0.0, ram_gb },
    }
}

/// The plan's view of this PC. When Bhippi's own server is running it holds video memory itself,
/// so the free reading is replaced by the card's total less what Windows keeps.
fn pc_from(machine: &Machine, own_server_running: bool) -> Pc {
    let limits = crate::resources::current();
    let usable = if own_server_running { (machine.vram_total_gb - 0.8).max(0.0) } else { machine.vram_free_gb.min(machine.vram_total_gb - 0.3).max(0.0) };
    Pc {
        vram_gb: usable,
        gpu_bandwidth_gbs: machine.gpu_name.as_deref().map_or(300.0, gpu_bandwidth_gbs),
        ram_gb: machine.ram_gb,
        ram_bandwidth_gbs: RAM_BANDWIDTH_GBS,
        ram_cap_gb: machine.ram_gb * f64::from(limits.ram_percent) / 100.0,
        ram_percent: limits.ram_percent,
        cpu_threads: limits.threads(),
    }
}

// ---------------------------------------------------------------------------------------------
// The runtime install
// ---------------------------------------------------------------------------------------------

fn runtime_dir(models: &Path) -> PathBuf {
    models.join("runtime").join("llama")
}

fn server_exe(models: &Path) -> PathBuf {
    runtime_dir(models).join(if cfg!(windows) { "llama-server.exe" } else { "llama-server" })
}

#[derive(Serialize, Deserialize, Default)]
struct VersionMarker {
    tag: String,
    cuda: bool,
}

fn marker_file(models: &Path) -> PathBuf {
    runtime_dir(models).join("version.json")
}

/// The installed runtime's marker, when its server program is there too.
fn installed_marker(models: &Path) -> Option<VersionMarker> {
    if !server_exe(models).is_file() {
        return None;
    }
    let marker: VersionMarker = serde_json::from_str(&std::fs::read_to_string(marker_file(models)).ok()?).ok()?;
    (!marker.tag.is_empty()).then_some(marker)
}

/// Where the installed runtime stands against the pinned release.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RuntimeState {
    /// Nothing usable is installed.
    Missing,
    /// The pinned build for this PC's graphics card (or lack of one).
    Current,
    /// An older build, or one for the other kind of PC: installing again replaces it.
    Outdated,
}

fn runtime_state(marker: Option<&VersionMarker>, cuda: bool) -> RuntimeState {
    match marker {
        None => RuntimeState::Missing,
        Some(marker) if marker.tag == LLAMA_TAG && marker.cuda == cuda => RuntimeState::Current,
        Some(_) => RuntimeState::Outdated,
    }
}

fn has_nvidia() -> bool {
    let mut command = std::process::Command::new("nvidia-smi");
    command.arg("-L");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command.output().is_ok_and(|out| out.status.success() && String::from_utf8_lossy(&out.stdout).contains("GPU"))
}

fn sha256_of(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut file = std::fs::File::open(path).map_err(|error| format!("cannot read {}: {error}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1 << 20];
    loop {
        let read = file.read(&mut buffer).map_err(|error| format!("cannot read {}: {error}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect())
}

async fn install(state: &Arc<AppState>, job: &JobHandle) -> Result<String, String> {
    if !cfg!(windows) {
        return Err("The managed llama.cpp runtime is Windows-only for now.".into());
    }
    let models = state.paths.models.clone();
    let cuda = has_nvidia();
    if runtime_state(installed_marker(&models).as_ref(), cuda) == RuntimeState::Current {
        return Ok(format!("llama.cpp {LLAMA_TAG} was already installed{}", if cuda { " (NVIDIA build)" } else { " (CPU build)" }));
    }
    if SERVER.lock().is_ok_and(|server| server.is_some()) {
        return Err("A local model is running. Stop it before updating the runtime.".into());
    }
    let dir = runtime_dir(&models);
    let _ignored = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|error| format!("cannot create {}: {error}", dir.display()))?;
    let list = packs(cuda);
    let total: u64 = list.iter().map(|pack| pack.bytes).sum();
    let mut done = 0_u64;
    for pack in list {
        let file_name = pack.name.replace("{tag}", LLAMA_TAG);
        let archive = dir.join(&file_name);
        let base = 0.9 * done as f64 / total as f64;
        let span = 0.9 * pack.bytes as f64 / total as f64;
        let label = if file_name.starts_with("cudart") { "NVIDIA CUDA libraries".to_owned() } else if cuda { "llama.cpp (NVIDIA build)".to_owned() } else { "llama.cpp (CPU build)".to_owned() };
        job.progress(base, format!("Downloading {label}"));
        models::fetch(&pack_url(pack), &archive, job, base, span * 0.9, &label).await?;
        job.progress(base + span * 0.9, format!("Checking {label}"));
        let path = archive.clone();
        let digest = tokio::task::spawn_blocking(move || sha256_of(&path)).await.map_err(|error| error.to_string())??;
        if digest != pack.sha256 {
            let _ignored = std::fs::remove_file(&archive);
            return Err(format!("The {label} download did not match its published checksum. Try again."));
        }
        job.progress(base + span * 0.95, format!("Unpacking {label}"));
        models::unpack(&archive, &dir).await?;
        let _ignored = std::fs::remove_file(&archive);
        done += pack.bytes;
    }
    if !server_exe(&models).is_file() {
        return Err("The llama.cpp download unpacked, but llama-server.exe is missing from it.".into());
    }
    crate::store::write_json(&marker_file(&models), &VersionMarker { tag: LLAMA_TAG.to_owned(), cuda })?;
    Ok(format!("llama.cpp {LLAMA_TAG} is ready{}", if cuda { " for your NVIDIA GPU" } else { " (CPU build)" }))
}

/// Installs the llama.cpp runtime as a background job; answers the job id.
#[tauri::command]
pub(crate) async fn llm_runtime_install(app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
    if !cfg!(windows) {
        return Err("The managed llama.cpp runtime is Windows-only for now.".into());
    }
    if state.jobs.list().iter().any(|job| job.kind == "install" && job.label.contains("llama.cpp") && job.status == crate::jobs::JobStatus::Running) {
        return Err("llama.cpp is already installing; follow it in the jobs list.".into());
    }
    let job = state.jobs.start("install", "Installing llama.cpp (local language models)", true);
    let id = job.id().to_owned();
    let shared = state.inner().clone();
    tauri::async_runtime::spawn(async move {
        match install(&shared, &job).await {
            Ok(summary) => {
                let _ignored = app.emit(LIBRARY_EVENT, serde_json::json!({ "id": null, "reason": "llm-runtime" }));
                job.done(summary, None);
            }
            Err(error) => job.fail(error),
        }
    });
    Ok(serde_json::json!({ "jobId": id }))
}

// ---------------------------------------------------------------------------------------------
// The running server
// ---------------------------------------------------------------------------------------------

struct Server {
    child: std::process::Child,
    running: LlmRunning,
    /// The address the user had typed for the llama.cpp provider before this server took it over.
    previous_endpoint: Option<String>,
}

static SERVER: Mutex<Option<Server>> = Mutex::new(None);

fn running_now() -> Option<LlmRunning> {
    SERVER.lock().ok().and_then(|server| server.as_ref().map(|server| server.running.clone()))
}

/// Kills the server Bhippi started, if any. Safe to call from anywhere, including on the way out of
/// the app (add it next to `comfy::shutdown()` there).
pub(crate) fn shutdown() {
    let taken = SERVER.lock().ok().and_then(|mut server| server.take());
    if let Some(mut server) = taken {
        let _ignored = server.child.kill();
        let _ignored = server.child.wait();
    }
}

fn free_port() -> Result<u16, String> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).map_err(|error| format!("could not open a local port: {error}"))?;
    listener.local_addr().map(|address| address.port()).map_err(|error| error.to_string())
}

/// The arguments for `llama-server`. All layers go to the GPU (`-ngl 999`); for a mixture-of-experts
/// model the experts of the first `cpu_moe_blocks` blocks are kept in RAM (`--n-cpu-moe`), for a
/// dense one only `gpu_layers` go. Flash attention and an 8-bit cache keep memory small, `--jinja`
/// turns on the model's own chat template (tool calls), `--fit off` stops llama.cpp from second-guessing
/// the plan, and the web page is switched off. With `Tuning::Fitted` there is no `-ngl` or
/// `--n-cpu-moe` and `--fit on` lets llama.cpp split the model itself (the context stays as asked).
/// A vision model's picture reader goes in with `--mmproj`.
#[cfg_attr(not(test), allow(dead_code))]
pub fn server_args(model: &Path, alias: &str, plan: &LlmPlan, tuning: Tuning, mmproj: Option<&Path>, port: u16) -> Vec<String> {
    server_args_with(model, alias, plan, tuning, mmproj, port, &Speedups::default())
}

/// Smallest prompt chunk (tokens) llama.cpp may reuse from its cache by shifting, so a changed
/// conversation start does not re-read everything. Models that cannot shift their memory (hybrid and
/// picture models) are told this too and llama.cpp switches it off for them with a warning.
const CACHE_REUSE_TOKENS: u32 = 256;
/// The server's own cache of earlier prompts held in RAM, in MiB. llama.cpp's default of 8 GB would
/// eat into the memory the big models need.
const PROMPT_CACHE_RAM_MIB: u32 = 1024;
/// First build with the MoE expert cache (`--moe-cache-mib`), MTP and EAGLE3 speculation.
const FIRST_SPEEDUP_BUILD: u32 = 11_700;

/// The number in a tag such as `b11703`.
fn build_number(tag: &str) -> Option<u32> {
    tag.strip_prefix('b')?.parse().ok()
}

/// Whether this installed build knows the expert cache and speculative flags. A build too old
/// for them is started without those flags rather than failing.
fn supports_speedups(tag: &str) -> bool {
    build_number(tag).is_some_and(|build| build >= FIRST_SPEEDUP_BUILD)
}

/// How a model is drafted ahead (speculative decoding). The draft is checked by the real model, so
/// the words are the same; only the speed changes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Speculation {
    /// The model's own multi-token-prediction head, inside its GGUF.
    Mtp,
    /// A small EAGLE3 helper file that drafts for the model.
    Eagle3 { draft: PathBuf },
}

impl Speculation {
    /// The short name stored and shown ("mtp", "eagle3").
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Mtp => "mtp",
            Self::Eagle3 { .. } => "eagle3",
        }
    }
}

/// What a start adds on top of the plan: the tuned values, the expert cache and speculation.
/// `Default` is the plan alone.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Speedups {
    /// Blocks whose experts stay in RAM, when tuning moved it from the plan's number.
    pub cpu_moe_blocks: Option<u32>,
    /// GPU cache for experts that live in RAM, in MiB (`--moe-cache-mib`); 0 = off.
    pub moe_cache_mib: u32,
    /// Physical batch size (`-ub`); 0 = llama.cpp's default.
    pub ubatch: u32,
    pub speculative: Option<Speculation>,
}

/// `server_args` with tuned values, the expert cache and speculation. Whatever the speed-ups, the
/// server runs one slot (`--parallel 1`: the whole context for one conversation, and the only mode
/// MTP supports), reuses cached prompt chunks (`--cache-reuse`) and serves `/metrics`, which Bhippi
/// reads for the live speeds.
pub fn server_args_with(model: &Path, alias: &str, plan: &LlmPlan, tuning: Tuning, mmproj: Option<&Path>, port: u16, speed: &Speedups) -> Vec<String> {
    let mut args: Vec<String> = vec!["-m".into(), model.display().to_string(), "--alias".into(), alias.to_owned(), "-c".into(), plan.context_tokens.to_string()];
    if let Some(projector) = mmproj {
        args.extend(["--mmproj".into(), projector.display().to_string()]);
    }
    let fit = match tuning {
        Tuning::Fitted => "on",
        Tuning::Planned { moe } => {
            if plan.gpu_layers == 0 {
                args.extend(["-ngl".into(), "0".into()]);
            } else if moe || plan.est_tokens_per_second.is_none() {
                args.extend(["-ngl".into(), "999".into()]);
            } else {
                args.extend(["-ngl".into(), plan.gpu_layers.to_string()]);
            }
            let blocks = speed.cpu_moe_blocks.unwrap_or(plan.cpu_moe_blocks);
            if moe && blocks > 0 {
                args.extend(["--n-cpu-moe".into(), blocks.to_string()]);
                if speed.moe_cache_mib > 0 {
                    args.extend(["--moe-cache-mib".into(), speed.moe_cache_mib.to_string()]);
                }
            }
            "off"
        }
    };
    if speed.ubatch > 0 {
        args.extend(["-ub".into(), speed.ubatch.to_string()]);
    }
    for flag in ["-fa", "on", "--cache-type-k", "q8_0", "--cache-type-v", "q8_0", "--fit", fit, "--jinja", "--no-webui", "--host", "127.0.0.1"] {
        args.push(flag.to_owned());
    }
    args.extend(["--parallel".into(), "1".into(), "--cache-reuse".into(), CACHE_REUSE_TOKENS.to_string(), "--cache-ram".into(), PROMPT_CACHE_RAM_MIB.to_string(), "--metrics".into()]);
    match &speed.speculative {
        Some(Speculation::Mtp) => args.extend(["--spec-type".into(), "draft-mtp".into()]),
        Some(Speculation::Eagle3 { draft }) => args.extend(["--spec-type".into(), "draft-eagle3".into(), "-md".into(), draft.display().to_string(), "--spec-draft-ngl".into(), "999".into()]),
        None => {}
    }
    args.extend(["--port".into(), port.to_string()]);
    args
}

/// Which speed-ups an argument list switches on, in the words the screen uses.
pub fn speedups_in(args: &[String]) -> Vec<&'static str> {
    let has = |flag: &str| args.iter().any(|arg| arg == flag);
    let value_of = |flag: &str| args.iter().position(|arg| arg == flag).and_then(|at| args.get(at + 1)).map(String::as_str);
    let mut on = Vec::new();
    if value_of("--moe-cache-mib").and_then(|value| value.parse::<u32>().ok()).is_some_and(|mib| mib > 0) {
        on.push("Expert cache");
    }
    match value_of("--spec-type") {
        Some("draft-mtp") => on.push("MTP"),
        Some("draft-eagle3") => on.push("EAGLE3 helper"),
        _ => {}
    }
    if has("--cache-reuse") {
        on.push("Prompt cache");
    }
    on
}

/// A short, plain description of the split for the screen.
fn split_note(plan: &LlmPlan, moe: bool, layers: u32) -> String {
    if moe && plan.cpu_moe_blocks > 0 {
        format!("Shared weights on the GPU; experts of {} of {} blocks in RAM", plan.cpu_moe_blocks, layers)
    } else if plan.gpu_layers >= layers {
        "All of it on the GPU".to_owned()
    } else if plan.gpu_layers == 0 {
        "All of it on the processor".to_owned()
    } else {
        format!("{} of {} layers on the GPU", plan.gpu_layers, layers)
    }
}

/// The last lines of the server's log, and what they usually mean.
fn explain_failure(log: &Path) -> String {
    let text = std::fs::read_to_string(log).unwrap_or_default();
    let lower = text.to_ascii_lowercase();
    if lower.contains("out of memory") || lower.contains("cudamalloc failed") || lower.contains("failed to allocate") {
        return "The graphics card or memory ran out while loading. Close other programs that use the GPU, or pick a shorter context or a smaller version.".to_owned();
    }
    if lower.contains("invalid argument") || lower.contains("unknown argument") || lower.contains("unrecognized option") {
        return "This llama.cpp is too old for one of the speed-up settings. Update the runtime (Settings, Model Library) and try again.".to_owned();
    }
    if lower.contains("unknown model architecture") {
        return "This model is newer than the llama.cpp runtime Bhippi installed. Update the runtime and try again.".to_owned();
    }
    let tail: Vec<&str> = text.lines().rev().filter(|line| !line.trim().is_empty()).take(4).collect();
    if tail.is_empty() {
        "The model server stopped while loading, without saying why.".to_owned()
    } else {
        format!("The model server stopped while loading: {}", tail.into_iter().rev().collect::<Vec<_>>().join(" | "))
    }
}

/// Sets (or, with None, restores) the address of the llama.cpp provider and re-detects providers,
/// so the running server shows up as a ready chat provider with its model name. Answers what the
/// user had typed before.
pub(crate) async fn point_provider(app: &AppHandle, state: &Arc<AppState>, url: Option<String>, restore: Option<Option<String>>) -> Result<Option<String>, String> {
    let mut previous = None;
    let saved = state.update_settings(|settings| {
        previous = settings.local_endpoints.get(PROVIDER_ID).cloned();
        let target = match (&url, &restore) {
            (Some(url), _) => Some(url.clone()),
            (None, Some(old)) => old.clone(),
            (None, None) => None,
        };
        match target {
            Some(target) => {
                settings.local_endpoints.insert(PROVIDER_ID.to_owned(), target);
            }
            None => {
                settings.local_endpoints.remove(PROVIDER_ID);
            }
        }
    })?;
    let _ignored = app.emit(crate::SETTINGS_EVENT, &saved);
    crate::detect_providers(app, state).await;
    Ok(previous)
}

/// Stops the server (if one runs), gives the provider address back and tells the screen.
async fn stop_server(app: &AppHandle, state: &Arc<AppState>, reason: &str) {
    let taken = SERVER.lock().ok().and_then(|mut server| server.take());
    let Some(mut server) = taken else { return };
    let _ignored = server.child.kill();
    let _ignored = server.child.wait();
    let _ignored = point_provider(app, state, None, Some(server.previous_endpoint.clone())).await;
    let _ignored = app.emit(LIBRARY_EVENT, serde_json::json!({ "id": server.running.model_id, "reason": reason }));
}

/// Stops the llama.cpp server, if one runs (another engine is about to take over the one model slot).
pub(crate) async fn stop_llama(app: &AppHandle, state: &Arc<AppState>, reason: &str) {
    stop_server(app, state, reason).await;
}

/// Watches the server: if it dies by itself (a crash, the user ending the task), the provider
/// address is given back and the screen told.
fn watch(app: AppHandle, state: Arc<AppState>, port: u16) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(3)).await;
            let exited = {
                let Ok(mut guard) = SERVER.lock() else { return };
                match guard.as_mut() {
                    Some(server) if server.running.port == port => server.child.try_wait().ok().flatten().is_some(),
                    _ => return,
                }
            };
            if exited {
                stop_server(&app, &state, "llm-stopped-unexpectedly").await;
                return;
            }
        }
    });
}

async fn health_ok(client: &reqwest::Client, port: u16) -> bool {
    client.get(format!("http://127.0.0.1:{port}/health")).timeout(Duration::from_secs(3)).send().await.is_ok_and(|response| response.status().is_success())
}

/// One completion on llama.cpp's own `/completion` endpoint, timed by the server: reading speed from
/// the prompt, writing speed from the answer. Nothing is kept in the prompt cache (`cache_prompt`
/// is off) so reading speed is real every time. None when the server does not answer or reports nothing.
async fn measure_completion(client: &reqwest::Client, port: u16, prompt: &str, n_predict: u32, timeout_secs: u64) -> Option<tune::Timing> {
    let started = Instant::now();
    let body = serde_json::json!({ "prompt": prompt, "n_predict": n_predict, "temperature": 0, "cache_prompt": false, "stream": false });
    let value: serde_json::Value = client
        .post(format!("http://127.0.0.1:{port}/completion"))
        .json(&body)
        .timeout(Duration::from_secs(timeout_secs))
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    tune::timing_of_response(&value, started.elapsed().as_secs_f64())
}

/// The same check through the OpenAI-style chat endpoint, for servers that have no `/completion`
/// (Strata). `model` is the name the server knows; speeds come from its `timings` when it reports
/// them, else from the clock (writing only).
pub(crate) async fn measure_chat(client: &reqwest::Client, port: u16, model: &str) -> Option<(Option<f64>, Option<f64>)> {
    let started = Instant::now();
    let body = serde_json::json!({
        "model": model,
        "messages": [{ "role": "user", "content": "Count from 1 to 40, one number per line." }],
        "max_tokens": 48,
        "temperature": 0,
        "stream": false,
    });
    let value: serde_json::Value = client
        .post(format!("http://127.0.0.1:{port}/v1/chat/completions"))
        .json(&body)
        .timeout(Duration::from_secs(180))
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    let timing = tune::timing_of_response(&value, started.elapsed().as_secs_f64())?;
    Some((timing.prefill.map(round1), timing.decode.map(round1)))
}

/// The start-up check: reading and writing speed from one completion over a short passage.
async fn measure_start(client: &reqwest::Client, port: u16) -> (Option<f64>, Option<f64>) {
    match measure_completion(client, port, tune::MEASURE_PROMPT, 48, 300).await {
        Some(timing) => (timing.prefill.map(round1), timing.decode.map(round1)),
        None => (None, None),
    }
}

/// Starts `llama-server` with `args`, logging to `log_name` in the runtime folder, and waits until it
/// answers its health check. Loading reads the whole file from disk: minutes for the big ones. On any
/// failure the process is gone and the error says what happened.
#[allow(clippy::too_many_arguments)]
async fn spawn_and_wait(models: &Path, args: &[String], job: &JobHandle, label: &str, expected: f64, base: f64, span: f64, log_name: &str) -> Result<std::process::Child, String> {
    let port: u16 = args.iter().position(|arg| arg == "--port").and_then(|at| args.get(at + 1)).and_then(|value| value.parse().ok()).ok_or("no port for the model server")?;
    let log = runtime_dir(models).join(log_name);
    let log_out = std::fs::File::create(&log).map_err(|error| format!("cannot write {}: {error}", log.display()))?;
    let log_err = log_out.try_clone().map_err(|error| error.to_string())?;
    let mut command = std::process::Command::new(server_exe(models));
    command.args(args).current_dir(runtime_dir(models)).stdin(std::process::Stdio::null()).stdout(log_out).stderr(log_err);
    // The processor share from Settings › Performance, unless the user or the tuner chose threads.
    let threads = crate::resources::current().threads().to_string();
    if !args.iter().any(|arg| arg == "-t" || arg == "--threads") {
        command.args(["-t", threads.as_str()]);
    }
    if !args.iter().any(|arg| arg == "-tb" || arg == "--threads-batch") {
        command.args(["-tb", threads.as_str()]);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    job.progress(base, format!("Loading {label} into memory"));
    let mut child = command.spawn().map_err(|error| format!("could not start llama-server: {error}"))?;
    crate::resources::contain_std(&child);
    let client = reqwest::Client::new();
    let started = Instant::now();
    let limit = Duration::from_secs(20 * 60);
    loop {
        if let Ok(Some(_)) = child.try_wait() {
            return Err(crate::resources::explain_failure("llama-server", explain_failure(&log)));
        }
        if *job.cancel.borrow() {
            let _ignored = child.kill();
            let _ignored = child.wait();
            return Err("Cancelled".into());
        }
        if health_ok(&client, port).await {
            return Ok(child);
        }
        let elapsed = started.elapsed();
        if elapsed > limit {
            let _ignored = child.kill();
            let _ignored = child.wait();
            return Err("The model took more than 20 minutes to load. Try a smaller version.".into());
        }
        job.progress(base + span * (elapsed.as_secs_f64() / expected.max(1.0)).min(1.0), format!("Loading {label} into memory ({} s)", elapsed.as_secs()));
        tokio::time::sleep(Duration::from_millis(1000)).await;
    }
}

/// The server's own speeds over its recent real requests (`/metrics`), laid over what the start-up
/// check measured. A server without metrics (Strata) keeps what it has.
async fn with_live_speeds(mut running: LlmRunning) -> LlmRunning {
    if !running.args.iter().any(|arg| arg == "--metrics") {
        return running;
    }
    let client = reqwest::Client::new();
    let text = match client.get(format!("{}/metrics", running.url)).timeout(Duration::from_millis(1500)).send().await {
        Ok(response) if response.status().is_success() => response.text().await.unwrap_or_default(),
        _ => return running,
    };
    let live = tune::parse_metrics(&text);
    if let Some(speed) = live.prefill {
        running.prefill_tokens_per_second = Some(round1(speed));
    }
    if let Some(speed) = live.decode {
        running.decode_tokens_per_second = Some(round1(speed));
    }
    running
}

// ---------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------

/// What is installed and running. A server that has died since is cleaned up here too.
#[tauri::command]
pub(crate) async fn llm_runtime_status(app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<LlmRuntimeStatus, String> {
    status(&app, state.inner()).await
}

async fn status(app: &AppHandle, state: &Arc<AppState>) -> Result<LlmRuntimeStatus, String> {
    let dead = SERVER.lock().map_err(|error| error.to_string())?.as_mut().is_some_and(|server| server.child.try_wait().ok().flatten().is_some());
    if dead {
        stop_server(app, state, "llm-stopped-unexpectedly").await;
    }
    crate::strata::reap_dead(app, state).await;
    let models = &state.paths.models;
    let marker = installed_marker(models);
    let running = match running_now() {
        Some(running) => Some(with_live_speeds(running).await),
        None => crate::strata::running_now(),
    };
    let update_available = marker.as_ref().is_some_and(|marker| marker.tag != LLAMA_TAG);
    let message = match (&marker, &running) {
        (_, Some(running)) => format!("Running {} at {}", running.model_id, running.url),
        (Some(marker), None) if update_available => format!("llama.cpp {} is installed; {LLAMA_TAG} adds the expert cache and faster drafting. Update it to use them.", marker.tag),
        (Some(marker), None) => format!("llama.cpp {} is installed{}; nothing is running.", marker.tag, if marker.cuda { " (NVIDIA build)" } else { " (CPU build)" }),
        (None, None) if cfg!(windows) => "The llama.cpp runtime is not installed yet. Install it to run local language models.".to_owned(),
        (None, None) => "Local language models are Windows-only for now.".to_owned(),
    };
    Ok(LlmRuntimeStatus { installed: marker.is_some(), version: marker.as_ref().map(|marker| marker.tag.clone()), cuda: marker.as_ref().is_some_and(|marker| marker.cuda), running, message, update_available })
}

/// Plans (`dryRun`) or starts a downloaded model, tuned to this PC. `variant` lets the screen plan a
/// size that is not downloaded yet; starting always uses what is on disk. Once the server answers,
/// the llama.cpp chat provider points at it. A stored "Tune for this PC" result is used when it
/// applies; the server is started once and stays up between chat turns.
#[tauri::command]
pub(crate) async fn llm_start(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    id: String,
    context_tokens: Option<u32>,
    dry_run: Option<bool>,
    variant: Option<String>,
) -> Result<StartResult, String> {
    start_inner(app, state.inner().clone(), id, context_tokens, dry_run.unwrap_or(false), variant).await
}

async fn start_inner(app: AppHandle, state: Arc<AppState>, id: String, context_tokens: Option<u32>, dry_run: bool, variant: Option<String>) -> Result<StartResult, String> {
    // Models that run through Strata are planned and started there.
    if crate::strata::is_strata(&id) {
        return crate::strata::start_for_library(app, state, id, variant, dry_run).await;
    }
    let entry_owned = find_entry(&state.paths.models, &id).ok_or_else(|| format!("Bhippi has no local language model called {id}."))?;
    let entry = &entry_owned;
    let on_disk = installed_variant(&state.paths.models, entry);
    let chosen = match (&on_disk, dry_run) {
        (Some((found, _)), _) => found,
        (None, true) => variant
            .as_deref()
            .and_then(|wanted| entry.variants.iter().find(|candidate| candidate.id == wanted))
            .or_else(|| entry.variants.iter().find(|candidate| candidate.default))
            .or_else(|| entry.variants.first())
            .ok_or("This model has no downloadable version.")?,
        (None, false) => return Err(format!("Download {} first (Settings, Model Library).", entry.name)),
    };
    // A planned size other than the installed one (dry run only).
    let chosen = if dry_run { variant.as_deref().and_then(|wanted| entry.variants.iter().find(|candidate| candidate.id == wanted)).unwrap_or(chosen) } else { chosen };
    let machine = read_machine(&state).await;
    let own_running = running_now().is_some();
    let pc = pc_from(&machine, own_running);
    // A hand-tuned pick keeps its computed split; anything else is left to llama.cpp's own fitting.
    let (shape, plan) = if is_tuned(entry, chosen) {
        let shape = shape_of(entry, chosen).ok_or("This catalog entry does not say how the model is built.")?;
        let planned = plan(&shape, &pc, context_tokens);
        (Some(shape), planned)
    } else {
        let (file_gb, projector_gb) = weight_sizes(chosen);
        (None, fit_plan(file_gb, projector_gb, &pc, context_tokens))
    };
    if dry_run {
        return Ok(StartResult { plan, running: running_now() });
    }
    if plan.verdict == Verdict::No {
        return Err(plan.note);
    }
    let models = state.paths.models.clone();
    let marker = installed_marker(&models).ok_or("Install the llama.cpp runtime first (Settings, Model Library).")?;
    let (_, folder) = on_disk.as_ref().ok_or("The model files are not on disk.")?;
    let first = folder.join(&chosen.files.iter().find(|file| !is_projector(&file.dest)).ok_or("This version lists no files.")?.dest);
    let projector = chosen.files.iter().find(|file| is_projector(&file.dest)).map(|file| folder.join(&file.dest));
    for file in &chosen.files {
        let path = folder.join(&file.dest);
        if std::fs::metadata(&path).map_or(true, |meta| meta.len() != file.bytes) {
            return Err(format!("{} is missing or incomplete. Download the model again.", path.display()));
        }
    }
    // The speed-ups: a stored tuning result for this PC when there is one, else the plan (plus the
    // model's own MTP head when its file has one). A build too old for the flags gets none.
    let (speed, tuned) = if shape.is_some() && supports_speedups(&marker.tag) {
        let key = tune::TuneKey::new(&entry.id, &chosen.id, &machine, &marker.tag);
        match tune::find(&models, &key, plan.context_tokens, plan.cpu_moe_blocks) {
            Some(record) => (tune::speedups_from(&record, plan.cpu_moe_blocks, chosen, entry, folder), true),
            None => (tune::default_speedups(chosen), false),
        }
    } else {
        (Speedups::default(), false)
    };

    let job = state.jobs.start("model", format!("Starting {}", entry.name), false);
    let mut result = launch(&app, &state, entry, chosen, shape.as_ref(), &first, projector.as_deref(), &plan, &speed, tuned, &job).await;
    let mut fell_back = false;
    if let Err(error) = &result {
        // A speed-up that will not start (not enough video memory for the cache, a draft head this build cannot use) must not cost the user the model.
        if speed != Speedups::default() && error != "Cancelled" {
            job.progress(0.03, "The speed-ups did not start; starting without them");
            result = launch(&app, &state, entry, chosen, shape.as_ref(), &first, projector.as_deref(), &plan, &Speedups::default(), false, &job).await;
            fell_back = result.is_ok();
        }
    }
    match result {
        Ok(running) => {
            let speed_text = running.decode_tokens_per_second.map(|speed| format!(" ({:.0} words a second)", speed * 0.75)).unwrap_or_default();
            job.done(format!("{} is ready{speed_text}{}", entry.name, if fell_back { "; the speed-ups did not start, so it runs on the plan alone" } else { "" }), None);
            Ok(StartResult { plan, running: Some(running) })
        }
        Err(error) => {
            job.fail(error.clone());
            Err(error)
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn launch(
    app: &AppHandle,
    state: &Arc<AppState>,
    entry: &CatalogEntry,
    variant: &CatalogVariant,
    shape: Option<&ModelShape>,
    model: &Path,
    projector: Option<&Path>,
    plan: &LlmPlan,
    speed: &Speedups,
    tuned: bool,
    job: &JobHandle,
) -> Result<LlmRunning, String> {
    // One model at a time.
    if running_now().is_some() {
        job.progress(0.02, "Stopping the model that is running");
        stop_server(app, state, "llm-stopped").await;
    }
    // Strata holds the same single model slot.
    crate::strata::stop_server(app, state, "llm-stopped").await;
    let models = state.paths.models.clone();
    let port = free_port()?;
    let alias = entry.id.clone();
    let tuning = shape.map_or(Tuning::Fitted, |shape| Tuning::Planned { moe: shape.moe });
    let args = server_args_with(model, &alias, plan, tuning, projector, port, speed);
    let expected = 20.0 + weight_sizes(variant).0 * 4.0;
    let mut child = spawn_and_wait(&models, &args, job, &entry.name, expected, 0.05, 0.85, "server.log").await?;

    // Reading and writing speed from one real request, so the screen has numbers before the first chat.
    job.progress(0.92, "Measuring speed");
    let client = reqwest::Client::new();
    let (prefill, decode) = measure_start(&client, port).await;
    let running = LlmRunning {
        model_id: entry.id.clone(),
        variant: variant.id.clone(),
        url: format!("http://127.0.0.1:{port}"),
        port,
        gpu_layers_note: match shape {
            Some(shape) => split_note(plan, shape.moe, shape.layers),
            None => "llama.cpp split it between the GPU and RAM to fit this PC".to_owned(),
        },
        tokens_per_second: decode,
        prefill_tokens_per_second: prefill,
        decode_tokens_per_second: decode,
        tuned,
        speculative: speed.speculative.as_ref().map(|kind| kind.kind().to_owned()),
        speedups: speedups_in(&args).into_iter().map(str::to_owned).collect(),
        args,
    };
    if let Ok(mut server) = SERVER.lock() {
        *server = Some(Server { child, running: running.clone(), previous_endpoint: None });
    } else {
        let _ignored = child.kill();
        return Err("Could not keep track of the model server.".into());
    }
    // The chat fits each request to this window (chat_fit.rs) instead of learning it from a 400.
    bhippi_providers::context_window::remember(&running.url, None, plan.context_tokens);
    // Offer it to chat: the llama.cpp provider's address is this server until it stops.
    job.progress(0.96, "Adding it to the AI chat");
    let previous = point_provider(app, state, Some(running.url.clone()), None).await?;
    if let Ok(mut server) = SERVER.lock() {
        if let Some(server) = server.as_mut().filter(|server| server.running.port == port) {
            // Never remember our own address as "the user's".
            server.previous_endpoint = previous.filter(|old| !old.contains(&format!(":{port}")));
        }
    }
    watch(app.clone(), state.clone(), port);
    let _ignored = app.emit(LIBRARY_EVENT, serde_json::json!({ "id": entry.id, "reason": "llm-started" }));
    Ok(running)
}

/// Measures the fastest settings for an installed model on this PC (a few minutes: it stops the
/// running model, benchmarks several splits and batch sizes, and times the expert cache and
/// speculation with a real server). The result is stored and `llm_start` uses it. Answers the job id.
#[tauri::command]
pub(crate) async fn llm_tune(app: AppHandle, state: State<'_, Arc<AppState>>, id: String, variant: Option<String>) -> Result<serde_json::Value, String> {
    let shared = state.inner().clone();
    let prep = tune::prepare(&shared.paths.models, &id, variant.as_deref())?;
    let claim = tune::claim()?;
    let job = shared.jobs.start("model", format!("Tuning {} for this PC", prep.entry.name), true);
    let job_id = job.id().to_owned();
    tauri::async_runtime::spawn(async move {
        let _claim = claim;
        match tune::run(&app, &shared, prep, &job).await {
            Ok((summary, record)) => job.done(summary, serde_json::to_value(&record).ok()),
            Err(error) => job.fail(error),
        }
    });
    Ok(serde_json::json!({ "jobId": job_id }))
}

/// The newest tuning result for a downloaded model on this PC, or null (never tuned, a different
/// card or amount of memory, or a newer llama.cpp than the one it was measured with).
#[tauri::command]
pub(crate) async fn llm_tuning(state: State<'_, Arc<AppState>>, id: String) -> Result<Option<tune::TuneRecord>, String> {
    let state = state.inner().clone();
    let models = state.paths.models.clone();
    let Some(entry) = find_entry(&models, &id) else { return Ok(None) };
    let Some((variant, _)) = installed_variant(&models, &entry) else { return Ok(None) };
    let Some(marker) = installed_marker(&models) else { return Ok(None) };
    let machine = read_machine(&state).await;
    Ok(tune::find_latest(&models, &tune::TuneKey::new(&entry.id, &variant.id, &machine, &marker.tag)))
}

/// Stops the running model and gives the llama.cpp provider its old address back.
#[tauri::command]
pub(crate) async fn llm_stop(app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<LlmRuntimeStatus, String> {
    stop_server(&app, state.inner(), "llm-stopped").await;
    crate::strata::stop_server(&app, state.inner(), "llm-stopped").await;
    status(&app, state.inner()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The user's PC: an RTX 3080 with 10 GB (about 9.2 GiB free with the desktop running) and 64 GB of RAM.
    fn rtx3080() -> Pc {
        pc(9.2, 63.8, "NVIDIA GeForce RTX 3080")
    }

    /// No limit in force: all the memory and enough threads to saturate it.
    fn pc(vram: f64, ram: f64, name: &str) -> Pc {
        Pc { vram_gb: vram, gpu_bandwidth_gbs: gpu_bandwidth_gbs(name), ram_gb: ram, ram_bandwidth_gbs: RAM_BANDWIDTH_GBS, ram_cap_gb: ram, ram_percent: 100, cpu_threads: 16 }
    }

    fn limited(mut pc: Pc, ram_percent: u8, threads: usize) -> Pc {
        pc.ram_percent = ram_percent;
        pc.ram_cap_gb = pc.ram_gb * f64::from(ram_percent) / 100.0;
        pc.cpu_threads = threads;
        pc
    }

    #[test]
    fn a_pc_at_the_default_limit_plans_within_three_quarters_of_its_memory() {
        let machine = Machine { gpu_name: None, vram_total_gb: 0.0, vram_free_gb: 0.0, ram_gb: 64.0 };
        let pc = pc_from(&machine, false);
        assert!((pc.ram_cap_gb - 48.0).abs() < 1e-9 && pc.ram_percent == 75 && pc.cpu_threads >= 1, "{pc:?}");
    }

    #[test]
    fn a_model_over_the_memory_limit_but_within_the_pc_gets_the_limit_note() {
        let pc = limited(pc(0.0, 64.0, ""), 75, 12);
        let plan = fit_plan(44.0, 0.0, &pc, None);
        assert_eq!(plan.verdict, Verdict::No);
        assert!(plan.over_limit, "{plan:?}");
        assert!(plan.note.contains("your limit is 48 GB (75%, Settings \u{203a} Performance)"), "{}", plan.note);
        // The same model with no limit runs.
        let free = fit_plan(44.0, 0.0, &limited(pc.clone(), 100, 12), None);
        assert_ne!(free.verdict, Verdict::No);
        assert!(!free.over_limit);
        // A model bigger than the whole PC is not blamed on the limit.
        let huge = fit_plan(70.0, 0.0, &pc, None);
        assert!(huge.verdict == Verdict::No && !huge.over_limit);
    }

    #[test]
    fn processor_speed_follows_the_threads_the_limit_allows() {
        let base = pc(0.0, 64.0, "");
        let speed = |threads: usize| fit_plan(10.0, 0.0, &limited(base.clone(), 100, threads), None).est_tokens_per_second.unwrap().1;
        assert!((speed(4) * 2.0 - speed(8)).abs() < 0.3, "{} {}", speed(4), speed(8));
        assert!((speed(8) - speed(16)).abs() < 1e-9, "memory bandwidth caps it");
    }

    fn model(id: &str, variant: &str) -> ModelShape {
        let entry = catalog().iter().find(|entry| entry.id == id).unwrap_or_else(|| panic!("no {id}"));
        let chosen = entry.variants.iter().find(|candidate| candidate.id == variant).unwrap_or_else(|| panic!("no {id}/{variant}"));
        shape_of(entry, chosen).unwrap()
    }

    fn default_variant(entry: &CatalogEntry) -> &CatalogVariant {
        entry.variants.iter().find(|variant| variant.default).unwrap()
    }

    #[test]
    fn expert_share_follows_the_active_fraction_and_is_capped() {
        assert_eq!(expert_share(30.0, 3.0, false), 0.0);
        assert!((expert_share(80.0, 3.0, true) - 0.95).abs() < 1e-9, "very sparse models hit the cap");
        assert!((expert_share(21.0, 3.6, true) - 0.897).abs() < 0.01);
        assert!(expert_share(25.2, 3.8, true) < expert_share(35.0, 3.0, true), "less sparse means less of the file is experts");
        assert!(expert_share(10.0, 10.0, true) >= 0.5);
    }

    #[test]
    fn rtx3080_runs_a_35b_moe_with_most_experts_in_ram() {
        let plan = plan(&model("qwen3.5-35b-a3b", "q4"), &rtx3080(), None);
        assert_eq!(plan.context_tokens, 32_768);
        assert!(plan.cpu_moe_blocks > 20 && plan.cpu_moe_blocks < 40, "some blocks fit the card, most do not: {plan:?}");
        assert_eq!(plan.gpu_layers, 40, "attention and shared weights are all on the card");
        assert!(plan.vram_gb <= 9.2 - HEADROOM_GB + 0.05, "never plans past the headroom: {plan:?}");
        assert!(plan.ram_gb > 10.0 && plan.ram_gb < 30.0);
        let (low, high) = plan.est_tokens_per_second.unwrap();
        assert!(low >= 15.0 && high <= 90.0 && low < high, "{plan:?}");
        assert_eq!(plan.verdict, Verdict::Great);
        assert!(plan.note.starts_with("Experts of ") && plan.note.contains("blocks stay in RAM") && plan.note.contains("words a second expected"), "{}", plan.note);
    }

    /// Bhippi's chat needs room for its guide and tools, so a model starts with 32K when the PC holds
    /// it, halves (to 8K) only when it does not, and keeps whatever the user chose.
    #[test]
    fn the_default_context_is_32k_and_halves_only_when_memory_is_short() {
        assert_eq!(DEFAULT_CONTEXT, 32_768);
        let tuned = plan(&model("qwen3.5-9b", "q4"), &rtx3080(), None);
        assert_eq!(tuned.context_tokens, 32_768, "{tuned:?}");
        assert!(tuned.context_tokens >= 32_768 / 2 && !tuned.note.contains("shortened"), "{}", tuned.note);
        // A model nobody hand-tuned: 32K on a PC with room, an explicit 16K kept.
        let roomy = fit_plan(5.0, 0.0, &rtx3080(), None);
        assert_eq!(roomy.context_tokens, 32_768);
        assert_eq!(fit_plan(5.0, 0.0, &rtx3080(), Some(16_384)).context_tokens, 16_384);
        assert_eq!(fit_plan(5.0, 0.0, &rtx3080(), Some(65_536)).context_tokens, 65_536);
        // RAM so short that 32K's cache tips it over: the default halves, never below 8K, and says so.
        let file_gb = 20.0;
        let tight_ram = fit_plan_at(file_gb, 0.0, &pc(0.0, 32.0, ""), 32_768).ram_gb - 0.05;
        let tight = fit_plan(file_gb, 0.0, &pc(0.0, tight_ram, ""), None);
        assert!(tight.context_tokens < 32_768 && tight.context_tokens >= 8_192, "{tight:?}");
        assert!(tight.note.contains("shortened"), "{}", tight.note);
        // An explicit choice is never halved, even when it does not fit.
        assert_eq!(fit_plan(file_gb, 0.0, &pc(0.0, tight_ram, ""), Some(32_768)).context_tokens, 32_768);
    }

    #[test]
    fn rtx3080_runs_gpt_oss_120b_on_64_gb() {
        let plan = plan(&model("gpt-oss-120b", "q4"), &rtx3080(), None);
        assert_ne!(plan.verdict, Verdict::No, "{plan:?}");
        assert!(plan.cpu_moe_blocks >= 30, "nearly every block's experts stay in RAM: {plan:?}");
        assert!(plan.ram_gb > 50.0 && plan.ram_gb < 63.8, "{plan:?}");
        let (low, high) = plan.est_tokens_per_second.unwrap();
        assert!(low >= 6.0 && high <= 40.0, "{plan:?}");
        assert!(matches!(plan.verdict, Verdict::Ok | Verdict::Great));
    }

    #[test]
    fn gpt_oss_120b_does_not_fit_32_gb_of_ram() {
        let plan = plan(&model("gpt-oss-120b", "q4"), &pc(9.2, 32.0, "RTX 3080"), None);
        assert_eq!(plan.verdict, Verdict::No);
        assert!(plan.note.contains("system memory") && plan.note.contains("32 GB"), "{}", plan.note);
        assert!(plan.est_tokens_per_second.is_none());
    }

    #[test]
    fn small_dense_model_sits_entirely_on_the_card() {
        let plan = plan(&model("qwen3.5-9b", "q4"), &rtx3080(), None);
        assert_eq!(plan.cpu_moe_blocks, 0);
        assert_eq!(plan.gpu_layers, 32);
        assert_eq!(plan.verdict, Verdict::Great);
        assert!(plan.note.starts_with("The whole model fits on the graphics card"));
        assert!(plan.vram_gb < 8.0);
    }

    #[test]
    fn dense_model_too_big_for_the_card_gets_partial_layers() {
        // Q8 of the 9B model is about 8.9 GiB: too much for a 6 GB card.
        let plan = plan(&model("qwen3.5-9b", "q8"), &pc(6.0, 32.0, "RTX 2060"), None);
        assert!(plan.gpu_layers > 0 && plan.gpu_layers < 32, "{plan:?}");
        assert!(plan.note.contains("layers run on the graphics card"), "{}", plan.note);
        assert!(plan.vram_gb <= 5.0 + 0.05);
        assert_ne!(plan.verdict, Verdict::No);
    }

    #[test]
    fn no_graphics_card_runs_on_the_processor() {
        let dense = plan(&model("qwen3.5-4b", "q4"), &pc(0.0, 16.0, ""), None);
        assert_eq!((dense.gpu_layers, dense.cpu_moe_blocks), (0, 0));
        assert!(dense.note.contains("No graphics card"), "{}", dense.note);
        assert_ne!(dense.verdict, Verdict::No);
        let moe = plan(&model("gpt-oss-20b", "q4"), &pc(0.0, 32.0, ""), None);
        assert_eq!(moe.gpu_layers, 0);
        assert_eq!(moe.cpu_moe_blocks, 24);
        assert!(moe.ram_gb > 14.0);
        assert!(moe.note.contains("processor"));
    }

    #[test]
    fn a_small_card_shortens_the_context_before_giving_up() {
        // GLM's cache is large: at 16K the shared part plus cache does not fit 4 GB, at 4K it does.
        let tight = pc(3.0, 64.0, "RTX 3050");
        let plan = plan(&model("glm-4.7-flash", "q4"), &tight, None);
        assert!(plan.context_tokens < 32_768, "{plan:?}");
        assert!(plan.context_tokens >= MIN_CONTEXT);
        if plan.verdict != Verdict::No {
            assert!(plan.note.contains("context is shortened"), "{}", plan.note);
        }
        // An explicit context is kept as asked, and can fail.
        let asked = super::plan(&model("glm-4.7-flash", "q4"), &tight, Some(65_536));
        assert_eq!(asked.context_tokens, 65_536);
    }

    #[test]
    fn a_card_too_small_for_the_shared_weights_says_no_and_why() {
        let plan = plan(&model("qwen3.5-122b-a10b", "q3"), &pc(3.0, 64.0, "GTX 1060"), None);
        assert_eq!(plan.verdict, Verdict::No);
        assert!(plan.note.contains("video memory"), "{}", plan.note);
        assert_eq!(plan.est_tokens_per_second, None);
    }

    #[test]
    fn more_video_memory_means_fewer_blocks_in_ram() {
        let shape = model("qwen3.5-35b-a3b", "q4");
        let mut last = u32::MAX;
        for vram in [5.0, 8.0, 10.0, 12.0, 16.0, 24.0, 48.0] {
            let blocks = plan(&shape, &pc(vram, 64.0, "RTX"), Some(16_384)).cpu_moe_blocks;
            assert!(blocks <= last, "{vram} GB: {blocks} > {last}");
            last = blocks;
        }
        assert_eq!(last, 0, "a 48 GB card holds all of it");
        let big = plan(&shape, &pc(48.0, 64.0, "RTX 6000"), None);
        assert!(big.note.starts_with("Everything fits on the graphics card"));
    }

    #[test]
    fn a_longer_context_never_means_fewer_blocks_in_ram() {
        let shape = model("glm-4.7-flash", "q4");
        let small = plan(&shape, &rtx3080(), Some(8_192)).cpu_moe_blocks;
        let large = plan(&shape, &rtx3080(), Some(131_072)).cpu_moe_blocks;
        assert!(large >= small);
    }

    #[test]
    fn faster_cards_and_more_gpu_blocks_are_faster() {
        let shape = model("qwen3.5-35b-a3b", "q4");
        let slow = plan(&shape, &pc(9.2, 64.0, "RTX 3060"), None).est_tokens_per_second.unwrap();
        let fast = plan(&shape, &pc(23.0, 64.0, "RTX 4090"), None).est_tokens_per_second.unwrap();
        assert!(fast.0 > slow.0 && fast.1 > slow.1);
    }

    #[test]
    fn gpu_names_map_to_bandwidth() {
        assert_eq!(gpu_bandwidth_gbs("NVIDIA GeForce RTX 3080"), 760.0);
        assert_eq!(gpu_bandwidth_gbs("NVIDIA GeForce RTX 3080 Ti"), 912.0);
        assert_eq!(gpu_bandwidth_gbs("NVIDIA GeForce RTX 4070 Ti SUPER"), 672.0);
        assert_eq!(gpu_bandwidth_gbs("NVIDIA GeForce RTX 4060 Ti"), 288.0);
        assert_eq!(gpu_bandwidth_gbs("Mystery Adapter"), 300.0);
    }

    #[test]
    fn the_users_pc_against_every_model_in_the_catalog() {
        // Prints the table the report quotes (run with --nocapture) and pins the broad outcomes.
        for entry in catalog() {
            for variant in &entry.variants {
                let plan = plan(&shape_of(entry, variant).unwrap(), &rtx3080(), None);
                println!(
                    "{}/{}: {:?}, ctx {}, cpu-moe {}, gpu layers {}, vram {} GB, ram {} GB, {:?} tok/s :: {}",
                    entry.id, variant.id, plan.verdict, plan.context_tokens, plan.cpu_moe_blocks, plan.gpu_layers, plan.vram_gb, plan.ram_gb, plan.est_tokens_per_second, plan.note
                );
                if variant.default {
                    assert_ne!(plan.verdict, Verdict::No, "{}/{} should run on a 3080 with 64 GB: {plan:?}", entry.id, variant.id);
                }
                if variant.default {
                    assert!(plan.vram_gb <= 9.2 - HEADROOM_GB + 0.1, "{}/{}: {plan:?}", entry.id, variant.id);
                }
            }
        }
    }

    #[test]
    fn catalog_is_well_formed() {
        assert!(catalog().len() >= 6, "the catalog parsed: {}", catalog().len());
        let mut ids = std::collections::HashSet::new();
        for entry in catalog() {
            assert!(ids.insert(entry.id.clone()), "duplicate id {}", entry.id);
            assert_eq!(entry.variants.iter().filter(|variant| variant.default).count(), 1, "{} needs exactly one default", entry.id);
            for variant in &entry.variants {
                let shape = shape_of(entry, variant).unwrap_or_else(|| panic!("{}/{} has no llm shape", entry.id, variant.id));
                assert!(shape.layers > 0 && shape.active_params_b <= shape.total_params_b && shape.context_max >= 4096);
                assert_eq!(shape.moe, shape.active_params_b < shape.total_params_b, "{}: moe flag matches the parameter counts", entry.id);
                assert!(!variant.files.is_empty());
                for file in &variant.files {
                    assert!(file.dest.starts_with(&format!("llm/{}/", entry.id)) && file.dest.ends_with(".gguf"), "{}", file.dest);
                    assert!(file.bytes > 1_000);
                }
                let (per_token, _) = kv_profile(&entry.id, shape.layers);
                assert!(per_token > 0.0);
            }
        }
        for (known, _) in [("qwen3.5-9b", 0), ("gpt-oss-20b", 0), ("gpt-oss-120b", 0), ("qwen3.5-35b-a3b", 0)] {
            assert!(catalog().iter().any(|entry| entry.id == known), "{known} is in the catalog");
        }
    }

    #[test]
    fn every_catalog_id_has_a_measured_cache_profile() {
        for entry in catalog() {
            let layers = entry.variants[0].llm.as_ref().unwrap().layers;
            let guess = f64::from(layers) * 4_096.0;
            assert_ne!(kv_profile(&entry.id, layers).0, guess, "{} falls back to the generic guess", entry.id);
        }
    }

    #[test]
    fn catalog_minimums_are_enough_to_start() {
        // minVramGb and minRamGb in llm.json were computed for 8K tokens with every expert in RAM.
        for entry in catalog() {
            let raw: serde_json::Value = serde_json::from_str(CATALOG_JSON).unwrap();
            let entry_json = raw.as_array().unwrap().iter().find(|candidate| candidate["id"] == entry.id.as_str()).unwrap();
            for variant in &entry.variants {
                let json = entry_json["variants"].as_array().unwrap().iter().find(|candidate| candidate["id"] == variant.id.as_str()).unwrap();
                let (min_vram, rec_vram, min_ram) = (json["minVramGb"].as_f64().unwrap(), json["recVramGb"].as_f64().unwrap(), json["minRamGb"].as_f64().unwrap());
                assert!(min_vram <= rec_vram, "{}/{}", entry.id, variant.id);
                let shape = shape_of(entry, variant).unwrap();
                let at_min = plan(&shape, &pc(min_vram.max(0.0), min_ram, "RTX 3070"), Some(8_192));
                assert_ne!(at_min.verdict, Verdict::No, "{}/{} must be startable at its own minimums: {at_min:?}", entry.id, variant.id);
                let at_rec = plan(&shape, &pc(rec_vram, min_ram, "RTX 3070"), Some(8_192));
                assert_eq!(at_rec.cpu_moe_blocks, 0, "{}/{} fits fully at its recommended video memory: {at_rec:?}", entry.id, variant.id);
                assert_eq!(at_rec.gpu_layers, shape.layers);
            }
        }
    }

    #[test]
    fn a_variant_that_is_not_downloaded_yet_can_still_be_planned() {
        let entry = catalog().iter().find(|entry| entry.id == "qwen3.5-35b-a3b").unwrap();
        let temp = std::env::temp_dir().join("bhippi-llm-test-empty");
        assert!(installed_variant(&temp, entry).is_none());
        assert!(default_variant(entry).llm.is_some());
    }

    #[test]
    fn installed_variant_reads_the_library_state_loosely() {
        let entry = catalog().iter().find(|entry| entry.id == "qwen3.5-9b").unwrap();
        let root = std::env::temp_dir().join(format!("bhippi-llm-test-{}", std::process::id()));
        let library = root.join("library");
        std::fs::create_dir_all(&library).unwrap();
        // Recorded under "models", with its own folder.
        let elsewhere = root.join("big-drive");
        std::fs::write(library.join("state.json"), serde_json::json!({ "storageDir": library, "models": { "qwen3.5-9b": { "installedVariant": "q8", "folder": elsewhere } } }).to_string()).unwrap();
        let (variant, folder) = installed_variant(&root, entry).unwrap();
        assert_eq!((variant.id.as_str(), folder), ("q8", elsewhere.clone()));
        // Recorded at the top level, no folder: the storage folder.
        std::fs::write(library.join("state.json"), serde_json::json!({ "storageDir": elsewhere, "qwen3.5-9b": { "installedVariant": "q4" } }).to_string()).unwrap();
        let (variant, folder) = installed_variant(&root, entry).unwrap();
        assert_eq!((variant.id.as_str(), folder), ("q4", elsewhere));
        // No record at all and nothing on disk: not installed.
        std::fs::write(library.join("state.json"), "{}").unwrap();
        assert!(installed_variant(&root, entry).is_none());
        let _ignored = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn server_arguments_follow_the_plan() {
        let moe_plan = plan(&model("qwen3.5-35b-a3b", "q4"), &rtx3080(), None);
        let args = server_args(Path::new("D:/m/model.gguf"), "qwen3.5-35b-a3b", &moe_plan, Tuning::Planned { moe: true }, None, 9876);
        let joined = args.join(" ");
        assert!(joined.starts_with("-m D:/m/model.gguf --alias qwen3.5-35b-a3b -c 32768 -ngl 999 --n-cpu-moe "), "{joined}");
        assert!(joined.contains(&format!("--n-cpu-moe {}", moe_plan.cpu_moe_blocks)));
        for flag in ["-fa on", "--cache-type-k q8_0", "--cache-type-v q8_0", "--jinja", "--host 127.0.0.1", "--port 9876", "--no-webui", "--fit off"] {
            assert!(joined.contains(flag), "{flag} in {joined}");
        }
        // Everything on the GPU: no --n-cpu-moe at all.
        let all = plan(&model("qwen3.5-35b-a3b", "q4"), &pc(48.0, 64.0, "RTX 6000"), None);
        assert!(!server_args(Path::new("m.gguf"), "x", &all, Tuning::Planned { moe: true }, None, 1).contains(&"--n-cpu-moe".to_owned()));
        // Dense with some layers on the GPU: an exact -ngl.
        let dense = plan(&model("qwen3.5-9b", "q8"), &pc(6.0, 32.0, "RTX 2060"), None);
        let dense_args = server_args(Path::new("m.gguf"), "x", &dense, Tuning::Planned { moe: false }, None, 1);
        let at = dense_args.iter().position(|arg| arg == "-ngl").unwrap();
        assert_eq!(dense_args[at + 1], dense.gpu_layers.to_string());
        // No GPU: -ngl 0.
        let cpu = plan(&model("qwen3.5-4b", "q4"), &pc(0.0, 16.0, ""), None);
        let cpu_args = server_args(Path::new("m.gguf"), "x", &cpu, Tuning::Planned { moe: false }, None, 1);
        let at = cpu_args.iter().position(|arg| arg == "-ngl").unwrap();
        assert_eq!(cpu_args[at + 1], "0");
    }

    #[test]
    fn fitted_start_leaves_the_split_to_llama_cpp_and_adds_the_picture_reader() {
        let plan = fit_plan(18.0, 0.9, &rtx3080(), None);
        let args = server_args(Path::new("D:/m/model.gguf"), "hf:x", &plan, Tuning::Fitted, Some(Path::new("D:/m/mmproj-F16.gguf")), 7000);
        let joined = args.join(" ");
        assert!(joined.starts_with("-m D:/m/model.gguf --alias hf:x -c 32768 --mmproj D:/m/mmproj-F16.gguf "), "{joined}");
        assert!(joined.contains("--fit on") && joined.contains("--jinja"), "{joined}");
        for flag in ["-ngl", "--n-cpu-moe", "--fit off"] {
            assert!(!joined.contains(flag), "{flag} must not be set when llama.cpp fits the model: {joined}");
        }
        // No picture reader: no --mmproj.
        assert!(!server_args(Path::new("m.gguf"), "x", &plan, Tuning::Fitted, None, 1).contains(&"--mmproj".to_owned()));
    }

    #[test]
    fn the_fit_plan_estimates_from_size_against_memory() {
        let small = fit_plan(4.0, 0.0, &rtx3080(), None);
        assert_eq!(small.verdict, Verdict::Great, "{small:?}");
        assert!(small.note.starts_with("llama.cpp fits it to this PC when it starts."), "{}", small.note);
        assert!(small.note.contains("fit the graphics card"), "{}", small.note);
        assert_eq!(small.cpu_moe_blocks, 0);
        let big = fit_plan(40.0, 0.0, &rtx3080(), None);
        assert!(big.vram_gb > 7.0 && big.vram_gb <= 9.2 - HEADROOM_GB + 0.05, "{big:?}");
        assert!(big.ram_gb > 30.0 && big.ram_gb < 63.8, "{big:?}");
        assert_ne!(big.verdict, Verdict::No);
        assert!(big.note.contains("on the graphics card") && big.note.contains("in RAM"), "{}", big.note);
        let too_big = fit_plan(70.0, 0.0, &pc(9.2, 32.0, "RTX 3080"), None);
        assert_eq!(too_big.verdict, Verdict::No);
        assert!(too_big.note.contains("32 GB of RAM"), "{}", too_big.note);
        let cpu_only = fit_plan(6.0, 0.0, &pc(0.0, 16.0, ""), None);
        assert_eq!(cpu_only.gpu_layers, 0);
        assert!(cpu_only.note.contains("No graphics card"), "{}", cpu_only.note);
        // A longer context costs memory.
        assert!(fit_plan(18.0, 0.0, &rtx3080(), Some(131_072)).ram_gb > fit_plan(18.0, 0.0, &rtx3080(), Some(4_096)).ram_gb);
    }

    #[test]
    fn models_from_hugging_face_are_found_and_never_tuned() {
        let root = std::env::temp_dir().join(format!("bhippi-llm-hub-test-{}", std::process::id()));
        let library = root.join("library");
        std::fs::create_dir_all(&library).unwrap();
        let entry = serde_json::json!([{
            "id": "hf:unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_M", "name": "Qwen3.6-35B-A3B", "kind": "llm",
            "variants": [{ "id": "UD-Q4_K_M", "default": true, "files": [
                { "dest": "llm/hf_unsloth_Qwen3.6-35B-A3B-GGUF_UD-Q4_K_M/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf", "bytes": 22_134_528_992_u64 },
                { "dest": "llm/hf_unsloth_Qwen3.6-35B-A3B-GGUF_UD-Q4_K_M/mmproj-F16.gguf", "bytes": 899_283_680_u64 } ] }]
        }, { "broken": true }]);
        std::fs::write(library.join("hub-models.json"), entry.to_string()).unwrap();
        let found = find_entry(&root, "hf:unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_M").expect("the added model is found");
        assert_eq!(found.variants.len(), 1);
        assert!(!is_tuned(&found, &found.variants[0]), "added models are fitted by llama.cpp");
        let (weights, projector) = weight_sizes(&found.variants[0]);
        assert!((weights - 20.6).abs() < 0.1 && (projector - 0.84).abs() < 0.01, "{weights} {projector}");
        assert!(find_entry(&root, "hf:nobody/none:Q4_0").is_none());
        // A pick of Bhippi's own is found without the file, and is tuned.
        let pick = find_entry(&root, "qwen3.5-35b-a3b").unwrap();
        assert!(is_tuned(&pick, &pick.variants[0]));
        let _ignored = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn picture_readers_are_recognised_and_kept_out_of_the_weights() {
        assert!(is_projector("llm/gemma-4-12b/mmproj-F16.gguf"));
        assert!(is_projector("llm/x/MMPROJ-model-f16.gguf"));
        assert!(!is_projector("llm/x/model-Q4_K_M.gguf"));
        let entry = catalog().iter().find(|entry| entry.id == "qwen3.6-35b-a3b").unwrap();
        let variant = default_variant(entry);
        let shape = shape_of(entry, variant).unwrap();
        assert!(shape.projector_gb > 0.8 && shape.projector_gb < 0.9, "{}", shape.projector_gb);
        assert!(shape.file_gb > 20.0 && shape.file_gb < 21.0, "{}", shape.file_gb);
        let without = ModelShape { projector_gb: 0.0, ..shape.clone() };
        let tight = pc(6.0, 64.0, "RTX 3060");
        assert!(plan(&shape, &tight, None).cpu_moe_blocks >= plan(&without, &tight, None).cpu_moe_blocks, "the picture reader takes video memory");
    }

    #[test]
    fn the_pinned_runtime_matches_the_release() {
        assert_eq!(pack_url(&PACK_CUDA), "https://github.com/ggml-org/llama.cpp/releases/download/b11703/llama-b11703-bin-win-cuda-12.4-x64.zip");
        assert_eq!(pack_url(&PACK_CUDART), "https://github.com/ggml-org/llama.cpp/releases/download/b11703/cudart-llama-bin-win-cuda-12.4-x64.zip");
        assert_eq!(pack_url(&PACK_CPU), "https://github.com/ggml-org/llama.cpp/releases/download/b11703/llama-b11703-bin-win-cpu-x64.zip");
        for pack in [&PACK_CUDA, &PACK_CUDART, &PACK_CPU] {
            assert_eq!(pack.sha256.len(), 64);
            assert!(pack.sha256.chars().all(|c| c.is_ascii_hexdigit()));
        }
        assert_eq!(packs(true).len(), 2);
        assert_eq!(packs(false).len(), 1);
        // The sums and sizes are the release's own asset digests (gh api releases/tags/b11703), and the build is one that knows the speed-up flags.
        assert_eq!(LLAMA_TAG, "b11703");
        assert_eq!(PACK_CUDA.sha256, "2f93aa90c8ec23b18ea7935e6e734514f2cf71a5f03130c060a8c65e46037b2b");
        assert_eq!(PACK_CUDA.bytes, 266_832_389);
        assert_eq!(PACK_CUDART.sha256, "8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6");
        assert_eq!(PACK_CPU.sha256, "cf3050ac140fb9d8c726cdea5e3c16b1879c86e41443aabb84c948e9e100b9de");
        assert_eq!(PACK_CPU.bytes, 19_610_655);
        assert!(PACK_CUDA.name.contains("cuda-12.4") && PACK_CUDART.name.contains("cuda-12.4"), "the CUDA 12.4 build with its cudart package");
        assert!(supports_speedups(LLAMA_TAG));
    }

    #[test]
    fn build_numbers_decide_which_flags_are_safe() {
        assert_eq!(build_number("b11703"), Some(11_703));
        assert_eq!(build_number("11703"), None);
        assert_eq!(build_number("bnext"), None);
        assert!(supports_speedups("b11700"));
        assert!(!supports_speedups("b11699"));
        assert!(!supports_speedups("b6000"));
        assert!(!supports_speedups("weird"));
    }

    #[test]
    fn an_older_install_is_found_and_replaced_by_the_pinned_build() {
        let root = std::env::temp_dir().join(format!("bhippi-llm-runtime-{}", std::process::id()));
        let _ignored = std::fs::remove_dir_all(&root);
        assert_eq!(runtime_state(installed_marker(&root).as_ref(), true), RuntimeState::Missing, "nothing installed");
        let dir = runtime_dir(&root);
        std::fs::create_dir_all(&dir).unwrap();
        // A marker without its server program is not an install.
        std::fs::write(marker_file(&root), r#"{"tag":"b11700","cuda":true}"#).unwrap();
        assert_eq!(runtime_state(installed_marker(&root).as_ref(), true), RuntimeState::Missing);
        std::fs::write(server_exe(&root), b"x").unwrap();
        let old = installed_marker(&root).unwrap();
        assert_eq!(old.tag, "b11700");
        assert_eq!(runtime_state(Some(&old), true), RuntimeState::Outdated, "b11700 is replaced by the pinned build");
        assert!(supports_speedups(&old.tag), "b11700 already has the flags, so it keeps working until the update");
        // The pinned build for a PC with a card is current; the CUDA build on a PC without one is not.
        std::fs::write(marker_file(&root), format!(r#"{{"tag":"{LLAMA_TAG}","cuda":true}}"#)).unwrap();
        assert_eq!(runtime_state(installed_marker(&root).as_ref(), true), RuntimeState::Current);
        assert_eq!(runtime_state(installed_marker(&root).as_ref(), false), RuntimeState::Outdated);
        let _ignored = std::fs::remove_dir_all(&root);
    }

    fn big_plan() -> LlmPlan {
        plan(&model("qwen3.5-35b-a3b", "q4"), &rtx3080(), None)
    }

    fn after(args: &[String], flag: &str) -> Option<String> {
        args.iter().position(|arg| arg == flag).and_then(|at| args.get(at + 1)).cloned()
    }

    #[test]
    fn every_start_keeps_one_warm_slot_with_a_prompt_cache() {
        let args = server_args(Path::new("m.gguf"), "x", &big_plan(), Tuning::Planned { moe: true }, None, 1);
        assert_eq!(after(&args, "--parallel").as_deref(), Some("1"));
        assert_eq!(after(&args, "--cache-reuse").as_deref(), Some("256"));
        assert_eq!(after(&args, "--cache-ram").as_deref(), Some("1024"));
        assert!(args.contains(&"--metrics".to_owned()));
        // The plan alone: no expert cache, no batch size, no speculation.
        for flag in ["--moe-cache-mib", "-ub", "--spec-type", "-md"] {
            assert!(!args.contains(&flag.to_owned()), "{flag} must not be there: {args:?}");
        }
        assert_eq!(speedups_in(&args), vec!["Prompt cache"]);
        // The port stays last, as before.
        assert_eq!(args[args.len() - 2], "--port");
    }

    #[test]
    fn tuned_values_replace_the_plans_and_switch_the_speed_ups_on() {
        let plan = big_plan();
        let speed = Speedups { cpu_moe_blocks: Some(plan.cpu_moe_blocks + 3), moe_cache_mib: 1024, ubatch: 1024, speculative: Some(Speculation::Mtp) };
        let args = server_args_with(Path::new("m.gguf"), "x", &plan, Tuning::Planned { moe: true }, None, 5, &speed);
        assert_eq!(after(&args, "--n-cpu-moe"), Some((plan.cpu_moe_blocks + 3).to_string()));
        assert_eq!(after(&args, "--moe-cache-mib").as_deref(), Some("1024"));
        assert_eq!(after(&args, "-ub").as_deref(), Some("1024"));
        assert_eq!(after(&args, "--spec-type").as_deref(), Some("draft-mtp"));
        assert!(!args.contains(&"-md".to_owned()), "MTP drafts with the model's own head, no second file");
        assert_eq!(after(&args, "--parallel").as_deref(), Some("1"), "MTP needs a single slot");
        assert_eq!(speedups_in(&args), vec!["Expert cache", "MTP", "Prompt cache"]);
        // A Speedups with no block override keeps the plan's own count.
        let same = server_args_with(Path::new("m.gguf"), "x", &plan, Tuning::Planned { moe: true }, None, 5, &Speedups { moe_cache_mib: 512, ..Speedups::default() });
        assert_eq!(after(&same, "--n-cpu-moe"), Some(plan.cpu_moe_blocks.to_string()));
    }

    #[test]
    fn the_eagle3_helper_is_a_draft_model_kept_on_the_gpu() {
        let speed = Speedups { speculative: Some(Speculation::Eagle3 { draft: PathBuf::from("D:/m/eagle3.gguf") }), ..Speedups::default() };
        let args = server_args_with(Path::new("m.gguf"), "x", &big_plan(), Tuning::Planned { moe: true }, None, 5, &speed);
        assert_eq!(after(&args, "--spec-type").as_deref(), Some("draft-eagle3"));
        assert_eq!(after(&args, "-md").as_deref(), Some("D:/m/eagle3.gguf"));
        assert_eq!(after(&args, "--spec-draft-ngl").as_deref(), Some("999"));
        assert_eq!(speedups_in(&args), vec!["EAGLE3 helper", "Prompt cache"]);
        assert_eq!(Speculation::Mtp.kind(), "mtp");
        assert_eq!(speed.speculative.as_ref().unwrap().kind(), "eagle3");
    }

    #[test]
    fn the_expert_cache_needs_experts_in_ram_and_a_planned_split() {
        let speed = Speedups { moe_cache_mib: 2048, ..Speedups::default() };
        let has_cache = |plan: &LlmPlan, tuning: Tuning| server_args_with(Path::new("m.gguf"), "x", plan, tuning, None, 1, &speed).contains(&"--moe-cache-mib".to_owned());
        // Everything on the GPU: nothing to cache.
        let all = plan(&model("qwen3.5-35b-a3b", "q4"), &pc(48.0, 64.0, "RTX 6000"), None);
        assert!(!has_cache(&all, Tuning::Planned { moe: true }));
        // A dense model has no experts.
        let dense = plan(&model("qwen3.5-9b", "q4"), &rtx3080(), None);
        assert!(!has_cache(&dense, Tuning::Planned { moe: false }));
        // llama.cpp's own fitting decides the split of an added model: no cache flag there either.
        assert!(!has_cache(&big_plan(), Tuning::Fitted));
        assert!(has_cache(&big_plan(), Tuning::Planned { moe: true }));
    }

    #[test]
    fn mtp_sizes_are_real_files_next_to_the_plain_ones() {
        let is_mtp = |variant: &CatalogVariant| variant.llm.as_ref().is_some_and(|shape| shape.speculative.as_deref() == Some("mtp"));
        let mut found = 0;
        for entry in catalog() {
            for variant in entry.variants.iter().filter(|variant| is_mtp(variant)) {
                found += 1;
                assert!(variant.id.ends_with("-mtp") && !variant.default, "{}/{}: an MTP size is offered, never the default", entry.id, variant.id);
                let weights = variant.files.iter().find(|file| !is_projector(&file.dest)).unwrap();
                assert!(weights.dest.ends_with("-MTP.gguf"), "{}: its own file name, so it never overwrites the plain one", weights.dest);
                let plain = entry.variants.iter().find(|candidate| candidate.id == variant.id.trim_end_matches("-mtp")).expect("the plain size it sits next to");
                assert_eq!(variant.llm.as_ref().unwrap().total_params_b, plain.llm.as_ref().unwrap().total_params_b);
                let plain_weights = plain.files.iter().find(|file| !is_projector(&file.dest)).unwrap();
                assert!(weights.bytes > plain_weights.bytes && weights.bytes < plain_weights.bytes * 110 / 100, "{}: the head adds a little", entry.id);
                // The picture reader is shared with the plain size, not downloaded twice.
                let projector = |v: &CatalogVariant| v.files.iter().find(|file| is_projector(&file.dest)).map(|file| (file.dest.clone(), file.bytes));
                assert_eq!(projector(variant), projector(plain), "{}", entry.id);
            }
        }
        assert_eq!(found, 7, "Qwen3.6 35B (2), Qwen3.5 35B (2), 9B, 4B and 122B");
        // The Model Library reads the same marker from the same file.
        let raw: Vec<crate::model_library::LibraryEntry> = serde_json::from_str(CATALOG_JSON).unwrap();
        let marked = raw.iter().flat_map(|entry| entry.variants.iter()).filter(|variant| variant.llm.as_ref().is_some_and(|shape| shape.speculative.as_deref() == Some("mtp"))).count();
        assert_eq!(marked, 7);
    }

    #[test]
    fn the_big_gpt_oss_has_an_eagle3_helper_as_an_optional_download() {
        let entry = catalog().iter().find(|entry| entry.id == "gpt-oss-120b").unwrap();
        let addon = entry.addons.iter().find(|addon| addon.id == "eagle3").expect("eagle3 helper");
        assert_eq!(addon.files.len(), 1);
        assert_eq!((addon.files[0].bytes, addon.files[0].dest.as_str()), (849_103_296, "llm/gpt-oss-120b/eagle3-gpt-oss-120b-Q8_0.gguf"));
        // Absent on disk: no helper, so speculation stays off however a stored result reads.
        assert!(tune::eagle3_file(entry, Path::new("D:/none")).is_none());
        assert_eq!(catalog().iter().filter(|other| other.id != "gpt-oss-120b" && !other.addons.is_empty()).count(), 0);
    }

    #[test]
    fn a_failed_start_with_an_unknown_flag_points_at_the_update() {
        let log = std::env::temp_dir().join(format!("bhippi-llm-log-{}.txt", std::process::id()));
        std::fs::write(&log, "error: invalid argument: --moe-cache-mib\n").unwrap();
        assert!(explain_failure(&log).contains("Update the runtime"));
        let _ignored = std::fs::remove_file(&log);
    }

    #[test]
    fn reads_nvidia_memory_and_names_with_commas() {
        assert_eq!(parse_nvidia_memory("NVIDIA GeForce RTX 3080, 10240, 9120\n"), Some(("NVIDIA GeForce RTX 3080".to_owned(), 10.0, 9120.0 / 1024.0)));
        assert_eq!(parse_nvidia_memory("Weird, Name Card, 8192, 100").map(|(name, ..)| name), Some("Weird, Name Card".to_owned()));
        assert_eq!(parse_nvidia_memory("  "), None);
        assert_eq!(parse_nvidia_memory("RTX, [N/A], [N/A]"), None);
    }

    #[test]
    fn our_own_server_holds_video_memory_so_free_is_not_trusted() {
        let machine = Machine { gpu_name: Some("RTX 3080".into()), vram_total_gb: 10.0, vram_free_gb: 2.0, ram_gb: 64.0 };
        assert!((pc_from(&machine, true).vram_gb - 9.2).abs() < 1e-9);
        assert!((pc_from(&machine, false).vram_gb - 2.0).abs() < 1e-9);
        let idle = Machine { gpu_name: Some("RTX 3080".into()), vram_total_gb: 10.0, vram_free_gb: 10.0, ram_gb: 64.0 };
        assert!((pc_from(&idle, false).vram_gb - 9.7).abs() < 1e-9);
    }

    #[test]
    fn words_and_notes_read_plainly() {
        assert_eq!(words((16.0, 27.0)), "about 12\u{2013}20 words a second");
        assert_eq!(words((1.0, 1.0)), "about 1 word a second");
        assert_eq!(words((8.0, 8.0)), "about 6 words a second");
        assert_eq!(context_label(16_384), "16K");
        assert_eq!(context_label(3_000), "3000");
    }
}
