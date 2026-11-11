/**
 * guide-file 单测（2026-11-07 引导数据导出）
 *
 * 引导文件只允许插件生成的 gd_xxx id（防路径穿越），经 ComfyUI /view 取回；
 * 非法/缺省 id、ComfyUI 未连接一律返回 null → 调用方给可读提示。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const endpointMock = vi.hoisted(() => ({ address: 'http://127.0.0.1:8188' }));
vi.mock('@/features/canvas-tabs/comfyui-endpoint.js', () => ({
  useComfyuiEndpointStore: { getState: () => ({ address: endpointMock.address }) },
}));

import { fetchGuideBlob, guideViewUrl, guideViewUrls, isGuideId } from './guide-file.js';

beforeEach(() => {
  endpointMock.address = 'http://127.0.0.1:8188';
});

describe('guideViewUrl', () => {
  it('合法 gd id → ComfyUI /view（output/zeroexo/guides）', () => {
    const url = guideViewUrl({ id: 'gd_abc12345' });
    expect(url).toBeTruthy();
    const u = new URL(url!);
    expect(u.origin).toBe('http://127.0.0.1:8188');
    expect(u.pathname).toBe('/view');
    expect(u.searchParams.get('filename')).toBe('gd_abc12345.safetensors');
    expect(u.searchParams.get('subfolder')).toBe('zeroexo/guides');
    expect(u.searchParams.get('type')).toBe('output');
  });

  it('非法 id / 空地址 → null（不拼路径、不发起请求）', () => {
    expect(isGuideId('gd_abc12345')).toBe(true);
    expect(isGuideId('../../secret')).toBe(false);
    expect(isGuideId('gd_')).toBe(false);
    expect(guideViewUrl({ id: '../x' })).toBeNull();
    endpointMock.address = '';
    expect(guideViewUrl({ id: 'gd_abc12345' })).toBeNull();
  });
});

describe('fetchGuideBlob', () => {
  it('取回非空 Blob；HTTP 失败返回 null', async () => {
    const blob = new Blob(['guide-bytes'], { type: 'application/octet-stream' });
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => blob }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchGuideBlob({ id: 'gd_abc12345' })).resolves.toBe(blob);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/view?'));
    vi.unstubAllGlobals();

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, blob: async () => null })));
    await expect(fetchGuideBlob({ id: 'gd_abc12345' })).resolves.toBeNull();
    vi.unstubAllGlobals();
  });

  it('当前地址取不到时回退到「产出该引导时的地址」（2026-11-11 下载没打包的修复）', async () => {
    endpointMock.address = 'http://127.0.0.1:8188';
    const calls: string[] = [];
    const blob = new Blob(['guide-bytes'], { type: 'application/octet-stream' });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(String(url));
      // 本地地址没有这个引导，云端地址才有
      if (String(url).startsWith('http://127.0.0.1:8188')) return { ok: false, blob: async () => null };
      return { ok: true, blob: async () => blob };
    }));
    await expect(fetchGuideBlob({ id: 'gd_cloud12345', baseUrl: 'https://cloud.example.com/' })).resolves.toBe(blob);
    expect(calls[0]).toContain('127.0.0.1:8188');
    expect(calls[1]).toContain('cloud.example.com/view');
    vi.unstubAllGlobals();
  });

  it('guideViewUrls：没有当前地址时仍能用产出地址', () => {
    endpointMock.address = '';
    const urls = guideViewUrls({ id: 'gd_abc12345', baseUrl: 'https://cloud.example.com' });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('cloud.example.com/view');
  });
});
