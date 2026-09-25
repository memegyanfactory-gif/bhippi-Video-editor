"""Magic Mask: click anything in a shot and keep it picked for the whole clip.

One checkpoint (SAM 2.1, Apache-2.0), two ways of running it:

  · serve — a resident process behind the Program Monitor. The image model stays loaded and each
            frame's embedding is cached, so a click answers in tens of milliseconds instead of
            the seconds a fresh process needs. JSON lines in on stdin, one JSON line out per line.
  · track — a job (local_media.py dispatches `magic-mask-track`). SAM 2.1's video predictor
            carries the clicks through the clip: forwards from the first clicked frame to the end,
            then backwards to the start. The soft mask is steadied over time (Consistency) and,
            at Better quality, its edge is rebuilt by ViTMatte from a trimap.

The video session keeps every frame it holds at 1024² float32 (~12 MB each), so the clip is
tracked in windows of WINDOW frames; each window is seeded with the mask the last one ended on.
"""
import json
import sys
import time
from collections import OrderedDict
from pathlib import Path

WINDOW = 120
# SAM degrades with a crowd of points; a painted stroke is thinned to this many per frame.
MAX_POINTS = 24


def _quiet():
    import warnings
    warnings.filterwarnings('ignore')
    try:
        from transformers.utils import logging
        logging.set_verbosity_error()
        logging.disable_progress_bar()
    except Exception:
        pass


def _thin(points):
    """Keeps every exclude click and spreads the rest evenly, up to MAX_POINTS."""
    if len(points) <= MAX_POINTS:
        return points
    step = len(points) / MAX_POINTS
    return [points[int(i * step)] for i in range(MAX_POINTS)]


def _labels(points, width, height):
    points = _thin(points)
    coords = [[float(p['x']) * width, float(p['y']) * height] for p in points]
    labels = [1 if p['mode'] == 'include' else 0 for p in points]
    return coords, labels


# ─── serve ───────────────────────────────────────────────────────────────────────────────────

class Picker:
    """The image model, one checkpoint at a time, with the last few frames' embeddings kept."""

    def __init__(self):
        self.checkpoint = None
        self.model = None
        self.processor = None
        self.embeddings = OrderedDict()

    def load(self, checkpoint):
        if self.checkpoint == checkpoint:
            return
        import torch
        from transformers import Sam2Model, Sam2Processor
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
        self.model = Sam2Model.from_pretrained(checkpoint, local_files_only=True).to(device).eval()
        self.processor = Sam2Processor.from_pretrained(checkpoint, local_files_only=True)
        self.device = device
        self.checkpoint = checkpoint
        self.embeddings.clear()

    def frame(self, request):
        import numpy as np
        import torch
        from PIL import Image
        started = time.perf_counter()
        self.load(request['checkpoint'])
        path = request['image']
        image = Image.open(path).convert('RGB')
        width, height = image.size
        points = [p for p in request['points'] if p['mode'] in ('include', 'exclude')]
        if not any(p['mode'] == 'include' for p in points):
            raise ValueError('Click the thing to mask first; an exclude click needs something to take away from.')
        coords, labels = _labels(points, width, height)
        with torch.inference_mode():
            embedding = self.embeddings.get(path)
            if embedding is None:
                pixels = self.processor(images=image, return_tensors='pt').to(self.device)['pixel_values']
                embedding = self.model.get_image_embeddings(pixels)
                self.embeddings[path] = embedding
                while len(self.embeddings) > 6:
                    self.embeddings.popitem(last=False)
            else:
                self.embeddings.move_to_end(path)
            inputs = self.processor(images=image, input_points=[[coords]], input_labels=[[labels]], return_tensors='pt').to(self.device)
            # One click is ambiguous (the shirt, the person, the crowd): ask for three and keep the
            # one SAM is surest of. More clicks already say which one is meant.
            several = len(coords) == 1
            output = self.model(input_points=inputs['input_points'], input_labels=inputs['input_labels'], image_embeddings=embedding, multimask_output=several)
            logits = self.processor.post_process_masks(output.pred_masks.cpu(), inputs['original_sizes'], binarize=False)[0][0]
            scores = output.iou_scores[0, 0].float().cpu()
            best = int(scores.argmax()) if several else 0
            probability = torch.sigmoid(logits[best].float()).numpy()
        Image.fromarray(np.round(probability * 255).astype('uint8')).save(request['out'])
        cover = float((probability > 0.5).mean())
        return {'ok': True, 'out': request['out'], 'score': float(scores[best]), 'cover': cover, 'ms': round((time.perf_counter() - started) * 1000)}


