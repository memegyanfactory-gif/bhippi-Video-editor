//! Project tabs: several projects open at once inside the one Bhippi window (sessions.rs holds
//! their files).
//!
//! Every project is a webview of its own inside the window: the first is the window's own, the
//! others are added beside it (Tauri's multiwebview). Only the active tab's webview is shown, over
//! the whole window; switching a tab shows another and hides the rest, in place, so it reads as
//! one app, the way a browser shows its pages. Each webview is a whole editor (its own undo
//! history, chat, AI turns and preview), so projects work side by side without mixing. A tab
//! restored from the last launch gets its webview when first shown, so sixteen tabs do not start
//! sixteen editors, and a new one stays hidden until its project is in (no half-drawn page).
//!
//! The overview lays every project's webview out as tiles inside the same window, under a thin
//! bar of its own (the "overview" webview, for the window's controls), each tile a chat beside its
//! preview. A tile dragged by its bar onto another swaps places with it.
//!
//! The window's minimize, maximize and close have a small webview of their own (the "controls"),
//! laid over the menu bar's buttons at the top right and kept above every other webview. It is a
//! page with nothing else to do and a renderer process of its own, so the buttons answer while a
//! project's page is busy (loading a big project, an AI turn applying edits) or stuck.
//!
//! Events for one project go to its webview by `EventTarget::webview`, never by a bare label: the
//! first project's webview is called "main", like the window, and a bare "main" reaches every
//! webview in the window, so every project would run the first one's AI tool calls.
//!
//! Every command here that can make a webview is `async`: making one waits on the main thread, so
//! from a synchronous command (which runs there) it would never finish.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Rect, State, Webview, WebviewBuilder, WebviewUrl, Window};

use crate::sessions::{self, Session, TabsState, TABS_EVENT};
use crate::AppState;

/// A project is asked to close its tab (or, with `app`, to get ready for Bhippi to quit): it saves
/// or asks, and answers with `tab_close_answer`.
const CLOSE_REQUEST_EVENT: &str = "bhippi://tab-close-request";
/// The overview turned on or off: each project switches to its chat-and-preview layout, or back.
const OVERVIEW_EVENT: &str = "bhippi://overview";
/// While a tile is dragged in the overview: which tile it would swap with (its session id, or none).
const OVERVIEW_TARGET_EVENT: &str = "bhippi://overview-target";
/// How long a project has to answer a close request before it is treated as refusing.
const CLOSE_WAIT: Duration = Duration::from_secs(600);
/// How long a project's page has to say it heard a close request (before it asks anything). A page
/// that has not by then is stuck: quitting goes on without it, and its autosave (every half second)
/// keeps its work for the next launch, which offers it back. Answering (a question to the user)
/// may take as long as `CLOSE_WAIT`.
const CLOSE_HEARD_WAIT: Duration = Duration::from_secs(6);
/// How long a tab's webview may take to load before it is shown anyway.
const LOAD_WAIT: Duration = Duration::from_secs(20);
/// The window Bhippi opens (tauri.conf.json); every project's webview lives in it.
const WINDOW: &str = "main";
/// The overview's own bar across the top of the window.
const OVERVIEW_BAR: &str = "overview";
/// Its height, in logical pixels: the menu bar's (--menubar-h in app.css). The tiles meet edge to edge and each draws its own border: a
/// gap between them would be window no webview covers, left showing what was there before.
const BAR_HEIGHT: f64 = 28.0;
/// The window's own minimize, maximize and close (src/components/WindowControls.tsx): their webview's
/// label is this and a number, a new one each time they are made again (`controls_on_top`).
const CONTROLS: &str = "controls";
/// Its width, in logical pixels: the menu bar's three buttons (`.win-btn` in app.css, 44 px each).
/// Its height is the menu bar's.
const CONTROLS_WIDTH: f64 = 132.0;

/// Close requests waiting for their project's answer, by webview label.
static ANSWERS: Mutex<Option<HashMap<String, tokio::sync::oneshot::Sender<bool>>>> = Mutex::new(None);
/// Close requests (and the quit summary) waiting for the page to say it heard them, by webview label.
static HEARD: Mutex<Option<HashMap<String, tokio::sync::oneshot::Sender<()>>>> = Mutex::new(None);
/// The launch splash is done and the editor is on screen (`launched`): projects restored from last
/// time may start opening out of sight from then on, not while the first one is coming up.
static LAUNCHED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// Bhippi is quitting: a second quit (every webview hears the window's close) is the same one.
static QUITTING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// The controls' webview now, by label (None until the launch splash is done).
static CONTROLS_LABEL: Mutex<Option<String>> = Mutex::new(None);
/// How many times the controls were made, for each new one's label.
static CONTROLS_MADE: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
/// A webview was made after the controls, so it sits above them: they are made again, on top, when
/// it comes on screen (`controls_on_top`).
static CONTROLS_BURIED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CloseRequest {
    /// Bhippi is quitting (every tab stays in the list for next time), rather than one tab closing.
    app: bool,
    /// "ask": the project asks about its own unsaved work. "save" / "discard": the user already
    /// chose for every project at once (quitting with several open): save it, or let the changes go,
    /// without asking again.
    mode: &'static str,
}

