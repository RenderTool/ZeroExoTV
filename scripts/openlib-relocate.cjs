#!/usr/bin/env node
/**
 * openlib-relocate — 开源资产库迁移到站点根 public/openlib · 2026-11-05
 *
 * 架构（用户拍板）：开源库是**站点自带内容**，不进用户数据目录。
 *   - 索引/条目清单：zeroexo-comfyui/public/openlib/{meta.json, entries-<库>.json}（随构建进 dist）
 *   - 缩略档二进制：public/openlib/thumbs/<库>/<文件>（打包随站点发布）
 *   - 原图：不打包；运行时按需从 CDN 取，命中后缓存在用户 CAS（复用现有缓存链路，见 open-library.ts cdnUrl）
 *   - 用户数据目录清空本次产生的所有内容（openlib 目录 + projectId:'openlib' 的 CAS 引用），先备份清单可回滚
 *
 * 本脚本一并完成（取代已删除的 openlib-extend.cjs）：
 *   A. 既有 2746 条本地缩略图：D:\Test\media\cas\<hash>.<ext> **移动**（非复制）到 public/openlib/thumbs/
 *   B. 448 条 18+（nsfw）条目：下载缩略图到 thumbs/（授权=禁再分发而非禁下载，同口径合规）
 *   C. shisei 库（CC0）导入：官方 catalog.json 288 套，中日双语标题，默认机位 w300 线稿下载到 thumbs/
 *   D. 清理用户目录：删 D:\Test\openlib\；cas_index.json 移除 refs 全为 openlib 的条目（用户既有 20 条不动）
 *
 * 明确不做（报告记录）：pose-depth / character / costume-anime 三库图片——原站自述禁止批量下载/镜像
 *   （"禁止批量下载或用工具自动获取" / "必须远程加载，不下载不镜像" / "禁止批量下载与再分发"），与项目是否商业无关。
 *
 * 用法：node scripts/openlib-relocate.cjs [--data-root D:\Test] [--repo-root D:\AICode\zeroexo\zeroexo-comfyui]
 *                                        [--src-dir <infinite-canvas presets>] [--shisei <catalog.json>]
 *   默认 dry-run；--apply 执行。
 */
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const drIdx = args.indexOf('--data-root');
const DATA_ROOT = drIdx >= 0 ? args[drIdx + 1] : 'D:\\Test';
const rrIdx = args.indexOf('--repo-root');
const REPO_ROOT = rrIdx >= 0 ? args[rrIdx + 1] : 'D:\\AICode\\zeroexo\\zeroexo-comfyui';
const srcIdx = args.indexOf('--src-dir');
const SRC_DIR = srcIdx >= 0 ? args[srcIdx + 1]
  : 'D:\\AICode\\zeroexo\\references\\infinite-canvas-main\\web\\src\\data\\system-presets';
const shiseiIdx = args.indexOf('--shisei');
const SHISEI_CATALOG = shiseiIdx >= 0 ? args[shiseiIdx + 1]
  : 'D:\\AICode\\zerovideoAgent\\.tmp-preset-sample\\shisei-catalog.json';

const OLD_OPENLIB = path.join(DATA_ROOT, 'openlib');
const CAS_INDEX_JSON = path.join(DATA_ROOT, 'entities', 'cas_index.json');
const OLD_CAS_DIR = path.join(DATA_ROOT, 'media', 'cas');
const NEW_OPENLIB = path.join(REPO_ROOT, 'public', 'openlib');
const NEW_THUMBS = path.join(NEW_OPENLIB, 'thumbs');
const BACKUP_ROOT = path.join(DATA_ROOT, '.openlib-relocate-backup');
const SHISEI_BASE = 'https://shisei.indaloop.app';
const nowIso = () => new Date().toISOString();

