"""Expose an already-running download in Bhippi settings without restarting it."""
import ctypes
import json
from pathlib import Path
import sys
import time
from huggingface_hub import model_info

pid = int(sys.argv[1])
root = Path.home() / 'AppData/Roaming/com.bhippi.videoeditor/models/generation/image'
parts = Path(__file__).resolve().parents[1] / 'work/model-download'
info = model_info('stabilityai/stable-diffusion-xl-base-1.0', files_metadata=True)
weights = [f for f in info.siblings if f.rfilename.endswith('.fp16.safetensors')]
total = sum(f.size for f in weights)
kernel = ctypes.WinDLL('kernel32', use_last_error=True)
kernel.OpenProcess.restype = ctypes.c_void_p
kernel.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_bool, ctypes.c_uint32]
kernel.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32)]
kernel.CloseHandle.argtypes = [ctypes.c_void_p]
handle = kernel.OpenProcess(0x1000, False, pid)
if not handle: raise RuntimeError('Download process is not available')
try:
    while True:
        code = ctypes.c_uint32()
        alive = kernel.GetExitCodeProcess(handle, ctypes.byref(code)) and code.value == 259
        manifest = root / 'bhippi-install.json'
        installed = manifest.is_file() and json.loads(manifest.read_text()).get('weightsVerified') is True
        completed = 0
        for file in weights:
            target = root / file.rfilename
            if target.is_file() and target.stat().st_size == file.size: completed += file.size
            else:
                folder = parts / file.lfs.sha256
                completed += min(file.size, sum(p.stat().st_size for p in folder.glob('*.part')) if folder.is_dir() else 0)
        status = 'done' if installed else 'running' if alive else 'error'
        marker = {'status': status, 'progress': min(1, completed / total), 'downloadedBytes': completed, 'totalBytes': total, 'updatedAt': time.time(), 'message': 'Downloading and verifying SDXL weights' if alive and not installed else 'SDXL installed' if installed else 'Download stopped; completed chunks are retained', 'external': True}
        temporary = root / 'bhippi-download.tmp'
        temporary.write_text(json.dumps(marker), encoding='utf-8')
        temporary.replace(root / 'bhippi-download.json')
        if status != 'running': break
        time.sleep(10)
finally:
    kernel.CloseHandle(handle)
