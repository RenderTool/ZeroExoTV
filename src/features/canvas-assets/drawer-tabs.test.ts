/**
 * 抽屉分组页签 + 模块挂载规则（2026-11-06 用户指令回归）
 *
 * 验收三条：
 * 1) sidebar 按钮顺序 = 资产 → 历史 → 层级 → 画布（资产置顶）；
 * 2) 层级 / 画布只在**画布模块**（含副本画布页签）挂载，剧本 / 主体库 / 导演台模块只有资产 / 历史，
 *    避免用户在这些模块里误选画布层级与子画布；
 * 3) 挂载接线：面板按 visibleGroups 过滤按钮，层级树数据 hook 只在层级分组组件内部挂载。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DRAWER_TAB_DEFS, DRAWER_MODULE_GROUPS, resolveDrawerModule } from './tab-defs.js';

/** 读仓库源码（结构断言用；vitest cwd = 仓库根） */
const readSrc = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf-8');

describe('抽屉页签顺序（资产置顶）', () => {
  it('历史入口已移除：资产 → 画布（层级/子画布合并）→ 本剧信息', () => {
    expect(DRAWER_TAB_DEFS.map((d) => d.key)).toEqual(['material', 'canvasStructure', 'scriptMeta']);
  });
});

describe('按模块独立挂载（层级/子画布只在画布模块）', () => {
  it('画布模块含画布专属分组，不含本剧信息', () => {
    expect(DRAWER_MODULE_GROUPS.canvas).toEqual(['material', 'canvasStructure']);
    expect(resolveDrawerModule('canvas')).toBe('canvas');
    expect(resolveDrawerModule('canvas:sc123')).toBe('canvas');
  });

  it('剧本/导演台模块 = 资产/本剧信息（不再有独立历史入口）', () => {
    for (const key of ['script:p1', 'script', 'workbench:node-2', 'workbench']) {
      const module = resolveDrawerModule(key);
      expect([...DRAWER_MODULE_GROUPS[module]]).toEqual(['material', 'scriptMeta']);
    }
  });

  it('主体库（storyboard）模块只有资产（不挂本剧信息、不挂历史）', () => {
    for (const key of ['storyboard:node-1', 'storyboard']) {
      expect([...DRAWER_MODULE_GROUPS[resolveDrawerModule(key)]]).toEqual(['material']);
    }
  });

  it('未知 key 回落画布模块（不产生空 sidebar）', () => {
    expect(resolveDrawerModule('whatever')).toBe('canvas');
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
