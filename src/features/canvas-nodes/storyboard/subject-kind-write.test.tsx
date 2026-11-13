/**
 * 「改类型 / 设封面 / 换媒体」端到端写回回归测试（2026-11-06）
 *
 * 与 subject-library-pages.test.tsx 的区别：那一份把 onChangeTree / onUpdateItem 换成 vi.fn，
 * 只验 UI 分支；这里接**真实数据链**（useStoryboardSubjectData → slot-containers → 假磁盘），
 * 因为用户报的「主体类型依然不能修改」恰恰发生在这一层：
 * changeKind 在同一 tick 连发两笔无锁 read-merge-write（subjectTree + entities），
 * 后完成的那一笔带着旧 subjectTree 覆盖回去 → 徽标闪一下又变回原类型。
 * 同一理由，封面（entities 一笔）与基础状态挂音频（subjectTree 一笔）也在这份里跑真实落盘。
 *
 * 假磁盘用 JSON 深拷贝 + 读写各自延迟，等价于真实文件语义（读到的一定是已落盘内容）。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import { createElement } from 'react';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) => {
      if (typeof fallback === 'string') return fallback;
      if (fallback && typeof fallback === 'object' && fallback.defaultValue) return fallback.defaultValue;
      return key;
    },
  }),
}));

const memfs = vi.hoisted(() => new Map<string, string>());
vi.mock('@/platform/fs', () => ({
  // 深拷贝返回：读永远看不到未完成的写（真实文件语义），race 才会如实暴露
  readJson: async <T,>(p: string) => {
    await new Promise((r) => { setTimeout(r, 2); });
    const raw = memfs.get(p);
    return raw ? (JSON.parse(raw) as T) : null;
  },
  writeJson: async (p: string, v: unknown) => {
    await new Promise((r) => { setTimeout(r, 6); });
    memfs.set(p, JSON.stringify(v));
  },
  writeJsonIfUnchanged: async (p: string, v: unknown) => { memfs.set(p, JSON.stringify(v)); },
  stat: async (p: string) => (memfs.has(p) ? { size: 1, lastModified: Date.now() } : null),
  listDir: async () => [] as string[],
  readFile: async (p: string) => memfs.get(p) ?? null,
  walkFiles: async () => [] as string[],
}));

// 快照层不在本次验证范围（真实链路里它只会把并发窗口拉得更宽）
vi.mock('@/entities/snapshot-store.js', () => ({
  preSaveSnapshot: async () => {},
  afterWriteSnapshot: async () => {},
}));

vi.mock('@zeroexo/plugin-nodes', () => ({
  usePreviewImage: (key: string, fallback: string) => (key ? `/media/${key}` : fallback),
}));
vi.mock('@/shared/utils/resource-url.js', () => ({ getResourceUrl: (key: string) => `/media/${key}` }));
vi.mock('@/entities/cas-store.js', () => ({
  isCasStorageKey: () => false,
  parseCasStorageKey: () => null,
  hasCasEntry: async () => true,
  registerCasRef: async () => {},
  releaseCas: async () => {},
}));
vi.mock('@/entities/script-store.js', () => ({
  readScript: async () => ({ episodes: [{ number: 1, title: '第一集' }] }),
  watchScript: () => () => {},
  displayEpisodeTitle: (title: string | undefined, n: number) => title || `第${n}集`,
}));
vi.mock('@/features/auth/auth-store.js', () => ({ useAuth: () => ({ isAuthenticated: true }) }));
vi.mock('@/features/asset-picker/services/upload-asset.js', () => ({ uploadAsset: async () => ({ data: { storageKey: 'k' } }) }));
vi.mock('./subject-media-source-panel.js', async () => {
  // 真实面板另有单测；这里用可控替身：把 onPick 交给被测组件，写入链（linkSubjectStateMedia）照旧真实
  const { createElement } = await import('react');
  return {
    SubjectMediaSourcePanel: (props: { open?: boolean; onPick?: (a: { storageKey: string; kind: 'image' | 'audio' }) => void }) => (
      props.open
        ? createElement('div', { 'data-mock-media-panel': '' },
            createElement('button', { 'data-mock-pick': 'image', onClick: () => props.onPick?.({ storageKey: 'picked-image-key', kind: 'image' }) }),
            createElement('button', { 'data-mock-pick': 'audio', onClick: () => props.onPick?.({ storageKey: 'picked-audio-key', kind: 'audio' }) }))
        : null
    ),
  };
});

import { SubjectLibraryPages } from './subject-library-pages';
import { useStoryboardSubjectData, useSubjectTotalCount } from './use-storyboard-subject-data';
import { readStoryboardContainer } from '@/entities/slot-containers.js';
import { createSubjectNode, createSubjectTree, type SubjectTree } from './subject-tree-types';
import { useViewPrefsStore } from '@/shared/view-prefs.js';
import type { ProductionItem } from '../production-manager/production-manager-types';

const THEME = {
  mode: 'dark',
  toolbar: {
    panel: '#17181a', text: '#e5e5e5', textMuted: '#888888',
    accent: '#3b82f6', border: '#333333', danger: '#ef4444',
  },
} as never;

const PID = 'p-kind-write';
const PATH = `projects/${PID}/entities/storyboard.json`;

/** 真实宿主接线（与 storyboard-tab-content / SubjectGroup 同一套 hook + 组件） */
function Host({ projectId = PID }: { projectId?: string }): React.ReactElement {
  const { container, loadState, subjects, subjectTree, addSubject, updateItem, deleteItem, changeTree } =
    useStoryboardSubjectData(projectId, true);
  if (!container) return <div data-loading data-load-state={loadState}>loading</div>;
  return (
    <SubjectLibraryPages
      productionItems={subjects}
      theme={THEME}
      projectId={projectId}
      subjectTree={subjectTree}
      onChangeTree={changeTree}
      onUpdateItem={updateItem}
      onDeleteItem={deleteItem}
      onAddSubject={() => addSubject('character')}
    />
  );
}

