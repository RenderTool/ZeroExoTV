/**
 * 胶囊常驻下载（2026-11-10 用户拍板）：图片 / 视频 / 音频三类节点都必须有同一个「下载」工具，
 * 位置一致（基础操作之后），且不依赖 hover。下载真正执行由 app 层 `node:download` 事件完成。
 */
import { describe, expect, it, vi } from 'vitest';
import { getAudioTools, getImageTools, getVideoTools } from './node-tools.js';

const mediaNode = {
  id: 'n1',
  type: 'image',
  position: { x: 0, y: 0 },
  data: { content: 'data:image/png;base64,AAAA', status: 'success' },
} as never;

function downloadTool(tools: ReturnType<typeof getImageTools>) {
  return tools.find((t) => t.id === 'download');
}

describe('胶囊常驻下载', () => {
  it('图片/视频/音频都有 download，且紧跟详情之后', () => {
    for (const tools of [getImageTools(), getVideoTools(), getAudioTools()]) {
      const ids = tools.map((t) => t.id);
      const idx = ids.indexOf('download');
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(ids[idx - 1]).toBe('detail');
    }
  });

  it('有媒体内容才显示，点击发 node:download 事件', () => {
    for (const tools of [getImageTools(), getVideoTools(), getAudioTools()]) {
      const tool = downloadTool(tools)!;
      expect(tool.visible?.(mediaNode, {} as never)).toBe(true);
      const emit = vi.fn();
      tool.run(mediaNode, { eventBus: { emit } } as never);
      expect(emit).toHaveBeenCalledWith('node:download', { node: mediaNode });
    }
  });

  it('空节点不显示下载', () => {
    const empty = { id: 'n2', type: 'image', position: { x: 0, y: 0 }, data: {} } as never;
    expect(downloadTool(getImageTools())!.visible?.(empty, {} as never)).toBe(false);
  });
});
