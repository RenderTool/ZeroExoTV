/**
 * director-params — 导演台 H3 参数/槽位/帧数学 唯一事实源（对齐 ComfyUI_MiniMaxH3_Director 节点）
 *
 * 逆向依据（行号见各字段 source）：
 * - nodes/director.py / nodes/director_common.py / nodes/director_groups.py（INPUT_TYPES）
 * - director/pack.py（槽位文件名正则 Picture1-9/Audio1-3/Video1-3 = 全局槽位号）
 * - director/plan.py（merge_indexed_refs：公共⨁组内、同槽位组内覆盖公共）
 * - director/frame_align.py（17k+5 吸附）、h3_motion_context.py（延续法）
 * - web/js/minimax_gen_timeline.js（MAX_GEN_FRAMES=736）
 *
 * 铁律：
 * 1. 全应用只允许 assignAssetSlots 一个槽位分配函数（公共占 1..K，片段 K+1 续排）。
 * 2. 参数只写源码可证实项；只能推断的（sd2.5=50 素材上限）标 verified:false，不落预设默认值。
 * 3. 运行链路本仓库不存在：只交付 validateRunSelection + buildPackSummary（dry-run）。
 */

// ===== 模型档位与素材上限 =====

export type DirectorModelTier = 'h3' | 'sd2.5';
export type DirectorAssetKind = 'image' | 'audio' | 'video';

export interface DirectorAssetRef {
  id: string;
  kind: DirectorAssetKind;
  title?: string;
  storageKey?: string;
  /** 预览 url（图片 dataUrl / 直链） */
  url?: string;
  /** 来源：library=公共资产 / project=本项目 */
  originScope?: 'library' | 'project';
  /**
   * 槽位号 pin（2026-11-04 槽位移除指令）：移除中间槽位后其余槽位保持原号，不整体重排。
   * 缺省 = 按数组顺序取该类型最小空号（与历史行为逐号一致）。
   */
  slotNo?: number;
}

/**
 * 素材上限。h3（含 sd2.0）：图 9（lib/ref_images.py L8 MAX_REFERENCE_IMAGES=9）、音 3、视 3 均源码实锤。
 * sd2.5=50 为产品需求（节点源码无此档位）——仅作上限常量，不进参数预设默认值。
 */
export const DIRECTOR_ASSET_CAPS: Record<DirectorModelTier, Record<DirectorAssetKind, number>> = {
  h3: { image: 9, audio: 3, video: 3 },
  'sd2.5': { image: 50, audio: 3, video: 3 },
};

/** 槽位标签前缀（与 pack.py L37-41 文件名正则一致） */
const SLOT_LABEL: Record<DirectorAssetKind, string> = {
  image: 'Picture',
  audio: 'Audio',
  video: 'Video',
};

export interface DirectorSlotEntry {
  assetId: string;
  kind: DirectorAssetKind;
  /** 全局槽位号（该类素材编号空间内） */
  slot: number;
  /** 展示标签，如 Picture3 */
  label: string;
  scope: 'shared' | 'segment';
}

export class DirectorSlotOverflowError extends Error {
  constructor(public readonly kind: DirectorAssetKind, public readonly used: number, public readonly cap: number) {
    super(`素材超出上限：${SLOT_LABEL[kind]} 已用 ${used} 个，${kind === 'image' ? '当前模型档位' : ''}上限 ${cap} 个`);
    this.name = 'DirectorSlotOverflowError';
  }
}

export interface AssignAssetSlotsResult {
  entries: DirectorSlotEntry[];
  byAssetId: Record<string, DirectorSlotEntry>;
  /** 片段素材在该类编号空间的起始槽位（= 公共该类素材数 + 1） */
  segmentStartSlot: Record<DirectorAssetKind, number>;
}

/**
 * 唯一槽位分配函数：公共素材先行占该类编号 1..K，片段素材从 K+1 续排。
 * 与节点 pack.py 语义一致（文件名 N = 全局槽位号；合并时同槽位组内覆盖公共）。
 * 任一类别 公共+片段 超过档位上限即抛 DirectorSlotOverflowError（不静默截断）。
 */
