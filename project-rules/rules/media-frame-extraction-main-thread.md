---
领域: 视频抽帧 / 缩略图 / 轨道胶片条
status: active
created: 2026-09-02
last_verified: 2026-09-02
expires: 180d
superseded_by:
适用项目: zeroexo_front
触发关键词: 视频缩略图, 抽帧, filmstrip, 胶片条, Web Worker, document, OffscreenCanvas, 轨道缩略图空白, 帧缩略图不渲染
---

# Web Worker 内无 DOM：视频抽帧只能在主线程做（async onmessage 抛错 = 静默失效）

## 问题

出片工作台把视频素材拖入时间轴轨道后，clip 上的帧缩略图（胶片条）**完全画不出来**
（征集 #133，用户报障「没有准正确绘制出帧缩略图」）。

## 根因

原实现把抽帧逻辑塞进**内联 Blob Web Worker**：

```js
const workerCode = `self.onmessage = async (e) => {
  const video = document.createElement('video'); // ❌ Worker 里没有 document！
  ...
}`;
```

1. Worker 里没有 DOM，`document` 未定义 → `document.createElement('video')` 直接抛 `ReferenceError`；
2. `self.onmessage` 是 **async 函数** → 抛错变成 **unhandled rejection**，**永远不会 postMessage**；
3. 主线程 `worker.extract()` 的 Promise 永不 resolve（pending Map 也不回收）→ `frames` 恒为空数组；
4. 组件 `if (frames.length === 0) return null` → 胶片条永不渲染，且**无任何报错提示**（静默失效）。

更深一层：**视频解码只有 `HTMLVideoElement` 一条路**，而它不存在于任何 Worker（
OffscreenCanvas 能画，但没有视频解码器喂它）。所以「Worker + OffscreenCanvas 抽帧」这个方向
从选型上就是错的。

## 修复 / 正确做法

抽帧必须回**主线程**：隐藏 `<video>` + `<canvas>.drawImage`（Opencut 同款做法）。

```ts
// 1. 全局串行队列：同一时刻只解码一个视频，防多 clip 并发 seek 互相打断
const extractQueue: Array<() => Promise<void>> = [];
// 2. 单次抽帧：loadedmetadata → 逐格 seek → drawImage → toDataURL
video.addEventListener('loadedmetadata', () => {
  for (let i = 0; i < count; i++) {
    video.currentTime = lo + step * (i + 0.5); // 取每格中心，避开首帧纯黑
  }
});
video.addEventListener('seeked', () => {
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h); // cover 居中裁切
  canvas.toDataURL('image/jpeg', quality);
});
```

配套铁律：
- **任何异常路径都必须 resolve**（返回已抽到的部分），绝不 reject —— 调用方不做兜底；
- `duration` 为 `Infinity` 的经典坑：先 `video.currentTime = 1e7` 触发浏览器修正再抽；
- 超时兜底（10s）+ 抽帧区间夹到源视频真实时长；
- 缓存 key 必须包含 `frameCount`（缩放改变帧数时不能命中旧长度缓存）；
- 跨域 tainted：`toDataURL` 抛错要 try/catch 静默降级（本库走 `resolveContentUrl` 已换 blob URL，同源不触发）。

## 关键规则

1. **Worker 内无 DOM**：凡涉及 `document`/`HTMLVideoElement`/`<img>` 的逻辑一律不能进 Worker。
2. **async `onmessage` 抛错 = 静默失效**：主线程 Promise 永不 resolve 且无提示，排查成本极高；
   写 Worker 回调要么不用 async，要么在最外层 catch 并 postMessage 错误帧。
3. 视频/音频解码是主线程独占能力，抽帧这种 CPU 密集操作靠**串行队列 + 低分辨率 + 小图**
   （160×90 JPEG q0.6）控制开销，而不是靠"offload 到 Worker"。

## 教训

「Web Worker 解耦主线程」在纯计算场景是对的，但**媒体解码根本进不了 Worker** ——
想当然地把 `<video>` 塞进 Worker，得到的是永远画不出来的缩略图和一个查不到的 bug。
