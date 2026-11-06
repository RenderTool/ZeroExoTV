/**
 * VideoFilmstrip - 轨道 clip 的 OpenCut 式视频帧缩略图
 *
 * 对 clip 绑定的视频按 [trimStart, trimEnd] 区间抽 N 帧（seek + canvas 截帧），
 * 横向平铺铺满 clip 宽度，形成胶片条式缩略图。
 *
 * ⚠️ 2026-09-02 重大修复（征集 #133）：抽帧必须在**主线程**完成。
 * 原实现把抽帧塞进内联 Blob Worker，但 Worker 内没有 DOM —— `document` 未定义，
 * workerCode 首行 `document.createElement('video')` 直接抛 ReferenceError；
 * `onmessage` 是 async 函数，异常变成 unhandled rejection，永远不 postMessage，
 * 主线程 Promise 永不 resolve → frames 恒为空 → 胶片条永远画不出来。
 * 视频解码只有 `<video>` 一条路（`HTMLVideoElement` 不存在于 Worker），
 * 因此改为主线程隐藏 video + canvas.drawImage（Opencut 同款做法）。
 *
 * 设计要点：
 * - 全局串行队列：同一时刻只解码一个视频，避免多 clip 并发 seek 互相打断、把主线程打满
 * - 两级缓存：内存 LRU，key = `storageKey#trimStart#trimEnd#frameCount`
 * - 小尺寸低画质：160×90 JPEG q0.6，够看且不占内存
 * - 超时兜底 + 时长修正（duration 为 Infinity 的经典坑：seek 到 1e7 触发浏览器修正）
 * - 逐帧 setState：抽到一帧就铺一帧，避免整批等待造成长时间空白
 */
import { useEffect, useRef, useState } from 'react';
import { resolveContentUrl } from '@zeroexo/plugin-nodes';

/** 抽帧结果缓存：key → 帧 dataURL 数组 */
const filmstripCache = new Map<string, string[]>();

/** LRU 缓存上限：保留最近 50 条，避免内存过度增长 */
const MAX_CACHE_SIZE = 50;

/** 清理 LRU：超过上限删除最旧的 10 条 */
function lruCleanup(): void {
  if (filmstripCache.size > MAX_CACHE_SIZE) {
    const keys = Array.from(filmstripCache.keys());
    keys.slice(0, 10).forEach((k) => filmstripCache.delete(k));
  }
}

/** 生成缓存 key：按裁剪区间 + 帧数精确匹配（帧数进 key：缩放改变帧数时不能命中旧长度缓存） */
function getCacheKey(storageKey: string, trimStart: number, trimEnd: number, frameCount: number): string {
  return `${storageKey}#${trimStart.toFixed(2)}#${trimEnd.toFixed(2)}#${frameCount}`;
}

/** 单个视频解码总超时（ms）：超时就返回已抽到的帧，绝不无限挂起 */
const EXTRACT_TIMEOUT_MS = 10000;

/** 抽帧参数 */
export interface ExtractFramesParams {
  url: string;
  count: number;
  /** 裁切起点（秒，源视频坐标） */
  start: number;
  /** 裁切终点（秒，源视频坐标） */
  end: number;
  frameWidth: number;
  frameHeight: number;
  quality: number;
  /** 每抽到一帧回调（逐帧铺满，避免长时间空白） */
  onFrame?: (frame: string, index: number) => void;
}

/**
 * 主线程抽一帧：把 video 当前画面按 cover 规则绘到 canvas（居中裁切不拉伸），
 * 返回 JPEG dataURL；未就绪/跨域 tainted 时静默返回 null。
 */
function drawFrame(video: HTMLVideoElement, w: number, h: number, quality: number): string | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // cover 裁剪：居中裁切，不拉伸变形
  const scale = Math.max(w / video.videoWidth, h / video.videoHeight);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (video.videoWidth - sw) / 2;
  const sy = (video.videoHeight - sh) / 2;
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
  try {
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    // 跨域 tainted canvas：静默降级
    return null;
  }
}

/**
 * 抽取 N 帧（async 顺序 seek）。
 * 契约：任何异常路径都必须 resolve（返回已抽到的部分），绝不 reject —— 调用方不做兜底。
 */
