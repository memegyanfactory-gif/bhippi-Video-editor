//! Text clips as one ASS script per track, with the clip's transform and fades folded into the
//! events `subtitles::build_ass` produces.
//!
//! Semantics the preview mirrors: a text clip's `transform` moves, scales and rotates the text
//! block around its preset's anchor (centre for titles and kinetic lines and styled captions,
//! bottom-centre for captions, the slide-in point for lower thirds) — it is not a picture that
//! gets fitted into the frame. Opacity and any transition on the clip multiply the alpha the
//! preset already animates. `vertical` stacks the characters one per line.

use super::num;
use crate::project::Graphic;

/// Where a text clip's block sits, relative to its preset.
#[derive(Clone, Copy, Debug)]
pub struct Placement {
    /// Offset in pixels of the rendered frame.
    pub dx: f64,
    pub dy: f64,
    /// 1.0 keeps the preset's size.
    pub scale: f64,
    /// Degrees, clockwise.
    pub rotation: f64,
    /// 0…1.
    pub opacity: f64,
    /// Seconds of fade at the clip's head and tail (from transitions), on top of the preset's.
    pub fade_in: f64,
    pub fade_out: f64,
    /// Characters stacked one per line.
    pub vertical: bool,
}

impl Default for Placement {
    fn default() -> Self {
        Self { dx: 0.0, dy: 0.0, scale: 1.0, rotation: 0.0, opacity: 1.0, fade_in: 0.0, fade_out: 0.0, vertical: false }
    }
}

impl Placement {
    fn is_identity(&self) -> bool {
        self.dx == 0.0 && self.dy == 0.0 && (self.scale - 1.0).abs() < 1e-9 && self.rotation == 0.0 && self.opacity >= 1.0 && self.fade_in == 0.0 && self.fade_out == 0.0
    }
}

/// One ASS script for placed text clips, timed on the comp's own timeline.
pub fn script(items: &[(Graphic, Placement)], width: u32, height: u32) -> String {
    // libass mangles colours to broadcast range when the script names a YCbCr matrix, which is
    // wrong for the RGB frames the export composites in.
    let mut out = crate::subtitles::build_ass(&[], width, height).replace("YCbCr Matrix: TV.709", "YCbCr Matrix: None");
    for (graphic, placement) in items {
        let mut graphic = graphic.clone();
        if placement.vertical {
            graphic.text = graphic.text.chars().filter(|c| *c != '\r' && *c != '\n').map(|c| c.to_string()).collect::<Vec<_>>().join("\n");
        }
        let script = crate::subtitles::build_ass(std::slice::from_ref(&graphic), width, height);
        for line in script.lines().filter(|line| line.starts_with("Dialogue:")) {
            out.push_str(&place(line, &graphic, *placement, width, height));
            out.push('\n');
        }
    }
    out
}

/// Rewrites one Dialogue line for the clip's placement.
fn place(line: &str, graphic: &Graphic, placement: Placement, width: u32, height: u32) -> String {
    let Some(rest) = line.strip_prefix("Dialogue:") else { return line.to_owned() };
    let fields: Vec<&str> = rest.splitn(10, ',').collect();
    if fields.len() < 10 || placement.is_identity() {
        return line.to_owned();
    }
    let (start, end) = (timestamp(fields[1]), timestamp(fields[2]));
    let mut text = fields[9].to_owned();

    if placement.dx != 0.0 || placement.dy != 0.0 {
        let moved = shift(&text, placement.dx, placement.dy);
        text = match moved {
            Some(moved) => moved,
            None => {
                let (ax, ay) = anchor(fields[3].trim(), width, height);
                insert(&text, &format!("\\pos({},{})", num(ax + placement.dx), num(ay + placement.dy)))
            }
        };
    }
    if (placement.scale - 1.0).abs() > 1e-9 {
        for tag in ["\\fscx", "\\fscy"] {
            text = map_numbers(&text, tag, |value| value * placement.scale);
        }
        text = insert(&text, &format!("\\fscx{0}\\fscy{0}", num(100.0 * placement.scale)));
    }
    if placement.rotation != 0.0 {
        // ASS turns counter-clockwise; the model (like CSS) turns clockwise.
        text = map_numbers(&text, "\\frz", |value| value - placement.rotation);
        text = insert(&text, &format!("\\frz{}", num(-placement.rotation)));
    }
    let (stripped, preset) = take_fade(&text);
    text = stripped;
    if let Some(fade) = fade(placement, preset, start - graphic.start, end - start, graphic.duration.max(0.2)) {
        text = insert(&text, &fade);
    }
    format!("Dialogue:{},{},{},{},{},{},{},{},{},{text}", fields[0], fields[1], fields[2], fields[3], fields[4], fields[5], fields[6], fields[7], fields[8])
}

