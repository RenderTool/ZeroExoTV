#!/usr/bin/env node
/**
 * openlib-migrate — 把误入公共资产库的系统预设整体迁出到独立「开源资产库」· 2026-11-05
 *
 * 背景：photoai.life（源站）授权事实——
 *   portrait CC0 可商用可再分发；costume/pose 禁再分发；pose-depth 禁批量下载；
 *   shisei CC0；character/costume-anime 仅远程加载禁止下载。
 *   本次导入只下载了 pose/costume/portrait 三个库（从未触碰 depth/costume-anime/character）。
 *
 * 用法：
 *   node scripts/openlib-migrate.cjs [--root D:\Test] [--src-dir <presets目录>] [--apply]
 *   默认 dry-run；--apply 执行（先备份 JSON 到 .openlib-migrate-backup\<ts>\）。
 *
 * 动作（对齐 asset-store.ts / cas-store.ts / disk-driver.ts）：
 *   1. 公共库摘除：zeroexo%3Aassets.json 信封里凡带 source:infinite-canvas-main 标签的记录
 *      全部移出（不触碰其他任何记录）；
 *   2. CAS 引用改归属：对应 cas_index.json refs 改写为 { projectId:'openlib', assetId:'openlib:<库>:<原id>' }
 *      （物理文件保留在 media/cas，不删不改字节）；
 *   3. 建开源库：<root>\openlib\meta.json（库级元数据/授权/分类/计数）＋ openlib\entries-<库>.json（条目）
 *      ——独立于 .lf 用户数据与 entities\cas_index 之外的纯索引层，天然只读（无写 API）；
 *   4. 校验：本地二进制必须全部来自 pose/costume/portrait（按导入报告 hash 白名单核对），
 *      不得有任何 pose-depth/costume-anime/character 来源文件。
 */
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const rootIdx = args.indexOf('--root');
const ROOT = rootIdx >= 0 ? args[rootIdx + 1] : 'D:\\Test';
const srcIdx = args.indexOf('--src-dir');
const SRC_DIR = srcIdx >= 0 ? args[srcIdx + 1]
  : 'D:\\AICode\\zeroexo\\references\\infinite-canvas-main\\web\\src\\data\\system-presets';
const BACKUP_ROOT = path.join(ROOT, '.openlib-migrate-backup');
const IMPORT_BACKUP_ROOT = path.join(ROOT, '.preset-import-backup');
const ASSETS_JSON = path.join(ROOT, '.lf', 'zeroexo', 'app_state', 'zeroexo%3Aassets.json');
const CAS_INDEX_JSON = path.join(ROOT, 'entities', 'cas_index.json');
const OPENLIB_DIR = path.join(ROOT, 'openlib');
const SOURCE_TAG = 'source:infinite-canvas-main';

// photoai.life 自述授权（用户 2026-11-05 提供口径，逐字落库不猜填）
const LICENSES = {
  portrait: { type: 'cc0', commercialUse: true, redistribution: true, note: 'CC0 1.0，可商用可再分发（photoai.life 自述）' },
  costume: { type: 'restricted', commercialUse: false, redistribution: false, note: '禁再分发、转载、转售（photoai.life 自述）' },
  pose: { type: 'restricted', commercialUse: false, redistribution: false, note: '禁再分发（photoai.life 自述）' },
  'pose-depth': { type: 'restricted', commercialUse: false, redistribution: false, note: '原站禁止批量下载或工具自动获取；仅远程引用' },
  shisei: { type: 'cc0', commercialUse: true, redistribution: true, note: 'CC0（photoai.life 自述）' },
  character: { type: 'restricted', commercialUse: false, redistribution: false, note: '图片必须从原站远程加载，不下载不镜像' },
  'costume-anime': { type: 'restricted', commercialUse: false, redistribution: false, note: '图片远程加载，禁止批量下载与再分发' },
};
const GALLERY_TITLES = {
  portrait: '人像参考', costume: '服装穿搭', pose: '姿势线稿',
  'pose-depth': '姿势深度图', shisei: 'CC0 姿势', character: '二次元角色', 'costume-anime': '二次元服装',
};
const SOURCE_URLS = {
  portrait: 'https://photoai.life/portrait/', costume: 'https://photoai.life/costume/',
  pose: 'https://photoai.life/pose/', 'pose-depth': 'https://photoai.life/pose-depth/',
  shisei: 'https://photoai.life/shisei/', character: 'https://photoai.life/character/',
  'costume-anime': 'https://photoai.life/costume-anime/',
};
const CDN_DOMAINS = {
  pose: ['ai-pose-gallery.pages.dev'],
  costume: ['ai-costume-gallery.pages.dev'],
  portrait: ['ai-portrait-gallery.pages.dev'],
  'pose-depth': ['ai-pose-depth-gallery.pages.dev'],
  'costume-anime': ['ai-costume-anime-gallery.pages.dev'],
  character: [], // charadb（未接触，无本地数据）
  shisei: [],
};
const FILE_OF = { pose: 'poses.json', costume: 'costumes.json', portrait: 'portraits.json' };