/// Quitting with several projects open asks once, in the project on screen: what would be lost.
const QUIT_SUMMARY_EVENT: &str = "bhippi://quit-summary";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct QuitSummary {
    /// Projects with a file and unsaved changes.
    unsaved: Vec<String>,
    /// Projects Bhippi AI is working in.
    busy: Vec<String>,
}

/// The answer to the quit summary: "save", "discard" or "cancel".
static QUIT_CHOICE: Mutex<Option<tokio::sync::oneshot::Sender<String>>> = Mutex::new(None);

/// A project's webview: the first one, or a tab's.
pub fn is_editor(label: &str) -> bool {
    label == "main" || label.starts_with("tab-")
}

/// Bhippi's window.
pub fn main_window(app: &AppHandle) -> Option<Window> {
    app.get_window(WINDOW)
}

/// The window, for code that needs it placed on screen (a screenshot of it).
pub fn shown_window(app: &AppHandle) -> Option<Window> {
    main_window(app)
}

pub fn emit_tabs(app: &AppHandle, state: &AppState) {
    let _ignored = app.emit(TABS_EVENT, state.sessions.state(None));
}

/// The whole window's inside, in physical pixels.
fn full_bounds(window: &Window) -> Rect {
    let size = window.inner_size().unwrap_or(PhysicalSize::new(1480, 920));
    Rect { position: PhysicalPosition::new(0, 0).into(), size: size.into() }
}

/// Keeps the frameless window resizable from its edges. Its edge handles are a strip laid over the
/// window; a webview added later sits above it, so the strip is laid again on top.
fn edges_on_top(window: &Window) {
    let _ignored = window.set_resizable(false);
    let _ignored = window.set_resizable(true);
}

/// Called once the window is up: its edges are resizable (see `edges_on_top`).
pub fn window_ready(window: &Window) {
    edges_on_top(window);
}

/// The webview showing a session, made (hidden) when it has none yet.
fn ensure_webview(app: &AppHandle, state: &AppState, id: &str) -> Result<Webview, String> {
    if let Some(webview) = state.sessions.window_of(id).and_then(|label| app.get_webview(&label)) {
        return Ok(webview);
    }
    let label = sessions::window_label(id);
    if let Some(webview) = app.get_webview(&label) {
        state.sessions.attach(&label, id);
        return Ok(webview);
    }
    let window = main_window(app).ok_or("Bhippi's window is not open")?;
    // Made at the window's size but just past its right edge (out of sight, never over the project
    // in use), then hidden; put in place once its project is in. At full size its editor lays its
    // panels out as they will be seen, rather than in a pixel.
    let size = window.inner_size().unwrap_or(PhysicalSize::new(1480, 920));
    // Made without the keyboard focus: a webview takes it when made, so one opened out of sight
    // took it from the project in use (its shortcuts stopped until it was clicked). It gets the
    // focus when it is shown (`reveal`).
    let builder = WebviewBuilder::new(&label, WebviewUrl::App("index.html".into()))
        .auto_resize()
        .focused(false)
        .background_color(tauri::window::Color(11, 11, 15, 255));
    let webview = window
        .add_child(builder, PhysicalPosition::new(size.width as i32, 0), size)
        .map_err(|error| format!("could not open the project: {error}"))?;
    let _ignored = webview.hide();
    controls_buried();
    edges_on_top(&window);
    state.sessions.attach(&label, id);
    Ok(webview)
}

// ───────────────────────────── the window's controls ─────────────────────────────

/// Where the controls sit in a window `width` physical pixels wide at `scale`: the top right
/// corner, the menu bar's height. As (x, width, height), in physical pixels.
fn controls_place(width: u32, scale: f64) -> (i32, u32, u32) {
    let w = ((CONTROLS_WIDTH * scale).round() as u32).min(width);
    let h = (BAR_HEIGHT * scale).round() as u32;
    ((width - w) as i32, w, h)
}

fn controls_bounds(window: &Window) -> (PhysicalPosition<i32>, PhysicalSize<u32>) {
    let size = window.inner_size().unwrap_or(PhysicalSize::new(1480, 920));
    let (x, w, h) = controls_place(size.width, window.scale_factor().unwrap_or(1.0));
    (PhysicalPosition::new(x, 0), PhysicalSize::new(w, h))
}

/// The controls' webview, once made.
fn controls(app: &AppHandle) -> Option<Webview> {
    let label = CONTROLS_LABEL.lock().ok()?.clone()?;
    app.get_webview(&label)
}

/// Keeps the controls over the menu bar's buttons as the window changes size. Runs on the main
/// thread (the window's resize event), so it only moves them: making a webview waits on that thread.
fn place_controls(app: &AppHandle) {
    let (Some(window), Some(controls)) = (main_window(app), controls(app)) else { return };
    let (position, size) = controls_bounds(&window);
    // A minimized window is 0 wide: the controls keep their place until it is back.
    if size.width > 0 {
        let _ignored = controls.set_bounds(Rect { position: position.into(), size: size.into() });
    }
}

