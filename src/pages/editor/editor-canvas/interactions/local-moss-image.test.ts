/** Moss Image 文生图：尺寸（1MP=1024²，16 对齐）与提交参数。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveMossSize, MOSS_DEFAULT_STEPS, MOSS_DEFAULT_CFG } from './local-moss-image.js';
import { submitMossJob } from '@/features/canvas-tabs/zeroexo-jobs-client.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveMossSize', () => {
  it('1MP 1:1 → 1024×1024，且恒 16 对齐', () => {
    expect(resolveMossSize('1:1', 1)).toEqual({ width: 1024, height: 1024 });
    for (const aspect of ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9']) {
      for (const mp of [1, 2, 3, 4]) {
        const { width, height } = resolveMossSize(aspect, mp);
        expect(width % 16).toBe(0);
        expect(height % 16).toBe(0);
      }
    }
  });

  it('16:9 1MP 为横向；9:16 为纵向', () => {
    const wide = resolveMossSize('16:9', 1);
    expect(wide.width).toBeGreaterThan(wide.height);
    const tall = resolveMossSize('9:16', 1);
    expect(tall.height).toBeGreaterThan(tall.width);
  });

  it('默认 25 步 / cfg 2.5', () => {
    expect(MOSS_DEFAULT_STEPS).toBe(25);
    expect(MOSS_DEFAULT_CFG).toBe(2.5);
  });
});

describe('submitMossJob', () => {
  it('kind=moss_image_t2i，携带 prompt/尺寸/步数/cfg/seed', async () => {
    const sent: any = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      sent.body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ ok: true, jobId: 'job-moss', state: 'queued' }), { status: 200 });
    }));
    const res = await submitMossJob('http://127.0.0.1:8188', {
      project: 'p', episode: 'image',
      params: { prompt: '一只猫', negative_prompt: '', width: 1024, height: 1024, steps: 25, cfg: 2.5, seed: 7 },
    });
    expect(res.jobId).toBe('job-moss');
    expect(sent.body.kind).toBe('moss_image_t2i');
    expect(sent.body.params).toMatchObject({ prompt: '一只猫', width: 1024, height: 1024, steps: 25, cfg: 2.5, seed: 7 });
  });
});
