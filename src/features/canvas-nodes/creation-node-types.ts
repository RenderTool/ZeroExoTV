/**
 * 剧创节点数据类型(独立页面壳版本)
 *
 * 剧本(script) / 分镜(storyboard) / 出片(workbench) 三类画布节点共用结构。
 * 节点不依赖任何创作项目:内容直接写入节点 data,随画布 Yjs 实时同步。
 */

/** 剧创节点类型（Plan#74 Phase C：新增 novel 长文本素材节点） */
export type CreationNodeType = 'script' | 'storyboard' | 'workbench' | 'novel';

/** 剧创节点 data 结构(各类型通过可选字段扩展) */
export interface CreationNodeData {
  /** 节点标题 */
  title: string;
  /** 阶段状态 idle/ready */
  status: 'idle' | 'ready';
  /** 剧本单版本内容(HTML);仅剧本节点使用 */
  content?: string;
}

/** 图片节点基准高度(数值与 node-contracts IMAGE_DEFAULT_SIZE.height 一致,用于空态卡推导) */
const IMAGE_BASE_HEIGHT = 348;

/**
 * 空态卡推导:总高度 = 图片节点基准高度(348)。
 * 2026-09-06 约定:弃 9:16 → 改 3:4,宽 = 348 × 3/4 = 261。
 * 剧本/分镜/出片/小说 空态卡统一此尺寸。
 */
export const CREATION_EMPTY_CARD_SIZE = {
  width: Math.round((IMAGE_BASE_HEIGHT * 3) / 4),
  height: IMAGE_BASE_HEIGHT,
};

/**
 * 出片节点固定尺寸(2026-08-31 契约变更;2026-09-04 约定:与图片/视频节点统一尺寸基准高)
 * 与音频气泡节点同款:resizable=false + specialAppearance=true
 * → 无 resize 手柄、不参与全局外观配置与尺寸计算(基准尺寸恢复/统一尺寸)
 * 该尺寸为**有内容(时间轴)**时的固定工作尺寸:高 = 图片基准高 348;
 * 空态时切到 CREATION_EMPTY_SIZE(261×348,3:4 空态卡)。
 */
export const WORKBENCH_FIXED_SIZE = { width: 620, height: IMAGE_BASE_HEIGHT };

/** 各剧创节点默认尺寸 */
export const CREATION_DEFAULT_SIZE: Record<CreationNodeType, { width: number; height: number }> = {
  script: { width: 720, height: 520 },
  storyboard: { width: 720, height: 520 },
  workbench: { ...WORKBENCH_FIXED_SIZE },
  novel: { ...CREATION_EMPTY_CARD_SIZE },
};

/** 各剧创节点最小尺寸(不可继续缩小;出片节点不可 resize,此处与固定尺寸对齐仅为类型完整性) */
export const CREATION_MIN_SIZE: Record<CreationNodeType, { width: number; height: number }> = {
  script: { width: 480, height: 360 },
  storyboard: { width: 640, height: 400 },
  workbench: { ...WORKBENCH_FIXED_SIZE },
  novel: { ...CREATION_EMPTY_CARD_SIZE },
};

/** 分镜节点生成中的紧凑占位尺寸(生成完成后展开到 defaultSize) */
export const CREATION_COMPACT_SIZE = { width: 200, height: 150 };

/** 剧创节点未生成态统一空态卡尺寸(Plan#74 Phase G；2026-09-06 约定：3:4，以图片节点高度为基准)
 * 总高度 = 图片基准高(348)，宽度 = 348×3/4 = 261；生成/编辑后恢复基准尺寸 */
export const CREATION_EMPTY_SIZE = { ...CREATION_EMPTY_CARD_SIZE };

/** 各剧创节点引脚定义（2026-09-04 方案 D++ 小步实验：剧本节点加 input pin，允许 text 等上游素材连入）
 * 剧本:1 输入 + 1 输出；分镜:1 输入 + 1 输出；出片:1 输入 */
export const CREATION_PINS: Record<
  CreationNodeType,
  { id: string; name: string; direction: 'input' | 'output' }[]
> = {
  script: [
    { id: 'input', name: 'Input', direction: 'input' },
    { id: 'output', name: 'Output', direction: 'output' },
  ],
  storyboard: [
    { id: 'input', name: 'Input', direction: 'input' },
    { id: 'output', name: 'Output', direction: 'output' },
  ],
  workbench: [{ id: 'input', name: 'Input', direction: 'input' }],
  novel: [{ id: 'output', name: 'Output', direction: 'output' }],
};