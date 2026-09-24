//! Headless Blender (docs/REFERENCE-FILMS-PLAN.md §5, A6): the AI describes a small 3D scene —
//! objects with material presets, studio or gradient light, a keyed camera — and the user's own
//! Blender renders it in the background to a PNG sequence with alpha, which the motion engine
//! composites as `source.sequence` footage. Blender runs as a separate program with
//! `workers/blender_bridge.py` (GPL, like everything that imports bpy); Helios never links it.
//!
//! Output folder (the project's `3D renders/<name> <job>`): `00001.png …`, `camera.json` (the
//! camera per frame in motion-engine pixels, so 2D layers can ride the same move), `objects2d.json`
//! (each object's screen box per frame, for glints and callouts) and `result.json`.

use crate::{local_media, storage, store, AppState};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

type CommandResult<T> = Result<T, String>;

const ENGINES: [&str; 2] = ["eevee", "cycles"];
const KINDS: [&str; 11] = ["box", "rounded-box", "sphere", "icosphere", "torus", "cylinder", "cone", "capsule", "crystal", "text", "floor"];
const MATERIALS: [&str; 9] = ["plastic", "glass", "frosted", "pearl", "metal", "gem", "clay", "emission", "flat"];

/// `blender(.exe)` in a Blender install folder.
fn exe_name() -> &'static str {
    if cfg!(windows) { "blender.exe" } else { "blender" }
}

/// "Blender 5.2" → (5, 2); anything else sorts first.
fn folder_version(name: &str) -> (u32, u32) {
    let digits = name.trim_start_matches(|c: char| !c.is_ascii_digit());
    let mut parts = digits.split('.').map(|part| part.chars().take_while(char::is_ascii_digit).collect::<String>().parse().unwrap_or(0));
    (parts.next().unwrap_or(0), parts.next().unwrap_or(0))
}

/// The newest `Blender X.Y/blender.exe` under a `Blender Foundation` folder.
fn newest_install(foundation: &Path) -> Option<PathBuf> {
    let mut installs: Vec<(u32, u32, PathBuf)> = std::fs::read_dir(foundation)
        .ok()?
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let exe = entry.path().join(exe_name());
            exe.is_file().then(|| {
                let (major, minor) = folder_version(&name);
                (major, minor, exe)
            })
        })
        .collect();
    installs.sort();
    installs.pop().map(|(_, _, exe)| exe)
}

/// Where Blender is: the setting, `$BLENDER`, PATH, then the usual install folders (the newest
/// version wins). `None` when this machine has no Blender.
pub fn find_blender(setting: Option<&str>) -> Option<PathBuf> {
    if let Some(path) = setting.map(str::trim).filter(|path| !path.is_empty()).map(PathBuf::from) {
        return path.is_file().then_some(path);
    }
    if let Some(path) = std::env::var_os("BLENDER").map(PathBuf::from).filter(|path| path.is_file()) {
        return Some(path);
    }
    if let Some(paths) = std::env::var_os("PATH") {
        if let Some(found) = std::env::split_paths(&paths).map(|dir| dir.join(exe_name())).find(|path| path.is_file()) {
            return Some(found);
        }
    }
    let mut roots: Vec<PathBuf> = Vec::new();
    if cfg!(windows) {
        for var in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
            if let Some(dir) = std::env::var_os(var) {
                roots.push(PathBuf::from(dir).join("Blender Foundation"));
            }
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            roots.push(PathBuf::from(local).join("Programs").join("Blender Foundation"));
        }
        roots.push(PathBuf::from(r"C:\Program Files\Blender Foundation"));
        if let Some(found) = roots.iter().find_map(|root| newest_install(root)) {
            return Some(found);
        }
        // Steam installs Blender as a plain folder.
        return [r"C:\Program Files (x86)\Steam\steamapps\common\Blender\blender.exe"].into_iter().map(PathBuf::from).find(|path| path.is_file());
    }
    ["/Applications/Blender.app/Contents/MacOS/Blender", "/usr/bin/blender", "/usr/local/bin/blender", "/snap/bin/blender", "/var/lib/flatpak/exports/bin/org.blender.Blender"]
        .into_iter()
        .map(PathBuf::from)
        .find(|path| path.is_file())
}

fn number(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(Value::as_f64).filter(|n| n.is_finite())
}

