"""
ZeroExoRefVideo - 纯参数「参考生视频」节点（r2v），不依赖上游导演台 UI。

工作流契约（与 templates/reference_video.json 对齐）：
  输入：MODEL / CLIP / 视频 VAE / 音频 VAE（开发者自己接）
  参数：prompt、negative、width、height、frames、frame_rate、steps、cfg、seed、
        guide_frames(=22)、use_prev_guide、reference_image、guide_path
  输出：IMAGE（帧序列）、AUDIO、ZEROEXO_GUIDE、STRING（guide 路径）

低显存：executor 的 clear_vram_between_segments 默认开；guide 只用前 N 帧，不常驻。
"""
import json
import os
import uuid

import folder_paths

from .engine import plan as plan_mod
from .engine import executor_core as exec_mod
from .lib.guide_options import GUIDE_FRAME_OPTIONS, snap_guide_frames

# 采样器 / 调度器候选：与 ComfyUI 原生 KSampler 同一清单（节点下拉用；取不到时退回引擎默认）
try:
    from comfy.samplers import KSampler as _KSampler

    SAMPLER_OPTIONS = list(_KSampler.SAMPLERS)
    SCHEDULER_OPTIONS = list(_KSampler.SCHEDULERS)
except Exception:  # noqa: BLE001 - 极简环境退回默认
    SAMPLER_OPTIONS = ["res_multistep", "euler", "dpmpp_2m"]
    SCHEDULER_OPTIONS = ["simple", "normal", "karras"]

CACHE_FRAME_CODECS = ["raw", "ffv1"]


def _guide_dir() -> str:
    root = os.environ.get("ZEROEXO_OUTPUT_ROOT") or folder_paths.get_output_directory()
    path = os.path.join(root, "zeroexo", "guides")
    os.makedirs(path, exist_ok=True)
    return path


def _build_timeline(prompt: str, width: int, height: int, frames: int, frame_rate: float,
                    reference_image: str, reference_images: list[str] | None = None) -> dict:
    names = [n for n in (reference_images or []) if n]
    if reference_image and reference_image not in names:
        names.insert(0, reference_image)
    refs = [
        {"index": i, "imageFile": name, "fileName": "", "type": "input", "subfolder": ""}
        for i, name in enumerate(names[:9])
    ]
    has_refs = bool(refs)
    return {
        "version": 5,
        # 单段生成走 global：参考图/提示词在 global 块，segment 模式只认分组内的 refs
        "editMode": "global",
        "totalFrames": frames,
        "frameRate": frame_rate,
        "video": {"fileName": "", "videoFile": "", "subfolder": "", "type": "input",
                  "frames": [], "frameMap": [], "sourceFrameCount": 0, "deletedSourceRanges": []},
        "videoClips": [],
        "global": {
            "taskType": "r2v", "prompt": prompt, "refs": refs, "refAudios": [],
            "referenceVideo": {"videoFile": "", "fileName": "", "type": "input", "subfolder": ""},
            "continuousReference": has_refs, "commonEnabled": has_refs,
            "commonCollapsed": True, "commonTab": "groups", "refVideos": [],
            "genImage": {"imageFile": (names[0] if names else "")},
        },
        "output": {"mode": "fixed", "aspectRatio": "custom", "megapixels": 0.0, "multiple": 32,
                   "longEdge": max(width, height), "width": width, "height": height,
                   "maxExportFrames": 0, "exportMode": "all", "audioMode": "generate"},
        # 实时预览：引擎按步解码并经 minimax_director_preview 推给提交时的 /ws clientId
        "liveTaePreview": True,
    }


