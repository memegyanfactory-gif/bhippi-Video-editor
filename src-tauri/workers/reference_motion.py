"""Motion profile of a reference film (docs/REFERENCE-FILMS-PLAN.md P10, B4).

Usage: python reference_motion.py request.json
  request: {"video": path, "out": dir, "ffmpeg": path, "maxSeconds": 180}

Measures what the frame-by-frame study measured by hand, so analyze_reference_video can hand the AI
numbers instead of adjectives:
  · cuts, and HIDDEN cuts (under a blur, a white or black flash, or a whip);
  · FOREGROUND SWAPS: the content changes while the background and palette stay (the SaaS films'
    "the background never cuts");
  · moves: bursts of motion with a cubic-bezier ease FITTED to their progress curve and the nearest
    named Helios ease;
  · a camera track (pan / zoom per 0.1 s) and how much of the film the camera moves;
  · ones vs twos: whether moving passages hold every other frame (character animation on twos);
  · the audio as waveform peaks in Helios's own format (peaks.bin: [peak, rms] bytes at 100 per
    second), so the app's tempo code (beats.ts) finds the tempo grid.
Progress lines are {"progress", "message"} JSON; the result is <out>/profile.json.
"""
import json
import math
import os
import subprocess
import sys

import cv2
import numpy as np

req = json.load(open(sys.argv[1], encoding="utf-8"))
video, out = req["video"], req["out"]
os.makedirs(out, exist_ok=True)
max_seconds = float(req.get("maxSeconds", 180))


def say(p, m):
    print(json.dumps({"progress": round(p, 3), "message": m}), flush=True)


# The named eases of src/motion/anim.ts (cubic-beziers only).
NAMED = {
    "linear": [0, 0, 1, 1], "ease-in-out": [0.42, 0, 0.58, 1], "cubic-out": [0.33, 1, 0.68, 1], "cubic-in": [0.32, 0, 0.67, 0],
    "cubic-in-out": [0.65, 0, 0.35, 1], "quart-out": [0.25, 1, 0.5, 1], "expo-out": [0.16, 1, 0.3, 1], "expo-in": [0.7, 0, 0.84, 0],
    "expo-in-out": [0.87, 0, 0.13, 1], "back-out": [0.34, 1.56, 0.64, 1], "house": [0.25, 0, 0, 1], "settle": [0.187, 0.368, 0.123, 0.981],
    "emphasized": [0.05, 0.7, 0.1, 1], "rise": [0.044, 0.419, 0.044, 0.991], "push": [0.57, 0, 0.41, 0.98], "creep": [1, 0.093, 0.856, 0.033],
    "snap-settle": [0.079, 0.602, 0.182, 0.958], "resolve": [0.162, 0.495, 0.117, 1.005], "card-zoom": [0.15, 0.46, 0.43, 1],
}


def bezier_curve(p, xs):
    """y(x) of a CSS cubic-bezier at the given xs (Newton on x(t))."""
    x1, y1, x2, y2 = p
    out_y = []
    for x in xs:
        t = x
        for _ in range(8):
            bx = 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t ** 2 * x2 + t ** 3 - x
            d = 3 * (1 - t) ** 2 * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t ** 2 * (1 - x2)
            if abs(d) < 1e-6:
                break
            t = min(1, max(0, t - bx / d))
        out_y.append(3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t ** 2 * y2 + t ** 3)
    return np.array(out_y)


GRID = [(x1, y1, x2, y2) for x1 in np.linspace(0, 1, 6) for y1 in np.linspace(-0.2, 1.4, 9) for x2 in np.linspace(0, 1, 6) for y2 in np.linspace(0.6, 1.2, 4)]
XS = np.linspace(0, 1, 24)
GRID_CURVES = [(g, bezier_curve(g, XS)) for g in GRID]
NAMED_CURVES = {k: bezier_curve(v, XS) for k, v in NAMED.items()}


def fit_ease(progress):
    """Best cubic-bezier for a 0→1 progress curve, and the nearest named ease."""
    ys = np.interp(XS, np.linspace(0, 1, len(progress)), progress)
    best = min(GRID_CURVES, key=lambda gc: float(np.mean((gc[1] - ys) ** 2)))
    named = min(NAMED_CURVES.items(), key=lambda kv: float(np.mean((kv[1] - ys) ** 2)))
    return [round(float(v), 3) for v in best[0]], named[0], round(float(np.sqrt(np.mean((named[1] - ys) ** 2))), 3)


