import sys
from pathlib import Path
import cv2
import numpy as np
import torch

source_path, matte_path, model_path, output_path = sys.argv[1:5]
video = cv2.VideoCapture(source_path)
video.set(cv2.CAP_PROP_POS_MSEC, 1000)
ok, frame = video.read()
if not ok:
    raise RuntimeError("Could not decode source video")
height, width = frame.shape[:2]
matte = cv2.VideoCapture(matte_path)
union = np.zeros((height, width), dtype=np.uint8)
frame_index = 0
used = 0
while True:
    ok, mask_frame = matte.read()
    if not ok:
        break
    if frame_index % 4 == 0:
        grey = cv2.cvtColor(mask_frame, cv2.COLOR_BGR2GRAY)
        if grey.shape != union.shape:
            grey = cv2.resize(grey, (width, height), interpolation=cv2.INTER_LINEAR)
        union = np.maximum(union, (grey > 32).astype(np.uint8) * 255)
        used += 1
    frame_index += 1
matte.release()
video.release()
if used == 0 or np.count_nonzero(union) < 1000:
    raise RuntimeError("Roto matte was empty or unreadable")
cv2.rectangle(union, (int(width*.28), int(height*.68)), (int(width*.74), height-1), 255, -1)
union = cv2.dilate(union, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (33, 33)))
target_width = 960
target_height = round(height * target_width / width)
small = cv2.resize(frame, (target_width, target_height), interpolation=cv2.INTER_AREA)
small_mask = cv2.resize(union, (target_width, target_height), interpolation=cv2.INTER_NEAREST)
pad_h = (8 - target_height % 8) % 8
pad_w = (8 - target_width % 8) % 8
small = cv2.copyMakeBorder(small, 0, pad_h, 0, pad_w, cv2.BORDER_REFLECT)
small_mask = cv2.copyMakeBorder(small_mask, 0, pad_h, 0, pad_w, cv2.BORDER_CONSTANT, value=0)
device = "cuda" if torch.cuda.is_available() else "cpu"
model = torch.jit.load(model_path, map_location=device).eval()
rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
image_tensor = torch.from_numpy(rgb).permute(2, 0, 1).unsqueeze(0).float().to(device) / 255.0
mask_tensor = torch.from_numpy((small_mask > 127).astype(np.float32)).unsqueeze(0).unsqueeze(0).to(device)
with torch.inference_mode():
    output_tensor = model(image_tensor, mask_tensor)
output = output_tensor[0].detach().float().cpu().permute(1, 2, 0).numpy()
if np.nanmax(output) <= 1.5:
    output *= 255.0
output = np.clip(output, 0, 255).astype(np.uint8)
output = cv2.cvtColor(output, cv2.COLOR_RGB2BGR)
output = output[:target_height, :target_width]
output = cv2.resize(output, (width, height), interpolation=cv2.INTER_CUBIC)
feather = cv2.GaussianBlur(union.astype(np.float32) / 255.0, (0, 0), 6)[:, :, None]
result = (frame.astype(np.float32) * (1 - feather) + output.astype(np.float32) * feather).clip(0, 255).astype(np.uint8)
Path(output_path).parent.mkdir(parents=True, exist_ok=True)
if not cv2.imwrite(output_path, result):
    raise RuntimeError("Could not write clean plate")
print(f"clean plate: {output_path}; matte frames={frame_index}; mask fraction={np.mean(union > 0):.3f}; device={device}")
