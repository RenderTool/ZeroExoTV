/**
 * bugfix-20261104 - 三 BUG 修复的回归断言(2026-11-04)
 *
 * 覆盖:
 * 1. 节点删除链路 —— 删除后文档(物理路径)与层级树列表均不含该 id;画布数据源(活跃节点集)不含该 id
 * 2. 层级缩略图失效 —— 同 storageKey 覆盖写后内容版本 +1 且派发事件,缓存 key 随之失效
 * 3. 图片节点尺寸 —— 导入按容器等比 fit(最长边贴 620、短边按比例、宽高比恒不变、不爆炸);
 *    角点 resize 在 lockAspectRatio 下宽高比恒定
 *
 * 注意: 深路径直连源文件,绕开包级 index(plugin-nodes 链到 antd/fluent-emoji,
 * jsdom 无法解析 ESM 目录导入 —— 与 workbench-sync.test.ts 同一规避手法)。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, render, act, waitFor } from '@testing-library/react';

// hierarchy-panel.tsx 从包级 index 引 useGraph/useSelection —— mock 为深路径 store 模块,
// 避免 index → canvas-view → … 的重组件链
vi.mock('@zeroexo/plugin-render-react', async () => {
  return await import('../../../../packages/plugins/render-react/src/store.js');
});
// hierarchy-list-view.tsx 引包级 index(链 antd/fluent-emoji) —— mock 成本测试需要的两个函数
vi.mock('@zeroexo/plugin-nodes', () => ({
  buildBackendUrl: () => null,
  resolveContentUrl: async (_k: string, c: string) => c,
}));
// Bug2b 用例: 缩略图解析器可编程(模拟"派生图尚未就绪 → 就绪"时序),其余符号保留真实实现
const persistenceState = vi.hoisted(() => ({ previewReady: false }));
// Bug2b 用例：派生图就绪时序现在由「按变体读 Blob」的媒体链决定（字符串解析链已下线）
const mediaChainState = vi.hoisted(() => ({ ready: false }));
vi.mock('@/shared/media/resolve-media-blob.js', () => ({
  resolveMediaBlob: vi.fn(async () => null),
  resolveMediaBlobChain: async () => (
    mediaChainState.ready ? { blob: new Blob(['preview']), origin: 'preview' } : null
  ),
}));
vi.mock('@zeroexo/plugin-persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zeroexo/plugin-persistence')>();
  return {
    ...actual,
    resolvePreviewUrl: async () => (persistenceState.previewReady ? 'blob:preview-ready' : ''),
    resolveThumbnailUrl: async () => '',
    resolveVideoThumbnail: async () => '',
  };
});
// 授权媒体组件走 fetch+鉴权,测试环境替换为裸标签
vi.mock('@/shared/components/authorized-media.js', () => ({
  AuthorizedImage: (props: { src?: string }) => <img src={props.src} alt="" />,
  AuthorizedVideo: (props: { src?: string }) => <video src={props.src} />,
}));
// hierarchy-panel.tsx 用 useTranslation;测试环境无 i18n 初始化,透传 key 即可
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import {
  CommandQueue,
  EventBus,
  AddNodeCommand,
  RemoveNodeCommand,
  ResizeNodeCommand,
} from '@zeroexo/core';
import { ReactGraphStore } from '@zeroexo/plugin-render-react';
import { ReplaceSceneCommand } from '../../../../packages/plugins/group/src/commands';
import { useHierarchyPanelProps } from '../../../../packages/plugins/group/src/hierarchy-panel';
import { createAssetNode } from '../../../../packages/plugins/nodes/src/asset-node-factory';
import { computeResizeRect } from '../../../../packages/plugins/interaction/src/resize-geometry';
import {
  CONTENT_SCALE_MAX,
  CONTENT_SCALE_MIN,
  cursorOriginPercent,
  nextContentScale,
  oneToOneScale,
  toggleContentScale,
} from '../../../../packages/plugins/nodes/src/utils/image-content-zoom';
import {
  __configureMediaUrlProviderForTests,
  IMAGE_CONTENT_UPDATED_EVENT,
  getImageContentVersion,
  bumpImageContentVersion,
} from '@zeroexo/plugin-persistence';
import { HierarchyThumbnail } from '../../../features/hierarchy/components/hierarchy-list-view';

// ===== 工具 =====

function makeNode(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'image',
    position: { x: 0, y: 0 },
    size: { width: 620, height: 620 },
    data: {},
    ...overrides,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function makeStore(nodes: ReturnType<typeof makeNode>[] = []) {
  const eventBus = new EventBus();
  const queue = new CommandQueue(
    { nodes, edges: [], viewport: { x: 0, y: 0, k: 1 }, metadata: {} },
    eventBus,
  );
  const store = new ReactGraphStore(queue, eventBus);
  return { eventBus, queue, store };
}

/** 收集层级树中全部节点 id(拍平) */
function collectTreeIds(tree: { node: { id: string } }[]): string[] {
  return tree.map((item) => item.node.id);
}