/// The scene the AI asked for, checked and filled with defaults; `out` is set by the caller.
/// Returns (request, frame count that will render).
pub fn check_request(mut request: Value) -> Result<(Value, usize), String> {
    let object = request.as_object_mut().ok_or("The 3D scene must be an object")?;
    let width = object.get("width").and_then(Value::as_f64).unwrap_or(1920.0).round();
    let height = object.get("height").and_then(Value::as_f64).unwrap_or(1080.0).round();
    if !(16.0..=4096.0).contains(&width) || !(16.0..=4096.0).contains(&height) {
        return Err("width and height must be 16–4096 px".into());
    }
    let fps = object.get("fps").and_then(Value::as_f64).unwrap_or(30.0).round();
    if !(1.0..=120.0).contains(&fps) {
        return Err("fps must be 1–120".into());
    }
    let duration = object.get("duration").and_then(Value::as_f64).unwrap_or(3.0);
    if !(duration.is_finite() && duration > 0.0 && duration <= 60.0) {
        return Err("duration must be above 0 and at most 60 seconds".into());
    }
    let engine = object.get("engine").and_then(Value::as_str).unwrap_or("eevee").to_ascii_lowercase();
    if !ENGINES.contains(&engine.as_str()) {
        return Err("engine must be eevee (fast draft) or cycles (final, GPU path tracing)".into());
    }
    let samples = object.get("samples").and_then(Value::as_f64).unwrap_or(if engine == "cycles" { 32.0 } else { 32.0 }).round();
    if !(1.0..=4096.0).contains(&samples) {
        return Err("samples must be 1–4096".into());
    }
    let step = object.get("step").and_then(Value::as_f64).unwrap_or(1.0).round().max(1.0);
    let total = (duration * fps).round().max(1.0) as usize;
    let frames = match object.get("frames") {
        Some(Value::Array(list)) => {
            let picked: Vec<u64> = list.iter().filter_map(Value::as_u64).filter(|f| *f >= 1 && *f as usize <= total).collect();
            if picked.len() != list.len() || picked.is_empty() {
                return Err(format!("frames must be frame numbers 1–{total}"));
            }
            picked.len().div_ceil(step as usize)
        }
        Some(Value::Null) | None => total.div_ceil(step as usize),
        Some(_) => return Err("frames must be a list of frame numbers".into()),
    };
    let objects = object.get("objects").and_then(Value::as_array).ok_or("objects must list at least one object")?;
    if objects.is_empty() || objects.len() > 64 {
        return Err("A 3D scene has 1–64 objects".into());
    }
    let mut ids = std::collections::HashSet::new();
    for item in objects {
        let id = item.get("id").and_then(Value::as_str).filter(|id| !id.is_empty() && id.len() <= 48).ok_or("Every object needs an id")?;
        if !ids.insert(id.to_owned()) || id.starts_with("cam") {
            return Err(format!("Object id \"{id}\" is repeated or reserved"));
        }
        let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
        if !KINDS.contains(&kind) {
            return Err(format!("Object \"{id}\": kind must be one of {}", KINDS.join(", ")));
        }
        if let Some(preset) = item.pointer("/material/preset").and_then(Value::as_str) {
            if !MATERIALS.contains(&preset) {
                return Err(format!("Object \"{id}\": material preset must be one of {}", MATERIALS.join(", ")));
            }
        }
        if let Some(parent) = item.get("parent").and_then(Value::as_str) {
            if !ids.contains(parent) || parent == id {
                return Err(format!("Object \"{id}\": parent must be an object listed before it"));
            }
        }
        if kind == "text" && item.get("text").and_then(Value::as_str).is_some_and(|text| text.chars().count() > 80) {
            return Err(format!("Object \"{id}\": 3D text is at most 80 characters"));
        }
    }
    if let Some(lens) = object.get("camera").and_then(|camera| number(camera, "lens")) {
        if !(8.0..=300.0).contains(&lens) {
            return Err("camera.lens must be 8–300 mm".into());
        }
    }
    object.insert("width".into(), json!(width as u32));
    object.insert("height".into(), json!(height as u32));
    object.insert("fps".into(), json!(fps as u32));
    object.insert("duration".into(), json!(duration));
    object.insert("engine".into(), json!(engine));
    object.insert("samples".into(), json!(samples as u32));
    object.insert("step".into(), json!(step as u32));
    Ok((request, frames))
}

