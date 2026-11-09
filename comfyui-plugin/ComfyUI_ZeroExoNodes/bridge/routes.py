"""HTTP routes for the ZeroExo Director Bridge.

Route table (all JSON unless noted):
  GET  /zeroexo/h3/health   -> {ok, version, queue, upstream}
  GET  /zeroexo/h3/models   -> available unet/vae/clip files + clip types
  POST /zeroexo/h3/pack     -> upload pack (multipart `pack` zip, or JSON ref)
  POST /zeroexo/h3/run      -> {packId, projectId, episode, models, overrides}
  GET  /zeroexo/h3/status?jobId= -> job + segment states + downloadUrl/cacheDir
  GET  /zeroexo/h3/guidance?jobId=&segment=N[&frames=] -> prev-segment tail WebP
  GET  /zeroexo/h3/jobs     -> all jobs (recent first)
  POST /zeroexo/h3/cancel   -> {jobId} interrupt running / dequeue pending
"""

from __future__ import annotations

import json as _json
import time
import uuid
from pathlib import Path

import folder_paths
from aiohttp import web, ClientSession
from server import PromptServer

from .common import (
    BRIDGE_VERSION,
    bridge_output_root,
    check_auth,
    json_error,
    log,
    now_ms,
    sanitize_part,
    server_base_url,
)
from .cors import apply_cors, preflight_response, with_cors
from .graph_build import build_graph, prepare_timeline
from .jobs import STORE
from .pack_io import handle_pack_upload, load_pack_record

UPSTREAM_IMPORT_ROUTE = "/minimax/director/import_pack"
PROMPT_TIMEOUT_SEC = 120

# 2026-11-05 「具体调用的是哪个工作流」：桥接没有外部工作流模板文件，
# 节点图由 graph_build.build_graph() 在代码里组装（API 格式）。
GRAPH_TEMPLATE_FILE = str(Path(__file__).with_name("graph_build.py").resolve())


def _last_prompt_path(job_id: str) -> Path:
    safe = sanitize_part(job_id, "unknown")
    return bridge_output_root() / f"last_prompt_{safe}.json"


def _node_summary(graph: dict) -> list[dict]:
    """节点 id → class_type 清单（供接口/前端一眼看全图）。"""
    out: list[dict] = []
    for node_id, node in (graph or {}).items():
        if isinstance(node, dict):
            out.append({"id": str(node_id), "classType": str(node.get("class_type") or "")})
    return out


