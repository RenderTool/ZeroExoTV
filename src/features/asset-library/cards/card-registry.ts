/**
 * card-registry - 卡片渲染器注册表（策略模式）
 *
 * 通过 registerCard 注册各资产类型的网格/列表渲染器，
 * 主组件通过 getCardRenderer 查询并调度，实现新增类型无需修改主组件。
 */

import type { ComponentType } from 'react';
import type { ThemeConfig } from '@zeroexo/shared';
import type { TFunction } from 'i18next';
import type { ContentType } from '../types.js';

// ===== 渲染器接口 =====

export interface GridCardRendererProps<T> {
  item: T;
  selected: boolean;
  multiSelectEnabled: boolean;
  onToggleSelect: (id: string) => void;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onDownload?: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  /** 发送到画布(征集 #87 验收轮十三:仅画布内嵌入时提供,卡片右上角飞机图标) */
  onSendToCanvas?: () => void;
  /** 发送到导演台当前片段（2026-11-05 用户拍板：与画布入口同组下拉；仅画布内嵌时提供） */
  onSendToDirector?: () => void;
  /** 图片资产「编辑」：开画布图片编辑页签（2026-11-06 用户指令） */
  onEditImage?: () => void;
  /**
   * 是否渲染卡片快速动作（发送到画布 / 发送到导演台）。
   * 2026-11-05 口径钉死：列表页卡片不显示；**画布素材抽屉必须显示**（显式 prop 区分，
   * 不靠改三处调用碰运气）。缺省 false = 列表页形态。
   */
  showQuickActions?: boolean;
  /** 当前所处归属视图(资产项目化)：project 视图中的公共库资产显示「引用态」提示并隐藏编辑/删除入口；缺省不显示 */
  scopeView?: 'project' | 'library';
  theme: ThemeConfig;
  t: TFunction;
}

export interface ListCardRendererProps<T> {
  item: T;
  onClick: () => void;
  theme: ThemeConfig;
  t: TFunction;
}

interface CardRenderer {
  renderGrid: ComponentType<GridCardRendererProps<any>>;
  renderList: ComponentType<ListCardRendererProps<any>>;
}

// ===== 注册表 =====

const registry = new Map<ContentType, CardRenderer>();

/** 注册卡片渲染器 */
export function registerCard(type: ContentType, renderer: CardRenderer): void {
  registry.set(type, renderer);
}

/** 获取卡片渲染器 */
export function getCardRenderer(type: ContentType): CardRenderer | undefined {
  return registry.get(type);
}

/** 获取所有已注册的类型 */
export function getRegisteredTypes(): ContentType[] {
  return Array.from(registry.keys());
}

/** 判断指定类型是否已注册 */
export function isRegistered(type: ContentType): boolean {
  return registry.has(type);
}

export type { CardRenderer };