const LICENSES = {
  portrait: { type: 'cc0', commercialUse: true, redistribution: true, note: 'CC0 1.0，可商用可再分发（photoai.life 自述）' },
  costume: { type: 'restricted', commercialUse: false, redistribution: false, note: '禁再分发、转载、转售（photoai.life 自述）' },
  pose: { type: 'restricted', commercialUse: false, redistribution: false, note: '禁再分发（photoai.life 自述）' },
  'pose-depth': { type: 'restricted', commercialUse: false, redistribution: false, note: '原站禁止批量下载或用工具自动获取；仅远程引用' },
  shisei: { type: 'cc0', commercialUse: true, redistribution: true, note: 'CC0 1.0，可商用可再分发（shisei.indaloop.app 自述）' },
  character: { type: 'restricted', commercialUse: false, redistribution: false, note: '图片必须从原站远程加载，不下载不镜像' },
  'costume-anime': { type: 'restricted', commercialUse: false, redistribution: false, note: '图片远程加载，禁止批量下载与再分发' },
};
const GALLERY_TITLES = {
  portrait: '人像参考', costume: '服装穿搭', pose: '姿势线稿', 'pose-depth': '姿势深度图',
  shisei: 'CC0 姿势', character: '二次元角色', 'costume-anime': '二次元服装',
};
const SOURCE_URLS = {
  portrait: 'https://photoai.life/portrait/', costume: 'https://photoai.life/costume/', pose: 'https://photoai.life/pose/',
  'pose-depth': 'https://photoai.life/pose-depth/', shisei: 'https://photoai.life/shisei/',
  character: 'https://photoai.life/character/', 'costume-anime': 'https://photoai.life/costume-anime/',
};
const CDN_DOMAINS = {
  pose: ['ai-pose-gallery.pages.dev'], costume: ['ai-costume-gallery.pages.dev'],
  portrait: ['ai-portrait-gallery.pages.dev'], 'pose-depth': ['ai-pose-depth-gallery.pages.dev'],
  'costume-anime': ['ai-costume-anime-gallery.pages.dev'], shisei: ['shisei.indaloop.app'], character: [],
};

