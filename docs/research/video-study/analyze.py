"""Frame-by-frame study kit for a reference motion-graphics video.

Usage: python analyze.py <video.mp4> <out_dir>

Writes, per video:
  frames/f_00001.jpg ...  every frame at 1280x720 (frame numbers are 1-based)
  ff/ff_001.jpg ...       frame-by-frame sheets: 16 consecutive frames (4x4), labelled
  overview_01.jpg ...     every 0.5 s, 20 cells per sheet
  timeline.png            motion energy, moving area, camera pan/zoom, audio onsets, cuts
  shots/shot_NN.jpg       first / middle / last frame of each shot at 640 px
  analysis.json           per-frame metrics, shots, moves (with easing), audio, captions
  analysis.md             human-readable digest of the above
"""
import json
import math
import os
import subprocess
import sys

import cv2
import numpy as np
import soundfile as sf
from PIL import Image, ImageDraw, ImageFont

video, out = sys.argv[1], sys.argv[2]
os.makedirs(os.path.join(out, "frames"), exist_ok=True)
os.makedirs(os.path.join(out, "ff"), exist_ok=True)
os.makedirs(os.path.join(out, "shots"), exist_ok=True)

cap = cv2.VideoCapture(video)
fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

try:
    FONT = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 18)
    FONT_S = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 14)
except OSError:
    FONT = FONT_S = ImageFont.load_default()


def tc(i):
    """1-based frame index -> seconds timecode string."""
    s = (i - 1) / fps
    return f"{int(s // 60)}:{s % 60:05.2f}"


