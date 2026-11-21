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
    """当前底稿结构：25 号是官方 `Load LoRA (Model)`（C-23）。"""
    return {
        "45:1": {"class_type": "UNETLoader", "inputs": {"unet_name": "base.safetensors"}},
        "25": {
            "class_type": "LoadLoraModel",
            "inputs": {"model": ["45:1", 0]},
        },
        "12": {"class_type": "ZeroExoRefVideo", "inputs": {"model": ["25", 0], "prompt": "x"}},
        "save": {"class_type": "SaveVideo", "inputs": {"video": ["12", 0]}},
    }


def legacy_array_template():
    """C-12 老底稿：25 号是插件自定义数组节点（兼容路径必须还能跑）。"""
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


def test_official_rows_injected_in_order():
    """C-23：官方节点按顺序写扁平行键 loras.<i>.{lora_name,strength,enabled}。"""
    g = apply_lora_chain(
        array_template(),
        [
            {"name": "a.safetensors", "strength": 0.8},
            {"name": "b.safetensors", "strength": 0.3},
        ],
    )
    assert g["25"]["class_type"] == "LoadLoraModel"
    assert g["12"]["inputs"]["model"] == ["25", 0]
    inputs = g["25"]["inputs"]
    assert inputs["loras.0.lora_name"] == "a.safetensors"
    assert inputs["loras.0.strength"] == 0.8
    assert inputs["loras.0.enabled"] is True
    assert inputs["loras.1.lora_name"] == "b.safetensors"
    assert inputs["loras.1.strength"] == 0.3
    # 行的起点必须从 0 开始连续（官方按 index 解析，跳号会得到「不存在的行」）
    assert sorted(k for k in inputs if k.startswith("loras.")) == [
        "loras.0.enabled", "loras.0.lora_name", "loras.0.strength",
        "loras.1.enabled", "loras.1.lora_name", "loras.1.strength",
    ]
    assert "loras" not in inputs  # 不能同时留旧的整块字符串
    print("ok official-rows")


def test_official_rows_replaced_not_appended():
    """同一 graph 二次调用（批次分段复用）不许把上一次的行叠进去。"""
    g = array_template()
    apply_lora_chain(g, [{"name": "a.safetensors", "strength": 0.8}, {"name": "b.safetensors", "strength": 0.3}])
    apply_lora_chain(g, [{"name": "c.safetensors", "strength": 1.0}])
    inputs = g["25"]["inputs"]
    assert inputs["loras.0.lora_name"] == "c.safetensors"
    assert "loras.1.lora_name" not in inputs
    print("ok official-rows-replaced")


def test_official_empty_prunes_node_and_rewires():
    """官方节点 min=1 行 → 一条都没勾必须剪节点，下游改接它自己的 model 来源。"""
    g = apply_lora_chain(array_template(), [])
    assert "25" not in g
    assert g["12"]["inputs"]["model"] == ["45:1", 0]
    assert g["save"]["inputs"]["video"] == ["12", 0]
    print("ok official-empty-prune")


def test_legacy_array_node_still_written_in_order():
    g = apply_lora_chain(
        legacy_array_template(),
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
    print("ok legacy-array-order")


def test_legacy_array_node_empty_passthrough():
    g = apply_lora_chain(legacy_array_template(), [])
    assert g["25"]["inputs"]["loras"] == ""
    assert g["12"]["inputs"]["model"] == ["25", 0]
    assert parse_loras(g["25"]["inputs"]["loras"]) == []
    print("ok legacy-array-empty")


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


def test_template_uses_official_node_without_rows():
    """C-23：底稿 25 号必须是官方 LoadLoraModel，且不带任何行（行在提交时注入）。"""
    import json
    import pathlib

    tpl = pathlib.Path(__file__).resolve().parents[1] / "ComfyUI_ZeroExoNodes" / "templates" / "reference_video.json"
    g = json.loads(tpl.read_text(encoding="utf-8"))
    assert g["25"]["class_type"] == "LoadLoraModel"
    assert not [k for k in g["25"]["inputs"] if k.startswith("loras")]
    assert g["12"]["inputs"]["model"] == ["25", 0]
    print("ok template-official-node")


def _fake_comfy_module(returns):
    """注入假 comfy.utils，模拟各版本 load_torch_file 的返回形态。"""
    import types

    calls = []

    def load_torch_file(path, safe_load=False, return_metadata=False):
        calls.append({"path": path, "return_metadata": return_metadata})
        if return_metadata is True and "with_metadata" not in returns:
            raise TypeError("load_torch_file() got an unexpected keyword argument 'return_metadata'")
        return returns["with_metadata" if return_metadata else "plain"]

    utils = types.SimpleNamespace(load_torch_file=load_torch_file)
    comfy = types.SimpleNamespace(utils=utils)
    sys.modules["comfy"] = comfy
    sys.modules["comfy.utils"] = utils
    return calls


def test_weights_dict_return_does_not_unpack():
    """C-19 根因回归：默认返回就是 dict，不能写 a, b = ...（会 ValueError）。"""
    import tempfile

    from lora_chain import _load_weights

    with tempfile.NamedTemporaryFile(suffix=".safetensors", delete=False) as fh:
        fh.write(b"x")
        path = fh.name
    sd = {"w1": 1, "w2": 2, "w3": 3, "w4": 4}
    _fake_comfy_module({"plain": sd, "with_metadata": (sd, {"k": "v"})})
    try:
        assert _load_weights(path) is sd
        # 老版本没有 return_metadata 形参 → TypeError 回退也要成功
        _fake_comfy_module({"plain": sd})
        assert _load_weights(path) is sd
    finally:
        os.unlink(path)
    print("ok unwrap-dict")


def test_weights_tuple_return_both_arity():
    """新版回 (sd, metadata)，个别分支更多元组：都取第 0 项。"""
    from lora_chain import _unwrap_torch_file

    sd = {"w1": 1}
    assert _unwrap_torch_file((sd, {"m": 1})) is sd
    assert _unwrap_torch_file((sd, {"m": 1}, {"extra": 1})) is sd
    assert _unwrap_torch_file([sd]) is sd
    try:
        _unwrap_torch_file("not-a-dict")
    except RuntimeError as exc:
        assert "不是字典" in str(exc)
    else:
        raise AssertionError("非字典形态必须抛 RuntimeError，不能静默")
    print("ok unwrap-tuple")


if __name__ == "__main__":
    test_official_rows_injected_in_order()
    test_official_rows_replaced_not_appended()
    test_official_empty_prunes_node_and_rewires()
    test_legacy_array_node_still_written_in_order()
    test_legacy_array_node_empty_passthrough()
    test_legacy_template_still_chains()
    test_legacy_single_lora_keeps_graph()
    test_parser_accepts_json_and_ignores_comments()
    test_format_text_roundtrip()
    test_template_uses_official_node_without_rows()
    test_weights_dict_return_does_not_unpack()
    test_weights_tuple_return_both_arity()
    print("ALL OK")
