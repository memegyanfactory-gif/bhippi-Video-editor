"""Bhippi specialist worker. One JSON request, one artifact; no shell or remote code."""
import json
import os
import sys
import traceback
import warnings
from pathlib import Path

# Library deprecation chatter (diffusers/transformers/torch) goes to stderr,
# which is exactly what the host surfaces as the failure message — silence it
# so a real error is never buried under warnings.
warnings.filterwarnings("ignore")
os.environ.setdefault("PYTHONWARNINGS", "ignore")


def emit(progress, message):
    print(json.dumps({"progress": progress, "message": message}), flush=True)


def optimal_sdxl_dimensions(w: int, h: int) -> tuple[int, int]:
    # Native SDXL training buckets (~1 megapixel) for maximum sharpness and detail
    buckets = [
        (1024, 1024),  # 1:1 square
        (1152, 896),   # 9:7 landscape (~5:4)
        (896, 1152),   # 7:9 portrait (~4:5)
        (1216, 832),   # 3:2 landscape
        (832, 1216),   # 2:3 portrait
        (1344, 768),   # 16:9 widescreen
        (768, 1344),   # 9:16 vertical (Reels/Shorts/TikTok)
        (1536, 640),   # 21:9 cinematic ultrawide
        (640, 1536),   # 9:21 tall vertical
    ]
    target_ratio = w / max(1, h)
    best = min(buckets, key=lambda b: abs((b[0] / b[1]) - target_ratio))
    return best


def optimal_wan_dimensions(w: int, h: int) -> tuple[int, int]:
    # Multiples of 16 supported by Wan 2.1 (between 256 and 832)
    buckets = [
        (832, 480),  # 16:9 widescreen landscape
        (480, 832),  # 9:16 vertical (Shorts/Reels)
        (624, 624),  # 1:1 square
        (512, 512),  # 1:1 compact square
        (704, 544),  # 4:3 standard
        (544, 704),  # 3:4 portrait
    ]
    target_ratio = w / max(1, h)
    return min(buckets, key=lambda b: abs((b[0] / b[1]) - target_ratio))


def optimal_ltx_dimensions(w: int, h: int) -> tuple[int, int]:
    # Multiples of 32 supported by LTX-Video
    buckets = [
        (768, 512),  # 3:2 / ~16:10 widescreen
        (512, 768),  # 2:3 vertical (Shorts/Reels)
        (704, 480),  # ~16:11 standard landscape
        (480, 704),  # standard portrait
        (512, 512),  # 1:1 square
        (832, 480),  # widescreen
        (480, 832),  # vertical widescreen
        (640, 480),  # 4:3
        (480, 640),  # 3:4
    ]
    target_ratio = w / max(1, h)
    return min(buckets, key=lambda b: abs((b[0] / b[1]) - target_ratio))


def auth_help(task, repo, error):
    """What to do when a gated model (Stable Audio Open) refuses the download."""
    detail = str(error).split('\n')[0][:220]
    return (
        f"Could not download the {task} model from {repo}: {detail}. "
        "This model is gated: open its Hugging Face page while logged in, accept the access terms, "
        "create a read token, and retry the download passing that token (install_local_model hf_token). "
        "Without the token only public models download."
    )


LAMA_URL = 'https://github.com/enesmsahin/simple-lama-inpainting/releases/download/v0.1.0/big-lama.pt'
LAMA_MIN_BYTES = 150 * 1024 * 1024


def _pip_install(emit, low, high, *arguments):
    """Runs pip in this interpreter, streaming its chatter into the progress bar."""
    import subprocess
    command = [sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', *arguments]
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0) if sys.platform == 'win32' else 0
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace', creationflags=flags)
    tail = []
    seen = 0
    for line in process.stdout:
        line = line.strip()
        if not line:
            continue
        tail.append(line)
        tail = tail[-30:]
        if line.startswith(('Collecting', 'Downloading', 'Installing', 'Successfully', 'Requirement already')):
            seen += 1
            emit(min(high, low + (high - low) * min(1.0, seen / 12)), line[:140])
    process.wait()
    if process.returncode != 0:
        raise RuntimeError('pip could not install ' + ' '.join(a for a in arguments if not a.startswith('-')) + '. Install by hand and retry: '
                           + sys.executable + ' -m pip install ' + ' '.join(arguments) + '\n' + '\n'.join(tail[-12:]))


