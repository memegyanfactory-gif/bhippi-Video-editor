//! Sound: every audible audio track of a comp, mixed.
//!
//! Semantics the preview mirrors:
//! - Only clips on audio tracks make sound; a picture-track clip never does, and a frame hold is
//!   silent. Solo beats mute (`Comp::audible`).
//! - A clip reads `[in, in + duration · speed)` of its source, backwards when `reverse` is set.
//!   `maintain_pitch` keeps the pitch (`atempo`); without it the pitch follows the speed.
//! - Channels are remapped, speech cleanup applied, then the clip's `volume` (linear, keyframed
//!   per frame when it has keys), then transition fades.
//! - Everything lands at 48 kHz stereo, summed without normalisation, and the whole mix passes a
//!   gentle limiter.

use super::{keyframe_expr, num, Graph, MAX_DEPTH, SAMPLE_RATE};
use crate::library::AssetKind;
use crate::project::{Channels, Clip, ClipSource, Comp, ItemKind, TrackKind, TransitionKind};

/// A source stream plus the silence that belongs in front of it (the part of the clip that
/// reaches past its source).
struct Voice {
    label: String,
    lead: f64,
}

/// A clip's transition fades: the windows to fade in and out over, and their shape.
struct Crossfade {
    head: Option<(f64, f64)>,
    tail: Option<(f64, f64)>,
    curve: &'static str,
}

impl<'a> Graph<'a> {
    /// Mixes `samples` samples from comp time `t0`; `None` when nothing is audible.
    pub(super) fn comp_audio(&mut self, comp: &'a Comp, t0: f64, samples: u64, depth: usize) -> Result<Option<String>, String> {
        if depth > MAX_DEPTH {
            return Ok(None);
        }
        let rate = f64::from(SAMPLE_RATE);
        let end = t0 + samples as f64 / rate;
        let tracks: Vec<String> = comp.tracks_of(TrackKind::Audio).filter(|track| comp.audible(track)).map(|track| track.id.clone()).collect();
        let mut voices: Vec<String> = Vec::new();
        for track_id in tracks {
            for clip in comp.clips_on(&track_id).into_iter().filter(|clip| clip.enabled) {
                let (mut head, mut tail, mut curve) = (None, None, "qsin");
                for transition in comp.transitions.iter().filter(|item| item.track_id == track_id && item.kind.is_audio()) {
                    let Some(window) = transition.window(comp) else { continue };
                    if transition.to_clip.as_deref() == Some(clip.id.as_str()) {
                        head = Some(window);
                        curve = fade_curve(transition.kind);
                    }
                    if transition.from_clip.as_deref() == Some(clip.id.as_str()) {
                        tail = Some(window);
                        curve = fade_curve(transition.kind);
                    }
                }
                let from = head.map_or(clip.start, |(a, _)| a.min(clip.start)).max(t0);
                let to = tail.map_or(clip.end(), |(_, b)| b.max(clip.end())).min(end);
                if to - from < 1e-6 {
                    continue;
                }
                if let Some(label) = self.voice(clip, (from, to), &Crossfade { head, tail, curve }, t0, depth)? {
                    let track = comp.tracks.iter().find(|track| track.id == track_id);
                    voices.push(match track.and_then(track_stage) {
                        Some(stage) => self.chain(&[label], &stage),
                        None => label,
                    });
                }
            }
        }
        if voices.is_empty() {
            return Ok(None);
        }
        let mix = if voices.len() == 1 { voices.remove(0) } else { self.chain(&voices, &format!("amix=inputs={}:normalize=0:duration=longest:dropout_transition=0", voices.len())) };
        Ok(Some(self.chain(&[mix], &format!("apad=whole_len={samples},atrim=end_sample={samples}"))))
    }

