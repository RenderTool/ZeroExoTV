/**
 * script-tab-content 全链路撤销落盘单测（2026-11-04 删除丢内容修复·断言③）
 *
 * 链路：ScriptStructuredEditor（删除段落 → Ctrl+Z）
 *   → onChange → ScriptFullscreenEditor.handleContentChange → onEpisodesChange
 *   → ScriptTabContent（markDirty → 600ms 防抖 → writeScript baseVersion 乐观锁）
 *
 * 断言：撤销后的落盘内容与界面一致——
 *   删除段落 → 防抖写盘（content = 删除后）；
 *   Ctrl+Z → 同一条防抖写盘路径再次写入（content = 删除前 = 界面当前内容）。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { App } from 'antd';

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
  useTranslation: () => ({ t: (key: string, opts?: unknown) => (typeof opts === 'string' ? opts : key) }),
}));
vi.mock('@/i18n/config', () => ({ default: { t: (key: string) => key } }));
vi.mock('i18next', () => ({
  default: {
    t: (key: string) => key,
    use: () => ({ init: () => Promise.resolve() }),
  },
  createInstance: () => ({ use: () => ({ init: () => Promise.resolve() }) }),
}));
vi.mock('@zeroexo/plugin-theme', () => ({ useTheme: () => ({ theme }) }));
vi.mock('@zeroexo/plugin-nodes', () => ({
  nodeActionBus: { on: () => () => {}, off: () => () => {}, emit: () => {} },
}));
vi.mock('@/shared/components/index.js', () => ({
  SimpleSelect: (): React.ReactElement => <div data-mock="simple-select" />,
}));

const INITIAL_HTML =
  '<p class="script-action">第一段</p>'
  + '<p class="script-action">第二段</p>'
  + '<p class="script-action">第三段</p>';

const baseEntity = {
  schemaVersion: 1,
  version: 1,
  title: '测试剧',
  activeEpisodeId: 'ep-1',
  episodes: [
    { id: 'ep-1', number: 1, title: '第1集', content: INITIAL_HTML, status: 'draft' },
  ],
  sourceInfo: { origin: 'created', createdBy: 'editor-page' as const },
  updatedAt: '2026-11-04T00:00:00.000Z',
};

// 唯一写者 mock：保留纯函数（EpisodeList/编辑器标题派生用），覆盖 IO 三件套
vi.mock('@/entities/script-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/entities/script-store.js')>();
  return {
    ...actual,
    readScript: vi.fn(async () => JSON.parse(JSON.stringify(baseEntity))),
    writeScript: vi.fn(async (_pid: string, patch: { episodes?: unknown[]; activeEpisodeId?: string }) => ({
      ...JSON.parse(JSON.stringify(baseEntity)),
      version: baseEntity.version + 1,
      episodes: (patch.episodes ?? baseEntity.episodes) as unknown[],
      activeEpisodeId: patch.activeEpisodeId ?? baseEntity.activeEpisodeId,
    })),
    watchScript: vi.fn(() => () => {}),
  };
});

import { ScriptTabContent } from '../script-tab-content';
import { useCanvasTabStore } from '../canvas-tab-store';
import { writeScript } from '@/entities/script-store.js';

const writeScriptMock = vi.mocked(writeScript);

function textareas(container: HTMLElement): HTMLTextAreaElement[] {
  return Array.from(container.querySelectorAll('textarea')) as HTMLTextAreaElement[];
}

/** 等待防抖写盘（ScriptTabContent 防抖 600ms） */
const waitDebounce = (): Promise<void> => new Promise((r) => setTimeout(r, 800));

describe('script-tab-content 撤销后落盘与界面一致（③）', () => {
  beforeEach(() => {
    writeScriptMock.mockClear();
    useCanvasTabStore.setState({
      activeTabKey: 'script',
      slotBindings: { script: 'proj-undo-1', storyboard: null, workbench: null },
    });
  });

  it('删除段落 → 防抖 writeScript(baseVersion=1)；Ctrl+Z → 同一路径写回删除前内容', async () => {
    const { container } = render(
      <App>
        <ScriptTabContent onReinitScript={() => {}} />
      </App>,
    );

    // 编辑器载入（readScript 异步）
    await waitFor(() => expect(textareas(container)).toHaveLength(3));
    expect(textareas(container).map((t) => t.value)).toEqual(['第一段', '第二段', '第三段']);

    // 删除第 2 段
    const delBtns = Array.from(container.querySelectorAll('button'))
      .filter((b) => b.title === 'scriptEditor.deleteParagraph');
    expect(delBtns).toHaveLength(3);
    fireEvent.click(delBtns[1]!);
    await waitFor(() => expect(textareas(container)).toHaveLength(2));

    // 防抖落盘：baseVersion=1（乐观锁），content = 删除后
    await waitFor(() => expect(writeScriptMock).toHaveBeenCalledTimes(1), { timeout: 3000 });
    const firstCall = writeScriptMock.mock.calls[0]!;
    expect(firstCall[0]).toBe('proj-undo-1');
    expect(firstCall[1].baseVersion).toBe(1);
    const savedAfterDelete = firstCall[1].episodes?.[0]?.content ?? '';
    expect(savedAfterDelete).toContain('第一段');
    expect(savedAfterDelete).not.toContain('第二段');
    expect(savedAfterDelete).toContain('第三段');

    // Ctrl+Z 撤销（同一 onChange → markDirty → 防抖 → writeScript 路径）
    fireEvent.keyDown(textareas(container)[0]!, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(textareas(container)).toHaveLength(3));
    await waitFor(() => expect(writeScriptMock).toHaveBeenCalledTimes(2), { timeout: 3000 });

    const secondCall = writeScriptMock.mock.calls[1]!;
    const savedAfterUndo = secondCall[1].episodes?.[0]?.content ?? '';
    // 落盘内容 === 删除前内容 === 界面当前内容
    expect(savedAfterUndo).toBe(INITIAL_HTML);
    expect(textareas(container).map((t) => t.value)).toEqual(['第一段', '第二段', '第三段']);

    await waitDebounce(); // 清理在途定时器
  });
});
