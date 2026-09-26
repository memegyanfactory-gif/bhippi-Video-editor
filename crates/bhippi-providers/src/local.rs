//! Local model servers: where each one listens, whether it is installed but stopped, and how
//! to switch it on.
//!
//! The desktop apps (LM Studio, Jan) keep their API server **off** by default: a user can chat
//! inside LM Studio all day while nothing answers on port 1234. So detection reads each app's
//! own config for the port it will use, notices when the app is installed but its server is
//! stopped, and — for the servers that ship a headless switch — offers to start it.

use crate::command::resolve_command;
use std::path::PathBuf;
use std::time::Duration;

fn home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

fn env_dir(name: &str) -> Option<PathBuf> {
    std::env::var_os(name).map(PathBuf::from)
}

/// Turns what a user typed ("localhost:1234", "http://pc:8080/v1/") into `http://host:port`.
#[must_use]
pub fn normalize_base(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return None;
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_owned()
    } else {
        format!("http://{trimmed}")
    };
    let url = reqwest::Url::parse(&with_scheme).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    let host = url.host_str()?;
    let host = if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_owned()
    };
    let port = url.port_or_known_default()?;
    Some(format!("{}://{host}:{port}", url.scheme()))
}

/// The port in a normalized base URL.
#[must_use]
pub fn port_of(base: &str) -> Option<u16> {
    reqwest::Url::parse(base).ok()?.port_or_known_default()
}

/// LM Studio's data folder: `LMSTUDIO_HOME` or `~/.lmstudio`.
fn lmstudio_home() -> Option<PathBuf> {
    env_dir("LMSTUDIO_HOME")
        .or_else(|| home().map(|home| home.join(".lmstudio")))
        .filter(|dir| dir.is_dir())
}

/// Addresses read from the apps' own settings, tried before the well-known ports.
#[must_use]
pub fn configured_bases(id: &str) -> Vec<String> {
    let mut bases = Vec::new();
    match id {
        "lmstudio" => {
            // The port chosen in LM Studio's Developer tab lives here.
            if let Some(dir) = lmstudio_home() {
                let file = dir.join(".internal").join("http-server-config.json");
                if let Ok(text) = std::fs::read_to_string(file) {
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                        if let Some(port) = value.get("port").and_then(serde_json::Value::as_u64) {
                            if let Ok(port) = u16::try_from(port) {
                                bases.push(format!("http://127.0.0.1:{port}"));
                            }
                        }
                    }
                }
            }
        }
        "ollama" => {
            // OLLAMA_HOST may be "0.0.0.0", ":11500", "127.0.0.1:11500" or a full URL.
            if let Ok(raw) = std::env::var("OLLAMA_HOST") {
                let raw = raw.trim();
                let raw = raw.replace("0.0.0.0", "127.0.0.1");
                let raw = if raw.starts_with(':') { format!("127.0.0.1{raw}") } else { raw };
                let has_port = raw.rsplit_once(':').is_some_and(|(_, port)| port.parse::<u16>().is_ok());
                let raw = if has_port || raw.contains("://") { raw } else { format!("{raw}:11434") };
                if let Some(base) = normalize_base(&raw) {
                    bases.push(base);
                }
            }
        }
        _ => {}
    }
    bases
}

/// Where the LM Studio `lms` CLI lives: on PATH, or in its data folder's `bin`.
fn lms_command() -> Option<crate::command::ResolvedCommand> {
    resolve_command("lms").or_else(|| {
        let exe = if cfg!(windows) { "lms.exe" } else { "lms" };
        let path = lmstudio_home()?.join("bin").join(exe);
        resolve_command(path.to_str()?)
    })
}

/// Ollama's Windows tray app, which runs the server and keeps it running.
fn ollama_app() -> Option<PathBuf> {
    let path = env_dir("LOCALAPPDATA")?.join("Programs").join("Ollama").join("ollama app.exe");
    path.is_file().then_some(path)
}

fn jan_installed() -> bool {
    let program = env_dir("LOCALAPPDATA").map(|dir| dir.join("Programs"));
    [
        program.as_ref().map(|dir| dir.join("jan").join("Jan.exe")),
        program.as_ref().map(|dir| dir.join("Jan").join("Jan.exe")),
        env_dir("APPDATA").map(|dir| dir.join("Jan").join("data")),
        home().map(|home| home.join("jan")),
        Some(PathBuf::from("/Applications/Jan.app")),
    ]
    .into_iter()
    .flatten()
    .any(|path| path.exists())
}

