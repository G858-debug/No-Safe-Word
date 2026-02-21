#!/usr/bin/env python3
"""Download CivitAI LoRAs at Docker build time.

Requires CIVITAI_API_KEY and COMFY_DIR environment variables.
Used by Dockerfile — not intended for runtime use.
"""
import os
import shutil
import sys
import urllib.request

key = os.environ.get("CIVITAI_API_KEY", "")
if not key:
    print("[NSW] CIVITAI_API_KEY not set — skipping CivitAI LoRA downloads")
    sys.exit(0)

loras = [
    (f"https://civitai.com/api/download/models/177674?token={key}", "better-bodies-xl.safetensors"),
    (f"https://civitai.com/api/download/models/2686970?token={key}", "cinecolor-harmonizer.safetensors"),
    (f"https://civitai.com/api/download/models/435833?token={key}", "melanin-mix-xl.safetensors"),
    (f"https://civitai.com/api/download/models/1746981?token={key}", "couples-poses-xl.safetensors"),
]

lora_dir = os.environ["COMFY_DIR"] + "/models/loras/"
failed = 0

for url, name in loras:
    print(f"Downloading {name}...")
    try:
        req = urllib.request.Request(url)
        req.add_header("User-Agent", "Mozilla/5.0 (ComfyUI-Worker)")
        resp = urllib.request.urlopen(req, timeout=300)
        with open(lora_dir + name, "wb") as f:
            shutil.copyfileobj(resp, f)
        resp.close()
        size_mb = os.path.getsize(lora_dir + name) // 1024 // 1024
        print(f"  done ({size_mb}MB)")
    except Exception as e:
        print(f"  FAILED: {e}", file=sys.stderr)
        failed += 1

print(f"CivitAI LoRAs: {len(loras) - failed}/{len(loras)} downloaded.")
if failed:
    sys.exit(1)
