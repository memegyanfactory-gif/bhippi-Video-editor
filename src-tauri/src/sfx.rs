//! Procedural sound effects, synthesised once into WAV files the preview and export share.
//!
//! The first five (whoosh, impact, chime, pop, riser) are the originals and still render sample
//! for sample as before. The @funny kinds (boom, scratch, bleep, swish, ding, glitch) are built
//! from small DSP parts — a state-variable filter, a short Schroeder room, soft saturation — and
//! each is normalised to the same −1.5 dBFS peak, so their levels are set by `SFX_GAIN_DB` in
//! the UI and never by accident here.

use crate::project::SfxKind;
use std::f64::consts::{PI, TAU};
use std::path::{Path, PathBuf};

const RATE: u32 = 48_000;
const HZ: f64 = RATE as f64;
/// Peak every @funny effect is scaled to: −1.5 dBFS, under the −1 dBFS ceiling.
const PEAK: f64 = 0.841;

#[must_use]
pub const fn duration(kind: SfxKind) -> f64 {
    kind.length()
}

/// Deterministic noise so every render of the same project sounds identical.
struct Noise(u64);

impl Noise {
    fn next(&mut self) -> f64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        // Top 53 bits → [0, 1), then → [-1, 1).
        ((self.0 >> 11) as f64 / (1u64 << 53) as f64) * 2.0 - 1.0
    }

    /// Uniform in [0, 1).
    fn unit(&mut self) -> f64 {
        0.5 * (self.next() + 1.0)
    }

    /// One of `0..count`.
    fn pick(&mut self, count: usize) -> usize {
        ((self.unit() * count as f64) as usize).min(count.saturating_sub(1))
    }
}

/// Samples in −1.0 … 1.0 for one effect.
#[must_use]
pub fn samples(kind: SfxKind) -> Vec<f64> {
    let frames = (HZ * duration(kind)).round() as usize;
    match kind {
        SfxKind::Whoosh | SfxKind::Impact | SfxKind::Chime | SfxKind::Pop | SfxKind::Riser => classic(kind),
        SfxKind::Boom => master(boom(frames), 0.002, 0.15),
        SfxKind::Scratch => master(scratch(frames), 0.003, 0.03),
        SfxKind::Bleep => master(bleep(frames), 0.005, 0.005),
        SfxKind::Swish => master(swish(frames), 0.004, 0.02),
        SfxKind::Ding => master(ding(frames), 0.001, 0.2),
        SfxKind::Glitch => master(glitch(frames), 0.001, 0.04),
        SfxKind::Click => master(click(frames), 0.0005, 0.01),
        SfxKind::Tick => master(tick(frames), 0.0003, 0.01),
        SfxKind::Key => master(key(frames), 0.0003, 0.01),
        SfxKind::Typing => master(typing(frames), 0.0003, 0.05),
        SfxKind::Glass => master(glass(frames), 0.001, 0.2),
        SfxKind::Shimmer => master(shimmer(frames), 0.01, 0.2),
        SfxKind::Sub => master(sub(frames), 0.002, 0.3),
        SfxKind::Blip => master(blip(frames), 0.001, 0.01),
    }
}

