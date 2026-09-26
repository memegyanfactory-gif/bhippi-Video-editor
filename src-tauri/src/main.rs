// Release builds are a windowed app with no console; debug builds keep the console for logs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    std::panic::set_hook(Box::new(|info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown".to_string());
        let payload = if let Some(s) = info.payload().downcast_ref::<&str>() {
            *s
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.as_str()
        } else {
            "unknown panic payload"
        };
        eprintln!("[FATAL PANIC] at {location}: {payload}");
        if let Ok(appdata) = std::env::var("APPDATA") {
            let dir = std::path::PathBuf::from(appdata).join("com.bhippi.videoeditor");
            let _ = std::fs::create_dir_all(&dir);
            let log_path = dir.join("crash.log");
            let backtrace = std::backtrace::Backtrace::force_capture();
            let msg = format!(
                "Time: {}\nLocation: {}\nPayload: {}\nBacktrace:\n{:?}\n\n",
                chrono::Utc::now(),
                location,
                payload,
                backtrace
            );
            let _ = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(log_path)
                .and_then(|mut f| std::io::Write::write_all(&mut f, msg.as_bytes()));
        }
    }));

    // A CLI agent starts this binary as Bhippi's MCP server. That must be decided before
    // `run()`: the single-instance plugin would otherwise forward the call to the running app
    // and exit, and the agent would be left talking to nobody.
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some(bhippi_lib::MCP_BRIDGE_FLAG) {
        std::process::exit(bhippi_lib::run_mcp_bridge(&args[1..]));
    }
    // Speech synthesis runs native code in a child copy of this program, so a crash there never
    // takes the editor with it. See `kokoro.rs`.
    if args.first().map(String::as_str) == Some(bhippi_lib::KOKORO_WORKER_FLAG) {
        std::process::exit(bhippi_lib::run_kokoro_worker());
    }
    bhippi_lib::run();
}
