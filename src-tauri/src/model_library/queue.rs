//! The download queue: which Model Library downloads run now, which wait, which are paused (with
//! their part-files kept) and which failed. The list is saved in `state.json`, so after a restart the
//! partial downloads still show up, paused, and a press of Resume continues them from the `.part`
//! file. The rules here are pure and tested; model_library.rs starts and stops the real downloads.

use serde::{Deserialize, Serialize};

/// How many downloads may run at once when the person has not chosen.
pub const DEFAULT_PARALLEL: usize = 1;
pub const MAX_PARALLEL: usize = 3;
/// Finished downloads kept for the "Finished" list.
const RECENT_KEPT: usize = 8;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QueueState {
    Running,
    #[default]
    Queued,
    Paused,
    Failed,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct QueueItem {
    pub id: String,
    pub variant: String,
    pub addons: Vec<String>,
    pub state: QueueState,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Recent {
    pub id: String,
    pub variant: String,
    /// Unix seconds.
    pub at: u64,
}

pub fn clamp_parallel(value: Option<u32>) -> usize {
    (value.unwrap_or(DEFAULT_PARALLEL as u32) as usize).clamp(1, MAX_PARALLEL)
}

/// Adds a download at the end of the line as Queued. One that is already listed (paused, failed or
/// waiting) is kept at its place with the new size and add-ons, and set back to Queued.
pub fn enqueue(queue: &mut Vec<QueueItem>, id: &str, variant: &str, addons: &[String]) {
    if let Some(item) = queue.iter_mut().find(|item| item.id == id) {
        if item.state == QueueState::Running {
            return;
        }
        item.variant = variant.to_owned();
        item.addons = addons.to_vec();
        item.state = QueueState::Queued;
        item.error = None;
        return;
    }
    queue.push(QueueItem { id: id.to_owned(), variant: variant.to_owned(), addons: addons.to_vec(), state: QueueState::Queued, error: None });
}

pub fn set_state(queue: &mut [QueueItem], id: &str, state: QueueState, error: Option<String>) -> bool {
    match queue.iter_mut().find(|item| item.id == id) {
        Some(item) => {
            item.state = state;
            item.error = error;
            true
        }
        None => false,
    }
}

pub fn remove(queue: &mut Vec<QueueItem>, id: &str) -> bool {
    let before = queue.len();
    queue.retain(|item| item.id != id);
    queue.len() != before
}

/// The Queued items to start now, in line order, so that at most `limit` are Running.
pub fn next_to_start(queue: &[QueueItem], limit: usize) -> Vec<String> {
    let running = queue.iter().filter(|item| item.state == QueueState::Running).count();
    queue.iter().filter(|item| item.state == QueueState::Queued).take(limit.saturating_sub(running)).map(|item| item.id.clone()).collect()
}

/// Moves a download to a place in line (0 is first). Running downloads stay ahead of everything that
/// is waiting, so "move to top" puts an item first among the waiting ones.
pub fn move_to(queue: &mut Vec<QueueItem>, id: &str, position: usize) -> bool {
    let Some(from) = queue.iter().position(|item| item.id == id) else { return false };
    let item = queue.remove(from);
    let floor = queue.iter().take_while(|other| other.state == QueueState::Running).count();
    let to = position.max(floor).min(queue.len());
    queue.insert(to, item);
    true
}

/// A download cannot be running in a program that has just started: whatever was running or waiting
/// when Bhippi closed becomes Paused (its part-files are still there), and nothing restarts by itself.
pub fn settle_after_restart(queue: &mut [QueueItem]) {
    for item in queue.iter_mut() {
        if matches!(item.state, QueueState::Running | QueueState::Queued) {
            item.state = QueueState::Paused;
        }
    }
}

pub fn pause_all(queue: &mut [QueueItem]) -> Vec<String> {
    let mut running = Vec::new();
    for item in queue.iter_mut() {
        match item.state {
            QueueState::Queued => item.state = QueueState::Paused,
            QueueState::Running => running.push(item.id.clone()),
            _ => {}
        }
    }
    running
}

pub fn resume_all(queue: &mut [QueueItem]) {
    for item in queue.iter_mut().filter(|item| item.state == QueueState::Paused) {
        item.state = QueueState::Queued;
    }
}

pub fn remember_finished(recent: &mut Vec<Recent>, id: &str, variant: &str, at: u64) {
    recent.retain(|row| row.id != id);
    recent.insert(0, Recent { id: id.to_owned(), variant: variant.to_owned(), at });
    recent.truncate(RECENT_KEPT);
}

/// Seconds left at the current speed, or None when it cannot be told yet.
pub fn eta_seconds(done: u64, total: u64, speed: u64) -> Option<u64> {
    (speed > 0 && total > done).then(|| (total - done).div_ceil(speed))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    fn line(items: &[(&str, QueueState)]) -> Vec<QueueItem> {
        items.iter().map(|(id, state)| QueueItem { id: (*id).to_owned(), variant: "v".to_owned(), state: *state, ..QueueItem::default() }).collect()
    }

    fn ids(queue: &[QueueItem]) -> Vec<&str> {
        queue.iter().map(|item| item.id.as_str()).collect()
    }

    #[test]
    fn items_wait_in_the_order_they_were_added() {
        let mut queue = Vec::new();
        for id in ["a", "b", "c"] {
            enqueue(&mut queue, id, "v", &[]);
        }
        assert_eq!(ids(&queue), ["a", "b", "c"]);
        assert_eq!(next_to_start(&queue, 3), ["a", "b", "c"]);
    }

    #[test]
    fn only_the_limit_runs_and_the_rest_wait() {
        let mut queue = line(&[("a", QueueState::Queued), ("b", QueueState::Queued), ("c", QueueState::Queued)]);
        assert_eq!(next_to_start(&queue, 1), ["a"]);
        set_state(&mut queue, "a", QueueState::Running, None);
        assert!(next_to_start(&queue, 1).is_empty(), "one is running and the limit is one");
        assert_eq!(next_to_start(&queue, 2), ["b"]);
        remove(&mut queue, "a");
        assert_eq!(next_to_start(&queue, 1), ["b"], "the next in line goes when a slot frees");
        assert_eq!(clamp_parallel(None), 1);
        assert_eq!(clamp_parallel(Some(0)), 1);
        assert_eq!(clamp_parallel(Some(9)), MAX_PARALLEL);
    }

    #[test]
    fn paused_and_failed_items_do_not_start_by_themselves() {
        let queue = line(&[("a", QueueState::Paused), ("b", QueueState::Failed), ("c", QueueState::Queued)]);
        assert_eq!(next_to_start(&queue, 3), ["c"]);
    }

    #[test]
    fn adding_a_listed_download_again_requeues_it_in_place() {
        let mut queue = line(&[("a", QueueState::Paused), ("b", QueueState::Queued)]);
        enqueue(&mut queue, "a", "big", &["x".to_owned()]);
        assert_eq!(ids(&queue), ["a", "b"]);
        assert_eq!(queue[0].state, QueueState::Queued);
        assert_eq!(queue[0].variant, "big");
        assert_eq!(queue[0].addons, ["x"]);
    }

    #[test]
    fn move_to_top_goes_behind_running_downloads_only() {
        let mut queue = line(&[("run", QueueState::Running), ("a", QueueState::Queued), ("b", QueueState::Queued), ("c", QueueState::Queued)]);
        assert!(move_to(&mut queue, "c", 0));
        assert_eq!(ids(&queue), ["run", "c", "a", "b"]);
        assert!(move_to(&mut queue, "c", 99));
        assert_eq!(ids(&queue), ["run", "a", "b", "c"]);
        assert!(!move_to(&mut queue, "missing", 0));
    }

    #[test]
    fn a_restart_pauses_everything_and_starts_nothing() {
        let mut queue = line(&[("a", QueueState::Running), ("b", QueueState::Queued), ("c", QueueState::Failed), ("d", QueueState::Paused)]);
        settle_after_restart(&mut queue);
        let states: Vec<_> = queue.iter().map(|item| item.state).collect();
        assert_eq!(states, [QueueState::Paused, QueueState::Paused, QueueState::Failed, QueueState::Paused]);
        assert!(next_to_start(&queue, 3).is_empty());
        resume_all(&mut queue);
        assert_eq!(next_to_start(&queue, 3), ["a", "b", "d"], "Resume all lines the paused ones up in their old order");
    }

    #[test]
    fn the_queue_survives_a_save_and_reload() {
        let mut queue = line(&[("a", QueueState::Paused), ("b", QueueState::Failed)]);
        queue[1].error = Some("The server said no".to_owned());
        queue[0].addons = vec!["lora".to_owned()];
        let text = serde_json::to_string(&queue).unwrap();
        assert!(text.contains("\"paused\"") && text.contains("\"failed\""));
        let back: Vec<QueueItem> = serde_json::from_str(&text).unwrap();
        assert_eq!(back, queue);
        // An older state.json has no queue at all.
        let old: Vec<QueueItem> = serde_json::from_str("[{\"id\":\"z\"}]").unwrap();
        assert_eq!(old[0].state, QueueState::Queued);
    }

    #[test]
    fn pause_all_stops_the_waiting_and_names_the_running() {
        let mut queue = line(&[("a", QueueState::Running), ("b", QueueState::Queued)]);
        assert_eq!(pause_all(&mut queue), ["a"]);
        assert_eq!(queue[1].state, QueueState::Paused);
    }

    #[test]
    fn finished_list_is_newest_first_and_short() {
        let mut recent = Vec::new();
        for index in 0..12u64 {
            remember_finished(&mut recent, &format!("m{index}"), "v", index);
        }
        assert_eq!(recent.len(), RECENT_KEPT);
        assert_eq!(recent[0].id, "m11");
        remember_finished(&mut recent, "m5", "v", 99);
        assert_eq!(recent[0].id, "m5");
        assert_eq!(recent.iter().filter(|row| row.id == "m5").count(), 1);
    }

    #[test]
    fn eta_needs_a_speed() {
        assert_eq!(eta_seconds(0, 100, 0), None);
        assert_eq!(eta_seconds(100, 100, 5), None);
        assert_eq!(eta_seconds(50, 100, 10), Some(5));
    }
}