// ===== Bug 1: 节点删除链路 =====

describe('Bug1 节点删除链路', () => {
  it('物理路径(ReplaceSceneCommand —— 键盘 Delete / 层级面板删除 / 右键删除统一口径): 删除后 docs.nodes 不含该 id', () => {
    const { queue, store } = makeStore();
    queue.execute(new AddNodeCommand(makeNode('n1')));
    queue.execute(new AddNodeCommand(makeNode('n2')));
    expect(store.getGraph().nodes.map((n) => n.id)).toEqual(['n1', 'n2']);

    // 与 groupCtrl.deleteSceneNode / deleteNodes 执行同一命令: 从文档物理移除
    queue.execute(
      new ReplaceSceneCommand(store.getGraph().nodes.filter((n) => n.id !== 'n1')),
    );
    const ids = store.getGraph().nodes.map((n) => n.id);
    expect(ids).not.toContain('n1');
    expect(ids).toEqual(['n2']);
  });

  it('墓碑路径(RemoveNodeCommand —— 回收站/内部占位清理): 画布数据源与层级树均不含该 id', () => {
    const { queue, store } = makeStore();
    queue.execute(new AddNodeCommand(makeNode('n1')));
    queue.execute(new AddNodeCommand(makeNode('n2')));
    queue.execute(new RemoveNodeCommand('n1'));

    // 文档里仍是墓碑(undo/回收站设计,见 builtins.ts Plan#80)……
    const tombstoned = store.getGraph().nodes.find((n) => n.id === 'n1');
    expect(tombstoned?._deleted).toBe(true);

    // ……但画布渲染数据源(活跃节点集)不含该 id
    expect(store.getActiveNodeIdSet().has('n1')).toBe(false);
    expect(store.getActiveNodeIdSet().has('n2')).toBe(true);

    // 层级树也不含该 id(修复点: hierarchy-panel.tsx tree useMemo 过滤 _deleted)
    // controller 仅用于交互回调,树构建只读 store —— 传最小桩即可
    const { result } = renderHook(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      useHierarchyPanelProps(store, {} as any),
    );
    const ids = collectTreeIds(result.current.tree);
    expect(ids).not.toContain('n1');
    expect(ids).toContain('n2');
  });

  it('undo 复活: ReplaceSceneCommand.undo 恢复原场景', () => {
    const { queue, store } = makeStore();
    queue.execute(new AddNodeCommand(makeNode('n1')));
    const before = store.getGraph().nodes;
    queue.execute(new ReplaceSceneCommand(before.filter((n) => n.id !== 'n1')));
    expect(store.getGraph().nodes.map((n) => n.id)).toEqual([]);
    queue.undo();
    expect(store.getGraph().nodes.map((n) => n.id)).toEqual(['n1']);
  });
});

// ===== Bug 2: 层级缩略图失效(版本号 + 事件) =====

