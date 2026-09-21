"""Who is where, frame by frame: RF-DETR Nano finds the people, ByteTrack keeps
their names straight while they move.

RF-DETR Nano (Apache 2.0, 30M params, 384px) beats YOLO11-N on COCO while
running fine on a CPU; supervision's ByteTrack (MIT) associates its boxes into
stable identities with a Kalman filter, so a person who walks behind a chair
comes back with the same id instead of a new one. No ReID embedding, no GPU
requirement, no copyleft: detector and tracker are both permissively licensed.

Reads the JPEG frames FFmpeg pulled (see person.rs), writes person-tracks.json:
per-track boxes in 0..1 frame units, `at` in source seconds. The reframe engine
(src/lib/reframe.ts) interpolates between these samples, so 3 fps is plenty.
"""

PACKAGES = ("rfdetr==1.3.0", "supervision==0.30.4")

# COCO person class. Everything else in the frame is not our business.
PERSON_CLASS = 0


def ensure_packages(emit):
    import importlib
    import subprocess
    import sys

    missing = []
    for package in PACKAGES:
        name = package.split("==")[0]
        try:
            importlib.import_module(name)
        except ImportError:
            missing.append(package)
    try:
        import supervision as sv

        if not (hasattr(sv, "ByteTrack") and hasattr(sv.ByteTrack, "update_with_detections")):
            missing.append("supervision==0.30.4")
    except ImportError:
        pass
    if not missing:
        return
    emit(0.02, f"Installing {', '.join(missing)} into the media Python (once)")
    process = subprocess.run(
        [sys.executable, "-m", "pip", "install", "--disable-pip-version-check", *missing],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=1800,
    )
    if process.returncode != 0:
        raise RuntimeError(
            "Could not install the tracking packages. Install them by hand and retry: "
            f"{sys.executable} -m pip install {' '.join(missing)}\n{process.stdout[-2000:]}"
        )


def load_model(weights_path):
    from rfdetr import RFDETRNano

    if weights_path:
        return RFDETRNano(pretrain_weights=weights_path)
    return RFDETRNano()


def track_people(request, emit):
    import json
    from pathlib import Path

    import numpy as np
    import supervision as sv
    import torch
    from PIL import Image

    if not hasattr(sv, "ByteTrack"):
        raise RuntimeError("The installed supervision has no ByteTrack. Re-run the person-track install.")
    from rfdetr import RFDETRNano  # noqa: F401  (import checked; constructor below)

    root = Path(request["folder"])
    paths = sorted((root / "frames").glob("*.jpg"))
    if not paths or len(paths) > 3600:
        raise ValueError("Invalid frame sequence")
    fps = float(request["fps"])
    start = float(request.get("from", 0.0))
    threshold = float(request.get("threshold", 0.45))
    if not 0.05 <= threshold <= 0.95:
        raise ValueError("Detection threshold must sit between 0.05 and 0.95")

    weights = request.get("weights") or None
    if weights and not Path(weights).is_file():
        raise ValueError("The configured tracker weights are missing; re-download them in Settings.")
    emit(0.03, "Loading RF-DETR Nano")
    model = load_model(weights)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    if hasattr(model, "optimize_for_inference"):
        try:
            model.optimize_for_inference()
        except Exception:
            pass
    emit(0.06, f"Detecting people ({device}, {len(paths)} frames)")
    tracker = sv.ByteTrack()
    tracks = {}
    width, height = Image.open(paths[0]).size
    for index, path in enumerate(paths):
        image = Image.open(path).convert("RGB")
        detections = model.predict(image, threshold=threshold)
        people = detections[detections.class_id == PERSON_CLASS] if len(detections) else detections
        tracked = tracker.update_with_detections(people) if len(people) else people
        if len(tracked):
            boxes = np.array(tracked.xyxy, dtype=float)
            boxes[:, (0, 2)] /= width
            boxes[:, (1, 3)] /= height
            for box, track_id in zip(boxes.tolist(), tracked.tracker_id.tolist()):
                x1, y1, x2, y2 = box
                tracks.setdefault(int(track_id), []).append({
                    "at": start + index / fps,
                    "x": max(0.0, x1), "y": max(0.0, y1),
                    "width": max(0.0, min(1.0, x2) - max(0.0, x1)),
                    "height": max(0.0, min(1.0, y2) - max(0.0, y1)),
                })
        if index % 12 == 0 or index == len(paths) - 1:
            emit(0.06 + 0.88 * (index + 1) / len(paths), f"Tracking frame {index + 1}/{len(paths)}")
    # Single-frame ghosts are detector hiccups, not people.
    kept = [
        {"id": f"person-{track_id}", "boxes": sorted(boxes, key=lambda b: b["at"])}
        for track_id, boxes in sorted(tracks.items())
        if len(boxes) >= 2
    ]
    (root / "person-tracks.json").write_text(json.dumps({
        "assetId": request.get("asset_id", ""),
        "model": "rf-detr-nano+bytetrack",
        "fps": fps,
        "frames": len(paths),
        "width": width,
        "height": height,
        "tracks": kept,
    }), encoding="utf-8")
    (root / "person-track-request.json").write_text(json.dumps(
        {key: request[key] for key in ("from", "fps", "threshold") if key in request}, indent=2), encoding="utf-8")
    emit(1.0, f"Tracked {len(kept)} {'person' if len(kept) == 1 else 'people'}")


def install_tracker(request, emit):
    """One-click setup for Settings: packages, weights, and a smoke test."""
    import json
    from pathlib import Path

    import numpy as np
    from PIL import Image

    ensure_packages(emit)
    emit(0.3, "Downloading RF-DETR Nano weights (once, ~120 MB)")
    from rfdetr import RFDETRNano

    model = RFDETRNano()
    emit(0.7, "Smoke test: one blank frame through the detector")
    blank = Image.fromarray(np.zeros((384, 384, 3), dtype=np.uint8))
    model.predict(blank, threshold=0.9)
    output = Path(request["output"])
    output.mkdir(parents=True, exist_ok=True)
    (output / "helios-install.json").write_text(json.dumps({
        "model": "rf-detr-nano",
        "packages": list(PACKAGES),
        "license": "Apache-2.0 (detector weights and code) · MIT (tracker)",
    }, indent=2), encoding="utf-8")
    emit(1.0, "Person tracker installed and verified")
