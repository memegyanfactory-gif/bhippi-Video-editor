//! The picture: every video track of a comp composited bottom to top.
//!
//! Semantics the preview mirrors, per clip:
//! - Source window: the clip shows `[in, in + duration * speed)` of its source over its timeline
//!   length; `reverse` plays that window backwards, `hold` freezes one source time.
//! - Picture: mask (fractions of the source) → flips → crop (percent per edge, of the *source's*
//!   own edges) → fit/fill scale × `scale` → colour effects (CSS order: brightness, contrast,
//!   saturate, hue-rotate, invert, blur) → rotation clockwise about the crop's centre → opacity →
//!   the crop's centre placed at `(W/2 + x·W, H/2 + y·H)`. What falls outside the frame is cut.
//! - Keyframed x, y, scale, rotation and opacity replace their static values and are evaluated
//!   per frame.
//! - Adjustment clips draw nothing: their effects (and mask and opacity) apply to everything
//!   composited below them while they are on screen.
//! - A transition renders both of its clips over its whole window, extending them past their cut
//!   with source frames when there are any and with a held edge frame when there are not.

use super::text::Placement;
use super::{hex, keyframe_expr, keyframe_value, num, raster, text, Frame, Graph, Span, MAX_DEPTH};
use crate::library::{Asset, AssetKind};
use crate::project::{HtmlFrames, Clip, ClipSource, Comp, Effects, FitMode, Graphic, Interpolation, ItemKind, Keyframe, Mask, MaskShape, Preset, ProjectItem, TrackKind, TransitionKind};

/// What a clip on a video track contributes to the picture.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Role {
    Picture,
    Adjust,
    Text,
    Nothing,
}

/// A transition's frame range on a track, with the clips it joins.
struct Window<'c> {
    from: i64,
    to: i64,
    kind: TransitionKind,
    out: Option<&'c Clip>,
    into: Option<&'c Clip>,
}

/// One stretch of a track's picture: a clip, or a transition holding both of its clips.
enum Piece<'c> {
    Clip { clip: &'c Clip, from: i64, to: i64 },
    Blend { kind: TransitionKind, out: Option<&'c Clip>, into: Option<&'c Clip>, window: (i64, i64), from: i64, to: i64 },
}

impl Piece<'_> {
    const fn from(&self) -> i64 {
        match self {
            Self::Clip { from, .. } | Self::Blend { from, .. } => *from,
        }
    }

    const fn to(&self) -> i64 {
        match self {
            Self::Clip { to, .. } | Self::Blend { to, .. } => *to,
        }
    }
}

/// A clip's frames, already conformed to the output rate and frame count.
struct Source {
    label: String,
    /// Source pixels.
    w: f64,
    h: f64,
    /// Output pixels per source pixel at 100 % scale, for pictures that are never fitted to the
    /// frame (shapes). `None` fits or fills like footage.
    natural: Option<f64>,
}

/// Source seconds shown at clip-local time `tau` (which may fall outside the clip, for
/// transitions that extend it).
fn source_time(clip: &Clip, tau: f64) -> f64 {
    match clip.hold {
        Some(hold) => hold.max(0.0),
        None if clip.reverse => clip.in_point + (clip.duration - tau) * clip.speed,
        None => clip.in_point + tau * clip.speed,
    }
}

impl<'a> Graph<'a> {
    /// Renders `span` of `comp` into a `frame`-sized gbrap stream.
    pub(super) fn comp_video(&mut self, comp: &'a Comp, frame: Frame, span: Span, transparent: bool, depth: usize) -> Result<String, String> {
        if depth > MAX_DEPTH {
            return Err("comps are nested too deeply to render".to_owned());
        }
        let colour = if transparent { "black@0" } else { "black" };
        let mut current = self.chain(&[], &format!("color=c={colour}:s={}x{}:r={},format=gbrap,trim=end_frame={},setsar=1", frame.w, frame.h, self.rate.text(), span.frames));
        let tracks: Vec<String> = comp.tracks_of(TrackKind::Video).filter(|track| !track.hidden).map(|track| track.id.clone()).collect();
        for track_id in tracks {
            let clips: Vec<&'a Clip> = comp.clips_on(&track_id).into_iter().filter(|clip| clip.enabled).collect();
            let pieces = self.pieces(comp, &track_id, &clips, span);
            if !pieces.is_empty() {
                current = self.track_picture(frame, span, pieces, current, depth)?;
            }
            let adjustments: Vec<&'a Clip> = clips.iter().copied().filter(|clip| self.role(clip) == Role::Adjust).collect();
            for clip in adjustments {
                current = self.adjustment(clip, frame, span, current);
            }
            current = self.track_text(comp, &track_id, &clips, frame, span, current);
        }
        Ok(current)
    }

    fn role(&self, clip: &Clip) -> Role {
        match &clip.source {
            ClipSource::Sfx { .. } => Role::Nothing,
            ClipSource::Text { .. } if !clip.adjustment => Role::Text,
            ClipSource::Html { frames: Some(_), .. } if !clip.adjustment => Role::Picture,
            ClipSource::Html { .. } if !clip.adjustment => Role::Text,
            ClipSource::Motion { frames: Some(_), .. } if !clip.adjustment => Role::Picture,
            ClipSource::Motion { .. } => Role::Nothing,
            ClipSource::Media { asset_id } if self.assets.get(asset_id).is_some_and(|asset| asset.kind == AssetKind::Audio) => Role::Nothing,
            ClipSource::Item { item_id } => match self.project.item(item_id).map(|item| item.kind) {
                Some(ItemKind::AdjustmentLayer) => Role::Adjust,
                None | Some(ItemKind::TransparentVideo) => Role::Nothing,
                Some(_) if clip.adjustment => Role::Adjust,
                Some(_) => Role::Picture,
            },
            _ if clip.adjustment => Role::Adjust,
            _ => Role::Picture,
        }
    }

