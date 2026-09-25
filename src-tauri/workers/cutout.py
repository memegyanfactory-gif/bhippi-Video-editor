"""Still-image cutouts: BiRefNet separates the subject, the edge is cleaned, and — when asked —
the sticker look (a white stroke and a soft drop shadow) is baked into the PNG.

BiRefNet (Zheng Peng et al., MIT licence, weights on Hugging Face) is a high-resolution
dichotomous segmentation model: one image in, one soft alpha out. Two snapshots are used:
`general` (ZhengPeng7/BiRefNet) for anything, `portrait` (ZhengPeng7/BiRefNet-portrait) for
people with hair. Each is downloaded on first use into the Bhippi models folder, from a pinned
revision, and every file is checked against its SHA-256 before the model code is imported.
RMBG-2.0 is deliberately not used: its licence is non-commercial.

What happens to the alpha after the model:
  · haze and stray islands far from the subject are removed;
  · the edge is choked by `choke` px so no background fringe survives;
  · the foreground colour is re-estimated under the soft edge (blur-fusion, as in the BiRefNet
    repo), so hair does not carry the old background with it;
  · on a green screen the picture is despilled (green limited by max(red, blue)).

Request (JSON file named on the command line):
  input      image to cut out (Bhippi pulls a video frame to PNG first)
  output     RGBA PNG to write
  result     JSON file to write the answer to
  modelDir   folder of the BiRefNet snapshot (downloaded here on first use)
  variant    'general' | 'portrait'
  region     optional [x, y, w, h] in frame fractions: only what is inside is cut out
  stroke     bool; strokePx is the stroke's thickness when the cut-out is shown 1080 px tall
  shadow     bool
  choke      px to pull the edge in (default 1)
  crop       bool (default true): crop to the subject plus room for the stroke and shadow

Answer: {path, width, height, bbox {x, y, width, height} (source-frame fractions), coverage,
         offset {x, y} (the PNG's top-left in source pixels), sourceWidth, sourceHeight, strokePx,
         model, device, greenScreen, seconds}
"""
import json
import math
import os
import sys
import time
import traceback
from pathlib import Path

VARIANTS = {
    # repo, pinned revision, {file: sha256}, minimum weight size
    "general": (
        "ZhengPeng7/BiRefNet",
        "e2bf8e4460fc8fa32bba5ea4d94b3233d367b0e4",
        {
            "BiRefNet_config.py": "e7b8c2a74f6cea6a59553d517f71d47f2c1d90e670a13416af17c25fe2f3dc52",
            "birefnet.py": "208771ae626f653d64128fbf2d6ac9f8e645c5cc5e286258a73ec3322bbfe5ef",
            "model.safetensors": "9ab37426bf4de0567af6b5d21b16151357149139362e6e8992021b8ce356a154",
        },
    ),
    "portrait": (
        "ZhengPeng7/BiRefNet-portrait",
        "b6561965a70070d9143fd9e558f6ca3c481510db",
        {
            "BiRefNet_config.py": "e7b8c2a74f6cea6a59553d517f71d47f2c1d90e670a13416af17c25fe2f3dc52",
            "birefnet.py": "2a45b4e0ece72d7c4212bca1a988e7d7e52bfe9f98ec59c58b8809c8a8b7a831",
            "model.safetensors": "4a4eb3a5469b75f0cccaec6772c22fc30e6c12ed429c2c0ba71b43e3d8d97182",
        },
    ),
}
# The model code imports these; transformers, torch and torchvision are already in the media Python.
PACKAGES = ("timm", "kornia", "einops")
SIZE = 1024
MEAN = (0.485, 0.456, 0.406)
STD = (0.229, 0.224, 0.225)


def emit(progress, message):
    print(json.dumps({"progress": progress, "message": message}), flush=True)


# ─── setup ───────────────────────────────────────────────────────────────────────────────────


