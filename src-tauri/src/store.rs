//! Where Helios keeps its files, and the one way JSON reaches disk (atomically).

use serde::de::DeserializeOwned;
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub struct Paths {
    pub root: PathBuf,
    pub thumbnails: PathBuf,
    pub proxies: PathBuf,
    pub projects: PathBuf,
    pub work: PathBuf,
    pub sfx: PathBuf,
    pub agent_workspace: PathBuf,
    /// Downloaded speech models and the programs that run them.
    pub models: PathBuf,
}

impl Paths {
    pub fn new(root: PathBuf) -> std::io::Result<Self> {
        let paths = Self {
            thumbnails: root.join("thumbnails"),
            proxies: root.join("proxies"),
            projects: root.join("projects"),
            work: root.join("work"),
            sfx: root.join("sfx"),
            agent_workspace: root.join("agent-workspace"),
            models: root.join("models"),
            root,
        };
        for dir in [
            &paths.root,
            &paths.thumbnails,
            &paths.proxies,
            &paths.projects,
            &paths.work,
            &paths.sfx,
            &paths.agent_workspace,
            &paths.models,
        ] {
            std::fs::create_dir_all(dir)?;
        }
        Ok(paths)
    }

    pub fn library_file(&self) -> PathBuf {
        self.root.join("library.json")
    }

    pub fn settings_file(&self) -> PathBuf {
        self.root.join("settings.json")
    }

    pub fn project_file(&self) -> PathBuf {
        self.projects.join("current.json")
    }

    pub fn chat_file(&self) -> PathBuf {
        self.projects.join("chat.json")
    }
}

/// Reads JSON, falling back to `T::default()` when the file is absent or unreadable. A
/// corrupt file is kept aside as `*.corrupt` rather than silently overwritten.
pub fn read_json<T: DeserializeOwned + Default>(path: &Path) -> T {
    let Ok(text) = std::fs::read_to_string(path) else {
        return T::default();
    };
    match serde_json::from_str(&text) {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(path = %path.display(), %error, "unreadable JSON kept aside");
            let _ignored = std::fs::rename(path, path.with_extension("corrupt"));
            T::default()
        }
    }
}

/// Writes JSON via a temp file and rename, so a crash never leaves half a file.
pub fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    let temporary = path.with_extension(format!("{}.tmp", ulid::Ulid::new()));
    std::fs::write(&temporary, text)
        .map_err(|error| format!("could not write {}: {error}", path.display()))?;
    std::fs::rename(&temporary, path).map_err(|error| {
        let _ignored = std::fs::remove_file(&temporary);
        format!("could not save {}: {error}", path.display())
    })
}

pub fn new_id() -> String {
    ulid::Ulid::new().to_string().to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::{read_json, write_json};

    #[test]
    fn json_round_trips_and_a_corrupt_file_is_kept_aside() {
        let dir = std::env::temp_dir().join(format!("helios-store-{}", super::new_id()));
        std::fs::create_dir_all(&dir).expect("dir");
        let path = dir.join("value.json");
        write_json(&path, &vec![1, 2, 3]).expect("write");
        assert_eq!(read_json::<Vec<i32>>(&path), vec![1, 2, 3]);
        std::fs::write(&path, "{not json").expect("corrupt");
        assert!(read_json::<Vec<i32>>(&path).is_empty());
        assert!(path.with_extension("corrupt").is_file());
        let _ignored = std::fs::remove_dir_all(dir);
    }
}
