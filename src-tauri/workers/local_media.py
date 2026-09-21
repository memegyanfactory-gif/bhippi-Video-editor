"""Helios specialist worker. One JSON request, one artifact; no shell or remote code."""
import json
import re
import sys
from pathlib import Path


def emit(progress, message):
    print(json.dumps({"progress": progress, "message": message}), flush=True)


def optimal_sdxl_dimensions(w: int, h: int) -> tuple[int, int]:    # Native SDXL training buckets (~1 megapixel) for maximum sharpness and detail
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


def fit_sdxl_prompt(prompt: str, budget_words: int = 44) -> str:
    """Compress prose to CLIP-friendly comma phrases that fit 77 tokens.

    SDXL's text encoders read at most 77 tokens each; anything past that is
    silently truncated, so a long scene paragraph loses its ending (usually the
    light, lens and mood — the parts that make the image good). CLIP also
    weighs early tokens most, so order is kept: subject first, details after.
    ~44 words stay under the limit with headroom for the quality tail added
    later (words run ~1.3 tokens each). Single-phrase prompts are cut to the
    budget, never padded.
    """
    phrases = [piece.strip(" ,;:.") for piece in re.split(r"[,;]", prompt) if piece.strip(" ,;:.")]
    if len(phrases) <= 1:
        return " ".join(prompt.split()[:budget_words])
    kept: list[str] = []
    used = 0
    for phrase in phrases:
        words = phrase.split()
        if not words:
            continue
        if kept and used + len(words) > budget_words:
            break
        kept.append(phrase)
        used += len(words)
    return ", ".join(kept) if kept else " ".join(prompt.split()[:budget_words])


