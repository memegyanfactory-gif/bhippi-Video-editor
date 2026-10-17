//! Fitting a turn to a small context window.
//!
//! A local server reads only as much as it was started with (often 8K to 32K), while Bhippi's full
//! request is a ~15K-token guide plus 200+ tool schemas. When the full request would take more than
//! [`CEILING`] of the window, the turn is built compact instead: a short guide, a small and stable
//! set of tools, `find_tools` to look up any other tool and `use_tool` to run it, and a history
//! trimmed from the oldest end. Cloud and frontier providers never come through here.

use crate::ai_tools;
use bhippi_providers::{Message, Role, ToolSpec};
use serde_json::{json, Value};
use std::fmt::Write as _;

/// The share of the window a request may fill; the rest is for the answer and the tool results.
pub const CEILING: f64 = 0.65;

/// The tool that looks up other tools.
pub const FIND_TOOLS: &str = "find_tools";
/// The tool that runs any Bhippi tool by name.
pub const USE_TOOL: &str = "use_tool";

/// Loaded in every compact request, in this order, whatever the message: the same list each turn, so
/// the server's prompt cache keeps working. Everything else is one `find_tools` away.
const COMPACT_TOOLS: [&str; 20] = [
    "editing_workflow_status", "get_comp", "get_project", "ask_user", "build_edit_from_brief", "add_text", "place_clip", "add_graphic", "split_clips", "delete_clips",
    "undo", "write_file", "edit_file", "read_file", "import_media", "update_clip", "add_captions", "add_transition", "run_frame_qa", "verify_edit_workflow",
];

/// A rough token count: about 3.5 characters a token, which errs towards over-counting JSON.
#[must_use]
pub fn estimate_tokens(chars: usize) -> usize {
    chars * 10 / 35
}

/// What a request costs, in estimated tokens: system text, tool schemas and every message.
#[must_use]
pub fn request_tokens(system: &str, tools: &[ToolSpec], messages: &[Message]) -> usize {
    estimate_tokens(system.len()) + tools_tokens(tools) + messages_tokens(messages)
}

#[must_use]
pub fn tools_tokens(tools: &[ToolSpec]) -> usize {
    estimate_tokens(tools.iter().map(|tool| tool.name.len() + tool.description.len() + tool.input_schema.to_string().len() + 40).sum())
}

/// What one message costs. An image is a data URL of hundreds of KB that the server turns into a
/// few hundred tokens, so it counts as a flat amount.
fn message_tokens(message: &Message) -> usize {
    let calls: usize = message.tool_calls.iter().map(|call| call.name.len() + call.arguments.to_string().len() + 30).sum();
    estimate_tokens(message.content.len() + calls + 16) + message.images.len() * 700
}

#[must_use]
pub fn messages_tokens(messages: &[Message]) -> usize {
    messages.iter().map(message_tokens).sum()
}

/// The request's token ceiling in a window of `window` tokens.
#[must_use]
pub fn ceiling(window: u32) -> usize {
    (f64::from(window) * CEILING) as usize
}

fn spec_find_tools() -> ToolSpec {
    ToolSpec {
        name: FIND_TOOLS.to_owned(),
        description: "Look up Bhippi tools you do not have loaded. Pass a word or two (\"color grade\", \"voiceover\", \"lottie\"); it returns the matching tools with their descriptions and full parameters. An empty query lists every tool name.".to_owned(),
        input_schema: json!({
            "type": "object",
            "properties": { "query": { "type": "string", "description": "What the tool should do, or part of its name." } },
            "required": ["query"],
        }),
        defer: false,
    }
}

fn spec_use_tool() -> ToolSpec {
    ToolSpec {
        name: USE_TOOL.to_owned(),
        description: "Run any Bhippi tool by name, including ones that are not loaded. Look the tool up with find_tools first so the arguments are right.".to_owned(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "name": { "type": "string", "description": "The tool's name, e.g. color_grade." },
                "arguments": { "type": "object", "description": "The tool's arguments, as find_tools showed them." },
            },
            "required": ["name", "arguments"],
        }),
        defer: false,
    }
}

