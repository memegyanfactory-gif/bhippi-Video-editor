//! References: films the editor points at and says "like this".
//!
//! A reference is only useful if it survives the conversation it was mentioned in, so each one is
//! taken apart once and kept: contact sheets through the opening and across the whole film, the
//! palette it actually uses, where its cuts fall and how fast they come. That much is measured,
//! not described, and it is what the assistant is handed when the editor says `/ref 1`.
//!
//! The written part — what the hook does, how the type behaves — is a note on the entry. It can
//! come from the editor or from a model that has looked at the sheets; either way it is stored as
//! prose beside the measurements rather than mixed into them.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reference {
    pub id: String,
    /// What the editor calls it: `1`, `2`, or a name they gave it.
    pub name: String,
    /// The file it was read from, kept so the sheets can be rebuilt.
    pub source: String,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub seconds: f64,
    /// Where the cuts fall, in seconds. The rhythm of a film is most of its feel.
    pub cuts: Vec<f64>,
    /// Seconds between cuts, on average, across the whole film.
    pub cut_every: f64,
    /// The colours it is made of, most used first.
    pub palette: Vec<String>,
    /// Contact sheets: the opening at four frames a second, then one frame per ten seconds.
    pub sheets: Vec<String>,
    /// What it is a reference *for*, in the editor's or a model's words.
    pub notes: String,
    /// A style pack this reference was turned into, when one exists.
    pub pack: Option<String>,
    pub added_at: String,
}

pub fn dir(root: &Path) -> PathBuf {
    root.join("refs")
}

