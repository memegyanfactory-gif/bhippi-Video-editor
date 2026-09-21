import json
import re
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .jobs import Jobs
from .ollama_client import (
    VISION_MAX_FRAMES,
    is_available,
    list_models,
    validate_model,
)
from .ollama_client import (
    chat as ollama_chat,
)
from .render import render_project, validate_timeline
from .schemas import (
    AnalyzeRequest,
    ChatAction,
    ChatRequest,
    ExportRequest,
    HooksRequest,
    MemoryRequest,
    ModelRequest,
    Project,
    TranscribeRequest,
)
from .storage import Store, run_process
from .whisper_engine import (
    available_models,
    load_engine,
    model_installed,
    run_transcription,
)

ROOT = Path(__file__).resolve().parent.parent
store = Store(ROOT / ".helios")
jobs = Jobs()
app = FastAPI(title="Helios", version="0.1.0", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(127\.0\.0\.1|localhost|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d{1,5})?",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def public_asset(item: dict) -> dict:
    return {
        "id": item["id"],

        "name": item["name"],
        "kind": item["kind"],
        "duration": item["duration"],
        "width": item.get("width", 0),
        "height": item.get("height", 0),
        "url": f"/api/media/{item['id']}",
        "thumbnail": f"/api/thumbnails/{item['id']}" if item.get("hasVideo", True) else None,
        "hasAudio": item.get("hasAudio", False),
    }


def trusted_origin(request: Request) -> bool:
    origin = request.headers.get("origin")
    if not origin:
        return True
    host = re.sub(r"^https?://", "", origin).rsplit(":", 1)[0]
    return re.fullmatch(r"(127\.0\.0\.1|localhost|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3})", host) is not None


COMMAND_WORDS = {
    "title": "title",
    "naam": "title",
    "split": "split",
    "kaat": "split",
    "cut": "split",
    "whoosh": "whoosh",
    "impact": "impact",
    "chime": "chime",
    "portrait": "9:16",
    "vertical": "9:16",
    "square": "1:1",
    "landscape": "16:9",
}


def parse_seconds(text: str) -> float | None:
    match = re.search(r"(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds|second)?\b", text)
    return float(match.group(1)) if match else None


def extract_quoted(text: str) -> str | None:
    match = re.search(r'"([^"]{1,200})"', text)
    if match:
        return match.group(1)
    match = re.search(r"'([^']{1,200})'", text)
    return match.group(1) if match else None


def command_actions(message: str, project: Project) -> tuple[list[dict], str]:
    lowered = message.lower()
    actions: list[dict] = []
    notes: list[str] = []
    now = parse_seconds(lowered) or 0.0
    for word, kind in COMMAND_WORDS.items():
        if word not in lowered:
            continue
        if kind in ("title", "kinetic", "caption", "lower-third") or word in ("title", "naam"):
            quoted = extract_quoted(message)
            text = quoted or message.strip()
            actions.append({"type": "add_graphic", "text": text[:200], "preset": "title" if kind == "title" else kind, "time": now, "duration": 2.5, "color": "#FFC53D"})
            notes.append(f"Added {kind} at {now:.1f}s")
            break
        if kind == "split":
            actions.append({"type": "split", "time": now})
            notes.append(f"Split marker at {now:.1f}s")
            break
        if kind in ("whoosh", "impact", "chime"):
            actions.append({"type": "add_sfx", "kind": kind, "time": now})
            notes.append(f"Added {kind} at {now:.1f}s")
            break
        if kind in ("9:16", "1:1", "16:9"):
            actions.append({"type": "set_aspect", "aspect": kind})
            notes.append(f"Aspect set to {kind}")
            break
    return actions, "; ".join(notes) if notes else "No editing command detected; ask me to add a title, whoosh, split, or change aspect."




def answer_chat(body: ChatRequest) -> dict:
    actions, note = command_actions(body.message, body.project)
    if not is_available() or not body.model:
        return {"reply": note, "actions": actions, "source": "command-parser"}
    try:
        model = validate_model(body.model, list_models())
    except HTTPException:
        return {"reply": note, "actions": actions, "source": "command-parser"}
    memory = store.read("memory.json", [])
    memory_text = "\n".join(f"- {item['text']}" for item in memory[-20:])
    system = (
        "You are Helios, a local video editing copilot. You may answer in English, Hindi, or Hinglish. "
        "When the user asks for an edit, respond with a JSON object {reply, actions} where actions is a list limited to these shapes: "
        '{"type":"add_graphic","text":"...","preset":"title|kinetic|caption|lower-third","time":number,"duration":number,"color":"#RRGGBB"} '
        '{"type":"split","time":number} {"type":"add_sfx","kind":"whoosh|impact|chime","time":number} {"type":"set_aspect","aspect":"16:9|9:16|1:1"}. '
        "Never invent other action types. Keep reply short."
    )
    if memory_text:
        system += "\nSaved user preferences:\n" + memory_text
    analysis = None
    for clip in body.project.clips[:1]:
        path = store.root / "analysis" / f"{clip.assetId}.json"
        if path.is_file():
            analysis = json.loads(path.read_text(encoding="utf-8"))
    context = ""
    if analysis:
        context = f"\nVideo analysis: {json.dumps(analysis)[:2000]}"
    messages = [{"role": "system", "content": system + context}]
    messages.extend({"role": item.role, "content": item.content} for item in body.history[-10:])
    messages.append({"role": "user", "content": body.message})
    try:
        raw = ollama_chat(model, messages)
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            parsed = json.loads(match.group(0))
            reply = str(parsed.get("reply", ""))[:4000] or note
            model_actions = []
            for action in parsed.get("actions", [])[:10]:
                if not isinstance(action, dict) or action.get("type") not in ("add_graphic", "split", "set_aspect", "add_sfx"):
                    continue
                try:
                    validated = ChatAction.model_validate(action)
                    model_actions.append(validated.model_dump(by_alias=True))
                except (ValueError, TypeError):
                    continue
            return {"reply": reply, "actions": model_actions or actions, "source": f"ollama:{model}"}
        return {"reply": raw[:4000] or note, "actions": actions, "source": f"ollama:{model}"}
    except HTTPException:
        return {"reply": note, "actions": actions, "source": "command-parser"}


@app.get("/api/health")
def health() -> dict:
    try:
        installed = run_process(["ffmpeg", "-version"])
        ffmpeg_ok = installed.startswith("ffmpeg version")
    except RuntimeError:
        ffmpeg_ok = False
    whisper_models = available_models(store)
    return {
        "ffmpeg": ffmpeg_ok,
        "whisper": True,
        "whisperModels": whisper_models,
        "ollama": is_available(),
        "models": list_models(),
        "memoryCount": len(store.read("memory.json", [])),
    }


@app.get("/api/assets")
def assets() -> list[dict]:
    return [public_asset(item) for item in store.assets()]


@app.post("/api/import")
async def import_files(request: Request, files: list[UploadFile] = File(default=[])) -> list[dict]:  # noqa: B008
    if not trusted_origin(request):
        raise HTTPException(403, "Cross-origin import is not allowed")
    if not files:
        raise HTTPException(422, "No files provided")
    if len(files) > 20:
        raise HTTPException(422, "Import at most 20 files at once")
    created = []
    for upload in files:
        asset_id = store.import_file(upload.filename or "asset", upload.file)
        created.append(asset_id)
    return [public_asset(item) for item in store.assets() if item["id"] in created]


@app.get("/api/media/{asset_id}")
def media(asset_id: str, request: Request):
    asset = store.asset(asset_id)
    path = store.media(asset_id)
    headers = {"Accept-Ranges": "bytes"}
    range_header = request.headers.get("range")
    if range_header and asset.kind == "video":
        start = 0
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header.strip())
        size = path.stat().st_size
        if match and match.group(1):
            start = int(match.group(1))
            end = int(match.group(2) or size - 1)
            end = min(end, size - 1)
            if start > end or start >= size:
                return JSONResponse(status_code=416, content={"detail": "Range not satisfiable"})
            headers["Content-Range"] = f"bytes {start}-{end}/{size}"
            return FileResponse(path, media_type="video/mp4", headers=headers, stat_result=None)
    return FileResponse(path, media_type="video/mp4", headers=headers)


