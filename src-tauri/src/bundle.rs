//! Saving gathers a project's files into its folder.
//!
//! A `.helios` owns a folder ([`storage::saved_folder`]). On save every file the project uses
//! that lives outside it — AI downloads, generated images/video/audio, voice-overs, roto runs,
//! tracking passes, storyboard pictures, the AI's guidelines and notes — is copied into the
//! matching category folder (moved, when it sits in the app's scratch places or in the unsaved
//! project's own folder), and the project is pointed there. Imported originals stay where they
//! are unless Settings › Storage › "Copy imported media into the project" is on.
//!
//! Inside the file, paths under the folder are stored relative to the `.helios`
//! (`extras.relativePaths` lists which), so the whole folder can be moved or zipped and still
//! opens with its media read straight from it.

use crate::files::Document;
use crate::storage::{self, Category};
use crate::AppState;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

/// Emitted when a guideline, plan or note changes, so the Project panel lists it again.
pub const DOCS_EVENT: &str = "helios://docs";
const DOC_EXTENSIONS: &[&str] = &["md", "markdown", "txt"];
const VIDEO: &[&str] = &["mp4", "m4v", "mov", "mkv", "webm", "avi", "wmv", "flv", "ts", "mts", "m2ts", "mpg", "mpeg", "3gp", "gif", "ogv"];
const AUDIO: &[&str] = &["mp3", "wav", "m4a", "aac", "flac", "ogg", "oga", "opus", "wma", "aif", "aiff"];
const IMAGE: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp", "svg"];

// ───────────────────────────── paths ─────────────────────────────

/// `.` dropped and `..` applied, without touching the disk (the file may not exist yet).
pub fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Comparable components: Windows paths compare without case.
fn key(path: &Path) -> Vec<String> {
    normalize(path)
        .components()
        .map(|component| {
            let text = component.as_os_str().to_string_lossy();
            if cfg!(windows) { text.replace('/', "\\").to_lowercase() } else { text.into_owned() }
        })
        .collect()
}

fn key_string(path: &Path) -> String {
    key(path).join("/")
}

/// Whether `path` is `base` or inside it.
pub fn within(path: &Path, base: &Path) -> bool {
    let (path, base) = (key(path), key(base));
    !base.is_empty() && path.len() >= base.len() && path[..base.len()] == base[..]
}

/// `path` relative to `base`, when it is inside it.
pub fn relative_path(path: &Path, base: &Path) -> Option<PathBuf> {
    if !within(path, base) {
        return None;
    }
    let skip = key(base).len();
    Some(normalize(path).components().skip(skip).collect())
}

fn slash_join(path: &Path) -> String {
    path.components().map(|component| component.as_os_str().to_string_lossy().into_owned()).collect::<Vec<_>>().join("/")
}

/// How a path is written into a `.helios` in `helios_dir` whose project folder is `project`:
/// relative (with `/`) when it is beside the file or inside the project folder — which may be
/// the file's parent (`<folder>/Project/x.helios` → `../Downloads/clip.mp4`) — otherwise `None`.
pub fn relative_text(path: &Path, helios_dir: &Path, project: &Path) -> Option<String> {
    if let Some(rel) = relative_path(path, helios_dir).filter(|rel| rel.components().next().is_some()) {
        return Some(slash_join(&rel));
    }
    if within(path, project) {
        let parent = helios_dir.parent()?;
        let rel = relative_path(path, parent).filter(|rel| rel.components().next().is_some())?;
        return Some(format!("../{}", slash_join(&rel)));
    }
    None
}

/// A stored path that is relative (not `C:\…`, `\\server\…` or `/…`).
pub fn is_relative_text(text: &str) -> bool {
    !text.is_empty() && !text.starts_with(['/', '\\']) && !text.contains(':') && !Path::new(text).is_absolute()
}

/// A relative stored path back to an absolute one.
pub fn resolve_text(text: &str, helios_dir: &Path) -> PathBuf {
    let native: String = if cfg!(windows) { text.replace('/', "\\") } else { text.to_owned() };
    normalize(&helios_dir.join(native))
}

// ───────────────────────────── what the project uses ─────────────────────────────

/// What a referenced file is, which decides its category folder.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hint {
    Video,
    Image,
    Audio,
    /// A roto matte: its whole run folder travels with it.
    Roto,
    Tracking,
    Storyboard,
    /// A guideline, plan or note the AI wrote.
    Note,
    Other,
}

impl Hint {
    pub fn of_extension(path: &Path) -> Self {
        let ext = path.extension().and_then(|ext| ext.to_str()).unwrap_or("").to_ascii_lowercase();
        if VIDEO.contains(&ext.as_str()) {
            Hint::Video
        } else if AUDIO.contains(&ext.as_str()) {
            Hint::Audio
        } else if IMAGE.contains(&ext.as_str()) {
            Hint::Image
        } else if DOC_EXTENSIONS.contains(&ext.as_str()) {
            Hint::Note
        } else {
            Hint::Other
        }
    }

    fn of_asset_kind(kind: &str) -> Self {
        match kind {
            "video" => Hint::Video,
            "audio" => Hint::Audio,
            "image" => Hint::Image,
            _ => Hint::Other,
        }
    }

    /// The folder under the project folder it is filed in when it comes from the app's own places.
    pub fn folder(self) -> PathBuf {
        let rel = match self {
            Hint::Video => "Generated/Video",
            Hint::Image => "Generated/Images",
            Hint::Audio => "Generated/Audio",
            Hint::Roto => Category::Roto.relative(),
            Hint::Tracking => Category::Tracking.relative(),
            Hint::Storyboard => Category::Storyboard.relative(),
            Hint::Note => Category::Guidelines.relative(),
            Hint::Other => Category::Research.relative(),
        };
        rel.split('/').collect()
    }

    /// Something the user might have imported themselves (and so follows "copy imports").
    fn is_media(self) -> bool {
        matches!(self, Hint::Video | Hint::Image | Hint::Audio | Hint::Other)
    }
}

/// One path string in a document: where it is (a JSON pointer) and what it is.
#[derive(Clone, Debug)]
pub struct Ref {
    pub pointer: String,
    pub path: PathBuf,
    pub hint: Hint,
}

/// Fields that hold words, never file paths, even when the words look like one.
const TEXT_KEYS: &[&str] = &[
    "text", "subtitle", "html", "css", "js", "script", "narration", "prompt", "negativePrompt", "notes", "note", "visual", "audio", "intent",
    "evidence", "description", "query", "url", "mediaUrl", "title", "name", "label", "headline", "kicker", "goal",
];

fn escape(key: &str) -> String {
    key.replace('~', "~0").replace('/', "~1")
}

fn looks_like_path(text: &str) -> bool {
    (4..=1024).contains(&text.len()) && !text.contains(['\n', '\r', '<', '>', '"', '|']) && Path::new(text).is_absolute()
}

/// The media paths of a document's `assets` array.
pub fn asset_refs(assets: &Value) -> Vec<Ref> {
    let Some(items) = assets.as_array() else { return Vec::new() };
    items
        .iter()
        .enumerate()
        .filter_map(|(index, asset)| {
            let path = asset.get("path")?.as_str()?;
            let hint = Hint::of_asset_kind(asset.get("kind").and_then(Value::as_str).unwrap_or(""));
            Some(Ref { pointer: format!("/assets/{index}/path"), path: PathBuf::from(path), hint })
        })
        .collect()
}

