"""作业图裁剪（纯度：只处理 dict，不 import torch / comfy）。
为什么需要：`reference_video` 模板里「低显存链 / 原模型链」是用 ComfySwitchNode 二选一，
但 ComfyUI 只执行输出节点的**祖先**——switch 的两个输入都是祖先，于是不管开关选哪边，
两条模型链（多一次 UNETLoader 加载 + MiniMaxLowVRAMAttention / BlockSparseAttention）
都会被拉起来执行。高显存机器上就会看到「明明选了高性能，还在跑低显存链路」。
提交前按开关把用不到的一支从图里删掉、把下游直接接到生效的那一支，才是真的只跑一条。
"""

from __future__ import annotations

from typing import Any

# reference_video 模板里的固定节点 id（模板本身就是固定结构）
_SWITCH_ID = "45:66"
_NORMAL_OUT = ["45:1", 0]
_LOW_OUT = ["45:61", 0]
_LOW_CHAIN = ("45:58", "45:59", "45:60", "45:61")

# 模板里的单 LoRA 节点 id（2026-11-20：要支持多 LoRA 串联）
_LORA_NODE_ID = "25"
_LORA_CLASS = "LoraLoaderModelOnly"
# 2026-11-21（C-12）：模板底稿曾用「数组节点」——插件自定义 Node，内部按数组顺序串联。
_LORA_CHAIN_CLASS = "ZeroExoLoraChain"
# 2026-11-21（C-23）：改用 ComfyUI 官方节点 `Load LoRA (Model)`（class_type LoadLoraModel）。
# 它的 `loras` 是 COMFY_DYNAMICGROUP_V3 动态行组，API 里是扁平键 `loras.<i>.<field>`，
# 每行 lora_name / strength / enabled，min 1、max 20 行 → 空列表必须剪节点（不能发 0 行）。
_OFFICIAL_LORA_CLASS = "LoadLoraModel"
_OFFICIAL_ROW_PREFIX = "loras."


def _bypass_node(template: dict[str, Any], node_id: str) -> dict[str, Any]:
    """把一个 MODEL 直通节点从图里剪掉：下游输入改接它自己的 model 来源，再删节点。"""
    node = template.get(node_id)
    if not isinstance(node, dict):
        return template
    source = (node.get("inputs") or {}).get("model")
    if not (isinstance(source, list) and len(source) == 2):
        raise RuntimeError(f"LoRA 节点 {node_id} 没有合法的 model 输入，无法剪除（会变成 0 行非法图）")
    for nid, other in list(template.items()):
        if nid == node_id or not isinstance(other, dict):
            continue
        inputs = other.get("inputs")
        if not isinstance(inputs, dict):
            continue
        for key, value in list(inputs.items()):
            if isinstance(value, list) and len(value) == 2 and value[0] == node_id:
                inputs[key] = list(source)
    template.pop(node_id, None)
    return template


def _fill_official_rows(inputs: dict[str, Any], loras: list[dict[str, Any]]) -> None:
    """按顺序写 `loras.<i>.lora_name / strength / enabled`（先清旧行，避免残留）。"""
    for key in [k for k in inputs if k.startswith(_OFFICIAL_ROW_PREFIX) or k == "loras"]:
        inputs.pop(key, None)
    for i, lora in enumerate(loras):
        inputs[f"loras.{i}.lora_name"] = str(lora["name"])
        inputs[f"loras.{i}.strength"] = float(lora["strength"])
        # 这里只会收到用户勾选的行；官方节点的 enabled 仍显式写 true，避免默认值被别的分支改掉
        inputs[f"loras.{i}.enabled"] = True


def format_lora_text(loras: list[dict[str, Any]]) -> str:
    """把数组写成 ZeroExoLoraChain 的 widget 文本（顺序即串联顺序）。"""
    lines = ["# 每行一条：文件名 | 强度（0–2），顺序 = 串联顺序"]
    for lora in loras:
        lines.append(f"{lora['name']} | {lora['strength']}")
    return "\n".join(lines)


