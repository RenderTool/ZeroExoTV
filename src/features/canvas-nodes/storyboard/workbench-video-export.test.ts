/**
 * 冒烟测试（2026-09-02）：mp4box vendor 接入 + 真实 mp4 探测。
 * 用后端 storage 里真实生成的 mp4 做样本，验证 probeMp4 能读出视频轨。
 * 样本路径固定，若删除需更新。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { probeMp4 } from './workbench-video-probe';

const SAMPLE = 'd:/AICode/zeroexo/zeroexo-platform/zeroexo_backend/storage/resources/front/assets/c5505b4a-b7ef-44fe-afda-e22eecdcda13/08/08525239cdafce2d0299114a390a50d0f16af8147efe9e2ae335bb0818e1d9e2.mp4';

describe('workbench-video-export probe 冒烟', () => {
  it('mp4box 能解析真实 mp4 并识别视频轨', async () => {
    const buf = readFileSync(SAMPLE);
    expect(buf.byteLength).toBeGreaterThan(0);
    // 转成 ArrayBuffer（readFileSync 返回 Buffer）
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const res = await probeMp4(ab);
    expect(res.ok, res.error ?? 'no error').toBe(true);
    expect(res.info?.tracks.some((t) => t.type === 'video')).toBe(true);
    // 真实样本是音视频双轨，可导出性签名必须覆盖两轨
    expect(res.info?.tracks.some((t) => t.type === 'audio')).toBe(true);
  });
});
