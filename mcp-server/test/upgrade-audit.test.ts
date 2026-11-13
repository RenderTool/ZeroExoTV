import { describe, expect, it } from 'vitest';
import { auditProjectData } from '../src/lib/upgrade-audit.js';

describe('升级查漏补缺（audit_upgrade 纯函数）', () => {
  it('能扫出：全剧风格未设 / 主体提示词空 / 图无 prompt / 片段未分集 / 片段提示词空', () => {
    const result = auditProjectData({
      script: { episodes: [{ id: 'ep-1', number: 1 }, { id: 'ep-2', number: 2 }] },
      storyboard: {
        subjectTree: [
          { name: '秦羽', kind: 'character', states: [{ fullPrompt: '' }] },
          {
            name: '苏离',
            kind: 'character',
            states: [{ fullPrompt: '人设：古装女侠', media: [{ type: 'image', prompt: '' }] }],
          },
        ],
      },
      workbench: {
        shots: [
          { id: 'seg-1', number: 1 },
          { id: 'seg-2', number: 2, episodeId: 'ep-1', imagePrompt: '图', videoPrompt: '' },
        ],
      },
    });
    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain('GLOBAL_STYLE_UNSET');
    expect(codes).toContain('SUBJECT_PROMPT_EMPTY');
    expect(codes).toContain('SUBJECT_IMAGE_NO_PROMPT');
    expect(codes).toContain('SHOT_EPISODE_UNASSIGNED');
    expect(codes).toContain('SHOT_PROMPT_EMPTY');
    expect(result.ok).toBe(false);
  });

  it('数据已符合当前流程时 ok=true', () => {
    const result = auditProjectData({
      script: { episodes: [{ id: 'ep-1', number: 1 }], meta: { visualStyle: { presetId: 'x', prompt: '风格片段' } } },
      storyboard: {
        subjectTree: [{
          name: '秦羽',
          kind: 'character',
          states: [{ fullPrompt: '人设：…\n风格：风格片段', media: [{ type: 'image', prompt: '反推' }] }],
        }],
      },
      workbench: {
        shots: [{ id: 'seg-1', number: 1, episodeId: 'ep-1', imagePrompt: '图', videoPrompt: '视频' }],
      },
    });
    expect(result.ok).toBe(true);
    expect(result.findings).toHaveLength(0);
  });
});
