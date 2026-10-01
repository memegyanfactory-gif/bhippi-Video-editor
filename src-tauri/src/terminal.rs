//! A persistent native PTY: ConPTY on Windows, a real tty on Unix. Only the editor window
//! owns it; plugin frames and auxiliary windows cannot open or write the user's shell.
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, State, Webview};

const EVENT: &str = "bhippi://terminal";
struct Session {
    id: String,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}
impl Drop for Session {
    fn drop(&mut self) { let _ = self.killer.kill(); }
}
#[derive(Clone, Default)]
pub struct TerminalState(Arc<Mutex<Option<Session>>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Output { session_id: String, data: Vec<u8>, exit_code: Option<u32>, error: Option<String> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened { session_id: String, shell: String, cwd: String }

// The commands take the calling webview, never a `WebviewWindow`: with project tabs the window
// holds several webviews and Tauri refuses a `WebviewWindow` argument there.
fn editor(window: &Webview) -> Result<(), String> {
    if crate::tabs::is_editor(window.label()) { Ok(()) } else { Err("The terminal belongs to an editor window".into()) }
}
fn size(cols: u16, rows: u16) -> PtySize { PtySize { cols: cols.clamp(2, 500), rows: rows.clamp(2, 200), pixel_width: 0, pixel_height: 0 } }

fn spawn(state: TerminalState, cwd: Option<String>, cols: u16, rows: u16, emit: impl Fn(Output) + Send + Sync + 'static) -> Result<Opened, String> {
    let cwd = cwd.map(std::path::PathBuf::from).unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(".")));
    if !cwd.is_dir() { return Err(format!("Working directory is not a folder: {}", cwd.display())); }
    let mut held = state.0.lock().map_err(|e| e.to_string())?;
    // Opening twice never leaves an orphaned shell. The frontend listens before starting it.
    held.take();
    let pair = native_pty_system().openpty(size(cols, rows)).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    let shells = ["pwsh.exe", "powershell.exe", "cmd.exe"];
    #[cfg(not(windows))]
    let shells = ["bash", "sh"];
    let mut spawned = None;
    let mut last_error = String::new();
    for shell in shells {
        let mut command = CommandBuilder::new(shell);
        command.cwd(&cwd);
        command.env("TERM", "xterm-256color");
        #[cfg(windows)]
        if shell != "cmd.exe" { command.args(["-NoLogo", "-NoProfile"]); }
        #[cfg(not(windows))]
        command.arg("-i");
        match pair.slave.spawn_command(command) {
            Ok(child) => { spawned = Some((shell.to_string(), child)); break; }
            Err(error) => last_error = error.to_string(),
        }
    }
    let (shell, mut child) = spawned.ok_or_else(|| format!("Could not start a shell: {last_error}"))?;
    drop(pair.slave);
    let reader = pair.master.try_clone_reader().map_err(|e| { let _ = child.kill(); e.to_string() })?;
    let writer = pair.master.take_writer().map_err(|e| { let _ = child.kill(); e.to_string() })?;
    let id = ulid::Ulid::new().to_string();
    *held = Some(Session { id: id.clone(), master: pair.master, writer, killer: child.clone_killer() });
    drop(held);
    let session_id = id.clone();
    let emit = Arc::new(emit);
    let output = emit.clone();
    let output_id = session_id.clone();
    let mut reader_killer = child.clone_killer();
    let reader_task = std::thread::spawn(move || {
        let mut reader = reader;
        let mut buffer = [0u8; 8192];
        let mut failure = None;
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => output(Output { session_id: output_id.clone(), data: buffer[..count].to_vec(), exit_code: None, error: None }),
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(error) => { failure = Some(error.to_string()); break; }
            }
        }
        // A failed read must not leave wait() blocked on a live shell.
        if failure.is_some() { let _ = reader_killer.kill(); }
        failure
    });
    std::thread::spawn(move || {
        let status = child.wait();
        let exit_code = status.as_ref().ok().map(|status| status.exit_code());
        // ConPTY can leave its read pipe open after the shell exits. Closing the master while
        // the output reader is draining prevents a deadlock and flushes its final bytes.
        if let Ok(mut held) = state.0.lock() {
            if held.as_ref().is_some_and(|session| session.id == session_id) { held.take(); }
        }
        let failure = reader_task.join().ok().flatten();
        let error = failure.or_else(|| status.err().map(|error| error.to_string()));
        emit(Output { session_id, data: Vec::new(), exit_code, error });
    });
    Ok(Opened { session_id: id, shell, cwd: cwd.to_string_lossy().into_owned() })
}

