"""Point and planar tracking for motion graphics: a callout that stays pinned to a hand, a label
that follows a face, a screen replacement that holds on a phone.

OpenCV pyramidal Lucas–Kanade (BSD/Apache, CPU, no model download) with a forward–backward
check on every step, so a point that slides off its feature is caught instead of drifting:

  · point  — each requested point is followed on its own. A step whose forward–backward error
             is over `fb_max` pixels is not trusted: the point is carried by the median motion of
             good features around it instead (a local "support" flow), and flagged low-confidence.
  · planar — features inside a region are followed together and a similarity transform
             (translation, uniform scale, rotation) is fitted per frame with RANSAC; the region's
             centre, scale and rotation are reported. Robust to a hand or head moving partly out.

Reads the JPEG frames FFmpeg pulled (see lib.rs `point_track_start`), writes point-tracks.json:
  { "fps": .., "from": .., "points": [ { "samples": [ {at, x, y, confidence} ] } ],
    "planar": { "samples": [ {at, x, y, scale, rotation, confidence} ] } | null }
x / y are fractions of the frame, `at` source seconds.
"""
import json
import math
from pathlib import Path


def emit_default(progress, message, **extra):
    print(json.dumps({"progress": progress, "message": message, **extra}), flush=True)


def _load(paths):
    import cv2
    for path in paths:
        image = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
        if image is None:
            raise RuntimeError(f"cannot read frame {path}")
        yield image


