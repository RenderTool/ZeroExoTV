import os

import paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(os.environ["ZX_SSH_HOST"], port=int(os.environ["ZX_SSH_PORT"]),
          username="root", password=os.environ["ZX_SSH_PASS"], timeout=20, banner_timeout=20)
for cmd in [
    "ls -l /root/comfyui/*.log",
    "grep -n -A6 'failed validation' /root/comfyui/comfy_restart.log | tail -40",
]:
    _, o, e = c.exec_command(cmd, timeout=30)
    print("$", cmd)
    print(o.read().decode()[-2000:])
c.close()
