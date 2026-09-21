//! Helios as an MCP server for CLI agents.
//!
//! A CLI agent (Claude Code, Codex, Gemini CLI, OpenCode) starts its MCP servers itself, as
//! child processes speaking JSON-RPC on stdio. Helios cannot be that child — the app is
//! already running — so the agent starts `helios.exe --mcp-bridge <port> <token>` instead: a
//! small bridge that answers the protocol and forwards each tool call over loopback TCP to the
//! running app, which runs it through the turn's [`ToolExecutor`] exactly like a native call.
//!
//! The token is minted per turn and routes a connection to that turn; it stops working the
//! moment the turn ends, so a lingering agent process cannot edit the project afterwards.

use crate::ai_tools::{self, ToolExecutor};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};

/// The first argument that turns the helios binary into a bridge.
pub const BRIDGE_FLAG: &str = "--mcp-bridge";

/// The server name agents see, and fold into tool names (`mcp__helios__add_text`).
pub const SERVER_NAME: &str = "helios";

const PROTOCOL_VERSIONS: &[&str] = &["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_PROTOCOL: &str = "2025-06-18";

/// Longer than the app's own per-call timeout, so the app's answer always wins the race.
/// Roto/depth/transcribe calls may run up to 900s.
const BRIDGE_READ_TIMEOUT: Duration = Duration::from_secs(950);

// ───────────────────────────── the protocol (pure) ─────────────────────────────

/// What the bridge does with one incoming line.
#[derive(Debug, PartialEq)]
pub enum Step {
    /// Write this JSON-RPC message back.
    Reply(Value),
    /// Forward a tool call to the app, then answer `id` with [`call_reply`].
    Call { id: Value, name: String, args: Value },
    /// A notification: nothing to say.
    Nothing,
}

fn error_reply(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn result_reply(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

/// The catalogue in MCP's shape.
pub fn tool_list() -> Value {
    let tools: Vec<Value> = ai_tools::specs()
        .iter()
        .map(|tool| json!({ "name": tool.name, "description": tool.description, "inputSchema": tool.input_schema }))
        .collect();
    json!({ "tools": tools })
}

/// Reads one line of JSON-RPC from the agent.
pub fn handle_line(line: &str) -> Step {
    let Ok(message) = serde_json::from_str::<Value>(line) else {
        return Step::Reply(error_reply(Value::Null, -32700, "Parse error"));
    };
    if !message.is_object() {
        return Step::Reply(error_reply(Value::Null, -32600, "Invalid Request"));
    }
    let method = message.get("method").and_then(Value::as_str);
    // Requests carry an id; notifications and responses to our (nonexistent) requests do not.
    let Some(id) = message.get("id").filter(|id| !id.is_null()).cloned() else {
        return Step::Nothing;
    };
    let Some(method) = method else {
        return Step::Nothing;
    };
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    match method {
        "initialize" => {
            let asked = params.get("protocolVersion").and_then(Value::as_str);
            let version = asked.filter(|version| PROTOCOL_VERSIONS.contains(version)).unwrap_or(DEFAULT_PROTOCOL);
            Step::Reply(result_reply(
                id,
                json!({
                    "protocolVersion": version,
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": SERVER_NAME, "version": env!("CARGO_PKG_VERSION") },
                }),
            ))
        }
        "ping" => Step::Reply(result_reply(id, json!({}))),
        "tools/list" => Step::Reply(result_reply(id, tool_list())),
        "tools/call" => {
            let Some(name) = params.get("name").and_then(Value::as_str) else {
                return Step::Reply(error_reply(id, -32602, "tools/call needs a tool name"));
            };
            if !ai_tools::is_known(name) {
                return Step::Reply(error_reply(id, -32602, &format!("Unknown tool: {name}")));
            }
            let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            Step::Call { id, name: name.to_owned(), args }
        }
        _ => Step::Reply(error_reply(id, -32601, "Method not found")),
    }
}

/// The `tools/call` answer for a Helios result: the result JSON as text, flagged as an error
/// when the edit did not happen so the agent reads it as a failure rather than a success.
pub fn call_reply(id: Value, result: &Value) -> Value {
    let mut text_result = result.clone();
    let omit_image_blocks = result.get("omitImageBlocks").and_then(Value::as_bool).unwrap_or(false)
        || result.get("textOnly").and_then(Value::as_bool).unwrap_or(false);
    let images = text_result.as_object_mut().and_then(|object| object.remove("images"));
    let mut content = vec![json!({ "type": "text", "text": text_result.to_string() })];
    if !omit_image_blocks {
        if let Some(Value::Array(images)) = images {
            for image in images.iter().filter_map(Value::as_str).take(6) {
                if let Some(data) = image.strip_prefix("data:image/jpeg;base64,") {
                    content.push(json!({ "type": "image", "mimeType": "image/jpeg", "data": data }));
                }
            }
        }
    }
    result_reply(
        id,
        json!({
            "content": content,
            "isError": !ai_tools::is_ok(result),
        }),
    )
}

// ───────────────────────────── the bridge process ─────────────────────────────

/// The bridge's line to the running app, opened on the first tool call.
struct AppLink {
    port: u16,
    token: String,
    connection: Option<(BufReader<std::net::TcpStream>, std::net::TcpStream)>,
    next_id: u64,
}

impl AppLink {
    fn connect(&mut self) -> Result<(), String> {
        let stream = std::net::TcpStream::connect(("127.0.0.1", self.port))
            .map_err(|error| format!("Helios is not reachable: {error}"))?;
        stream.set_read_timeout(Some(BRIDGE_READ_TIMEOUT)).map_err(|error| error.to_string())?;
        let mut writer = stream.try_clone().map_err(|error| error.to_string())?;
        let mut reader = BufReader::new(stream);
        writeln!(writer, "{}", json!({ "token": self.token })).map_err(|error| error.to_string())?;
        let mut answer = String::new();
        reader.read_line(&mut answer).map_err(|error| error.to_string())?;
        let answer: Value = serde_json::from_str(&answer).unwrap_or(Value::Null);
        if answer.get("ok").and_then(Value::as_bool) != Some(true) {
            return Err(answer
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("Helios refused the connection")
                .to_owned());
        }
        self.connection = Some((reader, writer));
        Ok(())
    }

    fn call(&mut self, name: &str, args: &Value) -> Value {
        if self.connection.is_none() {
            if let Err(reason) = self.connect() {
                return ai_tools::failure(reason);
            }
        }
        let Some((reader, writer)) = self.connection.as_mut() else {
            return ai_tools::failure("Helios is not connected");
        };
        self.next_id += 1;
        let id = self.next_id;
        let sent = writeln!(writer, "{}", json!({ "id": id, "name": name, "args": args }));
        let mut line = String::new();
        let read = sent.and_then(|()| reader.read_line(&mut line));
        match read {
            Ok(count) if count > 0 => serde_json::from_str::<Value>(&line)
                .ok()
                .and_then(|answer| answer.get("result").cloned())
                .unwrap_or_else(|| ai_tools::failure("Helios sent an unreadable answer")),
            _ => {
                // The app closed the line — the turn ended or Helios quit. A later call may
                // reconnect and be refused with the reason.
                self.connection = None;
                ai_tools::failure("Helios closed the connection; this chat turn is over")
            }
        }
    }
}

/// `helios --mcp-bridge <port> <token>`: serves MCP on stdio until the agent closes stdin.
/// Returns the process exit code. Only logs go to stderr — stdout is the protocol.
pub fn run_bridge(args: &[String]) -> i32 {
    let (Some(port), Some(token)) = (args.first().and_then(|port| port.parse::<u16>().ok()), args.get(1)) else {
        eprintln!("usage: helios {BRIDGE_FLAG} <port> <token>");
        return 2;
    };
    let mut link = AppLink { port, token: token.clone(), connection: None, next_id: 0 };
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else {
            break;
        };
        if line.trim().is_empty() {
            continue;
        }
        let reply = match handle_line(&line) {
            Step::Reply(reply) => reply,
            Step::Call { id, name, args } => call_reply(id, &link.call(&name, &args)),
            Step::Nothing => continue,
        };
        if writeln!(stdout, "{reply}").and_then(|()| stdout.flush()).is_err() {
            break;
        }
    }
    0
}

// ───────────────────────────── the app side ─────────────────────────────

/// A turn's route: its id (for logs) and the executor its calls run through.
struct Route {
    turn_id: String,
    executor: Arc<dyn ToolExecutor>,
}

/// The loopback listener bridges connect to, and the tokens that route them to turns.
pub struct McpHub {
    port: u16,
    routes: Mutex<HashMap<String, Route>>,
}

/// A registered turn. Dropping it retires the token, which is how a turn "ends" for bridges.
pub struct Registration {
    hub: Arc<McpHub>,
    token: String,
}

impl Registration {
    pub fn token(&self) -> &str {
        &self.token
    }
}

impl Drop for Registration {
    fn drop(&mut self) {
        if let Ok(mut routes) = self.hub.routes.lock() {
            routes.remove(&self.token);
        }
    }
}

impl McpHub {
    /// Binds `127.0.0.1` on a free port. Synchronous so app setup knows the port at once;
    /// [`McpHub::serve`] then runs on the async runtime.
    pub fn bind() -> std::io::Result<(Arc<Self>, std::net::TcpListener)> {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0))?;
        listener.set_nonblocking(true)?;
        let port = listener.local_addr()?.port();
        Ok((Arc::new(Self { port, routes: Mutex::new(HashMap::new()) }), listener))
    }

    pub const fn port(&self) -> u16 {
        self.port
    }

    /// Mints a token routing to `executor` for as long as the registration lives.
    pub fn register(self: &Arc<Self>, turn_id: &str, executor: Arc<dyn ToolExecutor>) -> Registration {
        let token = format!("{}{}", ulid::Ulid::new(), ulid::Ulid::new()).to_ascii_lowercase();
        if let Ok(mut routes) = self.routes.lock() {
            routes.insert(token.clone(), Route { turn_id: turn_id.to_owned(), executor });
        }
        Registration { hub: self.clone(), token }
    }

    fn executor_for(&self, token: &str) -> Option<(String, Arc<dyn ToolExecutor>)> {
        self.routes
            .lock()
            .ok()
            .and_then(|routes| routes.get(token).map(|route| (route.turn_id.clone(), route.executor.clone())))
    }

    /// Accepts bridge connections until the listener fails.
    pub async fn serve(self: Arc<Self>, listener: std::net::TcpListener) {
        let listener = match tokio::net::TcpListener::from_std(listener) {
            Ok(listener) => listener,
            Err(error) => {
                tracing::error!(%error, "the MCP bridge listener could not start");
                return;
            }
        };
        loop {
            match listener.accept().await {
                Ok((stream, _)) => {
                    tokio::spawn(self.clone().connection(stream));
                }
                Err(error) => {
                    // Accept failures are usually one bad connection; pausing keeps a broken
                    // listener from spinning the CPU instead of serving turns.
                    tracing::warn!(%error, "an MCP bridge connection failed");
                    tokio::time::sleep(Duration::from_millis(200)).await;
                }
            }
        }
    }

    /// One bridge: authenticate with the first line, then answer `{id, name, args}` requests
    /// with `{id, result}` for as long as the token stays registered.
    async fn connection(self: Arc<Self>, stream: tokio::net::TcpStream) {
        let (read, mut write) = stream.into_split();
        let mut lines = tokio::io::BufReader::new(read).lines();
        let Ok(Some(first)) = lines.next_line().await else {
            return;
        };
        let token = serde_json::from_str::<Value>(&first)
            .ok()
            .and_then(|hello| hello.get("token").and_then(Value::as_str).map(str::to_owned))
            .unwrap_or_default();
        let Some((turn_id, _)) = self.executor_for(&token) else {
            let refusal = json!({ "ok": false, "error": "Helios does not recognise this chat turn" });
            let _ignored = write.write_all(format!("{refusal}\n").as_bytes()).await;
            return;
        };
        if write.write_all(b"{\"ok\":true}\n").await.is_err() {
            return;
        }
        tracing::debug!(turn = %turn_id, "an MCP bridge connected");
        while let Ok(Some(line)) = lines.next_line().await {
            let request = serde_json::from_str::<Value>(&line).unwrap_or(Value::Null);
            let id = request.get("id").cloned().unwrap_or(Value::Null);
            let result = match (self.executor_for(&token), request.get("name").and_then(Value::as_str)) {
                (None, _) => ai_tools::failure("this chat turn has ended"),
                (Some(_), None) => ai_tools::failure("the request named no tool"),
                (Some((_, executor)), Some(name)) => {
                    let args = request.get("args").cloned().unwrap_or_else(|| json!({}));
                    ai_tools::run_call(executor.as_ref(), name, args).await
                }
            };
            let answer = json!({ "id": id, "result": result });
            if write.write_all(format!("{answer}\n").as_bytes()).await.is_err() {
                return;
            }
        }
    }
}

