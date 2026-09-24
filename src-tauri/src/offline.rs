//! The builtin offline assistant: direct edit commands, understood without a model.
//!
//! "add title \"Goa\" at 1s for 3s, add whoosh at every cut, make it vertical" becomes a list
//! of tool calls run through the same executor as every model, so an offline edit lands in
//! the timeline, the undo history and the chat's tool rows exactly like a model's. Times with
//! no number default to the playhead the UI put in the turn's context.

use crate::ai_tools::{self, ToolExecutor};
use serde_json::{json, Map, Value};

/// One thing a command asks for.
#[derive(Clone, Debug, PartialEq)]
enum Step {
    /// A tool call, with the line to show when Helios returns no summary of its own.
    Call { name: &'static str, args: Value, label: String },
    /// A sound effect just before every cut on the active comp — needs the timeline first.
    SoundAtCuts { kind: &'static str },
    /// Removes the last (or every) title or sound effect — needs the clip ids first.
    Remove { sounds: bool, all: bool },
    /// Something to tell the user instead of an edit.
    Note(String),
}

#[derive(Debug, PartialEq)]
enum Plan {
    /// A whole reply with no edits (greetings, help).
    Reply(String),
    Steps(Vec<Step>),
}

/// Answers `message` offline, running its edits through `executor`. Returns the reply: one
/// line per edit, in the order they ran.
pub async fn run(message: &str, context: &Value, executor: &dyn ToolExecutor) -> String {
    let steps = match plan(message, context) {
        Plan::Reply(reply) => return reply,
        Plan::Steps(steps) => steps,
    };
    if steps.is_empty() {
        return format!(
            "I couldn't find an edit command in that. The offline assistant understands direct commands:\n\n{COMMAND_LIST}\n\n\
             For open-ended requests, choose an AI provider from the model menu."
        );
    }
    let mut lines = Vec::new();
    for step in steps {
        match step {
            Step::Note(note) => lines.push(note),
            Step::Call { name, args, label } => lines.push(outcome(executor, name, args, &label).await),
            Step::SoundAtCuts { kind } => {
                let comp = executor.call("get_comp".to_owned(), json!({})).await;
                let cuts = cuts_of(&comp);
                if cuts.is_empty() {
                    lines.push("There are no cuts on the timeline to put a sound on yet".to_owned());
                }
                for cut in cuts {
                    let start = round((cut - 0.3).max(0.0));
                    let label = format!("Added {kind} at {start:.2}s");
                    lines.push(outcome(executor, "add_sound_effect", json!({ "kind": kind, "start": start }), &label).await);
                }
            }
            Step::Remove { sounds, all } => {
                let comp = executor.call("get_comp".to_owned(), json!({})).await;
                let mut targets: Vec<(f64, String)> = clips_of(&comp)
                    .filter(|clip| if sounds { is_sound(clip) } else { is_text(clip) })
                    .filter_map(|clip| Some((number(clip, "start").unwrap_or(0.0), clip.get("id")?.as_str()?.to_owned())))
                    .collect();
                targets.sort_by(|a, b| a.0.total_cmp(&b.0));
                if !all {
                    targets = targets.pop().into_iter().collect();
                }
                let what = if sounds { "sound effect" } else { "text clip" };
                if targets.is_empty() {
                    lines.push(format!("There is no {what} on this comp to remove"));
                    continue;
                }
                let ids: Vec<String> = targets.into_iter().map(|(_, id)| id).collect();
                let label = format!("Removed {} {what}(s)", ids.len());
                lines.push(outcome(executor, "delete_clips", json!({ "clipIds": ids }), &label).await);
            }
        }
    }
    lines.iter().map(|line| format!("- {line}")).collect::<Vec<_>>().join("\n")
}

/// One edit's line: Helios' own summary when it gave one, the reason when it failed.
async fn outcome(executor: &dyn ToolExecutor, name: &str, args: Value, label: &str) -> String {
    let result = ai_tools::run_call(executor, name, args).await;
    if ai_tools::is_ok(&result) {
        result.get("summary").and_then(Value::as_str).filter(|summary| !summary.is_empty()).unwrap_or(label).to_owned()
    } else {
        format!("Couldn't do that ({label}): {}", ai_tools::error_of(&result))
    }
}

fn round(seconds: f64) -> f64 {
    (seconds * 1000.0).round() / 1000.0
}

fn number(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(Value::as_f64).filter(|number| number.is_finite())
}

/// The playhead the UI put in the context, wherever this version of it nests it.
fn playhead(context: &Value) -> Option<f64> {
    ["/playhead", "/activeComp/playhead", "/comp/playhead", "/timeline/playhead"]
        .iter()
        .find_map(|pointer| context.pointer(pointer).and_then(Value::as_f64))
        .filter(|time| time.is_finite() && *time >= 0.0)
}

fn clips_of(comp: &Value) -> impl Iterator<Item = &Value> {
    comp.get("clips")
        .or_else(|| comp.pointer("/comp/clips"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
}

fn source_type(clip: &Value) -> Option<&str> {
    clip.pointer("/source/type").or_else(|| clip.get("kind")).and_then(Value::as_str)
}

fn is_text(clip: &Value) -> bool {
    source_type(clip) == Some("text") || clip.get("text").is_some_and(|text| !text.is_null())
}

fn is_sound(clip: &Value) -> bool {
    source_type(clip) == Some("sfx") || clip.get("sfx").is_some_and(|sfx| !sfx.is_null())
}

/// Where one picture clip ends and the next begins on the bottom video track: every clip end
/// except the last.
fn cuts_of(comp: &Value) -> Vec<f64> {
    let on_v1 = |clip: &&Value| {
        clip.get("track").or_else(|| clip.get("trackLabel")).and_then(Value::as_str).is_none_or(|track| track == "V1")
    };
    let mut ends: Vec<f64> = clips_of(comp)
        .filter(on_v1)
        .filter(|clip| !is_text(clip) && !is_sound(clip))
        .filter_map(|clip| {
            number(clip, "end").or_else(|| Some(number(clip, "start")? + number(clip, "duration")?))
        })
        .collect();
    ends.sort_by(f64::total_cmp);
    ends.dedup_by(|a, b| (*a - *b).abs() < 1e-3);
    ends.pop();
    ends
}

// ───────────────────────────── reading commands ─────────────────────────────

/// Pulls `"quoted"` (or “curly”) strings out so separators inside them are not split on.
fn quoted(message: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current: Option<String> = None;
    for character in message.chars() {
        match (character, current.as_mut()) {
            ('"' | '“' | '”', Some(text)) => {
                out.push(std::mem::take(text));
                current = None;
            }
            ('"' | '“', None) => current = Some(String::new()),
            (_, Some(text)) => text.push(character),
            _ => {}
        }
    }
    out
}

/// Splits a message into clauses on `,` `;` newlines, "and" and "then", each with its own
/// quoted strings.
fn clauses(message: &str) -> Vec<(String, Vec<String>)> {
    let texts = quoted(message);
    let mut masked = message.to_owned();
    for (index, text) in texts.iter().enumerate() {
        for (open, close) in [('"', '"'), ('“', '”')] {
            masked = masked.replacen(&format!("{open}{text}{close}"), &format!(" \u{1}{index}\u{1} "), 1);
        }
    }
    let lowered = masked.to_lowercase().replace('\n', ";");
    lowered
        .split([';', ','])
        .flat_map(|part| {
            part.split(" and then ")
                .flat_map(|piece| piece.split(" then "))
                .flat_map(|piece| piece.split(" and "))
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .map(|part| {
            let mut own = Vec::new();
            let mut clean = String::new();
            for (index, piece) in part.split('\u{1}').enumerate() {
                if index % 2 == 1 {
                    if let Some(text) = piece.trim().parse::<usize>().ok().and_then(|at| texts.get(at)) {
                        own.push(text.clone());
                    }
                } else {
                    clean.push_str(piece);
                }
            }
            (clean.trim().to_owned(), own)
        })
        .filter(|(clean, own)| !clean.is_empty() || !own.is_empty())
        .collect()
}

/// The first number followed by a seconds unit, written as `m:ss`, or after `at`/`@`/`par`.
fn seconds_in(clause: &str, after: &[&str]) -> Option<f64> {
    let words: Vec<&str> = clause.split_whitespace().collect();
    for (index, word) in words.iter().enumerate() {
        let trimmed = word.trim_matches(|c: char| !c.is_ascii_digit() && c != '.' && c != ':' && c != '@');
        let bare = trimmed.trim_start_matches('@');
        let value = if let Some((minutes, seconds)) = bare.split_once(':') {
            match (minutes.parse::<f64>(), seconds.parse::<f64>()) {
                (Ok(m), Ok(s)) if !seconds.is_empty() => Some(m * 60.0 + s),
                _ => None,
            }
        } else {
            bare.trim_end_matches('.').parse::<f64>().ok()
        };
        let Some(value) = value.filter(|value| value.is_finite()) else {
            continue;
        };
        let previous = index.checked_sub(1).and_then(|at| words.get(at)).copied().unwrap_or("");
        let next = words.get(index + 1).copied().unwrap_or("");
        let unit_attached = word.ends_with('s') || word.ends_with("sec") || word.contains(':');
        let unit_next = ["s", "sec", "secs", "second", "seconds"].contains(&next.trim_matches(|c: char| !c.is_alphabetic()));
        let marker = after.contains(&previous) || trimmed.starts_with('@');
        if unit_attached || unit_next || marker {
            return Some(value);
        }
    }
    None
}

fn named_color(word: &str) -> Option<&'static str> {
    Some(match word {
        "white" => "#FFFFFF",
        "black" => "#111111",
        "yellow" | "gold" | "golden" | "amber" => "#FFC53D",
        "red" => "#FF4D4F",
        "orange" => "#FF8A3D",
        "green" => "#3FB950",
        "blue" => "#3D7BFF",
        "cyan" | "teal" => "#2BD4C9",
        "pink" => "#FF6FB5",
        "purple" | "violet" => "#A78BFA",
        _ => return None,
    })
}

fn color_in(clause: &str) -> Option<String> {
    clause.split(|c: char| !c.is_alphanumeric() && c != '#').find_map(|word| {
        if word.len() == 7 && word.starts_with('#') && word[1..].chars().all(|c| c.is_ascii_hexdigit()) {
            Some(word.to_ascii_uppercase())
        } else {
            named_color(word).map(str::to_owned)
        }
    })
}

fn sfx_of(word: &str) -> Option<&'static str> {
    Some(match word {
        "whoosh" | "swoosh" | "swish" => "whoosh",
        "impact" | "boom" | "hit" | "thud" => "impact",
        "chime" | "ding" | "bell" => "chime",
        "pop" | "click" | "blip" => "pop",
        "riser" | "rise" | "build" | "buildup" => "riser",
        _ => return None,
    })
}

/// Frame-size words and the preset and label each means.
const FRAME_WORDS: &[(&[&str], &str, &str)] = &[
    (&["vertical", "9:16", "9x16", "reels", "reel", "shorts", "tiktok"], "vertical", "9:16 vertical (1080×1920)"),
    (&["square", "1:1"], "square", "1:1 square (1080×1080)"),
    (&["4:5", "feed", "portrait"], "portrait", "4:5 portrait (1080×1350)"),
    (&["landscape", "horizontal", "widescreen", "16:9", "youtube", "1080p"], "1080p", "16:9 landscape (1920×1080)"),
    (&["4k", "uhd"], "4k", "4K (3840×2160)"),
    (&["720p"], "720p", "720p (1280×720)"),
];

fn call(name: &'static str, args: Value, label: String) -> Step {
    Step::Call { name, args, label }
}

fn plan(message: &str, context: &Value) -> Plan {
    let lowered = message.trim().to_lowercase();
    let greeting = ["hi", "hello", "hey", "namaste", "hola", "yo", "hii", "helo"];
    if greeting.contains(&lowered.trim_matches(|c: char| !c.is_alphanumeric())) {
        return Plan::Reply(
            "Namaste! I'm the built-in Helios assistant — I work offline and understand direct edit commands. \
             Try:\n\n- `add title \"My Story\" at 1s`\n- `add whoosh at 2.5s`\n- `split at 4s`\n- `make it vertical`\n\n\
             For open-ended help (\"make this reel punchier\"), pick Claude, Codex, Gemini, Ollama or another provider from the model menu below."
                .to_owned(),
        );
    }
    // A roast / meme edit is a whole pipeline (beat sheet, meme research, receipts), not a command:
    // say what the @funny style does and that it needs a model, unless the message also held edits.
    let funny = asks_for_funny(message, context);
    if !funny && (lowered.contains("help") || lowered.contains("what can you do")) {
        return Plan::Reply(HELP.to_owned());
    }

    let now = playhead(context);
    let mut steps = Vec::new();
    for (clause, texts) in clauses(message) {
        let tokens: Vec<&str> = clause.split(|c: char| !c.is_alphanumeric() && c != ':').filter(|token| !token.is_empty()).collect();
        let has = |words: &[&str]| {
            words.iter().any(|word| tokens.contains(word) || (word.contains(' ') && clause.contains(word)))
        };
        let explicit = seconds_in(&clause, &["at", "par", "@", "from", "to"]);
        let at = explicit.or(now);
        let duration = clause
            .find("for ")
            .and_then(|index| clause[index + 4..].split_whitespace().next())
            .and_then(|token| token.trim_end_matches(|c: char| c.is_alphabetic()).parse::<f64>().ok())
            .filter(|duration| duration.is_finite() && *duration > 0.0);

        if has(&["undo"]) {
            let count = tokens.iter().find_map(|token| token.parse::<u32>().ok()).unwrap_or(1).clamp(1, 50);
            steps.push(call("undo", json!({ "steps": count }), format!("Undid {count} edit(s)")));
            continue;
        }
        if let Some((_, preset, label)) = FRAME_WORDS.iter().find(|(words, _, _)| has(words)) {
            steps.push(call("update_comp", json!({ "preset": preset }), format!("Switched the comp to {label}")));
            continue;
        }
        if clause.contains("style") {
            let named = texts.first().cloned().or_else(|| {
                crate::caption_styles::all()
                    .iter()
                    .find(|style| clause.contains(&style.label.to_lowercase()) || tokens.contains(&style.id.to_lowercase().as_str()))
                    .map(|style| style.label.clone())
            });
            if let Some(style) = named.as_deref().and_then(crate::caption_styles::lookup) {
                steps.push(call("set_caption_style", json!({ "style": style.id }), format!("Caption style set to {}", style.label)));
                continue;
            }
        }
        if has(&["rename", "name the comp", "comp name", "name the project", "call it"]) {
            match texts.first() {
                Some(name) => steps.push(call("update_comp", json!({ "name": name }), format!("Renamed the comp to “{name}”"))),
                None => steps.push(Step::Note("Put the new name in quotes, e.g. rename \"Goa trip\"".to_owned())),
            }
            continue;
        }
        if has(&["remove", "delete", "clear", "hatao"]) {
            let sounds = has(&["sound", "sounds", "sfx", "effects", "whoosh"]);
            if sounds || has(&["text", "title", "titles", "graphic", "graphics", "caption", "captions"]) {
                steps.push(Step::Remove { sounds, all: has(&["all", "every"]) });
            } else {
                steps.push(Step::Note("Say what to remove — e.g. \"remove last title\" or \"remove all sounds\"".to_owned()));
            }
            continue;
        }
        if has(&["marker"]) {
            let mut args = Map::new();
            if let Some(time) = at {
                args.insert("time".to_owned(), json!(time));
            }
            if let Some(name) = texts.first() {
                args.insert("name".to_owned(), json!(name));
            }
            let label = at.map_or_else(|| "Added a marker".to_owned(), |time| format!("Added a marker at {time:.2}s"));
            steps.push(call("add_marker", Value::Object(args), label));
            continue;
        }
        if has(&["go to", "jump to", "playhead", "seek"]) {
            match explicit {
                Some(time) => steps.push(call("set_playhead", json!({ "time": time }), format!("Moved the playhead to {time:.2}s"))),
                None => steps.push(Step::Note("Say where to go, e.g. go to 1:30".to_owned())),
            }
            continue;
        }
        if let Some(kind) = clause.split(|c: char| !c.is_alphabetic()).find_map(sfx_of) {
            if has(&["every cut", "each cut", "all cuts", "every clip", "each clip", "transitions"]) {
                steps.push(Step::SoundAtCuts { kind });
            } else {
                let mut args = Map::new();
                args.insert("kind".to_owned(), json!(kind));
                if let Some(time) = at {
                    args.insert("start".to_owned(), json!(time.max(0.0)));
                }
                let label = at.map_or_else(|| format!("Added {kind}"), |time| format!("Added {kind} at {time:.2}s"));
                steps.push(call("add_sound_effect", Value::Object(args), label));
            }
            continue;
        }
        if has(&["podcast", "who is speaking", "speaking", "speaker", "reframe", "reaction", "autocut", "auto-cut", "auto cut", "multicam", "multi-cam"]) {
            steps.push(call(
                "podcast_cut",
                json!({}),
                "Podcast cut planned: the AI will look at the frames, work out who sits where, and cut to whoever speaks. Give it a minute, then review the singles at 2x.".to_owned(),
            ));
            continue;
        }
        if has(&["split", "cut", "kaat", "kaato", "kato", "slice"]) {
            match at {
                Some(time) => steps.push(call("split_clips", json!({ "time": time }), format!("Split at {time:.2}s"))),
                None => steps.push(Step::Note("Say where to split, e.g. split at 4.5s".to_owned())),
            }
            continue;
        }
        let preset = if has(&["lower third", "lower-third", "nametag", "name tag", "lowerthird"]) {
            Some(("lower-third", "lower third"))
        } else if has(&["caption", "captions", "subtitle", "subtitles"]) {
            Some(("caption", "caption"))
        } else if has(&["kinetic", "animated", "word by word"]) {
            Some(("kinetic", "kinetic text"))
        } else if has(&["title", "heading", "headline", "text", "naam", "likho"]) || !texts.is_empty() {
            Some(("title", "title"))
        } else {
            None
        };
        if let Some((preset, noun)) = preset {
            let Some(body) = texts.first() else {
                steps.push(Step::Note("Put the words in quotes, e.g. add title \"My Story\" at 1s".to_owned()));
                continue;
            };
            let length = duration.unwrap_or(if preset == "kinetic" { 3.0 } else { 2.5 }).clamp(0.3, 600.0);
            let mut args = Map::new();
            args.insert("text".to_owned(), json!(body));
            args.insert("preset".to_owned(), json!(preset));
            args.insert("duration".to_owned(), json!(length));
            if let Some(time) = at {
                args.insert("start".to_owned(), json!(time.max(0.0)));
            }
            if let Some(subtitle) = texts.get(1) {
                args.insert("subtitle".to_owned(), json!(subtitle));
            }
            if let Some(color) = color_in(&clause) {
                args.insert("color".to_owned(), json!(color));
            }
            let when = at.map(|time| format!(" at {time:.2}s")).unwrap_or_default();
            steps.push(call("add_text", Value::Object(args), format!("Added {noun} “{body}”{when}")));
        }
    }
    let edits = steps.iter().any(|step| matches!(step, Step::Call { .. } | Step::SoundAtCuts { .. } | Step::Remove { .. }));
    if funny && !edits {
        return Plan::Reply(FUNNY.to_owned());
    }
    Plan::Steps(steps)
}

/// Words that ask for the @funny style (src/lib/styles.ts), outside any quoted text — a title
/// that says "funny" is a title — or the style already switched on in the chat.
fn asks_for_funny(message: &str, context: &Value) -> bool {
    const WORDS: &[&str] = &["funny", "roast", "roasting", "meme", "memes", "comedy", "comedic", "mazedaar", "mazaak"];
    let mut unquoted = message.to_lowercase();
    for text in quoted(message).iter().filter(|text| !text.trim().is_empty()) {
        unquoted = unquoted.replace(&text.to_lowercase(), " ");
    }
    let styled = context.get("editStyle").and_then(Value::as_str).is_some_and(|style| style.trim_start_matches('@').eq_ignore_ascii_case("funny"));
    styled || unquoted.split(|c: char| !c.is_alphanumeric()).any(|word| WORDS.contains(&word))
}

const COMMAND_LIST: &str = "- `add title \"Text\" at 1s for 3s` (also: kinetic, lower third, caption)\n\
- `add whoosh at 2s` (impact, chime, pop, riser) · `add whoosh at every cut`\n\
- `split at 4.5s` · `go to 1:30` · `add marker \"Hook\"`\n\
- `podcast cut` (who speaks when: cuts and reframes to the speaker)\n\
- `make it vertical` · `square` · `landscape` · `4:5`\n\
- `remove last title` · `remove all sounds` · `undo`\n\
- `rename \"Goa trip\"`\n\
- `caption style Hormozi` (any style from Graphics › Caption styles)";

const FUNNY: &str = "That's a job for **@funny**, Helios' roast / meme edit style. Type `@funny` in the chat (or `/style funny`) and \
Helios AI edits your recording like a roast channel: it keys your green screen, reads the transcript for setups and punchlines, \
finds memes that echo your words and the target's own clips as receipts, lands each one on the punchline with keyword text, \
cut-outs, stickers and a sound on every entry, then checks the pacing against a professional roast edit.\n\n\
Planning the jokes and researching the memes needs an AI model, so pick a provider (Claude, Codex, Gemini, Ollama or another) \
from the model menu below first. Offline I can still make direct edits: `add whoosh at 2s`, `add title \"BRUH\" at 4s`, `split at 4.5s`.";

const HELP: &str = "Here's what I can do offline:\n\n\
- `add title \"Text\" at 1s for 3s` (also: kinetic, lower third, caption)\n\
- `add whoosh at 2s` (impact, chime, pop, riser) · `add whoosh at every cut`\n\
- `split at 4.5s` · `go to 1:30` · `add marker \"Hook\"`\n\
- `podcast cut` (who speaks when: cuts and reframes to the speaker)\n\
- `make it vertical` · `square` · `landscape` · `4:5`\n\
- `remove last title` · `remove all sounds` · `undo`\n\
- `rename \"Goa trip\"`\n\n\
Chain edits with commas or \"and\". Times default to the playhead. \
Pick an AI provider from the model menu for creative direction, rewrites, and multi-step edits.";

#[cfg(test)]
mod tests {
    use super::{plan, run, Plan, Step};
    use crate::ai_tools::testing::FakeExecutor;
    use serde_json::json;

    fn calls(message: &str, context: &serde_json::Value) -> Vec<(&'static str, serde_json::Value)> {
        match plan(message, context) {
            Plan::Steps(steps) => steps
                .into_iter()
                .filter_map(|step| match step {
                    Step::Call { name, args, .. } => Some((name, args)),
                    _ => None,
                })
                .collect(),
            Plan::Reply(reply) => panic!("expected edits, got {reply}"),
        }
    }

    #[test]
    fn the_offline_parser_handles_chained_commands_and_quotes() {
        let planned = calls("add title \"Goa, finally\" at 1s for 3s and add whoosh at 0.5s, make it vertical", &json!({}));
        assert_eq!(
            planned,
            vec![
                ("add_text", json!({"text": "Goa, finally", "preset": "title", "duration": 3.0, "start": 1.0})),
                ("add_sound_effect", json!({"kind": "whoosh", "start": 0.5})),
                ("update_comp", json!({"preset": "vertical"})),
            ]
        );
    }

    #[test]
    fn times_default_to_the_playhead_in_the_context() {
        assert_eq!(calls("split here", &json!({"playhead": 5.0})), vec![("split_clips", json!({"time": 5.0}))]);
        assert_eq!(calls("kaat 1:30", &json!({})), vec![("split_clips", json!({"time": 90.0}))]);
        assert_eq!(
            calls("add red lower third \"Asha\" \"Director\"", &json!({"activeComp": {"playhead": 2.0}})),
            vec![("add_text", json!({"text": "Asha", "subtitle": "Director", "preset": "lower-third", "duration": 2.5, "start": 2.0, "color": "#FF4D4F"}))]
        );
        assert!(matches!(plan("split here", &json!({})), Plan::Steps(steps) if matches!(steps[..], [Step::Note(_)])));
        assert_eq!(calls("go to 12s and undo 2", &json!({})), vec![("set_playhead", json!({"time": 12.0})), ("undo", json!({"steps": 2}))]);
    }

    #[test]
    fn a_greeting_gets_a_greeting_not_an_error() {
        let Plan::Reply(reply) = plan("hi", &json!({})) else {
            panic!("a greeting is not an edit");
        };
        assert!(reply.starts_with("Namaste"), "{reply}");
    }

    #[test]
    fn podcast_words_route_to_the_speaker_cut_not_a_plain_split() {
        assert_eq!(calls("podcast cut", &json!({})), vec![("podcast_cut", json!({}))]);
        assert_eq!(
            calls("cut to whoever is speaking", &json!({})),
            vec![("podcast_cut", json!({}))],
            "speaker intent must win over the generic cut word"
        );
        // The plain cut still works when nobody mentions speakers.
        assert_eq!(calls("split at 4.5s", &json!({})), vec![("split_clips", json!({"time": 4.5}))]);
    }

    #[tokio::test]
    async fn every_cut_reads_the_timeline_then_replies_one_line_per_edit() {
        let executor = FakeExecutor::new(|name, args| match name {
            "get_comp" => json!({"ok": true, "clips": [
                {"id": "a", "track": "V1", "start": 0.0, "end": 4.0},
                {"id": "b", "track": "V1", "start": 4.0, "end": 9.0},
                {"id": "t", "track": "V2", "start": 1.0, "end": 3.0, "text": {"text": "Hi"}},
            ]}),
            "add_sound_effect" if args["start"] == json!(3.7) => json!({"ok": true, "summary": "Placed whoosh on A2 at 00:00:03:21"}),
            _ => json!({"ok": false, "error": "no such thing"}),
        });
        let reply = run("add whoosh at every cut", &json!({}), &executor).await;
        assert_eq!(executor.names(), vec!["get_comp", "add_sound_effect"]);
        assert_eq!(reply, "- Placed whoosh on A2 at 00:00:03:21");

        let reply = run("remove last title and add pop at 2s", &json!({}), &executor).await;
        assert_eq!(executor.calls.lock().expect("calls")[3], ("delete_clips".to_owned(), json!({"clipIds": ["t"]})));
        assert_eq!(reply.lines().count(), 2, "{reply}");
        assert!(reply.contains("Couldn't do that (Added pop at 2.00s): no such thing"), "{reply}");
    }

    #[test]
    fn a_roast_request_explains_the_funny_style_and_that_it_needs_a_model() {
        for message in ["make this funny", "@funny roast this video", "Roast him with memes and cut on the beat", "help me with a meme edit"] {
            let Plan::Reply(reply) = plan(message, &json!({})) else {
                panic!("{message} is a style request, not an edit");
            };
            assert!(reply.contains("@funny") && reply.contains("provider"), "{reply}");
        }
        // With the style on, a message with no command gets the same answer…
        assert!(matches!(plan("make it better", &json!({"editStyle": "funny"})), Plan::Reply(reply) if reply.contains("@funny")));
        // …but real edits still run, and a quoted "funny" is just a title.
        assert_eq!(calls("@funny add whoosh at 2s", &json!({})), vec![("add_sound_effect", json!({"kind": "whoosh", "start": 2.0}))]);
        assert_eq!(calls("add title \"so funny\" at 1s", &json!({})), vec![("add_text", json!({"text": "so funny", "preset": "title", "duration": 2.5, "start": 1.0}))]);
        assert!(matches!(plan("help", &json!({})), Plan::Reply(reply) if reply.starts_with("Here's what I can do offline")));
    }

    #[tokio::test]
    async fn a_message_with_no_command_explains_what_works() {
        let executor = FakeExecutor::new(|_, _| json!({"ok": true}));
        let reply = run("make it more cinematic", &json!({}), &executor).await;
        assert!(reply.starts_with("I couldn't find an edit command"), "{reply}");
        assert!(executor.names().is_empty());
    }
}
