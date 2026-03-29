#!/usr/bin/env python3
"""
Kohya LoRA Training Entrypoint for Pony V6 / CyberRealistic Pony.

Runs inside a RunPod GPU pod. Receives all configuration via environment variables.
Downloads dataset, runs Kohya sdxl_train_network.py, uploads trained LoRA,
and POSTs completion status to the webhook.

Environment variables:
  DATASET_URL           — Signed URL to download dataset tar.gz
  CHECKPOINT_PATH       — Path to base model on network volume
  TRIGGER_WORD          — Character trigger word (e.g., "lindiwe_nsw")
  LORA_ID               — Database ID for this LoRA record
  OUTPUT_UPLOAD_URL     — Signed Supabase URL to upload the trained .safetensors
  WEBHOOK_URL           — URL to POST completion/failure status
  WEBHOOK_SECRET        — Shared secret for webhook authentication
  TRAINING_CONFIG_JSON  — Serialized training params (optional overrides)
"""

import json
import os
import subprocess
import sys
import tarfile
import time
from pathlib import Path

import requests

# ── Configuration ──

DATASET_URL = os.environ.get("DATASET_URL")
CHECKPOINT_PATH = os.environ.get(
    "CHECKPOINT_PATH",
    "/workspace/models/checkpoints/CyberRealistic_PonySemi_V4.5.safetensors",
)
TRIGGER_WORD = os.environ.get("TRIGGER_WORD", "character_nsw")
LORA_ID = os.environ.get("LORA_ID", "unknown")
OUTPUT_UPLOAD_URL = os.environ.get("OUTPUT_UPLOAD_URL")
WEBHOOK_URL = os.environ.get("WEBHOOK_URL")
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "")

# Parse optional config overrides
_config_json = os.environ.get("TRAINING_CONFIG_JSON", "{}")
try:
    CONFIG_OVERRIDES = json.loads(_config_json)
except json.JSONDecodeError:
    CONFIG_OVERRIDES = {}

# Training defaults (from getRecommendedTrainingConfig)
NETWORK_DIM = int(CONFIG_OVERRIDES.get("networkDim", 8))
NETWORK_ALPHA = int(CONFIG_OVERRIDES.get("networkAlpha", 8))
NUM_EPOCHS = int(CONFIG_OVERRIDES.get("epochs", 12))
LEARNING_RATE = float(CONFIG_OVERRIDES.get("learningRate", 1.0))
OPTIMIZER = CONFIG_OVERRIDES.get("optimizer", "Prodigy")
SCHEDULER = CONFIG_OVERRIDES.get("scheduler", "cosine_with_restarts")
NOISE_OFFSET = float(CONFIG_OVERRIDES.get("noiseOffset", 0.03))
RESOLUTION = int(CONFIG_OVERRIDES.get("resolution", 1024))
BATCH_SIZE = int(CONFIG_OVERRIDES.get("batchSize", 2))
CLIP_SKIP = int(CONFIG_OVERRIDES.get("clipSkip", 2))
SAVE_EVERY_N_EPOCHS = int(CONFIG_OVERRIDES.get("saveEveryNEpochs", 4))

# Paths
DATASET_DIR = Path("/tmp/dataset")
OUTPUT_DIR = Path("/tmp/output")
SD_SCRIPTS_DIR = Path("/app/sd-scripts")


def post_webhook(status: str, message: str, extra: dict = None):
    """POST status to the webhook URL."""
    if not WEBHOOK_URL:
        print(f"[WEBHOOK] (no URL) {status}: {message}")
        return

    payload = {
        "loraId": LORA_ID,
        "status": status,
        "message": message,
        "secret": WEBHOOK_SECRET,
    }
    if extra:
        payload.update(extra)

    try:
        resp = requests.post(WEBHOOK_URL, json=payload, timeout=15)
        print(f"[WEBHOOK] {status} → {resp.status_code}")
    except Exception as e:
        print(f"[WEBHOOK ERROR] {e}")


