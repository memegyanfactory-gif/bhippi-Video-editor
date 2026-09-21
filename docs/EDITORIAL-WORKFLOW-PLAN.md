# Enforced editorial workflow

## Problem

The previous pipeline was prompt guidance only. The executor accepted edits before
analysis/planning, and chat counted successful inspections as edits. Neither a
tool count nor assistant completion prose proves an editorial pass is complete.

## Implementation

1. Default new turns to Full workflow; expose a user-controlled Quick edit choice
   for targeted changes. Models cannot select their own bypass.
2. Bind the turn to its initial composition. Track successful timeline reads,
   transcription receipts and unique delivered frames for each initial video clip.
   Full mode requires stride-1 frame coverage; failed calls do not advance it.
3. Validate a concise storyboard with ordered ranges covering the current timeline.
   Reject edits until preparation succeeds. Re-read and re-plan after timing or
   clip structure changes; preserve analysis receipts from the original footage.
4. Require model capability discovery before generation/Roto/depth. A job start
   is pending work; successful import is required before workflow verification.
5. Track actual project changes separately from analysis/model-management calls.
6. Verify final timeline structure after a fresh read. Show unverified workflow
   status separately from assistant prose, and persist a completion-time note.

## Verification

Unit coverage: stage ordering, failed tools, missing images, duplicate frame
coverage, timing invalidation, gaps/overlaps, generated imports, final read and
user-only Quick edit. Run existing media-tool tests and the production/native builds.

## Remaining capability work (not represented as completed)

- Frame-conditioned video transitions and image-to-video animation need dedicated
  adapters; the current Wan adapter accepts text only.
- Temporally coherent video inpainting/object removal is not implemented.
- Dedicated music composition and beat analysis need model/runtime integration;
  current gain automation does not change tempo or guarantee a composed crescendo.
- A structural verifier cannot certify that the model understood each image,
  that generated assets match every creative intention, or that final audio and
  rendered matte edges are professional quality. Render/playback QA remains needed.
- Every-frame review can be expensive and can exceed a provider's context/tool
  budget on long clips. If it stops, the workflow remains incomplete. Quick edit
  is explicit; there is no silent downgrade to sparse sampling.
- Per-turn receipts reset on a new turn; completion notes remain in saved chat.

Do not claim that every ComfyUI model is integrated. Extend the adapter registry
and tests for each supported capability, then expose it through real tools.
