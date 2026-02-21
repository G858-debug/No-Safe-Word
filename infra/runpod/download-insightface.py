#!/usr/bin/env python3
"""Download and extract InsightFace buffalo_l models for IPAdapter FaceID."""
import urllib.request
import zipfile
import shutil
import os

url = "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip"
dest = "/tmp/buffalo_l.zip"
outdir = os.environ.get("COMFY_DIR", "/comfyui") + "/models/insightface/models/"

os.makedirs(outdir, exist_ok=True)

print("Downloading InsightFace buffalo_l models...")
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
resp = urllib.request.urlopen(req, timeout=300)
with open(dest, "wb") as f:
    shutil.copyfileobj(resp, f)
resp.close()

print("Extracting...")
with zipfile.ZipFile(dest, "r") as z:
    z.extractall(outdir)
os.remove(dest)

print("InsightFace buffalo_l models installed.")