export function assignAssetSlots(args: {
  shared: DirectorAssetRef[];
  segment: DirectorAssetRef[];
  tier: DirectorModelTier;
}): AssignAssetSlotsResult {
  const caps = DIRECTOR_ASSET_CAPS[args.tier];
  const entries: DirectorSlotEntry[] = [];
  const byAssetId: Record<string, DirectorSlotEntry> = {};
  const used: Record<DirectorAssetKind, Set<number>> = {
    image: new Set(), audio: new Set(), video: new Set(),
  };
  const sharedMax: Record<DirectorAssetKind, number> = { image: 0, audio: 0, video: 0 };

  const emit = (asset: DirectorAssetRef, scope: 'shared' | 'segment', slot: number) => {
    used[asset.kind].add(slot);
    if (scope === 'shared') sharedMax[asset.kind] = Math.max(sharedMax[asset.kind], slot);
    const entry: DirectorSlotEntry = {
      assetId: asset.id, kind: asset.kind, slot,
      label: `${SLOT_LABEL[asset.kind]}${slot}`, scope,
    };
    entries.push(entry);
    byAssetId[asset.id] = entry;
  };

  const all: Array<{ asset: DirectorAssetRef; scope: 'shared' | 'segment' }> = [
    ...args.shared.map((asset) => ({ asset, scope: 'shared' as const })),
    ...args.segment.map((asset) => ({ asset, scope: 'segment' as const })),
  ];

  // 第一遍：pin 槽号落位（合法 = 该类 1..cap 且未被占用；非法/冲突 pin 降为未 pin）
  const unpinned: typeof all = [];
  for (const item of all) {
    const pin = item.asset.slotNo;
    if (
      typeof pin === 'number' && Number.isInteger(pin)
      && pin >= 1 && pin <= caps[item.asset.kind] && !used[item.asset.kind].has(pin)
    ) {
      emit(item.asset, item.scope, pin);
    } else {
      unpinned.push(item);
    }
  }

  // 第二遍：未 pin 按「公共先行 → 片段续排」取该类最小空号（无 pin 时与历史逐号一致）
  for (const item of unpinned) {
    const set = used[item.asset.kind];
    let next = 1;
    while (set.has(next)) next += 1;
    if (next > caps[item.asset.kind]) {
      throw new DirectorSlotOverflowError(item.asset.kind, next, caps[item.asset.kind]);
    }
    emit(item.asset, item.scope, next);
  }

  // 片段起始槽位 = 公共该类最大占号 + 1（无 pin 时 = 公共占用数 + 1，与历史一致）
  const segmentStartSlot: Record<DirectorAssetKind, number> = {
    image: sharedMax.image + 1,
    audio: sharedMax.audio + 1,
    video: sharedMax.video + 1,
  };

  return { entries, byAssetId, segmentStartSlot };
}

// ===== 公共池顺延（2026-11-05 约定：公共池永占编号前缀 1..K，片段从 K+1 续排） =====

/**
 * 算法照抄插件 ComfyUI_MiniMaxH3_Director web/js/minimax_image_batch.js：
 * - `_rebaseIndexedMedia`（L133-183）：offset=公共池最高槽号 K；
 *   全部 pinned 槽 ≤K（legacy）→ 整块 +K；混合 → 只把碰撞者按升序抬到 ≥K+1 的下一空槽；
 *   超出上限的 pin 丢弃（插件整条丢弃，这里保素材丢 pin，由分配兜底/报溢出）。
 * - `rebaseR2vGroupSlotsForCommon`（L185-222）：公共池增删/开关打开时对全部片段 rebase；
 *   公共池收缩（移除/关闭）→ offset 变小 → 无低位碰撞 → **不回退**（插件同语义，不自创回退）。
 * 无 pin 的片段素材不参与顺延：assignAssetSlots 第二趟本就把它们排到公共前缀之后。
 */
export interface SegmentSlotMove {
  kind: DirectorAssetKind;
  assetId: string;
  from: number;
  to: number;
}

export interface RebaseSegmentSlotsResult {
  /** 顺延后的片段引用（未变动的保持原对象引用；变动的浅拷贝改 slotNo） */
  refs: DirectorAssetRef[];
  /** 槽号移动清单（供调用方同步改写提示词 @PictureN/@AudioN/@VideoN 引用） */
  moves: SegmentSlotMove[];
}

export function rebaseSegmentRefsForShared(args: {
  /** 有效公共素材（enabled ? assets : []），由调用方算好 */
  shared: DirectorAssetRef[];
  segment: DirectorAssetRef[];
  tier: DirectorModelTier;
}): RebaseSegmentSlotsResult {
  const { shared, segment, tier } = args;
  // 公共池独立编号轴求各类 K（最高公共槽号；公共池内部 pin 优先、无 pin 按序填空）
  const sharedSlots = shared.length > 0 ? assignAssetSlots({ shared, segment: [], tier }).byAssetId : {};
  const offsetByKind: Record<DirectorAssetKind, number> = { image: 0, audio: 0, video: 0 };
  for (const ref of shared) {
    const slot = sharedSlots[ref.id]?.slot;
    if (slot != null && slot > offsetByKind[ref.kind]) offsetByKind[ref.kind] = slot;
  }
  if (offsetByKind.image === 0 && offsetByKind.audio === 0 && offsetByKind.video === 0) {
    return { refs: segment, moves: [] }; // 公共池空/关闭 → 不回退
  }
  const moves: SegmentSlotMove[] = [];
  const nextSlotById = new Map<string, number>();
  // KINDS 即三类素材轴（与 DIRECTOR_ASSET_CAPS 的 kind 维度一致）；DIRECTOR_SLOT_CAPS 为重构前旧名，已由 L42 的 DIRECTOR_ASSET_CAPS 取代
  for (const kind of ['image', 'audio', 'video'] as DirectorAssetKind[]) {
    const offset = offsetByKind[kind];
    if (offset <= 0) continue;
    const cap = DIRECTOR_ASSET_CAPS[tier][kind];
    const pinned = segment.filter(
      (r) => r.kind === kind && Number.isInteger(r.slotNo) && (r.slotNo as number) >= 1,
    );
    const lows = pinned
      .filter((r) => (r.slotNo as number) <= offset)
      .sort((a, b) => (a.slotNo as number) - (b.slotNo as number));
    if (lows.length === 0) continue;
    if (lows.length === pinned.length) {
      // legacy 块：整体 +offset（插件 L163-175）
      for (const r of pinned) {
        const to = (r.slotNo as number) + offset;
        if (to > cap) continue;
        nextSlotById.set(r.id, to);
        moves.push({ kind, assetId: r.id, from: r.slotNo as number, to });
      }
    } else {
      // 混合：只抬碰撞者到 ≥offset+1 的下一空槽（插件 L177-181；used 含原槽不释放）
      const used = new Set(pinned.map((r) => r.slotNo as number));
      for (const r of lows) {
        let to = offset + 1;
        while (used.has(to)) to += 1;
        if (to > cap) continue;
        used.add(to);
        nextSlotById.set(r.id, to);
        moves.push({ kind, assetId: r.id, from: r.slotNo as number, to });
      }
    }
  }
  if (moves.length === 0) return { refs: segment, moves };
  return {
    refs: segment.map((r) => {
      const to = nextSlotById.get(r.id);
      return to == null ? r : { ...r, slotNo: to };
    }),
    moves,
  };
}

