/**
 * view-prefs 持久化偏好 store 单元测试（2026-11-04 约定：切换 Tab 后偏好必须记住）
 *
 * 验收口径：
 * 1. 切换后偏好保持——store 设置→落盘→重新载入（模拟组件重挂载读初值）值不变；
 * 2. 刷新后偏好恢复——直接写 localStorage→loadViewPrefs 原样读回；
 * 3. 损坏容错——JSON 损坏 / schemaVersion 不符 / 单字段类型错 → 回默认不崩。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { resolveHierarchyPanelWidth } from '@/features/hierarchy/components/panel-width.js';
import {
  DEFAULT_VIEW_PREFS,
  VIEW_PREFS_SCHEMA_VERSION,
  VIEW_PREFS_STORAGE_KEY,
  loadViewPrefs,
  saveViewPrefs,
  useViewPrefsStore,
} from './view-prefs.js';

beforeEach(() => {
  localStorage.clear();
  // store 是模块级单例：每个用例重置为默认，避免用例间串值
  useViewPrefsStore.setState({ ...structuredClone(DEFAULT_VIEW_PREFS) });
});

describe('loadViewPrefs 损坏容错', () => {
  it('localStorage 无记录 → 返回默认值', () => {
    expect(loadViewPrefs()).toEqual(DEFAULT_VIEW_PREFS);
  });

  it('JSON 损坏（半截字符串）→ 回默认，不抛异常', () => {
    localStorage.setItem(VIEW_PREFS_STORAGE_KEY, '{oops broken');
    expect(() => loadViewPrefs()).not.toThrow();
    expect(loadViewPrefs()).toEqual(DEFAULT_VIEW_PREFS);
  });

  it('JSON 合法但非对象（数字/数组）→ 回默认', () => {
    localStorage.setItem(VIEW_PREFS_STORAGE_KEY, '42');
    expect(loadViewPrefs()).toEqual(DEFAULT_VIEW_PREFS);
    localStorage.setItem(VIEW_PREFS_STORAGE_KEY, '[]');
    expect(loadViewPrefs()).toEqual(DEFAULT_VIEW_PREFS);
  });

  it('schemaVersion 不符（旧版本残留）→ 整体回默认', () => {
    localStorage.setItem(VIEW_PREFS_STORAGE_KEY, JSON.stringify({
      schemaVersion: 999,
      data: { scriptEditor: { showLabels: false } },
    }));
    const prefs = loadViewPrefs();
    expect(prefs).toEqual(DEFAULT_VIEW_PREFS);
    expect(prefs.scriptEditor.showLabels).toBe(true);
  });

  it('单字段类型错只回该字段默认，不牵连其他字段', () => {
    localStorage.setItem(VIEW_PREFS_STORAGE_KEY, JSON.stringify({
      schemaVersion: VIEW_PREFS_SCHEMA_VERSION,
      data: {
        assetLibrary: { ...DEFAULT_VIEW_PREFS.assetLibrary, search: 123 as unknown as string },
        scriptEditor: { showLabels: false },
        workbench: { pixelsPerSecond: 'wide' as unknown as number },
      },
    }));
    const prefs = loadViewPrefs();
    expect(prefs.assetLibrary.search).toBe(''); // 类型错 → 默认
    expect(prefs.workbench.pixelsPerSecond).toBe(40); // 类型错 → 默认
    expect(prefs.scriptEditor.showLabels).toBe(false); // 合法字段保留
  });

  it('viewMode 非法枚举值 → 回默认 grid', () => {
    localStorage.setItem(VIEW_PREFS_STORAGE_KEY, JSON.stringify({
      schemaVersion: VIEW_PREFS_SCHEMA_VERSION,
      data: { assetLibrary: { viewMode: 'masonry' } },
    }));
    expect(loadViewPrefs().assetLibrary.viewMode).toBe('grid');
  });
});

describe('资产抽屉宽度：历史默认值一次性迁移', () => {
  it('落盘旧默认 400 → 载入得到 496 并回写存储', () => {
    localStorage.setItem(VIEW_PREFS_STORAGE_KEY, JSON.stringify({
      schemaVersion: VIEW_PREFS_SCHEMA_VERSION,
      data: { hierarchy: { panelWidth: 400 } },
    }));
    const prefs = loadViewPrefs();
    expect(prefs.hierarchy.panelWidth).toBe(496);
    const saved = JSON.parse(localStorage.getItem(VIEW_PREFS_STORAGE_KEY)!) as {
      data: { hierarchy: { panelWidth: number } };
    };
    expect(saved.data.hierarchy.panelWidth).toBe(496);
    // 幂等：再次载入仍是 496，不重复改写
    expect(loadViewPrefs().hierarchy.panelWidth).toBe(496);
  });

  it('落盘旧默认 450 → 载入得到 496 并回写存储', () => {
    localStorage.setItem(VIEW_PREFS_STORAGE_KEY, JSON.stringify({
      schemaVersion: VIEW_PREFS_SCHEMA_VERSION,
      data: { hierarchy: { panelWidth: 450 } },
    }));
    expect(loadViewPrefs().hierarchy.panelWidth).toBe(496);
  });

  it('用户自定义 520 → 原样保留，不迁移', () => {
    localStorage.setItem(VIEW_PREFS_STORAGE_KEY, JSON.stringify({
      schemaVersion: VIEW_PREFS_SCHEMA_VERSION,
      data: { hierarchy: { panelWidth: 520 } },
    }));
    expect(loadViewPrefs().hierarchy.panelWidth).toBe(520);
    const saved = JSON.parse(localStorage.getItem(VIEW_PREFS_STORAGE_KEY)!) as {
      data: { hierarchy: { panelWidth: number } };
    };
    expect(saved.data.hierarchy.panelWidth).toBe(520);
  });
});

describe('抽屉拖宽：大宽度可保存，视口变窄只夹取显示', () => {
  it('850 在 1920 屏可保存并恢复', () => {
    useViewPrefsStore.getState().setHierarchyPanelWidth(850);
    const restored = loadViewPrefs().hierarchy.panelWidth;
    expect(restored).toBe(850);
    expect(resolveHierarchyPanelWidth(restored, 1920)).toBe(850);
  });

  it('窗口缩到 1024：850 显示为 704，存值不回写', () => {
    useViewPrefsStore.getState().setHierarchyPanelWidth(850);
    const stored = loadViewPrefs().hierarchy.panelWidth;
    expect(resolveHierarchyPanelWidth(stored, 1024)).toBe(704);
    expect(stored).toBe(850);
    expect(useViewPrefsStore.getState().hierarchy.panelWidth).toBe(850);
    const saved = JSON.parse(localStorage.getItem(VIEW_PREFS_STORAGE_KEY)!) as {
      data: { hierarchy: { panelWidth: number } };
    };
    expect(saved.data.hierarchy.panelWidth).toBe(850);
  });
});

describe('刷新后偏好恢复（localStorage 往返）', () => {
  it('saveViewPrefs → loadViewPrefs 全量还原', () => {
    const custom = {
      assetLibrary: {
        viewMode: 'list' as const,
        activeGroup: 'script',
        activeChild: 'image',
        search: '海盗',
        hierarchyTypeFilter: 'video',
      },
      scriptEditor: { showLabels: false },
      subjectLibrary: { activeKind: 'character', activeEpisodeByProject: {} },
      subjectPages: { lastByProject: {} },
      workbench: { pixelsPerSecond: 96, activeEpisodeByProject: {} },
      canvasTabs: { lastSlotByProject: { 'p-1': 'canvas' as const }, openCanvasesByProject: { 'p-1': ['scabc123'] } },
      hierarchy: { panelWidth: 520 },
      canvasDrawer: { materialScopeByProject: { 'p-1': 'subject' as const } },
    };
    saveViewPrefs(custom);
    expect(loadViewPrefs()).toEqual(custom);
  });

  it('写入内容带 schemaVersion 信封', () => {
    saveViewPrefs(DEFAULT_VIEW_PREFS);
    const raw = JSON.parse(localStorage.getItem(VIEW_PREFS_STORAGE_KEY)!) as { schemaVersion: number };
    expect(raw.schemaVersion).toBe(VIEW_PREFS_SCHEMA_VERSION);
  });
});

describe('切换后偏好保持（store 动作 → 落盘 → 重挂载读回）', () => {
  it('剧本「显示标签」：关闭后重载仍为关闭（曾出现的偏好丢失项）', () => {
    useViewPrefsStore.getState().setScriptShowLabels(false);
    // 模拟页签切换后组件重挂载：从 localStorage 重新读初值
    expect(loadViewPrefs().scriptEditor.showLabels).toBe(false);
    useViewPrefsStore.getState().setScriptShowLabels(true);
    expect(loadViewPrefs().scriptEditor.showLabels).toBe(true);
  });

  it('资产库筛选/搜索/布局：设置后重载全部保留', () => {
    const { setAssetLibraryPrefs } = useViewPrefsStore.getState();
    setAssetLibraryPrefs({ activeGroup: 'script', activeChild: null });
    setAssetLibraryPrefs({ search: '关键词', viewMode: 'list' });
    const prefs = loadViewPrefs().assetLibrary;
    expect(prefs.activeGroup).toBe('script');
    expect(prefs.search).toBe('关键词');
    expect(prefs.viewMode).toBe('list');
    // 部分更新不清空其他字段
    expect(prefs.hierarchyTypeFilter).toBe('all');
  });

  it('主体库类型筛选 / 导演台时间线缩放：设置后重载保留', () => {
    useViewPrefsStore.getState().setSubjectActiveKind('scene');
    useViewPrefsStore.getState().setWorkbenchPixelsPerSecond(80);
    expect(loadViewPrefs().subjectLibrary.activeKind).toBe('scene');
    expect(loadViewPrefs().workbench.pixelsPerSecond).toBe(80);
  });

  it('非法缩放值（≤0）被拒绝且不落盘', () => {
    useViewPrefsStore.getState().setWorkbenchPixelsPerSecond(0);
    useViewPrefsStore.getState().setWorkbenchPixelsPerSecond(-5);
    expect(loadViewPrefs().workbench.pixelsPerSecond).toBe(40);
  });

  it('资产抽屉宽度：非法值拒绝，合法值落盘并重载保留（同一存储键）', () => {
    useViewPrefsStore.getState().setHierarchyPanelWidth(0);
    useViewPrefsStore.getState().setHierarchyPanelWidth(-5);
    expect(loadViewPrefs().hierarchy.panelWidth).toBe(0);
    useViewPrefsStore.getState().setHierarchyPanelWidth(520);
    expect(loadViewPrefs().hierarchy.panelWidth).toBe(520);
    const raw = localStorage.getItem(VIEW_PREFS_STORAGE_KEY);
    expect(raw).not.toBeNull();
  });

  it('资产抽屉分段（含主体）：按项目记忆并重载恢复', () => {
    useViewPrefsStore.getState().setDrawerMaterialScope('p-1', 'subject');
    expect(loadViewPrefs().canvasDrawer.materialScopeByProject).toEqual({
      'p-1': 'subject',
    });
    // 同项目再切回其它段：覆盖该项目的旧值，不影响其它项目
    useViewPrefsStore.getState().setDrawerMaterialScope('p-1', 'library');
    expect(loadViewPrefs().canvasDrawer.materialScopeByProject['p-1']).toBe('library');
  });

  it('资产抽屉分段：空项目 id / 非法值被拒绝且不落盘', () => {
    useViewPrefsStore.getState().setDrawerMaterialScope('', 'subject');
    useViewPrefsStore.getState().setDrawerMaterialScope('p-1', 'bogus' as never);
    expect(loadViewPrefs().canvasDrawer.materialScopeByProject).toEqual({});
  });

  it('store 状态与 localStorage 同步（切页签不丢的底层保证）', () => {
    useViewPrefsStore.getState().setScriptShowLabels(false);
    const raw = JSON.parse(localStorage.getItem(VIEW_PREFS_STORAGE_KEY)!) as {
      data: { scriptEditor: { showLabels: boolean } };
    };
    expect(raw.data.scriptEditor.showLabels).toBe(false);
    expect(useViewPrefsStore.getState().scriptEditor.showLabels).toBe(false);
  });
});