    /// One clip's sound, gained, faded and placed at its start.
    fn voice(&mut self, clip: &'a Clip, window: (f64, f64), fades: &Crossfade, t0: f64, depth: usize) -> Result<Option<String>, String> {
        let rate = f64::from(SAMPLE_RATE);
        let (from, to) = window;
        let length = to - from;
        let tau = from - clip.start;
        let Some(voice) = self.sound(clip, tau, length, depth)? else { return Ok(None) };
        let mut parts: Vec<String> = Vec::new();
        if clip.reverse {
            parts.push("areverse".to_owned());
        }
        if (clip.speed - 1.0).abs() > 1e-6 {
            if clip.maintain_pitch {
                parts.push(tempo(clip.speed));
            } else {
                parts.push(format!("asetrate={},aresample={SAMPLE_RATE}", num(rate * clip.speed)));
            }
        }
        if voice.lead > 1.0 / rate {
            parts.push(format!("adelay=delays={}S:all=1", (voice.lead * rate).round()));
        }
        if let Some(pan) = pan(clip.channels) {
            parts.push(pan.to_owned());
        }
        if clip.enhance_speech {
            parts.push("highpass=f=80,afftdn=nf=-25,acompressor=threshold=-18dB:ratio=3:attack=5:release=120,alimiter=limit=0.95:level=0:latency=1".to_owned());
        }
        if clip.keyframes.volume.is_empty() {
            if (clip.volume - 1.0).abs() > 1e-6 {
                parts.push(format!("volume={}", num(clip.volume.max(0.0))));
            }
        } else if let Some(expr) = keyframe_expr(&clip.keyframes.volume, &format!("(t+{})", num(tau))) {
            parts.push(format!("volume=volume='max(0,{expr})':eval=frame"));
        }
        let curve = fades.curve;
        if let Some((a, b)) = fades.head {
            parts.push(format!("afade=t=in:st={}:d={}:curve={curve}", num((a - from).max(0.0)), num((b - a).max(1e-3))));
        }
        if let Some((a, b)) = fades.tail {
            parts.push(format!("afade=t=out:st={}:d={}:curve={curve}", num((a - from).max(0.0)), num((b - a).max(1e-3))));
        }
        let samples = (length * rate).round().max(1.0);
        parts.push(format!("apad,atrim=end_sample={samples}"));
        let offset = ((from - t0) * rate).round().max(0.0);
        if offset >= 1.0 {
            parts.push(format!("adelay=delays={offset}S:all=1"));
        }
        Ok(Some(self.chain(&[voice.label], &parts.join(","))))
    }

    /// The clip's raw sound at 48 kHz stereo, starting where the segment does.
    fn sound(&mut self, clip: &'a Clip, tau: f64, length: f64, depth: usize) -> Result<Option<Voice>, String> {
        if clip.hold.is_some() {
            return Ok(None);
        }
        let (project, assets) = (self.project, self.assets);
        let format = format!("asetpts=PTS-STARTPTS,aresample={SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo");
        match &clip.source {
            ClipSource::Media { asset_id } => {
                let asset = assets.get(asset_id).ok_or("a clip refers to media that was removed")?;
                if asset.kind == AssetKind::Image || !asset.has_audio {
                    return Ok(None);
                }
                Ok(self.sound_file(clip, &asset.path.clone(), asset.duration.max(0.0), tau, length, &format))
            }
            ClipSource::Sfx { kind } => {
                let path = (self.sfx)(*kind);
                Ok(self.sound_file(clip, &path, kind.length(), tau, length, &format))
            }
            ClipSource::Comp { comp_id } => {
                let child = project.comp(comp_id).ok_or("a clip nests a comp that was deleted")?;
                let (a, b, lead) = self.window(clip, tau, length, child.duration().max(0.0));
                if b - a < 1e-4 {
                    return Ok(None);
                }
                let samples = ((b - a) * f64::from(SAMPLE_RATE)).round().max(1.0) as u64;
                let Some(mix) = self.comp_audio(child, a, samples, depth + 1)? else { return Ok(None) };
                Ok(Some(Voice { label: mix, lead }))
            }
            ClipSource::Item { item_id } => {
                let item = project.item(item_id).ok_or("a clip uses an item that was deleted")?;
                if !item.kind.has_audio() {
                    return Ok(None);
                }
                let (a, _, lead) = self.window(clip, tau, length, f64::MAX / 4.0);
                let expr = if item.kind == ItemKind::BarsAndTone {
                    // A 1 kHz tone at −20 dBFS.
                    "0.1*sin(2*PI*1000*t)".to_owned()
                } else {
                    beeps(clip, item.duration, a)
                };
                let label = self.chain(&[], &format!("aevalsrc=exprs='{expr}':s={SAMPLE_RATE}:d={},{format}", num(length + 1.0)));
                Ok(Some(Voice { label, lead }))
            }
            ClipSource::Text { .. } | ClipSource::Shape { .. } | ClipSource::Html { .. } | ClipSource::Motion { .. } => Ok(None),
        }
    }

    /// The source window a segment reads, clamped to what exists, plus the silence in front.
    fn window(&self, clip: &Clip, tau: f64, length: f64, source: f64) -> (f64, f64, f64) {
        let covered = length * clip.speed;
        let edge = clip.in_point + if clip.reverse { (clip.duration - tau) * clip.speed } else { tau * clip.speed };
        let (lo, hi) = if clip.reverse { (edge - covered, edge) } else { (edge, edge + covered) };
        let (a, b) = (lo.clamp(0.0, source), hi.clamp(0.0, source));
        let lead = ((if clip.reverse { hi - b } else { a - lo }) / clip.speed).max(0.0);
        (a, b, lead)
    }