/// Makes the controls, over the menu bar's buttons and above every webview made before them (the
/// last webview made sits on top), in place of the ones before. Never on the main thread.
fn make_controls(app: &AppHandle) -> Result<(), String> {
    let window = main_window(app).ok_or("Bhippi's window is not open")?;
    let (position, size) = controls_bounds(&window);
    let label = format!("{CONTROLS}-{}", CONTROLS_MADE.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1);
    // See-through: the menu bar's own buttons, drawn by the project's page in its theme, show
    // through it; it draws only the hover, and takes the clicks. Never the keyboard focus.
    let builder = WebviewBuilder::new(&label, WebviewUrl::App("index.html?view=controls".into())).transparent(true).focused(false);
    window.add_child(builder, position, size).map_err(|error| format!("could not lay the window's controls: {error}"))?;
    let before = CONTROLS_LABEL.lock().ok().and_then(|mut current| current.replace(label));
    if let Some(old) = before.and_then(|label| app.get_webview(&label)) {
        let _ignored = old.close();
    }
    // Their corner is also the window's top right resize handle when it is not maximized.
    edges_on_top(&window);
    Ok(())
}

/// A webview was just made: it sits above the controls until they are made again.
fn controls_buried() {
    CONTROLS_BURIED.store(true, std::sync::atomic::Ordering::SeqCst);
}

/// A webview came on screen: if it was made after the controls (it would cover them and take
/// their clicks), they are made again above it. Tauri has no way to raise a webview; moving it
/// into its own window again does, but that holds the webview while it waits on the main thread,
/// and the window's resize handler moving the controls then waited on it in turn: the window hung.
fn controls_on_top(app: &AppHandle) {
    if controls(app).is_none() || !CONTROLS_BURIED.swap(false, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = make_controls(&app) {
            tracing::warn!(%error, "the window's controls are left under a project's webview");
        }
    });
}

/// The launch splash is done (lib.rs `end_splash`): the controls are laid, and a few seconds later,
/// once the editor on screen has settled, the projects restored from last time start opening out of
/// sight (`warm_next`). Only the first call does anything.
pub fn launched(app: &AppHandle) {
    use std::sync::atomic::Ordering;
    if LAUNCHED.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Making a webview waits on the main thread, and this was called from it (`splash_done`).
        if let Err(error) = make_controls(&app) {
            tracing::warn!(%error, "the window's controls stay in each project's own menu bar");
        }
        tokio::time::sleep(WARM_AFTER_LAUNCH).await;
        if let Some(state) = app.try_state::<Arc<AppState>>() {
            warm_next(&app, &state);
        }
    });
}

/// The webview on screen now (the active tab's), if it is open.
fn visible_webview(app: &AppHandle, state: &AppState) -> Option<Webview> {
    let id = state.sessions.active()?;
    state.sessions.window_of(&id).and_then(|label| app.get_webview(&label))
}

/// Shows a session's tab. A webview still loading its project stays hidden, the current one on
/// screen, until it reports in (as a browser keeps the page up until the next one is ready): no
/// half-drawn page is ever shown.
pub fn activate(app: &AppHandle, state: &AppState, id: &str) -> Result<(), String> {
    if state.sessions.get(id).is_none() {
        return Err("that project is no longer open".to_owned());
    }
    ensure_webview(app, state, id)?;
    if !state.sessions.ready(id) {
        state.sessions.set_pending(Some(id));
        emit_tabs(app, state);
        let (app, id) = (app.clone(), id.to_owned());
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(LOAD_WAIT).await;
            let Some(state) = app.try_state::<Arc<AppState>>() else { return };
            if state.sessions.take_pending(&id) {
                let _ignored = reveal(&app, &state, &id);
            }
        });
        return Ok(());
    }
    state.sessions.set_pending(None);
    reveal(app, state, id)
}

/// A tab's webview has loaded its project: shown now if it was waiting to be. Then the next
/// project restored from last time starts opening, out of sight (`warm_next`) — once Bhippi has
/// launched: the first project reports in while the launch splash is still up, and a second editor
/// starting then held the first one's arrival on screen (`launched` starts the warming instead).
pub fn loaded(app: &AppHandle, state: &AppState, id: &str) {
    if state.sessions.take_pending(id) {
        let _ignored = reveal(app, state, id);
    }
    if LAUNCHED.load(std::sync::atomic::Ordering::SeqCst) {
        warm_next(app, state);
    }
}

/// How many projects are kept open at once, ready to switch to. Each is a whole editor (a few
/// hundred MB), so past this the rest open when first clicked, as before.
const WARM_LIMIT: usize = 8;
/// The pause between one project opening and the next starting, so the one in use stays smooth.
const WARM_PAUSE: Duration = Duration::from_millis(1500);
/// How long after the launch splash the first project restored from last time starts opening: the
/// editor has just come on screen and is drawing its project, and the user's first clicks are
/// landing. Opening a whole second editor then (its own load of the settings and its project) took
/// the processor from it.
const WARM_AFTER_LAUNCH: Duration = Duration::from_secs(4);

