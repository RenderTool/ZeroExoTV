/**
 * script-snapshot-panel UI 单测（2026-11-04 快照/版本功能；2026-11-05 补手动删除）
 *
 * 断言：面板渲染（列表+滚动容器）、行展示时间/来源/字数/差异摘要、
 * 预览只读正文、手动创建快照调用 service、恢复走二次确认 → onRestore 回调；
 * 手动删除：软删即时移除+计数同步、撤销完整恢复、超时真删、连续删除合并提示、
 * 删除最新版二次确认、预览中删除关闭预览、删除中禁止恢复。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { App } from 'antd';

const theme = {
  mode: 'dark',
  toolbar: { text: '#e5e5e5', textMuted: '#888', accent: '#e94560', border: '#333', editorSurface: '#1b1b1b', editorPaper: '#141414' },
} as any;

// t mock：字符串第二参 = defaultValue 原样返回；对象第二参 = 插值模板（模拟 i18next interpolation）
const I18N_TEMPLATES: Record<string, string> = {
  'scriptEditor.scriptSnapshot.meta': '{{n}} 个版本 · {{size}}',
  'scriptEditor.scriptSnapshot.deleted': '已删除 {{count}} 个版本',
};
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: string | Record<string, unknown>) => {
      if (typeof opts === 'string') return opts;
      if (opts && typeof opts === 'object') {
        const o = opts as Record<string, unknown>;
        const tpl = (typeof o.defaultValue === 'string' ? o.defaultValue : null) ?? I18N_TEMPLATES[key] ?? key;
        return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m: string, k: string) => String(o[k] ?? ''));
      }
      return I18N_TEMPLATES[key] ?? key;
    },
  }),
}));
vi.mock('@zeroexo/plugin-theme', () => ({ useTheme: () => ({ theme }) }));

const entityA = { title: '剧', episodes: [{ id: 'e1', number: 1, title: '第1集', content: '<p class="script-action">旧版正文内容</p>', status: 'draft' }] };
const entityB = { title: '剧', episodes: [{ id: 'e1', number: 1, title: '第1集', content: '<p class="script-action">新版正文内容变长了</p>', status: 'draft' }] };

// listSnapshots 契约：按文件名字典序 asc（旧 → 新）；createdAt 用无时区 ISO（本地解析，断言时区无关）
const snapsOnDisk = () => ([
  { schemaVersion: 1, type: 'script', reason: 'manual', createdAt: '2026-11-04T11:00:00', name: '定稿', hash: 'a', entity: entityA, fileName: 'snap-1.json' },
  { schemaVersion: 1, type: 'script', reason: 'auto', createdAt: '2026-11-04T12:00:00', hash: 'b', entity: entityB, fileName: 'snap-2.json' },
]);
const listSnapshots = vi.fn(async () => snapsOnDisk());
const ensureLegacyMigrated = vi.fn(async () => {});
const deleteSnapshotFile = vi.fn(async () => {});
const undeleteSnapshot = vi.fn(async () => {});
vi.mock('@/entities/snapshot-store.js', () => ({
  listSnapshots: (...args: unknown[]) => listSnapshots(...(args as [])),
  ensureLegacyMigrated: (...args: unknown[]) => ensureLegacyMigrated(...(args as [])),
  deleteSnapshotFile: (...args: unknown[]) => deleteSnapshotFile(...(args as [])),
  undeleteSnapshot: (...args: unknown[]) => undeleteSnapshot(...(args as [])),
}));

const createScriptSnapshot = vi.fn(async () => null);
vi.mock('@/entities/script-store.js', () => ({
  createScriptSnapshot: (...args: unknown[]) => createScriptSnapshot(...(args as [])),
}));

import { ScriptSnapshotPanel } from './script-snapshot-panel';

function renderPanel(
  onRestore: (s: unknown) => Promise<void>,
  opts: { undoWindowMs?: number } = {},
): HTMLElement {
  const { container } = render(
    <App>
      <ScriptSnapshotPanel
        projectId="p1"
        onClose={() => {}}
        onRestore={onRestore as never}
        accent="#e94560"
        border="#333"
        text="#e5e5e5"
        textMuted="#888"
        surface="#1b1b1b"
        undoWindowMs={opts.undoWindowMs}
      />
    </App>,
  );
  return container;
}

async function clickDelete(container: HTMLElement, fileName: string): Promise<void> {
  const btn = await waitFor(() => {
    const el = container.querySelector(`button[data-snapshot-delete="${fileName}"]`) as HTMLElement;
    expect(el).not.toBeNull();
    return el;
  });
  fireEvent.click(btn);
}

/** 点击 antd 确认弹窗的主按钮（弹窗渲染在 container 外，查 document） */
async function confirmModal(): Promise<void> {
  const okBtn = await waitFor(() => {
    const el = Array.from(document.querySelectorAll('.ant-modal .ant-btn-primary')).pop() as HTMLElement;
    expect(el).not.toBeUndefined();
    return el;
  });
  fireEvent.click(okBtn);
}