def download_and_extract_dataset():
    """Download dataset tar.gz and extract it."""
    if not DATASET_URL:
        raise ValueError("DATASET_URL is required")

    DATASET_DIR.mkdir(parents=True, exist_ok=True)
    tar_path = DATASET_DIR / "dataset.tar.gz"

    print(f"Downloading dataset from {DATASET_URL[:80]}...")
    resp = requests.get(DATASET_URL, stream=True, timeout=300)
    resp.raise_for_status()

    with open(tar_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=65536):
            f.write(chunk)

    size_mb = tar_path.stat().st_size / 1024 / 1024
    print(f"Downloaded dataset: {size_mb:.1f}MB")

    with tarfile.open(tar_path, "r:gz") as tar:
        tar.extractall(DATASET_DIR)

    # Find the directory with images
    for root, _dirs, files in os.walk(DATASET_DIR):
        images = [f for f in files if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))]
        if images:
            captions = [f for f in files if f.endswith(".txt")]
            print(f"Found {len(images)} images, {len(captions)} captions in {root}")
            return root, len(images)

    raise ValueError("No images found in extracted dataset")


def determine_repeats(num_images: int) -> int:
    """Target ~500 image views per epoch."""
    target = 500
    repeats = max(1, min(50, target // num_images))
    return repeats


def setup_kohya_directory(img_dir: str, num_images: int) -> Path:
    """Create Kohya-expected directory structure: {repeats}_{trigger_word}/"""
    repeats = determine_repeats(num_images)
    kohya_dir = DATASET_DIR / "kohya_formatted"
    sub_dir = kohya_dir / f"{repeats}_{TRIGGER_WORD}"
    sub_dir.mkdir(parents=True, exist_ok=True)

    for f in Path(img_dir).iterdir():
        if f.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".txt"):
            dest = sub_dir / f.name
            if not dest.exists():
                os.symlink(f.absolute(), dest)

    print(f"Kohya directory: {sub_dir}")
    print(f"  {num_images} images × {repeats} repeats = {num_images * repeats} per epoch")
    return kohya_dir


def build_training_command(checkpoint_path: str, dataset_dir: Path) -> list:
    """Build the accelerate launch command for Kohya sdxl_train_network.py."""
    output_name = f"lora_{TRIGGER_WORD}"

    cmd = [
        "accelerate", "launch",
        "--mixed_precision", "fp16",
        "--num_cpu_threads_per_process", "1",
        str(SD_SCRIPTS_DIR / "sdxl_train_network.py"),
        # Model
        "--pretrained_model_name_or_path", checkpoint_path,
        # Dataset
        "--train_data_dir", str(dataset_dir),
        "--resolution", f"{RESOLUTION},{RESOLUTION}",
        "--enable_bucket",
        "--min_bucket_reso", "512",
        "--max_bucket_reso", "1536",
        "--bucket_reso_steps", "64",
        # LoRA config
        "--network_module", "networks.lora",
        "--network_dim", str(NETWORK_DIM),
        "--network_alpha", str(NETWORK_ALPHA),
        # Training config
        "--max_train_epochs", str(NUM_EPOCHS),
        "--train_batch_size", str(BATCH_SIZE),
        "--learning_rate", str(LEARNING_RATE),
        "--optimizer_type", OPTIMIZER,
        "--lr_scheduler", SCHEDULER,
        "--lr_scheduler_num_cycles", "3",
        # Noise and precision
        "--noise_offset", str(NOISE_OFFSET),
        "--mixed_precision", "fp16",
        "--clip_skip", str(CLIP_SKIP),
        # Optimization
        "--cache_latents",
        "--cache_latents_to_disk",
        "--gradient_checkpointing",
        "--no_half_vae",
        # Output
        "--output_dir", str(OUTPUT_DIR),
        "--output_name", output_name,
        "--save_model_as", "safetensors",
        "--save_precision", "fp16",
        "--save_every_n_epochs", str(SAVE_EVERY_N_EPOCHS),
        # Misc
        "--caption_extension", ".txt",
        "--seed", "42",
        "--max_token_length", "225",
        "--xformers",
    ]

    if OPTIMIZER.lower() == "prodigy":
        cmd.extend([
            "--optimizer_args",
            "decouple=True",
            "weight_decay=0.01",
            "d_coef=2",
            "use_bias_correction=True",
            "safeguard_warmup=True",
        ])

    return cmd


def run_training(cmd: list):
    """Execute training with real-time stdout forwarding."""
    print(f"\n{'='*60}")
    print("Starting Kohya LoRA training")
    print(f"{'='*60}\n")
    post_webhook("training", "Kohya training started")

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        cwd=str(SD_SCRIPTS_DIR),
    )

    for line in proc.stdout:
        sys.stdout.write(line)
        sys.stdout.flush()

    proc.wait()
    if proc.returncode != 0:
        raise RuntimeError(f"Training failed with exit code {proc.returncode}")

    print("\nTraining completed successfully!")


