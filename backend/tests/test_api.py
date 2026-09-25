import time
import uuid

from fastapi.testclient import TestClient

from backend.main import app


def make_video(tmp_path, seconds=2.0):
    path = tmp_path / f"{uuid.uuid4().hex}.mp4"
    from backend.storage import run_process

    run_process([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"testsrc=duration={seconds}:size=320x180:rate=30",
        "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(path),
    ], timeout=120)
    return path


def test_import_export_roundtrip(tmp_path):
    client = TestClient(app, raise_server_exceptions=False)
    video = make_video(tmp_path)
    with open(video, "rb") as handle:
        response = client.post("/api/import", files={"files": ("sample.mp4", handle, "video/mp4")})
    assert response.status_code == 200, response.text
    assets = response.json()
    assert assets and assets[0]["kind"] == "video"

    project = {
        "version": 1,
        "name": "pytest",
        "aspect": "16:9",
        "clips": [{"id": "c1", "assetId": assets[0]["id"], "in": 0.2, "out": 1.8, "volume": 1}],
        "graphics": [{"id": "g1", "text": "BHIPPI", "subtitle": "test", "start": 0.3, "duration": 1.0, "preset": "title", "color": "#FFC53D"}],
        "sounds": [{"id": "s1", "kind": "whoosh", "start": 0.2, "volume": 0.5}],
        "transcripts": [],
    }
    job = client.post("/api/export", json={"project": project}).json()
    assert job["status"] in ("queued", "running")
    for _ in range(120):
        time.sleep(0.5)
        job = client.get(f"/api/jobs/{job['id']}").json()
        if job["status"] in ("done", "error"):
            break
    assert job["status"] == "done", job.get("message")
    download = client.get(job["result"]["url"])
    assert download.status_code == 200
    assert int(download.headers["content-length"]) > 1000


def test_project_roundtrip():
    client = TestClient(app)
    project = {"version": 1, "name": "saved", "aspect": "9:16", "clips": [], "graphics": [], "sounds": [], "transcripts": []}
    assert client.put("/api/project", json=project).status_code == 200
    fetched = client.get("/api/project").json()
    assert fetched["name"] == "saved"
    assert fetched["aspect"] == "9:16"


def test_chat_command_parser():
    client = TestClient(app)
    response = client.post("/api/chat", json={
        "message": 'add title "Namaste" at 1s',
        "model": "",
        "project": {"version": 1, "name": "t", "aspect": "16:9", "clips": [], "graphics": [], "sounds": [], "transcripts": []},
        "history": [],
    }).json()
    assert response["source"] == "command-parser"
    assert response["actions"][0]["type"] == "add_graphic"
    assert response["actions"][0]["text"] == "Namaste"