/**
 * 提示词槽号改写（2026-11-05 顺延联动）：把 `@PictureN `/`@AudioN `/`@VideoN ` 提及按
 * old→new 槽号映射改号，保持「编号 = 槽位」永不脱钩。单趟替换（按出现位置逐处映射），
 * 天然防级联（1→2 与 2→3 同时存在不互踩）；未在映射中的提及原样保留。
 */
export function retagPromptSlotRefs(
  prompt: string,
  moves: Partial<Record<DirectorAssetKind, Map<number, number>>>,
): string {
  if (!prompt || (!moves.image?.size && !moves.audio?.size && !moves.video?.size)) return prompt;
  return prompt.replace(/@(Picture|Audio|Video)(\d+)(?!\d)/g, (raw, label: string, digits: string) => {
    const kind: DirectorAssetKind = label === 'Picture' ? 'image' : (label.toLowerCase() as DirectorAssetKind);
    const to = moves[kind]?.get(Number(digits));
    return to == null ? raw : `@${label}${to}`;
  });
}

/** 片段引用顺延结果（含提示词改号后的正文） */
export interface RebasedShotRefs {
  shotId: string;
  references: DirectorAssetRef[];
  imagePrompt: string;
}

/**
 * 公共池变化后重排全部片段：rebase 槽位 pin + 同步改写 imagePrompt 的 @PictureN/@AudioN/@VideoN。
 */
export function rebaseShotsForSharedChange(args: {
  shared: DirectorAssetRef[];
  shots: Array<{ id: string; references: DirectorAssetRef[]; imagePrompt: string }>;
  tier: DirectorModelTier;
}): { changed: boolean; shots: RebasedShotRefs[] } {
  const { shared, shots, tier } = args;
  let changed = false;
  const out = shots.map((s) => {
    const { refs, moves } = rebaseSegmentRefsForShared({ shared, segment: s.references, tier });
    if (moves.length === 0) return { shotId: s.id, references: s.references, imagePrompt: s.imagePrompt };
    changed = true;
    const moveMap: Partial<Record<DirectorAssetKind, Map<number, number>>> = {};
    for (const m of moves) (moveMap[m.kind] ??= new Map()).set(m.from, m.to);
    return { shotId: s.id, references: refs, imagePrompt: retagPromptSlotRefs(s.imagePrompt, moveMap) };
  });
  return { changed, shots: out };
}

// ===== 帧数学（17k+5 吸附，frame_align.py L8-13；上限 736，minimax_gen_timeline.js L239） =====

export const DIRECTOR_FPS = 24;
export const MAX_GEN_FRAMES = 736;

/** 17k+5 吸附：f + (5 - f) mod 17（结果为非负最小网格点） */
export function alignFrames(frames: number): number {
  const f = Math.max(1, Math.round(frames));
  return f + ((((5 - f) % 17) + 17) % 17);
}

/** 秒 → 吸附帧（24fps；8s=192 / 10s=243 / 12s=294 / 15s=362） */
export function durationToFrames(sec: number): number {
  return alignFrames(Math.round(sec * DIRECTOR_FPS));
}

// ===== 单段时长滑动条（2026-11-06 用户指令：「时间下拉做成 0–30s 滑动条，滑动过程中提醒是否超推荐时长」）=====

/** 滑动条下限：取 duration_sec 参数 schema 的 min（0.2s），不给 0——零时长不是合法片段 */
export const DURATION_SLIDER_MIN_SEC = 0.2;
/** 滑动条上限：帧上限 736 @ 24fps ≈ 30.67s → 取整 30s（用户指定的 0–30 区间与引擎天花板一致，不是拍脑袋） */
export const DURATION_SLIDER_MAX_SEC = 30;
/** 滑动粒度 0.2s：再细也没意义——帧数走 17k+5 吸附，1 帧 = 1/24s */
export const DURATION_SLIDER_STEP_SEC = 0.2;

/**
 * 当前引导配置下的推荐时长上限（秒，向下取整，至少 1s）。
 * 延续法的采样预算 = align(可见帧 + 上下文帧) ≤ MAX_GEN_FRAMES，所以开了段间引导时
 * 推荐上限要按 ctx 帧数实时扣回（ctx=56 → 少 2.33s），与 validateRunSelection 同一判据。
 */
export function recommendedDurationCapSec(ctxFrames: number): number {
  return Math.max(1, Math.floor((MAX_GEN_FRAMES - Math.max(0, ctxFrames || 0)) / DIRECTOR_FPS));
}

/** 超出推荐上限多少秒（0 = 未超）；UI 实时提醒与 dry-run 预检共用，避免两套算法对不上 */
export function durationOverCapSec(sec: number, ctxFrames: number): number {
  return Math.max(0, Math.round((sec - recommendedDurationCapSec(ctxFrames)) * 100) / 100);
}

