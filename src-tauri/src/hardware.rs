//! Read-only local hardware inventory. Missing measurements stay null.
//!
//! `usage` is polled every few seconds by the header monitor, so it is kept to one PowerShell
//! process for the system numbers with `nvidia-smi` running beside it. A machine without
//! NVIDIA's tool pays for one more PowerShell call that reads the 3D-engine counters instead,
//! which gives a utilisation figure but no VRAM or temperature.
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::time::Duration;

const NVIDIA_QUERY: &str = "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu";
const NVIDIA_FORMAT: &str = "--format=csv,noheader,nounits";

pub async fn usage(folder: &std::path::Path) -> Result<Value, String> {
    #[cfg(windows)]
    {
        // Processes are the app's own tree: this PID and everything descended from it, most
        // memory first. Drives are every fixed disk; the one holding the data folder is the
        // "models" drive and is also reported through the older flat fields. Disk activity is
        // how busy each physical disk is (its active time, as Task Manager shows it), not how full
        // it is: the raw counters go out as text (they pass 2^53) and `disk_activity` turns two
        // readings into a share of the time between them.
        let script = format!(
            r#"$ErrorActionPreference='Stop'; $os=Get-CimInstance Win32_OperatingSystem; $cpu=Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'"; $drive=[IO.Path]::GetPathRoot($env:BHIPPI_DATA_FOLDER).TrimEnd('\'); $fixed=@(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3'); $disk=$fixed | Where-Object DeviceID -eq $drive; $raw=@(Get-CimInstance Win32_PerfRawData_PerfDisk_PhysicalDisk | Where-Object Name -ne '_Total' | ForEach-Object {{ [pscustomobject]@{{name=$_.Name;idle=[string]$_.PercentIdleTime;stamp=[string]$_.Timestamp_Sys100NS}} }}); $io=$null; try {{ $perf=Get-CimInstance Win32_PerfFormattedData_PerfDisk_LogicalDisk -Filter "Name='$drive'"; if($perf) {{ $io=[math]::Round([math]::Min(100,[math]::Max(0,100-[double]$perf.PercentIdleTime)),0) }} }} catch {{}}; $drives=@($fixed | ForEach-Object {{ [pscustomobject]@{{letter=$_.DeviceID.TrimEnd(':');freeGb=[math]::Round($_.FreeSpace/1GB,1);totalGb=[math]::Round($_.Size/1GB,1);role=$(if($_.DeviceID -eq $drive){{'models'}}else{{$null}})}} }}); $all=@(Get-CimInstance Win32_Process); $ids=[Collections.Generic.HashSet[int]]::new(); [void]$ids.Add({}); do {{ $added=$false; foreach($p in $all) {{ if($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)) {{ $added=$true }} }} }} while($added); $children=@($all | Where-Object {{ $ids.Contains([int]$_.ProcessId) }} | ForEach-Object {{ [pscustomobject]@{{name=$_.Name;pid=$_.ProcessId;ramGb=[math]::Round([double]$_.WorkingSetSize/1GB,3)}} }} | Sort-Object -Property ramGb -Descending); [pscustomobject]@{{cpuPercent=$cpu.PercentProcessorTime;ramTotalGb=[math]::Round($os.TotalVisibleMemorySize/1MB,1);ramUsedGb=[math]::Round(($os.TotalVisibleMemorySize-$os.FreePhysicalMemory)/1MB,1);diskFreeGb=[math]::Round($disk.FreeSpace/1GB,1);diskTotalGb=[math]::Round($disk.Size/1GB,1);diskActivityPercent=$io;diskRaw=$raw;drive=$drive;drives=$drives;processes=$children}} | ConvertTo-Json -Depth 4 -Compress"#,
            std::process::id()
        );
        let powershell_args = ["-NoProfile", "-NonInteractive", "-Command", script.as_str()];
        let (system, nvidia) = tokio::join!(
            output("powershell.exe", &powershell_args, folder),
            output("nvidia-smi", &[NVIDIA_QUERY, NVIDIA_FORMAT], folder),
        );
        let data = system.ok_or("Resource measurements unavailable")?;
        let mut value: Value = serde_json::from_str(data.trim_start_matches('\u{feff}').trim()).map_err(|e| e.to_string())?;
        if !value.is_object() {
            return Err("Resource measurements malformed".into());
        }
        // ConvertTo-Json hands back a bare object for a one-item list in some shells; the UI
        // always wants arrays here.
        for key in ["processes", "drives", "diskRaw"] {
            if !value[key].is_array() {
                let single = value[key].take();
                value[key] = if single.is_object() { json!([single]) } else { json!([]) };
            }
        }
        // The busiest disk over the time since the last reading; the first reading keeps the
        // models drive's instant figure.
        let disks = disk_activity(value["diskRaw"].take());
        if let Some(busiest) = disks.iter().max_by(|a, b| a.1.total_cmp(&b.1)) {
            value["diskActivityPercent"] = json!(busiest.1.round());
            value["diskActivityDrive"] = json!(busiest.0);
        }
        value["disks"] = json!(disks.iter().map(|(name, active)| json!({"name": name, "activityPercent": active.round()})).collect::<Vec<_>>());
        value["gpu"] = match nvidia.as_deref().and_then(parse_nvidia) {
            Some(gpu) => gpu,
            None => counter_gpu(folder).await,
        };
        Ok(value)
    }
    #[cfg(not(windows))]
    {
        let _ = folder;
        Err("Resource measurements unavailable on this platform".into())
    }
}

