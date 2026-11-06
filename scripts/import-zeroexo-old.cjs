#!/usr/bin/env node
/**
 * import-zeroexo-old — 把旧线上版本 zero（zeroexo-platform）抽屉资产库导入本地公共资产库 · 2026-11-05
 *
 * 用法：
 *   node scripts/import-zeroexo-old.cjs [--root D:\Test] [--limit N]     # dry-run（默认，只输出计划不动盘）
 *   node scripts/import-zeroexo-old.cjs --apply ...                      # 实际导入（先备份 JSON 元数据）
 *
 * 源（只读，不改动旧工程）：
 *   - 元数据：zeroexo_backend PostgreSQL（Prisma）Asset 表（抽屉/资产库条目，含 owner）
 *   - 二进制：zeroexo_backend\storage\<storageKey>（resources/front/assets、resources/admin/ai-gen、text/…）
 *
 * 目标（本地公共资产库，scope='library'，对齐 asset-store.ts / cas-store.ts / cas-upload.ts）：
 *   - 字节：  <root>\media\cas\<sha256>.<ext>
 *   - 索引：  <root>\entities\cas_index.json（refs 带 assetId/projectId='library'/kind）
 *   - 记录：  <root>\.lf\zeroexo\app_state\zeroexo%3Aassets.json（信封 {__lf:1, value:[Asset]}）
 *
 * 映射表（旧 Asset → 新 Asset）：
 *   filename        → title（逐字保留）
 *   kind=image      → kind='image'；二进制入 CAS；coverUrl=storageKey；data={kind:'image',dataUrl:'',storageKey,w,h}
 *   kind=video      → kind='video'；二进制入 CAS；data={kind:'video',url:'',storageKey,w,h,durationMs}
 *   kind=text       → kind='text'；content 取旧 text 列（缺失则读 storage 文件）；data={kind:'text',content}
 *   kind=script     → 跳过（公共库白名单 LIBRARY_ALLOWED_KINDS=image/video/audio/text，剧本不进公共库）
 *   width/height    → data.width/height（旧库实测值，逐字沿用）
 *   duration(秒)    → data.durationMs = duration*1000
 *   createdAt       → createdAt（保留原创建时间）
 *   ownerId         → tags['old-owner:<username>']
 *   id              → tags['old-id:<uuid>']
 *   category        → tags['old-category:<user|ai-generation|ai-test>']
 *   旧 tags         → 原样追加
 *   (来源)          → tags['source:zeroexo-old']（注明来自旧版 zero）
 *   visibility/folderId/version → 不映射（本地版无对应概念，folderId 一律 null）
 *
 * 去重（只增不改）：
 *   - 既有资产记录含同 'old-id:<id>' 标签 → 跳过（幂等）
 *   - 既有 cas_index 条目（任何作用域）同 hash → 跳过（不触碰既有条目）
 *   - 既有 library 资产同 cas.hash → 跳过
 *   - 批内同 hash → 后者跳过
 *   - 源二进制/文本缺失 → 跳过并记录原因
 */
'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

// ---------- 参数 ----------
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const rootIdx = args.indexOf('--root');
const ROOT = rootIdx >= 0 ? args[rootIdx + 1] : 'D:\\Test';
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) : 0; // 0 = 不限

// 旧工程路径（只读）
const OLD_BACKEND = 'D:\\AICode\\zeroexo\\zeroexo-platform\\zeroexo_backend';
const OLD_STORAGE = path.join(OLD_BACKEND, 'storage');

const ASSETS_JSON = path.join(ROOT, '.lf', 'zeroexo', 'app_state', 'zeroexo%3Aassets.json');
const CAS_INDEX_JSON = path.join(ROOT, 'entities', 'cas_index.json');
const CAS_DIR = path.join(ROOT, 'media', 'cas');

const SOURCE_TAG = 'source:zeroexo-old';
const MIME_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/webm': 'webm',
};

// ---------- 工具 ----------
const nowIso = () => new Date().toISOString();

