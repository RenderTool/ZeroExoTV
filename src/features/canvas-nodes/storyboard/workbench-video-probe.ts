/**
 * mp4 探测与兼容校验（2026-09-02）
 *
 * 与网络/plugin 解耦的纯模块：只依赖 mp4box vendor，可在 vitest(node) 直接测。
 * workbench-video-export 负责 fetch 源；本模块负责解析/判定能否无损拼接。
 */
import { getMP4Box, type Mp4Info, type Mp4Track } from '@/shared/vendor/mp4box-loader';

export interface ProbeResult {
  ok: boolean;
  error?: string;
  info?: Mp4Info;
}

/** 用 mp4box 解析单个 mp4：返回轨道构型信息（只解析 moov） */
export function probeMp4(buf: ArrayBuffer): Promise<ProbeResult> {
  return new Promise((resolve) => {
    try {
      const MP4Box = getMP4Box();
      const file = MP4Box.createFile();
      const timer = setTimeout(() => resolve({ ok: false, error: 'MP4 解析超时' }), 8000);
      file.onError = (e) => { clearTimeout(timer); resolve({ ok: false, error: `MP4 解析失败：${e}` }); };
      file.onReady = (info) => {
        clearTimeout(timer);
        resolve({ ok: true, info });
      };
      // mp4box v0.5.2 appendBuffer 要求传入「带 fileStart 属性的 ArrayBuffer」（文件内偏移，全量=0）
      (buf as unknown as { fileStart: number }).fileStart = 0;
      file.appendBuffer(buf);
      file.flush();
    } catch (e) {
      resolve({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}

/** 视频轨特征（判断多段能否无损拼接的关键签名） */
export function trackSignature(t: Mp4Track): string {
  if (t.type === 'video') return `v:${t.codec}:${t.video?.width}x${t.video?.height}`;
  if (t.type === 'audio') return `a:${t.codec}`;
  return `x:${t.codec}`;
}

export interface CompatibilityVerdict {
  compatible: boolean;
  reason?: string;
  signature?: string;
  fragmented?: boolean;
}

/** 校验多段 mp4 是否可无损拼接：全部非 fragmented + 轨道集合/编码参数一致 */
export function checkCompatibility(results: ProbeResult[]): CompatibilityVerdict {
  if (results.length === 0) return { compatible: false, reason: '没有可导出的片段' };
  if (results.some((r) => !r.ok || !r.info)) {
    const err = results.find((r) => !r.ok)?.error;
    return { compatible: false, reason: `存在无法解析的视频：${err ?? '未知错误'}` };
  }
  const infos = results.map((r) => r.info!) as Mp4Info[];
  if (infos.some((i) => i.isFragmented)) {
    return { compatible: false, reason: '包含流式(fragmented)MP4，暂不支持无损拼接' };
  }
  const sigs = infos.map((i) => i.tracks.map((t) => trackSignature(t)).sort().join('|') + `|ts=${i.timescale}`);
  const first = sigs[0];
  if (sigs.some((s) => s !== first)) {
    return { compatible: false, reason: '各片段编码参数不一致，无法无损拼接（可逐段导出）' };
  }
  return { compatible: true, signature: first, fragmented: false };
}