/// Opens the first project restored from last time that has no webview yet, hidden: a project
/// opened when first clicked took seconds to start its editor (every switch to one felt held),
/// while one already open switches at once. One at a time, each after the one before has its
/// project in (its `tab_report` calls `loaded`, which calls this again).
fn warm_next(app: &AppHandle, state: &AppState) {
    let ids = state.sessions.ids();
    let open = ids.iter().filter(|id| state.sessions.window_of(id).is_some()).count();
    if open >= WARM_LIMIT {
        return;
    }
    let Some(next) = ids.into_iter().find(|id| state.sessions.window_of(id).is_none()) else { return };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(WARM_PAUSE).await;
        let Some(state) = app.try_state::<Arc<AppState>>() else { return };
        // Closed, or opened by a click, in the meantime.
        if state.sessions.get(&next).is_none() || state.sessions.window_of(&next).is_some() {
            return;
        }
        if let Err(error) = ensure_webview(&app, &state, &next) {
            tracing::warn!(%error, "could not open a project ahead of time");
        } else if state.sessions.overview() {
            layout_overview(&app, &state);
        }
    });
}

/// Puts a session's webview on screen over the whole window and hides the others.
fn reveal(app: &AppHandle, state: &AppState, id: &str) -> Result<(), String> {
    let target = ensure_webview(app, state, id)?;
    state.sessions.set_active(id);
    if state.sessions.overview() {
        let _ignored = target.set_focus();
        emit_tabs(app, state);
        return Ok(());
    }
    if let Some(window) = main_window(app) {
        let _ignored = target.set_bounds(full_bounds(&window));
        let _ignored = window.unminimize();
        let _ignored = window.show();
    }
    let _ignored = target.show();
    let _ignored = target.set_focus();
    for other in project_webviews(app, state).into_iter().filter(|webview| webview.label() != target.label()) {
        let _ignored = other.hide();
    }
    controls_on_top(app);
    emit_tabs(app, state);
    Ok(())
}

/// Every open project's webview, in tab order.
fn project_webviews(app: &AppHandle, state: &AppState) -> Vec<Webview> {
    state.sessions.ids().iter().filter_map(|id| state.sessions.window_of(id)).filter_map(|label| app.get_webview(&label)).collect()
}

/// Asks a session's project to close its tab (or get ready to quit) and waits for its answer.
async fn ask_to_close(app: &AppHandle, state: &AppState, id: &str, quitting: bool, mode: &'static str) -> bool {
    let Some(webview) = state.sessions.window_of(id).and_then(|label| app.get_webview(&label)) else {
        // A tab whose webview never opened this launch has nothing unsaved: its autosave is it.
        return true;
    };
    // Nor does one still loading its project (it could not answer yet).
    if !state.sessions.ready(id) {
        return true;
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    if let Ok(mut answers) = ANSWERS.lock() {
        answers.get_or_insert_with(HashMap::new).insert(webview.label().to_owned(), sender);
    }
    let heard = expect_heard(webview.label());
    if app.emit_to(tauri::EventTarget::webview(webview.label()), CLOSE_REQUEST_EVENT, CloseRequest { app: quitting, mode }).is_err() {
        return true;
    }
    if !was_heard(heard).await {
        // Quitting goes on without a stuck page (its autosave has its work); a single tab stays
        // open, since closing it would throw its autosave away.
        tracing::warn!(id, quitting, "a project's page did not answer a close request; it is stuck");
        return quitting;
    }
    matches!(tokio::time::timeout(CLOSE_WAIT, receiver).await, Ok(Ok(true)))
}

/// Starts waiting for a page to say it heard a close request or the quit summary.
fn expect_heard(label: &str) -> tokio::sync::oneshot::Receiver<()> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    if let Ok(mut heard) = HEARD.lock() {
        heard.get_or_insert_with(HashMap::new).insert(label.to_owned(), sender);
    }
    receiver
}

/// Whether the page said it heard within `CLOSE_HEARD_WAIT`.
async fn was_heard(receiver: tokio::sync::oneshot::Receiver<()>) -> bool {
    matches!(tokio::time::timeout(CLOSE_HEARD_WAIT, receiver).await, Ok(Ok(())))
}

/// A page heard a close request or the quit summary (before it asks the user anything).
#[tauri::command]
pub fn tab_close_heard(webview: tauri::Webview) {
    let sender = HEARD.lock().ok().and_then(|mut heard| heard.as_mut().and_then(|map| map.remove(webview.label())));
    if let Some(sender) = sender {
        let _ignored = sender.send(());
    }
}

/// Closes a session's tab for good (its webview, its autosave and chat).
fn forget(app: &AppHandle, state: &AppState, id: &str) {
    let label = state.sessions.window_of(id);
    let was_active = state.sessions.active().as_deref() == Some(id);
    let next = state.sessions.remove(id);
    if let Some(label) = &label {
        state.sessions.detach(label);
    }
    // The next project goes on screen before this one's webview closes, so the window is never
    // left with nothing in it. One still opening is shown as it opens (its page is the dark editor
    // background): keeping the closed one up while it loads is not an option.
    if !state.sessions.overview() {
        if let Some(next) = next.filter(|_| was_active) {
            state.sessions.set_pending(None);
            let _ignored = reveal(app, state, &next);
        }
    }
    if let Some(webview) = label.and_then(|label| app.get_webview(&label)) {
        let _ignored = webview.close();
    }
    if state.sessions.overview() {
        layout_overview(app, state);
    }
    emit_tabs(app, state);
}

// ───────────────────────────── the overview ─────────────────────────────

/// Columns and rows for `count` tiles on a wide screen: 1 → 1×1, 2 → 2×1, 3-4 → 2×2, 5-6 → 3×2,
/// 7-9 → 3×3, 10-12 → 4×3, 13-16 → 4×4.
pub fn grid(count: usize) -> (usize, usize) {
    let count = count.max(1);
    let columns = (count as f64).sqrt().ceil() as usize;
    let rows = count.div_ceil(columns);
    (columns, rows)
}

