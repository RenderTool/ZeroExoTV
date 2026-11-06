/**
 * resize 拖拽全链路集成测试(2026-11-04)
 *
 * 用户实测「图片节点无法缩放」。本测试驱动真实链路:
 *   InteractionController.handleResizeHandlePointerDown
 *   → handlePointerMove → handlePointerUp
 *   → ResizeNodeCommand → CommandQueue → ReactGraphStore
 * 断言 node.width/height(node.size + data.width/height)实际发生变化。
 *
 * 【改动前失败 / 改动后通过】对照:
 *   改动前 ResizeNodeCommand 只写 data.width/height、不写 node.size,
 *   而渲染层 resolveNodeSize 优先读 node.size → 拖角后视觉尺寸纹丝不动。
 *   断言 node.size 变化的用例在旧实现下必败,在修复后通过。
 *
 * 等价最小测试: 不挂载 React,直接以真实 store/queue/controller 跑 pointer 事件序列
 * (controller/store 全部 DOM 访问均已 null 安全,node 环境可跑)。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CommandQueue, EventBus } from '@zeroexo/core';
import type { GraphModel } from '@zeroexo/core';
// 深路径导入: 包入口 index 会拉起全部 React 组件链(@lobehub/fluent-emoji ESM 目录导入不兼容 vitest),
// store.ts 本身仅依赖 react 运行时与纯函数模块,可独立加载
import { ReactGraphStore } from '../../render-react/src/store.js';
import { InteractionController } from './controller.js';
import type { ResizeConfig } from './types.js';

const IMAGE_RESIZE_CONFIG: ResizeConfig = {
  resizable: true,
  lockAspectRatio: true,
  minSize: { width: 80, height: 80 },
  defaultSize: { width: 620, height: 348 },
};

function makeGraph(): GraphModel {
  return {
    nodes: [
      {
        id: 'img-1',
        type: 'image',
        position: { x: 0, y: 0 },
        size: { width: 620, height: 348 },
        data: { naturalWidth: 3000, naturalHeight: 1000 },
      } as unknown as GraphModel['nodes'][number],
    ],
    edges: [],
    viewport: { x: 0, y: 0, k: 1 },
  } as GraphModel;
}

function fakePointer(x: number, y: number): PointerEvent {
  return {
    button: 0,
    pointerType: 'mouse',
    clientX: x,
    clientY: y,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    stopPropagation: () => {},
    preventDefault: () => {},
  } as unknown as PointerEvent;
}

describe('拖角 resize 全链路: pointerdown → move → up 后节点尺寸必须实际变化', () => {
  let store: ReactGraphStore;
  let queue: CommandQueue;
  let controller: InteractionController;

  beforeEach(() => {
    const bus = new EventBus();
    queue = new CommandQueue(makeGraph(), bus);
    store = new ReactGraphStore(queue, bus);
    controller = new InteractionController(store, queue, () => null);
    controller.setResizeConfigAccessor((nodeId) => (nodeId === 'img-1' ? IMAGE_RESIZE_CONFIG : null));
  });

  it('se 角向右拖 +100px: node.size 与 data.width/height 同步变化,且锁比例', () => {
    const before = store.getNode('img-1')!;
    expect(before.size).toEqual({ width: 620, height: 348 });

    controller.handleResizeHandlePointerDown(fakePointer(620, 348), 'img-1', 'se');
    controller.handlePointerMove(fakePointer(720, 400));
    controller.handlePointerUp();

    const after = store.getNode('img-1')!;
    // 【核心断言】渲染层读的 node.size 必须变化(改动前:620×348 纹丝不动,本断言失败)
    expect(after.size).toBeDefined();
    expect(after.size!.width).toBeCloseTo(720, 0);
    expect(after.size!.width).toBeGreaterThan(before.size!.width);
    // 锁比例: 620/348 契约比例恒定(误差 <1%)
    const contract = 620 / 348;
    const ratio = after.size!.width / after.size!.height;
    expect(Math.abs(ratio - contract) / contract).toBeLessThan(0.01);
    // data.width/height 同步(持久化/序列化通道)
    expect((after.data as { width?: number }).width).toBeCloseTo(after.size!.width, 0);
    expect((after.data as { height?: number }).height).toBeCloseTo(after.size!.height, 0);
    // 位置不动(se 角拖拽锚定 nw)
    expect(after.position).toEqual({ x: 0, y: 0 });
  });

  it('nw 角拖拽: node.size 变化且对角(se)坐标不动', () => {
    controller.handleResizeHandlePointerDown(fakePointer(0, 0), 'img-1', 'nw');
    controller.handlePointerMove(fakePointer(-60, -30));
    controller.handlePointerUp();

    const after = store.getNode('img-1')!;
    expect(after.size!.width).toBeGreaterThan(620);
    // nw 拖拽: 右下角 (x+width, y+height) 不动
    expect(after.position.x + after.size!.width).toBeCloseTo(620, 0);
    expect(after.position.y + after.size!.height).toBeCloseTo(348, 0);
  });

  it('undo 恢复原始尺寸(node.size 一并回滚)', () => {
    controller.handleResizeHandlePointerDown(fakePointer(620, 348), 'img-1', 'se');
    controller.handlePointerMove(fakePointer(720, 400));
    controller.handlePointerUp();
    expect(store.getNode('img-1')!.size!.width).toBeCloseTo(720, 0);

    queue.undo();
    const reverted = store.getNode('img-1')!;
    expect(reverted.size).toEqual({ width: 620, height: 348 });
  });

  it('微位移(<3px 阈值)不产生尺寸变化', () => {
    controller.handleResizeHandlePointerDown(fakePointer(620, 348), 'img-1', 'se');
    controller.handlePointerMove(fakePointer(621, 349));
    controller.handlePointerUp();
    expect(store.getNode('img-1')!.size).toEqual({ width: 620, height: 348 });
  });

  it('节点拖拽链路不受 resize 修复影响: pointerdown(模拟从 img 冒泡到节点外层)→ move → up 位置变化、尺寸不变', () => {
    // 证据: img 元素 pointerEvents:none(image-node-view.tsx:307/375),pointerdown
    // 实际命中 media 容器并冒泡到 NodeLayer 外层 div → handleNodePointerDown,
    // 图片节点上没有注册任何 pointerdown/stopPropagation,本用例模拟该冒泡结果。
    controller.handleNodePointerDown(fakePointer(100, 100), 'img-1');
    controller.handlePointerMove(fakePointer(160, 140));
    controller.handlePointerUp();

    const after = store.getNode('img-1')!;
    expect(after.position).toEqual({ x: 60, y: 40 });
    expect(after.size).toEqual({ width: 620, height: 348 });
  });
});