/// The original five, unchanged: their WAVs are cached on disk by name.
fn classic(kind: SfxKind) -> Vec<f64> {
    let length = duration(kind);
    let frames = (HZ * length).round() as usize;
    let mut noise = Noise(0x9E37_79B9_7F4A_7C15);
    let mut filtered = 0.0;
    let mut phase = 0.0_f64;
    (0..frames)
        .map(|index| {
            let time = index as f64 / HZ;
            let position = time / length;
            let attack = (time / 0.008).min(1.0);
            let release = ((length - time) / 0.03).clamp(0.0, 1.0);
            let white = noise.next();
            let sample = match kind {
                SfxKind::Whoosh => {
                    filtered = 0.75 * filtered + 0.25 * white;
                    phase += TAU * (180.0 + 1400.0 * position) / HZ;
                    (0.9 * filtered + 0.12 * phase.sin()) * (PI * position).sin().powf(1.6)
                }
                SfxKind::Impact => {
                    phase += TAU * (42.0 + 110.0 * (-11.0 * time).exp()) / HZ;
                    (0.8 * phase.sin() + 0.35 * white * (-30.0 * time).exp()) * (-5.0 * time).exp()
                }
                SfxKind::Chime => {
                    let partials = 0.55 * (TAU * 880.0 * time).sin() + 0.28 * (TAU * 1320.0 * time).sin() + 0.12 * (TAU * 1760.0 * time).sin();
                    partials * (-2.8 * time).exp()
                }
                SfxKind::Pop => {
                    phase += TAU * (900.0 * (-25.0 * time).exp() + 180.0) / HZ;
                    phase.sin() * (-22.0 * time).exp()
                }
                SfxKind::Riser => {
                    filtered = 0.6 * filtered + 0.4 * white;
                    phase += TAU * (120.0 + 900.0 * position * position) / HZ;
                    (0.55 * phase.sin() + 0.35 * filtered) * position.powf(1.8)
                }
                // Synthesised by their own voices below; never reached.
                SfxKind::Boom | SfxKind::Scratch | SfxKind::Bleep | SfxKind::Swish | SfxKind::Ding | SfxKind::Glitch | SfxKind::Click | SfxKind::Tick | SfxKind::Key | SfxKind::Typing | SfxKind::Glass | SfxKind::Shimmer | SfxKind::Sub | SfxKind::Blip => 0.0,
            };
            (sample * attack * release * 0.8).clamp(-1.0, 1.0)
        })
        .collect()
}

// ── DSP parts ─────────────────────────────────────────────────────────────

/// A topology-preserving state-variable filter (Zavalishin / Cytomic): stable under fast cutoff
/// sweeps, which the scratch and swish lean on. Answers (low, band, high).
#[derive(Default)]
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

/// A short room: four damped feedback combs in parallel into two allpasses (Schroeder, with
/// Freeverb's mutually prime delays scaled to 48 kHz). Answers the wet signal only.
fn room(dry: &[f64], feedback: f64, damp: f64) -> Vec<f64> {
    struct Comb {
        line: Vec<f64>,
        at: usize,
        store: f64,
    }
    let mut combs: Vec<Comb> = [1694, 1760, 1623, 1548].iter().map(|&len| Comb { line: vec![0.0; len], at: 0, store: 0.0 }).collect();
    let mut passes: Vec<(Vec<f64>, usize)> = [605, 480].iter().map(|&len| (vec![0.0; len], 0)).collect();
    dry.iter()
        .map(|&input| {
            let mut sum = 0.0;
            for comb in &mut combs {
                let out = comb.line[comb.at];
                comb.store = out * (1.0 - damp) + comb.store * damp;
                comb.line[comb.at] = input + comb.store * feedback;
                comb.at = (comb.at + 1) % comb.line.len();
                sum += out;
            }
            let mut signal = 0.25 * sum;
            for (line, at) in &mut passes {
                let delayed = line[*at];
                line[*at] = signal + 0.5 * delayed;
                signal = delayed - 0.5 * line[*at];
                *at = (*at + 1) % line.len();
            }
            signal
        })
        .collect()
}

/// Soft clip that keeps unity gain at the top: `tanh(drive·x) / tanh(drive)`.
fn saturate(sample: f64, drive: f64) -> f64 {
    (drive * sample).tanh() / drive.tanh()
}

/// A raised-cosine ramp 0 → 1 over `length` seconds at `time` seconds from the edge.
fn ramp(time: f64, length: f64) -> f64 {
    if length <= 0.0 || time >= length {
        1.0
    } else if time <= 0.0 {
        0.0
    } else {
        0.5 - 0.5 * (PI * time / length).cos()
    }
}

