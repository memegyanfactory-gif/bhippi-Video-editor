//! Caption styles imported from WatchFIWN (see scripts/import-fiwn-caption-styles.mjs) and their
//! libass rendering. The same JSON drives the preview in `src/editor/StyledCaption.tsx`; every
//! size here mirrors a CSS rule there so the export matches what the editor shows.
//!
//! Captions carry no word timestamps, so word-by-word highlighting spreads the words evenly across
//! the caption's duration — in the preview and in the export alike.

use crate::project::Graphic;
use serde::Deserialize;
use std::fmt::Write as _;
use std::sync::OnceLock;

const CATALOG: &str = include_str!("../../src/lib/caption-styles.json");

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Anim {
    pub preset: String,
    pub duration: f64,
    pub stagger: f64,
    pub unit: String,
    pub intensity: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionStyle {
    pub id: String,
    pub label: String,
    pub category: String,
    pub font: String,
    pub size: f64,
    pub weight: u32,
    pub italic: bool,
    pub uppercase: bool,
    pub color: String,
    pub color2: Option<String>,
    pub gradient: bool,
    pub word_alt: bool,
    pub background: Option<String>,
    pub outline: Option<String>,
    pub outline_width: f64,
    pub glow: Option<String>,
    pub glow_size: f64,
    pub shadow: bool,
    pub highlight: Option<String>,
    pub progressive: bool,
    pub pop: bool,
    pub highlight_box: Option<String>,
    pub highlight_text: Option<String>,
    pub highlight_font: Option<String>,
    pub highlight_italic: bool,
    pub highlight_scale: f64,
    pub max_width: f64,
    pub pos_y: f64,
    pub anim: Anim,
}

#[derive(Deserialize)]
struct Catalog {
    styles: Vec<CaptionStyle>,
}

pub fn all() -> &'static [CaptionStyle] {
    static STYLES: OnceLock<Vec<CaptionStyle>> = OnceLock::new();
    STYLES.get_or_init(|| match serde_json::from_str::<Catalog>(CATALOG) {
        Ok(catalog) => catalog.styles,
        Err(error) => {
            tracing::error!(%error, "caption style catalogue is unreadable");
            Vec::new()
        }
    })
}

pub fn find(id: &str) -> Option<&'static CaptionStyle> {
    all().iter().find(|style| style.id == id)
}

/// Matches a style by id or label, case-insensitively — how a person or a model names one.
pub fn lookup(name: &str) -> Option<&'static CaptionStyle> {
    let wanted = name.trim().to_ascii_lowercase();
    all().iter().find(|style| style.id.to_ascii_lowercase() == wanted || style.label.to_ascii_lowercase() == wanted)
}

// ───────────────────────────── colour helpers ─────────────────────────────

/// `#RRGGBBAA` → (`&HBBGGRR&`, ASS alpha byte where 0 is opaque).
fn split_color(hex: &str) -> (String, u8) {
    let channel = |range: std::ops::Range<usize>| u8::from_str_radix(hex.get(range).unwrap_or("FF"), 16).unwrap_or(255);
    let (r, g, b) = (channel(1..3), channel(3..5), channel(5..7));
    let alpha = if hex.len() >= 9 { channel(7..9) } else { 255 };
    (format!("&H{b:02X}{g:02X}{r:02X}&"), 255 - alpha)
}

fn mix(a: &str, b: &str) -> String {
    let channel = |hex: &str, range: std::ops::Range<usize>| u32::from(u8::from_str_radix(hex.get(range).unwrap_or("FF"), 16).unwrap_or(255));
    let blend = |range: std::ops::Range<usize>| (channel(a, range.clone()) + channel(b, range)) / 2;
    format!("#{:02X}{:02X}{:02X}{:02X}", blend(1..3), blend(3..5), blend(5..7), channel(a, 7..9))
}

impl CaptionStyle {
    /// The fill every word starts from. ASS has no gradient fill, so a gradient reads as the blend
    /// of its two stops — the preview draws it the same way.
    #[must_use]
    pub fn base_fill(&self) -> String {
        match (&self.color2, self.gradient) {
            (Some(second), true) => mix(&self.color, second),
            _ => self.color.clone(),
        }
    }

    /// Faces whose name already is the heavy cut must not be emboldened again.
    fn bold_flag(&self) -> u8 {
        let heavy_family = matches!(self.font.as_str(), "Segoe UI Black" | "Arial Black" | "Impact");
        u8::from(self.weight >= 600 && !heavy_family)
    }
}

// ───────────────────────────── events ─────────────────────────────

