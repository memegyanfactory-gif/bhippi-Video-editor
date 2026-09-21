"""Download the CUDA wheel in bounded HTTP ranges and verify its official index hash."""
import concurrent.futures
import hashlib
import html
from pathlib import Path
import re
import urllib.request

INDEX = 'https://download.pytorch.org/whl/cu128/torch/'
NAME = 'torch-2.11.0%2Bcu128-cp313-cp313-win_amd64.whl'
page = urllib.request.urlopen(INDEX, timeout=30).read().decode()
link = next(html.unescape(item) for item in re.findall(r'href="([^"]+)"', page) if NAME in item)
url, expected = link.split('#sha256=')
url = 'https://download.pytorch.org/whl/cu128/' + NAME
size = int(urllib.request.urlopen(urllib.request.Request(url, method='HEAD'), timeout=30).headers['Content-Length'])
destination = Path(__file__).resolve().parents[1] / 'work' / 'runtime-download'
destination.mkdir(parents=True, exist_ok=True)
chunk = 16 * 1024 * 1024

def get(index):
    start, end = index * chunk, min(size, (index + 1) * chunk) - 1
    path = destination / f'{index:04}.part'
    if path.exists() and path.stat().st_size == end - start + 1:
        return path
    request = urllib.request.Request(url, headers={'Range': f'bytes={start}-{end}'})
    with urllib.request.urlopen(request, timeout=60) as response:
        if response.status != 206:
            raise RuntimeError('Server did not honor bounded range download')
        data = response.read(chunk + 1)
    if len(data) != end - start + 1:
        raise RuntimeError('Incomplete runtime download chunk')
    path.write_bytes(data)
    return path

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    paths = list(pool.map(get, range((size + chunk - 1) // chunk)))
target = destination / urllib.parse.unquote(NAME)
digest = hashlib.sha256()
with target.open('wb') as output:
    for path in paths:
        data = path.read_bytes()
        output.write(data)
        digest.update(data)
if digest.hexdigest() != expected:
    target.unlink()
    raise RuntimeError('Runtime SHA256 did not match the official PyTorch index')
for path in paths:
    path.unlink()
print(target, flush=True)