async function extractFrames(params: ExtractFramesParams): Promise<string[]> {
  const { url, count, start, end, frameWidth, frameHeight, quality, onFrame } = params;
  const frames: string[] = [];
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';

  let settled = false;
  let timeoutId: number | undefined;

  const cleanup = (): void => {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    video.removeAttribute('src');
    try { video.load(); } catch { /* ignore */ }
  };

  return new Promise<string[]>((resolve) => {
    const finish = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(frames);
    };

    timeoutId = window.setTimeout(finish, EXTRACT_TIMEOUT_MS);

    /** 等待视频 seek 到 target 并抓帧；失败立即结束 */
    const seekAndGrab = (target: number): Promise<boolean> => new Promise<boolean>((done) => {
      let doneOnce = false;
      const settle = (ok: boolean): void => {
        if (doneOnce) return;
        doneOnce = true;
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onErr);
        done(ok);
      };
      const onSeeked = (): void => {
        const frame = drawFrame(video, frameWidth, frameHeight, quality);
        if (frame) {
          frames.push(frame);
          onFrame?.(frame, frames.length - 1);
        }
        settle(!!frame);
      };
      const onErr = (): void => settle(false);
      video.addEventListener('seeked', onSeeked);
      video.addEventListener('error', onErr);
      try {
        video.currentTime = target;
      } catch {
        settle(false);
      }
    });

    video.onerror = finish;
    video.onloadedmetadata = () => {
      void (async () => {
        // 经典坑：部分视频 duration 为 Infinity，seek 到极大值触发浏览器修正真实时长
        if (!Number.isFinite(video.duration) || video.duration <= 0) {
          await new Promise<void>((r) => {
            const onDur = (): void => { video.removeEventListener('durationchange', onDur); r(); };
            video.addEventListener('durationchange', onDur);
            try { video.currentTime = 1e7; } catch { /* ignore */ }
            window.setTimeout(() => { video.removeEventListener('durationchange', onDur); r(); }, 1500);
          });
        }
        if (!Number.isFinite(video.duration) || video.duration <= 0) { finish(); return; }

        // 抽帧区间夹到真实时长内
        const lo = Math.max(0, Math.min(start, video.duration));
        const hi = Math.max(lo + 0.05, Math.min(end, video.duration));
        const span = hi - lo;
        const step = span / count;
        for (let i = 0; i < count; i++) {
          // 取每格中心，避免首帧纯黑
          const target = Math.min(hi - 0.02, lo + step * (i + 0.5));
          const ok = await seekAndGrab(target);
          if (!ok) break;
        }
        finish();
      })();
    };

    video.src = url;
  });
}

// ===== 全局串行队列：同一时刻只解码一个视频 =====
type QueueTask = () => Promise<void>;
const extractQueue: QueueTask[] = [];
let queueRunning = false;

function runQueue(): void {
  if (queueRunning) return;
  const next = extractQueue.shift();
  if (!next) return;
  queueRunning = true;
  void next().finally(() => {
    queueRunning = false;
    runQueue();
  });
}

function enqueue(task: QueueTask): void {
  extractQueue.push(task);
  runQueue();
}

export interface VideoFilmstripProps {
  /** 视频素材 storageKey */
  storageKey?: string;
  /** 裁剪起点（秒，相对于源视频） */
  trimStart?: number;
  /** 裁剪终点（秒，相对于源视频）；缺省时用 clipDuration 推算 */
  trimEnd?: number;
  /** clip 时长（秒）—— trimEnd 缺失时的推算依据 */
  clipDuration?: number;
  /** 抽帧数量（默认根据 clip 宽度自适应） */
  frameCount?: number;
  /** 缩略图每帧宽度（像素），默认 160 */
  frameWidth?: number;
  /** 缩略图每帧高度（像素），默认 90 */
  frameHeight?: number;
}

export function VideoFilmstrip({
  storageKey,
  trimStart = 0,
  trimEnd,
  clipDuration,
  frameCount = 6,
  frameWidth = 160,
  frameHeight = 90,
}: VideoFilmstripProps) {
  const [frames, setFrames] = useState<string[]>([]);
  /** 代数令牌：storageKey/区间变化时让上一轮回调失效（队列里可能还压着旧任务） */
  const generationRef = useRef(0);

  useEffect(() => {
    if (!storageKey) {
      setFrames([]);
      return;
    }

    const count = Math.max(1, Math.floor(frameCount));
    const start = Math.max(0, trimStart);
    // 终点兜底：优先 trimEnd，其次 clipDuration 推算，最后 start + count × 0.5（极端缺省）
    const end = Math.max(
      start + 0.05,
      trimEnd ?? (clipDuration && clipDuration > 0 ? start + clipDuration : start + count * 0.5),
    );

    const cacheKey = getCacheKey(storageKey, start, end, count);
    const cached = filmstripCache.get(cacheKey);
    if (cached) {
      setFrames(cached);
      return;
    }

    const generation = ++generationRef.current;
    let cancelled = false;
    setFrames([]);

    enqueue(async () => {
      if (cancelled || generation !== generationRef.current) return;
      let url = '';
      try {
        url = await resolveContentUrl(storageKey, '');
      } catch {
        return;
      }
      if (cancelled || generation !== generationRef.current || !url) return;

      const collected: string[] = [];
      const extracted = await extractFrames({
        url,
        count,
        start,
        end,
        frameWidth,
        frameHeight,
        quality: 0.6,
        onFrame: (frame) => {
          collected.push(frame);
          // 逐帧铺满：抽到一帧就渲染一帧，避免整批等待造成长时间空白
          if (!cancelled && generation === generationRef.current) setFrames([...collected]);
        },
      });

      if (cancelled || generation !== generationRef.current) return;
      const result = extracted.length > 0 ? extracted : collected;
      if (result.length === 0) return; // 抽帧失败静默：clip 显示状态底色
      filmstripCache.set(cacheKey, result);
      lruCleanup();
      setFrames(result);
    });

    return () => {
      cancelled = true;
    };
  }, [storageKey, trimStart, trimEnd, clipDuration, frameCount, frameWidth, frameHeight]);

  if (frames.length === 0) return null;

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', pointerEvents: 'none' }}>
      {frames.map((f, i) => (
        <img
          key={i}
          src={f}
          alt=""
          draggable={false}
          style={{ flex: '1 1 0', minWidth: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ))}
    </div>
  );
}
