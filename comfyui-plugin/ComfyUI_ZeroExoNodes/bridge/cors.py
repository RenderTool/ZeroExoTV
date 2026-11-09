"""Self-contained CORS headers for the ZeroExo bridge routes.

Why this exists: stock ComfyUI only emits CORS headers when it is started with
`--enable-cors-header` (comfy/cli_args.py: default None -> middleware not added,
server.py:283). External WebUI (zeroexo-comfyui on another origin) must not
require the user to add that flag, so every `/zeroexo/h3/*` response — including
error responses and OPTIONS preflight — carries the headers itself.

Design:
- Echo the request `Origin` when present (falls back to `*`), so the headers also
  work when upstream CORS middleware is enabled with credentials.
- Pure helpers (no ComfyUI imports) so they stay trivially testable.
"""

from __future__ import annotations

from typing import Awaitable, Callable

from aiohttp import web

ALLOW_METHODS = "GET, POST, OPTIONS, DELETE, PUT, PATCH"
ALLOW_HEADERS = "Content-Type, Authorization, X-ZeroExo-Token, Accept, Origin, X-Requested-With"
MAX_AGE_SEC = "86400"


def _allowed_origin(request: web.Request | None) -> str:
    origin = request.headers.get("Origin", "") if request is not None else ""
    return origin or "*"


def apply_cors(response: web.Response, request: web.Request | None = None) -> web.Response:
    """Add CORS response headers (safe to call twice / alongside upstream CORS)."""
    response.headers["Access-Control-Allow-Origin"] = _allowed_origin(request)
    response.headers["Access-Control-Allow-Methods"] = ALLOW_METHODS
    response.headers["Access-Control-Allow-Headers"] = ALLOW_HEADERS
    response.headers["Access-Control-Max-Age"] = MAX_AGE_SEC
    # Chrome Private Network Access: HTTPS(GitHub Pages) -> http://127.0.0.1 必须显式放行
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    if request is not None and request.headers.get("Origin"):
        # 回显 Origin 时必须声明 Vary，避免缓存把 A 站点的响应给 B 站点
        response.headers.setdefault("Vary", "Origin")
    return response


def preflight_response(request: web.Request) -> web.Response:
    """OPTIONS 预检：200 空响应 + CORS 头（不进入 handler，不做鉴权）。"""
    return apply_cors(web.Response(status=200, text=""), request)


def with_cors(
    handler: Callable[[web.Request], Awaitable[web.StreamResponse]],
) -> Callable[[web.Request], Awaitable[web.StreamResponse]]:
    """Wrap a route handler: CORS on success, on json_error, and on exceptions.

    异常也补 CORS 并转成 JSON 500 —— 否则前端只会看到「CORS 失败」，
    看不到真实错误信息（2026-11-05 用户实测反馈）。
    """

    async def wrapped(request: web.Request) -> web.StreamResponse:
        try:
            response = await handler(request)
        except web.HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001 - 桥接层隔离，绝不吞掉上游 500 语义
            from .common import log

            log.exception("ZeroExo bridge route failed: %s", exc)
            response = web.json_response(
                {"ok": False, "error": f"{type(exc).__name__}: {exc}"}, status=500
            )
        if isinstance(response, web.Response):
            apply_cors(response, request)
        return response

    wrapped.__name__ = getattr(handler, "__name__", "handler")
    wrapped.__doc__ = getattr(handler, "__doc__", None)
    return wrapped
