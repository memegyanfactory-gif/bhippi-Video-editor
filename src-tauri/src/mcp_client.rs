//! Helios as an MCP *client*: connecting out to other people's servers.
//!
//! `mcp.rs` is the other direction — Helios serving its own tools to CLI agents. This module lets
//! the chat reach anything with an MCP server: a stdio process it starts, or an HTTP endpoint.
//! A server's tools join the catalogue the assistant may call, under `mcp__<server>__<tool>` so
//! they can never collide with Helios' own.
//!
//! A server that fails stays in the list, marked failed with the reason. Dropping it silently
//! would leave the assistant being told it has tools that are not there.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const PREFIX: &str = "mcp__";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    /// Short, stable, `[a-z0-9-]`: it becomes part of every tool name.
    pub id: String,
    pub label: String,
    /// `stdio` (a process Helios starts) or `http`.
    pub transport: String,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default = "yes")]
    pub enabled: bool,
}

fn yes() -> bool {
    true
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tool {
    /// The name the assistant calls: `mcp__<server>__<tool>`.
    pub name: String,
    /// The name on the server itself.
    pub remote: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub id: String,
    pub label: String,
    /// `ready` · `connecting` · `failed`
    pub state: String,
    /// What it is, or why it failed.
    pub detail: String,
    pub tools: Vec<Tool>,
}

/// A live stdio server: the child process and the pipes to talk to it.
struct Session {
    child: Child,
    next_id: u64,
}

#[derive(Default)]
pub struct Hub {
    sessions: Mutex<HashMap<String, Session>>,
    known: Mutex<HashMap<String, Status>>,
}

fn clean_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// One JSON-RPC exchange over a child's stdin/stdout, with a ceiling on how long we wait.
fn rpc(session: &mut Session, method: &str, params: serde_json::Value, wait: Duration) -> Result<serde_json::Value, String> {
    session.next_id += 1;
    let id = session.next_id;
    let request = serde_json::json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
    let line = format!("{request}\n");

    let stdin = session.child.stdin.as_mut().ok_or("that server closed its input")?;
    stdin.write_all(line.as_bytes()).map_err(|error| format!("could not write to the server: {error}"))?;
    stdin.flush().map_err(|error| format!("could not write to the server: {error}"))?;

    let stdout = session.child.stdout.as_mut().ok_or("that server closed its output")?;
    let mut reader = BufReader::new(stdout);
    let deadline = Instant::now() + wait;
    // Servers are entitled to send notifications; keep reading until the answer to `id` arrives.
    loop {
        if Instant::now() > deadline {
            return Err(format!("the server did not answer {method} in {}s", wait.as_secs()));
        }
        let mut line = String::new();
        let read = reader.read_line(&mut line).map_err(|error| format!("could not read from the server: {error}"))?;
        if read == 0 {
            return Err("the server stopped".to_owned());
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line.trim()) else {
            continue;
        };
        if value.get("id").and_then(serde_json::Value::as_u64) != Some(id) {
            continue;
        }
        if let Some(error) = value.get("error") {
            let message = error.get("message").and_then(serde_json::Value::as_str).unwrap_or("the server refused");
            return Err(message.to_owned());
        }
        return Ok(value.get("result").cloned().unwrap_or(serde_json::Value::Null));
    }
}

impl Hub {
    /// Starts a server and asks what it can do. Replaces any session already running for it.
    pub fn connect(&self, server: &Server) -> Status {
        let mut status = Status {
            id: server.id.clone(),
            label: server.label.clone(),
            state: "failed".to_owned(),
            detail: String::new(),
            tools: Vec::new(),
        };
        if !clean_id(&server.id) {
            status.detail = "the id may only be lower-case letters, digits and dashes".to_owned();
            return status;
        }
        if server.transport != "stdio" {
            // HTTP servers are next; saying so is better than pretending to connect.
            status.detail = "only stdio servers are supported so far".to_owned();
            return status;
        }
        let Some(command) = server.command.as_deref().filter(|value| !value.trim().is_empty()) else {
            status.detail = "no command to run".to_owned();
            return status;
        };

        self.disconnect(&server.id);
        let mut builder = Command::new(command);
        builder
            .args(&server.args)
            .envs(&server.env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            builder.creation_flags(0x0800_0000);
        }
        let child = match builder.spawn() {
            Ok(child) => child,
            Err(error) => {
                status.detail = format!("could not start {command}: {error}");
                self.remember(&status);
                return status;
            }
        };
        let mut session = Session { child, next_id: 0 };

        let hello = serde_json::json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": { "name": "helios", "version": env!("CARGO_PKG_VERSION") },
        });
        if let Err(error) = rpc(&mut session, "initialize", hello, Duration::from_secs(20)) {
            status.detail = error;
            let _ignored = session.child.kill();
            self.remember(&status);
            return status;
        }
        // The handshake is not complete until the client says it is ready.
        if let Some(stdin) = session.child.stdin.as_mut() {
            let note = serde_json::json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
            let _ignored = stdin.write_all(format!("{note}\n").as_bytes());
            let _ignored = stdin.flush();
        }

        match rpc(&mut session, "tools/list", serde_json::json!({}), Duration::from_secs(20)) {
            Ok(result) => {
                let listed = result.get("tools").and_then(serde_json::Value::as_array).cloned().unwrap_or_default();
                status.tools = listed
                    .iter()
                    .filter_map(|tool| {
                        let remote = tool.get("name").and_then(serde_json::Value::as_str)?.to_owned();
                        Some(Tool {
                            name: format!("{PREFIX}{}__{remote}", server.id),
                            remote,
                            description: tool.get("description").and_then(serde_json::Value::as_str).unwrap_or_default().to_owned(),
                            input_schema: tool
                                .get("inputSchema")
                                .cloned()
                                .unwrap_or_else(|| serde_json::json!({ "type": "object" })),
                        })
                    })
                    .collect();
                status.state = "ready".to_owned();
                status.detail = if server.transport == "stdio" { "stdio".to_owned() } else { server.transport.clone() };
            }
            Err(error) => {
                status.detail = error;
                let _ignored = session.child.kill();
                self.remember(&status);
                return status;
            }
        }

        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.insert(server.id.clone(), session);
        }
        self.remember(&status);
        status
    }

    fn remember(&self, status: &Status) {
        if let Ok(mut known) = self.known.lock() {
            known.insert(status.id.clone(), status.clone());
        }
    }

    pub fn disconnect(&self, id: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            if let Some(mut session) = sessions.remove(id) {
                let _ignored = session.child.kill();
            }
        }
        if let Ok(mut known) = self.known.lock() {
            known.remove(id);
        }
    }

    /// Everything connected in this run, for the chat's connection list.
    pub fn statuses(&self) -> Vec<Status> {
        self.known.lock().map(|known| known.values().cloned().collect()).unwrap_or_default()
    }

    /// Every tool the assistant may call, across all connected servers.
    pub fn tools(&self) -> Vec<Tool> {
        self.known
            .lock()
            .map(|known| known.values().filter(|status| status.state == "ready").flat_map(|status| status.tools.clone()).collect())
            .unwrap_or_default()
    }

    /// Calls `mcp__<server>__<tool>` on the server it belongs to.
    pub fn call(&self, name: &str, arguments: serde_json::Value) -> Result<serde_json::Value, String> {
        let rest = name.strip_prefix(PREFIX).ok_or("that is not an MCP tool")?;
        let (server, tool) = rest.split_once("__").ok_or("that tool name has no server in it")?;
        let mut sessions = self.sessions.lock().map_err(|_| "the MCP hub is busy".to_owned())?;
        let session = sessions.get_mut(server).ok_or_else(|| format!("{server} is not connected"))?;
        let params = serde_json::json!({ "name": tool, "arguments": arguments });
        rpc(session, "tools/call", params, Duration::from_secs(120))
    }
}