    /// The stretches a track's picture is made of, in order and never overlapping.
    fn pieces(&self, comp: &'a Comp, track_id: &str, clips: &[&'a Clip], span: Span) -> Vec<Piece<'a>> {
        let total = span.frames as i64;
        let pictures: Vec<&'a Clip> = clips.iter().copied().filter(|clip| self.role(clip) == Role::Picture).collect();
        let mut windows: Vec<Window<'a>> = Vec::new();
        for transition in comp.transitions.iter().filter(|item| item.track_id == track_id && !item.kind.is_audio()) {
            let find = |id: &Option<String>| id.as_deref().and_then(|id| pictures.iter().copied().find(|clip| clip.id == id));
            let (out, into) = (find(&transition.from_clip), find(&transition.to_clip));
            if out.is_none() && into.is_none() {
                continue;
            }
            let Some((a, b)) = transition.window(comp) else { continue };
            windows.push(Window { from: self.frame_at(span, a), to: self.frame_at(span, b), kind: transition.kind, out, into });
        }
        windows.sort_by_key(|window| window.from);
        let mut last = i64::MIN;
        windows.retain_mut(|window| {
            window.from = window.from.max(last);
            if window.from >= window.to {
                return false;
            }
            last = window.to;
            true
        });

        let mut pieces: Vec<Piece<'a>> = Vec::new();
        for window in &windows {
            let (from, to) = (window.from.max(0), window.to.min(total));
            if from < to {
                pieces.push(Piece::Blend { kind: window.kind, out: window.out, into: window.into, window: (window.from, window.to), from, to });
            }
        }
        for clip in &pictures {
            let (start, end) = (self.frame_at(span, clip.start), self.frame_at(span, clip.end()));
            let mut cursor = start;
            let mut add = |from: i64, to: i64| {
                let (from, to) = (from.max(0), to.min(total));
                if from < to {
                    pieces.push(Piece::Clip { clip, from, to });
                }
            };
            for window in &windows {
                if window.to <= cursor || window.from >= end {
                    continue;
                }
                if window.from > cursor {
                    add(cursor, window.from.min(end));
                }
                cursor = cursor.max(window.to);
            }
            if cursor < end {
                add(cursor, end);
            }
        }
        pieces.sort_by_key(Piece::from);
        pieces
    }

    /// One concatenated stream per track, overlaid onto the composite once.
    fn track_picture(&mut self, frame: Frame, span: Span, pieces: Vec<Piece<'a>>, current: String, depth: usize) -> Result<String, String> {
        let total = span.frames as i64;
        let mut segments: Vec<String> = Vec::new();
        let mut spans: Vec<(i64, i64)> = Vec::new();
        let mut cursor = 0;
        for piece in &pieces {
            let (from, to) = (piece.from(), piece.to());
            if from < cursor {
                continue;
            }
            let label = match piece {
                Piece::Clip { clip, .. } => self.picture(clip, frame, span, from, to, depth)?,
                Piece::Blend { kind, out, into, window, .. } => Some(self.transition(*kind, *out, *into, *window, (from, to), frame, span, depth)?),
            };
            let Some(label) = label else { continue };
            if from > cursor {
                let gap = self.gap(frame, from - cursor);
                segments.push(gap);
            }
            segments.push(label);
            spans.push((from, to));
            cursor = to;
        }
        if segments.is_empty() {
            return Ok(current);
        }
        if cursor < total {
            let gap = self.gap(frame, total - cursor);
            segments.push(gap);
        }
        let track = if segments.len() == 1 { segments.remove(0) } else { self.chain(&segments, &format!("concat=n={}:v=1:a=0", segments.len())) };
        // Blending is skipped on frames where the track shows nothing at all.
        let merged = merge(&spans);
        let enable = if merged.len() <= 32 && merged.first() != Some(&(0, total)) {
            format!(":enable='{}'", merged.iter().map(|(a, b)| format!("between(n,{a},{})", b - 1)).collect::<Vec<_>>().join("+"))
        } else {
            String::new()
        };
        Ok(self.chain(&[current, track], &format!("overlay=format=gbrp:eof_action=pass{enable}")))
    }

    /// Transparent filler for the frames a track shows nothing.
    fn gap(&mut self, frame: Frame, frames: i64) -> String {
        self.chain(&[], &format!("color=c=black@0:s={}x{}:r={},format=gbrap,trim=end_frame={frames},setsar=1", frame.w, frame.h, self.rate.text()))
    }

    /// A clip's picture over frames `from..to`, as a full frame; `None` when it draws nothing.
    fn picture(&mut self, clip: &'a Clip, frame: Frame, span: Span, from: i64, to: i64, depth: usize) -> Result<Option<String>, String> {
        let frames = (to - from) as u64;
        let tau = span.t0 + from as f64 / self.fps() - clip.start;
        let Some(source) = self.source(clip, frame, tau, frames, depth)? else { return Ok(None) };
        Ok(self.place(clip, frame, source, tau, frames))
    }

    fn source(&mut self, clip: &'a Clip, frame: Frame, tau: f64, frames: u64, depth: usize) -> Result<Option<Source>, String> {
        let (project, assets) = (self.project, self.assets);
        match &clip.source {
            ClipSource::Media { asset_id } => {
                let asset = assets.get(asset_id).ok_or("a clip refers to media that was removed")?;
                Ok(match asset.kind {
                    AssetKind::Audio => None,
                    AssetKind::Image => Some(self.still(asset, frames)),
                    AssetKind::Video => Some(self.media(clip, asset, tau, frames)),
                })
            }
            ClipSource::Comp { comp_id } => {
                let child = project.comp(comp_id).ok_or("a clip nests a comp that was deleted")?;
                self.nested(clip, child, frame, tau, frames, depth)
            }
            ClipSource::Item { item_id } => {
                let item = project.item(item_id).ok_or("a clip uses an item that was deleted")?;
                Ok(self.item(clip, item, frame, tau, frames))
            }
            ClipSource::Shape { .. } => Ok(self.shape(clip, frame, frames)),
            ClipSource::Html { frames: Some(rendered), .. } | ClipSource::Motion { frames: Some(rendered), .. } => Ok(Some(self.html_frames(rendered, tau, frames))),
            ClipSource::Text { .. } | ClipSource::Sfx { .. } | ClipSource::Html { .. } | ClipSource::Motion { .. } => Ok(None),
        }
    }

    /// Frames with timestamps exactly `N / fps`, holding the edge frame where the source runs out.
    fn conform(&self, lead: u64, frames: u64) -> String {
        format!("tpad=start_mode=clone:start={lead}:stop_mode=clone:stop={frames},trim=end_frame={frames},{}", self.retimed())
    }

    /// Resampling to the output rate: whole frames, blended, or motion-compensated.
    fn interpolation(&self, clip: &Clip, source_fps: f64) -> String {
        let rate = self.rate.text();
        if (source_fps / clip.speed - self.fps()).abs() < 1e-3 {
            return format!("fps={rate}");
        }
        match clip.interpolation {
            Interpolation::Sampling => format!("fps={rate}"),
            Interpolation::Blending => format!("framerate=fps={rate}"),
            Interpolation::OpticalFlow => format!("minterpolate=fps={rate}:mi_mode=mci"),
        }
    }

    fn media(&mut self, clip: &Clip, asset: &Asset, tau: f64, frames: u64) -> Source {
        let fps = self.fps();
        let source_fps = asset.fps.filter(|value| value.is_finite() && *value > 0.0).unwrap_or(fps);
        let length = asset.duration.max(0.0);
        let step = 1.0 / source_fps;
        let path = asset.path.clone();
        let deinterlace = if clip.deinterlace { "yadif," } else { "" };
        let speed = if (clip.speed - 1.0).abs() > 1e-9 { format!("setpts=(PTS-STARTPTS)/{},", num(clip.speed)) } else { String::new() };
        let covered = frames as f64 / fps * clip.speed;
        let edge = source_time(clip, tau);
        let (lo, hi) = if clip.reverse { (edge - covered, edge) } else { (edge, edge + covered) };
        let (a, b) = (lo.clamp(0.0, length), hi.clamp(0.0, length));
        let label = if clip.hold.is_some() || b - a < 2.0 * step || a > length - 1.5 * step {
            let time = match clip.hold {
                Some(hold) => hold.clamp(0.0, length),
                None if clip.reverse => b,
                None => a,
            };
            self.frozen(&path, time, length, deinterlace, frames)
        } else {
            // Frames the window asks for before the source starts (or after it ends, backwards)
            // are the edge frame held.
            let lead = ((if clip.reverse { hi - b } else { a - lo }) / clip.speed * fps).round().max(0.0) as u64;
            let raw = if clip.reverse {
                self.reversed(&path, a, b, deinterlace, asset)
            } else {
                let index = self.input(vec!["-ss".into(), num(a), "-t".into(), num(b - a + 2.0 * step), "-i".into(), path.clone()]);
                self.chain(&[format!("{index}:v:0")], &format!("{deinterlace}setpts=PTS-STARTPTS"))
            };
            self.chain(&[raw], &format!("{speed}{},{}", self.interpolation(clip, source_fps), self.conform(lead, frames)))
        };
        Source { label, w: f64::from(asset.width.max(1)), h: f64::from(asset.height.max(1)), natural: None }
    }

    /// One source frame, held for the whole segment.
    fn frozen(&mut self, path: &str, time: f64, length: f64, deinterlace: &str, frames: u64) -> String {
        let last = length > 0.0 && time > length - 0.5;
        let index = if last {
            self.input(vec!["-sseof".into(), num(-length.min(0.5)), "-i".into(), path.to_owned()])
        } else {
            self.input(vec!["-ss".into(), num(time.max(0.0)), "-t".into(), "0.5".into(), "-i".into(), path.to_owned()])
        };
        let pick = if last { "reverse," } else { "" };
        self.chain(&[format!("{index}:v:0")], &format!("{deinterlace}{pick}trim=end_frame=1,setpts=0,{}", self.conform(0, frames)))
    }

    /// Backwards playback, read in chunks so `reverse` never buffers the whole clip.
    fn reversed(&mut self, path: &str, a: f64, b: f64, deinterlace: &str, asset: &Asset) -> String {
        let pixels = f64::from(asset.width.max(1)) * f64::from(asset.height.max(1));
        let mut chunk = (4.0 * 2_073_600.0 / pixels).clamp(0.5, 8.0);
        if (b - a) / chunk > 32.0 {
            chunk = (b - a) / 32.0;
        }
        let mut parts: Vec<String> = Vec::new();
        let mut top = b;
        while top > a + 1e-6 {
            let bottom = (top - chunk).max(a);
            let index = self.input(vec!["-ss".into(), num(bottom), "-t".into(), num(top - bottom), "-i".into(), path.to_owned()]);
            parts.push(self.chain(&[format!("{index}:v:0")], &format!("{deinterlace}reverse,setpts=PTS-STARTPTS")));
            top = bottom;
        }
        if parts.len() == 1 {
            parts.remove(0)
        } else {
            self.chain(&parts, &format!("concat=n={}:v=1:a=0", parts.len()))
        }
    }

    /// A motion graphic the frontend rendered to a PNG sequence with alpha. Frame `k` of the
    /// sequence is the graphic `k / fps` seconds after the clip's first frame; the export reads
    /// from the frame nearest `tau` and holds the last frame if the sequence runs out.
    fn html_frames(&mut self, rendered: &HtmlFrames, tau: f64, frames: u64) -> Source {
        let rate = rendered.fps.max(1.0);
        let first = ((tau.max(0.0) * rate).round() as u64).min(rendered.frames.saturating_sub(1));
        // A transition can show the clip before its first frame (tau < 0): the preview holds the
        // first frame there, so the sequence starts that many output frames late.
        let lead = ((-tau).max(0.0) * self.fps()).round() as u64;
        let dir = rendered.dir.trim_end_matches(|c| c == '/' || c == '\\');
        let pattern = format!("{dir}/%05d.png");
        let index = self.input(vec!["-framerate".into(), num(rate), "-start_number".into(), first.to_string(), "-i".into(), pattern]);
        let label = self.chain(&[format!("{index}:v:0")], &format!("format=rgba,setpts=PTS-STARTPTS,fps={},{}", self.rate.text(), self.conform(lead.min(frames), frames)));
        Source { label, w: f64::from(rendered.width.max(1)), h: f64::from(rendered.height.max(1)), natural: None }
    }

    fn still(&mut self, asset: &Asset, frames: u64) -> Source {
        let index = self.input(vec!["-i".into(), asset.path.clone()]);
        let label = self.chain(&[format!("{index}:v:0")], &format!("loop=loop=-1:size=1,{}", self.conform(0, frames)));
        Source { label, w: f64::from(asset.width.max(1)), h: f64::from(asset.height.max(1)), natural: None }
    }

    fn nested(&mut self, clip: &'a Clip, child: &'a Comp, frame: Frame, tau: f64, frames: u64, depth: usize) -> Result<Option<Source>, String> {
        let fps = self.fps();
        let w = (f64::from(child.width) * frame.ratio).round().clamp(2.0, raster::MAX_SIDE);
        let h = (f64::from(child.height) * frame.ratio).round().clamp(2.0, raster::MAX_SIDE);
        let inner = Frame { w: w as u32, h: h as u32, ratio: h / f64::from(child.height) };
        let length = child.duration().max(0.0);
        let covered = frames as f64 / fps * clip.speed;
        let edge = source_time(clip, tau);
        let (lo, hi) = if clip.reverse { (edge - covered, edge) } else { (edge, edge + covered) };
        let (a, b) = (lo.clamp(0.0, length), hi.clamp(0.0, length));
        let label = if clip.hold.is_some() || b - a < 1.0 / fps {
            let time = match clip.hold {
                Some(hold) => hold.clamp(0.0, length),
                None if clip.reverse => b,
                None => a,
            };
            let single = self.comp_video(child, inner, Span { t0: time, frames: 1 }, true, depth + 1)?;
            self.chain(&[single], &self.conform(0, frames))
        } else {
            let lead = ((if clip.reverse { hi - b } else { a - lo }) / clip.speed * fps).round().max(0.0) as u64;
            let inner_frames = ((b - a) * fps - 1e-6).ceil().max(1.0) as u64;
            let rendered = if clip.reverse {
                // Chunked like media, so one long reversed nest cannot eat all the memory.
                let chunks = ((inner_frames as f64 / (3.0 * fps)).ceil() as u64).clamp(1, 8);
                let per = inner_frames.div_ceil(chunks);
                let mut parts = Vec::new();
                for index in (0..chunks).rev() {
                    let start = index * per;
                    let count = per.min(inner_frames.saturating_sub(start));
                    if count == 0 {
                        continue;
                    }
                    let part = self.comp_video(child, inner, Span { t0: a + start as f64 / fps, frames: count }, true, depth + 1)?;
                    parts.push(self.chain(&[part], "reverse,setpts=PTS-STARTPTS"));
                }
                if parts.len() == 1 { parts.remove(0) } else { self.chain(&parts, &format!("concat=n={}:v=1:a=0", parts.len())) }
            } else {
                self.comp_video(child, inner, Span { t0: a, frames: inner_frames }, true, depth + 1)?
            };
            let speed = if (clip.speed - 1.0).abs() > 1e-9 { format!("setpts=(PTS-STARTPTS)/{},fps={},", num(clip.speed), self.rate.text()) } else { String::new() };
            self.chain(&[rendered], &format!("{speed}{}", self.conform(lead, frames)))
        };
        Ok(Some(Source { label, w, h, natural: None }))
    }

    fn item(&mut self, clip: &Clip, item: &ProjectItem, frame: Frame, tau: f64, frames: u64) -> Option<Source> {
        let w = (f64::from(item.width) * frame.ratio).round().clamp(2.0, raster::MAX_SIDE);
        let h = (f64::from(item.height) * frame.ratio).round().clamp(2.0, raster::MAX_SIDE);
        let size = format!("s={}x{}:r={}", w as u32, h as u32, self.rate.text());
        let body = match item.kind {
            ItemKind::ColorMatte => format!("color=c=0x{}:{size}", hex(&item.color)),
            ItemKind::BlackVideo => format!("color=c=black:{size}"),
            // The classic SMPTE pattern (75 % bars, castellations, PLUGE) the preview draws.
            ItemKind::BarsAndTone => format!("smptebars={size}"),
            ItemKind::Countdown => format!("color=c=0x111111:{size}"),
            ItemKind::TransparentVideo | ItemKind::AdjustmentLayer => return None,
        };
        let mut chain = format!("{body},trim=end_frame={frames},format=gbrap,setsar=1");
        if item.kind == ItemKind::Countdown {
            chain.push(',');
            chain.push_str(&countdown(clip, item, h, tau));
        }
        let label = self.chain(&[], &chain);
        Some(Source { label, w, h, natural: None })
    }

    fn shape(&mut self, clip: &Clip, frame: Frame, frames: u64) -> Option<Source> {
        let ClipSource::Shape { shape, sides, fill, stroke, stroke_width, width, height, corner_radius } = &clip.source else { return None };
        let peak = if clip.keyframes.scale.is_empty() {
            clip.transform.scale
        } else {
            clip.keyframes.scale.iter().map(|key| key.value).fold(f64::MIN, f64::max)
        } / 100.0;
        if peak <= 0.0 {
            return None;
        }
        let mut factor = frame.ratio * peak;
        let longest = (width.max(*height) + stroke_width) * factor;
        if longest > raster::MAX_SIDE {
            factor *= raster::MAX_SIDE / longest;
        }
        let image = raster::shape(*shape, *sides, fill.as_deref(), stroke.as_deref(), stroke_width * factor, width * factor, height * factor, corner_radius * factor)?;
        let (w, h) = (f64::from(image.width), f64::from(image.height));
        let name = self.file("shape", "pam", raster::pam(&image));
        let index = self.input(vec!["-i".into(), name]);
        let label = self.chain(&[format!("{index}:v:0")], &format!("loop=loop=-1:size=1,{},format=gbrap", self.conform(0, frames)));
        Some(Source { label, w, h, natural: Some(frame.ratio / factor) })
    }

    /// Multiplies a mask into the picture's alpha, before anything moves it.
    fn masked(&mut self, label: String, mask: &Mask, w: f64, h: f64, frames: u64) -> String {
        let factor = (1920.0 / w.max(h).max(1.0)).min(1.0);
        let (mw, mh) = ((w * factor).round().max(1.0) as u32, (h * factor).round().max(1.0) as u32);
        let matte = raster::mask(mask, mw, mh);
        let name = self.file("mask", "pgm", raster::pgm(mw, mh, &matte));
        let index = self.input(vec!["-i".into(), name]);
        let gray = self.chain(&[format!("{index}:v:0")], &format!("format=gray,loop=loop=-1:size=1,{},scale={}:{}:flags={}", self.conform(0, frames), w.round(), h.round(), self.scaler));
        let picture = self.chain(&[label], "format=gbrap");
        let (keep, extract) = self.split(&picture);
        let alpha = self.chain(&[extract], "alphaextract");
        let multiplied = self.chain(&[alpha, gray], "blend=all_mode=multiply:shortest=1");
        self.chain(&[keep, multiplied], "alphamerge")
    }

    /// Applies a cached local Roto matte to the picture's alpha. The matte is a greyscale
    /// video with one frame per analyzed source frame; it is looped so short rounding
    /// differences at the tail can never reveal the background.
    fn roto_matted(&mut self, label: String, matte: &str, clip: &Clip, tau: f64, w: f64, h: f64, frames: u64) -> String {
        let gray = self.matte_stream(matte, clip, tau, w, h, frames, "gray16le");
        let picture = self.chain(&[label], "format=gbrap16le");
        let (keep, extract) = self.split(&picture);
        let alpha = self.chain(&[extract], "alphaextract");
        let mut corrected = gray;
        for item in &clip.roto_corrections {
            let radius = (item.radius.clamp(0.001, 1.0) * w.min(h)).max(1.0);
            let feather = (radius * item.softness.clamp(0.0, 1.0)).max(0.001);
            let strength = format!("clip(({}-sqrt(pow(X+0.5-{},2)+pow(Y+0.5-{},2)))/{},0,1)", num(radius), num(item.x.clamp(0.0,1.0)*w), num(item.y.clamp(0.0,1.0)*h), num(feather));
            let changed = if item.mode == "include" { format!("max(lum(X,Y),65535*({strength}))") } else { format!("min(lum(X,Y),65535*(1-({strength})))") };
            // Corrections are deliberately frame-local until tracked propagation is implemented.
            let at = (item.at * self.fps()).floor() / self.fps();
            corrected = self.chain(&[corrected], &format!("geq=lum='if(between(T+{},{},{}),{},lum(X,Y))'", num(tau), num(at), num(at+0.999/self.fps()), changed));
        }
        let multiplied = self.chain(&[alpha, corrected], "blend=all_mode=multiply:shortest=1");
        self.chain(&[keep, multiplied], "alphamerge")
    }

    /// A cached matte video (Roto or Magic Mask) as a greyscale stream on the clip's timing,
    /// `w`×`h`, in pixel format `format`.
    #[allow(clippy::too_many_arguments)]
    fn matte_stream(&mut self, matte: &str, clip: &Clip, tau: f64, w: f64, h: f64, frames: u64, format: &str) -> String {
        let metadata = std::path::Path::new(matte).parent().and_then(|p| std::fs::read_to_string(p.join("roto.json")).ok()).and_then(|s| serde_json::from_str::<crate::roto::Roto>(&s).ok());
        let origin = metadata.as_ref().and_then(|r| r.subjects.first()).map_or(clip.in_point, |s| s.at);
        let duration = metadata.as_ref().map_or(clip.duration * clip.speed, |r| r.frames as f64 / r.fps);
        let edge = source_time(clip, tau) - origin;
        let covered = frames as f64 / self.fps() * clip.speed;
        let start = if clip.reverse { edge - covered } else { edge }.max(0.0);
        let index = self.input(vec!["-ss".into(), num(start.min((duration - 0.001).max(0.0))), "-i".into(), matte.to_owned()]);
        let timing = if clip.hold.is_some() { "trim=end_frame=1,setpts=0,".to_owned() }
            else if clip.reverse { format!("trim=duration={},reverse,setpts=(PTS-STARTPTS)/{},", num(covered), num(clip.speed)) }
            else { format!("setpts=(PTS-STARTPTS)/{},", num(clip.speed)) };
        self.chain(&[format!("{index}:v:0")], &format!(
            "{timing}fps={},format={format},scale={}:{}:flags=lanczos,{}",
            self.rate.text(), w.round(), h.round(), self.conform(0, frames)
        ))
    }

    /// Effects limited to a Magic Mask, in stack order, each blended in through its mask:
    /// `maskedmerge` keeps the untouched picture where the mask is black and the effected one where
    /// it is white. Runs at source resolution, before the picture is placed, so the mask lines up
    /// pixel for pixel; `fx_height` is the frame height as seen from the source, which sizes the
    /// effects exactly as the whole-clip stack sizes them after scaling. The preview draws the same
    /// thing (editor/MagicMaskLayer.tsx): masked effects first, the whole-clip stack over them.
    #[allow(clippy::too_many_arguments)]
    fn magic_masked(&mut self, mut label: String, clip: &Clip, tau: f64, w: f64, h: f64, frames: u64, fx_height: u32) -> String {
        for fx in &clip.applied_effects {
            if fx["enabled"].as_bool() == Some(false) {
                continue;
            }
            let Scope::Masked(mask, outside) = scope(clip, fx) else { continue };
            let Some(matte) = mask.matte.as_deref() else { continue };
            let chain = self.effect_chain(std::slice::from_ref(fx), fx_height, "");
            if chain.is_empty() {
                continue;
            }
            let gray = self.matte_stream(matte, clip, tau, w, h, frames, "gray");
            let px = h / 1080.0;
            let mut refine: Vec<String> = Vec::new();
            let grow = (mask.expand * px).round().clamp(-40.0, 40.0) as i64;
            for _ in 0..grow.unsigned_abs() {
                refine.push(if grow > 0 { "dilation" } else { "erosion" }.to_owned());
            }
            if mask.feather > 0.0 {
                refine.push(format!("gblur=sigma={}", num((mask.feather * px / 2.0).min(200.0))));
            }
            if mask.invert != outside {
                refine.push("negate".to_owned());
            }
            refine.push("format=gbrap".to_owned());
            let weight = self.chain(&[gray], &refine.join(","));
            let picture = self.chain(&[label], "format=gbrap");
            let (keep, source) = self.split(&picture);
            let changed = self.chain(&[source], &format!("format=gbrap,{},format=gbrap", chain.join(",")));
            label = self.chain(&[keep, changed, weight], "maskedmerge");
        }
        label
    }

    /// Alpha for a clip: a plain multiplier, or one driven per frame by keyframes.
    fn opacity(&mut self, clip: &Clip, tau: f64) -> Option<String> {
        if clip.keyframes.opacity.is_empty() {
            return (clip.transform.opacity < 100.0).then(|| format!("colorchannelmixer=aa={}", num((clip.transform.opacity / 100.0).clamp(0.0, 1.0))));
        }
        let id = self.unique();
        let expr = keyframe_expr(&clip.keyframes.opacity, &time_expr("T", tau))?;
        let start = keyframe_value(&clip.keyframes.opacity, tau).unwrap_or(100.0) / 100.0;
        let name = self.file("keys", "txt", format!("0-86400 [expr] colorchannelmixer@o{id} aa 'clip(({expr})/100,0,1)';\n").into_bytes());
        Some(format!("sendcmd=f={name},colorchannelmixer@o{id}=aa={}", num(start.clamp(0.0, 1.0))))
    }

    /// Crops, colours, rotates and positions a source into a full frame.
    fn place(&mut self, clip: &Clip, frame: Frame, source: Source, tau: f64, frames: u64) -> Option<String> {
        let transform = &clip.transform;
        let keys = &clip.keyframes;
        let (width, height) = (f64::from(frame.w), f64::from(frame.h));
        let mut label = source.label;
        if let Some(matte) = clip.roto_matte.as_deref() {
            label = self.roto_matted(label, matte, clip, tau, source.w, source.h, frames);
        }
        if let Some(mask) = usable(clip.mask.as_ref()) {
            label = self.masked(label, mask, source.w, source.h, frames);
        }
        let mut parts: Vec<String> = vec!["format=gbrap".to_owned()];
        if clip.effects.flip_h {
            parts.push("hflip".to_owned());
        }
        if clip.effects.flip_v {
            parts.push("vflip".to_owned());
        }
        // Crop percentages name the source's own edges, so a flip swaps which edge they trim.
        let (mut left, mut right) = (transform.crop_left, transform.crop_right);
        let (mut top, mut bottom) = (transform.crop_top, transform.crop_bottom);
        if clip.effects.flip_h {
            std::mem::swap(&mut left, &mut right);
        }
        if clip.effects.flip_v {
            std::mem::swap(&mut top, &mut bottom);
        }
        let crop_w = source.w * (1.0 - (left + right) / 100.0);
        let crop_h = source.h * (1.0 - (top + bottom) / 100.0);
        if crop_w < 1.0 || crop_h < 1.0 {
            return None;
        }
        let unit = source.natural.unwrap_or_else(|| {
            let (x, y) = (width / crop_w, height / crop_h);
            if transform.fit == FitMode::Fit { x.min(y) } else { x.max(y) }
        });
        let animated = !keys.is_empty() && (!keys.x.is_empty() || !keys.y.is_empty() || !keys.scale.is_empty() || !keys.rotation.is_empty());
        let origin = (source.w * left / 100.0, source.h * top / 100.0);
        if animated {
            self.animated(clip, frame, &mut parts, source.w, source.h, (origin, crop_w, crop_h), unit, tau);
        } else if !self.fixed(clip, frame, &mut parts, source.w, source.h, (origin, crop_w, crop_h), unit, tau) {
            return None;
        }
        // `scale` keeps the display aspect by changing the sample aspect; concat and xfade insist
        // every segment agrees, so square pixels are forced back on.
        parts.push("setsar=1".to_owned());
        if clip.applied_effects.iter().any(|fx| matches!(scope(clip, fx), Scope::Masked(..))) {
            let fx_height = (f64::from(frame.h) / (unit * transform.scale.max(0.01) / 100.0)).round().clamp(2.0, 16384.0) as u32;
            label = self.magic_masked(label, clip, tau, source.w, source.h, frames, fx_height);
        }
        let body = parts.join(",");
        let placed = self.chain(&[label], &body);
        if animated {
            let canvas = self.gap(frame, frames as i64);
            let (x, y) = (
                keyframe_expr(&keys.x, &time_expr("t", tau)).unwrap_or_else(|| num(transform.x)),
                keyframe_expr(&keys.y, &time_expr("t", tau)).unwrap_or_else(|| num(transform.y)),
            );
            let position = format!(
                "overlay=format=gbrp:eval=frame:x='{}+({x})*{}-overlay_w/2':y='{}+({y})*{}-overlay_h/2'",
                num(width / 2.0),
                num(width),
                num(height / 2.0),
                num(height)
            );
            Some(self.chain(&[canvas, placed], &position))
        } else {
            Some(placed)
        }
    }

    /// The still transform: only the part of the picture that lands in the frame is ever scaled.
    #[allow(clippy::too_many_arguments)]
    fn fixed(&mut self, clip: &Clip, frame: Frame, parts: &mut Vec<String>, sw: f64, sh: f64, crop: ((f64, f64), f64, f64), unit: f64, tau: f64) -> bool {
        let (width, height) = (f64::from(frame.w), f64::from(frame.h));
        let transform = &clip.transform;
        let ((ox, oy), crop_w, crop_h) = crop;
        let factor = unit * transform.scale / 100.0;
        let (display_w, display_h) = (crop_w * factor, crop_h * factor);
        if display_w < 0.5 || display_h < 0.5 {
            return false;
        }
        let centre = (width / 2.0 + transform.x * width, height / 2.0 + transform.y * height);
        let radians = transform.rotation.to_radians();
        let (cos, sin) = (radians.cos(), radians.sin());
        let margin = clip.effects.blur * height / 1080.0 * 3.0 + 2.0;
        // The frame, seen from the unrotated picture: everything outside can be thrown away.
        let corners = [(0.0, 0.0), (width, 0.0), (0.0, height), (width, height)];
        let local: Vec<(f64, f64)> = corners
            .iter()
            .map(|(x, y)| {
                let (dx, dy) = (x - centre.0, y - centre.1);
                (dx * cos + dy * sin, -dx * sin + dy * cos)
            })
            .collect();
        let bound = |pick: fn(&(f64, f64)) -> f64, worst: f64, fold: fn(f64, f64) -> f64| local.iter().map(pick).fold(worst, fold);
        let u0 = (bound(|p| p.0, f64::INFINITY, f64::min) - margin + display_w / 2.0).floor().max(0.0);
        let u1 = (bound(|p| p.0, f64::NEG_INFINITY, f64::max) + margin + display_w / 2.0).ceil().min(display_w);
        let v0 = (bound(|p| p.1, f64::INFINITY, f64::min) - margin + display_h / 2.0).floor().max(0.0);
        let v1 = (bound(|p| p.1, f64::NEG_INFINITY, f64::max) + margin + display_h / 2.0).ceil().min(display_h);
        if u1 - u0 < 0.5 || v1 - v0 < 0.5 {
            return false;
        }
        let (sx0, sx1) = ((u0 / factor).floor().max(0.0), (u1 / factor).ceil().min(crop_w));
        let (sy0, sy1) = ((v0 / factor).floor().max(0.0), (v1 / factor).ceil().min(crop_h));
        if let Some(cut) = crop_filter(ox + sx0, oy + sy0, sx1 - sx0, sy1 - sy0, sw, sh) {
            parts.push(cut);
        }
        let (scaled_w, scaled_h) = (((sx1 - sx0) * factor).round().max(1.0), ((sy1 - sy0) * factor).round().max(1.0));
        parts.push(format!("scale={scaled_w}:{scaled_h}:flags={}", self.scaler));
        let (px, py) = ((u0 - sx0 * factor).round().clamp(0.0, scaled_w - 1.0), (v0 - sy0 * factor).round().clamp(0.0, scaled_h - 1.0));
        let (pw, ph) = ((u1 - u0).round().clamp(1.0, scaled_w - px), (v1 - v0).round().clamp(1.0, scaled_h - py));
        if pw < scaled_w || ph < scaled_h {
            parts.push(format!("crop={pw}:{ph}:{px}:{py}"));
        }
        parts.extend(effects(&clip.effects, frame.h, ""));
        parts.extend(self.stack_effects(clip, frame.h, ""));
        if let Some(alpha) = self.opacity(clip, tau) {
            parts.push(alpha);
        }
        // Where the piece's centre lands once the picture is turned about its own centre.
        let piece = (sx0 * factor + px + pw / 2.0 - display_w / 2.0, sy0 * factor + py + ph / 2.0 - display_h / 2.0);
        let (bw, bh) = if radians == 0.0 {
            (pw, ph)
        } else {
            let (bw, bh) = ((pw * cos.abs() + ph * sin.abs()).ceil(), (pw * sin.abs() + ph * cos.abs()).ceil());
            parts.push(format!("rotate=a={}:ow={bw}:oh={bh}:c=black@0", num(radians)));
            (bw, bh)
        };
        let landed = (centre.0 + piece.0 * cos - piece.1 * sin, centre.1 + piece.0 * sin + piece.1 * cos);
        let (x, y) = ((landed.0 - bw / 2.0).round(), (landed.1 - bh / 2.0).round());
        let (cx0, cy0) = ((-x).max(0.0), (-y).max(0.0));
        let (cx1, cy1) = (bw.min(width - x), bh.min(height - y));
        if cx1 - cx0 < 1.0 || cy1 - cy0 < 1.0 {
            return false;
        }
        if (cx0, cy0, cx1, cy1) != (0.0, 0.0, bw, bh) {
            parts.push(format!("crop={}:{}:{cx0}:{cy0}", cx1 - cx0, cy1 - cy0));
        }
        if (cx1 - cx0, cy1 - cy0) != (width, height) || x + cx0 != 0.0 || y + cy0 != 0.0 {
            parts.push(format!("pad={}:{}:{}:{}:color=black@0", frame.w, frame.h, x + cx0, y + cy0));
        }
        true
    }

    /// The keyframed transform: the picture is drawn once at its largest and moved per frame.
    #[allow(clippy::too_many_arguments)]
    fn animated(&mut self, clip: &Clip, frame: Frame, parts: &mut Vec<String>, sw: f64, sh: f64, crop: ((f64, f64), f64, f64), unit: f64, tau: f64) {
        let (width, height) = (f64::from(frame.w), f64::from(frame.h));
        let keys = &clip.keyframes;
        let ((ox, oy), crop_w, crop_h) = crop;
        let peak = if keys.scale.is_empty() { clip.transform.scale } else { keys.scale.iter().map(|key| key.value).fold(f64::MIN, f64::max) }.max(0.01);
        let mut factor = unit * peak / 100.0;
        let cap = 4.0 * width.max(height);
        let largest = (crop_w * factor).max(crop_h * factor);
        if largest > cap {
            factor *= cap / largest;
        }
        if let Some(cut) = crop_filter(ox, oy, crop_w, crop_h, sw, sh) {
            parts.push(cut);
        }
        parts.push(format!("scale={}:{}:flags={}", (crop_w * factor).round().max(1.0), (crop_h * factor).round().max(1.0), self.scaler));
        parts.extend(effects(&clip.effects, frame.h, ""));
        parts.extend(self.stack_effects(clip, frame.h, ""));
        if let Some(alpha) = self.opacity(clip, tau) {
            parts.push(alpha);
        }
        let rotation = keyframe_expr(&keys.rotation, &time_expr("t", tau)).unwrap_or_else(|| num(clip.transform.rotation));
        if !keys.rotation.is_empty() || clip.transform.rotation != 0.0 {
            parts.push(format!("rotate=a='({rotation})*PI/180':ow='hypot(iw,ih)':oh='hypot(iw,ih)':c=black@0"));
        }
        if !keys.scale.is_empty() {
            let scale = keyframe_expr(&keys.scale, &time_expr("t", tau)).unwrap_or_else(|| num(clip.transform.scale));
            let ratio = format!("max(0.002,({scale})/{})", num(peak));
            parts.push(format!("scale=w='max(2,iw*{ratio})':h='max(2,ih*{ratio})':eval=frame:flags={}", self.scaler));
        }
    }

    /// Both sides of a transition over its whole window, cut back to the visible part.
    #[allow(clippy::too_many_arguments)]
    fn transition(&mut self, kind: TransitionKind, out: Option<&'a Clip>, into: Option<&'a Clip>, window: (i64, i64), visible: (i64, i64), frame: Frame, span: Span, depth: usize) -> Result<String, String> {
        let (fa, fb) = window;
        let length = fb - fa;
        let mut sides = Vec::new();
        let mut drawn = [false; 2];
        for (index, clip) in [out, into].into_iter().enumerate() {
            let label = match clip {
                Some(clip) => self.picture(clip, frame, span, fa, fb, depth)?,
                None => None,
            };
            drawn[index] = label.is_some();
            sides.push(match label {
                Some(label) => label,
                None => self.gap(frame, length),
            });
        }
        let (start, end) = (visible.0 - fa, visible.1 - fa);
        let cut = format!("tpad=stop_mode=clone:stop=1,trim=start_frame={start}:end_frame={end},{}", self.conform(0, (end - start) as u64));
        let seconds = length as f64 / self.fps();
        let d = num(seconds.clamp(1e-3, 60.0));
        // One-sided transitions (a fade in from nothing, a fade out at the end) follow the
        // preview's single-clip rules, not a blend with the empty side: xfade on straight alpha
        // would darken the colour as well as the alpha, and a dip would reach its colour at the
        // half-way point and then show nothing.
        let single = match drawn {
            [true, false] => Some(0),
            [false, true] => Some(1),
            _ => None,
        };
        let joined = match (kind, single) {
            (TransitionKind::DipToBlack | TransitionKind::DipToWhite, Some(side)) => {
                // The dip colour covers the clip in proportion to how far it is from the cut.
                let colour = if kind == TransitionKind::DipToBlack { "black" } else { "white" };
                let way = if side == 0 { "out" } else { "in" };
                self.filters.push(format!("[{}]nullsink", sides[1 - side]));
                self.chain(&[sides[side].clone()], &format!("fade=t={way}:st=0:d={d}:color={colour}"))
            }
            (TransitionKind::CrossDissolve | TransitionKind::FilmDissolve | TransitionKind::AdditiveDissolve, Some(side))
            | (TransitionKind::SlideLeft | TransitionKind::SlideRight | TransitionKind::SlideUp | TransitionKind::SlideDown, Some(side @ 0)) => {
                // Opacity only: the clip fades against whatever is below it.
                let way = if side == 0 { "out" } else { "in" };
                self.filters.push(format!("[{}]nullsink", sides[1 - side]));
                self.chain(&[sides[side].clone()], &format!("fade=t={way}:st=0:d={d}:alpha=1"))
            }
            (TransitionKind::DipToBlack | TransitionKind::DipToWhite, None) if length >= 2 => {
                let colour = if kind == TransitionKind::DipToBlack { "black" } else { "white" };
                let half = length / 2;
                let first = self.chain(&[sides[0].clone()], &format!("trim=end_frame={half},fade=t=out:st=0:d={}:color={colour},{}", num(half as f64 / self.fps()), self.conform(0, half as u64)));
                let second = self.chain(
                    &[sides[1].clone()],
                    &format!("trim=start_frame={half},setpts=PTS-STARTPTS,fade=t=in:st=0:d={}:color={colour},{}", num((length - half) as f64 / self.fps()), self.conform(0, (length - half) as u64)),
                );
                self.chain(&[first, second], "concat=n=2:v=1:a=0")
            }
            _ => {
                let mode = if single == Some(0) { mode_single_out(kind) } else { None }.unwrap_or_else(|| mode(kind));
                self.chain(&sides, &format!("xfade=transition={mode}:duration={d}:offset=0"))
            }
        };
        Ok(self.chain(&[joined], &cut))
    }

    /// Burns a track's text clips over what is composited so far.
    fn track_text(&mut self, comp: &'a Comp, track_id: &str, clips: &[&'a Clip], frame: Frame, span: Span, current: String) -> String {
        let end = span.t0 + span.frames as f64 / self.fps();
        let mut current=current;
        for clip in clips {
            if self.role(clip) != Role::Text { continue; }
            if clip.end()<=span.t0 || clip.start>=end {continue;}
            let Some(graphic)=Graphic::from_clip(clip) else {continue;};
            let items=vec![(graphic,placement(comp,clip,frame,track_id))];
            let name=self.file("text","ass",text::script(&items,frame.w,frame.h).into_bytes());
            let (before,after)=if span.t0.abs()>1e-9 {(format!("setpts=round(PTS+{}/TB),",num(span.t0)),format!(",setpts=round(PTS-{}/TB)",num(span.t0)))}else{(String::new(),String::new())};
            let burn=format!("{before}ass=filename={name}:alpha=1{after}");
            let mut parts=effects(&clip.effects,frame.h,"");
            parts.extend(self.stack_effects(clip,frame.h,""));
            if parts.is_empty() {
                // Nothing to apply to the text alone: libass blends straight onto the composite,
                // pixel-identical to drawing a transparent layer and overlaying it, at a quarter
                // of the cost of a full-frame overlay per frame.
                current=self.chain(&[current],&burn);
                continue;
            }
            parts.insert(0,burn);
            let gap=self.gap(frame,span.frames as i64);
            let layer=self.chain(&[gap],&parts.join(","));
            current=self.chain(&[current,layer],"overlay=format=auto:alpha=straight:shortest=1");
        }
        current
    }

    /// An adjustment clip: its effects (and mask and opacity) applied to everything below.
    fn adjustment(&mut self, clip: &'a Clip, frame: Frame, span: Span, current: String) -> String {
        let total = span.frames as i64;
        let (from, to) = (self.frame_at(span, clip.start).max(0), self.frame_at(span, clip.end()).min(total));
        if from >= to {
            return current;
        }
        let enable = format!(":enable='between(n,{from},{})'", to - 1);
        let mut parts = effects(&clip.effects, frame.h, &enable);
        parts.extend(self.stack_effects(clip, frame.h, &enable));
        if clip.effects.flip_v {
            parts.insert(0, format!("vflip{enable}"));
        }
        if clip.effects.flip_h {
            parts.insert(0, format!("hflip{enable}"));
        }
        if parts.is_empty() {
            return current;
        }
        let tau = span.t0 + from as f64 / self.fps() - clip.start;
        let alpha = self.opacity(clip, tau);
        if alpha.is_none() && usable(clip.mask.as_ref()).is_none() {
            return self.chain(&[current], &parts.join(","));
        }
        let (base, branch) = self.split(&current);
        let mut label = self.chain(&[branch], &parts.join(","));
        if let Some(mask) = usable(clip.mask.as_ref()) {
            label = self.masked(label, mask, f64::from(frame.w), f64::from(frame.h), span.frames);
        }
        if let Some(alpha) = alpha {
            label = self.chain(&[label], &alpha);
        }
        self.chain(&[base, label], &format!("overlay=format=gbrp{enable}"))
    }
}

