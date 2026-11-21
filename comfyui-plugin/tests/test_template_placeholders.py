"""模板占位符覆盖守护（C-22）。

背景（真实 bug）：`templates/reference_video.json` 的 12 号节点有 `use_prev_guide`
占位符，但 `__init__.py` 的 VISIBLE_PARAMS / TEMPLATE_DEFAULTS 都没有这个键 →
`substitute()` 替换后留下字面量 `__zx:use_prev_guide__`，BOOLEAN 输入收到字符串。

本测试用 AST 解析源码（不 import 插件，避免拉起 torch/folder_paths），断言：
1. 模板里出现的每个 `__zx:<name>__` 都能在 TEMPLATE_DEFAULTS / *_VISIBLE_PARAMS 找到默认值
   （唯一豁免：运行期在代码里显式赋值的键，如 guide_path）；
2. `use_prev_guide` 必须在 TEMPLATE_DEFAULTS 内（C-22 回归点）；
3. 模板里不允许出现「长得像占位符但拼错」的残留写法。

运行：python comfyui-plugin/tests/test_template_placeholders.py
"""
from __future__ import annotations

import ast
import json
import pathlib
import re

_HERE = pathlib.Path(__file__).resolve()
_PLUGIN = _HERE.parents[1] / "ComfyUI_ZeroExoNodes"
_SRC = _PLUGIN / "__init__.py"
_TEMPLATES = _PLUGIN / "templates"

PLACEHOLDER = re.compile(r"__zx:(\w+)__")

# 运行期由代码显式赋值、因此不需要默认值的占位符（有则在 params 里出现）
RUNTIME_KEYS = {"guide_path"}


def _dict_keys(node: ast.AST) -> set[str]:
    if not isinstance(node, ast.Dict):
        return set()
    out: set[str] = set()
    for k in node.keys:
        if isinstance(k, ast.Constant) and isinstance(k.value, str):
            out.add(k.value)
    return out


def declared_param_keys() -> set[str]:
    """源码里所有「参数默认值」字典的键：TEMPLATE_DEFAULTS + 各 *_VISIBLE_PARAMS。"""
    tree = ast.parse(_SRC.read_text(encoding="utf-8"))
    keys: set[str] = set()
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        for target in node.targets:
            if not isinstance(target, ast.Name):
                continue
            name = target.id
            if name == "TEMPLATE_DEFAULTS" or name.endswith("VISIBLE_PARAMS"):
                keys |= _dict_keys(node.value)
    return keys


def template_placeholders() -> dict[str, set[str]]:
    """{模板文件: 占位符名集合}"""
    out: dict[str, set[str]] = {}
    for f in sorted(_TEMPLATES.glob("*.json")):
        text = f.read_text(encoding="utf-8")
        json.loads(text)  # 模板必须是合法 JSON
        out[f.name] = set(PLACEHOLDER.findall(text))
    return out


def test_every_placeholder_has_default():
    declared = declared_param_keys()
    allowed = declared | RUNTIME_KEYS
    missing_pairs: list[str] = []
    for name, names in template_placeholders().items():
        for p in sorted(names):
            if p not in allowed:
                missing_pairs.append(f"{name}: {p}")
    assert declared, "没解析到任何参数默认值字典：AST 规则失效，先修测试"
    assert not missing_pairs, (
        "这些占位符没有默认值，替换后会以字面量下发（BOOLEAN/INT 会直接校验失败）：\n  "
        + "\n  ".join(missing_pairs)
    )
    print(f"ok placeholder-coverage ({sum(len(v) for v in template_placeholders().values())} 处)")


def test_use_prev_guide_has_default():
    """C-22 回归：就是这个键漏了默认值才把字面量发进队列。"""
    declared = declared_param_keys()
    assert "use_prev_guide" in declared, "use_prev_guide 必须进 TEMPLATE_DEFAULTS（C-22）"
    assert "use_prev_guide" in template_placeholders()["reference_video.json"]
    print("ok use-prev-guide-default")


def test_no_misspelled_placeholder():
    """形如 __zx_xxx__ / __zx-xxx__ 的近似写法一律视为拼错（防止改名后静默失效）。"""
    bad: list[str] = []
    for f in sorted(_TEMPLATES.glob("*.json")):
        text = f.read_text(encoding="utf-8")
        for m in re.finditer(r"__zx[^:A-Za-z][^\"\\]*?__", text):
            bad.append(f"{f.name}: {m.group(0)}")
    assert not bad, "发现疑似拼错的占位符：\n  " + "\n  ".join(bad)
    print("ok placeholder-spelling")


if __name__ == "__main__":
    test_every_placeholder_has_default()
    test_use_prev_guide_has_default()
    test_no_misspelled_placeholder()
    print("ALL OK")
