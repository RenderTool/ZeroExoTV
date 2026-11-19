/**
 * 节点尺寸契约常量(Plan#11 全节点迁移 A2)
 *
 * 单一事实源:各节点扩展的 defaultSize/minSize 与所有尺寸入口(上传/替换/拖拽/AI生成)
 * 统一引用本文件常量 —— **节点本身的契约自己维护,改契约只改这一处**。
 *
 * 使用规则:
 * - 扩展定义(index.tsx)引用: createImageExtension 等 defaultSize/minSize 直接引用
 * - 包内工具(utils/)引用: replaceNodeImage 等需要"无 ext 时的类型契约兜底"
 * - 禁止在其他地方散落 620/348/404/360/96 等裸数字
 */

// ===== 媒体类(620×348 = 16:9 基准;文本节点例外:默认 3:4(261×348),高=图片基准 348,无尺寸限制可自由缩放) =====
export const TEXT_DEFAULT_SIZE = { width: 261, height: 348 };
export const GENERATOR_DEFAULT_SIZE = { width: 620, height: 348 };
export const IMAGE_DEFAULT_SIZE = { width: 620, height: 348 };
/**
 * 图片节点统一尺寸规则（2026-11-18 用户定稿）：
 * 所有图片节点都等比装进同一个 620×348 的展示框——
 * 16:9 → 620×348、4:3 → 464×348、1:1 → 348×348、9:16 → 196×348。
 * 同一比例的图片在任何入口（拖入/替换/生成/发送/链路快照）视觉尺寸完全一致；
 * 用户手动缩放后保留自己的尺寸。
 */
export const IMAGE_LONG_SIDE = 620;
export const IMAGE_FIT_BOX = { width: 620, height: 348 };

/** 按真实宽高等比装进统一展示框（短边不低于 minShort，极端长条也保持可读） */
export function fitMediaSize(
  naturalWidth: number,
  naturalHeight: number,
  box: { width: number; height: number } = IMAGE_FIT_BOX,
  minShort = 120,
): { width: number; height: number } {
  if (!naturalWidth || !naturalHeight) return { width: box.width, height: box.height };
  const scale = Math.min(box.width / naturalWidth, box.height / naturalHeight);
  let width = Math.max(minShort, Math.round(naturalWidth * scale));
  let height = Math.max(minShort, Math.round(naturalHeight * scale));
  if (width > box.width) { width = box.width; height = Math.round(box.width * (naturalHeight / naturalWidth)); }
  if (height > box.height) { height = box.height; width = Math.round(box.height * (naturalWidth / naturalHeight)); }
  return { width, height };
}
export const VIDEO_DEFAULT_SIZE = { width: 620, height: 348 };
/** 媒体类统一最小尺寸(等比锁节点的下限) */
export const MEDIA_MIN_SIZE = { width: 80, height: 80 };
/** 文本节点最小尺寸(自由 resize 下限,与 resize 几何隐式兜底一致,契约显式化) */
export const TEXT_MIN_SIZE = { width: 80, height: 60 };

// ===== 音频气泡(特化外观,非 16:9) =====
export const AUDIO_DEFAULT_SIZE = { width: 360, height: 96 };

// ===== StackNode(620×404 = 展示区 348 + 导航 56) =====
export const STACKED_MEDIA_DEFAULT_SIZE = { width: 620, height: 404 };
export const STACKED_MEDIA_MIN_SIZE = { width: 220, height: 143 };

// ===== AI 占位(网格 179×101 + 8px 留白 = 195×117) =====
export const AI_PLACEHOLDER_DEFAULT_SIZE = { width: 195, height: 117 };

// ===== Plan#20 重设计：主体节点统一 16:9 纯预览卡（同堆叠节点 620×348） =====
export const SUBJECT_DEFAULT_SIZE = { width: 620, height: 348 };
/** 主体节点统一最小尺寸（与 default 严格等比：220/620 = 123.48 → 123，偏差 0.48px ≤ 0.75，触底不破坏等比锁） */
export const SUBJECT_MIN_SIZE = { width: 220, height: 123 };