/// A mask worth rasterising: a pen mask needs at least a triangle, or the clip would vanish.
fn usable(mask: Option<&Mask>) -> Option<&Mask> {
    mask.filter(|mask| mask.shape != MaskShape::Polygon || mask.points.len() >= 3)
}

/// `t` (or sendcmd's `T`) shifted so it counts from the clip's first frame.
fn time_expr(variable: &str, tau: f64) -> String {
    if tau.abs() < 1e-9 { variable.to_owned() } else { format!("({variable}+{})", num(tau)) }
}

/// A crop to a source rectangle, as fractions of the decoded size; `None` when it is the whole
/// picture.
fn crop_filter(x: f64, y: f64, w: f64, h: f64, sw: f64, sh: f64) -> Option<String> {
    if x <= 0.5 && y <= 0.5 && w >= sw - 0.5 && h >= sh - 0.5 {
        return None;
    }
    Some(format!("crop=w=iw*{}:h=ih*{}:x=iw*{}:y=ih*{}", num(w / sw), num(h / sh), num(x / sw), num(y / sh)))
}

/// The clip's colour effects, in the order CSS applies them.
fn effects(effects: &Effects, height: u32, enable: &str) -> Vec<String> {
    if effects.is_identity() {
        return Vec::new();
    }
    let mut parts = Vec::new();
    if effects.brightness != 0.0 || effects.contrast != 0.0 {
        let expr = format!("clip((val*{}-127.5)*{}+127.5,0,255)", num(1.0 + effects.brightness / 100.0), num(1.0 + effects.contrast / 100.0));
        parts.push(format!("lutrgb=r='{expr}':g='{expr}':b='{expr}'{enable}"));
    }
    if (effects.saturation - 100.0).abs() > 1e-9 {
        let s = effects.saturation / 100.0;
        parts.push(matrix([[0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s], [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s], [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s]], enable));
    }
    if effects.hue != 0.0 {
        let (cos, sin) = (effects.hue.to_radians().cos(), effects.hue.to_radians().sin());
        parts.push(matrix(
            [
                [0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928],
                [0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.140, 0.072 - cos * 0.072 - sin * 0.283],
                [0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072],
            ],
            enable,
        ));
    }
    if effects.invert > 0.0 {
        let amount = effects.invert / 100.0;
        let expr = format!("clip(val*{}+{},0,255)", num(1.0 - 2.0 * amount), num(255.0 * amount));
        parts.push(format!("lutrgb=r='{expr}':g='{expr}':b='{expr}'{enable}"));
    }
    if effects.blur > 0.0 {
        parts.push(format!("gblur=sigma={}{enable}", num(effects.blur * f64::from(height) / 1080.0)));
    }
    parts
}

