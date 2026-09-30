//! A small client for the Chrome DevTools protocol: a headless Chrome or Edge, driven over its
//! local websocket. Enough for capture_app_session (app_capture.rs): open a page with a script
//! injected before its own, set the viewport and pixel ratio, click, type, evaluate, and take
//! screenshots of any rectangle. Calls are sequential: each command waits for its own reply, and
//! events that arrive meanwhile are kept so a later wait can find them.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// A running headless browser and its connection. Dropping it kills the browser and removes its
/// throwaway profile.
pub struct Browser {
    child: tokio::process::Child,
    profile: PathBuf,
    socket: Socket,
    next_id: u64,
    /// Events received while waiting for replies: (session id, method, params).
    events: Vec<(String, String, Value)>,
}

impl Drop for Browser {
    fn drop(&mut self) {
        let _ignored = self.child.start_kill();
        let profile = self.profile.clone();
        // The browser holds its profile open for a moment after it is told to die.
        std::thread::spawn(move || {
            for _ in 0..20 {
                if std::fs::remove_dir_all(&profile).is_ok() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(250));
            }
        });
    }
}

/// How long to wait for the browser to open its debugging port.
const START_TIMEOUT: Duration = Duration::from_secs(20);
/// How long one command may take (a heavy page's screenshot included).
const CALL_TIMEOUT: Duration = Duration::from_secs(60);

impl Browser {
    /// Starts `program` headless with a fresh profile under `work` and connects to it.
    pub async fn launch(program: &Path, work: &Path) -> Result<Self, String> {
        let profile = work.join(format!("cdp-profile-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&profile).map_err(|error| format!("cannot create a browser profile: {error}"))?;
        let child = tokio::process::Command::new(program)
            .args([
                "--headless=new",
                "--remote-debugging-port=0",
                "--no-first-run",
                "--no-default-browser-check",
                "--hide-scrollbars",
                "--mute-audio",
                "--disable-extensions",
                "--disable-background-networking",
                "--font-render-hinting=none",
            ])
            .arg(format!("--user-data-dir={}", profile.display()))
            .arg("about:blank")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| format!("could not start {}: {error}", program.display()))?;
        // The browser writes its port and websocket path to the profile once it listens.
        let port_file = profile.join("DevToolsActivePort");
        let started = std::time::Instant::now();
        let url = loop {
            if let Ok(text) = std::fs::read_to_string(&port_file) {
                let mut lines = text.lines();
                if let (Some(port), Some(path)) = (lines.next(), lines.next()) {
                    break format!("ws://127.0.0.1:{}{}", port.trim(), path.trim());
                }
            }
            if started.elapsed() > START_TIMEOUT {
                return Err("the browser did not open its debugging port in time".to_owned());
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        };
        let (socket, _) = tokio_tungstenite::connect_async(url.as_str()).await.map_err(|error| format!("could not connect to the browser: {error}"))?;
        Ok(Self { child, profile, socket, next_id: 1, events: Vec::new() })
    }

    /// Sends one command (to a page when `session` is given) and returns its result.
    pub async fn call(&mut self, method: &str, params: Value, session: Option<&str>) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        let mut message = json!({ "id": id, "method": method, "params": params });
        if let Some(session) = session {
            message["sessionId"] = json!(session);
        }
        self.socket.send(Message::Text(message.to_string())).await.map_err(|error| format!("{method}: {error}"))?;
        let deadline = tokio::time::Instant::now() + CALL_TIMEOUT;
        loop {
            let next = tokio::time::timeout_at(deadline, self.socket.next()).await.map_err(|_| format!("{method} took too long"))?;
            let Some(frame) = next else { return Err(format!("{method}: the browser closed")) };
            let frame = frame.map_err(|error| format!("{method}: {error}"))?;
            let Message::Text(text) = frame else { continue };
            let Ok(value) = serde_json::from_str::<Value>(&text) else { continue };
            if value.get("id").and_then(Value::as_u64) == Some(id) {
                if let Some(error) = value.get("error") {
                    return Err(format!("{method}: {}", error.get("message").and_then(Value::as_str).unwrap_or("failed")));
                }
                return Ok(value.get("result").cloned().unwrap_or(Value::Null));
            }
            if let Some(event) = value.get("method").and_then(Value::as_str) {
                let from = value.get("sessionId").and_then(Value::as_str).unwrap_or("").to_owned();
                self.events.push((from, event.to_owned(), value.get("params").cloned().unwrap_or(Value::Null)));
                if self.events.len() > 2000 {
                    self.events.drain(..1000);
                }
            }
        }
    }

    /// Waits until `method` has arrived for `session` (already or within `timeout`).
    pub async fn wait_for(&mut self, method: &str, session: &str, timeout: Duration) -> Result<Value, String> {
        if let Some(index) = self.events.iter().position(|(from, event, _)| from == session && event == method) {
            return Ok(self.events.remove(index).2);
        }
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            let next = tokio::time::timeout_at(deadline, self.socket.next()).await.map_err(|_| format!("waited too long for {method}"))?;
            let Some(frame) = next else { return Err("the browser closed".to_owned()) };
            let Message::Text(text) = frame.map_err(|error| error.to_string())? else { continue };
            let Ok(value) = serde_json::from_str::<Value>(&text) else { continue };
            let Some(event) = value.get("method").and_then(Value::as_str) else { continue };
            let from = value.get("sessionId").and_then(Value::as_str).unwrap_or("");
            if from == session && event == method {
                return Ok(value.get("params").cloned().unwrap_or(Value::Null));
            }
            self.events.push((from.to_owned(), event.to_owned(), value.get("params").cloned().unwrap_or(Value::Null)));
        }
    }

