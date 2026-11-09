/**
 * workbench-ref-builder - 出片占位 clip 引用回填与提示词预填（Plan#71 T6）
 *
 * 背景：出片节点 resync 上游分镜时，上游分镜行（分镜 Shot）只携带
 * description/promptText/promptEn 与 @主体[-状态] 文本（无 imagePrompt/videoPrompt）。
 * 本模块在 buildMergedWorkbenchShots 合并时被调用，把分镜行的主体引用解析成
 * 出片占位 clip 的 references（带来源指纹 origin，供 T8UI 失效检测），
 * 并生成一段可编辑的提示词预填文本（用户可直接改）。
 *
 * 引用回填数据源（两级）：
 * 1. subjectTree（主体树，root/state 含媒体 key）—— 状态级图（受伤/幼年…）在此；
 * 2. StoryboardEntity.referenceImages —— 基础参考图兜底。
 * 两级都没有 media key → 仍生成一条「icon 占位引用卡」（无 storageKey），
 * 用户可点击上传/替换；DockReferencesSection 对无 url 项已渲染 icon+标题。
 *
 * 设计约束：
 * - 只生成引用/提示词，不触碰 clip 已有产物（completed / manualEdit / 已编辑文本永不覆盖）；
 * - origin.mediaKey 取实际引用图 key，供 detectStaleRefs 比对换代；
 * - 幂等：同一次 resync 重复调用生成相同指纹引用（id 每次新建，调用方负责去重合并）。
 */
import { baseStateNodeOf, type SubjectTree, type SubjectTreeNode } from './subject-tree-types';
import type { WorkbenchShotReference } from './workbench-types';
import { extractSubjectMentions } from './storyboard-utils';

/** 一次解析出的主体引用意图（name + 可选 state） */
export interface ResolvedMention {
  name: string;
  state?: string;
}

/** 解析分镜行的全部主体引用（shot.entities 的 mention + description 内 @主体-状态，去重） */
export function resolveShotMentions(
  entities: Array<Record<string, unknown> | string> | undefined,
  description: string,
): ResolvedMention[] {
  const out: ResolvedMention[] = [];
  const seen = new Set<string>();
  const push = (name: string, state?: string) => {
    const key = state ? `${name}::${state}` : name;
    if (!name.trim() || seen.has(key)) return;
    seen.add(key);
    out.push({ name: name.trim(), state });
  };
  for (const e of entities ?? []) {
    if (typeof e === 'string') {
      const m = /@?([\w\u4e00-\u9fa5]+)(?:-([\w\u4e00-\u9fa5]+))?/.exec(e);
      if (m?.[1]) push(m[1], m[2] || undefined);
      continue;
    }
    const mention = String(e?.mention ?? '');
    if (mention) {
      const m = /@?([\w\u4e00-\u9fa5]+)(?:-([\w\u4e00-\u9fa5]+))?/.exec(mention);
      if (m?.[1]) push(m[1], m[2] || undefined);
    }
  }
  for (const m of extractSubjectMentions(description ?? '')) push(m.name, m.state);
  return out;
}

/** 基础主体图兜底（宽松结构：兼容上游 node.data 的 Record<string, any>） */
export interface BaseEntityLike {
  name?: string;
  id?: string;
  /** 别名（aiSubjects/productionItems 用；buildRefsFromSource 兜底匹配时一并考虑） */
  aliases?: string[];
  referenceImages?: Array<{ storageKey?: string }>;
}

/** 引用来源上下文（buildMerged 时由上游分镜节点 data 提供） */
export interface SourceRefContext {
  subjectTrees?: SubjectTree[];
  /** 基础主体图兜底（StoryboardEntity.referenceImages） */
  baseEntities?: BaseEntityLike[];
}

