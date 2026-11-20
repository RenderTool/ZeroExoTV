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


def apply_lora_chain(template: dict[str, Any], loras: list[dict[str, Any]]) -> dict[str, Any]:
    """把模板里「单个 LoRA 节点」改造成按顺序串联的 LoRA 链。

    ComfyUI 的 LoRA 是 MODEL 的串联 patch：每个 LoraLoaderModelOnly 吃上一个的 MODEL、
    按 strength_model 加权，所以多个 LoRA = 一串节点，顺序即用户排列顺序。

    - loras 为空 → 原样返回（不该发生，调用方会兜底成默认 LoRA）
    - 1 条 → 直接改原节点的两个输入，图结构不变（与今天完全一致）
    - N 条 → 原节点被 N 个新节点替换：链首吃原节点原来的 model 输入源，
      链尾接回所有原本消费该节点的下游（通常是 ZeroExoRefVideo）
    """
    anchor_id = _LORA_NODE_ID if isinstance(template.get(_LORA_NODE_ID), dict) else None
    if anchor_id is None:
        anchor_id = next(
            (nid for nid, node in template.items()
             if isinstance(node, dict) and node.get("class_type") == _LORA_CLASS),
            None,
        )
    if anchor_id is None or not loras:
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
