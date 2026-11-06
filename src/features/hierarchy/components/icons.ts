/**
 * 层级面板模块图标映射（分而治之：本模块图标在此单点维护，快速迭代）
 *
 * 语义键遵循拍板语义表（.project-rules/zeroexo_front/rules/interaction-metadata-mapping.md）：
 * stack=GalleryThumbnails
 */
import { GalleryThumbnails, Palette } from 'lucide-react';

/** 层级面板图标映射 */
export const HIERARCHY_ICONS = {
  stack: GalleryThumbnails,
  /** 色卡（Plan#65 色卡节点；三处同源契约——节点左上角/层级面板/顶部页签） */
  palette: Palette,
} as const;
