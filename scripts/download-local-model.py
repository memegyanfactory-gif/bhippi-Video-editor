"""Pinned model downloads with real byte progress, resumable chunks and SHA256 checks."""
import concurrent.futures
import fnmatch
import hashlib
import json
from pathlib import Path
import sys
import threading
import time
import urllib.request
from huggingface_hub import model_info, hf_hub_download, hf_hub_url, get_hf_file_metadata
from huggingface_hub.errors import GatedRepoError

task = sys.argv[1]
repo = {'video': 'Wan-AI/Wan2.1-T2V-1.3B-Diffusers', 'audio': 'stabilityai/stable-audio-open-1.0', 'depth': 'depth-anything/DA3-SMALL'}[task]
root = Path.home() / 'AppData/Roaming/studio.helios.desktop/models/generation' / task
root.mkdir(parents=True, exist_ok=True)
parts = Path(__file__).resolve().parents[1] / 'work/model-download' / task
parts.mkdir(parents=True, exist_ok=True)
state = {'status': 'running', 'progress': 0, 'downloadedBytes': 0, 'totalBytes': 0, 'message': 'Checking model access and files', 'external': True}
lock = threading.Lock()
finished = threading.Event()

def publish():
    with lock:
        state['updatedAt'] = time.time()
        state['progress'] = min(1, state['downloadedBytes'] / state['totalBytes']) if state['totalBytes'] else 0
        temp = root / 'helios-download.tmp'
        temp.write_text(json.dumps(state), encoding='utf-8')
        temp.replace(root / 'helios-download.json')

def heartbeat():
    while not finished.wait(5): publish()

publish()
thread = threading.Thread(target=heartbeat, daemon=True)
thread.start()
try:
    info = model_info(repo, files_metadata=True)
    # Check authorization before allocating weight chunks. Use the user's existing HF login if present.
    hf_hub_download(repo, 'config.json' if task == 'depth' else 'model_index.json', revision=info.sha, local_dir=root)
    files = [f for f in info.siblings if any(fnmatch.fnmatch(f.rfilename, p) for p in ['*.json', '*.txt', '*.model', '*.safetensors', 'LICENSE*', '*.md'])]
    # Stable Audio also publishes a duplicate monolithic training checkpoint; Diffusers uses subfolders.
    files = [f for f in files if not (task == 'audio' and f.rfilename == 'model.safetensors')]
    state['totalBytes'] = sum(f.size or 0 for f in files)
    chunk = 16 * 1024 * 1024
    for file in files:
        state['message'] = 'Downloading ' + file.rfilename
        size = file.size or 0
        destination = root / file.rfilename
        if not file.rfilename.endswith('.safetensors'):
            hf_hub_download(repo, file.rfilename, revision=info.sha, local_dir=root)
            with lock: state['downloadedBytes'] += size
            continue
        expected = file.lfs.sha256
        if destination.is_file() and destination.stat().st_size == size:
            with destination.open('rb') as stream:
                if hashlib.file_digest(stream, 'sha256').hexdigest() == expected:
                    with lock: state['downloadedBytes'] += size
                    continue
        url = hf_hub_url(repo, file.rfilename, revision=info.sha)
        location = get_hf_file_metadata(url).location
        folder = parts / expected
        folder.mkdir(exist_ok=True)
        def fetch(index):
            start, end = index * chunk, min(size, (index + 1) * chunk) - 1
            part = folder / f'{index:04}.part'
            if not (part.is_file() and part.stat().st_size == end-start+1):
                for attempt in range(5):
                    try:
                        signed = location if attempt == 0 else get_hf_file_metadata(url).location
                        request = urllib.request.Request(signed, headers={'Range': f'bytes={start}-{end}', 'Accept-Encoding': 'identity'})
                        with urllib.request.urlopen(request, timeout=60) as response:
                            if response.status != 206 or response.headers.get('Content-Range') != f'bytes {start}-{end}/{size}': raise RuntimeError('Incorrect byte range')
                            data = response.read(chunk + 1)
                        if len(data) != end-start+1: raise RuntimeError('Incomplete chunk')
                        part.write_bytes(data)
                        break
                    except Exception:
                        if attempt == 4: raise
                        time.sleep(attempt + 1)
            with lock: state['downloadedBytes'] += end-start+1
            return part
        count = (size + chunk - 1) // chunk
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            paths = list(pool.map(fetch, range(count)))
        state['message'] = 'Verifying ' + file.rfilename
        destination.parent.mkdir(parents=True, exist_ok=True)
        temp = destination.with_suffix('.downloading')
        digest = hashlib.sha256()
        with temp.open('wb') as output:
            for part in paths:
                data = part.read_bytes(); output.write(data); digest.update(data)
        if digest.hexdigest() != expected: raise RuntimeError('Checkpoint checksum failed')
        temp.replace(destination)
        for part in paths: part.unlink()
    (root / 'helios-install.json').write_text(json.dumps({'repo': repo, 'revision': info.sha, 'license': info.card_data.get('license') if info.card_data else None, 'weightsVerified': True}, indent=2), encoding='utf-8')
    state.update(status='done', message='Model installed; inference testing is still required', downloadedBytes=state['totalBytes'])
except GatedRepoError:
    state.update(status='error', message='Hugging Face access required: accept this model’s access terms and sign in with an authorized Hugging Face account. Download can then resume.')
except Exception as error:
    # HTTP exception strings can contain signed URLs. Keep credentials out of the status panel/log.
    state.update(status='error', message=f'Download could not finish ({type(error).__name__}). Completed chunks are retained for retry.')
finally:
    finished.set(); thread.join(); publish()
    print(json.dumps({'task': task, 'status': state['status'], 'message': state['message']}), flush=True)
