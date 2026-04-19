"""
Patch Flux custom nodes for ComfyUI 5.8.5+ compatibility.

ComfyUI 5.8.x passes new kwargs (like timestep_zero_index) to forward_orig.
Both PuLID and Flux2Fun ControlNet replace forward_orig with their own
patched versions, but neither accepts arbitrary kwargs, causing:
    <fn>() got an unexpected keyword argument 'timestep_zero_index'

Fix: Add **kwargs to the function signatures (right before the closing
paren) so they accept and forward any new kwargs ComfyUI introduces.

Patches:
- PuLID Flux: pulid_forward_orig in PulidFluxHook.py
- Flux2Fun ControlNet: patched_forward_orig in flux_patch.py

Verifies the exact line was modified, fails build loudly if not.
"""

import re
import sys
from pathlib import Path


def patch_file(path: Path, label: str) -> None:
    if not path.exists():
        print(f"FAIL: {path} does not exist")
        sys.exit(1)

    content = path.read_text()
    original = content

    # Pattern: function signature ending with `attn_mask: Tensor = None,\n) -> Tensor:`
    # Add `    **kwargs,\n` before the closing paren.
    patched = re.sub(
        r"(    attn_mask: Tensor = None,\n)(\) -> Tensor:)",
        r"\1    **kwargs,\n\2",
        content,
    )

    if patched == original:
        print(f"FAIL [{label}]: pattern did not match — signature unchanged")
        print("=== Searched lines ===")
        for i, line in enumerate(content.split("\n"), 1):
            if "attn_mask" in line and "Tensor" in line:
                print(f"  {i}: {line!r}")
        sys.exit(1)

    before_count = original.count("**kwargs")
    after_count = patched.count("**kwargs")
    new_kwargs = after_count - before_count
    if new_kwargs != 1:
        print(f"FAIL [{label}]: expected to add 1 **kwargs, added {new_kwargs}")
        sys.exit(1)

    path.write_text(patched)

    # Re-read and verify
    verify = path.read_text()
    if "**kwargs,\n) -> Tensor:" not in verify:
        print(f"FAIL [{label}]: post-write verification failed")
        sys.exit(1)

    print(f"[NSW] {label} patched: **kwargs count {before_count} -> {after_count}")


if len(sys.argv) < 2:
    print("Usage: patch_pulid.py <file1> [file2 ...]")
    sys.exit(1)

for arg in sys.argv[1:]:
    path = Path(arg)
    label = path.name
    patch_file(path, label)
