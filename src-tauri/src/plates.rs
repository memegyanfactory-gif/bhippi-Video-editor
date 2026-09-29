//! Designed background plates, rendered by FFmpeg from filter graphs: what the strong models used
//! to script by hand so motion graphics sit on a living background instead of flat black. Each
//! plate loops its motion slowly and carries film grain, and it is named "… Background Plate" so
//! `fill_background` finds it on its own.

use serde::Deserialize;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PlateStyle {
    /// A dark stage with a breathing glow of the accent colour from its centre, and grain.
    Glow,
    /// Two or three colours drifting across the frame, and grain.
    Gradient,
    /// Cream risograph paper, its fibres boiling on threes.
    Paper,
    /// A flat colour with grain and a soft vignette: the quietest plate.
    Grain,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlateSpec {
    pub style: PlateStyle,
    pub width: u32,
    pub height: u32,
    pub seconds: f64,
    #[serde(default = "default_fps")]
    pub fps: u32,
    /// `#rrggbb` colours: glow uses [background, glow]; gradient uses 2–3; paper and grain use the first.
    #[serde(default)]
    pub colors: Vec<String>,
}

const fn default_fps() -> u32 {
    30
}

/// `#rrggbb` (or `rrggbb`) as FFmpeg's `0xRRGGBB`; None when it is not a hex colour.
fn ff_color(text: &str) -> Option<String> {
    let hex = text.trim().trim_start_matches('#');
    (hex.len() == 6 && hex.chars().all(|c| c.is_ascii_hexdigit())).then(|| format!("0x{}", hex.to_ascii_uppercase()))
}

fn rgb(text: &str) -> Option<(u8, u8, u8)> {
    let hex = text.trim().trim_start_matches('#');
    if hex.len() != 6 {
        return None;
    }
    let part = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).ok();
    Some((part(0)?, part(2)?, part(4)?))
}

