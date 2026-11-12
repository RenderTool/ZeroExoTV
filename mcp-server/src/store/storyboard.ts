/**
 * 主体库实体。Schema 对齐 src/entities/slot-containers.ts:22-33（StoryboardContainer）：
 * version, title:'主体库', shots[], entities[](ProductionItem), subjectTree?, updatedAt。
 * ProductionItem: {id:'item-…', name, kind:'character'|'scene'|'prop', aliases, consistency,
 *                  note, episodeIds, images, coverKey}。
 */

import crypto from "node:crypto";
import { McpError } from "../errors.js";
import { paths } from "../config.js";
import { readJsonIfExists, updateVersionedJson, type UpdateResult } from "./fs-node.js";

export type SubjectKind = "character" | "scene" | "prop" | "candidate";

export interface ProductionItem {
  id: string;
  name: string;
  kind: SubjectKind;
  aliases: string[];
  consistency?: string;
  note?: string;
  episodeIds: string[];
  images: { storageKey: string; stateTag?: string; prompt?: string; note?: string; tags?: string[]; label?: string }[];
  coverKey?: string | null;
}

export interface StoryboardContainer {
  schemaVersion: 1;
  version: number;
  updatedAt: string;
  title: string;
  shots: unknown[];
  entities: ProductionItem[];
  subjectTree?: unknown;
}

function emptyStoryboard(): Omit<StoryboardContainer, "version" | "updatedAt"> {
  return { schemaVersion: 1, title: "主体库", shots: [], entities: [] };
}

export async function readStoryboard(root: string, projectId: string): Promise<StoryboardContainer | null> {
  return readJsonIfExists<StoryboardContainer>(paths.storyboard(projectId, root));
}

export interface SubjectInput {
  id?: string;
  name: string;
  kind: SubjectKind;
  aliases?: string[];
  note?: string;
  episodeIds?: string[];
}

export async function upsertSubject(
  root: string,
  projectId: string,
  opts: { baseVersion: number; subject: SubjectInput; dryRun?: boolean },
): Promise<UpdateResult<StoryboardContainer> & { subject: ProductionItem; created: boolean }> {
  let subject!: ProductionItem;
  let created = false;
  const res = await updateVersionedJson<StoryboardContainer>(paths.storyboard(projectId, root), {
    baseVersion: opts.baseVersion,
    createIfMissing: () => emptyStoryboard(),
    dryRun: opts.dryRun,
    mutate: (s) => {
      const input = opts.subject;
      const existing = input.id ? s.entities.find((e) => e.id === input.id) : undefined;
      if (existing) {
        existing.name = input.name;
        existing.kind = input.kind;
        if (input.aliases) existing.aliases = input.aliases;
        if (input.note !== undefined) existing.note = input.note;
        if (input.episodeIds) existing.episodeIds = input.episodeIds;
        subject = existing;
      } else {
        created = true;
        subject = {
          id: input.id ?? `item-${crypto.randomBytes(6).toString("hex")}`,
          name: input.name,
          kind: input.kind,
          aliases: input.aliases ?? [],
          note: input.note,
          episodeIds: input.episodeIds ?? [],
          images: [],
          coverKey: null,
        };
        s.entities.push(subject);
      }
      // 主体与主体树必须成对存在：MCP 新建/更新后立刻补树，避免前端打开是空状态
      ensureTree(s, subject);
    },
  });
  return { ...res, subject, created };
}

/** 按名称/别名模糊匹配主体候选（link_subject_to_shot 的 matchByName 用）。 */
export function matchSubjectCandidates(storyboard: StoryboardContainer, name: string): ProductionItem[] {
  const q = name.toLowerCase();
  return storyboard.entities.filter(
    (e) => e.name.toLowerCase().includes(q) || e.aliases.some((a) => a.toLowerCase().includes(q)),
  );
}

export interface SubjectImageInput {
  subjectId: string;
  storageKey: string;
  stateTag?: string;
  prompt?: string;
  note?: string;
  tags?: string[];
  /** true = 设为该主体封面（coverKey） */
  cover?: boolean;
}

/** 主体树里的状态节点（MCP 只写必要字段，其余交给前端迁移/补全） */
interface TreeStateLike {
  id: string;
  state: string;
  type: string;
  step?: number;
  deriveFrom?: unknown;
  deltaPrompt?: string;
  fullPrompt?: string;
  recognitionTerms?: string[];
  media: Array<{ key: string; type: string; prompt?: string }>;
  source?: string;
  baseRef?: string;
  appearEpisodes?: number[];
}