describe('Bug2 缩略图失效策略', () => {
  it('同 storageKey 覆盖写后内容版本 +1(缓存 key 拼版本号 → 旧条目自然失效)', () => {
    const key = 'image:bug2-test';
    const v0 = getImageContentVersion(key);
    bumpImageContentVersion(key);
    const v1 = getImageContentVersion(key);
    expect(v1).toBe(v0 + 1);
    bumpImageContentVersion(key);
    expect(getImageContentVersion(key)).toBe(v0 + 2);
  });

  it('覆盖写完成时派发 IMAGE_CONTENT_UPDATED_EVENT(detail.storageKey 匹配)', () => {
    const key = 'image:bug2-event';
    const listener = vi.fn();
    window.addEventListener(IMAGE_CONTENT_UPDATED_EVENT, listener);
    bumpImageContentVersion(key);
    expect(listener).toHaveBeenCalledTimes(1);
    const evt = listener.mock.calls[0]![0] as CustomEvent<{ storageKey: string }>;
    expect(evt.detail.storageKey).toBe(key);
    window.removeEventListener(IMAGE_CONTENT_UPDATED_EVENT, listener);
  });
});

// ===== Bug 3: 图片节点尺寸(fit + 宽高比恒定) =====

describe('Bug3 图片节点导入尺寸(容器等比 fit)', () => {
  it('横图 1600×900 → 620×349(长边贴容器,宽高比不变)', async () => {
    const node = await createAssetNode(
      { kind: 'image', dataUrl: '', title: 't', storageKey: 'image:t1', width: 1600, height: 900 },
      { x: 0, y: 0 },
    );
    expect(node!.size!.width).toBe(620);
    expect(Math.abs(node!.size!.height - 620 * (900 / 1600))).toBeLessThanOrEqual(1);
  });

  it('竖图 1000×3000 → 207×620(不再被宽度锚定成 620×1860 超长节点)', async () => {
    const node = await createAssetNode(
      { kind: 'image', dataUrl: '', title: 't', storageKey: 'image:t2', width: 1000, height: 3000 },
      { x: 0, y: 0 },
    );
    expect(node!.size!.height).toBe(620);
    expect(Math.abs(node!.size!.width - 620 * (1000 / 3000))).toBeLessThanOrEqual(1);
  });

  it('方图 2048×2048 → 620×620(不按原始像素铺开)', async () => {
    const node = await createAssetNode(
      { kind: 'image', dataUrl: '', title: 't', storageKey: 'image:t3', width: 2048, height: 2048 },
      { x: 0, y: 0 },
    );
    expect(node!.size).toEqual({ width: 620, height: 620 });
  });

  it('小图 40×40 → 短边抬到最小尺寸且等比(不变形)', async () => {
    const node = await createAssetNode(
      { kind: 'image', dataUrl: '', title: 't', storageKey: 'image:t4', width: 40, height: 40 },
      { x: 0, y: 0 },
    );
    expect(node!.size!.width).toBe(node!.size!.height); // 宽高比 1:1 恒定
    expect(node!.size!.width).toBeGreaterThanOrEqual(80);
  });

  it('角点 resize 在 lockAspectRatio 下宽高比恒定', () => {
    const start = { x: 0, y: 0, width: 620, height: 620 };
    const config = { resizable: true, minSize: { width: 80, height: 80 }, lockAspectRatio: true };
    const rect = computeResizeRect(start, 'se', config, 120, 40);
    const ratioBefore = start.width / start.height;
    const ratioAfter = rect.width / rect.height;
    expect(Math.abs(ratioAfter - ratioBefore)).toBeLessThan(0.01);
    // ResizeNodeCommand 存在且可用于提交(缩放交互链路落点)
    expect(typeof ResizeNodeCommand).toBe('function');
  });
});

// ===== Bug 3 补: 节点内内容缩放(滚轮 + 双击,不依赖选中态) =====

