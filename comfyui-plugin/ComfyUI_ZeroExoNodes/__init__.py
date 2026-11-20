"""
ComfyUI_ZeroExoNodes - ZeroExo 纯参数生成节点（参考生视频 / 引导数据）。

设计约束：
- 不依赖 ComfyUI_MiniMaxH3_Director；模型、CLIP、VAE 由开发者自己接；
- 前端只发「可见参数」，默认参数与工作流结构全在 templates/*.json（API 格式）；
- 每段产物 = 视频 + guide（safetensors，默认 22 帧），guide 可被下一段复用；
- 所有落盘走 folder_paths.get_output_directory()，不写 custom_nodes。

对外协议（zeroexo/v1）：
  GET  health | capabilities
  POST jobs            {kind, params, clientJobId, project, episode}
  GET  jobs/{id}       状态 + 产物（video / guide）
  POST jobs/{id}/cancel
"""
import os

import asyncio
import hashlib
import json
import random
import re
import time
import uuid
from typing import Any

from .lib.guide_options import GUIDE_FRAME_OPTIONS, snap_guide_frames
from .engine.graph_ops import prune_model_chain
from . import task_store

import aiohttp
import folder_paths
import torch
from aiohttp import web
from server import PromptServer

PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_DIR = os.path.join(PLUGIN_DIR, "templates")
JOBS: dict[str, dict[str, Any]] = {}
# 插件不持有任何项目数据：没有「上一段 guide」登记表，也没有 project/episode 键。
# 视频作业串行队列：只用于单段作业；跨段续接一律走批次内的 initial/chain 指令。
VIDEO_QUEUE: list[dict[str, Any]] = []
VIDEO_QUEUE_WORKER: "asyncio.Task | None" = None
# 批次队列（2026-11-15）：一次任务 = 一个批次，批次内部串行、按 segment 的 guide 指令
# （initial=外部给的起始引导 / chain=上一段产出的引导 / none=不用引导）自链。
# 批次只带「提示词 + 参数 + 起始引导 id」，不读写任何项目数据。
BATCH_QUEUE: list[dict[str, Any]] = []
BATCH_WORKER: "asyncio.Task | None" = None
GUIDE_ID_PATTERN = re.compile(r"^gd_[A-Za-z0-9_-]{4,64}$")

# 可见参数（前端按 schema 渲染；默认值来自模板，不属于前端）
VISIBLE_PARAMS = {
    "prompt": {"type": "string", "default": ""},
    "negative_prompt": {"type": "string", "default": ""},
    "width": {"type": "integer", "default": 100, "min": 64, "max": 4096},
    "height": {"type": "integer", "default": 100, "min": 64, "max": 4096},
    "frames": {"type": "integer", "default": 49, "min": 9, "max": 2000},
    "steps": {"type": "integer", "default": 1, "min": 1, "max": 100},
    "cfg": {"type": "number", "default": 1.0},
    "seed": {"type": "integer", "default": 1, "min": 0},
    "guide_frames": {"type": "integer", "default": 22, "enum": GUIDE_FRAME_OPTIONS},
    # 模型链：UNET →（低显存链 / 原模型，由 use_low_vram 切换）→ LoRA → 采样器
    "use_low_vram": {
        "type": "boolean",
        "default": False,
        "help": "true = 走 MiniMax 低显存链（8–12GB 显存开）；高显存机器关闭，避免稀疏注意力成为瓶颈",
    },
    "lora_name": {
        "type": "string",
        "default": "minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors",
    },
    "lora_strength": {"type": "number", "default": 1.0, "min": 0.0, "max": 2.0},
    # 采样 / 性能（与 MiniMax H3 Director 同口径；默认值 = 引擎默认）
    "sampler": {"type": "string", "default": "euler"},
    "scheduler": {"type": "string", "default": "simple"},
    "shift_video": {"type": "number", "default": 12.0},
    "shift_audio": {"type": "number", "default": 3.0},
    "clear_vram_between_segments": {"type": "boolean", "default": True},
    "cache_frames_codec": {"type": "string", "default": "raw", "enum": ["raw", "ffv1"]},
    "cache_name": {"type": "string", "default": ""},
    "reference_images": {"type": "string", "default": ""},
    # 片段引导槽（2026-11-07）：显式 guide id（gd_xxx），传了即不再使用上一段引导
    "guide_id": {"type": "string", "default": ""},
}

# 图像编辑（Qwen Image 2.1）可见参数（2026-11-07）
IMAGE_VISIBLE_PARAMS = {
    "edit_prompt": {"type": "string", "default": ""},
    "negative_prompt": {"type": "string", "default": ""},
    # ComfyUI input 目录文件名（前端先 POST /upload/image）
    "input_image": {"type": "string", "default": ""},
    # 遮罩（可选；有值时走 qwen_image_edit_mask 模板）
    "mask_image": {"type": "string", "default": ""},
    # 多参考图（可选）：按顺序最多 3 张，第一张同时作为 input_image。
    # 模板里的 BatchImagesNode 批量喂给 TextEncodeQwenImage21，Qwen 2.1 原生支持多图参考。
    "input_images": {"type": "string", "default": ""},
    "seed": {"type": "integer", "default": 1, "min": 0},
    "steps": {"type": "integer", "default": 25, "min": 1, "max": 100},
    "cfg": {"type": "number", "default": 1.0},
    "denoise": {"type": "number", "default": 1.0, "min": 0.0, "max": 1.0},
    "edit_mode": {"type": "boolean", "default": False},
    "use_llm_enhance": {"type": "boolean", "default": False},
    "width": {"type": "integer", "default": 1344, "min": 64, "max": 2048},
    "height": {"type": "integer", "default": 1008, "min": 64, "max": 2048},
}

# Krea2 文生图可见参数（仅线上 ComfyUI：需要 krea2 底模 + ClownsharK 采样器）
KREA2_VISIBLE_PARAMS = {
    "prompt": {"type": "string", "default": ""},
    "negative_prompt": {"type": "string", "default": ""},
    "width": {"type": "integer", "default": 1024, "min": 64, "max": 2048},
    "height": {"type": "integer", "default": 1024, "min": 64, "max": 2048},
    "steps": {"type": "integer", "default": 10, "min": 1, "max": 100},
    "cfg": {"type": "number", "default": 1.0},
    "seed": {"type": "integer", "default": 1, "min": 0},
    "eta": {"type": "number", "default": 0.55},
}

# Moss Image 文生图可见参数（2026-11-11：moss_image_sft_int8 + qwen3.5_9b 文本编码 + flux2 VAE）
MOSS_VISIBLE_PARAMS = {
    "prompt": {"type": "string", "default": ""},
    "negative_prompt": {"type": "string", "default": ""},
    "width": {"type": "integer", "default": 1024, "min": 64, "max": 2048},
    "height": {"type": "integer", "default": 1024, "min": 64, "max": 2048},
    "steps": {"type": "integer", "default": 25, "min": 1, "max": 100},
    "cfg": {"type": "number", "default": 2.5},
    "seed": {"type": "integer", "default": 1, "min": 0},
}

# 模板非可见占位符兜底：模板里出现的 __zx:<name>__ 都必须有值，
# 否则替换后留下字面量，INT/FLOAT 校验直接失败。
TEMPLATE_DEFAULTS = {
    "frame_rate": 24.0,
    "reference_image": "",
    "project": "zeroexo",
    "episode": "ep01",
    "use_low_vram": False,
    "lora_name": "minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors",
    "lora_strength": 1.0,
    "sampler": "euler",
    "scheduler": "simple",
    "shift_video": 12.0,
    "shift_audio": 3.0,
    "clear_vram_between_segments": True,
    "cache_frames_codec": "raw",
    "cache_name": "",
    "reference_images": "",
    "guide_in_path": "",
    # 图像编辑模板占位符（仅图像专属键；seed/steps/cfg/width/height 由 kind 的可见参数提供）
    "input_image": "",
    "mask_image": "",
    "edit_prompt": "",
    "edit_mode": False,
    "use_llm_enhance": False,
    # Krea2 文生图模板占位符（width/height/steps/cfg/seed/eta 由可见参数提供）
    "eta": 0.55,
}

_PLACEHOLDER = re.compile(r"__zx:(\w+)__")


