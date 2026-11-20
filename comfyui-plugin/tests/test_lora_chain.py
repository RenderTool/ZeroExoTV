"""LoRA 数组节点 / 图变换的纯 Python 校验（不依赖 ComfyUI/torch）。

运行：python comfyui-plugin/tests/test_lora_chain.py
"""
import os
import sys

_PLUGIN_DIR = os.path.join(os.path.dirname(__file__), "..", "ComfyUI_ZeroExoNodes")
sys.path.insert(0, _PLUGIN_DIR)
from engine.graph_ops import apply_lora_chain, format_lora_text  # noqa: E402
from lora_chain import parse_loras  # noqa: E402


def array_template():
    """当前底稿结构：25 号是数组节点（C-12）。"""
    return {
        "45:1": {"class_type": "UNETLoader", "inputs": {"unet_name": "base.safetensors"}},
        "25": {
            "class_type": "ZeroExoLoraChain",
            "inputs": {"loras": "", "model": ["45:1", 0]},
        },
        "12": {"class_type": "ZeroExoRefVideo", "inputs": {"model": ["25", 0], "prompt": "x"}},
        "save": {"class_type": "SaveVideo", "inputs": {"video": ["12", 0]}},
    }


def legacy_template():
    """0.1.3 老底稿：25 号是单 LoRA 节点（兼容路径必须还能跑）。"""
    return {
        "45:1": {"class_type": "UNETLoader", "inputs": {"unet_name": "base.safetensors"}},
        "25": {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {"lora_name": "old.safetensors", "strength_model": 1.0, "model": ["45:1", 0]},
        },
        "12": {"class_type": "ZeroExoRefVideo", "inputs": {"model": ["25", 0], "prompt": "x"}},
        "save": {"class_type": "SaveVideo", "inputs": {"video": ["12", 0]}},
    }


def test_array_node_written_in_order():
    g = apply_lora_chain(
        array_template(),
        [
            {"name": "a.safetensors", "strength": 0.8},
            {"name": "b.safetensors", "strength": 0.5},
        ],
    )
    assert g["25"]["class_type"] == "ZeroExoLoraChain"
    assert g["12"]["inputs"]["model"] == ["25", 0]
    assert "zx_lora_0" not in g
    text = g["25"]["inputs"]["loras"]
    lines = [ln for ln in text.splitlines() if ln and not ln.startswith("#")]
    assert lines == ["a.safetensors | 0.8", "b.safetensors | 0.5"]
    assert parse_loras(text) == [
        {"name": "a.safetensors", "strength": 0.8},
        {"name": "b.safetensors", "strength": 0.5},
    ]
    print("ok array-order")


def test_array_node_empty_passthrough():
    g = apply_lora_chain(array_template(), [])
    assert g["25"]["inputs"]["loras"] == ""
    assert g["12"]["inputs"]["model"] == ["25", 0]
    assert parse_loras(g["25"]["inputs"]["loras"]) == []
    print("ok array-empty")


def test_legacy_template_still_chains():
    g = apply_lora_chain(
        legacy_template(),
        [
            {"name": "a.safetensors", "strength": 0.8},
            {"name": "b.safetensors", "strength": 0.5},
            {"name": "c.safetensors", "strength": 1.2},
        ],
    )
    assert "25" not in g
    assert g["zx_lora_0"]["inputs"]["model"] == ["45:1", 0]
    assert g["zx_lora_1"]["inputs"]["model"] == ["zx_lora_0", 0]
    assert g["zx_lora_2"]["inputs"]["model"] == ["zx_lora_1", 0]
    assert g["12"]["inputs"]["model"] == ["zx_lora_2", 0]
    print("ok legacy-chain")


def test_legacy_single_lora_keeps_graph():
    g = apply_lora_chain(legacy_template(), [{"name": "a.safetensors", "strength": 0.7}])
    assert g["25"]["inputs"]["lora_name"] == "a.safetensors"
    assert g["25"]["inputs"]["strength_model"] == 0.7
    print("ok legacy-single")


def test_parser_accepts_json_and_ignores_comments():
    rows = parse_loras('[{"name": "x.safetensors", "strength": 1.5}]')
    assert rows == [{"name": "x.safetensors", "strength": 1.5}]
    rows = parse_loras("# 注释\n\nx.safetensors\n")
    assert rows == [{"name": "x.safetensors", "strength": 1.0}]
    rows = parse_loras("  \n# 只有注释\n")
    assert rows == []
    assert parse_loras("x.safetensors | 9")[0]["strength"] == 2.0  # 上限 2.0
    print("ok parser")


def test_format_text_roundtrip():
    text = format_lora_text([{"name": "a.safetensors", "strength": 0.8}])
    assert parse_loras(text) == [{"name": "a.safetensors", "strength": 0.8}]
    print("ok format-roundtrip")


def test_template_default_has_no_lora():
    """2026-11-21 用户口径：LoRA 纯可选项，底稿默认必须是空（不勾=一条都不加载）。"""
    import json
    import pathlib

    tpl = pathlib.Path(__file__).resolve().parents[1] / "ComfyUI_ZeroExoNodes" / "templates" / "reference_video.json"
    g = json.loads(tpl.read_text(encoding="utf-8"))
    assert g["25"]["class_type"] == "ZeroExoLoraChain"
    assert g["25"]["inputs"]["loras"] == ""
    assert g["12"]["inputs"]["model"] == ["25", 0]
    print("ok template-default-empty")


if __name__ == "__main__":
    test_array_node_written_in_order()
    test_array_node_empty_passthrough()
    test_legacy_template_still_chains()
    test_legacy_single_lora_keeps_graph()
    test_parser_accepts_json_and_ignores_comments()
    test_format_text_roundtrip()
    test_template_default_has_no_lora()
    print("ALL OK")
