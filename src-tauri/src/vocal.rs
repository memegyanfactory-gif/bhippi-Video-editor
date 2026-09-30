//! The lead vocal of a song, pulled forward for transcription.
//!
//! Speech engines hear sung lines badly under a full mix. A lead vocal is almost always mixed dead
//! centre while most instruments sit left or right, so where the two channels agree at a frequency
//! the sound is mostly voice. This keeps, frame by frame and bin by bin, the centre (mid) signal
//! weighted by how alike the channels are there (similarity to the 10th power), inside the voice
//! band, and drops the rest: the mask the 29 Sep launch film used to get word times for its sung
//! verses. Plain arithmetic with a small radix-2 FFT; no dependencies.

use std::f32::consts::PI;
use std::path::{Path, PathBuf};

use crate::tools::Tools;

/// The rate the vocal is analysed and written at: all a speech engine uses.
pub const RATE: u32 = 16_000;
const FRAME: usize = 2048;
const HOP: usize = 512;
/// The voice band kept, Hz: below it is kick and bass, above it cymbals.
const LOW_HZ: f32 = 140.0;
const HIGH_HZ: f32 = 7_500.0;
/// How sharply the mask falls off as the channels differ.
const SHARPNESS: i32 = 10;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Complex {
    re: f32,
    im: f32,
}

impl Complex {
    fn mul(self, other: Complex) -> Complex {
        Complex { re: self.re * other.re - self.im * other.im, im: self.re * other.im + self.im * other.re }
    }
    fn norm_sq(self) -> f32 {
        self.re * self.re + self.im * self.im
    }
}

/// In-place iterative radix-2 FFT (`inverse` scales by 1/n). `data.len()` must be a power of two.
fn fft(data: &mut [Complex], inverse: bool) {
    let n = data.len();
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            data.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let angle = if inverse { 2.0 * PI / len as f32 } else { -2.0 * PI / len as f32 };
        let step = Complex { re: angle.cos(), im: angle.sin() };
        for start in (0..n).step_by(len) {
            let mut w = Complex { re: 1.0, im: 0.0 };
            for k in 0..len / 2 {
                let even = data[start + k];
                let odd = data[start + k + len / 2].mul(w);
                data[start + k] = Complex { re: even.re + odd.re, im: even.im + odd.im };
                data[start + k + len / 2] = Complex { re: even.re - odd.re, im: even.im - odd.im };
                w = w.mul(step);
            }
        }
        len <<= 1;
    }
    if inverse {
        let scale = 1.0 / n as f32;
        for value in data.iter_mut() {
            value.re *= scale;
            value.im *= scale;
        }
    }
}

/// The centre-panned voice of a stereo signal at `rate`, mono, same length.
pub fn isolate(left: &[f32], right: &[f32], rate: u32) -> Vec<f32> {
    let length = left.len().min(right.len());
    let mut out = vec![0.0f32; length];
    let mut weight = vec![0.0f32; length];
    if length == 0 {
        return out;
    }
    let window: Vec<f32> = (0..FRAME).map(|i| 0.5 - 0.5 * (2.0 * PI * i as f32 / FRAME as f32).cos()).collect();
    let bin_hz = rate as f32 / FRAME as f32;
    let low = (LOW_HZ / bin_hz).floor() as usize;
    let high = ((HIGH_HZ / bin_hz).ceil() as usize).min(FRAME / 2);
    let mut l = vec![Complex::default(); FRAME];
    let mut r = vec![Complex::default(); FRAME];
    let mut mid = vec![Complex::default(); FRAME];
    let mut start = 0usize;
    loop {
        for i in 0..FRAME {
            let at = start + i;
            let (a, b) = if at < length { (left[at], right[at]) } else { (0.0, 0.0) };
            l[i] = Complex { re: a * window[i], im: 0.0 };
            r[i] = Complex { re: b * window[i], im: 0.0 };
        }
        fft(&mut l, false);
        fft(&mut r, false);
        for k in 0..FRAME {
            // Bins mirror above Nyquist: use the same mask on k and FRAME - k.
            let bin = if k <= FRAME / 2 { k } else { FRAME - k };
            let keep = if bin >= low && bin <= high {
                let cross = l[k].mul(Complex { re: r[k].re, im: -r[k].im });
                let power = l[k].norm_sq() + r[k].norm_sq();
                if power > 1e-12 {
                    let similarity = (2.0 * cross.norm_sq().sqrt() / power).clamp(0.0, 1.0);
                    // Only in-phase agreement is centre: a phase-inverted pair is wide, not centre.
                    if cross.re > 0.0 { similarity.powi(SHARPNESS) } else { 0.0 }
                } else {
                    0.0
                }
            } else {
                0.0
            };
            mid[k] = Complex { re: 0.5 * (l[k].re + r[k].re) * keep, im: 0.5 * (l[k].im + r[k].im) * keep };
        }
        fft(&mut mid, true);
        for i in 0..FRAME {
            let at = start + i;
            if at >= length {
                break;
            }
            out[at] += mid[i].re * window[i];
            weight[at] += window[i] * window[i];
        }
        if start + FRAME >= length {
            break;
        }
        start += HOP;
    }
    for (sample, w) in out.iter_mut().zip(weight.iter()) {
        if *w > 1e-6 {
            *sample /= *w;
        }
    }
    out
}

