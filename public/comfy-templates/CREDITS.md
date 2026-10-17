# ComfyUI workflow templates

The `.json` files in this folder are ComfyUI's official workflow templates, copied unchanged from the
ComfyUI workflow templates repository:

https://github.com/Comfy-Org/workflow_templates (templates/), Comfy-Org/workflow_templates.

Bhippi loads them at run time (`src/lib/comfyTemplates.ts`), turns them into the API format with the
node definitions of the running ComfyUI, writes the prompt, size, seed and model files into them and
sends them to ComfyUI. The model files they name are listed, with exact sizes and checksums, in
`src-tauri/catalog/library/comfy-models.json`; the models themselves have their own licences, shown in
the Model Library before anything is downloaded.

Templates used:

- `image_z_image_turbo` (Z-Image Turbo, text to image)
- `image_flux2_klein_text_to_image` (FLUX.2 [klein] 4B, text to image; the distilled branch is used)
- `image_flux2_klein_image_edit_4b_distilled` (FLUX.2 [klein] 4B, image edit)
- `image_ernie_image_turbo` (ERNIE-Image Turbo, text to image)
- `image_qwen_image_2_1_t2i` (Qwen Image 2.1, text to image)
- `image_qwen_image_2_1_turbo_t2i` (Qwen Image 2.1 Turbo, text to image)
- `image_qwen_image_2_1_image_edit` (Qwen Image 2.1, image edit)
- `image_qwen_image_edit_2511` (Qwen Image Edit 2511)
- `audio_ace_step1_5_xl_turbo` (ACE-Step 1.5 XL Turbo, text to music)
- `audio_ace_step_1_5_split_4b` (ACE-Step 1.5 Turbo, text to music)
- `audio_stable_audio_3_medium` (Stable Audio 3 Medium, text to audio)
- `audio_yue2_text2music` (YuE 2, text to music)

MIT License

Copyright (c) Comfy Org

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