/// A colour matrix as `colorchannelmixer` reads it; alpha is untouched.
fn matrix(m: [[f64; 3]; 3], enable: &str) -> String {
    let names = [["rr", "rg", "rb"], ["gr", "gg", "gb"], ["br", "bg", "bb"]];
    let pairs: Vec<String> = (0..3).flat_map(|row| (0..3).map(move |column| format!("{}={}", names[row][column], num(m[row][column])))).collect();
    format!("colorchannelmixer={}{enable}", pairs.join(":"))
}

/// The `xfade` mode (and its expression, for the ones xfade has no mode for).
fn mode(kind: TransitionKind) -> String {
    match kind {
        TransitionKind::PushLeft => "slideleft".to_owned(),
        TransitionKind::PushRight => "slideright".to_owned(),
        TransitionKind::PushUp => "slideup".to_owned(),
        TransitionKind::PushDown => "slidedown".to_owned(),
        TransitionKind::SlideLeft => "coverleft".to_owned(),
        TransitionKind::SlideRight => "coverright".to_owned(),
        TransitionKind::SlideUp => "coverup".to_owned(),
        TransitionKind::SlideDown => "coverdown".to_owned(),
        TransitionKind::WipeLeft => "wipeleft".to_owned(),
        TransitionKind::WipeRight => "wiperight".to_owned(),
        TransitionKind::WipeUp => "wipeup".to_owned(),
        TransitionKind::WipeDown => "wipedown".to_owned(),
        TransitionKind::CrossZoom => cross_zoom(),
        // xfade's own iris modes soften and offset their edges; these are the plain shapes the
        // preview draws with a clip-path. CSS `circle(r%)` measures r against hypot(W, H) / √2,
        // so the preview's 75 % is 0.5303 of the diagonal.
        TransitionKind::IrisRound => "custom:expr='if(lt(hypot(X-W/2,Y-H/2),(1-P)*0.530330*hypot(W,H)),B,A)'".to_owned(),
        TransitionKind::IrisBox => "custom:expr='if(lt(abs(X-W/2),(1-P)*W/2)*lt(abs(Y-H/2),(1-P)*H/2),B,A)'".to_owned(),
        _ => "fade".to_owned(),
    }
}

