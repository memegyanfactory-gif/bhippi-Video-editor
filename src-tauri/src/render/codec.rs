//! Formats and codecs, Media Encoder-style: what each export format writes (container, video
//! codec, audio codec), and the encoder arguments for a quality, a bitrate or a mastering profile.
//!
//! Every format is one container + codec pair the UI lists (src/lib/exportPresets.ts mirrors this
//! table). Delivery codecs (H.264, HEVC, AV1, VP9) run on the GPU when the card has that encoder and
//! the export does not refuse it, and on the CPU otherwise; mastering codecs (ProRes, DNxHR) and
//! GIF are CPU-only in FFmpeg.

use super::VideoEncoder;

/// The picture codec of a format.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Family {
    H264,
    Hevc,
    Av1,
    Vp9,
    /// ProRes 422 (Proxy · LT · 422 · HQ).
    ProRes,
    /// ProRes 4444 with alpha.
    ProRes4444,
    /// DNxHR (LB · SQ · HQ · HQX · 444).
    DnxHr,
    Mpeg4,
    Gif,
}

/// The sound codec of a format.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Sound {
    Aac,
    Opus,
    Mp3,
    Flac,
    Pcm16,
    Pcm24,
    None,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Format {
    pub ext: &'static str,
    /// `None` for audio-only formats.
    pub video: Option<Family>,
    pub sound: Sound,
}

pub const FORMATS: [&str; 14] = ["mp4", "mov", "hevc", "av1", "webm", "prores", "mov-alpha", "dnxhr", "avi", "gif", "mp3", "wav", "m4a", "flac"];

pub fn format(id: &str) -> Result<Format, String> {
    let (ext, video, sound) = match id {
        "mp4" => ("mp4", Some(Family::H264), Sound::Aac),
        "mov" => ("mov", Some(Family::H264), Sound::Aac),
        "hevc" => ("mp4", Some(Family::Hevc), Sound::Aac),
        "av1" => ("mp4", Some(Family::Av1), Sound::Aac),
        "webm" => ("webm", Some(Family::Vp9), Sound::Opus),
        "prores" => ("mov", Some(Family::ProRes), Sound::Pcm24),
        "mov-alpha" => ("mov", Some(Family::ProRes4444), Sound::Aac),
        "dnxhr" => ("mov", Some(Family::DnxHr), Sound::Pcm24),
        "avi" => ("avi", Some(Family::Mpeg4), Sound::Pcm16),
        "gif" => ("gif", Some(Family::Gif), Sound::None),
        "mp3" => ("mp3", None, Sound::Mp3),
        "wav" => ("wav", None, Sound::Pcm24),
        "m4a" => ("m4a", None, Sound::Aac),
        "flac" => ("flac", None, Sound::Flac),
        other => return Err(format!("\"{other}\" is not an export format — one of {}", FORMATS.join(", "))),
    };
    Ok(Format { ext, video, sound })
}

/// Which encoders this export may use: the H.264 choice (GPU or CPU, see [`VideoEncoder::choose`])
/// and whether the same GPU also encodes HEVC and AV1 here (a test encode at startup decides:
/// an RTX 30 has NVENC HEVC but no AV1).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Codecs {
    pub h264: VideoEncoder,
    pub gpu_hevc: bool,
    pub gpu_av1: bool,
}

impl Codecs {
    pub const fn cpu(x264: bool) -> Self {
        Self { h264: VideoEncoder::cpu(x264), gpu_hevc: false, gpu_av1: false }
    }

    /// The same encoders with every GPU one swapped for its CPU equivalent (the fallback render).
    pub const fn without_gpu(self, x264: bool) -> Self {
        Self::cpu(x264)
    }

    fn vendor(self) -> Option<&'static str> {
        match self.h264 {
            VideoEncoder::Nvenc => Some("nvenc"),
            VideoEncoder::Qsv => Some("qsv"),
            VideoEncoder::Amf => Some("amf"),
            _ => None,
        }
    }
}

