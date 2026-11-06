/**
 * ConnectionController - 连线交互控制器
 * 处理: 端口拖拽创建连线、端口类型校验、临时连线渲染数据
 *
 * 工作流:
 * 1. 用户在端口上 pointerdown → 开始拖拽,记录源端口
 * 2. pointermove → 更新临时连线终点(鼠标世界坐标)
 * 3. pointerup → 检测是否在目标端口上,校验后创建 AddEdgeCommand
 *
 * 不依赖 React,可在任意框架使用。临时连线状态通过 subscribe 暴露。
 */

import { AddEdgeCommand, BatchCommand } from '@zeroexo/core';
import type { CommandQueue } from '@zeroexo/core';
import type { NodeTypeExtension } from '@zeroexo/core';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';

/** 临时连线状态(null 表示无拖拽) */
export interface PendingConnection {
  /** 源节点 id */
  sourceNodeId: string;
  /** 源端口 id */
  sourcePinId: string;
  /** 源端口方向(决定起点在节点左侧还是右侧) */
  sourceDirection: 'input' | 'output';
  /** 源端口世界坐标(像素,已应用视口逆变换) */
  sourceX: number;
  sourceY: number;
  /** 当前鼠标世界坐标 */
  currentX: number;
  currentY: number;
  /** 组 pin 展开后的源端点列表(用于渲染多条预览线) */
  groupSourceEndpoints?: ConnectionEndpoint[];
}

/** 连线校验结果 */
export interface ConnectionValidation {
  valid: boolean;
  reason?: string;
}

/** 连线端点信息(传递给 NodeTypeExtension.canConnect 钩子) */
export interface ConnectionEndpoint {
  nodeId: string;
  pinId: string;
  direction: 'input' | 'output';
}

/** 节点类型扩展访问器(由 demo 从 NodeRegistryPlugin 注入,用于查询 canConnect 钩子) */
export type ExtensionAccessor = (nodeId: string) => NodeTypeExtension | undefined;

/**
 * 连线拖拽 snap 距离(屏幕像素,视觉恒定,不随缩放变化)。
 * 鼠标在 pin 周围该像素距离内时,预览线终点自动吸附到 pin 中心世界坐标,
 * 松手时 hoverTarget 直接拿吸附到的 pin,零命中误差。
 * 32px ≈ pin 视觉半径(14px × viewport 缩放反变换) + 18px 宽容度,
 * 保证用户哪怕点在 pin 边缘/附近空白处也能触发 snap。
 */
const PIN_SNAP_SCREEN_DISTANCE = 32;

/**
 * 组 pin 展开器(由 app 装配时注入,解耦 connection 与 group 插件)。
 *
 * 功能:将组聚合 pin(GROUP_INPUT_PIN_ID / GROUP_OUTPUT_PIN_ID)展开为
 * 组内所有叶子节点(跳过嵌套组)对应方向的 pin 端点列表。
 *
 * 用途:用户拖组 pin 连线时,等效于组内所有叶子节点的 pin 批量连线。
 * "遇到内部有嵌套组的情况下就跳过该组" — getLeafDescendants 已实现此语义。
 *
 * 由 app 注入实现(用 plugin-group 的 getLeafDescendants + extensions.getPins)。
 */
export type GroupPinExpander = (
  groupId: string,
  direction: 'input' | 'output',
) => ConnectionEndpoint[];

// ===== 组 pin 常量(与 @zeroexo/plugin-group 保持一致,避免循环依赖) =====
const GROUP_INPUT_PIN_ID = '__group_in__';
const GROUP_OUTPUT_PIN_ID = '__group_out__';

/** 连线拖拽释放于空白区域时的回调(用于弹出节点创建菜单) */
export type ConnectionDropCallback = (
  source: { nodeId: string; nodeType: string; pinId: string; direction: 'input' | 'output' },
  screenX: number,
  screenY: number,
  worldX: number,
  worldY: number,
) => void;

export class ConnectionController {
  private pending: PendingConnection | null = null;
  /** 预览线终点是否锁定(面板弹出后不再跟随指针移动) */
  private pendingLocked = false;
  private readonly listeners = new Set<() => void>();
  /** 当前悬停的目标端口(pointerenter/leave 追踪) */
  private hoverTarget: { nodeId: string; pinId: string; direction: 'input' | 'output' } | null = null;
  /** 拖拽时鼠标下方的节点 id(用于高亮可自动连接的目标节点) */
  private hoverNodeId: string | null = null;
  /** 最后一次指针屏幕坐标(pointerup 时 elementFromPoint 兜底用) */
  private lastClientX = 0;
  private lastClientY = 0;
  /** 节点类型扩展访问器(由 demo 注入,用于查询 NodeTypeExtension.canConnect 钩子) */
  private extensionAccessor: ExtensionAccessor | null = null;
  /** 组 pin 展开器(由 app 注入,用于组 pin 批量连线;null 时组 pin 退化为普通 pin) */
  private groupPinExpander: GroupPinExpander | null = null;
  /** 连线释放于空白区域时的回调(用于弹出节点创建菜单) */
  private dropCallback: ConnectionDropCallback | null = null;
  /** 节点锁定访问器(由 app 注入,生成中节点返回 true → 禁止连线) */
  private nodeLockedAccessor: ((nodeId: string) => boolean) | null = null;
  /** 节点类型兼容性检查器(由 app 注入,统一连线约束矩阵) */
  private compatibilityChecker: ((sourceType: string, targetType: string) => boolean) | null = null;