describe('script-snapshot-panel（版本面板）', () => {
  beforeEach(() => {
    listSnapshots.mockClear();
    ensureLegacyMigrated.mockClear();
    createScriptSnapshot.mockClear();
    deleteSnapshotFile.mockClear();
    undeleteSnapshot.mockClear();
    listSnapshots.mockImplementation(async () => snapsOnDisk());
  });

  it('渲染列表：行含时间/来源/字数/与上一版差异摘要；头部计数；容器为滚动区', async () => {
    const container = renderPanel(() => Promise.resolve());
    const list = await waitFor(() => {
      const el = container.querySelector('[data-snapshot-list]') as HTMLElement;
      expect(el).not.toBeNull();
      return el;
    });
    expect(list.style.overflowY).toBe('auto'); // 列表 + 滚动，不铺满整屏
    // 新→旧两行：第一行 auto（12:00），第二行 manual 有命名 → 显示「定稿」（命名优先于时间）
    expect(list.textContent).toContain('2026-11-04 12:00:00');
    expect(list.textContent).toContain('定稿');
    // 字数与差异：旧「旧版正文内容」(6字) → 新「新版正文内容变长了」(9字)，无公共前后缀
    const diff = list.querySelector('[data-snapshot-diff]');
    expect(diff?.textContent).toBe('+9 / -6');
    // 头部计数/占用同步展示
    const meta = container.querySelector('[data-snapshot-meta]');
    expect(meta?.textContent).toContain('2 个版本');
    expect(ensureLegacyMigrated).toHaveBeenCalledWith('p1'); // 打开面板触发一次性迁移
  });

  it('预览：只读查看该版本正文（不改当前编辑内容）', async () => {
    const container = renderPanel(() => Promise.resolve());
    const previewBtns = await waitFor(() => {
      const btns = Array.from(container.querySelectorAll('button')).filter((b) => b.textContent === '预览');
      expect(btns.length).toBeGreaterThan(0);
      return btns;
    });
    fireEvent.click(previewBtns[0]!); // 预览最新版（auto）
    const preview = await waitFor(() => {
      const el = container.querySelector('[data-snapshot-preview]') as HTMLElement;
      expect(el).not.toBeNull();
      return el;
    });
    expect(preview.textContent).toContain('新版正文内容变长了');
  });

  it('手动创建快照：调用 createScriptSnapshot（命名可选）', async () => {
    const container = renderPanel(() => Promise.resolve());
    await waitFor(() => expect(container.querySelector('[data-snapshot-list]')?.textContent).toContain('定稿'));
    const input = container.querySelector('[data-snapshot-name-input]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '发版前' } });
    const createBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('创建快照'))!;
    fireEvent.click(createBtn);
    await waitFor(() => expect(createScriptSnapshot).toHaveBeenCalledWith('p1', '发版前'));
  });

  it('恢复：二次确认后调用 onRestore（携带快照）', async () => {
    const onRestore = vi.fn(async (_snap: unknown) => {});
    const container = renderPanel(onRestore);
    const restoreBtns = await waitFor(() => {
      const btns = container.querySelectorAll('button[data-snapshot-restore]');
      expect(btns.length).toBeGreaterThan(0);
      return Array.from(btns);
    });
    fireEvent.click(restoreBtns[0]!); // 最新版
    // antd 确认弹窗出现 → 点击「恢复」确认
    await confirmModal();
    await waitFor(() => expect(onRestore).toHaveBeenCalledTimes(1));
    expect((onRestore.mock.calls[0]![0] as { fileName: string }).fileName).toBe('snap-2.json');
  });
});

