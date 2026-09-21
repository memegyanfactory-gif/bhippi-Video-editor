"""Relative video depth to editable, high precision foreground occlusion.

Depth is geometry, not a hair/transparent-material alpha estimator. Keep original
RGB untouched and store float depth separately from the derived 16-bit matte.
"""
import json
from pathlib import Path
import numpy as np


def occlusion_alpha(depth, threshold, softness, low, high):
    if not np.isfinite(depth).all() or high <= low:
        raise ValueError('Depth contains invalid values or has no usable range.')
    normalized = np.clip((depth - low) / (high - low), 0, 1)
    if softness == 0:
        return (normalized < threshold).astype(np.float32)
    x = np.clip((threshold + softness / 2 - normalized) / softness, 0, 1)
    return x * x * (3 - 2 * x)


def execute_depth(request, emit):
    import torch
    from PIL import Image
    from depth_anything_3.api import DepthAnything3
    root = Path(request['folder'])
    images = sorted((root / 'frames').glob('*.jpg'))
    threshold, softness = float(request['threshold']), float(request['softness'])
    if not 0 < threshold < 1 or not 0 <= softness <= 0.25:
        raise ValueError('Depth plane must be between 0 and 1; softness must be 0–0.25.')
    if not images or len(images) > 900:
        raise ValueError('Depth supports up to 900 frames per shot. Split longer shots first.')
    if not torch.cuda.is_available():
        raise RuntimeError('Depth requires the configured CUDA runtime.')
    checkpoint = Path(request['checkpoint'])
    if not (checkpoint / 'model.safetensors').is_file():
        raise ValueError('Install Depth Anything 3 Small first.')
    model = DepthAnything3.from_pretrained(str(checkpoint), local_files_only=True).to('cuda').eval()
    depths = root / 'depth'
    depths.mkdir(exist_ok=True)
    samples, previous = [], None
    # Overlap anchors keep one relative scale across windows. No per-frame normalization.
    window, overlap = 16, 4
    for start in range(0, len(images), window - overlap):
        paths = images[start:start + window]
        emit(0.05 + 0.65 * start / len(images), f'Estimating depth frames {start + 1}–{start + len(paths)}')
        prediction = model.inference([str(p) for p in paths], process_res=280, process_res_method='upper_bound_resize')
        values = np.asarray(prediction.depth, dtype=np.float32)
        if not np.isfinite(values).all() or (values <= 0).all():
            raise ValueError('The depth model returned invalid geometry.')
        skip = 0
        if previous is not None:
            skip = min(overlap, len(values))
            anchor, current = previous[-overlap:][:skip], values[:skip]
            valid = (anchor > 1e-6) & (current > 1e-6)
            scale = float(np.median(anchor[valid] / current[valid])) if valid.any() else float('nan')
            if not np.isfinite(scale) or scale <= 0:
                raise ValueError('Cannot align depth windows; split this shot at the scene cut.')
            values *= scale
        for local in range(skip, len(values)):
            value = values[local]
            np.save(depths / f'{start + local + 1:05d}.npy', value, allow_pickle=False)
            samples.append(value[::8, ::8].reshape(-1))
        previous = values
        if start + len(paths) == len(images):
            break
    del model
    torch.cuda.empty_cache()
    low, high = np.percentile(np.concatenate(samples), [1, 99]).astype(float)
    mattes = root / 'mattes'
    mattes.mkdir(exist_ok=True)
    subjects = []
    for index, path in enumerate(images):
        value = np.load(depths / f'{index + 1:05d}.npy', allow_pickle=False)
        with Image.open(path) as source:
            width, height = source.size
        # Resize continuous depth before thresholding; never resize class labels.
        value = np.asarray(Image.fromarray(value).resize((width, height), Image.Resampling.BILINEAR))
        alpha = occlusion_alpha(value, threshold, softness, low, high)
        header = f'P5\n{width} {height}\n65535\n'.encode()
        (mattes / f'{index + 1:05d}.pgm').write_bytes(header + np.rint(alpha * 65535).astype('>u2').tobytes())
        ys, xs = np.where(alpha > 0.5)
        subjects.append({'at': request['from'] + index / request['fps'], 'x': float(xs.min() / width) if xs.size else 0,
            'y': float(ys.min() / height) if ys.size else 0, 'width': float((xs.max()-xs.min()+1)/width) if xs.size else 0,
            'height': float((ys.max()-ys.min()+1)/height) if ys.size else 0, 'cover': float(np.mean(alpha > 0.5))})
        emit(0.72 + 0.25 * (index+1)/len(images), f'Writing depth occlusion {index+1}/{len(images)}')
    (root / 'subjects.json').write_text(json.dumps(subjects), encoding='utf-8')
    (root / 'depth.json').write_text(json.dumps({'model': 'DA3-SMALL', 'units': 'relative-not-metres', 'near': low, 'far': high,
        'threshold': threshold, 'softness': softness, 'fps': request['fps'], 'from': request['from'], 'frames': len(images),
        'alpha': 'straight coverage; original RGB retained', 'precision': 'float32 depth; uint16 matte',
        'limitations': 'Depth occlusion is not hair matting, relighting, camera tracking or physically correct transparent surfaces.'}, indent=2), encoding='utf-8')
