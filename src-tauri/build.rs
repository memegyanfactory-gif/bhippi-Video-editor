fn main() {
    // `tauri::generate_context!` embeds ../dist at compile time; rebuild when the UI changes so
    // F5 never launches a window showing a stale interface.
    println!("cargo:rerun-if-changed=../dist");
    println!("cargo:rerun-if-changed=prompts");
    tauri_build::build();
}
