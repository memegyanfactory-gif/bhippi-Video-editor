//! The project, Premiere-style: comps (sequences) with any number of video and audio tracks
//! holding freely placed clips, plus what the Project panel lists — imported media, generated
//! items (color mattes, adjustment layers, bars and tone…) and folders. The UI owns editing;
//! Rust validates what it is handed before saving or rendering it.
//!
//! Conventions shared with `src/lib/types.ts`:
//! - Times are seconds. A clip occupies `start..start + duration` on its comp's timeline and
//!   reads its source from `in` for `duration * speed` seconds.
//! - `tracks` keeps each kind in order: the first video track is V1 (drawn at the bottom), the
//!   first audio track is A1.
//! - Clips on one track never overlap.

use crate::library::{Asset, AssetKind};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

pub const MIN_CLIP: f64 = 1.0 / 240.0;
pub const MAX_CLIPS: usize = 20_000;
pub const MAX_TRACKS: usize = 99;
pub const MAX_COMPS: usize = 500;
pub const MAX_TIMELINE: f64 = 24.0 * 3600.0;
/// Overlap tolerance: float round-off from the UI must not reject a butt edit.
const EPSILON: f64 = 1e-4;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Preset {
    Title,
    Kinetic,
    LowerThird,
    Caption,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SfxKind {
    Whoosh,
    Impact,
    Chime,
    Pop,
    Riser,
}

impl SfxKind {
    pub const ALL: [Self; 5] = [Self::Whoosh, Self::Impact, Self::Chime, Self::Pop, Self::Riser];

    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Whoosh => "whoosh",
            Self::Impact => "impact",
            Self::Chime => "chime",
            Self::Pop => "pop",
            Self::Riser => "riser",
        }
    }

    /// Length of the generated WAV in seconds (mirrors `SFX_LENGTH` in the UI).
    #[must_use]
    pub const fn length(self) -> f64 {
        match self {
            Self::Whoosh => 0.9,
            Self::Impact => 1.4,
            Self::Chime => 1.6,
            Self::Pop => 0.25,
            Self::Riser => 2.0,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FitMode {
    /// Letterbox: the whole picture is visible.
    #[default]
    Fit,
    /// Cover the frame, cropping what spills over.
    Fill,
}

/// Where a clip's picture sits in its comp's frame. Offsets are fractions of the frame so a
/// transform survives a change of export resolution.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Transform {
    pub fit: FitMode,
    /// Horizontal offset as a fraction of the frame width (0 = centred).
    pub x: f64,
    /// Vertical offset as a fraction of the frame height (0 = centred).
    pub y: f64,
    /// Percent of the fitted size.
    pub scale: f64,
    /// Degrees, clockwise.
    pub rotation: f64,
    /// Percent.
    pub opacity: f64,
    /// Percent of the source trimmed from each edge.
    pub crop_left: f64,
    pub crop_top: f64,
    pub crop_right: f64,
    pub crop_bottom: f64,
}

impl Default for Transform {
    fn default() -> Self {
        Self { fit: FitMode::Fit, x: 0.0, y: 0.0, scale: 100.0, rotation: 0.0, opacity: 100.0, crop_left: 0.0, crop_top: 0.0, crop_right: 0.0, crop_bottom: 0.0 }
    }
}

impl Transform {
    /// True when the picture is untouched apart from its fit mode.
    #[must_use]
    pub fn is_identity(&self) -> bool {
        *self == Self { fit: self.fit, ..Self::default() }
    }

    fn validate(&self) -> Result<(), String> {
        let values = [self.x, self.y, self.scale, self.rotation, self.opacity, self.crop_left, self.crop_top, self.crop_right, self.crop_bottom];
        if values.iter().any(|value| !value.is_finite()) {
            return Err("a clip transform is not a number".to_owned());
        }
        if !(0.0..=10_000.0).contains(&self.scale) || !(0.0..=100.0).contains(&self.opacity) || self.x.abs() > 20.0 || self.y.abs() > 20.0 || self.rotation.abs() > 36_000.0 {
            return Err("a clip transform is out of range".to_owned());
        }
        let crops = [self.crop_left, self.crop_top, self.crop_right, self.crop_bottom];
        if crops.iter().any(|crop| !(0.0..=100.0).contains(crop)) || self.crop_left + self.crop_right > 99.0 || self.crop_top + self.crop_bottom > 99.0 {
            return Err("a clip crop leaves nothing to show".to_owned());
        }
        Ok(())
    }
}

/// Simple color and blur adjustments. On an adjustment layer they apply to everything below.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Effects {
    /// −100…100, 0 = unchanged.
    pub brightness: f64,
    /// −100…100, 0 = unchanged.
    pub contrast: f64,
    /// 0…300 percent, 100 = unchanged.
    pub saturation: f64,
    /// Gaussian blur radius in pixels of a 1080-pixel-tall frame; 0 = none.
    pub blur: f64,
    /// −180…180 degrees, the CSS `hue-rotate` matrix.
    pub hue: f64,
    /// 0…100 percent, the CSS `invert` filter.
    pub invert: f64,
    /// Mirror left↔right (Horizontal Flip).
    pub flip_h: bool,
    /// Mirror top↔bottom (Vertical Flip).
    pub flip_v: bool,
}

impl Default for Effects {
    fn default() -> Self {
        Self { brightness: 0.0, contrast: 0.0, saturation: 100.0, blur: 0.0, hue: 0.0, invert: 0.0, flip_h: false, flip_v: false }
    }
}

impl Effects {
    #[must_use]
    pub fn is_identity(&self) -> bool {
        *self == Self::default()
    }

