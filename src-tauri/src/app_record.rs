//! record_app_scene: the real product, moving, recorded as video.
//!
//! capture_app_session cuts the app into still parts; a film built only from those is a slideshow
//! with a camera over it, because nothing inside a picture moves. The films that scored well
//! recorded the running app instead: at every output frame the actions that are due are played
//! (clicks, typing, drags, keys), every CSS animation and transition is scrubbed to that frame's
//! time, and the whole window is captured. Menus open, words type, toggles slide and the timeline
//! fills through the app's own code, frame-accurately, whatever the machine's speed.
//!
//! The frames become one video in the project's AI Work/recordings/<name>, with the boxes of the
//! named parts over time and every click and drag point (recording.json), so a camera can frame a
//! part and a panel can lift out of its real place. A repeat recording with the same key is reused.

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::Path;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::app_capture::{clipped_text, open, page_issues, rect_of, slug, Open, Opened};
use crate::cdp::{Browser, Page};
use crate::storage::{self, Category};
use crate::AppState;

/// The longest single recording: a scene, not a film (about 900 frames at 30 fps).
pub const MAX_SECONDS: f64 = 30.0;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordRequest {
    /// The page to record; none means Bhippi itself, opened on its editor.
    pub url: Option<String>,
    pub name: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// Device pixels per CSS pixel: 2 by default, so the camera can push in 2x and stay sharp.
    pub scale: Option<f64>,
    pub fps: Option<u32>,
    /// Seconds of recording.
    pub duration: f64,
    pub standin: Option<String>,
    pub ready: Option<String>,
    pub key: Option<String>,
    #[serde(default)]
    pub actions: Vec<Action>,
    /// Parts whose boxes are measured over time (for the camera and for lift-outs).
    #[serde(default)]
    pub parts: Vec<NamedPart>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NamedPart {
    pub part: String,
    pub selector: String,
}

/// Where a drag ends: another element, or an offset in CSS pixels from where it started.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum Target {
    Selector(String),
    Offset([f64; 2]),
}

/// One timed action. `at` is seconds from the start of the recording.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "do", rename_all = "camelCase")]
pub enum Action {
    Click { at: f64, selector: String },
    Hover { at: f64, selector: String },
    /// Types `text` one character at a time from `at` to `until` (14 characters a second when
    /// left out); with a selector, that field is clicked first.
    Type { at: f64, selector: Option<String>, text: String, until: Option<f64> },
    Key { at: f64, key: String },
    /// Presses on `selector` at `at`, moves to `to` and lets go at `until`.
    Drag { at: f64, selector: String, to: Target, until: f64 },
    /// Scrolls `selector` by `by` CSS pixels, eased from `at` to `until` (0.5 s when left out).
    Scroll { at: f64, selector: String, by: f64, until: Option<f64> },
    Eval { at: f64, js: String },
}

/// What a frame plays. Actions expand into these, one per moment they touch the page.
#[derive(Debug, Clone, PartialEq)]
enum Prim {
    Click(String),
    Hover(String),
    Insert(String),
    Key(String),
    DragStart(usize),
    DragMove(usize, f64),
    DragEnd(usize),
    Scroll(String, f64),
    Eval(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PartBox {
    pub t: f64,
    /// CSS pixels: x, y, width, height on the window.
    #[serde(rename = "box")]
    pub rect: [f64; 4],
}

/// A moment a cursor matters: where a click, hover, typing or drag happened.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub t: f64,
    pub kind: String,
    pub selector: String,
    pub point: [f64; 2],
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<[f64; 2]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub until: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recording {
    pub key: Option<String>,
    pub name: String,
    pub url: String,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
    pub fps: u32,
    pub duration: f64,
    pub video: String,
    pub poster: String,
    pub frames: usize,
    /// Frames that differ from the one before: how much of the recording actually moves.
    pub unique: usize,
    pub parts: BTreeMap<String, Vec<PartBox>>,
    pub events: Vec<Event>,
    pub issues: Vec<String>,
    pub dir: String,
}

/// The virtual clock: every running animation is paused and set to the frame's time since it
/// began, so CSS transitions and keyframes land on the same frame on any machine. The caret and
/// scrollbars blink and fade on real time, so they are hidden.
const CLOCK: &str = r"(() => {
  const births = new WeakMap();
  window.__bhippiClock = (t) => {
    for (const animation of document.getAnimations()) {
      if (!births.has(animation)) births.set(animation, t);
      try { animation.pause(); animation.currentTime = Math.max(0, (t - births.get(animation)) * 1000); } catch (error) {}
    }
    return true;
  };
  const style = document.createElement('style');
  style.textContent = '*{caret-color:transparent!important} ::-webkit-scrollbar{display:none!important}';
  document.head.appendChild(style);
  return true;
})()";