/** 是否超单段硬帧上限（超了 dry-run 必报 frame-overflow，比“超推荐”更严重一级） */
export function durationExceedsFrameCap(sec: number): boolean {
  return durationToFrames(sec) > MAX_GEN_FRAMES;
}

/** 上下文帧数合法值（h3_motion_context.py L30-31：其余值就近吸附） */
export const CONTINUITY_OVERLAP_OPTIONS = [5, 22, 39, 56] as const;
export type ContinuityOverlap = (typeof CONTINUITY_OVERLAP_OPTIONS)[number];

export function snapContinuityOverlap(n: number): ContinuityOverlap {
  let best: ContinuityOverlap = 22;
  let bestDist = Infinity;
  for (const opt of CONTINUITY_OVERLAP_OPTIONS) {
    const d = Math.abs(opt - n);
    if (d < bestDist) { bestDist = d; best = opt; }
  }
  return best;
}

/** 延续法采样预算：sample = align(visible + ctx)；解码后裁 ctx 前缀，导出 = visible（h3_motion_context.py L745-774） */
export function generationFrameBudget(visibleFrames: number, ctxFrames: number): number {
  return alignFrames(visibleFrames + ctxFrames);
}

// ===== APP 级视频尺寸：比例 × 系数 → 宽高自动换算（宽高不提供直接编辑，2026-11-04 约定） =====

export const DIRECTOR_ASPECT_OPTIONS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] as const;
export type DirectorAspect = (typeof DIRECTOR_ASPECT_OPTIONS)[number];
export const DIRECTOR_SCALE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5] as const;

const ASPECT_RATIO: Record<DirectorAspect, number> = {
  '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:3': 4 / 3, '3:4': 3 / 4, '21:9': 21 / 9,
};
/**
 * 官方 Size Settings Reference：1 MP = 1024² 像素，按面积开方求宽高再就近对齐 ×32。
 * ×1 对应 0.4MP（16:9 → 864×480，即节点默认 nodes/director_common.py L61-62）；
 * 系数语义 = 像素量倍数（×0.5 → 0.2MP、×1.5 → 0.6MP），不是宽高倍数。
 */
const PIXELS_PER_MEGAPIXEL = 1024 * 1024;
const BASE_MEGAPIXELS = 0.4;
const round32 = (n: number): number => Math.max(32, Math.round(n / 32) * 32);

/** 尺寸系数范围（2026-11-04 约定：自由数字输入，不再固定档位） */
export const SCALE_FACTOR_MIN = 0.1;
export const SCALE_FACTOR_MAX = 2;
export const SCALE_FACTOR_DEFAULT = 1;

/**
 * 系数夹取：有限数夹到 [0.1, 2]；非法输入（NaN/空串/Infinity）回退默认 1。
 * 历史枚举值 0.5/0.75/1.25/1.5 自然兼容（均在界内原样通过）。
 */
export function clampScaleFactor(n: unknown): number {
  const v = typeof n === 'string' && n.trim() === '' ? NaN : Number(n);
  if (!Number.isFinite(v)) return SCALE_FACTOR_DEFAULT;
  return Math.min(SCALE_FACTOR_MAX, Math.max(SCALE_FACTOR_MIN, v));
}

/**
 * 宽度/高度 = f(比例, 尺寸系数)：官方 Size Settings Reference 换算（2026-11-10 对齐）。
 * 面积 = 0.4MP × 系数 × 1024² → w = √(面积 × r)、h = √(面积 / r) → 各自就近对齐 ×32。
 * 16:9 命中官方表：×0.5 → 608×352(0.2MP)、×1 → 864×480(0.4MP)、×1.25 → 960×544(0.5MP)、
 * ×1.5 → 1056×608(0.6MP)、×2 → 1216×672(0.8MP)。
 * 系数经 clampScaleFactor 夹取（×3 按 ×2 算）；所有结果恒 32 对齐且 ≥32
 * （MiniMax H3 VAE÷16 再 2×2 patch，非 32 倍数会被节点拒收）。
 */
export function resolveVideoSize(aspect: string, scaleFactor: number): { width: number; height: number } {
  const r = ASPECT_RATIO[aspect as DirectorAspect] ?? 16 / 9;
  const f = clampScaleFactor(scaleFactor);
  const total = BASE_MEGAPIXELS * f * PIXELS_PER_MEGAPIXEL;
  return {
    width: round32(Math.sqrt(total * r)),
    height: round32(Math.sqrt(total / r)),
  };
}

/**
 * UI 可见参数白名单（2026-11-04 约定：APP 只暴露视频相关参数，其余一律不进 UI）。
 * 未列入的节点字段仍按 DIRECTOR_PRESETS 默认值进 pack，保证导出合法。
 * - 公共(2)：aspect / scaleFactor（commonEnabled 做成 Tab 勾，不占参数行）
 *   （2026-11-05 公共提示词层下线：global_prompt 移除，重复内容由 MCP/LLM 直接写入每段提示词）
 * - 片段(2)：prompt / duration_sec（2026-11-04 约定：线上版本没有负面提示词，UI 彻底移除）
 * - 引导(4)：continuityFromPrev / continuityMode / continuityOverlapFrames / continuityRedraw（continue 时才显示）
 */
export const DIRECTOR_UI_PARAMS = {
  shared: ['aspect', 'scaleFactor'],
  segment: ['prompt', 'duration_sec'],
  continuity: ['continuityFromPrev', 'continuityMode', 'continuityOverlapFrames', 'continuityRedraw'],
} as const;

