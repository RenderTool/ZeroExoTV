/**
 * subject-tree-types - 分镜「主体树」数据契约（2026-09-01 重构）
 *
 * 占位主体 ≠ 提示词卡片，而是「主体树」：
 * - root：主体的唯一 id + 名称 + 类型（角色/场景/道具）——它是主体稳定标识
 * - baseState：基础定妆（三视图），生成完整 Cinematic Character Lineup Sheet 参考图
 * - states[]：状态迭代节点，基于 baseState 的差异描述，只写"变什么"
 *   如"受伤" = 保持 baseRef 形象不变，仅修改：左臂绷带、面色苍白、血迹
 *
 * 核心原则：
 * 1. 先出三视图定妆图锁定形象 → 状态在定妆图基础上迭代差异
 * 2. 差异提示词不重复基础特征，只写 delta
 * 3. 色卡为项目级共享，每个主体在 baseState 中绑定色卡
 */

import type { ProductionItemKind } from '../production-manager/production-manager-types';

/** 状态节点支持的媒体类型 */
export type SubjectNodeMedia = 'image' | 'video' | 'audio' | 'text';

/** 节点来源 */
export type SubjectNodeSource = 'ai' | 'user';

/** 色卡绑定（单色） */
export interface ColorCardSwatch {
  id: string;       // C1, C2, C3, C4, C5
  name: string;     // 晨雾灰, 森林赭, 油灯橙, 月光蓝, 青白釉
  hex: string;      // #D4D4D4
  usage: string;    // 日景山林/晨雾高光
}

/** 项目级色卡（5 色绑定，所有主体共享） */
export interface ProjectColorCard {
  palette: ColorCardSwatch[];
}

/**
 * 状态媒体引用来源（2026-11-04 资产→主体状态关联）：
 * - type：入口语义（upload=本地上传 / canvas=画布节点 / project=本项目资产 / library=公共库资产）
 * - fromNodeId：画布来源节点 id（用于反向定位）
 * - label：来源显示名（节点标题/资产标题），主体侧双向可见用
 */
export interface SubjectMediaOrigin {
  type: 'upload' | 'canvas' | 'project' | 'library';
  fromNodeId?: string;
  label?: string;
}

export interface SubjectNodeMediaRef {
  key: string;
  type: Exclude<SubjectNodeMedia, 'text'>;
  prompt?: string;
  /** 引用来源（2026-11-04）：双向可见 + 失效提示；历史数据无此字段照常显示 */
  origin?: SubjectMediaOrigin;
}

/** 定妆模板类型 */
export type SubjectTemplateType = 'character_lineup' | 'creature_reference' | 'environment_panorama' | 'prop_detail';

/** 基础定妆 */
export interface SubjectBaseState {
  /** 完整的三视图定妆提示词（高度参数化的定妆模板，根据 templateType 选择对应模板） */
  prompt: string;
  /** 使用的模板类型 */
  templateType: SubjectTemplateType;
  /** 选择的理由（为什么用这个模板？） */
  templateReason: string;
  /** 生成的定妆图 storageKey 列表 */
  referenceImages: SubjectNodeMediaRef[];
  /** 幂等键 */
  aiStableKey: string;
}

/** 生成优先级 */
export type GenerationPriority = 'p0_critical' | 'p1_important' | 'p2_optional';

/**
 * 推演映射（软建议，非递归依赖，Plan#71 Spec §2.3）
 *
 * 某个状态占位卡「可参考哪张图做 img2img 推演」的关联提示。
 * - 通常指向 基础形态/上一个有图占位；
 * - 变身类等无依赖状态 = null；
 * - 用户可随时改源/清空；有值即提示生成时带该图为参考。
 */
export interface SubjectDeriveFrom {
  /** 来源主体 rootId */
  rootId: string;
  /** 来源占位 nodeId；缺省 = baseState */
  nodeId?: string;
  /** 来源图 storageKey（指纹快照，供失效检测比对） */
  mediaKey?: string;
  /** 来源图更新时间戳（指纹快照） */
  updatedAt?: string;
  /** 展示文案：如「由 step2 基础形态图推演」 */
  label?: string;
}

/** DevLook 预览条目（跨环境一致性验证） */
export interface DevLookEntry {
  /** 环境描述，如"日景户外，自然光暖调" */
  environment: string;
  /** 预览提示词（基于 baseState 的 delta 变体） */
  prompt: string;
  /** 生成的预览图 storageKey */
  imageKey?: string;
}