def output_root() -> str:
    root = os.environ.get("ZEROEXO_OUTPUT_ROOT") or folder_paths.get_output_directory()
    return os.path.join(root, "zeroexo")


def ensure_dir(path: str) -> str:
    os.makedirs(path, exist_ok=True)
    return path


def _attach_extra_ref_images(template: dict[str, Any], names: Any) -> None:
    """多参考图接进模板：第 2、3 张各建 LoadImage，直接接到 TextEncodeQwenImage21 的 images.image_2/3。

    注意不能挂到 BatchImagesNode：它输出的是一个 batch，而 TextEncodeQwenImage21 的
    images 是 autogrow 的多路输入（image_1..image_16），一图一路才会被模型逐张看到。
    """
    if isinstance(names, str):
        items = [p.strip() for p in names.split(",") if p.strip()]
    elif isinstance(names, (list, tuple)):
        items = [str(p).strip() for p in names if str(p).strip()]
    else:
        items = []
    if len(items) <= 1:
        return
    encode_ids = [nid for nid, node in template.items() if isinstance(node, dict) and node.get("class_type") == "TextEncodeQwenImage21"]
    if not encode_ids:
        return
    encoder = template[encode_ids[0]]
    inputs = encoder.setdefault("inputs", {})
    # TextEncodeQwenImage21 的 images 是 image_1..image_16：槽位够接 16 张
    for slot, name in enumerate(items[1:16], start=1):
        node_id = f"zx_ref_image_{slot}"
        template[node_id] = {
            "inputs": {"image": name},
            "class_type": "LoadImage",
            "_meta": {"title": f"参考图 {slot + 1}"},
        }
        inputs[f"images.image_{slot + 1}"] = [node_id, 0]


def substitute(node: Any, params: dict[str, Any]) -> Any:
    """模板占位符：__zx:name__ 换成参数值（整串保留类型，串内拼接转字符串）。"""
    if isinstance(node, str):
        if node.startswith("__zx:") and node.endswith("__"):
            return params.get(node[5:-2], node)

        def repl(match: re.Match) -> str:
            return str(params.get(match.group(1), match.group(0)))

        return _PLACEHOLDER.sub(repl, node)
    if isinstance(node, list):
        return [substitute(x, params) for x in node]
    if isinstance(node, dict):
        return {k: substitute(v, params) for k, v in node.items()}
    return node


def _available_models(folder: str) -> list[str]:
    try:
        names = list(folder_paths.get_filename_list(folder))
    except Exception:
        return []
    # 编码器可能被用户放在 models/clip（老目录习惯），CLIPLoader 两处都会列出来；
    # 只查 text_encoders 会把「已配置好的 qwen3vl」误判成缺失。
    if folder == "text_encoders":
        try:
            for name in folder_paths.get_filename_list("clip"):
                if name not in names:
                    names.append(name)
        except Exception:
            pass
    return names


def _pick_model(folder: str, current: str, preferred: tuple[str, ...]) -> str:
    """模板里的旧模型名可能在某台机器上不存在；按可用清单做确定性回落。"""
    names = _available_models(folder)
    if not names:
        return current
    if current in names:
        return current
    lowered = [(n, n.lower()) for n in names]
    for kw in preferred:
        for name, low in lowered:
            if kw in low:
                return name
    return names[0]


def apply_model_overrides(template: dict[str, Any], models: Any, family: str = "auto") -> dict[str, Any]:
    """把前端选择的模型文件名写进模板；加载器节点不变，只换权重文件。

    family 决定编码器怎么取：image = 生图工作流（要 4096 维图像编码器），
    video = H3 参考视频（要 5120 维 32b 编码器）。auto = 按模板里现有的编码器名推断。
    前端「文本编码器」槽位是 H3 的配置，套到生图工作流上必然形状不匹配，所以这里按工作流分族。
    """
    m = models if isinstance(models, dict) else {}
    unet = str(m.get("unet") or "").strip()
    video_vae = str(m.get("videoVae") or "").strip()
    audio_vae = str(m.get("audioVae") or "").strip()
    clip = str(m.get("clip") or "").strip()
    clip_type = str(m.get("clipType") or "").strip()
    for node in template.values():
        if not isinstance(node, dict):
            continue
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            continue
        cls = node.get("class_type")
        if cls == "UNETLoader":
            if unet:
                inputs["unet_name"] = unet
            elif family != "image":
                # 视频槽位只对视频工作流生效；生图工作流沿用模板自己的底模
                inputs["unet_name"] = _pick_model(
                    "diffusion_models",
                    str(inputs.get("unet_name") or ""),
                    ("minimax_h3", "h3", "qwen_image", "qwen"),
                )
        elif cls == "CLIPLoader":
            current_clip = str(inputs.get("clip_name") or "")
            current_is_image = ("qwen3.5" in current_clip.lower() or "qwen_image" in current_clip.lower())
            is_image_flow = family == "image" or (family == "auto" and current_is_image)
            if is_image_flow:
                # 生图工作流：H3 的 32b 编码器（5120）绝不能进来，否则报 4096/5120 形状错误
                if clip and ("qwen3.5" in clip.lower() or "qwen_image" in clip.lower()):
                    inputs["clip_name"] = clip
                else:
                    inputs["clip_name"] = _pick_model("text_encoders", current_clip, ("qwen3.5", "qwen_image"))
            else:
                # H3 参考视频：用户选的就是它；没配时只在含 32b 的项里回落，绝不回落到 8b/4b
                if clip and not ("qwen3.5" in clip.lower() or "qwen_image" in clip.lower()):
                    inputs["clip_name"] = clip
                else:
                    names = [n for n in _available_models("text_encoders") if "32b" in n.lower()]
                    inputs["clip_name"] = names[0] if names else current_clip
            if clip_type:
                inputs["type"] = clip_type
        elif cls == "VAELoader":
            current = str(inputs.get("vae_name") or "").lower()
            if "audio" in current:
                inputs["vae_name"] = audio_vae or _pick_model(
                    "vae", str(inputs.get("vae_name") or ""), ("audio", "minimax_h3")
                )
            else:
                inputs["vae_name"] = video_vae or _pick_model(
                    "vae",
                    str(inputs.get("vae_name") or ""),
                    ("qwen_image", "qwen") if "qwen" in current else ("video", "minimax_h3"),
                )
        elif cls == "CheckpointLoaderSimple":
            inputs["ckpt_name"] = _pick_model(
                "checkpoints", str(inputs.get("ckpt_name") or ""), ("qwen", "flux", "sdxl")
            )
    return template



def load_template(kind: str) -> dict[str, Any]:
    path = os.path.join(TEMPLATE_DIR, f"{kind}.json")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def guide_meta(path: str) -> dict[str, Any] | None:
    """guide 产物元数据：帧数取 safetensors 张量形状，sha256 供前端去重。"""
    if not path or not os.path.isfile(path):
        return None
    try:
        from safetensors import safe_open

        with safe_open(path, framework="pt") as f:
            frames = int(f.get_slice("guide").get_shape()[0])
        digest = _sha256_file(path)
    except Exception:  # noqa: BLE001 - 元数据缺失不影响产物回传
        return None
    return {
        "id": os.path.splitext(os.path.basename(path))[0],
        "path": path,
        "frames": frames,
        "sha256": digest,
    }


# 2026-11-20 用户硬要求：id 相同 ≠ 内容相同（实测同一 gd 在云端/本地字节数不同）。
# 引导内容哈希按 (path,size,mtime) 缓存，避免每段重复读几百 MB。
_GUIDE_SHA_CACHE: dict[str, tuple[int, float, str]] = {}


def _sha256_file(path: str) -> str:
    st = os.stat(path)
    hit = _GUIDE_SHA_CACHE.get(path)
    if hit and hit[0] == st.st_size and hit[1] == st.st_mtime:
        return hit[2]
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(8 * 1024 * 1024), b""):
            digest.update(block)
    out = digest.hexdigest()
    _GUIDE_SHA_CACHE[path] = (st.st_size, st.st_mtime, out)
    return out


def _verify_guide_sha(path: str, want: str, label: str) -> None:
    """内容指纹校验：不一致就拒绝执行，绝不把错引导当对的用。"""
    want = str(want or "").strip().lower()
    if not want:
        return
    got = _sha256_file(path)
    if got != want:
        raise ValueError(
            f"{label}内容与记录不一致（记录 {want[:12]}… / 实际 {got[:12]}…，{os.path.getsize(path)} 字节）："
            "拒绝执行本段，请重新生成该引导或换成正确的那一份"
        )


