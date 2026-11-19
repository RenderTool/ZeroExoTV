import os
import select
import time

import paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(os.environ["ZX_SSH_HOST"], port=int(os.environ["ZX_SSH_PORT"]),
          username=os.environ["ZX_SSH_USER"], password=os.environ["ZX_SSH_PASS"],
          timeout=20, banner_timeout=20)
_, o, _ = c.exec_command("hostname -I; head -1 /proc/1/cgroup; hostname", timeout=15)
ips = o.read().decode().split()
print("remote:", ips[:3], ips[-2:] if len(ips) > 2 else "")
t = c.get_transport()
for target in [ips[0] if ips else "127.0.0.1", "127.0.0.1"]:
    try:
        ch = t.open_channel("direct-tcpip", (target, 8188), ("127.0.0.1", 0), timeout=10)
        ch.sendall(b"GET /system_stats HTTP/1.0\r\n\r\n")
        r, _, _ = select.select([ch], [], [], 5)
        data = ch.recv(200) if r else b"<timeout>"
        print(target, "->", data[:60])
        ch.close()
    except Exception as ex:
        print(target, "ERR", type(ex).__name__, ex)
c.close()