/// Every absolute path inside a project (roto mattes, storyboard pictures, motion-scene
/// sources…), found by shape so fields added later are covered too.
pub fn project_refs(project: &Value, pointer: &str) -> Vec<Ref> {
    let mut out = Vec::new();
    walk(project, pointer.to_owned(), "", false, &mut out);
    out
}

fn walk(value: &Value, pointer: String, key: &str, planning: bool, out: &mut Vec<Ref>) {
    match value {
        Value::Object(map) => {
            for (name, child) in map {
                let planning = planning || name == "storyboard" || name == "videoBlueprint";
                walk(child, format!("{pointer}/{}", escape(name)), name, planning, out);
            }
        }
        Value::Array(items) => {
            for (index, child) in items.iter().enumerate() {
                walk(child, format!("{pointer}/{index}"), key, planning, out);
            }
        }
        Value::String(text) if !TEXT_KEYS.contains(&key) && looks_like_path(text) => {
            let path = PathBuf::from(text);
            let hint = if key == "rotoMatte" || key == "matte" {
                Hint::Roto
            } else {
                match Hint::of_extension(&path) {
                    Hint::Image if key == "thumbnail" || planning => Hint::Storyboard,
                    other => other,
                }
            };
            out.push(Ref { pointer, path, hint });
        }
        _ => {}
    }
}

// ───────────────────────────── the plan ─────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Op {
    Copy,
    Move,
}

/// Where things are, for deciding what happens to each file.
#[derive(Clone, Debug)]
pub struct Ctx {
    /// The folder the saved `.helios` owns.
    pub project: PathBuf,
    /// The folder the project used before this save, when that is another one.
    pub previous: Option<PathBuf>,
    /// The previous folder was the unsaved project's scratch folder: its files move.
    pub move_previous: bool,
    pub storage_root: PathBuf,
    pub app_data: PathBuf,
    /// Scratch places whose files move rather than copy (work folder, agent workspace, temp).
    pub movable: Vec<PathBuf>,
    /// App places never collected (built-in SFX, models, proxies, the install folder).
    pub skip: Vec<PathBuf>,
    pub copy_imports: bool,
    /// "Save a copy" never moves anything: the open session keeps using the originals.
    pub allow_move: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Decision {
    /// Already in the project folder.
    Keep,
    /// Stays where it is (an imported original, an app resource).
    Leave,
    /// Goes to `project/<rel>`.
    Transfer { rel: PathBuf, op: Op },
}

fn is_category_folder(name: &str) -> bool {
    Category::ALL.iter().any(|category| category.relative().split('/').next().is_some_and(|top| top.eq_ignore_ascii_case(name)))
}

/// What happens to one file (or run folder) the project uses.
pub fn decide(ctx: &Ctx, unit: &Path, hint: Hint) -> Decision {
    if within(unit, &ctx.project) {
        return Decision::Keep;
    }
    if hint != Hint::Note && ctx.skip.iter().any(|dir| within(unit, dir)) {
        return Decision::Leave;
    }
    let Some(name) = unit.file_name() else { return Decision::Leave };
    let op = |wanted: Op| if ctx.allow_move { wanted } else { Op::Copy };
    if let Some(previous) = &ctx.previous {
        if let Some(rel) = relative_path(unit, previous).filter(|rel| rel.components().next().is_some()) {
            return Decision::Transfer { rel, op: op(if ctx.move_previous { Op::Move } else { Op::Copy }) };
        }
    }
    // Another project's folder under the storage root: same category, same layout.
    if let Some(rel) = relative_path(unit, &ctx.storage_root) {
        let parts: Vec<Component> = rel.components().collect();
        if parts.len() >= 3 && is_category_folder(&parts[1].as_os_str().to_string_lossy()) {
            return Decision::Transfer { rel: parts[1..].iter().collect(), op: Op::Copy };
        }
    }
    let filed = hint.folder().join(name);
    if ctx.movable.iter().any(|dir| within(unit, dir)) {
        return Decision::Transfer { rel: filed, op: op(Op::Move) };
    }
    if within(unit, &ctx.app_data) {
        return Decision::Transfer { rel: filed, op: Op::Copy };
    }
    if hint.is_media() {
        return if ctx.copy_imports {
            Decision::Transfer { rel: category_path(Category::Footage).join(name), op: Op::Copy }
        } else {
            Decision::Leave
        };
    }
    Decision::Transfer { rel: filed, op: Op::Copy }
}

fn category_path(category: Category) -> PathBuf {
    category.relative().split('/').collect()
}

/// One file or folder the project uses.
#[derive(Clone, Debug)]
pub struct Unit {
    pub path: PathBuf,
    pub hint: Hint,
    pub dir: bool,
}

#[derive(Clone, Debug)]
pub struct Step {
    pub from: PathBuf,
    pub to: PathBuf,
    pub op: Op,
    pub dir: bool,
    pub bytes: u64,
}

#[derive(Debug, Default)]
pub struct Plan {
    pub steps: Vec<Step>,
    /// Where each collected file or folder ends up (reused copies included), by source.
    targets: HashMap<String, PathBuf>,
    pub reused: usize,
    pub left: usize,
}

impl Plan {
    /// Where `path` will be after the plan runs: its own target, or inside a folder that moves.
    pub fn destination(&self, path: &Path) -> Option<PathBuf> {
        if let Some(target) = self.targets.get(&key_string(path)) {
            return Some(target.clone());
        }
        self.steps.iter().filter(|step| step.dir).find_map(|step| relative_path(path, &step.from).map(|rel| step.to.join(rel)))
    }
}

fn file_len(path: &Path) -> u64 {
    std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0)
}

fn tree_files(dir: &Path, out: &mut Vec<PathBuf>, budget: &mut usize) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if *budget == 0 {
            return;
        }
        *budget -= 1;
        let path = entry.path();
        match entry.file_type() {
            Ok(kind) if kind.is_dir() => tree_files(&path, out, budget),
            Ok(kind) if kind.is_file() => out.push(path),
            _ => {}
        }
    }
}

fn files_in(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut budget = 100_000;
    tree_files(dir, &mut out, &mut budget);
    out
}

/// A cheap content fingerprint: the size and a hash of the first and last MiB.
fn fingerprint(path: &Path) -> Option<(u64, Vec<u8>)> {
    const EDGE: u64 = 1024 * 1024;
    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; usize::try_from(EDGE.min(len)).ok()?];
    file.read_exact(&mut buffer).ok()?;
    hasher.update(&buffer);
    if len > EDGE {
        let tail = EDGE.min(len - EDGE);
        file.seek(SeekFrom::End(-i64::try_from(tail).ok()?)).ok()?;
        let mut end = vec![0u8; usize::try_from(tail).ok()?];
        file.read_exact(&mut end).ok()?;
        hasher.update(&end);
    }
    Some((len, hasher.finalize().to_vec()))
}

/// The same file content (by size first, then the fingerprint).
pub fn same_content(a: &Path, b: &Path) -> bool {
    if !a.is_file() || !b.is_file() || file_len(a) != file_len(b) {
        return false;
    }
    fingerprint(a).is_some_and(|left| fingerprint(b).is_some_and(|right| left == right))
}

fn numbered(name: &str, n: usize) -> String {
    let path = Path::new(name);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = path.extension().and_then(|s| s.to_str()).map(|e| format!(".{e}")).unwrap_or_default();
    format!("{stem} ({n}){ext}")
}

