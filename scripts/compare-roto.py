"""A matched-input smoke comparison, explicitly not a production matte-quality verdict."""
import json
from pathlib import Path
import time
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1] / 'work' / 'roto-benchmark'
candidate = root / 'run-1'
model_path = Path.home() / 'AppData/Roaming/com.bhippi.videoeditor/models/matte/rvm_mobilenetv3_fp32.onnx'
session = ort.InferenceSession(str(model_path), providers=['CPUExecutionProvider'])
state = {f'r{i}i': np.zeros((1,1,1,1),np.float32) for i in range(1,5)}
started = time.perf_counter()
alphas = []
frames = []
for path in sorted((candidate / 'frames').glob('*.jpg')):
    frame = Image.open(path).convert('RGB')
    values = np.asarray(frame).astype(np.float32).transpose(2,0,1)[None] / 255
    output = dict(zip([x.name for x in session.get_outputs()], session.run(None, {'src':values,'downsample_ratio':np.array([0.25],np.float32),**state})))
    state = {f'r{i}i': output[f'r{i}o'] for i in range(1,5)}
    alphas.append(output['pha'][0,0]); frames.append(frame)
seconds = time.perf_counter()-started
candidate_alpha = np.asarray(Image.open(candidate/'mattes/00001.pgm')).astype(np.float32)/65535
width,height=frames[0].size
comparison=Image.new('RGB',(width*3,height+32),'#202020')
for index,(label,picture) in enumerate([('Source',frames[0]),('RVM alpha · CPU',Image.fromarray(np.round(alphas[0]*255).astype(np.uint8)).convert('RGB')),('SAM 2.1 + ViTMatte alpha · GPU',Image.fromarray(np.round(candidate_alpha*255).astype(np.uint8)).convert('RGB'))]):
    comparison.paste(picture,(index*width,32)); ImageDraw.Draw(comparison).text((index*width+8,8),label,fill='white')
comparison.save(root/'comparison.png')
candidate_report=json.loads((candidate/'benchmark.json').read_text())
report={'fixture':'https://huggingface.co/datasets/hf-internal-testing/sam2-fixtures/resolve/main/bedroom.mp4','frames':len(frames),'rvm':{'device':'CPU','inferenceSeconds':seconds,'firstFrameCoverage':float((alphas[0]>.625).mean())},'candidate':candidate_report,'candidateFirstFrameCoverage':float((candidate_alpha>.625).mean()),'verdict':'Smoke test only. Both pipelines ran on identical six frames. Devices differ so runtime is not a fair model speed comparison. Bed segmentation is outside human-focused RVM scope. No ground-truth alpha and no hair, blur, spill, occlusion or re-entry quality evaluation.'}
(root/'comparison.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