/// Removes DC, fades both ends and scales the peak to [`PEAK`].
fn master(mut data: Vec<f64>, fade_in: f64, fade_out: f64) -> Vec<f64> {
    // One-pole DC blocker (≈ 8 Hz): saturation of an asymmetric wave leaves a little offset.
    let (mut last_in, mut last_out) = (0.0, 0.0);
    for sample in &mut data {
        let out = *sample - last_in + 0.999 * last_out;
        last_in = *sample;
        last_out = out;
        *sample = out;
    }
    let count = data.len();
    for (index, sample) in data.iter_mut().enumerate() {
        let from_start = index as f64 / HZ;
        let from_end = (count - index) as f64 / HZ;
        *sample *= ramp(from_start, fade_in) * ramp(from_end, fade_out);
    }
    // Scale by the true (inter-sample) peak, not the sample peak: bright sounds overshoot
    // between samples by up to a dB once a player reconstructs them.
    let peak = true_peak(&data);
    if peak > 1e-9 {
        let gain = PEAK / peak;
        for sample in &mut data {
            *sample = (*sample * gain).clamp(-1.0, 1.0);
        }
    }
    data
}

/// The peak of the signal reconstructed at 4× (ITU-R BS.1770's true peak, estimated with a
/// 16-tap Hann-windowed sinc at the three in-between phases), never below the sample peak.
fn true_peak(data: &[f64]) -> f64 {
    const TAPS: isize = 8;
    let kernel: Vec<[f64; 16]> = [0.25, 0.5, 0.75]
        .iter()
        .map(|&phase| {
            let mut row = [0.0; 16];
            for (slot, k) in row.iter_mut().zip(-TAPS + 1..=TAPS) {
                let x = k as f64 - phase;
                let sinc = if x.abs() < 1e-12 { 1.0 } else { (PI * x).sin() / (PI * x) };
                let window = 0.5 + 0.5 * (PI * x / TAPS as f64).cos();
                *slot = sinc * window;
            }
            row
        })
        .collect();
    let at = |index: isize| if index < 0 || index as usize >= data.len() { 0.0 } else { data[index as usize] };
    let mut peak = data.iter().fold(0.0_f64, |peak, sample| peak.max(sample.abs()));
    for index in 0..data.len() as isize {
        for row in &kernel {
            let value: f64 = row.iter().zip(-TAPS + 1..=TAPS).map(|(weight, k)| weight * at(index + k)).sum();
            peak = peak.max(value.abs());
        }
    }
    peak
}

// ── The @funny voices ─────────────────────────────────────────────────────

/// The "vine boom": a sub thump whose pitch falls fast from ~120 Hz to 45 Hz and then holds,
/// its octave and fifth on top and driven hard into saturation so it reads on a phone speaker,
/// a low-passed noise grit riding the same envelope, a dull click on the attack, and a room
/// behind it (the reference boom is a held, distorted, reverberant bass, not a clean kick).
fn boom(frames: usize) -> Vec<f64> {
    let mut phase = 0.0_f64;
    let mut noise = Noise(0xB00B_5EED_0000_0001);
    let mut click = Svf::default();
    let mut grit = Svf::default();
    let dry: Vec<f64> = (0..frames)
        .map(|index| {
            let time = index as f64 / HZ;
            let pitch = 45.0 + 75.0 * (-time / 0.07).exp();
            phase += TAU * pitch / HZ;
            let body = phase.sin() + 0.35 * (2.0 * phase).sin() + 0.12 * (3.0 * phase).sin();
            let envelope = ramp(time, 0.002) * (0.35 * (-time / 0.12).exp() + 0.65 * (-time / 0.9).exp());
            let thump = saturate(1.6 * body * envelope, 4.0);
            let white = noise.next();
            let (dust, _, _) = grit.run(white, 1800.0, 0.8);
            let (low, _, _) = click.run(white, 2600.0, 0.7);
            thump + 0.16 * dust * envelope + 0.5 * low * (-time / 0.006).exp()
        })
        .collect();
    let wet = room(&dry, 0.8, 0.4);
    dry.iter().zip(&wet).map(|(dry, wet)| dry + 0.3 * wet).collect()
}

