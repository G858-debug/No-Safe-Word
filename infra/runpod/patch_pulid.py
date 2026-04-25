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

    # Patch 1: forward_orig signature — add **kwargs for timestep_zero_index
    patched = re.sub(
        r"(    attn_mask: Tensor = None,\n)(\) -> Tensor:)",
        r"\1    **kwargs,\n\2",
        content,
    )
    kwargs_added = patched != original
    if kwargs_added:
        before = original.count("**kwargs")
        after = patched.count("**kwargs")
        if after - before != 1:
            print(f"FAIL [{label}]: kwargs delta {after - before}")
            sys.exit(1)

    # Patch 2: PuLID block replacement — fix extra_options["transformer_options"] KeyError
    # Flux2Fun ControlNet puts transformer_options in input_args, not extra_options.
    # Make PuLID's __call__ methods check both places.
    after_kwargs = patched
    patched = re.sub(
        r'transformer_options = extra_options\["transformer_options"\]',
        'transformer_options = extra_options.get("transformer_options") or input_args.get("transformer_options", {})',
        patched,
    )
    fallback_added = patched != after_kwargs

    # Patch 3a: DitDoubleBlockReplace — sigma is read BEFORE original_block executes.
    # If pulid_enter() was not called (e.g. ComfyUI 5.8.x hook ordering), "timesteps"
    # is absent from pulid_temp_attrs and raises KeyError. Guard: run original_block
    # unmodified and return, skipping PuLID conditioning for this step.
    after_p2 = patched
    patched = re.sub(
        r'([ \t]+)(sigma = pulid_temp_attrs\[["\'](timesteps)["\']\]\[0\]\.detach\(\)\.cpu\(\)\.item\(\)\n)([ \t]+out = extra_options\["original_block"\]\(input_args\))',
        r'\1if "timesteps" not in pulid_temp_attrs:\n\1    return extra_options["original_block"](input_args)\n\1\2\4',
        patched,
    )
    guard_double_added = patched != after_p2

    # Patch 3b: DitSingleBlockReplace — sigma is read AFTER original_block executes.
    # Same KeyError risk, plus pulid_temp_attrs['double_blocks_txt'] would also fail.
    # Guard: return the already-computed out unmodified, skipping PuLID conditioning.
    after_p3a = patched
    patched = re.sub(
        r'(\n\n)([ \t]+)(sigma = pulid_temp_attrs\[["\'](timesteps)["\']\]\[0\]\.detach\(\)\.cpu\(\)\.item\(\)\n)([ \t]+img = out\[\'img\'\])',
        r'\1\2if "timesteps" not in pulid_temp_attrs:\n\2    return out\n\2\3\5',
        patched,
    )
    guard_single_added = patched != after_p3a

    if not kwargs_added and not fallback_added and not guard_double_added and not guard_single_added:
        print(f"FAIL [{label}]: no patterns matched")
        sys.exit(1)

    path.write_text(patched)
    verify = path.read_text()

    if kwargs_added and "**kwargs,\n) -> Tensor:" not in verify:
        print(f"FAIL [{label}]: post-write kwargs verification failed")
        sys.exit(1)

    fallback_count = verify.count("input_args.get(\"transformer_options\"")
    print(f"[NSW] {label}: kwargs_added={kwargs_added} fallback_count={fallback_count} guard_double={guard_double_added} guard_single={guard_single_added}")


if len(sys.argv) < 2:
    print("Usage: patch_pulid.py <file1> [file2 ...]")
    sys.exit(1)

for arg in sys.argv[1:]:
    path = Path(arg)
    label = path.name
    patch_file(path, label)
