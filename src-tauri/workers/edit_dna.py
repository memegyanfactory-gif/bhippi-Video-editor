"""Edit DNA from a video file: how fast it cuts, how much of it is raw green screen, and (with
Demucs) how music and sound effects are used. docs/FUNNY-MODE-PLAN.md §1.1 and §3.7.

Video (one FFmpeg decode, no model):
  · cuts        — FFmpeg `select='gt(scene,0.28)',showinfo` on a 480p scale, the detector the
                  plan's reference numbers were measured with. cutsPerMinute counts them per
                  60 s bin; medianShot / longestStatic come from the shots between them.
  · greenShare  — the share of 2 fps frames whose left and right border strips are flat chroma
                  green (mean G > R + 40 and G > B + 30): an unkeyed green screen.

Audio (optional; needs Demucs, installed on demand into the media Python, see `install`):
  · htdemucs (CUDA when available) splits voice from everything else. On the accompaniment:
  · musicCoverage — share of 100 ms frames whose RMS is above −38 dBFS.
  · SFX-like hits — onset peaks that stand > 8 dB over the local (±3 s) median and > −32 dBFS.
  · onBeat        — share of the cuts that fall inside music landing within ±70 ms of a beat.
  Onset strength, peak picking and beat tracking are numpy/scipy ports of librosa 1.0's
  `onset_strength`, `util.peak_pick` and `beat.beat_track` (Ellis DP), so the media Python
  needs no librosa/numba. Without Demucs the audio fields come back null with a note: the
  numbers are never guessed.

Run by Bhippi (receipts.rs `edit_dna_file`):  python edit_dna.py request.json
  request: {"action": "measure" | "install", "path", "ffmpeg", "ffprobe", "output",
            "audio": true, "install_audio": false, "gpu": true}
  Progress goes to stdout as {"progress", "message"} lines; the result is written to `output`.
By hand:  python edit_dna.py --measure video.mp4 [--ffmpeg PATH]   (prints the JSON)
          python edit_dna.py --selftest [--ffmpeg PATH]            (synthetic video + DSP checks)
"""
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import time
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")

import numpy as np

SCENE_THRESHOLD = 0.28
GREEN_FPS = 2
GREEN_SIZE = (160, 90)
GREEN_STRIP = 0.08
MUSIC_DB = -38.0
SFX_OVER_LOCAL_DB = 8.0
SFX_FLOOR_DB = -32.0
BEAT_TOLERANCE = 0.07
SR = 44100
HOP = 512
N_FFT = 2048
N_MELS = 128
DEMUCS_PACKAGE = "demucs==4.1.0"
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0


def emit(progress, message, **extra):
    print(json.dumps({"progress": progress, "message": message, **extra}), flush=True)


# ─── Tools ─────────────────────────────────────────────────────────────────────────────────────

def find_ffmpeg(explicit=None):
    if explicit and Path(explicit).is_file():
        return str(explicit)
    found = shutil.which("ffmpeg")
    if not found:
        raise RuntimeError("FFmpeg was not found; pass its path")
    return found


def find_ffprobe(ffmpeg, explicit=None):
    if explicit and Path(explicit).is_file():
        return str(explicit)
    sibling = Path(ffmpeg).with_name("ffprobe" + (".exe" if sys.platform == "win32" else ""))
    if sibling.is_file():
        return str(sibling)
    return shutil.which("ffprobe")


def probe(ffprobe, path):
    """Duration in seconds and whether the file has an audio stream."""
    if not ffprobe:
        return None, True
    out = subprocess.run(
        [ffprobe, "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", str(path)],
        capture_output=True, text=True, creationflags=NO_WINDOW,
    )
    if out.returncode != 0:
        raise RuntimeError(f"ffprobe could not read {path}: {out.stderr.strip()[-400:]}")
    info = json.loads(out.stdout or "{}")
    duration = float(info.get("format", {}).get("duration") or 0) or None
    has_audio = any(s.get("codec_type") == "audio" for s in info.get("streams", []))
    return duration, has_audio


# ─── Video: scene cuts and green share, one decode ──────────────────────────────────────────────

