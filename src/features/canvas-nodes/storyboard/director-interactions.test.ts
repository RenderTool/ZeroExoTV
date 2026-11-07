/**
 * 导演台交互守卫（2026-11-06 用户指令）
 *
 * 1) 时长滑块：小数点精度统一到 0.1s，且数值/警告文案定宽，拖动不改变弹层尺寸（不抖动）；
 * 2) 插槽：素材可拖到已占用插槽格上**纯替换**内容（槽位号固定不变）；
 * 3) 轨道卡片右键菜单：向前插入 / 向后插入 / 复制插入 / 删除选中；
 *    工具栏操作按功能分组（分割线）并加入「复制」。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('导演台时长滑块不抖动', () => {
  const panel = read('src/features/canvas-tabs/director-prompt-panel.tsx');

  it('时长统一到 0.1s 精度（去浮点噪声）', () => {
    expect(panel).toContain('Math.round(sec * 10) / 10');
    expect(panel).toContain('Math.round(Number(e.target.value) * 10) / 10');
    expect(panel).toContain('Math.round(durationOverSec * 10) / 10');
  });

  it('数值与警告文案定宽/单行，弹层尺寸不随小数变化', () => {
    expect(panel).toContain('minWidth: 46');
    expect(panel).toContain('minWidth: 56');
    expect(panel).toContain('whiteSpace: \'nowrap\', overflow: \'hidden\', textOverflow: \'ellipsis\'');
  });
});

describe('导演台插槽拖动替换（槽号固定）', () => {
  const panel = read('src/features/canvas-tabs/director-prompt-panel.tsx');
  // @ 面板已抽到共享实现（导演台与主体状态媒体共用），面板侧断言改读该文件
  const pickPanel = read('src/shared/components/asset-pick-panel.tsx');

  it('拖拽替换 MIME + 插槽接收 drop + 原位替换实现', () => {
    expect(pickPanel).toContain("DIRECTOR_ASSET_DRAG_MIME = 'application/x-director-asset'");
    expect(panel).toContain('onDrop={(e) => {');
    expect(panel).toContain('replaceSlotAssetAt(a.id');
    expect(panel).toContain('replaceSlotAssetAt(replaceTarget, newRef)');
    // 纯替换：沿用被替换槽的 slotNo
    expect(panel).toContain('slotNo: newRef.slotNo ?? slotInfo.byAssetId[targetId]?.slot');
  });

  it('插槽之间拖拽互换（内容换位、槽号固定）', () => {
    expect(panel).toContain('swapSlotAssets');
    expect(panel).toContain('slotSwapped');
    expect(panel).toContain('const canSwap = e.dataTransfer.types.includes(DIRECTOR_SLOT_DRAG_MIME)');
    expect(panel).toContain('refs[i] = { ...b, slotNo: aSlot ?? bSlot }');
  });

  it('素材面板条目可拖拽（拖到插槽格替换）', () => {
    expect(pickPanel).toContain('draggable');
    expect(pickPanel).toContain('setData(DIRECTOR_ASSET_DRAG_MIME');
  });
});

describe('轨道卡片右键菜单 + 工具栏分组', () => {
  const timeline = read('src/features/canvas-nodes/storyboard/storyboard-timeline.tsx');

  it('右键菜单含向前插入 / 向后插入 / 复制插入 / 删除选中', () => {
    for (const label of ['向前插入', '向后插入', '复制插入', '删除选中']) {
      expect(timeline).toContain(label);
    }
    expect(timeline).toContain('handleInsertRelative');
    expect(timeline).toContain('handleDuplicateClip');
    expect(timeline).toContain('handleDeleteSelection');
  });

  it('工具栏有「复制」，操作按功能用分割线隔开', () => {
    expect(timeline).toContain('Copy');
    expect(timeline).toContain('handleDuplicateClip(activeShotId)');
    expect(timeline).toContain('title="复制选中片段并插入到其后"');
  });
});