def _history_entry(prompt_id: str) -> dict[str, Any] | None:
    try:
        hist = PromptServer.instance.prompt_queue.get_history(prompt_id=prompt_id) or {}
    except Exception:  # noqa: BLE001
        return None
    return hist.get(prompt_id)


def refresh_job(job: dict[str, Any]) -> dict[str, Any]:
    """按 /history 回填状态与产物（视频落盘路径由 SaveVideo 的 history outputs 给出）。"""
    if job.get("state") in ("success", "error", "cancelled"):
        return job
    entry = _history_entry(job.get("promptId") or "")
    if not entry:
        # 不在运行/排队中、也没有 history → 被外部中断（ComfyUI 界面取消/队列删除/重启），
        # 否则前端会永远轮询到 running，节点一直显示「生成中」。
        prompt_id = job.get("promptId")
        if prompt_id:
            try:
                running, pending = PromptServer.instance.prompt_queue.get_current_queue()
                in_queue = any(item[1] == prompt_id for item in list(running) + list(pending))
            except Exception:  # noqa: BLE001
                in_queue = None
            if in_queue is False:
                job["state"] = "error"
                job["error"] = "任务已中断（ComfyUI 队列中已不存在，可能是被手动取消或重启）"
        return job
    status = entry.get("status") or {}
    state = status.get("status_str")
    if state == "error":
        job["state"] = "error"
        for event, payload in status.get("messages") or []:
            if event == "execution_error" and isinstance(payload, dict):
                job["error"] = payload.get("exception_message") or "执行失败"
                break
        else:
            job["error"] = job.get("error") or "执行失败"
        return job
    if state != "success":
        return job
    output_dir = folder_paths.get_output_directory()
    image_kinds = ("qwen_image_edit", "krea2_t2i", "moss_image_t2i")
    out_kind = "image" if job.get("kind") in image_kinds else "video"
    outputs: list[dict[str, Any]] = []
    for node_out in (entry.get("outputs") or {}).values():
        for item in node_out.get("images") or []:
            name = item.get("filename") if isinstance(item, dict) else None
            if not name or item.get("type") != "output":
                continue
            path = os.path.join(output_dir, item.get("subfolder") or "", name)
            if os.path.isfile(path):
                outputs.append({"kind": out_kind, "path": path})
    job["outputs"] = outputs
    if not outputs:
        job["state"] = "error"
        job["error"] = "执行完成但没有产物（工作流节点校验未通过，详见 ComfyUI 控制台）"
        return job
    job["state"] = "success"
    if job.get("kind") not in image_kinds:
        job["guide"] = guide_meta(job.get("guidePath") or "")
    return job


# ===== GUIDE 节点：把采样得到的帧存成 safetensors，供下一段复用 =====
class ZeroExoGuideSave:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"images": ("IMAGE",), "frames": (GUIDE_FRAME_OPTIONS, {"default": 22})}}

    RETURN_TYPES = ("ZEROEXO_GUIDE", "STRING")
    FUNCTION = "save"
    CATEGORY = "ZeroExo"

    def save(self, images: torch.Tensor, frames: int):
        out_dir = ensure_dir(os.path.join(output_root(), "guides"))
        guide_id = f"gd_{uuid.uuid4().hex[:12]}"
        path = os.path.join(out_dir, f"{guide_id}.safetensors")
        # 尾部帧：作为下一段 motion context（与导演台尾帧语义一致；取头部会接错运动）
        n = max(1, min(int(frames), int(images.shape[0])))
        data = images[-n:].detach().cpu().contiguous()
        from safetensors.torch import save_file
        save_file({"guide": data}, path)
        return ({"id": guide_id, "path": path, "frames": int(data.shape[0])}, path)


class ZeroExoGuideLoad:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"path": ("STRING", {"default": ""})}}

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "load"
    CATEGORY = "ZeroExo"

    def load(self, path: str):
        from safetensors.torch import load_file
        return (load_file(path)["guide"],)


# ===== HTTP 协议 =====
routes = PromptServer.instance.routes

PLUGIN_VERSION = "0.1.2"


def _queue_counts() -> dict[str, Any]:
    """运行中/排队数（前端「已中断」自愈对账用；拿不到给 None 不报错）。"""
    out: dict[str, Any] = {"running": None, "pending": None}
    try:
        pq = getattr(PromptServer.instance, "prompt_queue", None)
        if pq is not None:
            out["running"] = len(getattr(pq, "currently_running", {}) or {})
            out["pending"] = pq.get_tasks_remaining() if hasattr(pq, "get_tasks_remaining") else None
    except Exception:  # noqa: BLE001
        pass
    return out


def _last_prompt_path(job_id: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", job_id or "unknown")[:80] or "unknown"
    return os.path.join(output_root(), f"last_prompt_{safe}.json")


def _truthy(value: Any) -> bool:
    if value is True or value == 1:
        return True
    if isinstance(value, str):
        return value.strip().lower() in {"true", "1", "yes", "on"}
    return False


def guides_dir() -> str:
    return ensure_dir(os.path.join(output_root(), "guides"))


def resolve_guide_input(params: dict[str, Any]) -> tuple[str, str]:
    """解析本段显式输入引导。

    插件是被动执行器：只认调用方给的 `guide_id`（片段引导槽/批次起始引导），
    按 id 找自己 output/guides 下的 gd_xxx.safetensors；没有就返回空路径（本段不用引导）。
    不存在「取同项目上一段」的隐式兜底 —— 续接由批次内的 chain 指令显式给出。
    返回 (绝对路径, 来源 explicit|none)。
    """
    explicit = str(params.get("guide_id") or "").strip()
    if explicit:
        if not GUIDE_ID_PATTERN.match(explicit):
            raise ValueError(f"guide_id 非法（只接受 gd_ 前缀）: {explicit}")
        path = os.path.join(guides_dir(), f"{explicit}.safetensors")
        if not os.path.isfile(path):
            raise FileNotFoundError(f"引导槽文件不存在: {explicit}")
        _verify_guide_sha(path, str(params.get("guide_sha256") or ""), f"引导槽 {explicit} ")
        return path, "explicit"
    return "", "none"


def _format_node_errors(node_errors: dict[str, Any]) -> str:
    """把 /prompt 返回的 node_errors 压成一行可读错误（前端可直接展示）。"""
    parts: list[str] = []
    for node_id, info in (node_errors or {}).items():
        class_type = info.get("class_type") or ""
        for err in info.get("errors") or []:
            message = err.get("message") or err.get("type") or "校验失败"
            details = err.get("details") or ""
            parts.append(f"{node_id} {class_type}: {message}{('（' + str(details) + '）') if details else ''}")
    return "；".join(parts)[:600]


def _save_last_prompt(job_id: str, prompt_id: str, template: dict[str, Any], params: dict[str, Any]) -> None:
    """落盘本次提交给 ComfyUI 的完整 prompt JSON（刷新/重启后仍可查）。"""
    try:
        record = {
            "jobId": job_id,
            "promptId": prompt_id,
            "assembledAt": int(time.time() * 1000),
            "plugin": "H3ZeroExo",
            "params": params,
            "nodeSummary": [
                {"id": str(nid), "classType": str(node.get("class_type") or "")}
                for nid, node in (template or {}).items()
                if isinstance(node, dict)
            ],
            "graph": template,
        }
        path = _last_prompt_path(job_id)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False)
    except Exception as exc:  # noqa: BLE001 - 落盘失败不影响运行
        import logging
        logging.getLogger(__name__).warning("ZeroExoNodes: persist last prompt failed: %s", exc)