// ===== 参数 Schema（39 项 = 公共 30 / 片段 9；source = 节点源码出处） =====

export interface DirectorParamOption { value: string; label: string }

export interface DirectorParamField {
  key: string;
  label: string;
  type: 'int' | 'float' | 'bool' | 'string' | 'enum';
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: DirectorParamOption[];
  multiline?: boolean;
  scope: 'shared' | 'segment';
  /** 节点源码出处（文件:行号） */
  source: string;
  /** false = 只能推断、未在源码证实（不落预设默认值） */
  verified: boolean;
}

const TASK_TYPE_OPTIONS: DirectorParamOption[] = [
  { value: 't2v', label: 't2v — 文生视频' },
  { value: 'i2v', label: 'i2v — 图生视频' },
  { value: 'fl2v', label: 'fl2v — 首尾帧生视频' },
  { value: 'r2v', label: 'r2v — 参考主体生视频' },
  { value: 'v2v', label: 'v2v — 视频生视频' },
  { value: 'rv2v', label: 'rv2v — 参考视频生视频' },
];

// 2026-11-05 导出：导演台「参数」面板 参考图尺寸模式 下拉所需（与上游插件 director/plan.py L77-172 一致）
export const REF_IMAGE_SIZE_OPTIONS: DirectorParamOption[] = [
  { value: 'match', label: 'match（按成片画布）' },
  { value: '1024', label: '1024' },
  { value: '1280', label: '1280' },
  { value: '1536', label: '1536' },
  { value: 'max', label: 'max（原样）' },
];

