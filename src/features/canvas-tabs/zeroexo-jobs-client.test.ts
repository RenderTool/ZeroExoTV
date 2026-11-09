/**
 * zeroexo 作业客户端：产物路径 → /view URL 换算（浏览器只能拿 /view，不能读本地磁盘路径）。
 */
import { describe, expect, it, vi } from 'vitest';
import { submitQwenImageJob, submitZeroexoJob, zeroexoOutputViewUrl } from './zeroexo-jobs-client.js';

describe('zeroexoOutputViewUrl', () => {
  it('Windows 绝对路径：取 output 之后的子目录 + 文件名', () => {
    const url = zeroexoOutputViewUrl(
      'http://127.0.0.1:8188',
      'D:\\ComfyUI\\ComfyUI_windows_portable\\ComfyUI\\output\\zeroexo\\z6GrKXXM6HxK\\ep01\\seg_00001.mp4',
    );
    expect(url).toBe(
      'http://127.0.0.1:8188/view?filename=seg_00001.mp4&subfolder=zeroexo%2Fz6GrKXXM6HxK%2Fep01&type=output',
    );
  });

  it('Linux/容器路径同样成立', () => {
    const url = zeroexoOutputViewUrl('/base/', '/app/ComfyUI/output/zeroexo/p/ep01/seg_00002.mp4');
    expect(url).toBe('/base/view?filename=seg_00002.mp4&subfolder=zeroexo%2Fp%2Fep01&type=output');
  });

  it('不在 output 目录下 → null（不瞎猜路径）', () => {
    expect(zeroexoOutputViewUrl('http://x', 'D:\\tmp\\seg.mp4')).toBeNull();
    expect(zeroexoOutputViewUrl('http://x', '')).toBeNull();
  });
});

describe('submitZeroexoJob', () => {
  it('把预览 /ws 的 clientId 透传给插件（否则实时帧发不到预览连接）', async () => {
    let sent: { clientId?: string; kind?: string } = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ ok: true, jobId: 'zx_v1', state: 'running' }), { status: 200 });
    }));
    try {
      await submitZeroexoJob('http://127.0.0.1:8188', {
        clientJobId: 'zx_v1',
        clientId: 'preview-client-1',
        project: 'p1',
        episode: 'ep01',
        params: {
          prompt: 'test', width: 100, height: 100, frames: 49, steps: 1, cfg: 1, seed: 1,
        } as never,
      });
      expect(sent.kind).toBe('reference_video');
      expect(sent.clientId).toBe('preview-client-1');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('submitQwenImageJob', () => {  it('提交 kind=qwen_image_edit，并保留编辑参数（含遮罩）', async () => {
    let sent: { kind?: string; params?: Record<string, unknown> } = {};
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ ok: true, jobId: 'zx_img_1', state: 'running' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const res = await submitQwenImageJob('http://127.0.0.1:8188', {
        clientJobId: 'zx_img_1',
        project: 'p1',
        episode: 'image',
        params: {
          edit_prompt: '换成红色外套', input_image: 'a.png', mask_image: 'm.png',
          seed: 7, steps: 25, cfg: 1, denoise: 1, edit_mode: false, use_llm_enhance: true,
          width: 1344, height: 1008,
        },
      });
      expect(res.jobId).toBe('zx_img_1');
      expect(sent.kind).toBe('qwen_image_edit');
      expect(sent.params?.mask_image).toBe('m.png');
      expect(sent.params?.use_llm_enhance).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