@routes.get("/zeroexo/v1/guides/{guide_id}")
async def guide_stat(request):
    """引导文件是否已在 ComfyUI 输出缓存里（账户制存储：机器换了只要没删就还在）。"""
    gid = str(request.match_info.get("guide_id") or "")
    if not GUIDE_ID_PATTERN.match(gid):
        return web.json_response({"ok": False, "error": f"guide_id 非法: {gid}"}, status=400)
    path = os.path.join(guides_dir(), f"{gid}.safetensors")
    if not os.path.isfile(path):
        return web.json_response({"ok": True, "exists": False, "id": gid}, status=404)
    try:
        size = os.path.getsize(path)
    except OSError:
        size = 0
    out: dict[str, Any] = {"ok": True, "exists": True, "id": gid, "bytes": size, "path": path}
    # 始终回 sha256（按 size+mtime 缓存），让调用方在「记录里没存哈希」时也能核对内容
    try:
        out["sha256"] = _sha256_file(path)
    except OSError as exc:  # noqa: PERF203
        out["sha256Error"] = str(exc)
    # 调用方给了期望 sha256 → 顺带校验内容（id 相同但文件被截断/替换的情况）
    want = str(request.query.get("sha256") or "").strip().lower()
    if want:
        if out.get("sha256"):
            out["match"] = out["sha256"] == want
            if not out["match"]:
                out["exists"] = False
    return web.json_response(out)


def _safetensors_ok(data: bytes) -> bool:
    """只做最小合法性校验：8 字节头长 + 可解析 JSON，且带 guide 张量。"""
    if len(data) < 24:
        return False
    import struct
    (header_len,) = struct.unpack("<Q", data[:8])
    if header_len <= 0 or 8 + header_len > len(data):
        return False
    try:
        header = json.loads(data[8 : 8 + header_len].decode("utf-8"))
    except Exception:  # noqa: BLE001
        return False
    return isinstance(header, dict) and "guide" in header


@routes.post("/zeroexo/v1/guides/{guide_id}")
async def guide_upload(request):
    """双重兜底的上传端：调用方（网页/MCP）在输出缓存里没有该引导时，把本地缓存推上来。

    支持 raw `application/octet-stream` 与 multipart（字段 file / guide 均可）。
    """
    gid = str(request.match_info.get("guide_id") or "")
    if not GUIDE_ID_PATTERN.match(gid):
        return web.json_response({"ok": False, "error": f"guide_id 非法: {gid}"}, status=400)
    try:
        ctype = str(request.headers.get("Content-Type") or "").lower()
        if "multipart/" in ctype:
            post = await request.post()
            field = post.get("file") or post.get("guide")
            if field is None or not hasattr(field, "file"):
                return web.json_response({"ok": False, "error": "multipart 里没有 file/guide 字段"}, status=400)
            data = field.file.read()
        else:
            data = await request.read()
        if not data:
            return web.json_response({"ok": False, "error": "空文件"}, status=400)
        if len(data) > 2 * 1024 * 1024 * 1024:
            return web.json_response({"ok": False, "error": "引导文件超过 2GB"}, status=413)
        if not _safetensors_ok(data):
            return web.json_response({"ok": False, "error": "不是合法的 safetensors（缺少 guide 张量）"}, status=400)
        dest = os.path.join(guides_dir(), f"{gid}.safetensors")
        tmp = dest + ".tmp"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, dest)
        return web.json_response({
            "ok": True,
            "exists": True,
            "id": gid,
            "bytes": os.path.getsize(dest),
            "sha256": hashlib.sha256(data).hexdigest(),
        })
    except Exception as exc:  # noqa: BLE001
        return web.json_response({"ok": False, "error": f"写入引导失败: {exc}"}, status=500)


@routes.get("/zeroexo/v1/health")
async def health(_request):
    return web.json_response({
        "ok": True,
        "plugin": "H3ZeroExo",
        "version": PLUGIN_VERSION,
        "templates": sorted(p[:-5] for p in os.listdir(TEMPLATE_DIR) if p.endswith(".json") and ".backup" not in p and ".workflow" not in p),
        "outputRoot": output_root(),
        "queue": _queue_counts(),
    })


@routes.get("/zeroexo/v1/models")
async def models(_request):
    """可用的模型文件清单（与桥接 /zeroexo/h3/models 同口径；连接面板校验用）。"""
    out: dict[str, Any] = {"ok": True, "unet": [], "vae": [], "clip": [], "clipTypes": []}
    try:
        import folder_paths as _fp
        out["unet"] = _fp.get_filename_list("diffusion_models")
        out["vae"] = _fp.get_filename_list("vae")
        out["clip"] = _fp.get_filename_list("text_encoders")
    except Exception:  # noqa: BLE001
        pass
    try:
        import nodes as comfy_nodes
        clip_loader = comfy_nodes.NODE_CLASS_MAPPINGS.get("CLIPLoader")
        if clip_loader is not None:
            spec = clip_loader.INPUT_TYPES()
            type_widget = (spec.get("required") or {}).get("type")
            if isinstance(type_widget, (list, tuple)) and type_widget:
                out["clipTypes"] = list(type_widget[0])
    except Exception:  # noqa: BLE001
        pass
    return web.json_response(out)


@routes.get("/zeroexo/v1/last-prompt")
async def last_prompt(request):
    """最近一次提交给 ComfyUI 的完整 prompt JSON（可复制/下载，前端「查看本次工作流」）。"""
    job_id = request.query.get("jobId") or ""
    try:
        if job_id:
            path = _last_prompt_path(job_id)
        else:
            root = output_root()
            files = [
                os.path.join(root, name)
                for name in os.listdir(root)
                if name.startswith("last_prompt_") and name.endswith(".json")
            ] if os.path.isdir(root) else []
            if not files:
                return web.json_response({"ok": False, "error": "还没有提交过 prompt（先运行一次）"}, status=404)
            path = max(files, key=os.path.getmtime)
        if not os.path.isfile(path):
            return web.json_response({"ok": False, "error": f"找不到该作业的 prompt 记录: {job_id}"}, status=404)
        with open(path, "r", encoding="utf-8") as f:
            record = json.load(f)
        return web.json_response({
            "ok": True,
            "jobId": record.get("jobId"),
            "promptId": record.get("promptId"),
            "assembledAt": record.get("assembledAt"),
            "template": "templates/*.json（本插件内置模板）",
            "nodeSummary": record.get("nodeSummary") or [],
            "prompt": record.get("graph") or {},
        })
    except Exception as exc:  # noqa: BLE001
        return web.json_response({"ok": False, "error": f"读取 prompt 记录失败: {exc}"}, status=500)


@routes.get("/zeroexo/v1/capabilities")
async def capabilities(_request):
    return web.json_response({
        "ok": True,
        "kinds": [
            {
                "kind": "reference_video",
                "label": "参考生视频",
                "visibleParams": VISIBLE_PARAMS,
                "defaults": {"guide_frames": 22, "steps": 1, "width": 100, "height": 100, "frames": 49},
            },
            {
                "kind": "reference_video_batch",
                "label": "参考生视频（连续段批次：起始引导 + 内部自链）",
                "visibleParams": VISIBLE_PARAMS,
                "defaults": {"guide_frames": 22, "steps": 1, "width": 100, "height": 100, "frames": 49},
            },
            {
                "kind": "qwen_image_edit",
                "label": "Qwen Image 2.1 图像编辑",
                "visibleParams": IMAGE_VISIBLE_PARAMS,
                "defaults": {"seed": 1, "steps": 25, "cfg": 1.0, "denoise": 1.0, "width": 1344, "height": 1008},
            },
            {
                "kind": "krea2_t2i",
                "label": "Krea2 文生图",
                "visibleParams": KREA2_VISIBLE_PARAMS,
                "defaults": {"seed": 1, "steps": 10, "cfg": 1.0, "width": 1024, "height": 1024},
            },
            {
                "kind": "moss_image_t2i",
                "label": "Moss Image 文生图",
                "visibleParams": MOSS_VISIBLE_PARAMS,
                "defaults": {"seed": 1, "steps": 25, "cfg": 2.5, "width": 1024, "height": 1024},
            },
        ],
    })


