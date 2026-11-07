/**
 * 素材选择面板一致性（2026-11-07 用户指令）
 *
 * 1) 导演台素材面板：视频条目必须有封面（poster/首帧），详情面板可播放预览；
 * 2) 主体库「选择图片/语音来源」面板：缩略图统一走 ThumbImage（旧 getResourceUrl 链取不到本地图 → 空白），
 *    悬停可预览，顶部有上传入口；
 * 3) 导入类按钮统一放顶部（导演台「导入资产」不再埋在列表底部）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('导演台素材面板：视频封面与播放', () => {
  // @ 面板已抽到共享实现（导演台与主体状态媒体共用），面板侧断言改读该文件
  const panel = read('src/shared/components/asset-pick-panel.tsx');

  it('列表行按类型走 ThumbImage（视频也出封面，不再只有图标）', () => {
    expect(panel).toContain('kind={ref.kind}');
    expect(panel).toContain('prefer="thumb"');
    expect(panel).toContain('ASSET_PICK_THUMB_SIZE');
  });

  it('详情面板视频可播（playable + 原文件），音频给播放器', () => {
    expect(panel).toContain('playable={ref.kind !== \'image\'}');
  });

  it('「导入资产」放在列表顶部（不再埋到底部）', () => {
    const listStart = panel.indexOf('data-asset-panel-list');
    const importAt = panel.indexOf('data-asset-import', listStart);
    const firstGroupAt = panel.indexOf('{groups.map', listStart);
    expect(importAt).toBeGreaterThan(-1);
    expect(firstGroupAt).toBeGreaterThan(importAt);
  });
});

describe('导演台画布资产页签（只图片/视频/音频）', () => {
  const panel = read('src/shared/components/asset-pick-panel.tsx');
  const director = read('src/features/canvas-tabs/director-prompt-panel.tsx');

  it('画布页签存在且只收媒体类型节点（文本/剧本等不列）', () => {
    expect(panel).toContain("panelTab === 'canvas'");
    expect(panel).toContain('data-canvas-media-item');
    // 画布节点 → 媒体引用的筛选在调用方（导演台）完成
    expect(director).toContain("n.type === 'image' || n.type === 'video' || n.type === 'audio'");
    expect(director).toContain("d.kind === 'image' || d.kind === 'video' || d.kind === 'audio'");
  });

  it('画布条目点击 = 走同一插入路径（占槽 + @ 引用）', () => {
    expect(panel).toContain('onPickCanvasMedia');
    expect(director).toContain('insertRef(ref)');
  });
});

describe('@ 块：删除与悬停预览', () => {
  const editor = read('src/features/canvas-tabs/mention-editor.tsx');

  it('每个 @ 块有独立删除入口（文本模型删除一次引用，可撤销）', () => {
    expect(editor).toContain('data-mention-remove');
    expect(editor).toContain('removeMention');
    expect(editor).toContain('emitChange(current.replace(re, \'\'), match.index)');
  });

  it('悬停 @ 块出大图/播放预览（portal + ThumbImage playable）', () => {
    expect(editor).toContain('data-mention-preview');
    expect(editor).toContain('createPortal');
    expect(editor).toContain('mentionPreview.slot');
  });
});

describe('主体库来源面板：预览与上传', () => {
  const panel = read('src/features/canvas-nodes/storyboard/subject-media-source-panel.tsx');
  const pickPanel = read('src/shared/components/asset-pick-panel.tsx');

  it('缩略图统一走共享面板的 ThumbImage（本地键经媒体 URL 提供者解析，不再用旧资源 URL 链）', () => {
    expect(pickPanel).toContain('ThumbImage');
    expect(panel).toContain('AssetPickPanel');
    expect(panel).not.toContain('getResourceUrl');
    expect(panel).not.toContain('AuthorizedImage');
  });

  it('悬停条目有预览区（右侧只读详情）；手动上传是面板内页签按钮', () => {
    expect(pickPanel).toContain('data-asset-detail');
    expect(pickPanel).toContain('data-asset-pick-upload');
    expect(panel).toContain('onUploadFiles');
    expect(panel).toMatch(/const TABS: AssetPickTab\[\] = \[[^\]]*'upload'/);
  });
});
