import os
import select
import socket
import time

import paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(os.environ["ZX_SSH_HOST"], port=int(os.environ["ZX_SSH_PORT"]),
          username=os.environ["ZX_SSH_USER"], password=os.environ["ZX_SSH_PASS"],
          timeout=20, banner_timeout=20)
t = c.get_transport()


def probe(host, port, payload, wait=6):
    try:
        ch = t.open_channel("direct-tcpip", (host, port), ("127.0.0.1", 0), timeout=10)
    except Exception as ex:
        print(f"{host}:{port} open ERR {type(ex).__name__} {ex}")
        return
    ch.sendall(payload)
    out = b""
    end = time.time() + wait
    while time.time() < end:
        r, _, _ = select.select([ch], [], [], 0.5)
        if r:
            try:
                d = ch.recv(4096)
            except Exception as ex:
                print(f"{host}:{port} recv ERR {ex}")
                break
            if not d:
                print(f"{host}:{port} EOF, got {out[:60]!r}")
                break
            out += d
            if len(out) > 60:
                break
    ch.close()
    print(f"{host}:{port} -> {out[:80]!r}")


probe("127.0.0.1", 22, b"", 6)
probe("127.0.0.1", 8188, b"GET /system_stats HTTP/1.0\r\n\r\n", 8)
c.close()
