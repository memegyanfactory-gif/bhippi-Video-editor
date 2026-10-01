//! A dark backdrop behind every project, once the launch splash is done.
//!
//! The window is see-through so the splash can be a small card over the desktop
//! (tauri.conf.json `transparent`), and it stays so for good: tao makes it see-through with DWM
//! blur-behind, so its background colour (painted without alpha) never shows. Wherever no project's
//! webview covers the window (a moment mid-resize, a project still opening) the desktop showed
//! through. Windows 11's dark Mica backdrop fills those places instead: a dark surface drawn
//! behind the whole window by the system.

use tauri::window::{Color, Effect, EffectsBuilder};
use tauri::Window;

/// Puts the dark backdrop behind `window` (Windows 11; elsewhere the window keeps its colour).
pub fn install(window: &Window) {
    let effects = EffectsBuilder::new().effect(Effect::MicaDark).color(Color(11, 11, 15, 255)).build();
    if let Err(error) = window.set_effects(effects) {
        tracing::warn!(%error, "could not put the dark backdrop behind the window");
    }
}
