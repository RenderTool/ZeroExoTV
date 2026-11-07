/**
 * 资产库记录（素材页的数据源）。
 *
 * 前端素材页读 `.lf/zeroexo/app_state/zeroexo:assets.json`（{__lf:1,value:Asset[]}），
 * 只有 cas_index 没有资产记录时，它会走「CAS 自愈」把条目重建成
 * 「恢复的图片·<hash>」——就是页面上那些名字错乱的资产。
 * 所以 upload_asset 必须同时写 CAS 和资产记录。
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { readJsonIfExists } from "./fs-node.js";

export interface LibraryAsset {
  id: string;
  title: string;
  kind: string;
  tags: string[];
  bytes: number;
  mimeType: string;
  createdAt: string;
  data: { kind: string; storageKey: string };
  cas?: { hash: string; ext: string };
  folderId: null;
  favorite: boolean;
  scope: "project" | "library";
  projectId?: string;
}

interface AssetsEnvelope {
  __lf: 1;
  value: LibraryAsset[];
}

const ASSETS_KEY = "zeroexo:assets";

export function assetsLibraryFile(root: string): string {
  return path.join(root, ".lf", "zeroexo", "app_state", `${encodeURIComponent(ASSETS_KEY)}.json`);
}

/** 同进程写串行：避免多条上传并发读-改-写互相覆盖 */
let queue: Promise<void> = Promise.resolve();

export async function appendAssetRecord(root: string, record: LibraryAsset): Promise<void> {
  const run = queue.then(async () => {
    const file = assetsLibraryFile(root);
    const env = await readJsonIfExists<AssetsEnvelope>(file);
    const list = env?.value ?? [];
    const idx = list.findIndex((a) => a.id === record.id || a.data?.storageKey === record.data.storageKey);
    if (idx >= 0) {
      // 同内容已有记录（CAS 自愈出来的「恢复的图片·hash」）：保留原 id（节点引用按 id 认），
      // 但把标题/归属改回真实值，否则素材页永远显示兜底名
      list[idx] = {
        ...list[idx]!,
        title: record.title,
        kind: record.kind,
        scope: record.scope,
        projectId: record.projectId,
        mimeType: record.mimeType,
        bytes: record.bytes,
        cas: record.cas,
        data: record.data,
      };
    } else {
      list.push(record);
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ __lf: 1, value: list } satisfies AssetsEnvelope, null, 2), "utf8");
  });
  queue = run.then(() => undefined, () => undefined);
  return run;
}

export function assetTitleFromFilename(filename: string): string {
  return path.basename(filename).replace(/\.[^.]+$/, "");
}