    fn sound_file(&mut self, clip: &Clip, path: &str, source: f64, tau: f64, length: f64, format: &str) -> Option<Voice> {
        let (a, b, lead) = self.window(clip, tau, length, source);
        if b - a < 1e-4 {
            return None;
        }
        let index = self.input(vec!["-ss".into(), num(a), "-t".into(), num(b - a), "-i".into(), path.to_owned()]);
        let label = self.chain(&[format!("{index}:a:0")], format);
        Some(Voice { label, lead })
    }
}

/// Speed without changing pitch, in stages `atempo` handles well.
fn tempo(speed: f64) -> String {
    let mut stages: Vec<f64> = Vec::new();
    let mut remaining = speed;
    while remaining > 2.0 {
        stages.push(2.0);
        remaining /= 2.0;
    }
    while remaining < 0.5 {
        stages.push(0.5);
        remaining *= 2.0;
    }
    if (remaining - 1.0).abs() > 1e-6 {
        stages.push(remaining);
    }
    stages.iter().map(|stage| format!("atempo={}", num(*stage))).collect::<Vec<_>>().join(",")
}

const fn pan(channels: Channels) -> Option<&'static str> {
    match channels {
        Channels::Stereo => None,
        Channels::Mono => Some("pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1"),
        Channels::Left => Some("pan=stereo|c0=c0|c1=c0"),
        Channels::Right => Some("pan=stereo|c0=c1|c1=c1"),
        Channels::Swap => Some("pan=stereo|c0=c1|c1=c0"),
    }
}

const fn fade_curve(kind: TransitionKind) -> &'static str {
    match kind {
        TransitionKind::ConstantGain => "tri",
        TransitionKind::ExponentialFade => "exp",
        _ => "qsin",
    }
}

/// The countdown leader's beep: 0.08 s of 1 kHz at −12 dBFS each time the number changes — every
/// whole second of source time, and at the clip's first frame so the first number is announced.
fn beeps(clip: &Clip, duration: f64, start: f64) -> String {
    let step = if clip.reverse { -clip.speed } else { clip.speed };
    let seconds = format!("({}+t*{})", num(start), num(step));
    let width = num(0.08 * clip.speed);
    let fraction = num(duration - duration.floor());
    format!("0.2512*sin(2*PI*1000*t)*gte({seconds},0)*lt({seconds},{})*max(lt(mod({seconds}-{fraction}+1,1),{width}),lt({seconds},{width}))", num(duration))
}

#[cfg(test)]
mod tests {
    use super::{pan, tempo};
    use crate::project::Channels;

    #[test]
    fn tempo_stages_stay_inside_what_atempo_handles() {
        assert_eq!(tempo(1.0), "");
        assert_eq!(tempo(2.0), "atempo=2");
        assert_eq!(tempo(8.0), "atempo=2,atempo=2,atempo=2");
        let slow = tempo(0.05);
        assert_eq!(slow.matches("atempo=0.5").count(), 4, "{slow}");
        let product: f64 = slow.split(',').filter_map(|stage| stage.trim_start_matches("atempo=").parse::<f64>().ok()).product();
        assert!((product - 0.05).abs() < 1e-9, "{slow} multiplies to {product}");
    }

    #[test]
    fn channel_mappings_cover_premieres_choices() {
        assert!(pan(Channels::Stereo).is_none());
        assert_eq!(pan(Channels::Swap), Some("pan=stereo|c0=c1|c1=c0"));
        assert!(pan(Channels::Mono).is_some_and(|filter| filter.contains("0.5*c0+0.5*c1")));
    }
}

/// A track's fader and balance as filters (None at unity and centre). Balance, not equal-power
/// panning: the far side keeps full level and the near side is turned down, as the preview does.
fn track_stage(track: &crate::project::Track) -> Option<String> {
    let mut parts = Vec::new();
    if track.gain.abs() > 1e-3 {
        parts.push(format!("volume={}dB", num(track.gain.clamp(-60.0, 24.0))));
    }
    let pan = track.pan.clamp(-1.0, 1.0);
    if pan.abs() > 1e-3 {
        let (left, right) = ((1.0 - pan).min(1.0), (1.0 + pan).min(1.0));
        parts.push(format!("pan=stereo|c0={}*c0|c1={}*c1", num(left), num(right)));
    }
    (!parts.is_empty()).then(|| parts.join(","))
}

#[cfg(test)]
mod track_stage_tests {
    use super::track_stage;
    use crate::project::fixtures;

    #[test]
    fn a_track_fader_and_balance_become_filters_only_when_set() {
        let mut track = fixtures::track("a1", crate::project::TrackKind::Audio);
        assert_eq!(track_stage(&track), None);
        track.gain = -6.0;
        track.pan = 0.5;
        assert_eq!(track_stage(&track).as_deref(), Some("volume=-6dB,pan=stereo|c0=0.5*c0|c1=1*c1"));
    }
}

