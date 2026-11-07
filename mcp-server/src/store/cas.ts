/**
 * CAS 资产存储。对齐 src/entities/cas-store.ts：
 * - 物理：media/cas/<sha256>.<ext>
 * - 索引：entities/cas_index.json {schemaVersion:1, entries:{hash:{path,size,mime,ext,refCount,createdAt,refs[]}}}
 * - 不变量：条目存在 ⇔ 文件存在；refCount = refs.length；storageKey = 'cas:<hash>.<ext>'。
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { paths } from "../config.js";
import { appendAssetRecord, assetTitleFromFilename } from "./asset-library.js";
import { readJsonIfExists, updateUnversionedJson } from "./fs-node.js";

export interface CasRef {
  assetId: string;
  projectId: string;
  kind: string;
}

export interface CasEntry {
  path: string;
  size: number;
  mime: string;
  ext: string;
  refCount: number;
  createdAt: string;
  refs: CasRef[];
}

export interface CasIndex {
  schemaVersion: 1;
  entries: Record<string, CasEntry>;
}

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
};

export async function readCasIndex(root: string): Promise<CasIndex> {
  return (await readJsonIfExists<CasIndex>(paths.casIndex(root))) ?? { schemaVersion: 1, entries: {} };
}

export interface UploadResult {
  hash: string;
  storageKey: string;
  size: number;
  dedup: boolean;
  refCount: number;
  assetId: string;
}

export async function uploadToCas(
  root: string,
  input: {
    projectId: string;
    filename: string;
    dataBase64: string;
    mime: string;
    title?: string;
    /** 进素材库（素材页可见）。默认 false：主体状态图只落 CAS，由主体库引用 */
    toLibrary?: boolean;
    /** CAS 记账的 ref 身份（主体图传 subject-state:<subjectId>/<state>，与前端一致） */
    refId?: string;
  },
): Promise<UploadResult> {
  const buf = Buffer.from(input.dataBase64, "base64");
  const hash = crypto.createHash("sha256").update(buf).digest("hex");
  const ext = MIME_EXT[input.mime] ?? path.extname(input.filename).replace(/^\./, "") ?? "bin";
  const relPath = `media/cas/${hash}.${ext}`;
  const absPath = path.join(root, relPath);

  const index = await readCasIndex(root);
  const dedup = index.entries[hash] !== undefined;

  if (!dedup) {
    await fs.mkdir(paths.casDir(root), { recursive: true });
    await fs.writeFile(absPath, buf);
  }

  const assetId = input.refId ?? `asset-${crypto.randomBytes(6).toString("hex")}`;
  await updateUnversionedJson<CasIndex>(paths.casIndex(root), {
    mutate: (idx) => {
      const next: CasIndex = idx ?? { schemaVersion: 1, entries: {} };
      const entry = next.entries[hash];
      if (entry) {
        entry.refs.push({ assetId, projectId: input.projectId, kind: input.mime.split("/")[0] });
        entry.refCount = entry.refs.length;
      } else {
        next.entries[hash] = {
          path: relPath,
          size: buf.length,
          mime: input.mime,
          ext,
          refCount: 1,
          createdAt: new Date().toISOString(),
          refs: [{ assetId, projectId: input.projectId, kind: input.mime.split("/")[0] }],
        };
      }
      return next;
    },
  });

  // 素材页读的是资产记录：只有显式 toLibrary 才建记录。
  // 主体状态图只落 CAS + subject-state ref（与前端 subject-state-media 同口径），
  // 否则同一张定妆图会在「主体库」和「素材」里各出现一次。
  if (input.toLibrary) {
    await appendAssetRecord(root, {
      id: assetId,
      title: input.title?.trim() || assetTitleFromFilename(input.filename),
      kind: input.mime.split("/")[0] ?? "image",
      tags: [],
      bytes: buf.length,
      mimeType: input.mime,
      createdAt: new Date().toISOString(),
      data: { kind: input.mime.split("/")[0] ?? "image", storageKey: `cas:${hash}.${ext}` },
      cas: { hash, ext },
      folderId: null,
      favorite: false,
      scope: "project",
      projectId: input.projectId,
    });
  }

  const after = await readCasIndex(root);
  return {
    hash,
    storageKey: `cas:${hash}.${ext}`,
    size: buf.length,
    dedup,
    refCount: after.entries[hash]?.refCount ?? 1,
    assetId,
  };
}

/** scope=project：refs 含本项目条目；scope=library：全局去重视图（每个 hash 一条）。 */
export async function listAssets(root: string, scope: "project" | "library", projectId?: string) {
  const index = await readCasIndex(root);
  const rows = Object.entries(index.entries).map(([hash, e]) => ({
    hash,
    storageKey: `cas:${hash}.${e.ext}`,
    path: e.path,
    size: e.size,
    mime: e.mime,
    refCount: e.refCount,
    createdAt: e.createdAt,
    projectIds: [...new Set(e.refs.map((r) => r.projectId))],
  }));
  if (scope === "project" && projectId) {
    return rows.filter((r) => r.projectIds.includes(projectId));
  }
  return rows;
}
