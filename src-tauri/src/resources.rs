//! How much of this PC Bhippi's heavy work may use: a share of the processor and of the memory,
//! 75% each unless the user picks otherwise (Settings › Performance). The heavy programs Bhippi
//! starts (llama.cpp, ComfyUI, Blender, FFmpeg, Strata, the Python workers) are held to it, so the
//! mouse, the browser and the rest of the PC stay usable while a model loads or a render runs.

use std::sync::RwLock;

/// The share used when the user has not chosen one.
pub const DEFAULT_PERCENT: u8 = 75;
/// The lowest share the user can pick; below it nothing heavy runs well.
pub const MIN_PERCENT: u8 = 25;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ResourceLimits {
    /// 25–100.
    pub cpu_percent: u8,
    /// 25–100.
    pub ram_percent: u8,
    /// Logical processors on this PC.
    pub total_threads: usize,
    /// Physical memory on this PC, bytes (0 when unknown).
    pub total_ram_bytes: u64,
}

impl ResourceLimits {
    /// Threads a heavy program may use: the CPU share of this PC's threads, at least one.
    pub fn threads(&self) -> usize {
        ((self.total_threads as f64 * f64::from(self.cpu_percent) / 100.0).floor() as usize).clamp(1, self.total_threads.max(1))
    }

    /// Memory the heavy programs may use together, bytes (0 when the PC's memory is unknown).
    pub fn ram_bytes(&self) -> u64 {
        (self.total_ram_bytes as f64 * f64::from(self.ram_percent) / 100.0) as u64
    }

    /// The same, in GB (10^9 bytes, as the model sizes are shown).
    pub fn ram_gb(&self) -> f64 {
        self.ram_bytes() as f64 / 1e9
    }
}

fn clamp_percent(value: Option<u8>) -> u8 {
    value.unwrap_or(DEFAULT_PERCENT).clamp(MIN_PERCENT, 100)
}

/// The limits for the settings' shares on a PC with this many threads and this much memory.
pub fn limits_for(cpu_percent: Option<u8>, ram_percent: Option<u8>, total_threads: usize, total_ram_bytes: u64) -> ResourceLimits {
    ResourceLimits { cpu_percent: clamp_percent(cpu_percent), ram_percent: clamp_percent(ram_percent), total_threads: total_threads.max(1), total_ram_bytes }
}

static CURRENT: RwLock<Option<ResourceLimits>> = RwLock::new(None);

/// The limits in force (the defaults on this PC until `set` is called from the settings).
pub fn current() -> ResourceLimits {
    if let Some(limits) = CURRENT.read().ok().and_then(|guard| *guard) {
        return limits;
    }
    limits_for(None, None, std::thread::available_parallelism().map_or(1, usize::from), 0)
}

/// Records new limits (at start and whenever the settings change) and applies them to the job, so
/// the programs already running follow them at once.
pub fn set(limits: ResourceLimits) {
    if let Ok(mut guard) = CURRENT.write() {
        *guard = Some(limits);
    }
    apply_to_job(limits);
}

/// The job's processor rate for a share, in hundredths of a percent.
pub fn cpu_rate(limits: &ResourceLimits) -> u32 {
    (u32::from(limits.cpu_percent) * 100).clamp(100, 10_000)
}

/// The job's memory limit in bytes, 0 for none: unknown memory or the whole PC is not a limit.
pub fn memory_limit(limits: &ResourceLimits) -> u64 {
    if limits.ram_percent >= 100 {
        0
    } else {
        limits.ram_bytes()
    }
}

fn apply_to_job(limits: ResourceLimits) {
    if let Err(error) = bhippi_job::apply(cpu_rate(&limits), memory_limit(&limits)) {
        tracing::warn!("could not apply the processor and memory limits: {error}");
    }
}

/// This PC's logical processors and physical memory in bytes (0 when unknown).
pub fn machine() -> (usize, u64) {
    (std::thread::available_parallelism().map_or(1, usize::from), bhippi_job::total_memory())
}

/// Computes the limits for the settings' shares on this PC, records and applies them.
pub fn apply_settings(cpu_percent: Option<u8>, ram_percent: Option<u8>) -> ResourceLimits {
    let (threads, ram) = machine();
    let limits = limits_for(cpu_percent, ram_percent, threads, ram);
    set(limits);
    limits
}

/// Makes sure the job holds the limits before the first program joins it (when the settings have
/// not been applied yet).
fn ensure_applied() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        if CURRENT.read().ok().and_then(|guard| *guard).is_none() {
            apply_settings(None, None);
        }
    });
}

/// Holds a started program (llama-server, ComfyUI, Blender, FFmpeg, a Python worker) to the limits.
/// A failure is logged and never stops the program from running.
pub fn contain(child: &tokio::process::Child) {
    #[cfg(windows)]
    if let Some(handle) = child.raw_handle() {
        contain_handle(handle as usize, child.id());
    }
    #[cfg(not(windows))]
    let _ = child;
}

/// The same for a program started with `std::process`.
pub fn contain_std(child: &std::process::Child) {
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        contain_handle(child.as_raw_handle() as usize, Some(child.id()));
    }
    #[cfg(not(windows))]
    let _ = child;
}

#[cfg(windows)]
fn contain_handle(handle: usize, pid: Option<u32>) {
    ensure_applied();
    if let Err(error) = bhippi_job::contain(handle) {
        tracing::warn!("process {pid:?} runs outside the resource limits: {error}");
    }
}

