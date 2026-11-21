"""ZeroExoLoraChain - 一个节点吃一份 LoRA 数组，内部按顺序串联。

为什么要有：ComfyUI 核心的 `LoraLoaderModelOnly` 一个实例只能挂一个 lora 文件 + 一个强度，
没有「数组节点」。而运行时删节点、造 `zx_lora_*` 链的做法在工作流界面上看不见，
用户打开模板永远只看到一个 LoRA 节点。这里用一个自定义节点把「数组」显式放在底稿里：

    MODEL → ZeroExoLoraChain(loras=[a|0.8, b|0.5]) → 采样器

`loras` 支持两种写法（顺序即串联顺序，`#` 开头为注释）：

    # 每行一条：文件名 | 强度（0–2）
    minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors | 1.0
    MysticXXX_MMH3-V1.safetensors | 0.6

或 JSON：

    [{"name": "...safetensors", "strength": 0.8}]

空数组 → 原样透传 model（不勾 LoRA 也不能断链）。
文件不在 `models/loras` 清单里 → RuntimeError（报缺失文件名 + 可用清单），不静默跳过。
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

MAX_STRENGTH = 2.0
# 进程内权重缓存：同 path+mtime 只读一次盘（多段批次会重复执行同一节点）
_LORA_CACHE: dict[tuple[str, float, int], Any] = {}
_CACHE_LIMIT = 8

_SEP = re.compile(r"\s*[|,\t]\s*")


def parse_loras(text: Any) -> list[dict[str, Any]]:
    """把 widget 文本解析成 [{name, strength}]。抽成纯函数，测试不打 torch。"""
    if isinstance(text, list):
        rows = text
    elif isinstance(text, str) and text.strip():
        raw = text.strip()
        if raw[0] in "[{":
            try:
                data = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise RuntimeError(f"ZeroExoLoraChain: loras 不是合法 JSON（{exc}）") from exc
            rows = data if isinstance(data, list) else [data]
        else:
            rows = []
            for line in raw.splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                parts = _SEP.split(line, maxsplit=1)
                name = parts[0].strip()
                strength = 1.0
                if len(parts) > 1 and parts[1].strip():
                    try:
                        strength = float(parts[1].strip())
                    except ValueError as exc:
                        raise RuntimeError(
                            f"ZeroExoLoraChain: 强度不是数字（{line!r}）"
                        ) from exc
                rows.append({"name": name, "strength": strength})
    else:
        return []

    out: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            raise RuntimeError(f"ZeroExoLoraChain: loras 条目必须是对象（{row!r}）")
        name = str(row.get("name") or row.get("lora_name") or "").strip()
        if not name:
            continue
        try:
            strength = float(row.get("strength", row.get("strength_model", 1.0)))
        except (TypeError, ValueError) as exc:
            raise RuntimeError(f"ZeroExoLoraChain: 强度不是数字（{row!r}）") from exc
        out.append({"name": name, "strength": max(0.0, min(MAX_STRENGTH, strength))})
    return out


def _unwrap_torch_file(loaded: Any) -> dict:
    """把 `load_torch_file` 的返回值统一成权重字典（C-19 崩溃根因）。

    ComfyUI 各版本返回形态不一致（本机 `comfy/utils.py`：
    `return (sd, metadata) if return_metadata else sd`）：
      - 默认 → 直接是 dict；
      - return_metadata=True → (sd, metadata)，个别分支可能更多元。
    这里一律归一到 dict，禁止再写 `a, b = load_torch_file(...)` 这种假设。
    """
    if isinstance(loaded, dict):
        return loaded
    if isinstance(loaded, (tuple, list)) and loaded:
        sd = loaded[0]
        if isinstance(sd, dict):
            return sd
    raise RuntimeError(
        "ZeroExoLoraChain: 读到的 LoRA 权重不是字典（type=%s）。"
        "该文件可能不是 LoRA，或 ComfyUI 版本返回形态未知。" % type(loaded).__name__
    )


def _load_weights(path: str) -> dict:
    """按版本兼容方式读权重：优先带 metadata，老版本退回归一化。"""
    import comfy.utils  # 只在 ComfyUI 进程里可用

    loader = comfy.utils.load_torch_file
    try:
        loaded = loader(path, safe_load=True, return_metadata=True)
    except TypeError:  # 老版本没有 return_metadata 形参
        loaded = loader(path, safe_load=True)
    return _unwrap_torch_file(loaded)


def _load_lora_file(path: str):
    """读权重字典：按 path+mtime+size 缓存，最多 8 份。"""
    st = os.stat(path)
    key = (os.path.normcase(path), float(st.st_mtime), int(st.st_size))
    cached = _LORA_CACHE.get(key)
    if cached is not None:
        return cached

    lora = _load_weights(path)
    if len(_LORA_CACHE) >= _CACHE_LIMIT:
        _LORA_CACHE.pop(next(iter(_LORA_CACHE)))
    _LORA_CACHE[key] = lora
    return lora


def apply_loras(model, rows: list[dict[str, Any]]):
    """按顺序把每条 LoRA pat 到 MODEL 上，返回新的 MODEL。"""
    if not rows:
        return model
    import comfy.sd
    import folder_paths

    available = list(folder_paths.get_filename_list("loras"))
    missing = [row["name"] for row in rows if row["name"] not in available]
    if missing:
        shown = "\n".join(f"  - {name}" for name in available[:20]) or "  （models/loras 为空）"
        raise RuntimeError(
            "ZeroExoLoraChain: 以下 LoRA 在本机 models/loras 里找不到：\n"
            + "\n".join(f"  - {name}" for name in missing)
            + f"\n当前可用（前 20 条）：\n{shown}"
        )

    for row in rows:
        path = folder_paths.get_full_path_or_raise("loras", row["name"])
        lora = _load_lora_file(path)
        patched = comfy.sd.load_lora_for_models(model, None, lora, row["strength"], 0)
        # 同样不做解包假设：正常回 (model, clip)，异常形态就取第一项
        model = patched[0] if isinstance(patched, (tuple, list)) else patched
    return model


class ZeroExoLoraChain:
    """把多条 LoRA 按数组顺序串联到 MODEL（一个节点，内部循环加载）。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "loras": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "# 每行一条：文件名 | 强度（0–2），顺序 = 串联顺序\n",
                    },
                ),
            }
        }

    RETURN_TYPES = ("MODEL",)
    RETURN_NAMES = ("model",)
    FUNCTION = "apply"
    CATEGORY = "ZeroExo"
    DESCRIPTION = "按 loras 数组顺序串联多个 LoRA；空数组原样透传 MODEL。"

    def apply(self, model, loras):
        rows = parse_loras(loras)
        return (apply_loras(model, rows),)


NODE_CLASS_MAPPINGS = {"ZeroExoLoraChain": ZeroExoLoraChain}
NODE_DISPLAY_NAME_MAPPINGS = {"ZeroExoLoraChain": "ZeroExo LoRA 数组串联"}
