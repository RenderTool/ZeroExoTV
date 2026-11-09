import { describe, expect, it, vi } from 'vitest';
import { resolveUseLowVram } from './vram-mode.js';
import { fetchComfyuiMachineInfo } from './comfyui-endpoint.js';

const GB = 1024 ** 3;

describe('出片显存策略', () => {
  it('auto：低于 16GB 走低显存，高于等于 16GB 走高显存', () => {
    expect(resolveUseLowVram({ vramTotalBytes: 12 * GB, fetchedAt: 0 }, 'auto')).toBe(true);
    expect(resolveUseLowVram({ vramTotalBytes: 16 * GB, fetchedAt: 0 }, 'auto')).toBe(false);
    expect(resolveUseLowVram({ vramTotalBytes: 24 * GB, fetchedAt: 0 }, 'auto')).toBe(false);
  });

  it('读不到显存时 auto 保守走低显存', () => {
    expect(resolveUseLowVram(null, 'auto')).toBe(true);
    expect(resolveUseLowVram({ fetchedAt: 0 }, 'auto')).toBe(true);
  });

  it('手动 low / high 覆盖自动判断', () => {
    expect(resolveUseLowVram({ vramTotalBytes: 24 * GB, fetchedAt: 0 }, 'low')).toBe(true);
    expect(resolveUseLowVram({ vramTotalBytes: 8 * GB, fetchedAt: 0 }, 'high')).toBe(false);
  });

  it('连接面板读 /system_stats：GPU 名称 / 显存 / 内存 / 版本', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      system: { os: 'nt', ram_total: 64 * GB, ram_free: 32 * GB, comfyui_version: '0.3.70' },
      devices: [{ name: 'NVIDIA RTX 4090', type: 'cuda', vram_total: 24 * GB, vram_free: 20 * GB }],
    }), { status: 200 })));
    try {
      const machine = await fetchComfyuiMachineInfo('http://127.0.0.1:8188');
      expect(machine?.gpuName).toBe('NVIDIA RTX 4090');
      expect(machine?.vramTotalBytes).toBe(24 * GB);
      expect(machine?.ramTotalBytes).toBe(64 * GB);
      expect(machine?.comfyuiVersion).toBe('0.3.70');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