/// A record scratch: a vowel-ish buzz and hiss "pressed" onto a record that is dragged forward
/// and back twice (varispeed read of the groove, pitch following the hand), silent where the
/// hand turns, through a resonant band-pass that opens with the speed.
fn scratch(frames: usize) -> Vec<f64> {
    // The groove: 1.6 s of a 140 Hz buzz shaped by "ah" formants, plus surface hiss.
    let groove_len = (1.6 * HZ) as usize;
    let mut noise = Noise(0x5C12_A7C4_0000_0002);
    let mut formant_a = Svf::default();
    let mut formant_b = Svf::default();
    let mut hiss = Svf::default();
    let groove: Vec<f64> = (0..groove_len)
        .map(|index| {
            let time = index as f64 / HZ;
            let saw: f64 = (1..=24).map(|n| (TAU * 140.0 * f64::from(n) * time).sin() / f64::from(n)).sum();
            let (_, band_a, _) = formant_a.run(saw, 720.0, 5.0);
            let (_, band_b, _) = formant_b.run(saw, 1220.0, 6.0);
            let (_, _, air) = hiss.run(noise.next(), 2500.0, 0.7);
            0.7 * band_a + 0.45 * band_b + 0.12 * saw + 0.18 * air
        })
        .collect();
    let mut position = 0.55 * HZ;
    let mut sweep = Svf::default();
    let top = 3.4;
    (0..frames)
        .map(|index| {
            let time = index as f64 / HZ;
            // Two back-and-forth strokes (4 Hz), with the wobble of a hand on vinyl.
            let speed = top * (TAU * 4.0 * time).sin() * (1.0 + 0.22 * (TAU * 13.0 * time).sin());
            position = (position + speed).clamp(0.0, (groove_len - 2) as f64);
            let at = position.floor() as usize;
            let frac = position - at as f64;
            let read = groove[at] * (1.0 - frac) + groove[at + 1] * frac;
            let pace = (speed.abs() / top).min(1.0);
            let (_, band, _) = sweep.run(read, 350.0 + 2800.0 * pace, 2.6);
            saturate((0.65 * band + 0.35 * read) * pace.powf(0.6), 1.6)
        })
        .collect()
}

/// The censor bleep: a clean 1 kHz sine with 5 ms edges (the bleep move trims it to the word).
fn bleep(frames: usize) -> Vec<f64> {
    (0..frames).map(|index| (TAU * 1000.0 * index as f64 / HZ).sin()).collect()
}

/// A short bright swish: noise through a resonant band-pass sweeping up from 1.2 to 7.5 kHz,
/// a little top-end air, rising fast and tailing off.
fn swish(frames: usize) -> Vec<f64> {
    let mut noise = Noise(0x5A15_4000_0000_0003);
    let mut band = Svf::default();
    let mut air = Svf::default();
    let length = frames as f64 / HZ;
    (0..frames)
        .map(|index| {
            let position = index as f64 / HZ / length;
            let white = noise.next();
            let cutoff = 1200.0 * (7500.0_f64 / 1200.0).powf(position);
            let (_, swept, _) = band.run(white, cutoff, 2.8);
            let (_, _, high) = air.run(white, 6000.0, 0.7);
            let envelope = (PI * position.powf(0.75)).sin().max(0.0).powf(1.6);
            (swept + 0.1 * high) * envelope
        })
        .collect()
}

/// A bell "ding": the free bar's inharmonic partials (1, 2.76, 5.4, 8.9 × 1046.5 Hz), each
/// decaying faster than the one below, a slightly detuned twin on the fundamental for shimmer,
/// and a tiny strike on the front.
fn ding(frames: usize) -> Vec<f64> {
    const BASE: f64 = 1046.5;
    const PARTIALS: [(f64, f64, f64); 4] = [(1.0, 1.0, 0.5), (2.76, 0.5, 0.26), (5.4, 0.28, 0.13), (8.9, 0.15, 0.065)];
    let mut noise = Noise(0xD1D1_0000_0000_0004);
    let mut strike = Svf::default();
    (0..frames)
        .map(|index| {
            let time = index as f64 / HZ;
            let ring: f64 = PARTIALS.iter().map(|&(ratio, level, decay)| level * (TAU * BASE * ratio * time).sin() * (-time / decay).exp()).sum();
            let twin = 0.35 * (TAU * BASE * 1.0015 * time).sin() * (-time / 0.6).exp();
            let (_, _, high) = strike.run(noise.next(), 4000.0, 0.7);
            ramp(time, 0.001) * (ring + twin) + 0.2 * high * (-time / 0.0015).exp()
        })
        .collect()
}

