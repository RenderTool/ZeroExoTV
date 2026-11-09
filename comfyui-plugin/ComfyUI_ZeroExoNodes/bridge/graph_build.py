"""Build the minimal ComfyUI prompt graph for one Director run.

Graph shape (API format, node ids are strings):

  1 UNETLoader            -> MODEL
  2 VAELoader (video vae) -> VAE
  3 VAELoader (audio vae) -> VAE
  4 CLIPLoader (minimax)  -> CLIP
  5 MiniMaxH3Director     -> executes the whole timeline in one process

No LoadImage nodes: segment refs resolve from timeline_data paths under
input/ (upstream plan.py:371 joins imageFile onto the input directory).
"""

from __future__ import annotations

import copy
import json

# Widget placeholders for the upstream grouping widgets (BDGROUP). Values are
# not validated by ComfyUI (execution.py:1006-1017 only coerces INT/FLOAT/
# STRING/BOOLEAN), but required widgets must be present.
BD_GRP_SAMPLE = "采样设置"
BD_GRP_ADVANCED = "高级采样"
BD_GRP_PERF = "性能"

DEFAULT_MODELS = {
    "unet": "",
    "videoVae": "",
    "audioVae": "",
    "clip": "",
    "clipType": "minimax",
    "weightDtype": "default",
}


def prepare_timeline(timeline: dict, overrides: dict) -> dict:
    """Force per-segment mp4 export, live preview events, and apply overrides."""
    tl = copy.deepcopy(timeline)
    output = tl.get("output")
    if not isinstance(output, dict):
        output = {}
        tl["output"] = output
    # Segment mp4s are the bridge's predictable per-segment artifact
    # (upstream segment_mp4_export.py:117 only writes when mode == "segments").
    output["exportMode"] = "segments"
    # Live TAE preview -> minimax_director_preview ws events (executor_core
    # gates on liveTaePreview; without this no in-run frames are emitted).
    output["liveTaePreview"] = True
    # executor_core.py:462 reads plan.raw.get("liveTaePreview") at the TOP
    # level (plan.raw = dict(timeline), the output sub-block is NOT hoisted),
    # so mirror the same flag at the timeline root or no frames are emitted.
    tl["liveTaePreview"] = True
    # Resume support: runSelection (0-based indices) makes the executor only
    # sample the listed segments; the rest are filled from the disk cache
    # (plan.py:715 _parse_run_selection + executor_core unselected fill).
    run_sel = (overrides or {}).get("runSelection")
    if isinstance(run_sel, list) and run_sel:
        try:
            tl["runSelectEnabled"] = True
            tl["runSelection"] = sorted({int(i) for i in run_sel})
        except (TypeError, ValueError):
            pass
    return tl


def build_graph(
    *,
    timeline: dict,
    widgets: dict,
    models: dict,
    overrides: dict,
    cache_name: str,
    save_prefix: str = "zeroexo/bridge",
) -> dict:
    m = {**DEFAULT_MODELS, **(models or {})}
    ov = overrides or {}
    w = widgets or {}

    global_block = timeline.get("global") if isinstance(timeline.get("global"), dict) else {}
    global_prompt = ov.get("globalPrompt")
    if global_prompt is None:
        global_prompt = str(global_block.get("prompt") or "")
    task_type = str(
        ov.get("taskType")
        or w.get("task_type")
        or global_block.get("taskType")
        or "t2v"
    )
    total_frames = int(
        ov.get("totalFrames") or timeline.get("totalFrames") or 124
    )
    output = timeline.get("output") if isinstance(timeline.get("output"), dict) else {}
    frame_rate = float(ov.get("frameRate") or output.get("frameRate") or 24.0)
    width = int(ov.get("width") or output.get("width") or 864)
    height = int(ov.get("height") or output.get("height") or 480)
    ref_max_size = int(ov.get("refMaxSize") or output.get("longEdge") or 864)

    director_inputs = {
        # required links
        "model": ["1", 0],
        "video_vae": ["2", 0],
        "audio_vae": ["3", 0],
        "clip": ["4", 0],
        # required widgets (director_common.py:29-77 + director.py:37-61)
        "task_type": task_type,
        "global_prompt": str(global_prompt),
        "bd_grp_sample": BD_GRP_SAMPLE,
        "cfg": float(ov.get("cfg", w.get("cfg", 1.0))),
        "seed": int(ov.get("seed", w.get("seed", 0))),
        "frame_rate": frame_rate,
        "width": width,
        "height": height,
        "ref_max_size": ref_max_size,
        "total_frames": total_frames,
        "timeline_data": json.dumps(timeline, ensure_ascii=False),
        # optional widgets (deterministic defaults; mirror upstream widget defaults)
        "bd_grp_advanced": BD_GRP_ADVANCED,
        "steps": int(ov.get("steps", w.get("steps", 25))),
        "sampler": str(ov.get("sampler", w.get("sampler", "res_multistep"))),
        "scheduler": str(ov.get("scheduler", w.get("scheduler", "simple"))),
        "shift_video": float(ov.get("shiftVideo", w.get("shift_video", 12.0))),
        "shift_audio": float(ov.get("shiftAudio", w.get("shift_audio", 3.0))),
        "bd_grp_perf": BD_GRP_PERF,
        "clear_vram_between_segments": bool(ov.get("clearVramBetweenSegments", True)),
        "clear_vram_before_refine": bool(ov.get("clearVramBeforeRefine", False)),
        "clear_vram_before_face_refine": bool(ov.get("clearVramBeforeFaceRefine", False)),
        "cache_frames_codec": str(ov.get("cacheFramesCodec", "raw")),
        "export_source_images": bool(ov.get("exportSourceImages", False)),
        "export_pre_face_refine": bool(ov.get("exportPreFaceRefine", False)),
        "cache_name": cache_name,
    }

    director_inputs["api_mode"] = True  # ZeroExo-issued timelines are API-mode

    return {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": m["unet"], "weight_dtype": m["weightDtype"]},
        },
        "2": {"class_type": "VAELoader", "inputs": {"vae_name": m["videoVae"]}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": m["audioVae"]}},
        "4": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": m["clip"],
                "type": m["clipType"],
                "device": "default",
            },
        },
        # Bridge-registered subclass (bridge/api_node.py): adds api_mode input.
        "5": {"class_type": "MiniMaxH3DirectorZX", "inputs": director_inputs},
        # ComfyUI /prompt rejects graphs without an OUTPUT_NODE ("Prompt has
        # no outputs"); Director itself is not one, so finish the chain like
        # the reference workflow: CreateVideo -> SaveVideo.
        "6": {
            "class_type": "CreateVideo",
            "inputs": {
                "images": ["5", 0],
                "audio": ["5", 1],
                "fps": ["5", 2],
                "codec": "none",
            },
        },
        "7": {
            "class_type": "SaveVideo",
            "inputs": {
                "video": ["6", 0],
                "filename_prefix": save_prefix,
                "format": "auto",
                "codec": "auto",
            },
        },
    }