def is_green_frame(frame):
    """Both border strips flat chroma green (the test that found 73 % of video A green)."""
    width = frame.shape[1]
    strip = max(1, int(width * GREEN_STRIP))
    for part in (frame[:, :strip], frame[:, -strip:]):
        r, g, b = part.reshape(-1, 3).mean(axis=0)
        if not (g > r + 40 and g > b + 30):
            return False
    return True


def analyse_video(ffmpeg, path, duration, progress=None):
    """Scene-change times (s) and the green share of 2 fps frames, from one FFmpeg pass."""
    w, h = GREEN_SIZE
    graph = (
        f"[0:v]scale=-2:480,split=2[s][g];"
        f"[s]select='gt(scene,{SCENE_THRESHOLD})',showinfo[sv];"
        f"[g]fps={GREEN_FPS},scale={w}:{h}:flags=area,format=rgb24[gv]"
    )
    with tempfile.TemporaryFile() as log:
        process = subprocess.Popen(
            [ffmpeg, "-hide_banner", "-nostats", "-i", str(path), "-an", "-sn", "-dn", "-filter_complex", graph,
             "-map", "[sv]", "-f", "null", "-", "-map", "[gv]", "-f", "rawvideo", "pipe:1"],
            stdout=subprocess.PIPE, stderr=log, stdin=subprocess.DEVNULL, creationflags=NO_WINDOW,
        )
        size = w * h * 3
        frames = green = 0
        expected = max(1, int(math.ceil((duration or 0) * GREEN_FPS)))
        while True:
            chunk = process.stdout.read(size)
            if not chunk or len(chunk) < size:
                break
            frame = np.frombuffer(chunk, dtype=np.uint8).reshape(h, w, 3).astype(np.float32)
            frames += 1
            green += is_green_frame(frame)
            if progress and frames % 60 == 0:
                progress(min(1.0, frames / expected))
        process.wait()
        log.seek(0)
        text = log.read().decode("utf-8", "replace")
    if process.returncode != 0:
        raise RuntimeError("FFmpeg could not decode the video: " + "\n".join(text.strip().splitlines()[-6:]))
    cuts = []
    for line in text.splitlines():
        if "Parsed_showinfo" not in line or "pts_time:" not in line:
            continue
        value = line.split("pts_time:", 1)[1].split()[0]
        try:
            cuts.append(float(value))
        except ValueError:
            pass
    return sorted(cuts), (green / frames if frames else None), frames