async def _post_prompt(job: dict[str, Any], template: dict[str, Any], client_id: str) -> None:
    server = PromptServer.instance
    # 引擎预览/进度按 clientId 定向；插件内部 HTTP 提交前必须显式设置，
    # 否则 PromptServer.client_id 是别的连接，网页永远收不到采样帧。
    try:
        from .engine.runtime_context import set_client_id
        set_client_id(client_id)
    except Exception:  # noqa: BLE001
        pass
    await server.send_json("zeroexo.v1.job", {"jobId": job["jobId"], "state": "queued"})
    url = f"http://127.0.0.1:{server.port}/prompt"
    # 2026-11-16：服务端默认 preview_method=NoPreviews，不显式打开就没有采样预览帧；
    # auto → Latent2RGB（Qwen latent 带 latent_rgb_factors），新版服务端只会把预览发给
    # 声明了 feature_flags 的 ws 客户端，网页 socket 已声明 supports_preview_metadata。
    payload: dict[str, Any] = {"prompt": template, "extra_data": {"preview_method": "auto"}}
    if client_id:
        payload["client_id"] = client_id
    async with aiohttp.ClientSession() as sess:
        async with sess.post(url, json=payload) as resp:
            data = await resp.json()
            if resp.status != 200 or not data.get("prompt_id"):
                raise RuntimeError(f"ComfyUI 队列拒绝: {data.get('error') or data}")
            node_errors = data.get("node_errors") or {}
            if node_errors:
                raise RuntimeError(f"ComfyUI 工作流校验失败: {_format_node_errors(node_errors)}")
    job["promptId"] = data["prompt_id"]
    job["state"] = "running"
    _save_last_prompt(job["jobId"], job["promptId"], template, job["params"])


async def _video_queue_worker() -> None:
    """单段视频作业串行执行（跨段续接走 reference_video_batch，不在这里做隐式兜底）。"""
    global VIDEO_QUEUE_WORKER
    try:
        while VIDEO_QUEUE:
            item = VIDEO_QUEUE.pop(0)
            job = item["job"]
            if job.get("state") == "cancelled":
                continue
            try:
                await _post_prompt(job, item["template"], item.get("clientId") or "")
            except Exception as e:  # noqa: BLE001
                job["state"] = "error"
                job["error"] = str(e)
                continue
            while job.get("state") in ("queued", "running"):
                await asyncio.sleep(1)
                refresh_job(job)
            # 每段作业之间真正释放显存：ComfyUI 默认会缓存模型，必须显式 unload；
            # 原版单节点多段是在 executor 内部清理，这里拆成多作业后在队列边界补上。
            if _truthy(job.get("params", {}).get("clear_vram_between_segments")):
                try:
                    from .engine.vram_cleanup import cleanup_segment_vram
                    cleanup_segment_vram(enabled=True, unload_models=True)
                except Exception as e:  # noqa: BLE001
                    print(f"[ZeroExo] segment VRAM cleanup failed: {e}", flush=True)
    finally:
        VIDEO_QUEUE_WORKER = None


def _ensure_video_worker() -> None:
    global VIDEO_QUEUE_WORKER
    if VIDEO_QUEUE_WORKER is None or VIDEO_QUEUE_WORKER.done():
        VIDEO_QUEUE_WORKER = asyncio.create_task(_video_queue_worker())


@routes.post("/zeroexo/v1/jobs")
async def submit_job(request):
    body = await request.json()
    kind = body.get("kind") or "reference_video"
    if kind == "reference_video_batch":
        return await submit_batch(body)
    visible = (
        IMAGE_VISIBLE_PARAMS if kind == "qwen_image_edit"
        else KREA2_VISIBLE_PARAMS if kind == "krea2_t2i"
        else MOSS_VISIBLE_PARAMS if kind == "moss_image_t2i"
        else VISIBLE_PARAMS
    )
    params: dict[str, Any] = {name: spec.get("default") for name, spec in visible.items()}
    params.update(TEMPLATE_DEFAULTS)
    params.update({k: v for k, v in (body.get("params") or {}).items() if v is not None})
    _normalize_seed(params)
    # Qwen-Image-2.1 原生 2K：HTTP 直调也夹到 2048，避免前端之外的调用打穿
    if kind == "qwen_image_edit":
        for key in ("width", "height"):
            try:
                params[key] = max(64, min(2048, int(params.get(key) or 1024)))
            except (TypeError, ValueError):
                params[key] = 1024
    # Moss：Flux2 latent 要求 16 对齐；宽高同样夹到 2048
    if kind == "moss_image_t2i":
        for key in ("width", "height"):
            try:
                v = max(64, min(2048, int(params.get(key) or 1024)))
            except (TypeError, ValueError):
                v = 1024
            params[key] = max(64, int(round(v / 16.0)) * 16)
    # 多参考图：数组 → 逗号串（节点输入是 STRING）
    if isinstance(params.get("reference_images"), list):
        params["reference_images"] = ",".join(str(x).strip() for x in params["reference_images"] if str(x).strip())
    # guide_frames 是下拉档位（5/22/39/56）：HTTP 传 30 之类的值夹到最近档位，避免组合校验失败
    params["guide_frames"] = snap_guide_frames(params.get("guide_frames"))
    # LoRA 名不能为空（空串会让 LoraLoaderModelOnly 找不到文件）；空 = 用默认 LoRA
    if not str(params.get("lora_name") or "").strip():
        params["lora_name"] = TEMPLATE_DEFAULTS["lora_name"]
    for key in ("project", "episode"):
        if body.get(key):
            params[key] = body[key]
    run_id = str(body.get("runId") or "").strip()
    if kind == "reference_video":
        # 输入引导（片段引导槽 / 批次起始引导）在此解析：只认显式 guide_id，没有就不用。
        try:
            guide_in_path, guide_source = resolve_guide_input(params)
        except FileNotFoundError as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=404)
        except ValueError as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)
        params["guide_in_path"] = guide_in_path
        # guide_in_path 在模板里占位为 prev_guide_path；显式引导已经能通过 substitute 注入
    else:
        guide_in_path, guide_source = "", "none"
        params["guide_in_path"] = ""
    # 图像编辑：无输入图 → 文生图模板；有遮罩 → 遮罩模板；否则普通图生图模板
    template_kind = kind
    if kind == "qwen_image_edit":
        if not str(params.get("input_image") or "").strip():
            template_kind = "qwen_image_t2i"
        elif str(params.get("mask_image") or "").strip():
            template_kind = "qwen_image_edit_mask"
    try:
        template = substitute(load_template(template_kind), params)
    except FileNotFoundError:
        return web.json_response({"ok": False, "error": f"缺少模板 templates/{template_kind}.json"}, status=400)
    # 前端四个槽位是「视频 H3」的配置：只有参考视频工作流能用，图片工作流用模板自己的底模/编码器
    template = apply_model_overrides(
        template,
        body.get("models"),
        family="video" if kind == "reference_video" else "image",
    )
    # 多参考图：把第 2、3 张接进模板的 BatchImagesNode（Qwen 2.1 原生支持多图参考），
    # 只做「有就加」的增补，不改变单图既有链路。
    if template_kind in ("qwen_image_edit", "qwen_image_edit_mask"):
        _attach_extra_ref_images(template, params.get("input_images"))
    if kind == "reference_video":
        # H3 必须用 32b 文本编码器（hidden 5120）；若机器上只有 8b/4b（4096），
        # 继续跑会在 matmul 报 "shapes cannot be multiplied (10x4096 and 5120x5376)"，
        # 这里提前给出可操作的错误，而不是让用户看到 PyTorch 形状错误。
        available_text_encoders = _available_models("text_encoders")
        for node in template.values():
            if not isinstance(node, dict) or node.get("class_type") != "CLIPLoader":
                continue
            clip_name = str((node.get("inputs") or {}).get("clip_name") or "")
            if clip_name and available_text_encoders and clip_name not in available_text_encoders:
                return web.json_response({
                    "ok": False,
                    "error": (
                        f"缺少 H3 文本编码器 {clip_name}：请把 qwen3vl_32b_minimax_h3_* 放进 models/text_encoders（放 models/clip 也认）。"
                        " 8b/4b 的 hidden 是 4096，H3 需要 5120，强行跑会报 matmul 形状不匹配。"
                    ),
                }, status=400)
        # 低显存 / 原模型是 switch 二选一，但两条链都是输出节点的祖先 → 都会执行。
        # 按本次参数把没选中的一支删掉，避免「选了高性能还在跑低显存链」。
        template = prune_model_chain(template, _truthy(params.get("use_low_vram")))

    job_id = body.get("clientJobId") or f"zx_{uuid.uuid4().hex[:12]}"
    # 前端 /ws clientId 透传：引擎的 minimax_director_preview/progress 按 server.client_id 定向发送
    client_id = str(body.get("clientId") or "").strip()
    guide_path = ""
    if kind == "reference_video":
        guide_dir = ensure_dir(os.path.join(output_root(), "guides"))
        guide_path = os.path.join(guide_dir, f"gd_{uuid.uuid4().hex[:12]}.safetensors")
        for node in template.values():
            if isinstance(node, dict) and node.get("class_type") == "ZeroExoRefVideo":
                node["inputs"]["guide_path"] = guide_path
    job: dict[str, Any] = {
        # taskId：插件任务表主键；单作业与批次共用同一条持久化路径，缺了 save_task 会 KeyError
        "taskId": job_id,
        "jobId": job_id, "promptId": None, "kind": kind, "state": "queued",
        "params": params, "outputs": [], "guide": None, "guidePath": guide_path or None,
        # 输入引导来源（explicit=起始段显式引导 / chain=批内上一段 / prev=旧兜底 / none）
        "guideSource": guide_source, "guideInPath": guide_in_path, "error": None,
        # 批内续接：runId 只用于取消同一批；批次不持有任何项目数据
        "runId": run_id or None,
    }
    JOBS[job_id] = job
    # 图片/单段作业也进入插件持久任务表，网页任务队列可查历史
    _save_job(job)
    # 2026-11-07：先落盘再提交，队列校验失败时也能查本次完整 prompt
    _save_last_prompt(job_id, "", template, params)
    if kind == "reference_video":
        VIDEO_QUEUE.append({"job": job, "template": template, "clientId": client_id})
        _ensure_video_worker()
        return web.json_response({"ok": True, "jobId": job_id, "state": "queued", "error": None})
    server = PromptServer.instance
    try:
        await server.send_json("zeroexo.v1.job", {"jobId": job_id, "state": "queued"})
        url = f"http://127.0.0.1:{server.port}/prompt"
        # extra_data.preview_method=auto：打开采样预览帧（见 _post_prompt 注释）
        payload: dict[str, Any] = {"prompt": template, "extra_data": {"preview_method": "auto"}}
        if client_id:
            payload["client_id"] = client_id
        async with aiohttp.ClientSession() as sess:
            async with sess.post(url, json=payload) as resp:
                data = await resp.json()
                if resp.status != 200 or not data.get("prompt_id"):
                    raise RuntimeError(f"ComfyUI 队列拒绝: {data.get('error') or data}")
                node_errors = data.get("node_errors") or {}
                if node_errors:
                    raise RuntimeError(f"ComfyUI 工作流校验失败: {_format_node_errors(node_errors)}")
        job["promptId"] = data["prompt_id"]
        job["state"] = "running"
        # 2026-11-07：落盘本次提交的完整 prompt（前端「查看本次工作流」/排查用，刷新后仍在）
        _save_last_prompt(job_id, job["promptId"], template, params)
    except Exception as e:  # noqa: BLE001
        job["state"] = "error"
        job["error"] = str(e)
    return web.json_response({"ok": job["state"] != "error", "jobId": job_id, "state": job["state"], "error": job["error"]})