fn timestamp(seconds: f64) -> String {
    let centis = (seconds.clamp(0.0, 35_999.99) * 100.0).round() as u64;
    format!("{}:{:02}:{:02}.{:02}", centis / 360_000, centis / 6_000 % 60, centis / 100 % 60, centis % 100)
}

fn escape(text: &str) -> String {
    text.replace('\\', "\u{29F5}").replace('{', "(").replace('}', ")").replace(['\r', '\n'], " ")
}

/// Tags for one animated unit at `rel` seconds after its event starts (negative = already done).
fn entrance(style: &CaptionStyle, fs: f64, rel_start: f64, final_tags: &str, alphas: &str) -> String {
    let anim = &style.anim;
    let duration = anim.duration.max(0.05);
    if anim.preset == "none" || rel_start + duration <= 0.0 {
        return format!("{final_tags}{alphas}");
    }
    let from = (rel_start.max(0.0) * 1000.0).round();
    let to = ((rel_start + duration) * 1000.0).round().max(from + 1.0);
    let intensity = anim.intensity.clamp(0.3, 2.0);
    let scale = |amount: f64| (100.0 - amount * intensity).clamp(20.0, 99.0).round();
    let start = match anim.preset.as_str() {
        "pop" | "balloon" | "inflate" => format!("\\fscx{0}\\fscy{0}", scale(40.0)),
        "zoom-out" => format!("\\fscx{0}\\fscy{0}", (100.0 + 60.0 * intensity).round()),
        "rise" | "wave-in" | "mask-up" | "wipe-up" | "reveal" => format!("\\frx{}", (55.0 * intensity).round()),
        "drop" | "bounce" => format!("\\frx-{}", (55.0 * intensity).round()),
        "stretch" => format!("\\fscx{}", (100.0 + 45.0 * intensity).round()),
        "blur" => format!("\\blur{:.1}", fs * 0.12 * intensity),
        "skew" => format!("\\fax{:.2}", 0.35 * intensity),
        "spin" => format!("\\frz-{}", (25.0 * intensity).round()),
        "glitch" => format!("\\fsp{:.1}", fs * 0.2),
        "slide-r" => format!("\\fsp{:.1}", fs * 0.15),
        _ => String::new(), // fade, type
    };
    format!("{final_tags}{start}\\1a&HFF&\\3a&HFF&\\4a&HFF&\\t({from},{to},{final_tags}{alphas})")
}

