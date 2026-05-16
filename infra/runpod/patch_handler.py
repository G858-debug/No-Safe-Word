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
import tarfile as _nsw_tarfile
import tempfile as _nsw_tempfile
import urllib.request as _nsw_urllib_request
import requests as _nsw_requests

_nsw_COMFY_DIR = _nsw_os.environ.get("COMFY_DIR", "/comfyui")
_nsw_LORAS_DIR = _nsw_os.path.join(_nsw_COMFY_DIR, "models", "loras")
_nsw_COMFY_HOST = "127.0.0.1:8188"

def _nsw_extract_safetensors_from_tar(tar_path, dest_path):
    """Extract lora.safetensors from a Replicate tar archive."""
    with _nsw_tarfile.open(tar_path, "r") as tar:
        for member in tar.getmembers():
            if member.name.endswith(".safetensors"):
                print(f"[NSW] Extracting {member.name} from tar")
                src = tar.extractfile(member)
                if src is None:
                    raise RuntimeError(f"Could not extract {member.name} from tar")
                with open(dest_path, "wb") as dst:
                    _nsw_shutil.copyfileobj(src, dst)
                return
    raise RuntimeError("No .safetensors file found in tar archive")

def _nsw_validate_safetensors(filepath, filename, expected_bytes=None):
    """Validate a downloaded safetensors file is not truncated or corrupt."""
    import struct as _struct
    sz = _nsw_os.path.getsize(filepath)
    # SDXL LoRAs are typically 30-200 MB; anything under 1 MB is suspicious
    if sz < 1 * 1024 * 1024:
        raise RuntimeError(
            f"LoRA {filename} is suspiciously small ({sz / 1024:.0f} KB). "
            f"Expected at least 1 MB for an SDXL LoRA. File may be truncated or corrupt."
        )
    # Check against expected size if provided — detects truncated downloads
    if expected_bytes and abs(sz - expected_bytes) > 1024:
        raise RuntimeError(
            f"LoRA {filename} size mismatch: got {sz} bytes, expected {expected_bytes} bytes "
            f"(diff={sz - expected_bytes}). File is likely truncated from an incomplete download."
        )
    # safetensors format: first 8 bytes are the header length as little-endian uint64
    with open(filepath, "rb") as f:
        header_bytes = f.read(8)
    if len(header_bytes) < 8:
        raise RuntimeError(f"LoRA {filename} is too short to be a valid safetensors file ({sz} bytes)")
    header_len = _struct.unpack("<Q", header_bytes)[0]
    # Header length should be reasonable (< 10 MB) and less than the file size
    if header_len == 0 or header_len > 10 * 1024 * 1024 or header_len >= sz:
        raise RuntimeError(
            f"LoRA {filename} has invalid safetensors header (header_len={header_len}, file_size={sz}). "
            f"File is likely corrupt."
        )
    # Verify file contains enough data for all declared tensors
    expected_total = 8 + header_len  # header_len_bytes + header_json
    import json as _json
    with open(filepath, "rb") as f:
        f.seek(8)
        header_json = f.read(header_len)
    try:
        header = _json.loads(header_json)
        for key, info in header.items():
            if key == "__metadata__":
                continue
            # Each tensor has shape and dtype — compute expected bytes
            offsets = info.get("data_offsets")
            if offsets and len(offsets) == 2:
                tensor_end = offsets[1]
                if 8 + header_len + tensor_end > sz:
                    raise RuntimeError(
                        f"LoRA {filename} is truncated: tensor '{key}' ends at offset {8 + header_len + tensor_end} "
                        f"but file is only {sz} bytes. Download was incomplete."
                    )
    except _json.JSONDecodeError:
        raise RuntimeError(f"LoRA {filename} has invalid JSON header — file is corrupt.")
    print(f"[NSW] Validated: {filename} (header={header_len} bytes, file={sz / (1024*1024):.1f} MB)")