pub fn hub() -> Arc<Hub> {
    Arc::new(Hub::default())
}

#[cfg(test)]
mod tests {
    use super::{clean_id, Hub, Server, PREFIX};
    use std::collections::HashMap;

    fn server(id: &str, command: &str, args: &[&str]) -> Server {
        Server {
            id: id.to_owned(),
            label: id.to_owned(),
            transport: "stdio".to_owned(),
            command: Some(command.to_owned()),
            args: args.iter().map(|value| (*value).to_owned()).collect(),
            env: HashMap::new(),
            url: None,
            headers: HashMap::new(),
            enabled: true,
        }
    }

    #[test]
    fn ids_become_tool_names_so_they_are_checked() {
        assert!(clean_id("filesystem"));
        assert!(clean_id("my-server-2"));
        assert!(!clean_id("Bad Name"));
        assert!(!clean_id(""));
        assert!(!clean_id("a".repeat(41).as_str()));
    }

    #[test]
    fn a_server_that_cannot_start_is_reported_not_hidden() {
        let hub = Hub::default();
        let status = hub.connect(&server("nope", "definitely-not-a-real-program-xyz", &[]));
        assert_eq!(status.state, "failed");
        assert!(!status.detail.is_empty());
        // It stays in the list so the chat can show it as failed.
        assert_eq!(hub.statuses().len(), 1);
        assert!(hub.tools().is_empty());
    }

    /// The real handshake, against Helios' own MCP bridge — the one server always to hand.
    #[test]
    fn helios_own_bridge_answers_the_handshake() {
        let Ok(exe) = std::env::current_exe() else {
            eprintln!("no test binary path; skipping");
            return;
        };
        // The bridge lives in the app binary, beside the test binary in target/debug.
        let app = exe.parent().and_then(|dir| dir.parent()).map(|dir| dir.join(if cfg!(windows) { "helios.exe" } else { "helios" }));
        let Some(app) = app.filter(|path| path.is_file()) else {
            eprintln!("helios binary not built; skipping");
            return;
        };
        let hub = Hub::default();
        // A bridge with no hub to reach still answers initialize and tools/list.
        let status = hub.connect(&server("helios-self", &app.display().to_string(), &["--mcp-bridge", "0", "none"]));
        if status.state != "ready" {
            eprintln!("bridge said: {}; skipping", status.detail);
            return;
        }
        assert!(!status.tools.is_empty(), "the bridge should list Helios' tools");
        for tool in &status.tools {
            assert!(tool.name.starts_with(PREFIX), "{} should be namespaced", tool.name);
            assert!(tool.name.contains("helios-self__"));
        }
        assert_eq!(hub.tools().len(), status.tools.len());
        hub.disconnect("helios-self");
        assert!(hub.tools().is_empty());
    }
}
