//! A bespoke music bed, composed and mixed here: what the strong models used to write as a
//! 500-line numpy script (kick, pumping sub, pad, pluck arp, claps, hats, a riser into each drop,
//! an impact on it, a room, a limiter) as one parametric synthesiser, so every model gets a real
//! score for its video with no generator installed.
//!
//! The arrangement follows the video: intro, groove, a one-bar build into each drop, the drop,
//! and a ring-out on the last bar. The beat grid is exact, so the caller knows every beat and
//! downbeat without detecting them. Oscillators are PolyBLEP saws through state-variable filters
//! (cheap enough for a minute of stereo in well under a second of CPU per voice).

use serde::{Deserialize, Serialize};
use std::f64::consts::{PI, TAU};

const RATE: u32 = 48_000;
const HZ: f64 = RATE as f64;
/// The sample-peak ceiling the master is limited to: −2 dBFS, so the true (inter-sample) peak
/// stays under −1.5 dBFS.
const CEILING: f64 = 0.794;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Mood {
    /// Four on the floor, pumping sub, 16th arp, claps: launches, reels, motion showreels.
    Energetic,
    /// Half-time, warm pad, soft 8th plucks: vlogs, tutorials, calm product walkthroughs.
    Chill,
    /// No groove until the drop: sub pulses, a wide pad, an ostinato, big hits.
    Cinematic,
    /// Light four on the floor, bright major plucks: SaaS explainers, brand videos.
    Corporate,
    /// Bouncy major staccato plucks, claps, 8th hats: fun, kids, food, memes.
    Playful,
    /// Minor, low detuned pad, sparse kick and ticks: tension, true crime, tech noir.
    Dark,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreSpec {
    pub duration: f64,
    pub bpm: f64,
    pub mood: Mood,
    /// MIDI note of the key's root (57 = A). Octaves are chosen per instrument.
    #[serde(default = "default_root")]
    pub root: i32,
    /// Minor key; the mood's own key when absent.
    #[serde(default)]
    pub minor: Option<bool>,
    /// Seconds where the music drops (a hit, full band). One is chosen when empty and the mood
    /// has a drop; pass `[]` with `no_drop` for a flat bed.
    #[serde(default)]
    pub drops: Vec<f64>,
    #[serde(default)]
    pub no_drop: bool,
    /// Seconds that get a crash or a soft hit (scene changes), besides the drops.
    #[serde(default)]
    pub accents: Vec<f64>,
    /// 0–1: how full and bright it plays (default 0.7).
    #[serde(default)]
    pub intensity: Option<f64>,
    #[serde(default)]
    pub seed: Option<u64>,
}

const fn default_root() -> i32 {
    57
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Score {
    #[serde(skip)]
    pub frames: Vec<[f64; 2]>,
    pub bpm: f64,
    pub duration: f64,
    /// Every beat, in seconds from the start of the file.
    pub beats: Vec<f64>,
    /// The first beat of every bar.
    pub downbeats: Vec<f64>,
    pub drops: Vec<f64>,
    /// What plays, in words, for the tool's summary.
    pub arrangement: String,
}

struct Noise(u64);

impl Noise {
    fn next(&mut self) -> f64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        ((self.0 >> 11) as f64 / (1u64 << 53) as f64) * 2.0 - 1.0
    }
}

/// Topology-preserving state-variable filter (as in sfx.rs): (low, band, high).
#[derive(Default, Clone)]
struct Svf {
    ic1: f64,
    ic2: f64,
}

impl Svf {
    fn run(&mut self, input: f64, cutoff: f64, q: f64) -> (f64, f64, f64) {
        let g = (PI * cutoff.clamp(20.0, 0.45 * HZ) / HZ).tan();
        let k = 1.0 / q.max(0.1);
        let a1 = 1.0 / (1.0 + g * (g + k));
        let a2 = g * a1;
        let a3 = g * a2;
        let v3 = input - self.ic2;
        let v1 = a1 * self.ic1 + a2 * v3;
        let v2 = self.ic2 + a2 * self.ic1 + a3 * v3;
        self.ic1 = 2.0 * v1 - self.ic1;
        self.ic2 = 2.0 * v2 - self.ic2;
        (v2, v1, input - k * v1 - v2)
    }
}

/// Band-limited saw by PolyBLEP; `phase` in [0, 1).
fn blep(t: f64, dt: f64) -> f64 {
    if t < dt {
        let x = t / dt;
        x + x - x * x - 1.0
    } else if t > 1.0 - dt {
        let x = (t - 1.0) / dt;
        x * x + x + x + 1.0
    } else {
        0.0
    }
}

#[derive(Clone, Copy)]
struct Saw {
    phase: f64,
}

impl Saw {
    fn next(&mut self, freq: f64) -> f64 {
        let dt = (freq / HZ).min(0.49);
        let out = 2.0 * self.phase - 1.0 - blep(self.phase, dt);
        self.phase += dt;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }
        out
    }
}