/** 主体状态迭代节点 */
export interface SubjectTreeNode {
  /** 节点稳定 id */
  id: string;
  /** 状态名：如「基础形态」「常态」「受伤」「幼年」「变身」 */
  state: string;
  /** 媒体类型 */
  type: SubjectNodeMedia;
  /** 推进生成步骤序号（AI 建议顺序：基础形态=1，其后占位 2,3…，可重排；Spec §2.3） */
  step?: number;
  /** 推演软映射：可参考哪张图做 img2img（无依赖=null；Spec §2.3） */
  deriveFrom?: SubjectDeriveFrom | null;
  /**
   * 差异提示词：只描述与 baseState 的不同，不重复基础特征。
   * 格式：保持 @baseRef 角色一致性。仅修改：[具体差异，如"左臂缠着白色绷带，面色苍白，粗布短褐沾满血迹"]
   */
  deltaPrompt: string;
  /**
   * 完整提示词（系统组装 = baseState.prompt 基础上 + deltaPrompt 语义合成）。
   * AI 生成时使用此字段调用 ai_image，但用户编辑时只改 deltaPrompt。
   */
  fullPrompt: string;
  /** LLM 识别语 */
  recognitionTerms: string[];
  /** 媒体资源 */
  media: SubjectNodeMediaRef[];
  /** 文本节点正文 */
  textContent?: string;
  /** 来源标记 */
  source: SubjectNodeSource;
  /** 幂等键 */
  aiStableKey?: string;
  /** 指向 baseState 所属的 rootId */
  baseRef: string;
  /** 关联用途 */
  usage?: string;
  /** 是否 AI 生成时已强关联到某镜头/剧情场景 */
  linked?: { shotStory?: string; detail?: string };
  /** 生成优先级（LLM 推荐的生成顺序，用户可调整） */
  generationPriority?: GenerationPriority;
  /** 出现集数（2026-11-04）：该状态出现的剧集编号列表；空/缺省 = 未设置（视为全部剧集）。
   *  编号取剧集 number（script-store nextEpisodeNumber 保证删除集后不复用空缺号）；
   *  剧集被删后的悬空编号在 UI 层过滤显示、数据保留（不静默清除）。 */
  appearEpisodes?: number[];
}

/** 单个主体的完整树（root + 基础定妆 + 状态迭代） */
export interface SubjectTree {
  /** 主体唯一 id（root 稳定键，改名不断链） */
  rootId: string;
  /**
   * 绑定的统筹条目 id（2026-11-06 修复「同名主体被一起改类型」）。
   * 旧口径只按 name 配对，而「添加主体」默认名全是「新主体」→ 多条同名条目命中同一棵树，
   * 改一条的类型/封面会串到另一条。本字段是两者唯一权威绑定，
   * 缺省（老数据 / MCP 直接写的树）退回「名字唯一」配对，详见 findTreeForItem。
   */
  itemId?: string | null;
  /** 主体名称（仅别名显示；映射以 rootId 为准，改名自动刷新不破坏关联） */
  name: string;
  /** 主体类型 */
  kind: ProductionItemKind;
  /** 主体别名 */
  aliases: string[];
  /** 形象锚点句：跨镜头/视频逐字复用（Spec §2.2） */
  identityAnchor?: string;
  /** 基础定妆 */
  baseState: SubjectBaseState;
  /** 状态迭代节点集合 */
  states: SubjectTreeNode[];
  /** 封面：root 级别剧照（选填） */
  coverKey?: string | null;
  /** 用户删过的状态名（LLM 识别注册时跳过防复活） */
  deletedStates?: string[];
  /** 跨环境一致性预览（DevLook），baseState 生成后建议同步生成 */
  devlook?: DevLookEntry[];
  /** 色卡选择理由 */
  colorCardReason?: string;
}

/**
 * 某个状态（含基础状态）「可当封面」的首个媒体键（2026-11-06 状态作封面）。
 * 音频不能当封面（封面是图），取不到非音频媒体 → null（UI 层据此提示先补图）。
 */
export function firstCoverMediaKeyOfState(
  media: readonly { key: string; type: string }[] | null | undefined,
): string | null {
  for (const m of media ?? []) {
    if (m?.key && m.type !== 'audio') return m.key;
  }
  return null;
}

/**
 * 主体封面候选键（顺序 = 基础状态 → 各状态原序），供 resolveSubjectCover(item, extraKeys)
 * 识别手动封面与做默认回落。本地版主体图大多只活在树里（条目 images[] 为空），
 * 不递候选集则「把某状态当封面」无法生效，列表卡也会一直显示「暂无封面图」。
 */
export function subjectCoverCandidates(tree: SubjectTree | null | undefined): string[] {
  if (!tree) return [];
  const out: string[] = [];
  const push = (k: string | null): void => {
    if (k && !out.includes(k)) out.push(k);
  };
  push(firstCoverMediaKeyOfState(tree.baseState?.referenceImages));
  for (const n of tree.states ?? []) push(firstCoverMediaKeyOfState(n.media));
  return out;
}