    /// Events of `method` received so far (and forgets them): console errors, exceptions.
    pub fn take_events(&mut self, method: &str) -> Vec<Value> {
        let (taken, kept): (Vec<_>, Vec<_>) = std::mem::take(&mut self.events).into_iter().partition(|(_, event, _)| event == method);
        self.events = kept;
        taken.into_iter().map(|(_, _, params)| params).collect()
    }
}

/// One page (tab) of the browser, with the calls a capture needs.
pub struct Page {
    pub session: String,
}

impl Page {
    /// A new blank page at `width`×`height` CSS pixels drawn at `scale` device pixels per pixel,
    /// with `script` run before any of the page's own scripts on every load.
    pub async fn open(browser: &mut Browser, width: u32, height: u32, scale: f64, script: Option<&str>) -> Result<Self, String> {
        let target = browser.call("Target.createTarget", json!({ "url": "about:blank" }), None).await?;
        let target_id = target.get("targetId").and_then(Value::as_str).ok_or("the browser opened no page")?.to_owned();
        let attached = browser.call("Target.attachToTarget", json!({ "targetId": target_id, "flatten": true }), None).await?;
        let session = attached.get("sessionId").and_then(Value::as_str).ok_or("could not attach to the page")?.to_owned();
        let page = Self { session };
        browser.call("Page.enable", json!({}), Some(&page.session)).await?;
        browser.call("Runtime.enable", json!({}), Some(&page.session)).await?;
        browser
            .call("Emulation.setDeviceMetricsOverride", json!({ "width": width, "height": height, "deviceScaleFactor": scale, "mobile": false }), Some(&page.session))
            .await?;
        if let Some(script) = script {
            browser.call("Page.addScriptToEvaluateOnNewDocument", json!({ "source": script }), Some(&page.session)).await?;
        }
        Ok(page)
    }

    /// Opens `url` and waits for its load event.
    pub async fn navigate(&self, browser: &mut Browser, url: &str) -> Result<(), String> {
        let result = browser.call("Page.navigate", json!({ "url": url }), Some(&self.session)).await?;
        if let Some(error) = result.get("errorText").and_then(Value::as_str) {
            return Err(format!("{url} did not open: {error}"));
        }
        browser.wait_for("Page.loadEventFired", &self.session, Duration::from_secs(60)).await.map(|_| ())
    }

    /// Runs `expression` in the page (awaiting a promise) and returns its value.
    pub async fn eval(&self, browser: &mut Browser, expression: &str) -> Result<Value, String> {
        let result = browser
            .call("Runtime.evaluate", json!({ "expression": expression, "awaitPromise": true, "returnByValue": true }), Some(&self.session))
            .await?;
        if let Some(details) = result.get("exceptionDetails") {
            let text = details.pointer("/exception/description").or_else(|| details.get("text")).and_then(Value::as_str).unwrap_or("the script failed");
            return Err(text.lines().next().unwrap_or(text).to_owned());
        }
        Ok(result.pointer("/result/value").cloned().unwrap_or(Value::Null))
    }

    /// A real mouse click at CSS pixel `x`, `y`.
    pub async fn click(&self, browser: &mut Browser, x: f64, y: f64) -> Result<(), String> {
        for kind in ["mouseMoved", "mousePressed", "mouseReleased"] {
            browser
                .call("Input.dispatchMouseEvent", json!({ "type": kind, "x": x, "y": y, "button": "left", "clickCount": 1 }), Some(&self.session))
                .await?;
        }
        Ok(())
    }