/// A transition with only its outgoing clip, where the preview's single-clip shape differs from
/// blending into nothing: wipes and irises take the clip away (it shrinks into the iris, the
/// wipe uncovers from the side it came in from).
fn mode_single_out(kind: TransitionKind) -> Option<String> {
    Some(match kind {
        TransitionKind::WipeLeft => "wiperight".to_owned(),
        TransitionKind::WipeRight => "wipeleft".to_owned(),
        TransitionKind::WipeUp => "wipedown".to_owned(),
        TransitionKind::WipeDown => "wipeup".to_owned(),
        TransitionKind::IrisRound => "custom:expr='if(lt(hypot(X-W/2,Y-H/2),P*0.530330*hypot(W,H)),A,B)'".to_owned(),
        TransitionKind::IrisBox => "custom:expr='if(lt(abs(X-W/2),P*W/2)*lt(abs(Y-H/2),P*H/2),A,B)'".to_owned(),
        _ => return None,
    })
}

/// The preview's cross zoom: the outgoing picture grows from 1× to 2× while it fades out, the
/// incoming one settles from 2× to 1× while it fades in over it — composited "over" on straight
/// alpha, plane by plane (gbrap: 0 G, 1 B, 2 R, 3 alpha). xfade's P runs 1 → 0.
fn cross_zoom() -> String {
    let q = "(1-P)";
    let (xa, ya) = (format!("W/2+(X-W/2)/(1+{q})"), format!("H/2+(Y-H/2)/(1+{q})"));
    let (xb, yb) = (format!("W/2+(X-W/2)/(2-{q})"), format!("H/2+(Y-H/2)/(2-{q})"));
    let pick = |side: &str, x: &str, y: &str| format!("if(eq(PLANE,0),{side}0({x},{y}),if(eq(PLANE,1),{side}1({x},{y}),{side}2({x},{y})))");
    let alpha_a = format!("a3({xa},{ya})/255*P");
    let alpha_b = format!("b3({xb},{yb})/255*{q}");
    let alpha = format!("({alpha_b}+{alpha_a}*(1-{alpha_b}))");
    let colour = format!("({}*{alpha_b}+{}*{alpha_a}*(1-{alpha_b}))/max({alpha},0.000001)", pick("b", &xb, &yb), pick("a", &xa, &ya));
    format!("custom:expr='if(eq(PLANE,3),255*{alpha},{colour})'")
}

