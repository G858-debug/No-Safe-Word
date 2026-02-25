"""
handler_wrapper.py — Wraps the base worker-comfyui handler to download
character LoRAs on-demand before ComfyUI executes the workflow.

Character LoRAs are per-story trained models stored on Supabase Storage.
They can't be baked into the Docker image because each story has different
characters. Instead, they're downloaded at job time from URLs passed in
the input payload's `character_lora_downloads` field.

Files are cached on the network volume so subsequent requests for the same
character skip the download.
"""

import importlib.util
import logging
import os
import shutil
import sys
import time
import urllib.request

import requests
import runpod

# Load the original handler module from its renamed location
spec = importlib.util.spec_from_file_location("handler_original", "/handler_original.py")
handler_original = importlib.util.module_from_spec(spec)
spec.loader.exec_module(handler_original)

logger = logging.getLogger("nsw_handler")

COMFY_DIR = os.environ.get("COMFY_DIR", "/comfyui")
LORAS_DIR = os.path.join(COMFY_DIR, "models", "loras")


def download_character_loras(downloads):
    """
    Download character LoRAs to ComfyUI's loras directory if not already present.

    Args:
        downloads: list of dicts with 'filename' and 'url' keys.
                   filename is e.g. "characters/char_zanele_abc123.safetensors"
                   url is a Supabase Storage URL.
    """
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

        # Ensure subdirectory exists (e.g. loras/characters/)
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
            # Clean up partial download
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            raise RuntimeError(f"Failed to download character LoRA {filename}: {e}")


COMFY_HOST = "127.0.0.1:8188"


def refresh_comfyui_model_cache():
    """
    Tell ComfyUI to clear its cached list of available LoRAs so newly
    downloaded character LoRA files pass workflow validation.

    Uses our nsw_refresh_models custom extension endpoint. Also touches
    the loras directory as a belt-and-suspenders approach for ComfyUI
    versions that use mtime-based cache invalidation.
    """
    # Touch loras dir to update mtime (invalidates mtime-based caches)
    try:
        os.utime(LORAS_DIR, None)
        logger.info("[NSW] Touched %s to update mtime", LORAS_DIR)
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


def wrapped_handler(job):
    """
    Pre-process job input to download character LoRAs, then delegate
    to the original handler.
    """
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

    return handler_original.handler(job)


if __name__ == "__main__":
    print("worker-comfyui (NSW wrapper) - Starting handler...")
    runpod.serverless.start({"handler": wrapped_handler})
