import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[1] / 'work' / 'roto-benchmark'
run = root / 'run-1'
(run / 'frames').mkdir(parents=True, exist_ok=True)
subprocess.run([sys.argv[1], '-hide_banner', '-loglevel', 'error', '-y', '-i', str(root / 'bedroom.mp4'), '-t', '2', '-vf', 'fps=3,scale=512:-2', str(run / 'frames' / '%05d.jpg')], check=True)
models = Path.home() / 'AppData/Roaming/studio.helios.desktop/models/generation'
request = {'action': 'tracked-roto', 'folder': str(run), 'sam2': str(models/'sam2'), 'vitmatte': str(models/'vitmatte'), 'from': 0, 'fps': 3, 'points': [{'at':0,'x':210/854,'y':350/480,'mode':'include'}]}
(root/'request.json').write_text(json.dumps(request), encoding='utf-8')
print('Prepared six source frames and a normalized foreground prompt from the official SAM2 fixture example.')