/// The last raw reading of each physical disk: (idle time, timestamp), both in 100 ns ticks.
static DISK_READINGS: std::sync::Mutex<BTreeMap<String, (u64, u64)>> = std::sync::Mutex::new(BTreeMap::new());

/// How busy a disk was between two raw readings of (idle time, timestamp): the share of the time
/// it was not idle, in percent. None when no time passed or the counters went back (a reset).
fn active_percent(before: (u64, u64), now: (u64, u64)) -> Option<f64> {
    let elapsed = now.1.checked_sub(before.1).filter(|&ticks| ticks > 0)?;
    let idle = now.0.checked_sub(before.0)?;
    Some((100.0 - 100.0 * idle as f64 / elapsed as f64).clamp(0.0, 100.0))
}

/// Each physical disk's activity since the last reading, by its drive letters ("C:", or "D: E:"
/// for a disk with two volumes). Remembers this reading for the next one.
fn disk_activity(raw: Value) -> Vec<(String, f64)> {
    let Value::Array(entries) = raw else { return Vec::new() };
    let mut readings = DISK_READINGS.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let mut out = Vec::new();
    for entry in entries {
        let text = |key: &str| entry[key].as_str().and_then(|value| value.trim().parse::<u64>().ok()).or_else(|| entry[key].as_u64());
        let (Some(name), Some(idle), Some(stamp)) = (entry["name"].as_str(), text("idle"), text("stamp")) else { continue };
        // "2 C:" is disk 2 holding C:; a disk with no letter keeps its number.
        let letters = name.split_whitespace().filter(|part| part.ends_with(':')).collect::<Vec<_>>().join(" ");
        let label = if letters.is_empty() { format!("Disk {}", name.trim()) } else { letters };
        if let Some(active) = readings.get(name).and_then(|&before| active_percent(before, (idle, stamp))) {
            out.push((label, active));
        }
        readings.insert(name.to_owned(), (idle, stamp));
    }
    out
}

/// One `nvidia-smi` CSV line → `{name, utilPercent, vramUsedMb, vramTotalMb, tempC}`. Fields it
/// cannot measure come back as `[N/A]` or `[Not Supported]`, which turn into null rather than
/// failing the whole reading. The name is whatever is left of the last four commas, so a comma
/// inside it does not shift the numbers.
#[cfg(windows)]
fn parse_nvidia(text: &str) -> Option<Value> {
    let line = text.lines().map(str::trim).find(|line| !line.is_empty())?;
    let mut fields = line.rsplitn(5, ',').map(str::trim);
    let temp = number(fields.next()?);
    let vram_total = number(fields.next()?);
    let vram_used = number(fields.next()?);
    let util = number(fields.next()?);
    let name = fields.next()?;
    if name.is_empty() {
        return None;
    }
    Some(json!({"name": name, "utilPercent": util, "vramUsedMb": vram_used, "vramTotalMb": vram_total, "tempC": temp}))
}

#[cfg(windows)]
fn number(field: &str) -> Value {
    field.parse::<f64>().map_or(Value::Null, Value::from)
}