/// The longest description a loaded compact tool keeps; `find_tools` returns the whole text.
const LOADED_DESCRIPTION: usize = 180;
/// The longest description of one parameter in a loaded compact tool.
const LOADED_PARAMETER: usize = 40;

/// `text` cut to at most `max` characters, at a sentence end when there is one.
fn cut(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_owned();
    }
    let head: String = text.chars().take(max).collect();
    match head.rfind(". ") {
        Some(at) if at > max / 3 => head[..=at].to_owned(),
        _ => format!("{}...", head.trim_end()),
    }
}

/// A schema with its parameter descriptions shortened: the names, types, enums and required list
/// stay, which is what a call needs; the prose is one `find_tools` away.
fn lean_schema(schema: &Value) -> Value {
    match schema {
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(key, value)| match (key.as_str(), value) {
                    ("description", Value::String(text)) => (key.clone(), Value::String(cut(text, LOADED_PARAMETER))),
                    _ => (key.clone(), lean_schema(value)),
                })
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.iter().map(lean_schema).collect()),
        other => other.clone(),
    }
}

/// A compact turn's copy of a tool: the same name and parameters, shorter prose.
fn lean(tool: &ToolSpec) -> ToolSpec {
    ToolSpec { name: tool.name.clone(), description: cut(&tool.description, LOADED_DESCRIPTION), input_schema: lean_schema(&tool.input_schema), defer: false }
}

/// The share of the ceiling the loaded tools may take; the rest is for the guide and the chat.
const TOOLS_SHARE: f64 = 0.5;

/// The tools a compact request loads for a window of `window` tokens: [`COMPACT_TOOLS`] in order for as
/// long as they fit [`TOOLS_SHARE`] of the ceiling (all of them from about 16K), then `find_tools` and
/// `use_tool`. The list depends on the window alone, so it is the same every turn.
#[must_use]
pub fn compact_tools(window: u32) -> Vec<ToolSpec> {
    let finders = [spec_find_tools(), spec_use_tool()];
    let budget = (ceiling(window) as f64 * TOOLS_SHARE) as usize;
    let mut used = tools_tokens(&finders);
    let mut tools: Vec<ToolSpec> = Vec::new();
    for tool in COMPACT_TOOLS.iter().filter_map(|name| ai_tools::specs().iter().find(|tool| tool.name == *name).map(lean)) {
        used += tools_tokens(std::slice::from_ref(&tool));
        if used > budget && tools.len() >= 3 {
            break;
        }
        tools.push(tool);
    }
    tools.extend(finders);
    tools
}

/// Every tool name, grouped by its leading verb (`add: text, tracks, …`): a map of what exists,
/// small enough to sit in the prompt. Sorted, so it is the same every turn.
#[must_use]
pub fn tool_index() -> String {
    let mut groups: std::collections::BTreeMap<&str, Vec<&str>> = std::collections::BTreeMap::new();
    for tool in ai_tools::specs() {
        match tool.name.split_once('_') {
            Some((verb, rest)) => groups.entry(verb).or_default().push(rest),
            None => groups.entry("other").or_default().push(tool.name.as_str()),
        }
    }
    let mut out = String::new();
    for (verb, mut rest) in groups {
        rest.sort_unstable();
        // A verb with one tool reads better whole.
        if rest.len() == 1 && verb != "other" {
            let _ignored = writeln!(out, "{verb}_{}", rest[0]);
        } else {
            let _ignored = writeln!(out, "{verb}: {}", rest.join(", "));
        }
    }
    out
}

/// The prompt section that tells the model what exists, for a window with room for it.
#[must_use]
pub fn index_section() -> String {
    format!("## Tool index\nEvery Bhippi tool, as `verb: what`, so `add: text` is `add_text`. Look one up with find_tools before first use.\n\n{}\n", tool_index())
}

