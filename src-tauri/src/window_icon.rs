//! A sharp taskbar icon on Windows.
//!
//! Tauri gives every window one bitmap as its icon: the first frame of `icons/icon.ico`
//! (tauri-codegen embeds `entries()[0]`), which tao sends as `WM_SETICON ICON_SMALL`, leaving
//! `ICON_BIG` empty. The Windows 11 taskbar draws the window's own icon, not the exe's, and with
//! no big icon it scales the small one to its button icon: 24 px at 100 % display scale, then
//! 30, 36, 42 and 48 px at 125–200 %. Any other size gets resampled; a 16 px frame stretched to
//! 24 px is the blurry logo the taskbar used to show.
//!
//! [`install`] swaps in the .ico frame that is exactly the taskbar size for the window's display
//! scale, and swaps it again whenever the window moves to a display with another scale.

use std::io::Cursor;

use tauri::{image::Image, Runtime, Window, WindowEvent};

/// The app icon at every size Windows asks for (written by scripts/build-icons.py).
const ICO: &[u8] = include_bytes!("../icons/icon.ico");

/// Keeps `window`'s icon at the taskbar size for its display: now, and after every scale change.
pub fn install<R: Runtime>(window: &Window<R>) {
    match window.scale_factor() {
        Ok(scale) => apply(window, scale),
        Err(error) => tracing::warn!(%error, window = window.label(), "no display scale; keeping the default taskbar icon"),
    }
    let target = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::ScaleFactorChanged { scale_factor, .. } = event {
            apply(&target, *scale_factor);
        }
    });
}

/// Gives `window` the icon frame that matches the taskbar at display `scale`. A failure only
/// leaves Tauri's default icon in place.
fn apply<R: Runtime>(window: &Window<R>, scale: f64) {
    let result = taskbar_icon(scale).and_then(|icon| window.set_icon(icon).map_err(|error| error.to_string()));
    if let Err(error) = result {
        tracing::warn!(%error, window = window.label(), "could not set the taskbar icon");
    }
}

/// Edge of the taskbar button icon in physical pixels at display `scale` (1.0 = 96 DPI).
fn taskbar_icon_px(scale: f64) -> u32 {
    let scale = if scale.is_finite() && scale > 0.0 { scale } else { 1.0 };
    // 24 px per 96 DPI, like the shell's other metrics; the largest .ico frame is 256 px.
    (24.0 * scale).round().clamp(16.0, 256.0) as u32
}

/// The frame for a `want` px icon: that size, else the next larger one (Windows shrinks it a
/// little), else the largest there is.
fn pick_size(available: &[u32], want: u32) -> Option<u32> {
    available.iter().copied().filter(|&size| size >= want).min().or_else(|| available.iter().copied().max())
}

/// The icon.ico frame for the taskbar at display `scale`, ready for `Window::set_icon`.
fn taskbar_icon(scale: f64) -> Result<Image<'static>, String> {
    let dir = ico::IconDir::read(Cursor::new(ICO)).map_err(|error| format!("icon.ico: {error}"))?;
    let square = |entry: &&ico::IconDirEntry| entry.width() == entry.height();
    let sizes: Vec<u32> = dir.entries().iter().filter(square).map(ico::IconDirEntry::width).collect();
    let size = pick_size(&sizes, taskbar_icon_px(scale)).ok_or("icon.ico has no square frames")?;
    let entry = dir.entries().iter().filter(square).find(|entry| entry.width() == size).ok_or("icon.ico frame vanished")?;
    let image = entry.decode().map_err(|error| format!("icon.ico {size} px frame: {error}"))?;
    let (width, height) = (image.width(), image.height());
    Ok(Image::new_owned(image.into_rgba_data(), width, height))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCALES: [f64; 5] = [1.0, 1.25, 1.5, 1.75, 2.0];

    #[test]
    fn taskbar_icon_is_24_px_per_96_dpi() {
        let edges: Vec<u32> = SCALES.iter().map(|&scale| taskbar_icon_px(scale)).collect();
        assert_eq!(edges, [24, 30, 36, 42, 48]);
        // A missing or nonsense scale is treated as 100 %.
        assert_eq!(taskbar_icon_px(0.0), 24);
        assert_eq!(taskbar_icon_px(-1.0), 24);
        assert_eq!(taskbar_icon_px(f64::NAN), 24);
        assert_eq!(taskbar_icon_px(20.0), 256);
    }

    #[test]
    fn picks_the_exact_frame_then_the_next_larger_then_the_largest() {
        let sizes = [16, 24, 32, 48, 256];
        assert_eq!(pick_size(&sizes, 24), Some(24));
        assert_eq!(pick_size(&sizes, 30), Some(32));
        assert_eq!(pick_size(&sizes, 300), Some(256));
        assert_eq!(pick_size(&[], 24), None);
    }

    #[test]
    fn the_shipped_ico_has_an_exact_frame_for_every_scale() {
        let dir = ico::IconDir::read(Cursor::new(ICO)).unwrap();
        let sizes: Vec<u32> = dir.entries().iter().map(ico::IconDirEntry::width).collect();
        for scale in SCALES {
            // The taskbar edge, and the small-icon edge (SM_CXSMICON) Windows uses elsewhere.
            for edge in [taskbar_icon_px(scale), (16.0 * scale).round() as u32] {
                assert!(sizes.contains(&edge), "icon.ico has no {edge} px frame for {scale}x; rerun scripts/build-icons.py");
            }
        }
        // Tauri makes the first frame every window's default icon, which the taskbar shows
        // until `install` runs, so it is the 100 % taskbar edge.
        assert_eq!(dir.entries()[0].width(), 24);
    }

    #[test]
    fn the_taskbar_icon_decodes_at_the_taskbar_size() {
        for scale in SCALES {
            let icon = taskbar_icon(scale).unwrap();
            let edge = taskbar_icon_px(scale);
            assert_eq!((icon.width(), icon.height()), (edge, edge));
            assert_eq!(icon.rgba().len(), (edge * edge * 4) as usize);
            assert!(icon.rgba().chunks(4).any(|pixel| pixel[3] == 0), "the rounded tile keeps transparent corners");
        }
    }
}