/// A generous ceiling for the render: measured 3.5 s per 1080p Cycles frame at 64 samples on an
/// RTX 3080 (0.7 s EEVEE), scaled by pixels and samples, times ten for slower GPUs, plus start-up.
pub fn timeout_for(request: &Value, frames: usize) -> std::time::Duration {
    let pixels = number(request, "width").unwrap_or(1920.0) * number(request, "height").unwrap_or(1080.0) / (1920.0 * 1080.0);
    let samples = number(request, "samples").unwrap_or(32.0);
    let per_frame = if request["engine"] == "cycles" { 3.5 * (samples / 64.0).max(0.25) } else { 0.7 * (samples / 32.0).max(0.25) };
    let seconds = 120.0 + frames as f64 * per_frame * pixels.max(0.1) * 10.0;
    std::time::Duration::from_secs_f64(seconds.min(6.0 * 3600.0))
}

/// Where Blender is and which version, for Settings and the AI's "can I render 3D" check.
#[tauri::command]
pub async fn blender_status(state: State<'_, Arc<AppState>>) -> CommandResult<Value> {
    let Some(path) = find_blender(state.settings().blender_path.as_deref()) else {
        return Ok(json!({ "found": false, "hint": "Install Blender 4.2 or newer (blender.org, free) or set its path in Settings." }));
    };
    let mut command = tokio::process::Command::new(&path);
    command.args(["-b", "--factory-startup", "-v"]).stdin(std::process::Stdio::null()).kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let version = tokio::time::timeout(std::time::Duration::from_secs(30), command.output())
        .await
        .ok()
        .and_then(Result::ok)
        .and_then(|out| String::from_utf8_lossy(&out.stdout).lines().find(|line| line.starts_with("Blender ")).map(|line| line.trim().to_owned()));
    Ok(json!({ "found": true, "path": path, "version": version }))
}

