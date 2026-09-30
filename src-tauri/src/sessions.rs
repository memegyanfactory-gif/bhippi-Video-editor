//! The projects open as tabs. Each tab is a project session with its own autosave file
//! (`current.json`), chat log, project folder and save order, shown by one window of its own. A
//! window finds its session by its label, so every command a window calls works on that window's
//! project, and two projects never write into each other's folders.
//!
//! The first session is the one Bhippi always had: `projects/current.json` and `projects/chat.json`,
//! its file and unsaved folder taken over from the settings where older versions kept them. Every
//! other tab keeps its files in `projects/tabs/<id>/`. The open tabs, in order, are kept in
//! `projects/tabs.json`, so the next launch opens them again.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::{Deserialize, Serialize};

/// Projects open at once, at most.
pub const MAX_TABS: usize = 16;
/// The tab list changed (a tab opened, closed, renamed, became active, or the overview toggled).
pub const TABS_EVENT: &str = "bhippi://tabs";
/// The id of the session Bhippi had before tabs, whose files keep their old names.
pub const FIRST: &str = "main";

/// Orders project autosaves that run on the blocking pool. Each save takes the next number when
/// it arrives, and its write goes ahead only if no later save has been written already, so a
/// slow older snapshot is never renamed over a newer current.json. One per session: a save of
/// one project never makes another project's pending save look stale.
#[derive(Default)]
pub struct SaveGate {
    issued: std::sync::atomic::AtomicU64,
    /// The newest save written so far. Held across a write, so two writes never interleave.
    written: Mutex<u64>,
}

impl SaveGate {
    pub fn ticket(&self) -> u64 {
        self.issued.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1
    }

    /// Runs `write` for `ticket`, or skips it (successfully) when a newer save got there first.
    pub fn write(&self, ticket: u64, write: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
        let mut written = self.written.lock().map_err(|_| "internal state is unavailable; restart Bhippi".to_owned())?;
        if *written > ticket {
            return Ok(());
        }
        write()?;
        *written = ticket;
        Ok(())
    }
}

/// One open project, as the tab list keeps it.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Session {
    pub id: String,
    /// The project's name, as its window last reported it.
    pub name: String,
    /// The `.bhippi` file it was opened from or saved to.
    pub project_path: Option<String>,
    /// While it has no file: the key of its own folder under `<storage root>/Unsaved projects/`.
    pub unsaved_folder: Option<String>,
}

/// What a tab shows: the session, and what its window reports while it runs.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabView {
    pub id: String,
    pub name: String,
    pub project_path: Option<String>,
    /// Edits not yet saved to its file.
    pub dirty: bool,
    /// Bhippi AI is working in it.
    pub busy: bool,
    /// Its window exists (a tab restored from the last launch opens its window when first shown).
    pub open: bool,
}

/// The tab list, as every window draws it.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabsState {
    pub tabs: Vec<TabView>,
    pub active: Option<String>,
    /// The session of the window that asked.
    pub own: Option<String>,
    pub overview: bool,
    pub max: usize,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Saved {
    tabs: Vec<Session>,
    active: Option<String>,
}

/// Per-session state that is not saved: the save order and the backup throttles.
#[derive(Default)]
struct Runtime {
    saves: Arc<SaveGate>,
    last_backup: Option<Instant>,
    last_version: Option<Instant>,
    dirty: bool,
    busy: bool,
    /// Its window has loaded its project and reported in (until then it has nothing unsaved).
    ready: bool,
    /// A project file the session's window opens as it starts (a file opened into a new tab).
    open_file: Option<String>,
}

#[derive(Default)]
struct Inner {
    tabs: Vec<Session>,
    active: Option<String>,
    /// Window label → session id.
    windows: HashMap<String, String>,
    runtime: HashMap<String, Runtime>,
    overview: bool,
}

pub struct Sessions {
    file: PathBuf,
    projects: PathBuf,
    inner: Mutex<Inner>,
}

