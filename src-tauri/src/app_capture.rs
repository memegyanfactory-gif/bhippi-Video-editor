//! capture_app_session: the real product, alive, cut into parts.
//!
//! Every premium film made for Bhippi first rebuilt this by hand: run the app in a headless
//! browser (with a stand-in for its desktop backend), play a short session (type into the chat,
//! open a menu, press send), and capture each named part in each state at 3-4x, so a camera can
//! fly into it and stay sharp. Opus spent a fifth of a 96-minute run on it and lost 7 minutes to
//! parts captured at 1x and to a font that fell back to a serif. This does it in one call, checks
//! both, and keeps the parts in the project's AI Work folder: a repeat capture with the same key
//! is reused, so Bhippi's own interface is captured once, not once per film.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::cdp::{png_size, Browser, Page};
use crate::storage::{self, Category};
use crate::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRequest {
    /// The page to capture; none means Bhippi itself.
    pub url: Option<String>,
    /// A name for the session (the folder the parts go in).
    pub name: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// Device pixels per CSS pixel: 3 by default, so a 3x zoom on a part stays sharp.
    pub scale: Option<f64>,
    /// A script run before the page's own (Bhippi's backend stand-in and its data). `{{FILES}}`
    /// in it becomes the address local files are served from.
    pub standin: Option<String>,
    /// A CSS selector the page is ready when it shows.
    pub ready: Option<String>,
    /// Capture parts on a transparent background (default false: the app's own background).
    pub transparent: Option<bool>,
    /// Reuse an earlier capture with the same key (the part library).
    pub key: Option<String>,
    pub steps: Vec<Step>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "do", rename_all = "camelCase")]
pub enum Step {
    Click { selector: String },
    Hover { selector: String },
    /// Types `text` into `selector` (clicked first). With `part`, the part is captured after every
    /// character as states t00, t01…: typing that can be played back frame by frame.
    Type { selector: String, text: String, part: Option<String>, #[serde(rename = "partSelector")] part_selector: Option<String> },
    Key { key: String },
    Wait { ms: u64 },
    Eval { js: String },
    Capture { part: String, selector: String, state: Option<String>, pad: Option<f64> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Part {
    pub part: String,
    pub state: String,
    pub file: String,
    /// Where it sat on the page, CSS pixels.
    pub box_css: [f64; 4],
    pub pixels: [u32; 2],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub key: Option<String>,
    pub url: String,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
    pub parts: Vec<Part>,
    /// What went wrong and was caught: parts at the wrong resolution, fonts that fell back, page errors.
    pub issues: Vec<String>,
    pub dir: String,
}

/// Files the stand-in may load (thumbnails, waveforms, media): only under Bhippi's own folders.
fn allowed_file(path: &Path, roots: &[PathBuf]) -> bool {
    let Ok(real) = path.canonicalize() else { return false };
    roots.iter().filter_map(|root| root.canonicalize().ok()).any(|root| real.starts_with(root))
}

/// A tiny localhost server for the capture's lifetime: the app's own built interface at `/`
/// (when it is bundled) and local files at `/f/<path>`, so the page loads over http like the
/// app does instead of `file://`, where fonts and module scripts fail.
struct Server {
    port: u16,
    stop: Arc<AtomicBool>,
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        // Wake the accept loop so it sees the stop flag.
        let _ignored = std::net::TcpStream::connect(("127.0.0.1", self.port));
    }
}

fn start_server(app: &AppHandle, roots: Vec<PathBuf>) -> Result<Server, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|error| format!("could not open a local port: {error}"))?;
    let port = listener.local_addr().map_err(|error| error.to_string())?.port();
    let stop = Arc::new(AtomicBool::new(false));
    let flag = stop.clone();
    let app = app.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            if flag.load(Ordering::SeqCst) {
                break;
            }
            let Ok(mut stream) = stream else { continue };
            let _ignored = stream.set_read_timeout(Some(Duration::from_secs(5)));
            let mut buffer = [0u8; 8192];
            let Ok(read) = stream.read(&mut buffer) else { continue };
            let request = String::from_utf8_lossy(&buffer[..read]);
            let target = request.lines().next().and_then(|line| line.split_whitespace().nth(1)).unwrap_or("/").to_owned();
            let path = target.split('?').next().unwrap_or("/");
            let (status, mime, body): (&str, String, Vec<u8>) = if let Some(file) = path.strip_prefix("/f/") {
                let decoded = percent_encoding::percent_decode_str(file).decode_utf8_lossy().replace('/', std::path::MAIN_SEPARATOR_STR);
                let file = PathBuf::from(decoded);
                match (allowed_file(&file, &roots), std::fs::read(&file)) {
                    (true, Ok(bytes)) => ("200 OK", mime_of(&file), bytes),
                    _ => ("404 Not Found", "text/plain".to_owned(), b"not here".to_vec()),
                }
            } else {
                let asset = if path == "/" { "index.html".to_owned() } else { path.trim_start_matches('/').to_owned() };
                match app.asset_resolver().get(asset) {
                    Some(found) => ("200 OK", found.mime_type.clone(), found.bytes.clone()),
                    None => ("404 Not Found", "text/plain".to_owned(), b"not here".to_vec()),
                }
            };
            let head = format!("HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n", body.len());
            let _ignored = stream.write_all(head.as_bytes()).and_then(|()| stream.write_all(&body));
        }
    });
    Ok(Server { port, stop })
}

