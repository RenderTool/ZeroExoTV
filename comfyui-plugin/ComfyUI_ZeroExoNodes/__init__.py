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
import hashlib
import json
import os
import re
import time
import uuid
from typing import Any

from .lib.guide_options import GUIDE_FRAME_OPTIONS, snap_guide_frames
from .engine.graph_ops import prune_model_chain

import aiohttp
import folder_paths
import torch
from aiohttp import web
from server import PromptServer

PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_DIR = os.path.join(PLUGIN_DIR, "templates")
JOBS: dict[str, dict[str, Any]] = {}
# 「上一段生成的引导」服务端登记表（2026-11-07）：key = project|episode。
# use_prev_guide=true 且没有显式 guide_id 时取它；显式 guide 优先且强制关闭 use_prev_guide。
LAST_GUIDE: dict[str, str] = {}
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
    "use_prev_guide": {"type": "boolean", "default": False},
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
    "sampler": {"type": "string", "default": "res_multistep"},
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
    "sampler": "res_multistep",
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
        return list(folder_paths.get_filename_list(folder))
    except Exception:
        return []


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


def apply_model_overrides(template: dict[str, Any], models: Any) -> dict[str, Any]:
    """把前端选择的模型文件名写进模板；加载器节点不变，只换权重文件。"""
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
            inputs["unet_name"] = _pick_model(
                "diffusion_models",
                unet or str(inputs.get("unet_name") or ""),
                ("minimax_h3", "h3", "qwen_image", "qwen"),
            )
        elif cls == "CLIPLoader":
            current_clip = str(inputs.get("clip_name") or "")
            image_clip = ("qwen3.5" in current_clip.lower() or "qwen_image" in current_clip.lower())
            inputs["clip_name"] = _pick_model(
                "text_encoders",
                clip or current_clip,
                ("qwen3.5", "qwen_image", "qwen3vl_32b") if image_clip else ("minimax_h3", "qwen3vl_32b", "qwen3vl_8b"),
            )
            if clip_type:
                inputs["type"] = clip_type
        elif cls == "VAELoader":
            current = str(inputs.get("vae_name") or "").lower()
            if "audio" in current:
                inputs["vae_name"] = _pick_model(
                    "vae", audio_vae or str(inputs.get("vae_name") or ""), ("audio", "minimax_h3")
                )
            else:
                inputs["vae_name"] = _pick_model(
                    "vae",
                    video_vae or str(inputs.get("vae_name") or ""),
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
        with open(path, "rb") as f:
            digest = hashlib.sha256(f.read()).hexdigest()
    except Exception:  # noqa: BLE001 - 元数据缺失不影响产物回传
        return None
    return {
        "id": os.path.splitext(os.path.basename(path))[0],
        "path": path,
        "frames": frames,
        "sha256": digest,
    }


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
        # 记录本 project/episode 的最新引导：use_prev_guide=true 的下一段取它（2026-11-07）
        if job.get("guide") and job["guide"].get("path"):
            LAST_GUIDE[_guide_key(job.get("params") or {})] = job["guide"]["path"]
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

PLUGIN_VERSION = "0.1.0"


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


def _guide_key(params: dict[str, Any]) -> str:
    return f"{params.get('project') or ''}|{params.get('episode') or ''}"


def guides_dir() -> str:
    return ensure_dir(os.path.join(output_root(), "guides"))


def resolve_guide_input(params: dict[str, Any]) -> tuple[str, str]:
    """解析本段要使用的输入引导（2026-11-07 需求 6/7）。

    - 显式 `guide_id`（片段引导槽）：只认插件自己生成的 gd_xxx 文件，命中即为本段引导，
      同时强制 `use_prev_guide=false`（显式引导不得被上一段覆盖）；
    - 否则 `use_prev_guide=true` → 取同 project/episode 上一段成功作业的 guide；
    - 都没有 → 空路径（本段不使用引导）。
    返回 (绝对路径, 来源 explicit|prev|none)。
    """
    explicit = str(params.get("guide_id") or "").strip()
    if explicit:
        if not GUIDE_ID_PATTERN.match(explicit):
            raise ValueError(f"guide_id 非法（只接受 gd_ 前缀）: {explicit}")
        path = os.path.join(guides_dir(), f"{explicit}.safetensors")
        if not os.path.isfile(path):
            raise FileNotFoundError(f"引导槽文件不存在: {explicit}")
        params["use_prev_guide"] = False
        return path, "explicit"
    if _truthy(params.get("use_prev_guide")):
        prev = LAST_GUIDE.get(_guide_key(params)) or ""
        if prev and os.path.isfile(prev):
            return prev, "prev"
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


@routes.post("/zeroexo/v1/jobs")
async def submit_job(request):
    body = await request.json()
    kind = body.get("kind") or "reference_video"
    visible = (
        IMAGE_VISIBLE_PARAMS if kind == "qwen_image_edit"
        else KREA2_VISIBLE_PARAMS if kind == "krea2_t2i"
        else MOSS_VISIBLE_PARAMS if kind == "moss_image_t2i"
        else VISIBLE_PARAMS
    )
    params: dict[str, Any] = {name: spec.get("default") for name, spec in visible.items()}
    params.update(TEMPLATE_DEFAULTS)
    params.update({k: v for k, v in (body.get("params") or {}).items() if v is not None})
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
    if kind == "reference_video":
        # 输入引导（片段引导槽 / 上一段引导）在此解析：显式 guide_id 优先并覆盖 use_prev_guide
        try:
            guide_in_path, guide_source = resolve_guide_input(params)
        except FileNotFoundError as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=404)
        except ValueError as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=400)
        params["guide_in_path"] = guide_in_path
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
    template = apply_model_overrides(template, body.get("models"))
    if kind == "reference_video":
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
        "jobId": job_id, "promptId": None, "kind": kind, "state": "queued",
        "params": params, "outputs": [], "guide": None, "guidePath": guide_path or None,
        # 输入引导来源（explicit=片段引导槽 / prev=上一段 / none）；前端可据此提示
        "guideSource": guide_source, "guideInPath": guide_in_path, "error": None,
    }
    JOBS[job_id] = job
    # 2026-11-07：先落盘再提交，队列校验失败时也能查本次完整 prompt
    _save_last_prompt(job_id, "", template, params)
    server = PromptServer.instance
    try:
        await server.send_json("zeroexo.v1.job", {"jobId": job_id, "state": "queued"})
        url = f"http://127.0.0.1:{server.port}/prompt"
        payload: dict[str, Any] = {"prompt": template}
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
    refresh_job(job)
    return web.json_response({"ok": True, **job})


@routes.post("/zeroexo/v1/jobs/{job_id}/cancel")
async def cancel_job(request):
    job = JOBS.get(request.match_info["job_id"])
    if not job:
        return web.json_response({"ok": False, "error": "job 不存在"}, status=404)
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