/** 从分镜行主体引用生成占位 clip 的 references（含指纹） */
export function buildRefsFromSource(
  mentions: ResolvedMention[],
  ctx: SourceRefContext,
): WorkbenchShotReference[] {
  const trees = ctx.subjectTrees ?? [];
  const baseEntities = ctx.baseEntities ?? [];
  const refs: WorkbenchShotReference[] = [];

  const findTree = (name: string): SubjectTree | undefined =>
    trees.find(
      (t) => t.name === name || t.rootId === name || (t.aliases ?? []).includes(name),
    );

  const stateNodeMedia = (tree: SubjectTree, state: string): { key: string; type: 'image' | 'video' | 'audio'; node?: SubjectTreeNode } | null => {
    const node = (tree.states ?? []).find(
      (s) => s.state === state || s.id === state,
    );
    const media = node?.media?.[0];
    if (!media) return null;
    return { key: media.key, type: media.type, node };
  };

  for (const m of mentions) {
    const tree = findTree(m.name);
    // 1) subjectTree：基础形态图 / 状态级图
    if (tree) {
      if (m.state) {
        const hit = stateNodeMedia(tree, m.state);
        if (hit?.key) {
          refs.push({
            id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            kind: hit.type,
            title: `${m.name}-${m.state}`,
            storageKey: hit.key,
            origin: {
              kind: 'subject-state',
              rootId: tree.rootId,
              nodeId: hit.node?.id,
              state: m.state,
              mediaKey: hit.key,
            },
          });
          continue;
        }
        // 状态已建但无图 → icon 占位（保留指纹，未来图换代/生成后可检测）
        const node = (tree.states ?? []).find((s) => s.state === m.state || s.id === m.state);
        if (node) {
          refs.push({
            id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            kind: 'image',
            title: `${m.name}-${m.state}`,
            origin: {
              kind: 'subject-state',
              rootId: tree.rootId,
              nodeId: node.id,
              state: m.state,
            },
          });
          continue;
        }
        // 状态未登记 → 跳过（避免幽灵引用；后续 validateShots 会拦截）
        continue;
      }
      const baseMedia = (baseStateNodeOf(tree)?.media ?? [])[0];
      if (baseMedia) {
        refs.push({
          id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          kind: baseMedia.type,
          title: m.name,
          storageKey: baseMedia.key,
          origin: {
            kind: 'subject-base',
            rootId: tree.rootId,
            mediaKey: baseMedia.key,
          },
        });
        continue;
      }
      // 基础形态无图 → icon 占位（baseRef 仍可检测删除）
      refs.push({
        id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: 'image',
        title: m.name,
        origin: { kind: 'subject-base', rootId: tree.rootId },
      });
      continue;
    }
    // 2) StoryboardEntity.referenceImages / aiSubjects / productionItems 兜底（基础主体库图）
    // 2026-09-03 修复①：片段 @ 了多个主体时，不能只映射「有图」的那个。
    // 只要上游真实存在该主体（主体字典能按 name/id/aliases 匹配），就生成引用：
    // 有图用图；暂无图也生成 icon 占位（title=主体名，无 storageKey），
    // 用户在出片参考区可补传/替换，且 buildPromptPreview 的映射会列出全部主体。
    // 2026-09-03 修复②：部分场景主体在 aiSubjects，
    // 不在 data.entities/subjectTree —— 上游字典需由调用方并入 baseEntities 传入。
    const ent = baseEntities.find(
      (e) => e.name === m.name || e.id === m.name || (e.aliases ?? []).includes(m.name),
    );
    const img = ent?.referenceImages?.[0];
    if (ent) {
      refs.push({
        id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: 'image',
        title: m.name,
        ...(img?.storageKey ? { storageKey: img.storageKey } : {}),
        origin: { kind: 'subject-base', rootId: ent.id, ...(img?.storageKey ? { mediaKey: img.storageKey } : {}) },
      });
      continue;
    }
    // 其余情况：上游连该主体实体都不存在 → 不生成引用（避免幽灵引用误导）
  }
  return refs;
}

/**
 * 生成占位 clip 的提示词预填文本（可编辑，非只读）。
 * 组装 = 分镜行语义描述（description/promptText 优先）+ 参考素材映射行。
 * @图片N 与 buildRefsFromSource 产出的 refs 顺序一一对应（出片生成时 referenceImages 按此传参）。
 */
export function buildPromptPreview(
  shot: { description?: string; promptText?: string },
  refs: WorkbenchShotReference[],
): string {
  const semantic = shot.promptText?.trim() || shot.description?.trim() || '';
  if (!semantic && refs.length === 0) return '';
  const mapping =
    refs.length > 0
      ? `\n\n参考素材映射：\n${refs.map((r, i) => `图${i + 1}=@${r.title ?? `图${i + 1}`}`).join('\n')}`
      : '';
  return `${semantic}${mapping}`.trim();
}
