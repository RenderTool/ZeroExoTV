/**
 * production-manager-types - 统筹节点数据契约（Plan#29 主体系统 V3）
 *
 * 统筹 = 一部剧的资产管理器（剧级聚合节点）：
 * - 条目(items) = 演员/场景/道具，是主体信息的唯一事实源
 * - 分镜 shot.entities 以条目 id(cardId) 幂等引用，改名不断链
 * - 「状态」已废弃：条目图片为「剧照集」，每张图挂自由标签（不约束语义）
 */

export type ProductionItemKind = 'character' | 'scene' | 'prop' | 'candidate';

/** 实体类型颜色标准：角色绿色、场景蓝色、道具紫色、备选琥珀色 */
export const KIND_COLOR: Record<ProductionItemKind, string> = {
  character: '#22c55e', // 绿色
  scene: '#3b82f6',     // 蓝色
  prop: '#a855f7',      // 紫色
  candidate: '#f59e0b', // 琥珀色（备选：暂不确定但先留着）
};

/** 剧照（prompt=生成提示词，note=备注，tags=自由标签，stateTag=状态标记——对齐资产库提示词 card 标签体系） */
export interface ProductionItemImage {
  storageKey: string;
  /** 生成/描述提示词（发送到资产的内容源） */
  prompt?: string;
  /** 备注 */
  note?: string;
  /** 自由标签（区分不同时期/造型的剧照，显示在 card 上） */
  tags: string[];
  /** 状态标记（自由文本，如"受伤态"、"成年"、"幼年"等，不约束语义） */
  stateTag?: string;
}

/** 统筹条目（一个演员/场景/道具） */
export interface ProductionItem {
  /** 条目稳定 id：分镜 shot.entities 的 cardId 引用键 */
  id: string;
  name: string;
  kind: ProductionItemKind;
  /** 别名（逗号分隔录入） */
  aliases: string[];
  /** 一致性提示词 */
  consistency: string;
  /** 音色（音频资产引用，对齐原主体状态级 voice） */
  voice?: { key: string; name: string };
  /** 备注 */
  note: string;
  /** 出场集（展示标记，非过滤维度） */
  episodeIds: string[];
  /** 剧照集 */
  images: ProductionItemImage[];
  /** 封面（条目级，对齐原主体 coverKey） */
  coverKey?: string | null;
}

export interface ProductionManagerData {
  title: string;
  /** 关联剧本节点 id（剧本→统筹自动建联） */
  scriptId?: string;
  items: ProductionItem[];
  /** 用户删除过的实体名(LLM 识别注册时跳过, 防止重新生成时已删条目复活; 用户手动添加同名条目时清除) */
  deletedNames?: string[];
}

export function createProductionItem(kind: ProductionItemKind, name = ''): ProductionItem {
  return {
    id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    kind,
    aliases: [],
    consistency: '',
    voice: undefined,
    note: '',
    episodeIds: [],
    images: [],
    coverKey: null,
  };
}

/** 封面解析结果（2026-11-04 主体库封面需求） */
export interface SubjectCoverResolution {
  /** 命中的封面图 storageKey；null = 无任何状态图（上层渲染图标+中性底占位） */
  key: string | null;
  /** 命中来源：manual=手动 coverKey 且仍指向现存状态图；default=第一个状态图；none=无图 */
  source: 'manual' | 'default' | 'none';
}

/**
 * 主体封面唯一解析入口（回落链：手动 coverKey → 第一张状态图 → 无）。
 * 主体库卡片 / 主体详情头部 / 导演台主体行 全部走这里，禁止各处各算一套。
 * 手动封面指向的状态图被删除时自动回落到第一个状态图，不留死链。
 *
 * extraKeys（2026-11-06 主体库页面化）：主体树里的媒体键（baseState.referenceImages /
 * states[].media）。本地版主体图大多只存在于树里、不在条目 images[] 中，
 * 故「把某个状态设为封面」写入的 coverKey 需要这份候选集才算有效手动封面；
 * 候选同时充当默认回落（images 在前，保持既有口径）。不传 = 旧行为。
 */
export function resolveSubjectCover(
  item: Pick<ProductionItem, 'coverKey' | 'images'> | null | undefined,
  extraKeys?: readonly (string | null | undefined)[],
): SubjectCoverResolution {
  const imageKeys = (item?.images ?? []).map((img) => img?.storageKey).filter((k): k is string => Boolean(k));
  const candidates: string[] = [];
  for (const k of [...imageKeys, ...(extraKeys ?? [])]) {
    if (k && !candidates.includes(k)) candidates.push(k);
  }
  if (candidates.length === 0) return { key: null, source: 'none' };
  const manual = item?.coverKey ?? null;
  if (manual && candidates.includes(manual)) return { key: manual, source: 'manual' };
  return { key: candidates[0]!, source: 'default' };
}

export function createProductionManagerDefaultData(): ProductionManagerData {
  return { title: '剧管', items: [] };
}

/** 正则字面量转义（名字由用户输入，不能直接拼进 RegExp） */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 新建主体的默认名自动递增（2026-11-06 用户反馈：「新建主体不会自动递增序号」）：
 * 「新主体」→「新主体 2」→「新主体 3」…（序号取已有最大值 +1，比较忽略大小写与首尾空格）。
 * 不只是好看问题：同名主体会逼出「按名字配对」的串台（见 findTreeForItem）。
 */
export function nextUniqueName(existingNames: readonly (string | undefined | null)[], base: string): string {
  const prefix = base.trim();
  if (!prefix) return base;
  const norm = (v: string | undefined | null): string => (v ?? '').trim().toLowerCase();
  const taken = new Set(existingNames.map(norm));
  if (!taken.has(norm(prefix))) return prefix;
  const pattern = new RegExp(`^${escapeRegExp(prefix)}\\s+(\\d+)$`, 'i');
  let max = 1;
  for (const raw of existingNames) {
    const m = pattern.exec((raw ?? '').trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix} ${max + 1}`;
}

/** 条目名字键集合（名字 + 别名，供幂等匹配） */
export function productionItemKeys(item: { name?: string; aliases?: string[] }): Set<string> {
  const keys = new Set<string>();
  const push = (v: unknown) => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s) keys.add(s);
  };
  push(item.name);
  for (const a of item.aliases ?? []) push(a);
  return keys;
}
