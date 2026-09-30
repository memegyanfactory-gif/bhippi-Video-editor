//! Project tabs: several projects open at once, one window each (sessions.rs holds their files).
//!
//! Bhippi draws its own title bar, so a tab strip is part of every window's page. The windows of
//! all tabs share one place on screen and only the active one is shown: switching a tab moves the
//! next window onto the current one's place and shows it, then hides the other. A tab restored
//! from the last launch gets its window when it is first shown, so sixteen tabs do not start
//! sixteen editors. Each window is a whole editor of its own (its own undo history, chat, AI turns
//! and preview), so projects can work side by side, and the overview shows them all at once as
//! windows tiled across the screen, each a chat beside its preview.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::sessions::{self, Session, TabsState, TABS_EVENT};
use crate::AppState;

/// A window is asked to close its tab (or, with `app`, to get ready for Bhippi to quit): it saves
/// or asks, and answers with `tab_close_answer`.
const CLOSE_REQUEST_EVENT: &str = "bhippi://tab-close-request";
/// The overview turned on or off: windows switch to the chat-and-preview layout, or back.
const OVERVIEW_EVENT: &str = "bhippi://overview";
/// How long a window has to answer a close request before it is treated as refusing.
const CLOSE_WAIT: Duration = Duration::from_secs(600);

/// Close requests waiting for their window's answer.
static ANSWERS: Mutex<Option<HashMap<String, tokio::sync::oneshot::Sender<bool>>>> = Mutex::new(None);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CloseRequest {
    /// Bhippi is quitting (every tab stays in the list for next time), rather than one tab closing.
    app: bool,
}

/// An editor window: the first one, or a project tab's.
pub fn is_editor(label: &str) -> bool {
    label == "main" || label.starts_with("tab-")
}

/// The editor window on screen (the active tab's), or the first one.
pub fn shown_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.try_state::<Arc<AppState>>().and_then(|state| visible_window(app, &state)).or_else(|| app.get_webview_window("main"))
}

pub fn emit_tabs(app: &AppHandle, state: &AppState) {
    let _ignored = app.emit(TABS_EVENT, state.sessions.state(None));
}

/// The window showing a session, made (hidden) when it has none yet.
fn ensure_window(app: &AppHandle, state: &AppState, id: &str) -> Result<WebviewWindow, String> {
    if let Some(window) = state.sessions.window_of(id).and_then(|label| app.get_webview_window(&label)) {
        return Ok(window);
    }
    let label = sessions::window_label(id);
    if let Some(window) = app.get_webview_window(&label) {
        state.sessions.attach(&label, id);
        return Ok(window);
    }
    // The same kind of window the app opens with (tauri.conf.json): frameless, transparent, its
    // own title bar drawn by the page.
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("Bhippi Video Editor")
        .inner_size(1480.0, 920.0)
        .min_inner_size(1024.0, 600.0)
        .decorations(false)
        .transparent(true)
        .resizable(true)
        .visible(false)
        .build()
        .map_err(|error| format!("could not open a window for the project: {error}"))?;
    #[cfg(windows)]
    crate::window_icon::install(&window.as_ref().window());
    state.sessions.attach(&label, id);
    Ok(window)
}

/// The window on screen now (the active tab's), if it is open.
fn visible_window(app: &AppHandle, state: &AppState) -> Option<WebviewWindow> {
    let id = state.sessions.active()?;
    state.sessions.window_of(&id).and_then(|label| app.get_webview_window(&label))
}

/// Puts `target` exactly where `from` is (maximized or at its size and place).
fn take_place(target: &WebviewWindow, from: &WebviewWindow) {
    if target.label() == from.label() {
        return;
    }
    if from.is_maximized().unwrap_or(false) {
        let _ignored = target.maximize();
        return;
    }
    let _ignored = target.unmaximize();
    if let (Ok(place), Ok(size)) = (from.outer_position(), from.outer_size()) {
        let _ignored = target.set_position(place);
        let _ignored = target.set_size(size);
    }
}

/// Shows a session's tab: its window takes the current one's place and the other hides.
pub fn activate(app: &AppHandle, state: &AppState, id: &str) -> Result<(), String> {
    if state.sessions.get(id).is_none() {
        return Err("that project is no longer open".to_owned());
    }
    let current = visible_window(app, state);
    let target = ensure_window(app, state, id)?;
    if state.sessions.overview() {
        let _ignored = target.show();
        let _ignored = target.unminimize();
        let _ignored = target.set_focus();
        state.sessions.set_active(id);
        emit_tabs(app, state);
        return Ok(());
    }
    match &current {
        Some(current) => take_place(&target, current),
        None => {
            let _ignored = target.maximize();
        }
    }
    let _ignored = target.show();
    let _ignored = target.unminimize();
    let _ignored = target.set_focus();
    if let Some(current) = current.filter(|current| current.label() != target.label()) {
        let _ignored = current.hide();
    }
    state.sessions.set_active(id);
    emit_tabs(app, state);
    Ok(())
}