/// How much of a match's description `find_tools` returns.
const FOUND_DESCRIPTION: usize = 700;
/// The most characters of matches one `find_tools` answer carries.
const FOUND_BUDGET: usize = 9_000;

/// Answers `find_tools {query}`: the best matches with their parameters, or every name for an empty query.
#[must_use]
pub fn find_tools(args: &Value) -> Value {
    let query = args.get("query").or_else(|| args.get("q")).or_else(|| args.get("search")).and_then(Value::as_str).unwrap_or_default().trim().to_ascii_lowercase();
    if query.is_empty() || query == "*" || query == "all" || query == "list" {
        return json!({ "ok": true, "summary": format!("{} tools exist", ai_tools::specs().len()), "index": tool_index(), "next": "Look one up with find_tools {query}, then call it, or run it with use_tool {name, arguments}." });
    }
    let words: Vec<&str> = query.split(|c: char| !c.is_ascii_alphanumeric()).filter(|word| word.len() > 1).collect();
    let joined = words.join("_");
    let mut scored: Vec<(usize, &ToolSpec)> = ai_tools::specs()
        .iter()
        .filter_map(|tool| {
            let name = tool.name.as_str();
            let description = tool.description.to_ascii_lowercase();
            let mut score = if name == joined { 100 } else { 0 };
            for word in &words {
                if name.split('_').any(|part| part == *word) {
                    score += 6;
                } else if name.contains(word) {
                    score += 4;
                }
                if description.contains(word) {
                    score += 1;
                }
            }
            (score > 0).then_some((score, tool))
        })
        .collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.name.cmp(&b.1.name)));
    let loaded: Vec<&str> = COMPACT_TOOLS.to_vec();
    let mut tools = Vec::new();
    let mut size = 0;
    for (_, tool) in scored.into_iter().take(8) {
        let description: String = tool.description.chars().take(FOUND_DESCRIPTION).collect();
        let entry = json!({ "name": tool.name, "description": description, "parameters": tool.input_schema, "loaded": loaded.contains(&tool.name.as_str()) });
        size += entry.to_string().len();
        if size > FOUND_BUDGET && !tools.is_empty() {
            break;
        }
        tools.push(entry);
    }
    if tools.is_empty() {
        return json!({ "ok": true, "summary": format!("No tool matches \"{query}\". Try another word, or find_tools with an empty query lists every name."), "tools": [] });
    }
    let names: Vec<&str> = tools.iter().filter_map(|tool| tool["name"].as_str()).collect();
    json!({
        "ok": true,
        "summary": format!("Found {}: {}", tools.len(), names.join(", ")),
        "tools": tools,
        "next": "Call a tool marked loaded directly. Run any other with use_tool {name, arguments}.",
    })
}

/// The tool and arguments inside a `use_tool` call. Small models put the arguments beside the name
/// instead of under `arguments`, or as a JSON string, so both are accepted.
pub fn unwrap_use_tool(args: &Value) -> Result<(String, Value), String> {
    let name = args.get("name").or_else(|| args.get("tool")).and_then(Value::as_str).map(str::trim).filter(|name| !name.is_empty()).ok_or("use_tool needs {name, arguments}: name the tool to run.")?;
    if name == USE_TOOL {
        return Err("use_tool runs another tool: name that one.".to_owned());
    }
    let inner = args.get("arguments").or_else(|| args.get("args")).or_else(|| args.get("input"));
    let arguments = match inner {
        Some(Value::String(text)) => serde_json::from_str::<Value>(text).ok().filter(Value::is_object).ok_or("use_tool's arguments must be a JSON object.")?,
        Some(value) if value.is_object() => value.clone(),
        Some(Value::Null) | None => {
            let mut rest = args.as_object().cloned().unwrap_or_default();
            for key in ["name", "tool", "arguments", "args", "input"] {
                rest.remove(key);
            }
            Value::Object(rest)
        }
        Some(_) => return Err("use_tool's arguments must be a JSON object.".to_owned()),
    };
    if name != FIND_TOOLS && !ai_tools::is_known(name) {
        let hint = find_tools(&json!({ "query": name.replace('_', " ") }));
        let suggestions = hint["summary"].as_str().unwrap_or_default();
        return Err(format!("{name} is not a Bhippi tool. {suggestions}"));
    }
    Ok((name.to_owned(), arguments))
}