/// Where a preset's text sits when the line carries no explicit position.
fn anchor(style: &str, width: u32, height: u32) -> (f64, f64) {
    let (w, h) = (f64::from(width), f64::from(height));
    // Mirrors `subtitles::style`: captions sit 9 % of the frame above the bottom edge.
    if style == "Caption" { (w / 2.0, h - (h * 0.09).round()) } else { (w / 2.0, h / 2.0) }
}

/// The alpha envelope: the preset's own fades combined with the clip's opacity and transitions.
fn fade(placement: Placement, preset: Option<(f64, f64)>, offset: f64, length: f64, clip: f64) -> Option<String> {
    let alpha = ((1.0 - placement.opacity.clamp(0.0, 1.0)) * 255.0).round();
    if alpha == 0.0 && preset.is_none() && placement.fade_in == 0.0 && placement.fade_out == 0.0 {
        return None;
    }
    let ms = |seconds: f64| (seconds * 1000.0).round();
    let (mut t1, mut t2) = (0.0, 0.0);
    let (mut t3, mut t4) = (ms(length), ms(length));
    if let Some((in_ms, out_ms)) = preset {
        t2 = in_ms;
        t3 = ms(length) - out_ms;
    }
    if placement.fade_in > 0.0 && ms(placement.fade_in - offset) > t2 {
        t1 = ms(-offset);
        t2 = ms(placement.fade_in - offset);
    }
    if placement.fade_out > 0.0 && ms(clip - placement.fade_out - offset) < t3 {
        t3 = ms(clip - placement.fade_out - offset);
        t4 = ms(clip - offset);
    }
    Some(format!("\\fade(255,{},255,{},{},{},{})", num(alpha), num(t1), num(t2), num(t3), num(t4)))
}

/// Removes a `\fad(in,out)` tag, returning its milliseconds.
fn take_fade(text: &str) -> (String, Option<(f64, f64)>) {
    let Some(at) = text.find("\\fad(") else { return (text.to_owned(), None) };
    let Some(close) = text[at..].find(')') else { return (text.to_owned(), None) };
    let inside = &text[at + 5..at + close];
    let mut parts = inside.split(',').map(|part| part.trim().parse::<f64>().unwrap_or(0.0));
    let times = (parts.next().unwrap_or(0.0), parts.next().unwrap_or(0.0));
    (format!("{}{}", &text[..at], &text[at + close + 1..]), Some(times))
}

/// Adds tags to the line's first override block.
fn insert(text: &str, tags: &str) -> String {
    if let Some(rest) = text.strip_prefix('{') { format!("{{{tags}{rest}") } else { format!("{{{tags}}}{text}") }
}

/// Shifts every `\pos`/`\move` in the line; `None` when it has neither.
fn shift(text: &str, dx: f64, dy: f64) -> Option<String> {
    let mut out = String::new();
    let mut rest = text;
    let mut found = false;
    while let Some(at) = rest.find("\\pos(").or_else(|| rest.find("\\move(")) {
        let tag = if rest[at..].starts_with("\\pos(") { "\\pos(" } else { "\\move(" };
        let Some(close) = rest[at..].find(')') else { break };
        let values: Vec<f64> = rest[at + tag.len()..at + close].split(',').map(|part| part.trim().parse::<f64>().unwrap_or(0.0)).collect();
        let moved: Vec<String> = values
            .iter()
            .enumerate()
            .map(|(index, value)| if index < 4 && index % 2 == 0 { num(value + dx) } else if index < 4 { num(value + dy) } else { num(*value) })
            .collect();
        out.push_str(&rest[..at]);
        out.push_str(&format!("{tag}{})", moved.join(",")));
        rest = &rest[at + close + 1..];
        found = true;
    }
    found.then(|| format!("{out}{rest}"))
}