@app.get("/api/thumbnails/{asset_id}")
def thumbnail(asset_id: str):
    path = store.root / "thumbnails" / f"{asset_id}.jpg"
    if not path.is_file():
        raise HTTPException(404, "Thumbnail not found")
    return FileResponse(path, media_type="image/jpeg")


@app.get("/api/project")
def get_project() -> dict:
    return store.read("projects/current.json", {"version": 1, "name": "Untitled story", "aspect": "16:9", "clips": [], "graphics": [], "sounds": [], "transcripts": []})


@app.put("/api/project")
def put_project(request: Request, project: Project) -> dict:
    if not trusted_origin(request):
        raise HTTPException(403, "Cross-origin save is not allowed")
    store.validate_project(project)
    store.save("projects/current.json", project.model_dump(by_alias=True))
    return {"ok": True}


@app.post("/api/transcribe")
def transcribe(request: Request, body: TranscribeRequest) -> dict:
    if not trusted_origin(request):
        raise HTTPException(403, "Cross-origin transcription is not allowed")
    store.asset(body.assetId)
    if not model_installed(store, body.model):
        raise HTTPException(409, f"Whisper model '{body.model}' is not downloaded. Use the Download button in Settings first (needs internet once).")

    def operation(update, job_id):
        return run_transcription(store, body.assetId, body.language, body.model, update, job_id)

    return jobs.submit(operation, "Transcribing locally")


