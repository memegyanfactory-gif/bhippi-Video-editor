//! Runs the download queue: starts the next waiting downloads when a slot is free, records how each
//! one ended, and answers the Downloads page. The rules themselves live in `queue.rs`.

use super::queue::{self as rules, QueueItem, QueueState};
use super::*;
use tokio::sync::Notify;

/// Fires whenever the queue changes (a download added, paused, moved, finished); no payload.
pub const QUEUE_EVENT: &str = "bhippi://model-queue";

pub(super) fn emit_queue(app: &AppHandle) {
    let _ignored = app.emit(QUEUE_EVENT, ());
}

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|elapsed| elapsed.as_secs()).unwrap_or(0)
}

/// Once per run of the program: what was running or waiting when Bhippi closed becomes Paused.
fn settle_once(paths: &store::Paths) {
    static SETTLED: std::sync::Once = std::sync::Once::new();
    SETTLED.call_once(|| {
        let _ignored = update_state(paths, |file| {
            rules::settle_after_restart(&mut file.queue);
            Ok(())
        });
    });
}

// ───────────────────────────── starting ─────────────────────────────

/// Starts as many waiting downloads as the limit allows. Each result is `(model id, job id or why not)`.
pub(super) async fn pump(app: &AppHandle, state: &Arc<AppState>) -> Vec<(String, Result<String, String>)> {
    settle_once(&state.paths);
    let picked = update_state(&state.paths, |file| {
        let ids = rules::next_to_start(&file.queue, rules::clamp_parallel(file.max_parallel));
        let mut picked = Vec::new();
        for id in ids {
            if rules::set_state(&mut file.queue, &id, QueueState::Running, None) {
                if let Some(item) = file.queue.iter().find(|item| item.id == id) {
                    picked.push(item.clone());
                }
            }
        }
        Ok(picked)
    })
    .unwrap_or_default();
    let mut started = Vec::new();
    for item in picked {
        let result = match find_entry(&item.id) {
            Ok(entry) => start_file_download(app.clone(), state.clone(), entry, Some(item.variant.clone()), item.addons.clone()).await.map(|started| started.job_id),
            Err(message) => Err(message),
        };
        if let Err(message) = &result {
            let _ignored = update_state(&state.paths, |file| {
                rules::set_state(&mut file.queue, &item.id, QueueState::Failed, Some(message.clone()));
                Ok(())
            });
        }
        started.push((item.id, result));
    }
    emit_queue(app);
    started
}

/// Asks the background scheduler to look at the queue again (a download ended, or Resume all).
pub(super) fn kick(app: &AppHandle, state: &Arc<AppState>) {
    static SCHEDULER: OnceLock<Arc<Notify>> = OnceLock::new();
    let wake = SCHEDULER
        .get_or_init(|| {
            let wake = Arc::new(Notify::new());
            let (app, state, listen) = (app.clone(), state.clone(), wake.clone());
            tauri::async_runtime::spawn(async move {
                loop {
                    listen.notified().await;
                    pump(&app, &state).await;
                }
            });
            wake
        })
        .clone();
    wake.notify_one();
}

/// How a download ended, for `finished`.
pub(super) enum End {
    Done,
    /// Stopped by the person: keep the part-files (paused) or throw them away.
    Stopped { keep: bool },
    Failed(String),
}

/// Records the end of a download in the queue, then lets the next one start.
pub(super) fn finished(app: &AppHandle, state: &Arc<AppState>, id: &str, variant: &str, end: End) {
    let _ignored = update_state(&state.paths, |file| {
        match &end {
            End::Done => {
                rules::remove(&mut file.queue, id);
                rules::remember_finished(&mut file.recent, id, variant, now());
            }
            End::Stopped { keep: true } => {
                rules::set_state(&mut file.queue, id, QueueState::Paused, None);
            }
            End::Stopped { keep: false } => {
                rules::remove(&mut file.queue, id);
            }
            End::Failed(message) => {
                rules::set_state(&mut file.queue, id, QueueState::Failed, Some(message.clone()));
            }
        }
        Ok(())
    });
    emit_queue(app);
    kick(app, state);
}

