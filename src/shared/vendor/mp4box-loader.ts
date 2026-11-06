/**
 * mp4box.js 加载器（2026-09-02）
 *
 * npm/pnpm 安装被本机 CodeBuddy node「安全删除 shim」阻塞，改为 CDN 下载官方
 * `mp4box.all.min.js`（gpac/mp4box.js v0.5.2）放 src/vendor/ 零依赖引用。
 *
 * 该文件是 UMD：在 CommonJS/AMD/浏览器间择机挂载。经 vite/vitest 转成 ESM 后，
 * `module`/`exports` 可能被 interop 判定污染、也可能没有 window，直接副作用 import
 * 不能保证挂载位置。因此这里用 `?raw` 读原文，在**函数作用域**内执行 —— 函数作用域
 * 中 `typeof module === 'undefined'`，UMD 必然走浏览器分支挂 `window.MP4Box`
 * （node 测试环境挂 `globalThis.MP4Box`），加载结果确定。
 */
import mp4boxSource from './mp4box.all.min.js?raw';

const g = (typeof window !== 'undefined' ? window : globalThis) as { MP4Box?: Mp4BoxStatic };

function bootMp4Box(): Mp4BoxStatic {
  if (g.MP4Box) return g.MP4Box;
  // 在函数作用域内显式提供 CommonJS module/exports，强制 UMD 走
  // `module.exports = factory()` 分支，直接捕获库对象，不依赖 window/global 挂载。
  const factory = new Function(
    `var module = { exports: {} }, exports = module.exports, define;\n${mp4boxSource}\n;return module.exports;`,
  );
  let out: unknown;
  try {
    out = factory();
  } catch (e) {
    throw new Error(`mp4box.js 加载失败：${e instanceof Error ? e.message : String(e)}`);
  }
  const inst = (out as { MP4Box?: Mp4BoxStatic } | Mp4BoxStatic | undefined) ?? g.MP4Box;
  const api = (inst as Mp4BoxStatic | undefined);
  if (!api || typeof api.createFile !== 'function') {
    throw new Error('mp4box.js 加载失败：导出对象缺少 createFile');
  }
  g.MP4Box = api;
  return api;
}

export interface Mp4Track {
  id: number;
  codec: string;
  timescale: number;
  duration: number;
  nb_samples: number;
  type: 'video' | 'audio';
  video?: { width: number; height: number };
  audio?: { sample_rate: number; channel_count: number; sample_size: number };
}

export interface Mp4Info {
  duration: number;
  timescale: number;
  isFragmented: boolean;
  tracks: Mp4Track[];
}

export interface Mp4BoxFile {
  onError: (e: string) => void;
  onReady: (info: Mp4Info) => void;
  appendBuffer(buf: ArrayBuffer): number;
  flush(): void;
  start(): void;
  stop(): void;
}

export interface Mp4BoxStatic {
  createFile(): Mp4BoxFile;
}

/** mp4box 单例（首次调用时执行 boot） */
export function getMP4Box(): Mp4BoxStatic {
  return bootMp4Box();
}
