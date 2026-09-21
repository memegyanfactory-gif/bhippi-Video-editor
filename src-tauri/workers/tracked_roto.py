"""SAM 2.1 tracking -> editable segmentation -> trimap -> ViTMatte alpha.

This candidate does not claim production-quality matting or automatic superiority to RVM.
"""
import json
from pathlib import Path
import time


def track(request, emit):
    import numpy as np
    import torch
    from PIL import Image
    from scipy.ndimage import binary_dilation, binary_erosion
    from transformers import Sam2VideoModel, Sam2VideoProcessor, VitMatteForImageMatting, VitMatteImageProcessor

    root = Path(request['folder'])
    paths = sorted((root / 'frames').glob('*.jpg'))
    if not paths or len(paths) > 3600:
        raise ValueError('Invalid frame sequence')
    fps = float(request['fps'])
    corrections = request['points']
    if not any(p['mode'] == 'include' and int(p['at'] * fps) == 0 for p in corrections):
        raise ValueError('Add a foreground point on the first frame before starting tracked Roto.')
    if not torch.cuda.is_available():
        raise RuntimeError('Tracked Roto requires the configured CUDA runtime.')
    frames = [Image.open(path).convert('RGB') for path in paths]
    width, height = frames[0].size
    started = time.perf_counter()
    model = Sam2VideoModel.from_pretrained(request['sam2'], local_files_only=True).to('cuda').eval()
    processor = Sam2VideoProcessor.from_pretrained(request['sam2'], local_files_only=True)
    session = processor.init_video_session(video=frames, inference_device='cuda', inference_state_device='cpu', video_storage_device='cpu')
    grouped = {}
    for point in corrections:
        index = min(len(frames)-1, max(0, int(point['at'] * fps)))
        grouped.setdefault(index, []).append(point)
    with torch.inference_mode():
        for index, points in sorted(grouped.items()):
            processor.add_inputs_to_inference_session(inference_session=session, frame_idx=index, obj_ids=1,
                input_points=[[[[p['x'] * width, p['y'] * height] for p in points]]],
                input_labels=[[[1 if p['mode'] == 'include' else 0 for p in points]]])
            model(inference_session=session, frame_idx=index)
        masks_dir = root / 'segmentation'
        masks_dir.mkdir(exist_ok=True)
        for result in model.propagate_in_video_iterator(session):
            mask = processor.post_process_masks([result.pred_masks], original_sizes=[[height, width]], binarize=False)[0][0, 0].float().cpu().numpy()
            np.save(masks_dir / f'{result.frame_idx:05d}.npy', mask, allow_pickle=False)
            emit(0.05 + 0.4 * (result.frame_idx + 1) / len(frames), f'Tracking frame {result.frame_idx + 1}/{len(frames)}')
    del model, session
    torch.cuda.empty_cache()
    model = VitMatteForImageMatting.from_pretrained(request['vitmatte'], local_files_only=True).to('cuda').eval()
    processor = VitMatteImageProcessor.from_pretrained(request['vitmatte'], local_files_only=True)
    matte_dir = root / 'mattes'
    matte_dir.mkdir(exist_ok=True)
    trimap_dir = root / 'trimaps'
    trimap_dir.mkdir(exist_ok=True)
    subjects = []
    changes = []
    previous = None
    radius = max(1, min(32, int(request.get('trimapRadius', 5))))
    with torch.inference_mode():
        for index, frame in enumerate(frames):
            binary = np.load(masks_dir / f'{index:05d}.npy', allow_pickle=False) > 0
            foreground = binary_erosion(binary, iterations=radius)
            background = ~binary_dilation(binary, iterations=radius)
            trimap = np.full((height, width), 128, dtype=np.uint8)
            trimap[foreground] = 255
            trimap[background] = 0
            trimap_image = Image.fromarray(trimap)
            trimap_image.save(trimap_dir / f'{index+1:05d}.png')
            inputs = processor(images=frame, trimaps=trimap_image, return_tensors='pt').to('cuda')
            alpha = model(**inputs).alphas[0, 0].float().cpu().numpy()[:height, :width].clip(0, 1)
            alpha[foreground] = 1
            alpha[background] = 0
            quantized = np.round(alpha * 65535).astype('>u2')
            with (matte_dir / f'{index+1:05d}.pgm').open('wb') as out:
                out.write(f'P5\n{width} {height}\n65535\n'.encode())
                out.write(quantized.tobytes())
            yy, xx = np.where(alpha > 0.625)
            subjects.append({'at': request['from'] + index / fps, 'x': float(xx.min()/width) if len(xx) else 0, 'y': float(yy.min()/height) if len(yy) else 0, 'width': float((xx.max()-xx.min()+1)/width) if len(xx) else 0, 'height': float((yy.max()-yy.min()+1)/height) if len(yy) else 0, 'cover': float((alpha>0.625).mean())})
            if previous is not None:
                changes.append(float(np.abs(alpha-previous).mean()))
            previous = alpha
            emit(0.5 + 0.45*(index+1)/len(frames), f'Refining alpha {index+1}/{len(frames)}')
    (root / 'subjects.json').write_text(json.dumps(subjects), encoding='utf-8')
    (root / 'tracking-request.json').write_text(json.dumps(request, indent=2), encoding='utf-8')
    (root / 'benchmark.json').write_text(json.dumps({'model': 'SAM2.1 + ViTMatte', 'seconds': time.perf_counter()-started, 'frames': len(frames), 'width': width, 'height': height, 'meanAdjacentAlphaDifference': float(np.mean(changes)) if changes else 0, 'qualityVerdict': 'Not assessed. Adjacent alpha change includes subject motion and is not a flicker metric.'}, indent=2), encoding='utf-8')