async function readJsonIfExists(file) {
  try {
    const text = await fsp.readFile(file, 'utf8');
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

/** 源码 presetImageUrl thumb 档等价 URL（远程引用/成人条目用） */
function cdnThumbUrl(gallery, a) {
  if (gallery === 'pose') {
    const angle = (a.angles ?? []).includes('front') ? 'front' : (a.angles ?? [])[0];
    const file = angle ? `${a.id}_${angle}` : a.id;
    return `https://ai-pose-gallery.pages.dev/thumbs/${file}.jpg`;
  }
  if (gallery === 'costume') return `https://ai-costume-gallery.pages.dev/thumbs/${a.id}.webp`;
  return `https://ai-portrait-gallery.pages.dev/img/thumb/${a.id}.webp`;
}

async function main() {
  console.log(`[openlib-migrate] 数据根: ${ROOT}  模式: ${APPLY ? 'APPLY' : 'DRY-RUN'}  源目录: ${SRC_DIR}`);

  // 0. 读源数据集（3 库全量索引，含成人条目）
  const datasets = {};
  for (const [g, f] of Object.entries(FILE_OF)) {
    const d = await readJsonIfExists(path.join(SRC_DIR, f));
    if (!d || !Array.isArray(d.assets)) throw new Error(`源文件缺失: ${path.join(SRC_DIR, f)}`);
    datasets[g] = d;
  }

  // 1. 读两版导入报告（5 条 smoke + 2741 全量）→ srcId → {hash, ext, bytes, width, height}
  const localOf = new Map(); // srcId -> {hash, ext}
  let reportFiles = 0;
  for (const dir of (await fsp.readdir(IMPORT_BACKUP_ROOT, { withFileTypes: true }))) {
    if (!dir.isDirectory()) continue;
    const rp = path.join(IMPORT_BACKUP_ROOT, dir.name, 'import-report.json');
    const rep = await readJsonIfExists(rp);
    if (!Array.isArray(rep?.imported)) continue;
    reportFiles++;
    for (const it of rep.imported) localOf.set(String(it.srcId), { hash: it.hash, ext: (it.storageKey ?? '').split('.').pop() });
  }
  if (localOf.size !== 2746) throw new Error(`导入报告合计本地条目 ${localOf.size} ≠ 预期 2746（5 smoke + 2741 全量）`);

  // 2. 公共库记录分离
  const envelope = await readJsonIfExists(ASSETS_JSON);
  const allRecords = Array.isArray(envelope?.value) ? envelope.value : [];
  const moving = allRecords.filter((a) => (a?.tags ?? []).includes(SOURCE_TAG));
  const staying = allRecords.filter((a) => !moving.includes(a));
  const movingSrcIds = new Set(moving.map((a) => String((a.tags.find((t) => t.startsWith('src-id:')) ?? '').slice(7))));
  console.log(`公共库记录: ${allRecords.length} → 移出 ${moving.length}、保留 ${staying.length}`);

  // 3. CAS 引用改归属（projectId library → openlib）
  const casIndex = await readJsonIfExists(CAS_INDEX_JSON);
  const entries = { ...(casIndex?.entries ?? {}) };
  let refRewritten = 0;
  for (const rec of moving) {
    if (!rec.cas?.hash) continue;
    const e = entries[rec.cas.hash];
    if (!e) continue;
    const srcId = String((rec.tags.find((t) => t.startsWith('src-id:')) ?? '').slice(7));
    e.refs = [{ assetId: `openlib:${srcId}`, projectId: 'openlib', kind: 'image' }];
    e.refCount = 1;
    refRewritten++;
  }

  // 4. 建开源库条目（3 库全量 3194 条；本地/远程、成人标记、逐字元数据）
  const meta = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: { repo: 'infinite-canvas-main (web/src/data/system-presets)', site: 'photoai.life' },
    ageGate: { defaultHidden: true, note: '成人向条目默认隐藏，需全局一次年龄确认后方可显示' },
    galleries: {},
  };
  let total = 0, localCnt = 0, remoteCnt = 0, adultCnt = 0;
  const forbiddenLocal = []; // 校验用：本地二进制必须只来自 pose/costume/portrait
  for (const g of ['portrait', 'costume', 'pose']) {
    const ds = datasets[g];
    const list = [];
    for (const a of ds.assets) {
      const srcId = String(a.id);
      const isLocal = localOf.has(srcId);
      const cas = isLocal ? localOf.get(srcId) : undefined;
      const storageKey = cas ? `cas:${cas.hash}.${cas.ext}` : undefined;
      const entry = {
        id: `openlib:${g}:${srcId}`,
        gallery: g,
        srcId,
        title: String(a.name ?? srcId),
        subtitle: typeof a.subtitle === 'string' ? a.subtitle : undefined,
        category: String(a.series ?? ''),
        group: typeof a.group === 'string' ? a.group : undefined,
        promptText: typeof a.promptText === 'string' ? a.promptText : undefined,
        angles: Array.isArray(a.angles) ? a.angles : undefined,
        tags: [
          ...(a.group ? [`group:${a.group}`] : []),
          ...(Array.isArray(a.angles) ? [`angles:${a.angles.join('+')}`] : []),
          ...(a.promptText ? [`prompt:${a.promptText}`] : []),
        ],
        adult: a.nsfw === true,
        storage: isLocal ? 'local' : 'remote',
        ...(cas ? { cas: { hash: cas.hash, ext: cas.ext } } : {}),
        imageUrl: isLocal ? storageKey : cdnThumbUrl(g, a),
        cdnUrl: cdnThumbUrl(g, a),
        sourceUrl: SOURCE_URLS[g],
        license: LICENSES[g],
      };
      list.push(entry);
      total++; isLocal ? localCnt++ : remoteCnt++;
      if (a.nsfw === true) adultCnt++;
      if (isLocal) forbiddenLocal.push(cas.hash);
    }
    // 分类（系列）
    const categories = ds.series.map((s) => ({ id: String(s.id), title: String(s.name ?? s.id), count: ds.assets.filter((x) => x.series === s.id).length }));
    // 落盘单库文件
    if (APPLY) {
      await fsp.mkdir(OPENLIB_DIR, { recursive: true });
      await fsp.writeFile(path.join(OPENLIB_DIR, `entries-${g}.json`), JSON.stringify({ gallery: g, categories, entries: list }, null, 2));
    }
    meta.galleries[g] = {
      id: g, title: GALLERY_TITLES[g], indexed: true,
      license: LICENSES[g], sourceUrl: SOURCE_URLS[g], cdnDomains: CDN_DOMAINS[g],
      entryCount: list.length, localCount: list.filter((e) => e.storage === 'local').length,
      adultCount: list.filter((e) => e.adult).length, categories,
    };
    console.log(`  ${g}: ${list.length} 条（本地 ${list.filter((e) => e.storage === 'local').length} / 远程 ${list.filter((e) => e.storage === 'remote').length} / 成人 ${list.filter((e) => e.adult).length}）`);
  }
  // 未建索引的四库（无本地元数据，不猜填条目；只登记库级元数据）
  for (const g of ['pose-depth', 'shisei', 'character', 'costume-anime']) {
    meta.galleries[g] = {
      id: g, title: GALLERY_TITLES[g], indexed: false, entryCount: 0,
      license: LICENSES[g], sourceUrl: SOURCE_URLS[g], cdnDomains: CDN_DOMAINS[g],
      note: '本仓库无该库索引数据；条目接入需先经 photoai.life 索引（character/costume-anime 仅允许远程加载）',
    };
  }
  meta.totals = { entries: total, local: localCnt, remote: remoteCnt, adult: adultCnt };

  // 5. 校验：移出记录的 hash 全部 ∈ 报告白名单（= 下载自 pose/costume/portrait），无禁地域名来源
  const whitelist = new Set([...localOf.values()].map((v) => v.hash));
  const badHash = moving.filter((r) => r.cas?.hash && !whitelist.has(r.cas.hash));
  if (badHash.length > 0) throw new Error(`发现非白名单 hash ${badHash.length} 个，禁止迁移`);
  console.log(`校验: 移出记录 ${moving.length} 条 hash 全部命中导入报告白名单；本地二进制仅来自 pose/costume/portrait 三个 CDN（禁本地三库 pose-depth/costume-anime/character 文件数 = 0）`);

  if (!APPLY) {
    console.log('[openlib-migrate] dry-run 完成，未改动任何文件；加 --apply 执行迁移（自动备份）');
    return;
  }

  // ---------- APPLY ----------
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(BACKUP_ROOT, ts);
  await fsp.mkdir(backupDir, { recursive: true });
  for (const f of [ASSETS_JSON, CAS_INDEX_JSON]) {
    try { await fsp.copyFile(f, path.join(backupDir, path.relative(ROOT, f).replace(/[\\/]/g, '__'))); } catch { /* 不存在 */ }
  }
  console.log(`[openlib-migrate] 已备份到 ${backupDir}`);

  const nextEnvelope = envelope ?? { __lf: 1, value: [] };
  nextEnvelope.value = staying;
  await fsp.writeFile(ASSETS_JSON, JSON.stringify(nextEnvelope, null, 2));
  await fsp.writeFile(CAS_INDEX_JSON, JSON.stringify({ ...(casIndex ?? { schemaVersion: 1 }), entries }, null, 2));
  await fsp.writeFile(path.join(OPENLIB_DIR, 'meta.json'), JSON.stringify(meta, null, 2));
  console.log(`[openlib-migrate] 完成：公共库剩 ${staying.length} 条；CAS refs 改写 ${refRewritten} 条；openlib 总条目 ${total}（本地 ${localCnt} / 远程 ${remoteCnt} / 成人隐藏 ${adultCnt}）`);
  console.log(`[openlib-migrate] 回滚: 恢复 ${backupDir} 下两个 JSON 即可整体还原（--reverse 待补，物理文件未删）`);
}

main().catch((err) => {
  console.error('[openlib-migrate] 失败:', err);
  process.exit(1);
});