/// How the bitrate is decided.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Rate {
    /// Constant quality (CRF / CQ) on the draft · standard · high ladder.
    Quality(usize),
    /// Variable bitrate: a target and a ceiling, in Mbit/s.
    Vbr { target: f64, max: f64 },
    /// Constant bitrate, in Mbit/s (streaming ingest, broadcast).
    Cbr(f64),
}

pub struct VideoSettings<'a> {
    pub rate: Rate,
    /// Profile of a mastering codec: `proxy` · `lt` · `standard` · `hq` (ProRes),
    /// `lb` · `sq` · `hq` · `hqx` · `444` (DNxHR).
    pub profile: Option<&'a str>,
    /// 8 or 10 (HEVC, AV1).
    pub bit_depth: u8,
    /// Keyframe every this many frames; `None` leaves it to the encoder.
    pub gop: Option<u32>,
    /// WebM with an alpha channel.
    pub alpha: bool,
    /// Two-pass VBR (CPU encoders only): the stats file both passes share.
    pub passlog: Option<&'a str>,
}

/// What the encoder needs: its arguments, the pixel format the picture must arrive in, whether it
/// runs on the GPU, and the arguments of a first pass when the encode is two-pass.
#[derive(Debug)]
pub struct VideoCodec {
    pub args: Vec<String>,
    pub pix_fmt: &'static str,
    pub gpu: bool,
    pub first_pass: Option<Vec<String>>,
}

fn strings(list: &[&str]) -> Vec<String> {
    list.iter().map(|item| (*item).to_owned()).collect()
}

fn mbit(value: f64) -> String {
    format!("{}k", (value * 1000.0).round().max(100.0) as u64)
}

/// Bitrate arguments shared by the encoders that read FFmpeg's generic rate options.
fn rate_args(rate: Rate) -> Vec<String> {
    match rate {
        Rate::Quality(_) => Vec::new(),
        Rate::Vbr { target, max } => vec!["-b:v".into(), mbit(target), "-maxrate".into(), mbit(max.max(target)), "-bufsize".into(), mbit(max.max(target) * 2.0)],
        Rate::Cbr(target) => vec!["-b:v".into(), mbit(target), "-minrate".into(), mbit(target), "-maxrate".into(), mbit(target), "-bufsize".into(), mbit(target * 2.0)],
    }
}

