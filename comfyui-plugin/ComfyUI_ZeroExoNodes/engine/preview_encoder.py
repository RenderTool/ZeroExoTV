"""采样预览异步编码器（对齐 KJNodes Model Preview Override）。

采样线程只提交 CPU 侧帧；编码/发送在独立线程完成。
有界队列满时直接丢帧，绝不阻塞采样。

优先 MP4（浏览器 <video>），失败回退 animated WebP，最后回退单张 JPEG。
"""
from __future__ import annotations

import base64
import io
import logging
import queue
import threading
from typing import Any, Callable

log = logging.getLogger("ComfyUI-MiniMaxH3-Director.preview_encoder")

_STOP = object()


def encode_mp4(frames: list[Any], fps: int = 8) -> bytes | None:
    """PIL 帧 -> fragmented MP4；不可用/失败返回 None。"""
    if not frames:
        return None
    try:
        import av
        from PIL import ImageOps

        out = io.BytesIO()
        # fragmented MP4：浏览器拿到字节即可边下边解（对齐 KJNodes）
        container = av.open(
            out, mode="w", format="mp4",
            options={"movflags": "frag_keyframe+empty_moov+default_base_moof"},
        )
        try:
            first = frames[0]
            stream = container.add_stream("libx264", rate=max(1, int(fps)))
            stream.width = int(first.width)
            stream.height = int(first.height)
            stream.pix_fmt = "yuv420p"
            stream.options = {"preset": "ultrafast", "tune": "zerolatency", "crf": "28"}
            # libx264 要求偶数尺寸
            if stream.width % 2:
                stream.width -= 1
            if stream.height % 2:
                stream.height -= 1
            for pil in frames:
                frame_img = pil.convert("RGB")
                if frame_img.size != (stream.width, stream.height):
                    frame_img = ImageOps.fit(frame_img, (stream.width, stream.height))
                frame = av.VideoFrame.from_image(frame_img)
                frame.pts = None
                for packet in stream.encode(frame):
                    container.mux(packet)
            for packet in stream.encode():
                container.mux(packet)
        finally:
            container.close()
        return out.getvalue() or None
    except Exception as exc:  # noqa: BLE001
        log.warning("MP4 preview encode failed: %s", exc)
        return None


def encode_webp(frames: list[Any], fps: int = 8) -> bytes | None:
    if not frames:
        return None
    try:
        out = io.BytesIO()
        duration = max(1, int(round(1000 / max(1, int(fps)))))
        frames[0].save(
            out,
            format="WEBP",
            save_all=True,
            append_images=frames[1:],
            duration=duration,
            loop=0,
            quality=80,
            method=4,
        )
        return out.getvalue() or None
    except Exception as exc:  # noqa: BLE001
        log.warning("WebP preview encode failed: %s", exc)
        return None


def encode_jpeg(frame: Any) -> bytes | None:
    try:
        out = io.BytesIO()
        frame.convert("RGB").save(out, format="JPEG", quality=80)
        return out.getvalue() or None
    except Exception:  # noqa: BLE001
        return None


def encode_preview(frames: list[Any], fps: int = 8) -> tuple[str, bytes] | None:
    """返回 (mime, bytes)。"""
    data = encode_mp4(frames, fps)
    if data:
        return "video/mp4", data
    data = encode_webp(frames, fps)
    if data:
        return "image/webp", data
    jpeg = encode_jpeg(frames[len(frames) // 2]) if frames else None
    if jpeg:
        return "image/jpeg", jpeg
    return None


class PreviewEncoder:
    """独立线程编码器；队列满丢帧，不阻塞采样。"""

    def __init__(self, max_in_flight: int = 2):
        self._q: "queue.Queue[Any]" = queue.Queue(maxsize=max_in_flight)
        self._thread = threading.Thread(target=self._run, name="zeroexo_preview_encoder", daemon=True)
        self._thread.start()

    def submit(self, fn: Callable[[], None]) -> bool:
        try:
            self._q.put_nowait(fn)
            return True
        except queue.Full:
            return False

    def _run(self) -> None:
        while True:
            item = self._q.get()
            if item is _STOP:
                return
            try:
                item()
            except Exception:  # noqa: BLE001
                log.exception("preview encoder job failed")

    def shutdown(self, timeout: float = 2.0) -> None:
        try:
            self._q.put(_STOP, timeout=timeout)
        except queue.Full:
            return
        self._thread.join(timeout=timeout)


def as_data_url(mime: str, raw: bytes) -> str:
    return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"