async function readJsonIfExists(file) {
  try {
    const text = await fsp.readFile(file, 'utf8');
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

/** nanoid 兼容（21 位，字母表 A-Za-z0-9_-），与前端 asset id 形制一致 */
function nanoId() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  const bytes = crypto.randomBytes(21);
  let out = '';
  for (let i = 0; i < 21; i++) out += alphabet[bytes[i] % 64];
  return out;
}

// ---------- 主流程 ----------
async function main() {
  console.log(`[import-zeroexo-old] 数据根: ${ROOT}  模式: ${APPLY ? 'APPLY（实际导入）' : 'DRY-RUN（只读）'}`);
  console.log(`[import-zeroexo-old] 旧工程(只读): ${OLD_BACKEND}`);

  // 1. 读旧库（Prisma，走旧工程 node_modules）
  const { PrismaClient } = require(path.join(OLD_BACKEND, 'node_modules', '@prisma', 'client'));
  const prisma = new PrismaClient();
  const oldAssets = await prisma.asset.findMany({
    select: {
      id: true, ownerId: true, filename: true, kind: true, storageKey: true,
      mimeType: true, size: true, width: true, height: true, duration: true,
      text: true, tags: true, category: true, folderId: true, createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  const users = await prisma.user.findMany({ select: { id: true, username: true } });
  const folders = await prisma.assetFolder.findMany({ select: { id: true, name: true, ownerId: true } });
  await prisma.$disconnect();
  const ownerName = new Map(users.map((u) => [u.id, u.username]));
  const folderName = new Map(folders.map((f) => [f.id, f.name]));
  console.log(`[import-zeroexo-old] 旧库 Asset 共 ${oldAssets.length} 条（归属：${[...new Set(oldAssets.map((a) => a.ownerId))].map((o) => `${ownerName.get(o) ?? o}`).join('、')}）`);

  // 2. 读既有状态（去重依据）
  const envelope = await readJsonIfExists(ASSETS_JSON);
  const existingAssets = Array.isArray(envelope?.value) ? envelope.value : [];
  const existingOldIds = new Set();
  const existingLibHashes = new Set();
  for (const a of existingAssets) {
    for (const t of a?.tags ?? []) if (t.startsWith('old-id:')) existingOldIds.add(t.slice(7));
    if ((a.scope ?? 'library') === 'library' && a.cas?.hash) existingLibHashes.add(a.cas.hash);
  }
  const casIndex = await readJsonIfExists(CAS_INDEX_JSON);
  const existingCasHashes = new Set(Object.keys(casIndex?.entries ?? {}));

  // 3. 逐条组装（读二进制/文本、去重）
  const imported = [];
  const skipped = [];
  const batchHashes = new Set();
  let batch = oldAssets;
  if (LIMIT > 0) batch = batch.slice(0, LIMIT);

  for (const a of batch) {
    const owner = ownerName.get(a.ownerId) ?? a.ownerId;
    const base = { srcId: a.id, title: a.filename, kind: a.kind, owner };
    if (a.kind === 'script') {
      skipped.push({ ...base, reason: 'kind=script 不在公共库白名单(LIBRARY_ALLOWED_KINDS)' });
      continue;
    }
    if (!['image', 'video', 'text'].includes(a.kind)) {
      skipped.push({ ...base, reason: `kind=${a.kind} 无映射` });
      continue;
    }
    if (existingOldIds.has(a.id)) { skipped.push({ ...base, reason: 'duplicate-old-id(已导入过)' }); continue; }

    const tags = [SOURCE_TAG, `old-id:${a.id}`, `old-owner:${owner}`, ...(a.category ? [`old-category:${a.category}`] : []), ...(a.tags ?? [])];
    const createdAt = a.createdAt instanceof Date ? a.createdAt.toISOString() : String(a.createdAt);

    if (a.kind === 'text') {
      // 文本：content 取旧 text 列；缺失则读 storage 文件
      let content = typeof a.text === 'string' ? a.text : null;
      if (content == null && a.storageKey) {
        try { content = await fsp.readFile(path.join(OLD_STORAGE, a.storageKey), 'utf8'); } catch { /* 下方统一判空 */ }
      }
      if (content == null || content.length === 0) { skipped.push({ ...base, reason: 'text 内容缺失(text 列与 storage 文件均为空)' }); continue; }
      imported.push({
        asset: {
          id: nanoId(), title: String(a.filename ?? '未命名素材'), kind: 'text',
          tags, createdAt, bytes: 0, mimeType: undefined,
          data: { kind: 'text', content },
          folderId: null, favorite: false, scope: 'library',
        },
        buf: null, hash: null,
      });
      continue;
    }

    // image / video：读旧二进制 → sha256 → CAS
    if (!a.storageKey) { skipped.push({ ...base, reason: '无 storageKey' }); continue; }
    const srcAbs = path.join(OLD_STORAGE, a.storageKey);
    let buf;
    try { buf = await fsp.readFile(srcAbs); } catch { skipped.push({ ...base, reason: `源文件缺失: ${a.storageKey}` }); continue; }
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    if (existingLibHashes.has(hash) || batchHashes.has(hash)) { skipped.push({ ...base, reason: 'duplicate-hash(公共库同内容已存在)' }); continue; }
    if (existingCasHashes.has(hash)) { skipped.push({ ...base, reason: 'hash-exists-in-cas(既有条目不触碰)' }); continue; }
    batchHashes.add(hash);

    const mime = a.mimeType ?? (a.kind === 'image' ? 'image/png' : 'video/mp4');
    const ext = MIME_EXT[mime] ?? path.extname(a.filename ?? '').replace(/^\./, '') ?? 'bin';
    const storageKey = `cas:${hash}.${ext}`;
    const durationMs = Number.isFinite(a.duration) && a.duration > 0 ? Math.round(a.duration * 1000) : undefined;
    const asset = {
      id: nanoId(),
      cas: { hash, ext },
      title: String(a.filename ?? '未命名素材'),
      kind: a.kind,
      ...(a.kind === 'image' ? { coverUrl: storageKey } : {}),
      tags,
      createdAt,
      bytes: Number(a.size ?? buf.length),
      mimeType: mime,
      data: a.kind === 'image'
        ? { kind: 'image', dataUrl: '', storageKey, width: a.width ?? undefined, height: a.height ?? undefined }
        : { kind: 'video', url: '', storageKey, width: a.width ?? undefined, height: a.height ?? undefined, durationMs },
      folderId: null,
      favorite: false,
      scope: 'library',
    };
    imported.push({ asset, buf, hash, relPath: `media/cas/${hash}.${ext}`, srcStorageKey: a.storageKey });
  }

  const byKind = {};
  for (const it of imported) byKind[it.asset.kind] = (byKind[it.asset.kind] ?? 0) + 1;
  console.log(`候选导入 ${imported.length}（分布 ${JSON.stringify(byKind)}）；跳过 ${skipped.length}`);
  for (const s of skipped) console.log(`  [跳过] ${s.kind} "${s.title}" (${s.owner}) — ${s.reason}`);

  if (!APPLY) {
    console.log('[import-zeroexo-old] dry-run 完成，未改动任何文件；加 --apply 执行导入（自动备份 JSON 元数据）');
    return;
  }

  // ---------- APPLY ----------
  const ts = nowIso().replace(/[:.]/g, '-');
  const backupDir = path.join(ROOT, '.zeroexo-old-import-backup', ts);
  await fsp.mkdir(backupDir, { recursive: true });
  await fsp.mkdir(CAS_DIR, { recursive: true });
  await fsp.mkdir(path.dirname(ASSETS_JSON), { recursive: true });
  await fsp.mkdir(path.dirname(CAS_INDEX_JSON), { recursive: true });
  for (const f of [ASSETS_JSON, CAS_INDEX_JSON]) {
    try { await fsp.copyFile(f, path.join(backupDir, path.relative(ROOT, f).replace(/[\\/]/g, '__'))); } catch { /* 不存在 */ }
  }
  console.log(`[import-zeroexo-old] 已备份既有 JSON 到 ${backupDir}`);

  // 写 CAS 物理文件
  let writtenFiles = 0;
  for (const it of imported) {
    if (!it.buf) continue;
    const abs = path.join(ROOT, it.relPath);
    try { await fsp.stat(abs); } catch { await fsp.writeFile(abs, it.buf); writtenFiles++; }
  }
  console.log(`[import-zeroexo-old] 新写入 media/cas 文件 ${writtenFiles} 个`);

  // 合并 cas_index.json（只追加新条目）
  const index = casIndex ?? { schemaVersion: 1, entries: {} };
  if (typeof index.entries !== 'object' || index.entries === null) index.entries = {};
  const now = nowIso();
  for (const it of imported) {
    if (!it.hash) continue;
    if (index.entries[it.hash]) continue;
    index.entries[it.hash] = {
      path: it.relPath,
      size: it.buf.length,
      mime: it.asset.mimeType,
      ext: it.asset.cas.ext,
      refCount: 1,
      createdAt: now,
      refs: [{ assetId: it.asset.id, projectId: 'library', kind: it.asset.kind }],
    };
  }
  await fsp.writeFile(CAS_INDEX_JSON, JSON.stringify(index, null, 2));
  console.log(`[import-zeroexo-old] cas_index.json 条目数: ${Object.keys(index.entries).length}`);

  // 追加资产记录（信封 {__lf:1, value:[...]}；只 push，不改既有记录）
  const nextEnvelope = envelope ?? { __lf: 1, value: [] };
  if (!Array.isArray(nextEnvelope.value)) nextEnvelope.value = [];
  for (const it of imported) nextEnvelope.value.push(it.asset);
  await fsp.writeFile(ASSETS_JSON, JSON.stringify(nextEnvelope, null, 2));
  console.log(`[import-zeroexo-old] 资产记录总数: ${nextEnvelope.value.length}（本次追加 ${imported.length}）`);

  // 导入报告
  const report = {
    appliedAt: nowIso(),
    source: 'zeroexo-platform (zeroexo_backend PostgreSQL Asset + storage/)',
    root: ROOT,
    importedCount: imported.length,
    skippedCount: skipped.length,
    skipped,
    imported: imported.map((it) => ({
      assetId: it.asset.id, oldId: it.asset.tags.find((t) => t.startsWith('old-id:'))?.slice(7),
      kind: it.asset.kind, title: it.asset.title, owner: it.asset.tags.find((t) => t.startsWith('old-owner:'))?.slice(10),
      hash: it.hash, storageKey: it.asset.coverUrl ?? it.asset.data?.storageKey ?? null,
      bytes: it.asset.bytes, srcStorageKey: it.srcStorageKey ?? null,
    })),
    unmappedSourceFields: {
      visibility: '旧库均为 private，本地版无可见性概念，未映射',
      folderId: '旧库样本均为 null；本地版 folderId 一律 null，旧值不迁移',
      'version/lastSyncedAt': '云端同步概念，本地版无对应字段',
      'kind=script': '公共库白名单不含 script，整条跳过（含旧库 1 条剧本「血色站台」）',
    },
  };
  const reportFile = path.join(backupDir, 'import-report.json');
  await fsp.writeFile(reportFile, JSON.stringify(report, null, 2));
  console.log(`[import-zeroexo-old] 导入报告: ${reportFile}`);
  console.log(`[import-zeroexo-old] 汇总：导入 ${imported.length}；跳过 ${skipped.length}`);
  console.log('[import-zeroexo-old] APPLY 完成');
}

main().catch((err) => {
  console.error('[import-zeroexo-old] 失败:', err);
  process.exit(1);
});