def apply_lora_chain(template: dict[str, Any], loras: list[dict[str, Any]]) -> dict[str, Any]:
    """把模板里的 LoRA 节点按数组填好。

    优先（C-23）：模板里若有官方 `LoadLoraModel`，按顺序注入动态行键；
    **一条都没勾时把该节点剪掉、下游接回它的 model 来源**（官方 min=1 行，0 行会被校验拒绝）。

    兼容：老模板里的 `ZeroExoLoraChain`（只写文本 widget）；更老的 `LoraLoaderModelOnly`
    走 0.1.3 的「造链」做法——ComfyUI 的 LoRA 是 MODEL 的串联 patch，顺序即用户排列顺序。

    - 官方节点 + N 条 → 只写行键，图结构不变
    - 官方节点 + 0 条 → 剪节点，下游直连 UNETLoader 侧
    - `ZeroExoLoraChain` + N 条 / 0 条 → 写文本（空文本原样透传 MODEL）
    - 老模板 1 条 → 直接改原节点的两个输入，图结构不变
    - 老模板 N 条 → 原节点被 N 个新节点替换：链首吃原节点原来的 model 输入源，
      链尾接回所有原本消费该节点的下游（通常是 ZeroExoRefVideo）
    """
    official_id = next(
        (nid for nid, node in template.items()
         if isinstance(node, dict) and node.get("class_type") == _OFFICIAL_LORA_CLASS),
        None,
    )
    if official_id is not None:
        if loras:
            _fill_official_rows(template[official_id].setdefault("inputs", {}), loras)
            return template
        return _bypass_node(template, official_id)
    chain_id = next(
        (nid for nid, node in template.items()
         if isinstance(node, dict) and node.get("class_type") == _LORA_CHAIN_CLASS),
        None,
    )
    if chain_id is not None:
        inputs = template[chain_id].setdefault("inputs", {})
        inputs["loras"] = format_lora_text(loras) if loras else ""
        return template
    if not loras:
        return template

    anchor_id = _LORA_NODE_ID if isinstance(template.get(_LORA_NODE_ID), dict) else None
    if anchor_id is None:
        anchor_id = next(
            (nid for nid, node in template.items()
             if isinstance(node, dict) and node.get("class_type") == _LORA_CLASS),
            None,
        )
    if anchor_id is None:
        return template
    anchor = template[anchor_id]
    inputs = anchor.setdefault("inputs", {})
    if len(loras) == 1:
        inputs["lora_name"] = loras[0]["name"]
        inputs["strength_model"] = loras[0]["strength"]
        return template

    source = inputs.get("model")
    if not isinstance(source, list) or len(source) != 2:
        return template  # 模板结构异常：不动，交给执行期报错

    chain_ids: list[str] = []
    prev = list(source)
    for i, lora in enumerate(loras):
        node_id = f"zx_lora_{i}"
        template[node_id] = {
            "inputs": {
                "lora_name": lora["name"],
                "strength_model": lora["strength"],
                "model": prev,
            },
            "class_type": _LORA_CLASS,
            "_meta": {"title": f"LoRA {i + 1}"},
        }
        chain_ids.append(node_id)
        prev = [node_id, 0]

    last = [chain_ids[-1], 0]
    for node in template.values():
        node_inputs = node.get("inputs") if isinstance(node, dict) else None
        if not isinstance(node_inputs, dict):
            continue
        for key, value in list(node_inputs.items()):
            if isinstance(value, list) and len(value) == 2 and value[0] == anchor_id:
                node_inputs[key] = list(last)
    template.pop(anchor_id, None)
    return template


def prune_model_chain(template: dict[str, Any], use_low_vram: bool) -> dict[str, Any]:
    """把 ComfySwitchNode 收敛成单分支：删除没被选中的那条模型链。"""
    switch = template.get(_SWITCH_ID)
    if not isinstance(switch, dict):
        return template  # 模板没有这条开关（别的 kind）：原样返回
    target = list(_LOW_OUT) if use_low_vram else list(_NORMAL_OUT)
    for node in template.values():
        inputs = node.get("inputs") if isinstance(node, dict) else None
        if not isinstance(inputs, dict):
            continue
        for key, value in list(inputs.items()):
            if isinstance(value, list) and len(value) == 2 and value[0] == _SWITCH_ID:
                inputs[key] = list(target)
    template.pop(_SWITCH_ID, None)
    if not use_low_vram:
        for node_id in _LOW_CHAIN:
            template.pop(node_id, None)
    return template