def _save_last_prompt(job_id: str, prompt_id: str, graph: dict) -> None:
    """落盘最近一次提交的 prompt（output/zeroexo/last_prompt_<jobId>.json）。

    刷新/重启后仍可查看，不依赖内存状态。
    """
    try:
        record = {
            "jobId": job_id,
            "promptId": prompt_id,
            "assembledAt": now_ms(),
            "assembledAtIso": time.strftime("%Y-%m-%d %H:%M:%S"),
            "template": GRAPH_TEMPLATE_FILE,
            "nodeSummary": _node_summary(graph),
            "graph": graph,
        }
        path = _last_prompt_path(job_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(_json.dumps(record, ensure_ascii=False), encoding="utf-8")
    except Exception as exc:  # 落盘失败不影响运行
        log.warning("ZeroExo bridge: failed to persist last prompt: %s", exc)



async def health(request) -> web.Response:
    auth = check_auth(request)
    if auth is not None:
        return auth
    srv = PromptServer.instance
    queue = {"running": None, "pending": None}
    upstream = {"importPackRoute": "unknown"}
    try:
        pq = getattr(srv, "prompt_queue", None)
        if pq is not None:
            queue["running"] = len(getattr(pq, "currently_running", {}) or {})
            queue["pending"] = pq.get_tasks_remaining() if hasattr(pq, "get_tasks_remaining") else None
    except Exception:
        pass
    # Cheap upstream presence probe: the route table entry exists.
    try:
        for resource in srv.routes:
            for route in resource:
                if getattr(route, "path", "") == UPSTREAM_IMPORT_ROUTE:
                    upstream["importPackRoute"] = "registered"
                    raise StopIteration
    except StopIteration:
        pass
    except Exception:
        upstream["importPackRoute"] = "unknown"
    return web.json_response({"ok": True, "version": BRIDGE_VERSION, "queue": queue, "upstream": upstream})


async def models(request) -> web.Response:
    auth = check_auth(request)
    if auth is not None:
        return auth
    out = {"unet": [], "vae": [], "clip": [], "clipTypes": []}
    try:
        out["unet"] = folder_paths.get_filename_list("diffusion_models")
    except Exception:
        pass
    try:
        out["vae"] = folder_paths.get_filename_list("vae")
    except Exception:
        pass
    try:
        out["clip"] = folder_paths.get_filename_list("text_encoders")
    except Exception:
        pass
    try:
        import nodes as comfy_nodes

        clip_loader = comfy_nodes.NODE_CLASS_MAPPINGS.get("CLIPLoader")
        if clip_loader is not None:
            spec = clip_loader.INPUT_TYPES()
            type_widget = (spec.get("required") or {}).get("type")
            if isinstance(type_widget, (list, tuple)) and type_widget:
                out["clipTypes"] = list(type_widget[0])
    except Exception:
        pass
    return web.json_response({"ok": True, **out})


async def run(request) -> web.Response:
    auth = check_auth(request)
    if auth is not None:
        return auth
    try:
        body = await request.json()
    except Exception as exc:
        return json_error(400, f"Invalid JSON: {exc}")

    pack_id = str(body.get("packId") or "").strip()
    if not pack_id:
        return json_error(400, "Missing packId (upload one via POST /zeroexo/h3/pack).")
    record = load_pack_record(pack_id)
    if record is None:
        return json_error(404, f"Unknown packId: {pack_id}")

    models = body.get("models") if isinstance(body.get("models"), dict) else {}
    missing_models = [k for k in ("unet", "videoVae", "audioVae", "clip") if not str(models.get(k) or "").strip()]
    if missing_models:
        return json_error(400, f"models missing keys: {', '.join(missing_models)}")

    project_id = str(body.get("projectId") or "default").strip() or "default"
    episode = str(body.get("episode") or "EP01").strip() or "EP01"
    overrides = body.get("overrides") if isinstance(body.get("overrides"), dict) else {}

    timeline = prepare_timeline(record["timeline"], overrides)
    cache_name = sanitize_part(f"zx_{project_id}_{episode}", "zx")
    graph = build_graph(
        timeline=timeline,
        widgets=record.get("widgets") or {},
        models=models,
        overrides=overrides,
        cache_name=cache_name,
        save_prefix=f"zeroexo/{sanitize_part(project_id, 'project')}/{sanitize_part(episode, 'EP')}/bridge",
    )
    # Upstream cache dir: output/minimax_seg_cache/<cache_name>_<node_id>
    # (segment_cache.py:180 resolve_segment_cache_key; node "5" is the Director
    # node in bridge graphs). Same name + node id on resume reuses seg_XXXX.pt.
    cache_dir = str(
        Path(folder_paths.get_output_directory()) / "minimax_seg_cache" / f"{cache_name}_5"
    )

    job_id = str(uuid.uuid4())
    payload = {"prompt": graph, "prompt_id": job_id}
    if body.get("front"):
        payload["front"] = True
    # 前端 /ws clientId 透传：H3 节点实时预览帧（minimax_director_preview/progress）
    # 按 server.client_id 定向发送，传了才能稳定发回发起本次运行的浏览器端
    client_id = str(body.get("clientId") or "").strip()
    if client_id:
        payload["client_id"] = client_id

    url = server_base_url() + "/prompt"
    try:
        async with ClientSession() as sess:
            async with sess.post(url, json=payload, timeout=PROMPT_TIMEOUT_SEC) as resp:
                text = await resp.text()
                status = resp.status
    except Exception as exc:
        return json_error(502, f"loopback POST /prompt failed: {exc}")
    try:
        prompt_resp = _json.loads(text)
    except Exception:
        prompt_resp = {"raw": text}
    if status != 200:
        return web.json_response(
            {"ok": False, "error": "ComfyUI rejected the prompt", "upstream": prompt_resp},
            status=status,
        )

    segments_meta = record.get("timeline", {})
    segs = segments_meta.get("segments") if isinstance(segments_meta, dict) else []
    segment_frames = []
    for seg in segs if isinstance(segs, list) else []:
        try:
            segment_frames.append(int(seg.get("frameCount") or seg.get("length") or 0))
        except (TypeError, ValueError):
            segment_frames.append(0)

    job = STORE.submit(
        job_id=job_id,
        prompt_id=str(prompt_resp.get("prompt_id") or job_id),
        project_id=project_id,
        episode=episode,
        pack_id=pack_id,
        number=prompt_resp.get("number"),
        segment_frames=segment_frames,
        api_mode=True,
        cache_dir=cache_dir,
    )
    # 2026-11-05 「查看本次工作流」：落盘本次提交的完整 prompt JSON（刷新后仍可查看）
    _save_last_prompt(job_id, str(job["promptId"]), graph)
    return web.json_response(
        {
            "ok": True,
            "jobId": job["jobId"],
            "promptId": job["promptId"],
            "number": job["number"],
            "state": job["state"],
            "apiMode": job["apiMode"],
            "segments": {"total": len(job["segments"]), "frames": segment_frames},
            "outputDir": str(
                Path(folder_paths.get_output_directory())
                / "zeroexo"
                / sanitize_part(project_id, "project")
                / sanitize_part(episode, "EP")
            ),
            "cacheDir": cache_dir,
        }
    )


async def status(request) -> web.Response:
    auth = check_auth(request)
    if auth is not None:
        return auth
    job_id = str(request.query.get("jobId") or "").strip()
    if not job_id:
        return json_error(400, "Missing jobId.")
    job = STORE.get(job_id)
    if job is None:
        return json_error(404, f"Unknown jobId: {job_id}")
    return web.json_response({"ok": True, **STORE.public(job)})


async def jobs_list(request) -> web.Response:
    auth = check_auth(request)
    if auth is not None:
        return auth
    return web.json_response({"ok": True, "jobs": [STORE.public(j) for j in STORE.all()]})


async def last_prompt(request) -> web.Response:
    """GET /zeroexo/h3/last-prompt?jobId= → 最近一次提交的完整 prompt JSON。

    - 带 jobId：读 output/zeroexo/last_prompt_<jobId>.json（刷新后仍可看）；
    - 不带：取该目录里最新的一份；
    - 用于前端「查看本次工作流」：可复制 / 下载 .json，拖进 ComfyUI 看真实节点图。
    """
    auth = check_auth(request)
    if auth is not None:
        return auth
    job_id = str(request.query.get("jobId") or "").strip()
    if job_id:
        path = _last_prompt_path(job_id)
    else:
        files = sorted(
            bridge_output_root().glob("last_prompt_*.json"),
            key=lambda p: p.stat().st_mtime if p.is_file() else 0,
            reverse=True,
        )
        if not files:
            return json_error(404, "No submitted prompt yet (run once via POST /zeroexo/h3/run).")
        path = files[0]
    if not path.is_file():
        return json_error(404, f"Unknown jobId (no prompt record): {job_id}")
    try:
        record = _json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        return json_error(500, f"Failed to read {path.name}: {exc}")
    if not isinstance(record, dict):
        return json_error(500, f"Corrupted prompt record: {path.name}")
    return web.json_response(
        {
            "ok": True,
            "jobId": record.get("jobId"),
            "promptId": record.get("promptId"),
            "assembledAt": record.get("assembledAt"),
            "assembledAtIso": record.get("assembledAtIso"),
            "template": record.get("template") or GRAPH_TEMPLATE_FILE,
            "nodeSummary": record.get("nodeSummary") or _node_summary(record.get("graph") or {}),
            "prompt": record.get("graph") or {},
        }
    )



DEFAULT_GUIDE_FRAMES = 22  # upstream default continuity overlap (tail frames)


async def guidance(request) -> web.Response:
    """Tail frames of segment N-1's pixel cache, as an animated WebP data URI.

    Source of truth: output/minimax_seg_cache/<key>/seg_XXXX.pt — the same
    tensor upstream resolve_prev_segment_output uses as the continuity guide
    (segment_continuity.py:379-403), so what the frontend sees == what the
    next segment actually samples from.
    """
    auth = check_auth(request)
    if auth is not None:
        return auth
    job_id = str(request.query.get("jobId") or "").strip()
    if not job_id:
        return json_error(400, "Missing jobId.")
    try:
        segment = int(request.query.get("segment") or "")
    except ValueError:
        return json_error(400, "segment must be an integer (1-based).")
    if segment < 2:
        return json_error(400, "segment must be >= 2 (segment 1 has no guide).")
    job = STORE.get(job_id)
    if job is None:
        return json_error(404, f"Unknown jobId: {job_id}")
    cache_dir = job.get("cacheDir")
    if not cache_dir:
        return json_error(409, "Job has no cacheDir (bridge too old for this job).")
    pt_path = Path(cache_dir) / f"seg_{segment - 2:04d}.pt"
    if not pt_path.is_file():
        return json_error(
            404,
            f"Guide cache not found: {pt_path.name} in cacheDir "
            f"(segment {segment - 1} not finished yet).",
        )
    try:
        want = int(request.query.get("frames") or DEFAULT_GUIDE_FRAMES)
    except ValueError:
        want = DEFAULT_GUIDE_FRAMES
    want = max(1, min(want, 64))

    import base64
    import io

    import torch
    from PIL import Image

    try:
        tensor = torch.load(pt_path, map_location="cpu", weights_only=True)
    except Exception as exc:
        return json_error(500, f"Failed to load {pt_path.name}: {exc}")
    if not isinstance(tensor, torch.Tensor) or tensor.ndim != 4:
        return json_error(500, f"Unexpected cache payload type: {type(tensor).__name__}")
    total_t, h, w, _c = tensor.shape
    n = min(want, total_t)
    tail = tensor[total_t - n :].to(torch.uint8).numpy()  # (n, H, W, C)
    images = [Image.fromarray(frame) for frame in tail]
    buf = io.BytesIO()
    images[0].save(
        buf,
        format="WEBP",
        save_all=True,
        append_images=images[1:],
        duration=1000 // 24,
        loop=0,
        quality=80,
        method=4,
    )
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return web.json_response(
        {
            "ok": True,
            "jobId": job_id,
            "segment": segment,
            "sourceSegment": segment - 1,
            "sourceFile": str(pt_path),
            "frames": n,
            "totalFrames": total_t,
            "width": w,
            "height": h,
            "format": "webp",
            "image": f"data:image/webp;base64,{b64}",
        }
    )


async def cancel(request) -> web.Response:
    auth = check_auth(request)
    if auth is not None:
        return auth
    try:
        body = await request.json()
    except Exception as exc:
        return json_error(400, f"Invalid JSON: {exc}")
    job_id = str(body.get("jobId") or "").strip()
    job = STORE.get(job_id)
    if job is None:
        return json_error(404, f"Unknown jobId: {job_id}")
    srv = PromptServer.instance
    pq = getattr(srv, "prompt_queue", None)
    if pq is None:
        return json_error(500, "PromptQueue unavailable.")
    prompt_id = job["promptId"]
    interrupted = False
    dequeued = False
    try:
        if hasattr(pq, "interrupt_if_running"):
            interrupted = bool(pq.interrupt_if_running(prompt_id))
    except Exception as exc:
        log.warning("interrupt_if_running failed: %s", exc)
    if not interrupted:
        try:
            dequeued = bool(pq.delete_queue_item(lambda item: item[1] == prompt_id))
        except Exception as exc:
            log.warning("delete_queue_item failed: %s", exc)
    if interrupted or dequeued:
        job["state"] = "canceled"
        job["finishedAt"] = int(time.time() * 1000)
        job["error"] = "canceled by client"
        STORE._send("zeroexo.h3.job", STORE._job_event(job))
    return web.json_response({"ok": True, "jobId": job_id, "interrupted": interrupted, "dequeued": dequeued})


def _register(routes, method: str, path: str, handler) -> None:
    """注册一条路由：handler 包 CORS；同路径额外挂 OPTIONS 预检（200 空响应）。

    2026-11-05 用户实测「跨域被拒」：不让用户改 ComfyUI 启动参数，桥接自带 CORS。
    """
    wrapped = with_cors(handler)
    if hasattr(routes, "add_route"):
        routes.add_route(method, path, wrapped)
        routes.add_route("OPTIONS", path, preflight_response)
    elif method == "POST" and hasattr(routes, "post"):
        routes.post(path)(wrapped)
        routes.options(path)(preflight_response)
    elif method == "GET" and hasattr(routes, "get"):
        routes.get(path)(wrapped)
        routes.options(path)(preflight_response)
    else:
        raise AttributeError("Unsupported ComfyUI route table API")


_REGISTERED = False


def register_routes() -> bool:
    global _REGISTERED
    if _REGISTERED:
        return True
    server = getattr(PromptServer, "instance", None)
    if server is None:
        log.warning("ZeroExo bridge: PromptServer not ready, routes not registered")
        return False
    routes = server.routes
    _register(routes, "GET", "/zeroexo/h3/health", health)
    _register(routes, "GET", "/zeroexo/h3/models", models)
    _register(routes, "POST", "/zeroexo/h3/pack", handle_pack_upload)
    _register(routes, "POST", "/zeroexo/h3/run", run)
    _register(routes, "GET", "/zeroexo/h3/status", status)
    _register(routes, "GET", "/zeroexo/h3/guidance", guidance)
    _register(routes, "GET", "/zeroexo/h3/jobs", jobs_list)
    _register(routes, "GET", "/zeroexo/h3/last-prompt", last_prompt)
    _register(routes, "POST", "/zeroexo/h3/cancel", cancel)
    _REGISTERED = True
    log.info("ZeroExo Director Bridge routes registered (/zeroexo/h3/*)")
    return True