/// Caps the threads a Python or native worker starts by itself (numpy, torch, ONNX, ...).
pub fn limit_threads_env(command: &mut tokio::process::Command) {
    let threads = current().threads().to_string();
    for name in ["OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "TORCH_NUM_THREADS"] {
        command.env(name, &threads);
    }
}

/// The same for a `std::process` command.
pub fn limit_threads_env_std(command: &mut std::process::Command) {
    let threads = current().threads().to_string();
    for name in ["OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "TORCH_NUM_THREADS"] {
        command.env(name, &threads);
    }
}

/// "48 GB", or "47.5 GB" when it is not a whole number.
fn gb_text(bytes: u64) -> String {
    let gb = bytes as f64 / 1e9;
    if (gb - gb.round()).abs() < 0.05 {
        format!("{} GB", gb.round() as u64)
    } else {
        format!("{gb:.1} GB")
    }
}

/// What to tell the user when `program` was stopped by the memory limit.
pub fn memory_stop_text(program: &str, limits: &ResourceLimits) -> String {
    format!(
        "Bhippi stopped {program} because its work reached the {}% memory limit ({}) set in Settings › Performance. Raise the limit or pick a smaller model.",
        limits.ram_percent,
        gb_text(limits.ram_bytes())
    )
}

/// The message for a program that just died, when the job's memory limit was reached a moment ago.
pub fn memory_stop_message(program: &str) -> Option<String> {
    let limits = current();
    (memory_limit(&limits) > 0 && bhippi_job::memory_limit_hit_within(120)).then(|| memory_stop_text(program, &limits))
}

/// Replaces `error` with the memory-limit explanation when the limit stopped `program`.
pub fn explain_failure(program: &str, error: String) -> String {
    memory_stop_message(program).unwrap_or(error)
}

/// The limits and what the contained programs use now, for Settings › Performance.
pub fn status() -> serde_json::Value {
    let limits = current();
    let usage = bhippi_job::usage();
    serde_json::json!({
        "cpuPercent": limits.cpu_percent,
        "ramPercent": limits.ram_percent,
        "threads": limits.threads(),
        "totalThreads": limits.total_threads,
        "ramLimitBytes": limits.ram_bytes(),
        "totalRamBytes": limits.total_ram_bytes,
        "usedBytes": usage.map(|u| u.used_bytes),
        "peakBytes": usage.map(|u| u.peak_bytes),
        "processes": usage.map(|u| u.processes),
        "cpuSeconds": usage.map(|u| u.cpu_seconds),
        "memoryLimitHit": bhippi_job::memory_limit_hit_within(600),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_is_three_quarters_of_the_pc() {
        let limits = limits_for(None, None, 16, 64_000_000_000);
        assert_eq!((limits.cpu_percent, limits.ram_percent), (75, 75));
        assert_eq!(limits.threads(), 12);
        assert_eq!(limits.ram_bytes(), 48_000_000_000);
    }

    #[test]
    fn the_job_limits_follow_the_shares() {
        let limits = limits_for(None, None, 16, 64_000_000_000);
        assert_eq!(cpu_rate(&limits), 7500);
        assert_eq!(memory_limit(&limits), 48_000_000_000);
        let all = limits_for(Some(100), Some(100), 16, 64_000_000_000);
        assert_eq!((cpu_rate(&all), memory_limit(&all)), (10_000, 0));
        let unknown = limits_for(Some(50), Some(50), 8, 0);
        assert_eq!((cpu_rate(&unknown), memory_limit(&unknown)), (5000, 0));
    }

    #[test]
    fn the_memory_message_names_the_program_and_the_limit() {
        let limits = limits_for(None, None, 16, 64_000_000_000);
        assert_eq!(
            memory_stop_text("llama-server", &limits),
            "Bhippi stopped llama-server because its work reached the 75% memory limit (48 GB) set in Settings › Performance. Raise the limit or pick a smaller model."
        );
        assert!(memory_stop_text("Blender", &limits_for(Some(75), Some(60), 8, 31_900_000_000)).contains("(19.1 GB)"));
    }

    #[cfg(windows)]
    #[test]
    fn a_contained_program_joins_the_job() {
        use std::os::windows::process::CommandExt;
        let limits = apply_settings(Some(50), Some(50));
        let mut child = std::process::Command::new("ping").args(["-n", "4", "127.0.0.1"]).creation_flags(0x0800_0000).stdout(std::process::Stdio::null()).spawn().unwrap();
        contain_std(&child);
        let (rate, memory) = bhippi_job::read_limits().unwrap();
        assert_eq!(rate, cpu_rate(&limits));
        // Windows rounds the limit to a whole page.
        assert!(memory.abs_diff(memory_limit(&limits)) < 8192, "{memory} vs {}", memory_limit(&limits));
        assert!(bhippi_job::usage().unwrap().processes >= 1);
        let _ = child.kill();
    }

    #[test]
    fn shares_stay_between_a_quarter_and_all_and_keep_one_thread() {
        let limits = limits_for(Some(5), Some(200), 2, 8_000_000_000);
        assert_eq!((limits.cpu_percent, limits.ram_percent), (25, 100));
        assert_eq!(limits.threads(), 1);
    }
}
