/**
 * 基础状态提示词模板：画面数量必须写死，不能出现「三视图 / Lineup Sheet」这类诱导名字。
 */
import { describe, expect, it } from 'vitest';
import { buildBaseStatePrompt } from './subject-prompt-templates.js';

describe('buildBaseStatePrompt（角色定妆）', () => {
  it('明写「固定 3 个画面、数量不得增减」，并禁止侧面视图', () => {
    const text = buildBaseStatePrompt('character', { roleDesc: '冷面剑客' });
    expect(text).toContain('固定 3 个画面，数量不得增减');
    expect(text).toContain('禁止侧面视图');
    expect(text).toContain('冷面剑客');
  });

  it('正文不再出现「三视图 / Lineup Sheet」', () => {
    const text = buildBaseStatePrompt('character', { name: '苏离' });
    expect(text).not.toContain('三视图');
    expect(text).not.toContain('Lineup');
  });
});
