"""插件侧持久任务表。

任务事实源放在 ComfyUI 插件自己的 output/zeroexo/tasks/ 下：
- 网页/MCP 关闭不影响插件继续执行；
- 每个状态变化原子写（temp + os.replace）；
- 插件重启后至少能恢复 queued 任务、保留已完成段，running 标 interrupted。
"""
from __future__ import annotations

import json
import os
import time
import uuid
from typing import Any

TASK_SCHEMA = 1


def tasks_dir(output_root: str) -> str:
    return os.path.join(output_root, "tasks")


def task_path(output_root: str, task_id: str) -> str:
    safe = "".join(ch for ch in str(task_id) if ch.isalnum() or ch in "-_")
    return os.path.join(tasks_dir(output_root), f"{safe}.json")


def new_task_id() -> str:
    return f"tsk_{int(time.time() * 1000):x}_{uuid.uuid4().hex[:6]}"


def atomic_write(path: str, data: Any) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.{uuid.uuid4().hex[:6]}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    # Windows 下目标被短暂占用时 replace 会 PermissionError，重试几次
    for attempt in range(6):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt >= 5:
                raise
            time.sleep(0.05 * (attempt + 1))


def save_task(output_root: str, task: dict[str, Any]) -> None:
    task_id = str(task.get("taskId") or task.get("jobId") or "")
    if not task_id:
        raise KeyError("taskId")
    task["taskId"] = task_id
    task["schemaVersion"] = TASK_SCHEMA
    task["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    atomic_write(task_path(output_root, task_id), task)


def load_task(output_root: str, task_id: str) -> dict[str, Any] | None:
    try:
        with open(task_path(output_root, task_id), "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def list_tasks(output_root: str, project_id: str | None = None) -> list[dict[str, Any]]:
    directory = tasks_dir(output_root)
    if not os.path.isdir(directory):
        return []
    out: list[dict[str, Any]] = []
    for name in os.listdir(directory):
        if not name.endswith(".json"):
            continue
        try:
            with open(os.path.join(directory, name), "r", encoding="utf-8") as fh:
                task = json.load(fh)
        except (OSError, ValueError):
            continue
        if not isinstance(task, dict) or not task.get("taskId"):
            continue
        if project_id and task.get("projectId") != project_id:
            continue
        out.append(task)
    out.sort(key=lambda t: str(t.get("createdAt") or ""), reverse=True)
    return out


def mark_interrupted(task: dict[str, Any]) -> None:
    """插件重启时：未完成段标 interrupted，已完成段原样保留。"""
    task["state"] = "interrupted"
    task["error"] = "插件重启，任务中断；已完成段保留"
    task["currentSegment"] = None
    for seg in task.get("segments") or []:
        if seg.get("state") not in ("success", "error", "cancelled", "interrupted"):
            seg["state"] = "interrupted"