/// Two animation frames: the page has drawn what the last action changed.
const SETTLE: &str = "new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true))))";

/// The boxes of several selectors, without scrolling anything (null for one that is not there).
const BOXES: &str = "(selectors) => selectors.map((selector) => { const el = document.querySelector(selector); if (!el) return null; const r = el.getBoundingClientRect(); return r.width && r.height ? [r.x, r.y, r.width, r.height] : null; })";

fn ease(p: f64) -> f64 {
    // easeInOutCubic: a hand that speeds up and settles.
    if p < 0.5 { 4.0 * p * p * p } else { 1.0 - (-2.0 * p + 2.0) * (-2.0 * p + 2.0) * (-2.0 * p + 2.0) / 2.0 }
}

/// The actions as a list of timed primitives, in order, at the frame rate's grid for anything
/// that moves over time (typing, drags, scrolls).
fn expand(actions: &[Action], fps: u32, duration: f64) -> Vec<(f64, Prim)> {
    let step = 1.0 / f64::from(fps.max(1));
    let mut out: Vec<(f64, Prim)> = Vec::new();
    for (index, action) in actions.iter().enumerate() {
        match action {
            Action::Click { at, selector } => out.push((*at, Prim::Click(selector.clone()))),
            Action::Hover { at, selector } => out.push((*at, Prim::Hover(selector.clone()))),
            Action::Key { at, key } => out.push((*at, Prim::Key(key.clone()))),
            Action::Eval { at, js } => out.push((*at, Prim::Eval(js.clone()))),
            Action::Type { at, selector, text, until } => {
                let mut start = *at;
                if let Some(selector) = selector {
                    out.push((start, Prim::Click(selector.clone())));
                    start += step;
                }
                let characters: Vec<char> = text.chars().collect();
                let count = characters.len().max(1) as f64;
                let end = until.unwrap_or(start + count / 14.0).max(start);
                for (i, character) in characters.iter().enumerate() {
                    let t = if characters.len() <= 1 { start } else { start + (end - start) * (i as f64 / (count - 1.0)) };
                    out.push((t, Prim::Insert(character.to_string())));
                }
            }
            Action::Drag { at, until, .. } => {
                let end = until.max(at + step);
                out.push((*at, Prim::DragStart(index)));
                let mut t = at + step;
                while t < end - 1e-9 {
                    out.push((t, Prim::DragMove(index, ease((t - at) / (end - at)))));
                    t += step;
                }
                out.push((end, Prim::DragMove(index, 1.0)));
                out.push((end, Prim::DragEnd(index)));
            }
            Action::Scroll { at, selector, by, until } => {
                let end = until.unwrap_or(at + 0.5).max(at + step);
                let mut done = 0.0;
                let mut t = *at;
                while t <= end + 1e-9 {
                    let target = by * ease(((t - at) / (end - at)).clamp(0.0, 1.0));
                    out.push((t, Prim::Scroll(selector.clone(), target - done)));
                    done = target;
                    t += step;
                }
                if (by - done).abs() > 0.01 {
                    out.push((end, Prim::Scroll(selector.clone(), by - done)));
                }
            }
        }
    }
    // Stable: actions given at the same moment play in the order they were given.
    out.retain(|(t, _)| *t >= 0.0 && *t <= duration + 1e-9);
    out.sort_by(|a, b| a.0.total_cmp(&b.0));
    out
}

/// FNV-1a over a frame's bytes: an unchanged frame is written once and shown again.
fn fnv(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    hash
}

/// The concat list FFmpeg reads: each distinct frame once, held for as long as it stayed.
fn concat_list(frames: &[String], fps: u32) -> String {
    let mut text = String::from("ffconcat version 1.0\n");
    let mut runs: Vec<(&str, usize)> = Vec::new();
    for frame in frames {
        match runs.last_mut() {
            Some((name, count)) if *name == frame.as_str() => *count += 1,
            _ => runs.push((frame.as_str(), 1)),
        }
    }
    for (name, count) in &runs {
        let _ignored = writeln!(text, "file '{name}'\nduration {:.6}", *count as f64 / f64::from(fps));
    }
    // The concat demuxer drops the last entry's duration unless the file is listed once more.
    if let Some((name, _)) = runs.last() {
        let _ignored = writeln!(text, "file '{name}'");
    }
    text
}