class ZeroExoRefVideo:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
                "video_vae": ("VAE",),
                "audio_vae": ("VAE",),
                "task_type": (["r2v"], {"default": "r2v"}),
                "prompt": ("STRING", {"multiline": True, "default": ""}),
                "negative_prompt": ("STRING", {"multiline": True, "default": ""}),
                "width": ("INT", {"default": 100, "min": 64, "max": 4096, "step": 32}),
                "height": ("INT", {"default": 100, "min": 64, "max": 4096, "step": 32}),
                "frames": ("INT", {"default": 49, "min": 9, "max": 2000}),
                "frame_rate": ("FLOAT", {"default": 24.0, "min": 1.0, "max": 120.0}),
                "steps": ("INT", {"default": 1, "min": 1, "max": 100}),
                "cfg": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 20.0}),
                "seed": ("INT", {"default": 1, "min": 0, "max": 0xFFFFFFFF}),
                "guide_frames": (GUIDE_FRAME_OPTIONS, {"default": 22}),
                "use_prev_guide": ("BOOLEAN", {"default": False}),
                # 采样/性能开关（与 MiniMax H3 Director 同口径，默认值 = 引擎默认）
                "sampler": (SAMPLER_OPTIONS, {"default": "res_multistep"}),
                "scheduler": (SCHEDULER_OPTIONS, {"default": "simple"}),
                "shift_video": ("FLOAT", {"default": 12.0, "min": 0.0, "max": 100.0, "step": 0.1}),
                "shift_audio": ("FLOAT", {"default": 3.0, "min": 0.0, "max": 100.0, "step": 0.1}),
                "clear_vram_between_segments": ("BOOLEAN", {"default": True}),
                "cache_frames_codec": (CACHE_FRAME_CODECS, {"default": "raw"}),
                "cache_name": ("STRING", {"default": ""}),
                "reference_image": ("STRING", {"default": ""}),
                # 多参考图（逗号分隔；由 /zeroexo/v1/jobs 的 reference_images 数组转换而来）
                "reference_images": ("STRING", {"default": ""}),
                "guide_path": ("STRING", {"default": ""}),
                # 外部引导槽（2026-11-07）：本段显式使用的 guide 文件（safetensors）。
                # 非空 = 以它作为首段 motion context；与 guide_path（输出路径）互不覆盖。
                "prev_guide_path": ("STRING", {"default": ""}),
            },
            # 预览/进度事件按节点 id 转发给前端（report_director_*），必须拿到 ComfyUI 节点 id
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ("IMAGE", "AUDIO", "ZEROEXO_GUIDE", "STRING")
    RETURN_NAMES = ("images", "audio", "guide", "guide_path")
    FUNCTION = "run"
    CATEGORY = "ZeroExo"

    def run(self, model, clip, video_vae, audio_vae, task_type, prompt, negative_prompt,
            width, height, frames, frame_rate, steps, cfg, seed, guide_frames,
            use_prev_guide, sampler, scheduler, shift_video, shift_audio,
            clear_vram_between_segments, cache_frames_codec, cache_name,
            reference_image, reference_images, guide_path, prev_guide_path="", unique_id=None):
        guide_frames = snap_guide_frames(guide_frames)
        extra_refs = [part.strip() for part in str(reference_images or "").split(",") if part.strip()]
        timeline = _build_timeline(prompt, width, height, frames, frame_rate, reference_image, extra_refs)
        plan = plan_mod.build_director_plan(
            json.dumps(timeline, ensure_ascii=False),
            global_task_type="r2v",
            global_prompt=prompt,
            total_frames=frames,
            frame_rate=frame_rate,
            width=width,
            height=height,
            ref_max_size=max(width, height),
        )
        # 外部引导槽（2026-11-07）：显式 guide 帧作为首段 motion context。
        # 单段作业本不走段间引导，这里把 plan 的连续性打开并把 guide 帧注入外部引导，
        # 由 segment_continuity.resolve_prev_segment_output 在首段返回它（无需上一段产物）。
        if str(prev_guide_path or "").strip():
            from safetensors.torch import load_file
            if not os.path.isfile(prev_guide_path):
                raise RuntimeError(f"ZeroExoRefVideo: 引导槽文件不存在: {prev_guide_path}")
            guide_tensor = load_file(prev_guide_path).get("guide")
            if guide_tensor is None or int(guide_tensor.shape[0]) < 1:
                raise RuntimeError("ZeroExoRefVideo: 引导槽文件缺少 guide 张量")
            # 上下文帧必须小于可见帧（apply_motion_context 的硬约束）
            ctx = min(int(guide_frames), int(guide_tensor.shape[0]), max(0, int(frames) - 1))
            if ctx < 5:
                raise RuntimeError(
                    f"ZeroExoRefVideo: 引导帧数（{int(guide_tensor.shape[0])}）与本次帧数（{int(frames)}）不兼容"
                )
            plan.external_guide_frames = guide_tensor
            plan.continuity_enabled = True
            plan.continuity_overlap_frames = ctx
            for seg in plan.segments:
                seg.continuity_from_prev = True
        # 缓存帧格式（raw .pt / ffv1 无损）在 plan 上生效（segment_cache 读该字段）
        plan.cache_frames_codec = str(cache_frames_codec or "raw")
        # executor 返回 (合成帧, 分段帧, 分段音频, 报告, 段帧数, 二采…)
        combined, _segment_outputs, segment_audios, *_rest = exec_mod.execute_director_plan_core(
            plan,
            node_id=None if unique_id is None else str(unique_id),
            cache_name=(cache_name or None),
            model=model,
            vae=video_vae,
            audio_vae=audio_vae,
            clip=clip,
            cfg=cfg,
            seed=seed,
            steps=steps,
            sampler=str(sampler or "res_multistep"),
            scheduler=str(scheduler or "simple"),
            shift_video=float(shift_video),
            shift_audio=float(shift_audio),
            clear_vram_between_segments=bool(clear_vram_between_segments),
        )
        images = combined
        audio = segment_audios[0] if segment_audios else None
        if images is None:
            raise RuntimeError("ZeroExoRefVideo: 引擎未返回帧结果")
        # guide：取**尾部** guide_frames 帧存 safetensors（不常驻显存）。
        # 下一段复用它是作为「上一段 motion context」（与导演台 resolve_prev_segment_output 的
        # 尾帧语义一致）；取头部会让下一段从上一段的开头接续，运动不连续。
        gpath = guide_path or os.path.join(_guide_dir(), f"gd_{uuid.uuid4().hex[:12]}.safetensors")
        gid = os.path.splitext(os.path.basename(gpath))[0]
        os.makedirs(os.path.dirname(os.path.abspath(gpath)), exist_ok=True)
        guide = None
        try:
            from safetensors.torch import save_file
            n = max(1, min(int(guide_frames), int(images.shape[0])))
            data = images[-n:].detach().cpu().contiguous()
            save_file({"guide": data}, gpath)
            guide = {"id": gid, "path": gpath, "frames": int(data.shape[0])}
        except Exception:
            guide = {"id": gid, "path": gpath, "frames": 0}
        return (images, audio, guide, gpath)


NODE_CLASS_MAPPINGS = {"ZeroExoRefVideo": ZeroExoRefVideo}
NODE_DISPLAY_NAME_MAPPINGS = {"ZeroExoRefVideo": "ZeroExo 参考生视频"}