def execute(request):
    if request.get('action') == 'depth-occlusion':
        from depth_media import execute_depth
        execute_depth(request, emit)
        return
    if request.get('action') == 'tracked-roto':
        from tracked_roto import track
        track(request, emit)
        return
    if request.get('action') == 'person-track':
        from person_track import track_people
        track_people(request, emit)
        return
    if request.get('action') == 'install' and request.get('task') == 'person-track':
        from person_track import install_tracker
        install_tracker(request, emit)
        return
    if request.get('action') == 'install':
        from huggingface_hub import model_info, snapshot_download
        repos = {'image': 'stabilityai/stable-diffusion-xl-base-1.0', 'video': 'Wan-AI/Wan2.1-T2V-1.3B-Diffusers', 'audio': 'stabilityai/stable-audio-open-1.0', 'sam2': 'facebook/sam2.1-hiera-tiny', 'vitmatte': 'hustvl/vitmatte-small-composition-1k', 'depth': 'depth-anything/DA3-SMALL'}
        repo = repos[request['task']]
        info = model_info(repo)
        revision = info.sha
        if not revision:
            raise RuntimeError('The model repository returned no immutable revision.')
        emit(0.05, 'Downloading model; progress depends on network speed')
        weights = '*.fp16.safetensors' if request['task'] == 'image' else '*.safetensors'
        folder = snapshot_download(repo_id=repo, revision=revision, local_dir=request['output'], allow_patterns=['*.json', '*.txt', '*.model', weights, 'LICENSE*', '*.md'], ignore_patterns=['*.bin', '*.onnx', '*.msgpack', '*.ckpt'])
        root = Path(folder)
        if not (root / ('config.json' if request['task'] in ('sam2', 'vitmatte', 'depth') else 'model_index.json')).is_file():
            raise RuntimeError('Incomplete model snapshot')
        (root / 'helios-install.json').write_text(json.dumps({'repo': repo, 'revision': revision, 'license': getattr(info, 'card_data', {}).get('license') if getattr(info, 'card_data', None) else None}, indent=2), encoding='utf-8')
        emit(1, 'Local checkpoint installed; inference verification is still required')
        return
    import torch
    from diffusers import (
        StableDiffusionXLPipeline,
        StableDiffusionXLImg2ImgPipeline,
        StableDiffusionXLInpaintPipeline,
        WanPipeline,
        StableAudioPipeline,
        DPMSolverMultistepScheduler,
    )

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
    original_prompt = prompt
    emit(0.05, "Loading local model")
    dtype = torch.float16
    classes = {"image": StableDiffusionXLPipeline, "image-edit": StableDiffusionXLImg2ImgPipeline, "image-inpaint": StableDiffusionXLInpaintPipeline, "video": WanPipeline, "audio": StableAudioPipeline}
    if task not in classes:
        raise ValueError("Unsupported task; use image, video or audio.")
    # Only local safetensors. Never execute code bundled in a downloaded repository.
    extra = {'variant': 'fp16'} if task.startswith('image') and (checkpoint / 'unet' / 'diffusion_pytorch_model.fp16.safetensors').is_file() else {}
    pipe = classes[task].from_pretrained(str(checkpoint), torch_dtype=dtype, use_safetensors=True, local_files_only=True, **extra)
    pipe.enable_model_cpu_offload()
    if hasattr(pipe, "enable_vae_tiling"):
        pipe.enable_vae_tiling()

    # Float32 VAE precision avoids color clipping, washed-out tones, and black screens in SDXL and Wan
    if hasattr(pipe, "vae") and pipe.vae is not None:
        try:
            pipe.vae.to(dtype=torch.float32)
        except Exception:
            pass

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

    default_guidance = 6.0 if task.startswith("image") else (5.0 if task == "video" else 7.5)
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

        # Smart prompt enrichment. The scene prompt is fit to CLIP first: without
        # this, prose plus the tail overflow 77 tokens and the model never sees
        # the ending. The tail itself stays short for the same reason.
        lower_p = prompt.lower()
        is_chroma = any(k in lower_p for k in ("green screen", "greenscreen", "chroma key", "chroma", "solid green"))
        is_stylized = any(k in lower_p for k in ("illustration", "drawing", "sketch", "anime", "cartoon", "painting", "vector", "pixel art", "render", "3d"))
        prompt = fit_sdxl_prompt(prompt, 32 if is_chroma else 44)
        lower_p = prompt.lower()
        if is_chroma:
            if "isolated" not in lower_p:
                prompt = f"{prompt}, isolated on pure solid chroma green background (#00FF00), seamless studio green screen backdrop, flat studio lighting, centered, sharp distinct silhouette edges, no shadows"
            negative_prompt = f"{negative_prompt}, shadows on green screen, gradient backdrop, color spill, semi-transparent edges, blurry edges"
        elif not is_stylized:
            quality_markers = ("cinematic", "photorealistic", "8k", "sharp focus", "35mm", "dslr", "photograph", "masterpiece", "hyperdetailed", "raw photo")
            if not any(k in lower_p for k in quality_markers):
                prompt = f"{prompt}, cinematic photo, 35mm f/1.8, sharp focus, natural skin texture, 8k"
        emit(0.1, f"Prompt fit to {len(prompt.split())} words for CLIP (was {len(original_prompt.split())})")
    elif task == "video":
        video_master_negative = "blurry, distorted, low quality, bad anatomy, artifacts, watermark, jittery, static frame, deformed, ugly, flickering, stuttering"
        negative_prompt = f"{user_neg}, {video_master_negative}" if user_neg else video_master_negative
        lower_p = prompt.lower()
        if not any(k in lower_p for k in ("motion", "moving", "cinematic", "high quality", "4k", "smooth")):
            prompt = f"{prompt}, smooth natural motion, cinematic video, sharp detail, high framerate, professional cinematography"
    else:
        negative_prompt = user_neg

    kwargs = dict(prompt=prompt, generator=generator, num_inference_steps=steps)
    if task.startswith("image") or task == "video":
        kwargs["guidance_scale"] = guidance_scale
    if negative_prompt and task in ("image", "image-edit", "image-inpaint", "video"):
        kwargs["negative_prompt"] = negative_prompt
    def step_end(pipeline, index, timestep, values):
        emit(0.15 + 0.8 * (index + 1) / steps, f'Inference step {index + 1}/{steps}')
        return values
    if task == 'audio':
        kwargs['callback'] = lambda index, timestep, latents: emit(0.15 + 0.8 * (index + 1) / steps, f'Inference step {index + 1}/{steps}')
        kwargs['callback_steps'] = 1
    else:
        kwargs['callback_on_step_end'] = step_end
    emit(0.15, "Generating; first run may take several minutes")
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
        result = pipe(**kwargs, width=width, height=height).images[0]
        if task == 'image-inpaint':
            # White marks the replacement. Preserve untouched source pixels exactly at output size.
            result = Image.composite(result, source, mask)
        result.save(output)
    elif task == "video":
        from diffusers.utils import export_to_video
        width, height = int(request.get("width", 832)), int(request.get("height", 480))
        frames = int(request.get("frames", 49))
        if any(n < 256 or n > 832 or n % 16 for n in (width, height)) or not 5 <= frames <= 81 or (frames - 1) % 4:
            raise ValueError("Wan dimensions: multiples of 16, 256–832; frames: 4n+1, 5–81.")
        # Wan's autoencoder is kept in float32 for stability.
        pipe.vae.to(dtype=torch.float32)
        result = pipe(**kwargs, width=width, height=height, num_frames=frames).frames[0]
        export_to_video(result, str(output), fps=16)
    else:
        import soundfile
        seconds = float(request.get("seconds", 10))
        if not 1 <= seconds <= 47:
            raise ValueError("Audio length must be 1–47 seconds.")
        result = pipe(**kwargs, audio_end_in_s=seconds).audios[0].T.float().cpu().numpy()
        soundfile.write(output, result, pipe.vae.sampling_rate, subtype="PCM_24")
    if not output.is_file() or output.stat().st_size == 0:
        raise RuntimeError("Inference produced no artifact.")
    output.with_suffix(output.suffix + ".json").write_text(json.dumps({"task": task, "checkpoint": str(checkpoint), "prompt": prompt, "prompt_original": original_prompt if task.startswith("image") else prompt, "negative_prompt": negative_prompt, "guidance_scale": guidance_scale if task.startswith("image") else None, "seed": request.get("seed", 0), "steps": steps, "sourceAssetId": request.get('sourceAssetId'), "maskAssetId": request.get('maskAssetId'), "strength": request.get('strength')}, indent=2), encoding="utf-8")
    emit(1, "Generated artifact saved")


if __name__ == "__main__":
    try:
        execute(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")))
    except Exception as error:
        print(str(error), file=sys.stderr, flush=True)
        sys.exit(1)
