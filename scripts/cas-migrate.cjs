#!/usr/bin/env node
/**
 * cas-migrate — 存量资产一次性收敛到内容寻址存储（CAS）· 2026-11-04
 *
 * 用法：
 *   node scripts/cas-migrate.cjs [--root D:\Test]            # dry-run（默认，只输出数字不动盘）
 *   node scripts/cas-migrate.cjs [--root D:\Test] --apply    # 实际迁移（先备份 JSON 元数据）
 *
 * 机制（对齐 entities/cas-store.ts）：
 *   1. 扫描资产记录（.lf/zeroexo/app_state/zeroexo%3Aassets.json）中仍持旧 storageKey
 *      （image:<id> / video:<id> / audio:<id> 桶键 或 image:assets/... 盘符键）的资产；
 *   2. 逐条 sha256 归并：物理字节收敛到 media/cas/<sha256>.<ext>（同内容一份）；
 *   3. 建/并 entities/cas_index.json 条目（refs 带 assetId/projectId/kind，refCount=refs.length）；
 *   4. 资产记录改写为 cas 引用（cas 字段 + 派生 cas:<hash>.<ext> 键）；
 *      graph 分片里的旧 storageKey 字符串同步替换（不改布局结构，纯引用换名）；
 *   5. 删除旧桶 blob 及其 :thumb/:preview/:videothumb 派生档；盘符文件同步删除；
 *   6. apply 前把 assets.json / cas_index.json / graph JSON 备份到 .cas-backup/<时间戳>/；
 *      物理字节可逆（media/cas 留存同内容），被删 blob 均可从 media/cas 恢复；
 *   7. apply 后自动复扫：剩余重复应为 0。
 *
 * 输出格式（dry-run 与 apply 一致）：
 *   扫描 N 个资产 / 唯一 hash M 个 / 可省磁盘 X 字节 / 冲突 Y 个
 */
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

// ---------- 参数 ----------
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const rootIdx = args.indexOf('--root');
const ROOT = rootIdx >= 0 ? args[rootIdx + 1] : 'D:\\Test';

const LF_DIR = path.join(ROOT, '.lf', 'zeroexo');
const APP_STATE = path.join(LF_DIR, 'app_state');
const ASSETS_JSON = path.join(APP_STATE, 'zeroexo%3Aassets.json');
const CAS_INDEX_JSON = path.join(ROOT, 'entities', 'cas_index.json');
const CAS_DIR = path.join(ROOT, 'media', 'cas');
const GRAPH_DATA = path.join(LF_DIR, 'graph_data');

const KIND_BUCKET = { image: 'image_files', video: 'media_files', audio: 'media_files' };
const MIME_EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/bmp': 'bmp', 'image/svg+xml': 'svg', 'image/avif': 'avif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-matroska': 'mkv',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/flac': 'flac',
};
const KIND_DEFAULT_EXT = { image: 'png', video: 'mp4', audio: 'mp3' };
const DERIVED_SUFFIXES = [':thumb', ':preview', ':videothumb'];

const encKey = (key) => encodeURIComponent(key);
const sha256File = (file) =>
  new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });

/** 旧 storageKey → 磁盘文件（桶 blob 或盘符文件）；无法映射返回 null */
function legacyFileOf(storageKey) {
  const m = /^(image|video|audio):(.+)$/.exec(storageKey);
  if (!m) return null;
  const [, kind, rest] = m;
  if (rest.includes('/')) {
    // 盘符键：image:assets/<proj>/images/<id>.png → <root>/assets/...
    if (rest.includes('..')) return null;
    return { file: path.join(ROOT, rest), form: 'path' };
  }
  return { file: path.join(LF_DIR, KIND_BUCKET[kind], `${encKey(storageKey)}.blob`), form: 'bucket' };
}

async function readJsonIfExists(file) {
  try {
    const text = await fsp.readFile(file, 'utf8');
    return JSON.parse(text.replace(/^﻿/, '')); // 容忍 UTF-8 BOM
  } catch {
    return null;
  }
}

