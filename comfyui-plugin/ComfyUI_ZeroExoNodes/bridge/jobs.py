"""Job registry + segment-level tracking for bridge runs.

How tracking works without touching upstream code:
  - The bridge mints jobId == ComfyUI prompt_id, so /ws `status`/`executing`/
    `executed` and /history all key off the same id (server.py:1183-1196
    accepts a client-supplied UUID prompt_id).
  - ComfyUI executes one prompt at a time. Upstream writes each finished
    segment to output/minimax_seg_export/<YYYYMMDD_HHMMSS>/seg_XXXX.mp4
    (segment_mp4_export.py:33-66). The tracker binds the newest run dir
    created after job start and watches seg files appear.
  - A segment is reported done when its seg_XXXX.mp4 size is stable across
    two polls, then copied to output/zeroexo/<projectId>/<episode>/.
  - Upstream already broadcasts per-phase progress as `minimax_director_progress`
    (upstream director/progress.py:100) — frontends can subscribe to that for
    live sampling bars; the bridge adds job/segment lifecycle events.

Events pushed via PromptServer.send_sync (broadcast):
  zeroexo.h3.job     {jobId, promptId, projectId, episode, state, error?}
  zeroexo.h3.segment {jobId, segment:{index,total,state,startedAt,finishedAt,frames,outputPath}}
"""

from __future__ import annotations

import asyncio
import json
import re
import shutil
import urllib.parse
from pathlib import Path

import folder_paths
from server import PromptServer

from .common import bridge_output_root, log, now_ms, sanitize_part

SEG_FINAL_RE = re.compile(r"^seg_(\d{4})\.mp4$")
SEG_ANY_RE = re.compile(r"^seg_(\d{4})(?:_[A-Za-z0-9]+)?\.mp4$")
POLL_INTERVAL_SEC = 1.5
RUN_DIR_SKEW_SEC = 10