impl Sessions {
    /// The tabs the last launch left open, or the one session older versions kept in the settings.
    /// The window `first_window` (the app's main window) shows the tab that was active.
    pub fn load(projects: &Path, legacy_path: Option<String>, legacy_unsaved: Option<String>, first_window: &str) -> Self {
        let file = projects.join("tabs.json");
        let saved: Saved = crate::store::read_json(&file);
        let mut tabs: Vec<Session> = saved.tabs.into_iter().filter(|tab| valid_id(&tab.id)).collect();
        tabs.dedup_by(|a, b| a.id == b.id);
        tabs.truncate(MAX_TABS);
        if tabs.is_empty() {
            tabs.push(Session { id: FIRST.to_owned(), name: String::new(), project_path: legacy_path, unsaved_folder: legacy_unsaved });
        }
        let active = saved.active.filter(|id| tabs.iter().any(|tab| &tab.id == id)).unwrap_or_else(|| tabs[0].id.clone());
        let mut windows = HashMap::new();
        windows.insert(first_window.to_owned(), active.clone());
        let sessions = Self { file, projects: projects.to_path_buf(), inner: Mutex::new(Inner { tabs, active: Some(active), windows, ..Inner::default() }) };
        sessions.persist();
        sessions
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn persist_inner(&self, inner: &Inner) {
        let saved = Saved { tabs: inner.tabs.clone(), active: inner.active.clone() };
        if let Err(error) = crate::store::write_json(&self.file, &saved) {
            tracing::warn!(%error, "could not save the tab list");
        }
    }

    fn persist(&self) {
        let inner = self.lock();
        self.persist_inner(&inner);
    }

    /// The session a window shows. A window Bhippi does not know (none today) gets the active one.
    pub fn id_for(&self, label: &str) -> String {
        let inner = self.lock();
        inner.windows.get(label).cloned().or_else(|| inner.active.clone()).unwrap_or_else(|| FIRST.to_owned())
    }

    pub fn get(&self, id: &str) -> Option<Session> {
        self.lock().tabs.iter().find(|tab| tab.id == id).cloned()
    }

    /// The session a window shows (a fresh one when the tab list is somehow empty).
    pub fn for_window(&self, label: &str) -> Session {
        let id = self.id_for(label);
        self.get(&id).unwrap_or(Session { id, ..Session::default() })
    }

    /// Changes a session and saves the tab list.
    pub fn update(&self, id: &str, change: impl FnOnce(&mut Session)) {
        let mut inner = self.lock();
        if let Some(tab) = inner.tabs.iter_mut().find(|tab| tab.id == id) {
            let before = tab.clone();
            change(tab);
            if *tab != before {
                self.persist_inner(&inner);
            }
        }
    }

    /// The window showing a session, if one is open.
    pub fn window_of(&self, id: &str) -> Option<String> {
        self.lock().windows.iter().find(|(_, session)| session.as_str() == id).map(|(label, _)| label.clone())
    }

    pub fn attach(&self, label: &str, id: &str) {
        self.lock().windows.insert(label.to_owned(), id.to_owned());
    }

    pub fn detach(&self, label: &str) {
        self.lock().windows.remove(label);
    }

    /// Opens a new session after `after` (or at the end); None when MAX_TABS are open.
    pub fn add(&self, session: Session, after: Option<&str>) -> Option<String> {
        let mut inner = self.lock();
        if inner.tabs.len() >= MAX_TABS {
            return None;
        }
        let id = session.id.clone();
        let at = after.and_then(|after| inner.tabs.iter().position(|tab| tab.id == after)).map_or(inner.tabs.len(), |index| index + 1);
        inner.tabs.insert(at, session);
        self.persist_inner(&inner);
        Some(id)
    }

    /// Closes a session: forgets it, and deletes its autosave and chat (a tab closed is closed; its
    /// project file, if it has one, stays where the user saved it). Returns the tab that takes its
    /// place when it was the active one.
    pub fn remove(&self, id: &str) -> Option<String> {
        let mut inner = self.lock();
        let Some(index) = inner.tabs.iter().position(|tab| tab.id == id) else { return inner.active.clone() };
        inner.tabs.remove(index);
        inner.runtime.remove(id);
        inner.windows.retain(|_, session| session != id);
        if inner.active.as_deref() == Some(id) {
            inner.active = inner.tabs.get(index).or_else(|| inner.tabs.get(index.wrapping_sub(1))).map(|tab| tab.id.clone());
        }
        self.persist_inner(&inner);
        let next = inner.active.clone();
        drop(inner);
        if id != FIRST {
            let _ignored = std::fs::remove_dir_all(self.projects.join("tabs").join(id));
        }
        next
    }

    pub fn set_active(&self, id: &str) {
        let mut inner = self.lock();
        if inner.tabs.iter().any(|tab| tab.id == id) && inner.active.as_deref() != Some(id) {
            inner.active = Some(id.to_owned());
            self.persist_inner(&inner);
        }
    }

    pub fn active(&self) -> Option<String> {
        self.lock().active.clone()
    }

    pub fn ids(&self) -> Vec<String> {
        self.lock().tabs.iter().map(|tab| tab.id.clone()).collect()
    }

    pub fn count(&self) -> usize {
        self.lock().tabs.len()
    }

    /// Moves a tab to position `to` in the strip.
    pub fn reorder(&self, id: &str, to: usize) {
        let mut inner = self.lock();
        let Some(from) = inner.tabs.iter().position(|tab| tab.id == id) else { return };
        let tab = inner.tabs.remove(from);
        let to = to.min(inner.tabs.len());
        inner.tabs.insert(to, tab);
        self.persist_inner(&inner);
    }

    /// The tab showing a project file already, so opening it again goes to that tab.
    pub fn find_file(&self, path: &str) -> Option<String> {
        let wanted = normalize(path);
        self.lock().tabs.iter().find(|tab| tab.project_path.as_deref().is_some_and(|own| normalize(own) == wanted)).map(|tab| tab.id.clone())
    }

    pub fn set_overview(&self, on: bool) {
        self.lock().overview = on;
    }

    pub fn overview(&self) -> bool {
        self.lock().overview
    }

    /// What a window reports about its tab while it runs.
    pub fn report(&self, id: &str, name: Option<String>, dirty: bool, busy: bool) -> bool {
        let mut inner = self.lock();
        let runtime = inner.runtime.entry(id.to_owned()).or_default();
        let mut changed = runtime.dirty != dirty || runtime.busy != busy || !runtime.ready;
        runtime.ready = true;
        runtime.dirty = dirty;
        runtime.busy = busy;
        if let Some(name) = name.filter(|name| !name.trim().is_empty()) {
            if let Some(tab) = inner.tabs.iter_mut().find(|tab| tab.id == id) {
                if tab.name != name {
                    tab.name = name;
                    changed = true;
                    self.persist_inner(&inner);
                }
            }
        }
        changed
    }

    /// The session's window has loaded its project (it has reported its tab at least once).
    pub fn ready(&self, id: &str) -> bool {
        self.lock().runtime.get(id).is_some_and(|runtime| runtime.ready)
    }

    pub fn set_open_file(&self, id: &str, path: Option<String>) {
        self.lock().runtime.entry(id.to_owned()).or_default().open_file = path;
    }

    /// The project file a session's window should open as it starts, once.
    pub fn take_open_file(&self, id: &str) -> Option<String> {
        self.lock().runtime.get_mut(id).and_then(|runtime| runtime.open_file.take())
    }

    pub fn state(&self, own: Option<&str>) -> TabsState {
        let inner = self.lock();
        let open: std::collections::HashSet<&String> = inner.windows.values().collect();
        TabsState {
            tabs: inner
                .tabs
                .iter()
                .map(|tab| {
                    let runtime = inner.runtime.get(&tab.id);
                    TabView {
                        id: tab.id.clone(),
                        name: tab.name.clone(),
                        project_path: tab.project_path.clone(),
                        dirty: runtime.is_some_and(|runtime| runtime.dirty),
                        busy: runtime.is_some_and(|runtime| runtime.busy),
                        open: open.contains(&tab.id),
                    }
                })
                .collect(),
            active: inner.active.clone(),
            own: own.map(str::to_owned),
            overview: inner.overview,
            max: MAX_TABS,
        }
    }

    /// The session's save order.
    pub fn save_gate(&self, id: &str) -> Arc<SaveGate> {
        self.lock().runtime.entry(id.to_owned()).or_default().saves.clone()
    }

    /// True (and the clock restarted) when the session's autosave copy was last written longer
    /// than `every` ago.
    pub fn backup_due(&self, id: &str, every: std::time::Duration) -> bool {
        let mut inner = self.lock();
        let runtime = inner.runtime.entry(id.to_owned()).or_default();
        if runtime.last_backup.is_some_and(|when| when.elapsed() < every) {
            return false;
        }
        runtime.last_backup = Some(Instant::now());
        true
    }

    /// The same for the session's dated versions.
    pub fn version_due(&self, id: &str, every: std::time::Duration) -> bool {
        let mut inner = self.lock();
        let runtime = inner.runtime.entry(id.to_owned()).or_default();
        if runtime.last_version.is_some_and(|when| when.elapsed() < every) {
            return false;
        }
        runtime.last_version = Some(Instant::now());
        true
    }

    /// Where a session's autosave lives.
    pub fn project_file(&self, id: &str) -> PathBuf {
        if id == FIRST {
            self.projects.join("current.json")
        } else {
            self.projects.join("tabs").join(id).join("current.json")
        }
    }

    /// Where a session's chat is kept; `scope` names a chat of its own (the Plugin Maker's).
    pub fn chat_file(&self, id: &str, scope: Option<&str>) -> PathBuf {
        let name = match scope {
            Some(scope) => format!("chat-{scope}.json"),
            None => "chat.json".to_owned(),
        };
        if id == FIRST {
            self.projects.join(name)
        } else {
            self.projects.join("tabs").join(id).join(name)
        }
    }
}

/// A new session id: short, sortable, safe as a folder and window-label part.
pub fn new_id() -> String {
    ulid::Ulid::new().to_string().to_ascii_lowercase()
}

/// The window label a session's own window gets (the first window keeps "main").
pub fn window_label(id: &str) -> String {
    format!("tab-{id}")
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn normalize(path: &str) -> String {
    path.replace('/', "\\").trim_end_matches('\\').to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("bhippi-tabs-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_first_launch_takes_over_the_session_older_versions_kept() {
        let dir = temp();
        let sessions = Sessions::load(&dir, Some("D:/Film/Project/Film.bhippi".into()), None, "main");
        let first = sessions.for_window("main");
        assert_eq!(first.id, FIRST);
        assert_eq!(first.project_path.as_deref(), Some("D:/Film/Project/Film.bhippi"));
        assert_eq!(sessions.project_file(FIRST), dir.join("current.json"));
        assert_eq!(sessions.chat_file(FIRST, None), dir.join("chat.json"));
        let _ignored = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tabs_open_in_order_are_kept_and_come_back() {
        let dir = temp();
        let sessions = Sessions::load(&dir, None, None, "main");
        let second = sessions.add(Session { id: new_id(), ..Session::default() }, Some(FIRST)).unwrap();
        sessions.attach(&window_label(&second), &second);
        sessions.set_active(&second);
        assert_eq!(sessions.id_for(&window_label(&second)), second);
        assert_ne!(sessions.project_file(&second), sessions.project_file(FIRST));
        // The next launch: the main window shows the tab that was active; the other waits for its window.
        let again = Sessions::load(&dir, None, None, "main");
        assert_eq!(again.ids(), vec![FIRST.to_owned(), second.clone()]);
        assert_eq!(again.id_for("main"), second);
        let _ignored = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn at_most_sixteen_and_closing_the_active_one_moves_to_its_neighbour() {
        let dir = temp();
        let sessions = Sessions::load(&dir, None, None, "main");
        let ids: Vec<String> = (1..MAX_TABS).map(|_| sessions.add(Session { id: new_id(), ..Session::default() }, None).unwrap()).collect();
        assert_eq!(sessions.count(), MAX_TABS);
        assert!(sessions.add(Session { id: new_id(), ..Session::default() }, None).is_none());
        sessions.set_active(&ids[3]);
        assert_eq!(sessions.remove(&ids[3]), Some(ids[4].clone()));
        assert_eq!(sessions.remove(ids.last().unwrap()), Some(ids[4].clone()));
        let _ignored = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_file_open_in_a_tab_is_found_whatever_its_slashes() {
        let dir = temp();
        let sessions = Sessions::load(&dir, Some("D:\\Film\\Project\\Film.bhippi".into()), None, "main");
        assert_eq!(sessions.find_file("d:/film/Project/Film.bhippi").as_deref(), Some(FIRST));
        assert!(sessions.find_file("D:/Other.bhippi").is_none());
        let _ignored = std::fs::remove_dir_all(&dir);
    }
}