fn hz(midi: f64) -> f64 {
    440.0 * 2f64.powf((midi - 69.0) / 12.0)
}

/// A stereo bus of `len` frames with a clamp-safe adder.
struct Bus(Vec<[f64; 2]>);

impl Bus {
    fn new(len: usize) -> Self {
        Self(vec![[0.0; 2]; len])
    }
    fn add(&mut self, at: usize, left: f64, right: f64) {
        if let Some(frame) = self.0.get_mut(at) {
            frame[0] += left;
            frame[1] += right;
        }
    }
    /// Mixes a mono one-shot at `time` seconds with `gain` and `pan` (−1 left … 1 right).
    fn shot(&mut self, sound: &[f64], time: f64, gain: f64, pan: f64) {
        let start = (time * HZ).round().max(0.0) as usize;
        let (left, right) = (gain * (1.0 - pan.max(0.0)), gain * (1.0 + pan.min(0.0)));
        for (index, sample) in sound.iter().enumerate() {
            self.add(start + index, sample * left, sample * right);
        }
    }
}

/// The mood's instruments, levels and colour.
struct Voicing {
    minor: bool,
    /// Kick pattern in beats within a bar; empty = no kick before the drop.
    kick: &'static [f64],
    clap: &'static [f64],
    /// Hat steps per beat (2 = off-beat 8ths, 4 = 16ths); 0 = none.
    hats: u32,
    /// Arp steps per beat; 0 = none.
    arp: u32,
    arp_decay: f64,
    pad_bright: f64,
    pad_level: f64,
    sub_pump: f64,
    has_drop: bool,
    /// The whole groove waits for the first drop (cinematic).
    hold_groove: bool,
}

fn voicing(mood: Mood) -> Voicing {
    match mood {
        Mood::Energetic => Voicing { minor: true, kick: &[0.0, 1.0, 2.0, 3.0], clap: &[1.0, 3.0], hats: 2, arp: 4, arp_decay: 0.15, pad_bright: 1.0, pad_level: 0.42, sub_pump: 0.9, has_drop: true, hold_groove: false },
        Mood::Chill => Voicing { minor: false, kick: &[0.0, 2.5], clap: &[2.0], hats: 4, arp: 2, arp_decay: 0.3, pad_bright: 0.55, pad_level: 0.5, sub_pump: 0.5, has_drop: false, hold_groove: false },
        Mood::Cinematic => Voicing { minor: true, kick: &[0.0, 2.0], clap: &[], hats: 0, arp: 2, arp_decay: 0.25, pad_bright: 0.7, pad_level: 0.6, sub_pump: 0.3, has_drop: true, hold_groove: true },
        Mood::Corporate => Voicing { minor: false, kick: &[0.0, 1.0, 2.0, 3.0], clap: &[1.0, 3.0], hats: 2, arp: 2, arp_decay: 0.18, pad_bright: 0.9, pad_level: 0.38, sub_pump: 0.6, has_drop: false, hold_groove: false },
        Mood::Playful => Voicing { minor: false, kick: &[0.0, 2.0], clap: &[1.0, 3.0], hats: 2, arp: 2, arp_decay: 0.09, pad_bright: 0.8, pad_level: 0.3, sub_pump: 0.4, has_drop: false, hold_groove: false },
        Mood::Dark => Voicing { minor: true, kick: &[0.0, 1.5], clap: &[3.0], hats: 4, arp: 0, arp_decay: 0.2, pad_bright: 0.4, pad_level: 0.55, sub_pump: 0.7, has_drop: true, hold_groove: false },
    }
}