@routes.get("/zeroexo/v1/jobs/{job_id}")
async def job_status(request):
    job = JOBS.get(request.match_info["job_id"])
    if not job:
        return web.json_response({"ok": False, "error": "job 不存在"}, status=404)
    # 批次由 worker 自己维护段状态；绝不能拿父 job 去 refresh_job（父的 promptId 只是当前子段，
    # 会把「某个子段成功」误判成整批 success，进度/取消全乱）。
    if job.get("kind") != "reference_video_batch":
        refresh_job(job)
        _save_job(job)
    return web.json_response({"ok": True, **job})


@routes.post("/zeroexo/v1/jobs/{job_id}/cancel")
async def cancel_job(request):
    job = JOBS.get(request.match_info["job_id"])
    if not job:
        return web.json_response({"ok": False, "error": "job 不存在"}, status=404)
    if job.get("kind") == "reference_video_batch":
        # 批次取消：队列里删掉整批、中断当前子作业、剩余段标已取消。
        job["cancelRequested"] = True
        job["state"] = "cancelled"
        BATCH_QUEUE[:] = [x for x in BATCH_QUEUE if (x.get("job") or {}).get("jobId") != job["jobId"]]
        _batch_mark_remaining(job, "cancelled")
        child_id = str(job.get("currentJobId") or "")
        child = JOBS.get(child_id) if child_id else None
        if child and child.get("promptId"):
            _interrupt_prompt(child["promptId"])
        if child and child.get("state") in ("queued", "running"):
            child["state"] = "cancelled"
        return web.json_response({"ok": True, **job})
    # 取消任意一段 = 取消同批还没提交的整条队列，否则 worker 会继续把下一段送进 ComfyUI，
    # 页面已经显示取消、云端却还在跑。批内用 runId 精确圈定；旧链路按 project 兜底。
    if job.get("kind") == "reference_video":
        run_id = str(job.get("runId") or "")
        project = (job.get("params") or {}).get("project")
        keep: list[dict[str, Any]] = []
        for item in VIDEO_QUEUE:
            queued = item.get("job") or {}
            same_run = bool(run_id) and str(queued.get("runId") or "") == run_id
            same_legacy_batch = (
                not run_id and not queued.get("runId") and bool(project)
                and (queued.get("params") or {}).get("project") == project
            )
            if same_run or same_legacy_batch:
                queued["state"] = "cancelled"
                continue
            keep.append(item)
        VIDEO_QUEUE[:] = keep
    if job.get("promptId"):
        try:
            pq = PromptServer.instance.prompt_queue
            # 运行中的作业必须走 interrupt_if_running（delete_queue_item 只能删排队项，删不掉正在跑的）
            interrupted = False
            if hasattr(pq, "interrupt_if_running"):
                interrupted = bool(pq.interrupt_if_running(job["promptId"]))
            if not interrupted:
                pq.delete_queue_item(lambda item: item[1] == job["promptId"])
        except Exception as e:  # noqa: BLE001
            return web.json_response({"ok": False, "error": str(e)}, status=500)
    job["state"] = "cancelled"
    return web.json_response({"ok": True, **job})


# ===== 连续段批次（2026-11-15）：起始引导 + 内部自链 =====
# 一次任务 = 一个批次。批次只带「每段提示词/参数 + 起始引导 id + chain/none 指令」，
# 不读写任何项目数据。段与段之间由本进程内部串行推进：上一段成功拿到 guide 后，
# 直接把该 guide 作为下一段的输入资产；每段完成即把 video + guide 写进段状态，
# 前端/MCP 轮询立刻能看到，不需要等整批跑完（返回结果不等于触发下一段）。


def _batch_mark_remaining(job: dict[str, Any], state: str, from_index: int = 0, reason: str = "") -> None:
    for seg in job.get("segments") or []:
        try:
            idx = int(seg.get("index") or 0)
        except (TypeError, ValueError):
            idx = 0
        if idx <= from_index:
            continue
        if seg.get("state") in ("success", "error"):
            continue
        seg["state"] = state
        if reason and not seg.get("error"):
            seg["error"] = reason


def _interrupt_prompt(prompt_id: str) -> bool:
    try:
        pq = PromptServer.instance.prompt_queue
        if hasattr(pq, "interrupt_if_running") and pq.interrupt_if_running(prompt_id):
            return True
        pq.delete_queue_item(lambda item: item[1] == prompt_id)
        return True
    except Exception:  # noqa: BLE001 - 取消失败不阻断批次收尾
        return False


def _normalize_seed(params: dict[str, Any]) -> None:
    """前端 seed=-1 表示「随机」；ComfyUI 节点校验 min=0，直接透传会被整图拒绝。"""
    try:
        seed = int(params.get("seed"))
    except (TypeError, ValueError):
        seed = 1
    if seed < 0:
        params["seed"] = random.randint(0, 2**31 - 1)


def _save_job(job: dict[str, Any]) -> None:
    """任务事实源持久化：网页/MCP 关闭不影响，插件重启可恢复。"""
    try:
        task_store.save_task(output_root(), job)
    except Exception as exc:  # noqa: BLE001
        print(f"[ZeroExo] persist task failed: {exc}", flush=True)


def _extract_last_frame(video_path: str, out_path: str) -> str:
    """从成品视频抽最后一帧作为片段封面（WS 预览帧常是低清/早期帧，会显得糊）。"""
    try:
        import cv2  # ComfyUI 环境自带
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return ""
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, total - 1))
        ok, frame = cap.read()
        cap.release()
        if not ok or frame is None:
            return ""
        ensure_dir(os.path.dirname(out_path))
        cv2.imwrite(out_path, frame)
        return out_path
    except Exception as exc:  # noqa: BLE001
        print(f"[ZeroExo] extract last frame failed: {exc}", flush=True)
        return ""