@app.post("/api/models/whisper")
def download_whisper(request: Request, body: ModelRequest) -> dict:
    if not trusted_origin(request):
        raise HTTPException(403, "Cross-origin download is not allowed")

    def operation(update, job_id):
        update(5, f"Downloading whisper '{body.model}' (explicit request)")
        load_engine(store, body.model, allow_download=True)
        update(100, "Downloaded")
        return {"model": body.model}

    return jobs.submit(operation, "Downloading model")


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str) -> dict:
    return jobs.get(job_id)


@app.get("/api/exports/{job_id}")
def export_file(job_id: str):
    if not re.fullmatch(r"[a-f0-9]{32}", job_id):
        raise HTTPException(422, "Invalid export id")
    path = store.root / "exports" / f"{job_id}.mp4"
    if not path.is_file():
        raise HTTPException(404, "Export not found")
    return FileResponse(path, media_type="video/mp4", filename=f"helios-{job_id[:8]}.mp4")


@app.post("/api/hooks")
def hooks(request: Request, body: HooksRequest) -> dict:
    if not trusted_origin(request):
        raise HTTPException(403, "Cross-origin analysis is not allowed")
    store.asset(body.assetId)
    ranked = []
    for segment in body.segments:
        text = segment.text.strip()
        if not text:
            continue
        score = min(1.0, 0.3 + 0.05 * len(text.split()))
        lower = text.lower()
        for cue in ("started", "but", "so", "secret", "wait", "शुरू", "लेकिन", "तो", "क्योंकि"):
            if cue in lower:
                score += 0.15
        ranked.append({"start": segment.start, "end": segment.end, "text": text, "reason": "Keyword/length heuristic", "score": round(score, 2)})
    ranked.sort(key=lambda item: item["score"], reverse=True)
    top = ranked[:5]
    source = "heuristic"
    if is_available() and body.segments:
        try:
            model = validate_model("llama3.2", list_models())
            transcript_text = "\n".join(f"{s.start:.1f}-{s.end:.1f}: {s.text.strip()}" for s in body.segments[:200])
            prompt = f"Pick the 5 most engaging hooks from this transcript. Return JSON list of objects with start, end, text, reason, score (0-1).\n\n{transcript_text}"
            raw = ollama_chat(model, [{"role": "user", "content": prompt}])
            match = re.search(r"\[.*\]", raw, re.DOTALL)
            if match:
                import json as jsonlib
                parsed = jsonlib.loads(match.group(0))
                cleaned = []
                for item in parsed[:5]:
                    if isinstance(item, dict) and "start" in item and "end" in item:
                        cleaned.append({
                            "start": float(item["start"]),
                            "end": float(item["end"]),
                            "text": str(item.get("text", ""))[:1000],
                            "reason": str(item.get("reason", ""))[:500],
                            "score": min(1.0, max(0.0, float(item.get("score", 0.5)))),
                        })
                if cleaned:
                    top = cleaned
                    source = "ollama:llama3.2"
        except (HTTPException, ValueError, TypeError):
            pass
    return {"hooks": top, "source": source}