def ensure_packages():
    import importlib
    import subprocess

    missing = []
    for name in PACKAGES:
        try:
            importlib.import_module(name)
        except ImportError:
            missing.append(name)
    if not missing:
        return
    emit(0.02, f"Installing {', '.join(missing)} into the media Python (once)")
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0
    process = subprocess.run(
        [sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "--no-input", *missing],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=1800, creationflags=flags,
    )
    if process.returncode != 0:
        raise RuntimeError(
            "Could not install the cutout packages. Install them by hand and retry: "
            f"{sys.executable} -m pip install {' '.join(missing)}\n{process.stdout[-2000:]}"
        )


def sha256(path):
    import hashlib

    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def download(url, target, low, high, label):
    """Streams `url` to `target`, resuming a half-finished .part file, reporting MB as it goes."""
    import urllib.error
    import urllib.request

    part = target.with_name(target.name + ".part")
    existing = part.stat().st_size if part.is_file() else 0
    headers = {"User-Agent": "Bhippi cutout installer"}
    if existing:
        headers["Range"] = f"bytes={existing}-"
    try:
        response = urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60)
    except urllib.error.HTTPError as error:
        if error.code == 416 and existing:
            os.replace(part, target)
            return
        raise RuntimeError(f"Could not download {label} ({error.code} {error.reason}). Check the connection and retry.") from error
    except (urllib.error.URLError, OSError) as error:
        raise RuntimeError(f"Could not download {label}: {error}. Check the connection and retry.") from error
    mb = 1024 * 1024
    with response:
        resumed = existing > 0 and response.status == 206
        if not resumed:
            existing = 0
        length = response.headers.get("Content-Length")
        total = existing + int(length) if length and length.isdigit() else 0
        done = existing
        reported = done
        with open(part, "ab" if resumed else "wb") as handle:
            while True:
                chunk = response.read(mb)
                if not chunk:
                    break
                handle.write(chunk)
                done += len(chunk)
                if done - reported >= 8 * mb or (total and done >= total):
                    reported = done
                    fraction = done / total if total else 0.0
                    emit(low + (high - low) * min(1.0, fraction), f"Downloading {label} {done // mb}/{total // mb if total else '?'} MB")
    if total and done < total:
        raise RuntimeError(f"The {label} download stopped at {done // mb} of {total // mb} MB; run the cutout again to resume.")
    os.replace(part, target)


def ensure_model(model_dir, variant):
    """Downloads the pinned snapshot on first use and checks every file's SHA-256."""
    repo, revision, files = VARIANTS[variant]
    model_dir.mkdir(parents=True, exist_ok=True)
    receipt = model_dir / "bhippi-install.json"
    if receipt.is_file():
        try:
            if json.loads(receipt.read_text(encoding="utf-8")).get("revision") == revision and all((model_dir / name).is_file() for name in files):
                return
        except (OSError, ValueError):
            pass
    names = sorted(files, key=lambda name: name == "model.safetensors")
    for index, name in enumerate(names):
        target = model_dir / name
        if target.is_file() and sha256(target) == files[name]:
            continue
        target.unlink(missing_ok=True)
        low, high = (0.05, 0.08) if name != "model.safetensors" else (0.08, 0.6)
        emit(low, f"Downloading BiRefNet {variant} ({name}, once)")
        download(f"https://huggingface.co/{repo}/resolve/{revision}/{name}", target, low, high, f"BiRefNet {variant} {name}")
        actual = sha256(target)
        if actual != files[name]:
            target.unlink(missing_ok=True)
            raise RuntimeError(f"The downloaded {name} does not match the pinned BiRefNet {variant} release (sha256 {actual}); run the cutout again.")
        emit(high, f"Verified {name} ({index + 1}/{len(names)})")
    receipt.write_text(json.dumps({
        "model": f"birefnet-{variant}",
        "repo": repo,
        "revision": revision,
        "license": "MIT",
        "files": files,
        "packages": list(PACKAGES),
    }, indent=2), encoding="utf-8")