fn mime_of(path: &Path) -> String {
    match path.extension().and_then(|ext| ext.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("json") => "application/json",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    }
    .to_owned()
}

/// A folder-safe version of a name.
fn slug(name: &str) -> String {
    let cleaned: String = name.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).collect();
    let trimmed = cleaned.trim_matches('-');
    if trimmed.is_empty() { "session".to_owned() } else { trimmed.chars().take(60).collect() }
}

/// The element's box relative to the window (for the mouse) and the page scroll (a screenshot clip
/// is measured on the whole document: without the scroll it lands beside the part as soon as the
/// page has moved). It is only scrolled into view when it is not already fully visible.
const RECT: &str = "(sel) => { const el = document.querySelector(sel); if (!el) return null; let r = el.getBoundingClientRect(); if (r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); r = el.getBoundingClientRect(); } return [r.x, r.y, r.width, r.height, scrollX, scrollY]; }";

/// Where a part is: `[x, y, width, height]` in window CSS pixels, and the page scroll.
async fn place_of(page: &Page, browser: &mut Browser, selector: &str) -> Result<([f64; 4], [f64; 2]), String> {
    let value = page.eval(browser, &format!("({RECT})({})", serde_json::to_string(selector).unwrap_or_default())).await?;
    let list = value.as_array().ok_or_else(|| format!("nothing on the page matches {selector}"))?;
    let number = |i: usize| list.get(i).and_then(Value::as_f64).unwrap_or(0.0);
    let rect = [number(0), number(1), number(2), number(3)];
    if rect[2] < 1.0 || rect[3] < 1.0 {
        return Err(format!("{selector} is on the page but has no size (hidden or collapsed)"));
    }
    Ok((rect, [number(4), number(5)]))
}

/// A part's box in window CSS pixels: where the mouse goes.
async fn rect_of(page: &Page, browser: &mut Browser, selector: &str) -> Result<[f64; 4], String> {
    place_of(page, browser, selector).await.map(|(rect, _)| rect)
}

/// Captures one part in one state and checks it came out at the resolution asked for.
#[allow(clippy::too_many_arguments)]
async fn capture(page: &Page, browser: &mut Browser, dir: &Path, part: &str, state: &str, selector: &str, pad: f64, scale: f64, issues: &mut Vec<String>) -> Result<Part, String> {
    let ([x, y, width, height], [scroll_x, scroll_y]) = place_of(page, browser, selector).await?;
    let (x, y) = (x + scroll_x, y + scroll_y);
    let (x, y, width, height) = ((x - pad).max(0.0), (y - pad).max(0.0), width + 2.0 * pad, height + 2.0 * pad);
    let png = page.screenshot(browser, x, y, width, height, 1.0).await?;
    let pixels = png_size(&png).unwrap_or((0, 0));
    let expected = ((width * scale).round() as i64, (height * scale).round() as i64);
    if (pixels.0 as i64 - expected.0).abs() > 3 || (pixels.1 as i64 - expected.1).abs() > 3 {
        issues.push(format!("{part} ({state}) came out {}x{} px, not the {}x{} asked for: it would blur when the camera zooms in", pixels.0, pixels.1, expected.0, expected.1));
    }
    let file = format!("{}__{}.png", slug(part), slug(state));
    std::fs::write(dir.join(&file), &png).map_err(|error| format!("cannot write {file}: {error}"))?;
    Ok(Part { part: part.to_owned(), state: state.to_owned(), file, box_css: [x, y, width, height], pixels: [pixels.0, pixels.1] })
}