  constructor(
    private store: ReactGraphStore,
    private commandQueue: CommandQueue,
    /** 容器元素访问器(用于坐标转换,修正工具栏等布局偏移) */
    private getContainer: () => HTMLElement | null = () => null,
  ) {}

  /** 注入节点类型扩展访问器(用于 canConnect 连线约束钩子) */
  setExtensionAccessor(accessor: ExtensionAccessor | null): void {
    this.extensionAccessor = accessor;
  }

  /**
   * 注入组 pin 展开器(用于组 pin 批量连线)。
   *
   * 展开器将组聚合 pin(__group_in__ / __group_out__)展开为组内所有叶子节点
   * 对应方向的 pin 端点列表(跳过嵌套组)。
   * 不注入时,组 pin 退化为普通 pin(只创建单条 edge 到组节点本身,无批量效果)。
   */
  setGroupPinExpander(expander: GroupPinExpander | null): void {
    this.groupPinExpander = expander;
  }

  /** 注入连线释放回调(拖拽到空白区域时触发,用于弹出节点创建菜单) */
  setDropCallback(cb: ConnectionDropCallback | null): void {
    this.dropCallback = cb;
  }

  /** 注入节点锁定访问器(由 app 注入,生成中节点返回 true → 禁止连线) */
  setNodeLockedAccessor(accessor: ((nodeId: string) => boolean) | null): void {
    this.nodeLockedAccessor = accessor;
  }

  /** 注入节点类型兼容性检查器(由 app 注入,统一连线约束矩阵;null 时不校验) */
  setCompatibilityChecker(checker: ((sourceType: string, targetType: string) => boolean) | null): void {
    this.compatibilityChecker = checker;
  }

  /** 判断节点是否锁定(生成中禁止连线) */
  isNodeLocked(nodeId: string): boolean {
    return this.nodeLockedAccessor?.(nodeId) ?? false;
  }

  // ===== 临时连线状态订阅 =====

  getPending = (): PendingConnection | null => this.pending;
  getHoverNodeId = (): string | null => this.hoverNodeId;

  /** 获取当前悬停节点的连接验证结果(用于显示 tooltip) */
  getHoverNodeValidation = (): ConnectionValidation | null => {
    if (!this.pending || !this.hoverNodeId) return null;
    const autoTarget = this.findNodeAutoConnectTarget();
    if (!autoTarget) return { valid: false, reason: '该节点无可连接的端口' };
    return this.validate(this.pending, autoTarget);
  };
  subscribePending = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private notify = (): void => {
    this.listeners.forEach((l) => l());
  };

  // ===== 端口事件(由渲染层注入) =====

  /** 端口 pointerdown - 开始连线拖拽 */
  handlePinPointerDown = (
    event: PointerEvent,
    pinEl: HTMLElement,
    nodeId: string,
    pinId: string,
    direction: 'input' | 'output',
  ): void => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();

    // 生成中节点锁定:禁止从其引脚拉出连线
    if (this.isNodeLocked(nodeId)) return;

    // 记录指针坐标(防止用户没移动鼠标就 pointerup 时 findPinAtPointer 用初始值 0,0)
    this.lastClientX = event.clientX;
    this.lastClientY = event.clientY;

    // 获取端口圆点的屏幕坐标
    // 使用 pinEl(父容器)的 getBoundingClientRect,避免 [data-pin-dot] 的
    // transform:scale(invSx,invSy) 反向缩放导致坐标偏移
    const rect = pinEl.getBoundingClientRect();
    const centerY = rect.top + rect.height / 2;

    // 起点在节点边缘(UE 风格产品意图,防预览线悬空)。
    // Plan#68 勘误: 实际容器几何下 pin 圆点自然中心在节点边缘外 ~15k px
    // (容器 left=-40/width=32 → 右缘=-8k, flex-end 对齐再内收半宽),并非本注释
    // 原先所称"边缘内 pinSize/2";起点保持节点边缘是刻意的视觉锚定,非几何推导
    const nodeEl = pinEl.closest('[data-node-id]') as HTMLElement | null;
    let edgeX: number;
    if (nodeEl) {
      const nodeRect = nodeEl.getBoundingClientRect();
      edgeX = direction === 'input' ? nodeRect.left : nodeRect.right;
    } else {
      edgeX = rect.left + rect.width / 2;
    }
    const world = this.screenToWorld(edgeX, centerY);