/// The picture encoder for `family` under `settings`.
pub fn video(family: Family, codecs: Codecs, settings: &VideoSettings) -> Result<VideoCodec, String> {
    let rung = match settings.rate { Rate::Quality(rung) => rung.min(2), _ => 1 };
    let ten = settings.bit_depth >= 10;
    let gop: Vec<String> = settings.gop.map(|frames| vec!["-g".into(), frames.max(1).to_string()]).unwrap_or_default();
    let two_pass = matches!(settings.rate, Rate::Vbr { .. }) && settings.passlog.is_some();
    let mut first_pass = None;
    let mut gpu = false;
    let (mut args, pix_fmt): (Vec<String>, &'static str) = match family {
        Family::H264 => {
            let encoder = codecs.h264;
            gpu = encoder.is_gpu();
            let mut args = match settings.rate {
                Rate::Quality(_) => encoder.args(["draft", "standard", "high"][rung]),
                _ => match encoder {
                    VideoEncoder::X264 => strings(&["-c:v", "libx264", "-preset", "slow", "-profile:v", "high"]),
                    VideoEncoder::Mpeg4 => strings(&["-c:v", "mpeg4"]),
                    VideoEncoder::Nvenc => strings(&["-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq", "-rc", if matches!(settings.rate, Rate::Cbr(_)) { "cbr" } else { "vbr" }, "-spatial-aq", "1", "-profile:v", "high"]),
                    VideoEncoder::Qsv => strings(&["-c:v", "h264_qsv", "-preset", "slow", "-profile:v", "high"]),
                    VideoEncoder::Amf => strings(&["-c:v", "h264_amf", "-quality", "quality", "-rc", if matches!(settings.rate, Rate::Cbr(_)) { "cbr" } else { "vbr_peak" }, "-profile:v", "high"]),
                },
            };
            args.extend(rate_args(settings.rate));
            if matches!(settings.rate, Rate::Cbr(_)) && encoder == VideoEncoder::X264 {
                args.extend(strings(&["-x264-params", "nal-hrd=cbr:force-cfr=1"]));
            }
            if two_pass && encoder == VideoEncoder::X264 {
                let log = settings.passlog.unwrap_or_default();
                let mut first = args.clone();
                first.extend(["-pass".into(), "1".into(), "-passlogfile".into(), log.to_owned()]);
                first_pass = Some(first);
                args.extend(["-pass".into(), "2".into(), "-passlogfile".into(), log.to_owned()]);
            }
            (args, "yuv420p")
        }
        Family::Hevc => {
            let (args, pix) = match codecs.vendor().filter(|_| codecs.gpu_hevc) {
                Some(vendor) => {
                    gpu = true;
                    let mut args = vec!["-c:v".to_owned(), format!("hevc_{vendor}")];
                    match (vendor, settings.rate) {
                        ("nvenc", Rate::Quality(_)) => args.extend(strings(&["-preset", ["p2", "p4", "p6"][rung], "-tune", "hq", "-rc", "vbr", "-cq", ["32", "26", "22"][rung], "-b:v", "0", "-spatial-aq", "1"])),
                        ("nvenc", rate) => args.extend(strings(&["-preset", "p5", "-tune", "hq", "-rc", if matches!(rate, Rate::Cbr(_)) { "cbr" } else { "vbr" }, "-spatial-aq", "1"])),
                        ("qsv", Rate::Quality(_)) => args.extend(strings(&["-preset", ["veryfast", "medium", "slow"][rung], "-global_quality", ["32", "26", "22"][rung]])),
                        ("amf", Rate::Quality(_)) => args.extend(strings(&["-quality", ["speed", "balanced", "quality"][rung], "-rc", "cqp", "-qp_i", ["28", "22", "18"][rung], "-qp_p", ["30", "24", "20"][rung]])),
                        _ => {}
                    }
                    args.extend(rate_args(settings.rate));
                    if ten {
                        args.extend(strings(&["-profile:v", "main10"]));
                    }
                    (args, if ten { "p010le" } else { "yuv420p" })
                }
                None => {
                    let mut params = vec!["log-level=error".to_owned()];
                    let mut args = strings(&["-c:v", "libx265"]);
                    match settings.rate {
                        Rate::Quality(_) => args.extend(strings(&["-preset", ["veryfast", "medium", "slow"][rung], "-crf", ["30", "24", "20"][rung]])),
                        rate => {
                            args.extend(strings(&["-preset", "slow"]));
                            args.extend(rate_args(rate));
                            if matches!(rate, Rate::Cbr(_)) {
                                params.push("strict-cbr=1".into());
                            }
                        }
                    }
                    if ten {
                        args.extend(strings(&["-profile:v", "main10"]));
                    }
                    if two_pass {
                        let log = settings.passlog.unwrap_or_default().replace('\\', "/");
                        let mut first = args.clone();
                        first.extend(["-x265-params".into(), format!("{}:pass=1:stats={log}", params.join(":"))]);
                        first_pass = Some(first);
                        params.push(format!("pass=2:stats={log}"));
                    }
                    args.extend(["-x265-params".into(), params.join(":")]);
                    (args, if ten { "yuv420p10le" } else { "yuv420p" })
                }
            };
            // `hvc1` is the sample entry Apple players (QuickTime, iOS, Final Cut) require.
            let mut args = args;
            args.extend(strings(&["-tag:v", "hvc1"]));
            if let Some(first) = first_pass.as_mut() {
                first.extend(strings(&["-tag:v", "hvc1"]));
            }
            (args, pix)
        }
        Family::Av1 => match codecs.vendor().filter(|_| codecs.gpu_av1) {
            Some(vendor) => {
                gpu = true;
                let mut args = vec!["-c:v".to_owned(), format!("av1_{vendor}")];
                if let ("nvenc", Rate::Quality(_)) = (vendor, settings.rate) {
                    args.extend(strings(&["-preset", ["p2", "p4", "p6"][rung], "-tune", "hq", "-rc", "vbr", "-cq", ["40", "33", "28"][rung], "-b:v", "0"]));
                } else if let Rate::Quality(_) = settings.rate {
                    args.extend(strings(&["-global_quality", ["40", "33", "28"][rung]]));
                } else if vendor == "nvenc" {
                    args.extend(strings(&["-preset", "p5", "-tune", "hq", "-rc", if matches!(settings.rate, Rate::Cbr(_)) { "cbr" } else { "vbr" }]));
                }
                args.extend(rate_args(settings.rate));
                (args, if ten { "p010le" } else { "yuv420p" })
            }
            None => {
                let mut args = strings(&["-c:v", "libsvtav1"]);
                match settings.rate {
                    Rate::Quality(_) => args.extend(strings(&["-preset", ["10", "8", "5"][rung], "-crf", ["40", "33", "27"][rung]])),
                    // SVT-AV1 has no constant-bitrate mode for files; a capped VBR is the nearest.
                    Rate::Vbr { target, .. } | Rate::Cbr(target) => args.extend(vec!["-preset".into(), "7".into(), "-b:v".into(), mbit(target)]),
                }
                args.extend(strings(&["-svtav1-params", "tune=0"]));
                (args, if ten { "yuv420p10le" } else { "yuv420p" })
            }
        },
        Family::Vp9 => {
            let mut args = strings(&["-c:v", "libvpx-vp9", "-row-mt", "1", "-deadline", "good", "-cpu-used", ["5", "3", "2"][rung]]);
            match settings.rate {
                Rate::Quality(_) => args.extend(strings(&["-crf", ["38", "32", "26"][rung], "-b:v", "0"])),
                rate => args.extend(rate_args(rate)),
            }
            if two_pass {
                let log = settings.passlog.unwrap_or_default();
                let mut first = args.clone();
                first.extend(["-pass".into(), "1".into(), "-passlogfile".into(), log.to_owned()]);
                first_pass = Some(first);
                args.extend(["-pass".into(), "2".into(), "-passlogfile".into(), log.to_owned()]);
            }
            (args, if settings.alpha { "yuva420p" } else { "yuv420p" })
        }
        Family::ProRes => {
            let profile = match settings.profile.unwrap_or("hq") {
                "proxy" => "0",
                "lt" => "1",
                "standard" => "2",
                "hq" => "3",
                other => return Err(format!("\"{other}\" is not a ProRes 422 profile — proxy, lt, standard or hq")),
            };
            (strings(&["-c:v", "prores_ks", "-profile:v", profile, "-vendor", "apl0"]), "yuv422p10le")
        }
        Family::ProRes4444 => (strings(&["-c:v", "prores_ks", "-profile:v", "4444", "-vendor", "apl0"]), "yuva444p10le"),
        Family::DnxHr => {
            let (profile, pix) = match settings.profile.unwrap_or("hq") {
                "lb" => ("dnxhr_lb", "yuv422p"),
                "sq" => ("dnxhr_sq", "yuv422p"),
                "hq" => ("dnxhr_hq", "yuv422p"),
                "hqx" => ("dnxhr_hqx", "yuv422p10le"),
                "444" => ("dnxhr_444", "yuv444p10le"),
                other => return Err(format!("\"{other}\" is not a DNxHR profile — lb, sq, hq, hqx or 444")),
            };
            (strings(&["-c:v", "dnxhd", "-profile:v", profile]), pix)
        }
        Family::Mpeg4 => (super::mpeg4_args(["6", "3", "2"][rung], rung > 0), "yuv420p"),
        Family::Gif => (strings(&["-c:v", "gif", "-loop", "0"]), "pal8"),
    };
    if matches!(family, Family::H264 | Family::Hevc | Family::Av1 | Family::Vp9) {
        args.extend(gop.clone());
        if let Some(first) = first_pass.as_mut() {
            first.extend(gop);
        }
    }
    Ok(VideoCodec { args, pix_fmt, gpu, first_pass })
}

