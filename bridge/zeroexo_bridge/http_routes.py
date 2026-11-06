"""zeroexo_bridge 路由注册（写法对齐已验证的 ComfyUI_MiniMaxH3_Director/director/http_routes.py）。

路由：
  GET  /zeroexo/health   —— 自检（返回 web 根目录与版本）
  POST /zeroexo/proxy    —— 云端 API 转发（绕浏览器 CORS）
  GET  /zeroexo, /zeroexo/spikes, /zeroexo/*  —— 同源静态托管

安全默认：只服务于 ComfyUI 自身监听的回环地址；转发目标拒绝私网/链路本地地址，
避免把 8188 变成任意内网跳板（SSRF）。确有需要时显式设 ZEROEXO_PROXY_ALLOW_LAN=1。
"""

from __future__ import annotations

import ipaddress
import os
from pathlib import Path
from urllib.parse import urlparse

import aiohttp
from aiohttp import web

try:
    from server import PromptServer
except Exception:  # 非 ComfyUI 环境（单测）
    PromptServer = None

VERSION = "0.0.1-spike"
WEB_ROOT = Path(os.environ.get("ZEROEXO_WEB", Path(__file__).resolve().parent / "web")).resolve()
_TIMEOUT = aiohttp.ClientTimeout(total=600)
_registered = False


def _web_root() -> Path:
    return WEB_ROOT if WEB_ROOT.is_dir() else Path(__file__).resolve().parent


async def health(_request: web.Request) -> web.Response:
    return web.json_response({"ok": True, "version": VERSION, "webRoot": str(_web_root())})


def _is_private(host: str) -> bool:
    try:
        ip = ipaddress.ip_address(host)
        return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
    except ValueError:
        return host in {"localhost"}  # 域名形式 localhost 同样拒绝（本机服务请直连，无需转发）


async def proxy(request: web.Request) -> web.Response:
    payload = await request.json()
    target = str(payload.get("url", ""))
    parsed = urlparse(target)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return web.json_response({"error": "BAD_URL"}, status=400)
    if _is_private(parsed.hostname or "") and os.environ.get("ZEROEXO_PROXY_ALLOW_LAN") != "1":
        return web.json_response({"error": "PRIVATE_TARGET_BLOCKED", "host": parsed.hostname}, status=403)

    headers = {k: v for k, v in payload.get("headers", {}).items() if isinstance(v, str)}
    key = payload.get("apiKey")
    if key:
        headers["Authorization"] = f"Bearer {key}"
    body = payload.get("body")
    method = str(payload.get("method", "GET")).upper()

    try:
        async with aiohttp.ClientSession(timeout=_TIMEOUT) as session:
            async with session.request(method, target, headers=headers, json=body if isinstance(body, (dict, list)) else None) as resp:
                data = await resp.read()
                return web.Response(status=resp.status, body=data, content_type=resp.headers.get("Content-Type", "application/json"))
    except aiohttp.ClientError as exc:
        return web.json_response({"error": "UPSTREAM_FAILED", "detail": str(exc)}, status=502)


def _index(name: str):
    async def _handler(_request: web.Request) -> web.Response:
        f = _web_root() / name
        if not f.is_file():
            return web.Response(status=404, text=f"missing {f}")
        return web.Response(body=f.read_bytes(), content_type="text/html; charset=utf-8")

    return _handler


def register_routes() -> bool:
    global _registered
    if _registered or PromptServer is None or getattr(PromptServer, "instance", None) is None:
        return False
    routes = PromptServer.instance.routes
    routes.get("/zeroexo/health")(health)
    routes.post("/zeroexo/proxy")(proxy)
    routes.get("/zeroexo")(_index("spikes/index.html"))
    routes.get("/zeroexo/spikes")(_index("spikes/index.html"))
    routes.get("/zeroexo/spikes/")(_index("spikes/index.html"))
    # 静态资源最后注册，避免吃掉上面精确路由；dist 上线时 /zeroexo 前缀即画布
    try:
        routes.static("/zeroexo", str(_web_root()), show_index=False)
    except Exception as exc:  # 目录尚不存在时不阻断 ComfyUI 启动
        print(f"[zeroexo_bridge] static skipped: {exc}")
    _registered = True
    print(f"[zeroexo_bridge] routes ready → http://127.0.0.1:8188/zeroexo/  webRoot={_web_root()}")
    return True


register_routes()