/// How many tiles each row of the overview holds: `count` spread over the grid's rows as evenly as
/// it goes, the fuller rows first (3 → 2 + 1, 5 → 3 + 2, 7 → 3 + 2 + 2). Every row is full width,
/// so a count that does not fill the grid leaves no empty cell (the see-through window behind it).
pub fn row_counts(count: usize) -> Vec<usize> {
    if count == 0 {
        return Vec::new();
    }
    let (_, rows) = grid(count);
    let (base, extra) = (count / rows, count % rows);
    (0..rows).map(|row| base + usize::from(row < extra)).collect()
}

/// The tiles' places inside a window of `width`×`height` physical pixels at `scale`: the bar
/// across the top, then `count` tiles in rows covering the rest exactly (each row split evenly
/// across the width, the last tile of a row and the last row taking the pixels left over by the
/// division, so no strip of window is left uncovered).
fn tiles(count: usize, width: u32, height: u32, scale: f64) -> (Rect, Vec<(i32, i32, u32, u32)>) {
    let bar = (BAR_HEIGHT * scale).round() as u32;
    let rows = row_counts(count);
    let area_h = height.saturating_sub(bar);
    let edge = |index: u32, cells: u32, total: u32| index * total / cells;
    let mut places = Vec::with_capacity(count);
    for (row, &in_row) in rows.iter().enumerate() {
        let (top, bottom) = (edge(row as u32, rows.len() as u32, area_h), edge(row as u32 + 1, rows.len() as u32, area_h));
        for column in 0..in_row as u32 {
            let (left, right) = (edge(column, in_row as u32, width), edge(column + 1, in_row as u32, width));
            places.push((left as i32, (bar + top) as i32, (right - left).max(1), (bottom - top).max(1)));
        }
    }
    (Rect { position: PhysicalPosition::new(0, 0).into(), size: PhysicalSize::new(width, bar).into() }, places)
}

/// Lays the overview out: its bar across the top, every project a tile below it.
fn layout_overview(app: &AppHandle, state: &AppState) {
    let Some(window) = main_window(app) else { return };
    let size = window.inner_size().unwrap_or(PhysicalSize::new(1480, 920));
    let scale = window.scale_factor().unwrap_or(1.0);
    let webviews = project_webviews(app, state);
    let (bar, places) = tiles(webviews.len(), size.width, size.height, scale);
    if let Some(bar_view) = app.get_webview(OVERVIEW_BAR) {
        let _ignored = bar_view.set_bounds(bar);
        let _ignored = bar_view.show();
    }
    for (webview, (x, y, w, h)) in webviews.iter().zip(places) {
        let _ignored = webview.set_bounds(Rect { position: PhysicalPosition::new(x, y).into(), size: PhysicalSize::new(w, h).into() });
        let _ignored = webview.show();
    }
    controls_on_top(app);
}

/// The overview's bar, made on first use.
fn ensure_overview_bar(app: &AppHandle) -> Result<Webview, String> {
    if let Some(webview) = app.get_webview(OVERVIEW_BAR) {
        return Ok(webview);
    }
    let window = main_window(app).ok_or("Bhippi's window is not open")?;
    let builder = WebviewBuilder::new(OVERVIEW_BAR, WebviewUrl::App("index.html?view=overview".into()))
        .auto_resize()
        .focused(false)
        .background_color(tauri::window::Color(35, 35, 35, 255));
    let webview = window.add_child(builder, PhysicalPosition::new(0, 0), PhysicalSize::new(1, 1)).map_err(|error| error.to_string())?;
    let _ignored = webview.hide();
    controls_buried();
    edges_on_top(&window);
    Ok(webview)
}

/// The window changed size: the controls stay in the top right corner, and in the overview the
/// tiles are laid out again (a full-size tab follows the window by itself).
pub fn window_resized(app: &AppHandle) {
    place_controls(app);
    if let Some(state) = app.try_state::<Arc<AppState>>() {
        if state.sessions.overview() {
            layout_overview(app, &state);
        }
    }
}

/// Which tile of the overview holds a point inside the window (physical pixels), by tab order.
fn tile_at(app: &AppHandle, state: &AppState, x: f64, y: f64) -> Option<usize> {
    let window = main_window(app)?;
    let size = window.inner_size().ok()?;
    let scale = window.scale_factor().ok()?;
    let count = project_webviews(app, state).len();
    let (_, places) = tiles(count, size.width, size.height, scale);
    places.iter().position(|&(left, top, w, h)| x >= left as f64 && y >= top as f64 && x < left as f64 + w as f64 && y < top as f64 + h as f64)
}

// ───────────────────────────── commands ─────────────────────────────

/// The tabs, the active one and the one this webview shows.
#[tauri::command]
pub fn tabs_list(webview: tauri::Webview, state: State<'_, Arc<AppState>>) -> TabsState {
    state.sessions.state(Some(&state.sessions.id_for(webview.label())))
}

