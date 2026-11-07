/**
 * zeroexo 作业客户端：产物路径 → /view URL 换算（浏览器只能拿 /view，不能读本地磁盘路径）。
 */
import { describe, expect, it } from 'vitest';
import { zeroexoOutputViewUrl } from './zeroexo-jobs-client.js';

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