def load_model(model_dir, variant, device):
    """Imports the snapshot's model code as a package (it uses a relative import), builds the
    network on the meta device and assigns the weights straight onto the GPU — seconds, where
    `from_pretrained` spends most of a minute initialising weights it then overwrites."""
    import importlib.util
    import types

    import torch
    from safetensors.torch import load_file

    _, _, files = VARIANTS[variant]
    # No __pycache__ beside the verified model code.
    sys.dont_write_bytecode = True
    for name in ("birefnet.py", "BiRefNet_config.py"):
        if sha256(model_dir / name) != files[name]:
            raise RuntimeError(f"{name} in {model_dir} was modified; delete the folder and run the cutout again.")
    package = f"bhippi_birefnet_{variant}"
    module = types.ModuleType(package)
    module.__path__ = [str(model_dir)]
    sys.modules[package] = module
    for name in ("BiRefNet_config", "birefnet"):
        spec = importlib.util.spec_from_file_location(f"{package}.{name}", model_dir / f"{name}.py")
        loaded = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = loaded
        spec.loader.exec_module(loaded)
    code = sys.modules[f"{package}.birefnet"]
    with torch.device("meta"):
        model = code.BiRefNet(bb_pretrained=False)
    weights = load_file(str(model_dir / "model.safetensors"), device=str(device))
    result = model.load_state_dict(weights, strict=False, assign=True)
    if result.missing_keys:
        raise RuntimeError(f"BiRefNet {variant} weights are incomplete ({len(result.missing_keys)} tensors missing).")
    model = model.to(device).eval()
    return model.half() if device.type == "cuda" else model.float()


# ─── the model ───────────────────────────────────────────────────────────────────────────────


def predict(model, rgb, device):
    """One soft alpha, 0..1, the size of `rgb` (uint8 H×W×3)."""
    import torch
    import torch.nn.functional as F

    height, width = rgb.shape[:2]
    x = torch.from_numpy(rgb).to(device).permute(2, 0, 1)[None].float() / 255.0
    x = F.interpolate(x, size=(SIZE, SIZE), mode="bilinear", align_corners=False, antialias=max(height, width) > SIZE)
    x = (x - torch.tensor(MEAN, device=device).view(1, 3, 1, 1)) / torch.tensor(STD, device=device).view(1, 3, 1, 1)
    if device.type == "cuda":
        x = x.half()
    with torch.inference_mode():
        logits = model(x)[-1].float()
    alpha = F.interpolate(logits.sigmoid(), size=(height, width), mode="bilinear", align_corners=False)[0, 0]
    return alpha.clamp(0, 1).cpu().numpy()


# ─── the edge ────────────────────────────────────────────────────────────────────────────────


def clean_alpha(alpha, choke):
    """Removes haze and islands, then chokes the edge by `choke` px (a min filter keeps it soft)."""
    import cv2
    import numpy as np

    a = alpha.astype(np.float32)
    a[a < 0.03] = 0.0
    solid = (a > 0.5).astype(np.uint8)
    if not solid.any():
        return a
    count, labels, stats, _ = cv2.connectedComponentsWithStats(solid, connectivity=8)
    if count > 2:
        areas = stats[1:, cv2.CC_STAT_AREA]
        floor = max(areas.max() * 0.04, a.size * 0.0005)
        small = 1 + np.nonzero(areas < floor)[0]
        if small.size:
            dropped = np.isin(labels, small)
            kept = (labels > 0) & ~dropped
            kernel = np.ones((7, 7), np.uint8)
            fringe = (cv2.dilate(dropped.astype(np.uint8), kernel) > 0) & ~(cv2.dilate(kept.astype(np.uint8), kernel) > 0)
            a[dropped | fringe] = 0.0
            solid = kept.astype(np.uint8)
    # Soft haze more than 2 % of the frame away from anything solid is not the subject.
    reach = max(4.0, 0.02 * max(a.shape))
    distance = cv2.distanceTransform((solid == 0).astype(np.uint8), cv2.DIST_L2, 5)
    a[distance > reach] = 0.0
    # A gentle levels pass: the last few percent at either end are noise, not coverage.
    a = np.clip((a - 0.02) / 0.96, 0.0, 1.0)
    if choke > 0:
        size = 2 * int(round(choke)) + 1
        a = cv2.erode(a, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size)))
    return a