/** 扫描：返回 { items, conflictNotes, orphanBlobs }；items 每条 = 一个待迁移资产引用 */
async function scan() {
  const envelope = await readJsonIfExists(ASSETS_JSON);
  const assets = Array.isArray(envelope?.value) ? envelope.value : [];
  const items = [];
  const conflictNotes = [];
  for (const a of assets) {
    const key = a?.data?.storageKey;
    if (typeof key !== 'string' || key.startsWith('cas:')) continue;
    if (a.cas) continue; // 已有 cas 引用（理论上此时 key 也是 cas:，双保险）
    const loc = legacyFileOf(key);
    if (!loc) {
      conflictNotes.push(`资产 ${a.id} 的 storageKey 无法映射旧路径: ${key}`);
      continue;
    }
    let st = null;
    try {
      st = await fsp.stat(loc.file);
    } catch { /* missing */ }
    if (!st) {
      conflictNotes.push(`资产 ${a.id} 的物理文件缺失: ${loc.file}`);
      continue;
    }
    const hash = await sha256File(loc.file);
    const mime = a.mimeType || 'application/octet-stream';
    const ext = MIME_EXT[mime] ?? KIND_DEFAULT_EXT[a.kind] ?? 'bin';
    items.push({ asset: a, key, file: loc.file, form: loc.form, size: st.size, hash, mime, ext });
  }

  // 信息项：桶内未被任何资产记录引用的孤儿 blob（含已迁移资产的派生档）——不属本次迁移范围（GC 职责）
  const referenced = new Set();
  for (const a of assets) {
    const key = a?.data?.storageKey;
    if (typeof key !== 'string' || key.includes('/')) continue;
    const kind = /^(image|video|audio):/.exec(key)?.[1];
    if (!kind) continue;
    referenced.add(`${encKey(key)}.blob`);
    for (const suf of DERIVED_SUFFIXES) referenced.add(`${encKey(key + suf)}.blob`);
  }
  let orphanBlobs = { count: 0, bytes: 0 };
  for (const bucket of new Set(Object.values(KIND_BUCKET))) {
    try {
      for (const name of await fsp.readdir(path.join(LF_DIR, bucket))) {
        if (referenced.has(name)) continue;
        try {
          orphanBlobs.bytes += (await fsp.stat(path.join(LF_DIR, bucket, name))).size;
          orphanBlobs.count++;
        } catch { /* 忽略 */ }
      }
    } catch { /* 桶目录不存在 */ }
  }
  return { items, conflictNotes, orphanBlobs };
}

function groupByHash(items) {
  const map = new Map();
  for (const it of items) {
    if (!map.has(it.hash)) map.set(it.hash, []);
    map.get(it.hash).push(it);
  }
  return map;
}