/// Asks a session's window to close its tab (or get ready to quit) and waits for its answer.
async fn ask_to_close(app: &AppHandle, state: &AppState, id: &str, quitting: bool) -> bool {
    let Some(window) = state.sessions.window_of(id).and_then(|label| app.get_webview_window(&label)) else {
        // A tab whose window never opened this launch has nothing unsaved: its autosave is it.
        return true;
    };
    // Nor does one whose window is still loading its project (it could not answer yet).
    if !state.sessions.ready(id) {
        return true;
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    if let Ok(mut answers) = ANSWERS.lock() {
        answers.get_or_insert_with(HashMap::new).insert(window.label().to_owned(), sender);
    }
    if window.emit_to(window.label(), CLOSE_REQUEST_EVENT, CloseRequest { app: quitting }).is_err() {
        return true;
    }
    matches!(tokio::time::timeout(CLOSE_WAIT, receiver).await, Ok(Ok(true)))
}

/// Closes a session's tab for good (its window, its autosave and chat).
fn forget(app: &AppHandle, state: &AppState, id: &str) {
    let window = state.sessions.window_of(id);
    let next = state.sessions.remove(id);
    if let Some(label) = window {
        state.sessions.detach(&label);
        if let Some(window) = app.get_webview_window(&label) {
            let _ignored = window.destroy();
        }
    }
    if let Some(next) = next {
        let _ignored = activate(app, state, &next);
    }
    emit_tabs(app, state);
}

// ───────────────────────────── commands ─────────────────────────────

/// The tabs, the active one and the one this window shows.
#[tauri::command]
pub fn tabs_list(webview: tauri::Webview, state: State<'_, Arc<AppState>>) -> TabsState {
    state.sessions.state(Some(&state.sessions.id_for(webview.label())))
}

/// A window says how its tab should read: the project's name, unsaved edits, the AI at work.
#[tauri::command]
pub fn tab_report(app: AppHandle, webview: tauri::Webview, state: State<'_, Arc<AppState>>, name: Option<String>, dirty: bool, busy: bool) {
    let id = state.sessions.id_for(webview.label());
    if state.sessions.report(&id, name, dirty, busy) {
        emit_tabs(&app, &state);
    }
}

/// Opens a new tab after the window's own (an empty project, or `open` a project file in it) and
/// shows it. Answers its id.
#[tauri::command]
pub fn tab_new(app: AppHandle, webview: tauri::Webview, state: State<'_, Arc<AppState>>, open: Option<String>) -> Result<String, String> {
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
pub fn tab_activate(app: AppHandle, state: State<'_, Arc<AppState>>, id: String) -> Result<(), String> {
    activate(&app, &state, &id)
}

/// Moves a tab in the strip.
#[tauri::command]
pub fn tab_move(app: AppHandle, state: State<'_, Arc<AppState>>, id: String, to: usize) {
    state.sessions.reorder(&id, to);
    emit_tabs(&app, &state);
}

/// The tab showing a project file, if one does.
#[tauri::command]
pub fn tab_find_file(state: State<'_, Arc<AppState>>, path: String) -> Option<String> {
    state.sessions.find_file(&path)
}

/// Closes a tab: its window saves or asks first. The last tab closing quits Bhippi.
#[tauri::command]
pub async fn tab_close(app: AppHandle, state: State<'_, Arc<AppState>>, id: String) -> Result<bool, String> {
    let state = state.inner().clone();
    if state.sessions.count() <= 1 {
        return quit(&app, &state).await;
    }
    if !ask_to_close(&app, &state, &id, false).await {
        return Ok(false);
    }
    forget(&app, &state, &id);
    Ok(true)
}

/// A window's answer to a close request: true when it may close.
#[tauri::command]
pub fn tab_close_answer(webview: tauri::Webview, ok: bool) {
    let sender = ANSWERS.lock().ok().and_then(|mut answers| answers.as_mut().and_then(|map| map.remove(webview.label())));
    if let Some(sender) = sender {
        let _ignored = sender.send(ok);
    }
}

/// Quits Bhippi: every open window saves or asks, one at a time; one that refuses stops the quit.
/// The tabs stay in the list, so the next launch opens them again.
#[tauri::command]
pub async fn app_quit(app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<bool, String> {
    let state = state.inner().clone();
    quit(&app, &state).await
}

async fn quit(app: &AppHandle, state: &AppState) -> Result<bool, String> {
    // The one on screen first, so a question about it comes before any about hidden ones.
    let mut order = state.sessions.ids();
    if let Some(active) = state.sessions.active() {
        order.retain(|id| id != &active);
        order.insert(0, active);
    }
    for id in order {
        if !ask_to_close(app, state, &id, true).await {
            return Ok(false);
        }
    }
    app.exit(0);
    Ok(true)
}

/// Tiles every open project across the screen, each a chat beside its preview (on), or puts them
/// back as tabs with `focus` shown (off).
#[tauri::command]
pub fn overview_set(app: AppHandle, webview: tauri::Webview, state: State<'_, Arc<AppState>>, on: bool, focus: Option<String>) -> Result<(), String> {
    let ids = state.sessions.ids();
    if on {
        let anchor = app.get_webview_window(webview.label());
        let monitor = anchor.as_ref().and_then(|window| window.current_monitor().ok().flatten()).or_else(|| app.primary_monitor().ok().flatten());
        let Some(monitor) = monitor else { return Err("no screen to lay the projects out on".to_owned()) };
        let area = *monitor.work_area();
        let windows: Vec<WebviewWindow> = ids.iter().map(|id| ensure_window(&app, &state, id)).collect::<Result<_, _>>()?;
        state.sessions.set_overview(true);
        let (columns, rows) = grid(windows.len());
        let (cell_w, cell_h) = (area.size.width / columns as u32, area.size.height / rows as u32);
        for (index, window) in windows.iter().enumerate() {
            let (column, row) = ((index % columns) as u32, (index / columns) as u32);
            let _ignored = window.set_min_size(Some(tauri::LogicalSize::new(360.0, 260.0)));
            let _ignored = window.unmaximize();
            let _ignored = window.set_position(tauri::PhysicalPosition::new(area.position.x + (column * cell_w) as i32, area.position.y + (row * cell_h) as i32));
            let _ignored = window.set_size(tauri::PhysicalSize::new(cell_w, cell_h));
            let _ignored = window.show();
        }
        let _ignored = app.emit(OVERVIEW_EVENT, true);
    } else {
        state.sessions.set_overview(false);
        let _ignored = app.emit(OVERVIEW_EVENT, false);
        let keep = focus.filter(|id| ids.contains(id)).or_else(|| Some(state.sessions.id_for(webview.label()))).unwrap_or_default();
        for id in &ids {
            let Some(window) = state.sessions.window_of(id).and_then(|label| app.get_webview_window(&label)) else { continue };
            let _ignored = window.set_min_size(Some(tauri::LogicalSize::new(1024.0, 600.0)));
            if id == &keep {
                let _ignored = window.maximize();
                let _ignored = window.show();
                let _ignored = window.set_focus();
            } else {
                let _ignored = window.hide();
            }
        }
        state.sessions.set_active(&keep);
    }
    emit_tabs(&app, &state);
    Ok(())
}

/// Columns and rows for `count` tiles on a wide screen: 1 → 1×1, 2 → 2×1, 3-4 → 2×2, 5-6 → 3×2,
/// 7-9 → 3×3, 10-12 → 4×3, 13-16 → 4×4.
pub fn grid(count: usize) -> (usize, usize) {
    let count = count.max(1);
    let columns = (count as f64).sqrt().ceil() as usize;
    let rows = count.div_ceil(columns);
    (columns, rows)
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
        if let Some(window) = visible_window(app, state) {
            let _ignored = window.emit_to(window.label(), "bhippi://open-file", path);
        }
        return;
    }
    state.sessions.set_open_file(&id, Some(path.to_owned()));
    if activate(app, state, &id).is_err() {
        state.sessions.remove(&id);
    }
    emit_tabs(app, state);
}

/// A window closed by the system (not through a tab's close button): its tab goes too.
pub fn window_destroyed(app: &AppHandle, state: &AppState, label: &str) {
    let id = state.sessions.id_for(label);
    if state.sessions.window_of(&id).as_deref() == Some(label) {
        state.sessions.detach(label);
        emit_tabs(app, state);
    }
}

#[cfg(test)]
mod tests {
    use super::grid;

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
}
