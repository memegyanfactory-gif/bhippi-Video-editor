"""Faces over time: YuNet finds them, IoU tracking keeps each one's identity.

YuNet (OpenCV Zoo, MIT licence; face_detection_yunet_2023mar.onnx, 230 KB) runs through
OpenCV's FaceDetectorYN on the CPU — no GPU, no extra packages. It returns a box, five
landmarks (eyes, nose tip, mouth corners) and a score per face. Faces are linked across frames
greedily by overlap (IoU), with a centre-distance fallback for fast moves and a short gap
allowance so a blink of missed detection does not split a track. InsightFace is deliberately not
used: its models are non-commercial.

Request (JSON file named on the command line):
  folder     holds frames/00001.jpg … (Bhippi pulls them at `fps`)
  from       source seconds of the first frame
  fps        frames per second of the sequence
  model      path to face_detection_yunet_2023mar.onnx (downloaded here on first use)
  result     JSON file to write the answer to
  threshold  detection score floor (default 0.6)

Answer: {fps, from, frames, width, height, model, tracks: [{id, frames: [{t, x, y, width, height,
score, mouth: {x, y}}]}]} — coordinates are frame fractions, `t` source seconds, `mouth` the
midpoint of the two mouth-corner landmarks.
"""
import json
import os
import sys
import traceback
from pathlib import Path

MODEL_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
MODEL_SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
MAX_FRAMES = 3600


def emit(progress, message):
    print(json.dumps({"progress": progress, "message": message}), flush=True)


def sha256(path):
    import hashlib

    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def ensure_model(path):
    import urllib.error
    import urllib.request

    path = Path(path)
    if path.is_file() and sha256(path) == MODEL_SHA256:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    emit(0.02, "Downloading the YuNet face model (once, 230 KB)")
    try:
        request = urllib.request.Request(MODEL_URL, headers={"User-Agent": "Bhippi face tracker"})
        with urllib.request.urlopen(request, timeout=60) as response:
            data = response.read()
    except (urllib.error.URLError, OSError) as error:
        raise RuntimeError(f"Could not download the YuNet face model: {error}. Check the connection and retry.") from error
    import hashlib

    if hashlib.sha256(data).hexdigest() != MODEL_SHA256:
        raise RuntimeError("The downloaded YuNet model does not match the pinned release; retry later.")
    part = path.with_name(path.name + ".part")
    part.write_bytes(data)
    os.replace(part, path)


def iou(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    left, top = max(ax, bx), max(ay, by)
    right, bottom = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    inter = max(0.0, right - left) * max(0.0, bottom - top)
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def link(detections, max_gap):
    """Greedy IoU association. `detections` is one list per frame of dicts with a `box` (x, y, w, h
    in pixels). Returns tracks as lists of (frame index, detection)."""
    tracks = []  # {"last": index, "box": box, "items": [...]}
    for index, faces in enumerate(detections):
        live = [track for track in tracks if index - track["last"] <= max_gap]
        pairs = sorted(
            ((iou(track["box"], face["box"]), t, f) for t, track in enumerate(live) for f, face in enumerate(faces)),
            key=lambda pair: -pair[0],
        )
        used_tracks, used_faces = set(), set()
        for overlap, t, f in pairs:
            if overlap < 0.25:
                break
            if t in used_tracks or f in used_faces:
                continue
            used_tracks.add(t)
            used_faces.add(f)
            live[t]["items"].append((index, faces[f]))
            live[t]["box"], live[t]["last"] = faces[f]["box"], index
        # A fast move leaves no overlap: fall back to the nearest centre within half a face.
        for f, face in enumerate(faces):
            if f in used_faces:
                continue
            fx, fy, fw, fh = face["box"]
            best, best_distance = None, None
            for t, track in enumerate(live):
                if t in used_tracks:
                    continue
                tx, ty, tw, th = track["box"]
                distance = ((fx + fw / 2) - (tx + tw / 2)) ** 2 + ((fy + fh / 2) - (ty + th / 2)) ** 2
                reach = 0.6 * max(fw, tw)
                if distance <= reach * reach and (best_distance is None or distance < best_distance):
                    best, best_distance = t, distance
            if best is not None:
                used_tracks.add(best)
                used_faces.add(f)
                live[best]["items"].append((index, face))
                live[best]["box"], live[best]["last"] = face["box"], index
            else:
                tracks.append({"last": index, "box": face["box"], "items": [(index, face)]})
    return [track["items"] for track in tracks]


def track_faces(request):
    import cv2

    root = Path(request["folder"])
    paths = sorted((root / "frames").glob("*.jpg"))
    if not paths or len(paths) > MAX_FRAMES:
        raise ValueError("Invalid frame sequence")
    fps = float(request["fps"])
    start = float(request.get("from", 0.0))
    threshold = float(request.get("threshold", 0.6))
    if not 0.1 <= threshold <= 0.99:
        raise ValueError("Detection threshold must sit between 0.1 and 0.99")
    model = request["model"]
    ensure_model(model)
    first = cv2.imread(str(paths[0]))
    if first is None:
        raise RuntimeError(f"cannot read frame {paths[0]}")
    height, width = first.shape[:2]
    detector = cv2.FaceDetectorYN.create(model, "", (width, height), threshold, 0.3, 5000)
    emit(0.05, f"Finding faces in {len(paths)} frames")
    detections = []
    for index, path in enumerate(paths):
        image = first if index == 0 else cv2.imread(str(path))
        if image is None:
            raise RuntimeError(f"cannot read frame {path}")
        if image.shape[:2] != (height, width):
            image = cv2.resize(image, (width, height))
        _, found = detector.detect(image)
        faces = []
        for row in ([] if found is None else found):
            x, y, w, h = (float(v) for v in row[:4])
            if w <= 1 or h <= 1:
                continue
            faces.append({
                "box": (x, y, w, h),
                "mouth": ((float(row[10]) + float(row[12])) / 2, (float(row[11]) + float(row[13])) / 2),
                "score": float(row[14]),
            })
        detections.append(faces)
        if index % 10 == 0 or index == len(paths) - 1:
            emit(0.05 + 0.9 * (index + 1) / len(paths), f"Frame {index + 1}/{len(paths)}")
    max_gap = max(2, int(round(fps * 0.5)))
    linked = link(detections, max_gap)
    # A face seen once in a long run is a false positive, not a person.
    floor = 1 if len(paths) < 3 else 2
    kept = [items for items in linked if len(items) >= floor]
    kept.sort(key=lambda items: items[0][0])
    clamp = lambda value: min(1.0, max(0.0, value))  # noqa: E731
    tracks = []
    for number, items in enumerate(kept):
        frames = []
        for index, face in items:
            x, y, w, h = face["box"]
            left, top = clamp(x / width), clamp(y / height)
            frames.append({
                "t": round(start + index / fps, 4),
                "x": left,
                "y": top,
                "width": clamp((x + w) / width) - left,
                "height": clamp((y + h) / height) - top,
                "score": round(face["score"], 4),
                "mouth": {"x": clamp(face["mouth"][0] / width), "y": clamp(face["mouth"][1] / height)},
            })
        tracks.append({"id": number, "frames": frames})
    answer = {"fps": fps, "from": start, "frames": len(paths), "width": width, "height": height, "model": "yunet-2023mar", "tracks": tracks}
    Path(request["result"]).write_text(json.dumps(answer), encoding="utf-8")
    emit(1.0, f"Tracked {len(tracks)} face{'s' if len(tracks) != 1 else ''}")
    return answer


if __name__ == "__main__":
    try:
        track_faces(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")))
    except Exception:
        traceback.print_exc()
        sys.exit(1)
