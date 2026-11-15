"""当前作业的前端 /ws clientId。

ComfyUI 的 PromptServer.instance.client_id 是全局“最近一次请求”的 client，
插件通过内部 HTTP 提交 prompt 时它并不是前端 clientId，导致预览/进度被发给错的连接。
插件在提交 prompt 前set，引擎发送事件时读取。
"""
from __future__ import annotations

_CURRENT: str | None = None
_CURRENT_TASK: dict | None = None


def set_client_id(client_id: str | None) -> None:
    global _CURRENT
    _CURRENT = str(client_id).strip() if client_id else None


def get_client_id() -> str | None:
    return _CURRENT


def set_current_task(task_id: str | None, segment_index: int | None = None) -> None:
    """当前正在执行的插件任务/段：采样预览帧要落盘回这个任务。"""
    global _CURRENT_TASK
    _CURRENT_TASK = (
        {"taskId": str(task_id), "segmentIndex": int(segment_index or 1)}
        if task_id else None
    )


def get_current_task() -> dict | None:
    return _CURRENT_TASK
