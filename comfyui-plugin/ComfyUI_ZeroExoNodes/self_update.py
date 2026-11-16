"""启动自更新 bootstrap：拉取远端 manifest.json，按 sha256 覆盖插件文件。

设计约束：
- 仅用标准库，不 import torch/aiohttp/folder_paths，供 __init__.py 首行调用；
- 更新发生在插件其他模块导入之前，覆盖后的新文件本次启动直接生效，无需重启 ComfyUI；
- 失败静默降级：网络/磁盘异常只打日志，绝不阻断插件加载；
- 幂等：本地 .update_state.json 记录已应用的清单版本，版本一致直接跳过（防循环下载）；
- 只覆盖清单列出的文件，路径越界（.. / 绝对路径）一律拒收。

环境变量：
  ZEROEXO_UPDATE_DISABLE=1              关闭自更新
  ZEROEXO_UPDATE_MANIFEST_URL           清单地址（覆盖默认 GitHub raw）
  ZEROEXO_UPDATE_REPO                   仓库（默认 RenderTool/ZeroExoTV）
  ZEROEXO_UPDATE_BRANCH                 分支（默认 main）
  ZEROEXO_UPDATE_MIRROR                 raw 镜像前缀（如 https://ghproxy.net/），直连失败时回退
  ZEROEXO_UPDATE_TOKEN / GITHUB_TOKEN   私有仓库只读 PAT（contents:read）
"""
import hashlib
import json
import os
import urllib.request

PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
MARKER_PATH = os.path.join(PLUGIN_DIR, ".update_state.json")
MANIFEST_NAME = "manifest.json"
FETCH_TIMEOUT = 5


def _raw_url() -> str:
    repo = os.environ.get("ZEROEXO_UPDATE_REPO", "RenderTool/ZeroExoTV")
    branch = os.environ.get("ZEROEXO_UPDATE_BRANCH", "main")
    return f"https://raw.githubusercontent.com/{repo}/{branch}/comfyui-plugin/ComfyUI_ZeroExoNodes/{MANIFEST_NAME}"


def _candidate_urls() -> list[str]:
    custom = os.environ.get("ZEROEXO_UPDATE_MANIFEST_URL")
    urls = [custom] if custom else [_raw_url()]
    mirror = os.environ.get("ZEROEXO_UPDATE_MIRROR")
    if not custom and mirror:
        urls.append(mirror + urls[0])
    return urls


def _fetch(url: str) -> bytes:
    req = urllib.request.Request(url)
    token = os.environ.get("ZEROEXO_UPDATE_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as resp:
        return resp.read()


def _load_manifest() -> tuple[dict | None, str]:
    for url in _candidate_urls():
        try:
            manifest = json.loads(_fetch(url))
            if not isinstance(manifest, dict):
                continue
            return manifest, url.rsplit(MANIFEST_NAME, 1)[0]
        except Exception as exc:
            print(f"[ZeroExo] self-update manifest fetch failed ({url}): {exc}")
    return None, ""


def _sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _safe_local(rel: str) -> str | None:
    if "\\" in rel or rel.startswith("/") or ".." in rel.split("/"):
        return None
    local = os.path.abspath(os.path.join(PLUGIN_DIR, rel))
    return local if local.startswith(PLUGIN_DIR + os.sep) else None


def bootstrap() -> None:
    if os.environ.get("ZEROEXO_UPDATE_DISABLE") == "1":
        return
    manifest, base_url = _load_manifest()
    if not manifest:
        return
    version = str(manifest.get("version") or "")
    if not version:
        return
    try:
        with open(MARKER_PATH, encoding="utf-8") as f:
            marker = json.load(f)
    except Exception:
        marker = {}
    if marker.get("version") == version:
        return
    changed = 0
    for entry in manifest.get("files") or []:
        if not isinstance(entry, dict):
            continue
        rel, sha = entry.get("path"), entry.get("sha256")
        if not isinstance(rel, str) or not isinstance(sha, str):
            continue
        local = _safe_local(rel)
        if not local:
            print(f"[ZeroExo] self-update rejected unsafe path: {rel}")
            continue
        if os.path.isfile(local) and _sha256_file(local) == sha:
            continue
        try:
            data = _fetch(base_url + rel)
        except Exception as exc:
            print(f"[ZeroExo] self-update download failed ({rel}): {exc}")
            continue
        if hashlib.sha256(data).hexdigest() != sha:
            print(f"[ZeroExo] self-update hash mismatch, skipped: {rel}")
            continue
        os.makedirs(os.path.dirname(local), exist_ok=True)
        tmp = local + ".update-tmp"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, local)
        changed += 1
    with open(MARKER_PATH, "w", encoding="utf-8") as f:
        json.dump({"version": version}, f)
    if changed:
        print(f"[ZeroExo] self-update applied {version} ({changed} files updated)")
    else:
        print(f"[ZeroExo] self-update already at {version}")