export const DIRECTOR_PARAM_SCHEMA: DirectorParamField[] = [
  // ---- 公共参数（30）----
  // （2026-11-05 公共提示词层下线：global_prompt 已移除——历史数据在导入时并入每段提示词，见 slot-containers 迁移）
  { key: 'task_type', label: '任务类型', type: 'enum', default: 't2v', options: TASK_TYPE_OPTIONS, scope: 'shared', source: 'lib/task_prompts.py L24-84', verified: true },
  { key: 'cfg', label: 'CFG', type: 'float', default: 1.0, min: 0, max: 30, step: 0.01, scope: 'shared', source: 'nodes/director_common.py L43-46', verified: true },
  { key: 'seed', label: '随机种子', type: 'int', default: 0, min: 0, max: 0xffffffffffffffff, step: 1, scope: 'shared', source: 'nodes/director_common.py L47-56', verified: true },
  { key: 'frame_rate', label: '帧率', type: 'float', default: 24.0, min: 1, max: 240, step: 0.1, scope: 'shared', source: 'nodes/director_common.py L57-59（内部恒 24）', verified: true },
  { key: 'width', label: '宽度', type: 'int', default: 864, min: 32, max: 8192, step: 32, scope: 'shared', source: 'nodes/director_common.py L61', verified: true },
  { key: 'height', label: '高度', type: 'int', default: 480, min: 32, max: 8192, step: 32, scope: 'shared', source: 'nodes/director_common.py L62', verified: true },
  { key: 'ref_max_size', label: '参考图最大边', type: 'int', default: 864, min: 32, max: 8192, step: 32, scope: 'shared', source: 'nodes/director_common.py L63', verified: true },
  { key: 'total_frames', label: '总帧数', type: 'int', default: 124, min: 5, max: 100000, step: 1, scope: 'shared', source: 'nodes/director_common.py L64-72', verified: true },
  { key: 'steps', label: '采样步数', type: 'int', default: 8, min: 1, max: 200, step: 1, scope: 'shared', source: 'nodes/director.py L161-172', verified: true },
  { key: 'sampler', label: '采样器', type: 'enum', default: 'res_multistep', options: [
    { value: 'res_multistep', label: 'res_multistep' }, { value: 'euler', label: 'euler' },
    { value: 'euler_ancestral', label: 'euler_ancestral' }, { value: 'ddim', label: 'ddim' },
    { value: 'dpmpp_2m', label: 'dpmpp_2m' }, { value: 'uni_pc', label: 'uni_pc' },
  ], scope: 'shared', source: 'nodes/director.py L173-179（KSampler.SAMPLERS，常用子集）', verified: true },
  { key: 'scheduler', label: '调度器', type: 'enum', default: 'simple', options: [
    { value: 'simple', label: 'simple' }, { value: 'normal', label: 'normal' },
    { value: 'karras', label: 'karras' }, { value: 'exponential', label: 'exponential' },
  ], scope: 'shared', source: 'nodes/director.py L180-189（KSampler.SCHEDULERS，常用子集）', verified: true },
  { key: 'shift_video', label: '视频 shift', type: 'float', default: 12.0, min: 0.01, max: 100, step: 0.01, scope: 'shared', source: 'nodes/director.py L190-193', verified: true },
  { key: 'shift_audio', label: '音频 shift', type: 'float', default: 3.0, min: 0.01, max: 100, step: 0.01, scope: 'shared', source: 'nodes/director.py L194-197', verified: true },
  { key: 'clear_vram_between_segments', label: '段间清显存', type: 'bool', default: true, scope: 'shared', source: 'nodes/director_common.py L80+（性能组）', verified: true },
  { key: 'clear_vram_before_refine', label: '精修前清显存', type: 'bool', default: false, scope: 'shared', source: 'nodes/director_common.py 性能组', verified: true },
  { key: 'clear_vram_before_face_refine', label: '面部精修前清显存', type: 'bool', default: false, scope: 'shared', source: 'nodes/director_common.py 性能组', verified: true },
  { key: 'cache_frames_codec', label: '缓存帧编码', type: 'enum', default: 'raw', options: [
    { value: 'raw', label: 'raw' }, { value: 'ffv1', label: 'ffv1' },
  ], scope: 'shared', source: 'nodes/director_common.py 性能组', verified: true },
  { key: 'export_source_images', label: '导出源图', type: 'bool', default: false, scope: 'shared', source: 'nodes/director_common.py 性能组', verified: true },
  { key: 'export_pre_face_refine', label: '导出面部精修前帧', type: 'bool', default: false, scope: 'shared', source: 'nodes/director_common.py 性能组', verified: true },
  { key: 'cache_name', label: '缓存名', type: 'string', default: '', scope: 'shared', source: 'nodes/director_common.py 性能组', verified: true },
  { key: 'refImageSize', label: '参考图尺寸', type: 'enum', default: 'match', options: REF_IMAGE_SIZE_OPTIONS, scope: 'shared', source: 'director/plan.py L77-172', verified: true },
  { key: 'continuityEnabled', label: '段间引导（主开关）', type: 'bool', default: false, scope: 'shared', source: 'director/segment_continuity.py L192-207', verified: true },
  { key: 'continuityOverlapFrames', label: '上下文帧数', type: 'enum', default: 22, options: [
    { value: '5', label: '5 帧' }, { value: '22', label: '22 帧' },
    { value: '39', label: '39 帧' }, { value: '56', label: '56 帧' },
  ], scope: 'shared', source: 'director/h3_motion_context.py L30-31,42-49（仅 5/22/39/56）', verified: true },
  { key: 'continuityMode', label: '引导方式', type: 'enum', default: 'guide', options: [
    { value: 'guide', label: 'guide（运动上下文）' }, { value: 'continue', label: 'continue（引导+重绘）' },
  ], scope: 'shared', source: 'director/segment_continuity.py L125-145', verified: true },
  { key: 'continuityRedraw', label: '重绘幅度', type: 'float', default: 0.10, min: 0, max: 0.95, step: 0.01, scope: 'shared', source: 'director/segment_continuity.py L148-164', verified: true },
  { key: 'continuityKeepTail', label: '保完整（对齐余量）', type: 'bool', default: true, scope: 'shared', source: 'director/segment_continuity.py L167-181', verified: true },
  { key: 'exportMode', label: '导出模式', type: 'enum', default: 'all', options: [
    { value: 'all', label: '整体导出' }, { value: 'segments', label: '分段导出' },
  ], scope: 'shared', source: 'timeline.output UI 块', verified: true },
  { key: 'maxExportFrames', label: '导出帧数上限', type: 'int', default: 0, min: 0, step: 1, scope: 'shared', source: 'timeline.output UI 块（0=不限）', verified: true },
  { key: 'audioMode', label: '音频模式', type: 'enum', default: 'generate', options: [
    { value: 'generate', label: '生成音频' },
  ], scope: 'shared', source: 'timeline.output UI 块', verified: true },
  { key: 'commonEnabled', label: '公共素材进场', type: 'bool', default: true, scope: 'shared', source: 'director/gen_timeline.py L406-410', verified: true },

  // ---- 片段参数（9）----
  { key: 'prompt', label: '片段提示词', type: 'string', default: '', multiline: true, scope: 'segment', source: 'nodes/director_groups.py L206+', verified: true },
  { key: 'negativePrompt', label: '负面提示词', type: 'string', default: '', multiline: true, scope: 'segment', source: 'director/pack.py L417-451（存 plan，不进采样）', verified: true },
  { key: 'duration_sec', label: '时长（秒）', type: 'float', default: 5, min: 0.2, max: 120, step: 0.1, scope: 'segment', source: 'nodes/director_groups.py L43-51（17k+5 吸附）', verified: true },
  { key: 'ref_image_size', label: '参考图尺寸（段级）', type: 'enum', default: 'match', options: REF_IMAGE_SIZE_OPTIONS, scope: 'segment', source: 'nodes/director_groups.py', verified: true },
  { key: 'task_type_override', label: '任务类型（段级覆盖）', type: 'enum', default: '', options: [
    { value: '', label: '继承公共' }, ...TASK_TYPE_OPTIONS,
  ], scope: 'segment', source: 'director/pack.py L417-451（空串=继承 pack 级）', verified: true },
  { key: 'continuityFromPrev', label: '上下文引导', type: 'bool', default: true, scope: 'segment', source: 'director/segment_continuity.py L210-231（段0恒false，缺省true）', verified: true },
  { key: 'ref_images', label: '参考图素材', type: 'int', default: 0, min: 0, max: 9, scope: 'segment', source: 'lib/ref_images.py L8（≤9）', verified: true },
  { key: 'ref_videos', label: '参考视频素材', type: 'int', default: 0, min: 0, max: 3, scope: 'segment', source: 'lib/ref_videos.py L10（≤3）', verified: true },
  { key: 'ref_audios', label: '参考音频素材', type: 'int', default: 0, min: 0, max: 3, scope: 'segment', source: 'lib/ref_audios.py L8（≤3）', verified: true },
];

// ===== 本地参数模板（替代线上 API 取参；默认值与节点 INPUT_TYPES 一致） =====

export interface DirectorPreset {
  id: DirectorModelTier;
  label: string;
  /** 公共参数默认值（仅 verified 项） */
  params: Record<string, unknown>;
}

