"""Shared helpers for the ZeroExo Director Bridge."""

from __future__ import annotations

import logging
import os
import re
import time
from pathlib import Path

import folder_paths
from aiohttp import web
from server import PromptServer

log = logging.getLogger("ComfyUI-ZeroExo-DirectorBridge")

BRIDGE_VERSION = "0.1.0"
TOKEN_ENV = "ZEROEXO_BRIDGE_TOKEN"
AUTH_HEADER = "X-ZeroExo-Token"

_WIN_ILLEGAL = re.compile(r'[<>:"/\\|?*\x00-\x1f]+')
_WIN_RESERVED = re.compile(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])$", re.I)


def now_ms() -> int:
    return int(time.time() * 1000)


def sanitize_part(value: str, fallback: str = "x") -> str:
    """Path-safe fragment for projectId / episode. Keeps CJK, strips Windows-illegal."""
    s = _WIN_ILLEGAL.sub("_", str(value or "").strip()).strip(" .")[:60]
    if not s or _WIN_RESERVED.match(s):
        s = fallback
    return s


def state_root() -> Path:
    root = Path(folder_paths.get_temp_directory()) / "zeroexo_bridge"
    root.mkdir(parents=True, exist_ok=True)
    return root


def packs_root() -> Path:
    root = state_root() / "packs"
    root.mkdir(parents=True, exist_ok=True)
    return root


def bridge_output_root() -> Path:
    root = Path(folder_paths.get_output_directory()) / "zeroexo"
    return root


def json_error(status: int, message: str) -> web.Response:
    return web.json_response({"ok": False, "error": str(message)}, status=status)


def check_auth(request) -> web.Response | None:
    """Optional token gate. Unset env = open local mode."""
    token = os.environ.get(TOKEN_ENV) or ""
    if not token:
        return None
    header_token = request.headers.get(AUTH_HEADER, "")
    auth = request.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        header_token = auth[7:].strip()
    if header_token == token:
        return None
    return json_error(401, f"missing or invalid {AUTH_HEADER}")


def server_base_url() -> str:
    """Loopback base URL of this ComfyUI instance."""
    srv = getattr(PromptServer, "instance", None)
    port = int(getattr(srv, "port", 8188) or 8188)
    address = str(getattr(srv, "address", "") or "").strip()
    if not address or address in ("0.0.0.0", "::"):
        address = "127.0.0.1"
    return f"http://{address}:{port}"
