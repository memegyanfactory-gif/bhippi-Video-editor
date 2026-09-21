from pathlib import Path

from fastapi import HTTPException

from .schemas import Project
from .sfx import synth_sfx
from .storage import run_process
from .subtitles import build_ass

ASPECTS = {"16:9": (16, 9), "9:16": (9, 16), "1:1": (1, 1)}
HEIGHTS = {"16:9": 1080, "9:16": 1920, "1:1": 1080}
FPS = 30
MIN_CLIP = 0.04
MAX_CLIPS = 200


def output_size(aspect: str) -> tuple[int, int]:
    height = HEIGHTS[aspect]
    horizontal, vertical = ASPECTS[aspect]
    width = height * horizontal // vertical
    return width - (width % 2), height - (height % 2)


def timeline_total(project: Project) -> float:
    return float(sum(clip.out - clip.in_ for clip in project.clips))


def validate_timeline(project: Project, store) -> float:
    if not project.clips:
        raise HTTPException(422, "Export requires at least one clip")
    if len(project.clips) > MAX_CLIPS:
        raise HTTPException(422, "Timeline is limited to 200 clips")
    total = 0.0
    for clip in project.clips:
        asset = store.asset(clip.assetId)
        if clip.out > asset.duration + 0.001:
            raise HTTPException(422, f"Clip {clip.id} exceeds source duration")
        if clip.out - clip.in_ < MIN_CLIP:
            raise HTTPException(422, f"Clip {clip.id} is shorter than {MIN_CLIP}s")
        total += clip.out - clip.in_
    if total > 14400:
        raise HTTPException(422, "Timeline is limited to four hours")
    if total < MIN_CLIP:
        raise HTTPException(422, "Timeline too short")
    return total


def clip_streams(project: Project, store, width: int, height: int, work: Path) -> list[str]:
    inputs: list[str] = []
    filters: list[str] = []
    labels: list[str] = []
    for index, clip in enumerate(project.clips):
        asset = store.asset(clip.assetId)
        source = store.media(clip.assetId)
        inputs.extend(["-i", str(source)])
        video_index = index
        audio_index = index
        duration = clip.out - clip.in_
        scale = f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black"
        fps = f"fps={FPS}"
        if asset.kind == "audio":
            filters.append(
                f"[{video_index}:v]color=c=0x101014:s={width}x{height}:r={FPS}:d={duration:.3f}[bg{index}];"
                f"[bg{index}]format=yuv420p[v{index}]"
            )
            filters.append(
                f"[{audio_index}:a]atrim=start={clip.in_:.3f}:end={clip.out:.3f},asetpts=PTS-STARTPTS,volume={clip.volume:.2f}[a{index}]"
            )
            labels.append(f"[v{index}][a{index}]")
        else:
            filters.append(
                f"[{video_index}:v]trim=start={clip.in_:.3f}:end={clip.out:.3f},setpts=PTS-STARTPTS,{scale},{fps},format=yuv420p[v{index}]"
            )
            if asset.hasAudio:
                filters.append(
                    f"[{audio_index}:a]atrim=start={clip.in_:.3f}:end={clip.out:.3f},asetpts=PTS-STARTPTS,volume={clip.volume:.2f}[a{index}]"
                )
                labels.append(f"[v{index}][a{index}]")
            else:
                filters.append(f"anullsrc=r=48000:cl=mono,atrim=0:{duration:.3f}[a{index}]")
                labels.append(f"[v{index}][a{index}]")
    return inputs, filters, labels


def concat_filter(labels: list[str], count: int) -> str:
    if count == 1:
        return labels[0]
    return "".join(labels) + f"concat=n={count}:v=1:a=1[vout][aout]"


def prepare_sfx(project: Project, work: Path) -> tuple[list[str], list[str], float]:
    inputs: list[str] = []
    delays: list[str] = []
    latest = 0.0
    for index, sound in enumerate(project.sounds):
        path = work / f"sfx_{index}.wav"
        duration = synth_sfx(path, sound.kind, sound.volume)
        inputs.extend(["-i", str(path)])
        delays.append(f"[{index}:a]adelay={round(sound.start * 1000)}:all=1[s{index}]")
        latest = max(latest, sound.start + duration)
    return inputs, delays, latest


def render_project(project: Project, store, update, job_id: str) -> dict:
    total = validate_timeline(project, store)
    width, height = output_size(project.aspect)
    work = store.root / "work" / job_id
    work.mkdir(parents=True, exist_ok=True)
    update(5, "Preparing clips")
    clip_inputs, filters, labels = clip_streams(project, store, width, height, work)
    filters.append("".join(labels) + f"concat=n={len(labels)}:v=1:a=1[vout][aout]")
    update(20, "Building filter graph")
    sfx_inputs, _, _ = prepare_sfx(project, work)
    sfx_delays = [f"[{len(project.clips) + i}:a]adelay={round(sound.start * 1000)}:all=1[s{i}]" for i, sound in enumerate(project.sounds)]
    inputs = clip_inputs + sfx_inputs
    output = store.root / "exports" / f"{job_id}.mp4"
    if project.graphics:
        ass_path = work / "overlay.ass"
        ass_path.write_text(build_ass(project, width, height, FPS), encoding="utf-8")
        escape_work = str(work).replace("\\", "/").replace(":", "\\:")
        filters.append(f"[vout]ass='{escape_work}/overlay.ass'[voutf]")
    final_video = "voutf" if project.graphics else "vout"
    filter_parts = list(filters)
    audio_out = "aout"
    if sfx_delays:
        filter_parts.extend(sfx_delays)
        filter_parts.append("[aout]" + "".join(f"[s{i}]" for i in range(len(sfx_delays))) + f"amix=inputs={len(sfx_delays) + 1}:normalize=0[aoutf]")
        audio_out = "aoutf"
    filter_complex = ";".join(filter_parts)
    args = ["ffmpeg", "-y", *inputs, "-filter_complex", filter_complex, "-map", f"[{final_video}]", "-map", f"[{audio_out}]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(output)]
    update(40, "Rendering with FFmpeg")
    run_process(args, timeout=7200)
    update(95, "Finalizing")
    return {"url": f"/api/exports/{job_id}", "duration": total}


