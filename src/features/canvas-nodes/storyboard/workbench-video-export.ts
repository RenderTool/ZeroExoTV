/**
 * 出片工作台：导出视频拼接（2026-09-02，浏览器本地无损 remux）
 *
 * 架构（约定）：拼接在用户浏览器用 mp4box.js 完成，服务器零视频处理。
 * 本模块只做「取源」：storageKey → resolveContentUrl → fetch ArrayBuffer；
 * 解析/兼容判定在纯模块 workbench-video-probe（可在 node 单测）。
 */
import { resolveContentUrl } from '@zeroexo/plugin-nodes';
import { probeMp4, checkCompatibility, type ProbeResult } from './workbench-video-probe';

export type { ProbeResult } from './workbench-video-probe';
export { probeMp4, checkCompatibility, trackSignature } from './workbench-video-probe';

/** 解析 storageKey → 可 fetch 的鉴权 URL */
export async function resolveStorageUrl(storageKey: string): Promise<string> {
  const url = await resolveContentUrl(storageKey, '');
  if (!url) throw new Error(`无法解析视频地址：${storageKey}`);
  return url;
}

/** fetch 单个 mp4 源为 ArrayBuffer */
export async function fetchMp4Buffer(url: string): Promise<ArrayBuffer> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`下载视频失败（HTTP ${resp.status}）`);
  return await resp.arrayBuffer();
}

/**
 * 导出管线：fetch → probe → compat。
 * 兼容时返回各段 buffer 与签名；不兼容时抛出含 reason 的错误（调用方降级提示）。
 */
export async function prepareConcatSources(
  storageKeys: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ bufs: ArrayBuffer[]; signature: string; probes: ProbeResult[] }> {
  const urls = await Promise.all(storageKeys.map(resolveStorageUrl));
  const bufs: ArrayBuffer[] = [];
  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    if (!u) continue;
    bufs.push(await fetchMp4Buffer(u));
    onProgress?.(i + 1, urls.length);
  }
  const probes = await Promise.all(bufs.map(probeMp4));
  const verdict = checkCompatibility(probes);
  if (!verdict.compatible || !verdict.signature) {
    throw new Error(verdict.reason ?? '无法无损拼接');
  }
  return { bufs, signature: verdict.signature, probes };
}
