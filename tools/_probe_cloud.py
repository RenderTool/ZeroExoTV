import os

import paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(os.environ["ZX_SSH_HOST"], port=int(os.environ["ZX_SSH_PORT"]),
          username=os.environ["ZX_SSH_USER"], password=os.environ["ZX_SSH_PASS"],
          timeout=20, banner_timeout=20)
for cmd in ("ss -ltnp | grep 8188", "curl -sS -m 5 http://127.0.0.1:8188/system_stats | head -c 160"):
    _, o, _ = c.exec_command(cmd, timeout=15)
    print(cmd, "=>", o.read().decode().strip()[:200])
c.close()