const FONT_CHECK: &str = r#"(async () => {
  await document.fonts.ready;
  const generic = /^(system-ui|sans-serif|serif|monospace|cursive|fantasy|inherit|initial|-apple-system|blinkmacsystemfont|segoe ui|arial|helvetica)$/i;
  const used = new Set();
  for (const el of document.querySelectorAll('body *')) {
    const family = getComputedStyle(el).fontFamily.split(',')[0].trim().replace(/["']/g, '');
    if (family) used.add(family);
  }
  return [...used].filter((family) => !generic.test(family) && !document.fonts.check(`16px "${family}"`)).slice(0, 8);
})()"#;

async fn run(app: &AppHandle, state: &AppState, request: CaptureRequest) -> Result<Manifest, String> {
    let width = request.width.unwrap_or(1920).clamp(320, 3840);
    let height = request.height.unwrap_or(1080).clamp(240, 2160);
    let scale = request.scale.unwrap_or(3.0).clamp(1.0, 4.0);
    let dir = storage::dir(state, Category::AiWork)?.join("ui-parts").join(slug(&request.name));
    // The part library: the same key captured before is reused as it is.
    let manifest_path = dir.join("manifest.json");
    if let (Some(key), Ok(text)) = (request.key.as_ref(), std::fs::read_to_string(&manifest_path)) {
        if let Ok(known) = serde_json::from_str::<Manifest>(&text) {
            if known.key.as_ref() == Some(key) && known.parts.iter().all(|part| dir.join(&part.file).is_file()) {
                return Ok(known);
            }
        }
    }
    std::fs::create_dir_all(&dir).map_err(|error| format!("cannot create {}: {error}", dir.display()))?;
    let roots = vec![state.paths.root.clone(), storage::root(state)];
    let server = start_server(app, roots)?;
    let files = format!("http://127.0.0.1:{}/f/", server.port);
    let url = match request.url.as_deref() {
        Some(url) => crate::ui_screen::capture_url(url)?,
        // Bhippi itself: the dev server while developing, the bundled interface otherwise.
        None => app.config().build.dev_url.as_ref().filter(|_| cfg!(debug_assertions)).map_or_else(|| format!("http://127.0.0.1:{}/", server.port), ToString::to_string),
    };
    let program = crate::ui_screen::find_browser().ok_or("No Chrome or Edge found to capture with")?;
    let mut browser = Browser::launch(&program, &state.paths.work).await?;
    let standin = request.standin.as_ref().map(|script| script.replace("{{FILES}}", &files));
    let page = Page::open(&mut browser, width, height, scale, standin.as_deref()).await?;
    if request.transparent.unwrap_or(false) {
        page.transparent(&mut browser).await?;
    }
    page.navigate(&mut browser, &url).await?;
    // Ready: the chosen element on screen (or the app's root filled in), fonts loaded.
    let ready = request.ready.clone().unwrap_or_else(|| "#root > *, body > *".to_owned());
    let started = std::time::Instant::now();
    loop {
        let found = page.eval(&mut browser, &format!("!!document.querySelector({})", serde_json::to_string(&ready).unwrap_or_default())).await.unwrap_or(Value::Bool(false));
        if found == Value::Bool(true) {
            break;
        }
        if started.elapsed() > Duration::from_secs(30) {
            return Err(format!("the page never showed {ready}"));
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    let _ignored = page.eval(&mut browser, "document.fonts.ready.then(() => new Promise((done) => setTimeout(done, 400)))").await;

    let mut parts = Vec::new();
    let mut issues = Vec::new();
    for step in &request.steps {
        let result: Result<(), String> = async {
            match step {
                Step::Click { selector } => {
                    let [x, y, w, h] = rect_of(&page, &mut browser, selector).await?;
                    page.click(&mut browser, x + w / 2.0, y + h / 2.0).await
                }
                Step::Hover { selector } => {
                    let [x, y, w, h] = rect_of(&page, &mut browser, selector).await?;
                    page.hover(&mut browser, x + w / 2.0, y + h / 2.0).await
                }
                Step::Type { selector, text, part, part_selector } => {
                    let [x, y, w, h] = rect_of(&page, &mut browser, selector).await?;
                    page.click(&mut browser, x + w / 2.0, y + h / 2.0).await?;
                    if let Some(part) = part {
                        let target = part_selector.as_deref().unwrap_or(selector);
                        parts.push(capture(&page, &mut browser, &dir, part, "t00", target, 0.0, scale, &mut issues).await?);
                        for (index, character) in text.chars().enumerate() {
                            page.insert_text(&mut browser, &character.to_string()).await?;
                            tokio::time::sleep(Duration::from_millis(40)).await;
                            parts.push(capture(&page, &mut browser, &dir, part, &format!("t{:02}", index + 1), target, 0.0, scale, &mut issues).await?);
                        }
                        Ok(())
                    } else {
                        page.insert_text(&mut browser, text).await
                    }
                }
                Step::Key { key } => page.key(&mut browser, key).await,
                Step::Wait { ms } => {
                    tokio::time::sleep(Duration::from_millis((*ms).min(10_000))).await;
                    Ok(())
                }
                Step::Eval { js } => page.eval(&mut browser, js).await.map(|_| ()),
                Step::Capture { part, selector, state, pad } => {
                    parts.push(capture(&page, &mut browser, &dir, part, state.as_deref().unwrap_or("idle"), selector, pad.unwrap_or(0.0).clamp(0.0, 200.0), scale, &mut issues).await?);
                    Ok(())
                }
            }
        }
        .await;
        if let Err(error) = result {
            // A missing element is reported and the session goes on: the other parts still count.
            issues.push(format!("step {step:?}: {error}"));
        }
        tokio::time::sleep(Duration::from_millis(120)).await;
    }
    if let Ok(Value::Array(missing)) = page.eval(&mut browser, FONT_CHECK).await {
        if !missing.is_empty() {
            let names: Vec<String> = missing.iter().filter_map(Value::as_str).map(str::to_owned).collect();
            issues.push(format!("fonts that did not load (shown in a fallback face): {}", names.join(", ")));
        }
    }
    for event in browser.take_events("Runtime.exceptionThrown").into_iter().take(4) {
        let text = event.pointer("/exceptionDetails/exception/description").or_else(|| event.pointer("/exceptionDetails/text")).and_then(Value::as_str).unwrap_or("an error");
        issues.push(format!("page error: {}", text.lines().next().unwrap_or(text)));
    }
    drop(browser);
    drop(server);
    let manifest = Manifest { key: request.key.clone(), url, width, height, scale, parts, issues, dir: dir.display().to_string() };
    std::fs::write(&manifest_path, serde_json::to_string_pretty(&manifest).unwrap_or_default()).map_err(|error| format!("cannot write the manifest: {error}"))?;
    Ok(manifest)
}

/// Captures a product (a web address, or Bhippi itself) as parts in states. See the module notes.
#[tauri::command]
pub async fn app_session_capture(app: AppHandle, state: State<'_, Arc<AppState>>, request: CaptureRequest) -> Result<Value, String> {
    if request.steps.len() > 400 {
        return Err("too many steps in one session (400 at most)".to_owned());
    }
    let job = state.jobs.start("capture", format!("Capturing {}", request.url.as_deref().unwrap_or("Bhippi")), false);
    match run(&app, &state, request).await {
        Ok(manifest) => {
            job.done(format!("{} part(s)", manifest.parts.len()), None);
            Ok(json!(manifest))
        }
        Err(error) => {
            job.fail(error.clone());
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{allowed_file, capture, slug, Browser, Page};
    use std::path::PathBuf;

    #[test]
    fn names_become_folder_safe() {
        assert_eq!(slug("Bhippi composer / typing"), "Bhippi-composer---typing");
        assert_eq!(slug("///"), "session");
    }

    #[test]
    fn only_files_under_bhippi_folders_are_served() {
        let root = std::env::temp_dir().join(format!("bhippi-capture-root-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&root).expect("root");
        let inside = root.join("thumb.png");
        std::fs::write(&inside, b"x").expect("write");
        assert!(allowed_file(&inside, &[root.clone()]));
        assert!(!allowed_file(&PathBuf::from(r"C:\Windows\win.ini"), &[root.clone()]));
        let _ignored = std::fs::remove_dir_all(&root);
    }

    /// A real browser: a part captured in two states, and typing captured character by character.
    #[tokio::test]
    async fn parts_are_captured_in_states_at_the_asked_scale() {
        let Some(program) = crate::ui_screen::find_browser() else { return };
        let work = std::env::temp_dir().join(format!("bhippi-capture-test-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&work).expect("work");
        let mut browser = Browser::launch(&program, &work).await.expect("launch");
        let page = Page::open(&mut browser, 600, 400, 3.0, None).await.expect("page");
        let html = "data:text/html,<input id=field style='position:absolute;left:10px;top:10px;width:300px;height:40px;font:20px sans-serif'><button id=send style='position:absolute;left:320px;top:10px;width:60px;height:40px' onclick=\"this.style.background='orange'\">go</button>";
        page.navigate(&mut browser, html).await.expect("navigate");
        let mut issues = Vec::new();
        let idle = capture(&page, &mut browser, &work, "send", "idle", "#send", 0.0, 3.0, &mut issues).await.expect("idle");
        page.click(&mut browser, 350.0, 30.0).await.expect("click");
        let pressed = capture(&page, &mut browser, &work, "send", "pressed", "#send", 0.0, 3.0, &mut issues).await.expect("pressed");
        assert_eq!(idle.pixels, [180, 120]);
        assert_ne!(std::fs::read(work.join(&idle.file)).expect("idle png"), std::fs::read(work.join(&pressed.file)).expect("pressed png"), "the state changed the picture");
        assert!(issues.is_empty(), "{issues:?}");
        let missing = capture(&page, &mut browser, &work, "gone", "idle", "#nope", 0.0, 3.0, &mut issues).await;
        assert!(missing.expect_err("no element").contains("#nope"));
        drop(browser);
        let _ignored = std::fs::remove_dir_all(&work);
    }
    /// The same part captured before and after the page scrolls is the same picture: the clip
    /// follows the scroll instead of landing beside the part.
    #[tokio::test]
    async fn a_scrolled_page_still_captures_the_part() {
        let Some(program) = crate::ui_screen::find_browser() else { return };
        let work = std::env::temp_dir().join(format!("bhippi-capture-scroll-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&work).expect("work");
        let mut browser = Browser::launch(&program, &work).await.expect("launch");
        let page = Page::open(&mut browser, 600, 400, 2.0, None).await.expect("page");
        let html = "data:text/html,<body style='margin:0;height:3000px;background:white'><div id=box style='position:absolute;left:40px;top:150px;width:200px;height:60px;background:linear-gradient(90deg,red,blue)'>part</div></body>";
        page.navigate(&mut browser, html).await.expect("navigate");
        let mut issues = Vec::new();
        let before = capture(&page, &mut browser, &work, "box", "a", "#box", 0.0, 2.0, &mut issues).await.expect("before");
        page.eval(&mut browser, "window.scrollTo(0, 100)").await.expect("scroll");
        let after = capture(&page, &mut browser, &work, "box", "b", "#box", 0.0, 2.0, &mut issues).await.expect("after");
        assert_eq!(std::fs::read(work.join(&before.file)).expect("a"), std::fs::read(work.join(&after.file)).expect("b"), "the scroll moved the crop");
        drop(browser);
        let _ignored = std::fs::remove_dir_all(&work);
    }
    /// End to end on Bhippi itself (run by hand: set BHIPPI_E2E_STANDIN to a stand-in script and
    /// BHIPPI_E2E_OUT to a folder, with the dev server on localhost:5199): the real interface boots
    /// on the stand-in, typing is captured per character, and the named parts come out at 3x.
    #[tokio::test]
    async fn bhippi_itself_is_captured_on_the_stand_in() {
        let (Ok(standin), Ok(out)) = (std::env::var("BHIPPI_E2E_STANDIN"), std::env::var("BHIPPI_E2E_OUT")) else { return };
        let Some(program) = crate::ui_screen::find_browser() else { return };
        let out = std::path::PathBuf::from(out);
        std::fs::create_dir_all(&out).expect("out");
        let script = std::fs::read_to_string(standin).expect("stand-in");
        let mut browser = Browser::launch(&program, &out).await.expect("launch");
        let page = Page::open(&mut browser, 1920, 1080, 3.0, Some(&script)).await.expect("page");
        page.navigate(&mut browser, "http://localhost:5199/").await.expect("navigate");
        for _ in 0..60 {
            if page.eval(&mut browser, "!!document.querySelector('form.composer')").await.expect("eval") == serde_json::Value::Bool(true) { break; }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
        page.eval(&mut browser, "document.fonts.ready.then(() => new Promise((done) => setTimeout(done, 600)))").await.expect("fonts");
        let mut issues = Vec::new();
        let [x, y, w, h] = super::rect_of(&page, &mut browser, "form.composer textarea").await.expect("field");
        page.click(&mut browser, x + w / 2.0, y + h / 2.0).await.expect("click");
        for (i, c) in "Cut my clips".chars().enumerate() {
            page.insert_text(&mut browser, &c.to_string()).await.expect("type");
            if i % 4 == 3 { capture(&page, &mut browser, &out, "composer", &format!("t{i:02}"), "form.composer", 0.0, 3.0, &mut issues).await.expect("composer"); }
        }
        for (part, selector) in [("send", "form.composer .send-btn"), ("pills", ".composer-pills"), ("timeline", ".timeline")] {
            let captured = capture(&page, &mut browser, &out, part, "idle", selector, 4.0, 3.0, &mut issues).await.expect(part);
            assert!(captured.pixels[0] > 0);
        }
        assert!(issues.is_empty(), "{issues:?}");
        let errors = browser.take_events("Runtime.exceptionThrown");
        assert!(errors.is_empty(), "page errors: {errors:?}");
    }
}