def _nsw_download_character_loras(downloads):
    """Download character LoRAs to ComfyUI loras dir if not cached."""
    if not downloads:
        return
    for entry in downloads:
        filename = entry.get("filename", "")
        url = entry.get("url", "")
        expected_bytes = entry.get("expected_bytes")
        if not filename or not url:
            print(f"[NSW] Skipping invalid LoRA entry: {entry}")
            continue
        dest = _nsw_os.path.join(_nsw_LORAS_DIR, filename)
        if _nsw_os.path.isfile(dest):
            # Validate cached file — a corrupt/truncated cached file causes noise images
            try:
                _nsw_validate_safetensors(dest, filename, expected_bytes)
                sz = _nsw_os.path.getsize(dest) / (1024 * 1024)
                print(f"[NSW] Cached: {filename} ({sz:.1f} MB)")
                continue
            except RuntimeError as ve:
                print(f"[NSW] Cached file INVALID — re-downloading: {ve}")
                _nsw_os.remove(dest)
        _nsw_os.makedirs(_nsw_os.path.dirname(dest), exist_ok=True)
        print(f"[NSW] Downloading: {filename}")
        tmp = dest + ".tmp"
        try:
            req = _nsw_urllib_request.Request(url)
            req.add_header("User-Agent", "Mozilla/5.0 (ComfyUI-Worker)")
            resp = _nsw_urllib_request.urlopen(req, timeout=300)
            with open(tmp, "wb") as f:
                _nsw_shutil.copyfileobj(resp, f)
            resp.close()
            # If the downloaded file is a tar archive, extract the safetensors from it
            is_tar = url.endswith(".tar")
            if not is_tar:
                try:
                    is_tar = _nsw_tarfile.is_tarfile(tmp)
                except Exception:
                    is_tar = False
            if is_tar:
                print(f"[NSW] Detected tar archive, extracting safetensors...")
                _nsw_extract_safetensors_from_tar(tmp, dest)
                _nsw_os.remove(tmp)
            else:
                _nsw_os.rename(tmp, dest)
            # Validate the downloaded file
            _nsw_validate_safetensors(dest, filename, expected_bytes)
            sz = _nsw_os.path.getsize(dest) / (1024 * 1024)
            print(f"[NSW] Downloaded: {filename} ({sz:.1f} MB)")
        except Exception as e:
            print(f"[NSW] FAILED to download {filename}: {e}")
            if _nsw_os.path.exists(tmp):
                _nsw_os.remove(tmp)
            # Also remove the dest file if it was partially written
            if _nsw_os.path.exists(dest):
                _nsw_os.remove(dest)
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

        # File deletion mode: remove specified files from the volume
        delete_files = job_input.get("nsw_delete_files")
        if delete_files and isinstance(delete_files, list):
            results = {}
            for filepath in delete_files:
                # Only allow deletion within /runpod-volume/models/
                if not filepath.startswith("/runpod-volume/models/"):
                    results[filepath] = "BLOCKED — only /runpod-volume/models/ allowed"
                    continue
                if _nsw_os.path.isfile(filepath):
                    sz = _nsw_os.path.getsize(filepath) / (1024*1024)
                    _nsw_os.remove(filepath)
                    results[filepath] = f"DELETED ({sz:.1f} MB freed)"
                    print(f"[NSW] Deleted: {filepath} ({sz:.1f} MB)")
                else:
                    results[filepath] = "NOT FOUND"
            # If this is also a diagnostic request, fall through; otherwise return now
            if not job_input.get("nsw_diagnostic"):
                return results

        # File download mode: download a file from a URL to the volume
        download = job_input.get("nsw_download_file")
        if download and isinstance(download, dict):
            url = download.get("url", "")
            dest = download.get("dest", "")
            headers = download.get("headers", {})
            if not dest.startswith("/runpod-volume/models/"):
                return {"error": "dest must start with /runpod-volume/models/"}
            dest_dir = _nsw_os.path.dirname(dest)
            _nsw_os.makedirs(dest_dir, exist_ok=True)
            tmp_path = dest + ".tmp"
            try:
                print(f"[NSW] Downloading {url[:80]}... -> {dest}")
                import time as _dl_time
                start = _dl_time.time()
                resp = _nsw_requests.get(url, headers=headers, stream=True, timeout=1800)
                resp.raise_for_status()
                total = int(resp.headers.get("content-length", 0))
                downloaded = 0
                with open(tmp_path, "wb") as f:
                    for chunk in resp.iter_content(chunk_size=64 * 1024 * 1024):
                        f.write(chunk)
                        downloaded += len(chunk)
                        mb = downloaded / (1024 * 1024)
                        pct = (downloaded / total * 100) if total else 0
                        print(f"[NSW] Downloaded {mb:.0f} MB / {total/1024/1024:.0f} MB ({pct:.1f}%)")
                _nsw_os.rename(tmp_path, dest)
                elapsed = _dl_time.time() - start
                final_size = _nsw_os.path.getsize(dest)
                return {
                    "status": "OK",
                    "dest": dest,
                    "size_mb": round(final_size / (1024 * 1024), 1),
                    "elapsed_s": round(elapsed, 1),
                    "speed_mbps": round(final_size / (1024 * 1024) / elapsed, 1) if elapsed > 0 else 0,
                }
            except Exception as e:
                if _nsw_os.path.exists(tmp_path):
                    _nsw_os.remove(tmp_path)
                return {"error": str(e)}

        # Diagnostic mode: return file listings of model directories + ComfyUI node info
        if job_input.get("nsw_diagnostic"):
            diag = {}
            for subdir in ["checkpoints", "loras", "diffusion_models", "clip", "vae"]:
                for base in [_nsw_COMFY_DIR + "/models", "/runpod-volume/models"]:
                    d = _nsw_os.path.join(base, subdir)
                    key = d
                    if _nsw_os.path.isdir(d):
                        files = []
                        for f in sorted(_nsw_os.listdir(d)):
                            fp = _nsw_os.path.join(d, f)
                            if _nsw_os.path.isfile(fp):
                                sz = _nsw_os.path.getsize(fp) / (1024*1024)
                                files.append(f"{f} ({sz:.1f} MB)")
                            elif _nsw_os.path.isdir(fp):
                                files.append(f"{f}/ (dir)")
                        diag[key] = files
                    else:
                        diag[key] = "NOT FOUND"
            # Check custom_nodes directory
            custom_nodes_dir = _nsw_os.path.join(_nsw_COMFY_DIR, "custom_nodes")
            if _nsw_os.path.isdir(custom_nodes_dir):
                diag["custom_nodes"] = sorted(_nsw_os.listdir(custom_nodes_dir))
            # Query ComfyUI /object_info for registered nodes — wait up to 5 min for startup
            import time as _nsw_time
            comfy_ready = False
            for _attempt in range(30):
                try:
                    r = _nsw_requests.get(f"http://{_nsw_COMFY_HOST}/object_info", timeout=10)
                    if r.status_code == 200:
                        comfy_ready = True
                        break
                except Exception:
                    pass
                _nsw_time.sleep(10)
            if comfy_ready:
                try:
                    all_nodes = list(r.json().keys())
                    diag["comfyui_total_nodes"] = len(all_nodes)
                except Exception as e:
                    diag["comfyui_object_info_error"] = str(e)
            else:
                diag["comfyui_object_info_error"] = "ComfyUI did not start within 5 minutes"
            # Also check for download log
            log_path = "/runpod-volume/nsw-download.log"
            if _nsw_os.path.isfile(log_path):
                with open(log_path) as lf:
                    diag["download_log_tail"] = lf.read()[-2000:]
            return diag

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