function sharedDefaults(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of DIRECTOR_PARAM_SCHEMA) {
    if (f.scope === 'shared' && f.verified) out[f.key] = f.default;
  }
  return out;
}

export const DIRECTOR_PRESETS: Record<DirectorModelTier, DirectorPreset> = {
  h3: { id: 'h3', label: 'MiniMax H3（SD2.0，素材≤9）', params: sharedDefaults() },
  // sd2.5 与 h3 同参数集（节点源码无独立档位）；差异仅在素材上限 50（DIRECTOR_ASSET_CAPS）
  'sd2.5': { id: 'sd2.5', label: 'SD2.5（素材≤50）', params: sharedDefaults() },
};

/**
 * 切换参数模板：保留同名字段（用户已填值不动），其余取模板默认；
 * 返回被重置键清单（UI 提示用）。
 */
export function applyPreset(
  current: Record<string, unknown>,
  presetId: DirectorModelTier,
): { params: Record<string, unknown>; keptKeys: string[]; resetKeys: string[] } {
  const tpl = DIRECTOR_PRESETS[presetId].params;
  const params: Record<string, unknown> = {};
  const keptKeys: string[] = [];
  const resetKeys: string[] = [];
  for (const [key, def] of Object.entries(tpl)) {
    if (current[key] !== undefined) {
      params[key] = current[key];
      if (current[key] !== def) keptKeys.push(key);
    } else {
      params[key] = def;
      resetKeys.push(key);
    }
  }
  return { params, keptKeys, resetKeys };
}

// ===== 选择运行：ready 校验 + dry-run pack 摘要 =====

/** 校验/摘要所需的片段最小结构（entities 层不反向依赖 features 类型） */
export interface RunShotLike {
  id: string;
  number: number;
  duration: number;
  /** cancelled/interrupted = 用户取消 / 异常退出残留自愈降级（2026-11-05，与 WorkbenchShot.status 同步放宽） */
  status: 'pending' | 'generating' | 'done' | 'failed' | 'cancelled' | 'interrupted';
  imagePrompt?: string;
  references?: DirectorAssetRef[];
  continuation?: { enabled: boolean };
  /**
   * 片段引导槽（2026-11-07）：显式引导数据，独立于参考图槽位。
   * 存在时本段以它为引导，不再使用上一段 guide（API 侧 use_prev_guide=false）。
   */
  guide?: { id: string; frames?: number; sha256?: string } | null;
  /**
   * 本段上一次生成产物自带的引导（2026-11-09）：视频默认都会产出 guide，
   * 重跑单独一段时用它接续时间线里的上一段，不依赖「本次勾选顺序」。
   */
  media?: { guide?: { id?: string } | null } | null;
}

export interface SharedParamsLike {
  enabled: boolean;
  assets: DirectorAssetRef[];
  presetId: DirectorModelTier;
  params: Record<string, unknown>;
}

export interface RunReadinessIssue {
  shotId?: string;
  code: 'asset-overflow' | 'frame-overflow' | 'continuation-blocked' | 'empty-prompt' | 'subject-image-missing';
  message: string;
}

/**
 * 无图主体槽位校验的解析器（2026-11-04 @ 浮层指令C）：
 * 引用形式 `subject:<subjectId>`（整主体占槽、不绑定状态图）——返回该主体当前封面 key
 * （resolveSubjectCover 回落链），null = 尚未录入任何图像 → pack 不静默产空槽。
 */
export type SubjectCoverOf = (subjectId: string) => string | null;

/** 从引用 id 提取整主体占槽的 subjectId（仅 `subject:<id>` 两段形态；`subject:<id>:<stateId>` 已绑定图） */
export function parseBareSubjectRef(refId: string): string | null {
  if (!refId.startsWith('subject:')) return null;
  const rest = refId.slice('subject:'.length);
  return rest.includes(':') ? null : rest;
}

/** 段级延续缺省：段 1（index 0）恒 false，其余缺省 true（segment_continuity.py L210-231） */
export function segmentContinuityEnabled(shot: RunShotLike, index: number): boolean {
  if (index === 0) return false;
  return shot.continuation?.enabled ?? true;
}

/**
 * 运行前校验（不静默截断，逐条返回可读 issue）：
 * - asset-overflow：公共+选中段素材超档位上限（assignAssetSlots 抛错转 issue）
 * - frame-overflow：单段 align 后 > MAX_GEN_FRAMES(736)
 * - continuation-blocked：延续段的前段既未 done 也不在本次选中序列里
 * - empty-prompt：片段提示词为空
 */
