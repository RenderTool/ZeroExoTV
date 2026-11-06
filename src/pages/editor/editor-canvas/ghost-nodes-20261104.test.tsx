/**
 * ghost-nodes-20261104 - 幽灵节点治理 + 选中态样式 验收断言(2026-11-04)
 *
 * 覆盖:
 * 1. 统一可见性判定 classifyNode / isVisibleNode / filterVisibleNodes(五态)
 * 2. 空间索引(store.getSpatialIndex().queryRect)不含墓碑、含孤儿 —— 命中区与可见集一致
 * 3. 框选(SelectionController.hitTest)不选中墓碑、可选中孤儿 —— 与层级树可见集一致
 * 4. 未知类型节点在 NodeLayer 渲染为"未知节点"占位(不静默消失)
 * 5. 选中态样式:outline-offset=2px、线宽≤2px、非红色、深底/浅底反色方向、无 glow
 *
 * 深路径直连源文件(与 bugfix-20261104.test.tsx 同一规避手法)。
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@zeroexo/plugin-render-react', async () => {
  return await import('../../../../packages/plugins/render-react/src/store.js');
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import {
  CommandQueue,
  EventBus,
  classifyNode,
  isVisibleNode,
  filterVisibleNodes,
} from '@zeroexo/core';
import { ReactGraphStore } from '@zeroexo/plugin-render-react';
import { SelectionController } from '../../../../packages/plugins/selection/src/controller';
import { NodeLayer } from '../../../../packages/plugins/render-react/src/components/node-layer';
import {
  SELECTION_RING_OFFSET,
  SELECTION_RING_WIDTH,
  SELECTION_RING_ON_DARK,
  SELECTION_RING_ON_LIGHT,
  relativeLuminance,
  selectionRingColor,
} from '../../../../packages/plugins/render-react/src/selection-style';

// ===== 工具 =====

function makeNode(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'image',
    position: { x: 0, y: 0 },
    size: { width: 200, height: 100 },
    data: {},
    ...overrides,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function makeStore(nodes: ReturnType<typeof makeNode>[]) {
  const eventBus = new EventBus();
  const queue = new CommandQueue(
    { nodes, edges: [], viewport: { x: 0, y: 0, k: 1 }, metadata: {} },
    eventBus,
  );
  return new ReactGraphStore(queue, eventBus);
}

const KNOWN_TYPES = new Set(['image', 'text', 'video', 'audio']);
const isTypeRegistered = (t: string): boolean => KNOWN_TYPES.has(t);

// ===== 1. 统一可见性判定 =====

describe('幽灵节点治理: classifyNode / isVisibleNode 五态', () => {
  it('墓碑节点 → tombstone,不可见', () => {
    const n = makeNode('a', { _deleted: true });
    expect(classifyNode(n)).toBe('tombstone');
    expect(isVisibleNode(n)).toBe(false);
  });

  it('无效节点(无 id / 空 id) → invalid,不可见', () => {
    expect(classifyNode(makeNode(''))).toBe('invalid');
    expect(isVisibleNode(makeNode(''))).toBe(false);
    expect(isVisibleNode(makeNode(undefined as unknown as string))).toBe(false);
  });

  it('孤儿节点(类型未注册) → unknown-type,仍可见(占位渲染,不静默消失)', () => {
    const orphan = makeNode('b', { type: 'storyboard' });
    expect(classifyNode(orphan, { isTypeRegistered })).toBe('unknown-type');
    expect(isVisibleNode(orphan, { isTypeRegistered })).toBe(true);
    // 不提供注册表时不做类型判定
    expect(classifyNode(orphan)).toBe('visible');
  });

  it('空数据节点(data 损坏为非对象) → empty-data,仍可见;data 缺失(undefined)属合法', () => {
    const broken = makeNode('c', { data: null });
    expect(classifyNode(broken)).toBe('empty-data');
    expect(isVisibleNode(broken)).toBe(true);
    const noData = makeNode('d');
    delete (noData as Record<string, unknown>).data;
    expect(classifyNode(noData)).toBe('visible');
  });

  it('filterVisibleNodes: 混合集合只剩正常+孤儿+空数据,墓碑与无效被剔除', () => {
    const nodes = [
      makeNode('ok'),
      makeNode('tomb', { _deleted: true }),
      makeNode('orphan', { type: 'storyboard' }),
      makeNode('broken', { data: null }),
      makeNode(''),
    ];
    const ids = filterVisibleNodes(nodes, { isTypeRegistered }).map((n) => n.id);
    expect(ids).toEqual(['ok', 'orphan', 'broken']);
  });
});

// ===== 2/3. 命中区(空间索引+框选)与可见集一致 =====

describe('幽灵节点治理: 命中区不含墓碑', () => {
  const nodes = [
    makeNode('visible-1', { position: { x: 0, y: 0 } }),
    makeNode('tombstone-1', { _deleted: true, position: { x: 10, y: 10 } }),
    makeNode('orphan-1', { type: 'storyboard', position: { x: 20, y: 20 } }),
  ];

  it('getActiveNodeIdSet: 不含墓碑,含孤儿', () => {
    const store = makeStore(nodes);
    const active = store.getActiveNodeIdSet();
    expect(active.has('visible-1')).toBe(true);
    expect(active.has('tombstone-1')).toBe(false);
    expect(active.has('orphan-1')).toBe(true);
  });

  it('空间索引 queryRect: 墓碑不可命中,孤儿可命中', () => {
    const store = makeStore(nodes);
    // 覆盖全部节点的查询矩形
    const hit = store.getSpatialIndex().queryRect(-100, -100, 1000, 1000);
    expect(hit.has('visible-1')).toBe(true);
    expect(hit.has('orphan-1')).toBe(true);
    expect(hit.has('tombstone-1')).toBe(false);
  });

  it('框选 hitTest: 选中集不含墓碑、含孤儿 —— 与层级树可见集口径一致', () => {
    const store = makeStore(nodes);
    const ctrl = new SelectionController(store);
    ctrl.beginMarquee(-100, -100);
    ctrl.updateMarquee(1000, 1000);
    const hit = ctrl.hitTest();
    expect(hit.has('visible-1')).toBe(true);
    expect(hit.has('orphan-1')).toBe(true);
    expect(hit.has('tombstone-1')).toBe(false);
    // 与统一可见性集合完全一致
    expect([...hit].sort()).toEqual(
      filterVisibleNodes(nodes).map((n) => n.id).sort(),
    );
  });
});

// ===== 4. 未知类型节点渲染为占位(不静默消失) =====

describe('幽灵节点治理: 孤儿节点占位渲染', () => {
  it('类型未注册的节点渲染"未知节点"占位,而非空壳/消失', () => {
    const orphan = makeNode('orphan-dom', { type: 'storyboard' });
    const store = makeStore([orphan]);
    const { container } = render(
      <NodeLayer
        nodes={[orphan]}
        extensions={new Map()}
        store={store}
        selectedIds={new Set()}
      />,
    );
    const placeholder = container.querySelector('[data-unknown-node="true"]');
    expect(placeholder).not.toBeNull();
    expect(placeholder!.textContent).toContain('未知节点 · storyboard');
    expect(placeholder!.textContent).toContain('orphan-dom');
  });

  it('墓碑节点在 NodeLayer 不渲染', () => {
    const tomb = makeNode('tomb-dom', { _deleted: true });
    const store = makeStore([tomb]);
    const { container } = render(
      <NodeLayer
        nodes={[tomb]}
        extensions={new Map()}
        store={store}
        selectedIds={new Set()}
      />,
    );
    expect(container.querySelector('[data-node-id]')).toBeNull();
  });
});

// ===== 5. 选中态样式: 2px 外扩 / 去红 / 反色 / 不扎眼 =====

describe('选中态样式(2026-11-04 治理)', () => {
  it('选中环外扩距离 == 2px,线宽 == 1px(二轮收敛 2→1)', () => {
    expect(SELECTION_RING_OFFSET).toBe(2);
    expect(SELECTION_RING_WIDTH).toBe(1);
  });

  it('选中色不含 accent 红 #e94560', () => {
    expect(SELECTION_RING_ON_DARK.toLowerCase()).not.toContain('#e94560');
    expect(SELECTION_RING_ON_LIGHT.toLowerCase()).not.toContain('#e94560');
  });

  it('深底节点 → 浅环;浅底节点 → 深环(反色方向,相对亮度对比)', () => {
    // 深底(主题默认 #16213e,WCAG 亮度 ≈ 0.016)
    const darkBg = '#16213e';
    const ringOnDark = selectionRingColor(darkBg);
    expect(ringOnDark).toBe(SELECTION_RING_ON_DARK);
    const darkBgLum = relativeLuminance(darkBg)!;
    const ringOnDarkLum = relativeLuminance(ringOnDark)!;
    expect(ringOnDarkLum).toBeGreaterThan(darkBgLum);

    // 浅底(#f5f5f4,WCAG 亮度 ≈ 0.9)
    const lightBg = '#f5f5f4';
    const ringOnLight = selectionRingColor(lightBg);
    expect(ringOnLight).toBe(SELECTION_RING_ON_LIGHT);
    const lightBgLum = relativeLuminance(lightBg)!;
    const ringOnLightLum = relativeLuminance(ringOnLight)!;
    expect(ringOnLightLum).toBeLessThan(lightBgLum);
  });

  it('rgba() 底色同样可解析;无法解析时回退深底白环', () => {
    expect(selectionRingColor('rgba(22, 33, 62, 1)')).toBe(SELECTION_RING_ON_DARK);
    expect(selectionRingColor('rgba(245, 245, 244, 1)')).toBe(SELECTION_RING_ON_LIGHT);
    expect(selectionRingColor('var(--weird)')).toBe(SELECTION_RING_ON_DARK);
    expect(selectionRingColor(undefined)).toBe(SELECTION_RING_ON_DARK);
  });

  it('选中环透明度 == 0.38(二轮收敛 0.55→0.38,区间 0.35–0.40)', () => {
    const alpha = (c: string): number => Number(/[\d.]+\)$/.exec(c)![0].replace(')', ''));
    expect(alpha(SELECTION_RING_ON_DARK)).toBe(0.38);
    expect(alpha(SELECTION_RING_ON_LIGHT)).toBe(0.38);
    expect(alpha(SELECTION_RING_ON_DARK)).toBeLessThanOrEqual(0.4);
    expect(alpha(SELECTION_RING_ON_LIGHT)).toBeGreaterThanOrEqual(0.35);
  });
});