/// All events for one styled caption. `layer_base` keeps glow, box and text stacked in order.
pub fn events(graphic: &Graphic, style: &CaptionStyle, width: u32, height: u32) -> Vec<String> {
    let (w, h) = (f64::from(width), f64::from(height));
    let fs = style.size / 100.0 * h;
    let text = if style.uppercase { graphic.text.to_uppercase() } else { graphic.text.clone() };
    let words: Vec<String> = escape(&text).split_whitespace().map(str::to_owned).collect();
    if words.is_empty() {
        return Vec::new();
    }
    let start = graphic.start;
    let end = start + graphic.duration.max(0.2);
    let karaoke = style.highlight.is_some() || style.highlight_box.is_some();
    // Which word is "being said" at each moment: the caption's duration shared evenly.
    let step = (end - start) / words.len() as f64;
    let margin = ((1.0 - style.max_width.clamp(0.3, 1.0)) / 2.0 * w).round();
    let position = format!("\\an5\\pos({:.0},{:.0})\\q0", w / 2.0, h * style.pos_y / 100.0);
    let italic = u8::from(style.italic);
    let face = format!("\\fn{}\\fs{:.0}\\b{}\\i{italic}", style.font, fs, style.bold_flag());

    let base_fill = style.base_fill();
    let (outline_color, outline_alpha) = style.outline.as_deref().map_or(("&H000000&".to_owned(), 255), split_color);
    let bord = if style.outline.is_some() { (fs * 0.05 * style.outline_width).max(1.0) } else { 0.0 };
    let shadow = if style.shadow { fs * 0.06 } else { 0.0 };

    let mut lines = Vec::new();
    // A transcribed caption knows when each word is said; one edited since (word count changed)
    // falls back to the even share.
    let spoken = graphic.word_starts.as_ref().filter(|starts| starts.len() == words.len());
    let intervals: Vec<(f64, f64, Option<usize>)> = if let (true, Some(starts)) = (karaoke, spoken) {
        let at = |index: usize| if index == 0 { start } else { starts[index].clamp(start, end) };
        (0..words.len())
            .map(|index| (at(index), if index + 1 == words.len() { end } else { at(index + 1).max(at(index)) }, Some(index)))
            .collect()
    } else if karaoke {
        (0..words.len())
            .map(|index| (start + step * index as f64, if index + 1 == words.len() { end } else { start + step * (index + 1) as f64 }, Some(index)))
            .collect()
    } else {
        vec![(start, end, None)]
    };
    let last = intervals.len() - 1;

    for (event_index, (from, to, active)) in intervals.iter().enumerate() {
        let fade = if event_index == last { "\\fad(0,140)".to_owned() } else { String::new() };
        let offset = from - start;

        // Box behind the whole caption (FIWN `bgOn` / caption cards). BorderStyle 3 draws one box
        // per line, padded by \bord, in the outline colour.
        if let Some(background) = &style.background {
            let (color, alpha) = split_color(background);
            let appear = if event_index == 0 { "\\fad(120,0)" } else { "" };
            lines.push(format!(
                "Dialogue: 0,{},{},StyledBox,,{margin:.0},{margin:.0},0,,{{{position}{face}{appear}{fade}\\bord{:.1}\\3c{color}\\3a&H{alpha:02X}&\\1a&HFF&\\shad0}}{}",
                timestamp(*from),
                timestamp(*to),
                fs * 0.32,
                words.join(" ")
            ));
        }

        let mut glow_line = String::new();
        let mut text_line = String::new();
        let mut unit_index = 0usize;
        for (index, word) in words.iter().enumerate() {
            let is_active = *active == Some(index);
            let lit = match active {
                Some(current) if style.progressive => index <= *current,
                Some(current) => index == *current,
                None => false,
            };
            let mut fill = if style.word_alt && index % 2 == 1 { style.color2.clone().unwrap_or_else(|| base_fill.clone()) } else { base_fill.clone() };
            if lit {
                if let Some(highlight) = &style.highlight {
                    fill = highlight.clone();
                }
            }
            let mut word_bord = bord;
            let mut word_outline = (outline_color.clone(), outline_alpha);
            if is_active {
                if let (Some(box_color), Some(text_color)) = (&style.highlight_box, &style.highlight_text) {
                    fill = text_color.clone();
                    word_outline = split_color(box_color);
                    word_bord = fs * 0.16;
                }
            }
            let (fill_color, fill_alpha) = split_color(&fill);
            let mut word_scale = 100.0;
            if is_active {
                word_scale *= style.highlight_scale;
                if style.pop {
                    word_scale *= 1.12;
                }
            }
            let font_swap = match (&style.highlight_font, is_active) {
                (Some(font), true) => format!("\\fn{font}\\i1"),
                _ if is_active && style.highlight_italic => "\\i1".to_owned(),
                _ => format!("\\fn{}\\i{italic}", style.font),
            };
            let final_tags = format!(
                "{font_swap}\\1c{fill_color}\\3c{}\\bord{word_bord:.1}\\shad{shadow:.1}\\4c&H000000&\\fscx{word_scale:.0}\\fscy{word_scale:.0}\\frx0\\frz0\\fax0\\blur0\\fsp0",
                word_outline.0
            );
            let alphas = format!("\\1a&H{fill_alpha:02X}&\\3a&H{:02X}&\\4a&H90&", word_outline.1);

            let units: Vec<String> = if style.anim.unit == "letter" { word.chars().map(String::from).collect() } else { vec![word.clone()] };
            if index > 0 {
                text_line.push(' ');
                glow_line.push(' ');
            }
            for unit in units {
                let rel = unit_index as f64 * style.anim.stagger - offset;
                unit_index += 1;
                let _ = write!(text_line, "{{{}}}{unit}", entrance(style, fs, rel, &final_tags, &alphas));
                if let Some(glow) = &style.glow {
                    let (glow_color, glow_alpha) = split_color(glow);
                    let size = style.glow_size / 1080.0 * h;
                    // The glow layer is only a blurred outline: its fill and shadow stay invisible
                    // for the whole animation, and only the outline's alpha fades in.
                    let glow_final = format!("{font_swap}\\fscx{word_scale:.0}\\fscy{word_scale:.0}\\bord{:.1}\\blur{:.1}\\3c{glow_color}\\shad0\\frx0\\frz0\\fax0\\fsp0\\1a&HFF&\\4a&HFF&", size * 0.45, size * 0.6);
                    let glow_alphas = format!("\\3a&H{:02X}&", glow_alpha.max(0x30));
                    let _ = write!(glow_line, "{{{}}}{unit}", entrance(style, fs, rel, &glow_final, &glow_alphas));
                }
            }
        }
        if style.glow.is_some() {
            lines.push(format!("Dialogue: 1,{},{},Styled,,{margin:.0},{margin:.0},0,,{{{position}{face}{fade}}}{glow_line}", timestamp(*from), timestamp(*to)));
        }
        lines.push(format!("Dialogue: 2,{},{},Styled,,{margin:.0},{margin:.0},0,,{{{position}{face}{fade}}}{text_line}", timestamp(*from), timestamp(*to)));
    }
    lines
}