async fn center(page: &Page, browser: &mut Browser, selector: &str) -> Result<[f64; 2], String> {
    let [x, y, w, h] = rect_of(page, browser, selector).await?;
    Ok([x + w / 2.0, y + h / 2.0])
}

struct Player {
    drags: BTreeMap<usize, ([f64; 2], [f64; 2])>,
    events: Vec<Event>,
    issues: Vec<String>,
}

impl Player {
    async fn play(&mut self, page: &Page, browser: &mut Browser, actions: &[Action], t: f64, prim: &Prim) -> Result<(), String> {
        match prim {
            Prim::Click(selector) => {
                let point = center(page, browser, selector).await?;
                page.click(browser, point[0], point[1]).await?;
                self.events.push(Event { t, kind: "click".into(), selector: selector.clone(), point, to: None, until: None });
            }
            Prim::Hover(selector) => {
                let point = center(page, browser, selector).await?;
                page.hover(browser, point[0], point[1]).await?;
                self.events.push(Event { t, kind: "hover".into(), selector: selector.clone(), point, to: None, until: None });
            }
            Prim::Insert(text) => page.insert_text(browser, text).await?,
            Prim::Key(key) => page.key(browser, key).await?,
            Prim::Eval(js) => {
                page.eval(browser, js).await?;
            }
            Prim::Scroll(selector, by) => {
                let script = format!("(() => {{ const el = document.querySelector({}); if (!el) throw new Error('nothing matches'); el.scrollBy(0, {by}); return true; }})()", serde_json::to_string(selector).unwrap_or_default());
                page.eval(browser, &script).await?;
            }
            Prim::DragStart(index) => {
                let Some(Action::Drag { selector, to, until, .. }) = actions.get(*index) else { return Ok(()) };
                let from = center(page, browser, selector).await?;
                let end = match to {
                    Target::Offset([dx, dy]) => [from[0] + dx, from[1] + dy],
                    Target::Selector(target) => center(page, browser, target).await?,
                };
                page.mouse(browser, "mouseMoved", from[0], from[1], false).await?;
                page.mouse(browser, "mousePressed", from[0], from[1], true).await?;
                self.drags.insert(*index, (from, end));
                self.events.push(Event { t, kind: "drag".into(), selector: selector.clone(), point: from, to: Some(end), until: Some(*until) });
            }
            Prim::DragMove(index, p) => {
                if let Some((from, end)) = self.drags.get(index).copied() {
                    page.mouse(browser, "mouseMoved", from[0] + (end[0] - from[0]) * p, from[1] + (end[1] - from[1]) * p, true).await?;
                }
            }
            Prim::DragEnd(index) => {
                if let Some((_, end)) = self.drags.remove(index) {
                    page.mouse(browser, "mouseReleased", end[0], end[1], true).await?;
                }
            }
        }
        Ok(())
    }
}

/// The parts' boxes now, appended to their timelines when they moved.
async fn measure(page: &Page, browser: &mut Browser, parts: &[NamedPart], t: f64, into: &mut BTreeMap<String, Vec<PartBox>>) {
    if parts.is_empty() {
        return;
    }
    let selectors: Vec<&str> = parts.iter().map(|part| part.selector.as_str()).collect();
    let Ok(Value::Array(boxes)) = page.eval(browser, &format!("({BOXES})({})", serde_json::to_string(&selectors).unwrap_or_default())).await else { return };
    for (part, found) in parts.iter().zip(boxes) {
        let Some(values) = found.as_array() else { continue };
        let rect: Vec<f64> = values.iter().filter_map(Value::as_f64).map(|v| (v * 10.0).round() / 10.0).collect();
        let Ok(rect) = <[f64; 4]>::try_from(rect) else { continue };
        let line = into.entry(part.part.clone()).or_default();
        if line.last().is_none_or(|last| last.rect != rect) {
            line.push(PartBox { t: (t * 1000.0).round() / 1000.0, rect });
        }
    }
}

