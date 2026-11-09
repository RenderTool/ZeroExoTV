"""导出引导帧的可选档位（节点下拉 + HTTP 参数共用，单一来源）。

22 帧 = 引擎默认上下文（= 一段的锁定帧数）；5 极短、39/56 更长的衔接余量。
"""

GUIDE_FRAME_OPTIONS = [5, 22, 39, 56]


def snap_guide_frames(value) -> int:
    """把任意输入夹到最近的合法档位（避免 HTTP 调用方传 30 之类导致下拉校验失败）。"""
    try:
        n = int(value)
    except (TypeError, ValueError):
        return 22
    return min(GUIDE_FRAME_OPTIONS, key=lambda opt: abs(opt - n))