/// Where `from` lands near `wanted`: an identical file already there (or already planned) is
/// reused; a different one with the name gets a numbered sibling.
fn settle(from: &Path, wanted: &Path, claimed: &HashMap<String, PathBuf>) -> (PathBuf, bool) {
    let dir = wanted.parent().map(Path::to_path_buf).unwrap_or_default();
    let name = wanted.file_name().and_then(|n| n.to_str()).unwrap_or("file").to_owned();
    for n in 1..10_000 {
        let candidate = if n == 1 { wanted.to_path_buf() } else { dir.join(numbered(&name, n)) };
        if let Some(other) = claimed.get(&key_string(&candidate)) {
            if same_content(from, other) {
                return (candidate, true);
            }
            continue;
        }
        if candidate.exists() {
            if same_content(from, &candidate) {
                return (candidate, true);
            }
            continue;
        }
        return (candidate, false);
    }
    (wanted.to_path_buf(), false)
}

/// The copy plan: what goes where, with duplicates reused and name clashes numbered. Folders
/// (roto runs, tracking passes, the notes folders) come first so a file inside one rides along.
pub fn plan(ctx: &Ctx, units: &[Unit]) -> Plan {
    let mut plan = Plan::default();
    let mut seen = HashSet::new();
    let mut claimed: HashMap<String, PathBuf> = HashMap::new();
    let ordered = units.iter().filter(|unit| unit.dir).chain(units.iter().filter(|unit| !unit.dir));
    for unit in ordered {
        if !seen.insert(key_string(&unit.path)) {
            continue;
        }
        if !(if unit.dir { unit.path.is_dir() } else { unit.path.is_file() }) {
            continue;
        }
        if !unit.dir && plan.destination(&unit.path).is_some() {
            continue;
        }
        match decide(ctx, &unit.path, unit.hint) {
            Decision::Keep => {}
            Decision::Leave => plan.left += 1,
            Decision::Transfer { rel, op } => {
                let wanted = ctx.project.join(rel);
                if unit.dir {
                    plan.targets.insert(key_string(&unit.path), wanted.clone());
                    let bytes = files_in(&unit.path).iter().map(|file| file_len(file)).sum();
                    plan.steps.push(Step { from: unit.path.clone(), to: wanted, op, dir: true, bytes });
                    continue;
                }
                let (target, reuse) = settle(&unit.path, &wanted, &claimed);
                plan.targets.insert(key_string(&unit.path), target.clone());
                if reuse {
                    plan.reused += 1;
                } else {
                    claimed.insert(key_string(&target), unit.path.clone());
                    plan.steps.push(Step { from: unit.path.clone(), to: target, op, dir: false, bytes: file_len(&unit.path) });
                }
            }
        }
    }
    plan
}

// ───────────────────────────── running it ─────────────────────────────

#[derive(Debug, Default)]
pub struct Outcome {
    pub copied: usize,
    pub moved: usize,
    pub bytes: u64,
    /// Which steps completed, by index.
    pub done: Vec<bool>,
    pub failures: Vec<String>,
}

struct Meter<'a> {
    done: u64,
    total: u64,
    last: u64,
    label: String,
    report: &'a mut dyn FnMut(u64, u64, &str),
}

impl Meter<'_> {
    fn add(&mut self, bytes: u64) {
        self.done += bytes;
        if self.done - self.last >= 8 * 1024 * 1024 || self.done >= self.total {
            self.last = self.done;
            (self.report)(self.done, self.total, &self.label);
        }
    }
}

fn copy_bytes(from: &Path, to: &Path, meter: &mut Meter) -> Result<(), String> {
    let name = to.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let part = to.with_file_name(format!(".{name}.part"));
    let result = (|| -> std::io::Result<()> {
        let mut source = std::fs::File::open(from)?;
        let mut target = std::fs::File::create(&part)?;
        let mut buffer = vec![0u8; 4 * 1024 * 1024];
        loop {
            let read = source.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            target.write_all(&buffer[..read])?;
            meter.add(read as u64);
        }
        target.flush()?;
        drop(target);
        std::fs::rename(&part, to)
    })();
    if let Err(error) = result {
        let _ignored = std::fs::remove_file(&part);
        return Err(format!("{}: {error}", from.display()));
    }
    Ok(())
}

/// Moves (a rename when it can, else copy then delete) or copies one file. True when it moved.
fn transfer_file(from: &Path, to: &Path, op: Op, meter: &mut Meter) -> Result<bool, String> {
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("cannot create {}: {error}", parent.display()))?;
    }
    if op == Op::Move && std::fs::rename(from, to).is_ok() {
        meter.add(file_len(to));
        return Ok(true);
    }
    copy_bytes(from, to, meter)?;
    if op == Op::Move {
        let _ignored = std::fs::remove_file(from);
        return Ok(true);
    }
    Ok(false)
}

fn remove_empty_dirs(dir: &Path) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                remove_empty_dirs(&entry.path());
            }
        }
    }
    let _ignored = std::fs::remove_dir(dir);
}

/// Merges a folder into `to`: a file already there with the same content is kept, a different
/// one gets a numbered sibling.
fn transfer_tree(from: &Path, to: &Path, op: Op, meter: &mut Meter, outcome: &mut Outcome) -> Result<(), String> {
    for file in files_in(from) {
        let Some(rel) = relative_path(&file, from) else { continue };
        let wanted = to.join(rel);
        let target = if wanted.exists() {
            if same_content(&file, &wanted) {
                meter.add(file_len(&file));
                if op == Op::Move {
                    let _ignored = std::fs::remove_file(&file);
                }
                continue;
            }
            let dir = wanted.parent().map(Path::to_path_buf).unwrap_or_default();
            storage::unique_path(&dir, wanted.file_name().and_then(|n| n.to_str()).unwrap_or("file"))
        } else {
            wanted
        };
        let bytes = file_len(&file);
        if transfer_file(&file, &target, op, meter)? {
            outcome.moved += 1;
        } else {
            outcome.copied += 1;
        }
        outcome.bytes += bytes;
    }
    if op == Op::Move {
        remove_empty_dirs(from);
    }
    Ok(())
}

/// Runs the plan. A step that fails is reported and left out; the rest still happen.
pub fn execute(steps: &[Step], report: &mut dyn FnMut(u64, u64, &str)) -> Outcome {
    let total = steps.iter().map(|step| step.bytes).sum::<u64>().max(1);
    let mut meter = Meter { done: 0, total, last: 0, label: String::new(), report };
    let mut outcome = Outcome::default();
    for step in steps {
        meter.label = step.from.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
        let result = if step.dir {
            transfer_tree(&step.from, &step.to, step.op, &mut meter, &mut outcome)
        } else {
            transfer_file(&step.from, &step.to, step.op, &mut meter).map(|moved| {
                if moved {
                    outcome.moved += 1;
                } else {
                    outcome.copied += 1;
                }
                outcome.bytes += step.bytes;
            })
        };
        match result {
            Ok(()) => outcome.done.push(true),
            Err(error) => {
                outcome.done.push(false);
                outcome.failures.push(error);
            }
        }
    }
    outcome
}

// ───────────────────────────── the file ─────────────────────────────

