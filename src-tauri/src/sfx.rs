//! Procedural sound effects, synthesised once into WAV files the preview and export share.

use crate::project::SfxKind;
use std::path::{Path, PathBuf};

const RATE: u32 = 48_000;

#[must_use]
pub const fn duration(kind: SfxKind) -> f64 {
    match kind {
        SfxKind::Whoosh => 0.9,
        SfxKind::Impact => 1.4,
        SfxKind::Chime => 1.6,
        SfxKind::Pop => 0.25,
        SfxKind::Riser => 2.0,
    }
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
}

/// Samples in −1.0 … 1.0 for one effect.
#[must_use]
pub fn samples(kind: SfxKind) -> Vec<f64> {
    let length = duration(kind);
    let frames = (f64::from(RATE) * length).round() as usize;
    let mut noise = Noise(0x9E37_79B9_7F4A_7C15);
    let mut filtered = 0.0;
    let mut phase = 0.0_f64;
    let tau = std::f64::consts::TAU;
    (0..frames)
        .map(|index| {
            let time = index as f64 / f64::from(RATE);
            let position = time / length;
            let attack = (time / 0.008).min(1.0);
            let release = ((length - time) / 0.03).clamp(0.0, 1.0);
            let white = noise.next();
            let sample = match kind {
                SfxKind::Whoosh => {
                    filtered = 0.75 * filtered + 0.25 * white;
                    phase += tau * (180.0 + 1400.0 * position) / f64::from(RATE);
                    (0.9 * filtered + 0.12 * phase.sin()) * (std::f64::consts::PI * position).sin().powf(1.6)
                }
                SfxKind::Impact => {
                    phase += tau * (42.0 + 110.0 * (-11.0 * time).exp()) / f64::from(RATE);
                    (0.8 * phase.sin() + 0.35 * white * (-30.0 * time).exp()) * (-5.0 * time).exp()
                }
                SfxKind::Chime => {
                    let partials = 0.55 * (tau * 880.0 * time).sin()
                        + 0.28 * (tau * 1320.0 * time).sin()
                        + 0.12 * (tau * 1760.0 * time).sin();
                    partials * (-2.8 * time).exp()
                }
                SfxKind::Pop => {
                    phase += tau * (900.0 * (-25.0 * time).exp() + 180.0) / f64::from(RATE);
                    phase.sin() * (-22.0 * time).exp()
                }
                SfxKind::Riser => {
                    filtered = 0.6 * filtered + 0.4 * white;
                    phase += tau * (120.0 + 900.0 * position * position) / f64::from(RATE);
                    (0.55 * phase.sin() + 0.35 * filtered) * position.powf(1.8)
                }
            };
            (sample * attack * release * 0.8).clamp(-1.0, 1.0)
        })
        .collect()
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
    use super::{duration, samples, wav_bytes};
    use crate::project::SfxKind;

    #[test]
    fn every_effect_is_audible_bounded_and_the_right_length() {
        for kind in SfxKind::ALL {
            let data = samples(kind);
            assert_eq!(data.len(), (48_000.0 * duration(kind)).round() as usize);
            let peak = data.iter().fold(0.0_f64, |peak, sample| peak.max(sample.abs()));
            assert!(peak > 0.05 && peak <= 1.0, "{kind:?} peak {peak}");
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