    fn validate(&self) -> Result<(), String> {
        let ok = [self.brightness, self.contrast, self.saturation, self.blur, self.hue, self.invert].iter().all(|value| value.is_finite())
            && (-100.0..=100.0).contains(&self.brightness)
            && (-100.0..=100.0).contains(&self.contrast)
            && (0.0..=300.0).contains(&self.saturation)
            && (0.0..=500.0).contains(&self.blur)
            && (-180.0..=180.0).contains(&self.hue)
            && (0.0..=100.0).contains(&self.invert);
        if ok {
            Ok(())
        } else {
            Err("a clip effect is out of range".to_owned())
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ShapeKind {
    Rectangle,
    Ellipse,
    /// A regular polygon with `sides` corners.
    Polygon,
}

/// An opacity mask on a clip's picture, like Premiere's Opacity › mask. Coordinates are
/// fractions of the source picture (0,0 top-left … 1,1 bottom-right).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mask {
    pub shape: MaskShape,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default = "one")]
    pub width: f64,
    #[serde(default = "one")]
    pub height: f64,
    /// Polygon corners (pen masks), fractions of the source picture.
    #[serde(default)]
    pub points: Vec<[f64; 2]>,
    /// Soft edge in pixels of a 1080-pixel-tall frame.
    #[serde(default)]
    pub feather: f64,
    /// Show what is outside the shape instead.
    #[serde(default)]
    pub inverted: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MaskShape {
    Rectangle,
    Ellipse,
    Polygon,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Easing {
    #[default]
    Linear,
    /// Holds the value until the next keyframe.
    Hold,
    /// Smooth in and out (cubic smoothstep).
    Ease,
    /// Slow start, fast finish (cubic).
    #[serde(rename = "ease-in")]
    EaseIn,
    /// Fast start, long settle — the weighted arrival motion design asks for (cubic).
    #[serde(rename = "ease-out")]
    EaseOut,
    /// A smoother S-curve than `Ease` (quintic smootherstep).
    #[serde(rename = "ease-in-out")]
    EaseInOut,
    /// Lands past the target and settles back (back-out, overshoot ≈ 10 %).
    Overshoot,
}

impl Easing {
    /// The curve as a function of progress 0..1.
    #[must_use]
    pub fn shape(self, p: f64) -> f64 {
        match self {
            Self::Linear => p,
            Self::Hold => if p >= 1.0 { 1.0 } else { 0.0 },
            Self::Ease => p * p * (3.0 - 2.0 * p),
            Self::EaseIn => p * p * p,
            Self::EaseOut => 1.0 - (1.0 - p).powi(3),
            Self::EaseInOut => p * p * p * (p * (p * 6.0 - 15.0) + 10.0),
            Self::Overshoot => {
                let q = p - 1.0;
                1.0 + q * q * (2.70158 * q + 1.70158)
            }
        }
    }

    /// The same curve as an FFmpeg expression of `p` (an expression already clamped to 0..1).
    #[must_use]
    pub fn expr(self, p: &str) -> String {
        match self {
            Self::Linear => p.to_owned(),
            Self::Hold => format!("gte({p},1)"),
            Self::Ease => format!("{p}*{p}*(3-2*{p})"),
            Self::EaseIn => format!("{p}*{p}*{p}"),
            Self::EaseOut => format!("(1-pow(1-{p},3))"),
            Self::EaseInOut => format!("{p}*{p}*{p}*({p}*({p}*6-15)+10)"),
            Self::Overshoot => format!("(1+({p}-1)*({p}-1)*(2.70158*({p}-1)+1.70158))"),
        }
    }
}

/// One keyframe: `time` is seconds from the clip's first frame.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Keyframe {
    pub time: f64,
    pub value: f64,
    #[serde(default)]
    pub easing: Easing,
}

/// Animated properties. A property with keyframes ignores its static value; a keyframe's easing
/// shapes the segment that starts at it; before the first and after the last keyframe the value
/// holds.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Keyframes {
    pub x: Vec<Keyframe>,
    pub y: Vec<Keyframe>,
    pub scale: Vec<Keyframe>,
    pub rotation: Vec<Keyframe>,
    pub opacity: Vec<Keyframe>,
    /// Linear gain like `Clip::volume`.
    pub volume: Vec<Keyframe>,
}

impl Keyframes {
    #[must_use]
    pub fn is_empty(&self) -> bool {
        [&self.x, &self.y, &self.scale, &self.rotation, &self.opacity, &self.volume].iter().all(|list| list.is_empty())
    }

    fn validate(&self) -> Result<(), String> {
        for list in [&self.x, &self.y, &self.scale, &self.rotation, &self.opacity, &self.volume] {
            if list.len() > 2000 || list.iter().any(|key| !key.time.is_finite() || !key.value.is_finite() || key.time < 0.0) {
                return Err("a clip keyframe is invalid".to_owned());
            }
        }
        Ok(())
    }
}

/// How frames are made when a clip's speed does not match the output rate.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Interpolation {
    /// Repeat or drop whole frames.
    #[default]
    Sampling,
    /// Blend neighbouring frames.
    Blending,
    /// Motion-compensated in-betweens.
    OpticalFlow,
}

/// Premiere's Audio Channels, simplified to the mappings people use.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Channels {
    #[default]
    Stereo,
    /// Both channels summed to the centre.
    Mono,
    /// The left channel on both sides.
    Left,
    /// The right channel on both sides.
    Right,
    /// Left and right exchanged.
    Swap,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AudioType {
    Dialogue,
    Music,
    Sfx,
    Ambience,
}

/// What a clip plays.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum ClipSource {
    /// Imported media from the library (`Asset::id`).
    Media { asset_id: String },
    /// Another comp, nested.
    Comp { comp_id: String },
    /// A generated item from the Project panel.
    Item { item_id: String },
    /// A title, lower third, kinetic line or caption.
    Text {
        text: String,
        #[serde(default)]
        subtitle: String,
        preset: Preset,
        color: String,
        /// A caption style id from the WatchFIWN catalogue (captions only).
        #[serde(default)]
        style: Option<String>,
        /// Vertical Type: characters stacked top to bottom.
        #[serde(default)]
        vertical: bool,
    },
    /// A built-in sound effect.
    Sfx { kind: SfxKind },
    /// A drawn shape (Rectangle, Ellipse and Polygon tools). `width`×`height` are pixels of the
    /// comp frame; unlike footage a shape is never fitted — it draws at that size × scale.
    Shape {
        shape: ShapeKind,
        #[serde(default = "polygon_sides")]
        sides: u32,
        #[serde(default)]
        fill: Option<String>,
        #[serde(default)]
        stroke: Option<String>,
        #[serde(default)]
        stroke_width: f64,
        width: f64,
        height: f64,
        /// Rectangles only.
        #[serde(default)]
        corner_radius: f64,
    },
    /// An HTML/CSS/GSAP motion graphic template (MOGRT) or overlay.
    Html {
        html: String,
        #[serde(default)]
        css: Option<String>,
        #[serde(default)]
        js: Option<String>,
        #[serde(default)]
        title: Option<String>,
        /// The template id it was built from (frontend vocabulary).
        #[serde(default)]
        template: Option<String>,
        /// Where the graphic draws, fractions of the frame; kept for the frontend's frame QA.
        #[serde(default, rename = "box")]
        layout_box: Option<serde_json::Value>,
        /// A PNG sequence the frontend rendered for export (`dir`, `fps`, `frames`); absent in
        /// the preview. When present the export overlays the frames instead of a static title.
        #[serde(default)]
        frames: Option<HtmlFrames>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RotoCorrection {
    pub at: f64,
    pub mode: String,
    pub kind: String,
    pub x: f64,
    pub y: f64,
    pub radius: f64,
    pub softness: f64,
}

/// Pre-rendered frames of an HTML motion graphic: `dir/%05d.png` with alpha, `frames` of them at
/// `fps`, starting at the clip's first frame.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HtmlFrames {
    pub dir: String,
    pub fps: f64,
    pub frames: u64,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub id: String,
    pub track_id: String,
    /// Timeline position of the first frame, seconds.
    pub start: f64,
    /// Timeline length, seconds.
    pub duration: f64,
    /// Where in the source playback begins, seconds.
    #[serde(rename = "in", default)]
    pub in_point: f64,
    /// Playback rate: 2 plays twice as fast and reads twice as much source.
    #[serde(default = "one")]
    pub speed: f64,
    pub source: ClipSource,
    /// Clips sharing a link id move, trim and delete together (a video and its audio).
    #[serde(default)]
    pub link_id: Option<String>,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub name: Option<String>,
    /// Linear gain for audio (1 = 0 dB).
    #[serde(default = "one")]
    pub volume: f64,
    #[serde(default)]
    pub transform: Transform,
    #[serde(default)]
    pub effects: Effects,
    /// Premiere label color name (`violet`, `iris`, `caribbean`, …); UI only.
    #[serde(default)]
    pub label: Option<String>,
    /// Grouped clips select and move together but trim separately.
    #[serde(default)]
    pub group_id: Option<String>,
    /// Plays the source window backwards.
    #[serde(default)]
    pub reverse: bool,
    /// Keep pitch when the speed changes (off: pitch follows speed).
    #[serde(default = "yes")]
    pub maintain_pitch: bool,
    /// Frame hold: shows this source time for the whole clip, and the clip is silent.
    #[serde(default)]
    pub hold: Option<f64>,
    #[serde(default)]
    pub interpolation: Interpolation,
    /// Field Options › Always Deinterlace.
    #[serde(default)]
    pub deinterlace: bool,
    /// Acts as an adjustment layer: draws nothing itself; its effects and opacity apply to the
    /// tracks below while it is active. Adjustment-layer items always behave this way.
    #[serde(default)]
    pub adjustment: bool,
    #[serde(default)]
    pub mask: Option<Mask>,
    /// Greyscale video matte generated by Helios' local Roto tool.
    #[serde(default)]
    pub roto_matte: Option<String>,
    /// Human corrections recorded against a cached roto pass.
    #[serde(default)]
    pub roto_corrections: Vec<RotoCorrection>,
    #[serde(default)]
    pub keyframes: Keyframes,
    #[serde(default)]
    pub channels: Channels,
    /// Speech cleanup: high-pass, denoise and gentle compression.
    #[serde(default)]
    pub enhance_speech: bool,
    #[serde(default)]
    pub audio_type: Option<AudioType>,
    #[serde(default)]
    pub applied_effects: Vec<serde_json::Value>,
}

