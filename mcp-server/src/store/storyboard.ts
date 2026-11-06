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

/**
 * 挂主体状态图：同 storageKey 已存在则原地更新（幂等），否则追加到 images[]。
 * cover=true 或主体此前无任何图 → coverKey = 该 storageKey。
 * 对齐前端 ProductionItem.images 元素（production-manager-types.ts L19-29：stateTag=状态名）。
 */
export async function setSubjectImage(
  root: string,
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
    },
  });
  return { ...res, subject };
}