def _download_lama(target, emit):
    """Fetches big-lama.pt with the standard library, resuming a half-finished .part file."""
    import urllib.request
    import urllib.error
    part = target.with_name(target.name + '.part')
    existing = part.stat().st_size if part.is_file() else 0
    headers = {'User-Agent': 'Bhippi local media installer'}
    if existing:
        headers['Range'] = f'bytes={existing}-'
    try:
        response = urllib.request.urlopen(urllib.request.Request(LAMA_URL, headers=headers), timeout=60)
    except urllib.error.HTTPError as error:
        if error.code == 416 and existing:
            # The .part already holds the whole file; the server refuses an empty range.
            os.replace(part, target)
            return
        raise RuntimeError(f'Could not download big-lama.pt ({error.code} {error.reason}). Check the connection and retry.') from error
    except (urllib.error.URLError, OSError) as error:
        raise RuntimeError(f'Could not download big-lama.pt: {error}. Check the connection and retry.') from error
    with response:
        resumed = existing > 0 and response.status == 206
        if not resumed:
            existing = 0
        length = response.headers.get('Content-Length')
        total = existing + int(length) if length and length.isdigit() else 0
        mb = 1024 * 1024
        done = existing
        reported = done
        with open(part, 'ab' if resumed else 'wb') as handle:
            while True:
                chunk = response.read(mb)
                if not chunk:
                    break
                handle.write(chunk)
                done += len(chunk)
                if done - reported >= 2 * mb or (total and done >= total):
                    reported = done
                    fraction = done / total if total else 0.0
                    total_text = f'{total // mb}' if total else '?'
                    emit(0.2 + 0.55 * min(1.0, fraction), f'Downloading big-lama.pt {done // mb}/{total_text} MB')
    if total and done < total:
        raise RuntimeError(f'The big-lama.pt download stopped at {done // mb} of {total // mb} MB; run the install again to resume.')
    if done < LAMA_MIN_BYTES:
        part.unlink(missing_ok=True)
        raise RuntimeError('The downloaded big-lama.pt is too small to be the model; run the install again.')
    os.replace(part, target)


def _lama_smoke_test(model_path, emit):
    """Loads the TorchScript model and inpaints a blank 64×64 frame. Returns which runtime answered."""
    import numpy as np
    import torch
    from PIL import Image
    os.environ['LAMA_MODEL'] = str(model_path)
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    image = np.zeros((64, 64, 3), dtype=np.uint8)
    mask = np.zeros((64, 64), dtype=np.uint8)
    mask[16:48, 16:48] = 255
    try:
        from simple_lama_inpainting import SimpleLama
    except ImportError:
        SimpleLama = None
    if SimpleLama is not None:
        emit(0.85, f'Smoke test: simple-lama-inpainting on {device}')
        try:
            lama = SimpleLama(device=torch.device(device))
        except TypeError:
            lama = SimpleLama()
        result = np.asarray(lama(Image.fromarray(image), Image.fromarray(mask)))
        if result.ndim != 3 or result.shape[0] < 64 or result.shape[1] < 64:
            raise RuntimeError('LaMa returned an unexpected image from the smoke test.')
        return 'simple-lama-inpainting'
    emit(0.85, f'Smoke test: TorchScript big-lama on {device} (simple-lama-inpainting is not importable)')
    model = torch.jit.load(str(model_path), map_location=device)
    model.eval()
    with torch.inference_mode():
        out = model(torch.from_numpy(image.astype(np.float32) / 255.0).permute(2, 0, 1)[None].to(device),
                    torch.from_numpy((mask > 0).astype(np.float32))[None, None].to(device))
    if tuple(out.shape[-2:]) != (64, 64):
        raise RuntimeError('The TorchScript LaMa model returned an unexpected shape.')
    return 'torchscript'


