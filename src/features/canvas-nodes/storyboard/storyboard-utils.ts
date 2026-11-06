/**
 * storyboard-utils - 分镜工具函数
 *
 * 从 storyboard-sheet.tsx 中抽离的辅助函数。
 */
import type { Shot, StoryboardNodeData, StoryboardEntity, EntityRef, EntityKind, AiSubject } from './storyboard-types';
import type { ProductionItem } from '../production-manager/production-manager-types';
import { resolveSubjectCover } from '../production-manager/production-manager-types';
import type { SubjectTree } from './subject-tree-types';
import { resolveContentUrl } from '@zeroexo/plugin-nodes';

/**
 * 读取视频素材真实时长（秒）。
 * 拖入素材若无时长元数据（资产库 durationMs 缺失）时，先在 drop 侧解析真实时长再插入，
 * 保证「素材按原时长」而非被兜底值裁剪（2026-09-02 约定）。
 * 解析链与经验 #55 一致：storageKey → resolveContentUrl → <video> metadata。
 */
export async function resolveVideoDurationSec(storageKey: string): Promise<number | null> {
  let url = '';
  try {
    url = await resolveContentUrl(storageKey, '');
  } catch {
    return null;
  }
  if (!url) return null;
  return new Promise<number | null>((resolve) => {
    const vid = document.createElement('video');
    vid.muted = true;
    vid.playsInline = true;
    vid.preload = 'metadata';
    let settled = false;
    const done = (d: number | null): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      vid.removeAttribute('src');
      try { vid.load(); } catch { /* ignore */ }
      resolve(d);
    };
    const timer = window.setTimeout(() => done(null), 8000);
    vid.onloadedmetadata = () => {
      const d = vid.duration;
      done(Number.isFinite(d) && d > 0 ? d : null);
    };
    vid.onerror = () => done(null);
    vid.src = url;
  });
}

/** 创建新空 shot */
export function createNewShot(shots: Shot[]): Shot {
  const number = shots.length + 1;
  const id = `shot-${Date.now()}-${number}`;
  return {
    id,
    number,
    sceneId: `1-${number}`,
    dayNight: '日',
    duration: 5,
    description: '',
    shotType: '中景',
    cameraMovement: '固定',
    dialogue: '',
    voiceoverText: '',
    monologue: '',
    sfx: [],
    entities: [],
    emotion: '',
    lighting: { keyLight: '自然光', colorTemp: '5500K', mood: '平和' },
    environment: { location: '', time: '午后', weather: '晴' },
    continuity: { transition: 'cut' },
    prompt: '',
  };
}

/** 归一化更新:把传给 updater 的 prev.shots/status/progress 归一化为"当前集"视图 */
export function normalizeUpdate(
  data: StoryboardNodeData,
  activeEpisodeId: string,
  updater: (prev: StoryboardNodeData) => StoryboardNodeData,
): StoryboardNodeData {
  const shots = data.shotsByEpisode?.[activeEpisodeId] ?? (Object.keys(data.shotsByEpisode ?? {}).length > 0 ? [] : (data.shots ?? []));
  const status = data.statusByEpisode?.[activeEpisodeId] ?? (Object.keys(data.statusByEpisode ?? {}).length > 0 ? 'idle' : (data.status ?? 'idle'));
  const progress = data.progressByEpisode?.[activeEpisodeId] ?? data.progress ?? 0;
  const normalizedPrev: StoryboardNodeData = { ...data, shots, status, progress };
  const next = updater(normalizedPrev);
  const sbe = { ...(next.shotsByEpisode ?? {}), [activeEpisodeId]: next.shots };
  return { ...next, shotsByEpisode: sbe };
}

// ===== Plan#20 T2: 契约统一工具(后端字符串产出 / 旧数据对象双兼容) =====

/** 光影字符串化: string 直显 / 对象拼 mood·keyLight·colorTemp */
export function formatLighting(lighting: Shot['lighting'] | undefined | null): string {
  if (lighting == null) return '';
  if (typeof lighting === 'string') return lighting;
  return [lighting.mood, lighting.keyLight, lighting.colorTemp].filter(Boolean).join('，');
}