# ---------------------------------------------------------------- decode + per-frame metrics
thumbs = []  # 480x270 RGB for sheets
metrics = []
prev_small = None
prev_hist = None
feat_params = dict(maxCorners=300, qualityLevel=0.01, minDistance=8, blockSize=7)
i = 0
while True:
    ok, frame = cap.read()
    if not ok:
        break
    i += 1
    big = cv2.resize(frame, (1280, 720), interpolation=cv2.INTER_AREA)
    cv2.imwrite(os.path.join(out, "frames", f"f_{i:05d}.jpg"), big, [cv2.IMWRITE_JPEG_QUALITY, 88])
    thumbs.append(cv2.cvtColor(cv2.resize(frame, (480, 270), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB))

    small = cv2.cvtColor(cv2.resize(frame, (320, 180), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(cv2.resize(frame, (160, 90)), cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1, 2], None, [16, 8, 8], [0, 180, 0, 256, 0, 256])
    cv2.normalize(hist, hist)
    m = {
        "f": i,
        "t": round((i - 1) / fps, 4),
        "luma": round(float(small.mean()), 2),
        "sat": round(float(hsv[..., 1].mean()), 2),
    }
    if prev_small is not None:
        d = cv2.absdiff(small, prev_small)
        m["diff"] = round(float(d.mean()), 3)
        m["moving"] = round(float((d > 12).mean()), 4)  # fraction of pixels that changed
        m["hist_corr"] = round(float(cv2.compareHist(prev_hist, hist, cv2.HISTCMP_CORREL)), 4)
        # global camera motion: similarity transform from LK-tracked corners
        pts = cv2.goodFeaturesToTrack(prev_small, mask=None, **feat_params)
        dx = dy = 0.0
        scale = 1.0
        rot = 0.0
        inl = 0
        if pts is not None and len(pts) >= 12:
            nxt, st, _ = cv2.calcOpticalFlowPyrLK(prev_small, small, pts, None, winSize=(21, 21), maxLevel=3)
            good0 = pts[st.flatten() == 1]
            good1 = nxt[st.flatten() == 1]
            if len(good0) >= 12:
                M, inliers = cv2.estimateAffinePartial2D(good0, good1, method=cv2.RANSAC, ransacReprojThreshold=1.5)
                if M is not None:
                    inl = int(inliers.sum())
                    scale = math.hypot(M[0, 0], M[1, 0])
                    rot = math.degrees(math.atan2(M[1, 0], M[0, 0]))
                    # express translation in 1080p pixels
                    dx = float(M[0, 2]) * (1920 / 320)
                    dy = float(M[1, 2]) * (1080 / 180)
                    # translation of the centre, not the origin
                    cx, cy = 160, 90
                    dx = float(M[0, 0] * cx + M[0, 1] * cy + M[0, 2] - cx) * (1920 / 320)
                    dy = float(M[1, 0] * cx + M[1, 1] * cy + M[1, 2] - cy) * (1080 / 180)
                    inl_frac = inl / max(1, len(good0))
                    if inl_frac < 0.5:  # not a camera move; independent elements moving
                        dx = dy = 0.0
                        scale = 1.0
                        rot = 0.0
        m["cam_dx"] = round(dx, 2)
        m["cam_dy"] = round(dy, 2)
        m["cam_scale"] = round(scale, 5)
        m["cam_rot"] = round(rot, 3)
        m["cam_inliers"] = inl
    else:
        m.update(diff=0.0, moving=0.0, hist_corr=1.0, cam_dx=0.0, cam_dy=0.0, cam_scale=1.0, cam_rot=0.0, cam_inliers=0)
    metrics.append(m)
    prev_small = small
    prev_hist = hist
cap.release()
N = len(metrics)
print(f"{video}: {N} frames @ {fps:.3f} fps")

# ---------------------------------------------------------------- cut detection
diff = np.array([m["diff"] for m in metrics])
corr = np.array([m["hist_corr"] for m in metrics])
med = np.median(diff[1:]) if N > 1 else 0
cuts = [1]
for k in range(1, N):
    local = diff[max(1, k - 8):k]
    base = np.median(local) if len(local) else med
    hard = diff[k] > max(18.0, 4.0 * base + 6) and corr[k] < 0.85
    color_jump = corr[k] < 0.55 and diff[k] > 8
    if (hard or color_jump) and (k + 1) - cuts[-1] >= 4:
        cuts.append(k + 1)
for k in range(N):
    metrics[k]["cut"] = (k + 1) in cuts and k > 0

shots = []
for si, start in enumerate(cuts):
    end = (cuts[si + 1] - 1) if si + 1 < len(cuts) else N
    shots.append({"shot": si + 1, "start": start, "end": end, "t0": round((start - 1) / fps, 3),
                  "t1": round(end / fps, 3), "dur": round((end - start + 1) / fps, 3)})


# ---------------------------------------------------------------- palette per shot
def palette(rgb, k=6):
    px = rgb.reshape(-1, 3).astype(np.float32)
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    _, labels, centers = cv2.kmeans(px, k, None, crit, 3, cv2.KMEANS_PP_CENTERS)
    counts = np.bincount(labels.flatten(), minlength=k)
    order = np.argsort(-counts)
    return [{"hex": "#%02x%02x%02x" % tuple(int(c) for c in centers[j]), "share": round(float(counts[j] / counts.sum()), 3)} for j in order]


for s in shots:
    mid = (s["start"] + s["end"]) // 2
    s["palette"] = palette(thumbs[mid - 1][::3, ::3])
    seg = metrics[s["start"] - 1:s["end"]]
    s["cam_total"] = {
        "dx": round(sum(m["cam_dx"] for m in seg[1:]), 1),
        "dy": round(sum(m["cam_dy"] for m in seg[1:]), 1),
        "zoom": round(float(np.prod([m["cam_scale"] for m in seg[1:]])) if len(seg) > 1 else 1.0, 4),
        "rot": round(sum(m["cam_rot"] for m in seg[1:]), 2),
    }
    s["mean_motion"] = round(float(np.mean([m["diff"] for m in seg[1:]])) if len(seg) > 1 else 0.0, 3)
    s["still_frac"] = round(float(np.mean([m["diff"] < 0.4 for m in seg[1:]])) if len(seg) > 1 else 1.0, 3)
    sheet = Image.new("RGB", (640 * 3, 360 + 30), (20, 20, 20))
    d = ImageDraw.Draw(sheet)
    for j, fi in enumerate([s["start"], mid, s["end"]]):
        sheet.paste(Image.fromarray(thumbs[fi - 1]).resize((640, 360)), (640 * j, 30))
        d.text((640 * j + 6, 6), f"f{fi}  {tc(fi)}", fill=(255, 220, 0), font=FONT)
    sheet.save(os.path.join(out, "shots", f"shot_{s['shot']:02d}.jpg"), quality=85)

# ---------------------------------------------------------------- "moves": bursts of motion and their easing
# A move is a run of frames whose motion energy stays above a floor. For each, the energy curve's
# shape tells the easing: peak early = ease-out (fast start, long settle), peak late = ease-in,
# symmetric = ease-in-out, flat = linear. A secondary peak after the main one = overshoot/bounce.
energy = np.array([m["moving"] for m in metrics])
floor = max(0.004, float(np.percentile(energy, 30)) * 1.5)
moves = []
k = 1
while k < N:
    if energy[k] > floor and not metrics[k]["cut"]:
        a = k
        while k < N and energy[k] > floor * 0.6 and not (metrics[k]["cut"] and k != a):
            k += 1
        b = k - 1
        if b - a + 1 >= 3:
            seg = energy[a:b + 1]
            pk = int(np.argmax(seg))
            rel = pk / max(1, len(seg) - 1)
            flat = float(seg.std() / (seg.mean() + 1e-6)) < 0.25
            peaks = [j for j in range(1, len(seg) - 1) if seg[j] > seg[j - 1] and seg[j] >= seg[j + 1] and seg[j] > 0.35 * seg[pk]]
            if flat:
                ease = "linear/constant"
            elif rel < 0.3:
                ease = "ease-out (fast start, long settle)"
            elif rel > 0.7:
                ease = "ease-in (slow start, hard stop)"
            else:
                ease = "ease-in-out"
            cam = metrics[a:b + 1]
            moves.append({
                "f0": a + 1, "f1": b + 1, "t0": round(a / fps, 3), "dur_s": round((b - a + 1) / fps, 3),
                "frames": b - a + 1, "peak_rel": round(rel, 2), "ease": ease, "peaks": len(peaks),
                "settle_bounce": len(peaks) >= 2 and peaks[-1] > pk,
                "moving_area_peak": round(float(seg.max()), 3),
                "cam": {"dx": round(sum(m["cam_dx"] for m in cam), 1), "dy": round(sum(m["cam_dy"] for m in cam), 1),
                        "zoom": round(float(np.prod([m["cam_scale"] for m in cam])), 4)},
            })
    else:
        k += 1

# ---------------------------------------------------------------- audio
audio = {"onsets": [], "tempo_bpm": None}
wav = os.path.join(out, "audio.wav")
try:
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", video, "-ac", "1", "-ar", "22050", wav], check=True)
    y, sr = sf.read(wav)
    hop = 256
    nfft = 1024
    win = np.hanning(nfft)
    frames_n = 1 + (len(y) - nfft) // hop
    spec = np.abs(np.stack([np.fft.rfft(win * y[j * hop:j * hop + nfft]) for j in range(frames_n)]))
    logspec = np.log1p(spec * 10)
    flux = np.maximum(0, np.diff(logspec, axis=0)).sum(axis=1)
    flux = np.concatenate([[0], flux])
    flux = (flux - flux.min()) / (flux.max() - flux.min() + 1e-9)
    ot = np.arange(len(flux)) * hop / sr
    # adaptive peak pick
    w = int(0.1 * sr / hop)
    onsets = []
    last = -1
    for j in range(w, len(flux) - w):
        loc = flux[j - w:j + w + 1]
        if flux[j] == loc.max() and flux[j] > loc.mean() + 0.12 and flux[j] > 0.08 and ot[j] - last > 0.08:
            onsets.append(round(float(ot[j]), 3))
            last = ot[j]
    audio["onsets"] = onsets
    # tempo from onset autocorrelation (60-180 bpm)
    ac = np.correlate(flux - flux.mean(), flux - flux.mean(), mode="full")[len(flux) - 1:]
    lags = np.arange(len(ac)) * hop / sr
    band = (lags > 60 / 180) & (lags < 60 / 60)
    if band.any():
        lag = lags[band][np.argmax(ac[band])]
        audio["tempo_bpm"] = round(60 / lag, 1)
    rms = np.array([np.sqrt(np.mean(y[int(j / fps * sr):int((j + 1) / fps * sr)] ** 2) + 1e-12) for j in range(N)])
    for j in range(N):
        metrics[j]["rms"] = round(float(rms[j]), 4)
    audio["flux"] = (ot, flux)
except Exception as e:  # noqa: BLE001
    audio["error"] = str(e)


def near_onset(t, tol):
    return any(abs(t - o) <= tol for o in audio["onsets"])


tol = 2.0 / fps
sync = {
    "cuts_on_onset": sum(near_onset((c - 1) / fps, tol) for c in cuts[1:]),
    "cuts": len(cuts) - 1,
    "moves_start_on_onset": sum(near_onset(mv["t0"], tol) for mv in moves),
    "moves": len(moves),
    "tolerance_frames": 2,
}

# ---------------------------------------------------------------- captions (word timings)
captions = []
base = os.path.splitext(video)[0]
for cand in (base + ".en-orig.json3", base + ".en.json3"):
    if os.path.exists(cand):
        with open(cand, encoding="utf-8") as fh:
            j3 = json.load(fh)
        for ev in j3.get("events", []):
            t0 = ev.get("tStartMs", 0)
            for sg in ev.get("segs", []) or []:
                w = sg.get("utf8", "").strip()
                if w:
                    captions.append({"t": round((t0 + sg.get("tOffsetMs", 0)) / 1000, 3), "w": w})
        break

# ---------------------------------------------------------------- sheets
def label(img, text, small=False):
    im = Image.fromarray(img)
    d = ImageDraw.Draw(im)
    f = FONT_S if small else FONT
    x0, y0, x1, y1 = d.textbbox((4, 2), text, font=f)
    d.rectangle([0, 0, x1 + 4, y1 + 3], fill=(0, 0, 0))
    d.text((4, 2), text, fill=(255, 220, 0), font=f)
    return im


per = 16
for si in range(0, N, per):
    sheet = Image.new("RGB", (480 * 4, 270 * 4), (0, 0, 0))
    for j in range(per):
        fi = si + j + 1
        if fi > N:
            break
        cut = " CUT" if metrics[fi - 1]["cut"] else ""
        sheet.paste(label(thumbs[fi - 1], f"f{fi} {tc(fi)}{cut}"), ((j % 4) * 480, (j // 4) * 270))
    sheet.save(os.path.join(out, "ff", f"ff_{si // per + 1:03d}.jpg"), quality=82)

step = max(1, round(fps / 2))
idx = list(range(1, N + 1, step))
cells = 20
for oi in range(0, len(idx), cells):
    sheet = Image.new("RGB", (384 * 5, 216 * 4), (0, 0, 0))
    for j, fi in enumerate(idx[oi:oi + cells]):
        im = Image.fromarray(thumbs[fi - 1]).resize((384, 216))
        sheet.paste(label(np.array(im), f"f{fi} {tc(fi)}", small=True), ((j % 5) * 384, (j // 5) * 216))
    sheet.save(os.path.join(out, f"overview_{oi // cells + 1:02d}.jpg"), quality=82)

# ---------------------------------------------------------------- timeline plot (drawn with PIL, no matplotlib)
PW, PH = 2400, 900
plot = Image.new("RGB", (PW, PH), (18, 18, 22))
d = ImageDraw.Draw(plot)
L, R = 90, PW - 20
lanes = [("moving area", [m["moving"] for m in metrics], (80, 200, 255)),
         ("cam pan |dx,dy| px", [math.hypot(m["cam_dx"], m["cam_dy"]) for m in metrics], (255, 170, 60)),
         ("cam zoom %/frame", [abs(m["cam_scale"] - 1) * 100 for m in metrics], (120, 255, 140)),
         ("audio rms", [m.get("rms", 0) for m in metrics], (230, 120, 255))]
lane_h = (PH - 80) // (len(lanes) + 1)


def x_of(t):
    return L + (R - L) * t / max(1e-6, N / fps)


for li, (name, vals, col) in enumerate(lanes):
    top = 30 + li * lane_h
    bot = top + lane_h - 12
    vmax = max(vals) if max(vals) > 0 else 1
    d.text((6, top), name, fill=col, font=FONT_S)
    d.line([(L, bot), (R, bot)], fill=(60, 60, 60))
    pts = [(x_of((k) / fps), bot - (bot - top) * v / vmax) for k, v in enumerate(vals)]
    d.line(pts, fill=col, width=2)
# onset lane
top = 30 + len(lanes) * lane_h
d.text((6, top), "audio onsets", fill=(255, 255, 255), font=FONT_S)
for o in audio["onsets"]:
    d.line([(x_of(o), top + 4), (x_of(o), top + lane_h - 20)], fill=(200, 200, 200))
for mv in moves:
    d.rectangle([x_of(mv["t0"]), top + lane_h - 18, x_of(mv["t0"] + mv["dur_s"]), top + lane_h - 10], fill=(80, 200, 255))
for c in cuts[1:]:
    x = x_of((c - 1) / fps)
    d.line([(x, 20), (x, PH - 40)], fill=(255, 60, 60), width=1)
for s in range(0, int(N / fps) + 1):
    x = x_of(s)
    d.line([(x, PH - 40), (x, PH - 34)], fill=(160, 160, 160))
    d.text((x - 6, PH - 30), f"{s}", fill=(160, 160, 160), font=FONT_S)
d.text((L, 4), f"{os.path.basename(video)}  red = cuts, blue bars = detected moves", fill=(255, 255, 255), font=FONT_S)
plot.save(os.path.join(out, "timeline.png"))

# ---------------------------------------------------------------- write json + md
audio_out = {k: v for k, v in audio.items() if k != "flux"}
result = {"video": os.path.basename(video), "fps": fps, "frames": N, "width": W, "height": H,
          "duration_s": round(N / fps, 3), "shots": shots, "moves": moves, "audio": audio_out,
          "sync": sync, "captions": captions, "per_frame": metrics}
with open(os.path.join(out, "analysis.json"), "w", encoding="utf-8") as fh:
    json.dump(result, fh)

lines = [f"# {os.path.basename(video)}", "",
         f"- {N} frames @ {fps:.3f} fps, {W}x{H}, {N / fps:.2f} s",
         f"- {len(shots)} shots (detected hard cuts / colour jumps; soft transitions and morphs are NOT cuts), mean shot {np.mean([s['dur'] for s in shots]):.2f} s",
         f"- {len(moves)} motion bursts ('moves'); audio tempo estimate {audio.get('tempo_bpm')} bpm; {len(audio['onsets'])} audio onsets",
         f"- sync: {sync['cuts_on_onset']}/{sync['cuts']} cuts and {sync['moves_start_on_onset']}/{sync['moves']} moves start within 2 frames of an audio onset",
         "", "## Shots", "",
         "| # | frames | time | dur s | still % | mean motion | camera (dx, dy px @1080p, zoom x, rot deg) | palette |",
         "|---|---|---|---|---|---|---|---|"]
for s in shots:
    c = s["cam_total"]
    pal = " ".join(f"{p['hex']}({int(p['share'] * 100)}%)" for p in s["palette"][:5])
    lines.append(f"| {s['shot']} | {s['start']}-{s['end']} | {tc(s['start'])}-{tc(s['end'])} | {s['dur']} | {int(s['still_frac'] * 100)} | {s['mean_motion']} | {c['dx']}, {c['dy']}, {c['zoom']}, {c['rot']} | {pal} |")
lines += ["", "## Moves (bursts of motion) with inferred easing", "",
          "| frames | t0 | dur s | ease | peaks | bounce | peak moving area | camera dx,dy,zoom |", "|---|---|---|---|---|---|---|---|"]
for mv in moves:
    lines.append(f"| {mv['f0']}-{mv['f1']} | {mv['t0']} | {mv['dur_s']} | {mv['ease']} | {mv['peaks']} | {mv['settle_bounce']} | {mv['moving_area_peak']} | {mv['cam']['dx']},{mv['cam']['dy']},{mv['cam']['zoom']} |")
if captions:
    lines += ["", "## Voiceover / caption words (t in s)", ""]
    row = []
    for c in captions:
        row.append(f"{c['t']:.2f} {c['w']}")
    lines.append(" · ".join(row))
lines += ["", "## Audio onsets (s)", "", ", ".join(str(o) for o in audio["onsets"])]
with open(os.path.join(out, "analysis.md"), "w", encoding="utf-8") as fh:
    fh.write("\n".join(lines) + "\n")
print("done", out, len(shots), "shots", len(moves), "moves")