export function validateRunSelection(args: {
  shots: RunShotLike[];
  shared: SharedParamsLike;
  tier: DirectorModelTier;
  selectedIds: string[];
  /** 主体封面解析（无图主体槽位校验；缺省 = 不做该校验，向后兼容） */
  subjectCoverOf?: SubjectCoverOf;
}): RunReadinessIssue[] {
  const issues: RunReadinessIssue[] = [];
  const selected = args.shots.filter((s) => args.selectedIds.includes(s.id));
  const sharedAssets = args.shared.enabled ? args.shared.assets : [];

  /** 无图主体槽位检查（shared 池 + 当前段池统一过一遍） */
  const checkSubjectSlots = (shot: RunShotLike) => {
    if (!args.subjectCoverOf) return;
    let slots: AssignAssetSlotsResult;
    try {
      slots = assignAssetSlots({ shared: sharedAssets, segment: shot.references ?? [], tier: args.tier });
    } catch {
      return; // 溢出已由 asset-overflow 上报
    }
    for (const ref of [...sharedAssets, ...(shot.references ?? [])]) {
      const subjectId = parseBareSubjectRef(ref.id);
      if (!subjectId) continue;
      if (args.subjectCoverOf(subjectId)) continue;
      const label = slots.byAssetId[ref.id]?.label ?? 'Picture?';
      const name = ref.title ?? subjectId;
      issues.push({
        shotId: shot.id, code: 'subject-image-missing',
        message: `片段 ${shot.number}：主体『${name}』尚未录入图像，槽位 ${label} 为空`,
      });
    }
  };

  for (const shot of selected) {
    try {
      assignAssetSlots({ shared: sharedAssets, segment: shot.references ?? [], tier: args.tier });
    } catch (err) {
      if (err instanceof DirectorSlotOverflowError) {
        issues.push({ shotId: shot.id, code: 'asset-overflow', message: `片段 ${shot.number}：${err.message}` });
      } else throw err;
    }
    checkSubjectSlots(shot);
    const frames = durationToFrames(shot.duration);
    if (frames > MAX_GEN_FRAMES) {
      issues.push({
        shotId: shot.id, code: 'frame-overflow',
        message: `片段 ${shot.number}：${shot.duration}s → ${frames} 帧，超出单段上限 ${MAX_GEN_FRAMES} 帧（≈30.7s@24fps）`,
      });
    }
    const idx = args.shots.findIndex((s) => s.id === shot.id);
    const prev = idx > 0 ? args.shots[idx - 1] : undefined;
    // 本段已有显式引导槽 → 不依赖上一段 guide（API 侧 use_prev_guide=false），不报衔接阻塞
    if (prev && !shot.guide && segmentContinuityEnabled(shot, idx)) {
      const prevInRun = args.selectedIds.includes(prev.id) &&
        selected.findIndex((s) => s.id === prev.id) < selected.findIndex((s) => s.id === shot.id);
      if (prev.status !== 'done' && !prevInRun) {
        issues.push({
          shotId: shot.id, code: 'continuation-blocked',
          message: `片段 ${shot.number}：已开启上下文引导，但前段（片段 ${prev.number}）未完成且不在本次运行序列`,
        });
      }
    }
    if (!shot.imagePrompt?.trim()) {
      issues.push({ shotId: shot.id, code: 'empty-prompt', message: `片段 ${shot.number}：提示词为空` });
    }
  }
  return issues;
}

export interface PackSegmentSummary {
  number: number;
  id: string;
  /** 可见帧（align 后） */
  frames: number;
  /** 延续上下文帧（未开延续 = 0） */
  ctxFrames: number;
  /** 采样预算帧 = align(frames + ctx) */
  budgetFrames: number;
  continuityFromPrev: boolean;
  prompt: string;
  slots: DirectorSlotEntry[];
}

export interface PackSummary {
  format: 'minimax-h3-director-pack';
  formatVersion: 1;
  tier: DirectorModelTier;
  sharedSlots: DirectorSlotEntry[];
  segments: PackSegmentSummary[];
  totalFrames: number;
  issues: RunReadinessIssue[];
}

/**
 * dry-run：输出将要提交的 pack 结构摘要（槽位表 / 每段帧数 / 延续关系）。
 * 本仓库无导演台生成链路——本函数是唯一"运行"产物，不发起任何真实生成请求。
 */
export function buildPackSummary(args: {
  shots: RunShotLike[];
  shared: SharedParamsLike;
  tier: DirectorModelTier;
  selectedIds: string[];
  /** 透传 validateRunSelection：无图主体槽位校验 */
  subjectCoverOf?: SubjectCoverOf;
}): PackSummary {
  const selected = args.shots.filter((s) => args.selectedIds.includes(s.id));
  const sharedAssets = args.shared.enabled ? args.shared.assets : [];
  const overlapRaw = Number(args.shared.params['continuityOverlapFrames'] ?? 22);
  const overlap = snapContinuityOverlap(Number.isFinite(overlapRaw) ? overlapRaw : 22);
  // 主开关默认关（segment_continuity.py L192-207 默认 false）：仅显式 true 才生效
  const globalContinuity = args.shared.params['continuityEnabled'] === true;

  const sharedSlots = assignAssetSlots({ shared: sharedAssets, segment: [], tier: args.tier }).entries;

  const segments: PackSegmentSummary[] = selected.map((shot) => {
    const idx = args.shots.findIndex((s) => s.id === shot.id);
    const cont = globalContinuity && segmentContinuityEnabled(shot, idx);
    const frames = durationToFrames(shot.duration);
    const ctx = cont ? overlap : 0;
    const slots = assignAssetSlots({ shared: sharedAssets, segment: shot.references ?? [], tier: args.tier }).entries;
    const fullPrompt = (shot.imagePrompt ?? '').trim();
    return {
      number: shot.number, id: shot.id, frames, ctxFrames: ctx,
      budgetFrames: generationFrameBudget(frames, ctx),
      continuityFromPrev: cont, prompt: fullPrompt, slots,
    };
  });

  return {
    format: 'minimax-h3-director-pack', formatVersion: 1, tier: args.tier,
    sharedSlots, segments,
    totalFrames: segments.reduce((sum, s) => sum + s.frames, 0),
    issues: validateRunSelection(args),
  };
}