impl Clip {
    #[must_use]
    pub fn end(&self) -> f64 {
        self.start + self.duration
    }

    /// The source time just past the last frame this clip shows.
    #[must_use]
    pub fn source_out(&self) -> f64 {
        self.in_point + self.duration * self.speed
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TrackKind {
    Video,
    Audio,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub kind: TrackKind,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub locked: bool,
    /// Video: output switched off (the eye).
    #[serde(default)]
    pub hidden: bool,
    /// Audio: muted.
    #[serde(default)]
    pub muted: bool,
    /// Audio: soloed.
    #[serde(default)]
    pub solo: bool,
    /// Targeted for edits at the playhead (Add Edit, paste, Up/Down edit points).
    #[serde(default = "yes")]
    pub targeted: bool,
    /// Sync lock: insert and ripple edits elsewhere move this track's clips too.
    #[serde(default = "yes")]
    pub sync_lock: bool,
    /// Header height in pixels (UI only).
    #[serde(default = "track_height")]
    pub height: f64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    pub id: String,
    pub time: f64,
    #[serde(default)]
    pub name: String,
    #[serde(default = "marker_color")]
    pub color: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum TransitionKind {
    CrossDissolve,
    DipToBlack,
    DipToWhite,
    FilmDissolve,
    AdditiveDissolve,
    PushLeft,
    PushRight,
    PushUp,
    PushDown,
    SlideLeft,
    SlideRight,
    SlideUp,
    SlideDown,
    WipeLeft,
    WipeRight,
    WipeUp,
    WipeDown,
    IrisRound,
    IrisBox,
    CrossZoom,
    /// Audio: equal-power crossfade (Premiere's default).
    ConstantPower,
    /// Audio: linear crossfade.
    ConstantGain,
    /// Audio: exponential fade.
    ExponentialFade,
}

impl TransitionKind {
    #[must_use]
    pub const fn is_audio(self) -> bool {
        matches!(self, Self::ConstantPower | Self::ConstantGain | Self::ExponentialFade)
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Alignment {
    /// Centred on the cut.
    #[default]
    Center,
    /// Starts at the cut (runs into the incoming clip).
    Start,
    /// Ends at the cut (runs over the end of the outgoing clip).
    End,
}

/// A transition on one track: between `from_clip` and `to_clip` at their shared edit point, or
/// single-sided at a clip's head (`to_clip` only) or tail (`from_clip` only). Where a clip has
/// no source beyond its edge, the edge frame is held (like Premiere without handles).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transition {
    pub id: String,
    pub track_id: String,
    pub kind: TransitionKind,
    #[serde(default)]
    pub from_clip: Option<String>,
    #[serde(default)]
    pub to_clip: Option<String>,
    pub duration: f64,
    #[serde(default)]
    pub alignment: Alignment,
}

impl Transition {
    /// The timeline window the transition covers, given a slice of clips.
    #[must_use]
    pub fn window_from_clips(&self, clips: &[Clip]) -> Option<(f64, f64)> {
        let find = |id: &Option<String>| id.as_ref().and_then(|id| clips.iter().find(|clip| &clip.id == id));
        let at = match (find(&self.from_clip), find(&self.to_clip)) {
            (Some(from), _) => from.end(),
            (None, Some(to)) => to.start,
            (None, None) => return None,
        };
        let alignment = match (&self.from_clip, &self.to_clip) {
            (Some(_), None) => Alignment::End,
            (None, Some(_)) => Alignment::Start,
            _ => self.alignment,
        };
        Some(match alignment {
            Alignment::Center => (at - self.duration / 2.0, at + self.duration / 2.0),
            Alignment::Start => (at, at + self.duration),
            Alignment::End => (at - self.duration, at),
        })
    }

    /// The timeline window the transition covers, given its clips.
    #[must_use]
    pub fn window(&self, comp: &Comp) -> Option<(f64, f64)> {
        self.window_from_clips(&comp.clips)
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comp {
    #[serde(default)]
    pub storyboard: Vec<serde_json::Value>,
    /// Blueprint-first production plan for from-scratch video creation.
    /// Optional so older projects without it keep loading.
    #[serde(default)]
    pub video_blueprint: Option<serde_json::Value>,
    /// Production phase, gates and research (see src/lib/types.ts `Production`). Opaque here:
    /// the frontend owns its shape; Rust only has to keep it across save and load.
    #[serde(default)]
    pub production: Option<serde_json::Value>,
    pub id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    #[serde(default)]
    pub tracks: Vec<Track>,
    #[serde(default)]
    pub clips: Vec<Clip>,
    #[serde(default)]
    pub markers: Vec<Marker>,
    #[serde(default)]
    pub transitions: Vec<Transition>,
    #[serde(default)]
    pub in_point: Option<f64>,
    #[serde(default)]
    pub out_point: Option<f64>,
    /// Source patching: where the Source monitor's picture and sound land on Insert/Overwrite.
    #[serde(default)]
    pub source_video: Option<String>,
    #[serde(default)]
    pub source_audio: Option<String>,
    #[serde(default)]
    pub folder_id: Option<String>,
}

impl Comp {
    /// Prunes and repairs broken references (e.g. cross-track or orphaned transitions)
    /// so saving and editing remain resilient and never crash or trap projects in memory.
    pub fn sanitize(&mut self) {
        let track_by_id: HashMap<&str, TrackKind> = self.tracks.iter().map(|t| (t.id.as_str(), t.kind)).collect();
        let clip_by_id: HashMap<&str, &str> = self.clips.iter().map(|clip| (clip.id.as_str(), clip.track_id.as_str())).collect();
        let clips = &self.clips;
        self.transitions.retain_mut(|transition| {
            let Some(&track_kind) = track_by_id.get(transition.track_id.as_str()) else {
                return false;
            };
            if transition.kind.is_audio() != (track_kind == TrackKind::Audio) {
                return false;
            }
            if !transition.duration.is_finite() || transition.duration <= 0.0 || transition.duration > 600.0 {
                return false;
            }
            if let Some(from_id) = &transition.from_clip {
                if clip_by_id.get(from_id.as_str()).copied() != Some(transition.track_id.as_str()) {
                    transition.from_clip = None;
                }
            }
            if let Some(to_id) = &transition.to_clip {
                if clip_by_id.get(to_id.as_str()).copied() != Some(transition.track_id.as_str()) {
                    transition.to_clip = None;
                }
            }
            if transition.from_clip.is_none() && transition.to_clip.is_none() {
                return false;
            }
            transition.window_from_clips(clips).is_some()
        });
    }

    /// The end of the last clip.
    #[must_use]
    pub fn duration(&self) -> f64 {
        self.clips.iter().map(Clip::end).fold(0.0, f64::max)
    }

    #[must_use]
    pub fn track(&self, id: &str) -> Option<&Track> {
        self.tracks.iter().find(|track| track.id == id)
    }

    /// Tracks of one kind in order: V1, V2, … or A1, A2, …
    pub fn tracks_of(&self, kind: TrackKind) -> impl Iterator<Item = &Track> {
        self.tracks.iter().filter(move |track| track.kind == kind)
    }

    /// `V1`, `A3`, … for a track id.
    #[must_use]
    pub fn track_label(&self, id: &str) -> Option<String> {
        let track = self.track(id)?;
        let index = self.tracks_of(track.kind).position(|item| item.id == id)?;
        Some(format!("{}{}", if track.kind == TrackKind::Video { 'V' } else { 'A' }, index + 1))
    }

    /// Whether an audio track is heard: when any track is soloed only soloed tracks play.
    #[must_use]
    pub fn audible(&self, track: &Track) -> bool {
        if self.tracks_of(TrackKind::Audio).any(|item| item.solo) {
            track.solo
        } else {
            !track.muted
        }
    }

    /// The clips on one track, earliest first.
    #[must_use]
    pub fn clips_on(&self, track_id: &str) -> Vec<&Clip> {
        let mut clips: Vec<&Clip> = self.clips.iter().filter(|clip| clip.track_id == track_id).collect();
        clips.sort_by(|a, b| a.start.total_cmp(&b.start));
        clips
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ItemKind {
    /// A solid of one color.
    ColorMatte,
    BlackVideo,
    /// Nothing at all: a placeholder that draws no pixels.
    TransparentVideo,
    /// SMPTE HD color bars with a 1 kHz tone at −20 dB.
    BarsAndTone,
    /// Applies its clip's effects and opacity to every track below it.
    AdjustmentLayer,
    /// A countdown leader: numbers from the item's duration down to 1 with a sweep and a beep
    /// on each second.
    Countdown,
}

impl ItemKind {
    /// Whether clips of this item make sound.
    #[must_use]
    pub const fn has_audio(self) -> bool {
        matches!(self, Self::BarsAndTone | Self::Countdown)
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectItem {
    pub id: String,
    pub kind: ItemKind,
    pub name: String,
    /// `#RRGGBB`; the matte color, or the countdown's accent.
    #[serde(default = "white")]
    pub color: String,
    pub width: u32,
    pub height: u32,
    /// Default clip length when placed. Countdowns cannot run longer than this.
    pub duration: f64,
    #[serde(default)]
    pub folder_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaRef {
    pub asset_id: String,
    #[serde(default)]
    pub folder_id: Option<String>,
    /// Make Offline: clips of this media show "Media Offline" until relinked.
    #[serde(default)]
    pub offline: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub version: u32,
    pub name: String,
    #[serde(default)]
    pub comps: Vec<Comp>,
    #[serde(default)]
    pub items: Vec<ProjectItem>,
    #[serde(default)]
    pub media: Vec<MediaRef>,
    #[serde(default)]
    pub folders: Vec<Folder>,
    #[serde(default)]
    pub active_comp_id: Option<String>,
    #[serde(default)]
    pub open_comp_ids: Vec<String>,
    /// The caption style new captions start with.
    #[serde(default)]
    pub caption_style: Option<String>,
}

pub const VERSION: u32 = 3;

const fn one() -> f64 {
    1.0
}
const fn yes() -> bool {
    true
}
const fn track_height() -> f64 {
    48.0
}
const fn polygon_sides() -> u32 {
    5
}
fn marker_color() -> String {
    "#3FB950".to_owned()
}
fn white() -> String {
    "#FFFFFF".to_owned()
}

impl Default for Project {
    fn default() -> Self {
        Self {
            version: VERSION,
            name: "Untitled project".to_owned(),
            comps: Vec::new(),
            items: Vec::new(),
            media: Vec::new(),
            folders: Vec::new(),
            active_comp_id: None,
            open_comp_ids: Vec::new(),
            caption_style: None,
        }
    }
}

/// A text clip in the shape the ASS writers take: timing on its comp's timeline.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Graphic {
    pub id: String,
    pub text: String,
    #[serde(default)]
    pub subtitle: String,
    pub start: f64,
    pub duration: f64,
    pub preset: Preset,
    pub color: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
}

impl Graphic {
    /// The text a clip draws, or `None` when it is not a text clip.
    #[must_use]
    pub fn from_clip(clip: &Clip) -> Option<Self> {
        match &clip.source {
            ClipSource::Text { text, subtitle, preset, color, style, .. } => Some(Self {
                id: clip.id.clone(),
                text: text.clone(),
                subtitle: subtitle.clone(),
                start: clip.start,
                duration: clip.duration,
                preset: *preset,
                color: color.clone(),
                style: style.clone(),
            }),
            // HTML motion graphics are GSAP/CSS in the preview, which ffmpeg
            // cannot rasterise — but dropping them silently loses the card's
            // message entirely. Export their visible text as a static title so
            // the words always survive; the animation itself is preview-only.
            ClipSource::Html { frames: Some(_), .. } => None,
            ClipSource::Html { html, title, .. } => {
                let mut text = visible_html_text(html);
                if text.is_empty() {
                    text = title.clone().unwrap_or_default().trim().to_owned();
                }
                if text.is_empty() {
                    return None;
                }
                Some(Self {
                    id: clip.id.clone(),
                    text,
                    subtitle: String::new(),
                    start: clip.start,
                    duration: clip.duration,
                    preset: Preset::Title,
                    color: "#FFFFFF".to_owned(),
                    style: None,
                })
            }
            _ => None,
        }
    }
}

/// The words a motion-graphic's markup actually shows: tags stripped, entities
/// decoded, whitespace collapsed, capped so one card cannot flood the script.
fn visible_html_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len().min(512));
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            // A tag boundary is a word boundary too (</h1><p>), so keep one
            // space; the later collapse removes the extras.
            '>' => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    let text = out
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ");
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.chars().take(200).collect::<String>().trim().to_owned()
}

impl Project {
    /// Sanitizes all comps in the project so saving and editing remain resilient.
    pub fn sanitize(&mut self) {
        for comp in &mut self.comps {
            comp.sanitize();
        }
    }
    #[must_use]
    pub fn comp(&self, id: &str) -> Option<&Comp> {
        self.comps.iter().find(|comp| comp.id == id)
    }

    #[must_use]
    pub fn item(&self, id: &str) -> Option<&ProjectItem> {
        self.items.iter().find(|item| item.id == id)
    }

    /// Comps that `comp_id` nests, directly or through other comps.
    fn nests(&self, comp_id: &str, seen: &mut HashSet<String>) -> Result<(), String> {
        if !seen.insert(comp_id.to_owned()) {
            return Err("a comp is nested inside itself".to_owned());
        }
        let Some(comp) = self.comp(comp_id) else {
            return Ok(());
        };
        for clip in &comp.clips {
            if let ClipSource::Comp { comp_id: child } = &clip.source {
                self.nests(child, seen)?;
            }
        }
        seen.remove(comp_id);
        Ok(())
    }

    /// Structural checks that hold regardless of the media library.
    pub fn validate_shape(&self) -> Result<(), String> {
        if self.version != VERSION {
            return Err(format!("project version {} is not supported here", self.version));
        }
        if self.name.chars().count() > 200 {
            return Err("project name is too long".to_owned());
        }
        if self.comps.len() > MAX_COMPS || self.items.len() > 10_000 || self.folders.len() > 10_000 || self.media.len() > 50_000 {
            return Err("the project holds too many items".to_owned());
        }
        let comp_ids: HashSet<&str> = self.comps.iter().map(|comp| comp.id.as_str()).collect();
        if comp_ids.len() != self.comps.len() {
            return Err("two comps share an id".to_owned());
        }
        let item_ids: HashSet<&str> = self.items.iter().map(|item| item.id.as_str()).collect();
        for item in &self.items {
            if !is_hex_color(&item.color) || !(1..=16_384).contains(&item.width) || !(1..=16_384).contains(&item.height) || !item.duration.is_finite() || item.duration <= 0.0 || item.duration > MAX_TIMELINE {
                return Err(format!("item \"{}\" has invalid settings", item.name));
            }
        }
        for comp in &self.comps {
            validate_comp(comp, &comp_ids, &item_ids)?;
        }
        for comp in &self.comps {
            self.nests(&comp.id, &mut HashSet::new())?;
        }
        if let Some(active) = &self.active_comp_id {
            if !comp_ids.contains(active.as_str()) {
                return Err("the active comp does not exist".to_owned());
            }
        }
        Ok(())
    }

    /// Checks against the media library, for rendering `comp_id`: every media clip's file
    /// exists, sits on a track that can play it, and stays inside its source.
    pub fn validate_media(&self, comp_id: &str, assets: &HashMap<String, Asset>) -> Result<(), String> {
        self.validate_shape()?;
        let comp = self.comp(comp_id).ok_or("that comp is not in the project")?;
        let mut pending = vec![comp];
        let mut checked = HashSet::new();
        while let Some(comp) = pending.pop() {
            if !checked.insert(comp.id.clone()) {
                continue;
            }
            for clip in &comp.clips {
                let kind = comp.track(&clip.track_id).map_or(TrackKind::Video, |track| track.kind);
                match &clip.source {
                    ClipSource::Media { asset_id } => {
                        let asset = assets.get(asset_id).ok_or_else(|| format!("a clip in \"{}\" refers to media that was removed", comp.name))?;
                        if self.media.iter().any(|reference| &reference.asset_id == asset_id && reference.offline) {
                            return Err(format!("\"{}\" is offline — relink it with Link Media before exporting", asset.name));
                        }
                        if !std::path::Path::new(&asset.path).is_file() {
                            return Err(format!("\"{}\" is missing from {} — was it moved or deleted?", asset.name, asset.path));
                        }
                        if kind == TrackKind::Video && asset.kind == AssetKind::Audio {
                            return Err(format!("\"{}\" is audio and cannot sit on a video track", asset.name));
                        }
                        if kind == TrackKind::Audio && (asset.kind == AssetKind::Image || !asset.has_audio) {
                            return Err(format!("\"{}\" has no sound to put on an audio track", asset.name));
                        }
                        if asset.kind != AssetKind::Image && clip.source_out() > asset.duration + 0.1 {
                            return Err(format!("a clip runs past the end of \"{}\"", asset.name));
                        }
                    }
                    ClipSource::Comp { comp_id } => {
                        if let Some(child) = self.comp(comp_id) {
                            pending.push(child);
                        }
                    }
                    ClipSource::Item { .. } | ClipSource::Text { .. } | ClipSource::Sfx { .. } | ClipSource::Shape { .. } | ClipSource::Html { .. } => {}
                }
            }
        }
        Ok(())
    }
}

fn validate_comp(comp: &Comp, comp_ids: &HashSet<&str>, item_ids: &HashSet<&str>) -> Result<(), String> {
    let name = &comp.name;
    if name.chars().count() > 200 {
        return Err("comp name is too long".to_owned());
    }
    if !(16..=16_384).contains(&comp.width) || !(16..=16_384).contains(&comp.height) {
        return Err(format!("comp \"{name}\" has an invalid frame size"));
    }
    if !comp.fps.is_finite() || !(1.0..=240.0).contains(&comp.fps) {
        return Err(format!("comp \"{name}\" has an invalid frame rate"));
    }
    if comp.tracks_of(TrackKind::Video).count() > MAX_TRACKS || comp.tracks_of(TrackKind::Audio).count() > MAX_TRACKS {
        return Err(format!("comp \"{name}\" has more than {MAX_TRACKS} tracks of one kind"));
    }
    if comp.clips.len() > MAX_CLIPS || comp.markers.len() > MAX_CLIPS {
        return Err(format!("comp \"{name}\" holds too many clips"));
    }
    let tracks: HashMap<&str, &Track> = comp.tracks.iter().map(|track| (track.id.as_str(), track)).collect();
    if tracks.len() != comp.tracks.len() {
        return Err(format!("two tracks in \"{name}\" share an id"));
    }
    let mut clip_ids = HashSet::new();
    for clip in &comp.clips {
        if !clip_ids.insert(clip.id.as_str()) {
            return Err(format!("two clips in \"{name}\" share an id"));
        }
        let track = tracks.get(clip.track_id.as_str()).ok_or_else(|| format!("a clip in \"{name}\" is on a track that does not exist"))?;
        let times = [clip.start, clip.duration, clip.in_point, clip.speed, clip.volume];
        if times.iter().any(|value| !value.is_finite()) || clip.start < 0.0 || clip.in_point < 0.0 {
            return Err(format!("a clip in \"{name}\" has invalid times"));
        }
        if clip.duration < MIN_CLIP - 1e-9 || clip.end() > MAX_TIMELINE {
            return Err(format!("a clip in \"{name}\" is too short or too long"));
        }
        if !(0.05..=20.0).contains(&clip.speed) {
            return Err(format!("a clip in \"{name}\" has a speed outside 5%–2000%"));
        }
        if !(0.0..=8.0).contains(&clip.volume) {
            return Err(format!("a clip in \"{name}\" has a volume out of range"));
        }
        clip.transform.validate()?;
        clip.effects.validate()?;
        clip.keyframes.validate()?;
        if clip.hold.is_some_and(|time| !time.is_finite() || time < 0.0) {
            return Err(format!("a frame hold in \"{name}\" is invalid"));
        }
        if let Some(mask) = &clip.mask {
            let values = [mask.x, mask.y, mask.width, mask.height, mask.feather];
            if values.iter().any(|value| !value.is_finite()) || mask.points.len() > 500 || mask.points.iter().flatten().any(|value| !value.is_finite()) || mask.feather < 0.0 {
                return Err(format!("a mask in \"{name}\" is invalid"));
            }
        }
        if clip.roto_corrections.len() > 2000 || clip.roto_corrections.iter().any(|correction| {
            [correction.at, correction.x, correction.y, correction.radius, correction.softness].iter().any(|value| !value.is_finite())
                || correction.at < 0.0 || !(0.0..=1.0).contains(&correction.x) || !(0.0..=1.0).contains(&correction.y)
                || correction.radius <= 0.0 || correction.radius > 1.0 || !(0.0..=1.0).contains(&correction.softness)
                || !matches!(correction.mode.as_str(), "include" | "exclude") || !matches!(correction.kind.as_str(), "click" | "brush")
        }) {
            return Err(format!("a roto correction in \"{name}\" is invalid"));
        }
        let video_only = || {
            if track.kind == TrackKind::Video {
                Ok(())
            } else {
                Err(format!("a picture-only clip in \"{name}\" is on an audio track"))
            }
        };
        match &clip.source {
            ClipSource::Media { asset_id } if asset_id.is_empty() => return Err(format!("a clip in \"{name}\" has no media")),
            ClipSource::Media { .. } => {}
            ClipSource::Comp { comp_id } => {
                if !comp_ids.contains(comp_id.as_str()) {
                    return Err(format!("a clip in \"{name}\" nests a comp that was deleted"));
                }
            }
            ClipSource::Item { item_id } => {
                if !item_ids.contains(item_id.as_str()) {
                    return Err(format!("a clip in \"{name}\" uses an item that was deleted"));
                }
            }
            ClipSource::Text { text, subtitle, color, .. } => {
                video_only()?;
                if text.chars().count() > 2000 || subtitle.chars().count() > 500 {
                    return Err("text clips are limited to 2000 characters".to_owned());
                }
                if !is_hex_color(color) {
                    return Err(format!("a text clip in \"{name}\" has an invalid color"));
                }
            }
            ClipSource::Sfx { .. } => {
                if track.kind != TrackKind::Audio {
                    return Err(format!("a sound effect in \"{name}\" is on a video track"));
                }
            }
            ClipSource::Shape { sides, fill, stroke, stroke_width, width, height, corner_radius, .. } => {
                video_only()?;
                let colors_ok = fill.as_deref().is_none_or(is_hex_color) && stroke.as_deref().is_none_or(is_hex_color);
                let sizes = [*stroke_width, *width, *height, *corner_radius];
                if !colors_ok || sizes.iter().any(|value| !value.is_finite() || *value < 0.0) || *width > 65_536.0 || *height > 65_536.0 || !(3..=64).contains(sides) {
                    return Err(format!("a shape in \"{name}\" has invalid settings"));
                }
            }
            ClipSource::Html { .. } => {
                video_only()?;
            }
        }
    }
    let clip_by_id: HashMap<&str, &Clip> = comp.clips.iter().map(|clip| (clip.id.as_str(), clip)).collect();
    for transition in &comp.transitions {
        let track = tracks.get(transition.track_id.as_str()).ok_or_else(|| format!("a transition in \"{name}\" is on a missing track"))?;
        if transition.kind.is_audio() != (track.kind == TrackKind::Audio) {
            return Err(format!("a transition in \"{name}\" does not suit its track"));
        }
        if !transition.duration.is_finite() || transition.duration <= 0.0 || transition.duration > 600.0 {
            return Err(format!("a transition in \"{name}\" has an invalid duration"));
        }
        for id in [&transition.from_clip, &transition.to_clip].into_iter().flatten() {
            if clip_by_id.get(id.as_str()).is_none_or(|clip| clip.track_id != transition.track_id) {
                return Err(format!("a transition in \"{name}\" refers to a clip that is not on its track"));
            }
        }
        if transition.window(comp).is_none() {
            return Err(format!("a transition in \"{name}\" has no clips"));
        }
    }
    for track in &comp.tracks {
        let clips = comp.clips_on(&track.id);
        for pair in clips.windows(2) {
            if pair[1].start < pair[0].end() - EPSILON {
                return Err(format!("two clips overlap on {} in \"{name}\"", comp.track_label(&track.id).unwrap_or_default()));
            }
        }
    }
    let times = comp.markers.iter().map(|marker| marker.time).chain(comp.in_point).chain(comp.out_point);
    if times.into_iter().any(|time| !time.is_finite() || time < 0.0) {
        return Err(format!("a marker or In/Out point in \"{name}\" is invalid"));
    }
    for patch in [&comp.source_video, &comp.source_audio].into_iter().flatten() {
        if !tracks.contains_key(patch.as_str()) {
            return Err(format!("source patching in \"{name}\" names a missing track"));
        }
    }
    Ok(())
}

#[must_use]
pub fn is_hex_color(value: &str) -> bool {
    value.len() == 7 && value.starts_with('#') && value[1..].chars().all(|c| c.is_ascii_hexdigit())
}

#[cfg(test)]
pub mod fixtures {
    //! Builders for tests elsewhere in the crate.
    use super::{Channels, Clip, ClipSource, Comp, Effects, Interpolation, Keyframes, Project, Track, TrackKind, Transform, VERSION};

    #[must_use]
    pub fn track(id: &str, kind: TrackKind) -> Track {
        Track { id: id.to_owned(), kind, name: String::new(), locked: false, hidden: false, muted: false, solo: false, targeted: true, sync_lock: true, height: 48.0 }
    }

    #[must_use]
    pub fn clip(id: &str, track_id: &str, start: f64, duration: f64, source: ClipSource) -> Clip {
        Clip {
            id: id.to_owned(),
            track_id: track_id.to_owned(),
            start,
            duration,
            in_point: 0.0,
            speed: 1.0,
            source,
            link_id: None,
            enabled: true,
            name: None,
            volume: 1.0,
            transform: Transform::default(),
            effects: Effects::default(),
            label: None,
            group_id: None,
            reverse: false,
            maintain_pitch: true,
            hold: None,
            interpolation: Interpolation::default(),
            deinterlace: false,
            adjustment: false,
            mask: None,
            roto_matte: None,
            roto_corrections: Vec::new(),
            keyframes: Keyframes::default(),
            channels: Channels::default(),
            enhance_speech: false,
            audio_type: None,
            applied_effects: vec![],
        }
    }

    /// A 1920×1080 30 fps comp with tracks V1, V2, A1, A2.
    #[must_use]
    pub fn comp(id: &str, clips: Vec<Clip>) -> Comp {
        Comp {
            storyboard: Vec::new(),
            video_blueprint: None,
            production: None,
            id: id.to_owned(),
            name: id.to_owned(),
            width: 1920,
            height: 1080,
            fps: 30.0,
            tracks: vec![track("v1", TrackKind::Video), track("v2", TrackKind::Video), track("a1", TrackKind::Audio), track("a2", TrackKind::Audio)],
            clips,
            markers: Vec::new(),
            transitions: Vec::new(),
            in_point: None,
            out_point: None,
            source_video: None,
            source_audio: None,
            folder_id: None,
        }
    }

    #[must_use]
    pub fn project(comps: Vec<Comp>) -> Project {
        Project { version: VERSION, active_comp_id: comps.first().map(|comp| comp.id.clone()), comps, ..Project::default() }
    }
}

#[cfg(test)]
mod tests {
    use super::fixtures::{clip, comp, project};
    use super::{ClipSource, Graphic, ItemKind, Preset, Project, ProjectItem, SfxKind, TrackKind};

    fn media(id: &str) -> ClipSource {
        ClipSource::Media { asset_id: id.to_owned() }
    }

    #[test]
    fn the_ui_shape_round_trips() {
        let json = r##"{"version":3,"name":"Reel","activeCompId":"c","openCompIds":["c"],
            "comps":[{"id":"c","name":"Main","width":1080,"height":1920,"fps":30,
              "tracks":[{"id":"v1","kind":"video","name":""},{"id":"a1","kind":"audio"}],
              "clips":[
                {"id":"x","trackId":"v1","start":0,"duration":2,"in":1,"source":{"type":"media","assetId":"m"},"linkId":"l"},
                {"id":"y","trackId":"a1","start":0,"duration":2,"in":1,"source":{"type":"media","assetId":"m"},"linkId":"l"},
                {"id":"t","trackId":"v1","start":2,"duration":1,"source":{"type":"text","text":"Hi","preset":"lower-third","color":"#FFC53D"}}
              ],
              "markers":[{"id":"k","time":1.5}]}],
            "items":[{"id":"i","kind":"color-matte","name":"Red","color":"#FF0000","width":1080,"height":1920,"duration":5}],
            "media":[{"assetId":"m"}],"folders":[]}"##;
        let project: Project = serde_json::from_str(json).expect("parse");
        project.validate_shape().expect("valid");
        let clip = &project.comps[0].clips[0];
        assert_eq!((clip.speed, clip.volume, clip.enabled), (1.0, 1.0, true), "defaults fill in");
        assert_eq!(project.comps[0].tracks[0].height, 48.0);
        assert_eq!(project.items[0].kind, ItemKind::ColorMatte);
        let back = serde_json::to_value(&project).expect("serialise");
        assert_eq!(back["comps"][0]["clips"][0]["in"], 1.0);
        assert_eq!(back["comps"][0]["clips"][0]["source"]["type"], "media");
        assert_eq!(back["comps"][0]["clips"][0]["source"]["assetId"], "m");
        assert_eq!(back["comps"][0]["clips"][2]["source"]["preset"], "lower-third");
        assert_eq!(back["comps"][0]["tracks"][1]["kind"], "audio");
        assert_eq!(back["items"][0]["kind"], "color-matte");
    }

    #[test]
    fn labels_follow_track_order_within_each_kind() {
        let comp = comp("c", Vec::new());
        assert_eq!(comp.track_label("v2").as_deref(), Some("V2"));
        assert_eq!(comp.track_label("a1").as_deref(), Some("A1"));
        assert_eq!(comp.tracks_of(TrackKind::Audio).count(), 2);
    }

    #[test]
    fn solo_decides_which_audio_tracks_are_heard() {
        let mut comp = comp("c", Vec::new());
        assert!(comp.audible(&comp.tracks[2]) && comp.audible(&comp.tracks[3]));
        comp.tracks[3].solo = true;
        assert!(!comp.audible(&comp.tracks[2]) && comp.audible(&comp.tracks[3]));
    }

    #[test]
    fn overlapping_clips_on_one_track_are_refused_but_butt_edits_pass() {
        let ok = project(vec![comp("c", vec![clip("a", "v1", 0.0, 2.0, media("m")), clip("b", "v1", 2.00001, 1.0, media("m")), clip("c", "v2", 1.0, 3.0, media("m"))])]);
        ok.validate_shape().expect("butt edit and another track are fine");
        let bad = project(vec![comp("c", vec![clip("a", "v1", 0.0, 2.0, media("m")), clip("b", "v1", 1.5, 1.0, media("m"))])]);
        assert!(bad.validate_shape().expect_err("overlap").contains("overlap on V1"));
    }

    #[test]
    fn sources_must_suit_their_track_and_exist() {
        let text = ClipSource::Text { text: "Hi".into(), subtitle: String::new(), preset: Preset::Title, color: "#FFFFFF".into(), style: None, vertical: false };
        let on_audio = project(vec![comp("c", vec![clip("t", "a1", 0.0, 1.0, text)])]);
        assert!(on_audio.validate_shape().is_err());
        let sfx_on_video = project(vec![comp("c", vec![clip("s", "v1", 0.0, 1.0, ClipSource::Sfx { kind: SfxKind::Pop })])]);
        assert!(sfx_on_video.validate_shape().is_err());
        let ghost = project(vec![comp("c", vec![clip("n", "v1", 0.0, 1.0, ClipSource::Comp { comp_id: "gone".into() })])]);
        assert!(ghost.validate_shape().expect_err("missing comp").contains("deleted"));
        let mut with_item = project(vec![comp("c", vec![clip("i", "v1", 0.0, 1.0, ClipSource::Item { item_id: "red".into() })])]);
        assert!(with_item.validate_shape().is_err());
        with_item.items.push(ProjectItem { id: "red".into(), kind: ItemKind::ColorMatte, name: "Red".into(), color: "#FF0000".into(), width: 1920, height: 1080, duration: 5.0, folder_id: None });
        with_item.validate_shape().expect("item exists");
    }

    #[test]
    fn transitions_sit_on_their_edit_point_and_must_suit_the_track() {
        use super::{Alignment, Transition, TransitionKind};
        let mut comp = comp("c", vec![clip("a", "v1", 0.0, 4.0, media("m")), clip("b", "v1", 4.0, 3.0, media("m"))]);
        let mut dissolve = Transition { id: "t".into(), track_id: "v1".into(), kind: TransitionKind::CrossDissolve, from_clip: Some("a".into()), to_clip: Some("b".into()), duration: 1.0, alignment: Alignment::Center };
        assert_eq!(dissolve.window(&comp), Some((3.5, 4.5)));
        dissolve.alignment = Alignment::Start;
        assert_eq!(dissolve.window(&comp), Some((4.0, 5.0)));
        let fade_in = Transition { id: "f".into(), track_id: "v1".into(), kind: TransitionKind::DipToBlack, from_clip: None, to_clip: Some("a".into()), duration: 0.5, alignment: Alignment::Center };
        assert_eq!(fade_in.window(&comp), Some((0.0, 0.5)), "a head transition always starts at the clip");
        comp.transitions = vec![dissolve.clone(), fade_in];
        project(vec![comp.clone()]).validate_shape().expect("valid");
        comp.transitions = vec![Transition { kind: TransitionKind::ConstantPower, ..dissolve }];
        assert!(project(vec![comp]).validate_shape().expect_err("audio transition on video").contains("suit"));
    }

    #[test]
    fn transitions_can_be_sanitized_if_orphaned_or_on_wrong_track() {
        use super::{Alignment, Transition, TransitionKind};
        let mut comp = comp("c", vec![clip("a", "v1", 0.0, 4.0, media("m")), clip("b", "v2", 4.0, 4.0, media("m"))]);
        let broken = Transition { id: "t".into(), track_id: "v1".into(), kind: TransitionKind::CrossDissolve, from_clip: Some("a".into()), to_clip: Some("b".into()), duration: 1.0, alignment: Alignment::Center };
        comp.transitions = vec![broken];
        let mut proj = project(vec![comp]);
        assert!(proj.validate_shape().is_err(), "should fail validation before sanitize");
        proj.sanitize();
        proj.validate_shape().expect("should succeed after sanitize heals the cross-track reference");
    }

    #[test]
    fn a_comp_can_nest_another_but_never_itself() {
        let child = comp("child", vec![clip("x", "v1", 0.0, 1.0, media("m"))]);
        let parent = comp("parent", vec![clip("n", "v1", 0.0, 1.0, ClipSource::Comp { comp_id: "child".into() })]);
        project(vec![parent.clone(), child.clone()]).validate_shape().expect("nesting is fine");
        let mut looped = child;
        looped.clips.push(clip("back", "v2", 0.0, 1.0, ClipSource::Comp { comp_id: "parent".into() }));
        assert!(project(vec![parent, looped]).validate_shape().expect_err("cycle").contains("itself"));
    }

    #[test]
    fn speed_reads_more_source_and_text_clips_become_graphics() {
        let mut fast = clip("a", "v1", 3.0, 2.0, media("m"));
        fast.in_point = 1.0;
        fast.speed = 2.0;
        assert!((fast.source_out() - 5.0).abs() < 1e-9);
        assert!((fast.end() - 5.0).abs() < 1e-9);
        let text = clip("t", "v2", 1.0, 2.5, ClipSource::Text { text: "Hi".into(), subtitle: "there".into(), preset: Preset::Caption, color: "#FFFFFF".into(), style: Some("hormozi".into()), vertical: false });
        let graphic = Graphic::from_clip(&text).expect("text");
        assert_eq!((graphic.start, graphic.duration, graphic.style.as_deref()), (1.0, 2.5, Some("hormozi")));
        assert!(Graphic::from_clip(&fast).is_none());
        let comp = comp("c", vec![fast, text]);
        assert!((comp.duration() - 5.0).abs() < 1e-9);
    }

    #[test]
    fn html_motion_graphics_export_their_visible_text() {
        let card = clip("g", "v2", 2.0, 3.0, ClipSource::Html {
            html: "<div class=\"mgt-card\"><h1>DAILY</h1><p>AI streams &amp; news</p></div>".into(),
            css: None,
            js: Some("timeline.to('.mgt-card', {x: 100})".into()),
            title: Some("Daily card".into()),
            template: None,
            layout_box: None,
            frames: None,
        });
        let graphic = Graphic::from_clip(&card).expect("html graphic");
        assert_eq!(graphic.text, "DAILY AI streams & news");
        assert_eq!((graphic.start, graphic.duration), (2.0, 3.0));
        // Title alone carries the message when the markup has no text nodes.
        let bare = clip("b", "v2", 0.0, 1.0, ClipSource::Html {
            html: "<div></div>".into(),
            css: None,
            js: None,
            title: Some("Lower third".into()),
            template: None,
            layout_box: None,
            frames: None,
        });
        assert_eq!(Graphic::from_clip(&bare).expect("title fallback").text, "Lower third");
        // Nothing to say means nothing to draw — still skipped, not blank.
        let empty = clip("e", "v2", 0.0, 1.0, ClipSource::Html { html: "<br/>".into(), css: None, js: None, title: None, template: None, layout_box: None, frames: None });
        assert!(Graphic::from_clip(&empty).is_none());
    }
}
