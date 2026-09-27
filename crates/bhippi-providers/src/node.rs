//! Node.js for the npm-installed provider CLIs (Claude Code, Codex, OpenCode, Grok).
//!
//! Those installs need `npm`, and a fresh Windows PC has none — or has a Node too old for the
//! vendor CLIs. Rather than stop with "install npm first", Bhippi fetches the current LTS
//! build from nodejs.org into a private folder of its own (no admin rights, no system PATH
//! change) and puts that folder first in every provider command's PATH (see
//! `command::search_dirs`). A system Node that is new enough is used as it is.

use crate::command::resolve_command;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// The oldest Node major the vendor CLIs run on.
const MIN_NODE_MAJOR: u32 = 18;
const DIST: &str = "https://nodejs.org/dist";

/// Where Bhippi keeps its own Node: `%LOCALAPPDATA%\Bhippi\node` on Windows, `~/.bhippi/node` elsewhere.
#[must_use]
pub(crate) fn private_dir() -> Option<PathBuf> {
    if cfg!(windows) {
        std::env::var_os("LOCALAPPDATA").map(|root| PathBuf::from(root).join("Bhippi").join("node"))
    } else {
        std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".bhippi").join("node"))
    }
}

/// The folder holding `node` and `npm` in Bhippi's private Node, once it is installed.
#[must_use]
pub(crate) fn private_bin() -> Option<PathBuf> {
    let dir = private_dir()?;
    let bin = if cfg!(windows) { dir } else { dir.join("bin") };
    bin.join(if cfg!(windows) { "node.exe" } else { "node" }).is_file().then_some(bin)
}

/// The major version `node --version` reports, if Node runs at all.
async fn node_major() -> Option<u32> {
    let resolved = resolve_command("node")?;
    let output = tokio::time::timeout(Duration::from_secs(20), resolved.command().arg("--version").output()).await.ok()?.ok()?;
    parse_major(&String::from_utf8_lossy(&output.stdout))
}

fn parse_major(version: &str) -> Option<u32> {
    version.trim().trim_start_matches('v').split('.').next()?.parse().ok()
}

/// Makes sure `npm` runs on a new-enough Node, installing Bhippi's private Node when it does
/// not. `progress` hears each step.
pub(crate) async fn ensure_npm(progress: &mut (dyn FnMut(&str) + Send)) -> Result<(), String> {
    if resolve_command("npm").is_some() && node_major().await.is_some_and(|major| major >= MIN_NODE_MAJOR) {
        return Ok(());
    }
    progress("Node.js is missing or too old — downloading the current LTS for Bhippi");
    install_private(progress).await?;
    match (resolve_command("npm"), node_major().await) {
        (Some(_), Some(major)) if major >= MIN_NODE_MAJOR => Ok(()),
        _ => Err("Node.js was downloaded but does not run on this computer.".to_owned()),
    }
}

/// The platform part of a Node release file name, and its archive extension.
fn platform() -> Result<(String, &'static str), String> {
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => return Err(format!("Node.js has no build for this processor ({other}).")),
    };
    let (os, ext) = match std::env::consts::OS {
        "windows" => ("win", "zip"),
        "macos" => ("darwin", "tar.gz"),
        "linux" => ("linux", "tar.gz"),
        other => return Err(format!("Node.js cannot be installed automatically on {other}.")),
    };
    Ok((format!("{os}-{arch}"), ext))
}

/// Downloads the newest LTS release and unpacks it into [`private_dir`], replacing any older one.
async fn install_private(progress: &mut (dyn FnMut(&str) + Send)) -> Result<(), String> {
    let target = private_dir().ok_or("Bhippi cannot find a folder to install Node.js into.")?;
    let (platform, ext) = platform()?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(600)).build().map_err(|error| error.to_string())?;
    let index: Vec<serde_json::Value> = client
        .get(format!("{DIST}/index.json"))
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| format!("Could not reach nodejs.org: {error}"))?
        .json()
        .await
        .map_err(|error| format!("nodejs.org answered with something unexpected: {error}"))?;
    // The index lists newest first; an LTS release names its line in `lts`, others carry false.
    let version = index
        .iter()
        .find(|release| release["lts"].is_string())
        .and_then(|release| release["version"].as_str())
        .ok_or("nodejs.org lists no LTS release.")?
        .to_owned();
    let name = format!("node-{version}-{platform}");
    progress(&format!("Downloading Node.js {version}"));
    let bytes = client
        .get(format!("{DIST}/{version}/{name}.{ext}"))
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| format!("Could not download Node.js: {error}"))?
        .bytes()
        .await
        .map_err(|error| format!("The Node.js download broke off: {error}"))?;

    let parent = target.parent().ok_or("bad Node.js folder")?.to_path_buf();
    let staging = parent.join("node-staging");
    let _ignored = tokio::fs::remove_dir_all(&staging).await;
    tokio::fs::create_dir_all(&staging).await.map_err(|error| error.to_string())?;
    let archive = staging.join(format!("{name}.{ext}"));
    tokio::fs::write(&archive, &bytes).await.map_err(|error| format!("Could not save Node.js: {error}"))?;

    progress(&format!("Unpacking Node.js {version}"));
    unpack(&archive, &staging).await?;
    let unpacked = staging.join(&name);
    if !unpacked.is_dir() {
        return Err("The Node.js archive did not unpack as expected.".to_owned());
    }
    let _ignored = tokio::fs::remove_dir_all(&target).await;
    tokio::fs::rename(&unpacked, &target).await.map_err(|error| format!("Could not put Node.js in place: {error}"))?;
    let _ignored = tokio::fs::remove_dir_all(&staging).await;
    progress(&format!("Node.js {version} is ready"));
    Ok(())
}

/// Unpacks with the system `tar` (Windows 10 and later ship one that reads zip files too).
async fn unpack(archive: &Path, into: &Path) -> Result<(), String> {
    let tar = if cfg!(windows) {
        std::env::var_os("SYSTEMROOT").map_or_else(|| PathBuf::from("tar"), |root| PathBuf::from(root).join("System32").join("tar.exe"))
    } else {
        PathBuf::from("tar")
    };
    let mut command = tokio::process::Command::new(tar);
    command.arg("-xf").arg(archive).arg("-C").arg(into).kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let output = command.output().await.map_err(|error| format!("Could not unpack Node.js: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!("Could not unpack Node.js: {}", String::from_utf8_lossy(&output.stderr).trim()))
    }
}

#[cfg(test)]
mod tests {
    use super::parse_major;

    #[test]
    fn reads_the_major_version() {
        assert_eq!(parse_major("v22.11.0\n"), Some(22));
        assert_eq!(parse_major("18.0.0"), Some(18));
        assert_eq!(parse_major("not node"), None);
    }
}