/** 抽屉胶囊「主体 N」（与列表同源，2026-11-06） */
function SubjectTotal({ projectId = PID }: { projectId?: string }): React.ReactElement {
  const total = useSubjectTotalCount(projectId);
  return <div data-subject-total>{total ?? 'null'}</div>;
}

function seed(item: ProductionItem, tree: SubjectTree): void {
  memfs.set(PATH, JSON.stringify({
    schemaVersion: 1, version: 1, title: '主体库', shots: [],
    entities: [item], subjectTree: [tree], updatedAt: new Date().toISOString(),
  }));
}

/** 按项目播种容器（同名串台 / 计数用例需要独立 PID，避免跳用例残留） */
function seedAt(projectId: string, entities: unknown[], subjectTree: unknown[]): void {
  memfs.set(`projects/${projectId}/entities/storyboard.json`, JSON.stringify({
    schemaVersion: 1, version: 1, title: '主体库', shots: [],
    entities, subjectTree, updatedAt: new Date().toISOString(),
  }));
}

async function changeKindToScene(): Promise<void> {
  await waitFor(() => expect(document.querySelector('[data-subject-card="item-1"]')).toBeTruthy());
  const card = document.querySelector('[data-subject-card="item-1"]') as HTMLElement;
  fireEvent.mouseEnter(card);
  fireEvent.click(card.querySelector('[data-card-action="kind"]') as Element);
  await waitFor(() => expect(document.querySelector('.ant-dropdown')).toBeTruthy());
  fireEvent.click(document.querySelector('[data-subject-kind-option="scene"]') as Element);
}

/** 等两笔写（各自带延迟）彻底落定 + 写回结果刷回 UI */
const settle = () => new Promise((r) => { setTimeout(r, 80); });