async fn encode(state: &AppState, dir: &Path, list: &Path, out: &Path, fps: u32) -> Result<(), String> {
    let tools = state.tools();
    let ffmpeg = tools.ffmpeg()?.to_path_buf();
    let x264 = tools.status.x264;
    drop(tools);
    let filter = format!("fps={fps},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p");
    let list = list.display().to_string();
    let out = out.display().to_string();
    let mut args = vec!["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list.as_str(), "-vf", filter.as_str()];
    // Near-lossless: the camera pushes into this picture, so its edges must stay crisp.
    args.extend(if x264 { ["-c:v", "libx264", "-preset", "medium", "-crf", "15"] } else { ["-c:v", "mpeg4", "-q:v", "2", "-g", "30"] });
    args.extend(["-movflags", "+faststart", out.as_str()]);
    crate::tools::run(&ffmpeg, &args, Some(dir)).await.map(|_| ())
}

/// The recording's timing and size.
#[derive(Clone, Copy)]
struct Grid {
    fps: u32,
    duration: f64,
    width: u32,
    height: u32,
}

/// The frames as written (`frames/fNNNNN.jpg`, one entry per output frame, repeats held), and
/// what was learned while playing.
struct Filmed {
    frames: Vec<String>,
    unique: usize,
    parts: BTreeMap<String, Vec<PartBox>>,
    events: Vec<Event>,
    issues: Vec<String>,
}

/// Plays the actions on the virtual clock and writes every frame into `dir`/frames.
async fn film(page: &Page, browser: &mut Browser, actions: &[Action], named: &[NamedPart], grid: Grid, dir: &Path, report: &impl Fn(f64, String)) -> Result<Filmed, String> {
    let Grid { fps, duration, width, height } = grid;
    std::fs::create_dir_all(dir.join("frames")).map_err(|error| format!("cannot create the frames folder: {error}"))?;
    page.eval(browser, CLOCK).await?;
    // The pointer starts off in the corner, so no hover state shows before the first action.
    let _ignored = page.mouse(browser, "mouseMoved", f64::from(width) - 2.0, f64::from(height) - 2.0, false).await;
    let prims = expand(actions, fps, duration);
    let total = ((duration * f64::from(fps)).round() as usize).max(1);
    let mut player = Player { drags: BTreeMap::new(), events: Vec::new(), issues: Vec::new() };
    let mut parts = BTreeMap::new();
    let mut frames: Vec<String> = Vec::with_capacity(total);
    let mut previous: Option<u64> = None;
    let mut unique = 0;
    let mut next = 0;
    let mut failed: BTreeMap<String, usize> = BTreeMap::new();
    let mut clipped: Vec<String> = Vec::new();
    for frame in 0..total {
        let t = frame as f64 / f64::from(fps);
        let mut acted = frame == 0;
        while next < prims.len() && prims[next].0 <= t + 1e-6 {
            let (at, prim) = &prims[next];
            if let Err(error) = player.play(page, browser, actions, *at, prim).await {
                let label = format!("{prim:?}").split('(').next().unwrap_or("step").to_lowercase();
                *failed.entry(format!("{label} at {at:.2} s: {error}")).or_default() += 1;
            }
            next += 1;
            acted = true;
        }
        if acted {
            let _ignored = page.eval(browser, SETTLE).await;
            measure(page, browser, named, t, &mut parts).await;
            if let Some(issue) = clipped_text(page, browser, None, &format!("the window at {t:.2} s")).await {
                // The same labels cut short at another moment are one issue, not one per frame.
                let labels = |text: &str| text.split_once(": ").map(|(_, rest)| rest.to_owned());
                if !clipped.iter().any(|known: &String| labels(known) == labels(&issue)) {
                    clipped.push(issue);
                }
            }
        }
        page.eval(browser, &format!("window.__bhippiClock({t})")).await?;
        let bytes = page.frame_jpeg(browser, 92).await?;
        let hash = fnv(&bytes);
        if previous == Some(hash) {
            let last = frames.last().cloned().unwrap_or_default();
            frames.push(last);
        } else {
            let name = format!("frames/f{frame:05}.jpg");
            std::fs::write(dir.join(&name), &bytes).map_err(|error| format!("cannot write a frame: {error}"))?;
            frames.push(name);
            previous = Some(hash);
            unique += 1;
        }
        if frame % 15 == 0 {
            report(0.9 * frame as f64 / total as f64, format!("frame {frame} of {total}"));
        }
    }
    measure(page, browser, named, duration, &mut parts).await;
    page_issues(page, browser, &mut player.issues).await;
    player.issues.extend(failed.into_iter().take(8).map(|(text, count)| if count > 1 { format!("{text} (×{count})") } else { text }));
    player.issues.extend(clipped.into_iter().take(3));
    for part in named {
        if !parts.contains_key(&part.part) {
            player.issues.push(format!("part {} ({}) was never on the page", part.part, part.selector));
        }
    }
    if unique <= 1 && total > 1 {
        player.issues.push("nothing moved: every frame is the same picture. Check the actions and their selectors.".to_owned());
    }
    Ok(Filmed { frames, unique, parts, events: player.events, issues: player.issues })
}

async fn run(app: &AppHandle, state: &AppState, session: &str, request: RecordRequest, report: impl Fn(f64, String)) -> Result<Recording, String> {
    let width = request.width.unwrap_or(1920).clamp(320, 3840);
    let height = request.height.unwrap_or(1080).clamp(240, 2160);
    let scale = request.scale.unwrap_or(2.0).clamp(1.0, 3.0);
    let fps = request.fps.unwrap_or(30).clamp(12, 60);
    let duration = request.duration.clamp(0.25, MAX_SECONDS);
    let dir = storage::dir(state, session, Category::AiWork)?.join("recordings").join(slug(&request.name));
    let manifest_path = dir.join("recording.json");
    if let (Some(key), Ok(text)) = (request.key.as_ref(), std::fs::read_to_string(&manifest_path)) {
        if let Ok(known) = serde_json::from_str::<Recording>(&text) {
            if known.key.as_ref() == Some(key) && Path::new(&known.video).is_file() {
                return Ok(known);
            }
        }
    }
    // A new recording replaces the frames of an older one under the same name.
    let _ignored = std::fs::remove_dir_all(dir.join("frames"));

    let Opened { mut browser, page, server, url } =
        open(app, state, &Open { url: request.url.as_deref(), width, height, scale, standin: request.standin.as_deref(), ready: request.ready.as_deref(), transparent: false }).await?;
    let filmed = film(&page, &mut browser, &request.actions, &request.parts, Grid { fps, duration, width, height }, &dir, &report).await;
    drop(browser);
    drop(server);
    let Filmed { frames, unique, parts, events, issues } = filmed?;
    let total = frames.len();

    report(0.92, "encoding".to_owned());
    let list = dir.join("frames.txt");
    std::fs::write(&list, concat_list(&frames, fps)).map_err(|error| format!("cannot write the frame list: {error}"))?;
    let video = dir.join("recording.mp4");
    encode(state, &dir, &list, &video, fps).await?;
    let poster = dir.join(frames.first().cloned().unwrap_or_default());
    let recording = Recording {
        key: request.key.clone(),
        name: request.name.clone(),
        url,
        width,
        height,
        scale,
        fps,
        duration,
        video: video.display().to_string(),
        poster: poster.display().to_string(),
        frames: total,
        unique,
        parts,
        events,
        issues,
        dir: dir.display().to_string(),
    };
    std::fs::write(&manifest_path, serde_json::to_string_pretty(&recording).unwrap_or_default()).map_err(|error| format!("cannot write recording.json: {error}"))?;
    Ok(recording)
}

/// Records a product (a web address, or Bhippi itself) moving through timed actions. See the module notes.
#[tauri::command]
pub async fn app_session_record(app: AppHandle, webview: tauri::Webview, state: State<'_, Arc<AppState>>, request: RecordRequest) -> Result<Value, String> {
    let session = state.session(&webview);
    if request.actions.len() > 400 {
        return Err("too many actions in one recording (400 at most)".to_owned());
    }
    if !request.duration.is_finite() || request.duration <= 0.0 {
        return Err("give the recording a duration in seconds".to_owned());
    }
    let job = state.jobs.start("capture", format!("Recording {}", request.url.as_deref().unwrap_or("Bhippi")), false);
    let outcome = run(&app, &state, &session, request, |fraction, message| job.progress(fraction, message)).await;
    match outcome {
        Ok(recording) => {
            job.done(format!("{} frames, {} moving", recording.frames, recording.unique), None);
            Ok(json!(recording))
        }
        Err(error) => {
            job.fail(error.clone());
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{concat_list, expand, film, Action, Grid, NamedPart, Prim, Target};
    use crate::cdp::{Browser, Page};

    #[test]
    fn typing_spreads_over_its_span_after_the_click() {
        let actions = vec![Action::Type { at: 1.0, selector: Some("#f".into()), text: "abc".into(), until: Some(2.0) }];
        let prims = expand(&actions, 10, 5.0);
        assert_eq!(prims[0], (1.0, Prim::Click("#f".into())));
        let inserts: Vec<f64> = prims.iter().filter(|(_, p)| matches!(p, Prim::Insert(_))).map(|(t, _)| *t).collect();
        assert_eq!(inserts.len(), 3);
        assert!((inserts[0] - 1.1).abs() < 1e-9 && (inserts[2] - 2.0).abs() < 1e-9);
    }

    #[test]
    fn a_drag_presses_moves_on_every_frame_and_lets_go() {
        let actions = vec![Action::Drag { at: 0.0, selector: "#a".into(), to: Target::Offset([100.0, 0.0]), until: 0.5 }];
        let prims = expand(&actions, 10, 5.0);
        assert_eq!(prims.first().map(|p| &p.1), Some(&Prim::DragStart(0)));
        assert_eq!(prims.last().map(|p| &p.1), Some(&Prim::DragEnd(0)));
        let moves = prims.iter().filter(|(_, p)| matches!(p, Prim::DragMove(..))).count();
        assert!(moves >= 4, "a move per frame, got {moves}");
    }

    #[test]
    fn a_scroll_adds_up_to_its_distance() {
        let actions = vec![Action::Scroll { at: 0.0, selector: ".list".into(), by: 300.0, until: Some(0.6) }];
        let total: f64 = expand(&actions, 30, 5.0).iter().map(|(_, p)| if let Prim::Scroll(_, by) = p { *by } else { 0.0 }).sum();
        assert!((total - 300.0).abs() < 0.01);
    }

    #[test]
    fn actions_past_the_end_are_dropped_and_the_rest_sorted() {
        let actions = vec![Action::Key { at: 3.0, key: "Enter".into() }, Action::Key { at: 9.0, key: "Tab".into() }, Action::Hover { at: 1.0, selector: "#x".into() }];
        let prims = expand(&actions, 30, 5.0);
        assert_eq!(prims.len(), 2);
        assert_eq!(prims[0].1, Prim::Hover("#x".into()));
    }

    #[test]
    fn repeated_frames_are_held_not_repeated() {
        let frames = vec!["a.jpg".to_owned(), "a.jpg".to_owned(), "b.jpg".to_owned()];
        let list = concat_list(&frames, 30);
        assert!(list.starts_with("ffconcat version 1.0"));
        assert!(list.contains("file 'a.jpg'\nduration 0.066667"));
        assert!(list.contains("file 'b.jpg'\nduration 0.033333"));
        assert!(list.trim_end().ends_with("file 'b.jpg'"));
    }

    /// A real browser: a click starts a 300 ms CSS transition, and the virtual clock captures it
    /// in between frames rather than jumping to its end; the part's box is measured as it grows.
    #[tokio::test]
    async fn a_transition_is_recorded_frame_by_frame() {
        let Some(program) = crate::ui_screen::find_browser() else { return };
        let work = std::env::temp_dir().join(format!("bhippi-record-test-{}", ulid::Ulid::new()));
        let mut browser = Browser::launch(&program, &work).await.expect("launch");
        let page = Page::open(&mut browser, 400, 200, 1.0, None).await.expect("page");
        // No "#" anywhere: in a data: address it starts the fragment and cuts the page short.
        let html = "data:text/html,<style>body{margin:0;background:white}.bar{position:absolute;left:20px;top:80px;height:40px;width:40px;background:orange;transition:width 300ms linear}.bar.on{width:340px}</style><div class=bar onclick=\"this.classList.add('on')\"></div>";
        page.navigate(&mut browser, html).await.expect("navigate");
        let actions = vec![Action::Click { at: 0.1, selector: ".bar".into() }];
        let parts = vec![NamedPart { part: "bar".into(), selector: ".bar".into() }];
        let filmed = film(&page, &mut browser, &actions, &parts, Grid { fps: 20, duration: 0.6, width: 400, height: 200 }, &work, &|_, _| {}).await.expect("film");
        drop(browser);
        assert_eq!(filmed.frames.len(), 12);
        // Still before the click, a frame per step of the transition, still after it.
        assert!(filmed.unique >= 6, "the transition should be captured in steps, got {} distinct frames", filmed.unique);
        assert_eq!(filmed.events.len(), 1);
        assert_eq!(filmed.events[0].kind, "click");
        assert!(filmed.parts["bar"].len() >= 2, "the bar's box was measured before and after: {:?}", filmed.parts["bar"]);
        let _ignored = std::fs::remove_dir_all(&work);
    }

    /// End to end on Bhippi itself (run by hand): set BHIPPI_E2E_RECORD_STANDIN (a stand-in script),
    /// BHIPPI_E2E_RECORD_OUT and optionally BHIPPI_E2E_RECORD_URL (the dev server). It records the
    /// composer being used (a click, a prompt typed, the reasoning menu opened and an option
    /// picked) and encodes the video with the FFmpeg on PATH.
    #[tokio::test]
    async fn a_bhippi_recording_plays_its_actions() {
        let (Ok(standin), Ok(out)) = (std::env::var("BHIPPI_E2E_RECORD_STANDIN"), std::env::var("BHIPPI_E2E_RECORD_OUT")) else { return };
        let Some(program) = crate::ui_screen::find_browser() else { return };
        let base = std::env::var("BHIPPI_E2E_RECORD_URL").unwrap_or_else(|_| "http://localhost:5299/".to_owned());
        let out = std::path::PathBuf::from(out);
        let _ignored = std::fs::remove_dir_all(out.join("frames"));
        std::fs::create_dir_all(&out).expect("out");
        let script = std::fs::read_to_string(standin).expect("stand-in");
        let mut browser = Browser::launch(&program, &out).await.expect("launch");
        let page = Page::open(&mut browser, 1920, 1080, 1.0, Some(&script)).await.expect("page");
        page.navigate(&mut browser, &crate::app_capture::bhippi_capture_url(&base)).await.expect("navigate");
        let mut ready = false;
        for _ in 0..80 {
            if page.eval(&mut browser, "!!document.querySelector('form.composer') && !!document.querySelector('.timeline')").await.expect("eval") == serde_json::Value::Bool(true) { ready = true; break; }
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }
        assert!(ready, "Bhippi never showed its editor in the capture view");
        page.eval(&mut browser, "document.fonts.ready.then(() => new Promise((done) => setTimeout(done, 800)))").await.expect("fonts");
        let actions = vec![
            Action::Type { at: 0.4, selector: Some("form.composer textarea".into()), text: "Make a launch film for Bhippi".into(), until: Some(1.8) },
            Action::Click { at: 2.1, selector: ".composer-pills button[aria-label^='Editing workflow']".into() },
            Action::Hover { at: 2.6, selector: ".pill-menu [role=menuitemradio]:nth-child(2)".into() },
            Action::Click { at: 3.0, selector: ".pill-menu [role=menuitemradio]:nth-child(2)".into() },
        ];
        let parts = vec![
            NamedPart { part: "composer".into(), selector: "form.composer".into() },
            NamedPart { part: "timeline".into(), selector: ".timeline".into() },
            NamedPart { part: "menu".into(), selector: ".pill-menu".into() },
        ];
        let filmed = film(&page, &mut browser, &actions, &parts, Grid { fps: 30, duration: 4.0, width: 1920, height: 1080 }, &out, &|_, _| {}).await.expect("film");
        drop(browser);
        std::fs::write(out.join("frames.txt"), concat_list(&filmed.frames, 30)).expect("list");
        std::fs::write(out.join("filmed.json"), serde_json::to_string_pretty(&serde_json::json!({ "unique": filmed.unique, "frames": filmed.frames.len(), "parts": filmed.parts, "events": filmed.events, "issues": filmed.issues })).unwrap_or_default()).expect("json");
        let status = std::process::Command::new("ffmpeg")
            .args(["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "frames.txt", "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-crf", "16", "recording.mp4"])
            .current_dir(&out)
            .status()
            .expect("ffmpeg");
        assert!(status.success());
        assert!(filmed.unique > 20, "typing and the menu should change many frames, got {}", filmed.unique);
        assert!(filmed.parts.contains_key("menu"), "the reasoning menu opened: {:?}", filmed.issues);
        assert!(filmed.issues.iter().all(|issue| !issue.contains("nothing on the page")), "every action landed: {:?}", filmed.issues);
    }
}