/// The FFmpeg arguments that render `spec` to `output` (H.264 MP4).
pub fn args(spec: &PlateSpec, output: &str) -> Result<Vec<String>, String> {
    let width = spec.width.clamp(64, 7680) & !1;
    let height = spec.height.clamp(64, 4320) & !1;
    let seconds = spec.seconds.clamp(1.0, 120.0);
    let fps = spec.fps.clamp(12, 60);
    let colors: Vec<&str> = spec.colors.iter().map(String::as_str).filter(|c| ff_color(c).is_some()).collect();
    let pick = |index: usize, fallback: &str| colors.get(index).copied().unwrap_or(fallback).to_owned();
    let size = format!("{width}x{height}");
    let d = format!("{seconds:.3}");
    let mut inputs: Vec<String> = Vec::new();
    let graph = match spec.style {
        PlateStyle::Glow => {
            // Claude's stage plate: the glow colour darkened to a base, vignetted from a point a
            // little below centre with a breathing angle, a floor so black never crushes, grain.
            let glow = pick(1, &pick(0, "#7a1f0e"));
            let (r, g, b) = rgb(&glow).unwrap_or((122, 31, 14));
            let base = format!("0x{:02X}{:02X}{:02X}", r / 2, g / 2, b / 2);
            let floor = rgb(&pick(0, "#0b0605")).unwrap_or((11, 6, 5));
            inputs.extend(["-f", "lavfi", "-i"].map(str::to_owned));
            inputs.push(format!("color=c={base}:s={size}:r={fps}:d={d}"));
            format!(
                "[0:v]format=gbrp,vignette=angle='PI/2-0.08-0.06*sin(2*PI*t/7.5)':x0=w/2:y0=h*0.56:eval=frame,lutrgb=r='max(val,{})':g='max(val,{})':b='max(val,{})',format=yuv420p,noise=c0s=6:c0f=t+u[out]",
                floor.0, floor.1, floor.2
            )
        }
        PlateStyle::Gradient => {
            let c0 = ff_color(&pick(0, "#1b1f3b")).unwrap_or_default();
            let c1 = ff_color(&pick(1, "#6b2fa0")).unwrap_or_default();
            let c2 = colors.get(2).and_then(|c| ff_color(c));
            inputs.extend(["-f", "lavfi", "-i"].map(str::to_owned));
            inputs.push(format!(
                "gradients=s={size}:r={fps}:d={d}:c0={c0}:c1={c1}{}:n={}:speed=0.004:type=linear:seed=7",
                c2.as_ref().map(|c| format!(":c2={c}")).unwrap_or_default(),
                if c2.is_some() { 3 } else { 2 }
            ));
            "[0:v]format=yuv420p,vignette=PI/5,noise=c0s=5:c0f=t+u[out]".to_owned()
        }
        PlateStyle::Paper => {
            // Claude's riso paper boil: coarse and fine noise overlaid on the stock at 10 fps
            // (boiling on threes), grain on top, then up to the frame rate.
            // Paper is light: the lightest colour given when it is light enough, else cream stock.
            let light = colors.iter().filter_map(|c| rgb(c).map(|(r, g, b)| (c, 0.2126 * f64::from(r) + 0.7152 * f64::from(g) + 0.0722 * f64::from(b)))).filter(|(_, luma)| *luma > 170.0).max_by(|a, b| a.1.total_cmp(&b.1));
            let stock = ff_color(light.map_or("#EEE3CC", |(c, _)| c)).unwrap_or_default();
            for source in [
                format!("color=c={stock}:s={size}:r=10:d={d}"),
                format!("color=c=0x808080:s=64x36:r=10:d={d}"),
                format!("color=c=0x808080:s=320x180:r=10:d={d}"),
                format!("color=c=0x808080:s={size}:r=10:d={d}"),
            ] {
                inputs.extend(["-f", "lavfi", "-i"].map(str::to_owned));
                inputs.push(source);
            }
            format!(
                "[1:v]noise=c0s=40:c0f=t+u,format=gray,scale={width}:{height}:flags=bicubic,format=gbrp[coarse];\
                 [2:v]noise=c0s=34:c0f=t+u,format=gray,scale={width}:{height}:flags=bicubic,format=gbrp[fine];\
                 [3:v]noise=c0s=30:c0f=t+u,format=gray,format=gbrp[grain];[0:v]format=gbrp[stock];\
                 [stock][coarse]blend=all_mode=overlay:all_opacity=0.4[p1];[p1][fine]blend=all_mode=overlay:all_opacity=0.45[p2];\
                 [p2][grain]blend=all_mode=overlay:all_opacity=0.65,fps={fps},format=yuv420p[out]"
            )
        }
        PlateStyle::Grain => {
            let colour = ff_color(&pick(0, "#121212")).unwrap_or_default();
            inputs.extend(["-f", "lavfi", "-i"].map(str::to_owned));
            inputs.push(format!("color=c={colour}:s={size}:r={fps}:d={d}"));
            "[0:v]format=yuv420p,vignette=PI/4.5,noise=c0s=7:c0f=t+u[out]".to_owned()
        }
    };
    let mut args: Vec<String> = ["-hide_banner", "-nostdin", "-loglevel", "error", "-y"].map(str::to_owned).to_vec();
    args.extend(inputs);
    args.extend(
        ["-filter_complex", &graph, "-map", "[out]", "-t", &d, "-r", &fps.to_string(), "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-tune", "grain", "-pix_fmt", "yuv420p", "-movflags", "+faststart", output]
            .map(str::to_owned),
    );
    Ok(args)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Renders every style with the FFmpeg on PATH into `BHIPPI_PLATE_OUT`:
    /// `BHIPPI_PLATE_OUT=dir cargo test --lib plates::tests::render_plates -- --ignored`.
    #[test]
    #[ignore = "needs FFmpeg; writes files"]
    fn render_plates() {
        let dir = std::path::PathBuf::from(std::env::var("BHIPPI_PLATE_OUT").expect("BHIPPI_PLATE_OUT"));
        for style in [PlateStyle::Glow, PlateStyle::Gradient, PlateStyle::Paper, PlateStyle::Grain] {
            let out = dir.join(format!("{style:?}.mp4"));
            let spec = PlateSpec { style, width: 1920, height: 1080, seconds: 3.0, fps: 30, colors: vec!["#0b0605".into(), "#ff5a1f".into(), "#2b1055".into()] };
            let args = args(&spec, &out.display().to_string()).unwrap();
            let status = std::process::Command::new("ffmpeg").args(&args).output().unwrap();
            assert!(status.status.success(), "{style:?}: {}", String::from_utf8_lossy(&status.stderr));
        }
    }

    #[test]
    fn builds_a_graph_for_every_style_and_ignores_bad_colours() {
        for style in [PlateStyle::Glow, PlateStyle::Gradient, PlateStyle::Paper, PlateStyle::Grain] {
            let spec = PlateSpec { style, width: 1081, height: 1920, seconds: 6.0, fps: 30, colors: vec!["#ff2d1a".into(), "not a colour".into(), "0b0605".into()] };
            let args = args(&spec, "out.mp4").unwrap();
            let graph = &args[args.iter().position(|a| a == "-filter_complex").unwrap() + 1];
            assert!(graph.ends_with("[out]"), "{style:?}: {graph}");
            assert!(args.iter().any(|a| a.contains("1080x1920")), "even width: {args:?}");
            assert!(!args.iter().any(|a| a.contains("not a colour")));
            assert_eq!(args.last().unwrap(), "out.mp4");
        }
    }
}