beforeEach(() => {
  cleanup();
  memfs.clear();
  window.history.replaceState(null, '');
  useViewPrefsStore.setState({
    assetLibrary: { viewMode: 'list', activeGroup: 'script', activeChild: 'image', search: '', hierarchyTypeFilter: 'all' },
    scriptEditor: { showLabels: true },
    subjectLibrary: { activeKind: 'all', activeEpisodeByProject: {} },
    subjectPages: { lastByProject: {} },
    workbench: { pixelsPerSecond: 40, activeEpisodeByProject: {} },
    canvasTabs: { lastSlotByProject: {}, openCanvasesByProject: {} },
  });
});

describe('主体库整页「改类型」写回真实容器', () => {
  it('已有主体树时改类型：徽标稳定停在「场景」，盘上 subjectTree 与 entities 同时更新', async () => {
    const tree = createSubjectTree('character', '东海龙王');
    seed(
      { id: 'item-1', name: '东海龙王', kind: 'character', aliases: [], consistency: '龙首人身', note: '', episodeIds: [], images: [], coverKey: null },
      tree,
    );
    render(createElement(AntdApp, null, createElement(Host)));

    await changeKindToScene();

    // 徽标先到「场景」
    await waitFor(() => expect((document.querySelector('[data-subject-card-badge]') as HTMLElement).textContent).toBe('场景'));

    // 关键断言：两笔写全部落定后仍必须是「场景」——丢写版本在这里会退回「角色」
    await settle();
    expect((document.querySelector('[data-subject-card-badge]') as HTMLElement).textContent).toBe('场景');
    expect(document.querySelector('[data-subject-page="list"]')).toBeTruthy();

    const onDisk = await readStoryboardContainer(PID);
    expect((onDisk?.subjectTree as Array<{ kind: string }>)[0]?.kind).toBe('scene');
    expect((onDisk?.entities as Array<{ kind: string }>)[0]?.kind).toBe('scene');
  });

  it('还没有主体树的老数据改类型：条目 kind 落盘，徽标同步', async () => {
    // 只留条目、不留同名树（subjectTree 空 = 类型唯一来源是条目 kind）
    memfs.set(PATH, JSON.stringify({
      schemaVersion: 1, version: 1, title: '主体库', shots: [],
      entities: [{ id: 'item-1', name: '老人', kind: 'character', aliases: [], consistency: '', note: '', episodeIds: [], images: [], coverKey: null }],
      subjectTree: [], updatedAt: new Date().toISOString(),
    }));
    render(createElement(AntdApp, null, createElement(Host)));

    await changeKindToScene();
    await settle();

    expect((document.querySelector('[data-subject-card-badge]') as HTMLElement).textContent).toBe('场景');
    const onDisk = await readStoryboardContainer(PID);
    expect((onDisk?.entities as Array<{ kind: string }>)[0]?.kind).toBe('scene');
  });
});

/** 带媒体的主体：基础状态一张图 + 一个状态一张图，条目 images 仍为空（本地版常态） */
function seedWithMedia(): void {
  const tree = createSubjectTree('character', '东海龙王');
  tree.rootId = 'subj-1';
  const base = tree.states[0]!;
  base.media = [{ key: 'base-key-1', type: 'image' }];
  const node = createSubjectNode('东海龙王 · 状态2', 'image', 'user', 'subj-1', { step: 2 });
  node.id = 'state-1';
  node.media = [{ key: 'state-key-1', type: 'image' }];
  tree.states = [base, node];
  memfs.set(PATH, JSON.stringify({
    schemaVersion: 1, version: 1, title: '主体库', shots: [],
    entities: [{ id: 'item-1', name: '东海龙王', kind: 'character', aliases: [], consistency: '', note: '', episodeIds: [], images: [], coverKey: null }],
    subjectTree: [tree], updatedAt: new Date().toISOString(),
  }));
}

async function openSubjectPageUi(): Promise<void> {
  await waitFor(() => expect(document.querySelector('[data-subject-card="item-1"]')).toBeTruthy());
  fireEvent.click(document.querySelector('[data-subject-card="item-1"]') as Element);
  await waitFor(() => expect(document.querySelector('[data-subject-page="subject"]')).toBeTruthy());
}