    // 如果是组 pin,展开为组内所有叶子节点的 pin 端点列表
    const isGroupPin = this.isGroupPinEndpoint(nodeId, pinId);
    const groupSourceEndpoints = isGroupPin && this.groupPinExpander
      ? this.groupPinExpander(nodeId, direction)
      : undefined;

    this.pending = {
      sourceNodeId: nodeId,
      sourcePinId: pinId,
      sourceDirection: direction,
      sourceX: world.x,
      sourceY: world.y,
      currentX: world.x,
      currentY: world.y,
      groupSourceEndpoints,
    };
    this.hoverTarget = null;
    // 源 pin 高亮:给 pin-dot 加 data-pin-connecting 属性
    const sourceDot = pinEl.querySelector('[data-pin-dot]') as HTMLElement | null;
    if (sourceDot) sourceDot.setAttribute('data-pin-connecting', 'true');
    // 拖拽期间全局 cursor 变十字:在 viewport 元素上设 data-connection-pending="true",
    // 由 cursor-styles.ts 注入的 !important CSS 规则接管(比 body.style.cursor 优先级高)
    const viewportEl = document.querySelector('[data-canvas-viewport]');
    if (viewportEl) (viewportEl as HTMLElement).setAttribute('data-connection-pending', 'true');
    this.notify();
  };

  /** rAF 节流 id */
  private rafId = 0;

  /** 全局 pointermove - 更新临时连线终点(rAF 节流) */
  handlePointerMove = (event: PointerEvent): void => {
    this.lastClientX = event.clientX;
    this.lastClientY = event.clientY;
    if (!this.pending) return;

    // 预览线终点已锁定(面板弹出后),不再跟随指针移动
    if (this.pendingLocked) return;

    // === Snap 到最近 pin ===
    // 每次 pointermove 都查最近 pin(屏幕像素距离,不随缩放变化),
    // 在 SNAP_DISTANCE 内时强制把 currentX/Y 设为 pin 中心世界坐标。
    // 坐标系:findNearestPinOnScreen 返回 pin 圆点中心 client 坐标,
    // screenToWorld 转换为世界坐标(用 getContainer 视频口 div 偏移修正),
    // 层渲染时 pending.currentX * viewport.k + viewport.x 还原为
    // 视口 div 坐标系坐标,roundtrip 无损。
    const nearestPin = this.findNearestPinOnScreen(event.clientX, event.clientY);
    const snapWorld = nearestPin
      ? this.screenToWorld(nearestPin.screenCenterX, nearestPin.screenCenterY)
      : null;

    // snap 命中时高亮目标 pin
    this.updateSnapHighlight(nearestPin);

    // 更新 pending 坐标:snap 时用 pin 中心世界坐标,否则跟随鼠标
    const rawWorld = this.screenToWorld(event.clientX, event.clientY);
    this.pending = {
      ...this.pending,
      currentX: snapWorld ? snapWorld.x : rawWorld.x,
      currentY: snapWorld ? snapWorld.y : rawWorld.y,
    };
    // snap 同步 hoverTarget:命中 pin 但没触发 pointerenter 时补一个
    if (nearestPin) {
      if (!this.hoverTarget ||
          this.hoverTarget.nodeId !== nearestPin.nodeId ||
          this.hoverTarget.pinId !== nearestPin.pinId) {
        this.hoverTarget = { nodeId: nearestPin.nodeId, pinId: nearestPin.pinId, direction: nearestPin.direction };
      }
    } else {
      // 没 snap 目标且也不是 pointerenter 追踪的 hoverTarget → 清空
      // 注意:不能无条件清空,因为 pointerenter 可能还没被事件循环派发
      if (this.hoverTarget) {
        const htEl = document.querySelector(
          `[data-node-id="${this.hoverTarget.nodeId}"] [data-pin-id="${this.hoverTarget.pinId}"]`,
        ) as HTMLElement | null;
        if (htEl && htEl.matches(':hover')) {
          // pointerenter 仍生效,保留
        } else {
          this.hoverTarget = null;
        }
      }
    }

    // 用 rAF 节流通知,避免高频 pointermove 触发过多 React 重渲染
    if (!this.rafId) {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = 0;
        this.hoverNodeId = this.findNodeUnderPointer();
        this.notify();
      });
    }
  };

  /** 上一次 snap 高亮的 pin 元素(用于切换 snap 目标时清掉旧高亮 + dispose 时无残留) */
  private snapHighlightEl: HTMLElement | null = null;
  /** 清除 snap 高亮(无残留) */
  private clearSnapHighlight(): void {
    if (this.snapHighlightEl) {
      this.snapHighlightEl.removeAttribute('data-pin-snap');
      this.snapHighlightEl = null;
      this.lastSnapTargetKey = null;
    }
  }
  /** 上一次 snap 命中的 pin 标识(nodeId + pinId,用于检测 snap 目标变化) */
  private lastSnapTargetKey: string | null = null;
  /** 更新 snap 高亮 DOM 状态 */
  private updateSnapHighlight(nearestPin: { nodeId: string; pinId: string } | null): void {
    if (!nearestPin) { this.clearSnapHighlight(); return; }
    const key = `${nearestPin.nodeId}::${nearestPin.pinId}`;
    if (key === this.lastSnapTargetKey) return;
    if (this.snapHighlightEl) { this.snapHighlightEl.removeAttribute('data-pin-snap'); }
    const newEl = document.querySelector(
      `[data-node-id="${nearestPin.nodeId}"] [data-pin-id="${nearestPin.pinId}"] [data-pin-dot]`,
    ) as HTMLElement | null;
    if (newEl) { newEl.setAttribute('data-pin-snap', 'true'); this.snapHighlightEl = newEl; }
    this.lastSnapTargetKey = key;
  }

  /** 连线释放于空白区域时的回调(用于弹出节点创建菜单) */
  private clearPending = (): void => {
    this.clearSourcePinHighlight();
    this.pending = null;
    this.hoverTarget = null;
    this.hoverNodeId = null;
    this.pendingLocked = false;
    this.clearSnapHighlight();
    const viewportEl = document.querySelector('[data-canvas-viewport]');
    if (viewportEl) (viewportEl as HTMLElement).removeAttribute('data-connection-pending');
  };

  /** 清除源 pin 高亮 */
  private clearSourcePinHighlight(): void {
    const prev = this.pending;
    if (!prev) return;
    const sourceDot = document.querySelector(
      `[data-node-id="${prev.sourceNodeId}"] [data-pin-id="${prev.sourcePinId}"] [data-pin-dot]`,
    ) as HTMLElement | null;
    if (sourceDot) sourceDot.removeAttribute('data-pin-connecting');
  }

  /** 清除连线 cursor 状态的内部 helper(handlePointerUp/cancel 共用) */
  private clearConnectionCursor = (): void => {
    const viewportEl = document.querySelector('[data-canvas-viewport]');
    if (viewportEl) (viewportEl as HTMLElement).removeAttribute('data-connection-pending');
  };

  /** 全局 pointerup - 完成或取消连线 */
  handlePointerUp = (): void => {
    // 清除 cursor(不管 pending 是否存在都清掉,保证不会残留 crosshair)
    this.clearConnectionCursor();
    this.pendingLocked = false;
    // 取消待执行的 rAF
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    if (!this.pending) return;

    const underNode = this.findNodeUnderPointer();

    // 优先使用 hoverTarget,其次用 elementFromPoint 兜底
    const target = this.hoverTarget ?? this.findPinAtPointer();
    if (target) {
      const sourceIsGroupPin = this.isGroupPinEndpoint(this.pending.sourceNodeId, this.pending.sourcePinId);
      const targetIsGroupPin = this.isGroupPinEndpoint(target.nodeId, target.pinId);
      if ((sourceIsGroupPin || targetIsGroupPin) && this.groupPinExpander) {
        const groupValidation = this.validateGroupConnection(this.pending, target, sourceIsGroupPin, targetIsGroupPin);
        if (!groupValidation.valid) {
          this.clearPending();
          this.notify();
          return;
        }
        this.createBatchEdges(this.pending, target);
      } else {
        const validation = this.validate(this.pending, target);
        if (validation.valid) {
          this.createEdge(this.pending, target);
        }
      }
      this.clearPending();
      this.notify();
      return;
    }

    // 松手在节点上:尝试自动连接,不弹出面板
    if (underNode) {
      const autoTarget = this.findNodeAutoConnectTarget();
      if (autoTarget) {
        const validation = this.validate(this.pending, autoTarget);
        if (validation.valid) {
          this.createEdge(this.pending, autoTarget);
        }
      }
      // 节点上松手无论连接成功与否都清除 pending,不弹出面板
      this.clearPending();
      this.notify();
      return;
    }

    // 松手于空白区域:触发回调,弹出节点创建菜单
    // 保留 pending 状态,预览线连线到面板上,直到面板关闭或节点创建完成
    if (this.dropCallback) {
      const world = this.screenToWorld(this.lastClientX, this.lastClientY);
      // 查询源节点类型(用于菜单约束过滤)
      const srcNode = this.store.getGraph().nodes.find((n) => n.id === this.pending!.sourceNodeId);
      this.dropCallback(
        {
          nodeId: this.pending.sourceNodeId,
          nodeType: srcNode?.type ?? 'unknown',
          pinId: this.pending.sourcePinId,
          direction: this.pending.sourceDirection,
        },
        this.lastClientX,
        this.lastClientY,
        world.x,
        world.y,
      );
    } else {
      this.clearPending();
      this.notify();
    }
  };

  /** 更新临时连线终点坐标(用于面板弹出后预览线连到面板位置;锁定后指针移动不再覆盖) */
  updatePendingEndpoint = (screenX: number, screenY: number): void => {
    if (!this.pending) return;
    const world = this.screenToWorld(screenX, screenY);
    this.pending = { ...this.pending, currentX: world.x, currentY: world.y };
    this.pendingLocked = true;
    this.notify();
  };

  /** 取消正在进行的连线拖拽(用于 contextmenu/Escape 等中断场景) */
  cancel = (): void => {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    if (!this.pending) return;
    this.clearPending();
    this.notify();
  };

  /**
   * BUG7: 获取连接到指定节点 input 引脚的源节点 ID 列表。
   * 用于配置节点的实时统计(显示引用了哪些节点)。
   */
  getIncomingNodeIds = (nodeId: string): string[] => {
    const graph = this.store.getGraph();
    return graph.edges
      .filter((e) => e.target.nodeId === nodeId)
      .map((e) => e.source.nodeId);
  };

  /**
   * Bug6: 获取连接到指定节点的源节点列表(含类型信息)。
   * 用于配置节点按引用类型分类统计(文本/图片/视频/音频)。
   */
  getIncomingNodeTypes = (nodeId: string): { id: string; type: string }[] => {
    const graph = this.store.getGraph();
    return graph.edges
      .filter((e) => e.target.nodeId === nodeId)
      .map((e) => {
        const node = graph.nodes.find((n) => n.id === e.source.nodeId);
        return { id: e.source.nodeId, type: node?.type ?? 'unknown' };
      });
  };

  /** 端口 pointerenter - 记录潜在目标 */
  handlePinPointerEnter = (
    _event: PointerEvent,
    nodeId: string,
    pinId: string,
    direction: 'input' | 'output',
  ): void => {
    if (!this.pending) return;
    this.hoverTarget = { nodeId, pinId, direction };
  };

  /** 端口 pointerleave - 清除潜在目标 */
  handlePinPointerLeave = (): void => {
    this.hoverTarget = null;
  };

  /** 节点 pointerenter - 记录悬停节点(用于 Pin 可见性控制) */
  handleNodePointerEnter = (nodeId: string): void => {
    this.hoverNodeId = nodeId;
    this.notify();
  };

  /** 节点 pointerleave - 清除悬停节点 */
  handleNodePointerLeave = (): void => {
    this.hoverNodeId = null;
    this.notify();
  };

  // ===== 内部方法 =====

  /**
   * 屏幕坐标 → 世界坐标
   * 关键: clientX/Y 是相对浏览器视口的, viewport.x/y 是相对容器 div 的
   * 必须减去容器偏移(工具栏高度等),否则临时连线位置会偏移
   */
  private screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const vp = this.store.getViewport();
    const container = this.getContainer();
    const rect = container?.getBoundingClientRect();
    const screenX = clientX - (rect?.left ?? 0);
    const screenY = clientY - (rect?.top ?? 0);
    return { x: (screenX - vp.x) / vp.k, y: (screenY - vp.y) / vp.k };
  }

  private findPinAtPointer(): { nodeId: string; pinId: string; direction: 'input' | 'output' } | null {
    // 兜底: 用 elementFromPoint 查找鼠标下方的端口元素
    const el = document.elementFromPoint(this.lastClientX, this.lastClientY);
    const pinEl = el?.closest('[data-pin-id]') as HTMLElement | null;
    if (!pinEl) return null;
    const pinId = pinEl.getAttribute('data-pin-id');
    const direction = pinEl.getAttribute('data-pin-direction') as 'input' | 'output' | null;
    const nodeEl = pinEl.closest('[data-node-id]');
    const nodeId = nodeEl?.getAttribute('data-node-id');
    if (!pinId || !direction || !nodeId) return null;
    return { nodeId, pinId, direction };
  }

  /**
   * 查所有 pin 中距离屏幕坐标 (screenX, screenY) 最近的那个,
   * 且距离 < PIN_SNAP_SCREEN_DISTANCE。
   *
   * 返回: { nodeId, pinId, direction, screenCenterX, screenCenterY } | null
   * - screenCenterX/Y 是 pin 圆点中心的 clientX/clientY(浏览器视口坐标,已含缩放)
   * - 不做 viewport 逆变换,因为 snap 距离是屏幕像素,直接在 client 坐标系里算
   * - 排除:源 pin 自身、源节点上的所有 pin(自己不能连自己)
   *
   * 实现:querySelectorAll 一次性取所有 data-pin-dot,遍历算距离。
   * 避免 per-pin 逐个 querySelector 的 N+1 查询。querySelectorAll 是 O(N) 单次调用,
   * 50 节点 × 4 pin = 200 个元素,每次 pointermove 遍历无压力。
   */
  private findNearestPinOnScreen(
    screenX: number,
    screenY: number,
  ): { nodeId: string; pinId: string; direction: 'input' | 'output'; screenCenterX: number; screenCenterY: number } | null {
    if (!this.pending) return null;
    const dots = document.querySelectorAll('[data-pin-dot]');
    let bestDist = PIN_SNAP_SCREEN_DISTANCE;
    let best: { nodeId: string; pinId: string; direction: 'input' | 'output'; screenCenterX: number; screenCenterY: number } | null = null;
    for (const dot of dots) {
      const pinEl = (dot as HTMLElement).closest('[data-pin-id]') as HTMLElement | null;
      if (!pinEl) continue;
      const nodeEl = pinEl.closest('[data-node-id]') as HTMLElement | null;
      const nodeId = nodeEl?.getAttribute('data-node-id');
      const pinId = pinEl.getAttribute('data-pin-id');
      const direction = pinEl.getAttribute('data-pin-direction') as 'input' | 'output' | null;
      if (!nodeId || !pinId || !direction) continue;
      // 排除源 pin 自身 + 同节点 pin(自连禁止)
      if (nodeId === this.pending.sourceNodeId) continue;
      if (nodeId === this.pending.sourceNodeId && pinId === this.pending.sourcePinId) continue;
      // 方向相反才是有效 snap 目标(output→input 或 input→output)
      if (direction === this.pending.sourceDirection) continue;

      // 使用 pinEl(父容器,没有反向缩放 transform)的 getBoundingClientRect,
      // 避免 [data-pin-dot] 的 transform:scale(invSx,invSy) 导致坐标偏移
      const rect = pinEl.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = cx - screenX;
      const dy = cy - screenY;
      const dist = Math.hypot(dx, dy);
      if (dist < bestDist) {
        bestDist = dist;
        best = { nodeId, pinId, direction, screenCenterX: cx, screenCenterY: cy };
      }
    }
    return best;
  }

  /**
   * 查找鼠标下方的节点 id(用于拖拽连线时高亮可自动连接的目标节点)。
   * 排除:自身节点、组节点(组由 GroupLayer 独立处理)。
   */
  private findNodeUnderPointer(): string | null {
    if (!this.pending) return null;
    const el = document.elementFromPoint(this.lastClientX, this.lastClientY);
    const nodeEl = el?.closest('[data-node-id]') as HTMLElement | null;
    if (!nodeEl) return null;
    const nodeId = nodeEl.getAttribute('data-node-id');
    if (!nodeId || nodeId === this.pending.sourceNodeId) return null;
    return nodeId;
  }

  /**
   * Pin 到节点自动连接:鼠标落在节点空白区域时,查找该节点最近的兼容 Pin。
   * 遍历节点的所有 Pin,找到方向与源端口相反的第一个兼容 Pin。
   * 用最近距离(屏幕坐标)判断,避免多 Pin 时随机选择。
   */
  private findNodeAutoConnectTarget(): { nodeId: string; pinId: string; direction: 'input' | 'output' } | null {
    if (!this.pending) return null;
    const el = document.elementFromPoint(this.lastClientX, this.lastClientY);
    const nodeEl = el?.closest('[data-node-id]') as HTMLElement | null;
    if (!nodeEl) return null;
    const nodeId = nodeEl.getAttribute('data-node-id');
    if (!nodeId) return null;
    if (nodeId === this.pending.sourceNodeId) return null;

    const targetDirection = this.pending.sourceDirection === 'output' ? 'input' : 'output';

    // 优先使用 extensionAccessor 查询 Pin(精确)
    if (this.extensionAccessor) {
      const ext = this.extensionAccessor(nodeId);
      if (ext?.getPins) {
        const graph = this.store.getGraph();
        const node = graph.nodes.find((n: { id: string }) => n.id === nodeId);
        if (node) {
          const pins = ext.getPins(node);
          const compatiblePins = pins.filter((p) => p.direction === targetDirection);
          if (compatiblePins.length > 0) {
            const pin = compatiblePins[0]!;
            return { nodeId, pinId: pin.id, direction: pin.direction };
          }
        }
      }
    }

    // 兜底:通过 DOM 查询目标节点的引脚(当 extensionAccessor 不可用时)
    const pinSelector = `[data-node-id="${nodeId}"] [data-pin-id][data-pin-direction="${targetDirection}"]`;
    const pinEl = document.querySelector(pinSelector) as HTMLElement | null;
    if (!pinEl) return null;
    const pinId = pinEl.getAttribute('data-pin-id');
    if (!pinId) return null;
    return { nodeId, pinId, direction: targetDirection };
  }

  private validate(
    source: PendingConnection,
    target: { nodeId: string; pinId: string; direction: 'input' | 'output' },
  ): ConnectionValidation {
    // 1. 同一端口自连禁止(pin 级别)
    if (source.sourceNodeId === target.nodeId && source.sourcePinId === target.pinId) {
      return { valid: false, reason: '不能连接到自身端口' };
    }
    // 2. 同一节点自连禁止(node 级别:inpin 不能和 outpin 互连)
    if (source.sourceNodeId === target.nodeId) {
      return { valid: false, reason: '不能连接到同一节点' };
    }
    // 3. 方向校验: output → input 或 input → output
    if (source.sourceDirection === target.direction) {
      return { valid: false, reason: '端口方向不兼容(需 output → input)' };
    }
    // 3.5 目标节点生成中:禁止连线
    if (this.isNodeLocked(target.nodeId)) {
      return { valid: false, reason: '目标节点正在生成,暂不可连线' };
    }
    // 4. 重复连线校验
    const graph = this.store.getGraph();
    const [src, tgt] = source.sourceDirection === 'output'
      ? [{ nodeId: source.sourceNodeId, pinId: source.sourcePinId }, { nodeId: target.nodeId, pinId: target.pinId }]
      : [{ nodeId: target.nodeId, pinId: target.pinId }, { nodeId: source.sourceNodeId, pinId: source.sourcePinId }];
    const exists = graph.edges.some(
      (e) =>
        e.source.nodeId === src.nodeId &&
        e.source.pinId === src.pinId &&
        e.target.nodeId === tgt.nodeId &&
        e.target.pinId === tgt.pinId,
    );
    if (exists) {
      return { valid: false, reason: '连线已存在' };
    }
    // 4.5 循环连线校验:target 沿现有出边可达 source → 新边将形成环(A→B→A 互相引用),
    //    布局/参考素材语义均不允许,拒绝创建
    if (this.wouldCreateCycle(src.nodeId, tgt.nodeId)) {
      return { valid: false, reason: '不能创建循环连线(会形成互相引用)' };
    }
    // 5. 统一节点类型兼容性校验(中央矩阵,由 app 注入)
    //    与 ConnectionDropMenu 菜单过滤共用同一套规则
    if (this.compatibilityChecker) {
      const srcNode = graph.nodes.find((n) => n.id === src.nodeId);
      const tgtNode = graph.nodes.find((n) => n.id === tgt.nodeId);
      if (srcNode && tgtNode && !this.compatibilityChecker(srcNode.type, tgtNode.type)) {
        return { valid: false, reason: '节点类型不兼容' };
      }
    }
    // 6. 节点类型扩展钩子(canConnect):允许节点类型自定义连线约束
    //    钩子返回 { valid: false } 拒绝;返回 { valid: true } 或 void 表示中立(继续后续钩子)。
    if (this.extensionAccessor) {
      const srcExt = this.extensionAccessor(source.sourceNodeId);
      const tgtExt = this.extensionAccessor(target.nodeId);
      // 统一为 output → input 方向调用钩子(避免方向歧义)
      const [srcEnd, tgtEnd] = source.sourceDirection === 'output'
        ? [
            { nodeId: source.sourceNodeId, pinId: source.sourcePinId, direction: source.sourceDirection },
            { nodeId: target.nodeId, pinId: target.pinId, direction: target.direction },
          ]
        : [
            { nodeId: target.nodeId, pinId: target.pinId, direction: target.direction },
            { nodeId: source.sourceNodeId, pinId: source.sourcePinId, direction: source.sourceDirection },
          ];
      // 源节点钩子(从 output 端看)
      if (srcExt?.canConnect) {
        const result = srcExt.canConnect(srcEnd, tgtEnd);
        if (result && !result.valid) {
          return { valid: false, reason: result.reason ?? '节点类型拒绝连线' };
        }
      }
      // 目标节点钩子(从 input 端看,参数顺序仍是 source→target)
      if (tgtExt?.canConnect && tgtExt !== srcExt) {
        const result = tgtExt.canConnect(srcEnd, tgtEnd);
        if (result && !result.valid) {
          return { valid: false, reason: result.reason ?? '节点类型拒绝连线' };
        }
      }
    }
    return { valid: true };
  }

  private createEdge(
    source: PendingConnection,
    target: { nodeId: string; pinId: string; direction: 'input' | 'output' },
  ): void {
    // 统一为 output → input 方向
    const [edgeSource, edgeTarget] = source.sourceDirection === 'output'
      ? [
          { nodeId: source.sourceNodeId, pinId: source.sourcePinId },
          { nodeId: target.nodeId, pinId: target.pinId },
        ]
      : [
          { nodeId: target.nodeId, pinId: target.pinId },
          { nodeId: source.sourceNodeId, pinId: source.sourcePinId },
        ];

    const edgeId = `edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.commandQueue.execute(
      new AddEdgeCommand({
        id: edgeId,
        source: edgeSource,
        target: edgeTarget,
      }),
    );
  }

  /**
   * 环检测:若 target 沿现有出边(DFS)可达 source,则新边 source→target 将形成环。
   * 用于阻止 A→B 后又 B→A 的循环连线(参考素材互相引用,树状布局/语义均不允许)。
   */
  private wouldCreateCycle(sourceNodeId: string, targetNodeId: string): boolean {
    const graph = this.store.getGraph();
    const adj = new Map<string, string[]>();
    for (const e of graph.edges) {
      const from = e.source.nodeId;
      let list = adj.get(from);
      if (!list) { list = []; adj.set(from, list); }
      list.push(e.target.nodeId);
    }
    const visited = new Set<string>();
    const stack: string[] = [targetNodeId];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (cur === sourceNodeId) return true;
      if (visited.has(cur)) continue;
      visited.add(cur);
      for (const next of adj.get(cur) ?? []) stack.push(next);
    }
    return false;
  }

  /**
   * 判断端点是否为组聚合 pin(nodeId 是组节点 且 pinId 是 __group_in__/__group_out__)。
   * 用于 handlePointerUp 检测组 pin 批量连线场景。
   */
  private isGroupPinEndpoint(nodeId: string, pinId: string): boolean {
    if (pinId !== GROUP_INPUT_PIN_ID && pinId !== GROUP_OUTPUT_PIN_ID) return false;
    const node = this.store.getGraph().nodes.find((n) => n.id === nodeId);
    return node?.type === 'group';
  }

  /**
   * 组 pin 连线验证 — 在 createBatchEdges 之前执行,拒绝不合理连接。
   *
   * 约束规则:
   * 1. 方向必须相反(sourceDirection !== targetDirection)
   * 2. 双组连接时:input→output 或 output→input,禁止 input→input 或 output→output
   * 3. 单组连接时:组 pin 方向必须与目标 pin 方向相反
   */
  private validateGroupConnection(
    source: PendingConnection,
    target: { nodeId: string; pinId: string; direction: 'input' | 'output' },
    sourceIsGroupPin: boolean,
    targetIsGroupPin: boolean,
  ): ConnectionValidation {
    // 1. 方向校验:必须相反
    if (source.sourceDirection === target.direction) {
      return { valid: false, reason: '组 pin 连接方向不兼容(需 output → input)' };
    }
    // 2. 双组连接:禁止同向连接
    if (sourceIsGroupPin && targetIsGroupPin) {
      return { valid: true };
    }
    // 3. 目标节点锁定
    if (this.isNodeLocked(target.nodeId)) {
      return { valid: false, reason: '目标节点正在生成,暂不可连线' };
    }
    return { valid: true };
  }

  /**
   * 组 pin 批量连线:展开组 pin 为叶子节点 pin 列表,笛卡尔积创建多条 edge。
   *
   * 场景:用户拖组 pin(__group_in__/__group_out__)到目标 pin 松手,
   * 等效于组内所有叶子节点的对应方向 pin 批量连线到目标。
   * "遇到内部有嵌套组的情况下就跳过该组" — 由 GroupPinExpander 内部的
   * getLeafDescendants 保证(只返回非 group 叶子节点)。
   *
   * 笛卡尔积规则:
   * - 源是组 output pin → 目标是普通 input pin:组内每个叶子 output pin → 目标 input
   * - 源是普通 output pin → 目标是组 input pin:源 output → 组内每个叶子 input pin
   * - 双端都是组 pin:组内每个叶子 output → 组内每个叶子 input(理论上可能,实际少见)
   *
   * 跳过:同节点自连、已存在的 edge、方向不匹配。
   * 用 BatchCommand 一次提交(支持撤销,合并为一条历史记录)。
   */
  private createBatchEdges(
    source: PendingConnection,
    target: { nodeId: string; pinId: string; direction: 'input' | 'output' },
  ): void {
    if (!this.groupPinExpander) return;

    // 展开组 pin 为叶子节点端点列表(非组 pin 端保持单元素列表)
    const sourceEndpoints = this.isGroupPinEndpoint(source.sourceNodeId, source.sourcePinId)
      ? this.groupPinExpander(source.sourceNodeId, source.sourceDirection)
      : [{ nodeId: source.sourceNodeId, pinId: source.sourcePinId, direction: source.sourceDirection }];
    const targetEndpoints = this.isGroupPinEndpoint(target.nodeId, target.pinId)
      ? this.groupPinExpander(target.nodeId, target.direction)
      : [{ nodeId: target.nodeId, pinId: target.pinId, direction: target.direction }];

    // 统一为 output → input 方向
    const [outputEndpoints, inputEndpoints] = source.sourceDirection === 'output'
      ? [sourceEndpoints, targetEndpoints]
      : [targetEndpoints, sourceEndpoints];

    const graph = this.store.getGraph();
    const commands: AddEdgeCommand[] = [];
    for (const out of outputEndpoints) {
      for (const inp of inputEndpoints) {
        // 跳过同节点自连
        if (out.nodeId === inp.nodeId) continue;
        // 跳过已存在的 edge
        const exists = graph.edges.some(
          (e) =>
            e.source.nodeId === out.nodeId &&
            e.source.pinId === out.pinId &&
            e.target.nodeId === inp.nodeId &&
            e.target.pinId === inp.pinId,
        );
        if (exists) continue;
        // 跳过会形成环的连线(inp 沿出边可达 out → 互相引用)
        if (this.wouldCreateCycle(out.nodeId, inp.nodeId)) continue;
        const edgeId = `edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${commands.length}`;
        commands.push(
          new AddEdgeCommand({
            id: edgeId,
            source: { nodeId: out.nodeId, pinId: out.pinId },
            target: { nodeId: inp.nodeId, pinId: inp.pinId },
          }),
        );
      }
    }

    if (commands.length === 0) return;
    this.commandQueue.execute(new BatchCommand(commands, 'batch-connect-group-pin'));
  }
}
