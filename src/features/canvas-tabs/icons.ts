/**
 * canvas-tabs/icons.ts — 顶部页签类型图标映射
 *
 * 遵循经验 #19（interaction-metadata-mapping）：新增图标一律走模块级 icons.ts Map，
 * 禁止在组件内散落内联 lucide。
 *
 * 契约铁律：内容槽位图标必须与画布节点左上角 / 层级面板的「节点类型图标」同源，
 * 见 creation-node-view.tsx（script=FileText / storyboard=Aperture / workbench=Film）
 * 与 hierarchy-list-view.tsx getTypeIcon（同一套映射）。
 * 新增资源页签类型时必须同步这两处与下面的 Map，避免页签图标与节点图标不一致。
 * 2026-11-04：canvas 槽位补 Frame 图标（画布非节点类型、无同源对象），
 * 替换原 6px 红点占位，四槽位统一 lucide 描边图标语言（size 13 / strokeWidth 1.8，选中 2.2）。
 */
import { FileText, Aperture, Film, ClipboardList, Frame, PictureInPicture2, X, type LucideIcon } from 'lucide-react';
import type { CanvasTabKind, FixedSlotKind } from './canvas-tab-store.js';

/** 页签类型 → Lucide 图标（含 canvas 槽位；plan 为历史 kind 保留兼容） */
export const CANVAS_TAB_ICONS: Record<CanvasTabKind | FixedSlotKind, LucideIcon> = {
  /** 剧本（与 script 节点同款） */
  script: FileText,
  /** 主体库（与 storyboard 节点同款） */
  storyboard: Aperture,
  /** 导演台（与 workbench 节点同款 Film） */
  workbench: Film,
  /** 制作计划（Plan#51，非画布节点类型，取清单语义图标） */
  plan: ClipboardList,
  /** 画布（非节点类型，无同源对象；取画框语义图标，替换原红点占位） */
  canvas: Frame,
};

/**
 * 副本画布标签图标（Spec / 征集#184）：与 1 号主画布的 Frame 区分，取「画中画」=多块画布并存。
 * 依旧走本文件 Map，禁止在页签组件内内联 lucide（经验 #19 图标单一来源）。
 */
export const CANVAS_COPY_TAB_ICON: LucideIcon = PictureInPicture2;

/** 副本标签上的关闭×（固定槽位不可关，所以只有副本标签用得到） */
export const CANVAS_TAB_CLOSE_ICON: LucideIcon = X;
