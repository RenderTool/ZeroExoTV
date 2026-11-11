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

export type SubjectKind = "character" | "scene" | "prop";

export interface ProductionItem {
  id: string;
  name: string;
  kind: SubjectKind;
  aliases: string[];
  consistency?: string;
  note?: string;
  episodeIds: string[];
  images: { storageKey: string; label?: string }[];
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
