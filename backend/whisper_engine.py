import threading

from fastapi import HTTPException

WHISPER_MODELS = ("base", "small", "medium")
MODELS_DIRNAME = "models"

_lock = threading.Lock()
_models = {}


def models_root(store):
    return store.root / MODELS_DIRNAME


def available_models(store) -> list[str]:
    root = models_root(store)
    if not root.exists():
        return []
    found = []
    for entry in sorted(root.iterdir()):
        name = entry.name
        matched = any(
            name.endswith((f".{m}", f"-{m}")) or f"--{m}--" in name or name == m
            for m in WHISPER_MODELS
        )
        if entry.is_dir() and matched:
            found.append(name)
    return found


def validate_requested(model: str) -> str:
    if model not in WHISPER_MODELS:
        raise HTTPException(422, f"Unknown whisper model '{model}'. Available: {', '.join(WHISPER_MODELS)}")
    return model


def load_engine(store, model: str, allow_download: bool = False):
    validate_requested(model)
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise HTTPException(503, "faster-whisper is not installed. Run: uv pip install -r requirements.txt") from exc
    with _lock:
        cached = _models.get(model)
        if cached is not None:
            return cached
        try:
            engine = WhisperModel(
                model,
                device="cpu",
                compute_type="int8",
                download_root=str(models_root(store)),
                local_files_only=not allow_download,
            )
        except Exception as exc:
            raise HTTPException(
                409,
                f"Whisper model '{model}' is not downloaded locally. Download it first: "
                f'POST /api/models/whisper {{"model":"{model}"}} (explicit user request, needs internet once), '
                "or place the model under .bhippi/models. Transcription runs fully offline with local_files_only.",
            ) from exc
        _models[model] = engine
        return engine


def model_installed(store, model: str) -> bool:
    validate_requested(model)
    names = available_models(store)
    if not names:
        return False
    for name in names:
        suffixes = (f"-{model}", f".{model}")
        if name == model or f"--{model}--" in name or name.endswith(suffixes):
            return True
    return False


def run_transcription(store, asset_id: str, language: str, model: str, progress, job_id: str):
    path = store.media(asset_id)
    engine = load_engine(store, model)
    language_code = None if language == "auto" else language

    segments_iter, info = engine.transcribe(
        str(path),
        language=language_code,
        beam_size=3,
        vad_filter=True,
        word_timestamps=True,
    )
    progress(8, f"Detected language: {getattr(info, 'language', language_code) or 'auto'}")
    segments = []
    for segment in segments_iter:
        words = [
            {"start": float(w.start), "end": float(w.end), "word": w.word}
            for w in (segment.words or [])
            if w.start is not None and w.end is not None
        ]
        segments.append({"start": float(segment.start), "end": float(segment.end), "text": segment.text.strip(), "words": words})
        progress(10 + 85 * min(1.0, segment.end / max(info.duration, 0.1)), "Transcribing")
    return {
        "transcript": {
            "assetId": asset_id,
            "language": getattr(info, "language", None) or language or "auto",
            "segments": segments,
        }
    }
