import json
import os
import sys
import time
from pathlib import Path

# Setup ComfyUI import path
comfy_dir = r"C:\Users\aayus\AppData\Local\Comfy-Desktop\ComfyUI-Installs\COMFY\ComfyUI"
if os.path.isdir(comfy_dir) and comfy_dir not in sys.path:
    sys.path.insert(0, comfy_dir)

import torch
import comfy.sd
import comfy.model_management
import comfy.sample
import comfy.utils
import comfy.nested_tensor


def optimal_ltx_dimensions(width: int, height: int) -> tuple[int, int]:
    w = max(384, min(1024, (width // 32) * 32))
    h = max(256, min(768, (height // 32) * 32))
    return w, h


def execute(request: dict) -> None:
    output_path = Path(request["output"])
    output_path.parent.mkdir(parents=True, exist_ok=True)

    prompt = request.get("prompt", "")
    neg_prompt = request.get("negative_prompt", "blurry, worst quality, low resolution, deformed, distorted, text, watermark")
    raw_w = int(request.get("width", 768))
    raw_h = int(request.get("height", 512))
    width, height = optimal_ltx_dimensions(raw_w, raw_h)

    # Frame pacing
    raw_frames = int(request.get("frames", 25))
    frames = max(9, min(97, ((raw_frames - 1) // 8) * 8 + 1))
    frame_rate = 25.0

    print("Loading local model", flush=True)

    ckpt_path = request.get("checkpoint")
    if not ckpt_path or not os.path.isfile(ckpt_path):
        ckpt_path = r"C:\Users\aayus\AppData\Local\Comfy-Desktop\ComfyUI-Shared\models\checkpoints\ltx-2.3-22b-dev-fp8.safetensors"

    te_path = r"C:\Users\aayus\AppData\Local\Comfy-Desktop\ComfyUI-Shared\models\text_encoders\gemma_3_12B_it_fp4_mixed.safetensors"
    lora_path = r"C:\Users\aayus\AppData\Local\Comfy-Desktop\ComfyUI-Shared\models\loras\ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors"

    # 1. Checkpoint & Video VAE
    model, _, vae, _ = comfy.sd.load_checkpoint_guess_config(ckpt_path)

    # 2. Audio VAE
    sd_ckpt, metadata = comfy.utils.load_torch_file(ckpt_path, return_metadata=True)
    sd_audio = comfy.utils.state_dict_prefix_replace(sd_ckpt, {"audio_vae.": "autoencoder.", "vocoder.": "vocoder."}, filter_keys=True)
    audio_vae = comfy.sd.VAE(sd=sd_audio, metadata=metadata)

    # 3. Gemma Text Encoder + Checkpoint Projection
    clip = comfy.sd.load_clip(ckpt_paths=[te_path, ckpt_path], clip_type=comfy.sd.CLIPType.LTXV)

    # 4. Optional Distilled LoRA for 6-step fast inference
    has_lora = os.path.isfile(lora_path)
    steps = int(request.get("steps", 6 if has_lora else 20))
    if has_lora:
        lora = comfy.utils.load_torch_file(lora_path, safe_load=True)
        model, clip = comfy.sd.load_lora_for_models(model, clip, lora, 1.0, 1.0)

    # 5. Prompt conditioning
    tokens = clip.tokenize(prompt)
    pos = clip.encode_from_tokens_scheduled(tokens)

    tokens_neg = clip.tokenize(neg_prompt)
    neg = clip.encode_from_tokens_scheduled(tokens_neg)

    # 6. Latents
    latent_h = height // 32
    latent_w = width // 32
    latent_t = (frames - 1) // 8 + 1
    video_latent = torch.zeros([1, 128, latent_t, latent_h, latent_w], device="cpu")

    z_channels = audio_vae.latent_channels
    audio_freq = audio_vae.first_stage_model.latent_frequency_bins
    num_audio_latents = audio_vae.first_stage_model.num_of_latents_from_frames(frames, frame_rate)
    audio_latent = torch.zeros([1, z_channels, num_audio_latents, audio_freq], device="cpu")

    av_latent = comfy.nested_tensor.NestedTensor((video_latent, audio_latent))
    seed = int(request.get("seed", int(time.time()))) % (2**31)
    generator = torch.manual_seed(seed)
    noise = comfy.nested_tensor.NestedTensor((
        torch.randn(video_latent.shape, generator=generator),
        torch.randn(audio_latent.shape, generator=generator)
    ))

    print(f"Generating LTX-Video 2.3: {width}x{height}, {frames} frames ({steps} steps)...", flush=True)

    def callback(step, x0, x, total_steps):
        pct = int(((step + 1) / total_steps) * 70 + 20)
        print(f"Inference step {step + 1}/{total_steps} ({pct}%)", flush=True)

    cfg = float(request.get("guidance_scale", 1.0 if has_lora else 3.0))

    samples = comfy.sample.sample(
        model,
        noise=noise,
        steps=steps,
        cfg=cfg,
        sampler_name="euler",
        scheduler="simple",
        positive=pos,
        negative=neg,
        latent_image=av_latent,
        denoise=1.0,
        seed=seed,
        callback=callback
    )

    print("Decoding generated latents...", flush=True)
    unbound = samples.unbind()
    video_out = unbound[0]
    audio_out = unbound[1]

    # Decode video frames
    frames_tensor = vae.decode(video_out)
    if frames_tensor.dim() == 5:
        # [B, T, H, W, C]
        frames_tensor = frames_tensor.squeeze(0)

    # Scale to uint8 [0, 255]
    video_frames = (torch.clamp(frames_tensor, 0.0, 1.0) * 255.0).to(torch.uint8)

    # Decode audio
    audio_wave = audio_vae.decode(audio_out).movedim(-1, 1).squeeze(0)
    audio_sample_rate = int(audio_vae.first_stage_model.output_sample_rate)

    # Save to MP4 with av (PyAV)
    import av
    container = av.open(str(output_path), mode="w", format="mp4")
    v_stream = container.add_stream("h264", rate=int(frame_rate))
    v_stream.width = width
    v_stream.height = height
    v_stream.pix_fmt = "yuv420p"

    for img_tensor in video_frames:
        frame = av.VideoFrame.from_ndarray(img_tensor.cpu().numpy(), format="rgb24")
        for packet in v_stream.encode(frame):
            container.mux(packet)
    for packet in v_stream.encode():
        container.mux(packet)

    # Audio stream
    try:
        a_stream = container.add_stream("aac", rate=audio_sample_rate)
        a_stream.channels = audio_wave.shape[0] if audio_wave.dim() > 1 else 1
        audio_np = audio_wave.cpu().numpy()
        a_frame = av.AudioFrame.from_ndarray(audio_np, format="fltp", layout="stereo" if a_stream.channels == 2 else "mono")
        a_frame.sample_rate = audio_sample_rate
        for packet in a_stream.encode(a_frame):
            container.mux(packet)
        for packet in a_stream.encode():
            container.mux(packet)
    except Exception as e:
        print(f"Warning: Audio muxing skipped: {e}", flush=True)

    container.close()
    print("Generated artifact saved", flush=True)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(1)
    req = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    execute(req)
