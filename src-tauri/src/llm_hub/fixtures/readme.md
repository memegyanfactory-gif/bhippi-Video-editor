---
library_name: transformers
license: apache-2.0
license_link: https://huggingface.co/Qwen/Qwen3.6-35B-A3B/blob/main/LICENSE
pipeline_tag: image-text-to-text
base_model:
- Qwen/Qwen3.6-35B-A3B
tags:
- unsloth
- qwen
- qwen3_5_moe
---
# Read our How to [Run Qwen3.6 Guide!](https://docs.unsloth.ai/models/qwen3.6)
<div>
  <p style="margin: 0 0 0px 0; margin-top: 0px;">
    <em>See <a href="https://unsloth.ai/docs/basics/unsloth-dynamic-v2.0-gguf">Unsloth Dynamic 2.0 GGUFs</a> for our quantization benchmarks.</em>
  </p>
  <div style="display: flex; gap: 5px; align-items: center; margin-bottom: 0px;">
    <a href="https://github.com/unslothai/unsloth/">
      <img src="https://github.com/unslothai/unsloth/raw/main/images/unsloth%20new%20logo.png" width="133">
    </a>
    <a href="https://discord.gg/unsloth">
      <img src="https://github.com/unslothai/unsloth/raw/main/images/Discord%20button.png" width="173">
    </a>
    <a href="https://unsloth.ai/docs/models/qwen3.6">
      <img src="https://raw.githubusercontent.com/unslothai/unsloth/refs/heads/main/images/documentation%20green%20button.png" width="143">
    </a>
  </div>
    <ul style="margin: 0;">
    <li>NEW: Developer Role Support so Qwen3.6 can work in Codex, OpenCode and more!</li>
    <li>Qwen3.6 can now be run and fine-tuned in <a href="https://unsloth.ai/docs/new/studio">Unsloth Studio</a>. <a href="https://unsloth.ai/docs/models/qwen3.6">Read our guide</a>.</li>
    <li>Tool calling improvements: Makes parsing nested objects to make tool calling succeed more.</li>
 <li>Example of Qwen3.6 (4-bit GGUF) running in Unsloth Studio with tool-calling:</li>
  </ul>
</div>
<img width="600" alt="qwen3.6 in unsloth studio" src="https://cdn-uploads.huggingface.co/production/uploads/62ecdc18b72a69615d6bd857/wRyC_xcMidEnz4INKA1b-.gif" />

---

# Qwen3.6-35B-A3B

<img width="400px" src="https://qianwen-res.oss-accelerate.aliyuncs.com/Qwen3.6/logo.png">

[![Qwen Chat](https://img.shields.io/badge/%F0%9F%92%9C%EF%B8%8F%20Qwen%20Chat%20-536af5)](https://chat.qwen.ai)

> [!Note]
> This repository contains model weights and configuration files for the post-trained model in the Hugging Face Transformers format. 
>
> These artifacts are compatible with Hugging Face Transformers, vLLM, SGLang, KTransformers, etc.

Following the February release of the Qwen3.5 series, we're pleased to share the first open-weight variant of Qwen3.6. Built on direct feedback from the community, Qwen3.6 prioritizes stability and real-w