/** 环境字符串化: string 直显 / 对象拼 location·time·weather */
export function formatEnvironment(env: Shot['environment'] | undefined | null): string {
  if (env == null) return '';
  if (typeof env === 'string') return env;
  return [env.location, env.time, env.weather].filter(Boolean).join('，');
}

/** 实体展示名双兼容(EntityRef 取 mention / string 直显) */
export function entityDisplayName(e: EntityRef | string | undefined | null): string {
  if (e == null) return '';
  return typeof e === 'string' ? e : (e.mention ?? '');
}

/**
 * onDone 适配层(写入 node.data 前跑一遍):
 * - lighting/environment 异常形态(非 string 非对象)转字符串
 * - entities 归一为数组(容忍字符串/空)
 * - prompt 映射 promptText(后端分块契约无 prompt 字段)
 * - 新旧数据(含断点续跑复用旧子任务产出)一次适配
 */
export function normalizeShotForUi(raw: Record<string, any>): Shot {
  const shot = { ...raw } as Shot;
  if (shot.lighting != null && typeof shot.lighting !== 'string' && typeof shot.lighting !== 'object') {
    shot.lighting = String(shot.lighting);
  }
  if (shot.environment != null && typeof shot.environment !== 'string' && typeof shot.environment !== 'object') {
    shot.environment = String(shot.environment);
  }
  if (!Array.isArray(shot.entities)) {
    shot.entities = typeof shot.entities === 'string' && shot.entities ? [shot.entities] : [];
  }
  if (!shot.prompt && typeof (shot as any).promptText === 'string') {
    shot.prompt = (shot as any).promptText;
  }
  // 2026-08-20: 对白/旁白/音效字段默认值兜底(旧数据或缺字段时不致空列异常)
  if (typeof shot.dialogue !== 'string') shot.dialogue = shot.dialogue != null ? String(shot.dialogue) : '';
  if (typeof shot.voiceoverText !== 'string') shot.voiceoverText = shot.voiceoverText != null ? String(shot.voiceoverText) : '';
  if (typeof shot.monologue !== 'string') shot.monologue = shot.monologue != null ? String(shot.monologue) : '';
  if (!Array.isArray(shot.sfx)) {
    shot.sfx = typeof shot.sfx === 'string' && shot.sfx ? [shot.sfx] : [];
  }
  // 2026-08-20 T3: dayNight 默认值兜底(旧数据无此字段时空列不致异常)
  if (typeof shot.dayNight !== 'string') shot.dayNight = shot.dayNight != null ? String(shot.dayNight) : '';
  return shot;
}

// ===== 主体 kind 展示元数据(Plan#20 T3: 表格主体列/StepView 单一事实源, 图标对齐 StepView 体系) =====

/** 实体类型颜色标准(对齐 production-manager-types KIND_COLOR, 全站统一) */
export const ENTITY_KIND_META: Record<EntityKind, { emoji: string; color: string; labelKey: string }> = {
  character: { emoji: '\u{1F464}', color: '#22c55e', labelKey: 'entity.character' }, // 角色绿色
  scene: { emoji: '\u{1F4CD}', color: '#3b82f6', labelKey: 'entity.scene' },        // 场景蓝色
  prop: { emoji: '\u{1F4E6}', color: '#a855f7', labelKey: 'entity.prop' },           // 道具紫色
};

/**
 * 实体名 → kind 查找链(Plan#20 T3):
 * 1. entities(节点内主体列表, EntityRef.id 或名字匹配)
 * 2. aiSubjects(后端主体字典, 名字/别名匹配)
 * 均未命中返回 undefined(展示中性色)
 */
export function resolveEntityKind(
  name: string,
  entities: StoryboardEntity[],
  aiSubjects?: AiSubject[],
): EntityKind | undefined {
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  const ent = entities.find((e) => e.name === trimmed || e.id === trimmed);
  if (ent) return ent.kind;
  const subj = aiSubjects?.find((s) => s.name === trimmed || s.aliases.includes(trimmed));
  return subj?.kind;
}