describe('把某个状态当封面（真实落盘）', () => {
  it('默认封面 = 基础状态图；点状态卡封面动作后 coverKey 落盘、徒标与列表封面一起跟过去', async () => {
    seedWithMedia();
    render(createElement(AntdApp, null, createElement(Host)));

    // 条目 images 为空，封面仍能从树里解析出来（resolveSubjectCover 候选集）
    await waitFor(() => expect(document.querySelector('[data-subject-card="item-1"] img[data-subject-media-thumb]')).toBeTruthy());
    expect(document.querySelector('[data-subject-card="item-1"] img[data-subject-media-thumb]')?.getAttribute('src')).toContain('base-key-1');

    await openSubjectPageUi();
    // 默认封面落在基础状态卡
    expect(document.querySelector('[data-state-card="__base__"] [data-state-cover-badge]')).toBeTruthy();

    const card = document.querySelector('[data-state-card="state-1"]') as HTMLElement;
    fireEvent.mouseEnter(card);
    fireEvent.click(card.querySelector('[data-state-action="cover"]') as Element);
    await settle();

    const onDisk = await readStoryboardContainer(PID);
    expect((onDisk?.entities as Array<{ coverKey: string | null }>)[0]?.coverKey).toBe('state-key-1');
    expect(document.querySelector('[data-state-card="state-1"] [data-state-cover-badge]')).toBeTruthy();
    expect(document.querySelector('[data-state-card="__base__"] [data-state-cover-badge]')).toBeNull();

    // 回列表：封面已换成该状态图
    fireEvent.click(document.querySelector('[data-subject-crumb="library"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="list"]')).toBeTruthy());
    expect(document.querySelector('[data-subject-card="item-1"] img[data-subject-media-thumb]')?.getAttribute('src')).toContain('state-key-1');
  });

  it('再点一次 = 取消封面：coverKey 回 null，默认封面退回第一张候选图', async () => {
    seedWithMedia();
    render(createElement(AntdApp, null, createElement(Host)));
    await openSubjectPageUi();

    const card = document.querySelector('[data-state-card="state-1"]') as HTMLElement;
    fireEvent.mouseEnter(card);
    fireEvent.click(card.querySelector('[data-state-action="cover"]') as Element);
    await settle();
    fireEvent.click(card.querySelector('[data-state-action="cover"]') as Element);
    await settle();

    const onDisk = await readStoryboardContainer(PID);
    expect((onDisk?.entities as Array<{ coverKey: string | null }>)[0]?.coverKey).toBeNull();
    expect(document.querySelector('[data-state-card="state-1"] [data-state-cover-badge]')).toBeNull();
    expect(document.querySelector('[data-state-card="__base__"] [data-state-cover-badge]')).toBeTruthy();
  });
});

describe('基础状态与状态共用同一媒体入口（可挂音频）', () => {
  it('基础状态替换面板选音频 → states[0].media[0] 落盘为 audio，卡片变语音', async () => {
    seedWithMedia();
    render(createElement(AntdApp, null, createElement(Host)));
    await openSubjectPageUi();
    fireEvent.click(document.querySelector('[data-state-card="__base__"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="state"]')).toBeTruthy());

    fireEvent.click(document.querySelector('[data-media-action="replace"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-mock-media-panel]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-mock-pick="audio"]') as Element);
    await settle();

    const onDisk = await readStoryboardContainer(PID);
    const refs = (onDisk?.subjectTree as Array<{ states: Array<{ media: unknown[] }> }>)[0]?.states[0]?.media;
    expect(refs).toEqual([{ key: 'picked-audio-key', type: 'audio' }]);
    expect(document.querySelector('[data-subject-media-thumb][data-media-kind="audio"]')).toBeTruthy();
  });

  it('封面右上角「删除媒体」→ 该槽位清空（不留半引用）', async () => {
    seedWithMedia();
    render(createElement(AntdApp, null, createElement(Host)));
    await openSubjectPageUi();
    fireEvent.click(document.querySelector('[data-state-card="state-1"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="state"]')).toBeTruthy());

    fireEvent.click(document.querySelector('[data-media-action="remove"]') as Element);
    await settle();

    const onDisk = await readStoryboardContainer(PID);
    const states = (onDisk?.subjectTree as Array<{ states: Array<{ id: string; media: unknown[] }> }>)[0]?.states ?? [];
    expect(states.find((s) => s.id === 'state-1')?.media).toEqual([]);
    expect(document.querySelector('[data-media-action="remove"]')).toBeNull();
  });
});

