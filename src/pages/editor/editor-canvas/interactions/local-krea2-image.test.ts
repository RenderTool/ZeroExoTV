/**
 * Krea2 文生图（仅线上 ComfyUI）：尺寸规则（比例 + 百万像素 + 32 对齐）与提交协议。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveKrea2Size, KREA2_DEFAULT_STEPS } from './local-krea2-image.js';
import { submitKrea2Job } from '@/features/canvas-tabs/zeroexo-jobs-client.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveKrea2Size', () => {
  it('1MP = 1024×1024（1024² 定义，不是十进制 1,000,000）', () => {
    expect(resolveKrea2Size('1:1', 1)).toEqual({ width: 1024, height: 1024 });
  });

  it('3MP 16:9 → 32 对齐的横向尺寸', () => {
    const { width, height } = resolveKrea2Size('16:9', 3);
    expect(width % 32).toBe(0);
    expect(height % 32).toBe(0);
    expect(width).toBeGreaterThan(height);
    expect(Math.abs((width * height) / (1024 * 1024) - 3)).toBeLessThan(0.15);
  });

  it('1:1 2MP → 近似正方形且 32 对齐', () => {
    const { width, height } = resolveKrea2Size('1:1', 2);
    expect(width).toBe(height);
    expect(width % 32).toBe(0);
  });

  it('非法比例回退 1:1；像素夹在 0.5–8MP', () => {
    expect(resolveKrea2Size(undefined, 3)).toEqual({ width: 1760, height: 1760 });
    const huge = resolveKrea2Size('1:1', 99);
    expect(huge.width).toBeLessThanOrEqual(8 * 1024);
    expect(KREA2_DEFAULT_STEPS).toBe(10);
  });
});

describe('submitKrea2Job', () => {
  it('提交 kind=krea2_t2i 并保留参数', async () => {
    let sent: { kind?: string; clientId?: string; params?: Record<string, unknown> } = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ ok: true, jobId: 'zx_krea2_1', state: 'running' }), { status: 200 });
    }));
    const res = await submitKrea2Job('http://127.0.0.1:8188', {
      clientJobId: 'zx_krea2_1',
      clientId: 'cid-9',
      project: 'p1',
      episode: 'image',
      params: { prompt: '一只猫', seed: 7, steps: 10, cfg: 1, eta: 0.55, width: 1536, height: 864 },
    });
    expect(res.jobId).toBe('zx_krea2_1');
    expect(sent.kind).toBe('krea2_t2i');
    expect(sent.clientId).toBe('cid-9');
    expect(sent.params).toMatchObject({ prompt: '一只猫', steps: 10, width: 1536, height: 864 });
  });
});
