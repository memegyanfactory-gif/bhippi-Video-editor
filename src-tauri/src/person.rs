//! Finding every person in the frame and keeping their identities while they move.
//!
//! Roto answers "where is *the* subject" with one box per frame. A podcast frame
//! needs more: *how many* people are here, *which* box is which person a minute
//! later, and boxes that survive someone walking behind a chair. That is person
//! detection (RF-DETR Nano, Apache 2.0) plus multi-object tracking (ByteTrack,
//! MIT) in `workers/person_track.py`; this module is the Bhippi side — frame
//! extraction, the run cache, and reading the tracks back.
//!
//! What comes out is cached beside the asset under `tracking/<asset_id>`:
//!   · `person-tracks.json` — one entry per person: stable `person-N` ids with
//!     boxes in 0..1 frame units and `at` in source seconds. `src/lib/reframe.ts`
//!     interpolates between the samples, so 3 fps is plenty and a minute of
//!     footage is seconds of CPU work, no GPU required.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Detection + tracking at this width. RF-DETR Nano reads 384px itself; 768
/// keeps small faces in group shots while staying cheap to decode.
pub const WORK_WIDTH: u32 = 768;

/// One sighting, in frame units with `at` in source seconds.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonSample {
    pub at: f64,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// One person, in order of first appearance (left to right is *not* promised —
/// the reframe engine sorts that out per moment).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonTrack {
    pub id: String,
    #[serde(default)]
    pub boxes: Vec<PersonSample>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonTracks {
    pub asset_id: String,
    pub model: String,
    pub fps: f64,
    pub frames: usize,
    pub tracks: Vec<PersonTrack>,
}

/// One asset's tracking folder. `root` is the Tracking category folder (see storage.rs), or
/// `<app data>/tracking` for passes made before project folders existed.
pub fn dir(root: &Path, asset_id: &str) -> PathBuf {
    root.join(asset_id)
}

pub fn read(root: &Path, asset_id: &str) -> Option<PersonTracks> {
    let text = std::fs::read_to_string(dir(root, asset_id).join("person-tracks.json")).ok()?;
    serde_json::from_str(&text).ok()
}

/// Pulls the frames the detector will look at. Every Nth frame is enough —
/// identities carry across the gaps, which is the whole point of tracking.
pub async fn extract_frames(
    ffmpeg: &Path,
    source: &str,
    root: &Path,
    asset_id: &str,
    from: f64,
    seconds: f64,
    fps: f64,
) -> Result<(PathBuf, usize), String> {
    let folder = dir(root, asset_id).join("frames");
    let _ignored = std::fs::remove_dir_all(&folder);
    std::fs::create_dir_all(&folder).map_err(|error| format!("cannot make the frame folder: {error}"))?;
    let filter = format!("fps={fps:.6},scale={WORK_WIDTH}:-2");
    let pattern = folder.join("%05d.jpg").display().to_string();
    let args = [
        "-hide_banner", "-loglevel", "error", "-y", "-nostdin",
        "-accurate_seek", "-ss", &from.max(0.0).to_string(),
        "-i", source,
        "-t", &seconds.max(0.01).to_string(),
        "-vf", filter.as_str(),
        "-q:v", "3",
        pattern.as_str(),
    ];
    crate::tools::run(ffmpeg, &args, None).await?;
    let count = std::fs::read_dir(&folder)
        .map_err(|error| format!("cannot read the frame folder: {error}"))?
        .filter_map(Result::ok)
        .count();
    if count == 0 {
        return Err("no frames came out of that range".to_owned());
    }
    Ok((folder, count))
}

/// The worker's answer, checked before anything trusts it: finite numbers,
/// boxes with area, tracks that saw a person at least twice. Single-frame
/// ghosts are detector hiccups, not people, and must not become singles.
pub fn validate(tracks: &PersonTracks) -> Result<PersonTracks, String> {
    if tracks.tracks.len() > 32 {
        return Err("the tracker found more people than a frame can hold; lower the range or raise the threshold".to_owned());
    }
    let mut clean = tracks.clone();
    for track in &mut clean.tracks {
        track.boxes.retain(|sample| {
            sample.at.is_finite()
                && sample.x.is_finite() && sample.y.is_finite()
                && sample.width.is_finite() && sample.height.is_finite()
                && sample.width > 0.005 && sample.height > 0.005
        });
        track.boxes.sort_by(|a, b| a.at.partial_cmp(&b.at).unwrap_or(std::cmp::Ordering::Equal));
    }
    clean.tracks.retain(|track| track.boxes.len() >= 2);
    Ok(clean)
}

#[cfg(test)]
mod tests {
    use super::{validate, PersonTracks};

    fn parsed(body: &str) -> PersonTracks {
        serde_json::from_str(body).expect("worker output parses")
    }

    #[test]
    fn worker_output_becomes_tracks_and_ghosts_do_not() {
        let tracks = parsed(
            r#"{"assetId":"a","model":"rf-detr-nano+bytetrack","fps":3.0,"frames":9,
            "tracks":[
            {"id":"person-0","boxes":[
            {"at":0.0,"x":0.1,"y":0.3,"width":0.13,"height":0.3},
            {"at":0.33,"x":0.11,"y":0.3,"width":0.13,"height":0.3}]},
            {"id":"person-1","boxes":[
            {"at":0.0,"x":0.7,"y":0.3,"width":0.13,"height":0.3}]},
            {"id":"person-2","boxes":[
            {"at":0.0,"x":0.1,"y":0.3,"width":0.0,"height":0.3},
            {"at":0.33,"x":0.1,"y":0.3,"width":0.13,"height":0.3}]}]}"#,
        );
        assert_eq!(tracks.tracks.len(), 3);
        let clean = validate(&tracks).expect("validates");
        // person-1 blinked for a single frame; person-2's zero-area box goes.
        assert_eq!(clean.tracks.len(), 1);
        assert_eq!(clean.tracks[0].id, "person-0");
        assert_eq!(clean.tracks[0].boxes.len(), 2);
    }

    #[test]
    fn a_crowd_is_refused_rather_than_cut_into_confetti() {
        let mut tracks = parsed(r#"{"assetId":"a","model":"x","fps":3.0,"frames":9,"tracks":[]}"#);
        tracks.tracks = (0..40)
            .map(|index| super::PersonTrack {
                id: format!("person-{index}"),
                boxes: vec![
                    super::PersonSample { at: 0.0, x: 0.01 * index as f64, y: 0.3, width: 0.05, height: 0.2 },
                    super::PersonSample { at: 0.33, x: 0.01 * index as f64, y: 0.3, width: 0.05, height: 0.2 },
                ],
            })
            .collect();
        assert!(validate(&tracks).is_err());
    }
}
