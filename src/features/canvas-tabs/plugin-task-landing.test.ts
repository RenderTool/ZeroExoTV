import { describe, expect, it } from 'vitest';
import { pluginViewUrl } from './plugin-task-landing.js';

describe('pluginViewUrl', () => {
  it('Linux output 绝对路径 → /view', () => {
    expect(pluginViewUrl('https://x.test/', '/root/comfyui/ComfyUI/output/zeroexo/p/ep/seg_1.mp4'))
      .toBe('https://x.test/view?filename=seg_1.mp4&subfolder=zeroexo%2Fp%2Fep&type=output');
  });

  it('Windows output 绝对路径 → /view', () => {
    expect(pluginViewUrl('http://127.0.0.1:8188', 'D:\\ComfyUI\\output\\zeroexo\\guides\\gd_1.safetensors'))
      .toBe('http://127.0.0.1:8188/view?filename=gd_1.safetensors&subfolder=zeroexo%2Fguides&type=output');
  });

  it('没有 /output/ 返回 null', () => {
    expect(pluginViewUrl('http://x', 'relative/seg.mp4')).toBeNull();
  });
});
