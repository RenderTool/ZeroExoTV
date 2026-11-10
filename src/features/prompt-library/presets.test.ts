import { describe, expect, it } from 'vitest';
import { PROMPT_PRESETS } from './presets.js';

describe('提示词预设（角色定妆参考图）', () => {
  it('角色定妆模板只读且有占位符', () => {
    expect(PROMPT_PRESETS.length).toBeGreaterThanOrEqual(2);
    const body = PROMPT_PRESETS.map((p) => p.body).join('\n');
    expect(body).toContain('专业电影级角色定妆参考图');
    expect(body).toContain('{角色描述段');
    expect(body).toContain('FRONT 正面');
    expect(body).toContain('BACK 背面');
  });

  it('画面数量写死、不诱导三视图', () => {
    for (const preset of PROMPT_PRESETS) {
      // 数量必须显式写出，模型才不会自己加视图
      expect(preset.body).toContain('画面中固定 3 个画面，数量不得增减');
      // 「三视图 / Lineup Sheet」这类名字会诱导模型多画一个侧视图
      expect(preset.body).not.toContain('三视图');
      expect(preset.body).not.toContain('Lineup');
      expect(preset.title).not.toContain('三视图');
      expect(preset.tags).not.toContain('三视图');
      // 显式禁止额外的侧面视图
      expect(preset.body).toContain('禁止侧面视图');
    }
  });

  it('全部为角色分类，不含公共/私有字段', () => {
    expect(PROMPT_PRESETS.every((p) => p.category === '角色')).toBe(true);
    expect(PROMPT_PRESETS.every((p) => !('visibility' in p))).toBe(true);
  });
});