/// A project says how its tab should read: its name, unsaved edits, the AI at work, and how the
/// AI's last turn ended until the project is looked at. The first report also says its project is
/// in, so a tab waiting for it is shown.
#[tauri::command]
pub async fn tab_report(app: AppHandle, webview: tauri::Webview, state: State<'_, Arc<AppState>>, name: Option<String>, dirty: bool, busy: bool, result: Option<String>) -> Result<(), String> {
    let id = state.sessions.id_for(webview.label());
    let (changed, first) = state.sessions.report(&id, name, dirty, busy, result);
    if first {
        loaded(&app, &state, &id);
    }
    if changed {
        emit_tabs(&app, &state);
    }
    Ok(())
}

/// Opens a new tab after the asking project's own (an empty project, or `open` a project file in
/// it) and shows it once it is in. Answers its id.
#[tauri::command]
pub async fn tab_new(app: AppHandle, webview: tauri::Webview, state: State<'_, Arc<AppState>>, open: Option<String>) -> Result<String, String> {
    if let Some(existing) = open.as_deref().and_then(|path| state.sessions.find_file(path)) {
        activate(&app, &state, &existing)?;
        return Ok(existing);
    }
    let after = state.sessions.id_for(webview.label());
    let id = sessions::new_id();
    let session = Session { id: id.clone(), ..Session::default() };
    state
        .sessions
        .add(session, Some(&after))
        .ok_or_else(|| format!("{} projects are open, the most Bhippi keeps at once. Close one to open another.", sessions::MAX_TABS))?;
    state.sessions.set_open_file(&id, open);
    if let Err(error) = activate(&app, &state, &id) {
        state.sessions.remove(&id);
        emit_tabs(&app, &state);
        return Err(error);
    }
    Ok(id)
}

/// Shows a tab.
#[tauri::command]
pub async fn tab_activate(app: AppHandle, state: State<'_, Arc<AppState>>, id: String) -> Result<(), String> {
    let started = std::time::Instant::now();
    let result = activate(&app, &state, &id);
    tracing::debug!(id, ms = started.elapsed().as_millis() as u64, "tab switch");
    result
}

/// Moves a tab in the strip (and its tile in the overview).
#[tauri::command]
pub fn tab_move(app: AppHandle, state: State<'_, Arc<AppState>>, id: String, to: usize) {
    state.sessions.reorder(&id, to);
    if state.sessions.overview() {
        layout_overview(&app, &state);
    }
    emit_tabs(&app, &state);
}

/// The tab showing a project file, if one does.
#[tauri::command]
pub fn tab_find_file(state: State<'_, Arc<AppState>>, path: String) -> Option<String> {
    state.sessions.find_file(&path)
}

/// Closes a tab: its project saves or asks first. The last tab closing quits Bhippi.
#[tauri::command]
pub async fn tab_close(app: AppHandle, state: State<'_, Arc<AppState>>, id: String) -> Result<bool, String> {
    let state = state.inner().clone();
    if state.sessions.count() <= 1 {
        return quit(&app, &state).await;
    }
    if !ask_to_close(&app, &state, &id, false, "ask").await {
        return Ok(false);
    }
    forget(&app, &state, &id);
    Ok(true)
}

/// A project's answer to a close request: true when it may close.
#[tauri::command]
pub fn tab_close_answer(webview: tauri::Webview, ok: bool) {
    let sender = ANSWERS.lock().ok().and_then(|mut answers| answers.as_mut().and_then(|map| map.remove(webview.label())));
    if let Some(sender) = sender {
        let _ignored = sender.send(ok);
    }
}

/// Quits Bhippi: every open project saves or asks, one at a time; one that refuses stops the quit.
/// The tabs stay in the list, so the next launch opens them again.
#[tauri::command]
pub async fn app_quit(app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<bool, String> {
    let state = state.inner().clone();
    quit(&app, &state).await
}

/// The window's own controls (src/components/WindowControls.tsx): "minimize", "maximize" (or back
/// down) and "close", which quits as the menu bar's close button does. Clicking the controls' page
/// gave it the keyboard: the project on screen gets it back first, so its shortcuts work after a
/// maximize, and after the window comes back from the taskbar.
#[tauri::command]
pub async fn window_control(app: AppHandle, state: State<'_, Arc<AppState>>, action: String) -> Result<(), String> {
    let window = main_window(&app).ok_or("Bhippi's window is not open")?;
    if let Some(project) = visible_webview(&app, &state) {
        let _ignored = project.set_focus();
    }
    let result = match action.as_str() {
        "minimize" => window.minimize(),
        "maximize" if window.is_maximized().unwrap_or(false) => window.unmaximize(),
        "maximize" => window.maximize(),
        "close" => {
            close_requested(&app);
            Ok(())
        }
        other => return Err(format!("unknown window control: {other}")),
    };
    result.map_err(|error| error.to_string())
}

/// The window was asked to close (Alt+F4, the taskbar's Close, File › Exit, the controls' close):
/// Bhippi quits as the menu bar's close button does, every project saving or asking first.
/// Started here rather than by a page's own close listener, which did nothing while that page was
/// busy.
pub fn close_requested(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        match app.try_state::<Arc<AppState>>().map(|state| state.inner().clone()) {
            Some(state) => {
                let _ignored = quit(&app, &state).await;
            }
            None => app.exit(0),
        }
    });
}