/// A UI click: a bright press transient (high-passed noise + a 3.2 kHz ping, ~6 ms) and a softer
/// release 45 ms later — the mouse/trackpad click SaaS films put on every press.
fn click(frames: usize) -> Vec<f64> {
    let mut noise = Noise(0xC11C_0000_0000_0006);
    let mut high = Svf::default();
    (0..frames)
        .map(|index| {
            let time = index as f64 / HZ;
            let (_, _, air) = high.run(noise.next(), 2500.0, 0.8);
            let press = (0.7 * air + 0.6 * (TAU * 3200.0 * time).sin()) * (-time / 0.006).exp();
            let later = time - 0.045;
            let release = if later >= 0.0 { 0.45 * (0.6 * air + 0.5 * (TAU * 2400.0 * later).sin()) * (-later / 0.004).exp() } else { 0.0 };
            press + release
        })
        .collect()
}

// ── The SaaS / brand-film voices (docs/REFERENCE-FILMS-PLAN.md P9) ────────

/// A UI tick: a 3 ms burst of high band-passed noise plus a short 2.8 kHz ping — the frame-synced
/// tick the Limelight film puts under most UI events.
fn tick(frames: usize) -> Vec<f64> {
    let mut noise = Noise(0x71C4_0000_0000_0007);
    let mut band = Svf::default();
    (0..frames)
        .map(|index| {
            let time = index as f64 / HZ;
            let (_, b, _) = band.run(noise.next(), 4200.0, 1.4);
            (0.8 * b + 0.5 * (TAU * 2800.0 * time).sin()) * (-time / 0.003).exp()
        })
        .collect()
}

/// One keystroke (seed picks the key): a low plastic thock, a bright contact click, and the
/// softer key-up 30–45 ms later.
fn keystroke(out: &mut [f64], start: usize, seed: u64, level: f64) {
    let mut noise = Noise(seed | 1);
    let pitch = 150.0 + 90.0 * noise.unit();
    let release = 0.030 + 0.015 * noise.unit();
    let mut high = Svf::default();
    let length = (0.09 * HZ) as usize;
    for k in 0..length {
        let Some(slot) = out.get_mut(start + k) else { break };
        let time = k as f64 / HZ;
        let (_, _, click) = high.run(noise.next(), 3200.0, 0.8);
        let thock = (TAU * pitch * time).sin() * (-time / 0.012).exp();
        let contact = click * (-time / 0.004).exp();
        let up = if time >= release { 0.35 * click * (-(time - release) / 0.003).exp() } else { 0.0 };
        *slot += level * (0.6 * thock + 0.7 * contact + up);
    }
}

fn key(frames: usize) -> Vec<f64> {
    let mut out = vec![0.0; frames];
    keystroke(&mut out, 0, 0x4B45_5900_0000_0001, 1.0);
    out
}

/// A typing bed: keystrokes at a human, uneven ~13 per second with varied keys and weights —
/// laid under typed text for as long as it types (the clip is trimmed to the typing).
fn typing(frames: usize) -> Vec<f64> {
    let mut out = vec![0.0; frames];
    let mut noise = Noise(0x7479_7069_6E67_0008);
    let mut at = 0.0_f64;
    let length = frames as f64 / HZ;
    let mut n = 0_u64;
    while at < length - 0.09 {
        let level = 0.55 + 0.45 * noise.unit();
        keystroke(&mut out, (at * HZ) as usize, 0x1000 + n * 7919, level);
        n += 1;
        // 60–110 ms between keys; now and then a longer pause, as between words.
        at += 0.06 + 0.05 * noise.unit() + if noise.unit() < 0.12 { 0.12 } else { 0.0 };
    }
    out
}

