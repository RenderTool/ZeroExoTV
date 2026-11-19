import os
import time

import paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(os.environ["ZX_SSH_HOST"], port=int(os.environ["ZX_SSH_PORT"]),
          username=os.environ["ZX_SSH_USER"], password=os.environ["ZX_SSH_PASS"],
          timeout=20, banner_timeout=20)
i, o, e = c.exec_command("grep -iE 'allowtcpforwarding|gatewayports' /etc/ssh/sshd_config", timeout=15)
print("cfg:", o.read().decode().strip())
t = c.get_transport()
try:
    ch = t.open_channel("direct-tcpip", ("127.0.0.1", 8188), ("127.0.0.1", 1))
    ch.sendall(b"GET /system_stats HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
    time.sleep(1.5)
    print("recv:", ch.recv(200)[:80])
except Exception as ex:
    print("ERR", type(ex).__name__, ex)
c.close()