const dupItem = (id: string, name: string): ProductionItem => ({
  id, name, kind: 'character', aliases: [], consistency: '', note: '', episodeIds: [], images: [], coverKey: null,
});

describe('新建主体自动递增序号（真实写回）', () => {
  it('连点两次「添加主体」→ 新主体 2 / 新主体 3，不再堆同名', async () => {
    const pid = 'p-auto-name';
    seedAt(pid, [dupItem('item-0', '新主体')], []);
    render(createElement(AntdApp, null, createElement(Host, { projectId: pid })));
    await waitFor(() => expect(document.querySelector('[data-subject-card="item-0"]')).toBeTruthy());

    for (let i = 0; i < 2; i += 1) {
      fireEvent.click(document.querySelector('[data-subject-add]') as Element);
      await settle();
    }

    const onDisk = await readStoryboardContainer(pid);
    expect((onDisk?.entities as Array<{ name: string }>).map((e) => e.name)).toEqual(['新主体', '新主体 2', '新主体 3']);
  });
});

describe('同名主体不再串台（条目↔树唯一绑定）', () => {
  it('两条同名主体共享一棵老树时，改第二条类型不动第一条，也不改写别人的绑定', async () => {
    const pid = 'p-dup-kind';
    const legacy = createSubjectTree('character', '新主体');
    seedAt(pid, [dupItem('item-1', '新主体'), dupItem('item-2', '新主体')], [legacy]);
    render(createElement(AntdApp, null, createElement(Host, { projectId: pid })));
    await waitFor(() => expect(document.querySelector('[data-subject-card="item-2"]')).toBeTruthy());

    const card2 = document.querySelector('[data-subject-card="item-2"]') as HTMLElement;
    fireEvent.mouseEnter(card2);
    fireEvent.click(card2.querySelector('[data-card-action="kind"]') as Element);
    await waitFor(() => expect(document.querySelector('.ant-dropdown')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-subject-kind-option="scene"]') as Element);
    await settle();

    const card1 = document.querySelector('[data-subject-card="item-1"]') as HTMLElement;
    expect(card1.querySelector('[data-subject-card-badge]')?.textContent).toBe('角色');
    expect(card2.querySelector('[data-subject-card-badge]')?.textContent).toBe('场景');

    const onDisk = await readStoryboardContainer(pid);
    expect((onDisk?.entities as Array<{ kind: string }>).map((e) => e.kind)).toEqual(['character', 'scene']);
    // 第一条继承的老树没被第二条改走（旧口径会把两条一起变成场景）
    const tree = (onDisk?.subjectTree as Array<{ kind: string; itemId?: string | null }>)[0];
    expect(tree?.kind).toBe('character');
    expect(tree?.itemId).toBeNull();
  });
});

describe('抽屉胶囊「主体 N」与列表同源', () => {
  it('加载后显示总数，新建主体后即时 +1', async () => {
    const pid = 'p-total';
    seedAt(pid, [dupItem('item-1', '老人')], []);
    render(createElement(AntdApp, null,
      createElement(Host, { projectId: pid }),
      createElement(SubjectTotal, { projectId: pid })));

    await waitFor(() => expect(document.querySelector('[data-subject-total]')?.textContent).toBe('1'));

    fireEvent.click(document.querySelector('[data-subject-add]') as Element);
    await settle();
    expect(document.querySelector('[data-subject-total]')?.textContent).toBe('2');
  });
});
