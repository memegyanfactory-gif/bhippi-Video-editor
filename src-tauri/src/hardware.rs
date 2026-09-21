//! Read-only local hardware inventory. Missing measurements stay null.
//!
//! `usage` is polled every few seconds by the header monitor, so it is kept to one PowerShell
//! process for the system numbers with `nvidia-smi` running beside it. A machine without
//! NVIDIA's tool pays for one more PowerShell call that reads the 3D-engine counters instead,
//! which gives a utilisation figure but no VRAM or temperature.
use serde_json::{json, Value};
use std::time::Duration;

const NVIDIA_QUERY: &str = "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu";
const NVIDIA_FORMAT: &str = "--format=csv,noheader,nounits";

pub async fn usage(folder: &std::path::Path) -> Result<Value, String> {
    #[cfg(windows)]
    {
        // Processes are the app's own tree: this PID and everything descended from it, most
        // memory first. Drives are every fixed disk; the one holding the data folder is the
        // "models" drive and is also reported through the older flat fields.
        let script = format!(
            r#"$ErrorActionPreference='Stop'; $os=Get-CimInstance Win32_OperatingSystem; $cpu=Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'"; $drive=[IO.Path]::GetPathRoot($env:HELIOS_DATA_FOLDER).TrimEnd('\'); $fixed=@(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3'); $disk=$fixed | Where-Object DeviceID -eq $drive; $drives=@($fixed | ForEach-Object {{ [pscustomobject]@{{letter=$_.DeviceID.TrimEnd(':');freeGb=[math]::Round($_.FreeSpace/1GB,1);totalGb=[math]::Round($_.Size/1GB,1);role=$(if($_.DeviceID -eq $drive){{'models'}}else{{$null}})}} }}); $all=@(Get-CimInstance Win32_Process); $ids=[Collections.Generic.HashSet[int]]::new(); [void]$ids.Add({}); do {{ $added=$false; foreach($p in $all) {{ if($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)) {{ $added=$true }} }} }} while($added); $children=@($all | Where-Object {{ $ids.Contains([int]$_.ProcessId) }} | ForEach-Object {{ [pscustomobject]@{{name=$_.Name;pid=$_.ProcessId;ramGb=[math]::Round([double]$_.WorkingSetSize/1GB,3)}} }} | Sort-Object -Property ramGb -Descending); [pscustomobject]@{{cpuPercent=$cpu.PercentProcessorTime;ramTotalGb=[math]::Round($os.TotalVisibleMemorySize/1MB,1);ramUsedGb=[math]::Round(($os.TotalVisibleMemorySize-$os.FreePhysicalMemory)/1MB,1);diskFreeGb=[math]::Round($disk.FreeSpace/1GB,1);diskTotalGb=[math]::Round($disk.Size/1GB,1);drive=$drive;drives=$drives;processes=$children}} | ConvertTo-Json -Depth 4 -Compress"#,
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
        for key in ["processes", "drives"] {
            if !value[key].is_array() {
                let single = value[key].take();
                value[key] = if single.is_object() { json!([single]) } else { json!([]) };
            }
        }
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
    const SCRIPT: &str = r#"$ErrorActionPreference='SilentlyContinue'; $name=(Get-CimInstance Win32_VideoController | Select-Object -First 1 -ExpandProperty Name); $util=$null; try { $sum=((Get-Counter '\GPU Engine(*engtype_3D)\Utilization Percentage' -ErrorAction Stop).CounterSamples | Measure-Object -Property CookedValue -Sum).Sum; if($null -ne $sum){ $util=[math]::Round([math]::Min(100,[math]::Max(0,[double]$sum)),0) } } catch {}; [pscustomobject]@{name=$name;utilPercent=$util} | ConvertTo-Json -Compress"#;
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
    command.args(args).env("HELIOS_DATA_FOLDER", folder).kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let output = tokio::time::timeout(Duration::from_secs(8), command.output()).await.ok()?.ok()?;
    if !output.status.success() || output.stdout.len() > 65536 {
        return None;
    }
    String::from_utf8(output.stdout).ok()
}

pub async fn inspect(folder: &std::path::Path) -> Value {
    let mut info = json!({"os":std::env::consts::OS,"architecture":std::env::consts::ARCH,"threads":std::thread::available_parallelism().map_or(1,usize::from),"cpu":null,"ramGb":null,"diskFreeGb":null,"gpus":[],"nvidia":[]});
    #[cfg(windows)]
    {
        let script = r#"$ErrorActionPreference='Stop'; $os=Get-CimInstance Win32_OperatingSystem; $cpu=Get-CimInstance Win32_Processor; $drive=[IO.Path]::GetPathRoot($env:HELIOS_DATA_FOLDER).TrimEnd('\'); $disk=Get-CimInstance Win32_LogicalDisk | Where-Object DeviceID -eq $drive; [pscustomobject]@{cpu=($cpu.Name -join ', ');ramGb=[math]::Round($os.TotalVisibleMemorySize/1MB,1);diskFreeGb=if($disk){[math]::Round($disk.FreeSpace/1GB,1)}else{$null};gpus=@(Get-CimInstance Win32_VideoController | ForEach-Object Name)} | ConvertTo-Json -Compress"#;
        if let Some(data) = output("powershell.exe", &["-NoProfile", "-NonInteractive", "-Command", script], folder).await {
            if let Ok(measured) = serde_json::from_str::<Value>(data.trim_start_matches('\u{feff}').trim()) {
                for key in ["cpu", "ramGb", "diskFreeGb", "gpus"] {
                    info[key] = measured[key].clone();
                }
            }
        }
    }
    if let Some(data) = output("nvidia-smi", &["--query-gpu=name,memory.total", NVIDIA_FORMAT], folder).await {
        info["nvidia"] = Value::Array(
            data.lines()
                .filter_map(|line| {
                    let (name, memory) = line.rsplit_once(',')?;
                    let mb = memory.trim().parse::<u64>().ok()?;
                    Some(json!({"name":name.trim(),"vramMb":mb}))
                })
                .collect(),
        );
    }
    info
}