/// A text clip's placement: its own transform, plus fades from any transition on it.
fn placement(comp: &Comp, clip: &Clip, frame: Frame, track_id: &str) -> Placement {
    let keys = &clip.keyframes;
    // Text is drawn by libass, which cannot animate along our curves: a keyframed property is
    // taken at the clip's first frame.
    let at = |list: &[Keyframe], fallback: f64| if list.is_empty() { fallback } else { keyframe_value(list, 0.0).unwrap_or(fallback) };
    let vertical = matches!(&clip.source, ClipSource::Text { vertical: true, preset, style, .. } if *preset != Preset::Kinetic && style.is_none());
    let mut place = if clip.transform.is_identity() && clip.keyframes.is_empty() {
        Placement { vertical, ..Placement::default() }
    } else {
        Placement {
            dx: at(&keys.x, clip.transform.x) * f64::from(frame.w),
            dy: at(&keys.y, clip.transform.y) * f64::from(frame.h),
            scale: at(&keys.scale, clip.transform.scale) / 100.0,
            rotation: at(&keys.rotation, clip.transform.rotation),
            opacity: at(&keys.opacity, clip.transform.opacity) / 100.0,
            fade_in: 0.0,
            fade_out: 0.0,
            vertical,
        }
    };
    for transition in comp.transitions.iter().filter(|item| item.track_id == track_id && !item.kind.is_audio()) {
        let Some((a, b)) = transition.window(comp) else { continue };
        if transition.to_clip.as_deref() == Some(clip.id.as_str()) {
            place.fade_in = place.fade_in.max(b - clip.start);
        }
        if transition.from_clip.as_deref() == Some(clip.id.as_str()) {
            place.fade_out = place.fade_out.max(clip.end() - a);
        }
    }
    place
}