/// Paths under the project folder become relative to the `.helios`; `extras.relativePaths`
/// records which, so opening resolves exactly those and nothing that merely looks like a path.
pub fn relativize(value: &mut Value, helios_dir: &Path, project: &Path) {
    let mut refs = asset_refs(value.get("assets").unwrap_or(&Value::Null));
    refs.extend(project_refs(value.get("project").unwrap_or(&Value::Null), "/project"));
    let mut pointers = Vec::new();
    for reference in refs {
        let Some(rel) = relative_text(&reference.path, helios_dir, project) else { continue };
        if let Some(slot) = value.pointer_mut(&reference.pointer) {
            *slot = Value::String(rel);
            pointers.push(Value::String(reference.pointer));
        }
    }
    if let Value::Object(map) = value {
        let extras = map.entry("extras").or_insert_with(|| Value::Object(serde_json::Map::new()));
        if !extras.is_object() {
            *extras = Value::Object(serde_json::Map::new());
        }
        extras["relativePaths"] = Value::Array(pointers);
        extras["projectFolder"] = Value::String(project.display().to_string());
    }
}

/// The reverse of [`relativize`], against the folder the `.helios` was opened from.
pub fn resolve(value: &mut Value, helios_dir: &Path) {
    let mut pointers: Vec<String> = value
        .pointer("/extras/relativePaths")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Value::as_str).map(str::to_owned).collect())
        .unwrap_or_default();
    if let Some(assets) = value.get("assets").and_then(Value::as_array) {
        for (index, asset) in assets.iter().enumerate() {
            if asset.get("path").and_then(Value::as_str).is_some_and(is_relative_text) {
                pointers.push(format!("/assets/{index}/path"));
            }
        }
    }
    for pointer in pointers {
        if let Some(slot) = value.pointer_mut(&pointer) {
            if let Some(text) = slot.as_str().filter(|text| is_relative_text(text)) {
                *slot = Value::String(resolve_text(text, helios_dir).display().to_string());
            }
        }
    }
}

/// Opens a `.helios`, with its relative paths made absolute again.
pub fn read(path: &Path) -> Result<Document, String> {
    let document = crate::files::read_document(path)?;
    let helios_dir = path.parent().map(Path::to_path_buf).unwrap_or_default();
    let mut value = serde_json::to_value(&document).map_err(|error| error.to_string())?;
    resolve(&mut value, &helios_dir);
    serde_json::from_value(value).map_err(|error| format!("that is not a Helios project: {error}"))
}

/// Writes a `.helios` with the paths inside its project folder stored relative to it.
pub fn write(path: &Path, document: &Document, project: &Path) -> Result<(), String> {
    crate::files::check_extension(path)?;
    let mut doc = document.clone();
    doc.project.sanitize();
    doc.project.validate_shape()?;
    let mut value = serde_json::to_value(&doc).map_err(|error| error.to_string())?;
    let helios_dir = path.parent().map(Path::to_path_buf).unwrap_or_default();
    relativize(&mut value, &helios_dir, project);
    if !helios_dir.as_os_str().is_empty() {
        std::fs::create_dir_all(&helios_dir).map_err(|error| format!("cannot create {}: {error}", helios_dir.display()))?;
    }
    crate::store::write_json(path, &value)
}

// ───────────────────────────── the AI's notes ─────────────────────────────

/// The assistant files its plans as `todos/<name>.md` (relative): they belong to the project, so
/// they live in its Guidelines folder. Any other path is left alone.
pub fn map_todo(project: &Path, path: &str) -> Option<PathBuf> {
    let given = Path::new(path.trim());
    if given.is_absolute() || path.trim().starts_with(['/', '\\']) {
        return None;
    }
    let mut parts = given.components().filter(|component| !matches!(component, Component::CurDir));
    let Some(Component::Normal(first)) = parts.next() else { return None };
    if !first.to_string_lossy().eq_ignore_ascii_case("todos") {
        return None;
    }
    let rest: PathBuf = parts.collect();
    if rest.components().any(|component| !matches!(component, Component::Normal(_))) {
        return None;
    }
    Some(storage::category_dir(project, Category::Guidelines).join(rest))
}

/// Where an AI file tool's path really points (see [`map_todo`]).
pub fn agent_path(state: &AppState, path: &str) -> String {
    map_todo(&storage::project_dir(state), path).map_or_else(|| path.to_owned(), |mapped| mapped.display().to_string())
}

/// The same for reading: a note written before notes moved into projects is still found.
pub fn agent_path_existing(state: &AppState, path: &str) -> String {
    let mapped = agent_path(state, path);
    if mapped != path && !Path::new(&mapped).exists() && Path::new(path).exists() {
        return path.to_owned();
    }
    mapped
}

fn is_doc(path: &Path) -> bool {
    path.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| DOC_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
}

/// Tells the Project panel a document changed.
pub fn notify_if_doc(app: &AppHandle, path: &str) {
    if is_doc(Path::new(path)) {
        let _ignored = app.emit(DOCS_EVENT, ());
    }
}

/// Folders the assistant wrote notes to before they were filed per project.
fn legacy_note_dirs(state: &AppState) -> Vec<PathBuf> {
    let mut dirs = vec![state.paths.agent_workspace.join("todos")];
    if let Ok(cwd) = std::env::current_dir() {
        dirs.insert(0, cwd.join("todos"));
    }
    dirs
}

const DOC_CATEGORIES: [Category; 3] = [Category::Guidelines, Category::Storyboard, Category::Research];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocEntry {
    name: String,
    path: String,
    /// "Guidelines", "Storyboard", "Research" — or "Workspace notes" for older notes.
    folder: String,
    /// Under the project folder, `/`-separated (the file name for older notes).
    relative: String,
    size: u64,
    modified: u64,
    legacy: bool,
}

fn doc_entry(path: &Path, folder: &str, relative: String, legacy: bool) -> DocEntry {
    let meta = std::fs::metadata(path).ok();
    let modified = meta.as_ref().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs());
    DocEntry {
        name: path.file_name().map_or_else(|| "?".into(), |name| name.to_string_lossy().into_owned()),
        path: path.display().to_string(),
        folder: folder.to_owned(),
        relative,
        size: meta.map_or(0, |m| m.len()),
        modified,
        legacy,
    }
}

