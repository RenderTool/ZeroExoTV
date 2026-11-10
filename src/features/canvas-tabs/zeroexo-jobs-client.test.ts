/**
 * zeroexo 作业客户端：产物路径 → /view URL 换算（浏览器只能拿 /view，不能读本地磁盘路径）。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  fetchZeroexoJob,
  submitQwenImageJob,
  submitZeroexoJob,
  uploadZeroexoReference,
  warmZeroexoConnection,
  zeroexoOutputViewUrl,
} from './zeroexo-jobs-client.js';

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

describe('连接预热与网络层重试（点两次才生成 / 参考图被静默丢掉）', () => {
  it('warmZeroexoConnection：keep-alive 被关掉导致的首次失败重试一次即成功', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('Failed to fetch');
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(warmZeroexoConnection('http://127.0.0.1:8188')).resolves.toBeUndefined();
      expect(calls).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('warmZeroexoConnection：两次都失败也不抛错（预热是尽力而为，真正的错误留给提交暴露）', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(warmZeroexoConnection('http://127.0.0.1:8188')).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uploadZeroexoReference：POST 网络失败重试一次，参考图不再被静默丢弃', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify({ name: 'zx_input.png' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const name = await uploadZeroexoReference('http://127.0.0.1:8188', new Blob(['x']), 'zx_input.png');
      expect(name).toBe('zx_input.png');
      expect(calls).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fetchZeroexoJob：轮询 GET 抖动一次不会打死整次生成', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify({ ok: true, jobId: 'zx_1', state: 'running' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const status = await fetchZeroexoJob('http://127.0.0.1:8188', 'zx_1');
      expect(status.state).toBe('running');
      expect(calls).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
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