/// A glass ping: bright inharmonic partials (2.09, 5.2, 8.6 kHz) with fast, faster, fastest
/// decays and a slowly beating twin — the glint sound of glass cards and orbs.
fn glass(frames: usize) -> Vec<f64> {
    const PARTIALS: [(f64, f64, f64); 3] = [(2093.0, 1.0, 0.55), (5234.0, 0.45, 0.22), (8612.0, 0.25, 0.1)];
    (0..frames)
        .map(|index| {
            let time = index as f64 / HZ;
            let ring: f64 = PARTIALS.iter().map(|&(f, level, decay)| level * (TAU * f * time).sin() * (-time / decay).exp()).sum();
            let twin = 0.3 * (TAU * 2097.0 * time).sin() * (-time / 0.5).exp();
            ramp(time, 0.001) * (ring + twin)
        })
        .collect()
}

/// A shimmer: a cloud of tiny high sine grains (4–9 kHz) whose density swells and fades — the
/// sparkle under a star glint or a logo resolve.
fn shimmer(frames: usize) -> Vec<f64> {
    let mut out = vec![0.0; frames];
    let mut noise = Noise(0x5348_494D_0000_0009);
    let length = frames as f64 / HZ;
    let grains = 90;
    for _ in 0..grains {
        // Grains cluster in the middle: the shimmer swells then fades.
        let at = length * (0.5 + 0.5 * (noise.next() + noise.next()) / 2.0).clamp(0.0, 0.98);
        let f = 4000.0 + 5000.0 * noise.unit();
        let decay = 0.02 + 0.06 * noise.unit();
        let level = 0.3 + 0.7 * noise.unit();
        let start = (at * HZ) as usize;
        for k in 0..((decay * 6.0 * HZ) as usize) {
            let Some(slot) = out.get_mut(start + k) else { break };
            let time = k as f64 / HZ;
            *slot += level * (TAU * f * time).sin() * (-time / decay).exp() * ramp(time, 0.002);
        }
    }
    out
}

/// A sub drop: a sine falling 90 → 35 Hz with a long tail and a touch of drive so it reads on
/// small speakers — the hit under a slam ("Boom") or a world change on the drop.
fn sub(frames: usize) -> Vec<f64> {
    let mut phase = 0.0_f64;
    (0..frames)
        .map(|index| {
            let time = index as f64 / HZ;
            let f = 35.0 + 55.0 * (-time / 0.18).exp();
            phase += TAU * f / HZ;
            saturate(phase.sin() * (-time / 0.55).exp(), 1.6) + 0.15 * saturate((2.0 * phase).sin() * (-time / 0.3).exp(), 1.2)
        })
        .collect()
}

/// A data blip: a 120 ms square-ish chirp rising 1.3 → 1.9 kHz — counters, chart points, pills.
fn blip(frames: usize) -> Vec<f64> {
    let mut phase = 0.0_f64;
    let length = frames as f64 / HZ;
    (0..frames)
        .map(|index| {
            let time = index as f64 / HZ;
            let f = 1300.0 + 600.0 * (time / length);
            phase += TAU * f / HZ;
            let square = saturate(phase.sin(), 3.0);
            square * (1.0 - time / length).powf(1.5)
        })
        .collect()
}

