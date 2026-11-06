/**
 * 色卡节点类型与常量（Plan#65 色卡节点）
 *
 * 色卡节点：静态展示型节点，内嵌调色盘卡片（色条 hover 展开 + 底部色值 + 顶部圆形调色盘图标）。
 * 可配置颜色上限 12 个，双击进入编辑态增删改颜色。
 * 无引脚、不可堆叠、不参与媒体计算。
 */

/** 色卡节点颜色上限 */
export const COLOR_CARD_MAX_COLORS = 12;

/** 单个色卡条目（value 为 hex 色值，name 为可选名称；缺省渲染显示 value） */
export interface ColorCardColor {
  value: string;
  name?: string;
}

/** 色卡节点 data 结构 */
export interface ColorCardData {
  /** 节点标题 */
  title: string;
  /** 阶段状态 idle/ready */
  status: 'idle' | 'ready';
  /** 色卡数组（上限 COLOR_CARD_MAX_COLORS） */
  colors: ColorCardColor[];
}

/** 默认色卡（参考用户提供的调色盘卡片 4 色） */
export const COLOR_CARD_DEFAULT_COLORS: ColorCardColor[] = [
  { value: '#0E3746' },
  { value: '#EAE8DC' },
  { value: '#F4F2EC' },
  { value: '#BE2623' },
];

/** 色卡节点默认尺寸 */
export const COLOR_CARD_DEFAULT_SIZE = { width: 340, height: 220 };

/** 色卡节点最小尺寸（可自由 resize） */
export const COLOR_CARD_MIN_SIZE = { width: 160, height: 120 };

/** 将任意 hex 输入规整为标准 6 位 hex（容忍 #RGB / 大小写 / 缺 #） */
export function normalizeHex(input: string): string {
  let hex = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return '';
  return `#${hex.toUpperCase()}`;
}