async fn quit(app: &AppHandle, state: &AppState) -> Result<bool, String> {
    use std::sync::atomic::Ordering;
    // Every project hears the window's close: the first one quits, the rest are the same quit.
    if QUITTING.swap(true, Ordering::SeqCst) {
        return Ok(false);
    }
    tracing::info!("quitting: every project is asked to save and close");
    // The one on screen first, so a question about it comes before any about the others.
    let mut order = state.sessions.ids();
    if let Some(active) = state.sessions.active() {
        order.retain(|id| id != &active);
        order.insert(0, active);
    }
    // One project asks about its own work, as ever. Several ask once, together: save them all,
    // let their changes go, or stay.
    let mut stuck = None;
    let mode = if order.len() <= 1 {
        "ask"
    } else {
        let (unsaved, busy) = state.sessions.quit_summary();
        if unsaved.is_empty() && busy.is_empty() {
            "save"
        } else {
            match ask_quit_choice(app, state, QuitSummary { unsaved, busy }).await.as_str() {
                "save" => "save",
                "discard" => "discard",
                // The project on screen is stuck and could not ask: the others save, and it is
                // left to its autosave without being waited on a second time.
                "stuck" => {
                    stuck = order.first().cloned();
                    "save"
                }
                _ => {
                    QUITTING.store(false, Ordering::SeqCst);
                    return Ok(false);
                }
            }
        }
    };
    for id in order.into_iter().filter(|id| stuck.as_ref() != Some(id)) {
        // A project with nothing to save or stop is only told (it marks its close clean); waiting
        // on its answer would hold the quit on a page that has nothing to say.
        if mode != "ask" && !state.sessions.needs_care(&id) {
            if let Some(label) = state.sessions.window_of(&id) {
                let _ignored = app.emit_to(tauri::EventTarget::webview(label.as_str()), CLOSE_REQUEST_EVENT, CloseRequest { app: true, mode });
            }
            continue;
        }
        if !ask_to_close(app, state, &id, true, mode).await {
            QUITTING.store(false, Ordering::SeqCst);
            return Ok(false);
        }
    }
    // A moment for the told ones to mark their close clean, then Bhippi goes.
    tokio::time::sleep(Duration::from_millis(250)).await;
    tracing::info!("quit: every project closed cleanly");
    app.exit(0);
    Ok(true)
}

/// Shows the quit summary in the project on screen and waits for the choice: "save", "discard",
/// "cancel", or "stuck" when that project's page did not hear it.
async fn ask_quit_choice(app: &AppHandle, state: &AppState, summary: QuitSummary) -> String {
    let Some(webview) = visible_webview(app, state) else { return "cancel".to_owned() };
    let (sender, receiver) = tokio::sync::oneshot::channel();
    if let Ok(mut slot) = QUIT_CHOICE.lock() {
        *slot = Some(sender);
    }
    let heard = expect_heard(webview.label());
    if app.emit_to(tauri::EventTarget::webview(webview.label()), QUIT_SUMMARY_EVENT, summary).is_err() {
        return "cancel".to_owned();
    }
    // The project on screen is stuck and cannot ask (`quit` goes on without it).
    if !was_heard(heard).await {
        tracing::warn!("the project on screen did not answer the quit summary; it is stuck");
        return "stuck".to_owned();
    }
    match tokio::time::timeout(CLOSE_WAIT, receiver).await {
        Ok(Ok(choice)) => choice,
        _ => "cancel".to_owned(),
    }
}

/// The user's answer to the quit summary: "save", "discard" or "cancel".
#[tauri::command]
pub fn app_quit_choice(choice: String) {
    if let Some(sender) = QUIT_CHOICE.lock().ok().and_then(|mut slot| slot.take()) {
        let _ignored = sender.send(choice);
    }
}

/// Shows every open project at once inside the window, each a chat beside its preview (on), or
/// puts them back as tabs with `focus` on screen (off).
#[tauri::command]
pub async fn overview_set(app: AppHandle, webview: tauri::Webview, state: State<'_, Arc<AppState>>, on: bool, focus: Option<String>) -> Result<(), String> {
    let ids = state.sessions.ids();
    if on {
        for id in &ids {
            ensure_webview(&app, &state, id)?;
        }
        ensure_overview_bar(&app)?;
        state.sessions.set_overview(true);
        let _ignored = app.emit(OVERVIEW_EVENT, true);
        layout_overview(&app, &state);
    } else {
        state.sessions.set_overview(false);
        let _ignored = app.emit(OVERVIEW_EVENT, false);
        if let Some(bar) = app.get_webview(OVERVIEW_BAR) {
            let _ignored = bar.hide();
        }
        let asking = state.sessions.id_for(webview.label());
        let keep = focus.filter(|id| ids.contains(id)).unwrap_or_else(|| state.sessions.active().unwrap_or(asking));
        reveal(&app, &state, &keep)?;
    }
    emit_tabs(&app, &state);
    Ok(())
}

