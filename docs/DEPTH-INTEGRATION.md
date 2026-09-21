# Depth Anything 3 integration

Installed official DA3-SMALL weights from `depth-anything/DA3-SMALL`, revision
`e08cab65ca0ec38e7826075418411ab90cab4da3`, SHA256 verified by the resumable
downloader. Model card: https://huggingface.co/depth-anything/DA3-SMALL (Apache-2.0).

Runtime: official ByteDance-Seed/Depth-Anything-3 source at
`3d835ec1a5802d64a8b8b15f817a1ab54809bfe4`, installed into `.media-venv` without
replacing CUDA Torch. The upstream package's Python/numpy constraints do not match
this Python 3.13 / numpy 2 environment, so this is a tested compatibility setup,
not a clean upstream dependency resolution. Optional gsplat, xformers, open3d,
web server and development packages are not needed for this depth-only path.
Import and actual CUDA depth inference pass. Revalidate when upgrading the runtime.

## Tools and pipeline

`install_local_model(task="depth")` downloads the checkpoint into Settings.
`depth_occlusion_clip(clipId, depthPlane, softness)` extracts every clip frame,
runs joint depth in overlapping 16-frame windows with 4-frame scale alignment,
stores float32 depth, then derives a globally normalized 16-bit foreground matte.
The native renderer packs lossless FFV1 gray16; the existing low-resolution matte
preview and editable corrections continue to work. Clip changes/cancellation
prevent attachment of stale results. Completed caches are immutable.

`add_media_behind_subject(clipId, assetId)` and `add_text_behind_subject` retain the
original background and place content below the masked foreground. Layers remain
editable and undoable. Duplicate backgrounds and inserted media are silent to
avoid doubling source audio. The AI prompt follows transcript, real-frame review,
concise timed storyboard, supported scene edits, music/SFX mix, and review.

Wan generates RGB video, not RGBA. For transparent layers, generate/import/place,
then use SAM/ViTMatte Roto with actual subject points. Original RGB remains separate
from the alpha. Depth occlusion does not replace hair matting or provide native
alpha generation, video inpainting, relighting, metric placement or camera tracking.

## Validation and limits

- Real 6-frame CUDA inference and 16-bit FFV1 packing passed.
- A 25-frame repeated-source test crossed window boundaries without missing frames.
  This is an engineering smoke test, not a temporal quality benchmark.
- Alpha math checks cover near/far ordering, smooth transitions and consistent scale.
- Tool tests cover source timing, retimed-shot refusal, stale result rejection and
  separate insertion layers. TypeScript/frontend build and native build pass.
- Current limit: one shot, forward normal speed, up to 30 seconds and 30 fps.
  Split at scene cuts. Depth is relative; overlap scale alignment can still flicker.
  Inference uses 280-pixel long-side processing; inspect fine edges before delivery.
- No production-quality hair, blur, glass, occlusion/re-entry or long-video benchmark
  is claimed. Settings distinguishes installed weights from tested inference.
