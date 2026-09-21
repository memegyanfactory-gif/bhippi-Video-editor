"""Magic eraser: the background behind a rotoscoped subject, with the subject gone.

One JSON request, two artifacts, no shell or remote code:

  · clean_plate.png — a still of the background with nobody in it. Every pixel is
    the temporal median of the frames where the matte says the subject was not
    standing there; the few pixels the subject never uncovered are filled by LaMa
    (big-lama, Samsung AI Lab, Apache 2.0).
  · erased.mp4 — the requested range rendered at the source resolution with the
    plate composited under the (dilated, feathered) matte, so a title or a
    graphic can sit truly behind the person once the original clip is layered
    back on top through its Roto matte.

Request (paths absolute; seconds are source seconds):
  {
    "source": "<video>", "matte": "<matte.mkv>", "matteOrigin": 12.0,
    "start": 12.5, "end": 18.0, "fps": 29.97,
    "dilate": 12, "mode": "clean-plate" | "per-frame", "refine": false,
    "output": "<dir>", "lamaModel": "<big-lama.pt>", "ffmpeg": "<ffmpeg>",
    "maxWidth": 1280
  }

`mode`:
  · clean-plate (default) — composite only, deterministic and quick. With
    `refine` true, LaMa regenerates a narrow band along the seam of every frame
    so a halo never shows; the plate itself is kept.
  · per-frame — LaMa repaints the whole masked region of every frame from that
    frame's own surroundings (the camera moved, so one static plate is wrong).
    Slow: one LaMa pass per frame.

Progress goes to stdout as one JSON object per line; the last one carries the
output paths. Anything on stderr is a failure diagnostic.
"""
import io
import json
import os
import subprocess
import sys
import traceback
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")
os.environ.setdefault("PYTHONWARNINGS", "ignore")

MAX_SAMPLES = 120
FEATHER = 6
HOLE_GROW = 8
SEAM_BAND = 6
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0
MEGABYTE = 1024 * 1024


def emit(progress, message, **extra):
    print(json.dumps({"progress": progress, "message": message, **extra}), flush=True)


def ffmpeg_base(ffmpeg):
    return [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin"]


def probe_size(ffmpeg, path, seek):
    """Width and height of the decoded picture (after any rotation), from one real frame."""
    from PIL import Image

    args = ffmpeg_base(ffmpeg)
    if seek > 0:
        args += ["-ss", f"{seek:.6f}"]
    args += ["-i", str(path), "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"]
    done = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=NO_WINDOW, timeout=120)
    if done.returncode != 0 or not done.stdout:
        detail = done.stderr.decode("utf-8", "replace").strip().splitlines()
        raise RuntimeError("FFmpeg could not decode a frame from " + Path(path).name + (": " + detail[-1] if detail else ""))
    with Image.open(io.BytesIO(done.stdout)) as image:
        return image.size


def working_size(width, height, max_width):
    scale = min(1.0, max_width / max(1, width))
    w = max(2, int(round(width * scale)) // 2 * 2)
    h = max(2, int(round(height * scale)) // 2 * 2)
    return w, h


def read_exact(stream, count):
    chunks = []
    remaining = count
    while remaining > 0:
        piece = stream.read(remaining)
        if not piece:
            break
        chunks.append(piece)
        remaining -= len(piece)
    return b"".join(chunks)


class FrameReader:
    """Frames of one file as numpy arrays, decoded by FFmpeg straight into a pipe."""

    def __init__(self, ffmpeg, path, seek, seconds, fps, width, height, pix_fmt, bytes_per_pixel, log):
        self.width, self.height = width, height
        self.frame_bytes = width * height * bytes_per_pixel
        args = ffmpeg_base(ffmpeg)
        if seek > 0:
            args += ["-ss", f"{seek:.6f}"]
        args += [
            "-i", str(path), "-t", f"{max(0.001, seconds):.6f}", "-an", "-sn",
            "-vf", f"fps={fps:.6f},scale={width}:{height}:flags=area",
            "-f", "rawvideo", "-pix_fmt", pix_fmt, "-",
        ]
        self.log = open(log, "wb")
        self.process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=self.log, creationflags=NO_WINDOW)

    def next(self):
        data = read_exact(self.process.stdout, self.frame_bytes)
        if len(data) < self.frame_bytes:
            return None
        return data

    def close(self):
        try:
            self.process.stdout.close()
        except Exception:
            pass
        try:
            self.process.wait(timeout=30)
        except Exception:
            self.process.kill()
        self.log.close()

    def failure(self):
        try:
            return Path(self.log.name).read_text(encoding="utf-8", errors="replace").strip().splitlines()[-1]
        except Exception:
            return ""


class MatteReader:
    """The matte, aligned to the source range: zeros before the matte starts and after it ends."""

    def __init__(self, ffmpeg, path, origin, start, seconds, fps, width, height, log):
        import numpy as np

        self.blank = np.zeros((height, width), dtype=np.uint16)
        self.shape = (height, width)
        seek = start - origin
        self.lead = 0
        if seek < 0:
            self.lead = int(round(-seek * fps))
            seek = 0.0
        remaining = seconds - self.lead / fps
        self.reader = None
        if remaining > 0:
            # A frame or two of slack: `-t` plus the fps filter can stop one frame short of the
            # range, and the source decides how many frames are read, never the matte.
            self.reader = FrameReader(ffmpeg, path, seek, remaining + 2.0 / fps, fps, width, height, "gray16le", 2, log)

    def next(self):
        import numpy as np

        if self.lead > 0:
            self.lead -= 1
            return self.blank
        if self.reader is None:
            return self.blank
        data = self.reader.next()
        if data is None:
            return self.blank
        return np.frombuffer(data, dtype=np.uint16).reshape(self.shape)

    def close(self):
        if self.reader is not None:
            self.reader.close()


def kernel(radius):
    import cv2

    size = 2 * max(0, int(radius)) + 1
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size))