def _prepare_batch_segment(
    seg: dict[str, Any],
    models: Any,
    guide_in_path: str,
) -> tuple[dict[str, Any], dict[str, Any], str]:
    """把一个 segment 准备成可提交的 reference_video：参数默认值 + 模型链 + 起始引导 + 输出 guide 路径。"""
    raw = seg.get("params") or {}
    params: dict[str, Any] = {name: spec.get("default") for name, spec in VISIBLE_PARAMS.items()}
    params.update(TEMPLATE_DEFAULTS)
    params.update({k: v for k, v in raw.items() if v is not None})
    _normalize_seed(params)
    if isinstance(params.get("reference_images"), list):
        params["reference_images"] = ",".join(
            str(x).strip() for x in params["reference_images"] if str(x).strip()
        )
    params["guide_frames"] = snap_guide_frames(params.get("guide_frames"))
    if not str(params.get("lora_name") or "").strip():
        params["lora_name"] = TEMPLATE_DEFAULTS["lora_name"]
    # guide 指令由批次给：initial 的路径已传入；chain 由上一段产物路径传入；none 为空
    params["guide_in_path"] = guide_in_path
    guide_dir = ensure_dir(os.path.join(output_root(), "guides"))
    out_guide = os.path.join(guide_dir, f"gd_{uuid.uuid4().hex[:12]}.safetensors")
    params["guide_path"] = out_guide
    template = substitute(load_template("reference_video"), params)
    template = apply_model_overrides(template, models, family="video")
    available_text_encoders = _available_models("text_encoders")
    for node in template.values():
        if not isinstance(node, dict) or node.get("class_type") != "CLIPLoader":
            continue
        clip_name = str((node.get("inputs") or {}).get("clip_name") or "")
        if clip_name and available_text_encoders and clip_name not in available_text_encoders:
            raise RuntimeError(
                f"缺少 H3 文本编码器 {clip_name}：请把 qwen3vl_32b_minimax_h3_* 放进 models/text_encoders。"
                " 8b/4b 的 hidden 是 4096，H3 需要 5120，强行跑会报 matmul 形状不匹配。"
            )
    template = prune_model_chain(template, _truthy(params.get("use_low_vram")))
    return params, template, out_guide


async def _batch_worker() -> None:
    global BATCH_WORKER
    try:
        while BATCH_QUEUE:
            item = BATCH_QUEUE.pop(0)
            job = item["job"]
            if job.get("cancelRequested"):
                job["state"] = "cancelled"
                _batch_mark_remaining(job, "cancelled")
                _save_job(job)
                continue
            job["state"] = "running"
            _save_job(job)
            failed = False
            for seg in job.get("segments") or []:
                if job.get("cancelRequested"):
                    job["state"] = "cancelled"
                    _batch_mark_remaining(job, "cancelled", int(seg.get("index") or 1) - 1)
                    failed = True
                    _save_job(job)
                    break
                try:
                    index = int(seg.get("index") or 1)
                except (TypeError, ValueError):
                    index = 1
                job["currentSegment"] = index
                _save_job(job)
                guide = seg.get("guide") if isinstance(seg.get("guide"), dict) else {}
                mode = str(guide.get("mode") or "none")
                guide_in = ""
                if mode == "initial":
                    gid = str(guide.get("id") or "").strip()
                    if gid:
                        path = os.path.join(guides_dir(), f"{gid}.safetensors")
                        if not os.path.isfile(path):
                            seg["state"] = "error"
                            seg["error"] = f"起始引导不存在: {gid}（请先在项目侧生成/缓存该引导）"
                            job["state"] = "error"
                            job["error"] = seg["error"]
                            failed = True
                            break
                        try:
                            _verify_guide_sha(path, str(guide.get("sha256") or ""), f"起始引导 {gid} ")
                        except ValueError as exc:
                            seg["state"] = "error"
                            seg["error"] = str(exc)
                            job["state"] = "error"
                            job["error"] = seg["error"]
                            failed = True
                            break
                        guide_in = path
                elif mode == "chain":
                    prev = (job.get("segments") or [])[index - 2] if index >= 2 else None
                    prev_path = str(((prev or {}).get("guide") or {}).get("path") or "")
                    if not prev or prev.get("state") != "success" or not prev_path or not os.path.isfile(prev_path):
                        seg["state"] = "error"
                        seg["error"] = "上一段没有产出引导数据，无法续接（不回退其它段引导）"
                        job["state"] = "error"
                        job["error"] = seg["error"]
                        failed = True
                        break
                    guide_in = prev_path
                seg["state"] = "running"
                seg["guideInPath"] = guide_in
                seg["startedAt"] = time.time()
                try:
                    from .engine.runtime_context import set_current_task
                    set_current_task(job.get("taskId") or job.get("jobId"), index)
                except Exception:  # noqa: BLE001
                    pass
                _save_job(job)
                try:
                    params, template, out_guide = _prepare_batch_segment(seg, job.get("models"), guide_in)
                except Exception as exc:  # noqa: BLE001
                    seg["state"] = "error"
                    seg["error"] = str(exc)
                    job["state"] = "error"
                    job["error"] = str(exc)
                    failed = True
                    break
                child: dict[str, Any] = {
                    "jobId": f"{job['jobId']}#{index}",
                    "promptId": None,
                    "kind": "reference_video",
                    "state": "queued",
                    "params": params,
                    "outputs": [],
                    "guide": None,
                    "guidePath": out_guide,
                    "guideSource": "chain" if mode == "chain" else ("explicit" if mode == "initial" else "none"),
                    "guideInPath": guide_in,
                    "error": None,
                    "runId": job["jobId"],
                }
                JOBS[child["jobId"]] = child
                job["currentJobId"] = child["jobId"]
                job["promptId"] = None
                try:
                    await _post_prompt(child, template, str(job.get("clientId") or ""))
                except Exception as exc:  # noqa: BLE001
                    seg["state"] = "error"
                    seg["error"] = str(exc)
                    job["state"] = "error"
                    job["error"] = str(exc)
                    failed = True
                    break
                job["promptId"] = child.get("promptId")
                while child.get("state") in ("queued", "running"):
                    if job.get("cancelRequested") and child.get("state") in ("queued", "running"):
                        if child.get("promptId"):
                            _interrupt_prompt(str(child["promptId"]))
                        child["state"] = "cancelled"
                        break
                    await asyncio.sleep(1)
                    refresh_job(child)
                seg["guide"] = child.get("guide")
                seg["outputs"] = child.get("outputs") or []
                seg["error"] = child.get("error")
                seg["finishedAt"] = time.time()
                seg["state"] = (
                    "success" if child.get("state") == "success"
                    else "cancelled" if child.get("state") == "cancelled"
                    else "error"
                )
                try:
                    from .engine.runtime_context import set_current_task
                    set_current_task(None)
                except Exception:  # noqa: BLE001
                    pass
                if seg["state"] != "success":
                    job["state"] = "cancelled" if seg["state"] == "cancelled" else "error"
                    job["error"] = seg.get("error") or "生成失败"
                    _batch_mark_remaining(
                        job,
                        "cancelled" if job["state"] == "cancelled" else "error",
                        index,
                        "前一段未成功，未执行",
                    )
                    failed = True
                    break
                job["outputs"] = [o for s in job["segments"] for o in (s.get("outputs") or [])]
                job["guide"] = seg.get("guide")
                # 用成品视频最后一帧做片段封面；不回退到 WS 早期低清帧
                out_path = str((seg.get("outputs") or [{}])[0].get("path") or "")
                if out_path:
                    seg["previewPath"] = _extract_last_frame(
                        out_path,
                        os.path.join(output_root(), "previews", f"{job['jobId']}-s{index}.png"),
                    )
                _save_job(job)
                if _truthy(params.get("clear_vram_between_segments")):
                    try:
                        from .engine.vram_cleanup import cleanup_segment_vram
                        cleanup_segment_vram(enabled=True, unload_models=True)
                    except Exception as exc:  # noqa: BLE001
                        print(f"[ZeroExo] batch VRAM cleanup failed: {exc}", flush=True)
            if not failed and job.get("state") != "cancelled":
                job["state"] = "success"
                job["currentSegment"] = None
            job["currentJobId"] = None
            job["cancelRequested"] = False
            _save_job(job)
    finally:
        BATCH_WORKER = None