/// Whether the app behind a local server is on this computer even though nothing answered.
#[must_use]
pub fn installed(id: &str) -> bool {
    match id {
        "ollama" => ollama_app().is_some() || resolve_command("ollama").is_some_and(|command| command.target_exists()),
        "lmstudio" => lmstudio_home().is_some() || lms_command().is_some(),
        "jan" => jan_installed(),
        "llamacpp" => resolve_command("llama-server").is_some(),
        "vllm" => resolve_command("vllm").is_some(),
        _ => false,
    }
}

/// Whether Bhippi can switch this server on by itself.
#[must_use]
pub fn can_start(id: &str) -> bool {
    match id {
        "lmstudio" => lms_command().is_some(),
        "ollama" => ollama_app().is_some() || resolve_command("ollama").is_some(),
        _ => false,
    }
}

/// What to tell a user whose server is installed but not answering.
#[must_use]
pub fn stopped_reason(id: &str) -> String {
    match id {
        "lmstudio" => "LM Studio is installed, but its local server is off. Press Start server, or in LM Studio open the Developer tab and switch Status to Running.".to_owned(),
        "ollama" => "Ollama is installed, but not running. Press Start server, or open Ollama from the Start menu.".to_owned(),
        "jan" => "Jan is installed, but its Local API Server is off. In Jan open Settings → Local API Server and press Start Server.".to_owned(),
        "llamacpp" => "llama-server is installed, but not running. Start it (for example `llama-server -m model.gguf`), or set its address below if it uses another port.".to_owned(),
        "vllm" => "vLLM is installed, but not serving. Run `vllm serve <model>`, or set its address below.".to_owned(),
        _ => "installed, but not running".to_owned(),
    }
}

/// Switches a local server on. Returns a short line for the UI.
pub async fn start(id: &str) -> Result<String, String> {
    match id {
        "lmstudio" => {
            let lms = lms_command().ok_or("LM Studio's `lms` tool was not found. Open LM Studio once, then try again.")?;
            let mut command = lms.command();
            command.args(["server", "start"]);
            let output = tokio::time::timeout(Duration::from_secs(60), command.output())
                .await
                .map_err(|_| "LM Studio did not start its server within a minute.".to_owned())?
                .map_err(|error| format!("could not run lms: {error}"))?;
            let text = format!(
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            let last = text.lines().map(str::trim).rfind(|line| !line.is_empty()).unwrap_or("").to_owned();
            if output.status.success() {
                Ok(if last.is_empty() { "LM Studio server started".to_owned() } else { last })
            } else {
                Err(if last.is_empty() { format!("lms exited with {}", output.status) } else { last })
            }
        }
        "ollama" => {
            // A detached process: the server must outlive this call and Bhippi itself.
            let mut command = if let Some(app) = ollama_app() {
                std::process::Command::new(app)
            } else {
                let path = resolve_command("ollama").ok_or("Ollama was not found on this computer.")?;
                let mut command = std::process::Command::new(path.target());
                command.arg("serve");
                command
            };
            command
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                // DETACHED_PROCESS | CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP
                command.creation_flags(0x0000_0008 | 0x0800_0000 | 0x0000_0200);
            }
            command.spawn().map_err(|error| format!("could not start Ollama: {error}"))?;
            Ok("Ollama is starting".to_owned())
        }
        _ => Err("Bhippi cannot start this server by itself — start it in its own app, then press Refresh.".to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::{normalize_base, port_of};

    #[test]
    fn typed_addresses_normalize() {
        assert_eq!(normalize_base("localhost:1234").as_deref(), Some("http://localhost:1234"));
        assert_eq!(normalize_base("http://127.0.0.1:8080/v1/").as_deref(), Some("http://127.0.0.1:8080"));
        assert_eq!(normalize_base("https://box.lan").as_deref(), Some("https://box.lan:443"));
        assert_eq!(normalize_base("http://[::1]:11434").as_deref(), Some("http://[::1]:11434"));
        assert_eq!(normalize_base("  "), None);
        assert_eq!(normalize_base("ftp://x:1"), None);
        assert_eq!(port_of("http://127.0.0.1:1234"), Some(1234));
    }
}

#[cfg(test)]
mod live {
    /// `cargo test -p bhippi-providers live_start_lmstudio -- --ignored --nocapture` switches
    /// on this machine's LM Studio server and shows what detection then finds.
    #[tokio::test]
    #[ignore = "starts the real LM Studio server on this machine"]
    async fn live_start_lmstudio() {
        println!("can_start={}", super::can_start("lmstudio"));
        println!("start: {:?}", super::start("lmstudio").await);
        let rows = crate::detect(crate::CATALOG, &[], &crate::ApiKeys::new(), &crate::Endpoints::new()).await;
        let row = rows.iter().find(|row| row.id == "lmstudio").expect("row");
        println!("usable={} base={:?} health={:?} models={:?}", row.usable, row.base_url, row.health, row.models);
    }
}