/// The chord of bar `bar`: (root offset in semitones, minor triad).
fn chord(minor: bool, bar: usize) -> (i32, bool) {
    // i–VI–III–VII (Am F C G) and I–V–vi–IV (C G Am F).
    const MINOR: [(i32, bool); 4] = [(0, true), (-4, false), (3, false), (-2, false)];
    const MAJOR: [(i32, bool); 4] = [(0, false), (7, false), (-3, true), (5, false)];
    if minor { MINOR[bar % 4] } else { MAJOR[bar % 4] }
}

fn triad(root: i32, minor: bool) -> [i32; 3] {
    [root, root + if minor { 3 } else { 4 }, root + 7]
}

fn kick_sound(noise: &mut Noise, soft: bool) -> Vec<f64> {
    let n = (0.45 * HZ) as usize;
    let mut phase = 0.0;
    let mut svf = Svf::default();
    (0..n)
        .map(|i| {
            let t = i as f64 / HZ;
            let freq = 47.0 + 120.0 * (-t / 0.03).exp() + 60.0 * (-t / 0.004).exp();
            phase += TAU * freq / HZ;
            let body = (1.8 * phase.sin() * (-t / if soft { 0.12 } else { 0.18 }).exp() * (1.0 - (-t / 0.0006).exp())).tanh() / 1.8f64.tanh();
            let click = svf.run(noise.next(), 3500.0, 0.7).1 * (-t / 0.003).exp();
            body + if soft { 0.05 } else { 0.2 } * click
        })
        .collect()
}

fn clap_sound(noise: &mut Noise) -> Vec<f64> {
    let n = (0.35 * HZ) as usize;
    let mut svf = Svf::default();
    (0..n)
        .map(|i| {
            let t = i as f64 / HZ;
            let mut env = 0.0_f64;
            for delay in [0.0, 0.010, 0.021, 0.033] {
                if t >= delay {
                    env = env.max((-(t - delay) / 0.006).exp());
                }
            }
            if t >= 0.033 {
                env = env.max(0.6 * (-(t - 0.033) / 0.11).exp());
            }
            2.5 * svf.run(noise.next(), 1800.0, 0.9).1 * env
        })
        .collect()
}

fn hat_sound(noise: &mut Noise, decay: f64) -> Vec<f64> {
    let n = (0.2 * HZ) as usize;
    let mut svf = Svf::default();
    (0..n)
        .map(|i| {
            let t = i as f64 / HZ;
            svf.run(noise.next(), 8000.0, 0.8).2 * (-t / decay).exp() * (1.0 - (-t / 0.0004).exp())
        })
        .collect()
}

fn crash_sound(noise: &mut Noise, decay: f64) -> Vec<f64> {
    let n = (decay * 4.0 * HZ) as usize;
    let mut svf = Svf::default();
    (0..n)
        .map(|i| {
            let t = i as f64 / HZ;
            svf.run(noise.next(), 5200.0, 0.6).2 * (-t / decay).exp() * (1.0 - (-t / 0.0008).exp())
        })
        .collect()
}

fn impact_sound(noise: &mut Noise) -> Vec<f64> {
    let n = (2.2 * HZ) as usize;
    let mut phase = 0.0;
    let (mut low, mut high) = (Svf::default(), Svf::default());
    (0..n)
        .map(|i| {
            let t = i as f64 / HZ;
            phase += TAU * (28.0 + 70.0 * (-t / 0.09).exp()) / HZ;
            let boom = (2.0 * phase.sin() * (-t / 0.7).exp() * (1.0 - (-t / 0.0008).exp())).tanh() / 2f64.tanh();
            let white = noise.next();
            let body = low.run(white, 1200.0, 0.7).0 * (-t / 0.14).exp();
            let crack = high.run(white, 6000.0, 0.7).2 * (-t / 0.02).exp();
            boom + 0.5 * body + 0.4 * crack
        })
        .collect()
}

/// Noise through a rising band-pass over `length` seconds, loudest at its end.
fn riser_sound(noise: &mut Noise, length: f64) -> Vec<f64> {
    let n = (length * HZ) as usize;
    let mut svf = Svf::default();
    let mut saw = Saw { phase: 0.0 };
    (0..n)
        .map(|i| {
            let u = i as f64 / n as f64;
            let cutoff = 350.0 * (9000.0f64 / 350.0).powf(u);
            let swept = svf.run(noise.next(), cutoff, 1.4).1;
            let tone = saw.next(110.0 * 2f64.powf(3.0 * u)) * 0.25;
            (2.0 * swept + tone) * u.powf(2.2)
        })
        .collect()
}

