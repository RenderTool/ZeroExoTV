"""多 LoRA 串联图变换的纯 Python 校验（不依赖 ComfyUI/torch）。

运行：python comfyui-plugin/tests/test_lora_chain.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "ComfyUI_ZeroExoNodes"))
from engine.graph_ops import apply_lora_chain  # noqa: E402


def base_template():
    return {
        "45:1": {"class_type": "UNETLoader", "inputs": {"unet_name": "base.safetensors"}},
        "25": {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {"lora_name": "old.safetensors", "strength_model": 1.0, "model": ["45:1", 0]},
        },
        "12": {"class_type": "ZeroExoRefVideo", "inputs": {"model": ["25", 0], "prompt": "x"}},
        "save": {"class_type": "SaveVideo", "inputs": {"video": ["12", 0]}},
    }


def test_single_lora_keeps_graph():
    g = apply_lora_chain(base_template(), [{"name": "a.safetensors", "strength": 0.7}])
    assert "25" in g and g["25"]["inputs"]["lora_name"] == "a.safetensors"
    assert g["25"]["inputs"]["strength_model"] == 0.7
    assert g["12"]["inputs"]["model"] == ["25", 0]
    assert not any(k.startswith("zx_lora_") for k in g)
    print("ok single")


def test_multi_lora_chains_in_order():
    g = apply_lora_chain(
        base_template(),
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
    assert [g[f"zx_lora_{i}"]["inputs"]["lora_name"] for i in range(3)] == [
        "a.safetensors", "b.safetensors", "c.safetensors"
    ]
    assert [g[f"zx_lora_{i}"]["inputs"]["strength_model"] for i in range(3)] == [0.8, 0.5, 1.2]
    assert g["12"]["inputs"]["model"] == ["zx_lora_2", 0]
    print("ok multi")


def test_empty_returns_unchanged():
    g = apply_lora_chain(base_template(), [])
    assert g["12"]["inputs"]["model"] == ["25", 0]
    print("ok empty")


if __name__ == "__main__":
    test_single_lora_keeps_graph()
    test_multi_lora_chains_in_order()
    test_empty_returns_unchanged()
    print("ALL OK")
