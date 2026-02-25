"""
NSW Refresh Models — Tiny ComfyUI custom node extension that adds a
POST /api/nsw/refresh-models endpoint to clear folder_paths cache.

This is needed because character LoRAs are downloaded at runtime (per-job),
after ComfyUI has already cached the list of available LoRAs at startup.
Without cache invalidation, ComfyUI's workflow validation rejects the
newly downloaded LoRA filenames with "value_not_in_list" errors.
"""

from aiohttp import web
from server import PromptServer
import folder_paths
import logging

logger = logging.getLogger("nsw_refresh")

@PromptServer.instance.routes.post("/api/nsw/refresh-models")
async def refresh_models(request):
    """Clear ComfyUI's filename_list_cache so newly downloaded models are found."""
    try:
        if hasattr(folder_paths, 'filename_list_cache'):
            cache = folder_paths.filename_list_cache
            # Handle both dict and CacheHelper styles
            if isinstance(cache, dict):
                cache.clear()
            elif hasattr(cache, 'cache'):
                cache.cache.clear()
            elif hasattr(cache, 'clear'):
                cache.clear()
            logger.info("[NSW] Cleared folder_paths.filename_list_cache")
        else:
            logger.warning("[NSW] folder_paths.filename_list_cache not found")

        return web.json_response({"status": "ok"})
    except Exception as e:
        logger.error("[NSW] Failed to refresh models: %s", e)
        return web.json_response({"status": "error", "message": str(e)}, status=500)


# Required by ComfyUI custom node loader — empty since we only add a server route
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
