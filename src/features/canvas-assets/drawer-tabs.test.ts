/**
 * 抽屉分组页签 + 模块挂载规则（2026-11-16 用户指令回归）
 *
 * 验收四条：
 * 1) sidebar 按钮顺序 = 全局分组（公共资产/主体/画布历史/导演台/任务队列）置顶，
 *    模块独有分组（画布结构/本剧信息）垫底，面板给首个独有分组上方画分割线；
 * 2) 画布结构只在画布模块挂载、本剧信息只在剧本/导演台模块挂载，
 *    避免用户在这些模块里误选画布层级与子画布；
 * 3) 挂载接线：面板按 visibleGroups 过滤按钮，层级树数据 hook 只在层级分组组件内部挂载；
 * 4) 「全局/全局资产库」改名「公共资产」（2026-11-16 用户指令）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DRAWER_TAB_DEFS, DRAWER_MODULE_GROUPS, resolveDrawerModule } from './tab-defs.js';

/** 读仓库源码（结构断言用；vitest cwd = 仓库根） */
const readSrc = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf-8');

describe('抽屉页签顺序（全局置顶、模块独有垫底）', () => {
  it('全局分组在前：公共资产 → 主体 → 画布历史 → 导演台 → 任务队列', () => {
    expect(DRAWER_TAB_DEFS.filter((d) => !d.moduleOnly).map((d) => d.key))
      .toEqual(['assets', 'subjects', 'canvasHistory', 'directorHistory', 'tasks']);
  });

  it('模块独有分组垫底：画布结构 / 本剧信息', () => {
    expect(DRAWER_TAB_DEFS.filter((d) => d.moduleOnly).map((d) => d.key))
      .toEqual(['canvasStructure', 'scriptMeta']);
    expect(DRAWER_TAB_DEFS.slice(-2).every((d) => d.moduleOnly)).toBe(true);
  });
});

describe('按模块独立挂载（层级/子画布只在画布模块）', () => {
  it('画布模块含画布专属分组，不含本剧信息', () => {
    expect(DRAWER_MODULE_GROUPS.canvas).toEqual(['assets', 'subjects', 'canvasHistory', 'directorHistory', 'tasks', 'canvasStructure']);
    expect(resolveDrawerModule('canvas')).toBe('canvas');
    expect(resolveDrawerModule('canvas:sc123')).toBe('canvas');
  });

  it('剧本/导演台模块挂本剧信息（垫底），画布模块不挂', () => {
    expect(DRAWER_MODULE_GROUPS.script).toEqual(['assets', 'subjects', 'canvasHistory', 'directorHistory', 'tasks', 'scriptMeta']);
    expect(DRAWER_MODULE_GROUPS.workbench).toEqual(['assets', 'subjects', 'canvasHistory', 'directorHistory', 'tasks', 'scriptMeta']);
    expect(DRAWER_MODULE_GROUPS.canvas).not.toContain('scriptMeta');
  });

  it('主体库（storyboard）模块只有全局分组（不挂本剧信息、不挂画布结构）', () => {
    for (const key of ['storyboard:node-1', 'storyboard']) {
      expect([...DRAWER_MODULE_GROUPS[resolveDrawerModule(key)]]).toEqual(['assets', 'subjects', 'canvasHistory', 'directorHistory', 'tasks']);
    }
  });

  it('未知 key 回落画布模块（不产生空 sidebar）', () => {
    expect(resolveDrawerModule('whatever')).toBe('canvas');
  });
});

describe('分割线接线（模块独有分组上方）', () => {
  it('面板给首个 moduleOnly 按钮设置 dividerBefore，SidebarNav 支持渲染分割线', () => {
    const panel = readSrc('src/features/canvas-assets/CanvasAssetsPanel.tsx');
    expect(panel).toContain('dividerBefore');
    const common = readSrc('src/features/canvas-assets/components/common.tsx');
    expect(common).toContain('dividerBefore');
  });
});

describe('挂载接线（静态守卫，防回退）', () => {
  it('面板按 visibleGroups 过滤按钮，层级树 hook 只在分组组件内挂载', () => {
    const panel = readSrc('src/features/canvas-assets/CanvasAssetsPanel.tsx');
    expect(panel).toContain('store.visibleGroups.includes');
    expect(panel).toContain('resolveDrawerModule(activeTabKey)');
    expect(panel).toContain('CanvasStructureGroup');
    // store 的 activeGroup 必须由 visibleGroups 派生（否则非画布模块仍可能停在层级/画布）
    const store = readSrc('src/features/canvas-assets/store.ts');
    expect(store).toContain('visibleGroups.includes(groupByModule[drawerModule])');
    // 抽屉壳层不再自己调层级树 hook（否则又变成「抽屉一打开就订阅整张图」）
    const shell = readSrc('src/features/hierarchy/components/hierarchy-panel.tsx');
    expect(shell).not.toContain('useHierarchyPanelProps');
    const group = readSrc('src/features/canvas-assets/groups/HierarchyGroup.tsx');
    expect(group).toContain('useHierarchyPanelProps');
  });
});
