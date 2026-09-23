fn main() {
    // `tauri::generate_context!` embeds ../dist at compile time; rebuild when the UI changes so
    // F5 never launches a window showing a stale interface.
    println!("cargo:rerun-if-changed=../dist");
    println!("cargo:rerun-if-changed=prompts");
    // tauri-build compiles icons/icon.ico into the exe (resource 32512: Explorer, shortcuts, the
    // installer) but emits no rerun line for it, and the explicit lines above switch off cargo's
    // "any file changed" default — so a regenerated icon would otherwise keep the old exe icon.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::build();
}
