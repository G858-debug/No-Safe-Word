"""
handler_wrapper.py — Wraps the base worker-comfyui handler to download
character LoRAs on-demand before ComfyUI executes the workflow.

Instead of importing the original handler module (which can fail due to
import order and side-effect issues), this wrapper modifies the original
handler.py in-place to inject our pre-processing hook via monkey-patching
runpod.serverless.start.
"""

import logging
import os
import shutil
import urllib.request

import requests
import runpod

logger = logging.getLogger("nsw_handler")

COMFY_DIR = os.environ.get("COMFY_DIR", "/comfyui")
LORAS_DIR = os.path.join(COMFY_DIR, "models", "loras")
COMFY_HOST = "127.0.0.1:8188"


def download_character_loras(downloads):
    """Download character LoRAs to ComfyUI's loras directory if not already present."""
    if not downloads:
        return

    for entry in downloads:
        filename = entry.get("filename", "")
        url = entry.get("url", "")

        if not filename or not url:
            logger.warning("[NSW] Skipping invalid character LoRA download entry: %s", entry)
            continue

        dest = os.path.join(LORAS_DIR, filename)

        if os.path.isfile(dest):
            size_mb = os.path.getsize(dest) / (1024 * 1024)
            logger.info("[NSW] Character LoRA already cached: %s (%.1f MB)", filename, size_mb)
            continue

        os.makedirs(os.path.dirname(dest), exist_ok=True)

        logger.info("[NSW] Downloading character LoRA: %s", filename)
        tmp_path = dest + ".tmp"

        try:
            req = urllib.request.Request(url)
            req.add_header("User-Agent", "Mozilla/5.0 (ComfyUI-Worker)")
            resp = urllib.request.urlopen(req, timeout=120)
            with open(tmp_path, "wb") as f:
                shutil.copyfileobj(resp, f)
            resp.close()
            os.rename(tmp_path, dest)
            size_mb = os.path.getsize(dest) / (1024 * 1024)
            logger.info("[NSW] Downloaded character LoRA: %s (%.1f MB)", filename, size_mb)
        except Exception as e:
            logger.error("[NSW] Failed to download character LoRA %s: %s", filename, e)
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            raise RuntimeError(f"Failed to download character LoRA {filename}: {e}")


def refresh_comfyui_model_cache():
    """Clear ComfyUI's cached LoRA file list so newly downloaded files pass validation."""
    # Touch loras dir to update mtime (invalidates mtime-based caches)
    try:
        os.utime(LORAS_DIR, None)
    except Exception as e:
        logger.warning("[NSW] Failed to touch loras dir: %s", e)

    # Call our custom extension to explicitly clear the cache
    try:
        resp = requests.post(f"http://{COMFY_HOST}/api/nsw/refresh-models", timeout=10)
        if resp.status_code == 200:
            logger.info("[NSW] ComfyUI model cache refreshed successfully")
        else:
            logger.warning("[NSW] ComfyUI refresh returned %d: %s", resp.status_code, resp.text)
    except Exception as e:
        logger.warning("[NSW] Failed to call ComfyUI refresh endpoint: %s", e)


# ---- Monkey-patch runpod.serverless.start to wrap the handler ----
_original_start = runpod.serverless.start


def _patched_start(config):
    """Intercept the handler registration to wrap it with our pre-processing."""
    original_handler = config.get("handler")
    if original_handler is None:
        return _original_start(config)

    def wrapped_handler(job):
        job_input = job.get("input", {})
        character_lora_downloads = job_input.pop("character_lora_downloads", None)

        if character_lora_downloads:
            logger.info(
                "[NSW] Job %s: downloading %d character LoRA(s)...",
                job.get("id", "?"),
                len(character_lora_downloads),
            )
            download_character_loras(character_lora_downloads)
            refresh_comfyui_model_cache()
            logger.info("[NSW] All character LoRAs ready.")

        return original_handler(job)

    config["handler"] = wrapped_handler
    print("[NSW] Handler wrapped with character LoRA download support")
    return _original_start(config)


runpod.serverless.start = _patched_start

# Now exec the original handler script — it will call runpod.serverless.start()
# which is now our patched version that wraps the handler
print("[NSW] Loading original handler with monkey-patched runpod.serverless.start...")
exec(open("/handler_original.py").read())
