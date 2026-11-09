"""Director-pack intake: accept a pack and hand it to the upstream importer.

We deliberately forward to the upstream route POST /minimax/director/import_pack
(ComfyUI_MiniMaxH3_Director/director/http_routes.py:675 ->
ComfyUI_MiniMaxH3_Director/director/pack.py:1136) so slot semantics
(PictureN/AudioN/VideoN, timeline assembly) stay defined by upstream alone.
Upstream copies media into input/minimax_director_packs/<packId>/ and returns
{timeline, widgets, packId, missing}; we persist that record for /run.
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
from pathlib import Path

from aiohttp import web, ClientSession, FormData

from .common import check_auth, log, json_error, now_ms, packs_root, server_base_url

UPSTREAM_IMPORT_ROUTE = "/minimax/director/import_pack"
FORWARD_TIMEOUT_SEC = 600  # packs can be large; import is disk-bound


def _pack_record_path(pack_id: str) -> Path:
    safe = "".join(c for c in str(pack_id or "") if c.isalnum() or c in "-_")[:64]
    return packs_root() / f"{safe or 'unknown'}.json"


def save_pack_record(record: dict) -> Path:
    path = _pack_record_path(record.get("packId"))
    path.write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")
    return path


def load_pack_record(pack_id: str) -> dict | None:
    path = _pack_record_path(pack_id)
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        log.warning("ZeroExo bridge: unreadable pack record %s: %s", path, exc)
        return None


def _segment_summary(timeline: dict) -> dict:
    segments = timeline.get("segments") if isinstance(timeline, dict) else None
    if not isinstance(segments, list):
        segments = []
    frames = []
    for seg in segments:
        if not isinstance(seg, dict):
            frames.append(0)
            continue
        try:
            frames.append(int(seg.get("frameCount") or seg.get("length") or 0))
        except (TypeError, ValueError):
            frames.append(0)
    return {
        "segmentCount": len(segments),
        "segmentFrames": frames,
        "totalFrames": int(timeline.get("totalFrames") or sum(frames) or 0)
        if isinstance(timeline, dict)
        else 0,
    }


async def _forward_import(*, zip_path: Path | None, json_ref: dict | None) -> tuple[int, dict | str]:
    url = server_base_url() + UPSTREAM_IMPORT_ROUTE
    timeout = None
    try:
        import aiohttp

        timeout = aiohttp.ClientTimeout(total=FORWARD_TIMEOUT_SEC)
    except Exception:
        pass
    async with ClientSession(timeout=timeout) as sess:
        if zip_path is not None:
            with open(zip_path, "rb") as fh:
                form = FormData()
                form.add_field(
                    "pack", fh, filename=zip_path.name, content_type="application/zip"
                )
                async with sess.post(url, data=form) as resp:
                    text = await resp.text()
                    return resp.status, _parse_maybe_json(text)
        else:
            async with sess.post(url, json=json_ref) as resp:
                text = await resp.text()
                return resp.status, _parse_maybe_json(text)


def _parse_maybe_json(text: str):
    try:
        return json.loads(text)
    except Exception:
        return text


async def handle_pack_upload(request) -> web.Response:
    """POST /zeroexo/h3/pack

    multipart/form-data: field `pack` = pack zip (.mmxpack.zip / .zip)
    application/json:      {"filename": "x.zip", "subfolder": "", "type": "input"}
                           (zip already inside ComfyUI input/)
    """
    auth = check_auth(request)
    if auth is not None:
        return auth
    ctype = request.content_type or ""
    tmp_path: Path | None = None
    try:
        if "multipart" in ctype:
            post = await request.post()
            upload = post.get("pack")
            if upload is None or not hasattr(upload, "file"):
                return json_error(400, "Missing multipart field 'pack' (zip).")
            fd, tmp_name = tempfile.mkstemp(prefix="zx_pack_", suffix=".zip")
            os.close(fd)
            tmp_path = Path(tmp_name)
            with open(tmp_path, "wb") as out:
                shutil.copyfileobj(upload.file, out)
            status, payload = await _forward_import(zip_path=tmp_path, json_ref=None)
        else:
            try:
                body = await request.json()
            except Exception as exc:
                return json_error(400, f"Invalid JSON: {exc}")
            filename = str(body.get("filename") or body.get("name") or "").strip()
            if not filename:
                return json_error(400, "Missing filename of a zip already in ComfyUI input/.")
            json_ref = {
                "filename": filename,
                "subfolder": str(body.get("subfolder") or ""),
                "type": str(body.get("type") or "input"),
            }
            status, payload = await _forward_import(zip_path=None, json_ref=json_ref)
    finally:
        if tmp_path is not None:
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass

    if status != 200 or not isinstance(payload, dict):
        return web.json_response(
            {"ok": False, "error": "upstream import_pack failed", "upstream": payload},
            status=502 if status == 200 else status,
        )

    timeline = payload.get("timeline") if isinstance(payload.get("timeline"), dict) else {}
    widgets = payload.get("widgets") if isinstance(payload.get("widgets"), dict) else {}
    summary = _segment_summary(timeline)
    record = {
        "packId": payload.get("packId"),
        "receivedAt": now_ms(),
        "taskType": widgets.get("task_type") or "",
        "widgets": widgets,
        "timeline": timeline,
        "missing": payload.get("missing") or [],
    }
    save_pack_record(record)
    return web.json_response(
        {
            "ok": True,
            "packId": record["packId"],
            "taskType": record["taskType"],
            "segmentCount": summary["segmentCount"],
            "totalFrames": summary["totalFrames"],
            "missing": record["missing"],
            "mediaDir": f"input/minimax_director_packs/{record['packId']}",
        }
    )