/// The sound encoder, at `kbps` for the lossy codecs.
pub fn sound(sound: Sound, kbps: u32) -> Vec<String> {
    let rate = format!("{}k", kbps.clamp(32, 512));
    match sound {
        Sound::Aac => vec!["-c:a".into(), "aac".into(), "-b:a".into(), rate],
        Sound::Opus => vec!["-c:a".into(), "libopus".into(), "-b:a".into(), format!("{}k", kbps.clamp(32, 510))],
        Sound::Mp3 => vec!["-c:a".into(), "libmp3lame".into(), "-b:a".into(), format!("{}k", kbps.clamp(32, 320))],
        Sound::Flac => strings(&["-c:a", "flac", "-compression_level", "8"]),
        Sound::Pcm16 => strings(&["-c:a", "pcm_s16le"]),
        Sound::Pcm24 => strings(&["-c:a", "pcm_s24le"]),
        Sound::None => strings(&["-an"]),
    }
}

/// Measured loudness (EBU R128), from a first pass of the soundtrack through `loudnorm`.
#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Loudness {
    pub input_i: f64,
    pub input_tp: f64,
    pub input_lra: f64,
    pub input_thresh: f64,
    pub target_offset: f64,
}

/// Reads the JSON block `loudnorm=print_format=json` prints at the end of stderr.
pub fn parse_loudness(stderr: &str) -> Option<Loudness> {
    let start = stderr.rfind("\"input_i\"").and_then(|at| stderr[..at].rfind('{'))?;
    let end = start + stderr[start..].find('}')?;
    let value: serde_json::Value = serde_json::from_str(&stderr[start..=end]).ok()?;
    // Silence reads "-inf": kept as a very low number, which `loudnorm` below treats as nothing to do.
    let read = |key: &str| value[key].as_str().and_then(|text| text.trim().parse::<f64>().ok()).filter(|n| !n.is_nan()).map(|n| n.clamp(-99.0, 99.0));
    Some(Loudness { input_i: read("input_i")?, input_tp: read("input_tp")?, input_lra: read("input_lra")?, input_thresh: read("input_thresh")?, target_offset: read("target_offset").unwrap_or(0.0) })
}