// ===== 2026-08-30 征集 #110: 描述文本主体自动匹配 =====

/** 主体匹配源：entities ∪ aiSubjects ∪ 剧管 items（征集 #110：三者都匹配，entities 优先） */
export interface SubjectMatchSource {
  name: string;
  kind: EntityKind;
  id: string;
  aliases?: string[];
  /** 主体状态细分（@主体-状态 选择用，2026-08-31） */
  states?: Array<{ id: string; name: string }>;
  /** 选中时携带的状态名（popover 状态 chip 点击后追加，写入 `@主体-状态`） */
  state?: string;
  /** 2026-09-02 征集 #131: 生成缩略图 URL（已生成图片的主体显示缩略图） */
  thumbnailUrl?: string;
  /** 2026-09-02 征集 #131: 生成状态（占位/生成中/已生成） */
  generationStatus?: 'placeholder' | 'generating' | 'generated';
}

/**
 * 收集全部可匹配主体（subjectTrees 主体树 > entities > aiSubjects > productionItems 优先级去重）。
 * 供 @ 搜索面板、描述文本自动匹配、只读 mention chip（失效判定 + 改引候选）共用单一数据源。
 *
 * Plan#71 Spec §5.4：数据源并入 subjectTree —— 树内 root(name/aliases/kind) + states[state 名]，
 * 使 @主体-状态 的「状态是否存在」判定以主体树为准（状态删除 → chip 标红可改引）。
 */
export function collectSubjectSources(
  entities: StoryboardEntity[],
  aiSubjects?: AiSubject[],
  productionItems?: ProductionItem[],
  subjectTrees?: SubjectTree[],
): SubjectMatchSource[] {
  const out: SubjectMatchSource[] = [];
  const seen = new Set<string>();
  const push = (s: SubjectMatchSource) => {
    if (!s.name.trim() || seen.has(s.name)) return;
    seen.add(s.name);
    out.push(s);
  };
  // 主体树最高优先级：root = 主体名/id/kind，states = 状态节点（含 state 名）
  for (const t of subjectTrees ?? []) {
    const hasMedia = (t.states ?? []).some((n) => (n.media ?? []).length > 0) || (t.baseState?.referenceImages ?? []).length > 0;
    push({
      name: t.name,
      kind: t.kind as StoryboardEntity['kind'],
      id: t.rootId,
      aliases: t.aliases ?? [],
      states: (t.states ?? []).map((n) => ({ id: n.id, name: n.state })),
      generationStatus: hasMedia ? 'generated' : (t.states?.length ? 'placeholder' : 'placeholder'),
    });
  }
  for (const e of entities ?? []) {
    push({
      name: e.name,
      kind: e.kind,
      id: e.id,
      aliases: [],
      states: (e.states ?? []).map((s) => ({ id: s.id, name: s.name })),
    });
  }
  for (const s of aiSubjects ?? []) push({ name: s.name, kind: s.kind ?? 'character', id: `subj-${s.name}`, aliases: s.aliases ?? [] });
  for (const it of productionItems ?? []) {
    const hasImages = (it.images ?? []).length > 0;
    push({
      name: it.name,
      kind: it.kind,
      id: it.id,
      aliases: it.aliases ?? [],
      // 封面唯一解析入口（手动 coverKey → 第一个状态图 → 无）
      thumbnailUrl: resolveSubjectCover(it).key ?? undefined,
      generationStatus: hasImages ? 'generated' : 'placeholder',
    });
  }
  return out;
}

/**
 * 精确匹配：输入文本与主体名/别名完全相等时命中。
 * 用于 @ 面板搜索过滤与失焦自动匹配。
 */
export function matchSubjectByText(
  text: string,
  sources: SubjectMatchSource[],
): SubjectMatchSource | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const exact = sources.find((s) => s.name === trimmed);
  if (exact) return exact;
  return sources.find((s) => (s.aliases ?? []).includes(trimmed));
}