describe('script-snapshot-panel 手动删除（2026-11-05）', () => {
  beforeEach(() => {
    listSnapshots.mockClear();
    ensureLegacyMigrated.mockClear();
    createScriptSnapshot.mockClear();
    deleteSnapshotFile.mockClear();
    undeleteSnapshot.mockClear();
    listSnapshots.mockImplementation(async () => snapsOnDisk());
  });

  it('软删（非最新）：行立即消失、计数同步、底部撤销条出现；文件尚未真删', async () => {
    const container = renderPanel(() => Promise.resolve());
    await waitFor(() => expect(container.querySelector('[data-snapshot-list]')?.textContent).toContain('定稿'));
    await clickDelete(container, 'snap-1.json'); // 旧一份 = 非最新 → 无确认弹窗
    const list = await waitFor(() => {
      const el = container.querySelector('[data-snapshot-list]') as HTMLElement;
      expect(el.textContent).not.toContain('定稿'); // 该行立即移除
      return el;
    });
    expect(list.textContent).toContain('2026-11-04 12:00:00'); // 另一行仍在
    const bar = container.querySelector('[data-snapshot-undo-bar]');
    expect(bar?.textContent).toContain('已删除 1 个版本'); // 合并提示条
    expect(container.querySelector('[data-snapshot-meta]')?.textContent).toContain('1 个版本'); // 计数同步
    expect(deleteSnapshotFile).not.toHaveBeenCalled(); // 软删：撤销窗内不真删
  });

  it('撤销：按原样写回并刷新，该条回到原排序位置；撤销条消失', async () => {
    const container = renderPanel(() => Promise.resolve());
    await waitFor(() => expect(container.querySelector('[data-snapshot-list]')?.textContent).toContain('定稿'));
    await clickDelete(container, 'snap-1.json');
    const undoBtn = await waitFor(() => {
      const el = container.querySelector('button[data-snapshot-undo]') as HTMLElement;
      expect(el).not.toBeNull();
      return el;
    });
    fireEvent.click(undoBtn);
    await waitFor(() => expect(undeleteSnapshot).toHaveBeenCalledWith('p1', 'script', expect.objectContaining({ fileName: 'snap-1.json' })));
    await waitFor(() => {
      const el = container.querySelector('[data-snapshot-list]') as HTMLElement;
      expect(el.textContent).toContain('定稿');
      // 位置还原：最新一份（12:00）在前、被撤销的「定稿」在后
      expect(el.textContent.indexOf('2026-11-04 12:00:00')).toBeLessThan(el.textContent.indexOf('定稿'));
    });
    expect(container.querySelector('[data-snapshot-undo-bar]')).toBeNull(); // 撤销条消失
    expect(deleteSnapshotFile).not.toHaveBeenCalled(); // 撤销后不真删
  });

  it('超时真删：撤销窗过后文件被真正删除（deleteSnapshotFile 落盘）', async () => {
    const container = renderPanel(() => Promise.resolve(), { undoWindowMs: 30 });
    await waitFor(() => expect(container.querySelector('[data-snapshot-list]')?.textContent).toContain('定稿'));
    await clickDelete(container, 'snap-1.json');
    expect(deleteSnapshotFile).not.toHaveBeenCalled(); // 软删阶段未删
    await waitFor(() => expect(deleteSnapshotFile).toHaveBeenCalledWith('p1', 'script', 'snap-1.json'));
    await waitFor(() => expect(container.querySelector('[data-snapshot-undo-bar]')).toBeNull()); // 真删后撤销条消失
  });

  it('连续删除合并为一条提示：删两条 → 「已删除 2 个版本」+ 撤销全部', async () => {
    const container = renderPanel(() => Promise.resolve(), { undoWindowMs: 5000 });
    await waitFor(() => expect(container.querySelector('[data-snapshot-list]')?.textContent).toContain('定稿'));
    await clickDelete(container, 'snap-1.json'); // 旧一份（非最新）
    await clickDelete(container, 'snap-2.json'); // 最新一份 → 确认弹窗
    await confirmModal();
    const bar = await waitFor(() => {
      const el = container.querySelector('[data-snapshot-undo-bar]') as HTMLElement;
      expect(el?.textContent).toContain('已删除 2 个版本'); // 合并为一条，不堆多条
      return el;
    });
    expect(container.querySelectorAll('[data-snapshot-undo-bar]')).toHaveLength(1);
    // 撤销全部：两条都回来
    fireEvent.click(bar.querySelector('button[data-snapshot-undo]')!);
    await waitFor(() => expect(undeleteSnapshot).toHaveBeenCalledTimes(2));
    const list = await waitFor(() => {
      const el = container.querySelector('[data-snapshot-list]') as HTMLElement;
      expect(el.textContent).toContain('定稿');
      expect(el.textContent).toContain('2026-11-04 12:00:00');
      return el;
    });
    expect(list.textContent).not.toContain('暂无快照');
    expect(deleteSnapshotFile).not.toHaveBeenCalled();
  });

  it('删除最新版：弹二次确认并明确提示「这是最新版本」；确认后才软删', async () => {
    const container = renderPanel(() => Promise.resolve(), { undoWindowMs: 5000 });
    await waitFor(() => expect(container.querySelector('[data-snapshot-list]')?.textContent).toContain('定稿'));
    await clickDelete(container, 'snap-2.json'); // 列表新→旧的第一行 = 最新
    // 弹窗出现且文案明确「最新版本」，不静默
    await waitFor(() => {
      const modalEl = document.querySelector('.ant-modal');
      expect(modalEl?.textContent).toContain('删除最新版本？');
      expect(modalEl?.textContent).toContain('这是当前最新的快照版本');
    });
    expect(container.querySelector('[data-snapshot-undo-bar]')).toBeNull(); // 未确认 → 尚未软删
    await confirmModal();
    await waitFor(() => {
      const list = container.querySelector('[data-snapshot-list]') as HTMLElement;
      expect(list?.textContent).not.toContain('2026-11-04 12:00:00'); // 确认后行移除
    });
    expect(container.querySelector('[data-snapshot-undo-bar]')?.textContent).toContain('已删除 1 个版本');
  });

  it('预览中删除：预览关闭、回列表且该行移除', async () => {
    const container = renderPanel(() => Promise.resolve(), { undoWindowMs: 5000 });
    const previewBtns = await waitFor(() => {
      const btns = Array.from(container.querySelectorAll('button')).filter((b) => b.textContent === '预览');
      expect(btns.length).toBeGreaterThan(0);
      return btns;
    });
    fireEvent.click(previewBtns[1]!); // 预览旧一份（定稿）
    await waitFor(() => expect(container.querySelector('[data-snapshot-preview]')).not.toBeNull());
    await clickDelete(container, 'snap-1.json'); // 预览态的删除按钮
    await waitFor(() => expect(container.querySelector('[data-snapshot-preview]')).toBeNull()); // 预览关闭
    const list = container.querySelector('[data-snapshot-list]') as HTMLElement;
    expect(list?.textContent).not.toContain('定稿'); // 回列表且该行已移除
    expect(list?.textContent).toContain('2026-11-04 12:00:00');
    expect(container.querySelector('[data-snapshot-undo-bar]')?.textContent).toContain('已删除 1 个版本');
  });

  it('删除进行中禁止恢复：软删暂存中的条目点恢复 → 确认后 onRestore 不被调用', async () => {
    const onRestore = vi.fn(async (_snap: unknown) => {});
    const container = renderPanel(onRestore, { undoWindowMs: 5000 });
    await waitFor(() => expect(container.querySelector('[data-snapshot-list]')?.textContent).toContain('定稿'));
    // 先点开恢复确认弹窗（不确认），再软删同一条 → 确认恢复应被安全闸拦下
    const restoreBtn = await waitFor(() => {
      const el = container.querySelector('button[data-snapshot-restore="snap-1.json"]') as HTMLElement;
      expect(el).not.toBeNull();
      return el;
    });
    fireEvent.click(restoreBtn);
    await waitFor(() => expect(document.querySelector('.ant-modal')).not.toBeNull());
    await clickDelete(container, 'snap-1.json'); // 确认弹窗悬着时删除同一条
    await confirmModal(); // 点「恢复」确认
    await waitFor(() => expect(container.querySelector('[data-snapshot-undo-bar]')?.textContent).toContain('已删除 1 个版本'));
    expect(onRestore).not.toHaveBeenCalled(); // 删除流程中的条目禁止恢复
  });
});
