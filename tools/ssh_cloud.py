"""一次性 SSH 运维助手（不提交凭据；通过环境变量传参）。

用法：
  python ssh_cloud.py "command"
  python ssh_cloud.py --put local remote
  python ssh_cloud.py --get remote local
环境变量：ZX_SSH_HOST ZX_SSH_PORT ZX_SSH_USER ZX_SSH_PASS
"""
import os
import sys

import paramiko

host = os.environ["ZX_SSH_HOST"]
port = int(os.environ.get("ZX_SSH_PORT", "22"))
user = os.environ["ZX_SSH_USER"]
password = os.environ["ZX_SSH_PASS"]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, port=port, username=user, password=password, timeout=30, banner_timeout=30)

try:
    if len(sys.argv) >= 2 and sys.argv[1] == "--put":
        sftp = client.open_sftp()
        sftp.put(sys.argv[2], sys.argv[3])
        sftp.close()
        print("uploaded", sys.argv[2], "->", sys.argv[3])
    elif len(sys.argv) >= 2 and sys.argv[1] == "--get":
        sftp = client.open_sftp()
        sftp.get(sys.argv[2], sys.argv[3])
        sftp.close()
        print("downloaded", sys.argv[2], "->", sys.argv[3])
    else:
        cmd = " ".join(sys.argv[1:])
        _stdin, stdout, stderr = client.exec_command(cmd, timeout=600)
        out = stdout.read().decode("utf-8", "replace")
        err = stderr.read().decode("utf-8", "replace")
        code = stdout.channel.recv_exit_status()
        sys.stdout.write(out)
        if err:
            sys.stderr.write(err)
        sys.exit(code)
finally:
    client.close()