/// Scales every `tag` value in the line (`\fscx70` → `\fscx140`).
fn map_numbers(text: &str, tag: &str, transform: impl Fn(f64) -> f64) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(at) = rest.find(tag) {
        out.push_str(&rest[..at]);
        let after = &rest[at + tag.len()..];
        let digits = after.find(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-' || c == '+')).unwrap_or(after.len());
        match after[..digits].parse::<f64>() {
            Ok(value) => {
                out.push_str(&format!("{tag}{}", num(transform(value))));
                rest = &after[digits..];
            }
            Err(_) => {
                out.push_str(tag);
                rest = after;
            }
        }
    }
    format!("{out}{rest}")
}

/// `0:00:01.25` → seconds.
fn timestamp(text: &str) -> f64 {
    let mut parts = text.trim().split(':').map(|part| part.parse::<f64>().unwrap_or(0.0));
    let hours = parts.next().unwrap_or(0.0);
    let minutes = parts.next().unwrap_or(0.0);
    let seconds = parts.next().unwrap_or(0.0);
    hours * 3600.0 + minutes * 60.0 + seconds
}

#[cfg(test)]
mod tests {
    use super::{script, Placement};
    use crate::project::{Graphic, Preset};

    fn graphic(preset: Preset, style: Option<&str>) -> Graphic {
        Graphic { id: "t".into(), text: "hello there".into(), subtitle: String::new(), start: 2.0, duration: 3.0, preset, color: "#FFFFFF".into(), style: style.map(str::to_owned) }
    }

    fn events(text: &str) -> Vec<String> {
        text.lines().filter(|line| line.starts_with("Dialogue:")).map(str::to_owned).collect()
    }

    #[test]
    fn an_untouched_clip_keeps_the_preset_line_and_drops_the_broadcast_matrix() {
        let out = script(&[(graphic(Preset::Title, None), Placement::default())], 1080, 1920);
        assert!(out.contains("YCbCr Matrix: None"));
        assert_eq!(events(&out).len(), 1);
        assert!(events(&out)[0].contains("\\fad(160,160)"), "{:?}", events(&out));
    }

    #[test]
    fn a_transform_positions_scales_rotates_and_dims_the_block() {
        let placement = Placement { dx: 100.0, dy: -50.0, scale: 2.0, rotation: 90.0, opacity: 0.5, ..Placement::default() };
        let out = script(&[(graphic(Preset::Title, None), placement)], 1000, 2000);
        let line = events(&out).remove(0);
        assert!(line.contains("\\pos(600,950)"), "{line}");
        assert!(line.contains("\\fscx200\\fscy200") && line.contains("\\fscx140\\fscy140"), "preset scaling is multiplied: {line}");
        assert!(line.contains("\\frz-90"), "{line}");
        assert!(line.contains("\\fade(255,128,255,0,160,2840,3000)"), "the preset fade keeps its shape at half alpha: {line}");
        assert!(!line.contains("\\fad("), "the old fade is gone: {line}");
    }

    #[test]
    fn a_transition_lengthens_the_fades_and_styled_captions_keep_their_own_position() {
        let placement = Placement { fade_in: 1.0, fade_out: 1.0, opacity: 1.0, dx: 10.0, ..Placement::default() };
        let out = script(&[(graphic(Preset::Caption, Some("hormozi")), placement)], 1080, 1920);
        let lines = events(&out);
        assert!(lines.len() >= 2, "one event per spoken word: {lines:#?}");
        assert!(lines[0].contains("\\pos(550,"), "the styled position is shifted: {}", lines[0]);
        assert!(lines[0].contains("\\fade(255,0,255,0,1000,"), "{}", lines[0]);
        let last = lines.last().expect("an event");
        assert!(last.contains(",255,-") || last.contains("\\fade(255,0,255,"), "later events shift their fade window: {last}");
    }

    #[test]
    fn vertical_text_stacks_characters() {
        let out = script(&[(graphic(Preset::Title, None), Placement { vertical: true, opacity: 0.9, ..Placement::default() })], 1080, 1920);
        assert!(out.contains("h\\Ne\\Nl\\Nl\\No"), "{out}");
    }
}
