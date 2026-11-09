import { describe, expect, it } from 'vitest';
import { PROMPT_PRESETS } from './presets.js';

describe('提示词预设（角色三视图）', () => {
  it('来自 zerovideoAgent 的角色三视图模板，只读且有占位符', () => {
    expect(PROMPT_PRESETS.length).toBeGreaterThanOrEqual(2);
    const body = PROMPT_PRESETS.map((p) => p.body).join('\n');
    expect(body).toContain('专业电影级角色定妆参考图');
    expect(body).toContain('{角色描述段');
    expect(body).toContain('FRONT 正面');
    expect(body).toContain('BACK 背面');
  });

  it('全部为角色分类，不含公共/私有字段', () => {
    expect(PROMPT_PRESETS.every((p) => p.category === '角色')).toBe(true);
    expect(PROMPT_PRESETS.every((p) => !('visibility' in p))).toBe(true);
  });
});