fn list_docs(state: &AppState) -> Vec<DocEntry> {
    let project = storage::project_dir(state);
    let mut docs = Vec::new();
    for category in DOC_CATEGORIES {
        let dir = storage::category_dir(&project, category);
        let mut files: Vec<PathBuf> = files_in(&dir).into_iter().filter(|file| is_doc(file)).take(500).collect();
        files.sort();
        for file in files {
            let rel = relative_path(&file, &project).map(|rel| slash_join(&rel)).unwrap_or_default();
            docs.push(doc_entry(&file, category.relative(), rel, false));
        }
    }
    let guidelines = storage::category_dir(&project, Category::Guidelines);
    for dir in legacy_note_dirs(state) {
        if within(&dir, &guidelines) || !dir.is_dir() {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten().take(500) {
            let path = entry.path();
            if path.is_file() && is_doc(&path) {
                let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                docs.push(doc_entry(&path, "Workspace notes", name, true));
            }
        }
    }
    let order = |folder: &str| DOC_CATEGORIES.iter().position(|c| c.relative() == folder).unwrap_or(DOC_CATEGORIES.len());
    docs.sort_by(|a, b| order(&a.folder).cmp(&order(&b.folder)).then(b.modified.cmp(&a.modified)));
    docs
}

/// The open project's documents: guidelines, plans, storyboards and research notes.
#[tauri::command]
pub async fn project_docs(state: State<'_, Arc<AppState>>) -> Result<Vec<DocEntry>, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || list_docs(&state)).await.map_err(|error| error.to_string())
}

/// One document's text, for the viewer.
#[tauri::command]
pub fn project_doc_read(path: String) -> Result<String, String> {
    let file = Path::new(&path);
    if !is_doc(file) {
        return Err("only Markdown and text documents open here".to_owned());
    }
    let meta = std::fs::metadata(file).map_err(|_| "that document is not there any more — was it deleted?".to_owned())?;
    if meta.len() > 8 * 1024 * 1024 {
        return Err("that document is too large to show".to_owned());
    }
    let bytes = std::fs::read(file).map_err(|error| format!("cannot read it: {error}"))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// A document file name from a free-text title: safe, with `.md` unless it already has a
/// document extension.
pub fn doc_file_name(name: &str) -> String {
    let trimmed = name.trim();
    let (stem, ext) = match Path::new(trimmed).extension().and_then(|ext| ext.to_str()) {
        Some(ext) if DOC_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()) => (&trimmed[..trimmed.len() - ext.len() - 1], ext.to_ascii_lowercase()),
        _ => (trimmed, "md".to_owned()),
    };
    format!("{}.{ext}", storage::sanitize(stem))
}

fn doc_dir(project: &Path, category: &str) -> Result<PathBuf, String> {
    let category = Category::parse(category).filter(|c| DOC_CATEGORIES.contains(c)).ok_or_else(|| format!("documents go in guidelines, storyboard or research, not {category}"))?;
    Ok(storage::category_dir(project, category))
}

/// Writes (or replaces) a document in the open project's Guidelines, Storyboard or Research folder.
#[tauri::command]
pub fn project_doc_write(app: AppHandle, state: State<'_, Arc<AppState>>, category: String, name: String, content: String) -> Result<String, String> {
    let dir = doc_dir(&storage::project_dir(&state), &category)?;
    std::fs::create_dir_all(&dir).map_err(|error| format!("cannot create {}: {error}", dir.display()))?;
    let path = dir.join(doc_file_name(&name));
    std::fs::write(&path, content).map_err(|error| format!("cannot write {}: {error}", path.display()))?;
    let _ignored = app.emit(DOCS_EVENT, ());
    Ok(path.display().to_string())
}

/// Deletes a document of the open project (or an older workspace note) — nothing else.
#[tauri::command]
pub fn project_doc_delete(app: AppHandle, state: State<'_, Arc<AppState>>, path: String) -> Result<(), String> {
    let file = normalize(Path::new(&path));
    let project = storage::project_dir(&state);
    let allowed = is_doc(&file)
        && (DOC_CATEGORIES.iter().any(|category| within(&file, &storage::category_dir(&project, *category)))
            || legacy_note_dirs(&state).iter().any(|dir| file.parent().is_some_and(|parent| key(parent) == key(dir))));
    if !allowed {
        return Err("only the project's own documents can be deleted here".to_owned());
    }
    std::fs::remove_file(&file).map_err(|_| "that document is not there any more".to_owned())?;
    let _ignored = app.emit(DOCS_EVENT, ());
    Ok(())
}

/// The library entries whose file is gone (deleted or moved in Explorer). Cheap — one stat per
/// file — so the UI can ask whenever the window comes back and only reload when it changed.
#[tauri::command]
pub async fn library_missing(state: State<'_, Arc<AppState>>) -> Result<Vec<String>, String> {
    let paths: Vec<(String, String)> = state.library.lock().map_err(crate::lock_error)?.iter().map(|asset| (asset.id.clone(), asset.path.clone())).collect();
    tauri::async_runtime::spawn_blocking(move || paths.into_iter().filter(|(_, path)| !Path::new(path).is_file()).map(|(id, _)| id).collect())
        .await
        .map_err(|error| error.to_string())
}

// ───────────────────────────── save ─────────────────────────────

/// A document the UI wants filed with the save (a comp's storyboard as Markdown).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocFile {
    pub category: String,
    pub name: String,
    pub content: String,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Rewrite {
    pub from: String,
    pub to: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveReport {
    path: String,
    project_folder: String,
    /// Old path → new path, for the paths inside the project the UI holds.
    rewrites: Vec<Rewrite>,
    copied: usize,
    moved: usize,
    reused: usize,
    /// Imported originals left where they are.
    left: usize,
    bytes: u64,
    failures: Vec<String>,
}

/// Whether a folder holds a saved project (a `.helios` in `Project/` that is not the autosave).
fn holds_saved_project(folder: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(storage::category_dir(folder, Category::Project)) else { return false };
    entries.flatten().any(|entry| {
        let name = entry.file_name().to_string_lossy().to_lowercase();
        name.ends_with(".helios") && !name.ends_with("(autosave).helios")
    })
}

/// The files a project uses, as units to collect.
fn units_for(state: &AppState, ctx: &Ctx, value: &Value, refs: &[Ref]) -> Vec<Unit> {
    let mut units = Vec::new();
    if let Some(previous) = &ctx.previous {
        for category in DOC_CATEGORIES {
            let dir = storage::category_dir(previous, category);
            if dir.is_dir() {
                units.push(Unit { path: dir, hint: Hint::Note, dir: true });
            }
        }
    }
    for reference in refs {
        match reference.hint {
            Hint::Roto => {
                if let Some(run) = reference.path.parent() {
                    units.push(Unit { path: run.to_path_buf(), hint: Hint::Roto, dir: true });
                }
            }
            hint => units.push(Unit { path: reference.path.clone(), hint, dir: false }),
        }
    }
    if let Some(assets) = value.get("assets").and_then(Value::as_array) {
        for id in assets.iter().filter_map(|asset| asset.get("id").and_then(Value::as_str)) {
            if id.is_empty() || id.contains(['/', '\\', '.']) {
                continue;
            }
            let dir = state.tracking_root(id).join(id);
            if dir.is_dir() {
                units.push(Unit { path: dir, hint: Hint::Tracking, dir: true });
            }
        }
    }
    // A production's todo list, written as `todos/…` before the project had a folder of its own.
    if let Some(comps) = value.pointer("/project/comps").and_then(Value::as_array) {
        let bases: Vec<PathBuf> = std::env::current_dir().into_iter().chain([state.paths.agent_workspace.clone()]).collect();
        for todo in comps.iter().filter_map(|comp| comp.pointer("/production/todoPath").and_then(Value::as_str)) {
            if is_relative_text(todo) {
                if let Some(found) = bases.iter().map(|base| base.join(todo)).find(|path| path.is_file()) {
                    units.push(Unit { path: found, hint: Hint::Note, dir: false });
                }
            }
        }
    }
    units
}

/// Copies the built-in effects the project uses into Audio/SFX, so they can be found there too
/// (the project keeps playing them from the app's own copies).
fn file_builtin_sfx(state: &AppState, document: &Document, project: &Path) {
    let mut kinds = HashSet::new();
    for comp in &document.project.comps {
        for clip in &comp.clips {
            if let crate::project::ClipSource::Sfx { kind } = &clip.source {
                kinds.insert(*kind);
            }
        }
    }
    if kinds.is_empty() {
        return;
    }
    let dir = storage::category_dir(project, Category::Sfx);
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    for kind in kinds {
        let source = crate::sfx::path_for(&state.paths.sfx, kind);
        let target = dir.join(format!("{}.wav", kind.as_str()));
        if source.is_file() && !target.exists() {
            let _ignored = std::fs::copy(&source, &target);
        }
    }
}

fn human_bytes(bytes: u64) -> String {
    let mb = bytes as f64 / (1024.0 * 1024.0);
    if mb >= 1024.0 { format!("{:.2} GB", mb / 1024.0) } else { format!("{mb:.1} MB") }
}

/// What a Save As refuses before it plans, creates or moves anything: a project the autosave
/// would refuse too must not first carry the work folder's files off to the new place.
fn check_document(file: &Path, document: &Document) -> Result<(), String> {
    crate::files::check_extension(file)?;
    let mut probe = document.project.clone();
    probe.sanitize();
    probe.validate_shape()
}

/// Save / Save As: gathers every file the project uses into the folder the `.helios` owns,
/// points the project (and, for Save / Save As, the library) at the gathered copies, files the
/// UI's documents, and writes the `.helios` with relative paths. `keep_path` is false for "Save
/// a copy", which copies only and leaves the open session as it was.
#[tauri::command]
pub async fn project_file_save(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    path: String,
    document: Document,
    keep_path: bool,
    docs: Option<Vec<DocFile>>,
) -> Result<SaveReport, String> {
    let file = PathBuf::from(&path);
    check_document(&file, &document)?;
    let project_folder = storage::saved_folder(&file).ok_or("choose a folder to save the project in")?;
    let state = state.inner().clone();
    let settings = state.settings();
    let previous = storage::project_dir(&state);
    let separate = !within(&previous, &project_folder) || !within(&project_folder, &previous);
    let mut skip = vec![state.paths.sfx.clone(), state.paths.models.clone(), state.paths.proxies.clone()];
    if let Some(install) = std::env::current_exe().ok().and_then(|exe| exe.parent().map(Path::to_path_buf)) {
        skip.push(install);
    }
    let ctx = Ctx {
        project: project_folder.clone(),
        move_previous: separate && keep_path && settings.project_path.is_none() && !holds_saved_project(&previous),
        previous: separate.then_some(previous),
        storage_root: storage::root(&state),
        app_data: state.paths.root.clone(),
        movable: vec![state.paths.work.clone(), state.paths.agent_workspace.clone(), std::env::temp_dir()],
        skip,
        copy_imports: settings.copy_imports == Some(true),
        allow_move: keep_path,
    };
    std::fs::create_dir_all(&project_folder).map_err(|error| format!("cannot create {}: {error}", project_folder.display()))?;

    let mut value = serde_json::to_value(&document).map_err(|error| error.to_string())?;
    let mut refs = asset_refs(value.get("assets").unwrap_or(&Value::Null));
    refs.extend(project_refs(value.get("project").unwrap_or(&Value::Null), "/project"));
    let units = units_for(&state, &ctx, &value, &refs);
    let planned = {
        let ctx = ctx.clone();
        tauri::async_runtime::spawn_blocking(move || plan(&ctx, &units)).await.map_err(|error| error.to_string())?
    };

    // The copying runs off the async runtime, with a progress job the status bar shows.
    let steps = planned.steps.clone();
    let outcome = if steps.is_empty() {
        Outcome::default()
    } else {
        let folder_name = project_folder.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let job = state.jobs.start("collect", format!("Collecting files into {folder_name}"), false);
        tauri::async_runtime::spawn_blocking(move || {
            let outcome = execute(&steps, &mut |done, total, name| {
                job.progress(done as f64 / total as f64, format!("Saving {name} · {} of {}", human_bytes(done), human_bytes(total)));
            });
            let message = format!("{} file(s) gathered · {}", outcome.copied + outcome.moved, human_bytes(outcome.bytes));
            if outcome.failures.is_empty() {
                job.done(message, None);
            } else {
                job.fail(format!("{message} · {} could not be copied", outcome.failures.len()));
            }
            outcome
        })
        .await
        .map_err(|error| error.to_string())?
    };

    // Point every reference at where its file now is (skipping steps that failed).
    let failed: Vec<&Step> = planned.steps.iter().zip(&outcome.done).filter(|(_, ok)| !**ok).map(|(step, _)| step).collect();
    let mut rewrites: Vec<Rewrite> = Vec::new();
    let mut moved_assets: Vec<(String, String)> = Vec::new();
    for reference in &refs {
        let Some(target) = planned.destination(&reference.path) else { continue };
        if failed.iter().any(|step| within(&reference.path, &step.from)) {
            continue;
        }
        let new_path = target.display().to_string();
        let old_path = reference.path.display().to_string();
        if new_path == old_path {
            continue;
        }
        if let Some(slot) = value.pointer_mut(&reference.pointer) {
            *slot = Value::String(new_path.clone());
        }
        if let Some(index) = reference.pointer.strip_prefix("/assets/").and_then(|rest| rest.strip_suffix("/path")) {
            if let Some(id) = value.pointer(&format!("/assets/{index}/id")).and_then(Value::as_str) {
                moved_assets.push((id.to_owned(), new_path.clone()));
            }
        }
        if !rewrites.iter().any(|entry| entry.from == old_path) {
            rewrites.push(Rewrite { from: old_path, to: new_path });
        }
    }
    let saved: Document = serde_json::from_value(value).map_err(|error| error.to_string())?;

    let _ignored = app.asset_protocol_scope().allow_directory(&project_folder, true);
    if keep_path && !moved_assets.is_empty() {
        let changed: Vec<crate::library::Asset> = {
            let mut items = state.library.lock().map_err(crate::lock_error)?;
            let mut changed = Vec::new();
            for (id, new_path) in &moved_assets {
                if let Some(asset) = items.iter_mut().find(|asset| &asset.id == id) {
                    asset.path = new_path.clone();
                    asset.missing = false;
                    changed.push(asset.clone());
                }
            }
            state.save_library(&items)?;
            changed
        };
        for asset in &changed {
            crate::allow_asset(&app, asset);
        }
        let _ignored = app.emit(crate::library::LIBRARY_EVENT, ());
    }

    file_builtin_sfx(&state, &saved, &project_folder);
    let mut wrote_docs = false;
    for doc in docs.unwrap_or_default().into_iter().take(200) {
        let Ok(dir) = doc_dir(&project_folder, &doc.category) else { continue };
        let target = dir.join(doc_file_name(&doc.name));
        if std::fs::read_to_string(&target).is_ok_and(|current| current == doc.content) {
            continue;
        }
        if std::fs::create_dir_all(&dir).is_ok() && std::fs::write(&target, &doc.content).is_ok() {
            wrote_docs = true;
        }
    }
    if wrote_docs || planned.steps.iter().any(|step| step.dir) {
        let _ignored = app.emit(DOCS_EVENT, ());
    }

    write(&file, &saved, &project_folder)?;
    Ok(SaveReport {
        path: file.display().to_string(),
        project_folder: project_folder.display().to_string(),
        rewrites,
        copied: outcome.copied,
        moved: outcome.moved,
        reused: planned.reused,
        left: planned.left,
        bytes: outcome.bytes,
        failures: outcome.failures,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("helios-bundle-{name}-{}", crate::store::new_id()));
        std::fs::create_dir_all(&dir).expect("dir");
        dir
    }

    fn put(path: &Path, bytes: &[u8]) {
        std::fs::create_dir_all(path.parent().expect("parent")).expect("dir");
        std::fs::write(path, bytes).expect("write");
    }

    #[test]
    fn bundle_paths_relativise_beside_the_file_and_one_level_up() {
        let base = temp("rel");
        // <folder>/Project/x.helios: the media is one level up.
        let folder = base.join("Launch");
        let helios_dir = folder.join("Project");
        let clip = folder.join("Downloads").join("clip one.mp4");
        assert_eq!(relative_text(&clip, &helios_dir, &folder).as_deref(), Some("../Downloads/clip one.mp4"));
        assert_eq!(resolve_text("../Downloads/clip one.mp4", &helios_dir), normalize(&clip));
        // <dir>/film.helios with "film Files" beside it.
        let files = base.join("film Files");
        let image = files.join("Generated").join("Images").join("a.png");
        assert_eq!(relative_text(&image, &base, &files).as_deref(), Some("film Files/Generated/Images/a.png"));
        assert_eq!(resolve_text("film Files/Generated/Images/a.png", &base), normalize(&image));
        // Outside both: stays absolute.
        let elsewhere = std::env::temp_dir().join("elsewhere.mp4");
        assert_eq!(relative_text(&elsewhere, &helios_dir, &folder), None);
        assert!(is_relative_text("../a.mp4") && is_relative_text("film Files/a.png"));
        assert!(!is_relative_text("C:\\a.mp4") && !is_relative_text("/a.mp4") && !is_relative_text("\\\\server\\a.mp4"));
        assert!(within(&clip, &folder) && !within(&folder, &clip));
        let _ignored = std::fs::remove_dir_all(base);
    }

    #[test]
    fn bundle_documents_round_trip_through_relative_paths() {
        let base = temp("doc");
        let folder = base.join("Launch");
        let helios_dir = folder.join("Project");
        let clip = folder.join("Downloads").join("clip.mp4");
        let matte = folder.join("Roto").join("run1").join("matte.mp4");
        let outside = base.join("camera.mp4");
        let mut value = json!({
            "format": "helios",
            "assets": [{ "id": "a", "kind": "video", "path": clip.display().to_string() }, { "id": "b", "kind": "video", "path": outside.display().to_string() }],
            "project": { "comps": [{ "clips": [{ "rotoMatte": matte.display().to_string(), "source": { "type": "text", "text": clip.display().to_string() } }] }] }
        });
        relativize(&mut value, &helios_dir, &folder);
        assert_eq!(value["assets"][0]["path"], "../Downloads/clip.mp4");
        assert_eq!(value["assets"][1]["path"], outside.display().to_string());
        assert_eq!(value["project"]["comps"][0]["clips"][0]["rotoMatte"], "../Roto/run1/matte.mp4");
        // Words that look like a path are not paths.
        assert_eq!(value["project"]["comps"][0]["clips"][0]["source"]["text"], clip.display().to_string());
        assert_eq!(value["extras"]["relativePaths"].as_array().map(Vec::len), Some(2));

        // The folder moved somewhere else entirely: paths follow the file.
        let moved = base.join("Archive").join("Launch").join("Project");
        resolve(&mut value, &moved);
        assert_eq!(value["assets"][0]["path"], normalize(&base.join("Archive").join("Launch").join("Downloads").join("clip.mp4")).display().to_string());
        assert_eq!(value["project"]["comps"][0]["clips"][0]["rotoMatte"], normalize(&base.join("Archive").join("Launch").join("Roto").join("run1").join("matte.mp4")).display().to_string());
        let _ignored = std::fs::remove_dir_all(base);
    }

    #[test]
    fn bundle_finds_paths_by_shape_and_hints_their_category() {
        let base = temp("refs");
        let thumb = base.join("s1.png");
        let matte = base.join("run").join("matte.mp4");
        let project = json!({ "comps": [{ "storyboard": [{ "thumbnail": thumb.display().to_string(), "visual": thumb.display().to_string() }], "clips": [{ "rotoMatte": matte.display().to_string() }], "name": "not/a/path" }] });
        let refs = project_refs(&project, "/project");
        assert_eq!(refs.len(), 2, "{refs:?}");
        assert!(refs.iter().any(|r| r.hint == Hint::Storyboard && r.pointer == "/project/comps/0/storyboard/0/thumbnail"));
        assert!(refs.iter().any(|r| r.hint == Hint::Roto && r.pointer == "/project/comps/0/clips/0/rotoMatte"));
        let assets = json!([{ "kind": "audio", "path": "x.wav" }]);
        assert_eq!(asset_refs(&assets)[0].hint, Hint::Audio);
        let _ignored = std::fs::remove_dir_all(base);
    }

    fn ctx(base: &Path) -> Ctx {
        Ctx {
            project: base.join("Saved").join("Launch"),
            previous: Some(base.join("Root").join("Untitled project")),
            move_previous: true,
            storage_root: base.join("Root"),
            app_data: base.join("AppData"),
            movable: vec![base.join("AppData").join("work")],
            skip: vec![base.join("AppData").join("sfx")],
            copy_imports: false,
            allow_move: true,
        }
    }

    #[test]
    fn bundle_decides_what_moves_copies_or_stays() {
        let base = temp("decide");
        let c = ctx(&base);
        let transfer = |rel: &str, op| Decision::Transfer { rel: rel.split('/').collect(), op };
        assert_eq!(decide(&c, &c.project.join("Downloads").join("a.mp4"), Hint::Video), Decision::Keep);
        // The unsaved project's own folder moves, keeping its layout.
        assert_eq!(decide(&c, &base.join("Root/Untitled project/Downloads/a.mp4"), Hint::Video), transfer("Downloads/a.mp4", Op::Move));
        // Another project's category folder is copied into the same category.
        assert_eq!(decide(&c, &base.join("Root/Other/Generated/Images/x/cat.png"), Hint::Image), transfer("Generated/Images/x/cat.png", Op::Copy));
        // A user folder that happens to sit under the root is an import, not a project's file.
        assert_eq!(decide(&c, &base.join("Root/Raw/b.mp4"), Hint::Video), Decision::Leave);
        // Scratch moves; other app data copies; built-ins stay.
        assert_eq!(decide(&c, &base.join("AppData/work/j1/out.mp4"), Hint::Video), transfer("Generated/Video/out.mp4", Op::Move));
        assert_eq!(decide(&c, &base.join("AppData/storyboard/s.png"), Hint::Storyboard), transfer("Storyboard/s.png", Op::Copy));
        assert_eq!(decide(&c, &base.join("AppData/roto/run1"), Hint::Roto), transfer("Roto/run1", Op::Copy));
        assert_eq!(decide(&c, &base.join("AppData/sfx/whoosh.wav"), Hint::Audio), Decision::Leave);
        // Imported originals follow "copy imports"; AI notes are always gathered.
        assert_eq!(decide(&c, &base.join("Videos/camera.mp4"), Hint::Video), Decision::Leave);
        assert_eq!(decide(&Ctx { copy_imports: true, ..c.clone() }, &base.join("Videos/camera.mp4"), Hint::Video), transfer("Footage/camera.mp4", Op::Copy));
        assert_eq!(decide(&c, &base.join("repo/todos/todo-plan.md"), Hint::Note), transfer("Guidelines/todo-plan.md", Op::Copy));
        // "Save a copy" never moves.
        assert_eq!(decide(&Ctx { allow_move: false, ..c.clone() }, &base.join("AppData/work/j1/out.mp4"), Hint::Video), transfer("Generated/Video/out.mp4", Op::Copy));
        let _ignored = std::fs::remove_dir_all(base);
    }

    #[test]
    fn bundle_plans_reuse_duplicates_number_clashes_and_run_folders() {
        let base = temp("plan");
        let c = ctx(&base);
        let a = base.join("AppData/work/j1/shot.mp4");
        let same = base.join("AppData/work/j2/shot.mp4");
        let different = base.join("AppData/work/j3/shot.mp4");
        put(&a, b"one");
        put(&same, b"one");
        put(&different, b"two!");
        // Already in the project with the same content: reused, not copied again.
        let existing = base.join("AppData/work/j4/logo.png");
        put(&existing, b"logo");
        put(&c.project.join("Generated/Images/logo.png"), b"logo");
        // A roto run folder, and a file inside it referenced on its own.
        let run = base.join("AppData/roto/run1");
        put(&run.join("matte.mp4"), b"matte");
        put(&run.join("mattes/0001.png"), b"m");
        let units = vec![
            Unit { path: a.clone(), hint: Hint::Video, dir: false },
            Unit { path: same.clone(), hint: Hint::Video, dir: false },
            Unit { path: different.clone(), hint: Hint::Video, dir: false },
            Unit { path: a.clone(), hint: Hint::Video, dir: false },
            Unit { path: existing.clone(), hint: Hint::Image, dir: false },
            Unit { path: run.join("matte.mp4"), hint: Hint::Video, dir: false },
            Unit { path: run.clone(), hint: Hint::Roto, dir: true },
            Unit { path: base.join("missing.mp4"), hint: Hint::Video, dir: false },
        ];
        let planned = plan(&c, &units);
        let video = c.project.join("Generated/Video");
        assert_eq!(planned.destination(&a), Some(video.join("shot.mp4")));
        assert_eq!(planned.destination(&same), Some(video.join("shot.mp4")), "identical content is reused");
        assert_eq!(planned.destination(&different), Some(video.join("shot (2).mp4")), "a clash is numbered");
        assert_eq!(planned.destination(&existing), Some(c.project.join("Generated/Images/logo.png")));
        assert_eq!(planned.destination(&run.join("matte.mp4")), Some(c.project.join("Roto/run1/matte.mp4")));
        assert_eq!(planned.reused, 2);
        assert_eq!(planned.steps.len(), 3, "{:?}", planned.steps);

        let mut ticks = 0;
        let outcome = execute(&planned.steps, &mut |_, _, _| ticks += 1);
        assert!(outcome.failures.is_empty(), "{:?}", outcome.failures);
        assert!(ticks > 0);
        assert_eq!(std::fs::read(video.join("shot.mp4")).expect("moved"), b"one");
        assert_eq!(std::fs::read(video.join("shot (2).mp4")).expect("moved"), b"two!");
        assert!(!a.exists(), "scratch files move");
        assert!(same.exists(), "a reused duplicate is left alone");
        assert!(c.project.join("Roto/run1/mattes/0001.png").is_file());
        assert!(run.join("matte.mp4").is_file(), "app-data runs are copied, not moved");
        let _ignored = std::fs::remove_dir_all(base);
    }

    #[test]
    fn bundle_merges_folders_without_clobbering() {
        let base = temp("merge");
        let from = base.join("from");
        let to = base.join("to");
        put(&from.join("plan.md"), b"new plan");
        put(&from.join("same.md"), b"same");
        put(&to.join("plan.md"), b"old plan");
        put(&to.join("same.md"), b"same");
        let steps = vec![Step { from: from.clone(), to: to.clone(), op: Op::Move, dir: true, bytes: 12 }];
        let outcome = execute(&steps, &mut |_, _, _| {});
        assert!(outcome.failures.is_empty());
        assert_eq!(std::fs::read(to.join("plan.md")).expect("kept"), b"old plan");
        assert_eq!(std::fs::read(to.join("plan (2).md")).expect("numbered"), b"new plan");
        assert!(!from.exists(), "a moved folder is cleaned up");
        let _ignored = std::fs::remove_dir_all(base);
    }

    #[test]
    fn bundle_writes_relative_files_that_open_absolute() {
        let base = temp("write");
        let folder = base.join("Launch");
        let clip = folder.join("Downloads").join("clip.mp4");
        put(&clip, b"x");
        let mut document = Document { format: "helios".to_owned(), version: 3, saved_at: "now".to_owned(), project: crate::project::Project::default(), assets: Vec::new(), extras: None };
        let asset: crate::library::Asset = serde_json::from_value(json!({
            "id": "a1", "name": "clip.mp4", "path": clip.display().to_string(), "kind": "video", "duration": 1.0, "width": 16, "height": 9,
            "fps": 30.0, "hasAudio": false, "videoCodec": null, "audioCodec": null, "size": 1, "importedAt": "2026-01-01T00:00:00Z",
            "thumbnail": null, "filmstrip": null, "waveform": null, "proxy": null, "preview": "native"
        }))
        .expect("asset");
        document.assets.push(asset);
        let file = folder.join("Project").join("Launch.helios");
        write(&file, &document, &folder).expect("write");
        let text = std::fs::read_to_string(&file).expect("read");
        assert!(text.contains("../Downloads/clip.mp4"), "{text}");
        let opened = read(&file).expect("open");
        assert_eq!(Path::new(&opened.assets[0].path), normalize(&clip));
        let _ignored = std::fs::remove_dir_all(base);
    }

    #[test]
    fn bundle_save_as_refuses_a_bad_project_before_moving_anything() {
        use crate::project::fixtures::{clip, comp, project};
        let base = temp("refuse");
        let planted = base.join("work").join("mogrt").join("frame.png");
        put(&planted, b"png");
        let mut bad = clip("c1", "v1", 0.0, 2.0, crate::project::ClipSource::Media { asset_id: "a1".to_owned() });
        bad.transform.scale = 1e9;
        let mut document = Document { format: "helios".to_owned(), version: 3, saved_at: "now".to_owned(), project: project(vec![comp("main", vec![bad])]), assets: Vec::new(), extras: None };
        let file = base.join("Launch").join("Launch.helios");
        assert!(check_document(&file, &document).expect_err("out of range").contains("transform"));
        assert!(planted.is_file(), "nothing was moved");
        assert!(!base.join("Launch").exists(), "nothing was created");
        document.project.comps[0].clips[0].transform.scale = 100.0;
        assert!(check_document(&file, &document).is_ok());
        let _ignored = std::fs::remove_dir_all(base);
    }

    #[test]
    fn bundle_files_the_assistants_todos_in_guidelines() {
        let project = Path::new("/p");
        assert_eq!(map_todo(project, "todos/todo-plan.md"), Some(project.join("Guidelines").join("todo-plan.md")));
        assert_eq!(map_todo(project, "./todos/sub/x.md"), Some(project.join("Guidelines").join("sub").join("x.md")));
        assert_eq!(map_todo(project, "notes/x.md"), None);
        assert_eq!(map_todo(project, "todos/../secret.md"), None);
        assert_eq!(map_todo(project, "/abs/todos/x.md"), None);
        assert_eq!(doc_file_name("Crimson: style guide"), "Crimson style guide.md");
        assert_eq!(doc_file_name("plan.MD"), "plan.md");
    }
}
