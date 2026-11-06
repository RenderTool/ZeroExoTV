/**
 * 冒烟测试（2026-09-02）：mp4box vendor 接入 + 真实 mp4 探测。
 * 用后端 storage 里真实生成的 mp4 做样本，验证 probeMp4 能读出视频轨。
 *
 * 2026-11-07：vendor 文件（src/shared/vendor/mp4box.all.min.js）与样本路径都是仓库外资产；
 * 两者缺失时整个套件跳过，避免把"资产没带"误报成代码失败（视频导出链路本身按需接入）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const VENDOR = resolve(process.cwd(), 'src/shared/vendor/mp4box.all.min.js');
const SAMPLE = 'd:/AICode/zeroexo/zeroexo-platform/zeroexo_backend/storage/resources/front/assets/c5505b4a-b7ef-44fe-afda-e22eecdcda13/08/08525239cdafce2d0299114a390a50d0f16af8147efe9e2ae335bb0818e1d9e2.mp4';

const runnable = existsSync(VENDOR) && existsSync(SAMPLE);
const describeIfAssets = runnable ? describe : describe.skip;

describeIfAssets('workbench-video-export probe 冒烟', () => {
  it('mp4box 能解析真实 mp4 并识别视频轨', async () => {
    // 动态引入：vendor 缺失时模块本身也无法加载，跳过用例不应触发解析
    const { probeMp4 } = await import('./workbench-video-probe');
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