fn pluck_sound(midi: f64, bright: f64, decay: f64) -> Vec<f64> {
    let n = ((decay * 4.0).max(0.12) * HZ) as usize;
    let mut saw = Saw { phase: 0.0 };
    let mut svf = Svf::default();
    let freq = hz(midi);
    (0..n)
        .map(|i| {
            let t = i as f64 / HZ;
            let cutoff = 350.0 + 5000.0 * bright * (-t / 0.055).exp();
            let s = svf.run(saw.next(freq), cutoff, 1.1).0;
            s * (1.0 - (-t / 0.0015).exp()) * (-t / decay).exp()
        })
        .collect()
}

/// The sidechain gain at every frame: ducks after each kick and breathes back.
fn pump(len: usize, kicks: &[f64], depth: f64) -> Vec<f64> {
    let mut gain = vec![1.0_f64; len];
    let release = 0.28;
    for &kick in kicks {
        let from = (kick * HZ) as usize;
        let to = (((kick + release) * HZ) as usize).min(len);
        for (i, slot) in gain.iter_mut().enumerate().take(to).skip(from) {
            let u = (i as f64 / HZ - kick) / release;
            *slot = slot.min(1.0 - depth * 0.5 * (1.0 + (PI * u.clamp(0.0, 1.0)).cos()));
        }
    }
    gain
}

/// A small stereo room on the send (Schroeder combs + allpasses, the right side offset).
fn reverb(send: &[f64]) -> Vec<[f64; 2]> {
    let side = |lengths: [usize; 4], passes: [usize; 2]| {
        let mut combs: Vec<(Vec<f64>, usize, f64)> = lengths.iter().map(|&len| (vec![0.0; len], 0, 0.0)).collect();
        let mut alls: Vec<(Vec<f64>, usize)> = passes.iter().map(|&len| (vec![0.0; len], 0)).collect();
        send.iter()
            .map(|&input| {
                let mut sum = 0.0;
                for (line, at, store) in &mut combs {
                    let out = line[*at];
                    *store = out * 0.6 + *store * 0.4;
                    line[*at] = input + *store * 0.84;
                    *at = (*at + 1) % line.len();
                    sum += out;
                }
                let mut signal = 0.25 * sum;
                for (line, at) in &mut alls {
                    let delayed = line[*at];
                    line[*at] = signal + 0.5 * delayed;
                    signal = delayed - 0.5 * line[*at];
                    *at = (*at + 1) % line.len();
                }
                signal
            })
            .collect::<Vec<f64>>()
    };
    let left = side([1557 * 2, 1617 * 2, 1491 * 2, 1422 * 2], [556, 441]);
    let right = side([1580 * 2, 1640 * 2, 1514 * 2, 1445 * 2], [579, 464]);
    left.into_iter().zip(right).map(|(l, r)| [l, r]).collect()
}