// ───────────────────────────── the Downloads page ─────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RowState {
    Running,
    Queued,
    Paused,
    Failed,
    Verifying,
    Done,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueRow {
    pub id: String,
    pub name: String,
    pub variant: String,
    pub variant_label: String,
    pub addons: Vec<String>,
    pub state: RowState,
    pub bytes_done: u64,
    pub bytes_total: u64,
    /// Bytes per second, smoothed; 0 when not running.
    pub speed: u64,
    pub eta_seconds: Option<u64>,
    pub error: Option<String>,
    pub thumbnail_path: Option<String>,
    /// Place in line among the waiting downloads, from 1.
    pub position: Option<usize>,
    /// The job behind a running download, so other screens can match it.
    pub job_id: Option<String>,
    /// Unix seconds, for finished downloads.
    pub finished_at: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueView {
    pub rows: Vec<QueueRow>,
    pub max_parallel: usize,
}

/// `(bytes already on disk, bytes in all)` for one download, counting finished files and part-files.
pub(super) fn progress_of(entry: &LibraryEntry, variant: &str, addons: &[String], folder: &Path) -> (u64, u64) {
    let Ok(files) = plan_files(entry, variant, addons) else { return (0, 0) };
    let mut done = 0;
    let mut total = 0;
    for file in &files {
        total += file.bytes;
        if let Ok(target) = safe_join(folder, &file.dest) {
            done += bytes_on_disk(&target, file);
        }
    }
    (done, total)
}

fn row_for(entry: &LibraryEntry, folder: &Path, item: &QueueItem, position: Option<usize>) -> QueueRow {
    let (disk_done, disk_total) = progress_of(entry, &item.variant, &item.addons, folder);
    let live = (item.state == QueueState::Running).then(|| {
        let active = active_lock();
        active.get(&entry.id).map(|active| (active.done.load(Ordering::Relaxed).min(active.total), active.total, active.speed.load(Ordering::Relaxed), active.job_id.clone()))
    });
    let (done, total, speed, job_id) = match live.flatten() {
        Some((done, total, speed, job)) => (done, total, speed, Some(job)),
        None => (disk_done, disk_total, 0, None),
    };
    let state = match item.state {
        QueueState::Running if total > 0 && done >= total => RowState::Verifying,
        QueueState::Running => RowState::Running,
        QueueState::Queued => RowState::Queued,
        QueueState::Paused => RowState::Paused,
        QueueState::Failed => RowState::Failed,
    };
    QueueRow {
        id: entry.id.clone(),
        name: entry.name.clone(),
        variant: item.variant.clone(),
        variant_label: entry.variants.iter().find(|variant| variant.id == item.variant).map(|variant| variant.label.clone()).unwrap_or_default(),
        addons: item.addons.clone(),
        state,
        bytes_done: done,
        bytes_total: total,
        speed,
        eta_seconds: rules::eta_seconds(done, total, speed),
        error: item.error.clone(),
        thumbnail_path: cached_thumbnail(folder, &entry.id).map(|path| path.display().to_string()),
        position,
        job_id,
        finished_at: None,
    }
}

/// The queue as the page shows it: running first, then waiting in order, paused, failed, and the
/// downloads that finished lately. A part-file with no queue entry (left by an older version) shows as paused.
fn view_of(file: &StateFile, paths: &store::Paths) -> QueueView {
    let folder = current_storage(paths, file);
    let mut rows = Vec::new();
    let mut waiting = 0;
    for item in &file.queue {
        let Ok(entry) = find_entry(&item.id) else { continue };
        let position = (item.state == QueueState::Queued).then(|| {
            waiting += 1;
            waiting
        });
        rows.push(row_for(entry, &folder, item, position));
    }
    for entry in catalog().iter().filter(|entry| is_file_runtime(entry)) {
        let installed = file.models.get(&entry.id).is_some_and(|record| record.installed_variant.is_some());
        if installed || file.queue.iter().any(|item| item.id == entry.id) || partial_bytes(entry, &folder) == 0 {
            continue;
        }
        let Some(variant) = default_variant(entry) else { continue };
        let orphan = QueueItem { id: entry.id.clone(), variant: variant.id.clone(), state: QueueState::Paused, ..QueueItem::default() };
        rows.push(row_for(entry, &folder, &orphan, None));
    }
    let rank = |state: RowState| match state {
        RowState::Running | RowState::Verifying => 0,
        RowState::Queued => 1,
        RowState::Paused => 2,
        RowState::Failed => 3,
        RowState::Done => 4,
    };
    rows.sort_by_key(|row| rank(row.state));
    for recent in &file.recent {
        let Ok(entry) = find_entry(&recent.id) else { continue };
        if file.queue.iter().any(|item| item.id == recent.id) {
            continue;
        }
        let item = QueueItem { id: recent.id.clone(), variant: recent.variant.clone(), state: QueueState::Paused, ..QueueItem::default() };
        let mut row = row_for(entry, &folder, &item, None);
        row.state = RowState::Done;
        row.bytes_done = row.bytes_total;
        row.finished_at = Some(recent.at);
        rows.push(row);
    }
    QueueView { rows, max_parallel: rules::clamp_parallel(file.max_parallel) }
}

#[tauri::command]
pub(crate) async fn model_library_queue(state: State<'_, Arc<AppState>>) -> Result<QueueView, String> {
    use_paths(&state.paths);
    settle_once(&state.paths);
    Ok(view_of(&read_state(&state.paths), &state.paths))
}

/// Stops one download but keeps what it fetched; Resume continues from there. A waiting one is paused where it stands.
#[tauri::command]
pub(crate) async fn model_library_pause(app: AppHandle, state: State<'_, Arc<AppState>>, id: String) -> Result<(), String> {
    use_paths(&state.paths);
    settle_once(&state.paths);
    let running = {
        let active = active_lock();
        active.get(&id).map(|download| {
            download.keep_partial.store(true, Ordering::Relaxed);
            download.job_id.clone()
        })
    };
    if let Some(job_id) = running {
        state.jobs.cancel(&job_id);
        return Ok(());
    }
    update_state(&state.paths, |file| {
        match file.queue.iter().find(|item| item.id == id).map(|item| item.state) {
            Some(QueueState::Queued) => {
                rules::set_state(&mut file.queue, &id, QueueState::Paused, None);
                Ok(())
            }
            Some(_) => Ok(()),
            None => Err("That download is not in the queue.".to_owned()),
        }
    })?;
    emit_queue(&app);
    Ok(())
}

/// Puts a paused or failed download back in line (at the end) and starts it when a slot is free.
#[tauri::command]
pub(crate) async fn model_library_resume(app: AppHandle, state: State<'_, Arc<AppState>>, id: String) -> Result<(), String> {
    use_paths(&state.paths);
    settle_once(&state.paths);
    let entry = find_entry(&id)?;
    if active_lock().contains_key(&id) {
        return Err(format!("{} is still stopping. Try again in a moment.", entry.name));
    }
    update_state(&state.paths, |file| {
        if file.queue.iter().any(|item| item.id == id) {
            rules::set_state(&mut file.queue, &id, QueueState::Queued, None);
        } else {
            let variant = default_variant(entry).map(|variant| variant.id.clone()).ok_or_else(|| format!("{} has nothing to download.", entry.name))?;
            rules::enqueue(&mut file.queue, &id, &variant, &[]);
        }
        Ok(())
    })?;
    let outcome = pump(&app, state.inner()).await;
    match outcome.into_iter().find(|(started, _)| *started == id) {
        Some((_, Err(message))) => Err(message),
        _ => Ok(()),
    }
}

/// Stops a download and deletes what it fetched, or removes a waiting one from the line.
#[tauri::command]
pub(crate) async fn model_library_discard(app: AppHandle, state: State<'_, Arc<AppState>>, id: String) -> Result<(), String> {
    model_library_cancel(app, state, id, false).await
}

/// Moves a waiting download to a place in line (1 is next).
#[tauri::command]
pub(crate) async fn model_library_reorder(app: AppHandle, state: State<'_, Arc<AppState>>, id: String, position: usize) -> Result<(), String> {
    use_paths(&state.paths);
    settle_once(&state.paths);
    update_state(&state.paths, |file| {
        if rules::move_to(&mut file.queue, &id, position.saturating_sub(1)) {
            Ok(())
        } else {
            Err("That download is not in the queue.".to_owned())
        }
    })?;
    emit_queue(&app);
    Ok(())
}

#[tauri::command]
pub(crate) async fn model_library_move_to_top(app: AppHandle, state: State<'_, Arc<AppState>>, id: String) -> Result<(), String> {
    model_library_reorder(app, state, id, 1).await
}

#[tauri::command]
pub(crate) async fn model_library_pause_all(app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    use_paths(&state.paths);
    settle_once(&state.paths);
    let running = update_state(&state.paths, |file| Ok(rules::pause_all(&mut file.queue)))?;
    for id in running {
        let job_id = {
            let active = active_lock();
            active.get(&id).map(|download| {
                download.keep_partial.store(true, Ordering::Relaxed);
                download.job_id.clone()
            })
        };
        if let Some(job_id) = job_id {
            state.jobs.cancel(&job_id);
        }
    }
    emit_queue(&app);
    Ok(())
}

#[tauri::command]
pub(crate) async fn model_library_resume_all(app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    use_paths(&state.paths);
    settle_once(&state.paths);
    update_state(&state.paths, |file| {
        rules::resume_all(&mut file.queue);
        Ok(())
    })?;
    pump(&app, state.inner()).await;
    Ok(())
}

/// How many downloads may run at once (1 to 3). More start at once if the limit goes up.
#[tauri::command]
pub(crate) async fn model_library_set_parallel(app: AppHandle, state: State<'_, Arc<AppState>>, limit: u32) -> Result<usize, String> {
    use_paths(&state.paths);
    settle_once(&state.paths);
    let kept = rules::clamp_parallel(Some(limit));
    update_state(&state.paths, |file| {
        file.max_parallel = Some(kept as u32);
        Ok(())
    })?;
    pump(&app, state.inner()).await;
    Ok(kept)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("bhippi-queue-{name}-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn downloadable() -> (&'static LibraryEntry, String, LibraryFile) {
        let entry = catalog().iter().find(|entry| is_file_runtime(entry) && default_variant(entry).is_some_and(|variant| variant.files.iter().all(|file| file.bytes > 1000))).unwrap();
        let variant = default_variant(entry).unwrap();
        (entry, variant.id.clone(), variant.files[0].clone())
    }

    #[test]
    fn a_paused_download_reports_how_far_the_part_file_got() {
        let (entry, variant, first) = downloadable();
        let folder = scratch("paused");
        let target = safe_join(&folder, &first.dest).unwrap();
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(part_path(&target), vec![1u8; 700]).unwrap();
        let item = QueueItem { id: entry.id.clone(), variant: variant.clone(), state: QueueState::Paused, ..QueueItem::default() };
        let row = row_for(entry, &folder, &item, None);
        assert_eq!(row.state, RowState::Paused);
        assert_eq!(row.bytes_done, 700, "Resume continues from the part file, so that is where it stands");
        assert!(row.bytes_total >= first.bytes);
        assert_eq!(row.speed, 0);
        // The same number is what a resumed download starts counting from.
        assert_eq!(progress_of(entry, &variant, &[], &folder).0, bytes_on_disk(&target, &first) + other_files(entry, &variant, &folder, &first));
        let _ignored = std::fs::remove_dir_all(&folder);
    }

    fn other_files(entry: &LibraryEntry, variant: &str, folder: &Path, first: &LibraryFile) -> u64 {
        plan_files(entry, variant, &[]).unwrap().iter().filter(|file| file.dest != first.dest).map(|file| bytes_on_disk(&safe_join(folder, &file.dest).unwrap(), file)).sum()
    }

    #[test]
    fn the_saved_queue_comes_back_paused_in_the_same_order() {
        let (entry, variant, _) = downloadable();
        let mut file = StateFile::default();
        rules::enqueue(&mut file.queue, &entry.id, &variant, &[]);
        let text = serde_json::to_string(&file).unwrap();
        let mut back: StateFile = serde_json::from_str(&text).unwrap();
        rules::set_state(&mut back.queue, &entry.id, QueueState::Running, None);
        rules::settle_after_restart(&mut back.queue);
        assert_eq!(back.queue.len(), 1);
        assert_eq!(back.queue[0].state, QueueState::Paused);
        let folder = scratch("reload");
        let paths_free = view_rows_only(&back, &folder);
        assert_eq!(paths_free[0].state, RowState::Paused);
        let _ignored = std::fs::remove_dir_all(&folder);
    }

    /// The rows of a state file's queue, without needing the app's folders.
    fn view_rows_only(file: &StateFile, folder: &Path) -> Vec<QueueRow> {
        file.queue.iter().filter_map(|item| find_entry(&item.id).ok().map(|entry| row_for(entry, folder, item, None))).collect()
    }

    #[test]
    fn waiting_rows_know_their_place_in_line() {
        let (entry, variant, _) = downloadable();
        let folder = scratch("place");
        let item = QueueItem { id: entry.id.clone(), variant, state: QueueState::Queued, ..QueueItem::default() };
        let row = row_for(entry, &folder, &item, Some(2));
        assert_eq!(row.state, RowState::Queued);
        assert_eq!(row.position, Some(2));
        let _ignored = std::fs::remove_dir_all(&folder);
    }
}
