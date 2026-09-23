//! Point and planar tracking for motion graphics (`workers/point_track.py`, OpenCV
//! Lucas–Kanade with a forward–backward check). A callout pinned to a hand, a label that follows
//! a face, a card riding a phone screen: the frontend turns the samples into keyframes on a
//! motion-scene layer. CPU only, no model download; frames are pulled here at the tracking rate.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Tracking reads frames this wide: enough detail for corners, cheap to decode.
pub const WORK_WIDTH: u32 = 960;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PointSample {
    pub at: f64,
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub scale: Option<f64>,
    #[serde(default)]
    pub rotation: Option<f64>,
    pub confidence: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct SampleTrack {
    pub samples: Vec<PointSample>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct PointTracks {
    pub fps: f64,
    pub from: f64,
    pub points: Vec<SampleTrack>,
    #[serde(default)]
    pub planar: Option<SampleTrack>,
}

pub fn dir(root: &Path, asset_id: &str) -> PathBuf {
    root.join("tracking").join(asset_id).join("points")
}

/// Pulls the frames of `[from, from + seconds)` at `fps`, `WORK_WIDTH` wide.
pub async fn extract_frames(ffmpeg: &Path, source: &str, folder: &Path, from: f64, seconds: f64, fps: f64) -> Result<usize, String> {
    let frames = folder.join("frames");
    let _ignored = std::fs::remove_dir_all(&frames);
    std::fs::create_dir_all(&frames).map_err(|error| format!("cannot make the frame folder: {error}"))?;
    let filter = format!("fps={fps:.6},scale={WORK_WIDTH}:-2");
    let pattern = frames.join("%05d.jpg").display().to_string();
    let args = [
        "-hide_banner", "-loglevel", "error", "-y", "-nostdin",
        "-accurate_seek", "-ss", &from.max(0.0).to_string(),
        "-i", source,
        "-t", &seconds.max(0.01).to_string(),
        "-vf", filter.as_str(),
        "-q:v", "2",
        pattern.as_str(),
    ];
    crate::tools::run(ffmpeg, &args, None).await?;
    let count = std::fs::read_dir(&frames).map_err(|error| format!("cannot read the frame folder: {error}"))?.filter_map(Result::ok).count();
    if count < 2 {
        return Err("fewer than two frames came out of that range".to_owned());
    }
    Ok(count)
}

/// The worker's answer, checked: finite numbers, samples in time order, confidence 0..1.
pub fn validate(tracks: PointTracks) -> Result<PointTracks, String> {
    let ok = |track: &SampleTrack| {
        track.samples.iter().all(|s| s.at.is_finite() && s.x.is_finite() && s.y.is_finite() && (0.0..=1.0).contains(&s.confidence) && s.scale.is_none_or(|v| v.is_finite() && v > 0.0) && s.rotation.is_none_or(f64::is_finite))
            && track.samples.windows(2).all(|pair| pair[0].at <= pair[1].at)
    };
    if !tracks.points.iter().all(ok) || !tracks.planar.as_ref().is_none_or(ok) {
        return Err("the tracker returned samples that are not usable".to_owned());
    }
    Ok(tracks)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(at: f64, x: f64) -> PointSample {
        PointSample { at, x, y: 0.5, scale: None, rotation: None, confidence: 1.0 }
    }

    #[test]
    fn validation_rejects_bad_samples() {
        let good = PointTracks { fps: 30.0, from: 0.0, points: vec![SampleTrack { samples: vec![sample(0.0, 0.1), sample(0.1, 0.2)] }], planar: None };
        assert!(validate(good.clone()).is_ok());
        let mut nan = good.clone();
        nan.points[0].samples[1].x = f64::NAN;
        assert!(validate(nan).is_err());
        let mut backwards = good;
        backwards.points[0].samples[1].at = -1.0;
        assert!(validate(backwards).is_err());
    }
}