#[tauri::command]
pub async fn terminal_open(window: Webview, state: State<'_, TerminalState>, cwd: Option<String>, cols: u16, rows: u16) -> Result<Opened, String> {
    editor(&window)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || spawn(state, cwd, cols, rows, move |event| { let _ = window.emit_to(tauri::EventTarget::webview(window.label()), EVENT, event); })).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn terminal_write(window: Webview, state: State<'_, TerminalState>, session_id: String, data: String) -> Result<(), String> {
    editor(&window)?;
    if data.len() > 1024 * 1024 { return Err("Terminal input is too large".into()); }
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut held = state.0.lock().map_err(|e| e.to_string())?;
        let session = held.as_mut().filter(|s| s.id == session_id).ok_or("Terminal session has ended")?;
        session.writer.write_all(data.as_bytes()).and_then(|_| session.writer.flush()).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn terminal_resize(window: Webview, state: State<'_, TerminalState>, session_id: String, cols: u16, rows: u16) -> Result<(), String> {
    editor(&window)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let held = state.0.lock().map_err(|e| e.to_string())?;
        let session = held.as_ref().filter(|s| s.id == session_id).ok_or("Terminal session has ended")?;
        session.master.resize(size(cols, rows)).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn terminal_close(window: Webview, state: State<'_, TerminalState>, session_id: String) -> Result<(), String> {
    editor(&window)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut held = state.0.lock().map_err(|e| e.to_string())?;
        if held.as_ref().is_some_and(|s| s.id == session_id) { held.take(); }
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn native_shell_streams_output_errors_and_exit_and_resizes() {
        let state = TerminalState::default();
        let (tx, rx) = std::sync::mpsc::channel();
        let opened = spawn(state.clone(), None, 80, 24, move |event| { let _ = tx.send(event); }).expect("open native shell");
        {
            let mut held = state.0.lock().expect("session");
            let session = held.as_mut().expect("running");
            session.master.resize(size(100, 30)).expect("resize");
            let dimensions = session.master.get_size().expect("size");
            assert_eq!((dimensions.cols, dimensions.rows), (100, 30));
        }
        let mut bytes = Vec::new();
        let mut sent = false;
        loop {
            let event = rx.recv_timeout(std::time::Duration::from_secs(20)).unwrap_or_else(|error| panic!("{error}: {}", String::from_utf8_lossy(&bytes)));
            assert_eq!(event.session_id, opened.session_id);
            bytes.extend(event.data);
            let output = String::from_utf8_lossy(&bytes);
            let mut held = state.0.lock().expect("session");
            if let Some(session) = held.as_mut() {
                // PowerShell asks the terminal for its cursor position before accepting input.
                if output.ends_with("\u{1b}[6n") { session.writer.write_all(b"\x1b[1;1R").expect("cursor report"); session.writer.flush().unwrap(); }
                if !sent && output.contains(">") {
                    session.writer.write_all(b"Write-Output ('PTY' + '_OUTPUT_OK'); Write-Error ('PTY' + '_ERROR_OK'); exit 7\r").expect("input");
                    session.writer.flush().expect("flush");
                    sent = true;
                }
            }
            drop(held);
            if let Some(code) = event.exit_code { assert_eq!(code, 7); break; }
            assert!(event.error.is_none(), "{:?}", event.error);
        }
        let output = String::from_utf8_lossy(&bytes);
        assert!(output.contains("PTY_OUTPUT_OK"), "{output}");
        assert!(output.contains("PTY_ERROR_OK"), "{output}");
        assert!(state.0.lock().expect("session").is_none());
    }
}
