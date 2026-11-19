import os
import posixpath
import time

import paramiko

HOST = os.environ["ZX_SSH_HOST"]
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, port=int(os.environ["ZX_SSH_PORT"]), username="root",
          password=os.environ["ZX_SSH_PASS"], timeout=25, banner_timeout=25)

local_zip = r"D:\AICode\zeroexo\zeroexo-comfyui\public\downloads\ComfyUI_ZeroExoNodes.zip"
sftp = c.open_sftp()
sftp.put(local_zip, "/tmp/zx_plugin.zip")
print("uploaded", sftp.stat("/tmp/zx_plugin.zip").st_size)
sftp.close()

def run(cmd, timeout=60):
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode()
    err = e.read().decode()
    print("$", cmd)
    print(out[-1500:])
    if err.strip():
        print("ERR:", err[-400:])
    return out

run("unzip -l /tmp/zx_plugin.zip | head -20")
run("tr '\\0' ' ' < /proc/230/cmdline; echo; readlink /proc/230/cwd; ps -o pid,cmd -p 230")
c.close()
