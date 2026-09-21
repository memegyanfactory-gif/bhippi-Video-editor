//! Read-only local hardware inventory. Missing measurements stay null.
use serde_json::{json,Value};
use std::time::Duration;
pub async fn usage(folder: &std::path::Path) -> Result<Value, String> {
    #[cfg(windows)] {
        let script = format!(r#"$ErrorActionPreference='Stop'; $os=Get-CimInstance Win32_OperatingSystem; $cpu=Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'"; $drive=[IO.Path]::GetPathRoot($env:HELIOS_DATA_FOLDER).TrimEnd('\'); $disk=Get-CimInstance Win32_LogicalDisk | Where-Object DeviceID -eq $drive; $all=@(Get-CimInstance Win32_Process); $ids=[Collections.Generic.HashSet[int]]::new(); [void]$ids.Add({}); do {{ $added=$false; foreach($p in $all) {{ if($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)) {{ $added=$true }} }} }} while($added); $children=@($all | Where-Object {{ $ids.Contains([int]$_.ProcessId) }} | ForEach-Object {{ [pscustomobject]@{{name=$_.Name;pid=$_.ProcessId;ramGb=[math]::Round([double]$_.WorkingSetSize/1GB,3)}} }}); [pscustomobject]@{{cpuPercent=$cpu.PercentProcessorTime;ramTotalGb=[math]::Round($os.TotalVisibleMemorySize/1MB,1);ramUsedGb=[math]::Round(($os.TotalVisibleMemorySize-$os.FreePhysicalMemory)/1MB,1);diskFreeGb=[math]::Round($disk.FreeSpace/1GB,1);diskTotalGb=[math]::Round($disk.Size/1GB,1);drive=$drive;processes=$children}} | ConvertTo-Json -Depth 4 -Compress"#, std::process::id());
        let data = output("powershell.exe", &["-NoProfile", "-NonInteractive", "-Command", &script], folder).await.ok_or("Resource measurements unavailable")?;
        let mut value: Value = serde_json::from_str(data.trim_start_matches('\u{feff}').trim()).map_err(|e| e.to_string())?;
        // Live GPU load is best-effort: NVIDIA reports utilisation and VRAM use,
        // anything else honestly reports no sensor rather than a fake zero.
        value["gpu"] = live_gpu(folder).await;
        return Ok(value);
    }
    #[cfg(not(windows))] { let _ = folder; Err("Resource measurements unavailable on this platform".into()) }
}

/// First NVIDIA GPU, or null when there is no NVIDIA driver to ask.
async fn live_gpu(folder: &std::path::Path) -> Value {
    let query = output("nvidia-smi", &["--query-gpu=name,utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"], folder).await;
    let line = query.as_deref().and_then(|text| text.lines().next()).unwrap_or_default();
    let mut parts = line.split(',');
    let (name, util, used, total) = (parts.next(), parts.next(), parts.next(), parts.next());
    match (name, util, used, total) {
        (Some(name), Some(util), Some(used), Some(total)) => {
            let number = |text: &str| text.trim().parse::<f64>().ok();
            match (number(util), number(used), number(total)) {
                (Some(util), Some(used), Some(total)) if total > 0.0 => json!({
                    "name": name.trim(), "utilPercent": util.clamp(0.0, 100.0),
                    "memUsedMb": used, "memTotalMb": total,
                }),
                _ => Value::Null,
            }
        }
        _ => Value::Null,
    }
}
async fn output(program:&str,args:&[&str],folder:&std::path::Path)->Option<String>{
    let mut command=tokio::process::Command::new(program);
    command.args(args).env("HELIOS_DATA_FOLDER",folder).kill_on_drop(true);
    #[cfg(windows)] command.creation_flags(0x0800_0000);
    let output=tokio::time::timeout(Duration::from_secs(8),command.output()).await.ok()?.ok()?;
    if !output.status.success()||output.stdout.len()>65536{return None;}
    String::from_utf8(output.stdout).ok()
}
pub async fn inspect(folder:&std::path::Path)->Value{
    let mut info=json!({"os":std::env::consts::OS,"architecture":std::env::consts::ARCH,"threads":std::thread::available_parallelism().map_or(1,usize::from),"cpu":null,"ramGb":null,"diskFreeGb":null,"gpus":[],"nvidia":[]});
    #[cfg(windows)] {
        let script=r#"$ErrorActionPreference='Stop'; $os=Get-CimInstance Win32_OperatingSystem; $cpu=Get-CimInstance Win32_Processor; $drive=[IO.Path]::GetPathRoot($env:HELIOS_DATA_FOLDER).TrimEnd('\'); $disk=Get-CimInstance Win32_LogicalDisk | Where-Object DeviceID -eq $drive; [pscustomobject]@{cpu=($cpu.Name -join ', ');ramGb=[math]::Round($os.TotalVisibleMemorySize/1MB,1);diskFreeGb=if($disk){[math]::Round($disk.FreeSpace/1GB,1)}else{$null};gpus=@(Get-CimInstance Win32_VideoController | ForEach-Object Name)} | ConvertTo-Json -Compress"#;
        if let Some(data)=output("powershell.exe",&["-NoProfile","-NonInteractive","-Command",script],folder).await {
            if let Ok(measured)=serde_json::from_str::<Value>(data.trim_start_matches('\u{feff}').trim()) {for key in ["cpu","ramGb","diskFreeGb","gpus"]{info[key]=measured[key].clone();}}
        }
    }
    if let Some(data)=output("nvidia-smi",&["--query-gpu=name,memory.total","--format=csv,noheader,nounits"],folder).await{
        info["nvidia"]=Value::Array(data.lines().filter_map(|line|{let(name,memory)=line.rsplit_once(',')?;let mb=memory.trim().parse::<u64>().ok()?;Some(json!({"name":name.trim(),"vramMb":mb}))}).collect());
    }
    info
}