/// A tile dragged by its bar in the overview: `x`, `y` are the pointer in the dragged tile's own
/// page (CSS pixels, as the page sees them). While dragging (`drop` false) the tile under the
/// pointer is marked; on the drop the dragged project takes that tile's place.
#[tauri::command]
pub fn overview_drag(app: AppHandle, webview: tauri::Webview, state: State<'_, Arc<AppState>>, x: f64, y: f64, drop: bool) {
    let dragged = state.sessions.id_for(webview.label());
    let ids = state.sessions.ids();
    let scale = main_window(&app).and_then(|window| window.scale_factor().ok()).unwrap_or(1.0);
    let origin = webview.bounds().ok().map(|bounds| bounds.position.to_physical::<f64>(scale)).unwrap_or(PhysicalPosition::new(0.0, 0.0));
    let (x, y) = (origin.x + x * scale, origin.y + y * scale);
    let target = tile_at(&app, &state, x, y).and_then(|index| ids.get(index).cloned()).filter(|id| id != &dragged);
    let _ignored = app.emit(OVERVIEW_TARGET_EVENT, if drop { None } else { target.clone() });
    if drop {
        if let Some(to) = target.and_then(|target| ids.iter().position(|id| id == &target)) {
            state.sessions.reorder(&dragged, to);
            layout_overview(&app, &state);
            emit_tabs(&app, &state);
        }
    }
}

/// A project file opened while Bhippi runs (a double-clicked `.bhippi`): the tab that has it, or a
/// new tab for it.
pub fn open_file(app: &AppHandle, state: &AppState, path: &str) {
    if let Some(existing) = state.sessions.find_file(path) {
        let _ignored = activate(app, state, &existing);
        return;
    }
    let after = state.sessions.active();
    let id = sessions::new_id();
    if state.sessions.add(Session { id: id.clone(), ..Session::default() }, after.as_deref()).is_none() {
        // Sixteen open: the file opens in the tab on screen, which asks about its own changes first.
        if let Some(webview) = visible_webview(app, state) {
            let _ignored = app.emit_to(tauri::EventTarget::webview(webview.label()), "bhippi://open-file", path);
        }
        return;
    }
    state.sessions.set_open_file(&id, Some(path.to_owned()));
    if activate(app, state, &id).is_err() {
        state.sessions.remove(&id);
    }
    emit_tabs(app, state);
}

#[cfg(test)]
mod tests {
    use super::{controls_place, grid, row_counts, tiles};

    #[test]
    fn the_controls_sit_over_the_menu_bars_buttons_in_the_top_right_corner() {
        // Three 44 px buttons at the menu bar's 28 px, flush with the right edge.
        assert_eq!(controls_place(1920, 1.0), (1920 - 132, 132, 28));
        assert_eq!(controls_place(2560, 1.25), (2560 - 165, 165, 35));
        assert_eq!(controls_place(3840, 1.5), (3840 - 198, 198, 42));
        // A window narrower than the buttons (minimized is 0 wide) never gives a negative place.
        assert_eq!(controls_place(100, 1.0), (0, 100, 28));
        assert_eq!(controls_place(0, 1.0), (0, 0, 28));
    }

    #[test]
    fn the_overview_grid_fills_a_wide_screen() {
        assert_eq!(grid(1), (1, 1));
        assert_eq!(grid(2), (2, 1));
        assert_eq!(grid(4), (2, 2));
        assert_eq!(grid(5), (3, 2));
        assert_eq!(grid(9), (3, 3));
        assert_eq!(grid(12), (4, 3));
        assert_eq!(grid(16), (4, 4));
    }

    #[test]
    fn every_row_is_full_so_no_cell_is_left_empty() {
        assert_eq!(row_counts(1), [1]);
        assert_eq!(row_counts(2), [2]);
        assert_eq!(row_counts(3), [2, 1]);
        assert_eq!(row_counts(5), [3, 2]);
        assert_eq!(row_counts(7), [3, 2, 2]);
        assert_eq!(row_counts(10), [4, 3, 3]);
        assert_eq!(row_counts(16), [4, 4, 4, 4]);
        for count in 1..=16 {
            assert_eq!(row_counts(count).iter().sum::<usize>(), count);
            // The tiles cover the window below the bar exactly: their areas add up to it.
            let (_, places) = tiles(count, 1920, 1080, 1.25);
            let area: u64 = places.iter().map(|&(_, _, w, h)| u64::from(w) * u64::from(h)).sum();
            assert_eq!(area, 1920 * (1080 - 35), "{count} tiles");
            assert!(places.iter().all(|&(x, _, w, _)| x as u32 + w <= 1920));
        }
    }

    #[test]
    fn tiles_sit_below_the_bar_inside_the_window_without_overlapping() {
        let (bar, places) = tiles(4, 1920, 1080, 1.0);
        let bar_size: tauri::PhysicalSize<u32> = match bar.size {
            tauri::Size::Physical(size) => size,
            tauri::Size::Logical(size) => size.to_physical(1.0),
        };
        assert_eq!(bar_size.height, 28);
        for &(x, y, w, h) in &places {
            assert!(y >= 28 && x >= 0);
            assert!(x as u32 + w <= 1920 && y as u32 + h <= 1080);
        }
        assert_eq!(places[0].0 + places[0].2 as i32, places[1].0, "side by side, edge to edge");
        assert_eq!(places[0].1 + places[0].3 as i32, places[2].1, "one above the other, edge to edge");
        // Together they cover the window below the bar to the last pixel.
        assert_eq!(places[3].0 as u32 + places[3].2, 1920);
        assert_eq!(places[3].1 as u32 + places[3].3, 1080);
    }
}
