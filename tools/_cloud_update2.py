import os

import paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(os.environ["ZX_SSH_HOST"], port=int(os.environ["ZX_SSH_PORT"]), username="root",
          password=os.environ["ZX_SSH_PASS"], timeout=25, banner_timeout=25)

def run(cmd, timeout=60):
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode()
    err = e.read().decode()
    print("$", cmd)
    print(out[-1800:])
    if err.strip():
        print("ERR:", err[-400:])
    return out

run("python3 -c \"import zipfile;z=zipfile.ZipFile('/tmp/zx_plugin.zip');print('\\n'.join(z.namelist()[:12]))\"")
run("ps -eo pid,cmd | grep -i 'ComfyUI/main.py' | grep -v grep")
run("ss -ltnp | grep 8188")
c.close()
