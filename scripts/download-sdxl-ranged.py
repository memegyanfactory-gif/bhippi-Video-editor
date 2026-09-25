"""Resume SDXL's pinned official safetensors with bounded, hash-verified HTTP ranges."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import time
import urllib.request
from huggingface_hub import model_info, hf_hub_url

repo = 'stabilityai/stable-diffusion-xl-base-1.0'
target = Path.home() / 'AppData/Roaming/com.bhippi.videoeditor/models/generation/image'
info = model_info(repo, files_metadata=True)
chunk = 16 * 1024 * 1024
parts = Path(__file__).resolve().parents[1] / 'work/model-download'
parts.mkdir(parents=True, exist_ok=True)
for file in info.siblings:
    if not file.rfilename.endswith('.fp16.safetensors'):
        continue
    destination = target / file.rfilename
    expected = file.lfs.sha256
    size = file.size
    if destination.is_file() and destination.stat().st_size == size:
        with destination.open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() == expected:
                print(f'Verified {file.rfilename}', flush=True)
                continue
    url = hf_hub_url(repo, file.rfilename, revision=info.sha)
    folder = parts / expected
    folder.mkdir(exist_ok=True)
    def fetch(index):
        start, end = index * chunk, min(size, (index + 1) * chunk) - 1
        path = folder / f'{index:04}.part'
        if path.is_file() and path.stat().st_size == end-start+1:
            return path
        for attempt in range(4):
            try:
                # Resolve a fresh signed CDN URL with this specific byte range.
                request = urllib.request.Request(url, headers={'Range': f'bytes={start}-{end}'})
                with urllib.request.urlopen(request, timeout=60) as response:
                    if response.status != 206 or response.headers.get('Content-Range') != f'bytes {start}-{end}/{size}':
                        raise RuntimeError('Server did not honor the requested byte range')
                    data = response.read(chunk + 1)
                if len(data) != end-start+1:
                    raise RuntimeError('Incomplete model chunk')
                path.write_bytes(data)
                return path
            except Exception:
                if attempt == 3: raise
                time.sleep(attempt + 1)
    total = (size + chunk - 1) // chunk
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        paths = []
        for index, path in enumerate(pool.map(fetch, range(total))):
            paths.append(path)
            if index % 16 == 0: print(f'{file.rfilename}: {index+1}/{total} chunks', flush=True)
    temporary = destination.with_suffix('.downloading')
    destination.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    with temporary.open('wb') as output:
        for path in paths:
            data = path.read_bytes(); output.write(data); digest.update(data)
    if digest.hexdigest() != expected:
        raise RuntimeError('Checkpoint SHA256 mismatch; the temporary file was not installed')
    temporary.replace(destination)
    for path in paths: path.unlink()
    print(f'Verified {file.rfilename}', flush=True)
(target / 'bhippi-install.json').write_text(json.dumps({'repo': repo, 'revision': info.sha, 'license': info.card_data.get('license'), 'weightsVerified': True}, indent=2))
print('SDXL safetensors verified and installed', flush=True)