def estimate_foreground(image, alpha):
    """Blur-fusion foreground estimation (Forte & Pitié; as in the BiRefNet repo): the colour
    under a soft edge is re-estimated from the solid subject nearby, so the old background does
    not ride along on hair and shoulders. `image` float 0..1 H×W×3, `alpha` H×W."""
    import cv2
    import numpy as np

    a = alpha[:, :, None]

    def fuse(F, B, radius):
        blurred_a = cv2.blur(alpha, (radius, radius))[:, :, None]
        blurred_f = cv2.blur(F * a, (radius, radius)) / (blurred_a + 1e-5)
        blurred_b = cv2.blur(B * (1 - a), (radius, radius)) / ((1 - blurred_a) + 1e-5)
        F = blurred_f + a * (image - a * blurred_f - (1 - a) * blurred_b)
        return np.clip(F, 0, 1), blurred_b

    large = max(31, int(round(90 * max(alpha.shape) / 1920)) | 1)
    F, B = fuse(image, image, large)
    return fuse(F, B, 7)[0]


def green_backdrop(image, alpha):
    """True when what the model threw away is mostly chroma green."""
    import cv2
    import numpy as np

    background = alpha < 0.05
    if background.sum() < 0.05 * alpha.size:
        return False
    hsv = cv2.cvtColor((image * 255).astype(np.uint8), cv2.COLOR_RGB2HSV)[background]
    hue, sat, val = hsv[:, 0].astype(np.float32) * 2, hsv[:, 1] / 255.0, hsv[:, 2] / 255.0
    green = (hue >= 75) & (hue <= 165) & (sat >= 0.35) & (val >= 0.15)
    return float(green.mean()) > 0.6


def despill(F):
    """Green limited by max(red, blue): the green cast a screen throws on skin and hair goes."""
    import numpy as np

    F = F.copy()
    F[:, :, 1] = np.minimum(F[:, :, 1], np.maximum(F[:, :, 0], F[:, :, 2]))
    return F


# ─── the sticker look ────────────────────────────────────────────────────────────────────────


def touching(alpha):
    """Which sides the subject is cut by (the frame edge runs through it): left, top, right, bottom."""
    import numpy as np

    def cut(line):
        return float((line > 0.5).mean()) > 0.01

    return (cut(alpha[:, :2].max(axis=1)), cut(alpha[:2, :].max(axis=0)), cut(alpha[:, -2:].max(axis=1)), cut(alpha[-2:, :].max(axis=0)))


def pad(array, amount, sides):
    """Pads left/top/right/bottom by `amount`; a side the subject is cut by continues outward
    (edge replicate) so neither the stroke nor the shadow wraps around the cut."""
    import numpy as np

    left, top, right, bottom = sides
    extra = [(0, 0)] * (array.ndim - 2)
    for axis, before, after in ((1, left, right), (0, top, bottom)):
        for at_start, replicate in ((True, before), (False, after)):
            widths = [(0, 0), (0, 0)]
            widths[axis] = (amount, 0) if at_start else (0, amount)
            array = np.pad(array, widths + extra, mode="edge" if replicate else "constant")
    return array