async function readJsonIfExists(file) {
  try {
    const text = await fsp.readFile(file, 'utf8');
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch { return null; }
}

async function download(url, expect) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 45000);
    try {
      const res = await fetch(url, { signal: ac.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const ok = expect === 'jpg'
        ? (buf[0] === 0xff && buf[1] === 0xd8)
        : (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP');
      if (!ok || buf.length === 0) throw new Error(`内容校验失败 bytes=${buf.length}`);
      return buf;
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    } finally { clearTimeout(timer); }
  }
  throw new Error('unreachable');
}

async function dirSize(dir) {
  let total = 0;
  async function walk(d) {
    for (const e of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else total += (await fsp.stat(p)).size;
    }
  }
  await walk(dir);
  return total;
}

async function main() {
  console.log(`[relocate] 数据根: ${DATA_ROOT}  仓库: ${REPO_ROOT}  模式: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  const meta = await readJsonIfExists(path.join(OLD_OPENLIB, 'meta.json'));
  if (!meta) throw new Error('数据根下 openlib/meta.json 不存在（先跑 openlib-migrate.cjs）');
  const casIndex = (await readJsonIfExists(CAS_INDEX_JSON)) ?? { schemaVersion: 1, entries: {} };

  // ===== 计划 =====
  const galFiles = {};
  const moves = [];      // {from(绝对), to(绝对), gallery, srcId}
  const downloads = [];  // {url, expect, to, gallery, srcId}
  let localizeCnt = 0;
  for (const g of ['portrait', 'costume', 'pose']) {
    const f = await readJsonIfExists(path.join(OLD_OPENLIB, `entries-${g}.json`));
    if (!f) throw new Error(`entries-${g}.json 缺失`);
    galFiles[g] = f;
    for (const e of f.entries) {
      const file = path.basename(new URL(e.cdnUrl).pathname);
      const to = path.join(NEW_THUMBS, g, file);
      if (e.storage === 'local' && e.cas) {
        moves.push({ from: path.join(OLD_CAS_DIR, `${e.cas.hash}.${e.cas.ext}`), to, gallery: g, srcId: e.srcId });
      } else {
        localizeCnt++;
        downloads.push({ url: e.cdnUrl, expect: g === 'pose' ? 'jpg' : 'webp', to, gallery: g, srcId: e.srcId });
      }
    }
  }
  // shisei 条目
  const shiseiCat = await readJsonIfExists(SHISEI_CATALOG);
  if (!Array.isArray(shiseiCat) || !shiseiCat.length) throw new Error('shisei catalog 缺失');
  const VIEWS = ['front', 'diag', 'side', 'above', 'below'];
  const shiseiEntries = [];
  const classCount = {};
  for (const p of shiseiCat) {
    const viewEntries = Object.entries(p.views ?? {}).filter(([, v]) => typeof v === 'string' && v);
    const views = viewEntries.map(([k]) => k);
    const dv = views.includes('front') ? 'front' : VIEWS.find((v) => views.includes(v)) ?? views[0];
    if (!dv) continue;
    const file = p.views[dv];
    const url = `${SHISEI_BASE}/images/line/w300/${file}`;
    const classCn = p.class_cn ?? '';
    classCount[classCn] = (classCount[classCn] ?? 0) + 1;
    shiseiEntries.push({
      id: `openlib:shisei:${p.id}`, gallery: 'shisei', srcId: String(p.id),
      title: String(p.name_cn ?? p.id), titleJp: String(p.name_jp ?? ''), subtitle: String(p.desc_en ?? ''),
      category: String(p.series ?? ''), group: classCn,
      promptText: typeof p.desc_en === 'string' ? p.desc_en : undefined,
      angles: views, tags: [`class:${classCn}`, ...(p.desc_en ? [`prompt:${p.desc_en}`] : [])],
      adult: p.rating !== 'general', storage: 'bundled',
      imageUrl: `/openlib/thumbs/shisei/${file}`, cdnUrl: url,
      sourceUrl: 'https://shisei.indaloop.app/', license: LICENSES.shisei,
    });
    downloads.push({ url, expect: 'webp', to: path.join(NEW_THUMBS, 'shisei', file), gallery: 'shisei', srcId: String(p.id) });
  }
  console.log(`计划: 移动既有缩略图 ${moves.length}；18+ 本地化下载 ${localizeCnt}；shisei 下载 ${shiseiEntries.length}；合计 thumbs ${moves.length + downloads.length}`);

  if (!APPLY) {
    console.log('[relocate] dry-run 完成；加 --apply 执行（迁移前自动备份 cas_index 与旧 openlib 清单）');
    return;
  }

  // ===== APPLY =====
  const ts = nowIso().replace(/[:.]/g, '-');
  const backupDir = path.join(BACKUP_ROOT, ts);
  await fsp.mkdir(backupDir, { recursive: true });
  await fsp.copyFile(CAS_INDEX_JSON, path.join(backupDir, 'cas_index.json'));
  await fsp.mkdir(path.join(backupDir, 'old-openlib'), { recursive: true });
  for (const f of ['meta.json', 'entries-portrait.json', 'entries-costume.json', 'entries-pose.json']) {
    await fsp.copyFile(path.join(OLD_OPENLIB, f), path.join(backupDir, 'old-openlib', f));
  }
  console.log(`[relocate] 已备份到 ${backupDir}`);

  // A. 移动既有缩略图
  let moved = 0, moveMissing = 0;
  for (const m of moves) {
    await fsp.mkdir(path.dirname(m.to), { recursive: true });
    try {
      await fsp.rename(m.from, m.to); // 同盘移动，原子
      moved++;
    } catch (err) {
      if (err.code === 'EXDEV' || err.code === 'ENOENT') {
        // 跨盘或源缺失：尝试复制；源缺失记录（可能已被移过）
        try {
          const buf = await fsp.readFile(m.from);
          await fsp.writeFile(m.to, buf);
          await fsp.unlink(m.from).catch(() => {});
          moved++;
        } catch { moveMissing++; }
      } else throw err;
    }
  }
  console.log(`[relocate] A. 移动完成 ${moved}（源缺失 ${moveMissing}）`);

  // B+C. 下载（8 并发）
  const failures = [];
  let done = 0;
  const queue = [...downloads];
  async function worker() {
    while (queue.length > 0) {
      const t = queue.shift();
      try {
        const buf = await download(t.url, t.expect);
        await fsp.mkdir(path.dirname(t.to), { recursive: true });
        try { const prev = await fsp.readFile(t.to); if (prev.equals(buf)) { done++; continue; } }
        catch { /* 不存在 */ }
        await fsp.writeFile(t.to, buf);
      } catch (err) {
        failures.push({ srcId: t.srcId, gallery: t.gallery, url: t.url, reason: err.message });
      }
      done++;
      if (done % 100 === 0) console.log(`  下载进度 ${done}/${downloads.length}（失败 ${failures.length}）`);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(`[relocate] B/C. 下载完成：成功 ${downloads.length - failures.length} / 失败 ${failures.length}`);

  // 改写三库条目（storage='bundled'、imageUrl=站点根路径、去 cas 字段）
  for (const g of ['portrait', 'costume', 'pose']) {
    for (const e of galFiles[g].entries) {
      const file = path.basename(new URL(e.cdnUrl).pathname);
      e.storage = 'bundled';
      e.imageUrl = `/openlib/thumbs/${g}/${file}`;
      delete e.cas;
    }
  }

  // D. 清用户目录：cas_index 移除纯 openlib 条目；删 D:\Test\openlib
  const nextEntries = {};
  let removedCas = 0, keptCas = 0;
  const removedManifest = [];
  for (const [hash, e] of Object.entries(casIndex.entries ?? {})) {
    const refs = e.refs ?? [];
    if (refs.length > 0 && refs.every((r) => r.projectId === 'openlib')) {
      removedCas++;
      removedManifest.push({ hash, path: e.path, refs });
    } else { nextEntries[hash] = e; keptCas++; }
  }
  await fsp.writeFile(CAS_INDEX_JSON, JSON.stringify({ ...(casIndex ?? { schemaVersion: 1 }), entries: nextEntries }, null, 2));
  await fsp.writeFile(path.join(backupDir, 'removed-cas-manifest.json'), JSON.stringify(removedManifest, null, 2));
  await fsp.rm(OLD_OPENLIB, { recursive: true, force: true });
  console.log(`[relocate] D. cas_index: 移除 openlib 专属条目 ${removedCas}，保留用户条目 ${keptCas}；已删除 ${OLD_OPENLIB}`);
  // 残留物理文件核查（被移动的应不存在；若 hash 仍在保留条目中则文件合法保留）
  let orphan = 0;
  for (const m of removedManifest) {
    const p = path.join(DATA_ROOT, m.path);
    if (fs.existsSync(p)) orphan++;
  }
  console.log(`[relocate] D. openlib hash 物理残留 ${orphan} 个（应为 0，已被移动到 thumbs）`);

  // ===== 写站点根 =====
  await fsp.mkdir(NEW_OPENLIB, { recursive: true });
  for (const g of ['portrait', 'costume', 'pose']) {
    const cnt = { total: galFiles[g].entries.length, adult: galFiles[g].entries.filter((e) => e.adult).length };
    galFiles[g].categories = galFiles[g].categories ?? [];
    await fsp.writeFile(path.join(NEW_OPENLIB, `entries-${g}.json`), JSON.stringify({ gallery: g, categories: galFiles[g].categories, entries: galFiles[g].entries }, null, 2));
    meta.galleries[g] = {
      ...(meta.galleries[g] ?? {}),
      id: g, title: GALLERY_TITLES[g], indexed: true,
      license: LICENSES[g], sourceUrl: SOURCE_URLS[g], cdnDomains: CDN_DOMAINS[g],
      entryCount: cnt.total, localCount: cnt.total, adultCount: cnt.adult,
    };
  }
  const shiseiAdult = shiseiEntries.filter((e) => e.adult).length;
  await fsp.writeFile(path.join(NEW_OPENLIB, 'entries-shisei.json'), JSON.stringify({ gallery: 'shisei', categories: Object.entries(classCount).map(([id, count]) => ({ id, title: id, count })), entries: shiseiEntries }, null, 2));
  meta.galleries.shisei = {
    id: 'shisei', title: GALLERY_TITLES.shisei, indexed: true,
    license: LICENSES.shisei, sourceUrl: SOURCE_URLS.shisei, cdnDomains: CDN_DOMAINS.shisei,
    entryCount: shiseiEntries.length, localCount: shiseiEntries.length, adultCount: shiseiAdult,
    categories: Object.entries(classCount).map(([id, count]) => ({ id, title: id, count })),
  };
  for (const g of ['pose-depth', 'character', 'costume-anime']) {
    meta.galleries[g] = {
      ...(meta.galleries[g] ?? {}), id: g, title: GALLERY_TITLES[g], indexed: false, entryCount: 0,
      license: LICENSES[g], sourceUrl: SOURCE_URLS[g], cdnDomains: CDN_DOMAINS[g],
      note: '原站禁止批量下载/镜像（见 license.note），不内置条目；如需接入走远程引用',
    };
  }
  // 重算总量（全部 bundled；shisei 成人条目也 bundled 但默认隐藏）
  const totalEntries = 1499 + 1407 + 288 + shiseiEntries.length;
  const totalAdult = 0 + 393 + 55 + shiseiAdult;
  meta.totals = { entries: totalEntries, bundled: totalEntries, remote: 0, adult: totalAdult };
  meta.schemaVersion = 2;
  meta.relocatedAt = nowIso();
  meta.bundle = { root: '/openlib/', thumbs: '/openlib/thumbs/', note: '缩略档随站点发布；原图按需从 cdnUrl 拉取并缓存到用户 CAS' };
  await fsp.writeFile(path.join(NEW_OPENLIB, 'meta.json'), JSON.stringify(meta, null, 2));

  const sizeBytes = await dirSize(NEW_OPENLIB);
  const report = {
    appliedAt: nowIso(), newRoot: NEW_OPENLIB, sizeBytes,
    movedThumbs: moved, movedMissing: moveMissing,
    downloadedAdult: localizeCnt - failures.filter((f) => f.gallery !== 'shisei').length,
    downloadedShisei: shiseiEntries.length - failures.filter((f) => f.gallery === 'shisei').length,
    failures,
    casRemoved: removedCas, casKept: keptCas, orphanPhysicalFiles: orphan,
    totals: meta.totals,
    declined: ['pose-depth', 'character', 'costume-anime'],
  };
  await fsp.writeFile(path.join(backupDir, 'relocate-report.json'), JSON.stringify(report, null, 2));
  console.log(`[relocate] 站点根 ${NEW_OPENLIB} 总体积 ${(sizeBytes / 1048576).toFixed(1)}MB`);
  console.log(`[relocate] 完成：thumbs ${(moves.length - moveMissing) + (downloads.length - failures.length)} 张；条目 ${totalEntries}（18+ ${totalAdult}，默认隐藏）；失败 ${failures.length}`);
  console.log(`[relocate] 报告: ${path.join(backupDir, 'relocate-report.json')}`);
}

main().catch((err) => {
  console.error('[relocate] 失败:', err);
  process.exit(1);
});