def track(request, emit=emit_default):
    import cv2
    import numpy as np

    folder = Path(request["folder"])
    frames = sorted((folder / "frames").glob("*.jpg"))
    if len(frames) < 2:
        raise RuntimeError("need at least two frames to track")
    fps = float(request["fps"])
    start = float(request["from"])
    fb_max = float(request.get("fbMax", 1.5))
    lk = dict(winSize=(31, 31), maxLevel=4, criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 40, 0.01))

    images = list(_load(frames))
    h, w = images[0].shape[:2]
    requested = [(float(p[0]) * w, float(p[1]) * h) for p in request.get("points", [])]
    region = request.get("region")

    def flow(a, b, pts):
        if len(pts) == 0:
            return pts, np.zeros((0,), bool), np.zeros((0,))
        p0 = np.float32(pts).reshape(-1, 1, 2)
        p1, st1, _ = cv2.calcOpticalFlowPyrLK(a, b, p0, None, **lk)
        p0r, st2, _ = cv2.calcOpticalFlowPyrLK(b, a, p1, None, **lk)
        fb = np.linalg.norm((p0 - p0r).reshape(-1, 2), axis=1)
        good = (st1.reshape(-1) == 1) & (st2.reshape(-1) == 1) & (fb < fb_max)
        return p1.reshape(-1, 2), good, fb

    # ── points ────────────────────────────────────────────────────────────
    point_tracks = []
    current = np.float32(requested).reshape(-1, 2) if requested else np.zeros((0, 2), np.float32)
    confidence = np.ones(len(current))
    samples = [[{"at": start, "x": float(x / w), "y": float(y / h), "confidence": 1.0}] for x, y in current]
    for i in range(1, len(images)):
        a, b = images[i - 1], images[i]
        if len(current):
            moved, good, _ = flow(a, b, current)
            # Support flow for the points that failed: median motion of good corners nearby.
            corners = cv2.goodFeaturesToTrack(a, maxCorners=400, qualityLevel=0.01, minDistance=8)
            support_from = corners.reshape(-1, 2) if corners is not None else np.zeros((0, 2), np.float32)
            support_to, support_good, _ = flow(a, b, support_from)
            for k in range(len(current)):
                if good[k]:
                    current[k] = moved[k]
                    confidence[k] = min(1.0, confidence[k] * 0.995 + 0.005)
                    continue
                if len(support_from):
                    d = np.linalg.norm(support_from - current[k], axis=1)
                    near = support_good & (d < max(w, h) * 0.08)
                    if near.sum() >= 3:
                        current[k] = current[k] + np.median(support_to[near] - support_from[near], axis=0)
                        confidence[k] *= 0.85
                        continue
                confidence[k] *= 0.6
            for k in range(len(current)):
                samples[k].append({"at": start + i / fps, "x": float(np.clip(current[k][0] / w, -0.5, 1.5)), "y": float(np.clip(current[k][1] / h, -0.5, 1.5)), "confidence": float(confidence[k])})
        if i % 10 == 0:
            emit(0.1 + 0.6 * i / len(images), f"Tracking frame {i}/{len(images)}")
    point_tracks = [{"samples": s} for s in samples]

    # ── planar ────────────────────────────────────────────────────────────
    planar = None
    if region:
        rx, ry, rw, rh = (float(region[0]) * w, float(region[1]) * h, float(region[2]) * w, float(region[3]) * h)
        mask = np.zeros_like(images[0])
        mask[int(ry):int(ry + rh), int(rx):int(rx + rw)] = 255
        pts = cv2.goodFeaturesToTrack(images[0], maxCorners=300, qualityLevel=0.01, minDistance=5, mask=mask)
        if pts is None or len(pts) < 6:
            raise RuntimeError("the region has too little texture to track; pick a region with edges or detail")
        ref = pts.reshape(-1, 2).astype(np.float32)
        live = ref.copy()
        alive = np.ones(len(ref), bool)
        centre0 = np.array([rx + rw / 2, ry + rh / 2], np.float32)
        out = [{"at": start, "x": float(centre0[0] / w), "y": float(centre0[1] / h), "scale": 1.0, "rotation": 0.0, "confidence": 1.0}]
        for i in range(1, len(images)):
            moved, good, _ = flow(images[i - 1], images[i], live)
            alive &= good
            live = moved
            conf = float(alive.mean())
            if alive.sum() >= 4:
                matrix, inliers = cv2.estimateAffinePartial2D(ref[alive], live[alive], method=cv2.RANSAC, ransacReprojThreshold=3.0)
            else:
                matrix = None
            if matrix is None:
                previous = out[-1]
                out.append({**previous, "at": start + i / fps, "confidence": previous["confidence"] * 0.5})
                continue
            scale = math.hypot(matrix[0, 0], matrix[1, 0])
            rotation = math.degrees(math.atan2(matrix[1, 0], matrix[0, 0]))
            centre = matrix @ np.array([centre0[0], centre0[1], 1.0])
            out.append({"at": start + i / fps, "x": float(centre[0] / w), "y": float(centre[1] / h), "scale": float(scale), "rotation": float(rotation), "confidence": conf})
            # Re-seed when too many features are lost, keeping the fitted transform continuous.
            if alive.mean() < 0.35:
                inv_region = cv2.transform(np.float32([[[rx, ry]], [[rx + rw, ry]], [[rx + rw, ry + rh]], [[rx, ry + rh]]]), matrix).reshape(-1, 2)
                m2 = np.zeros_like(images[i])
                cv2.fillConvexPoly(m2, inv_region.astype(np.int32), 255)
                fresh = cv2.goodFeaturesToTrack(images[i], maxCorners=300, qualityLevel=0.01, minDistance=5, mask=m2)
                if fresh is not None and len(fresh) >= 6:
                    live = fresh.reshape(-1, 2).astype(np.float32)
                    inverse = cv2.invertAffineTransform(matrix)
                    ref = cv2.transform(live.reshape(-1, 1, 2), inverse).reshape(-1, 2)
                    alive = np.ones(len(live), bool)
            if i % 10 == 0:
                emit(0.7 + 0.25 * i / len(images), f"Planar tracking frame {i}/{len(images)}")
        planar = {"samples": out}

    result = {"fps": fps, "from": start, "width": w, "height": h, "points": point_tracks, "planar": planar}
    (folder / "point-tracks.json").write_text(json.dumps(result), encoding="utf-8")
    emit(1, "Tracking done", tracks=len(point_tracks), planar=planar is not None)
    return result


if __name__ == "__main__":
    import sys
    track(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")))
