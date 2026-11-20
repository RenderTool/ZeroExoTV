/**
 * 引导 sha256 台账（2026-11-20 用户要求：历史 guide 默认重传一遍避免出错）
 *
 * 背景：片段版本存档里的 `guide` 只有 `{id, path, frames, localKey}`，没有 sha256，
 * 于是 MCP `ensureComfyGuide(base, id, undefined)` 只能「云端有同名文件就信」——
 * 云端那份可能是旧内容/被截断，插件跑起来就是错引导，且没有任何校验能发现。
 *
 * 口径：没有可信 sha 的历史引导 → 第一次提交时从本地 media/guides 强制重传覆盖云端，
 * 上传成功后把本地内容的 sha 记进本台账；之后每次按 sha 校验，一致就不再传（引导约 400MB，不无脑重传）。
 *
 * 台账与具体片段解耦：同一个 guideId 全网只记一份。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { dataRoot } from "../config.js";

export const GUIDE_SHA_REL = path.join(".lf", "zeroexo", "app_meta", "guide-sha.json");

export interface GuideShaEntry {
  sha256: string;
  bytes?: number;
  updatedAt: string;
  source: "local-reupload" | "local-record";
}

interface GuideShaFile {
  schemaVersion: 1;
  guides: Record<string, GuideShaEntry>;
}

async function readFileSafe(): Promise<GuideShaFile> {
  try {
    const raw = await fs.readFile(path.join(dataRoot(), GUIDE_SHA_REL), "utf8");
    const parsed = JSON.parse(raw) as GuideShaFile;
    if (parsed && typeof parsed === "object" && parsed.guides && typeof parsed.guides === "object") {
      return { schemaVersion: 1, guides: parsed.guides };
    }
  } catch {
    /* 不存在或损坏 → 空台账 */
  }
  return { schemaVersion: 1, guides: {} };
}

export async function readGuideSha(guideId: string): Promise<string | null> {
  if (!/^gd_[A-Za-z0-9_-]{4,64}$/.test(guideId)) return null;
  const file = await readFileSafe();
  const v = file.guides[guideId]?.sha256;
  return typeof v === "string" && v.length === 64 ? v.toLowerCase() : null;
}

export async function recordGuideSha(guideId: string, sha256: string, bytes?: number): Promise<void> {
  if (!/^gd_[A-Za-z0-9_-]{4,64}$/.test(guideId)) return;
  if (!/^[a-f0-9]{64}$/i.test(sha256)) return;
  const file = await readFileSafe();
  file.guides[guideId] = {
    sha256: sha256.toLowerCase(),
    ...(bytes ? { bytes } : {}),
    updatedAt: new Date().toISOString(),
    source: "local-reupload",
  };
  const abs = path.join(dataRoot(), GUIDE_SHA_REL);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

/** 本地 media/guides 是否存在 + 其 sha（没有文件返回 null）。 */
export async function localGuideDigest(guideId: string): Promise<{ sha256: string; bytes: number; path: string } | null> {
  if (!/^gd_[A-Za-z0-9_-]{4,64}$/.test(guideId)) return null;
  const file = path.join(dataRoot(), "media", "guides", `${guideId}.safetensors`);
  try {
    const buf = await fs.readFile(file);
    if (!buf.length) return null;
    return { sha256: crypto.createHash("sha256").update(buf).digest("hex"), bytes: buf.length, path: file };
  } catch {
    return null;
  }
}