def shot_stats(cuts, duration):
    """cutsPerMinute (60 s bins), medianShot, longestStatic from cut times."""
    bins = max(1, int(math.ceil(duration / 60.0 - 1e-9)))
    per_minute = [0] * bins
    for cut in cuts:
        per_minute[min(bins - 1, int(cut // 60))] += 1
    edges = [0.0] + [c for c in cuts if 0 < c < duration] + [duration]
    shots = [(edges[i], edges[i + 1]) for i in range(len(edges) - 1) if edges[i + 1] > edges[i]]
    lengths = [b - a for a, b in shots]
    median = float(np.median(lengths)) if lengths else duration
    start, end = max(shots, key=lambda s: s[1] - s[0]) if shots else (0.0, duration)
    return per_minute, median, {"start": round(start, 3), "end": round(end, 3), "seconds": round(end - start, 3)}


# ─── Audio DSP: numpy/scipy ports of the librosa 1.0 functions the study used ──────────────────

def hz_to_mel(freqs):
    freqs = np.asanyarray(freqs, dtype=np.float64)
    f_sp = 200.0 / 3
    mels = freqs / f_sp
    min_log_hz = 1000.0
    min_log_mel = min_log_hz / f_sp
    logstep = np.log(6.4) / 27.0
    return np.where(freqs >= min_log_hz, min_log_mel + np.log(np.maximum(freqs, 1e-12) / min_log_hz) / logstep, mels)


def mel_to_hz(mels):
    mels = np.asanyarray(mels, dtype=np.float64)
    f_sp = 200.0 / 3
    freqs = f_sp * mels
    min_log_hz = 1000.0
    min_log_mel = min_log_hz / f_sp
    logstep = np.log(6.4) / 27.0
    return np.where(mels >= min_log_mel, min_log_hz * np.exp(logstep * (mels - min_log_mel)), freqs)


def mel_filters(sr=SR, n_fft=N_FFT, n_mels=N_MELS):
    """librosa.filters.mel (Slaney scale and norm), float32."""
    fftfreqs = np.fft.rfftfreq(n=n_fft, d=1.0 / sr)
    mel_f = mel_to_hz(np.linspace(hz_to_mel(0.0), hz_to_mel(sr / 2.0), n_mels + 2))
    fdiff = np.diff(mel_f)
    ramps = np.subtract.outer(mel_f, fftfreqs)
    weights = np.zeros((n_mels, 1 + n_fft // 2), dtype=np.float32)
    for i in range(n_mels):
        lower = -ramps[i] / fdiff[i]
        upper = ramps[i + 2] / fdiff[i + 1]
        weights[i] = np.maximum(0, np.minimum(lower, upper))
    weights *= (2.0 / (mel_f[2:n_mels + 2] - mel_f[:n_mels]))[:, np.newaxis]
    return weights


def mel_db(y, sr=SR):
    """power_to_db(melspectrogram(y)) with librosa's defaults, as (frames, n_mels) float32.
    The STFT runs in blocks so an hour of audio never needs gigabytes of complex frames."""
    import scipy.fft

    y = np.asarray(y, dtype=np.float32)
    padded = np.pad(y, (N_FFT // 2, N_FFT // 2))
    n_frames = 1 + (len(padded) - N_FFT) // HOP
    window = (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N_FFT) / N_FFT)).astype(np.float32)
    basis = mel_filters(sr).T.copy()
    out = np.empty((n_frames, N_MELS), dtype=np.float32)
    block = 2048
    for first in range(0, n_frames, block):
        last = min(n_frames, first + block)
        segment = padded[first * HOP:(last - 1) * HOP + N_FFT]
        frames = np.lib.stride_tricks.sliding_window_view(segment, N_FFT)[::HOP][: last - first]
        spectrum = scipy.fft.rfft(frames * window, axis=1)
        power = (spectrum.real ** 2 + spectrum.imag ** 2).astype(np.float32)
        out[first:last] = power @ basis
    db = 10.0 * np.log10(np.maximum(1e-10, out))
    return np.maximum(db, db.max() - 80.0).astype(np.float32)


def onset_envelope(db, aggregate=np.mean):
    """librosa.onset.onset_strength(lag=1, max_size=1, center=True) from a mel-dB spectrogram."""
    flux = np.maximum(0.0, db[1:] - db[:-1])
    env = aggregate(flux, axis=1).astype(np.float32)
    pad = 1 + N_FFT // (2 * HOP)
    return np.concatenate([np.zeros(pad, dtype=np.float32), env])[: db.shape[0]]


def peak_pick(x, pre_max, post_max, pre_avg, post_avg, delta, wait):
    """librosa.util.peak_pick (greedy): x[n] is the max of x[n-pre_max:n+post_max], at least
    mean(x[n-pre_avg:n+post_avg]) + delta, and more than `wait` frames after the last peak."""
    x = np.asarray(x, dtype=np.float64)
    n_total = len(x)
    if n_total == 0:
        return np.array([], dtype=int)
    padded = np.concatenate([np.full(pre_max, -np.inf), x, np.full(post_max, -np.inf)])
    run_max = np.lib.stride_tricks.sliding_window_view(padded, pre_max + post_max).max(axis=1)[:n_total]
    csum = np.concatenate([[0.0], np.cumsum(x)])
    lo = np.maximum(0, np.arange(n_total) - pre_avg)
    hi = np.minimum(n_total, np.arange(n_total) + post_avg)
    run_avg = (csum[hi] - csum[lo]) / (hi - lo)
    peaks = []
    first = x[0] >= x[: min(post_max, n_total)].max() and x[0] >= x[: min(post_avg, n_total)].mean() + delta
    n = wait + 1 if first else 1
    if first:
        peaks.append(0)
    while n < n_total:
        if x[n] == run_max[n] and x[n] >= run_avg[n] + delta:
            peaks.append(n)
            n += wait + 1
        else:
            n += 1
    return np.array(peaks, dtype=int)


def estimate_tempo(env, sr=SR, start_bpm=120.0, std_bpm=1.0, ac_size=8.0, max_tempo=320.0):
    """librosa.feature.rhythm.tempo: the global tempo from the mean autocorrelation tempogram,
    weighted by a log-normal prior around 120 BPM."""
    import scipy.fft

    win = int(int(ac_size * sr) // HOP)
    n = len(env)
    padded = np.pad(env.astype(np.float64), (win // 2, win // 2), mode="linear_ramp", end_values=(0, 0))
    frames = np.lib.stride_tricks.sliding_window_view(padded, win)[:n]
    window = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(win) / win)
    n_pad = scipy.fft.next_fast_len(2 * win - 1, real=True)
    total = np.zeros(win)
    tiny = np.finfo(np.float64).tiny
    for first in range(0, n, 2048):
        block = frames[first:first + 2048] * window
        power = np.abs(scipy.fft.rfft(block, n=n_pad, axis=1)) ** 2
        ac = scipy.fft.irfft(power, n=n_pad, axis=1)[:, :win]
        peak = np.abs(ac).max(axis=1, keepdims=True)
        peak[peak < tiny] = 1.0
        total += (ac / peak).sum(axis=0)
    mean_tg = total / max(1, n)
    with np.errstate(divide="ignore"):
        bpms = np.concatenate([[np.inf], 60.0 * sr / (HOP * np.arange(1.0, win))])
        logprior = -0.5 * ((np.log2(bpms) - np.log2(start_bpm)) / std_bpm) ** 2
    logprior[: int(np.argmax(bpms < max_tempo))] = -np.inf
    return float(bpms[int(np.argmax(np.log1p(1e6 * mean_tg) + logprior))])


def track_beats(env, bpm, sr=SR, tightness=100.0, trim=True):
    """librosa.beat.beat_track's dynamic program (Ellis 2007) for a static tempo; beat frames."""
    env = np.asarray(env, dtype=np.float32)
    n = len(env)
    if n == 0 or not env.any() or bpm <= 0:
        return np.array([], dtype=int)
    fpb = float(np.round(sr / HOP * 60.0 / bpm))
    norm = (env / (env.std(ddof=1) + np.finfo(np.float32).tiny)).astype(np.float32)
    window = np.exp(-0.5 * (np.arange(-fpb, fpb + 1) * 32.0 / fpb) ** 2)
    k = len(window)
    half = k // 2
    # librosa's same-mode convolution, summed in its order into float32 (so near-tied beats
    # resolve the same way). Its bounds never let onset frame 0 contribute; that is kept too.
    local = np.zeros(n, dtype=np.float32)
    index = np.arange(n)
    for tap in range(k):
        rows = index[(tap > index + half - n) & (tap < np.minimum(index + half, k))]
        if len(rows):
            local[rows] = (local[rows].astype(np.float64) + window[tap] * norm[rows + half - tap].astype(np.float64)).astype(np.float32)

    near = int(round(fpb / 2))
    far = int(2 * fpb)
    offsets = np.arange(near, far + 1)
    penalty = tightness * (np.log(offsets) - np.log(fpb)) ** 2
    cumscore = np.zeros(n, dtype=np.float64)
    backlink = np.full(n, -1, dtype=np.int64)
    threshold = 0.01 * float(local.max())
    first_beat = True
    for i in range(n):
        score_i = float(local[i])
        valid = offsets <= i
        location = -1
        if valid.any():
            candidates = cumscore[i - offsets[valid]] - penalty[valid]
            best = int(np.argmax(candidates))
            location = int(i - offsets[valid][best])
            cumscore[i] = score_i + candidates[best]
        else:
            cumscore[i] = score_i
        if first_beat and score_i < threshold:
            backlink[i] = -1
        else:
            backlink[i] = location
            first_beat = False

    lmax = np.zeros(n, dtype=bool)
    if n > 2:
        lmax[1:-1] = (cumscore[1:-1] > cumscore[:-2]) & (cumscore[1:-1] >= cumscore[2:])
    if n > 1:
        lmax[-1] = cumscore[-1] > cumscore[-2]
    tail = n - 1
    if lmax.any():
        cut = 0.5 * float(np.median(cumscore[lmax]))
        hits = np.flatnonzero(lmax & (cumscore >= cut))
        if len(hits):
            tail = int(hits[-1])
    beats = np.zeros(n, dtype=bool)
    at = tail
    while at >= 0:
        beats[at] = True
        at = int(backlink[at])

    smooth = np.convolve(local[beats].astype(np.float64), np.hanning(5))[2:n + 2]
    limit = 0.5 * math.sqrt(float((smooth ** 2).mean())) if trim and len(smooth) else 0.0
    i = 0
    while i < n and local[i] <= limit:
        beats[i] = False
        i += 1
    i = n - 1
    while i >= 0 and local[i] <= limit:
        beats[i] = False
        i -= 1
    return np.flatnonzero(beats)


def frame_db(y, hop):
    frames = len(y) // hop
    if frames == 0:
        return np.array([], dtype=np.float64)
    blocks = y[: frames * hop].astype(np.float64).reshape(frames, hop)
    rms = np.sqrt((blocks ** 2).mean(axis=1))
    return 20 * np.log10(np.maximum(rms, 1e-6))


def within(points, targets, tolerance):
    """For each point: is a target within ±tolerance?"""
    points = np.asarray(points, dtype=np.float64)
    targets = np.sort(np.asarray(targets, dtype=np.float64))
    if len(points) == 0:
        return np.array([], dtype=bool)
    if len(targets) == 0:
        return np.zeros(len(points), dtype=bool)
    idx = np.clip(np.searchsorted(targets, points), 1, len(targets) - 1) if len(targets) > 1 else np.zeros(len(points), dtype=int)
    nearest = np.minimum(np.abs(targets[idx] - points), np.abs(targets[np.maximum(idx - 1, 0)] - points))
    return nearest <= tolerance


def analyse_accompaniment(acc, cuts, sr=SR):
    """musicCoverage, SFX-like hits and on-beat share from the mono accompaniment (float32)."""
    decis = frame_db(acc, sr // 10)
    n = len(decis)
    music = decis > MUSIC_DB
    coverage = float(music.mean()) if n else 0.0
    db = mel_db(acc, sr)
    env = onset_envelope(db, np.mean)
    times = np.arange(len(env)) * HOP / sr
    peaks = peak_pick(env, 20, 20, 100, 100, float(np.percentile(env, 99)) * 0.5, 20)
    hits = []
    for p in peaks:
        t = float(times[p])
        i = int(t * 10)
        if i >= n:
            continue
        local = float(np.median(decis[max(0, i - 30):i + 30]))
        level = float(decis[min(n - 1, i + 1)])
        if level - local > SFX_OVER_LOCAL_DB and level > SFX_FLOOR_DB:
            hits.append(t)
    minutes = n / 600.0
    bins = max(1, int(math.ceil(n / 600.0 - 1e-9)))
    per_minute = [0] * bins
    for t in hits:
        per_minute[min(bins - 1, int(t // 60))] += 1

    beat_env = onset_envelope(db, np.median)
    tempo = estimate_tempo(beat_env, sr) if beat_env.any() else 0.0
    beats = track_beats(beat_env, tempo, sr) * HOP / sr if tempo > 0 else np.array([])
    in_music = [c for c in cuts if n and music[min(n - 1, int(c * 10))]]
    on_beat = float(within(in_music, beats, BEAT_TOLERANCE).mean()) if in_music and len(beats) else None
    # What chance gives: every 100 ms music frame treated as a cut (deterministic baseline).
    grid = np.flatnonzero(music) / 10.0
    chance = float(within(grid, beats, BEAT_TOLERANCE).mean()) if len(grid) and len(beats) else None
    return {
        "musicCoverage": round(coverage, 4),
        "sfxHits": [round(t, 2) for t in hits],
        "sfxPerMinute": per_minute,
        "sfxRate": round(len(hits) / minutes, 3) if minutes > 0 else 0.0,
        "onBeat": None if on_beat is None else round(on_beat, 4),
        "onBeatChance": None if chance is None else round(chance, 4),
        "cutsInMusic": len(in_music),
        "tempo": round(tempo, 2),
        "beats": int(len(beats)),
    }


# ─── Audio: decode and separate ────────────────────────────────────────────────────────────────

def demucs_available():
    try:
        import demucs.apply  # noqa: F401
        import demucs.pretrained  # noqa: F401
        import torch  # noqa: F401
        return True
    except Exception:
        return False


def decode_audio(ffmpeg, path, sr=SR):
    """Stereo float32 (2, n) at `sr`, straight from FFmpeg."""
    out = subprocess.run(
        [ffmpeg, "-v", "error", "-i", str(path), "-vn", "-ac", "2", "-ar", str(sr), "-f", "f32le", "pipe:1"],
        capture_output=True, stdin=subprocess.DEVNULL, creationflags=NO_WINDOW,
    )
    if out.returncode != 0:
        raise RuntimeError("FFmpeg could not decode the audio: " + out.stderr.decode("utf-8", "replace").strip()[-400:])
    samples = np.frombuffer(out.stdout, dtype=np.float32)
    return samples[: len(samples) // 2 * 2].reshape(-1, 2).T.copy()


def separate_accompaniment(stereo, gpu=True):
    """htdemucs: everything that is not voice (drums + bass + other), as mono float32.
    Seeded, so the same file measures the same every time (demucs shifts by a random offset)."""
    import random

    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    random.seed(0)
    torch.manual_seed(0)
    device = "cuda" if gpu and torch.cuda.is_available() else "cpu"
    model = get_model("htdemucs")
    model.eval()
    wav = torch.from_numpy(stereo)
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std()
    wav = (wav - mean) / (std + 1e-8)
    with torch.no_grad():
        out = apply_model(model, wav[None], device=device, split=True, overlap=0.1, progress=False)[0]
    out = out * std + mean
    keep = [i for i, name in enumerate(model.sources) if name != "vocals"]
    acc = out[keep].sum(0).mean(0).numpy().astype(np.float32)
    del out
    if device == "cuda":
        torch.cuda.empty_cache()
    return acc, device


# ─── Measure ───────────────────────────────────────────────────────────────────────────────────

def measure(path, ffmpeg, ffprobe=None, audio=True, gpu=True, install_audio=False, progress=emit, audio_note=None):
    started = time.perf_counter()
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f"No such file: {path}")
    notes = []
    duration, has_audio = probe(ffprobe, path)
    progress(0.02, "Finding cuts and green screen")
    cuts, green, frames = analyse_video(ffmpeg, path, duration, lambda f: progress(0.02 + 0.43 * f, "Finding cuts and green screen"))
    if not duration:
        duration = frames / GREEN_FPS if frames else (cuts[-1] if cuts else 0.0)
    cuts = [c for c in cuts if c < duration]
    per_minute, median, longest = shot_stats(cuts, duration)
    timings = {"video": round(time.perf_counter() - started, 2)}

    audio_result = None
    if not audio:
        notes.append((audio_note or "Audio was not measured (not requested).") + " musicCoverage, sfxPerMinute and onBeat are unknown.")
    elif not has_audio:
        notes.append("The file has no audio stream: musicCoverage, sfxPerMinute and onBeat are unknown.")
    else:
        if not demucs_available() and install_audio:
            install(progress, 0.46, 0.6)
        if not demucs_available():
            notes.append("Audio was not measured: Demucs is not installed in the media Python, and music/SFX need the "
                         "voice separated first. Install it once (measureFileDna(path, { installAudio: true }), about "
                         "100 MB) — musicCoverage, sfxPerMinute and onBeat are unknown, not zero.")
        else:
            t0 = time.perf_counter()
            progress(0.6, "Decoding audio")
            stereo = decode_audio(ffmpeg, path)
            progress(0.64, "Separating voice from music (Demucs)")
            acc, device = separate_accompaniment(stereo, gpu)
            del stereo
            timings["separate"] = round(time.perf_counter() - t0, 2)
            t1 = time.perf_counter()
            progress(0.9, "Measuring music, sound effects and beats")
            audio_result = analyse_accompaniment(acc, cuts)
            audio_result["device"] = device
            timings["analyse"] = round(time.perf_counter() - t1, 2)
            if audio_result["onBeat"] is None:
                notes.append("No cut falls inside music, so onBeat is not measured.")
            elif audio_result["onBeatChance"] is not None:
                notes.append(f"onBeat {audio_result['onBeat']:.2f} vs {audio_result['onBeatChance']:.2f} by chance "
                             f"({audio_result['cutsInMusic']} cuts inside music, tempo {audio_result['tempo']:.0f} BPM).")
    timings["total"] = round(time.perf_counter() - started, 2)
    progress(1, "Edit DNA measured")
    return {
        "path": str(path),
        "duration": round(float(duration), 3),
        "cuts": [round(c, 3) for c in cuts],
        "cutsPerMinute": per_minute,
        "medianShot": round(median, 3),
        "longestStatic": longest,
        "greenShare": None if green is None else round(float(green), 4),
        "audio": audio_result,
        "notes": notes,
        "timings": timings,
    }


# ─── Install (on demand, into this interpreter) ─────────────────────────────────────────────────

def install(progress=emit, low=0.02, high=0.95):
    """pip install demucs (plus julius, lameenc, sphn; torch, einops, huggingface-hub, safetensors,
    pyyaml and tqdm are already in the media runtime), fetch the htdemucs weights (~80 MB, Hugging
    Face cache) and separate one second of noise as a smoke test."""
    if not demucs_available():
        progress(low, f"Installing {DEMUCS_PACKAGE} into the media Python (once)")
        process = subprocess.run(
            [sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "--no-input", DEMUCS_PACKAGE],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace",
            timeout=1800, creationflags=NO_WINDOW,
        )
        if process.returncode != 0:
            raise RuntimeError("Could not install Demucs. Install it by hand and retry: "
                               f"{sys.executable} -m pip install {DEMUCS_PACKAGE}\n{process.stdout[-2000:]}")
        import importlib
        importlib.invalidate_caches()
    progress(low + (high - low) * 0.6, "Fetching the htdemucs weights and testing them")
    noise = (np.random.default_rng(0).standard_normal((2, SR)) * 0.05).astype(np.float32)
    acc, device = separate_accompaniment(noise, gpu=True)
    if acc.shape[0] != SR or not np.isfinite(acc).all():
        raise RuntimeError("Demucs installed but its test separation returned nonsense")
    progress(high, f"Demucs ready ({device})")
    return {"package": DEMUCS_PACKAGE, "model": "htdemucs", "license": "MIT (Demucs, Meta)", "device": device}


# ─── Self-test ─────────────────────────────────────────────────────────────────────────────────

def selftest(ffmpeg):
    """A synthetic video with known cuts and green shots, plus DSP checks on synthetic audio."""
    failures = []

    def check(name, ok, detail):
        print(("ok   " if ok else "FAIL ") + f"{name}: {detail}", flush=True)
        if not ok:
            failures.append(name)

    # 1. Video: five shots, two of them green screen (7 of 14 s).
    shots = [("color=c=0x00C800", 3.0), ("testsrc2", 2.0), ("color=c=0x2040C0", 4.0), ("smptebars", 1.5), ("color=c=0x10D010", 3.5)]
    folder = Path(tempfile.mkdtemp(prefix="edit-dna-selftest-"))
    try:
        video = folder / "synthetic.mp4"
        inputs = []
        for source, seconds in shots:
            inputs += ["-f", "lavfi", "-i", f"{source}{':' if '=' in source else '='}s=640x360:r=25:d={seconds}"]
        inputs += ["-f", "lavfi", "-i", "sine=f=440:sample_rate=44100:d=14"]
        labels = "".join(f"[{i}:v]" for i in range(len(shots)))
        made = subprocess.run(
            [ffmpeg, "-v", "error", "-y", *inputs, "-filter_complex", f"{labels}concat=n={len(shots)}:v=1:a=0[v]",
             "-map", "[v]", "-map", f"{len(shots)}:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(video)],
            capture_output=True, text=True, creationflags=NO_WINDOW,
        )
        if made.returncode != 0:
            raise RuntimeError("could not make the synthetic video: " + made.stderr[-600:])
        result = measure(video, ffmpeg, find_ffprobe(ffmpeg), audio=False, progress=lambda *a, **k: None)
        expected = [3.0, 5.0, 9.0, 10.5]
        got = result["cuts"]
        close = len(got) == len(expected) and all(abs(a - b) <= 0.05 for a, b in zip(got, expected))
        check("scene cuts", close, f"{got} vs {expected}")
        check("cutsPerMinute", result["cutsPerMinute"] == [4], str(result["cutsPerMinute"]))
        check("medianShot", abs(result["medianShot"] - 3.0) < 0.06, str(result["medianShot"]))
        ls = result["longestStatic"]
        check("longestStatic", abs(ls["seconds"] - 4.0) < 0.06 and abs(ls["start"] - 5.0) < 0.06, str(ls))
        check("greenShare", abs((result["greenShare"] or 0) - 0.5) <= 0.05, str(result["greenShare"]))
        check("duration", abs(result["duration"] - 14.0) < 0.2, str(result["duration"]))
    finally:
        shutil.rmtree(folder, ignore_errors=True)

    # 2. DSP: a 120 BPM track of broadband clicks over a -30 dBFS noise bed ("music" under all of
    #    it), with three loud half-second hits on top that stand far over the bed (the SFX).
    sr = SR
    seconds = 40
    rng = np.random.default_rng(1)
    y = (rng.standard_normal(sr * seconds) * 0.03).astype(np.float32)
    click = (np.hanning(221) * rng.standard_normal(221)).astype(np.float32)
    beat_times = np.arange(0.5, seconds - 0.5, 0.5)
    for t in beat_times:
        i = int(t * sr)
        y[i:i + len(click)] += 0.3 * click
    burst = (rng.standard_normal(int(0.5 * sr)) * np.exp(-np.linspace(0, 4, int(0.5 * sr)))).astype(np.float32)
    for t in (10.25, 20.25, 30.25):
        i = int(t * sr)
        y[i:i + len(burst)] += 0.8 * burst
    db = mel_db(y, sr)
    tempo = estimate_tempo(onset_envelope(db, np.median), sr)
    check("tempo", abs(tempo - 120) < 3 or abs(tempo - 240) < 6 or abs(tempo - 60) < 2, f"{tempo:.1f} BPM")
    beats = track_beats(onset_envelope(db, np.median), tempo, sr) * HOP / sr
    near = within(beats, beat_times, 0.03)
    check("beats on clicks", len(beats) > 50 and near.mean() > 0.9, f"{len(beats)} beats, {near.mean():.2f} within 30 ms")
    analysis = analyse_accompaniment(y, [5.0, 12.51, 17.02, 25.26])
    check("sfx hits", sorted(round(h) for h in analysis["sfxHits"]) == [10, 20, 30], str(analysis["sfxHits"]))
    check("music coverage", analysis["musicCoverage"] > 0.9, str(analysis["musicCoverage"]))
    check("onBeat", analysis["onBeat"] is not None and analysis["onBeat"] >= 0.75, f"{analysis['onBeat']} (chance {analysis['onBeatChance']})")
    peaks = peak_pick(np.array([0, 1, 0, 0, 5, 0, 0, 0, 3, 0], dtype=float), 1, 1, 1, 1, 0.5, 2)
    check("peak_pick", list(peaks) == [1, 4, 8], str(list(peaks)))
    print("SELFTEST " + ("PASSED" if not failures else "FAILED: " + ", ".join(failures)), flush=True)
    return not failures


def execute(request):
    ffmpeg = find_ffmpeg(request.get("ffmpeg"))
    ffprobe = find_ffprobe(ffmpeg, request.get("ffprobe"))
    output = Path(request["output"])
    if request.get("action") == "install":
        result = install()
    else:
        result = measure(request["path"], ffmpeg, ffprobe, audio=request.get("audio", True) is not False,
                         gpu=request.get("gpu", True) is not False, install_audio=request.get("install_audio") is True,
                         audio_note=request.get("audio_note"))
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result), encoding="utf-8")


if __name__ == "__main__":
    args = sys.argv[1:]
    explicit = args[args.index("--ffmpeg") + 1] if "--ffmpeg" in args else None
    if "--selftest" in args:
        sys.exit(0 if selftest(find_ffmpeg(explicit)) else 1)
    if "--measure" in args:
        target = args[args.index("--measure") + 1]
        ff = find_ffmpeg(explicit)
        report = measure(target, ff, find_ffprobe(ff), audio="--no-audio" not in args,
                         progress=lambda p, m, **k: print(f"[{p:.2f}] {m}", file=sys.stderr, flush=True))
        if "--no-cuts" in args:
            report.pop("cuts", None)
        print(json.dumps(report, indent=1))
        sys.exit(0)
    try:
        execute(json.loads(Path(args[0]).read_text(encoding="utf-8")))
    except Exception as error:  # the host shows stderr's tail as the failure
        print(f"{type(error).__name__}: {error}", file=sys.stderr, flush=True)
        sys.exit(1)
