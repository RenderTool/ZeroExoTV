/** 剧本「问AI」：复制当集信息给任意 Agent 修改（2026-11-12 用户要求）。 */
import { describe, expect, it } from 'vitest';
import { buildScriptAiBrief } from './script-ai-brief.js';
import type { Episode } from '../storyboard/script-types';

const episode = {
  id: 'ep-2',
  number: 2,
  title: '第二集：雨夜',
  content: '<p>正文</p>',
} as Episode;

describe('buildScriptAiBrief', () => {
  it('带项目/集定位、集标题与纯文本正文', () => {
    const text = buildScriptAiBrief({
      projectId: 'proj-1',
      episode,
      episodeIndex: 1,
      totalEpisodes: 5,
      plainText: '### 第1场：街道 · 外 · 夜\n雨下得很大。',
    });
    expect(text).toContain('get_current_project');
    expect(text).toContain('get_script');
    expect(text).toContain('proj-1');
    expect(text).toContain('episodeId=ep-2');
    expect(text).toContain('第 2 / 5 集');
    expect(text).toContain('第二集：雨夜');
    expect(text).toContain('### 第1场：街道 · 外 · 夜');
    expect(text).toContain('只改下面这一集');
  });

  it('没有 projectId 时仍给可执行指令，不出现 undefined', () => {
    const text = buildScriptAiBrief({
      episode,
      episodeIndex: 0,
      totalEpisodes: 1,
      plainText: '',
    });
    expect(text).toContain('（当前打开的项目）');
    expect(text).not.toContain('undefined');
    expect(text).toContain('（空）');
  });
});
