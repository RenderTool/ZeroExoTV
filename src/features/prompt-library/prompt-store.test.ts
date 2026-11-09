import { beforeEach, describe, expect, it } from 'vitest';
import { loadUserPrompts, usePromptLibraryStore } from './prompt-store.js';

describe('提示词库新建/编辑/删除', () => {
  beforeEach(() => {
    localStorage.clear();
    usePromptLibraryStore.setState({ userPrompts: [] });
  });

  it('新建后持久化，并可编辑/删除', () => {
    const created = usePromptLibraryStore.getState().addPrompt({
      title: '我的三视图',
      category: '角色',
      description: '测试',
      tags: ['三视图'],
      body: '角色描述：{角色描述段}',
    });
    expect(created.readOnly).toBe(false);
    expect(loadUserPrompts()).toHaveLength(1);
    expect(loadUserPrompts()[0]?.title).toBe('我的三视图');

    usePromptLibraryStore.getState().updatePrompt(created.id, { title: '改名后' });
    expect(loadUserPrompts()[0]?.title).toBe('改名后');

    usePromptLibraryStore.getState().removePrompt(created.id);
    expect(loadUserPrompts()).toHaveLength(0);
  });

  it('损坏的本地数据不影响预设加载', () => {
    localStorage.setItem('zeroexo.promptLibrary', '{not-json');
    expect(loadUserPrompts()).toEqual([]);
  });
});