/// Composes, mixes and masters the score.
#[must_use]
pub fn render(spec: &ScoreSpec) -> Score {
    let duration = spec.duration.clamp(2.0, 600.0);
    let bpm = spec.bpm.clamp(50.0, 200.0);
    let beat = 60.0 / bpm;
    let bar = 4.0 * beat;
    let len = (duration * HZ).round() as usize;
    let intensity = spec.intensity.unwrap_or(0.7).clamp(0.0, 1.0);
    let voice = voicing(spec.mood);
    let minor = spec.minor.unwrap_or(voice.minor);
    let root = spec.root.clamp(40, 70);
    let mut noise = Noise(spec.seed.unwrap_or(0x5EED_B1FF).max(1));

    // Grid and sections.
    let beats: Vec<f64> = (0..).map(|i| f64::from(i) * beat).take_while(|&t| t < duration - 1e-6).collect();
    let downbeats: Vec<f64> = beats.iter().copied().step_by(4).collect();
    let snap = |t: f64| (t / bar).round() * bar;
    let mut drops: Vec<f64> = spec.drops.iter().map(|&t| snap(t)).filter(|&t| t >= bar && t < duration - bar * 0.5).collect();
    if drops.is_empty() && voice.has_drop && !spec.no_drop && duration >= 4.0 * bar {
        drops.push(snap(duration * 0.6).max(2.0 * bar));
    }
    drops.dedup_by(|a, b| (*a - *b).abs() < bar);
    let intro_end = if duration >= 6.0 * bar { bar } else { 0.0 };
    let outro_start = (duration - bar).max(intro_end);
    let groove_from = if voice.hold_groove { drops.first().copied().unwrap_or(intro_end) } else { intro_end };
    let in_build = |t: f64| drops.iter().any(|&d| t >= d - bar && t < d);
    let after_drop = |t: f64| drops.iter().any(|&d| t >= d);
    let chord_at = |t: f64| chord(minor, (t / bar).floor().max(0.0) as usize);

    let mut drums = Bus::new(len);
    let mut kick_times = Vec::new();

    // Kick.
    let kick = kick_sound(&mut noise, matches!(spec.mood, Mood::Chill | Mood::Playful));
    for &down in &downbeats {
        let live = down >= groove_from && down < outro_start;
        for &step in voice.kick {
            let t = down + step * beat;
            if live && t < outro_start && !(in_build(t) && step > 0.0 && t >= down + 2.0 * beat) {
                drums.shot(&kick, t, 1.0, 0.0);
                kick_times.push(t);
            }
        }
    }
    for &drop in &drops {
        drums.shot(&kick, drop, 1.0, 0.0);
        kick_times.push(drop);
    }
    let last_hit = (duration - bar).max(0.0);
    if !voice.kick.is_empty() && duration > bar {
        drums.shot(&kick, last_hit, 0.85, 0.0);
        kick_times.push(last_hit);
    }
    kick_times.sort_by(f64::total_cmp);

    // Claps and hats.
    let claps: Vec<Vec<f64>> = (0..3).map(|_| clap_sound(&mut noise)).collect();
    let hat = hat_sound(&mut noise, 0.045);
    let tick = hat_sound(&mut noise, 0.016);
    let mut clap_count = 0;
    for &down in &downbeats {
        if down < groove_from + bar || down >= outro_start {
            continue;
        }
        let building = in_build(down);
        for &step in voice.clap {
            let t = down + step * beat;
            drums.shot(&claps[clap_count % 3], t, if building { 0.6 } else { 0.9 }, 0.0);
            clap_count += 1;
        }
        if building {
            // Claps in 8ths, then 16ths, rising into the drop.
            for i in 0..12 {
                let t = down + 2.0 * beat + f64::from(i) * beat / 6.0;
                drums.shot(&claps[i as usize % 3], t, 0.45 + 0.04 * f64::from(i), 0.0);
            }
        }
        if voice.hats > 0 {
            for i in 0..(4 * voice.hats) {
                let step = f64::from(i) / f64::from(voice.hats);
                let t = down + step * beat;
                let off = (step.fract() - 0.5).abs() < 1e-6;
                if voice.hats == 2 && !off {
                    continue;
                }
                let gain = if voice.hats == 4 { if i % 2 == 0 { 0.35 } else { 0.22 } } else { 0.7 };
                drums.shot(if voice.hats == 4 { &tick } else { &hat }, t, gain, if i % 2 == 0 { -0.15 } else { 0.2 });
            }
        }
    }

    // Crashes and impacts.
    let crash = crash_sound(&mut noise, 0.9);
    let impact = impact_sound(&mut noise);
    let riser = riser_sound(&mut noise, bar.min(2.5));
    let mut fx = Bus::new(len);
    if groove_from > 0.0 && groove_from < duration - bar {
        drums.shot(&crash, groove_from, 0.35, 0.0);
    }
    for &drop in &drops {
        drums.shot(&crash, drop, 0.7, 0.0);
        fx.shot(&impact, drop, 1.0, 0.0);
        fx.shot(&riser, drop - riser.len() as f64 / HZ, 0.55, 0.0);
    }
    for &accent in &spec.accents {
        if accent > 0.2 && accent < duration - 0.2 && !drops.iter().any(|&d| (d - accent).abs() < 0.3) {
            drums.shot(&crash, accent, 0.22, if accent as usize % 2 == 0 { -0.3 } else { 0.3 });
        }
    }

    // Sub bass (and a mid saw on top), following the chord root, side-chained to the kick.
    let pumps = pump(len, &kick_times, voice.sub_pump);
    let mut bass = Bus::new(len);
    {
        let mut phase = 0.0_f64;
        let mut mid = Saw { phase: 0.0 };
        let mut mid_filter = Svf::default();
        let mut level = 0.0_f64;
        for i in 0..len {
            let t = i as f64 / HZ;
            let on = t >= groove_from && t < outro_start + beat * 2.0 && !(in_build(t) && t % bar >= 3.0 * beat);
            level += ((if on { 1.0 } else { 0.0 }) - level) * 0.004;
            if level < 1e-4 {
                continue;
            }
            let (offset, _) = chord_at(t);
            let note = f64::from(root - 24 + offset.rem_euclid(12) - if offset.rem_euclid(12) > 7 { 12 } else { 0 });
            let freq = hz(note);
            phase += TAU * freq / HZ;
            let sub = ((1.6 * phase.sin()).tanh() / 1.6f64.tanh() + 0.2 * (2.0 * phase).sin()) * level * pumps[i];
            let edge = mid_filter.run(mid.next(freq * 2.0), 420.0 + 300.0 * intensity, 1.3).0 * level * pumps[i] * 0.35;
            bass.add(i, sub + edge, sub + edge);
        }
    }

    // Pad: the chord's triad plus the octave, three detuned saws a note, a slow filter.
    let mut pad = Bus::new(len);
    {
        let mut oscillators = vec![Saw { phase: 0.0 }; 4 * 3 * 2];
        for (index, osc) in oscillators.iter_mut().enumerate() {
            osc.phase = (index as f64 * 0.137).fract();
        }
        let (mut left_filter, mut right_filter) = (Svf::default(), Svf::default());
        let mut chord_gain = 0.0_f64;
        let voiced = |(offset, minor_chord): (i32, bool)| {
            let tones = triad(root + offset.rem_euclid(12) - if offset.rem_euclid(12) > 7 { 12 } else { 0 }, minor_chord);
            let notes = [tones[0], tones[1], tones[2], tones[0] + 12];
            let mut freqs = [0.0; 12];
            for (n, &note) in notes.iter().enumerate() {
                for v in 0..3 {
                    freqs[n * 3 + v] = hz(f64::from(note) + (v as f64 - 1.0) * 0.09);
                }
            }
            freqs
        };
        let mut current = chord_at(0.0);
        let mut freqs = voiced(current);
        for i in 0..len {
            let t = i as f64 / HZ;
            let next = chord_at(t);
            if next != current {
                chord_gain = 0.0;
                current = next;
                freqs = voiced(current);
            }
            chord_gain = (chord_gain + 1.0 / (0.04 * HZ)).min(1.0);
            let (mut left, mut right) = (0.0, 0.0);
            for n in 0..4 {
                for v in 0..3 {
                    let freq = freqs[n * 3 + v];
                    let l = oscillators[(n * 3 + v) * 2].next(freq);
                    let r = oscillators[(n * 3 + v) * 2 + 1].next(freq * 1.0007);
                    let spread = (v as f64 - 1.0) * 0.6;
                    left += l * (1.0 - spread.max(0.0));
                    right += r * (1.0 + spread.min(0.0));
                }
            }
            let rise = if in_build(t) { ((t % bar) / bar).powi(2) } else { 0.0 };
            let intro = if t < intro_end { (t / intro_end.max(1e-3)).powf(1.5) } else { 1.0 };
            let tail = if t >= outro_start { (-(t - outro_start) / (bar * 0.45)).exp() } else { 1.0 };
            let base = (500.0 + 1400.0 * voice.pad_bright * (0.6 + 0.4 * intensity)) * (1.0 + 0.1 * (TAU * t / (2.0 * bar)).sin());
            let cutoff = base * (1.0 + 1.6 * rise) * if after_drop(t) { 1.35 } else { 1.0 } * (0.3 + 0.7 * intro);
            let gain = chord_gain.min(1.0) * intro * tail * if voice.sub_pump > 0.5 { pumps[i].max(0.55) } else { 1.0 };
            pad.add(i, left_filter.run(left, cutoff, 0.8).0 * gain, right_filter.run(right, cutoff, 0.8).0 * gain);
        }
    }

    // Pluck arp over the chord.
    let mut arp = Bus::new(len);
    if voice.arp > 0 {
        let pattern = [0usize, 2, 1, 3, 2, 1, 2, 3];
        let step = beat / f64::from(voice.arp);
        let mut t = if voice.hold_groove { 0.0 } else { intro_end * 0.5 };
        let mut index = 0usize;
        while t < outro_start {
            let (offset, minor_chord) = chord_at(t);
            let tones = triad(root + 12 + offset.rem_euclid(12) - if offset.rem_euclid(12) > 7 { 12 } else { 0 }, minor_chord);
            let notes = [tones[0], tones[1], tones[2], tones[0] + 12];
            let note = f64::from(notes[pattern[index % 8]]);
            let accent = if index % voice.arp as usize == 0 { 1.0 } else { 0.72 };
            let bright = (0.4 + 0.6 * intensity) * if after_drop(t) { 1.25 } else { 1.0 } * if t < groove_from { 0.5 } else { 1.0 };
            let gain = accent * if t < groove_from { 0.6 } else { 1.0 };
            arp.shot(&pluck_sound(note, bright, voice.arp_decay), t, gain, if index % 2 == 0 { -0.25 } else { 0.25 });
            t += step;
            index += 1;
        }
    }

    // Mix: each bus scaled to its level, the room on a send, the pad and arp pumped lightly.
    let normal = |bus: &Bus| bus.0.iter().fold(0.0_f64, |peak, frame| peak.max(frame[0].abs()).max(frame[1].abs())).max(1e-9);
    let groups: [(&Bus, f64, f64); 5] = [
        (&drums, 1.0, 0.12),
        (&bass, 0.55, 0.0),
        (&pad, voice.pad_level, 0.45),
        (&arp, 0.5 + 0.2 * intensity, 0.35),
        (&fx, 0.8, 0.3),
    ];
    let mut mix = vec![[0.0_f64; 2]; len];
    let mut send = vec![0.0_f64; len];
    for (bus, level, wet) in groups {
        let scale = level / normal(bus);
        for (i, frame) in bus.0.iter().enumerate() {
            mix[i][0] += frame[0] * scale;
            mix[i][1] += frame[1] * scale;
            send[i] += wet * 0.5 * (frame[0] + frame[1]) * scale;
        }
    }
    for (frame, wet) in mix.iter_mut().zip(reverb(&send)) {
        frame[0] += 0.35 * wet[0];
        frame[1] += 0.35 * wet[1];
    }

    // Master: DC block, loudness to about −14 dB RMS over the playing part, soft limiting under
    // the ceiling, a short fade in and a fade over the ring-out.
    let (mut last_in, mut last_out) = ([0.0; 2], [0.0; 2]);
    for frame in &mut mix {
        for c in 0..2 {
            let out = frame[c] - last_in[c] + 0.9995 * last_out[c];
            last_in[c] = frame[c];
            last_out[c] = out;
            frame[c] = out;
        }
    }
    let active: Vec<f64> = mix.iter().map(|f| 0.5 * (f[0] * f[0] + f[1] * f[1])).filter(|&p| p > 1e-8).collect();
    let rms = (active.iter().sum::<f64>() / active.len().max(1) as f64).sqrt().max(1e-9);
    let gain = 10f64.powf(-14.0 / 20.0) / rms;
    let fade_out = (bar * 0.9).min(duration * 0.3);
    for (i, frame) in mix.iter_mut().enumerate() {
        let t = i as f64 / HZ;
        let edge = (t / 0.004).min(1.0) * if t > duration - fade_out { 0.5 * (1.0 + (PI * (t - (duration - fade_out)) / fade_out).cos()) } else { 1.0 };
        for sample in frame.iter_mut() {
            let x = *sample * gain;
            // Unity below 0.6 of the ceiling, then a tanh knee up to it.
            let knee = 0.6 * CEILING;
            let limited = if x.abs() <= knee { x } else { x.signum() * (knee + (CEILING - knee) * ((x.abs() - knee) / (CEILING - knee)).tanh()) };
            *sample = limited * edge;
        }
    }

    let name = format!("{:?}", spec.mood).to_lowercase();
    let arrangement = format!(
        "{name}, {bpm:.0} BPM, {} {}: {}{}{}",
        note_name(root),
        if minor { "minor" } else { "major" },
        if intro_end > 0.0 { format!("intro to {intro_end:.2}s, ") } else { String::new() },
        if drops.is_empty() { "a steady groove".to_owned() } else { format!("builds into drop{} at {}", if drops.len() == 1 { "" } else { "s" }, drops.iter().map(|d| format!("{d:.2}s")).collect::<Vec<_>>().join(", ")) },
        format!(", ring-out from {outro_start:.2}s"),
    );
    Score { frames: mix, bpm, duration, beats, downbeats, drops, arrangement }
}