def install_eraser(request, emit):
    """One-click Magic eraser setup: packages, the big-lama weights, and a smoke test.

    simple-lama-inpainting pins numpy<2, pillow<10 and the non-headless OpenCV, all of
    which would downgrade the diffusers runtime around it, so it goes in with --no-deps;
    its runtime only imports torch, numpy, Pillow and cv2, and cv2 comes from the
    headless wheel installed beside it.
    """
    import importlib
    output = Path(request['output'])
    output.mkdir(parents=True, exist_ok=True)
    emit(0.02, 'Installing simple-lama-inpainting and opencv-python-headless into the media Python (once)')
    try:
        importlib.import_module('cv2')
        have_cv2 = True
    except ImportError:
        have_cv2 = False
    try:
        importlib.import_module('simple_lama_inpainting')
        have_lama = True
    except ImportError:
        have_lama = False
    if not have_cv2:
        _pip_install(emit, 0.03, 0.1, 'opencv-python-headless')
    if not have_lama:
        _pip_install(emit, 0.1, 0.18, '--no-deps', 'simple-lama-inpainting')
    target = output / 'big-lama.pt'
    if target.is_file() and target.stat().st_size >= LAMA_MIN_BYTES:
        emit(0.75, 'big-lama.pt is already here; skipping the download')
    else:
        emit(0.2, 'Downloading big-lama.pt (once, ~200 MB)')
        _download_lama(target, emit)
    runtime = _lama_smoke_test(target, emit)
    (output / 'bhippi-install.json').write_text(json.dumps({
        'model': 'big-lama',
        'license': 'Apache-2.0 (LaMa, Samsung AI Lab)',
        'revision': 'v0.1.0',
        'url': LAMA_URL,
        'weights': target.name,
        'packages': ['simple-lama-inpainting', 'opencv-python-headless'],
        'runtime': runtime,
    }, indent=2), encoding='utf-8')
    emit(1, 'Magic eraser installed and verified')