/// Binds a hub and serves it on the current runtime — for tests and the live check.
#[cfg(test)]
pub fn start_hub() -> Arc<McpHub> {
    let (hub, listener) = McpHub::bind().expect("loopback listener");
    tokio::spawn(hub.clone().serve(listener));
    hub
}

#[cfg(test)]
mod tests {
    use super::{call_reply, handle_line, start_hub, AppLink, Step};
    use crate::ai_tools::testing::FakeExecutor;
    use serde_json::json;
    use std::sync::Arc;

    fn reply(line: &str) -> serde_json::Value {
        match handle_line(line) {
            Step::Reply(reply) => reply,
            other => panic!("expected a reply, got {other:?}"),
        }
    }

    #[test]
    fn initialize_answers_a_supported_version_or_the_default() {
        let known = reply(r#"{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{}}}"#);
        assert_eq!(known["id"], 0);
        assert_eq!(known["result"]["protocolVersion"], "2025-11-25");
        assert_eq!(known["result"]["capabilities"], json!({"tools": {}}));
        assert_eq!(known["result"]["serverInfo"]["name"], "helios");
        let future = reply(r#"{"jsonrpc":"2.0","id":"a","method":"initialize","params":{"protocolVersion":"2031-01-01"}}"#);
        assert_eq!(future["result"]["protocolVersion"], "2025-06-18");
        assert_eq!(future["id"], "a");
    }

    #[test]
    fn notifications_get_no_answer_and_unknown_methods_get_32601() {
        assert_eq!(handle_line(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#), Step::Nothing);
        assert_eq!(handle_line(r#"{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":3}}"#), Step::Nothing);
        assert_eq!(reply(r#"{"jsonrpc":"2.0","id":7,"method":"ping"}"#)["result"], json!({}));
        assert_eq!(reply(r#"{"jsonrpc":"2.0","id":8,"method":"resources/list"}"#)["error"]["code"], -32601);
        assert_eq!(reply("not json")["error"]["code"], -32700);
    }

    #[test]
    fn tools_list_is_the_catalogue_with_mcp_schema_keys() {
        let listed = reply(r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#);
        let tools = listed["result"]["tools"].as_array().expect("tools");
        assert_eq!(tools.len(), crate::ai_tools::specs().len());
        let add_text = tools.iter().find(|tool| tool["name"] == "add_text").expect("add_text");
        assert_eq!(add_text["inputSchema"]["required"], json!(["text"]));
        assert!(add_text.get("input_schema").is_none());
    }

    #[test]
    fn a_tool_call_is_forwarded_and_its_result_becomes_text_content() {
        let step = handle_line(r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"add_text","arguments":{"text":"Goa"},"_meta":{"progressToken":2}}}"#);
        assert_eq!(step, Step::Call { id: json!(2), name: "add_text".to_owned(), args: json!({"text": "Goa"}) });
        let unknown = reply(r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"rm_rf"}}"#);
        assert_eq!(unknown["error"]["code"], -32602);

        let ok = call_reply(json!(2), &json!({"ok": true, "summary": "Added Goa"}));
        assert_eq!(ok["result"]["isError"], false);
        let text = ok["result"]["content"][0]["text"].as_str().expect("text");
        assert_eq!(serde_json::from_str::<serde_json::Value>(text).expect("json")["summary"], "Added Goa");
        assert_eq!(call_reply(json!(3), &json!({"ok": false, "error": "locked"}))["result"]["isError"], true);
    }

    #[test]
    fn frame_evidence_is_image_content_not_a_base64_text_dump() {
        let reply = call_reply(json!(1), &json!({"ok":true,"times":[1.0],"images":["data:image/jpeg;base64,YWJj"]}));
        assert_eq!(reply["result"]["content"][1]["type"], "image");
        assert_eq!(reply["result"]["content"][1]["data"], "YWJj");
        assert!(!reply["result"]["content"][0]["text"].as_str().unwrap().contains("YWJj"));
    }

    #[test]
    fn text_only_omits_image_blocks() {
        let reply = call_reply(json!(1), &json!({"ok":true,"times":[1.0],"textOnly":true,"images":["data:image/jpeg;base64,YWJj"]}));
        assert_eq!(reply["result"]["content"].as_array().unwrap().len(), 1);
        assert_eq!(reply["result"]["content"][0]["type"], "text");
    }

    /// The whole app side over real loopback: a registered token reaches its turn's executor,
    /// an unknown one is refused, and a retired one stops working.
    #[tokio::test(flavor = "multi_thread")]
    async fn tokens_route_bridges_to_their_turn_and_die_with_it() {
        let hub = start_hub();
        let executor = Arc::new(FakeExecutor::new(|name, _| json!({"ok": true, "summary": format!("ran {name}")})));
        let registration = hub.register("turn-9", executor.clone());
        let port = hub.port();
        let token = registration.token().to_owned();

        let (first, refused) = tokio::task::spawn_blocking(move || {
            let mut link = AppLink { port, token, connection: None, next_id: 0 };
            let first = link.call("set_playhead", &json!({"time": 3}));
            let mut stranger = AppLink { port, token: "nope".to_owned(), connection: None, next_id: 0 };
            (first, stranger.call("undo", &json!({})))
        })
        .await
        .expect("bridge thread");
        assert_eq!(first, json!({"ok": true, "summary": "ran set_playhead"}));
        assert_eq!(refused["ok"], false);
        assert!(refused["error"].as_str().is_some_and(|error| error.contains("does not recognise")), "{refused}");
        assert_eq!(executor.names(), vec!["set_playhead"]);

        let token = registration.token().to_owned();
        let mut link = tokio::task::spawn_blocking(move || {
            let mut link = AppLink { port, token, connection: None, next_id: 0 };
            assert_eq!(link.call("undo", &json!({}))["ok"], true);
            link
        })
        .await
        .expect("bridge thread");
        drop(registration);
        let after = tokio::task::spawn_blocking(move || link.call("undo", &json!({}))).await.expect("bridge thread");
        assert_eq!(after, json!({"ok": false, "error": "this chat turn has ended"}));
        assert_eq!(executor.names(), vec!["set_playhead", "undo"]);
    }
}