/// Loudness targets are LUFS between these (−14 streaming, −16 podcasts, −23/−24 broadcast).
pub const LOUDNESS_RANGE: std::ops::RangeInclusive<f64> = -36.0..=-5.0;

/// The `loudnorm` stage: linear gain from a measurement when there is one (the way Premiere and
/// Media Encoder normalise — no pumping), a single dynamic pass otherwise. It resamples to 192 kHz
/// internally, so the caller brings the stream back to 48 kHz after it.
pub fn loudnorm(target: f64, measured: Option<Loudness>) -> String {
    let base = format!("loudnorm=I={}:TP=-1:LRA=11", super::num(target));
    match measured {
        // Digital silence measures −inf / −70: there is nothing to normalise.
        Some(m) if m.input_i > -70.0 => format!(
            "{base}:measured_I={}:measured_TP={}:measured_LRA={}:measured_thresh={}:offset={}:linear=true:print_format=none",
            super::num(m.input_i), super::num(m.input_tp), super::num(m.input_lra), super::num(m.input_thresh), super::num(m.target_offset)
        ),
        Some(_) => "anull".to_owned(),
        None => format!("{base}:print_format=none"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CPU: Codecs = Codecs::cpu(true);
    const NVENC: Codecs = Codecs { h264: VideoEncoder::Nvenc, gpu_hevc: true, gpu_av1: false };

    fn settings(rate: Rate) -> VideoSettings<'static> {
        VideoSettings { rate, profile: None, bit_depth: 8, gop: None, alpha: false, passlog: None }
    }

    #[test]
    fn every_listed_format_has_a_container_and_codec() {
        for id in FORMATS {
            let format = format(id).unwrap_or_else(|error| panic!("{id}: {error}"));
            if let Some(family) = format.video {
                let profile = VideoSettings { profile: None, ..settings(Rate::Quality(1)) };
                video(family, CPU, &profile).unwrap_or_else(|error| panic!("{id}: {error}"));
            }
        }
        assert!(format("mkv-lossless").is_err());
    }

    #[test]
    fn hevc_uses_the_gpu_when_it_can_and_tags_hvc1() {
        let gpu = video(Family::Hevc, NVENC, &settings(Rate::Quality(2))).unwrap();
        assert!(gpu.gpu && gpu.args.contains(&"hevc_nvenc".to_owned()) && gpu.args.contains(&"hvc1".to_owned()), "{:?}", gpu.args);
        let cpu = video(Family::Hevc, CPU, &VideoSettings { bit_depth: 10, ..settings(Rate::Quality(1)) }).unwrap();
        assert!(!cpu.gpu && cpu.args.contains(&"libx265".to_owned()) && cpu.pix_fmt == "yuv420p10le", "{:?}", cpu.args);
    }

    #[test]
    fn av1_falls_back_to_svt_when_the_card_has_no_av1_encoder() {
        let codec = video(Family::Av1, NVENC, &settings(Rate::Quality(1))).unwrap();
        assert!(!codec.gpu && codec.args.contains(&"libsvtav1".to_owned()));
    }

    #[test]
    fn bitrate_modes_reach_the_encoder() {
        let vbr = video(Family::H264, CPU, &settings(Rate::Vbr { target: 16.0, max: 24.0 })).unwrap();
        let text = vbr.args.join(" ");
        assert!(text.contains("-b:v 16000k") && text.contains("-maxrate 24000k") && !text.contains("-crf"), "{text}");
        let cbr = video(Family::H264, NVENC, &settings(Rate::Cbr(8.0))).unwrap().args.join(" ");
        assert!(cbr.contains("-rc cbr") && cbr.contains("-minrate 8000k"), "{cbr}");
    }

    #[test]
    fn two_pass_writes_matching_passes() {
        let codec = video(Family::H264, CPU, &VideoSettings { passlog: Some("pass"), ..settings(Rate::Vbr { target: 10.0, max: 15.0 }) }).unwrap();
        let first = codec.first_pass.expect("a first pass").join(" ");
        assert!(first.contains("-pass 1 -passlogfile pass") && codec.args.join(" ").contains("-pass 2 -passlogfile pass"));
        // Quality mode has no second pass to prepare.
        assert!(video(Family::H264, CPU, &VideoSettings { passlog: Some("pass"), ..settings(Rate::Quality(1)) }).unwrap().first_pass.is_none());
    }

    #[test]
    fn mastering_profiles_pick_the_right_flavour() {
        let hq = video(Family::ProRes, CPU, &VideoSettings { profile: Some("hq"), ..settings(Rate::Quality(1)) }).unwrap();
        assert!(hq.args.join(" ").contains("-profile:v 3") && hq.pix_fmt == "yuv422p10le");
        let hqx = video(Family::DnxHr, CPU, &VideoSettings { profile: Some("hqx"), ..settings(Rate::Quality(1)) }).unwrap();
        assert!(hqx.args.join(" ").contains("dnxhr_hqx") && hqx.pix_fmt == "yuv422p10le");
        assert!(video(Family::ProRes, CPU, &VideoSettings { profile: Some("raw"), ..settings(Rate::Quality(1)) }).is_err());
    }

    #[test]
    fn loudness_is_read_from_ffmpeg_output_and_applied_linearly() {
        let stderr = "[Parsed_loudnorm_0 @ 0x1] \n{\n\t\"input_i\" : \"-23.54\",\n\t\"input_tp\" : \"-7.12\",\n\t\"input_lra\" : \"5.10\",\n\t\"input_thresh\" : \"-33.80\",\n\t\"output_i\" : \"-14.02\",\n\t\"target_offset\" : \"0.02\"\n}\n";
        let measured = parse_loudness(stderr).expect("parsed");
        assert!((measured.input_i + 23.54).abs() < 1e-9 && (measured.target_offset - 0.02).abs() < 1e-9);
        let filter = loudnorm(-14.0, Some(measured));
        assert!(filter.contains("I=-14") && filter.contains("measured_I=-23.54") && filter.contains("linear=true"), "{filter}");
        let silent = parse_loudness(&stderr.replace("-23.54", "-inf").replace("-7.12", "-inf")).expect("silence parses");
        assert_eq!(loudnorm(-14.0, Some(silent)), "anull");
    }
}