/** 描述文本中已用 @ 引用的主体名集合（扫描 @xxx 词，跳过不重复匹配） */
export function extractExplicitMentions(text: string): Set<string> {
  const set = new Set<string>();
  const re = /@([\w\u4e00-\u9fa5]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) != null) {
    if (m[1]) set.add(m[1]);
  }
  return set;
}

/**
 * 提取带状态的主体提及（2026-08-31 约定：@主体-状态 固定语法）
 *
 * 例：`@老张-常态` → { name: '老张', state: '常态' }
 *     `@古董店-被砸状态` → { name: '古董店', state: '被砸状态' }
 *     `@小刀` → { name: '小刀', state: undefined }
 * 规则：`@名字-状态`，名字/状态均为中文/字母/数字/下划线。
 */
export function extractSubjectMentions(text: string): Array<{ name: string; state?: string }> {
  const out: Array<{ name: string; state?: string }> = [];
  const re = /@([\w\u4e00-\u9fa5]+)(?:-([\w\u4e00-\u9fa5]+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) != null) {
    if (m[1]) out.push({ name: m[1], state: m[2] || undefined });
  }
  return out;
}

// ===== Plan#71 Spec §3：引用失效检测引擎（T8，纯函数） =====

/** 引用来源指纹（结构兼容 workbench-types.SubjectRefFingerprint，避免跨文件强依赖） */
export interface SubjectRefOriginLike {
  kind: 'subject-base' | 'subject-state' | 'color-card' | 'user-upload' | string;
  rootId?: string;
  nodeId?: string;
  state?: string;
  mediaKey?: string;
  updatedAt?: string;
}

export interface DetectStaleResult {
  refId: string;
  level: 'warn' | 'broken';
  reason: string;
}

/**
 * 失效规则矩阵（Spec §3.1）：
 * - user-upload：永不过期
 * - root 已删除 → broken
 * - 基础形态图换代（mediaKey 不在最新 referenceImages）→ warn（「用新图替换」）
 * - 状态占位已删 → broken（建议改引基础形态/其它状态）
 * - 状态占位图换代 → warn（「用新图替换」）
 * - 改名/别名/kind → 不失效（以 rootId/nodeId 关联）
 * 只检测不修改；修复动作（re-resolve/改引/移除）由 UI 显式触发。
 */
export function detectStaleRefs(input: {
  subjects: Array<{
    rootId: string;
    name: string;
    baseState?: { referenceImages?: Array<{ key?: string }> };
    states?: Array<{
      id: string;
      state?: string;
      media?: Array<{ key?: string }>;
    }>;
  }>;
  refs: Array<{ id: string; origin?: SubjectRefOriginLike | null }>;
}): DetectStaleResult[] {
  const results: DetectStaleResult[] = [];
  const { subjects, refs } = input;
  for (const ref of refs) {
    const o = ref.origin;
    if (!o || o.kind === 'user-upload' || o.kind === 'color-card') continue;
    const tree = o.rootId
      ? subjects.find((s) => s.rootId === o.rootId)
      : undefined;
    if (!tree) {
      results.push({ refId: ref.id, level: 'broken', reason: '主体已删除，引用失效' });
      continue;
    }
    if (o.kind === 'subject-base') {
      const still = (tree.baseState?.referenceImages ?? []).some((m) => m.key && m.key === o.mediaKey);
      if (!still) {
        results.push({ refId: ref.id, level: 'warn', reason: `基础形态图已更新/替换（${tree.name}），建议用新图替换` });
      }
      continue;
    }
    // subject-state
    const node = (tree.states ?? []).find((s) => s.id === o.nodeId);
    if (!node) {
      results.push({
        refId: ref.id,
        level: 'broken',
        reason: `状态「${o.state ?? o.nodeId ?? ''}」已删除或未登记（${tree.name}），建议改引基础形态/其它状态`,
      });
      continue;
    }
    const stillMedia = (node.media ?? []).some((m) => m.key && m.key === o.mediaKey);
    if (!stillMedia) {
      results.push({
        refId: ref.id,
        level: 'warn',
        reason: `状态「${node.state ?? node.id}」形象图已更换，建议用新图替换`,
      });
    }
  }
  return results;
}