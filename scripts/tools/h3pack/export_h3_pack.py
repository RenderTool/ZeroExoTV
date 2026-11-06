#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""export_h3_pack.py — zeroexo 画布 project.json → MiniMaxH3 导演包（mmxpack v1）旁路导出器.

只读画布本地数据目录的 projects/<id>/project.json（裸 JSON），不修改任何现有数据；
输出 pack 目录 + .mmxpack.zip，schema 与 ComfyUI_MiniMaxH3_Director 节点完全一致
（依据 zerovideoAgent references/director-pack-schema.md，经节点源码 round-trip 验证）。

用法：
  python scripts/tools/h3pack/export_h3_pack.py --project <数据目录>/projects/<id>/project.json \
      --assets <资产目录> [--node <nodeId>] [--episode <episodeId>] \
      [--shared shared.json] [--params params.json] --out <输出目录> [--zip]

--assets 目录内文件以 storageKey 命名（storageKey.<ext>），或提供 assets-map.json
  {"<storageKey>": "<相对--assets路径>"} 通过 --assets-map 指定。
--shared JSON：{"prompt": "(已废弃,忽略)", "images": ["a.png"], "audios": ["v.wav"], "videos": []}
  （2026-11-05 公共提示词层下线：传入 prompt 会被忽略，shared_params.json 的 prompt 恒为空串；公共内容请在装配前并入每段 prompt）
--params JSON（均可缺省）：taskType(默认 r2v), frameRate(24), idPrefix(默认=输出目录名),
  widgets{...8键}, output{...原样透传}, commonEnabled(true), refImageSize("max"),
  negativePrompt(段级缺省 ""), continuityFromPrev(布尔数组覆盖)。
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import zipfile
from pathlib import Path

PACK_FORMAT = "minimax-h3-director-pack"
PACK_VERSION = 1
WIDGET_KEYS = ["steps", "sampler", "scheduler", "cfg", "shift_video", "shift_audio", "seed", "task_type"]
IMG_EXT = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff"}
AUD_EXT = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac", ".wma"}
VID_EXT = {".mp4", ".mov", ".webm", ".mkv"}
ASCII_PATH = re.compile(r"^[A-Za-z0-9_./]+$")
MAX_IMG, MAX_AUD, MAX_VID = 9, 3, 3

DEFAULT_WIDGETS = {
    "steps": 8, "sampler": "res_multistep", "scheduler": "simple", "cfg": 1,
    "shift_video": 12, "shift_audio": 3, "seed": 666,
    "task_type": "r2v — 参考主体生视频(Reference to Video)",
}
DEFAULT_OUTPUT = {
    "width": 1728, "height": 736, "refImageSize": "max",
    "continuityEnabled": True, "continuityOverlapFrames": 22,
    "continuityMode": "continue", "continuityRedraw": 0.1, "continuityKeepTail": True,
    "audioMode": "generate",
}


