//! Text graphics as an ASS script that libass burns into the export.
//!
//! Sizes and positions mirror the preview's CSS (see `src/editor/overlay.css`): every size is
//! a fraction of the frame's short side, so a title reads the same in 16:9 and 9:16.

use crate::project::{Graphic, Preset};

pub const FONT: &str = "Segoe UI";
const FADE_MS: u32 = 160;

/// Size, margin and look per preset, as fractions of the short side / frame.
struct Style {
    size: f64,
    outline: f64,
    shadow: f64,
    /// ASS numpad alignment: 5 centre, 2 bottom-centre, 1 bottom-left.
    align: u8,
    margin_v: f64,
    bold: bool,
    boxed: bool,
}

const fn style(preset: Preset) -> Style {
    match preset {
        Preset::Title => Style { size: 0.105, outline: 0.004, shadow: 0.003, align: 5, margin_v: 0.0, bold: true, boxed: false },
        Preset::Kinetic => Style { size: 0.12, outline: 0.005, shadow: 0.0, align: 5, margin_v: 0.0, bold: true, boxed: false },
        Preset::LowerThird => Style { size: 0.052, outline: 0.012, shadow: 0.0, align: 1, margin_v: 0.12, bold: true, boxed: true },
        Preset::Caption => Style { size: 0.055, outline: 0.004, shadow: 0.0, align: 2, margin_v: 0.09, bold: true, boxed: false },
    }
}

const fn style_name(preset: Preset) -> &'static str {
    match preset {
        Preset::Title => "Title",
        Preset::Kinetic => "Kinetic",
        Preset::LowerThird => "LowerThird",
        Preset::Caption => "Caption",
    }
}

/// `#RRGGBB` → ASS `&HAABBGGRR` with the given alpha (00 opaque, FF clear).
fn ass_color(hex: &str, alpha: u8) -> String {
    let channel = |range: std::ops::Range<usize>| hex.get(range).unwrap_or("FF").to_ascii_uppercase();
    format!("&H{alpha:02X}{}{}{}", channel(5..7), channel(3..5), channel(1..3))
}

/// Braces start override blocks and backslashes start tags; neither may come from user text.
fn escape(text: &str) -> String {
    text.replace('\\', "\u{29F5}")
        .replace('{', "(")
        .replace('}', ")")
        .replace("\r\n", "\\N")
        .replace('\n', "\\N")
        .trim()
        .to_owned()
}

fn timestamp(seconds: f64) -> String {
    let centis = (seconds.clamp(0.0, 35_999.99) * 100.0).round() as u64;
    format!(
        "{}:{:02}:{:02}.{:02}",
        centis / 360_000,
        centis / 6_000 % 60,
        centis / 100 % 60,
        centis % 100
    )
}

fn dialogue(layer: u8, start: f64, end: f64, style: &str, text: &str) -> String {
    format!(
        "Dialogue: {layer},{},{},{style},,0,0,0,,{text}",
        timestamp(start),
        timestamp(end)
    )
}

fn events(graphic: &Graphic, width: u32, height: u32) -> Vec<String> {
    let short = f64::from(width.min(height));
    let start = graphic.start;
    let end = start + graphic.duration.max(0.2);
    let name = style_name(graphic.preset);
    let color = format!("\\c{}", ass_color(&graphic.color, 0));
    let fade = format!("\\fad({FADE_MS},{FADE_MS})");
    let text = escape(&graphic.text);
    let subtitle = escape(&graphic.subtitle);
    let sub_size = (short * 0.042).round();
    let with_subtitle = |body: String| {
        if subtitle.is_empty() {
            body
        } else {
            format!("{body}\\N{{\\fs{sub_size}\\c&H00FFFFFF&\\b0}}{subtitle}")
        }
    };
    match graphic.preset {
        Preset::Title => {
            let pop = "\\fscx70\\fscy70\\t(0,240,\\fscx100\\fscy100)";
            vec![dialogue(0, start, end, name, &with_subtitle(format!("{{{fade}{pop}{color}}}{text}")))]
        }
        Preset::Caption => {
            vec![dialogue(0, start, end, name, &with_subtitle(format!("{{{fade}}}{text}")))]
        }
        Preset::LowerThird => {
            // As the preview draws it (`.ov-lower`, `.ov-lower-third`): one panel whose bottom-left
            // corner sits 6% in and 12% up, padded 0.022 of the short side across and 0.012 down,
            // with the text inside it. BorderStyle 4 boxes the whole event once (BorderStyle 3 boxed
            // each line, and where the boxes overlapped the tint doubled); its box is the back
            // colour, and `\xbord` / `\ybord` are the padding.
            let (pad_x, pad_y) = ((short * 0.022).round(), (short * 0.012).round());
            let x = (f64::from(width) * 0.06).round() + pad_x;
            let y = (f64::from(height) * (1.0 - style(Preset::LowerThird).margin_v)).round() - pad_y;
            let from = x - f64::from(width) * 0.08;
            let slide = format!("\\move({from},{y},{x},{y},0,320)");
            // The panel is the accent at 88% (the preview's `color-mix(… 88%, transparent)`). An
            // override colour tag carries no alpha — libass drops it, which made the box opaque and
            // hid white text on a light accent — so the alpha goes in its own `\4a`. The border
            // widths also stroke the glyphs, so that stroke is made clear (`\3a&HFF&`).
            let panel = format!("\\4c{}&\\4a&H1F&\\3a&HFF&\\xbord{pad_x}\\ybord{pad_y}\\shad0", ass_color(&graphic.color, 0));
            vec![dialogue(0, start, end, name, &with_subtitle(format!("{{{fade}{slide}{panel}}}{text}")))]
        }
        Preset::Kinetic => {
            // Words land one after another on a stable line: each event shows the whole line
            // with the words still to come made transparent, and pops the newest word.
            let words: Vec<&str> = text.split_whitespace().collect();
            if words.is_empty() {
                return Vec::new();
            }
            let step = (graphic.duration.max(0.2) * 0.6) / words.len() as f64;
            words
                .iter()
                .enumerate()
                .map(|(index, _)| {
                    let word_start = start + step * index as f64;
                    let word_end = if index + 1 == words.len() { end } else { start + step * (index + 1) as f64 };
                    let line = words
                        .iter()
                        .enumerate()
                        .map(|(position, word)| match position.cmp(&index) {
                            std::cmp::Ordering::Less => format!("{{\\alpha&H00&{color}}}{word}"),
                            std::cmp::Ordering::Equal => format!(
                                "{{\\alpha&H00&{color}\\fscx55\\fscy55\\t(0,180,\\fscx100\\fscy100)}}{word}{{\\fscx100\\fscy100}}"
                            ),
                            std::cmp::Ordering::Greater => format!("{{\\alpha&HFF&}}{word}"),
                        })
                        .collect::<Vec<_>>()
                        .join(" ");
                    let fade_out = if index + 1 == words.len() { format!("{{\\fad(0,{FADE_MS})}}") } else { String::new() };
                    dialogue(0, word_start, word_end, name, &with_subtitle(format!("{fade_out}{line}")))
                })
                .collect()
        }
    }
}