def hard_mask(alpha, dilate):
    """Where the subject is, grown by `dilate` pixels: 1 inside, 0 outside, uint8."""
    import cv2
    import numpy as np

    mask = (alpha > int(0.2 * 65535)).astype(np.uint8)
    if dilate > 0:
        mask = cv2.dilate(mask, kernel(dilate))
    return mask


def soften(hard):
    """The hard mask with a feathered outer edge, still fully opaque inside the hard region."""
    import cv2
    import numpy as np

    grown = cv2.dilate(hard, kernel(FEATHER)).astype(np.float32)
    size = 2 * FEATHER + 1
    soft = cv2.GaussianBlur(grown, (size, size), 0)
    return np.clip(np.maximum(soft, hard.astype(np.float32)), 0.0, 1.0)


def seam_band(hard):
    import cv2

    outer = cv2.dilate(hard, kernel(SEAM_BAND))
    inner = cv2.erode(hard, kernel(SEAM_BAND))
    return (outer & (1 - inner)).astype(outer.dtype)


class Lama:
    """big-lama through simple-lama-inpainting when it is installed, else the TorchScript file directly."""

    def __init__(self, model_path, device):
        import torch

        os.environ["LAMA_MODEL"] = str(model_path)
        self.device = device
        self.simple = None
        self.model = None
        try:
            from simple_lama_inpainting import SimpleLama

            try:
                self.simple = SimpleLama(device=torch.device(device))
            except TypeError:
                self.simple = SimpleLama()
        except ImportError:
            self.model = torch.jit.load(str(model_path), map_location=device)
            self.model.eval()
            self.model.to(device)

    def __call__(self, image, mask):
        """`image` uint8 (h, w, 3); `mask` uint8 (h, w) with 1 where to repaint. Returns uint8 (h, w, 3)."""
        import numpy as np

        h, w = mask.shape
        if self.simple is not None:
            from PIL import Image

            result = self.simple(Image.fromarray(image), Image.fromarray((mask > 0).astype(np.uint8) * 255))
            return np.asarray(result)[:h, :w]
        import torch

        pad_h = (8 - h % 8) % 8
        pad_w = (8 - w % 8) % 8
        picture = np.pad(image.astype(np.float32) / 255.0, ((0, pad_h), (0, pad_w), (0, 0)), mode="symmetric")
        hole = np.pad((mask > 0).astype(np.float32), ((0, pad_h), (0, pad_w)), mode="symmetric")
        with torch.inference_mode():
            out = self.model(
                torch.from_numpy(picture).permute(2, 0, 1)[None].to(self.device),
                torch.from_numpy(hole)[None, None].to(self.device),
            )
            result = out[0].permute(1, 2, 0).float().cpu().numpy()
        return np.clip(result[:h, :w] * 255.0, 0, 255).astype(np.uint8)