/// The countdown leader's crosshair and number, drawn at the item's own size.
fn countdown(clip: &Clip, item: &ProjectItem, height: f64, tau: f64) -> String {
    let thickness = (height / 540.0).round().max(2.0);
    let seconds = match clip.hold {
        Some(hold) => num(hold.max(0.0)),
        None if clip.reverse => format!("({}-t*{})", num(clip.in_point + (clip.duration - tau) * clip.speed), num(clip.speed)),
        None => format!("({}+t*{})", num(clip.in_point + tau * clip.speed), num(clip.speed)),
    };
    let number = format!("max(1\\,ceil({}-max(0\\,{seconds})-0.000001))", num(item.duration));
    format!(
        "drawbox=x=0:y=(ih-{thickness})/2:w=iw:h={thickness}:color=white@0.25:t=fill,\
         drawbox=x=(iw-{thickness})/2:y=0:w={thickness}:h=ih:color=white@0.25:t=fill,\
         drawtext=font='Segoe UI\\:style=Bold':fontsize={}:fontcolor=0x{}:x=(w-text_w)/2:y=(h-text_h)/2:text='%{{eif\\:{number}\\:d}}'",
        (height * 0.5).round(),
        hex(&item.color)
    )
}

/// Where an applied effect draws: the whole clip, inside or outside one of its Magic Masks, or
/// nowhere (it names a mask that is deleted or not tracked yet).
enum Scope<'c> {
    Whole,
    Masked(&'c crate::project::MagicMask, bool),
    Off,
}

fn scope<'c>(clip: &'c Clip, fx: &serde_json::Value) -> Scope<'c> {
    let Some(id) = fx["maskId"].as_str().filter(|id| !id.is_empty()) else { return Scope::Whole };
    match clip.magic_masks.iter().find(|mask| mask.id == id) {
        Some(mask) if mask.matte.as_deref().is_some_and(|m| !m.is_empty()) => Scope::Masked(mask, fx["maskSide"].as_str() == Some("outside")),
        _ => Scope::Off,
    }
}

/// Joins touching or overlapping frame ranges.
fn merge(spans: &[(i64, i64)]) -> Vec<(i64, i64)> {
    let mut merged: Vec<(i64, i64)> = Vec::new();
    for span in spans {
        match merged.last_mut() {
            Some(last) if span.0 <= last.1 => last.1 = last.1.max(span.1),
            _ => merged.push(*span),
        }
    }
    merged
}

