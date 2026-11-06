/**
 * LAYOUT_CONSTANTS.ts - 全局布局常量
 *
 * 统一管理所有布局层级的高度、宽度常量。
 * 所有 TopBar、Toolbar、Sidebar 应引用此处的常量，避免硬编码。
 */
import type { CSSProperties } from 'react';

export const LAYOUT = {
  /** 所有 TopBar 统一高度（TopNav / CreationTopBar / TopBar，2026-08-31 约定 45px） */
  NAV_HEIGHT: 45,
  /** 阶段内 toolbar 高度（StageToolbar） */
  STAGE_TOOLBAR_HEIGHT: 42,
  /** 侧栏展开宽度 */
  SIDEBAR_EXPANDED: 220,
  /** 侧栏折叠宽度 */
  SIDEBAR_COLLAPSED: 60,
} as const;

/** 画布工作区外框圆角（画布容器与导演台提示词输入区共用，单一来源） */
export const WORKSPACE_SURFACE_RADIUS = 12;

/** 画布工作区外框样式（供画布容器直接展开使用） */
export const WORKSPACE_SURFACE_STYLE: CSSProperties = { borderRadius: WORKSPACE_SURFACE_RADIUS };

/**
 * STAGE_COLORS - 阶段页面辅助色调色板
 *
 * 仅保留绿色完成态，蓝/紫辅助色已移除。
 * 操作按钮统一使用 accent (#e94560) 或中性灰。
 */
export const STAGE_COLORS = {
  /** 完成/确认态（绿色） */
  completed: '#10b981',
} as const;