/// The context JSON cut down to about `max_chars`: long lists keep their first items, long strings
/// their start, and past that the text is cut with a note.
#[must_use]
pub fn shrink_context(context: &Value, max_chars: usize) -> String {
    let whole = serde_json::to_string(context).unwrap_or_default();
    if whole.len() <= max_chars {
        return whole;
    }
    fn walk(value: &mut Value, items: usize, text: usize) {
        match value {
            Value::String(string) if string.chars().count() > text => {
                let kept: String = string.chars().take(text).collect();
                *string = format!("{kept}...");
            }
            Value::Array(list) => {
                if list.len() > items {
                    let more = list.len() - items;
                    list.truncate(items);
                    list.push(json!(format!("... {more} more")));
                }
                list.iter_mut().for_each(|item| walk(item, items, text));
            }
            Value::Object(map) => map.values_mut().for_each(|item| walk(item, items, text)),
            _ => {}
        }
    }
    let mut value = context.clone();
    for (items, text) in [(24, 400), (12, 200), (6, 100)] {
        walk(&mut value, items, text);
        let small = serde_json::to_string(&value).unwrap_or_default();
        if small.len() <= max_chars {
            return small;
        }
    }
    let small = serde_json::to_string(&value).unwrap_or_default();
    let mut end = max_chars.min(small.len());
    while !small.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}... (project summary cut to fit this model's context)", &small[..end])
}

/// A tool result longer than this is a candidate for shortening when the request is over budget.
const SHORTEN_ABOVE: usize = 1_500;

fn shorten_text(text: &str) -> String {
    let mut head = 600;
    while !text.is_char_boundary(head) {
        head -= 1;
    }
    let mut tail = text.len() - 300;
    while !text.is_char_boundary(tail) {
        tail += 1;
    }
    format!("{}...{} chars omitted...{}", &text[..head], tail - head, &text[tail..])
}

/// What [`fit_messages`] did, for the log.
#[derive(Debug, Default, Eq, PartialEq)]
pub struct Trimmed {
    pub shortened: usize,
    pub dropped_messages: usize,
}

/// Where each unit of the conversation begins. A unit is a user message and everything up to the
/// next one, except that a user message right after a tool result (the frames a round attaches)
/// belongs to that round. A tool call and its results are therefore never in different units.
fn unit_starts(messages: &[Message]) -> Vec<usize> {
    let mut starts = vec![0];
    for at in 1..messages.len() {
        if messages[at].role == Role::User && messages[at - 1].role != Role::Tool {
            starts.push(at);
        }
    }
    starts
}

/// Where each round begins inside the last unit: an assistant message after the first one, taken
/// with its tool results.
fn round_starts(messages: &[Message], from: usize) -> Vec<usize> {
    (from + 1..messages.len()).filter(|at| messages[*at].role == Role::Assistant && (messages[*at - 1].role != Role::Assistant || messages[*at - 1].tool_calls.is_empty())).collect()
}