def die(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def align_frames(frames: int) -> int:
    """17k+5 吸附：frames + (5 - frames) % 17（与节点 frame_align.py 一致）。"""
    return frames + (5 - frames) % 17


def pick_node(graph: dict, node_id: str | None) -> dict:
    nodes = [n for n in graph.get("nodes", []) if not n.get("_deleted")]
    if node_id:
        for n in nodes:
            if n.get("id") == node_id:
                return n
        die(f"找不到节点 {node_id}")
    for t in ("workbench", "storyboard"):
        for n in nodes:
            if n.get("type") == t:
                return n
    die("project.json 中没有 workbench/storyboard 节点（可用 --node 指定）")


def pick_shots(node: dict, episode_id: str | None) -> list[dict]:
    data = node.get("data") or {}
    if episode_id and data.get("shotsByEpisode"):
        return list(data["shotsByEpisode"].get(episode_id) or [])
    return list(data.get("shots") or [])


def shot_prompt(shot: dict) -> str:
    return (shot.get("videoPrompt") or shot.get("prompt") or shot.get("promptText") or "").strip()


def resolve_asset(storage_key: str, assets_dir: Path, amap: dict) -> Path:
    rel = amap.get(storage_key)
    if rel:
        p = assets_dir / rel
        if p.is_file():
            return p
    direct = assets_dir / storage_key
    if direct.is_file():
        return direct
    for f in assets_dir.iterdir():
        if f.stem == storage_key and f.suffix.lower() in IMG_EXT | AUD_EXT | VID_EXT:
            return f
    die(f"资产文件找不到：storageKey={storage_key}（在 {assets_dir} 或 --assets-map 中）")


def slot_refs(refs: list[dict], kind: str) -> list[dict]:
    """按 kind 过滤参考素材，返回 (reference, storageKey) 列表。"""
    out = []
    for r in refs or []:
        if r.get("kind") == kind and r.get("storageKey"):
            out.append(r)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--assets", required=True)
    ap.add_argument("--assets-map")
    ap.add_argument("--node")
    ap.add_argument("--episode")
    ap.add_argument("--shared")
    ap.add_argument("--params")
    ap.add_argument("--out", required=True)
    ap.add_argument("--zip", action="store_true")
    a = ap.parse_args()

    graph = json.loads(Path(a.project).read_text(encoding="utf-8"))
    node = pick_node(graph, a.node)
    shots = pick_shots(node, a.episode)
    if not shots:
        die("节点内没有镜头")

    params = json.loads(Path(a.params).read_text(encoding="utf-8")) if a.params else {}
    frame_rate = float(params.get("frameRate", 24))
    task_type = params.get("taskType", "r2v")
    id_prefix = params.get("idPrefix", Path(a.out).name)
    common_enabled = bool(params.get("commonEnabled", True))
    ref_image_size = params.get("refImageSize", "max")
    neg_default = params.get("negativePrompt", "")
    cfp_override = params.get("continuityFromPrev")  # 可选布尔数组
    widgets = {k: v for k, v in {**DEFAULT_WIDGETS, **params.get("widgets", {})}.items() if k in WIDGET_KEYS}
    output = {**DEFAULT_OUTPUT, **params.get("output", {})}

    shared = json.loads(Path(a.shared).read_text(encoding="utf-8")) if a.shared else {}
    shared_imgs = list(shared.get("images") or [])
    shared_auds = list(shared.get("audios") or [])
    shared_vids = list(shared.get("videos") or [])
    if len(shared_imgs) > MAX_IMG or len(shared_auds) > MAX_AUD or len(shared_vids) > MAX_VID:
        die("公共素材超上限（图9/音3/视3）")
    k_img, k_aud, k_vid = len(shared_imgs), len(shared_auds), len(shared_vids)

    assets_dir = Path(a.assets)
    amap = json.loads(Path(a.assets_map).read_text(encoding="utf-8")) if a.assets_map else {}
    out = Path(a.out)
    if out.exists():
        shutil.rmtree(out)
    (out / "shared_params").mkdir(parents=True)

    def copy_slot(src: Path, dst_dir: Path, name: str) -> str:
        dst = dst_dir / f"{name}{src.suffix.lower()}"
        shutil.copyfile(src, dst)
        return dst.name

    def check_ascii(rel: str) -> None:
        if not ASCII_PATH.match(rel):
            die(f"包内路径含非 ASCII：{rel}")

    # ---- shared_params ----
    sp_refs, sp_audios, sp_videos = [], [], []
    for i, f in enumerate(shared_imgs):
        src = resolve_asset(f, assets_dir, amap)
        fn = copy_slot(src, out / "shared_params", f"Picture{i + 1}")
        sp_refs.append({"index": i, "imageFile": f"shared_params/{fn}", "fileName": src.name,
                        "type": "input", "subfolder": "shared_params"})
    for i, f in enumerate(shared_auds):
        src = resolve_asset(f, assets_dir, amap)
        fn = copy_slot(src, out / "shared_params", f"Audio{i + 1}")
        sp_audios.append({"index": i, "audioFile": f"shared_params/{fn}", "fileName": src.name,
                          "type": "input", "subfolder": "shared_params"})
    for i, f in enumerate(shared_vids):
        src = resolve_asset(f, assets_dir, amap)
        fn = copy_slot(src, out / "shared_params", f"Video{i + 1}")
        sp_videos.append({"index": i, "videoFile": f"shared_params/{fn}", "fileName": src.name,
                          "type": "input", "subfolder": "shared_params"})
    (out / "shared_params" / "shared_params.json").write_text(json.dumps({
        "commonEnabled": common_enabled, "commonCollapsed": False,
        # 2026-11-05 公共提示词层下线：上游格式键保留但恒为空串，不再拼接公共提示词
        "prompt": "",
        "refs": sp_refs, "refAudios": sp_audios, "refVideos": sp_videos,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    # ---- asset_groups ----
    start = 0
    total = 0
    for idx, shot in enumerate(shots):
        nn = f"{idx + 1:02d}"
        gdir = out / "asset_groups" / nn
        gdir.mkdir(parents=True)
        dur = float(shot.get("duration") or 0)
        frames = shot.get("frameCount") or align_frames(max(5, round(dur * frame_rate)))
        refs = shot.get("references") or []

        g_refs, g_audios, g_videos = [], [], []
        for j, r in enumerate(slot_refs(refs, "image")):
            slot = k_img + 1 + j
            if common_enabled and slot > MAX_IMG:
                die(f"段 {nn} 图片槽位超上限（公共 {k_img} + 组内 {len(slot_refs(refs, 'image'))} > 9）")
            src = resolve_asset(r["storageKey"], assets_dir, amap)
            fn = copy_slot(src, gdir, f"Picture{slot}")
            g_refs.append({"index": slot - 1, "imageFile": f"asset_groups/{nn}/{fn}",
                           "fileName": src.name, "type": "input", "subfolder": f"asset_groups/{nn}"})
        for j, r in enumerate(slot_refs(refs, "audio")):
            slot = k_aud + 1 + j
            if common_enabled and slot > MAX_AUD:
                die(f"段 {nn} 音频槽位超上限")
            src = resolve_asset(r["storageKey"], assets_dir, amap)
            fn = copy_slot(src, gdir, f"Audio{slot}")
            g_audios.append({"index": slot - 1, "audioFile": f"asset_groups/{nn}/{fn}",
                             "fileName": src.name, "type": "input", "subfolder": f"asset_groups/{nn}"})
        for j, r in enumerate(slot_refs(refs, "video")):
            slot = k_vid + 1 + j
            if common_enabled and slot > MAX_VID:
                die(f"段 {nn} 视频槽位超上限")
            src = resolve_asset(r["storageKey"], assets_dir, amap)
            fn = copy_slot(src, gdir, f"Video{slot}")
            g_videos.append({"index": slot - 1, "videoFile": f"asset_groups/{nn}/{fn}",
                             "fileName": src.name, "type": "input", "subfolder": f"asset_groups/{nn}"})

        cfp = bool(cfp_override[idx]) if cfp_override else (idx > 0)
        group = {
            "id": f"{id_prefix}_{nn}",
            "prompt": shot_prompt(shot),
            "negativePrompt": shot.get("negativePrompt", neg_default),
            "frameCount": frames, "length": frames,
            "durationSec": round(frames / frame_rate, 4),
            "start": start,
            "taskType": shot.get("segmentTaskType", ""),
            "refs": g_refs, "refAudios": g_audios, "refVideos": g_videos,
            "continuityFromPrev": shot.get("continuityFromPrev", cfp),
            "refImageSize": shot.get("refImageSize", ref_image_size),
        }
        (gdir / "group.json").write_text(json.dumps(group, ensure_ascii=False, indent=2), encoding="utf-8")
        start += frames
        total += frames

    (out / "pack.json").write_text(json.dumps({
        "format": PACK_FORMAT, "formatVersion": PACK_VERSION,
        "taskType": task_type, "widgets": widgets, "output": output,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    # ---- 包内路径 ASCII 校验 ----
    for f in out.rglob("*"):
        if f.is_file():
            check_ascii(f.relative_to(out).as_posix())

    zip_path = None
    if a.zip:
        zip_path = out.with_suffix(".mmxpack.zip")
        if zip_path.exists():
            zip_path.unlink()
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
            for f in sorted(out.rglob("*")):
                if f.is_file():
                    z.write(f, f.relative_to(out).as_posix())

    print(f"OK: {len(shots)} 段, 总帧 {total}, 输出 {out}" + (f", zip {zip_path}" if zip_path else ""))


if __name__ == "__main__":
    main()