/// The non-NVIDIA reading: Windows' own per-engine GPU counters summed over the 3D engines,
/// which is what Task Manager shows, and the adapter name from WMI. Null when neither answers.
#[cfg(windows)]
async fn counter_gpu(folder: &std::path::Path) -> Value {
    // Task Manager's figure: each engine type's use summed over processes, the busiest type.
    const SCRIPT: &str = r#"$ErrorActionPreference='SilentlyContinue'; $name=(Get-CimInstance Win32_VideoController | Select-Object -First 1 -ExpandProperty Name); $util=$null; try { $samples=(Get-Counter '\GPU Engine(*)\Utilization Percentage' -ErrorAction Stop).CounterSamples; $max=($samples | Group-Object { ($_.InstanceName -split '_engtype_')[1] } | ForEach-Object { ($_.Group | Measure-Object -Property CookedValue -Sum).Sum } | Measure-Object -Maximum).Maximum; if($null -ne $max){ $util=[math]::Round([math]::Min(100,[math]::Max(0,[double]$max)),0) } } catch {}; [pscustomobject]@{name=$name;utilPercent=$util} | ConvertTo-Json -Compress"#;
    let Some(data) = output("powershell.exe", &["-NoProfile", "-NonInteractive", "-Command", SCRIPT], folder).await else {
        return Value::Null;
    };
    let Ok(measured) = serde_json::from_str::<Value>(data.trim_start_matches('\u{feff}').trim()) else {
        return Value::Null;
    };
    if measured["name"].is_null() && measured["utilPercent"].is_null() {
        return Value::Null;
    }
    json!({"name": measured["name"], "utilPercent": measured["utilPercent"], "vramUsedMb": null, "vramTotalMb": null, "tempC": null})
}

async fn output(program: &str, args: &[&str], folder: &std::path::Path) -> Option<String> {
    let mut command = tokio::process::Command::new(program);
    command.args(args).env("BHIPPI_DATA_FOLDER", folder).kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let output = tokio::time::timeout(Duration::from_secs(8), command.output()).await.ok()?.ok()?;
    if !output.status.success() || output.stdout.len() > 65536 {
        return None;
    }
    String::from_utf8(output.stdout).ok()
}

pub async fn inspect(folder: &std::path::Path) -> Value {
    let mut info = json!({"os":std::env::consts::OS,"architecture":std::env::consts::ARCH,"threads":std::thread::available_parallelism().map_or(1,usize::from),"cpu":null,"ramGb":null,"diskFreeGb":null,"gpus":[],"adapters":[],"nvidia":[]});
    #[cfg(windows)]
    {
        // `adapters` carries each display adapter's dedicated memory. WMI's AdapterRAM is a 32-bit
        // field that tops out at 4 GB, so the size comes from the driver's own 64-bit
        // `HardwareInformation.qwMemorySize` in the display class key, with AdapterRAM only as a
        // fallback. Integrated GPUs report a small carve-out (or nothing) here, which is right:
        // they borrow system RAM and cannot hold a video model.
        let script = r#"$ErrorActionPreference='Stop'; $os=Get-CimInstance Win32_OperatingSystem; $cpu=Get-CimInstance Win32_Processor; $drive=[IO.Path]::GetPathRoot($env:BHIPPI_DATA_FOLDER).TrimEnd('\'); $disk=Get-CimInstance Win32_LogicalDisk | Where-Object DeviceID -eq $drive; $reg=@{}; try { Get-ChildItem 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}' -ErrorAction SilentlyContinue | ForEach-Object { $p=Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue; if($p -and $p.DriverDesc -and $p.'HardwareInformation.qwMemorySize'){ $reg[[string]$p.DriverDesc]=[double]$p.'HardwareInformation.qwMemorySize' } } } catch {}; $adapters=@(Get-CimInstance Win32_VideoController | ForEach-Object { $bytes=if($reg.ContainsKey([string]$_.Name)){$reg[[string]$_.Name]}else{[double]$_.AdapterRAM}; [pscustomobject]@{name=$_.Name;vramMb=if($bytes -gt 0){[math]::Round($bytes/1MB)}else{$null};driver=$_.DriverVersion} }); [pscustomobject]@{cpu=($cpu.Name -join ', ');ramGb=[math]::Round($os.TotalVisibleMemorySize/1MB,1);diskFreeGb=if($disk){[math]::Round($disk.FreeSpace/1GB,1)}else{$null};gpus=@($adapters | ForEach-Object name);adapters=$adapters} | ConvertTo-Json -Depth 3 -Compress"#;
        if let Some(data) = output("powershell.exe", &["-NoProfile", "-NonInteractive", "-Command", script], folder).await {
            if let Ok(measured) = serde_json::from_str::<Value>(data.trim_start_matches('\u{feff}').trim()) {
                for key in ["cpu", "ramGb", "diskFreeGb", "gpus", "adapters"] {
                    info[key] = measured[key].clone();
                }
                for key in ["gpus", "adapters"] {
                    if !info[key].is_array() {
                        let single = info[key].take();
                        info[key] = if single.is_null() { json!([]) } else { json!([single]) };
                    }
                }
            }
        }
    }
    // compute_cap says which precisions the card runs natively (8.0+ has bf16, which the video
    // models are published in); driver_version tells whether current CUDA wheels will load.
    if let Some(data) = output("nvidia-smi", &["--query-gpu=name,memory.total,compute_cap,driver_version", NVIDIA_FORMAT], folder).await {
        info["nvidia"] = Value::Array(data.lines().filter_map(parse_nvidia_card).collect());
    } else if let Some(data) = output("nvidia-smi", &["--query-gpu=name,memory.total", NVIDIA_FORMAT], folder).await {
        // Older drivers do not know compute_cap and reject the whole query.
        info["nvidia"] = Value::Array(data.lines().filter_map(parse_nvidia_card).collect());
    }
    info
}

