"""本地 8188 → 云端 ComfyUI 8188 的 SSH 隧道（仅标准库 + paramiko）。

云端 waas 实例的 8188 不对外暴露，只能在实例内访问；网页/MCP 需要一个本地地址时，
用本脚本把 127.0.0.1:8188 转发到云端 127.0.0.1:8188。

环境变量：ZX_SSH_HOST ZX_SSH_PORT ZX_SSH_USER ZX_SSH_PASS
可选：ZX_TUNNEL_LOCAL_PORT（默认 8188）
"""
import os
import select
import socket
import socketserver
import sys
import threading
import time

import paramiko

HOST = os.environ["ZX_SSH_HOST"]
PORT = int(os.environ.get("ZX_SSH_PORT", "22"))
USER = os.environ["ZX_SSH_USER"]
PASS = os.environ["ZX_SSH_PASS"]
LOCAL_PORT = int(os.environ.get("ZX_TUNNEL_LOCAL_PORT", "8188"))
REMOTE = ("127.0.0.1", 8188)

_client = None
_transport = None
_lock = threading.Lock()


def ensure_transport():
    """建立（或重建）SSH 连接；失败时抛异常。"""
    global _client, _transport
    with _lock:
        if _transport is not None and _transport.is_active():
            return _transport
        _client = paramiko.SSHClient()
        _client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        _client.connect(HOST, port=PORT, username=USER, password=PASS,
                        timeout=30, banner_timeout=30, auth_timeout=30)
        _transport = _client.get_transport()
        _transport.set_keepalive(30)
        print(f"[tunnel] connected {HOST}:{PORT}", flush=True)
        return _transport


def pump(src, dst):
    try:
        while True:
            r, _, _ = select.select([src, dst], [], [], 1)
            if src in r:
                data = src.recv(65536)
                if not data:
                    break
                dst.sendall(data)
            if dst in r:
                data = dst.recv(65536)
                if not data:
                    break
                src.sendall(data)
    except Exception:
        pass
    finally:
        for s in (src, dst):
            try:
                s.close()
            except Exception:
                pass


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        try:
            transport = ensure_transport()
            chan = transport.open_channel("direct-tcpip", REMOTE, self.client_address)
        except Exception as exc:
            print(f"[tunnel] open_channel failed: {exc}", flush=True)
            return
        threading.Thread(target=pump, args=(self.request, chan), daemon=True).start()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    while True:
        try:
            ensure_transport()
            break
        except Exception as exc:
            print(f"[tunnel] connect retry: {exc}", flush=True)
            time.sleep(5)
    with Server(("127.0.0.1", LOCAL_PORT), Handler) as srv:
        print(f"[tunnel] listening 127.0.0.1:{LOCAL_PORT} -> remote {REMOTE}", flush=True)
        srv.serve_forever()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
