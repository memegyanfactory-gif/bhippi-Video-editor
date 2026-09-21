// Release builds are a windowed app with no console; debug builds keep the console for logs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // A CLI agent starts this binary as Helios' MCP server. That must be decided before
    // `run()`: the single-instance plugin would otherwise forward the call to the running app
    // and exit, and the agent would be left talking to nobody.
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some(helios_lib::MCP_BRIDGE_FLAG) {
        std::process::exit(helios_lib::run_mcp_bridge(&args[1..]));
    }
    helios_lib::run();
}