/// The two style lines styled captions reference; every look is applied with inline overrides.
#[must_use]
pub fn style_lines(height: u32) -> String {
    let size = (f64::from(height) * 0.05).round();
    format!(
        "Style: Styled,Segoe UI,{size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H90000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1\n\
         Style: StyledBox,Segoe UI,{size},&HFF000000,&HFF000000,&H00000000,&HFF000000,0,0,0,0,100,100,0,0,3,0,0,5,0,0,0,1\n"
    )
}

#[cfg(test)]
mod tests {
    use super::{all, events, find, lookup, split_color};
    use crate::project::{Graphic, Preset};

    fn caption(text: &str, style: &str) -> Graphic {
        Graphic { id: "c".into(), text: text.into(), subtitle: String::new(), start: 1.0, duration: 3.0, preset: Preset::Caption, color: "#FFFFFF".into(), style: Some(style.into()), word_starts: None }
    }

    #[test]
    fn the_imported_catalogue_loads_with_unique_ids() {
        let styles = all();
        assert!(styles.len() >= 60, "{} styles", styles.len());
        let mut ids: Vec<_> = styles.iter().map(|style| style.id.as_str()).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), styles.len());
        assert!(find("hormozi").is_some());
        assert_eq!(lookup("Box Word").map(|style| style.id.as_str()), Some("boxword"));
    }

    #[test]
    fn colours_carry_their_alpha_into_ass() {
        assert_eq!(split_color("#FFC53DFF"), ("&H3DC5FF&".to_owned(), 0));
        assert_eq!(split_color("#00000080").1, 0x7F);
    }

    #[test]
    fn a_karaoke_style_emits_one_event_per_spoken_word_with_the_highlight() {
        let style = find("hormozi").expect("hormozi");
        let lines = events(&caption("make it pop", "hormozi"), style, 1080, 1920);
        assert_eq!(lines.len(), 3, "{lines:#?}");
        assert!(lines[0].contains("MAKE"), "uppercase applies");
        assert!(lines[1].contains("\\1c&H00E6FF&"), "the active word is yellow: {}", lines[1]);
        assert!(lines[2].contains("\\fad(0,140)"), "only the last event fades out");
    }

    #[test]
    fn karaoke_follows_real_word_timings_and_falls_back_when_the_words_changed() {
        let style = find("hormozi").expect("hormozi");
        // "make" at 1.0, a long pause, "it" at 3.2, "pop" at 3.5 (caption 1.0–4.0).
        let timed = Graphic { word_starts: Some(vec![1.0, 3.2, 3.5]), ..caption("make it pop", "hormozi") };
        let lines = events(&timed, style, 1080, 1920);
        assert_eq!(lines.len(), 3, "{lines:#?}");
        assert!(lines[0].contains(",0:00:01.00,0:00:03.20,"), "{}", lines[0]);
        assert!(lines[1].contains(",0:00:03.20,0:00:03.50,"), "{}", lines[1]);
        // Edited to four words: the three timings no longer fit, so the time is shared evenly.
        let edited = Graphic { word_starts: Some(vec![1.0, 3.2, 3.5]), ..caption("make it pop now", "hormozi") };
        let lines = events(&edited, style, 1080, 1920);
        assert!(lines[1].contains(",0:00:01.75,"), "{}", lines[1]);
    }

    #[test]
    fn boxes_and_glows_render_on_their_own_layers() {
        let boxed = all().iter().find(|style| style.background.is_some()).expect("a boxed style");
        let lines = events(&caption("hello world", &boxed.id), boxed, 1920, 1080);
        assert!(lines.iter().any(|line| line.contains(",StyledBox,")), "{lines:#?}");
        let glowing = all().iter().find(|style| style.glow.is_some() && style.highlight.is_none()).expect("a glow style");
        let lines = events(&caption("hello world", &glowing.id), glowing, 1920, 1080);
        assert!(lines.iter().any(|line| line.starts_with("Dialogue: 1,") && line.contains("\\blur")), "{lines:#?}");
    }

    #[test]
    fn every_style_renders_without_panicking() {
        for style in all() {
            let lines = events(&caption("Bhippi makes captions pop", &style.id), style, 1080, 1920);
            assert!(!lines.is_empty(), "{} rendered nothing", style.id);
        }
    }
}
