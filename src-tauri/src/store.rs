//! Where Bhippi keeps its files, and the one way JSON reaches disk (atomically).

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

/// Reads JSON like `read_json`, but a value of the wrong type costs only that field, not the file:
/// every top-level field (and every field inside an object-valued one) that fits `T` is kept, the
/// rest fall back to their defaults. The dropped paths come back so the caller can say what went.
/// When anything is dropped the file as it was is copied to `*.before-repair.json`.
pub fn read_json_lenient<T: DeserializeOwned + Serialize + Default>(path: &Path) -> (T, Vec<String>) {
    let Ok(text) = std::fs::read_to_string(path) else {
        return (T::default(), Vec::new());
    };
    let value: serde_json::Value = match serde_json::from_str(&text) {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(path = %path.display(), %error, "unreadable JSON kept aside");
            let _ignored = std::fs::rename(path, path.with_extension("corrupt"));
            return (T::default(), Vec::new());
        }
    };
    if let Ok(whole) = serde_json::from_value::<T>(value.clone()) {
        return (whole, Vec::new());
    }
    let (fitted, dropped) = fit_fields::<T>(serde_json::to_value(T::default()).unwrap_or_default(), &value);
    if !dropped.is_empty() {
        tracing::warn!(path = %path.display(), ?dropped, "fields of the wrong type fell back to their defaults");
        let _ignored = std::fs::copy(path, path.with_extension("before-repair.json"));
    }
    (fitted, dropped)
}

/// `base` (a valid `T` as JSON) with each field of `incoming` laid over it where the result is still
/// a valid `T`; object-valued fields that do not fit whole are tried one inner field at a time.
/// Returns the value and the paths that had to be dropped.
pub fn fit_fields<T: DeserializeOwned + Default>(mut base: serde_json::Value, incoming: &serde_json::Value) -> (T, Vec<String>) {
    let mut dropped = Vec::new();
    let fits = |candidate: &serde_json::Value| serde_json::from_value::<T>(candidate.clone()).is_ok();
    if let (Some(fields), true) = (incoming.as_object(), base.is_object()) {
        for (key, field) in fields {
            let mut candidate = base.clone();
            candidate[key.as_str()] = field.clone();
            if fits(&candidate) {
                base = candidate;
                continue;
            }
            match (field.as_object(), base.get(key).map(serde_json::Value::is_object)) {
                (Some(inner), Some(true)) => {
                    for (inner_key, inner_field) in inner {
                        let mut candidate = base.clone();
                        candidate[key.as_str()][inner_key.as_str()] = inner_field.clone();
                        if fits(&candidate) {
                            base = candidate;
                        } else {
                            dropped.push(format!("{key}.{inner_key}"));
                        }
                    }
                }
                _ => dropped.push(key.clone()),
            }
        }
    }
    (serde_json::from_value(base).unwrap_or_default(), dropped)
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
        let dir = std::env::temp_dir().join(format!("bhippi-store-{}", super::new_id()));
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