/// A digital glitch: 18–55 ms slices, each one of a stuttered grain of an FM tone, bit-crushed
/// noise, a decimated square at a random pitch, or a hole — the sound of a buffer skipping.
fn glitch(frames: usize) -> Vec<f64> {
    let mut noise = Noise(0x611C_4000_0000_0005);
    let tone = |time: f64| (TAU * 220.0 * time + 2.6 * (TAU * 440.0 * time).sin()).sin();
    let crush = |value: f64, levels: f64| (value * levels).round() / levels;
    let mut out = vec![0.0; frames];
    let mut start = 0;
    let mut previous = usize::MAX;
    while start < frames {
        let length = ([0.018, 0.026, 0.038, 0.055][noise.pick(4)] * HZ) as usize;
        let end = (start + length).min(frames);
        // Never the same texture twice running, and a hole only between two sounds.
        let mut kind = noise.pick(4);
        if kind == previous || (kind == 3 && (start == 0 || previous == 3)) {
            kind = (kind + 1 + noise.pick(2)) % 3;
        }
        previous = kind;
        let grain = ((0.004 + 0.01 * noise.unit()) * HZ) as usize;
        let grain_from = noise.unit() * 0.3;
        let hold = 6 + noise.pick(18);
        let pitch = 300.0 + 2100.0 * noise.unit();
        let bits = [4.0, 6.0, 8.0][noise.pick(3)];
        let mut held = 0.0;
        for (offset, slot) in out[start..end].iter_mut().enumerate() {
            let value = match kind {
                0 => tone(grain_from + (offset % grain.max(1)) as f64 / HZ),
                1 => {
                    if offset % hold == 0 {
                        held = crush(noise.next(), bits / 2.0);
                    }
                    0.8 * held
                }
                2 => {
                    let step = offset - offset % (hold / 2).max(2);
                    let square = (TAU * pitch * step as f64 / HZ).sin().signum();
                    0.6 * crush(square, bits)
                }
                _ => 0.0,
            };
            // Half-millisecond edges: hard enough to read as digital, soft enough not to spit.
            let edge = ramp(offset as f64 / HZ, 0.0005) * ramp((end - start - offset) as f64 / HZ, 0.0005);
            *slot = value * edge;
        }
        start = end;
    }
    let length = frames as f64 / HZ;
    for (index, sample) in out.iter_mut().enumerate() {
        *sample *= 1.0 - 0.35 * (index as f64 / HZ / length);
    }
    out
}