    /// Moves the mouse to `x`, `y` (hover states).
    pub async fn hover(&self, browser: &mut Browser, x: f64, y: f64) -> Result<(), String> {
        browser.call("Input.dispatchMouseEvent", json!({ "type": "mouseMoved", "x": x, "y": y }), Some(&self.session)).await.map(|_| ())
    }

    /// Types `text` into whatever has focus, as if from a keyboard.
    pub async fn insert_text(&self, browser: &mut Browser, text: &str) -> Result<(), String> {
        browser.call("Input.insertText", json!({ "text": text }), Some(&self.session)).await.map(|_| ())
    }

    /// Presses and releases one named key ("Enter", "Escape", "Tab", "ArrowDown"...).
    pub async fn key(&self, browser: &mut Browser, key: &str) -> Result<(), String> {
        let code = match key {
            "Enter" => 13,
            "Escape" => 27,
            "Tab" => 9,
            "Backspace" => 8,
            "ArrowDown" => 40,
            "ArrowUp" => 38,
            "ArrowLeft" => 37,
            "ArrowRight" => 39,
            _ => 0,
        };
        for kind in ["keyDown", "keyUp"] {
            browser
                .call("Input.dispatchKeyEvent", json!({ "type": kind, "key": key, "code": key, "windowsVirtualKeyCode": code, "nativeVirtualKeyCode": code }), Some(&self.session))
                .await?;
        }
        Ok(())
    }

    /// A PNG of the CSS pixel rectangle, at the page's pixel ratio times `scale`.
    pub async fn screenshot(&self, browser: &mut Browser, x: f64, y: f64, width: f64, height: f64, scale: f64) -> Result<Vec<u8>, String> {
        let result = browser
            .call(
                "Page.captureScreenshot",
                json!({ "format": "png", "fromSurface": true, "captureBeyondViewport": true, "clip": { "x": x, "y": y, "width": width, "height": height, "scale": scale } }),
                Some(&self.session),
            )
            .await?;
        let data = result.get("data").and_then(Value::as_str).ok_or("the browser returned no picture")?;
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.decode(data).map_err(|error| format!("the picture was unreadable: {error}"))
    }

    /// Makes the page's background transparent, so parts are captured without a backdrop.
    pub async fn transparent(&self, browser: &mut Browser) -> Result<(), String> {
        browser
            .call("Emulation.setDefaultBackgroundColorOverride", json!({ "color": { "r": 0, "g": 0, "b": 0, "a": 0 } }), Some(&self.session))
            .await
            .map(|_| ())
    }
}

/// The width and height of a PNG, read from its header.
pub fn png_size(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 24 || &bytes[0..8] != b"\x89PNG\r\n\x1a\n" {
        return None;
    }
    let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    Some((width, height))
}

#[cfg(test)]
mod tests {
    use super::{png_size, Browser, Page};

    #[test]
    fn a_png_header_gives_its_size() {
        let mut header = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        header.extend_from_slice(&640u32.to_be_bytes());
        header.extend_from_slice(&360u32.to_be_bytes());
        assert_eq!(png_size(&header), Some((640, 360)));
        assert_eq!(png_size(b"not a png at all, no"), None);
    }

    /// Drives a real headless browser when one is installed: opens a page with an injected script,
    /// clicks a button, and captures it at 3x.
    #[tokio::test]
    async fn a_real_browser_opens_clicks_and_captures() {
        let Some(program) = crate::ui_screen::find_browser() else { return };
        let work = std::env::temp_dir().join(format!("bhippi-cdp-test-{}", ulid::Ulid::new()));
        let mut browser = Browser::launch(&program, &work).await.expect("launch");
        let page = Page::open(&mut browser, 400, 300, 3.0, Some("window.__injected = 'yes';")).await.expect("page");
        let html = "data:text/html,<button id=b style='position:absolute;left:20px;top:30px;width:120px;height:40px' onclick=\"this.textContent='done'\">go</button>";
        page.navigate(&mut browser, html).await.expect("navigate");
        assert_eq!(page.eval(&mut browser, "window.__injected").await.expect("eval"), "yes");
        page.click(&mut browser, 60.0, 50.0).await.expect("click");
        assert_eq!(page.eval(&mut browser, "document.getElementById('b').textContent").await.expect("eval"), "done");
        let png = page.screenshot(&mut browser, 20.0, 30.0, 120.0, 40.0, 1.0).await.expect("shot");
        assert_eq!(png_size(&png), Some((360, 120)), "3x the CSS size");
        drop(browser);
        let _ignored = std::fs::remove_dir_all(&work);
    }
}