/// `name, memory.total[, compute_cap, driver_version]` → `{name, vramMb, computeCap, driver}`.
/// The name is whatever precedes the numeric fields, so a comma inside it cannot shift them.
fn parse_nvidia_card(line: &str) -> Option<Value> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    let parts: Vec<&str> = line.split(',').map(str::trim).collect();
    // Find the memory column: the first field from the right-hand group that parses as an integer.
    let (name, vram, cap, driver) = if parts.len() >= 4 && parts[parts.len() - 3].parse::<u64>().is_ok() {
        let n = parts.len();
        (parts[..n - 3].join(","), parts[n - 3], parts[n - 2], parts[n - 1])
    } else if parts.len() >= 2 {
        let n = parts.len();
        (parts[..n - 1].join(","), parts[n - 1], "", "")
    } else {
        return None;
    };
    let mb = vram.parse::<u64>().ok()?;
    let cap = cap.parse::<f64>().ok();
    Some(json!({"name": name.trim(), "vramMb": mb, "computeCap": cap, "driver": (!driver.is_empty() && driver != "[N/A]").then_some(driver)}))
}

#[cfg(test)]
mod tests {
    use super::parse_nvidia_card;

    #[test]
    fn disk_activity_is_the_busy_share_of_the_time_between_readings() {
        // 3 s apart (in 100 ns ticks), idle for 2.4 s of them: 20 % busy.
        assert_eq!(super::active_percent((1_000, 5_000), (24_001_000, 30_005_000)).map(f64::round), Some(20.0));
        // Never idle is 100 %, all idle is 0 %; no time, or counters that went back, say nothing.
        assert_eq!(super::active_percent((0, 0), (0, 10)), Some(100.0));
        assert_eq!(super::active_percent((0, 0), (10, 10)), Some(0.0));
        assert_eq!(super::active_percent((0, 10), (0, 10)), None);
        assert_eq!(super::active_percent((50, 0), (10, 10)), None);
    }

    #[test]
    fn each_disk_is_named_by_its_letters_from_the_second_reading_on() {
        // Raw counters pass 2^53, so they come as text.
        let first = serde_json::json!([{ "name": "7 Q:", "idle": "100000000000000000", "stamp": "200000000000000000" }, { "name": "8", "idle": "0", "stamp": "0" }]);
        assert!(super::disk_activity(first).is_empty(), "one reading is not an activity yet");
        let second = serde_json::json!([{ "name": "7 Q:", "idle": "100000000015000000", "stamp": "200000000030000000" }, { "name": "8", "idle": "30000000", "stamp": "30000000" }]);
        let disks = super::disk_activity(second);
        assert_eq!(disks.len(), 2);
        assert_eq!(disks[0].0, "Q:");
        assert_eq!(disks[0].1.round(), 50.0);
        assert_eq!(disks[1], ("Disk 8".to_owned(), 0.0));
    }

    #[test]
    fn reads_nvidia_cards_with_and_without_capability() {
        let full = parse_nvidia_card("NVIDIA GeForce RTX 4070, 12282, 8.9, 566.36").unwrap();
        assert_eq!(full["vramMb"], 12282);
        assert_eq!(full["computeCap"], 8.9);
        assert_eq!(full["driver"], "566.36");
        let old = parse_nvidia_card("Quadro P2000, 5120").unwrap();
        assert_eq!(old["name"], "Quadro P2000");
        assert!(old["computeCap"].is_null());
        assert!(parse_nvidia_card("  ").is_none());
    }
}
