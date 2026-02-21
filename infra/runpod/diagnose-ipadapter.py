#!/usr/bin/env python3
"""Diagnostic: check if IPAdapter Plus loads correctly in ComfyUI environment."""
import sys
import os

os.chdir("/comfyui")
sys.path.insert(0, "/comfyui")

print("=== ComfyUI Import Check ===")

# Check core ComfyUI modules that IPAdapter Plus depends on
checks = [
    ("folder_paths", "import folder_paths"),
    ("node_helpers", "import node_helpers"),
    ("comfy.clip_vision", "from comfy.clip_vision import load"),
    ("clip_preprocess", "from comfy.clip_vision import clip_preprocess"),
    ("clip_vision.Output", "from comfy.clip_vision import Output"),
    ("conditioning_set_values", "from node_helpers import conditioning_set_values"),
    ("comfy.sd", "from comfy.sd import load_lora_for_models"),
    ("comfy.utils", "import comfy.utils"),
    ("comfy.model_management", "import comfy.model_management"),
]

for name, stmt in checks:
    try:
        exec(stmt)
        print(f"  {name}: OK")
    except Exception as e:
        print(f"  {name}: FAILED - {type(e).__name__}: {e}")

print("\n=== IPAdapter Directory Contents ===")
ipadapter_dir = None
for d in os.listdir("/comfyui/custom_nodes"):
    if "ipadapter" in d.lower():
        ipadapter_dir = d
        full_path = os.path.join("/comfyui/custom_nodes", d)
        print(f"  Directory: {d}")
        for f in sorted(os.listdir(full_path)):
            fpath = os.path.join(full_path, f)
            ftype = "dir" if os.path.isdir(fpath) else "file"
            print(f"    {ftype}: {f}")

if not ipadapter_dir:
    print("  NO IPADAPTER DIRECTORY FOUND!")
    sys.exit(1)

print("\n=== Full IPAdapter Import Test ===")
ipadapter_path = os.path.join("/comfyui/custom_nodes", ipadapter_dir)
sys.path.insert(0, ipadapter_path)

try:
    # Try importing exactly as ComfyUI would
    init_path = os.path.join(ipadapter_path, "__init__.py")
    if not os.path.exists(init_path):
        print(f"  ERROR: {init_path} does not exist!")
        sys.exit(1)

    import importlib.util
    spec = importlib.util.spec_from_file_location(
        ipadapter_dir, init_path,
        submodule_search_locations=[ipadapter_path]
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules[ipadapter_dir] = mod
    spec.loader.exec_module(mod)

    if hasattr(mod, "NODE_CLASS_MAPPINGS"):
        keys = list(mod.NODE_CLASS_MAPPINGS.keys())
        print(f"  SUCCESS: Loaded {len(keys)} nodes")
        faceid = [k for k in keys if "FaceID" in k]
        print(f"  FaceID nodes: {faceid}")
        print(f"  All nodes: {keys}")
    else:
        print("  WARNING: No NODE_CLASS_MAPPINGS found")
except Exception as e:
    print(f"  IMPORT FAILED: {type(e).__name__}: {e}")
    import traceback
    traceback.print_exc()