def sticker(F, alpha, stroke_px, shadow, object_height):
    """Composites subject over a white stroke over a soft shadow on a padded canvas.
    Returns (rgb 0..1, alpha, padding, sides)."""
    import cv2
    import numpy as np

    sides = touching(alpha)
    sigma = max(3.0, object_height * 0.014) if shadow else 0.0
    offset = (object_height * 0.005, max(3.0, object_height * 0.014)) if shadow else (0.0, 0.0)
    room = int(math.ceil(stroke_px + 3 * sigma + max(offset) + 2))
    a = pad(alpha, room, sides)
    F = pad(F, room, sides)
    silhouette = a
    out_a = a.copy()
    out_rgb = F * a[:, :, None]
    if stroke_px > 0:
        smooth = cv2.GaussianBlur(a, (0, 0), max(1.0, stroke_px * 0.35))
        outside = (smooth <= 0.5).astype(np.uint8)
        distance = cv2.distanceTransform(outside, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
        ring = np.clip(stroke_px + 0.5 - distance, 0.0, 1.0).astype(np.float32)
        silhouette = np.maximum(ring, a)
        out_rgb = out_rgb + (1 - out_a)[:, :, None] * ring[:, :, None]  # white, premultiplied
        out_a = out_a + ring * (1 - out_a)
    if shadow:
        shift = np.float32([[1, 0, offset[0]], [0, 1, offset[1]]])
        moved = cv2.warpAffine(silhouette, shift, (silhouette.shape[1], silhouette.shape[0]), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        soft = cv2.GaussianBlur(moved, (0, 0), sigma) * 0.55
        out_a = out_a + soft * (1 - out_a)  # black, adds nothing to the premultiplied colour
    rgb = out_rgb / np.maximum(out_a, 1e-6)[:, :, None]
    return np.clip(rgb, 0, 1), np.clip(out_a, 0, 1), room, sides


# ─── the run ─────────────────────────────────────────────────────────────────────────────────


def solid_box(alpha):
    import numpy as np

    ys, xs = np.nonzero(alpha > 0.5)
    if not len(xs):
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def cutout(request):
    import cv2
    import numpy as np
    from PIL import Image

    started = time.perf_counter()
    variant = request.get("variant", "general")
    if variant not in VARIANTS:
        raise ValueError("variant must be general or portrait")
    source = Path(request["input"])
    output = Path(request["output"])
    choke = float(request.get("choke", 1.0))
    if not 0 <= choke <= 8:
        raise ValueError("choke must be 0–8 px")
    stroke_on = bool(request.get("stroke", False))
    stroke_scale = float(request.get("strokePx", 8.0))
    if not 0 < stroke_scale <= 64:
        raise ValueError("strokePx must be 0–64")
    shadow_on = bool(request.get("shadow", False))
    crop = bool(request.get("crop", True))

    ensure_packages()
    model_dir = Path(request["modelDir"])
    ensure_model(model_dir, variant)

    try:
        from pillow_heif import register_heif_opener  # noqa: PLC0415

        register_heif_opener()
    except ImportError:
        pass
    emit(0.62, "Reading the image")
    picture = Image.open(source)
    picture.load()
    if picture.mode in ("RGBA", "LA", "P"):
        flat = Image.new("RGB", picture.size, (255, 255, 255))
        flat.paste(picture.convert("RGBA"), mask=picture.convert("RGBA").split()[-1])
        picture = flat
    rgb = np.asarray(picture.convert("RGB"))
    height, width = rgb.shape[:2]
    if width < 16 or height < 16 or width * height > 80_000_000:
        raise ValueError("The image must be between 16 px and 80 megapixels.")

    import torch

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    emit(0.66, f"Loading BiRefNet {variant} ({device.type})")
    loaded = time.perf_counter()
    model = load_model(model_dir, variant, device)
    load_seconds = time.perf_counter() - loaded

    region = request.get("region")
    emit(0.8, "Separating the subject")
    inferred = time.perf_counter()
    if region:
        x, y, w, h = (float(v) for v in region)
        if not (0 <= x < 1 and 0 <= y < 1 and 0 < w <= 1 and 0 < h <= 1):
            raise ValueError("region must be [x, y, width, height] in frame fractions")
        # A little context around the box helps the model decide what the subject is.
        grow_x, grow_y = w * 0.04, h * 0.04
        left, top = int(max(0.0, x - grow_x) * width), int(max(0.0, y - grow_y) * height)
        right, bottom = int(math.ceil(min(1.0, x + w + grow_x) * width)), int(math.ceil(min(1.0, y + h + grow_y) * height))
        if right - left < 16 or bottom - top < 16:
            raise ValueError("region is too small")
        alpha = np.zeros((height, width), np.float32)
        alpha[top:bottom, left:right] = predict(model, np.ascontiguousarray(rgb[top:bottom, left:right]), device)
        # Only what is inside the region the caller drew belongs to the subject.
        box = np.zeros_like(alpha)
        box[int(y * height):int(math.ceil((y + h) * height)), int(x * width):int(math.ceil((x + w) * width))] = 1.0
        alpha *= cv2.GaussianBlur(box, (0, 0), 2.0)
    else:
        alpha = predict(model, rgb, device)
    if device.type == "cuda":
        torch.cuda.synchronize()
    infer_seconds = time.perf_counter() - inferred
    del model
    if device.type == "cuda":
        torch.cuda.empty_cache()

    emit(0.88, "Cleaning the edge")
    alpha = clean_alpha(alpha, choke)
    found = solid_box(alpha)
    if found is None:
        raise RuntimeError("BiRefNet found no subject in that image. Try the other model, or a region around the person.")
    left, top, right, bottom = found
    coverage = float((alpha > 0.5).mean())
    image = rgb.astype(np.float32) / 255.0
    foreground = estimate_foreground(image, alpha)
    green = green_backdrop(image, alpha)
    if green:
        foreground = despill(foreground)

    object_height = float(bottom - top)
    stroke_px = max(2.0, stroke_scale * object_height / 1080.0) if stroke_on else 0.0
    offset_x = offset_y = 0
    if stroke_on or shadow_on:
        emit(0.93, "Baking the sticker stroke and shadow")
        out_rgb, out_a, room, sides = sticker(foreground, alpha, stroke_px, shadow_on, object_height)
        offset_x = offset_y = -room
    else:
        out_rgb, out_a, room, sides = foreground, alpha, 0, touching(alpha)

    canvas_h, canvas_w = out_a.shape
    if crop:
        seen = np.nonzero(out_a > 0.004)
        c_left, c_top = int(seen[1].min()), int(seen[0].min())
        c_right, c_bottom = int(seen[1].max()) + 1, int(seen[0].max()) + 1
        # A side the frame edge cuts through ends exactly at the frame edge.
        if sides[0]:
            c_left = room
        if sides[1]:
            c_top = room
        if sides[2]:
            c_right = canvas_w - room
        if sides[3]:
            c_bottom = canvas_h - room
    else:
        c_left, c_top = (room if sides[0] else 0), (room if sides[1] else 0)
        c_right, c_bottom = canvas_w - (room if sides[2] else 0), canvas_h - (room if sides[3] else 0)
    out_rgb = out_rgb[c_top:c_bottom, c_left:c_right]
    out_a = out_a[c_top:c_bottom, c_left:c_right]
    offset_x += c_left
    offset_y += c_top

    rgba = np.dstack([np.round(out_rgb * 255), np.round(out_a * 255)]).astype(np.uint8)
    output.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(output, compress_level=3)
    if not output.is_file() or output.stat().st_size == 0:
        raise RuntimeError("The cut-out PNG was not written.")
    answer = {
        "path": str(output),
        "width": int(rgba.shape[1]),
        "height": int(rgba.shape[0]),
        "bbox": {"x": left / width, "y": top / height, "width": (right - left) / width, "height": (bottom - top) / height},
        "coverage": coverage,
        "offset": {"x": int(offset_x), "y": int(offset_y)},
        "sourceWidth": int(width),
        "sourceHeight": int(height),
        "strokePx": round(stroke_px, 2),
        "model": f"birefnet-{variant}",
        "device": device.type,
        "greenScreen": bool(green),
        "seconds": round(time.perf_counter() - started, 3),
        "loadSeconds": round(load_seconds, 3),
        "inferSeconds": round(infer_seconds, 3),
    }
    Path(request["result"]).write_text(json.dumps(answer), encoding="utf-8")
    emit(1.0, f"Cut out {answer['width']}×{answer['height']} ({coverage * 100:.0f}% of the frame)")
    return answer


if __name__ == "__main__":
    import warnings

    warnings.filterwarnings("ignore")
    os.environ.setdefault("PYTHONWARNINGS", "ignore")
    try:
        cutout(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")))
    except Exception:
        traceback.print_exc()
        sys.exit(1)