def _ensure_batch_worker() -> None:
    global BATCH_WORKER
    if BATCH_WORKER is None or BATCH_WORKER.done():
        BATCH_WORKER = asyncio.create_task(_batch_worker())


async def submit_batch(body: dict[str, Any]) -> web.Response:
    segments_in = body.get("segments")
    if not isinstance(segments_in, list) or not segments_in:
        return web.json_response({"ok": False, "error": "segments 不能为空"}, status=400)
    if len(segments_in) > 200:
        return web.json_response({"ok": False, "error": "一个批次最多 200 段"}, status=400)
    batch_id = str(body.get("clientJobId") or f"zxb_{uuid.uuid4().hex[:12]}").strip()
    if batch_id in JOBS:
        return web.json_response({"ok": False, "error": f"批次已存在: {batch_id}"}, status=409)
    segments: list[dict[str, Any]] = []
    for i, raw in enumerate(segments_in):
        if not isinstance(raw, dict):
            return web.json_response({"ok": False, "error": f"segments[{i}] 必须是对象"}, status=400)
        guide = raw.get("guide") if isinstance(raw.get("guide"), dict) else {}
        mode = str(guide.get("mode") or "none")
        if mode not in ("initial", "chain", "none"):
            return web.json_response({"ok": False, "error": f"segments[{i}].guide.mode 非法: {mode}"}, status=400)
        gid = str(guide.get("id") or "").strip()
        if mode == "initial" and gid and not GUIDE_ID_PATTERN.match(gid):
            return web.json_response({"ok": False, "error": f"segments[{i}].guide.id 非法: {gid}"}, status=400)
        if mode == "chain" and i == 0:
            return web.json_response({"ok": False, "error": "第 1 段不能是 chain：必须给 initial 或 none"}, status=400)
        prompt = str((raw.get("params") or {}).get("prompt") or "")
        segments.append({
            "index": i + 1,
            "shotId": raw.get("shotId"),
            "state": "queued",
            "prompt": prompt,
            # 每段自己的提示词/宽高/帧数/步数等参数必须原样带着走；丢了就全走模板默认（49 帧=2s）
            "params": raw.get("params") if isinstance(raw.get("params"), dict) else {},
            "guide": {"mode": mode, **({"id": gid} if gid else {})},
            "outputs": [],
            "error": None,
            "guideInPath": "",
        })
    job: dict[str, Any] = {
        "jobId": batch_id,
        "taskId": batch_id,
        "projectId": str(body.get("projectId") or ""),
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "promptId": None,
        "kind": "reference_video_batch",
        "state": "queued",
        "params": {},
        "outputs": [],
        "segments": segments,
        "currentSegment": None,
        "currentJobId": None,
        "guide": None,
        "guidePath": None,
        "error": None,
        "cancelRequested": False,
        "clientId": str(body.get("clientId") or ""),
        "models": body.get("models"),
        "runId": batch_id,
    }
    JOBS[batch_id] = job
    _save_job(job)
    BATCH_QUEUE.append({"job": job})
    _ensure_batch_worker()
    return web.json_response({"ok": True, "jobId": batch_id, "state": "queued", "segments": len(segments), "error": None})


# ===== 任务表（插件持有，网页/MCP 只读/提交） =====

_RESTORED = False


def _restore_tasks() -> None:
    """插件启动/首次访问时恢复任务：queued 重新入队，running 标中断但保留已完成段。"""
    global _RESTORED
    if _RESTORED:
        return
    _RESTORED = True
    for task in task_store.list_tasks(output_root()):
        task_id = str(task.get("taskId") or "")
        if not task_id or task_id in JOBS:
            continue
        task.setdefault("jobId", task_id)
        if task.get("state") == "running":
            task_store.mark_interrupted(task)
            _save_job(task)
        JOBS[task_id] = task
        if task.get("state") == "queued":
            BATCH_QUEUE.append({"job": task})
    if BATCH_QUEUE:
        _ensure_batch_worker()


@routes.post("/zeroexo/v1/tasks")
async def task_create(request):
    _restore_tasks()
    body = await request.json()
    if not isinstance(body, dict):
        return web.json_response({"ok": False, "error": "body 必须是对象"}, status=400)
    if not body.get("clientJobId"):
        body["clientJobId"] = body.get("taskId") or task_store.new_task_id()
    return await submit_batch(body)


@routes.get("/zeroexo/v1/tasks")
async def task_list(request):
    _restore_tasks()
    project_id = request.query.get("projectId")
    return web.json_response({"ok": True, "tasks": task_store.list_tasks(output_root(), project_id)})


@routes.get("/zeroexo/v1/tasks/{task_id}")
async def task_get(request):
    task_id = request.match_info["task_id"]
    task = JOBS.get(task_id) or task_store.load_task(output_root(), task_id)
    if not task:
        return web.json_response({"ok": False, "error": "task 不存在"}, status=404)
    return web.json_response({"ok": True, "task": task})


@routes.post("/zeroexo/v1/tasks/{task_id}/cancel")
async def task_cancel(request):
    task_id = request.match_info["task_id"]
    job = JOBS.get(task_id) or task_store.load_task(output_root(), task_id)
    if not job:
        return web.json_response({"ok": False, "error": "task 不存在"}, status=404)
    job["cancelRequested"] = True
    if job.get("state") == "queued":
        job["state"] = "cancelled"
        _batch_mark_remaining(job, "cancelled")
        _save_job(job)
    elif job.get("currentJobId") and JOBS.get(str(job["currentJobId"])):
        child = JOBS[str(job["currentJobId"])]
        if child.get("promptId"):
            _interrupt_prompt(str(child["promptId"]))
    _save_job(job)
    return web.json_response({"ok": True, "task": job})


@routes.delete("/zeroexo/v1/tasks/{task_id}")
async def task_delete(request):
    """真删任务事实源（网页「清空已完成」调用）：终态任务删 JSON + 内存，刷新不再复活。"""
    task_id = request.match_info["task_id"]
    job = JOBS.get(task_id) or task_store.load_task(output_root(), task_id)
    if not job:
        return web.json_response({"ok": True, "deleted": False})
    if job.get("state") in ("queued", "running"):
        return web.json_response({"ok": False, "error": "任务进行中，请先取消再删除"}, status=409)
    JOBS.pop(task_id, None)
    deleted = task_store.delete_task(output_root(), task_id)
    return web.json_response({"ok": True, "deleted": deleted})


from .ref_video import (
    NODE_CLASS_MAPPINGS as _REF_CLASS,
    NODE_DISPLAY_NAME_MAPPINGS as _REF_NAME,
)

# ===== 导演桥接（原 ComfyUI_ZeroExoDirectorBridge，2026-11-07 合并进本插件）=====
# 完整导演包流程（多参考图 / 段间延续 / 引导预览 / last-prompt）作为本插件的一部分注册，
# 不再需要单独的桥接插件；/zeroexo/h3/* 路由在下面一并注册。
from .bridge.api_node import build_node_mappings as _build_bridge_mappings
from .bridge.routes import register_routes as _register_bridge_routes

_BRIDGE_CLASS, _BRIDGE_NAME = _build_bridge_mappings()

NODE_CLASS_MAPPINGS = {
    "ZeroExoGuideSave": ZeroExoGuideSave,
    "ZeroExoGuideLoad": ZeroExoGuideLoad,
    **_REF_CLASS,
    **_BRIDGE_CLASS,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "ZeroExoGuideSave": "ZeroExo 引导保存",
    "ZeroExoGuideLoad": "ZeroExo 引导读取",
    **_REF_NAME,
    **_BRIDGE_NAME,
}

WEB_DIRECTORY = "./web"

try:
    if not _register_bridge_routes():
        import logging
        logging.getLogger(__name__).warning("ZeroExoNodes: 导演桥接路由未注册（PromptServer 未就绪）")
except Exception as _bridge_exc:  # noqa: BLE001 - 桥接异常不得阻断插件加载
    import logging
    logging.getLogger(__name__).warning("ZeroExoNodes: 导演桥接路由加载失败: %s", _bridge_exc)
