/**
 * canvas-assets/tab-defs - 抽屉分组页签定义 + 模块挂载规则（纯数据，无组件依赖，导出供结构断言/单测）
 *
 * 2026-11-13 用户指令（资产路径简化）：删除独立「历史」分组——
 * 画布生成产物直接进素材「画布」，导演台生成产物直接进「导演台」；
 * 不再保留第三套历史入口，也不在导演台类目下再分「从画布生成 / 从导演台」。
 *
 * 2026-11-06 用户指令（本条仍有效）：
 * 1. **按钮顺序**：资产 → 层级 → 画布（资产置顶、画布专属分组垫底）；
 * 2. **加载时机**：层级与画布是**画布模块专属**——顶部页签不在画布（剧本/主体库/导演台）时，
 *    这两个按钮与内容都不挂载到抽屉 sidebar，避免用户在这些模块里误选画布层级与子画布；
 *    每个模块按自己的激活状态独立挂载。
 */

/** 抽屉分组页签定义（数组顺序 = sidebar 按钮顺序） */
export const DRAWER_TAB_DEFS = [
  { key: 'material', labelKey: 'assetLibrary.filterMaterial' },
  // 画布相关合并为一个入口：层级 / 子画布在组内用 Tab 切换
  { key: 'canvasStructure', labelKey: 'canvasCopy.drawerTab' },
  // 2026-11-07 用户指令：剧本页的「本剧信息」放进资产抽屉，作为独立分组（整部剧一句话概述 + 标签）
  { key: 'scriptMeta', labelKey: 'assetLibrary.filterScriptMeta' },
] as const;

/** 抽屉分组键（由页签定义直接推导，避免第二份拷贝） */
export type DrawerGroup = (typeof DRAWER_TAB_DEFS)[number]['key'];

/** 抽屉所属模块（= 顶部固定槽位页签；画布副本页签归画布模块） */
export type DrawerModule = 'canvas' | 'script' | 'storyboard' | 'workbench';

/** 每个模块独立挂载自己的分组：层级 / 画布只在画布模块存在 */
export const DRAWER_MODULE_GROUPS: Record<DrawerModule, readonly DrawerGroup[]> = {
  canvas: ['material', 'canvasStructure'],
  // 剧本 / 导演台：本剧信息是这两个阶段共用的项目级信息，只在这两个模块挂载
  script: ['material', 'scriptMeta'],
  storyboard: ['material'],
  workbench: ['material', 'scriptMeta'],
};

/**
 * 顶部页签 key → 抽屉模块。
 * key 口径与 canvas-tab-store 一致：画布槽位 = 'canvas'，副本 = 'canvas:<cid>'，
 * 其余槽位 = '<kind>'（无绑定空态）或 '<kind>:<id>'。
 * 此处只做前缀判定，不 import canvas-tab-store：store 层保持对页签 store 零依赖，单测可独立渲染。
 */
export function resolveDrawerModule(activeTabKey: string): DrawerModule {
  if (activeTabKey === 'canvas' || activeTabKey.startsWith('canvas:')) return 'canvas';
  if (activeTabKey.startsWith('script')) return 'script';
  if (activeTabKey.startsWith('storyboard')) return 'storyboard';
  if (activeTabKey.startsWith('workbench')) return 'workbench';
  return 'canvas';
}