def find_best_lora() -> Path:
    """Find the final-epoch .safetensors file."""
    import glob as g
    files = sorted(g.glob(str(OUTPUT_DIR / "*.safetensors")))
    if not files:
        raise FileNotFoundError("No .safetensors files in output directory")

    for f in files:
        size_mb = os.path.getsize(f) / 1024 / 1024
        print(f"  {os.path.basename(f)} ({size_mb:.1f}MB)")

    best = Path(files[-1])
    print(f"Using: {best.name}")
    return best


def upload_lora(lora_path: Path) -> str | None:
    """Upload the trained LoRA via the signed upload URL."""
    if not OUTPUT_UPLOAD_URL:
        print("No OUTPUT_UPLOAD_URL — skipping upload")
        return None

    post_webhook("uploading", "Uploading trained LoRA...")
    size_mb = lora_path.stat().st_size / 1024 / 1024
    print(f"Uploading {lora_path.name} ({size_mb:.1f}MB)...")

    with open(lora_path, "rb") as f:
        resp = requests.put(
            OUTPUT_UPLOAD_URL,
            data=f,
            headers={"Content-Type": "application/octet-stream"},
            timeout=600,
        )

    resp.raise_for_status()
    print(f"Upload complete: HTTP {resp.status_code}")

    try:
        result = resp.json()
        return result.get("Key") or OUTPUT_UPLOAD_URL
    except Exception:
        return OUTPUT_UPLOAD_URL


def main():
    print(f"{'='*60}")
    print(f"Kohya LoRA Training — {TRIGGER_WORD}")
    print(f"LoRA ID: {LORA_ID}")
    print(f"Network dim: {NETWORK_DIM}, alpha: {NETWORK_ALPHA}")
    print(f"Optimizer: {OPTIMIZER}, LR: {LEARNING_RATE}")
    print(f"Epochs: {NUM_EPOCHS}, Batch: {BATCH_SIZE}, Resolution: {RESOLUTION}")
    print(f"{'='*60}\n")

    try:
        # 1. Dataset
        img_dir, num_images = download_and_extract_dataset()

        # 2. Verify checkpoint
        if not os.path.exists(CHECKPOINT_PATH):
            raise FileNotFoundError(
                f"Base model not found at {CHECKPOINT_PATH}. "
                "Ensure the network volume is mounted with the checkpoint."
            )
        ckpt_size_mb = os.path.getsize(CHECKPOINT_PATH) / 1024 / 1024
        print(f"Checkpoint: {CHECKPOINT_PATH} ({ckpt_size_mb:.0f}MB)")

        # 3. Kohya directory structure
        dataset_dir = setup_kohya_directory(img_dir, num_images)

        # 4. Train
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        cmd = build_training_command(CHECKPOINT_PATH, dataset_dir)
        run_training(cmd)

        # 5. Find + upload
        best_lora = find_best_lora()
        lora_url = upload_lora(best_lora)
        file_size = best_lora.stat().st_size

        # 6. Webhook — success
        post_webhook("completed", "Training complete", {
            "loraUrl": lora_url,
            "loraFilename": best_lora.name,
            "fileSizeBytes": file_size,
        })

        print(f"\n{'='*60}")
        print(f"DONE — {best_lora.name} ({file_size / 1024 / 1024:.1f}MB)")
        print(f"{'='*60}")

    except Exception as e:
        post_webhook("failed", str(e))
        print(f"\nFATAL: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
