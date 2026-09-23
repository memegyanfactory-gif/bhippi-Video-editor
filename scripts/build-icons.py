"""Builds every Helios app icon from the one logo master.

    .media-venv/Scripts/python -m pip install resvg-py   # once
    .media-venv/Scripts/python scripts/build-icons.py

Input: public/helios.svg — the Helios mark (silver H, amber bend) on a transparent background.
The app's own UI (title bar, home, About, sign-in, the splash in index.html) shows that SVG
directly. Output: src-tauri/icons/*, the app icon (the mark on a dark rounded tile) at every
size Tauri, the Windows taskbar/Start menu, the installer and macOS ask for, plus icon.ico and
icon.icns. Every size is rendered from the vector, never resampled from a larger bitmap.

The tile keeps the mark legible on light and dark taskbars alike; the UI is always dark, so
it shows the mark on its own.
"""

import io
import re
import struct
from pathlib import Path

import resvg_py
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "src-tauri" / "icons"
MARK = ROOT / "public" / "helios.svg"
MASTER = 1024
# Tile geometry on the 1024 canvas; matches the rounded square the previous icon used.
PAD, RADIUS = 64, 200


def mark_svg() -> tuple[str, str]:
    """The master's viewBox and inner markup, to nest inside the tile."""
    text = MARK.read_text(encoding="utf-8")
    open_tag = re.search(r"<svg\b[^>]*>", text)
    view_box = re.search(r'viewBox="([^"]+)"', open_tag.group(0)).group(1)
    return view_box, text[open_tag.end() : text.rindex("</svg>")]


def tile_svg(mark_scale: float, edge: bool) -> str:
    """The mark on the dark tile. Small sizes pass a larger `mark_scale` so it stays readable."""
    view_box, inner = mark_svg()
    side = MASTER - 2 * PAD
    width = side * mark_scale
    offset = (MASTER - width) / 2
    # The bend sits right of centre in the mark; the warm bloom sits behind it.
    vx, _, vw, _ = (float(v) for v in view_box.split())
    bloom_x = offset + (318 - vx) / vw * width
    hairline = (
        f'<rect x="{PAD + 2}" y="{PAD + 2}" width="{side - 4}" height="{side - 4}" rx="{RADIUS - 2}" '
        'fill="none" stroke="#fff" stroke-opacity="0.1" stroke-width="4"/>'
        if edge  # below 64 px it only muddies the corner
        else ""
    )
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {MASTER} {MASTER}">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1e1e26"/>
      <stop offset="1" stop-color="#0a0a0e"/>
    </linearGradient>
    <radialGradient id="bloom" gradientUnits="userSpaceOnUse" cx="{bloom_x:.1f}" cy="512" r="300">
      <stop offset="0" stop-color="#ff9a1f" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#ff9a1f" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="{PAD}" y="{PAD}" width="{side}" height="{side}" rx="{RADIUS}" fill="url(#tile)"/>
  <rect x="{PAD}" y="{PAD}" width="{side}" height="{side}" rx="{RADIUS}" fill="url(#bloom)"/>
  {hairline}
  <svg x="{offset:.2f}" y="{offset:.2f}" width="{width:.2f}" height="{width:.2f}" viewBox="{view_box}">{inner}</svg>
</svg>"""


def render(svg: str, size: int) -> Image.Image:
    png = resvg_py.svg_to_bytes(svg_string=svg, width=size, height=size)
    return Image.open(io.BytesIO(bytes(png))).convert("RGBA")


def app_icon(size: int) -> Image.Image:
    # Tiny icons get a bigger mark (less tile) — at 16 px the slot and glow are a few pixels.
    scale = 0.64 if size >= 64 else 0.72 if size >= 32 else 0.78
    return render(tile_svg(scale, edge=size >= 64), size)


# Every edge Windows asks for at 100–200 % display scale, so nothing is resampled at run time:
# small icons 16/20/24/28/32, taskbar buttons 24/30/36/42/48, SM_CXICON 32/40/48/56/64, plus the
# Start/Explorer sizes (60, 72, 80, 96, 128, 256). The first entry is what Tauri embeds as every
# window's default icon (tauri-codegen takes `entries()[0]`), and until src-tauri/src/window_icon.rs
# swaps in the right size that one bitmap is what the taskbar draws — so it is the 100 % taskbar
# edge, 24 px. (With 16 px first the taskbar stretched it to 24 and the logo came out blurry.)
ICO_SIZES = [24, 16, 20, 28, 30, 32, 36, 40, 42, 48, 56, 60, 64, 72, 80, 96, 128, 256]


def write_ico(path: Path, frames: list[Image.Image]) -> None:
    """A .ico with one 32-bit PNG frame per image, in the given order.

    Pillow's ICO writer always sorts the frames smallest first; the order matters here (see
    ICO_SIZES), so the directory is written by hand.
    """
    blobs = []
    for frame in frames:
        buffer = io.BytesIO()
        frame.save(buffer, format="PNG", optimize=True)
        blobs.append(buffer.getvalue())
    directory = struct.pack("<HHH", 0, 1, len(frames))
    offset = len(directory) + 16 * len(frames)
    for frame, blob in zip(frames, blobs):
        edge = frame.width % 256  # 0 means 256
        directory += struct.pack("<BBBBHHII", edge, edge, 0, 0, 1, 32, len(blob), offset)
        offset += len(blob)
    path.write_bytes(directory + b"".join(blobs))


def main() -> None:
    pngs = {
        "32x32.png": 32,
        "64x64.png": 64,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "icon.png": 512,
        "Square30x30Logo.png": 30,
        "Square44x44Logo.png": 44,
        "Square71x71Logo.png": 71,
        "Square89x89Logo.png": 89,
        "Square107x107Logo.png": 107,
        "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150,
        "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310,
        "StoreLogo.png": 50,
    }
    for name, size in pngs.items():
        app_icon(size).save(ICONS / name, optimize=True)

    write_ico(ICONS / "icon.ico", [app_icon(size) for size in ICO_SIZES])
    app_icon(MASTER).save(ICONS / "icon.icns", format="ICNS")
    (ICONS / "icon.svg").write_text(tile_svg(0.64, edge=True), encoding="utf-8")
    print(f"icons written to {ICONS}")


if __name__ == "__main__":
    main()
