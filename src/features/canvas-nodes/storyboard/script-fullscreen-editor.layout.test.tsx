/**
 * script-fullscreen-editor 剧本卡片布局结构断言（2026-11-04 跳转按钮与统计条重排）
 *
 * 结构契约：
 * 1. [data-script-jump]「跳转」按钮的父级归属 = 剧集列表标题行 [data-script-episodes-header]；
 * 2. 统计容器 [data-script-stats] 不含跳转按钮，且右对齐（justify-content: flex-end）；
 * 3. 剧集行集名文字色 = 中性文字色（不用主题 accent 红 #e94560，激活态由底色/描边/字重表达）。
 *
 * 子组件（纸张编辑器）与 react-i18next / @zeroexo/plugin-theme / @/i18n/config 全部 mock，
 * EpisodeList 保持真实渲染（它是被断言的结构主体）。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';

const theme = {
  mode: 'dark',
  toolbar: {
    text: '#e5e5e5',
    textMuted: '#888888',
    accent: '#e94560',
    border: '#333',
    editorSurface: '#1b1b1b',
    editorPaper: '#141414',
  },
} as any;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, second?: unknown, third?: unknown) => {
      const base = typeof second === 'string' ? second : key;
      if (!third || typeof third !== 'object') {
        return typeof second === 'string' ? second : key;
      }
      let out = base;
      for (const [k, v] of Object.entries(third as Record<string, unknown>)) out = out.replace(`{{${k}}}`, String(v));
      return out;
    },
  }),
}));
vi.mock('@/i18n/config', () => ({ default: { t: (key: string) => key } }));
vi.mock('@zeroexo/plugin-theme', () => ({ useTheme: () => ({ theme }) }));
// 包级 index 链到 antd/fluent-emoji（jsdom 无法解析 ESM 目录导入），与既有测试同法 mock 掉
vi.mock('@zeroexo/plugin-nodes', () => ({
  nodeActionBus: { on: () => () => {}, off: () => {}, emit: () => {} },
}));
vi.mock('../script-editor/script-structured-editor', () => ({
  ScriptStructuredEditor: (): ReactElement => <div data-mock="structured-editor" />,
}));

import { App } from 'antd';
import { ScriptFullscreenEditor } from './script-fullscreen-editor';
import type { Episode } from './script-types';

const episodes: Episode[] = [
  { id: 'ep-1', number: 1, title: '第1集', content: '<p class="script-action">第一集正文。</p>', pageCount: 3 },
  {
    id: 'ep-2', number: 2, title: '第2集', pageCount: 5,
    content: '<p class="script-scene-heading">INT. 破庙大殿 - 夜</p><p class="script-action">油灯昏黄。</p><p class="script-scene-heading">EXT. 官道 - 夜</p>',
    meta: { logline: '书生夜宿破庙，鬼影上门。', tags: ['古装', '志怪'], publishNote: '建议深夜档发布。' },
  },
] as Episode[];

function renderEditor(
  activeEpisodeId = 'ep-1',
  onEpisodesChange: (eps: Episode[]) => void = () => {},
  onActiveEpisodeChange: (id: string) => void = () => {},
  onEpisodesAndActiveChange: (eps: Episode[], activeId?: string) => void = () => {},
) {
  return render(
    <App>
      <ScriptFullscreenEditor
        open
        embedded
        onClose={() => {}}
        title="测试剧本"
        episodes={episodes}
        activeEpisodeId={activeEpisodeId}
        onEpisodesChange={onEpisodesChange}
        onActiveEpisodeChange={onActiveEpisodeChange}
        onEpisodesAndActiveChange={onEpisodesAndActiveChange}
        onAddEpisode={() => {}}
      />
    </App>,
  );
}

describe('script-fullscreen-editor 剧本卡片布局', () => {
  it('跳转按钮在剧集标题行内', () => {
    const { baseElement } = renderEditor();
    const jump = baseElement.querySelector('[data-script-jump]');
    expect(jump).not.toBeNull();
    expect(jump!.closest('[data-script-episodes-header]')).not.toBeNull();
  });

  it('统计容器不含跳转按钮且右对齐', () => {
    const { baseElement } = renderEditor();
    const stats = baseElement.querySelector('[data-script-stats]') as HTMLElement;
    expect(stats).not.toBeNull();
    expect(stats.querySelector('[data-script-jump]')).toBeNull();
    expect(stats.style.justifyContent).toBe('flex-end');
  });

  it('集名文字色为中性色（非 accent 红）', () => {
    const { baseElement } = renderEditor();
    const header = baseElement.querySelector('[data-script-episodes-header]')!;
    expect(header).not.toBeNull();
    // 列表区集名（顶栏当前集标题同为中性色，不排除）均不使用 accent 红
    const titles = Array.from(baseElement.querySelectorAll('span'))
      .filter((el) => el.textContent === '第1集' || el.textContent === '第2集');
    expect(titles.length).toBeGreaterThanOrEqual(2);
    for (const el of titles) {
      expect((el as HTMLElement).style.color).not.toBe(theme.toolbar.accent);
    }
  });

  it('标题处可下拉切换集数：选项列出全部剧集，点某集回传 onActiveEpisodeChange', async () => {
    const changes: string[] = [];
    const { baseElement } = renderEditor('ep-1', () => {}, (id) => changes.push(id));
    const trigger = baseElement.querySelector('[data-script-episode-switch]') as HTMLElement;
    expect(trigger).not.toBeNull();
    expect(trigger.textContent).toContain('第1集');
    fireEvent.click(trigger);
    await waitFor(() => {
      const items = Array.from(document.querySelectorAll('.ant-dropdown-menu-item'));
      expect(items.length).toBe(2);
    });
    const second = Array.from(document.querySelectorAll('.ant-dropdown-menu-item'))
      .find((el) => el.textContent?.includes('第2集')) as HTMLElement;
    fireEvent.click(second);
    expect(changes).toEqual(['ep-2']);
  });

  /** 右键剧集行 → 打开「更多」菜单并点第 index 项（菜单文案走 i18n mock = key，按顺序取更稳） */
  async function clickMenuOfEpisode(container: HTMLElement, epId: string, index: number): Promise<void> {
    const rowText = epId === 'ep-1' ? '第1集' : '第2集';
    const episodeRow = Array.from(container.querySelectorAll('div[draggable="true"]'))
      .find((el) => (el.textContent ?? '').includes(rowText)) as HTMLElement;
    fireEvent.contextMenu(episodeRow);
    await waitFor(() => expect(document.querySelectorAll('.ant-dropdown-menu-item').length).toBeGreaterThan(index));
    const item = document.querySelectorAll('.ant-dropdown-menu-item')[index] as HTMLElement;
    expect(item).toBeTruthy();
    fireEvent.click(item);
  }

  it('编辑已有集：⋮ → 重命名 → 输入新名回车，回写该集标题', async () => {
    const changes: Episode[][] = [];
    const { baseElement } = renderEditor('ep-1', (eps) => changes.push(eps));
    await clickMenuOfEpisode(baseElement, 'ep-1', 0); // 菜单第 1 项 = 重命名
    // 重命名后行内出现输入框（限定在剧集抽屉内，避开隐藏的 file input）
    const drawer = (baseElement.querySelector('[data-script-episodes-header]') as HTMLElement).parentElement!;
    const editInput = drawer.querySelector('input') as HTMLInputElement;
    expect(editInput).toBeTruthy();
    fireEvent.change(editInput, { target: { value: '第一集（改名）' } });
    fireEvent.keyDown(editInput, { key: 'Enter' });
    expect(changes.length).toBeGreaterThan(0);
    const edited = changes.at(-1)!.find((e) => e.id === 'ep-1');
    expect(edited?.title).toBe('第一集（改名）');
  });

  it('合并到上一集：⋮ → 合并到上一集，正文拼接 + 删当前集 + 编号重排 + 选中上一集', async () => {
    const patches: Array<{ eps: Episode[]; active?: string }> = [];
    const { baseElement } = renderEditor('ep-2', () => {}, () => {}, (eps, active) => patches.push({ eps, active }));
    await clickMenuOfEpisode(baseElement, 'ep-2', 3); // 菜单第 4 项 = 合并到上一集
    expect(patches.length).toBe(1);
    const { eps, active } = patches[0]!;
    expect(eps.length).toBe(1);
    expect(eps[0]!.id).toBe('ep-1');
    expect(eps[0]!.content).toContain('第一集正文');
    expect(eps[0]!.content).toContain('INT. 破庙大殿');
    expect(eps[0]!.number).toBe(1);
    expect(active).toBe('ep-1');
  });
});
