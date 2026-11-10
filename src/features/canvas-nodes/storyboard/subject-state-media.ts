/**
 * subject-state-media - 「资产 → 主体状态」媒体关联唯一写入层（2026-11-04 约定）
 *
 * 铁律（收口到一个函数，两个入口都调它，不要各写一套）：
 * - 画布右键「发送到主体」（subject-link-dialog）
 * - 主体库状态卡占位/替换/重新关联（StoryboardSubjectTree + subject-media-source-panel）
 *
 * 规则：
 * - 只存 CAS 资产引用（registerCasRef，refCount++），**不复制文件**；
 * - kind=image 落到「形象/分镜图」，kind=audio 落到「音色参考」；
 * - 替换或移除时正确释放旧引用（releaseCas，refCount--）；
 * - 同 key 重复关联不重复记账（CasEntry.refCount 与 refs 必须一致）。
 *
 * 持久化由调用方各自的既有写链路完成：
 * - 主体库内（树组件）：返回新 trees → onChange → 父级 applyPatch → updateStoryboardContainer；
 * - 画布右键弹层：直接读容器 → 本函数 → updateStoryboardContainer。
 */
import { create } from 'zustand';
import {
  type SubjectTree,
  type SubjectTreeNode,
  type SubjectNodeMediaRef,
  type SubjectMediaOrigin,
} from './subject-tree-types';
import { SUBJECT_BASE_STATE_ID } from './subject-page-nav';
import {
  parseCasStorageKey,
  registerCasRef,
  releaseCas,
} from '@/entities/cas-store.js';

/**
 * 状态媒体类型（image=形象/分镜图；audio=音色参考）。
 * video 仅用于「撤销恢复」历史引用（视频已不再支持新关联，UI 入口只提供 image/audio）。
 */
export type SubjectStateMediaKind = 'image' | 'audio' | 'video';

export interface SubjectStateMediaAsset {
  storageKey: string;
  kind: SubjectStateMediaKind;
  /** 引用来源（双向可见 + 失效提示）；本地上传可省略 */
  origin?: SubjectMediaOrigin;
}

/** CAS 记账用的稳定 ref 身份：同一状态同一槽位 */
function casRef(rootId: string, stateId: string, projectId: string, kind: string) {
  return { assetId: `subject-state:${rootId}/${stateId}`, projectId, kind };
}

export interface LinkSubjectStateMediaParams {
  /** 当前主体树全集（调用方内存态或容器读出） */
  trees: SubjectTree[];
  /** CAS 记账 projectId；缺省跳过记账（历史/测试数据兼容） */
  projectId?: string;
  rootId: string;
  stateId: string;
  /** 新资产；null = 移除（回到占位） */
  asset: SubjectStateMediaAsset | null;
}

export interface LinkSubjectStateMediaResult {
  trees: SubjectTree[];
  /** 被替换/移除的旧首媒体（供「撤销」恢复） */
  replaced: SubjectNodeMediaRef | null;
}

/**
 * 唯一写入函数：把资产关联到某主体状态（首槽替换语义，与主体库内上传一致）。
 * 纯数据变换 + CAS 记账，不落盘；调用方负责持久化（onChange / updateStoryboardContainer）。
 * 找不到目标树/状态 → throw（调用方给错误提示，不静默失败）。
 *
 * 2026-11-08 数据层统一：基础状态已是 states[0] 真节点（id = SUBJECT_BASE_STATE_ID），
 * 所有状态走同一条 states[].media[0] 写入路径，不再有 baseState.referenceImages 分叉。
 */
