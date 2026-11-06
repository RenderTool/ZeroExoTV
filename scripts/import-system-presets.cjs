#!/usr/bin/env node
/**
 * import-system-presets — 把 infinite-canvas-main 的系统预设导入公共资产库 · 2026-11-05
 *
 * 用法：
 *   node scripts/import-system-presets.cjs [--root D:\Test] [--src-dir <path>] [--limit N] [--only pose|costume|portrait]
 *                                          # dry-run（默认，只输出计划不动盘）
 *   node scripts/import-system-presets.cjs --apply ...              # 实际导入（先备份 JSON 元数据）
 *
 * 源：references/infinite-canvas-main/web/src/data/system-presets/{poses,costumes,portraits}.json
 *   - 源仓库只存索引元数据，图片二进制在其官方 CDN（pages.dev）上；
 *     本脚本按源码 presetImageUrl() 的 thumb 档规则逐条下载缩略图。
 *   - 源自带 nsfw 过滤口径（includeSensitive=false 默认隐藏）：nsfw=true 的条目一律不导入。
 *
 * 目标（公共资产库，scope='library'，对齐 asset-store.ts / cas-store.ts / disk-driver.ts）：
 *   - 字节：  <root>\media\cas\<sha256>.<ext>            （内容寻址，同 hash 一份）
 *   - 索引：  <root>\entities\cas_index.json             （refs 带 assetId/projectId='library'/kind）
 *   - 记录：  <root>\.lf\zeroexo\app_state\zeroexo%3Aassets.json（信封 {__lf:1, value:[Asset]}）
 *
 * 映射表（源 SystemPresetAsset → 目标 Asset）：
 *   name        → title（原始名称逐字保留）
 *   (类目)      → kind='image'；scope='library'；projectId 不写
 *   CDN thumb   → 下载字节 → sha256 → media/cas + cas{hash,ext} + coverUrl/data.storageKey='cas:<hash>.<ext>'
 *   id          → tags['src-id:<id>']
 *   series      → tags['series:<seriesId>']
 *   (类目)      → tags['preset:<category>']
 *   (来源)      → tags['source:infinite-canvas-main']
 *   group(pose) → tags['group:<group>']
 *   angles(pose)→ tags['angles:<a1+a2…>']（导入默认机位 front|first 的缩略图一张）
 *   promptText(costume) → tags['prompt:<原词>']（逐字保留）
 *   实测字节    → bytes / mimeType；实测解析 → data.width/height（JPEG/WebP/PNG 头解析）
 *   不映射并记录：subtitle / 源 width,height（full 档尺寸，对 thumb 字节不实）/ 数据集级 source,generatedAt
 *
 * 去重（只增不改）：
 *   - 已有资产记录含同 'src-id:<id>' 标签 → 跳过（重复导入防护，幂等）
 *   - 已有 library 资产同 cas.hash → 跳过
 *   - 已有 cas_index 条目（任何作用域）同 hash → 跳过（不触碰既有条目）
 *   - 批内同 hash → 后者跳过
 *
 * 输出：dry-run/apply 均打印汇总；apply 另写导入报告与备份到 <root>\.preset-import-backup\<ts>\
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
const srcIdx = args.indexOf('--src-dir');
const SRC_DIR = srcIdx >= 0 ? args[srcIdx + 1]
  : 'D:\\AICode\\zeroexo\\references\\infinite-canvas-main\\web\\src\\data\\system-presets';
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) : 0; // 0 = 不限
const onlyIdx = args.indexOf('--only');
const ONLY = onlyIdx >= 0 ? args[onlyIdx + 1] : '';

const ASSETS_JSON = path.join(ROOT, '.lf', 'zeroexo', 'app_state', 'zeroexo%3Aassets.json');
const CAS_INDEX_JSON = path.join(ROOT, 'entities', 'cas_index.json');
const CAS_DIR = path.join(ROOT, 'media', 'cas');

const SOURCE_TAG = 'source:infinite-canvas-main';
const CATEGORIES = ['pose', 'costume', 'portrait'];
const CDN = {
  pose: 'https://ai-pose-gallery.pages.dev',
  costume: 'https://ai-costume-gallery.pages.dev',
  portrait: 'https://ai-portrait-gallery.pages.dev',
};
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

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

/** 源码 presetImageUrl(category, id, {tier:'thumb'}) 的等价实现（只取 thumb 档） */
function thumbUrl(category, asset) {
  const join = (base, rest) => `${base.replace(/\/+$/, '')}/${rest.replace(/^\/+/, '')}`;
  if (category === 'pose') {
    const angle = (asset.angles ?? []).includes('front') ? 'front' : (asset.angles ?? [])[0];
    const file = angle ? `${asset.id}_${angle}` : asset.id;
    return { url: join(CDN.pose, `thumbs/${file}.jpg`), mime: 'image/jpeg', angle };
  }
  if (category === 'costume') {
    return { url: join(CDN.costume, `thumbs/${asset.id}.webp`), mime: 'image/webp' };
  }
  return { url: join(CDN.portrait, `img/thumb/${asset.id}.webp`), mime: 'image/webp' };
}