async function main() {
  console.log(`[cas-migrate] 数据根: ${ROOT}  模式: ${APPLY ? 'APPLY（实际迁移）' : 'DRY-RUN（只读）'}`);

  const { items, conflictNotes, orphanBlobs } = await scan();
  const groups = groupByHash(items);

  // 冲突：同 hash 出现不同 ext/mime 归一冲突（取首个，仅记录）
  const conflicts = [...conflictNotes];
  for (const [hash, list] of groups) {
    const exts = new Set(list.map((i) => i.ext));
    if (exts.size > 1) conflicts.push(`hash ${hash.slice(0, 12)}… 存在多个扩展名 ${[...exts].join('/')}（取 ${list[0].ext}）`);
  }

  // 可省磁盘：每组 (份数-1)×单份字节
  let savedBytes = 0;
  for (const list of groups.values()) {
    if (list.length > 1) savedBytes += (list.length - 1) * list[0].size;
  }
  // 派生档（thumb/preview/videothumb）删除也能省：单独统计进详情行
  let derivedBytes = 0;
  let derivedCount = 0;
  for (const it of items) {
    if (it.form !== 'bucket') continue;
    const bucketDir = path.dirname(it.file);
    for (const suf of DERIVED_SUFFIXES) {
      const f = path.join(bucketDir, `${encKey(it.key + suf)}.blob`);
      try {
        derivedBytes += (await fsp.stat(f)).size;
        derivedCount++;
      } catch { /* 无派生档 */ }
    }
  }

  console.log(`扫描 ${items.length} 个资产 / 唯一 hash ${groups.size} 个 / 可省磁盘 ${savedBytes} 字节 / 冲突 ${conflicts.length} 个`);
  if (derivedCount > 0) console.log(`  详情: 另有 ${derivedCount} 个派生缩略档可清理，约 ${derivedBytes} 字节`);
  if (orphanBlobs.count > 0) console.log(`  详情: 桶内未被任何资产记录引用的孤儿 blob ${orphanBlobs.count} 个 / ${orphanBlobs.bytes} 字节（不在本次迁移范围，属存量 GC）`);
  const dupGroups = [...groups.entries()].filter(([, l]) => l.length > 1);
  for (const [hash, list] of dupGroups.slice(0, 10)) {
    console.log(`  重复组 ${hash.slice(0, 12)}… ×${list.length} 份 ×${list[0].size}B（${list.map((i) => i.asset.id).join(', ')}）`);
  }
  if (dupGroups.length > 10) console.log(`  …另有 ${dupGroups.length - 10} 个重复组`);
  for (const c of conflicts) console.log(`  冲突: ${c}`);

  if (!APPLY) {
    console.log('[cas-migrate] dry-run 完成，未改动任何文件；加 --apply 执行迁移（自动备份 JSON 元数据）');
    return;
  }

  // ---------- APPLY ----------
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(ROOT, '.cas-backup', ts);
  await fsp.mkdir(backupDir, { recursive: true });
  await fsp.mkdir(CAS_DIR, { recursive: true });
  await fsp.mkdir(path.dirname(CAS_INDEX_JSON), { recursive: true });

  // 1. 备份 JSON 元数据（物理字节可逆——media/cas 留存同内容）
  const graphFiles = [];
  for (const dir of [APP_STATE, GRAPH_DATA]) {
    try {
      for (const name of await fsp.readdir(dir)) {
        if (name.endsWith('.json')) graphFiles.push(path.join(dir, name));
      }
    } catch { /* 目录不存在 */ }
  }
  for (const f of [ASSETS_JSON, CAS_INDEX_JSON, ...graphFiles]) {
    try {
      const rel = path.relative(ROOT, f).replace(/[\\/]/g, '__');
      await fsp.copyFile(f, path.join(backupDir, rel));
    } catch { /* 文件不存在 */ }
  }
  console.log(`[cas-migrate] 已备份 ${graphFiles.length + 2} 个 JSON 到 ${backupDir}`);

  // 2. 归并物理字节到 media/cas/
  const keyToCas = new Map(); // 旧 storageKey → { casKey, hash, ext }
  let writtenFiles = 0;
  for (const [hash, list] of groups) {
    const ext = list[0].ext;
    const target = path.join(CAS_DIR, `${hash}.${ext}`);
    try {
      const st = await fsp.stat(target);
      if (st.size !== list[0].size) conflicts.push(`已存在 CAS 文件大小不一致: ${target}`);
    } catch {
      await fsp.copyFile(list[0].file, target);
      writtenFiles++;
    }
    for (const it of list) keyToCas.set(it.key, { casKey: `cas:${hash}.${ext}`, hash, ext });
  }
  console.log(`[cas-migrate] 新写入 media/cas 文件 ${writtenFiles} 个（复用 ${groups.size - writtenFiles} 个）`);

  // 3. 建/并 cas_index.json
  const index = (await readJsonIfExists(CAS_INDEX_JSON)) ?? { schemaVersion: 1, entries: {} };
  if (typeof index.entries !== 'object' || index.entries === null) index.entries = {};
  const now = new Date().toISOString();
  for (const [hash, list] of groups) {
    const ext = list[0].ext;
    const entry = index.entries[hash] ?? {
      path: `media/cas/${hash}.${ext}`,
      size: list[0].size,
      mime: list[0].mime,
      ext,
      refCount: 0,
      createdAt: now,
      refs: [],
    };
    entry.path = `media/cas/${hash}.${ext}`;
    for (const it of list) {
      const ref = { assetId: it.asset.id, projectId: it.asset.projectId ?? 'library', kind: it.asset.kind };
      if (!entry.refs.some((r) => r.assetId === ref.assetId && r.projectId === ref.projectId && r.kind === ref.kind)) {
        entry.refs.push(ref);
      }
    }
    entry.refCount = entry.refs.length;
    index.entries[hash] = entry;
  }
  await fsp.writeFile(CAS_INDEX_JSON, JSON.stringify(index, null, 2));
  console.log(`[cas-migrate] cas_index.json 条目数: ${Object.keys(index.entries).length}`);

  // 4. 改写资产记录为 cas 引用
  const envelope = await readJsonIfExists(ASSETS_JSON);
  let rewritten = 0;
  for (const a of envelope?.value ?? []) {
    const key = a?.data?.storageKey;
    const hit = typeof key === 'string' ? keyToCas.get(key) : null;
    if (!hit) continue;
    a.cas = { hash: hit.hash, ext: hit.ext };
    a.data.storageKey = hit.casKey;
    rewritten++;
  }
  if (envelope) await fsp.writeFile(ASSETS_JSON, JSON.stringify(envelope, null, 2));
  console.log(`[cas-migrate] 改写资产记录 ${rewritten} 条`);

  // 5. graph 分片/其他 app_state JSON 中的旧 storageKey 字符串换名（纯引用替换，不动布局）
  let graphRewritten = 0;
  for (const f of graphFiles) {
    if (f === ASSETS_JSON) continue;
    let text;
    try {
      text = await fsp.readFile(f, 'utf8');
    } catch { continue; }
    let next = text;
    for (const [oldKey, { casKey }] of keyToCas) {
      next = next.split(`"${oldKey}"`).join(`"${casKey}"`);
    }
    if (next !== text) {
      await fsp.writeFile(f, next);
      graphRewritten++;
    }
  }
  console.log(`[cas-migrate] 改写 graph/状态 JSON ${graphRewritten} 个`);

  // 6. 删除旧物理文件（桶 blob + 派生档；盘符文件）
  let removed = 0;
  for (const it of items) {
    try {
      await fsp.unlink(it.file);
      removed++;
    } catch { /* 已不存在（同文件多 key 或重复资产）——幂等 */ }
    if (it.form === 'bucket') {
      const bucketDir = path.dirname(it.file);
      for (const suf of DERIVED_SUFFIXES) {
        try {
          await fsp.unlink(path.join(bucketDir, `${encKey(it.key + suf)}.blob`));
          removed++;
        } catch { /* 无派生档 */ }
      }
    }
  }
  console.log(`[cas-migrate] 删除旧文件 ${removed} 个`);

  // 7. 复扫：剩余重复应归零
  const after = await scan();
  const afterGroups = groupByHash(after.items);
  let afterDup = 0;
  for (const list of afterGroups.values()) {
    if (list.length > 1) afterDup += (list.length - 1) * list[0].size;
  }
  console.log(`[cas-migrate] 复扫: 剩余旧引用 ${after.items.length} 个 / 剩余重复字节 ${afterDup}`);
  if (conflicts.length > 0) console.log(`[cas-migrate] 冲突 ${conflicts.length} 个（见上）`);
  console.log('[cas-migrate] APPLY 完成');
}

main().catch((err) => {
  console.error('[cas-migrate] 失败:', err);
  process.exit(1);
});