fn note_name(midi: i32) -> &'static str {
    ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][midi.rem_euclid(12) as usize]
}

/// 16-bit stereo PCM WAV at 48 kHz.
#[must_use]
pub fn wav_bytes(frames: &[[f64; 2]]) -> Vec<u8> {
    let data_len = (frames.len() * 4) as u32;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&RATE.to_le_bytes());
    out.extend_from_slice(&(RATE * 4).to_le_bytes());
    out.extend_from_slice(&4u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for frame in frames {
        for sample in frame {
            out.extend_from_slice(&((sample.clamp(-1.0, 1.0) * 32767.0).round() as i16).to_le_bytes());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(mood: Mood, duration: f64) -> ScoreSpec {
        ScoreSpec { duration, bpm: 120.0, mood, root: 57, minor: None, drops: vec![], no_drop: false, accents: vec![3.0], intensity: None, seed: None }
    }

    #[test]
    fn every_mood_renders_a_loud_clean_score_on_an_exact_grid() {
        for mood in [Mood::Energetic, Mood::Chill, Mood::Cinematic, Mood::Corporate, Mood::Playful, Mood::Dark] {
            let score = render(&spec(mood, 15.0));
            assert_eq!(score.frames.len(), 15 * RATE as usize);
            let peak = score.frames.iter().fold(0.0_f64, |p, f| p.max(f[0].abs()).max(f[1].abs()));
            assert!(peak <= CEILING + 1e-9 && peak > 0.2, "{mood:?} peak {peak}");
            assert!(score.frames.iter().all(|f| f[0].is_finite() && f[1].is_finite()));
            assert_eq!(score.beats.len(), 30);
            assert!((score.beats[1] - 0.5).abs() < 1e-9 && score.downbeats[1] == 2.0);
            // Silence where the file ends: the ring-out fades to nothing.
            let last = score.frames.last().unwrap();
            assert!(last[0].abs() < 1e-3 && last[1].abs() < 1e-3);
        }
    }

    /// Writes one score per mood to `BHIPPI_SCORE_OUT` for listening and loudness checks:
    /// `BHIPPI_SCORE_OUT=dir cargo test --lib score::tests::write_scores -- --ignored`.
    #[test]
    #[ignore = "writes files for a listening check"]
    fn write_scores() {
        let dir = std::path::PathBuf::from(std::env::var("BHIPPI_SCORE_OUT").expect("BHIPPI_SCORE_OUT"));
        for mood in [Mood::Energetic, Mood::Chill, Mood::Cinematic, Mood::Corporate, Mood::Playful, Mood::Dark] {
            let started = std::time::Instant::now();
            let score = render(&spec(mood, 30.0));
            println!("{mood:?}: {:.2}s to render 30s — {}", started.elapsed().as_secs_f64(), score.arrangement);
            std::fs::write(dir.join(format!("{mood:?}.wav")), wav_bytes(&score.frames)).unwrap();
        }
    }

    #[test]
    fn a_drop_lands_on_a_bar_and_is_the_loudest_moment() {
        let mut energetic = spec(Mood::Energetic, 16.0);
        energetic.drops = vec![9.9];
        let score = render(&energetic);
        assert_eq!(score.drops, vec![10.0]);
        let window = |from: f64| {
            let (a, b) = ((from * HZ) as usize, ((from + 0.25) * HZ) as usize);
            score.frames[a..b].iter().map(|f| f[0] * f[0]).sum::<f64>()
        };
        assert!(window(10.0) > window(4.0));
        let wav = wav_bytes(&score.frames);
        assert_eq!(&wav[..4], b"RIFF");
        assert_eq!(wav.len(), 44 + score.frames.len() * 4);
    }
}
