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
