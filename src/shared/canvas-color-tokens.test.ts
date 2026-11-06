/**
 * 2026-11-05 用户要求：连线改为蓝色（默认 → hover 提亮 → 选中最强），深浅主题各一套。
 * 此处断言 edge 三态 + 拖拽预览色 token，防止后续换肤回退到品牌红。
 */
import { describe, expect, it } from 'vitest';
import { DARK_THEME, LIGHT_THEME } from '@zeroexo/shared';

describe('canvas edge color tokens', () => {
  it('深色主题：默认蓝 / hover 提亮 / 选中最强', () => {
    expect(DARK_THEME.edge.color).toBe('#2f6bff');
    expect(DARK_THEME.edge.hoverColor).toBe('#4d86ff');
    expect(DARK_THEME.edge.selectedColor).toBe('#7fa9ff');
    expect(DARK_THEME.edge.pendingColor).toBe('#4d86ff');
  });

  it('浅色主题：三态同样为蓝且逐级增强对比', () => {
    expect(LIGHT_THEME.edge.color).toBe('#2563eb');
    expect(LIGHT_THEME.edge.hoverColor).toBe('#3b82f6');
    expect(LIGHT_THEME.edge.selectedColor).toBe('#1d4ed8');
    expect(LIGHT_THEME.edge.pendingColor).toBe('#2563eb');
  });

  it('两套主题的边色都不再是品牌红', () => {
    for (const theme of [DARK_THEME, LIGHT_THEME]) {
      for (const value of Object.values(theme.edge)) {
        expect(value.toLowerCase()).not.toBe('#e94560');
      }
    }
  });
});
