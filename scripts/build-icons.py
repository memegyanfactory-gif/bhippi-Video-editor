"""Builds every Bhippi app icon from the one logo master.

    .media-venv/Scripts/python -m pip install resvg-py pillow   # once
    .media-venv/Scripts/python scripts/build-icons.py

Input: public/bhippi.png — the official Bhippi mark (glossy orange ring around a "B") on a
transparent background, square, 1024 px, cropped tight to the mark. It is cut from the original
artwork `icon png.png` at the repo root (kept untouched; also copied to src-tauri/icons/source.png).
The app's own UI (title bar, home, About, sign-in, the splash in index.html) shows that PNG
directly. Output: src-tauri/icons/*, the app icon (the mark on a dark rounded tile) at every
size Tauri, the Windows taskbar/Start menu, the installer and macOS ask for, plus icon.ico and
icon.icns. Every size is downscaled straight from the 1024 px master with Lanczos (in
premultiplied alpha, so the transparent edge never picks up a dark or white fringe).

The tile keeps the mark legible on light and dark taskbars alike; the UI is always dark, so
it shows the mark on its own.
"""

import io
import shutil
import struct
from pathlib import Path

import resvg_py
from PIL import Image, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "src-tauri" / "icons"
MARK = ROOT / "public" / "bhippi.png"
ORIGINAL = ROOT / "icon png.png"
MASTER = 1024
# Tile geometry on the 1024 canvas; matches the rounded square the previous icon used.
PAD, RADIUS = 64, 200


def tile_svg(edge: bool, pad: float = PAD, radius: float = RADIUS) -> str:
    """The dark rounded tile (no mark), with a warm bloom behind where the mark sits."""
    side = MASTER - 2 * pad
    hairline = (
        f'<rect x="{pad + 2}" y="{pad + 2}" width="{side - 4}" height="{side - 4}" rx="{radius - 2}" '
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
    <radialGradient id="bloom" gradientUnits="userSpaceOnUse" cx="512" cy="512" r="380">
      <stop offset="0" stop-color="#ff6a1a" stop-opacity="0.20"/>
      <stop offset="1" stop-color="#ff6a1a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="{pad}" y="{pad}" width="{side}" height="{side}" rx="{radius}" fill="url(#tile)"/>
  <rect x="{pad}" y="{pad}" width="{side}" height="{side}" rx="{radius}" fill="url(#bloom)"/>
  {hairline}
</svg>"""


def render_svg(svg: str, size: int) -> Image.Image:
    png = resvg_py.svg_to_bytes(svg_string=svg, width=size, height=size)
    return Image.open(io.BytesIO(bytes(png))).convert("RGBA")


def load_mark() -> Image.Image:
    mark = Image.open(MARK).convert("RGBA")
    if mark.size != (MASTER, MASTER):
        mark = mark.convert("RGBa").resize((MASTER, MASTER), Image.LANCZOS).convert("RGBA")
    return mark


def scaled_mark(mark: Image.Image, px: int) -> Image.Image:
    """Lanczos downscale in premultiplied alpha; tiny sizes get a touch of crispness back."""
    small = mark.convert("RGBa").resize((px, px), Image.LANCZOS).convert("RGBA")
    if px <= 40:
        rgb = small.convert("RGB").filter(ImageFilter.UnsharpMask(radius=0.6, percent=60, threshold=0))
        rgb = ImageEnhance.Contrast(rgb).enhance(1.12)
        rgb = ImageEnhance.Color(rgb).enhance(1.1)
        small = Image.merge("RGBA", (*rgb.split(), small.getchannel("A")))
    return small


def flattened(mark: Image.Image, mix: float = 0.55) -> Image.Image:
    """The mark with its glossy highlights pulled toward a plain amber-to-orange ramp.

    At 32 px and below the glass reflections alias into speckle that hides the ring's gaps and
    the "B"; a flatter fill keeps the silhouette readable while still looking like the logo.
    """
    width, height = mark.size
    ramp = Image.new("RGB", (1, 2))
    ramp.putpixel((0, 0), (255, 150, 40))
    ramp.putpixel((0, 1), (240, 70, 10))
    ramp = ramp.resize((width, height), Image.BILINEAR)
    rgb = Image.blend(mark.convert("RGB"), ramp, mix)
    return Image.merge("RGBA", (*rgb.split(), mark.getchannel("A")))


def app_icon(mark: Image.Image, size: int, flat: Image.Image | None = None) -> Image.Image:
    # Tiny icons give the mark more of the tile (and a thinner tile margin) so the ring and the
    # "B" stay readable: at 16 px every pixel of mark counts.
    if size <= 32 and flat is not None:
        mark = flat
    if size >= 64:
        pad, scale = PAD, 0.70
    elif size >= 32:
        pad, scale = 40, 0.80
    else:
        pad, scale = 0, 0.86
    tile = render_svg(tile_svg(edge=size >= 64, pad=pad, radius=RADIUS if pad else 230), size)
    px = max(1, round(size * scale))
    offset = (size - px) // 2
    tile.alpha_composite(scaled_mark(mark, px), (offset, offset))
    return tile


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
    mark = load_mark()
    flat = flattened(mark)
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
        app_icon(mark, size, flat).save(ICONS / name, optimize=True)

    write_ico(ICONS / "icon.ico", [app_icon(mark, size, flat) for size in ICO_SIZES])
    app_icon(mark, MASTER).save(ICONS / "icon.icns", format="ICNS")
    if ORIGINAL.exists():
        shutil.copyfile(ORIGINAL, ICONS / "source.png")
    print(f"icons written to {ICONS}")


if __name__ == "__main__":
    main()