def serve():
    _quiet()
    # Libraries print to stdout now and then; replies must be the only thing on it.
    out = sys.stdout
    sys.stdout = sys.stderr
    picker = Picker()
    print(json.dumps({'ok': True, 'ready': True}), file=out, flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            if request.get('cmd') == 'quit':
                break
            reply = picker.frame(request)
        except Exception as error:  # the host shows this to the user
            reply = {'ok': False, 'error': f'{type(error).__name__}: {error}'}
        print(json.dumps(reply), file=out, flush=True)


# ─── track ───────────────────────────────────────────────────────────────────────────────────

def _windows(first, count):
    """Frame ranges to track, in order: forwards from `first`, then backwards from it.

    Each window overlaps the one before by a frame, the frame whose mask seeds it."""
    forward = []
    start = first
    while start < count - 1 or not forward:
        end = min(count, start + WINDOW)
        forward.append((start, end, False))
        if end >= count:
            break
        start = end - 1
    backward = []
    end = first + 1
    while end > 1:
        start = max(0, end - WINDOW)
        backward.append((start, end, True))
        end = start + 1
    return forward + backward


def _track_masks(request, frames, emit):
    """SAM 2.1 over the clip; returns probability planes (uint8) by frame index."""
    import numpy as np
    import torch
    from transformers import Sam2VideoModel, Sam2VideoProcessor
    width, height = frames[0].size
    fps = float(request['fps'])
    seeds = {}
    for point in request['points']:
        if point['mode'] not in ('include', 'exclude'):
            continue
        index = min(len(frames) - 1, max(0, int(float(point['at']) * fps + 1e-6)))
        seeds.setdefault(index, []).append(point)
    seeds = {index: points for index, points in seeds.items() if any(p['mode'] == 'include' for p in points)}
    if not seeds:
        raise ValueError('Click the thing to mask on at least one frame before tracking.')
    first = min(seeds)
    model = Sam2VideoModel.from_pretrained(request['sam2'], local_files_only=True).to('cuda').eval()
    processor = Sam2VideoProcessor.from_pretrained(request['sam2'], local_files_only=True)
    planes = {}
    windows = _windows(first, len(frames))
    done = 0
    with torch.inference_mode():
        for start, end, reverse in windows:
            session = processor.init_video_session(video=frames[start:end], inference_device='cuda', inference_state_device='cpu', video_storage_device='cpu')
            anchor = end - 1 if reverse else start
            seeded = False
            for index in range(start, end):
                points = seeds.get(index)
                if not points:
                    continue
                coords, labels = _labels(points, width, height)
                processor.add_inputs_to_inference_session(inference_session=session, frame_idx=index - start, obj_ids=1, input_points=[[coords]], input_labels=[[labels]])
                model(inference_session=session, frame_idx=index - start)
                seeded = True
            if anchor in planes and anchor not in seeds:
                # Carry the object across the window edge on the mask it was last seen with.
                processor.add_inputs_to_inference_session(inference_session=session, frame_idx=anchor - start, obj_ids=1, input_masks=planes[anchor] >= 128)
                model(inference_session=session, frame_idx=anchor - start)
                seeded = True
            if not seeded:
                continue
            for result in model.propagate_in_video_iterator(session, start_frame_idx=anchor - start, reverse=reverse):
                index = start + result.frame_idx
                logits = processor.post_process_masks([result.pred_masks], original_sizes=[[height, width]], binarize=False)[0][0, 0].float()
                planes[index] = np.round(torch.sigmoid(logits).cpu().numpy() * 255).astype('uint8')
                done += 1
                emit(0.05 + 0.5 * min(1.0, done / (len(frames) + len(windows))), f'Tracking frame {index + 1}/{len(frames)}')
            del session
    del model
    torch.cuda.empty_cache()
    missing = [i for i in range(len(frames)) if i not in planes]
    if missing:
        raise RuntimeError(f'Tracking left {len(missing)} frames without a mask.')
    return planes


def _steady(planes, consistency):
    """A temporal bilateral filter: neighbouring frames that agree with this one are averaged in,
    so an edge that shimmers settles, while a real move (where they disagree) is left alone."""
    import numpy as np
    reach = int(round(max(0.0, min(1.0, consistency)) * 4))
    if reach == 0:
        return lambda i: planes[i].astype('float32') / 255
    count = len(planes)

    def at(i):
        centre = planes[i].astype('float32') / 255
        total = np.ones_like(centre)
        weighted = centre.copy()
        for offset in range(-reach, reach + 1):
            j = i + offset
            if offset == 0 or j < 0 or j >= count:
                continue
            other = planes[j].astype('float32') / 255
            weight = (1 - abs(offset) / (reach + 1)) * np.exp(-((other - centre) / 0.3) ** 2)
            weighted += weight * other
            total += weight
        return weighted / total
    return at


def track(request, emit):
    _quiet()
    import numpy as np
    import torch
    from PIL import Image
    from scipy.ndimage import binary_dilation, binary_erosion, gaussian_filter
    root = Path(request['folder'])
    paths = sorted((root / 'frames').glob('*.jpg'))
    if not paths or len(paths) > 9000:
        raise ValueError('Invalid frame sequence')
    if not torch.cuda.is_available():
        raise RuntimeError('Magic Mask tracking needs the CUDA runtime from Settings › Local media.')
    started = time.perf_counter()
    frames = [Image.open(path).convert('RGB') for path in paths]
    width, height = frames[0].size
    planes = _track_masks(request, frames, emit)
    steady = _steady(planes, float(request.get('consistency', 0.5)))
    better = request.get('quality') == 'better'
    if better:
        from transformers import VitMatteForImageMatting, VitMatteImageProcessor
        matter = VitMatteForImageMatting.from_pretrained(request['vitmatte'], local_files_only=True).to('cuda').eval()
        matter_processor = VitMatteImageProcessor.from_pretrained(request['vitmatte'], local_files_only=True)
    radius = max(2, round(width / 128))
    matte_dir = root / 'mattes'
    matte_dir.mkdir(exist_ok=True)
    subjects = []
    with torch.inference_mode():
        for index, frame in enumerate(frames):
            probability = steady(index)
            if better:
                solid = probability >= 0.5
                foreground = binary_erosion(solid, iterations=radius)
                background = ~binary_dilation(solid, iterations=radius)
                trimap = np.full((height, width), 128, dtype=np.uint8)
                trimap[foreground] = 255
                trimap[background] = 0
                inputs = matter_processor(images=frame, trimaps=Image.fromarray(trimap), return_tensors='pt').to('cuda')
                alpha = matter(**inputs).alphas[0, 0].float().cpu().numpy()[:height, :width].clip(0, 1)
                alpha[foreground] = 1
                alpha[background] = 0
            else:
                # SAM's probability is sharp but stair-stepped at 512 px; a short ramp and a
                # sub-pixel blur give the edge a believable roll-off.
                alpha = np.clip((probability - 0.5) / 0.3 + 0.5, 0, 1)
                alpha = gaussian_filter(alpha, 0.6)
            quantized = np.round(alpha * 65535).astype('>u2')
            with (matte_dir / f'{index + 1:05d}.pgm').open('wb') as out:
                out.write(f'P5\n{width} {height}\n65535\n'.encode())
                out.write(quantized.tobytes())
            yy, xx = np.where(alpha > 0.625)
            subjects.append({
                'at': request['from'] + index / float(request['fps']),
                'x': float(xx.min() / width) if len(xx) else 0,
                'y': float(yy.min() / height) if len(yy) else 0,
                'width': float((xx.max() - xx.min() + 1) / width) if len(xx) else 0,
                'height': float((yy.max() - yy.min() + 1) / height) if len(yy) else 0,
                'cover': float((alpha > 0.625).mean()),
            })
            emit(0.55 + 0.4 * (index + 1) / len(frames), f'{"Refining edge" if better else "Writing mask"} {index + 1}/{len(frames)}')
    (root / 'subjects.json').write_text(json.dumps(subjects), encoding='utf-8')
    (root / 'magic-mask-request.json').write_text(json.dumps(request, indent=2), encoding='utf-8')
    (root / 'benchmark.json').write_text(json.dumps({'model': 'SAM2.1 magic mask' + (' + ViTMatte' if better else ''), 'seconds': time.perf_counter() - started, 'frames': len(frames), 'width': width, 'height': height}, indent=2), encoding='utf-8')


if __name__ == '__main__':
    if '--serve' in sys.argv:
        serve()