def execute(request):
    if request.get('action') == 'depth-occlusion':
        from depth_media import execute_depth
        execute_depth(request, emit)
        return
    if request.get('action') == 'tracked-roto':
        from tracked_roto import track
        track(request, emit)
        return
    if request.get('action') == 'magic-mask-track':
        from magic_mask import track as track_mask
        track_mask(request, emit)
        return
    if request.get('action') == 'person-track':
        from person_track import track_people
        track_people(request, emit)
        return
    if request.get('action') == 'install' and request.get('task') == 'person-track':
        from person_track import install_tracker
        install_tracker(request, emit)
        return
    if request.get('action') == 'install' and request.get('task') == 'erase':
        install_eraser(request, emit)
        return
    if request.get('action') == 'install':
        from huggingface_hub import hf_hub_download, model_info
        from huggingface_hub.errors import GatedRepoError
        from huggingface_hub.utils import HfHubHTTPError
        repos = {
            'image': 'stabilityai/stable-diffusion-xl-base-1.0',
            'video': 'Lightricks/LTX-Video',
            'video-ltx': 'Lightricks/LTX-Video',
            'video-wan': 'Wan-AI/Wan2.1-T2V-1.3B-Diffusers',
            'audio': 'stabilityai/stable-audio-open-1.0',
            'sam2': 'facebook/sam2.1-hiera-tiny',
            'vitmatte': 'hustvl/vitmatte-small-composition-1k',
            'depth': 'depth-anything/DA3-SMALL',
        }
        repo = repos.get(request['task'], repos['video'])
        token = request.get('hf_token') or None
        # File by file instead of one snapshot_download: same layout, but each
        # finished file moves the progress bar, so a multi-gigabyte download no
        # longer looks stuck at 5%.
        try:
            info = model_info(repo, token=token)
        except (GatedRepoError, HfHubHTTPError) as error:
            raise RuntimeError(auth_help(request['task'], repo, error)) from error
        revision = info.sha
        if not revision:
            raise RuntimeError('The model repository returned no immutable revision.')
        weights = '*.fp16.safetensors' if request['task'] == 'image' else '*.safetensors'
        import fnmatch as _fnmatch
        if repo == 'Lightricks/LTX-Video':
            wanted = [s.rfilename for s in (info.siblings or [])
                      if any(s.rfilename.startswith(p) for p in ('scheduler/', 'text_encoder/', 'tokenizer/', 'transformer/', 'vae/'))
                      or s.rfilename in ('model_index.json', 'README.md')]
        else:
            wanted = [s.rfilename for s in (info.siblings or [])
                      if any(_fnmatch.fnmatch(s.rfilename, p) for p in ['*.json', '*.txt', '*.model', weights, 'LICENSE*', '*.md'])
                      and not any(_fnmatch.fnmatch(s.rfilename, p) for p in ['*.bin', '*.onnx', '*.msgpack', '*.ckpt'])]
        if not wanted:
            raise RuntimeError('The model repository lists no downloadable weights.')
        emit(0.05, f'Downloading {request["task"]} model ({len(wanted)} files); progress depends on network speed')
        for index, filename in enumerate(sorted(wanted)):
            try:
                hf_hub_download(repo_id=repo, filename=filename, revision=revision, local_dir=request['output'], token=token)
            except (GatedRepoError, HfHubHTTPError) as error:
                raise RuntimeError(auth_help(request['task'], repo, error)) from error
            emit(0.05 + 0.9 * (index + 1) / len(wanted), f'Downloaded {index + 1}/{len(wanted)}: {filename}')
        root = Path(request['output'])
        if not (root / ('config.json' if request['task'] in ('sam2', 'vitmatte', 'depth') else 'model_index.json')).is_file():
            raise RuntimeError('Incomplete model snapshot')
        (root / 'bhippi-install.json').write_text(json.dumps({'repo': repo, 'revision': revision, 'license': getattr(info, 'card_data', {}).get('license') if getattr(info, 'card_data', None) else None}, indent=2), encoding='utf-8')
        emit(1, 'Local checkpoint installed; inference verification is still required')
        return
    import torch
    from diffusers import (
        StableDiffusionXLPipeline,
        StableDiffusionXLImg2ImgPipeline,
        StableDiffusionXLInpaintPipeline,
        WanPipeline,
        LTXPipeline,
        StableAudioPipeline,
        DPMSolverMultistepScheduler,
    )
    try:
        import diffusers as _diffusers_pkg
        _diffusers_pkg.logging.set_verbosity_error()
    except Exception:
        pass
    try:
        import transformers as _transformers_pkg
        _transformers_pkg.logging.set_verbosity_error()
    except Exception:
        pass

    task = request["task"]
    checkpoint = Path(request["checkpoint"])
    output = Path(request["output"])
    if not checkpoint.joinpath("model_index.json").is_file():
        raise ValueError("Choose an installed Diffusers model directory containing model_index.json.")
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable in the configured local media Python runtime.")
    prompt = request["prompt"].strip()
    if not prompt or len(prompt) > 12000:
        raise ValueError("Supply a prompt between 1 and 12000 characters.")
    emit(0.05, "Loading local model")
    dtype = torch.float16

    model_index_path = checkpoint / "model_index.json"
    class_name = ""
    try:
        model_index_data = json.loads(model_index_path.read_text(encoding="utf-8"))
        class_name = model_index_data.get("_class_name", "")
    except Exception:
        pass

    is_ltx = class_name == "LTXPipeline" or "ltx" in checkpoint.name.lower()
    if task == "video":
        has_trans = (checkpoint / "transformer").is_dir() and any((checkpoint / "transformer").glob("*.safetensors"))
        if not has_trans:
            for alt in ["video", "video-wan"]:
                alt_folder = checkpoint.parent / alt
                if (alt_folder / "transformer").is_dir() and any((alt_folder / "transformer").glob("*.safetensors")):
                    checkpoint = alt_folder
                    is_ltx = False
                    break
    video_class = LTXPipeline if is_ltx else WanPipeline

    classes = {"image": StableDiffusionXLPipeline, "image-edit": StableDiffusionXLImg2ImgPipeline, "image-inpaint": StableDiffusionXLInpaintPipeline, "video": video_class, "audio": StableAudioPipeline}
    if task not in classes:
        raise ValueError("Unsupported task; use image, video or audio.")
    # Ensure safetensors compatibility across diffusers and transformers
    try:
        import os
        for dirpath, _, filenames in os.walk(str(checkpoint)):
            for f in filenames:
                if f.endswith('.fp16.safetensors'):
                    full = os.path.join(dirpath, f)
                    target = os.path.join(dirpath, f.replace('.fp16.safetensors', '.safetensors'))
                    if not os.path.exists(target):
                        try:
                            os.link(full, target)
                        except Exception:
                            pass
                elif f.endswith('.safetensors') and not f.endswith('.fp16.safetensors'):
                    full = os.path.join(dirpath, f)
                    target = os.path.join(dirpath, f.replace('.safetensors', '.fp16.safetensors'))
                    if not os.path.exists(target):
                        try:
                            os.link(full, target)
                        except Exception:
                            pass
    except Exception:
        pass

    extra = {'variant': 'fp16'} if task.startswith('image') and (checkpoint / 'unet' / 'diffusion_pytorch_model.fp16.safetensors').is_file() else {}
    load_kwargs = {'use_safetensors': True, 'local_files_only': True, **extra}

    def load_pipe(**overrides):
        # diffusers >= 0.31 renamed torch_dtype to dtype; support both.
        if 'dtype' in overrides or 'torch_dtype' in overrides:
            return classes[task].from_pretrained(str(checkpoint), **overrides)
        try:
            return classes[task].from_pretrained(str(checkpoint), dtype=dtype, **overrides)
        except TypeError as dtype_err:
            if 'dtype' not in str(dtype_err):
                raise
            return classes[task].from_pretrained(str(checkpoint), torch_dtype=dtype, **overrides)

    try:
        pipe = load_pipe(**load_kwargs)
    except Exception as load_err:
        if task == "video" and is_ltx:
            # Fallback to Wan if LTX fails
            fell_back = False
            for alt in ["video", "video-wan"]:
                alt_folder = checkpoint.parent / alt
                if (alt_folder / "transformer").is_dir() and any((alt_folder / "transformer").glob("*.safetensors")):
                    checkpoint = alt_folder
                    is_ltx = False
                    classes["video"] = WanPipeline
                    pipe = load_pipe(**load_kwargs)
                    fell_back = True
                    break
            if not fell_back:
                raise load_err
        elif extra:
            load_kwargs = {'use_safetensors': True, 'local_files_only': True}
            pipe = load_pipe(**load_kwargs)
        else:
            raise load_err

    # The installer downloads native fp16 weights (including a fine-tuned fp16
    # VAE), so the whole pipeline stays fp16: a manual fp32 VAE override mixes
    # half-precision latents with float weights and crashes current torch with
    # "Input type Half and bias type Float".
    if hasattr(pipe, "vae") and pipe.vae is not None:
        try:
            pipe.vae.to(dtype=dtype)
        except Exception:
            pass

    pipe.enable_model_cpu_offload()
    if hasattr(pipe, "enable_vae_tiling"):
        pipe.enable_vae_tiling()

    # Configure DPM++ 2M SDE Karras solver for SDXL image tasks for maximum detail and sharpness
    if task.startswith("image") and hasattr(pipe, "scheduler"):
        try:
            pipe.scheduler = DPMSolverMultistepScheduler.from_config(
                pipe.scheduler.config,
                use_karras_sigmas=True,
                algorithm_type="sde-dpmsolver++"
            )
        except Exception:
            try:
                pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config, use_karras_sigmas=True)
            except Exception:
                pass

    generator = torch.Generator("cpu").manual_seed(int(request.get("seed", 0)))
    steps = int(request.get("steps", 30))
    if not 1 <= steps <= 80:
        raise ValueError("Steps must be 1 to 80.")

    default_guidance = 6.0 if task.startswith("image") else (3.0 if (task == "video" and is_ltx) else (5.0 if task == "video" else 7.5))
    guidance_scale = float(request.get("guidance_scale", default_guidance))
    if not 1.0 <= guidance_scale <= 25.0:
        raise ValueError("Guidance scale must be 1.0 to 25.0.")

    user_neg = str(request.get("negative_prompt", "")).strip()
    if task.startswith("image"):
        sdxl_master_negative = (
            "blurry, bad quality, worst quality, low resolution, deformed, distorted, "
            "bad anatomy, bad hands, missing fingers, extra digits, poorly drawn face, poorly drawn eyes, "
            "mutation, extra limbs, ugly, disfigured, text, watermark, signature, logo, jpeg artifacts, "
            "noisy, oversaturated, cropped, out of frame, plastic skin, doll, artificial, cartoon, 3d render"
        )
        negative_prompt = f"{user_neg}, {sdxl_master_negative}" if user_neg else sdxl_master_negative

        # Smart prompt enrichment
        lower_p = prompt.lower()
        is_chroma = any(k in lower_p for k in ("green screen", "greenscreen", "chroma key", "chroma", "solid green"))
        is_stylized = any(k in lower_p for k in ("illustration", "drawing", "sketch", "anime", "cartoon", "painting", "vector", "pixel art", "render", "3d"))
        if is_chroma:
            if "isolated" not in lower_p:
                prompt = f"{prompt}, isolated on pure solid chroma green background (#00FF00), seamless studio green screen backdrop, flat studio lighting, centered, sharp distinct silhouette edges, no shadows"
            negative_prompt = f"{negative_prompt}, shadows on green screen, gradient backdrop, color spill, semi-transparent edges, blurry edges"
        elif not is_stylized:
            quality_markers = ("cinematic", "photorealistic", "8k", "sharp focus", "35mm", "dslr", "photograph", "masterpiece", "hyperdetailed", "raw photo")
            if not any(k in lower_p for k in quality_markers):
                prompt = f"{prompt}, professional photography, 35mm photograph, f/1.8, cinematic lighting, sharp focus, natural skin texture, 8k uhd, masterpiece, hyperdetailed"
    elif task == "video":
        video_master_negative = "blurry, distorted, low quality, bad anatomy, artifacts, watermark, jittery, static frame, deformed, ugly, flickering, stuttering"
        negative_prompt = f"{user_neg}, {video_master_negative}" if user_neg else video_master_negative
        lower_p = prompt.lower()
        if not any(k in lower_p for k in ("motion", "moving", "cinematic", "high quality", "4k", "smooth")):
            prompt = f"{prompt}, smooth natural motion, cinematic video, sharp detail, high framerate, professional cinematography"
    else:
        negative_prompt = user_neg

    def compact_to_window(text, label):
        # CLIP text encoders silently corrupt anything past 77 tokens (and
        # transformers logs a warning per call); compact with the pipeline's
        # own tokenizer so nothing is truncated mid-word by accident.
        try:
            tokenizers = [getattr(pipe, attr, None) for attr in ("tokenizer", "tokenizer_2")]
            tokenizers = [t for t in tokenizers if t is not None and hasattr(t, "model_max_length")]
            if not tokenizers or not text:
                return text
            limit = max(8, min(int(t.model_max_length) for t in tokenizers) - 2)
            ids = tokenizers[0](text, add_special_tokens=False)["input_ids"]
            if len(ids) > limit:
                text = tokenizers[0].decode(ids[:limit], skip_special_tokens=True).strip()
                emit(0.19, f"{label} compacted to the model's {limit}-token window.")
        except Exception:
            pass
        return text

    prompt = compact_to_window(prompt, "Prompt")
    if negative_prompt and task in ("image", "image-edit", "image-inpaint", "video"):
        negative_prompt = compact_to_window(negative_prompt, "Negative prompt")

    kwargs = dict(prompt=prompt, generator=generator, num_inference_steps=steps)
    if task.startswith("image") or task == "video":
        kwargs["guidance_scale"] = guidance_scale
    if negative_prompt and task in ("image", "image-edit", "image-inpaint", "video"):
        kwargs["negative_prompt"] = negative_prompt
    def step_end(pipeline, index, timestep, values):
        pct = 0.20 + 0.70 * (index + 1) / steps
        emit(round(pct, 2), f"Inference step {index + 1}/{steps} ({int(pct * 100)}%)")
        return values
    if task == 'audio':
        kwargs['callback'] = lambda index, timestep, latents: emit(0.20 + 0.70 * (index + 1) / steps, f"Inference step {index + 1}/{steps} ({int((0.20 + 0.70 * (index + 1) / steps) * 100)}%)")
        kwargs['callback_steps'] = 1
    else:
        kwargs['callback_on_step_end'] = step_end
    emit(0.18, "Starting model inference; GPU compute active...")
    if task.startswith("image"):
        req_w = int(request.get("width", 1024))
        req_h = int(request.get("height", 1024))
        width, height = optimal_sdxl_dimensions(req_w, req_h)
        if task != 'image':
            from PIL import Image, ImageOps
            source = ImageOps.exif_transpose(Image.open(request['sourcePath'])).convert('RGB')
            strength = float(request.get('strength', 0.65))
            if not 0 < strength <= 1 or int(steps * strength) < 1:
                raise ValueError('Strength must be in (0,1] and steps * strength must be at least 1.')
            source = source.resize((width, height), Image.Resampling.LANCZOS)
            kwargs.update(image=source, strength=strength)
            if task == 'image-inpaint':
                mask = ImageOps.exif_transpose(Image.open(request['maskPath'])).convert('L').resize((width, height), Image.Resampling.NEAREST)
                kwargs['mask_image'] = mask
        emit(0.20, f"Generating SDXL image: {width}x{height}, {steps} steps...")
        with torch.inference_mode():
            result = pipe(**kwargs, width=width, height=height).images[0]
        if task == 'image-inpaint':
            # White marks the replacement. Preserve untouched source pixels exactly at output size.
            result = Image.composite(result, source, mask)
        emit(0.95, "Saving image artifact...")
        result.save(output)
    elif task == "video":
        from diffusers.utils import export_to_video
        req_w = int(request.get("width", 768 if is_ltx else 832))
        req_h = int(request.get("height", 512 if is_ltx else 480))
        if is_ltx:
            width, height = optimal_ltx_dimensions(req_w, req_h)
            requested_frames = int(request.get("frames", 73))
            # LTX temporal compression requires (frames - 1) % 8 == 0
            clamped_frames = min(max(9, requested_frames), 161)
            frames = ((clamped_frames - 1) // 8) * 8 + 1
            fps = 24
            emit(0.20, f"Generating LTX-Video: {width}x{height}, {frames} frames at {fps} fps ({steps} steps)...")
            kwargs["frame_rate"] = fps
        else:
            width, height = optimal_wan_dimensions(req_w, req_h)
            requested_frames = int(request.get("frames", 81))
            # Strictly enforce maximum 5.0 seconds duration (81 frames at 16 fps = 5.06s)
            clamped_frames = min(max(5, requested_frames), 81)
            frames = ((clamped_frames - 1) // 4) * 4 + 1
            fps = 16
            emit(0.20, f"Generating Wan 2.1 video: {width}x{height}, {frames} frames at {fps} fps ({steps} steps)...")
        with torch.inference_mode():
            result = pipe(**kwargs, width=width, height=height, num_frames=frames).frames[0]
        emit(0.92, "Encoding video frames to MP4...")
        export_to_video(result, str(output), fps=fps)
    else:
        import soundfile
        seconds = float(request.get("seconds", 10))
        if not 1 <= seconds <= 47:
            raise ValueError("Audio length must be 1–47 seconds.")
        with torch.inference_mode():
            result = pipe(**kwargs, audio_end_in_s=seconds).audios[0].T.float().cpu().numpy()
        soundfile.write(output, result, pipe.vae.sampling_rate, subtype="PCM_24")
    if not output.is_file() or output.stat().st_size == 0:
        raise RuntimeError("Inference produced no artifact.")
    output.with_suffix(output.suffix + ".json").write_text(json.dumps({"task": task, "checkpoint": str(checkpoint), "prompt": prompt, "negative_prompt": negative_prompt, "guidance_scale": guidance_scale if task.startswith("image") else None, "seed": request.get("seed", 0), "steps": steps, "sourceAssetId": request.get('sourceAssetId'), "maskAssetId": request.get('maskAssetId'), "strength": request.get('strength')}, indent=2), encoding="utf-8")
    emit(1, "Generated artifact saved")


if __name__ == "__main__":
    try:
        execute(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")))
    except Exception:
        # The full traceback is the diagnosis: the host surfaces stderr, so a
        # bare str(error) plus warning noise used to hide the failing call.
        traceback.print_exc()
        sys.exit(1)