# ---------------------------------------------------------------- per-frame metrics
cap = cv2.VideoCapture(video)
fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
limit = int(min(total or 10 ** 9, max_seconds * fps))
metrics = []
prev = None
prev_hist = None
feat = dict(maxCorners=200, qualityLevel=0.01, minDistance=8, blockSize=7)
i = 0
while i < limit:
    ok, frame = cap.read()
    if not ok:
        break
    small = cv2.cvtColor(cv2.resize(frame, (320, 180), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(cv2.resize(frame, (160, 90)), cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1, 2], None, [16, 8, 8], [0, 180, 0, 256, 0, 256])
    cv2.normalize(hist, hist)
    m = {"t": i / fps, "luma": float(small.mean()), "sharp": float(cv2.Laplacian(small, cv2.CV_64F).var())}
    if prev is not None:
        d = cv2.absdiff(small, prev)
        m["diff"] = float(d.mean())
        m["moving"] = float((d > 12).mean())
        m["corr"] = float(cv2.compareHist(prev_hist, hist, cv2.HISTCMP_CORREL))
        dx = dy = 0.0
        scale = 1.0
        pts = cv2.goodFeaturesToTrack(prev, mask=None, **feat)
        if pts is not None and len(pts) >= 12:
            nxt, st, _ = cv2.calcOpticalFlowPyrLK(prev, small, pts, None, winSize=(21, 21), maxLevel=3)
            g0 = pts[st.flatten() == 1]
            g1 = nxt[st.flatten() == 1]
            if len(g0) >= 12:
                M, inl = cv2.estimateAffinePartial2D(g0, g1, method=cv2.RANSAC, ransacReprojThreshold=1.5)
                if M is not None and inl.sum() / max(1, len(g0)) >= 0.5:
                    scale = math.hypot(M[0, 0], M[1, 0])
                    dx = float(M[0, 0] * 160 + M[0, 1] * 90 + M[0, 2] - 160) * 6
                    dy = float(M[1, 0] * 160 + M[1, 1] * 90 + M[1, 2] - 90) * 6
        m.update(dx=dx, dy=dy, zoom=scale)
    else:
        m.update(diff=0.0, moving=0.0, corr=1.0, dx=0.0, dy=0.0, zoom=1.0)
    metrics.append(m)
    prev, prev_hist = small, hist
    i += 1
    if i % 120 == 0:
        say(0.05 + 0.7 * i / max(1, limit), f"frame {i}/{limit}")
cap.release()
N = len(metrics)
if N < 3:
    raise SystemExit("The video has too few frames to measure")
diff = np.array([m["diff"] for m in metrics])
moving = np.array([m["moving"] for m in metrics])
corr = np.array([m["corr"] for m in metrics])
sharp = np.array([m["sharp"] for m in metrics])
luma = np.array([m["luma"] for m in metrics])
cam_speed = np.array([math.hypot(m["dx"], m["dy"]) for m in metrics])

# ---------------------------------------------------------------- cuts and hidden cuts
cuts = []
for k in range(1, N):
    local = diff[max(1, k - 8):k]
    base = np.median(local) if len(local) else 0
    hard = diff[k] > max(18.0, 4.0 * base + 6) and corr[k] < 0.85
    jump = corr[k] < 0.55 and diff[k] > 8
    if (hard or jump) and (not cuts or k - cuts[-1] >= 4):
        cuts.append(k)
med_sharp = float(np.median(sharp)) or 1.0
cut_list = []
for k in cuts:
    a, b = max(0, k - 4), min(N, k + 5)
    kind = "hard"
    # A flash must stand out from the shots around it (a white-background film is not a white-out).
    around = np.median(luma[max(0, k - 15):min(N, k + 16)])
    if luma[a:b].max() >= 235 and luma[a:b].max() - around > 25:
        kind = "white-out"
    elif luma[a:b].min() <= 14 and around - luma[a:b].min() > 25:
        kind = "black"
    elif sharp[a:b].min() < 0.35 * med_sharp:
        kind = "blur-bridge"
    elif cam_speed[a:b].max() > 1920 * 0.06:
        kind = "whip"
    cut_list.append({"t": round(k / fps, 3), "kind": kind})

# ---------------------------------------------------------------- foreground swaps
cut_set = set(cuts)
swaps = []
for k in range(2, N - 2):
    if any(abs(k - c) <= 3 for c in cut_set):
        continue
    if moving[k] > 0.18 and corr[k] > 0.9 and moving[k] >= moving[k - 1] and moving[k] >= moving[k + 1] and cam_speed[k] < 40:
        if not swaps or k - swaps[-1] > 8:
            swaps.append(k)

# ---------------------------------------------------------------- moves with fitted eases
floor = max(0.004, float(np.percentile(moving, 30)) * 1.5)
moves = []
k = 1
while k < N:
    if moving[k] > floor and k not in cut_set:
        a = k
        while k < N and moving[k] > floor * 0.6 and (k == a or k not in cut_set):
            k += 1
        b = k - 1
        if 3 <= b - a + 1 <= fps * 4:
            # Progress: the camera's travel when the camera moves (exact), otherwise the moving area (a proxy).
            travel = cam_speed[a:b + 1]
            basis = "camera" if travel.sum() > 60 else "energy"
            seg = travel if basis == "camera" else moving[a:b + 1]
            prog = np.cumsum(seg)
            prog = (prog - prog[0]) / max(1e-9, prog[-1] - prog[0])
            ease, named, err = fit_ease(prog)
            # On twos: inside the move, every other frame barely changes.
            d = diff[a:b + 1]
            still = d < 0.15 * max(1e-6, d.mean())
            twos = len(d) >= 6 and 0.35 <= still.mean() <= 0.65 and np.mean(still[1:] != still[:-1]) > 0.6
            moves.append({"t": round(a / fps, 3), "frames": int(b - a + 1), "ease": ease, "named": named, "fitError": err, "basis": basis, "twos": bool(twos)})
    else:
        k += 1

# ---------------------------------------------------------------- camera track
step = max(1, int(round(fps / 10)))
x = y = 0.0
z = 1.0
track = []
for idx, m in enumerate(metrics):
    x += m["dx"]
    y += m["dy"]
    z *= m["zoom"]
    if idx in cut_set:
        x = y = 0.0
        z = 1.0
    if idx % step == 0:
        track.append([round(m["t"], 2), round(x, 1), round(y, 1), round(z, 4)])
camera_share = float(np.mean((cam_speed > 3) | (np.abs(np.array([m["zoom"] for m in metrics]) - 1) > 0.002)))
say(0.8, "audio")

# ---------------------------------------------------------------- audio → Helios peaks (100 buckets/s, [peak, rms])
peaks_path = os.path.join(out, "peaks.bin")
duration = N / fps
try:
    raw = subprocess.run([req.get("ffmpeg", "ffmpeg"), "-hide_banner", "-loglevel", "error", "-nostdin", "-i", video, "-t", str(duration), "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "-"],
                         check=True, capture_output=True, creationflags=0x08000000 if os.name == "nt" else 0).stdout
    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    buckets = int(math.ceil(duration * 100))
    samples = np.pad(samples, (0, max(0, buckets * 80 - len(samples))))[: buckets * 80].reshape(buckets, 80)
    peak = np.clip(np.round(np.abs(samples).max(axis=1) * 255), 0, 255).astype(np.uint8)
    rms = np.clip(np.round(np.sqrt((samples ** 2).mean(axis=1)) * 255), 0, 255).astype(np.uint8)
    np.stack([peak, rms], axis=1).reshape(-1).tofile(peaks_path)
    has_audio = bool(rms.max() > 2)
except Exception as error:  # noqa: BLE001 - a silent reference is fine
    has_audio = False
    print(f"no audio: {error}", file=sys.stderr)

# ---------------------------------------------------------------- summary
# One transition can cut two or three times in a few frames (a blur-bridge, a flash): count it once.
events = []
for e in sorted([c["t"] for c in cut_list] + [round(s / fps, 3) for s in swaps]):
    if not events or e - events[-1] > 0.35:
        events.append(e)
gaps = np.diff([0.0] + events + [duration]) if events else np.array([duration])
move_frames = np.array([mv["frames"] for mv in moves]) if moves else np.array([0])
named_share = {}
for mv in moves:
    if mv["basis"] == "camera":
        named_share[mv["named"]] = named_share.get(mv["named"], 0) + 1
profile = {
    "fps": round(fps, 3), "seconds": round(duration, 2), "frames": N,
    "cuts": cut_list, "hiddenCuts": sum(1 for c in cut_list if c["kind"] != "hard"),
    "swaps": [round(s / fps, 3) for s in swaps],
    "cadence": {"events": len(events), "medianGap": round(float(np.median(gaps)), 2), "meanGap": round(float(np.mean(gaps)), 2)},
    "moves": moves[:400],
    "moveFrames": {"median": int(np.median(move_frames)), "p25": int(np.percentile(move_frames, 25)), "p75": int(np.percentile(move_frames, 75))},
    "eases": dict(sorted(named_share.items(), key=lambda kv: -kv[1])),  # camera moves only: those are measured exactly
    "twosShare": round(float(np.mean([mv["twos"] for mv in moves])) if moves else 0.0, 3),
    "camera": {"share": round(camera_share, 3), "track": track[:3000]},
    "stillShare": round(float(np.mean(diff[1:] < 0.4)), 3),
    "audio": {"peaks": peaks_path if has_audio else None, "buckets": int(math.ceil(duration * 100)) if has_audio else 0},
}
json.dump(profile, open(os.path.join(out, "profile.json"), "w", encoding="utf-8"))
say(1.0, "done")
