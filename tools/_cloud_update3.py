import os
import time

import paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(os.environ["ZX_SSH_HOST"], port=int(os.environ["ZX_SSH_PORT"]), username="root",
          password=os.environ["ZX_SSH_PASS"], timeout=25, banner_timeout=25)

def run(cmd, timeout=90):
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode()
    err = e.read().decode()
    print("$", cmd)
    print(out[-1500:])
    if err.strip():
        print("ERR:", err[-500:])
    return out

ok = run("python3 -c \"import zipfile;n=zipfile.ZipFile('/tmp/zx_plugin.zip').namelist();print('self_update' if any('self_update' in x for x in n) else 'no-self_update');print('manifest' if any('manifest.json' in x for x in n) else 'no-manifest')\"")
if "no-self_update" not in ok or "no-manifest" not in ok:
    print("ZIP 仍是旧包，停止")
    raise SystemExit(1)

run("set -e; TS=$(date +%Y%m%d-%H%M%S); mkdir -p /root/comfyui/plugin-backups; D=/root/comfyui/ComfyUI/custom_nodes/ComfyUI_ZeroExoNodes; if [ -d $D ]; then mv $D /root/comfyui/plugin-backups/ComfyUI_ZeroExoNodes-$TS; fi; python3 - <<'PY'\nimport zipfile\nzipfile.ZipFile('/tmp/zx_plugin.zip').extractall('/root/comfyui/ComfyUI/custom_nodes')\nPY\nrm -rf $D/__pycache__ $D/.update_state.json; ls $D | head -20", timeout=120)
run("kill 13136; sleep 3; cd /root/comfyui/ComfyUI && nohup /root/miniconda3/bin/python main.py --preview-method auto --port 8188 --listen 0.0.0.0 --enable-cors-header '*' > /root/comfyui/comfy_run.log 2>&1 & echo started", timeout=30)
time.sleep(20)
run("curl -sS -m 8 http://127.0.0.1:8188/system_stats | head -c 220; echo; ls /root/comfyui/ComfyUI/custom_nodes/ComfyUI_ZeroExoNodes | head -20", timeout=60)
c.close()