describe('Bug3b 图片节点内容缩放(滚轮/双击实际改变缩放值)', () => {
  it('滚轮向上(deltaY<0)放大、向下(deltaY>0)缩小', () => {
    const s1 = nextContentScale(1, -100); // 向上滚
    expect(s1).toBeGreaterThan(1);
    const s2 = nextContentScale(1, 100); // 向下滚
    expect(s2).toBeLessThan(1);
    // 连续滚动单调累积
    const s3 = nextContentScale(s1, -100);
    expect(s3).toBeGreaterThan(s1);
  });

  it('缩放被夹在 [0.1, 10],不会缩没/爆掉', () => {
    let s = 1;
    for (let i = 0; i < 100; i++) s = nextContentScale(s, -1000);
    expect(s).toBe(CONTENT_SCALE_MAX);
    for (let i = 0; i < 200; i++) s = nextContentScale(s, 1000);
    expect(s).toBe(CONTENT_SCALE_MIN);
  });

  it('双击 fit ↔ 目标倍率往返切换', () => {
    const zoomed = toggleContentScale(1, 2);
    expect(zoomed).toBe(2);
    expect(toggleContentScale(zoomed, 2)).toBe(1);
  });

  it('1:1 倍率按 contain 显示尺寸计算(2000×1000 图 / 620×620 盒 → 2000/620)', () => {
    const s = oneToOneScale(2000, 1000, 620, 620);
    expect(s).not.toBeNull();
    expect(Math.abs(s! - 2000 / 620)).toBeLessThan(0.001);
    // 入参缺失回退 null(组件回退固定 2×)
    expect(oneToOneScale(undefined, undefined, 620, 620)).toBeNull();
  });

  it('滚轮锚点取光标在容器内的百分比位置(光标处即缩放中心)', () => {
    const rect = { left: 100, top: 50, width: 400, height: 200 };
    expect(cursorOriginPercent(300, 150, rect)).toEqual({ x: 50, y: 50 });
    expect(cursorOriginPercent(100, 50, rect)).toEqual({ x: 0, y: 0 });
    // 越界钳制
    expect(cursorOriginPercent(9999, -5, rect)).toEqual({ x: 100, y: 0 });
  });
});

// ===== Bug2b: 导入图片后层级缩略图不刷新(首次上传路径,2026-11-04 复测) =====
// 根因: uploadImage 派生图(缩略图/预览图)fire-and-forget 异步生成,完成时不 bump 版本;
// HierarchyThumbnail 解析 effect 在节点出现即跑,派生图未就绪 → 落空且无重触发。
// 修复: uploadImage 待派生任务落定后 bumpImageContentVersion(与 setImageBlob 同一机制)。

describe('Bug2b: 导入图片后层级缩略图不刷新', () => {
  beforeEach(() => {
    // 每个用例重置媒体 URL 提供者（会话级缓存），并给出可控 object URL
    __configureMediaUrlProviderForTests();
    mediaChainState.ready = false;
    (URL as unknown as Record<string, unknown>).createObjectURL = vi.fn(() => 'blob:preview-ready');
    (URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn();
  });

  it('派生图就绪事件到达后,同一挂载实例的 img src 更新(不重挂载)', async () => {
    mediaChainState.ready = false;
    const v0 = getImageContentVersion('image:import-1');

    const { container } = render(
      <HierarchyThumbnail
        storageKey="image:import-1"
        content=""
        isVideo={false}
        borderColor="#333"
        mutedColor="#888"
      />,
    );

    // 初始: 派生图未就绪 → 无 img,渲染占位图标(svg)而非空白
    await waitFor(() => {
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('svg')).not.toBeNull();
    });

    // 模拟 uploadImage 修复: 派生图生成完成 → bump 内容版本(派发 window 事件)
    mediaChainState.ready = true;
    act(() => {
      bumpImageContentVersion('image:import-1');
    });

    // 版本号 +1(缓存 key 带修订标识,避免旧内容污染)
    expect(getImageContentVersion('image:import-1')).toBe(v0 + 1);

    // 关键断言: 组件未重挂载,同一实例的 img src 已变为新解析结果
    await waitFor(() => {
      expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:preview-ready');
    });
  });

  it('始终无图时保持占位图标(不渲染空白 img)', async () => {
    mediaChainState.ready = false;
    const { container } = render(
      <HierarchyThumbnail
        storageKey="image:never-ready"
        content=""
        isVideo={false}
        borderColor="#333"
        mutedColor="#888"
      />,
    );
    await waitFor(() => {
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('svg')).not.toBeNull();
    });
    // 无关 storageKey 的事件不应影响本组件
    act(() => {
      bumpImageContentVersion('image:other-key');
    });
    await waitFor(() => {
      expect(container.querySelector('img')).toBeNull();
    });
  });
});
