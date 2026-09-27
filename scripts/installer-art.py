"""Draws the Windows installer artwork from the Bhippi logo (public/bhippi.png).

    python scripts/installer-art.py

Writes into src-tauri/icons/installer/:
  header.bmp   150x57   NSIS page header, installer and uninstaller
  sidebar.bmp  164x314  NSIS welcome / finish page panel
  banner.bmp   493x58   MSI (WiX) top banner
  dialog.bmp   493x312  MSI (WiX) welcome / finish background

NSIS and WiX only read 24-bit BMPs, so everything is flattened onto a solid background.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
LOGO = Image.open(ROOT / "public" / "bhippi.png").convert("RGBA")
OUT = ROOT / "src-tauri" / "icons" / "installer"
DARK = (14, 14, 18)
WHITE = (255, 255, 255)
ORANGE = (255, 122, 26)


def font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    for name in (["segoeuib.ttf", "arialbd.ttf"] if bold else ["segoeui.ttf", "arial.ttf"]):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def logo(size: int) -> Image.Image:
    return LOGO.resize((size, size), Image.LANCZOS)


def canvas(width: int, height: int, colour) -> Image.Image:
    return Image.new("RGBA", (width, height), colour + (255,))


def dark_panel(width: int, height: int) -> Image.Image:
    """A near-black panel with a soft orange glow behind where the logo sits."""
    image = canvas(width, height, DARK)
    glow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(glow)
    for step in range(40, 0, -1):
        alpha = int(3 + (40 - step) * 0.9)
        radius = step * max(width, height) / 55
        cx, cy = width / 2, height * 0.36
        draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=ORANGE + (alpha // 6,))
    image.alpha_composite(glow)
    return image


def save(image: Image.Image, name: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").save(OUT / name, "BMP")
    print("wrote", OUT / name, image.size)


def header() -> None:
    image = canvas(150, 57, WHITE)
    image.alpha_composite(logo(41), (8, 8))
    draw = ImageDraw.Draw(image)
    draw.text((56, 12), "Bhippi", font=font(17), fill=(20, 20, 24))
    draw.text((57, 33), "Video Editor", font=font(11, bold=False), fill=(95, 95, 105))
    save(image, "header.bmp")


def sidebar() -> None:
    image = dark_panel(164, 314)
    image.alpha_composite(logo(104), (30, 58))
    draw = ImageDraw.Draw(image)
    for text, size, y, colour, bold in (("Bhippi", 22, 182, WHITE, True), ("Video Editor", 12, 212, (190, 190, 200), False)):
        width = draw.textlength(text, font=font(size, bold))
        draw.text(((164 - width) / 2, y), text, font=font(size, bold), fill=colour)
    draw.rectangle((62, 244, 102, 246), fill=ORANGE)
    save(image, "sidebar.bmp")


def banner() -> None:
    image = canvas(493, 58, WHITE)
    # WiX writes the dialog title on the left of the banner, so the mark sits at the right.
    image.alpha_composite(logo(44), (493 - 44 - 10, 7))
    save(image, "banner.bmp")


def dialog() -> None:
    # WiX draws its welcome text on the right 329 px of this image; the art stays in the left 164.
    image = canvas(493, 312, WHITE)
    image.alpha_composite(dark_panel(164, 312), (0, 0))
    image.alpha_composite(logo(104), (30, 60))
    draw = ImageDraw.Draw(image)
    for text, size, y, colour, bold in (("Bhippi", 22, 182, WHITE, True), ("Video Editor", 12, 212, (190, 190, 200), False)):
        width = draw.textlength(text, font=font(size, bold))
        draw.text(((164 - width) / 2, y), text, font=font(size, bold), fill=colour)
    save(image, "dialog.bmp")


if __name__ == "__main__":
    header()
    sidebar()
    banner()
    dialog()