/// Brings `messages` under `budget` estimated tokens, trimming from the oldest end and never
/// touching what stays: first the old tool results are shortened, then the oldest whole turns go,
/// then the oldest rounds of the turn in progress. A tool call is never separated from its result,
/// and the last user message and the latest round stay whole.
pub fn fit_messages(messages: &mut Vec<Message>, budget: usize) -> Trimmed {
    let mut done = Trimmed::default();
    if messages_tokens(messages) <= budget {
        return done;
    }
    // The latest round (and anything after the last user text) is never shortened.
    let last_user = messages.iter().rposition(|message| message.role == Role::User && message.tool_result.is_none()).unwrap_or(0);
    let protected_from = round_starts(messages, last_user).last().copied().unwrap_or(messages.len());
    for at in 0..protected_from.min(messages.len()) {
        if messages_tokens(messages) <= budget {
            return done;
        }
        let message = &mut messages[at];
        if message.role == Role::Tool && message.content.len() > SHORTEN_ABOVE {
            message.content = shorten_text(&message.content);
            done.shortened += 1;
        }
    }
    // Whole earlier turns, oldest first.
    loop {
        if messages_tokens(messages) <= budget {
            return done;
        }
        let starts = unit_starts(messages);
        if starts.len() < 2 {
            break;
        }
        let end = starts[1];
        messages.drain(..end);
        done.dropped_messages += end;
    }
    // Rounds of the turn in progress: its user message stays, its latest round stays.
    loop {
        if messages_tokens(messages) <= budget {
            return done;
        }
        let rounds = round_starts(messages, 0);
        if rounds.len() < 2 {
            return done;
        }
        let (from, to) = (rounds[0], rounds[1]);
        messages.drain(from..to);
        done.dropped_messages += to - from;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bhippi_providers::ToolCall;

    fn call(id: &str) -> ToolCall {
        ToolCall { id: id.to_owned(), name: "get_comp".to_owned(), arguments: json!({}) }
    }

    /// A round: the assistant's call and the tool's (large) answer.
    fn round(id: &str, size: usize) -> Vec<Message> {
        let call = call(id);
        vec![Message::assistant_with_tools(String::new(), vec![call.clone()]), Message::tool_result(&call, "x".repeat(size), false)]
    }

    /// Every tool result answers a call made by the assistant message right before it, and every
    /// call has its result.
    fn paired(messages: &[Message]) -> bool {
        let mut open: Vec<String> = Vec::new();
        for message in messages {
            match message.role {
                Role::Assistant => {
                    if !open.is_empty() {
                        return false;
                    }
                    open = message.tool_calls.iter().map(|call| call.id.clone()).collect();
                }
                Role::Tool => {
                    let Some(result) = &message.tool_result else { return false };
                    let Some(at) = open.iter().position(|id| *id == result.call_id) else { return false };
                    open.remove(at);
                }
                _ => {
                    if !open.is_empty() {
                        return false;
                    }
                }
            }
        }
        open.is_empty()
    }

    #[test]
    fn the_compact_set_is_small_stable_and_has_the_two_finders() {
        let tools = compact_tools(32_768);
        assert_eq!(tools.len(), 22, "a 32K window loads them all");
        let small = compact_tools(16_384);
        println!("16K loads {} tools, {} tokens", small.len(), tools_tokens(&small));
        assert!(small.len() >= 16 && tools_tokens(&small) <= ceiling(16_384) / 2 + 400, "{}", small.len());
        assert!(compact_tools(8_192).len() < small.len() && compact_tools(8_192).len() >= 5);
        assert!(tools.len() >= 15 && tools.len() <= 25, "{}", tools.len());
        assert!(tools.iter().any(|tool| tool.name == FIND_TOOLS) && tools.iter().any(|tool| tool.name == USE_TOOL));
        for name in COMPACT_TOOLS {
            assert!(ai_tools::is_known(name), "{name} is not in the catalogue");
        }
        assert_eq!(serde_json::to_string(&small).unwrap(), serde_json::to_string(&compact_tools(16_384)).unwrap());
        // The index names every tool once and stays small.
        let index = tool_index();
        assert!(index.contains("add: ") && index.contains("text"), "{index}");
        assert!(estimate_tokens(index.len()) < 2_500, "{} tokens", estimate_tokens(index.len()));
    }

    #[test]
    fn find_tools_returns_names_one_liners_and_schemas() {
        let found = find_tools(&json!({ "query": "color grade" }));
        assert_eq!(found["ok"], true);
        let tools = found["tools"].as_array().expect("tools");
        assert!(tools.iter().any(|tool| tool["name"] == "color_grade" && tool["parameters"]["properties"].as_object().is_some_and(|map| !map.is_empty())), "{found}");
        assert!(find_tools(&json!({ "query": "" }))["index"].as_str().is_some_and(|index| index.contains("add: ")));
        assert_eq!(find_tools(&json!({ "query": "qqqzzz" }))["tools"], json!([]));
    }

    #[test]
    fn use_tool_unwraps_to_the_real_call() {
        assert_eq!(unwrap_use_tool(&json!({ "name": "add_text", "arguments": { "text": "Goa" } })), Ok(("add_text".to_owned(), json!({ "text": "Goa" }))));
        // Arguments as a JSON string, or beside the name.
        assert_eq!(unwrap_use_tool(&json!({ "name": "add_text", "arguments": "{\"text\":\"Goa\"}" })).map(|call| call.1), Ok(json!({ "text": "Goa" })));
        assert_eq!(unwrap_use_tool(&json!({ "name": "add_text", "text": "Goa" })).map(|call| call.1), Ok(json!({ "text": "Goa" })));
        let unknown = unwrap_use_tool(&json!({ "name": "format_disk", "arguments": {} })).unwrap_err();
        assert!(unknown.contains("not a Bhippi tool"), "{unknown}");
        assert!(unwrap_use_tool(&json!({ "arguments": {} })).is_err());
        assert!(unwrap_use_tool(&json!({ "name": "use_tool", "arguments": {} })).is_err());
    }

    #[test]
    fn trimming_keeps_every_tool_call_with_its_result() {
        // Two earlier turns, then a turn in progress with four rounds.
        let mut messages = vec![Message::user("first ask".to_owned()), Message::assistant("done one".to_owned()), Message::user("second ask".to_owned())];
        messages.extend(round("a", 6_000));
        messages.push(Message::assistant("done two".to_owned()));
        messages.push(Message::user("THE LAST ASK".to_owned()));
        for id in ["b", "c", "d", "e"] {
            messages.extend(round(id, 6_000));
        }
        assert!(paired(&messages));
        let before = messages_tokens(&messages);

        // Over budget by a little: old results shrink, nothing is dropped.
        let mut shorter = messages.clone();
        let done = fit_messages(&mut shorter, before - 1_200);
        assert!(done.shortened > 0 && done.dropped_messages == 0, "{done:?}");
        assert_eq!(shorter.len(), messages.len());
        assert!(paired(&shorter));
        let last = messages.last().expect("last");
        assert_eq!(shorter.last(), Some(last), "the latest round is untouched");

        // Far over: whole turns go, then old rounds; pairs stay together, the last ask stays whole.
        let mut tight = messages.clone();
        let done = fit_messages(&mut tight, 2_500);
        assert!(done.dropped_messages > 0, "{done:?}");
        assert!(paired(&tight), "{tight:?}");
        assert!(tight.iter().any(|message| message.content == "THE LAST ASK"));
        assert_eq!(tight.last(), Some(last));
        assert_eq!(tight.first().map(|message| message.role), Some(Role::User));

        // Already under budget: untouched.
        let mut same = messages.clone();
        assert_eq!(fit_messages(&mut same, before + 10), Trimmed::default());
        assert_eq!(same, messages);
    }

    #[test]
    fn a_big_project_summary_is_cut_to_size() {
        let context = json!({ "tracks": (0..400).map(|n| json!({ "id": format!("clip-{n}"), "name": "x".repeat(300) })).collect::<Vec<_>>(), "playhead": 1.5 });
        let text = shrink_context(&context, 6_000);
        assert!(text.len() <= 6_100, "{}", text.len());
        assert!(text.contains("playhead") || text.contains("clip-0"), "{text}");
        assert_eq!(shrink_context(&json!({ "a": 1 }), 6_000), "{\"a\":1}");
    }
}