def extract_frames(path: Path, work: Path, count: int = VISION_MAX_FRAMES) -> list[tuple[float, Path]]:
    probe_json = run_process(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)])
    duration = float(json.loads(probe_json)["format"]["duration"])
    step = max(duration / (count + 1), 0.5)
    frames = []
    for index in range(count):
        time = step * (index + 1)
        if time >= duration:
            break
        frame_path = work / f"frame_{index}.jpg"
        run_process(["ffmpeg", "-y", "-ss", f"{time:.3f}", "-i", str(path), "-frames:v", "1", "-vf", "scale=512:-2", str(frame_path)], timeout=60)
        if frame_path.is_file():
            frames.append((time, frame_path))
    return frames


@app.post("/api/analyze")
def analyze(request: Request, body: AnalyzeRequest) -> dict:
    if not trusted_origin(request):
        raise HTTPException(403, "Cross-origin analysis is not allowed")
    asset = store.asset(body.assetId)
    model = validate_model(body.model, list_models())
    if asset.kind != "video":
        raise HTTPException(422, "Frame analysis needs a video asset")

    def operation(update, job_id):
        import base64
        update(10, "Extracting frames")
        work = store.root / "work" / job_id
        work.mkdir(parents=True, exist_ok=True)
        frames = extract_frames(store.media(body.assetId), work)
        if not frames:
            return {"frames": [], "summary": ""}
        update(40, "Asking local vision model")
        descriptions = []
        for index, (time, frame_path) in enumerate(frames):
            image_b64 = base64.b64encode(frame_path.read_bytes()).decode("ascii")
            description = ollama_chat(
                model,
                [{"role": "user", "content": "Describe this video frame in one sentence.", "images": [image_b64]}],
            )
            descriptions.append({"time": time, "description": description})
            update(40 + 50 * (index + 1) / len(frames), "Analyzing frames")
        summary_prompt = "Summarize what happens in this video from these frame descriptions and give 3 motion-graphic title ideas as a JSON object {summary, titleIdeas}. " + json.dumps(descriptions)
        summary = ollama_chat(model, [{"role": "user", "content": summary_prompt}])
        result = {"frames": descriptions, "summary": summary}
        store.save(f"analysis/{body.assetId}.json", result)
        return result

    return jobs.submit(operation, "Analyzing video locally")




@app.post("/api/chat")
def chat_endpoint(request: Request, body: ChatRequest) -> dict:
    if not trusted_origin(request):
        raise HTTPException(403, "Cross-origin chat is not allowed")
    return answer_chat(body)


@app.get("/api/memory")
def memory_list() -> dict:
    return {"items": store.read("memory.json", [])}


@app.post("/api/memory")
def memory_add(request: Request, body: MemoryRequest) -> dict:
    if not trusted_origin(request):
        raise HTTPException(403, "Cross-origin memory write is not allowed")
    items = store.read("memory.json", [])
    entry = {"id": uuid.uuid4().hex, "text": body.text}
    items.append(entry)
    store.save("memory.json", items[-200:])
    return entry


@app.delete("/api/memory/{item_id}")
def memory_delete(request: Request, item_id: str) -> dict:
    if not trusted_origin(request):
        raise HTTPException(403, "Cross-origin memory delete is not allowed")
    items = store.read("memory.json", [])
    remaining = [item for item in items if item.get("id") != item_id]
    store.save("memory.json", remaining)
    return {"ok": True}


@app.post("/api/export")
def export_endpoint(request: Request, body: ExportRequest) -> dict:
    if not trusted_origin(request):
        raise HTTPException(403, "Cross-origin export is not allowed")
    total = validate_timeline(body.project, store)
    if total < 0.04:
        raise HTTPException(422, "Nothing to export")

    def operation(update, job_id):
        return render_project(body.project, store, update, job_id)

    return jobs.submit(operation, "Exporting MP4")


DIST = ROOT / "dist"
if DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        candidate = (DIST / full_path).resolve()
        if full_path and candidate.is_file() and candidate.is_relative_to(DIST):
            return FileResponse(candidate)
        return FileResponse(DIST / "index.html")
