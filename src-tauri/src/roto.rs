//! Separating the subject from the background, the way After Effects' roto brush does: once per
//! clip, cached, and then free to use everywhere.
//!
//! The work is split where each side is strongest. FFmpeg pulls the frames and, at the end, packs
//! the mattes back into a file the renderer can composite with. The model itself runs in the
//! webview (`src/lib/roto.ts`) on Robust Video Matting, which carries state from one frame to the
//! next — the reason its edge holds still instead of crawling. The desktop binary therefore needs
//! no inference runtime of its own.
//!
//! What comes out of it is two things, both cached beside the asset:
//!   · `matte.mp4` — the alpha, as greyscale video, for `alphamerge` at export and as a CSS mask
//!     in preview.
//!   · `subject.json` — where the subject is in each frame, which is what the layout engine reads
//!     so that type lands beside a person rather than across their face.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// The size frames are handed to the model at. RVM is trained around this, and it is small enough
/// that a minute of footage is a few seconds of work rather than a coffee break. The matte is
/// scaled back up when it is used; a soft edge survives that perfectly well.
pub const WORK_WIDTH: u32 = 512;

pub fn valid_run_id(id: &str) -> bool {
    id.strip_prefix("run-").is_some_and(|value| !value.is_empty() && value.bytes().all(|c| c.is_ascii_digit()))
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectBox {
    /// Seconds from the start of the *source* file.
    pub at: f64,
    /// In frame units, 0..1, origin top-left — the same units `src/lib/layout.ts` works in.
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// How much of the frame the subject covers, 0..1. Near zero means nobody was found.
    pub cover: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Roto {
    pub asset_id: String,
    /// The model that made it, so a better one can supersede it later.
    pub model: String,
    pub fps: f64,
    pub frames: usize,
    /// Greyscale video of the alpha, or `None` while only the boxes exist.
    pub matte: Option<String>,
    pub subjects: Vec<SubjectBox>,
}

pub fn dir(root: &Path, asset_id: &str) -> PathBuf {
    root.join("roto").join(asset_id)
}

pub fn read(root: &Path, asset_id: &str) -> Option<Roto> {
    let text = std::fs::read_to_string(dir(root, asset_id).join("roto.json")).ok()?;
    serde_json::from_str(&text).ok()
}

/// Pulls the frames the model will look at, as JPEGs the webview can fetch.
///
/// Every frame is extracted, not a sample of them: a matte that only exists on some frames is
/// worse than none, because the gap shows. `fps` of `None` keeps the source's own rate.
pub async fn extract_frames(
    ffmpeg: &Path,
    source: &str,
    root: &Path,
    asset_id: &str,
    from: f64,
    seconds: f64,
    fps: Option<f64>,
) -> Result<(PathBuf, usize), String> {
    let folder = dir(root, asset_id).join("frames");
    let _ignored = std::fs::remove_dir_all(&folder);
    std::fs::create_dir_all(&folder).map_err(|error| format!("cannot make the frame folder: {error}"))?;

    let start = from.max(0.0).to_string();
    let length = seconds.max(0.01).to_string();
    let filter = match fps {
        Some(rate) => format!("fps={rate:.6},scale={WORK_WIDTH}:-2"),
        None => format!("scale={WORK_WIDTH}:-2"),
    };
    let pattern = folder.join("%05d.jpg").display().to_string();
    let args = [
        "-hide_banner", "-loglevel", "error", "-y", "-nostdin",
        "-accurate_seek", "-ss", start.as_str(),
        "-i", source,
        "-t", length.as_str(),
        "-vf", filter.as_str(),
        "-q:v", "3",
        pattern.as_str(),
    ];
    crate::tools::run(ffmpeg, &args, None).await?;

    let count = std::fs::read_dir(&folder)
        .map_err(|error| format!("cannot read the frame folder: {error}"))?
        .filter(|entry| entry.as_ref().is_ok_and(|item| item.path().extension().is_some_and(|ext| ext == "jpg")))
        .count();
    if count == 0 {
        return Err("FFmpeg produced no frames from that range".to_owned());
    }
    Ok((folder, count))
}

/// Where the subject is, from one frame's alpha. `alpha` is one byte per pixel, row by row.
///
/// The box is the tightest one holding the solidly-opaque pixels, not every pixel with a trace of
/// alpha: a matting model leaves a haze around the subject, and a box drawn round the haze is
/// always too big to place type against. A row or column only counts when enough of it is solid,
/// which also throws away the speckle a model puts in the corners.
pub fn subject_box(alpha: &[u8], width: usize, height: usize, at: f64) -> SubjectBox {
    let empty = SubjectBox { at, x: 0.0, y: 0.0, width: 0.0, height: 0.0, cover: 0.0 };
    if width == 0 || height == 0 || alpha.len() < width * height {
        return empty;
    }
    const SOLID: u8 = 160;
    let mut columns = vec![0_u32; width];
    let mut rows = vec![0_u32; height];
    let mut total = 0_u64;
    for y in 0..height {
        for x in 0..width {
            if alpha[y * width + x] >= SOLID {
                columns[x] += 1;
                rows[y] += 1;
                total += 1;
            }
        }
    }
    if total == 0 {
        return empty;
    }
    // A line counts as part of the subject once a twentieth of it is solid — enough to ignore
    // speckle, little enough to keep an outstretched hand.
    let column_floor = (height as u32 / 20).max(2);
    let row_floor = (width as u32 / 20).max(2);
    let first = |counts: &[u32], floor: u32| counts.iter().position(|count| *count >= floor);
    let last = |counts: &[u32], floor: u32| counts.iter().rposition(|count| *count >= floor);

    let (Some(left), Some(right)) = (first(&columns, column_floor), last(&columns, column_floor)) else {
        return empty;
    };
    let (Some(top), Some(bottom)) = (first(&rows, row_floor), last(&rows, row_floor)) else {
        return empty;
    };
    SubjectBox {
        at,
        x: left as f64 / width as f64,
        y: top as f64 / height as f64,
        width: (right + 1 - left) as f64 / width as f64,
        height: (bottom + 1 - top) as f64 / height as f64,
        cover: total as f64 / (width * height) as f64,
    }
}

/// Packs the matte frames into greyscale video the renderer can composite with.
pub async fn pack_matte(ffmpeg: &Path, root: &Path, asset_id: &str, fps: f64) -> Result<String, String> {
    let folder = dir(root, asset_id).join("mattes");
    if !folder.is_dir() {
        return Err("there are no matte frames to pack".to_owned());
    }
    let target = dir(root, asset_id).join("matte.mkv");
    let target_text = target.display().to_string();
    let pattern = folder.join("%05d.pgm").display().to_string();
    let rate = format!("{fps:.6}");
    let args = [
        "-hide_banner", "-loglevel", "error", "-y", "-nostdin",
        "-framerate", rate.as_str(),
        "-i", pattern.as_str(),
        "-vf", "format=gray16le",
        "-c:v", "ffv1", "-level", "3", "-pix_fmt", "gray16le",
        target_text.as_str(),
    ];
    crate::tools::run(ffmpeg, &args, None).await?;
    let preview = dir(root, asset_id).join("preview");
    std::fs::create_dir_all(&preview).map_err(|e| e.to_string())?;
    let preview_pattern = preview.join("%05d.png").display().to_string();
    crate::tools::run(ffmpeg, &[
        "-hide_banner", "-loglevel", "error", "-y", "-nostdin", "-framerate", &rate,
        "-i", &pattern, "-vf", "format=gray", &preview_pattern,
    ], None).await?;
    if !target.is_file() {
        return Err("the matte video was not written".to_owned());
    }
    Ok(target_text)
}

/// The box to use at a given moment: the nearest frame's, since a subject does not teleport.
pub fn subject_at(roto: &Roto, at: f64) -> Option<SubjectBox> {
    roto.subjects
        .iter()
        .filter(|subject| subject.cover > 0.01)
        .min_by(|a, b| (a.at - at).abs().total_cmp(&(b.at - at).abs()))
        .copied()
}

/// One box for a whole span — the union of what the subject covers across it, which is what a
/// title that stays up for three seconds has to avoid.
pub fn subject_over(roto: &Roto, from: f64, to: f64) -> Option<SubjectBox> {
    let inside: Vec<&SubjectBox> = roto
        .subjects
        .iter()
        .filter(|subject| subject.cover > 0.01 && subject.at >= from - 1e-6 && subject.at <= to + 1e-6)
        .collect();
    if inside.is_empty() {
        return subject_at(roto, (from + to) / 2.0);
    }
    let left = inside.iter().map(|s| s.x).fold(f64::MAX, f64::min);
    let top = inside.iter().map(|s| s.y).fold(f64::MAX, f64::min);
    let right = inside.iter().map(|s| s.x + s.width).fold(f64::MIN, f64::max);
    let bottom = inside.iter().map(|s| s.y + s.height).fold(f64::MIN, f64::max);
    Some(SubjectBox {
        at: from,
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
        cover: inside.iter().map(|s| s.cover).fold(0.0, f64::max),
    })
}

#[cfg(test)]
mod tests {
    use super::{subject_at, subject_box, subject_over, Roto, SubjectBox};

    /// An alpha plane with one solid rectangle in it, plus the haze and speckle a real model leaves.
    fn plane(width: usize, height: usize, rect: (usize, usize, usize, usize)) -> Vec<u8> {
        let (left, top, right, bottom) = rect;
        let mut alpha = vec![0_u8; width * height];
        for y in 0..height {
            for x in 0..width {
                let inside = x >= left && x < right && y >= top && y < bottom;
                // A soft fringe just outside the subject, as matting models produce.
                let near = x + 3 >= left && x < right + 3 && y + 3 >= top && y < bottom + 3;
                alpha[y * width + x] = if inside { 255 } else if near { 90 } else { 0 };
            }
        }
        // Speckle in a corner: a couple of stray solid pixels that must not widen the box.
        alpha[2] = 255;
        alpha[width + 3] = 255;
        alpha
    }

    #[test]
    fn the_box_holds_the_subject_and_ignores_the_haze() {
        let (width, height) = (100, 100);
        let alpha = plane(width, height, (40, 20, 60, 90));
        let found = subject_box(&alpha, width, height, 1.5);

        assert!((found.x - 0.40).abs() < 0.02, "left edge was {}", found.x);
        assert!((found.y - 0.20).abs() < 0.02, "top edge was {}", found.y);
        assert!((found.width - 0.20).abs() < 0.03, "width was {}", found.width);
        assert!((found.height - 0.70).abs() < 0.03, "height was {}", found.height);
        // The fringe is not solid, so it is outside the box, and the speckle has not dragged it
        // to the corner.
        assert!(found.x > 0.3);
        assert!((found.cover - 0.14).abs() < 0.02, "cover was {}", found.cover);
        assert_eq!(found.at, 1.5);
    }

    #[test]
    fn an_empty_matte_is_reported_as_empty_rather_than_guessed() {
        let blank = vec![0_u8; 64 * 64];
        let found = subject_box(&blank, 64, 64, 0.0);
        assert_eq!(found.cover, 0.0);
        assert_eq!(found.width, 0.0);
        // A plane too short for its dimensions is refused rather than read past the end.
        assert_eq!(subject_box(&[0, 0, 0], 64, 64, 0.0).cover, 0.0);
    }

    #[test]
    fn a_span_takes_the_union_so_type_clears_the_whole_shot() {
        let roto = Roto {
            asset_id: "a".to_owned(),
            model: "matte-rvm".to_owned(),
            fps: 2.0,
            frames: 3,
            matte: None,
            subjects: vec![
                SubjectBox { at: 0.0, x: 0.10, y: 0.2, width: 0.2, height: 0.6, cover: 0.12 },
                SubjectBox { at: 0.5, x: 0.30, y: 0.2, width: 0.2, height: 0.6, cover: 0.12 },
                SubjectBox { at: 1.0, x: 0.55, y: 0.1, width: 0.2, height: 0.8, cover: 0.16 },
            ],
        };
        // He walks across frame: over the whole span the type must clear all of it.
        let union = subject_over(&roto, 0.0, 1.0).expect("a union");
        assert!((union.x - 0.10).abs() < 1e-9);
        assert!((union.x + union.width - 0.75).abs() < 1e-9);
        assert!((union.y - 0.10).abs() < 1e-9);

        // One moment gives the nearest frame, not the union.
        let near = subject_at(&roto, 0.45).expect("nearest");
        assert!((near.x - 0.30).abs() < 1e-9);

        // Frames where nobody was found never win.
        let sparse = Roto {
            subjects: vec![SubjectBox { at: 0.0, x: 0.0, y: 0.0, width: 0.0, height: 0.0, cover: 0.0 }],
            ..roto
        };
        assert!(subject_at(&sparse, 0.0).is_none());
    }
}
