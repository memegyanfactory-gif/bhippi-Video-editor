import json
import math
import os
import subprocess
import threading
import uuid
from pathlib import Path

from fastapi import HTTPException

from .schemas import Asset, Project

FORMATS = "mov,matroska,webm,mp3,wav,flac,ogg,aac,avi,mpegts,mpeg"
INPUT_OPTIONS = ["-protocol_whitelist", "file,pipe", "-format_whitelist", FORMATS]


def run_process(args: list[str], timeout: int = 120, cwd: Path | None = None) -> str:
    try:
        result = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout, shell=False, encoding="utf-8", errors="replace", check=False)
    except FileNotFoundError as exc:
        raise RuntimeError(f"{args[0]} is not installed. Install FFmpeg and add ffmpeg/ffprobe to PATH.") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"{args[0]} exceeded its time limit") from exc
    if result.returncode:
        raise RuntimeError(f"{args[0]} failed: {result.stderr[-2000:]}")
    return result.stdout


def probe(path: Path) -> dict:
    data = json.loads(run_process(["ffprobe", "-v", "error", *INPUT_OPTIONS, "-show_format", "-show_streams", "-of", "json", str(path)]))
    streams = data.get("streams", [])
    videos = [s for s in streams if s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic")]
    audio = [s for s in streams if s.get("codec_type") == "audio"]
    if not videos and not audio:
        raise ValueError("File contains no supported video or audio")
    duration = float(data.get("format", {}).get("duration") or max((float(s.get("duration") or 0) for s in streams), default=0))
    if not math.isfinite(duration) or not 0 < duration <= 86400:
        raise ValueError("Media duration must be finite, positive, and at most 24 hours")
    video = videos[0] if videos else {}
    width, height = int(video.get("width", 0)), int(video.get("height", 0))
    if videos and (not 0 < width <= 8192 or not 0 < height <= 8192):
        raise ValueError("Unsupported video dimensions")
    return {"kind": "video" if videos else "audio", "duration": duration, "width": width, "height": height, "hasAudio": bool(audio)}


class Store:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.lock = threading.RLock()
        for name in ("media", "models", "projects", "exports", "thumbnails", "analysis", "work"):
            (self.root / name).mkdir(parents=True, exist_ok=True)

    def read(self, name: str, default):
        path = self.root / name
        with self.lock:
            if not path.exists():
                return default
            return json.loads(path.read_text(encoding="utf-8"))

    def save(self, name: str, value):
        with self.lock:
            path = self.root / name
            temporary = path.with_suffix(f".{uuid.uuid4().hex}.tmp")
            temporary.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False), encoding="utf-8")
            os.replace(temporary, path)

    def assets(self) -> list[dict]:
        return self.read("media/assets.json", [])

    def asset(self, asset_id: str) -> Asset:
        for item in self.assets():
            if item["id"] == asset_id:
                return Asset.model_validate({**item, "url": f"/api/media/{asset_id}"})
        raise HTTPException(404, "Asset not found")

    def managed(self, folder: str, filename: str) -> Path:
        base = (self.root / folder).resolve()
        path = base / filename
        if path.is_symlink() or path.resolve().parent != base or not path.is_file():
            raise HTTPException(404, "Managed file not found")
        return path

    def media(self, asset_id: str) -> Path:
        self.asset(asset_id)
        return self.managed("media", f"{asset_id}.bin")

    def import_file(self, filename: str, stream) -> str:
        safe_name = Path(filename).name
        suffix = Path(safe_name).suffix.lower()
        if suffix not in {".mp4", ".mov", ".mkv", ".webm", ".avi", ".mp3", ".wav", ".m4a", ".flac", ".ogg", ".aac", ".ts", ".mpg", ".mpeg"}:
            raise HTTPException(422, f"Unsupported file type '{suffix}'. Import video or audio files.")
        asset_id = uuid.uuid4().hex
        target = self.root / "media" / f"{asset_id}.bin"
        size = 0
        with open(target, "wb") as writer:
            while chunk := stream.read(1024 * 1024):
                size += len(chunk)
                if size > 4 * 1024 * 1024 * 1024:
                    writer.close()
                    target.unlink(missing_ok=True)
                    raise HTTPException(413, "File exceeds 4GB limit")
                writer.write(chunk)
        if size == 0:
            target.unlink(missing_ok=True)
            raise HTTPException(422, "Empty file")
        try:
            info = probe(target)
        except (RuntimeError, ValueError) as exc:
            target.unlink(missing_ok=True)
            raise HTTPException(422, f"Could not read media: {exc}") from exc
        if suffix in {".mp3", ".wav", ".m4a", ".flac", ".ogg", ".aac"}:
            info["kind"] = "audio"
        entry = {"id": asset_id, "name": safe_name, **info}
        with self.lock:
            items = self.assets()
            items.append(entry)
            self.save("media/assets.json", items)
        thumb = self.root / "thumbnails" / f"{asset_id}.jpg"
        if info["kind"] == "video":
            try:
                run_process(["ffmpeg", "-y", "-ss", "1", "-i", str(target), "-frames:v", "1", "-vf", "scale=320:-2", str(thumb)], timeout=60)
            except RuntimeError:
                pass
        return asset_id

    def validate_project(self, project: Project, export: bool = False) -> float:
        total = 0.0
        for clip in project.clips:
            asset = self.asset(clip.assetId)
            self.media(clip.assetId)
            if clip.out > asset.duration + 0.001:
                raise HTTPException(422, "Clip exceeds source duration")
            total += clip.out - clip.in_
        if total > 14400:
            raise HTTPException(422, "Timeline is limited to four hours")
        if export and total < 0.04:
            raise HTTPException(422, "Export requires at least 0.04 seconds of clips")
        if any(g.start + g.duration > 86400 for g in project.graphics):
            raise HTTPException(422, "Graphic timing exceeds limit")
        for transcript in project.transcripts:
            asset = self.asset(transcript.assetId)
            if any(s.end > asset.duration + 0.1 for s in transcript.segments):
                raise HTTPException(422, "Transcript exceeds source duration")
        return total