/**
 * 条目 ↔ 主体树 唯一绑定（2026-11-06 修复同名串台）。回落链：
 * 1) `tree.itemId === item.id` 直接命中（新建 / 建树即写，改名不断链）；
 * 2) 无 itemId 的老树按名字配对，但**同名条目多于一条时只让第一条继承**，
 *    其余条目当作「还没有树」——进详情时各自建一棵带 itemId 的新树，
 *    绝不与第一条抢同一棵树（抢 = 用户看到的「改一个另一个也跟着变」）；
 * 3) 配不上 = 无树（类型退回条目 kind，状态列表为空，不编造归属）。
 */
export function findTreeForItem(
  trees: readonly SubjectTree[],
  item: { id: string; name: string },
  items: readonly { id: string; name: string }[],
): SubjectTree | undefined {
  const byId = trees.find((tr) => tr.itemId && tr.itemId === item.id);
  if (byId) return byId;
  const sameName = items.filter((it) => it.name === item.name);
  if (sameName.length > 1 && sameName[0]?.id !== item.id) return undefined;
  return trees.find((tr) => !tr.itemId && tr.name === item.name);
}

/** findTreeForItem 的反向查询（树 → 条目）：封面 / 改类型回写条目都走这里 */
export function findItemForTree<TItem extends { id: string; name: string }>(
  items: readonly TItem[],
  tree: SubjectTree,
  trees: readonly SubjectTree[],
): TItem | undefined {
  if (tree.itemId) return items.find((it) => it.id === tree.itemId);
  // 多棵无绑定同名树 = 归属无法确定，不猜（避免把封面/类型写到错的那一条上）
  const unbound = trees.filter((tr) => !tr.itemId && tr.name === tree.name);
  if (unbound.length > 1) return undefined;
  // 与 findTreeForItem 同口径：同名多条时只认第一条
  return items.find((it) => it.name === tree.name);
}

/** 创建默认状态迭代节点（step/deriveFrom 由调用方按大纲顺序补） */
export function createSubjectNode(
  state: string,
  type: SubjectNodeMedia = 'image',
  source: SubjectNodeSource = 'user',
  baseRef: string = '',
  extra?: { step?: number; deriveFrom?: SubjectDeriveFrom | null },
): SubjectTreeNode {
  return {
    id: `snode-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    state,
    type,
    step: extra?.step,
    deriveFrom: extra?.deriveFrom ?? null,
    deltaPrompt: '',
    fullPrompt: '',
    recognitionTerms: [],
    media: [],
    source,
    baseRef,
    appearEpisodes: [],
  };
}

/** 创建默认主体树（含空 baseState）；itemId = 绑定的统筹条目 id（新建就写，不留名字配对窗口） */
export function createSubjectTree(kind: ProductionItemKind = 'character', name = '', itemId?: string | null): SubjectTree {
  const id = `subj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    rootId: id,
    itemId: itemId ?? null,
    name,
    kind,
    aliases: [],
    baseState: {
      prompt: '',
      templateType: 'character_lineup',
      templateReason: '',
      referenceImages: [],
      aiStableKey: `${id}_base`,
    },
    states: [],
    coverKey: null,
    devlook: [],
    colorCardReason: '',
  };
}

/** 创建项目级默认色卡（zerovideoAgent 5 色绑定复用） */
export function createDefaultColorCard(): ProjectColorCard {
  return {
    palette: [
      { id: 'C1', name: '晨雾灰', hex: '#D4D4D4', usage: '高光/日景山林/晨雾' },
      { id: 'C2', name: '森林赭', hex: '#C4A35A', usage: '固有色/枯草/泥土/秋林' },
      { id: 'C3', name: '油灯橙', hex: '#E8A040', usage: '暖光主光源/室内暖调' },
      { id: 'C4', name: '月光蓝', hex: '#7A8BA8', usage: '阴影/夜景冷调/暗部' },
      { id: 'C5', name: '青白釉', hex: '#8DB5A4', usage: '瓷器道具/特殊色' },
    ],
  };
}

// ===== 2026-09-04 征集 #155：删除 BASE_STATE_TERM（按 kind 派生的基础形态术语）=====
// 原值：character='角色形象·三视图定妆' / scene='场景·全景参考' / prop='道具参考·多角度细节'。
// 需求变更两个前提：① 角色不一定是人形（生物/机器人/动物类角色此前被错称）；
// ② 不再使用「xxx 定妆照」这类术语，统一称「基础状态」。前端统一用 i18n `subject.baseState`。
// baseState.templateType / templateReason 字段保留（后端 LLM 契约），仅不再映射成展示术语。

/**
 * 兼容旧数据归一化（Spec §2.3/§2.4）
 * - 为缺失 step 的状态占位按大纲顺序补号（基础形态=1，其后 2,3…）
 * - 缺省 deriveFrom → null（无依赖）
 * - baseRef 恒指 rootId
 */
