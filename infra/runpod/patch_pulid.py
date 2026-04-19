"""
Patch PuLID Flux hook for ComfyUI 5.8.5+ compatibility.

ComfyUI 5.8.x passes new kwargs (like timestep_zero_index) to model
forward functions. PuLID's pulid_forward_orig replaces the model's
forward_orig method but doesn't accept arbitrary kwargs, causing:
    patched_forward_orig() got an unexpected keyword argument 'timestep_zero_index'

Fix: Add **kwargs to pulid_forward_orig signature.
Verifies the exact line was modified, fails build loudly if not.
"""

import re
import sys
from pathlib import Path

if len(sys.argv) != 2:
    print("Usage: patch_pulid.py <path-to-PulidFluxHook.py>")
    sys.exit(1)

target = Path(sys.argv[1])
if not target.exists():
    print(f"FAIL: {target} does not exist")
    sys.exit(1)

content = target.read_text()
original = content

# Pattern: function signature lines ending with attn_mask before -> Tensor
# We add **kwargs as a new line before the closing paren
patched = re.sub(
    r"(    attn_mask: Tensor = None,\n)(\) -> Tensor:)",
    r"\1    **kwargs,\n\2",
    content,
)

if patched == original:
    print("FAIL: pattern did not match — pulid_forward_orig signature unchanged")
    print("=== Searched lines ===")
    for i, line in enumerate(content.split("\n"), 1):
        if "attn_mask" in line and "Tensor" in line:
            print(f"  {i}: {line!r}")
    sys.exit(1)

# Verify exactly one change
before_count = original.count("**kwargs")
after_count = patched.count("**kwargs")
new_kwargs = after_count - before_count
if new_kwargs != 1:
    print(f"FAIL: expected to add 1 **kwargs, added {new_kwargs}")
    sys.exit(1)

target.write_text(patched)

# Final verification: re-read and grep the patched signature
verify = target.read_text()
if "**kwargs,\n) -> Tensor:" not in verify:
    print("FAIL: post-write verification failed")
    sys.exit(1)

print(f"[NSW] PuLID hook patched: added **kwargs to pulid_forward_orig signature")
print(f"[NSW] **kwargs count: {before_count} -> {after_count}")