/// Renders a 3D scene in headless Blender as a background job. The job's result names the PNG
/// sequence (`dir`, `frames`, `fps`, …) and the camera / object tracks beside it.
#[tauri::command]
pub async fn blender_render_start(app: AppHandle, state: State<'_, Arc<AppState>>, request: Value, name: Option<String>) -> CommandResult<String> {
    let blender = find_blender(state.settings().blender_path.as_deref()).ok_or("Blender was not found. Install Blender 4.2+ from blender.org (free) or set its path in Settings › Local media.")?;
    let (mut request, frames) = check_request(request)?;
    let timeout = timeout_for(&request, frames);
    let lease = local_media::acquire()?;
    let label = storage::readable_name(name.as_deref().unwrap_or("3D scene"), 40, "3D scene");
    let job = state.jobs.start("generation", format!("Rendering 3D · {label}"), true);
    let id = job.id().to_owned();
    let work = state.paths.work.join(&id);
    let folder = storage::dir(&state, storage::Category::ThreeD)?.join(format!("{label} {id}"));
    std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let _ignored = app.asset_protocol_scope().allow_directory(&folder, false);
    let worker = work.join("blender_bridge.py");
    std::fs::write(&worker, include_str!("../workers/blender_bridge.py")).map_err(|e| e.to_string())?;
    request["out"] = json!(folder);
    let input = work.join("request.json");
    store::write_json(&input, &request)?;
    let (width, height, fps) = (request["width"].clone(), request["height"].clone(), request["fps"].clone());
    tauri::async_runtime::spawn(async move {
        let _lease = lease;
        let os = std::ffi::OsStr::new;
        let args = [os("-b"), os("--factory-startup"), os("--python-exit-code"), os("1"), os("-P"), worker.as_os_str(), os("--"), input.as_os_str()];
        let outcome = local_media::run_program(&blender, &args, &job, Some(timeout), "Blender").await;
        let result: Option<Value> = std::fs::read_to_string(folder.join("result.json")).ok().and_then(|text| serde_json::from_str(&text).ok());
        match (outcome, result) {
            (Ok(()), Some(result)) if result["ok"] == true => {
                let _ignored = std::fs::remove_dir_all(&work);
                let rendered = result["frames"].as_u64().unwrap_or(0);
                job.done(
                    format!("3D render ready · {rendered} frame(s) in {} s", result["totalSeconds"]),
                    Some(json!({
                        "task": "blender", "dir": folder, "path": folder.join("00001.png"),
                        "frames": rendered, "frameNumbers": result["frameNumbers"], "step": result["step"], "fps": fps, "width": width, "height": height,
                        "camera": folder.join("camera.json"), "objects2d": folder.join("objects2d.json"),
                        "secondsPerFrame": result["secondsPerFrame"], "blender": result["blender"],
                    })),
                );
            }
            (Ok(()), _) => job.fail("Blender finished without writing its frames"),
            (Err(error), _) => job.fail(error),
        }
    });
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scene() -> Value {
        json!({ "width": 1280, "height": 720, "duration": 2, "objects": [{ "id": "orb", "kind": "sphere", "material": { "preset": "pearl" } }] })
    }

    #[test]
    fn a_minimal_scene_is_filled_with_defaults() {
        let (request, frames) = check_request(scene()).unwrap();
        assert_eq!(frames, 60);
        assert_eq!(request["engine"], "eevee");
        assert_eq!(request["fps"], 30);
        assert_eq!(request["step"], 1);
    }

    #[test]
    fn frames_and_step_set_how_many_render() {
        let mut request = scene();
        request["frames"] = json!([1, 30, 60]);
        assert_eq!(check_request(request.clone()).unwrap().1, 3);
        request["frames"] = json!([1, 61]);
        assert!(check_request(request.clone()).is_err());
        request["frames"] = Value::Null;
        request["step"] = json!(4);
        assert_eq!(check_request(request).unwrap().1, 15);
    }

    #[test]
    fn bad_scenes_are_refused_with_a_reason() {
        for (key, value) in [("engine", json!("octane")), ("duration", json!(0)), ("duration", json!(600)), ("width", json!(9000)), ("objects", json!([]))] {
            let mut request = scene();
            request[key] = value;
            assert!(check_request(request).is_err(), "{key} accepted");
        }
        let mut request = scene();
        request["objects"][0]["kind"] = json!("teapot");
        assert!(check_request(request).unwrap_err().contains("kind"));
        let mut request = scene();
        request["objects"][0]["material"]["preset"] = json!("velvet");
        assert!(check_request(request).unwrap_err().contains("preset"));
        let mut request = scene();
        request["objects"] = json!([{ "id": "a", "kind": "box" }, { "id": "a", "kind": "box" }]);
        assert!(check_request(request).is_err());
    }

    #[test]
    fn the_timeout_grows_with_frames_samples_and_engine() {
        let (eevee, frames) = check_request(scene()).unwrap();
        let mut cycles = eevee.clone();
        cycles["engine"] = json!("cycles");
        cycles["samples"] = json!(128);
        assert!(timeout_for(&cycles, frames) > timeout_for(&eevee, frames));
        assert!(timeout_for(&eevee, 600) > timeout_for(&eevee, 60));
        assert!(timeout_for(&eevee, 1).as_secs() >= 120);
    }

    #[test]
    fn install_folders_sort_by_version() {
        assert!(folder_version("Blender 5.2") > folder_version("Blender 4.10"));
        assert!(folder_version("Blender 4.10") > folder_version("Blender 4.2"));
        assert_eq!(folder_version("stuff"), (0, 0));
    }

    #[test]
    fn a_set_path_that_does_not_exist_finds_nothing() {
        assert_eq!(find_blender(Some("Z:/nowhere/blender.exe")), None);
    }

    /// Renders through the real bridge when this machine has Blender (skipped otherwise).
    #[test]
    #[ignore = "needs Blender installed; run with --ignored"]
    fn the_bridge_renders_a_frame_with_alpha_and_camera_tracks() {
        let Some(blender) = find_blender(None) else { return };
        let dir = std::env::temp_dir().join(format!("helios-blender-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let (mut request, _) = check_request(json!({ "width": 320, "height": 180, "duration": 0.5, "frames": [1], "samples": 4,
            "objects": [{ "id": "floor", "kind": "floor" }, { "id": "gem", "kind": "crystal", "material": { "preset": "gem" } }] })).unwrap();
        request["out"] = json!(dir);
        let worker = dir.join("bridge.py");
        std::fs::write(&worker, include_str!("../workers/blender_bridge.py")).unwrap();
        let input = dir.join("request.json");
        std::fs::write(&input, request.to_string()).unwrap();
        let status = std::process::Command::new(blender).args(["-b", "--factory-startup", "--python-exit-code", "1", "-P"]).arg(&worker).arg("--").arg(&input).output().unwrap();
        assert!(status.status.success(), "{}", String::from_utf8_lossy(&status.stdout));
        assert!(dir.join("00001.png").is_file());
        let camera: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("camera.json")).unwrap()).unwrap();
        assert_eq!(camera["frames"].as_array().unwrap().len(), 15);
        let objects: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("objects2d.json")).unwrap()).unwrap();
        assert!(objects["frames"][0]["gem"]["box"][2].as_f64().unwrap() > 1.0);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
