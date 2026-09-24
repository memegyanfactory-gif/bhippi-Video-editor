//! Pictures of UI screens (src/motion/ui): the webview rasterises a screen and each of its parts,
//! and they are kept in the project's `Generated/UI screens/<screen>/` folder, so the motion scene
//! that animates them reads files like any footage.

use crate::{storage, AppState};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

/// Letters, digits, `-` and `_` only (1–80 characters), so a name can never leave its folder.
fn safe_name(name: &str) -> Option<String> {
    let ok = !name.is_empty() && name.len() <= 80 && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.') && !name.starts_with('.') && !name.contains("..");
    ok.then(|| name.to_owned())
}

pub fn picture_path(root: &Path, screen: &str, name: &str) -> Result<PathBuf, String> {
    let screen = safe_name(screen).ok_or("bad screen id")?;
    let name = safe_name(name).filter(|n| n.ends_with(".png")).ok_or("bad picture name")?;
    Ok(root.join("UI screens").join(screen).join(name))
}

/// Saves one PNG sent as the raw request body; `x-screen` and `x-name` headers say where.
#[tauri::command]
pub async fn ui_screen_save(app: AppHandle, state: State<'_, Arc<AppState>>, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let header = |name: &str| request.headers().get(name).and_then(|value| value.to_str().ok()).map(str::to_owned).ok_or_else(|| format!("missing {name} header"));
    let screen = header("x-screen")?;
    let name = header("x-name")?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("a picture must be sent as raw bytes".to_owned()) };
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("UI screen pictures are PNGs".into());
    }
    if bytes.len() > 64 * 1024 * 1024 {
        return Err("that picture is larger than 64 MB".into());
    }
    let path = picture_path(&storage::dir(&state, storage::Category::Generated)?, &screen, &name)?;
    let dir = path.parent().ok_or("bad path")?.to_path_buf();
    let bytes = bytes.to_vec();
    let written = path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&dir)?;
        std::fs::write(&written, bytes)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    let _ignored = app.asset_protocol_scope().allow_file(&path);
    Ok(path.display().to_string())
}

/// A Chromium browser to screenshot pages with: Edge ships with Windows; Chrome, Chromium or
/// Brave elsewhere.
pub fn find_browser() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if cfg!(windows) {
        for var in ["ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"] {
            if let Some(dir) = std::env::var_os(var).map(PathBuf::from) {
                candidates.push(dir.join(r"Microsoft\Edge\Application\msedge.exe"));
                candidates.push(dir.join(r"Google\Chrome\Application\chrome.exe"));
                candidates.push(dir.join(r"BraveSoftware\Brave-Browser\Application\brave.exe"));
            }
        }
    } else {
        for path in ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge", "/snap/bin/chromium"] {
            candidates.push(PathBuf::from(path));
        }
    }
    candidates.into_iter().find(|path| path.is_file())
}

/// Checks a page address: http(s) only, with a host.
pub fn capture_url(url: &str) -> Result<String, String> {
    let url = url.trim();
    let rest = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://")).ok_or("Give an http(s) address")?;
    if rest.is_empty() || rest.starts_with('/') || url.chars().any(|c| c.is_whitespace() || c == '"') {
        return Err("That is not a web address".into());
    }
    Ok(url.to_owned())
}

/// Screenshots a web page (the user's product) in a headless browser at 2× into
/// `Generated/UI screens/<screen>/capture.png`, for `create_ui_screen {screenshot, parts}`.
#[tauri::command]
pub async fn ui_capture(app: AppHandle, state: State<'_, Arc<AppState>>, url: String, width: Option<u32>, height: Option<u32>, dark: Option<bool>) -> Result<serde_json::Value, String> {
    let url = capture_url(&url)?;
    let (width, height) = (width.unwrap_or(1440).clamp(320, 2560), height.unwrap_or(900).clamp(320, 2560));
    let browser = find_browser().ok_or("No Chromium browser (Edge or Chrome) was found to capture the page with")?;
    let screen = format!("capture_{}", crate::store::new_id());
    let path = picture_path(&storage::dir(&state, storage::Category::Generated)?, &screen, "capture.png")?;
    let dir = path.parent().ok_or("bad path")?.to_path_buf();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let profile = state.paths.work.join(format!("browser-{screen}"));
    let mut command = tokio::process::Command::new(&browser);
    command
        .arg("--headless=new")
        .args(["--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "--mute-audio", "--force-device-scale-factor=2", "--virtual-time-budget=8000"])
        .arg(format!("--user-data-dir={}", profile.display()))
        .arg(format!("--window-size={width},{height}"))
        .arg(format!("--screenshot={}", path.display()));
    if dark.unwrap_or(false) {
        command.arg("--force-dark-mode").arg("--blink-settings=preferredColorScheme=0");
    }
    command.arg(&url).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let outcome = tokio::time::timeout(std::time::Duration::from_secs(60), command.status()).await;
    let _ignored = std::fs::remove_dir_all(&profile);
    match outcome {
        Err(_) => return Err("The page took more than a minute to capture".into()),
        Ok(Err(error)) => return Err(format!("Could not start the browser: {error}")),
        Ok(Ok(_)) => {}
    }
    if !path.is_file() {
        return Err("The browser did not capture the page (is the address reachable?)".into());
    }
    let _ignored = app.asset_protocol_scope().allow_file(&path);
    Ok(serde_json::json!({ "path": path, "width": width, "height": height, "scale": 2 }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_stay_inside_the_screen_folder() {
        let root = Path::new("/p/Generated");
        assert_eq!(picture_path(root, "ui_1", "main-search.png").unwrap(), root.join("UI screens").join("ui_1").join("main-search.png"));
        for (screen, name) in [("..", "a.png"), ("ui", "../x.png"), ("ui", "a/b.png"), ("ui", "a.jpg"), ("ui", ".png"), ("a\\b", "a.png"), ("", "a.png")] {
            assert!(picture_path(root, screen, name).is_err(), "{screen} {name}");
        }
    }

    #[test]
    fn only_web_addresses_are_captured() {
        assert_eq!(capture_url(" https://linear.app/features ").unwrap(), "https://linear.app/features");
        for bad in ["file:///C:/secret.txt", "javascript:alert(1)", "https://", "http:///x", "https://a b.com", "linear.app"] {
            assert!(capture_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    #[ignore = "needs Edge or Chrome and the network; run with --ignored"]
    fn a_browser_is_found_on_this_machine() {
        assert!(find_browser().is_some());
    }
}