impl Graph<'_> {
    /// The whole-clip effects; those limited to a Magic Mask are drawn by `magic_masked`, and
    /// those naming a mask that is gone or not tracked yet draw nothing, as in the preview.
    fn stack_effects(&mut self, clip: &Clip, height: u32, enable: &str) -> Vec<String> {
        let whole: Vec<serde_json::Value> = clip.applied_effects.iter().filter(|fx| matches!(scope(clip, fx), Scope::Whole)).cloned().collect();
        self.effect_chain(&whole, height, enable)
    }

    fn effect_chain(&mut self, list: &[serde_json::Value], height: u32, enable: &str) -> Vec<String> {
        let mut output=Vec::new();
        // The Color Studio grades the source first, whatever its place in the stack — as the
        // preview's GPU pass does (src/editor/GradeCanvas.tsx).
        let mut list: Vec<&serde_json::Value>=list.iter().collect();
        list.sort_by_key(|fx| fx["effectId"].as_str()!=Some("lumetri-color"));
        for fx in list {
            if fx["enabled"].as_bool()==Some(false) {continue;}
            let id=fx["effectId"].as_str().unwrap_or("");let p=&fx["params"];
            let n=|key:&str,default:f64|p[key].as_f64().filter(|x|x.is_finite()).unwrap_or(default);
            if id=="lumetri-color" {
                if let Some(cube)=grade_cube(p) {
                    let file=self.file("grade","cube",cube.into_bytes());
                    output.push(format!("lut3d=file='{file}':interp=trilinear{enable}"));
                }
                continue;
            }
            if let Some(tables)=p["_exportTables"].as_str().and_then(|s|serde_json::from_str::<Vec<Vec<String>>>(s).ok()) {
                if tables.len()>=3 && tables.iter().all(|t|t.len()==256 && t.iter().all(|v|v.parse::<f64>().is_ok_and(|x|x.is_finite()&&(0.0..=1.0).contains(&x)))) {
                    let mut cube=String::from("LUT_1D_SIZE 256\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n");
                    for i in 0..256 {cube.push_str(&format!("{} {} {}\n",tables[0][i],tables[1][i],tables[2][i]));}
                    let file=self.file("effect","cube",cube.into_bytes());
                    output.push(format!("lut1d=file='{file}':interp=linear{enable}"));
                    if id=="curves" && tables.len()>3 {
                        // Curves' alpha channel uses the same piecewise-linear table.
                        let values:Vec<f64>=tables[3].iter().filter_map(|s|s.parse().ok()).collect();
                        if values.iter().enumerate().any(|(i,x)|(x-i as f64/255.0).abs()>0.0001) {
                            let mut terms=vec![num(values[0]*255.0)];
                            for i in 0..255 {let delta=(values[i+1]-values[i])*255.0;if delta.abs()>1e-9{terms.push(format!("{}*clip(val-{i},0,1)",num(delta)));}}
                            let expr=super::sum_expr(terms);
                            output.push(format!("lutrgb=a='{expr}'{enable}"));
                        }
                    }
                }
            }
            match id {
                "gaussian-blur"=>{let sigma=n("blurriness",15.0).max(0.0)*f64::from(height)/1080.0;if sigma>0.0{output.push(format!("gblur=sigma={}{enable}",num(sigma)));}},
                "hue-saturation"|"color-balance-hls"=>{let mut e=Effects::default();e.hue=n("masterHue",0.0);e.saturation=(100.0+n("masterSaturation",0.0)).max(0.0);output.extend(effects(&e,height,enable));let light=n("masterLightness",0.0);if light!=0.0{let value=num((1.0+light/100.0).max(0.0));output.push(format!("lutrgb=r='clip(val*{value},0,255)':g='clip(val*{value},0,255)':b='clip(val*{value},0,255)'{enable}"));}},
                "invert"=>{let mut e=Effects::default();e.invert=n("amount",100.0);output.extend(effects(&e,height,enable));},
                "black-white"=>{let mut e=Effects::default();e.saturation=100.0-n("amount",100.0);output.extend(effects(&e,height,enable));},
                "mirror"=>{if p["flipHorizontal"].as_bool()==Some(true){output.push(format!("hflip{enable}"));}},
                "tint"=>{
                    let parse=|key:&str,default:&str|{let s=p[key].as_str().unwrap_or(default);[1..3,3..5,5..7].map(|r|s.get(r).and_then(|h|u8::from_str_radix(h,16).ok()).map_or(0.0,|v|f64::from(v)/255.0))};
                    let black=parse("mapBlackTo","#000000");let white=parse("mapWhiteTo","#ffffff");let amount=(n("amount",100.0)/100.0).clamp(0.0,1.0);
                    let rows:[String;3]=std::array::from_fn(|c|{let delta=white[c]-black[c];format!("{}*r(X,Y)+{}*g(X,Y)+{}*b(X,Y)+{}",num((if c==0{1.0-amount}else{0.0})+amount*delta*0.2126),num((if c==1{1.0-amount}else{0.0})+amount*delta*0.7152),num((if c==2{1.0-amount}else{0.0})+amount*delta*0.0722),num(amount*black[c]*255.0))});
                    output.push(format!("geq=r='{}':g='{}':b='{}':a='alpha(X,Y)'{enable}",rows[0],rows[1],rows[2]));
                },
                "4-color-gradient"=>{
                    let parse=|key:&str,default:&str|{let s=p[key].as_str().unwrap_or(default);[1..3,3..5,5..7].map(|r|s.get(r).and_then(|h|u8::from_str_radix(h,16).ok()).map_or(0.0,f64::from))};
                    let tl=parse("topLeft","#ff4040");let tr=parse("topRight","#ffff40");let bl=parse("bottomLeft","#4040ff");let br=parse("bottomRight","#40ffff");let mix=(n("mix",100.0)/100.0).clamp(0.0,1.0);
                    let rows:[String;3]=std::array::from_fn(|c|format!("{}*(({}*(1-X/max(1,W-1))+{}*X/max(1,W-1))*(1-Y/max(1,H-1))+({}*(1-X/max(1,W-1))+{}*X/max(1,W-1))*Y/max(1,H-1))+{}*{}(X,Y)",num(mix),num(tl[c]),num(tr[c]),num(bl[c]),num(br[c]),num(1.0-mix),["r","g","b"][c]));
                    output.push(format!("geq=r='{}':g='{}':b='{}':a='alpha(X,Y)'{enable}",rows[0],rows[1],rows[2]));
                },
                "keylight"|"linear-color-key"=>{
                    // The preview's key (effectFilters.tsx), term for term: the matte is a linear
                    // colour difference against the screen's channel, the picture is despilled by
                    // pulling that channel toward the other two, and the matte multiplies alpha.
                    let color_str=p.get("screenColor").or_else(||p.get("keyColor")).and_then(|v|v.as_str()).unwrap_or("#00ff00");
                    let hex=color_str.trim_start_matches('#');
                    let channel=|range:std::ops::Range<usize>|hex.get(range).and_then(|h|u8::from_str_radix(h,16).ok()).map_or(0.0,|v|f64::from(v)/255.0);
                    let (kr,kg,kb)=(channel(0..2),channel(2..4),channel(4..6));
                    let gain=n("screenGain",n("tolerance",30.0)).max(1.0)/30.0;
                    let balance=n("screenBalance",n("softness",10.0)).max(0.0)/100.0;
                    let despill=(n("despill",50.0)/100.0).clamp(0.0,1.0);
                    let blue=kb>kg&&kb>kr;
                    let (half,keep)=(num(0.5*despill),num(1.0-despill));
                    let (g,b)=if blue {
                        ("g(X,Y)".to_owned(),format!("{half}*r(X,Y)+{half}*g(X,Y)+{keep}*b(X,Y)"))
                    } else {
                        (format!("{half}*r(X,Y)+{keep}*g(X,Y)+{half}*b(X,Y)"),"b(X,Y)".to_owned())
                    };
                    let (wr,wg,wb)=if blue {(1.5*gain,1.5*gain,-3.0*gain)} else {(1.5*gain,-3.0*gain,1.5*gain)};
                    let matte=format!("clip(({}*r(X,Y)+{}*g(X,Y)+{}*b(X,Y))/255+{},0,1)",num(wr),num(wg),num(wb),num(1.0+balance));
                    output.push(format!("geq=r='r(X,Y)':g='{g}':b='{b}':a='alpha(X,Y)*{matte}'{enable}"));
                },
                "extract"=>{
                    // The preview's luma key: alpha × clamp((luma − black point) / softness).
                    let bp=n("blackPoint",25.0).clamp(0.0,255.0)/255.0;
                    let soft=(n("softness",15.0)/100.0).max(0.01);
                    let invert=p["invert"].as_bool()==Some(true);
                    let (slope,intercept)=if invert {(-1.0/soft,1.0+bp/soft)} else {(1.0/soft,-bp/soft)};
                    output.push(format!("geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*clip((0.2126*r(X,Y)+0.7152*g(X,Y)+0.0722*b(X,Y))/255*{}+{},0,1)'{enable}",num(slope),num(intercept)));
                },
                _=>{},
            }
        }
        output
    }
}

/// The Color Studio grade of an effect's params as .cube text: `_exportLut3d` holds its
/// `_lutSize`³ RGB entries (red fastest) as base64 little-endian 16-bit values, baked by
/// src/lib/effectExport.ts from the same function the preview draws with.
pub(super) fn grade_cube(params: &serde_json::Value) -> Option<String> {
    use base64::Engine;
    use std::fmt::Write as _;
    let size = params["_lutSize"].as_u64().filter(|size| (2..=65).contains(size))? as usize;
    let bytes = base64::engine::general_purpose::STANDARD.decode(params["_exportLut3d"].as_str()?).ok()?;
    if bytes.len() != size * size * size * 3 * 2 {
        return None;
    }
    let mut cube = format!("LUT_3D_SIZE {size}
DOMAIN_MIN 0 0 0
DOMAIN_MAX 1 1 1
");
    for entry in bytes.chunks_exact(6) {
        let value = |i: usize| f64::from(u16::from_le_bytes([entry[i], entry[i + 1]])) / 65535.0;
        let _ = writeln!(cube, "{:.6} {:.6} {:.6}", value(0), value(2), value(4));
    }
    Some(cube)
}

#[cfg(test)]
mod grade_tests {
    use super::grade_cube;
    use base64::Engine;

    #[test]
    fn a_baked_grade_becomes_a_cube_and_a_broken_one_does_not() {
        let size = 2usize;
        let values: Vec<u16> = (0..size * size * size * 3).map(|i| if i % 3 == 0 { 65535 } else { 0 }).collect();
        let bytes: Vec<u8> = values.iter().flat_map(|v| v.to_le_bytes()).collect();
        let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
        let cube = grade_cube(&serde_json::json!({"_exportLut3d": encoded, "_lutSize": 2})).expect("a cube");
        assert!(cube.starts_with("LUT_3D_SIZE 2\n"));
        assert_eq!(cube.lines().filter(|line| line.starts_with("1.000000 0.000000 0.000000")).count(), 8);
        assert!(grade_cube(&serde_json::json!({"_exportLut3d": encoded, "_lutSize": 3})).is_none(), "wrong size");
        assert!(grade_cube(&serde_json::json!({"_lutSize": 2})).is_none(), "no table");
        assert!(grade_cube(&serde_json::json!({"_exportLut3d": "not base64!", "_lutSize": 2})).is_none());
    }
}