export function normalizeSubjectTree(tree: SubjectTree): SubjectTree {
  const states = (tree.states ?? []).map((n, i) => ({
    ...n,
    baseRef: tree.rootId,
    step: typeof n.step === 'number' ? n.step : i + 2,
    deriveFrom: n.deriveFrom === undefined ? null : n.deriveFrom,
  }));
  return { ...tree, states };
}

/** 下一个状态占位的 step（基础=1，states 数 n → 下一个 = n+2） */
export function nextStateStep(tree: SubjectTree): number {
  return (tree.states?.length ?? 0) + 2;
}

/**
 * 新状态默认名（2026-11-04 约定）：以形象名称为前缀（如「东海龙王 · 状态2」），
 * 避免出现一堆无归属的「状态1」。形象名称为空 → 退回「状态N」本体。
 * stateLabel 由调用方传入 i18n（subject.stateLabelN，参数 n），保证三语一致。
 */
export function buildDefaultStateName(
  treeName: string,
  step: number,
  stateLabel: (n: number) => string,
): string {
  const label = stateLabel(step);
  const name = typeof treeName === 'string' ? treeName.trim() : '';
  return name ? `${name} · ${label}` : label;
}

// ===== 方案 C（2026-11-05 约定）：出现集数「不过滤、只排序 + 标签」=====
// 相关性 rank：0 = 命中当前集或未标注（未标注视为通用），1 = 明确标注为其它集。
// activeEpisodeNumber 取不到（null）时一律 0 = 不重排（退回原顺序，绝不硬编码集号）。

/** 单状态与本集相关性：命中/未标注 → 0；标注为其它集 → 1 */
export function stateEpisodeRank(
  node: Pick<SubjectTreeNode, 'appearEpisodes'>,
  activeEpisodeNumber: number | null,
): 0 | 1 {
  if (activeEpisodeNumber == null) return 0;
  const eps = node.appearEpisodes ?? [];
  if (eps.length === 0) return 0; // 未标注 = 通用
  return eps.includes(activeEpisodeNumber) ? 0 : 1;
}

/**
 * 状态显示排序（稳定、display-only，不改数据、不改树结构）：
 * rank 0（本集命中/未标注）在前，rank 1（标注为其它集）在后；同 rank 保持原顺序。
 * 返回新数组，入参不动 —— trees.states 的存储顺序不变，仅渲染顺序变化。
 */
export function sortStatesByEpisodeRelevance<T extends Pick<SubjectTreeNode, 'appearEpisodes'>>(
  states: T[],
  activeEpisodeNumber: number | null,
): T[] {
  if (activeEpisodeNumber == null) return states;
  return states
    .map((s, i) => ({ s, i, r: stateEpisodeRank(s, activeEpisodeNumber) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.s);
}

/** 树级相关性：任一状态 rank 0（命中/未标注）即 0；全部状态都标注为其它集才 1；无状态 = 通用 0 */
export function treeEpisodeRank(
  states: Array<Pick<SubjectTreeNode, 'appearEpisodes'>> | undefined,
  activeEpisodeNumber: number | null,
): 0 | 1 {
  if (activeEpisodeNumber == null) return 0;
  if (!states || states.length === 0) return 0;
  return states.some((s) => stateEpisodeRank(s, activeEpisodeNumber) === 0) ? 0 : 1;
}

/** 主体列表显示排序（同上稳定、display-only）：树间父子结构不变，仅渲染顺序变化 */
export function sortTreesByEpisodeRelevance<T extends { states?: Array<Pick<SubjectTreeNode, 'appearEpisodes'>> }>(
  trees: T[],
  activeEpisodeNumber: number | null,
): T[] {
  if (activeEpisodeNumber == null) return trees;
  return trees
    .map((tr, i) => ({ tr, i, r: treeEpisodeRank(tr.states, activeEpisodeNumber) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.tr);
}

/**
 * 推导软映射建议：默认指向「上一个有图的占位」，无则回退基础形态图；再无则 null。
 * 调用方插入新占位时按此预填 deriveFrom（用户可清空/改源）。
 */
export function findDeriveSuggestion(tree: SubjectTree): SubjectDeriveFrom | null {
  const states = tree.states ?? [];
  for (let i = states.length - 1; i >= 0; i--) {
    const n = states[i];
    if (!n) continue;
    const m = (n.media ?? []).find((x) => x.type !== 'audio');
    if (m) {
      return {
        rootId: tree.rootId,
        nodeId: n.id,
        mediaKey: m.key,
        label: `${tree.name}/${n.state || '状态'}`,
      };
    }
  }
  const bm = (tree.baseState?.referenceImages ?? []).find((x) => x.type === 'image');
  if (bm) {
    return { rootId: tree.rootId, mediaKey: bm.key, label: `${tree.name}/基础形态` };
  }
  return null;
}