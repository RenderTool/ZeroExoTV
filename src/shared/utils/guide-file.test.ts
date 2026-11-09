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

import { fetchGuideBlob, guideViewUrl, isGuideId } from './guide-file.js';

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
});