export async function linkSubjectStateMedia(params: LinkSubjectStateMediaParams): Promise<LinkSubjectStateMediaResult> {
  const { trees, projectId, rootId, stateId, asset } = params;
  // 先定位目标（找不到 → throw，不静默失败）
  const tree = trees.find((tr) => tr.rootId === rootId);
  const targetState = (tree?.states ?? []).find((n) => n.id === stateId);
  if (!tree || !targetState) {
    throw new Error(`[subject-state-media] target state not found: ${rootId}/${stateId}`);
  }
  // 旧首槽（记账基准；与 replaced 分离：同 key 重挂时 replaced=null 但旧槽仍在，
  // 必须据此跳过重复 register，否则 refCount 会重复 ++）
  const oldSlot: SubjectNodeMediaRef | null = (Array.isArray(targetState.media) ? targetState.media[0] : undefined) ?? null;
  let replaced: SubjectNodeMediaRef | null = null;
  if (oldSlot && oldSlot.key && (!asset || oldSlot.key !== asset.storageKey)) replaced = oldSlot;
  const next = trees.map((tr) => {
    if (tr.rootId !== rootId) return tr;
    const states = tr.states.map((n) => {
      if (n.id !== stateId) return n;
      const media = Array.isArray(n.media) ? n.media : [];
      const nextMedia: SubjectNodeMediaRef[] = asset
        ? [{ key: asset.storageKey, type: asset.kind, origin: asset.origin }, ...media.slice(1)]
        : [];
      // 被替换/清空的首槽进入历史：文件保留，用户可随时恢复；最多 20 条
      const history = Array.isArray(n.mediaHistory) ? n.mediaHistory : [];
      const nextHistory = replaced && replaced.key
        ? [replaced, ...history.filter((m) => m.key !== replaced.key)].slice(0, 20)
        : history;
      const node: SubjectTreeNode = asset
        ? { ...n, type: asset.kind, media: nextMedia, mediaHistory: nextHistory }
        : { ...n, media: [], mediaHistory: nextHistory };
      return node;
    });
    // 当前状态媒体正好是主体封面 → 封面跟随替换/清空，不再停留在旧 key
    const coverFollows = Boolean(tr.coverKey && oldSlot?.key && tr.coverKey === oldSlot.key);
    return {
      ...tr,
      states,
      coverKey: coverFollows ? (asset?.storageKey ?? null) : tr.coverKey,
    };
  });
  // ===== CAS 记账（只在有 projectId 且 key 是 CAS 格式时）=====
  if (projectId) {
    const newParsed = asset ? parseCasStorageKey(asset.storageKey) : null;
    const oldParsed = oldSlot && oldSlot.key ? parseCasStorageKey(oldSlot.key) : null;
    if (newParsed && (!oldParsed || newParsed.hash !== oldParsed.hash)) {
      try {
        await registerCasRef(newParsed.hash, casRef(rootId, stateId, projectId, asset!.kind));
      } catch {
        // 引用条目不存在（资产已被 GC）：仍保留树内引用，主体侧由存活探测显示「引用已失效」
      }
    }
    // 旧引用不释放：它已进入 mediaHistory，仍需保活；删除状态时统一释放
  }
  return { trees: next, replaced };
}

// ===== 引用可见性（双向可见）=====

/**
 * 删除状态 / 主体树前释放其全部媒体 CAS 引用（refCount--，归零自动删文件）。
 * 场景：主体内手动上传的文件只挂在 subject-state ref 上（不入 asset-store），
 * 若删除时不释放，会留孤儿文件。fire-and-forget，失败不阻塞删除（索引幂等）。
 */
export async function releaseSubjectStateMediaRefs(params: {
  trees: SubjectTree[];
  projectId?: string;
  /** 只释放该主体树；缺省 = 全部树 */
  rootId?: string;
  /** 只释放该状态；缺省 = 该树全部状态 + 基础状态；SUBJECT_BASE_STATE_ID = 只释放基础状态 */
  stateId?: string;
}): Promise<void> {
  const { trees, projectId, rootId, stateId } = params;
  if (!projectId) return; // 无 projectId 时 CAS 无记账，无需释放
  const releaseOne = async (rid: string, sid: string, m: SubjectNodeMediaRef | undefined): Promise<void> => {
    const parsed = m?.key ? parseCasStorageKey(m.key) : null;
    if (!parsed) return;
    try {
      await releaseCas(parsed.hash, casRef(rid, sid, projectId, m!.type));
    } catch {
      // 引用本就不在索引里（历史数据）：无事可释放
    }
  };
  for (const tr of trees ?? []) {
    if (rootId && tr.rootId !== rootId) continue;
    // 基础状态已在 states[0]，与其余状态同一循环（id 仍是 __base__，CAS 记账不变）
    for (const n of tr.states ?? []) {
      if (stateId && n.id !== stateId) continue;
      const all = [...(n.media ?? []), ...(n.mediaHistory ?? [])];
      for (const m of all) await releaseOne(tr.rootId, n.id, m);
    }
  }
}

export interface SubjectMediaUsage {
  rootId: string;
  treeName: string;
  stateId: string;
  stateName: string;
  kind: string;
}

/** 查询某 storageKey 被哪些主体状态引用（画布资产侧「被 主体X · 状态Y 使用」；含基础状态槽位） */
export function findSubjectMediaUsage(trees: SubjectTree[], storageKey: string): SubjectMediaUsage[] {
  if (!storageKey) return [];
  const out: SubjectMediaUsage[] = [];
  for (const tr of trees ?? []) {
    for (const n of tr.states ?? []) {
      for (const m of n.media ?? []) {
        if (m && m.key === storageKey) {
          const isBase = n.id === SUBJECT_BASE_STATE_ID;
          out.push({
            rootId: tr.rootId,
            treeName: tr.name,
            stateId: n.id,
            stateName: n.state || (isBase ? '基础状态' : `#${n.step ?? '?'}`),
            kind: m.type,
          });
        }
      }
    }
  }
  return out;
}

// ===== 外部写入事件（画布右键弹层直写容器后，通知已打开的主体库详情刷新本地树）=====

interface SubjectMediaLinkEventState {
  version: number;
  last: { rootId: string; stateId: string } | null;
  /** 写入完成后调用：SubjectDetailView 订阅并重读容器刷新本地树 */
  emit: (e: { rootId: string; stateId: string }) => void;
}

export const useSubjectMediaLinkEventStore = create<SubjectMediaLinkEventState>((set) => ({
  version: 0,
  last: null,
  emit: (e) => set((s) => ({ version: s.version + 1, last: e })),
}));
