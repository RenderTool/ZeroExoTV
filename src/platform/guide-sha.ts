/**
 * 引导 sha256 台账（网页侧，2026-11-20）
 *
 * 与 MCP `mcp-server/src/lib/guide-sha.ts` 读写同一个文件：
 * `<数据根>/.lf/zeroexo/app_meta/guide-sha.json`。
 *
 * 用户要求：历史 guide（版本记录里没有 sha256）默认重传一遍，避免云端旧文件冒充正确引导。
 * 重传成功后把本地内容的 sha 记在这里，两边下次都按 sha 校验，不再重复上传（引导约 400MB）。
 */
import { readJson, writeJson } from './fs.js';

export const GUIDE_SHA_PATH = '.lf/zeroexo/app_meta/guide-sha.json';

interface GuideShaFile {
  schemaVersion: 1;
  guides: Record<string, { sha256: string; bytes?: number; updatedAt: string; source: string }>;
}

const GUIDE_ID_RE = /^gd_[A-Za-z0-9_-]{4,64}$/;

async function readFileSafe(): Promise<GuideShaFile> {
  const parsed = await readJson<GuideShaFile>(GUIDE_SHA_PATH).catch(() => null);
  if (parsed && typeof parsed === 'object' && parsed.guides && typeof parsed.guides === 'object') {
    return { schemaVersion: 1, guides: parsed.guides };
  }
  return { schemaVersion: 1, guides: {} };
}

export async function readGuideSha(guideId: string): Promise<string | null> {
  if (!GUIDE_ID_RE.test(guideId)) return null;
  const file = await readFileSafe();
  const v = file.guides[guideId]?.sha256;
  return typeof v === 'string' && v.length === 64 ? v.toLowerCase() : null;
}

export async function recordGuideSha(guideId: string, sha256: string, bytes?: number): Promise<void> {
  if (!GUIDE_ID_RE.test(guideId) || !/^[a-f0-9]{64}$/i.test(sha256)) return;
  const file = await readFileSafe();
  file.guides[guideId] = {
    sha256: sha256.toLowerCase(),
    ...(bytes ? { bytes } : {}),
    updatedAt: new Date().toISOString(),
    source: 'local-reupload',
  };
  await writeJson(GUIDE_SHA_PATH, file);
}
