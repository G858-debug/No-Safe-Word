"""
NSW Region Masks — ComfyUI custom node for creating horizontal region masks.

Used by the multi-pass workflow's Attention Couple integration to split the
canvas into left/right character regions + shared background.

Generates a binary MASK tensor where the specified horizontal percentage
range is filled with 1.0 and the rest is 0.0.
"""
import torch


class CreateRegionMask:
    """Create a binary mask covering a horizontal region of the canvas."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "width": ("INT", {"default": 1024, "min": 64, "max": 8192, "step": 8}),
                "height": ("INT", {"default": 1024, "min": 64, "max": 8192, "step": 8}),
                "start_pct": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                "end_pct": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
            }
        }

    RETURN_TYPES = ("MASK",)
    FUNCTION = "create_mask"
    CATEGORY = "nsw/masks"

    def create_mask(self, width, height, start_pct, end_pct):
        mask = torch.zeros(1, height, width)
        start_px = int(width * start_pct)
        end_px = int(width * end_pct)
        mask[:, :, start_px:end_px] = 1.0
        return (mask,)


class CreateSoftRegionMask:
    """Create a mask with soft/feathered edges for smoother regional blending.

    The feathered edges prevent hard seams between character regions.
    A 10% feather on a 1024px wide image means ~100px of gradual transition.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "width": ("INT", {"default": 1024, "min": 64, "max": 8192, "step": 8}),
                "height": ("INT", {"default": 1024, "min": 64, "max": 8192, "step": 8}),
                "start_pct": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                "end_pct": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.01}),
                "feather_pct": ("FLOAT", {"default": 0.1, "min": 0.0, "max": 0.5, "step": 0.01}),
            }
        }

    RETURN_TYPES = ("MASK",)
    FUNCTION = "create_mask"
    CATEGORY = "nsw/masks"

    def create_mask(self, width, height, start_pct, end_pct, feather_pct):
        mask = torch.zeros(1, height, width)
        start_px = int(width * start_pct)
        end_px = int(width * end_pct)
        feather_px = max(1, int(width * feather_pct))

        # Fill the core region (between feather zones)
        core_start = min(start_px + feather_px, end_px)
        core_end = max(end_px - feather_px, start_px)
        if core_start < core_end:
            mask[:, :, core_start:core_end] = 1.0

        # Left feather (ramp up from 0 to 1)
        for i in range(feather_px):
            px = start_px + i
            if 0 <= px < width and px < core_start:
                mask[:, :, px] = i / feather_px

        # Right feather (ramp down from 1 to 0)
        for i in range(feather_px):
            px = core_end + i
            if 0 <= px < width and px < end_px:
                mask[:, :, px] = 1.0 - (i / feather_px)

        return (mask,)


NODE_CLASS_MAPPINGS = {
    "NSWCreateRegionMask": CreateRegionMask,
    "NSWCreateSoftRegionMask": CreateSoftRegionMask,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "NSWCreateRegionMask": "NSW Create Region Mask",
    "NSWCreateSoftRegionMask": "NSW Create Soft Region Mask",
}