/// 16-bit mono PCM WAV bytes.
pub fn wav_bytes(samples: &[f32], rate: u32) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let mut bytes = Vec::with_capacity(44 + data_len as usize);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&rate.to_le_bytes());
    bytes.extend_from_slice(&(rate * 2).to_le_bytes());
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_len.to_le_bytes());
    // Normalise to -1 dBFS peak so a quiet vocal stem still reaches the engine at a useful level.
    let peak = samples.iter().fold(0.0f32, |max, s| max.max(s.abs()));
    let gain = if peak > 1e-6 { 0.89 / peak } else { 1.0 };
    for sample in samples {
        let value = (sample * gain).clamp(-1.0, 1.0);
        bytes.extend_from_slice(&((value * i16::MAX as f32) as i16).to_le_bytes());
    }
    bytes
}

/// Writes the isolated vocal of `source` to `<work>/<id>-vocal.wav` and returns its path.
pub async fn vocal_wav(tools: &Tools, source: &str, work: &Path, id: &str) -> Result<PathBuf, String> {
    let ffmpeg = tools.ffmpeg()?;
    std::fs::create_dir_all(work).map_err(|error| format!("cannot create {}: {error}", work.display()))?;
    let raw = work.join(format!("{id}-stereo.f32"));
    let raw_text = raw.display().to_string();
    let rate = RATE.to_string();
    let args = ["-hide_banner", "-loglevel", "error", "-y", "-i", source, "-vn", "-ac", "2", "-ar", rate.as_str(), "-f", "f32le", "-acodec", "pcm_f32le", raw_text.as_str()];
    crate::tools::run(ffmpeg, &args, None).await.map_err(|error| format!("FFmpeg could not read the song: {error}"))?;
    let target = work.join(format!("{id}-vocal.wav"));
    let raw_for_task = raw.clone();
    let target_for_task = target.clone();
    let result = tokio::task::spawn_blocking(move || -> Result<(), String> {
        let bytes = std::fs::read(&raw_for_task).map_err(|error| format!("cannot read the decoded song: {error}"))?;
        let samples: Vec<f32> = bytes.chunks_exact(4).map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]])).collect();
        let left: Vec<f32> = samples.iter().step_by(2).copied().collect();
        let right: Vec<f32> = samples.iter().skip(1).step_by(2).copied().collect();
        let voice = isolate(&left, &right, RATE);
        std::fs::write(&target_for_task, wav_bytes(&voice, RATE)).map_err(|error| format!("cannot write the vocal: {error}"))
    })
    .await
    .map_err(|error| error.to_string());
    let _ignored = std::fs::remove_file(&raw);
    result??;
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::{fft, isolate, wav_bytes, Complex, RATE};
    use std::f32::consts::PI;

    fn tone(hz: f32, seconds: f32) -> Vec<f32> {
        (0..(seconds * RATE as f32) as usize).map(|i| (2.0 * PI * hz * i as f32 / RATE as f32).sin() * 0.5).collect()
    }

    fn rms(samples: &[f32]) -> f32 {
        let body = &samples[samples.len() / 4..samples.len() * 3 / 4];
        (body.iter().map(|s| s * s).sum::<f32>() / body.len() as f32).sqrt()
    }

    #[test]
    fn the_fft_round_trips() {
        let original: Vec<Complex> = (0..64).map(|i| Complex { re: (i as f32 * 0.37).sin(), im: 0.0 }).collect();
        let mut data = original.clone();
        fft(&mut data, false);
        fft(&mut data, true);
        for (a, b) in original.iter().zip(data.iter()) {
            assert!((a.re - b.re).abs() < 1e-4 && b.im.abs() < 1e-4);
        }
    }

    #[test]
    fn a_centred_voice_stays_and_a_wide_instrument_goes() {
        let voice = tone(440.0, 1.0);
        let guitar = tone(660.0, 1.0);
        // The voice in both channels; the guitar hard left only.
        let left: Vec<f32> = voice.iter().zip(&guitar).map(|(v, g)| v + g).collect();
        let right = voice.clone();
        let out = isolate(&left, &right, RATE);
        assert_eq!(out.len(), left.len());
        // Correlate the result with each source: the voice survives, the guitar mostly does not.
        let with = |source: &[f32]| out.iter().zip(source).map(|(a, b)| a * b).sum::<f32>() / source.iter().map(|b| b * b).sum::<f32>();
        assert!(with(&voice) > 0.6, "voice kept {:.2}", with(&voice));
        assert!(with(&guitar) < 0.2, "guitar kept {:.2}", with(&guitar));
    }

    #[test]
    fn bass_below_the_voice_band_goes() {
        let bass = tone(60.0, 1.0);
        let out = isolate(&bass, &bass, RATE);
        assert!(rms(&out) < 0.05 * rms(&bass), "bass left {:.3}", rms(&out));
    }

    #[test]
    fn the_wav_header_is_right() {
        let bytes = wav_bytes(&[0.0, 0.5, -0.5], RATE);
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..16], b"WAVEfmt ");
        assert_eq!(u32::from_le_bytes([bytes[24], bytes[25], bytes[26], bytes[27]]), RATE);
        assert_eq!(bytes.len(), 44 + 6);
    }
}
