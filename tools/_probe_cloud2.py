import os

import paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(os.environ["ZX_SSH_HOST"], port=int(os.environ["ZX_SSH_PORT"]),
          username="root", password=os.environ["ZX_SSH_PASS"], timeout=20, banner_timeout=20)
cmds = [
    "ls /root/comfyui",
    "ls /root/comfyui/ComfyUI/custom_nodes/ComfyUI_ZeroExoNodes | head -30",
    "find /root/comfyui -maxdepth 2 -name '*.log' -printf '%T@ %p\\n' | sort -nr | head -5",
]
for cmd in cmds:
    _, o, e = c.exec_command(cmd, timeout=25)
    print("$", cmd)
    print(o.read().decode()[:800])
    err = e.read().decode()[:200]
    if err:
        print("ERR:", err)
c.close()