def build_plate(frames, masks, emit):
    """Per-pixel median over the frames where the pixel was uncovered; `hole` marks the never-uncovered ones."""
    import numpy as np

    count, height, width, _ = frames.shape
    plate = np.zeros((height, width, 3), dtype=np.uint8)
    hole = np.zeros((height, width), dtype=np.uint8)
    covered = masks.astype(bool)
    rows = max(4, int(48 * MEGABYTE // max(1, count * width * 3 * 4)))
    for y0 in range(0, height, rows):
        y1 = min(height, y0 + rows)
        chunk = frames[:, y0:y1].astype(np.float32)
        chunk[covered[:, y0:y1]] = np.nan
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", category=RuntimeWarning)
            median = np.nanmedian(chunk, axis=0)
        empty = (~covered[:, y0:y1]).sum(axis=0) == 0
        median[empty] = 0.0
        plate[y0:y1] = np.clip(np.rint(median), 0, 255).astype(np.uint8)
        hole[y0:y1] = empty.astype(np.uint8)
        emit(0.45 + 0.08 * y1 / height, f"Building the clean plate {y1}/{height} rows")
    return plate, hole


def open_encoder(ffmpeg, output, width, height, fps, target_width, target_height, log):
    args = ffmpeg_base(ffmpeg) + [
        "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{width}x{height}", "-r", f"{fps:.6f}", "-i", "-",
        "-an",
    ]
    if (target_width, target_height) != (width, height):
        args += ["-vf", f"scale={target_width}:{target_height}:flags=lanczos"]
    args += ["-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-r", f"{fps:.6f}", "-movflags", "+faststart", str(output)]
    handle = open(log, "wb")
    process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=handle, creationflags=NO_WINDOW)
    return process, handle


def encoder_failure(log):
    """The encoder's last complaint, as a suffix for an error message; empty when it said nothing."""
    try:
        lines = Path(log.name).read_text(encoding="utf-8", errors="replace").strip().splitlines()
    except Exception:
        return ""
    return ": " + lines[-1] if lines else ""


def validate(request):
    for key in ("source", "matte", "output", "lamaModel", "ffmpeg"):
        if not isinstance(request.get(key), str) or not request[key]:
            raise ValueError(f"The erase request is missing '{key}'.")
    for key in ("source", "matte", "lamaModel", "ffmpeg"):
        if not Path(request[key]).is_file():
            raise ValueError(f"Missing file for '{key}': {request[key]}")
    start = float(request.get("start", 0.0))
    end = float(request.get("end", 0.0))
    fps = float(request.get("fps", 25.0))
    if not (start >= 0.0 and end > start and end - start <= 600.0):
        raise ValueError("Erase a range of up to 600 seconds with end after start.")
    if not 1.0 <= fps <= 120.0:
        raise ValueError("Frame rate must sit between 1 and 120.")
    dilate = int(request.get("dilate", 12) or 0)
    if not 0 <= dilate <= 64:
        raise ValueError("Dilate the matte by 0 to 64 pixels.")
    mode = request.get("mode") or "clean-plate"
    if mode not in ("clean-plate", "per-frame"):
        raise ValueError("mode must be clean-plate or per-frame.")
    max_width = int(request.get("maxWidth", 1280) or 1280)
    if not 256 <= max_width <= 4096:
        raise ValueError("maxWidth must sit between 256 and 4096.")
    return start, end, fps, dilate, mode, bool(request.get("refine", False)), max_width


def erase(request, emit):
    import numpy as np
    import torch
    from PIL import Image

    start, end, fps, dilate, mode, refine, max_width = validate(request)
    ffmpeg = request["ffmpeg"]
    source = request["source"]
    matte = request["matte"]
    origin = float(request.get("matteOrigin", 0.0) or 0.0)
    output_dir = Path(request["output"])
    output_dir.mkdir(parents=True, exist_ok=True)
    video_out = output_dir / "erased.mp4"
    plate_out = output_dir / "clean_plate.png"
    seconds = end - start
    expected = max(1, int(round(seconds * fps)))
    device = "cuda" if torch.cuda.is_available() else "cpu"

    emit(0.02, "Reading the source and matte dimensions")
    source_w, source_h = probe_size(ffmpeg, source, start)
    width, height = working_size(source_w, source_h, max_width)
    target_w, target_h = max(2, source_w // 2 * 2), max(2, source_h // 2 * 2)

    sample_count = min(expected, MAX_SAMPLES)
    sample_index = {int(i) for i in np.round(np.linspace(0, expected - 1, sample_count))}
    keep_all = expected <= MAX_SAMPLES

    # Pass A: walk the range once, keeping an even spread of frames for the median.
    samples = np.empty((len(sample_index), height, width, 3), dtype=np.uint8)
    sample_masks = np.empty((len(sample_index), height, width), dtype=np.uint8)
    filled = 0
    cache = [] if keep_all else None
    # The source is asked for a frame more than the range and capped at `expected`, so the clip
    # holds exactly round(seconds × fps) frames and drops onto the timeline 1:1.
    slack = seconds + 1.0 / fps
    reader = FrameReader(ffmpeg, source, start, slack, fps, width, height, "rgb24", 3, output_dir / "ffmpeg-source.log")
    mattes = MatteReader(ffmpeg, matte, origin, start, seconds, fps, width, height, output_dir / "ffmpeg-matte.log")
    total = 0
    try:
        while total < expected:
            data = reader.next()
            if data is None:
                break
            frame = np.frombuffer(data, dtype=np.uint8).reshape((height, width, 3))
            hard = hard_mask(mattes.next(), dilate)
            if total in sample_index and filled < len(sample_index):
                samples[filled] = frame
                sample_masks[filled] = hard
                filled += 1
            if cache is not None:
                cache.append((frame, hard))
            total += 1
            if total % 10 == 0 or total == expected:
                emit(0.05 + 0.4 * min(1.0, total / expected), f"Reading frames {total}/{expected} ({width}×{height})")
    finally:
        reader.close()
        mattes.close()
    if total == 0:
        raise RuntimeError("FFmpeg produced no frames from that range" + (": " + reader.failure() if reader.failure() else ""))
    if filled == 0:
        raise RuntimeError("No frames were sampled for the clean plate")
    samples = samples[:filled]
    sample_masks = sample_masks[:filled]

    plate, hole = build_plate(samples, sample_masks, emit)
    del samples, sample_masks
    never_seen = float(hole.mean())
    emit(0.54, f"Loading LaMa on {device}")
    lama = Lama(request["lamaModel"], device)
    if hole.any():
        import cv2

        grown = cv2.dilate(hole, kernel(HOLE_GROW))
        emit(0.56, f"LaMa is filling the {never_seen * 100:.1f}% of the plate the subject never uncovered")
        plate = lama(plate, grown)
    Image.fromarray(plate).save(plate_out, compress_level=4)
    emit(0.62, "Clean plate saved; rendering the erased range")

    # Pass B: composite every frame over the plate and hand it to the encoder at source size.
    encoder, encoder_log = open_encoder(ffmpeg, video_out, width, height, fps, target_w, target_h, output_dir / "ffmpeg-encode.log")
    plate_f = plate.astype(np.float32)
    reader = None
    mattes = None
    if cache is None:
        reader = FrameReader(ffmpeg, source, start, slack, fps, width, height, "rgb24", 3, output_dir / "ffmpeg-source-2.log")
        mattes = MatteReader(ffmpeg, matte, origin, start, seconds, fps, width, height, output_dir / "ffmpeg-matte-2.log")
    written = 0
    try:
        index = 0
        while index < total:
            if cache is not None:
                frame, hard = cache[index]
            else:
                data = reader.next()
                if data is None:
                    break
                frame = np.frombuffer(data, dtype=np.uint8).reshape((height, width, 3))
                hard = hard_mask(mattes.next(), dilate)
            index += 1
            if hard.any():
                soft = soften(hard)[..., None]
                out = np.clip(np.rint(frame.astype(np.float32) * (1.0 - soft) + plate_f * soft), 0, 255).astype(np.uint8)
                if mode == "per-frame":
                    out = lama(out, hard)
                elif refine:
                    band = seam_band(hard)
                    if band.any():
                        repainted = lama(out, band)
                        out = np.where(band[..., None] > 0, repainted, out)
            else:
                out = np.ascontiguousarray(frame)
            try:
                encoder.stdin.write(out.tobytes())
            except (BrokenPipeError, OSError) as error:
                raise RuntimeError("FFmpeg stopped taking frames" + encoder_failure(encoder_log)) from error
            written += 1
            if written % 10 == 0 or written == total:
                emit(0.62 + 0.36 * min(1.0, written / max(1, total)), f"Erasing frame {written}/{total}")
    finally:
        try:
            encoder.stdin.close()
        except Exception:
            pass
        code = encoder.wait()
        encoder_log.close()
        if reader is not None:
            reader.close()
        if mattes is not None:
            mattes.close()
    if code != 0 or not video_out.is_file():
        raise RuntimeError("FFmpeg could not encode the erased clip" + encoder_failure(encoder_log))
    if written == 0:
        raise RuntimeError("No frames were rendered")
    summary = {
        "output": str(video_out), "cleanPlate": str(plate_out), "frames": written, "fps": fps,
        "width": target_w, "height": target_h, "workingWidth": width, "workingHeight": height,
        "neverUncovered": never_seen, "mode": mode, "refine": refine, "dilate": dilate, "device": device,
    }
    (output_dir / "result.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    emit(1, "Clean plate ready", **summary)


def main():
    if len(sys.argv) != 2:
        print("usage: magic_erase.py request.json", file=sys.stderr)
        sys.exit(2)
    try:
        erase(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")), emit)
    except Exception:
        # The host surfaces the tail of stderr as the failure message; the
        # traceback names the failing call where a bare str(error) would not.
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
