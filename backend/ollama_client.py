import re

import httpx
from fastapi import HTTPException

OLLAMA_BASE = "http://127.0.0.1:11434"
TIMEOUT = 60.0
CLOUD_HINTS = ("cloud", "gpt", "claude", "gemini", "openai", "anthropic", "azure", "bedrock", "mistral-large")
VISION_MAX_FRAMES = 6


def client() -> httpx.Client:
    return httpx.Client(base_url=OLLAMA_BASE, timeout=TIMEOUT, headers={"Content-Type": "application/json"})


def is_available() -> bool:
    try:
        with client() as session:
            response = session.get("/api/version", timeout=2.5)
            return response.status_code == 200
    except httpx.HTTPError:
        return False


def list_models() -> list[str]:
    try:
        with client() as session:
            response = session.get("/api/tags", timeout=2.5)
            if response.status_code != 200:
                return []
            models = response.json().get("models", [])
            return [item.get("name", "") for item in models if item.get("name")]
    except (httpx.HTTPError, ValueError):
        return []


def local_model_names(models: list[str]) -> list[str]:
    return sorted({re.sub(r":.*$", "", name) for name in models})


def validate_model(name: str, installed: list[str]) -> str:
    if not name or not re.fullmatch(r"[A-Za-z0-9._:/-]{1,120}", name):
        raise HTTPException(422, "Model name contains unsupported characters")
    lowered = name.lower()
    if any(hint in lowered for hint in CLOUD_HINTS):
        raise HTTPException(422, f"Model '{name}' looks like a cloud service; Helios only uses local Ollama models")
    base_names = local_model_names(installed)
    short = re.sub(r":.*$", "", name)
    if short not in base_names and name not in installed:
        raise HTTPException(422, f"Ollama model '{name}' is not installed. Pull it in Ollama first. Installed: {', '.join(installed) or 'none'}")
    return name


def chat(model: str, messages: list[dict], images: list[str] | None = None, temperature: float = 0.4) -> str:
    payload = {"model": model, "messages": messages, "stream": False, "temperature": temperature}
    if images:
        payload["images"] = images
    try:
        with client() as session:
            response = session.post("/api/chat", json=payload)
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"Ollama is unreachable at {OLLAMA_BASE}: {exc}") from exc
    if response.status_code == 404:
        raise HTTPException(422, f"Ollama model '{model}' is not installed locally")
    if response.status_code != 200:
        raise HTTPException(502, f"Ollama error {response.status_code}: {response.text[:500]}")
    data = response.json()
    return str(data.get("message", {}).get("content", "")).strip()