/** 从字节解析图片宽高（JPEG SOF / WebP VP8,VP8L,VP8X / PNG IHDR）；失败返回 null */
function parseImageDims(buf, mime) {
  try {
    if (mime === 'image/jpeg') {
      let off = 2;
      while (off + 9 < buf.length) {
        if (buf[off] !== 0xff) { off++; continue; }
        const marker = buf[off + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
        }
        off += 2 + buf.readUInt16BE(off + 2);
      }
      return null;
    }
    if (mime === 'image/png') {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (mime === 'image/webp') {
      const tag = buf.toString('ascii', 12, 16);
      if (tag === 'VP8 ') {
        return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      }
      if (tag === 'VP8L') {
        const b = buf.readUInt32LE(21);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
      if (tag === 'VP8X') {
        return { width: (buf.readUIntLE(24, 3)) + 1, height: (buf.readUIntLE(27, 3)) + 1 };
      }
      return null;
    }
  } catch { /* fallthrough */ }
  return null;
}

/** 下载（fetch + 2 次重试 + 45s 超时）；校验响应确实是声明的图片类型 */
async function download(url, mime) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 45000);
    try {
      const res = await fetch(url, { signal: ac.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const ct = (res.headers.get('content-type') ?? '').split(';')[0].trim();
      const okMagic =
        (mime === 'image/jpeg' && buf[0] === 0xff && buf[1] === 0xd8) ||
        (mime === 'image/webp' && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP');
      if (!okMagic || buf.length === 0 || (ct && ct !== 'application/octet-stream' && ct !== mime)) {
        throw new Error(`内容校验失败 content-type=${ct || '?'} bytes=${buf.length}`);
      }
      return buf;
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('unreachable');
}

// ---------- 主流程 ----------
async function main() {
  console.log(`[import-presets] 数据根: ${ROOT}  模式: ${APPLY ? 'APPLY（实际导入）' : 'DRY-RUN（只读）'}`);
  console.log(`[import-presets] 源目录: ${SRC_DIR}`);

  // 1. 读源数据
  const datasets = {};
  for (const cat of CATEGORIES) {
    if (ONLY && cat !== ONLY) continue;
    const file = path.join(SRC_DIR, `${cat === 'pose' ? 'poses' : cat === 'costume' ? 'costumes' : 'portraits'}.json`);
    const data = await readJsonIfExists(file);
    if (!data || !Array.isArray(data.assets)) {
      throw new Error(`源文件缺失或格式不对: ${file}`);
    }
    datasets[cat] = data;
  }

  // 2. 读既有状态（去重依据）
  const envelope = await readJsonIfExists(ASSETS_JSON);
  const existingAssets = Array.isArray(envelope?.value) ? envelope.value : [];
  const existingSrcIds = new Set();
  const existingLibHashes = new Set();
  for (const a of existingAssets) {
    for (const t of a?.tags ?? []) if (t.startsWith('src-id:')) existingSrcIds.add(t.slice(7));
    if ((a.scope ?? 'library') === 'library' && a.cas?.hash) existingLibHashes.add(a.cas.hash);
  }
  const casIndex = await readJsonIfExists(CAS_INDEX_JSON);
  const existingCasHashes = new Set(Object.keys(casIndex?.entries ?? {}));

  // 3. 组装候选（nsfw 过滤 + 既有去重），统计源字段出现情况
  const candidates = [];
  const skipped = []; // {srcId, title, category, reason}
  const fieldStats = {};
  for (const cat of Object.keys(datasets)) {
    for (const a of datasets[cat].assets) {
      for (const k of Object.keys(a)) fieldStats[k] = (fieldStats[k] ?? 0) + 1;
      if (a.nsfw === true) { skipped.push({ srcId: a.id, title: a.name, category: cat, reason: 'nsfw' }); continue; }
      if (existingSrcIds.has(String(a.id))) { skipped.push({ srcId: a.id, title: a.name, category: cat, reason: 'duplicate-src-id(已导入过)' }); continue; }
      candidates.push({ cat, a });
    }
  }
  const batch = LIMIT > 0 ? candidates.slice(0, LIMIT) : candidates;
  const outOfBatch = candidates.length - batch.length;
  console.log(`源条目合计: ${Object.values(datasets).reduce((n, d) => n + d.assets.length, 0)}；` +
    `nsfw/重复跳过 ${skipped.length}；本次候选 ${batch.length}${outOfBatch > 0 ? `（--limit 截断 ${outOfBatch}）` : ''}`);
  console.log(`源字段出现统计: ${JSON.stringify(fieldStats)}`);
  const byCat = {};
  for (const c of batch) byCat[c.cat] = (byCat[c.cat] ?? 0) + 1;
  console.log(`候选分布: ${JSON.stringify(byCat)}`);

  if (!APPLY) {
    console.log('[import-presets] dry-run 完成，未改动/下载任何文件；加 --apply 执行导入（自动备份 JSON 元数据）');
    console.log('  预期动作：逐条下载官方 CDN 缩略图（thumb 档）→ sha256 入 media/cas → 登记 cas_index refs(projectId=library) → 追加资产记录(scope=library, tags 带 src-id/来源标注)');
    return;
  }

  // ---------- APPLY ----------
  const ts = nowIso().replace(/[:.]/g, '-');
  const backupDir = path.join(ROOT, '.preset-import-backup', ts);
  await fsp.mkdir(backupDir, { recursive: true });
  await fsp.mkdir(CAS_DIR, { recursive: true });
  await fsp.mkdir(path.dirname(ASSETS_JSON), { recursive: true });
  await fsp.mkdir(path.dirname(CAS_INDEX_JSON), { recursive: true });
  for (const f of [ASSETS_JSON, CAS_INDEX_JSON]) {
    try { await fsp.copyFile(f, path.join(backupDir, path.relative(ROOT, f).replace(/[\\/]/g, '__'))); } catch { /* 不存在 */ }
  }
  console.log(`[import-presets] 已备份既有 JSON 到 ${backupDir}`);

  // 4. 并发下载（8 并发）
  const imported = [];
  const batchHashes = new Set();
  let done = 0;
  const queue = [...batch];
  async function worker() {
    while (queue.length > 0) {
      const { cat, a } = queue.shift();
      const srcId = String(a.id);
      let status = 'downloaded';
      let buf = null;
      try {
        const { url, mime, angle } = thumbUrl(cat, a);
        buf = await download(url, mime);
        const hash = crypto.createHash('sha256').update(buf).digest('hex');
        if (existingLibHashes.has(hash) || batchHashes.has(hash)) {
          skipped.push({ srcId, title: a.name, category: cat, reason: 'duplicate-hash(公共库同内容已存在)' });
          status = null;
        } else if (existingCasHashes.has(hash)) {
          skipped.push({ srcId, title: a.name, category: cat, reason: 'hash-exists-in-cas(既有条目不触碰)' });
          status = null;
        } else {
          batchHashes.add(hash);
          const ext = MIME_EXT[thumbUrl(cat, a).mime];
          const dims = parseImageDims(buf, thumbUrl(cat, a).mime) ?? { width: 0, height: 0 };
          const mime = thumbUrl(cat, a).mime;
          const storageKey = `cas:${hash}.${ext}`;
          const id = nanoId();
          const tags = [SOURCE_TAG, `preset:${cat}`, `series:${a.series}`, `src-id:${srcId}`];
          if (cat === 'pose') {
            if (a.group) tags.push(`group:${a.group}`);
            if (Array.isArray(a.angles)) tags.push(`angles:${a.angles.join('+')}`);
          }
          if (typeof a.promptText === 'string' && a.promptText.trim()) tags.push(`prompt:${a.promptText}`);
          const asset = {
            id,
            cas: { hash, ext },
            title: String(a.name ?? srcId),
            kind: 'image',
            coverUrl: storageKey,
            tags,
            createdAt: nowIso(),
            bytes: buf.length,
            mimeType: mime,
            data: { kind: 'image', dataUrl: '', storageKey, width: dims.width, height: dims.height },
            folderId: null,
            favorite: false,
            scope: 'library',
          };
          imported.push({ asset, buf, relPath: `media/cas/${hash}.${ext}`, srcId, category: cat, url: thumbUrl(cat, a).url, angle });
        }
      } catch (err) {
        skipped.push({ srcId, title: a.name, category: cat, reason: `download-failed: ${err.message}` });
      }
      done++;
      if (done % 250 === 0) console.log(`  进度 ${done}/${batch.length}（成功 ${imported.length}，跳过/失败 ${skipped.length}）`);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(`下载完成：成功 ${imported.length}；跳过/失败 ${skipped.length}`);

  // 5. 写 CAS 物理文件（已存在同 hash 文件则跳过——由 existingCasHashes/batch 去重保证不冲突）
  let writtenFiles = 0;
  for (const it of imported) {
    const abs = path.join(ROOT, it.relPath);
    try {
      await fsp.stat(abs);
    } catch {
      await fsp.writeFile(abs, it.buf);
      writtenFiles++;
    }
  }
  console.log(`[import-presets] 新写入 media/cas 文件 ${writtenFiles} 个`);

  // 6. 合并 cas_index.json（只追加新条目，不动既有条目）
  const index = casIndex ?? { schemaVersion: 1, entries: {} };
  if (typeof index.entries !== 'object' || index.entries === null) index.entries = {};
  const now = nowIso();
  for (const it of imported) {
    if (index.entries[it.asset.cas.hash]) continue; // 理论不可达（前面已去重），双保险
    index.entries[it.asset.cas.hash] = {
      path: it.relPath,
      size: it.buf.length,
      mime: it.asset.mimeType,
      ext: it.asset.cas.ext,
      refCount: 1,
      createdAt: now,
      refs: [{ assetId: it.asset.id, projectId: 'library', kind: 'image' }],
    };
  }
  await fsp.writeFile(CAS_INDEX_JSON, JSON.stringify(index, null, 2));
  console.log(`[import-presets] cas_index.json 条目数: ${Object.keys(index.entries).length}`);

  // 7. 追加资产记录（信封 {__lf:1, value:[...]}；只 push，不改既有记录）
  const nextEnvelope = envelope ?? { __lf: 1, value: [] };
  if (!Array.isArray(nextEnvelope.value)) nextEnvelope.value = [];
  for (const it of imported) nextEnvelope.value.push(it.asset);
  await fsp.writeFile(ASSETS_JSON, JSON.stringify(nextEnvelope, null, 2));
  console.log(`[import-presets] 资产记录总数: ${nextEnvelope.value.length}（本次追加 ${imported.length}）`);

  // 8. 写导入报告
  const report = {
    appliedAt: nowIso(),
    source: 'infinite-canvas-main (web/src/data/system-presets)',
    root: ROOT,
    importedCount: imported.length,
    skippedCount: skipped.length,
    skippedByReason: skipped.reduce((m, s) => { m[s.reason] = (m[s.reason] ?? 0) + 1; return m; }, {}),
    imported: imported.map((it) => ({
      assetId: it.asset.id, srcId: it.srcId, category: it.category, title: it.asset.title,
      series: it.asset.tags.find((t) => t.startsWith('series:')), hash: it.asset.cas.hash,
      storageKey: it.asset.coverUrl, bytes: it.asset.bytes,
      width: it.asset.data.width, height: it.asset.data.height, url: it.url,
    })),
    skipped,
    unmappedSourceFields: {
      subtitle: '无对应 Asset 字段，未映射',
      'width/height(源)': '为 CDN full 档尺寸，对导入的 thumb 字节不实，未映射；data.width/height 由实测解析',
      'dataset.source/generatedAt': '数据集级元数据，不逐条落记录',
      'pose 多机位': '每条 pose 只导入默认机位（front 优先）一张缩略图；其余机位仍在源 CDN',
    },
  };
  const reportFile = path.join(backupDir, 'import-report.json');
  await fsp.writeFile(reportFile, JSON.stringify(report, null, 2));
  console.log(`[import-presets] 导入报告: ${reportFile}`);
  console.log(`[import-presets] 汇总：导入 ${imported.length}；跳过 ${skipped.length}（原因分布 ${JSON.stringify(report.skippedByReason)}）`);
  console.log('[import-presets] APPLY 完成');
}

main().catch((err) => {
  console.error('[import-presets] 失败:', err);
  process.exit(1);
});
