"""
patch_handler.py — Run at Docker build time to inject character LoRA
download support into the base worker-comfyui handler.py.

This reads /handler_original.py, injects a monkey-patch that wraps the
handler function registration, and writes the result to /handler.py.
"""

PATCH_CODE = r'''
# ---- NSW Character LoRA Download Patch ----
import os as _nsw_os
import shutil as _nsw_shutil
import urllib.request as _nsw_urllib_request
import requests as _nsw_requests

_nsw_COMFY_DIR = _nsw_os.environ.get("COMFY_DIR", "/comfyui")
_nsw_LORAS_DIR = _nsw_os.path.join(_nsw_COMFY_DIR, "models", "loras")
_nsw_COMFY_HOST = "127.0.0.1:8188"

def _nsw_download_character_loras(downloads):
    """Download character LoRAs to ComfyUI loras dir if not cached."""
    if not downloads:
        return
    for entry in downloads:
        filename = entry.get("filename", "")
        url = entry.get("url", "")
        if not filename or not url:
            print(f"[NSW] Skipping invalid LoRA entry: {entry}")
            continue
        dest = _nsw_os.path.join(_nsw_LORAS_DIR, filename)
        if _nsw_os.path.isfile(dest):
            sz = _nsw_os.path.getsize(dest) / (1024 * 1024)
            print(f"[NSW] Cached: {filename} ({sz:.1f} MB)")
            continue
        _nsw_os.makedirs(_nsw_os.path.dirname(dest), exist_ok=True)
        print(f"[NSW] Downloading: {filename}")
        tmp = dest + ".tmp"
        try:
            req = _nsw_urllib_request.Request(url)
            req.add_header("User-Agent", "Mozilla/5.0 (ComfyUI-Worker)")
            resp = _nsw_urllib_request.urlopen(req, timeout=120)
            with open(tmp, "wb") as f:
                _nsw_shutil.copyfileobj(resp, f)
            resp.close()
            _nsw_os.rename(tmp, dest)
            sz = _nsw_os.path.getsize(dest) / (1024 * 1024)
            print(f"[NSW] Downloaded: {filename} ({sz:.1f} MB)")
        except Exception as e:
            print(f"[NSW] FAILED to download {filename}: {e}")
            if _nsw_os.path.exists(tmp):
                _nsw_os.remove(tmp)
            raise RuntimeError(f"Failed to download character LoRA {filename}: {e}")

def _nsw_refresh_cache():
    """Clear ComfyUI model cache after downloading new LoRAs."""
    try:
        _nsw_os.utime(_nsw_LORAS_DIR, None)
    except Exception:
        pass
    try:
        r = _nsw_requests.post(f"http://{_nsw_COMFY_HOST}/api/nsw/refresh-models", timeout=10)
        if r.status_code == 200:
            print("[NSW] Model cache refreshed")
        else:
            print(f"[NSW] Refresh returned {r.status_code}")
    except Exception as e:
        print(f"[NSW] Refresh endpoint unavailable: {e}")

# Monkey-patch runpod.serverless.start to wrap the handler
import runpod as _nsw_runpod
_nsw_original_start = _nsw_runpod.serverless.start

def _nsw_patched_start(config):
    original_handler = config.get("handler")
    if original_handler is None:
        return _nsw_original_start(config)
    def _nsw_wrapped(job):
        job_input = job.get("input", {})
        downloads = job_input.pop("character_lora_downloads", None)
        if downloads:
            print(f"[NSW] Job {job.get('id','?')}: {len(downloads)} character LoRA(s)")
            _nsw_download_character_loras(downloads)
            _nsw_refresh_cache()
            print("[NSW] All character LoRAs ready")
        return original_handler(job)
    config["handler"] = _nsw_wrapped
    print("[NSW] Handler wrapped with character LoRA support")
    return _nsw_original_start(config)

_nsw_runpod.serverless.start = _nsw_patched_start
# ---- End NSW Patch ----

'''

# Read original handler
with open("/handler_original.py", "r") as f:
    original = f.read()

# Write patched handler: inject patch BEFORE the original code
with open("/handler.py", "w") as f:
    f.write(PATCH_CODE)
    f.write("\n")
    f.write(original)

print("[NSW] Patched /handler.py with character LoRA download support")
