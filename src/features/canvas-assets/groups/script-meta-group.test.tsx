/**
 * 资产抽屉「本剧信息」分组验收（2026-11-07 用户指令）
 *
 * 1) 只在剧本 / 导演台模块挂载（drawer-tabs.test 覆盖）；
 * 2) 剧名 / 一句话概述 / 推荐标签全部可编辑，保存经 writeScript 写回实体（title + meta）。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { App as AntdApp } from 'antd';

const theme = {
  mode: 'dark',
  toolbar: {
    text: '#f5f5f4', textMuted: '#a8a29e', border: '#44403c',
    editorSurface: '#1b1b1b', editorPaper: '#141414', accent: '#e94560',
  },
} as never;

const hoisted = vi.hoisted(() => {
  const entity = {
    schemaVersion: 1,
    version: 7,
    title: '秀才住破庙',
    activeEpisodeId: 'ep-1',
    episodes: [{ id: 'ep-1', number: 1, title: '第1集', status: 'draft', content: '' }],
    meta: { logline: '书生夜宿破庙，鬼影上门。', tags: ['古装', '志怪'] },
    sourceInfo: { origin: 'imported', createdBy: 'mcp' },
    updatedAt: '2026-11-07T00:00:00.000Z',
  };
  return {
    entity,
    readScript: vi.fn(async () => entity),
    watchScript: vi.fn(() => () => {}),
    writeScript: vi.fn(async (_pid: string, patch: Record<string, unknown>) => ({ ...entity, version: 8, ...patch })),
  };
});

vi.mock('@zeroexo/plugin-theme', () => ({ useTheme: () => ({ theme }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
  }),
}));
vi.mock('@/features/canvas-tabs/canvas-tab-store.js', () => ({
  useCanvasTabStore: (sel: (s: { slotBindings: { script: string } }) => unknown) => sel({ slotBindings: { script: 'p1' } }),
}));
vi.mock('@/entities/script-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/entities/script-store.js')>();
  return {
    ...actual,
    readScript: hoisted.readScript,
    watchScript: hoisted.watchScript,
    writeScript: hoisted.writeScript,
    ScriptConflictError: class ScriptConflictError extends Error {},
  };
});

import { ScriptMetaGroup } from './ScriptMetaGroup.js';

function renderGroup() {
  return render(<AntdApp><ScriptMetaGroup theme={theme} /></AntdApp>);
}

describe('资产抽屉「本剧信息」分组', () => {
  it('带出剧名 / 一句话概述 / 推荐标签，三项都是可编辑控件', async () => {
    const { container } = renderGroup();
    await waitFor(() => expect(container.querySelector('[data-script-meta-input="title"]')).toBeTruthy());
    expect((container.querySelector('[data-script-meta-input="title"]') as HTMLInputElement).value).toBe('秀才住破庙');
    expect((container.querySelector('[data-script-meta-input="logline"]') as HTMLTextAreaElement).value)
      .toBe('书生夜宿破庙，鬼影上门。');
    // 没有只读文本版（所有条目可改）
    expect(container.querySelector('[data-script-meta-empty]')).toBeNull();
  });

  it('改剧名 + 概述 + 标签 → 保存写回 title 与 meta', async () => {
    const { container } = renderGroup();
    await waitFor(() => expect(container.querySelector('[data-script-meta-input="title"]')).toBeTruthy());
    fireEvent.change(container.querySelector('[data-script-meta-input="title"]') as HTMLInputElement, {
      target: { value: '新剧名' },
    });
    fireEvent.change(container.querySelector('[data-script-meta-input="logline"]') as HTMLTextAreaElement, {
      target: { value: '改过的整剧概述' },
    });
    fireEvent.click(container.querySelector('[data-script-meta-save]') as HTMLElement);
    await waitFor(() => expect(hoisted.writeScript).toHaveBeenCalledTimes(1));
    const patch = hoisted.writeScript.mock.calls[0]![1] as {
      baseVersion: number;
      title: string;
      meta: { logline?: string; tags?: string[] };
    };
    expect(patch.baseVersion).toBe(7);
    expect(patch.title).toBe('新剧名');
    expect(patch.meta.logline).toBe('改过的整剧概述');
    expect(patch.meta.tags).toEqual(['古装', '志怪']);
  });

  it('剧名清空时保存回落原标题（不把剧本名写空）', async () => {
    const { container } = renderGroup();
    await waitFor(() => expect(container.querySelector('[data-script-meta-input="title"]')).toBeTruthy());
    fireEvent.change(container.querySelector('[data-script-meta-input="title"]') as HTMLInputElement, {
      target: { value: '   ' },
    });
    fireEvent.click(container.querySelector('[data-script-meta-save]') as HTMLElement);
    await waitFor(() => expect(hoisted.writeScript).toHaveBeenCalled());
    const patch = hoisted.writeScript.mock.calls.at(-1)![1] as { title: string };
    expect(patch.title).toBe('秀才住破庙');
  });
});