/// A 16-bit mono PCM WAV file.
#[must_use]
pub fn wav_bytes(samples: &[f64]) -> Vec<u8> {
    let data_len = u32::try_from(samples.len() * 2).unwrap_or(u32::MAX);
    let mut out = Vec::with_capacity(44 + samples.len() * 2);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&RATE.to_le_bytes());
    out.extend_from_slice(&(RATE * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples {
        let value = (sample * 32767.0).round() as i16;
        out.extend_from_slice(&value.to_le_bytes());
    }
    out
}

pub fn path_for(dir: &Path, kind: SfxKind) -> PathBuf {
    dir.join(format!("{}-v2.wav", kind.as_str()))
}

/// Writes every effect that is not already on disk.
pub fn ensure_all(dir: &Path) -> Result<(), String> {
    for kind in SfxKind::ALL {
        let path = path_for(dir, kind);
        if !path.is_file() {
            std::fs::write(&path, wav_bytes(&samples(kind)))
                .map_err(|error| format!("could not write {}: {error}", path.display()))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{duration, samples, wav_bytes, HZ};
    use crate::project::SfxKind;

    fn peak(data: &[f64]) -> f64 {
        data.iter().fold(0.0_f64, |peak, sample| peak.max(sample.abs()))
    }

    fn rms(data: &[f64]) -> f64 {
        (data.iter().map(|sample| sample * sample).sum::<f64>() / data.len().max(1) as f64).sqrt()
    }

    #[test]
    fn every_effect_is_audible_bounded_and_the_right_length() {
        for kind in SfxKind::ALL {
            let data = samples(kind);
            assert_eq!(data.len(), (48_000.0 * duration(kind)).round() as usize);
            let peak = peak(&data);
            assert!(peak > 0.05 && peak <= 1.0, "{kind:?} peak {peak}");
        }
    }

    #[test]
    fn the_kind_list_names_every_effect_and_each_parses_back() {
        assert_eq!(SfxKind::ALL.len(), 19);
        for kind in SfxKind::ALL {
            assert_eq!(SfxKind::parse(kind.as_str()), Some(kind));
            assert_eq!(serde_json::to_value(kind).ok(), Some(serde_json::json!(kind.as_str())));
            assert!((duration(kind) - kind.length()).abs() < f64::EPSILON);
        }
        assert_eq!(SfxKind::parse("vine"), None);
    }

    #[test]
    fn the_funny_effects_peak_under_minus_one_dbfs_and_are_not_silent() {
        let ceiling = 10f64.powf(-1.0 / 20.0);
        for kind in [SfxKind::Boom, SfxKind::Scratch, SfxKind::Bleep, SfxKind::Swish, SfxKind::Ding, SfxKind::Glitch] {
            let data = samples(kind);
            let peak = peak(&data);
            assert!(peak <= ceiling && peak > 0.5, "{kind:?} peak {peak}");
            assert!(super::true_peak(&data) <= ceiling, "{kind:?} true peak");
            assert!(rms(&data) > 0.05, "{kind:?} rms {}", rms(&data));
            // Both ends are faded: no click at the clip edges.
            assert!(data[0].abs() < 0.01 && data[data.len() - 1].abs() < 0.01, "{kind:?} edges");
            // No DC offset worth hearing.
            let mean = data.iter().sum::<f64>() / data.len() as f64;
            assert!(mean.abs() < 0.01, "{kind:?} dc {mean}");
        }
    }

    #[test]
    fn the_funny_effects_have_their_character() {
        // The boom's energy sits low: a 200 Hz one-pole low-pass keeps most of it.
        let boom = samples(SfxKind::Boom);
        let alpha = 1.0 - (-std::f64::consts::TAU * 200.0 / HZ).exp();
        let mut state = 0.0;
        let low: Vec<f64> = boom.iter().map(|sample| { state += alpha * (sample - state); state }).collect();
        assert!(rms(&low) > 0.6 * rms(&boom), "boom low {} of {}", rms(&low), rms(&boom));
        // It holds like the reference boom, then falls away: the last tenth ≥ 6 dB under the first.
        let tenth = boom.len() / 10;
        assert!(rms(&boom[boom.len() - tenth..]) < 0.5 * rms(&boom[..tenth]));

        // The bleep is 1 kHz: 800 zero-crossing pairs in 0.8 s, give or take the edges.
        let bleep = samples(SfxKind::Bleep);
        let crossings = bleep.windows(2).filter(|pair| pair[0] < 0.0 && pair[1] >= 0.0).count();
        assert!((798..=801).contains(&crossings), "bleep crossings {crossings}");

        // The ding rings on and dies away; the glitch stops and starts.
        let ding = samples(SfxKind::Ding);
        let quarter = ding.len() / 4;
        assert!(rms(&ding[..quarter]) > 4.0 * rms(&ding[3 * quarter..]));
        let glitch = samples(SfxKind::Glitch);
        let block = 240; // 5 ms
        let levels: Vec<f64> = glitch.chunks(block).map(rms).collect();
        let jumps = levels.windows(2).filter(|pair| (pair[0] - pair[1]).abs() > 0.1).count();
        assert!(jumps >= 4, "glitch jumps {jumps}");
    }

    /// `HELIOS_SFX_OUT=<folder> cargo test -p helios render_every_effect -- --ignored` writes every
    /// effect there, to listen to or plot.
    #[test]
    #[ignore = "writes WAV files for listening"]
    fn render_every_effect_to_a_folder() {
        let Ok(folder) = std::env::var("HELIOS_SFX_OUT") else { return };
        std::fs::create_dir_all(&folder).unwrap();
        for kind in SfxKind::ALL {
            std::fs::write(std::path::Path::new(&folder).join(format!("{}.wav", kind.as_str())), wav_bytes(&samples(kind))).unwrap();
        }
    }

    #[test]
    fn the_wav_header_describes_the_data() {
        let bytes = wav_bytes(&[0.0, 0.5, -0.5]);
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(bytes.len(), 44 + 6);
        assert_eq!(u32::from_le_bytes([bytes[40], bytes[41], bytes[42], bytes[43]]), 6);
    }
}