interface TreeLike {
  rootId: string;
  itemId?: string | null;
  name: string;
  kind: SubjectKind;
  aliases: string[];
  states: TreeStateLike[];
  coverKey?: string | null;
}

function ensureTree(s: StoryboardContainer, item: ProductionItem): TreeLike {
  const trees = (Array.isArray(s.subjectTree) ? s.subjectTree : []) as TreeLike[];
  let tree = trees.find((t) => t.itemId === item.id);
  if (!tree) {
    // 兼容按名字绑定的老树（无 itemId）：不抢改，仅当名字唯一命中时接管
    const byName = trees.filter((t) => !t.itemId && t.name === item.name);
    if (byName.length === 1) {
      tree = byName[0];
      tree.itemId = item.id;
    }
  }
  if (!tree) {
    tree = {
      rootId: `subj-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      itemId: item.id,
      name: item.name,
      kind: item.kind,
      aliases: item.aliases ?? [],
      states: [],
      coverKey: null,
    };
    trees.push(tree);
  }
  if (!Array.isArray(tree.states)) tree.states = [];
  if (tree.states.length === 0) {
    tree.states.push({
      id: "__base__",
      state: "",
      type: "image",
      step: 1,
      deriveFrom: null,
      deltaPrompt: "",
      fullPrompt: "",
      recognitionTerms: [],
      media: [],
      source: "user",
      baseRef: tree.rootId,
      appearEpisodes: [],
    });
  }
  s.subjectTree = trees;
  return tree;
}

/** 状态图落到主体树：base/定妆 → states[0]；其它 stateTag → 对应状态（不存在则新建） */
function applyImageToTree(tree: TreeLike, input: SubjectImageInput): void {
  const base = tree.states[0];
  const tag = (input.stateTag ?? "").trim();
  if (!tag || tag === "定妆" || tag === "基础状态" || tag === "基础形态") {
    base.media = [{ key: input.storageKey, type: "image", prompt: input.prompt }];
    if (input.prompt) base.fullPrompt = input.prompt;
    if (!base.state) base.state = tag === "定妆" ? "" : base.state;
    return;
  }
  let state = tree.states.find((x) => x.state === tag);
  if (!state) {
    state = {
      id: `snode-${tree.rootId}-${tree.states.length}`,
      state: tag,
      type: "image",
      step: 1,
      deriveFrom: null,
      deltaPrompt: base.fullPrompt ? "" : "",
      fullPrompt: input.prompt ?? "",
      recognitionTerms: [],
      media: [],
      source: "user",
      baseRef: tree.rootId,
      appearEpisodes: [],
    };
    tree.states.push(state);
  }
  state.media = [{ key: input.storageKey, type: "image", prompt: input.prompt }];
  if (input.prompt) state.fullPrompt = input.prompt;
}

/**
 * 挂主体状态图：同 storageKey 已存在则原地更新（幂等），否则追加到 images[]。
 * cover=true 或主体此前无任何图 → coverKey = 该 storageKey。
 * 同时写 subjectTree（2026-11-12 修复：只挂封面时基础状态仍显示「暂无封面」）：
 * - 定妆/无 stateTag → 基础状态 states[0] 的 media；
 * - 其它 stateTag → 对应状态节点（不存在则创建），前端主体页按状态展示。
 */
export async function setSubjectImage(  root: string,
  projectId: string,
  opts: { baseVersion: number; image: SubjectImageInput; dryRun?: boolean },
): Promise<UpdateResult<StoryboardContainer> & { subject: ProductionItem }> {
  let subject!: ProductionItem;
  const res = await updateVersionedJson<StoryboardContainer>(paths.storyboard(projectId, root), {
    baseVersion: opts.baseVersion,
    createIfMissing: () => emptyStoryboard(),
    dryRun: opts.dryRun,
    mutate: (s) => {
      const found = s.entities.find((e) => e.id === opts.image.subjectId);
      if (!found) throw new McpError("NOT_FOUND", `主体不存在: ${opts.image.subjectId}`, { subjectId: opts.image.subjectId });
      subject = found;
      const input = opts.image;
      const existing = subject.images.find((i) => i.storageKey === input.storageKey);
      const entry = {
        storageKey: input.storageKey,
        stateTag: input.stateTag,
        prompt: input.prompt,
        note: input.note,
        tags: input.tags,
      };
      if (existing) {
        Object.assign(existing, entry);
      } else {
        subject.images.push(entry);
      }
      if (input.cover || !subject.coverKey) subject.coverKey = input.storageKey;
      const tree = ensureTree(s, subject);
      applyImageToTree(tree, input);
      if (input.cover || !tree.coverKey) tree.coverKey = input.storageKey;
    },
  });
  return { ...res, subject };
}

/**
 * 删除主体（连同主体树）。2026-11-12：MCP 之前没有删除工具，弱模型只能让用户去前端删。
 * 画布/导演台里对该主体的引用不在这里级联（避免误删片段），由调用方决定是否再清理。
 */
export async function deleteSubject(
  root: string,
  projectId: string,
  opts: { baseVersion: number; subjectId: string; dryRun?: boolean },
): Promise<UpdateResult<StoryboardContainer> & { deleted: boolean; subject?: ProductionItem }> {
  let deleted: ProductionItem | undefined;
  const res = await updateVersionedJson<StoryboardContainer>(paths.storyboard(projectId, root), {
    baseVersion: opts.baseVersion,
    dryRun: opts.dryRun,
    mutate: (s) => {
      const idx = s.entities.findIndex((e) => e.id === opts.subjectId);
      if (idx < 0) throw new McpError("NOT_FOUND", `主体不存在: ${opts.subjectId}`, { subjectId: opts.subjectId });
      deleted = s.entities[idx];
      s.entities.splice(idx, 1);
      if (Array.isArray(s.subjectTree)) {
        s.subjectTree = (s.subjectTree as TreeLike[]).filter((t) => t.itemId !== opts.subjectId);
      }
    },
  });
  return { ...res, deleted: Boolean(deleted), subject: deleted };
}

/** 删除主体的一张状态图（同时删树里对应状态/基础状态的 media；状态空了且非基础状态则移除该状态） */
export async function deleteSubjectImage(
  root: string,
  projectId: string,
  opts: { baseVersion: number; subjectId: string; storageKey: string; dryRun?: boolean },
): Promise<UpdateResult<StoryboardContainer> & { deleted: boolean; subject?: ProductionItem }> {
  let deleted = false;
  let subject: ProductionItem | undefined;
  const res = await updateVersionedJson<StoryboardContainer>(paths.storyboard(projectId, root), {
    baseVersion: opts.baseVersion,
    dryRun: opts.dryRun,
    mutate: (s) => {
      subject = s.entities.find((e) => e.id === opts.subjectId);
      if (!subject) throw new McpError("NOT_FOUND", `主体不存在: ${opts.subjectId}`, { subjectId: opts.subjectId });
      const before = subject.images.length;
      subject.images = subject.images.filter((i) => i.storageKey !== opts.storageKey);
      deleted = subject.images.length !== before;
      if (subject.coverKey === opts.storageKey) {
        subject.coverKey = subject.images[0]?.storageKey ?? null;
      }
      if (Array.isArray(s.subjectTree)) {
        const trees = s.subjectTree as TreeLike[];
        const tree = trees.find((t) => t.itemId === opts.subjectId);
        if (tree) {
          tree.states = tree.states.filter((st) => {
            const had = st.media.some((m) => m.key === opts.storageKey);
            if (!had) return true;
            st.media = st.media.filter((m) => m.key !== opts.storageKey);
            return st.id === "__base__" || st.media.length > 0;
          });
          if (tree.coverKey === opts.storageKey) tree.coverKey = tree.states[0]?.media[0]?.key ?? null;
        }
      }
    },
  });
  return { ...res, deleted, subject };
}

/**
 * 合并两个主体（把重复主体并回本体）：图片/别名/集数并入 target，source 树的状态并入 target 树，然后删除 source。
 * 状态同名时保留 target 的，source 的图挂到 target 同名状态 media 里（去重）。
 */
export async function mergeSubjects(
  root: string,
  projectId: string,
  opts: { baseVersion: number; sourceId: string; targetId: string; dryRun?: boolean },
): Promise<UpdateResult<StoryboardContainer> & { merged: boolean; movedImages: number; movedStates: number }> {
  let movedImages = 0;
  let movedStates = 0;
  const res = await updateVersionedJson<StoryboardContainer>(paths.storyboard(projectId, root), {
    baseVersion: opts.baseVersion,
    dryRun: opts.dryRun,
    mutate: (s) => {
      if (opts.sourceId === opts.targetId) throw new McpError("VALIDATION", "sourceId 与 targetId 不能相同");
      const source = s.entities.find((e) => e.id === opts.sourceId);
      const target = s.entities.find((e) => e.id === opts.targetId);
      if (!source || !target) throw new McpError("NOT_FOUND", "source 或 target 主体不存在", { sourceId: opts.sourceId, targetId: opts.targetId });
      if (source.kind !== target.kind) throw new McpError("VALIDATION", "只能合并同类型主体（角色↔角色 / 场景↔场景 / 道具↔道具）");
      const keys = new Set(target.images.map((i) => i.storageKey));
      for (const img of source.images) {
        if (!keys.has(img.storageKey)) {
          target.images.push(img);
          keys.add(img.storageKey);
          movedImages += 1;
        }
      }
      target.aliases = Array.from(new Set([...(target.aliases ?? []), source.name, ...(source.aliases ?? [])])).filter(
        (a) => a !== target.name && !a.includes('⚠️') && !a.includes('可前端删'),
      );
      target.episodeIds = Array.from(new Set([...(target.episodeIds ?? []), ...(source.episodeIds ?? [])]));
      if (!target.coverKey) target.coverKey = source.coverKey ?? target.images[0]?.storageKey ?? null;

      if (Array.isArray(s.subjectTree)) {
        const trees = s.subjectTree as TreeLike[];
        const sourceTree = trees.find((t) => t.itemId === opts.sourceId);
        const targetTree = ensureTree(s, target);
        if (sourceTree) {
          for (const st of sourceTree.states) {
            if (st.id === "__base__") {
              if (targetTree.states[0].media.length === 0 && st.media.length > 0) {
                targetTree.states[0].media = st.media;
              } else {
                for (const m of st.media) {
                  if (!targetTree.states[0].media.some((x) => x.key === m.key)) targetTree.states[0].media.push(m);
                }
              }
              if (!targetTree.states[0].fullPrompt && st.fullPrompt) targetTree.states[0].fullPrompt = st.fullPrompt;
              continue;
            }
            const exists = targetTree.states.find((x) => x.state === st.state);
            if (exists) {
              for (const m of st.media) {
                if (!exists.media.some((x) => x.key === m.key)) exists.media.push(m);
              }
            } else {
              targetTree.states.push({ ...st, id: `snode-${targetTree.rootId}-${targetTree.states.length}`, baseRef: targetTree.rootId });
              movedStates += 1;
            }
          }
          s.subjectTree = trees.filter((t) => t.itemId !== opts.sourceId);
        }
      }
      s.entities = s.entities.filter((e) => e.id !== opts.sourceId);
    },
  });
  return { ...res, merged: res.written !== false, movedImages, movedStates };
}

// ===== 主体库自检与修复（2026-11-12：MCP 写入只改实体不建树导致「有图但页面没图」） =====

const BASE_STATE_TAGS = new Set(["", "定妆", "基础状态", "基础形态", "基础", "定妆照"]);

function normalizeStateTag(tag: unknown): string {
  return String(tag ?? "").trim();
}

/** 把 entity.images 按 stateTag 映射进树：基础图 → states[0]；其它 tag → 对应状态（不存在则建） */
function assignImagesToTree(
  tree: TreeLike,
  images: ProductionItem["images"],
  coverKey?: string | null,
): { mediaFixed: number; statesCreated: number; baseFilled: boolean } {
  let mediaFixed = 0;
  let statesCreated = 0;
  const base = tree.states[0];
  const groups = new Map<string, ProductionItem["images"]>();
  for (const img of images) {
    const tag = normalizeStateTag(img.stateTag);
    const key = BASE_STATE_TAGS.has(tag) || (coverKey && img.storageKey === coverKey) ? "__base__" : tag || "__base__";
    const list = groups.get(key) ?? [];
    list.push(img);
    groups.set(key, list);
  }
  const baseImgs = groups.get("__base__") ?? [];
  if (baseImgs.length > 0) {
    const next = baseImgs.map((i) => ({ key: i.storageKey, type: "image", prompt: i.prompt }));
    if (JSON.stringify(base.media ?? []) !== JSON.stringify(next)) mediaFixed += 1;
    base.media = next;
  }
  for (const [tag, imgs] of groups) {
    if (tag === "__base__") continue;
    let state = tree.states.find((x) => normalizeStateTag(x.state) === tag);
    if (!state) {
      state = {
        id: `snode-${tree.rootId}-${tree.states.length}`,
        state: tag,
        type: "image",
        step: 1,
        deriveFrom: null,
        deltaPrompt: "",
        fullPrompt: "",
        recognitionTerms: [],
        media: [],
        source: "user",
        baseRef: tree.rootId,
        appearEpisodes: [],
      };
      tree.states.push(state);
      statesCreated += 1;
    }
    const next = imgs.map((i) => ({ key: i.storageKey, type: "image", prompt: i.prompt }));
    if (JSON.stringify(state.media ?? []) !== JSON.stringify(next)) mediaFixed += 1;
    state.media = next;
  }
  return { mediaFixed, statesCreated, baseFilled: base.media.length > 0 };
}

export interface SubjectAuditIssue {
  subjectId: string;
  name: string;
  kind: SubjectKind;
  issue: "missing_tree" | "images_not_in_tree" | "base_state_empty" | "no_image" | "duplicate_name";
  detail: string;
}

export interface SubjectAudit {
  version: number;
  entities: number;
  trees: number;
  counts: { missingTree: number; imagesNotInTree: number; baseStateEmpty: number; noImage: number; duplicateName: number };
  issues: SubjectAuditIssue[];
}

/** 只读自检：主体 ↔ 树 ↔ 图片是否一一对应（写主体后建议先跑它） */
export async function auditSubjects(root: string, projectId: string): Promise<SubjectAudit> {
  const s = await readStoryboard(root, projectId);
  const empty: SubjectAudit = {
    version: 0,
    entities: 0,
    trees: 0,
    counts: { missingTree: 0, imagesNotInTree: 0, baseStateEmpty: 0, noImage: 0, duplicateName: 0 },
    issues: [],
  };
  if (!s) return empty;
  const trees = (Array.isArray(s.subjectTree) ? s.subjectTree : []) as TreeLike[];
  const byTree = new Map(trees.map((t) => [t.itemId, t]));
  const issues: SubjectAuditIssue[] = [];
  const seen = new Map<string, string>();
  for (const e of s.entities) {
    const tree = byTree.get(e.id);
    if (!tree) {
      issues.push({ subjectId: e.id, name: e.name, kind: e.kind, issue: "missing_tree", detail: "没有主体树" });
      empty.counts.missingTree += 1;
    } else {
      const keys = new Set(tree.states.flatMap((st) => (st.media ?? []).map((m) => m.key)));
      const missing = e.images.filter((i) => !keys.has(i.storageKey));
      if (missing.length > 0) {
        issues.push({
          subjectId: e.id, name: e.name, kind: e.kind, issue: "images_not_in_tree",
          detail: `${missing.length} 张图不在任何状态里（页面不显示）`,
        });
        empty.counts.imagesNotInTree += 1;
      }
      if (e.images.length > 0 && (tree.states[0]?.media ?? []).length === 0) {
        issues.push({ subjectId: e.id, name: e.name, kind: e.kind, issue: "base_state_empty", detail: "基础状态没有图" });
        empty.counts.baseStateEmpty += 1;
      }
    }
    if (e.images.length === 0) {
      issues.push({ subjectId: e.id, name: e.name, kind: e.kind, issue: "no_image", detail: "主体没有任何图" });
      empty.counts.noImage += 1;
    }
    const norm = e.name.replace(/[（(][^）)]*[）)]/g, "").replace(/\s+/g, "").toLowerCase();
    const prev = seen.get(`${norm}|${e.kind}`);
    if (prev) {
      issues.push({ subjectId: e.id, name: e.name, kind: e.kind, issue: "duplicate_name", detail: `与 ${prev} 同名` });
      empty.counts.duplicateName += 1;
    } else {
      seen.set(`${norm}|${e.kind}`, e.name);
    }
  }
  return { version: s.version, entities: s.entities.length, trees: trees.length, counts: empty.counts, issues };
}

/** 修复：补齐缺失的树、把图片映射进状态（幂等）。不删数据，不动已有提示词。 */
export async function repairSubjectTrees(
  root: string,
  projectId: string,
  opts: { baseVersion: number; dryRun?: boolean },
): Promise<UpdateResult<StoryboardContainer> & { mediaFixed: number; statesCreated: number; treesCreated: number }> {
  let mediaFixed = 0;
  let statesCreated = 0;
  let treesCreated = 0;
  const res = await updateVersionedJson<StoryboardContainer>(paths.storyboard(projectId, root), {
    baseVersion: opts.baseVersion,
    dryRun: opts.dryRun,
    mutate: (s) => {
      const before = (Array.isArray(s.subjectTree) ? s.subjectTree : []).length as number;
      for (const e of s.entities) {
        const existed = ((Array.isArray(s.subjectTree) ? s.subjectTree : []) as TreeLike[]).some((t) => t.itemId === e.id);
        const tree = ensureTree(s, e);
        if (!existed) treesCreated += 1;
        const r = assignImagesToTree(tree, e.images ?? [], e.coverKey);
        mediaFixed += r.mediaFixed;
        statesCreated += r.statesCreated;
        if (!e.coverKey && e.images?.[0]) e.coverKey = e.images[0].storageKey;
        tree.coverKey = e.coverKey ?? tree.states[0]?.media?.[0]?.key ?? null;
      }
      if (before === 0) {
        // 保证 subjectTree 落到容器里（ensureTree 已写，但空数组情况再兜底）
        s.subjectTree = s.subjectTree ?? [];
      }
    },
  });
  return { ...res, mediaFixed, statesCreated, treesCreated };
}

// ===== 集数同步（2026-11-12：episodeIds 只写实体，树里的 appearEpisodes 一直是空 → 页面全显示「全部」） =====

function stripHtmlText(html: string): string {
  return String(html ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, "");
}

/**
 * 把主体的集数关联同步到树：entity.episodeIds ↔ states[0].appearEpisodes（编号）。
 * entity 为空时按名字/别名在剧本里重新匹配（只补空，不覆盖已有绑定）。
 */
export async function syncSubjectEpisodes(
  root: string,
  projectId: string,
  opts: { baseVersion: number; subjectId?: string; dryRun?: boolean },
): Promise<UpdateResult<StoryboardContainer> & { synced: number; appeared: number }> {
  const script = await readScriptSafe(root, projectId);
  const episodes = script?.episodes ?? [];
  const byId = new Map(episodes.map((e) => [e.id, e.number]));
  const byNumber = new Map(episodes.map((e) => [e.number, e.id]));
  let synced = 0;
  let appeared = 0;
  const res = await updateVersionedJson<StoryboardContainer>(paths.storyboard(projectId, root), {
    baseVersion: opts.baseVersion,
    dryRun: opts.dryRun,
    mutate: (s) => {
      for (const e of s.entities) {
        if (opts.subjectId && e.id !== opts.subjectId) continue;
        let numbers = e.episodeIds.map((id) => byId.get(id)).filter((n): n is number => typeof n === "number");
        if (episodes.length > 0) {
          // 场景名常用「大地名·小地点」（云顶大厦·保安部）：拆分后按小地点再匹配一次，
          // 否则场景永远关联不上集数（2026-11-12 用户反馈：道具/场景也没关联）。
          const nameParts = e.kind === "scene"
            ? e.name.split(/[·・]/).map((s) => s.trim()).filter((s) => s.length >= 2)
            // 道具名常带修饰（天山寒铁匕首 / 十亿钻戒）：取 2~4 字尾词兜底匹配
            : e.kind === "prop"
              ? [2, 3, 4].map((n) => e.name.slice(-n)).filter((s) => s.length >= 2 && !/[的与和]$/.test(s))
              : [];
          const needles = Array.from(new Set([e.name, ...(e.aliases ?? []), ...nameParts]))
            .map((n) => stripHtmlText(n))
            .filter((n) => n.length >= 2 && !n.includes("⚠️"));
          const mentioned = episodes
            .filter((ep) => {
              const text = stripHtmlText(ep.content ?? "");
              return needles.some((n) => text.includes(n));
            })
            .map((ep) => ep.number);
          // 2026-11-12：以剧本实际出现为准重算（旧绑定是半套自动生成的，会漏集）
          if (mentioned.length > 0) numbers = mentioned;
          if (numbers.length > 0) {
            e.episodeIds = numbers.map((n) => byNumber.get(n)).filter((id): id is string => Boolean(id));
          }
        }
        const tree = ensureTree(s, e);
        const before = JSON.stringify(tree.states[0]?.appearEpisodes ?? []);
        tree.states[0].appearEpisodes = [...numbers].sort((a, b) => a - b);
        if (before !== JSON.stringify(tree.states[0].appearEpisodes)) synced += 1;
        if (numbers.length > 0) appeared += 1;
      }
    },
  });
  return { ...res, synced, appeared };
}

async function readScriptSafe(root: string, projectId: string): Promise<{ episodes: Array<{ id: string; number: number; content?: string }> } | null> {
  try {
    const mod = await import("./script.js");
    return (await mod.readScript(root, projectId)) as { episodes: Array<{ id: string; number: number; content?: string }> } | null;
  } catch {
    return null;
  }
}
