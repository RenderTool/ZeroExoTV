"""ZeroExo API-mode wrapper node around upstream MiniMaxH3Director.

Design notes (why a subclass, not an upstream patch):
  - Upstream files stay byte-identical. We import the upstream class and
    subclass it, adding one real widget input `api_mode` (BOOLEAN) so the
    toggle is part of the graph JSON and visible to /prompt validation.
  - The class_type is NEW ("MiniMaxH3DirectorZX"), so existing workflows and
    the original node are untouched (regression-free by construction).
  - api_mode ON  -> local timeline is meaningless: Python raises a clear
    Chinese error when timeline_data arrives empty, and the bridge JS locks
    + clears the widget. The only timeline source is ZeroExo via /run.
  - api_mode OFF -> execute() forwards verbatim to upstream; behavior is
    identical to the original node.

Upstream import strategy: normally ComfyUI loads custom nodes alphabetically
("...MiniMax..." < "...ZeroExo..."), so the upstream package is already in
sys.modules; we locate it via nodes.LOADED_MODULE_DIRS / __path__ matching.
Fallback: create a bare package object pointing at the upstream directory and
import only `nodes.director` (never the upstream top-level __init__, so its
route registration is never executed twice).
"""

from __future__ import annotations

import copy
import importlib
import importlib.machinery
import importlib.util
import os
import sys
from types import ModuleType

from .common import log

UPSTREAM_DIR_NAME = "ComfyUI_MiniMaxH3_Director"
ZX_CLASS_TYPE = "MiniMaxH3DirectorZX"
ZX_DISPLAY_NAME = "MiniMax H3 Director (ZeroExo API)"

API_MODE_EMPTY_TIMELINE_ERROR = (
    "API 模式已开启，但未收到 timeline_data：请通过 ZeroExo 接口"
    "（POST /zeroexo/h3/run）下发时间轴，或关闭 API 模式后手动编辑。"
)

_upstream_director_cls = None
_upstream_import_error: str | None = None


def _find_upstream_base() -> str | None:
    try:
        import nodes as comfy_nodes

        base = comfy_nodes.LOADED_MODULE_DIRS.get(UPSTREAM_DIR_NAME)
        if base and os.path.isdir(base):
            return base
    except Exception:
        pass
    # Fallback: sibling directory convention under custom_nodes/.
    here = os.path.dirname(os.path.abspath(__file__))
    candidate = os.path.join(os.path.dirname(os.path.dirname(here)), UPSTREAM_DIR_NAME)
    return candidate if os.path.isdir(candidate) else None


def _upstream_package_module(base: str) -> ModuleType:
    """Return the already-loaded upstream package, or a bare stub for it."""
    for mod in list(sys.modules.values()):
        path = getattr(mod, "__path__", None)
        if not path:
            continue
        try:
            if os.path.abspath(list(path)[0]) == os.path.abspath(base):
                return mod
        except (TypeError, IndexError, OSError):
            continue
    # Stub package: lets `....nodes.director` resolve relative imports without
    # ever executing the upstream top-level __init__.py.
    spec = importlib.machinery.ModuleSpec(UPSTREAM_DIR_NAME, loader=None, is_package=True)
    pkg = importlib.util.module_from_spec(spec)
    pkg.__path__ = [base]
    sys.modules[UPSTREAM_DIR_NAME] = pkg
    return pkg


def _load_upstream_director_class():
    global _upstream_director_cls, _upstream_import_error
    if _upstream_director_cls is not None:
        return _upstream_director_cls
    base = _find_upstream_base()
    if base is None:
        _upstream_import_error = f"upstream directory not found: {UPSTREAM_DIR_NAME}"
        log.warning("ZeroExo bridge: %s", _upstream_import_error)
        return None
    try:
        pkg = _upstream_package_module(base)
        module = importlib.import_module(f"{pkg.__name__}.nodes.director")
        _upstream_director_cls = module.MiniMaxH3Director
        log.info("ZeroExo bridge: upstream MiniMaxH3Director imported from %s", base)
        return _upstream_director_cls
    except Exception as exc:
        _upstream_import_error = f"{type(exc).__name__}: {exc}"
        log.warning("ZeroExo bridge: failed to import upstream director: %s", exc)
        return None


def _is_empty_timeline(value) -> bool:
    s = str(value or "").strip()
    return s in ("", "{}", "null", "None")


def build_node_mappings() -> tuple[dict, dict]:
    """Return (NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS) for the bridge."""
    upstream = _load_upstream_director_class()
    if upstream is None:
        return {}, {}

    input_types = copy.deepcopy(upstream.INPUT_TYPES())
    required = input_types.setdefault("required", {})
    # Real widget input: lands in graph JSON, validated by /prompt, and shows
    # up as a toggle in the frontend with zero JS needed for the switch itself.
    required["api_mode"] = (
        "BOOLEAN",
        {
            "default": False,
            "label_on": "API 模式（时间轴由 ZeroExo 下发）",
            "label_off": "手动编辑",
            "tooltip": "开启后本地时间轴清零并锁死，只接受 ZeroExo 接口下发的 timeline_data",
        },
    )

    class MiniMaxH3DirectorZX(upstream):  # type: ignore[misc]
        """API-executor variant of MiniMaxH3Director (upstream files untouched)."""

        @classmethod
        def INPUT_TYPES(cls):
            return copy.deepcopy(input_types)

        FUNCTION = "execute"
        CATEGORY = getattr(upstream, "CATEGORY", "MiniMaxH3")
        DESCRIPTION = (
            "MiniMaxH3Director 的 ZeroExo API 执行器形态。"
            "开启 api_mode 后本地时间轴清零锁死，timeline_data 只能由接口下发。"
        )
        RETURN_TYPES = upstream.RETURN_TYPES
        RETURN_NAMES = getattr(upstream, "RETURN_NAMES", None)
        OUTPUT_NODE = getattr(upstream, "OUTPUT_NODE", False)

        def execute(self, api_mode=False, **kwargs):
            if api_mode and _is_empty_timeline(kwargs.get("timeline_data")):
                raise ValueError(API_MODE_EMPTY_TIMELINE_ERROR)
            return super().execute(**kwargs)

    MiniMaxH3DirectorZX.__name__ = ZX_CLASS_TYPE
    return {ZX_CLASS_TYPE: MiniMaxH3DirectorZX}, {ZX_CLASS_TYPE: ZX_DISPLAY_NAME}