pub fn list(root: &Path) -> Vec<Reference> {
    let Ok(entries) = std::fs::read_dir(dir(root)) else {
        return Vec::new();
    };
    let mut out: Vec<Reference> = entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| std::fs::read_to_string(entry.path().join("ref.json")).ok())
        .filter_map(|text| serde_json::from_str::<Reference>(&text).ok())
        .collect();
    // Named `1`, `2`, … first and in order; anything else after, alphabetically.
    out.sort_by(|a, b| match (a.name.parse::<u32>(), b.name.parse::<u32>()) {
        (Ok(one), Ok(two)) => one.cmp(&two),
        (Ok(_), Err(_)) => std::cmp::Ordering::Less,
        (Err(_), Ok(_)) => std::cmp::Ordering::Greater,
        (Err(_), Err(_)) => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    out
}

pub fn read(root: &Path, id: &str) -> Option<Reference> {
    let text = std::fs::read_to_string(dir(root).join(id).join("ref.json")).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn write(root: &Path, reference: &Reference) -> Result<(), String> {
    let folder = dir(root).join(&reference.id);
    std::fs::create_dir_all(&folder).map_err(|error| format!("cannot make the reference folder: {error}"))?;
    let text = serde_json::to_string_pretty(reference).map_err(|error| format!("cannot write the reference: {error}"))?;
    std::fs::write(folder.join("ref.json"), text).map_err(|error| format!("cannot write the reference: {error}"))
}

/// Saves a project guideline / reference directly into the reference library.
pub fn save_guideline(
    root: &Path,
    name: Option<String>,
    notes: String,
    palette: Vec<String>,
    pack: Option<String>,
    source: Option<String>,
) -> Result<Reference, String> {
    let id = crate::store::new_id();
    let name_str = name.unwrap_or_else(|| next_name(root));
    let reference = Reference {
        id,
        name: name_str,
        source: source.unwrap_or_else(|| "project-guideline".to_owned()),
        width: 1920,
        height: 1080,
        fps: 30.0,
        seconds: 0.0,
        cuts: Vec::new(),
        cut_every: 0.0,
        palette,
        sheets: Vec::new(),
        notes,
        pack,
        added_at: chrono::Utc::now().to_rfc3339(),
    };
    write(root, &reference)?;
    Ok(reference)
}

pub fn remove(root: &Path, id: &str) -> Result<(), String> {
    std::fs::remove_dir_all(dir(root).join(id)).map_err(|error| format!("cannot remove the reference: {error}"))
}

/// The next free number, so a reference dropped in the chat is `1`, then `2`, without being asked.
pub fn next_name(root: &Path) -> String {
    let used: Vec<u32> = list(root).iter().filter_map(|item| item.name.parse().ok()).collect();
    (1..).find(|number| !used.contains(number)).unwrap_or(1).to_string()
}

/// Where a film's cuts fall, from FFmpeg's own scene detection.
async fn find_cuts(ffmpeg: &Path, source: &str) -> Vec<f64> {
    // Scaled down first: the score is about change, not detail, and this is many times faster.
    let filter = "scale=320:-2,select='gt(scene,0.35)',metadata=print:file=-";
    let args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-i", source, "-vf", filter, "-an", "-f", "null", "-"];
    let Ok(output) = crate::tools::run(ffmpeg, &args, None).await else {
        return Vec::new();
    };
    output
        .lines()
        .filter_map(|line| line.split("pts_time:").nth(1))
        .filter_map(|value| value.trim().parse::<f64>().ok())
        .collect()
}

/// Takes a film apart and files it. Everything here is measured; the words come later.
pub async fn ingest(
    tools: &crate::tools::Tools,
    root: &Path,
    source: &str,
    name: Option<String>,
    notes: String,
    report: impl Fn(f64, &str),
) -> Result<Reference, String> {
    let ffmpeg = tools.ffmpeg()?;
    let path = Path::new(source);
    if !path.is_file() {
        return Err(format!("there is no file at {source}"));
    }
    report(0.05, "Reading the file");
    let probe = crate::library::probe_file(tools, path).await?;
    let seconds = probe.duration.max(0.1);

    let id = crate::store::new_id();
    let folder = dir(root).join(&id);
    std::fs::create_dir_all(&folder).map_err(|error| format!("cannot make the reference folder: {error}"))?;

    // The opening, close enough together to read a hook beat by beat.
    report(0.2, "Reading the opening");
    let mut sheets = Vec::new();
    let opening = folder.join("opening.jpg").display().to_string();
    let hook_seconds = seconds.min(8.0);
    let hook_args = [
        "-hide_banner", "-loglevel", "error", "-y", "-nostdin",
        "-t", &format!("{hook_seconds:.3}"),
        "-i", source,
        "-vf", "fps=4,scale=320:-2,tile=6x6",
        "-frames:v", "1",
        opening.as_str(),
    ];
    if crate::tools::run(ffmpeg, &hook_args, None).await.is_ok() && Path::new(&opening).is_file() {
        sheets.push(opening);
    }

    // Then the whole film at a glance.
    report(0.45, "Reading the whole film");
    let overview = folder.join("overview.jpg").display().to_string();
    let rate: f64 = (72.0 / seconds).clamp(0.02, 2.0);
    let overview_args = [
        "-hide_banner", "-loglevel", "error", "-y", "-nostdin",
        "-i", source,
        "-vf", &format!("fps={rate:.6},scale=256:-2,tile=9x8"),
        "-frames:v", "1",
        overview.as_str(),
    ];
    if crate::tools::run(ffmpeg, &overview_args, None).await.is_ok() && Path::new(&overview).is_file() {
        sheets.push(overview);
    }

    report(0.7, "Finding the cuts");
    let cuts = find_cuts(ffmpeg, source).await;
    let cut_every = if cuts.len() > 1 { seconds / cuts.len() as f64 } else { seconds };

    report(0.85, "Reading the colour");
    let palette = crate::library::palette(ffmpeg, source, seconds, 6).await;

    let reference = Reference {
        name: name.unwrap_or_else(|| next_name(root)),
        id,
        source: source.to_owned(),
        width: probe.width,
        height: probe.height,
        fps: probe.fps.unwrap_or(30.0),
        seconds,
        cuts,
        cut_every,
        palette,
        sheets,
        notes,
        pack: None,
        added_at: chrono::Utc::now().to_rfc3339(),
    };
    write(root, &reference)?;
    report(1.0, "Filed");
    Ok(reference)
}

/// What the assistant is told about a reference: the measurements, short enough to sit in a prompt.
pub fn brief(reference: &Reference) -> String {
    let mut lines = vec![format!(
        "Reference {}: {}×{}, {:.0} fps, {:.0}s, a cut every {:.1}s ({} cuts).",
        reference.name, reference.width, reference.height, reference.fps, reference.seconds, reference.cut_every, reference.cuts.len()
    )];
    if !reference.palette.is_empty() {
        lines.push(format!("Its colours: {}.", reference.palette.join(", ")));
    }
    if !reference.notes.trim().is_empty() {
        lines.push(reference.notes.trim().to_owned());
    }
    if !reference.sheets.is_empty() {
        lines.push(format!(
            "Contact sheets, if you can open images: {}.",
            reference.sheets.join(" and ")
        ));
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::{brief, list, next_name, write, Reference};

    fn sample(id: &str, name: &str) -> Reference {
        Reference {
            id: id.to_owned(),
            name: name.to_owned(),
            source: "C:/films/one.mp4".to_owned(),
            width: 1920,
            height: 1080,
            fps: 30.0,
            seconds: 60.0,
            cuts: vec![2.0, 5.5, 9.0],
            cut_every: 20.0,
            palette: vec!["#E11D2E".to_owned(), "#12040A".to_owned()],
            sheets: vec!["C:/refs/one/opening.jpg".to_owned()],
            notes: "Type lands a word at a time beside the speaker.".to_owned(),
            pack: None,
            added_at: "now".to_owned(),
        }
    }

    #[test]
    fn numbered_references_come_back_in_order_and_the_next_number_is_free() {
        let root = std::env::temp_dir().join(format!("helios-refs-{}", crate::store::new_id()));
        std::fs::create_dir_all(&root).expect("dir");

        write(&root, &sample("a", "2")).expect("write");
        write(&root, &sample("b", "1")).expect("write");
        write(&root, &sample("c", "Kinetic openers")).expect("write");

        let all = list(&root);
        // Numbers first and in order, names after them.
        assert_eq!(all.iter().map(|item| item.name.as_str()).collect::<Vec<_>>(), ["1", "2", "Kinetic openers"]);
        // Two numbers are taken, so the next one offered is three.
        assert_eq!(next_name(&root), "3");

        let _ignored = std::fs::remove_dir_all(root);
    }

    #[test]
    fn the_brief_carries_the_measurements_and_the_words() {
        let text = brief(&sample("a", "1"));
        assert!(text.contains("Reference 1"));
        assert!(text.contains("1920×1080"));
        assert!(text.contains("a cut every 20.0s"));
        assert!(text.contains("#E11D2E"));
        assert!(text.contains("word at a time"));
        // Short enough to sit in a prompt beside everything else.
        assert!(text.len() < 700, "the brief was {} characters", text.len());
    }
}