#[must_use]
/// One ASS script for a set of text clips (timing already on the output timeline).
pub fn build_ass(graphics: &[Graphic], width: u32, height: u32) -> String {
    let short = f64::from(width.min(height));
    let mut script = format!(
        "[Script Info]\nScriptType: v4.00+\nPlayResX: {width}\nPlayResY: {height}\nWrapStyle: 0\nScaledBorderAndShadow: yes\nYCbCr Matrix: TV.709\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
    );
    let margin_h = (f64::from(width) * 0.06).round();
    for preset in [Preset::Title, Preset::Kinetic, Preset::LowerThird, Preset::Caption] {
        let look = style(preset);
        script.push_str(&format!(
            "Style: {},{FONT},{},&H00FFFFFF,&H00FFFFFF,&H00101014,&H96000000,{},0,0,0,100,100,0,0,{},{},{},{},{margin_h},{margin_h},{},1\n",
            style_name(preset),
            (short * look.size).round(),
            if look.bold { -1 } else { 0 },
            if look.boxed { 4 } else { 1 },
            (short * look.outline).round().max(1.0),
            (short * look.shadow).round(),
            look.align,
            (f64::from(height) * look.margin_v).round(),
        ));
    }
    script.push_str(&crate::caption_styles::style_lines(height));
    script.push_str("\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n");
    for graphic in graphics {
        let styled = (graphic.preset == Preset::Caption)
            .then(|| graphic.style.as_deref().and_then(crate::caption_styles::find))
            .flatten();
        let lines = match styled {
            Some(style) => crate::caption_styles::events(graphic, style, width, height),
            None => events(graphic, width, height),
        };
        for line in lines {
            script.push_str(&line);
            script.push('\n');
        }
    }
    script
}

#[cfg(test)]
mod tests {
    use super::{ass_color, build_ass, escape, timestamp};
    use crate::project::{Graphic, Preset};

    fn graphic(preset: Preset, text: &str) -> Graphic {
        Graphic {
            id: "g".to_owned(),
            text: text.to_owned(),
            subtitle: String::new(),
            start: 1.0,
            duration: 2.0,
            preset,
            color: "#FFC53D".to_owned(),
            style: None,
        }
    }

    #[test]
    fn colors_timestamps_and_escaping() {
        assert_eq!(ass_color("#FFC53D", 0), "&H003DC5FF");
        assert_eq!(timestamp(3725.5), "1:02:05.50");
        assert_eq!(escape("a{\\b1}b\nc"), "a(⧵b1)b\\Nc");
    }

    #[test]
    fn kinetic_text_becomes_one_event_per_word() {
        let script = build_ass(&[graphic(Preset::Kinetic, "one two three")], 1080, 1920);
        assert_eq!(script.matches("Dialogue:").count(), 3);
        assert!(script.contains("PlayResX: 1080"));
        assert!(script.contains("Style: Kinetic,Segoe UI,130,"));
    }

    #[test]
    fn every_preset_renders_its_text() {
        for preset in [Preset::Title, Preset::LowerThird, Preset::Caption] {
            let script = build_ass(&[graphic(preset, "Hello Bhippi")], 1920, 1080);
            assert!(script.contains("Hello Bhippi"), "{preset:?}");
        }
    }

    #[test]
    fn a_lower_third_panel_is_see_through_like_the_preview() {
        // libass ignores alpha packed into an override colour, so the panel's 88% lives in \4a.
        let script = build_ass(&[graphic(Preset::LowerThird, "Jane Doe")], 1920, 1080);
        assert!(script.contains("\\4c&H003DC5FF&\\4a&H1F&\\3a&HFF&\\xbord24\\ybord13"), "{script}");
        assert!(script.contains("Style: LowerThird,Segoe UI,56,") && script.contains(",0,0,4,"), "one box around the whole event: {script}");
    }
}