class JobStore:
    def __init__(self) -> None:
        self.jobs: dict[str, dict] = {}
        self._task: asyncio.Task | None = None
        self._file_sizes: dict[str, int] = {}

    # -- registration -----------------------------------------------------

    def submit(
        self,
        *,
        job_id: str,
        prompt_id: str,
        project_id: str,
        episode: str,
        pack_id: str,
        number,
        segment_frames: list[int],
        api_mode: bool = True,
        cache_dir: str | None = None,
    ) -> dict:
        job = {
            "jobId": job_id,
            "promptId": prompt_id,
            "projectId": project_id,
            "episode": episode,
            "packId": pack_id,
            "number": number,
            "apiMode": bool(api_mode),
            "state": "queued",
            "createdAt": now_ms(),
            "startedAt": None,
            "finishedAt": None,
            "error": None,
            "runDir": None,
            "cacheDir": cache_dir,
            "segments": [
                {
                    "index": i + 1,
                    "state": "pending",
                    "startedAt": None,
                    "finishedAt": None,
                    "frames": segment_frames[i] if i < len(segment_frames) else None,
                    "outputPath": None,
                }
                for i in range(len(segment_frames))
            ],
        }
        self.jobs[job_id] = job
        self._send("zeroexo.h3.job", self._job_event(job))
        self._ensure_tracker()
        return job

    def get(self, job_id: str) -> dict | None:
        return self.jobs.get(str(job_id or ""))

    def all(self) -> list[dict]:
        return sorted(self.jobs.values(), key=lambda j: j["createdAt"], reverse=True)

    # -- websocket events ---------------------------------------------------

    @staticmethod
    def _send(event: str, payload: dict) -> None:
        try:
            srv = PromptServer.instance
            if srv:
                srv.send_sync(event, payload)  # sid=None broadcasts
        except Exception as exc:
            log.debug("ZeroExo bridge send_sync skipped: %s", exc)

    @staticmethod
    def _job_event(job: dict) -> dict:
        return {
            "jobId": job["jobId"],
            "promptId": job["promptId"],
            "projectId": job["projectId"],
            "episode": job["episode"],
            "state": job["state"],
            "error": job["error"],
        }

    # -- tracker --------------------------------------------------------------

    def _ensure_tracker(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop())

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(POLL_INTERVAL_SEC)
            try:
                self._tick()
            except Exception as exc:
                log.warning("ZeroExo bridge tracker tick failed: %s", exc)

    def _tick(self) -> None:
        active = [j for j in self.jobs.values() if j["state"] in ("queued", "running")]
        if not active:
            return
        srv = PromptServer.instance
        pq = getattr(srv, "prompt_queue", None)
        # currently_running keys are queue numbers; values are queued items
        # whose [1] element is the prompt_id (execution.py:1313-1331).
        running_prompt_ids = set()
        for item in (getattr(pq, "currently_running", {}) or {}).values():
            try:
                running_prompt_ids.add(item[1])
            except (TypeError, IndexError):
                continue
        for job in active:
            try:
                self._tick_job(job, pq, running_prompt_ids)
            except Exception as exc:
                log.warning("ZeroExo bridge job %s tick failed: %s", job["jobId"], exc)

    def _tick_job(self, job: dict, pq, running_prompt_ids: set) -> None:
        prompt_id = job["promptId"]

        if job["state"] == "queued" and prompt_id in running_prompt_ids:
            job["state"] = "running"
            job["startedAt"] = now_ms()
            self._send("zeroexo.h3.job", self._job_event(job))

        if job["runDir"] is None and job["state"] == "running":
            job["runDir"] = self._discover_run_dir(job)

        if job["runDir"]:
            self._scan_segments(job)

        if pq is None:
            return
        hist = pq.get_history(prompt_id=prompt_id)
        entry = hist.get(prompt_id) if isinstance(hist, dict) else None
        if not entry:
            return
        status_str = str((entry.get("status") or {}).get("status_str") or "")
        if status_str == "success":
            self._final_sweep(job)
            self._write_manifest(job)
            job["state"] = "success"
        elif status_str == "error":
            job["error"] = self._extract_error(entry)
            job["state"] = "error"
        else:
            return
        job["finishedAt"] = now_ms()
        self._send("zeroexo.h3.job", self._job_event(job))

    # -- filesystem -----------------------------------------------------------

    def _discover_run_dir(self, job: dict) -> str | None:
        base = Path(folder_paths.get_output_directory()) / "minimax_seg_export"
        if not base.is_dir():
            return None
        earliest = job["createdAt"] / 1000 - RUN_DIR_SKEW_SEC
        candidates = []
        for d in base.iterdir():
            if not d.is_dir():
                continue
            try:
                if d.stat().st_mtime >= earliest:
                    candidates.append(d)
            except OSError:
                continue
        if not candidates:
            return None
        chosen = max(candidates, key=lambda d: d.stat().st_mtime)
        job["startedAt"] = job["startedAt"] or now_ms()
        if job["state"] == "queued":
            job["state"] = "running"
            self._send("zeroexo.h3.job", self._job_event(job))
        return str(chosen)

    def _dest_dir(self, job: dict) -> Path:
        return (
            bridge_output_root()
            / sanitize_part(job["projectId"], "project")
            / sanitize_part(job["episode"], "EP")
        )

    @staticmethod
    def _view_url(dest: Path) -> str:
        """Relative /view URL (server.py:599 serves any output file).

        Relative on purpose: the frontend knows the ComfyUI base URL and
        prepends it (single source of truth for host/port).
        """
        out_root = Path(folder_paths.get_output_directory())
        try:
            rel = dest.relative_to(out_root)
        except ValueError:
            subfolder, filename = "", dest.name
        else:
            *parts, filename = rel.parts
            subfolder = "/".join(parts)
        q = urllib.parse.urlencode(
            {"filename": filename, "subfolder": subfolder, "type": "output"}
        )
        return f"/view?{q}"

    def public(self, job: dict) -> dict:
        """Status payload with derived fields: currentSegment + progress."""
        segs = job.get("segments") or []
        done = [s for s in segs if s["state"] == "done"]
        current = None
        for s in segs:
            if s["state"] in ("writing", "pending") and s.get("startedAt"):
                current = s["index"]
                break
        if current is None:
            for s in segs:
                if s["state"] == "done" and s["index"] + 1 <= len(segs):
                    nxt = s["index"] + 1
                    if any(x["index"] == nxt and x["state"] != "done" for x in segs):
                        current = nxt
                        break
        return {
            **job,
            "currentSegment": current,
            "progress": {
                "done": len(done),
                "total": len(segs),
            },
        }

    def _scan_segments(self, job: dict, *, final: bool = False) -> None:
        run_dir = Path(job["runDir"])
        if not run_dir.is_dir():
            return
        for path in sorted(run_dir.glob("seg_*.mp4")):
            m = SEG_ANY_RE.match(path.name)
            if not m:
                continue
            num = int(m.group(1))  # 0-based: upstream writes seg_{seg.index:04d}
            # (segment_mp4_export.py segment_mp4_path uses seg.index, which is
            # the 0-based timeline_index — verified against a real run dir).
            if num < 0 or num >= len(job["segments"]):
                continue
            seg = job["segments"][num]
            idx = num + 1  # bridge segment index stays 1-based in events
            key = f"{job['jobId']}:{path}"
            try:
                size = path.stat().st_size
            except OSError:
                continue
            if seg["startedAt"] is None:
                seg["startedAt"] = int(path.stat().st_mtime * 1000)
                if seg["state"] == "pending":
                    seg["state"] = "writing"
            is_final_name = bool(SEG_FINAL_RE.match(path.name))
            stable = self._file_sizes.get(key) == size
            self._file_sizes[key] = size
            if not is_final_name or not (stable or final):
                continue
            if seg["state"] == "done":
                continue
            dest_dir = self._dest_dir(job)
            dest_dir.mkdir(parents=True, exist_ok=True)
            dest = dest_dir / path.name
            try:
                shutil.copy2(path, dest)
            except OSError as exc:
                log.warning("ZeroExo bridge copy failed %s -> %s: %s", path, dest, exc)
                continue
            seg["state"] = "done"
            seg["finishedAt"] = now_ms()
            seg["outputPath"] = str(dest)
            seg["downloadUrl"] = self._view_url(dest)
            self._send(
                "zeroexo.h3.segment",
                {
                    "jobId": job["jobId"],
                    "segment": {
                        "index": idx,
                        "total": len(job["segments"]),
                        "state": "done",
                        "startedAt": seg["startedAt"],
                        "finishedAt": seg["finishedAt"],
                        "frames": seg["frames"],
                        "outputPath": seg["outputPath"],
                        "downloadUrl": seg["downloadUrl"],
                    },
                },
            )

    def _final_sweep(self, job: dict) -> None:
        if job["runDir"]:
            self._scan_segments(job, final=True)

    def _write_manifest(self, job: dict) -> None:
        dest_dir = self._dest_dir(job)
        dest_dir.mkdir(parents=True, exist_ok=True)
        manifest = {
            "jobId": job["jobId"],
            "promptId": job["promptId"],
            "projectId": job["projectId"],
            "episode": job["episode"],
            "packId": job["packId"],
            "createdAt": job["createdAt"],
            "startedAt": job["startedAt"],
            "finishedAt": now_ms(),
            "segments": job["segments"],
        }
        try:
            (dest_dir / f"job_{job['jobId']}.json").write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        except OSError as exc:
            log.warning("ZeroExo bridge manifest write failed: %s", exc)

    @staticmethod
    def _extract_error(entry: dict) -> str:
        messages = (entry.get("status") or {}).get("messages") or []
        for msg in messages:
            if isinstance(msg, (list, tuple)) and len(msg) >= 2 and msg[0] == "execution_error":
                detail = msg[1] if isinstance(msg[1], dict) else {}
                return str(detail.get("exception_message") or detail or "execution_error")
        return "execution_error"


STORE = JobStore()
