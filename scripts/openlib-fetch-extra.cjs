#!/usr/bin/env node
/**
 * openlib-fetch-extra — 补齐 pose-depth / character / costume-anime 三库 · 2026-11-05
 *
 * 站点所有者拍板：三库按"站点自带"路径全量下载（缩略档随构建发布，非商用自用镜像）。
 *   - pose-depth:   https://ai-pose-depth-gallery.pages.dev/index.json（1439 文件级条目）
 *   - costume-anime: https://ai-costume-anime-gallery.pages.dev/index.json（1320 套）
 *   - character:    https://charadb-2fi.pages.dev/data.js（1027 条目：hair306/outfit440/pose281）
 *
 * 输出对齐既有四库 schema：thumbs 进 public/openlib/thumbs/<库>/，索引 entries-<库>.json，meta.json 增量更新。
 * 不触碰已有四库（portrait/costume/pose/shisei）的任何文件。
 * 失败重试 3 次，最终失败记录原因分类；体积超 300MB 需人工评估懒加载（本脚本会打印总体积）。
 *
 * 用法：node scripts/openlib-fetch-extra.cjs [--repo-root <仓库>] [--cache-dir <索引缓存目录>] [--apply]
 */
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const rrIdx = args.indexOf('--repo-root');
const REPO_ROOT = rrIdx >= 0 ? args[rrIdx + 1] : 'D:\\AICode\\zeroexo\\zeroexo-comfyui';
const cdIdx = args.indexOf('--cache-dir');
const CACHE_DIR = cdIdx >= 0 ? args[cdIdx + 1] : 'D:\\AICode\\zerovideoAgent\\.tmp-preset-sample';

const OPENLIB = path.join(REPO_ROOT, 'public', 'openlib');
const META_JSON = path.join(OPENLIB, 'meta.json');
const nowIso = () => new Date().toISOString();

const CDN = {
  'pose-depth': 'https://ai-pose-depth-gallery.pages.dev',
  'costume-anime': 'https://ai-costume-anime-gallery.pages.dev',
  character: 'https://charadb-2fi.pages.dev',
};
const SOURCE_URLS = {
  'pose-depth': 'https://photoai.life/pose-depth/',
  'costume-anime': 'https://photoai.life/costume-anime/',
  character: 'https://charadb-2fi.pages.dev/',
};
const TITLES = { 'pose-depth': '姿势深度图', 'costume-anime': '二次元服装', character: '二次元角色' };
const LICENSE_RESTRICTED = { type: 'restricted', commercialUse: false, redistribution: false, note: '原站自述限再分发；本站所有者决定作为站点自带内容镜像（非商用自用）' };

async function readJson(file) {
  const text = await fsp.readFile(file, 'utf8');
  return JSON.parse(text.replace(/^﻿/, ''));
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
      if (!ok || buf.length === 0) throw new Error(`magic 校验失败 bytes=${buf.length}`);
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

function entryBase(gallery, srcId) {
  return { id: `openlib:${gallery}:${srcId}`, gallery, srcId: String(srcId), storage: 'bundled', sourceUrl: SOURCE_URLS[gallery], license: LICENSE_RESTRICTED };
}

async function main() {
  console.log(`[fetch-extra] 仓库: ${REPO_ROOT}  模式: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  const meta = await readJson(META_JSON);

  // ===== 1. 读三库索引 =====
  const depthIdx = await readJson(path.join(CACHE_DIR, 'depth-index.json'));
  const animeIdx = await readJson(path.join(CACHE_DIR, 'anime-index.json'));
  const charaObjText = (await fsp.readFile(path.join(CACHE_DIR, 'charadb-data.js'), 'utf8'))
    .match(/window\.DB\s*=\s*(\{[\s\S]*\})\s*;?\s*$/)[1];
  const charaDb = (0, eval)(`(${charaObjText})`); // JS 对象字面量（键不带引号），eval 解析
  const charaItems = charaDb.items;
  if (!Array.isArray(depthIdx.items) || !Array.isArray(animeIdx.items) || !Array.isArray(charaItems)) throw new Error('索引结构异常');
  console.log(`索引: depth=${depthIdx.items.length} anime=${animeIdx.items.length} character=${charaItems.length}`);

  // ===== 2. 组装条目 =====
  const tasks = []; // {url, expect, to, gallery, srcId}
  const libs = {};  // gallery -> {entries, categories}

  // pose-depth（文件级条目；系統含セクシー → adult）
  {
    const entries = [];
    const catCount = {};
    for (const it of depthIdx.items) {
      const srcId = String(it.id);
      const adult = /セクシー|sexy/i.test(String(it.系統 ?? ''));
      const file = path.basename(String(it.サムネ));
      const url = `${CDN['pose-depth']}/thumbs/${file}`;
      const cat = String(it.系統 ?? '');
      catCount[cat] = (catCount[cat] ?? 0) + 1;
      entries.push({
        ...entryBase('pose-depth', srcId),
        title: String(it.ポーズ名 ?? srcId), titleJp: String(it.ポーズ名 ?? ''),
        subtitle: `${String(it.分類 ?? '')}・${String(it.アングル ?? '')}`,
        category: cat, group: String(it.分類 ?? ''), promptText: undefined,
        angles: [String(it.アングル ?? '')],
        tags: [`angle:${String(it.アングル ?? '')}`, `pose:${String(it.ポーズ番号 ?? '')}`, ...(it.原寸 ? [`full:${path.basename(String(it.原寸))}`] : [])],
        adult, imageUrl: `/openlib/thumbs/pose-depth/${file}`, cdnUrl: url,
      });
      tasks.push({ url, expect: 'jpg', to: path.join(OPENLIB, 'thumbs', 'pose-depth', file), gallery: 'pose-depth', srcId });
    }
    libs['pose-depth'] = { entries, categories: Object.entries(catCount).map(([id, count]) => ({ id, title: id, count })) };
  }

  // costume-anime（套装条目，キーワード为提示词）
  {
    const entries = [];
    const catCount = {};
    for (const it of animeIdx.items) {
      const srcId = String(it.id);
      const file = `${srcId}.webp`;
      const url = `${CDN['costume-anime']}/thumbs/${file}`;
      const cat = String(it.カテゴリ ?? '');
      catCount[cat] = (catCount[cat] ?? 0) + 1;
      entries.push({
        ...entryBase('costume-anime', srcId),
        title: srcId, titleJp: undefined, subtitle: undefined,
        category: cat, group: undefined,
        promptText: typeof it.キーワード === 'string' && it.キーワード ? it.キーワード : undefined,
        angles: undefined,
        tags: [...(it.キーワード ? [`prompt:${it.キーワード}`] : [])],
        adult: false, imageUrl: `/openlib/thumbs/costume-anime/${file}`, cdnUrl: url,
      });
      tasks.push({ url, expect: 'webp', to: path.join(OPENLIB, 'thumbs', 'costume-anime', file), gallery: 'costume-anime', srcId });
    }
    libs['costume-anime'] = { entries, categories: Object.entries(catCount).map(([id, count]) => ({ id, title: id, count })) };
  }

  // character（hair/outfit/pose；title=jp；pose=线稿）
  {
    const entries = [];
    const catCount = {};
    for (const it of charaItems) {
      const srcId = String(it.id);
      const file = `${srcId}.webp`;
      const url = `${CDN.character}/thumb/${file}`;
      const cat = String(it.set ?? '');
      catCount[cat] = (catCount[cat] ?? 0) + 1;
      entries.push({
        ...entryBase('character', srcId),
        title: String(it.jp ?? srcId), titleJp: String(it.jp ?? ''),
        subtitle: undefined,
        category: cat, group: String(it.cat ?? ''),
        promptText: typeof it.tags === 'string' && it.tags ? it.tags : undefined,
        angles: undefined,
        tags: [
          `set:${cat}`, ...(it.sub ? [`sub:${it.sub}`] : []),
          ...(it.parent ? [`parent:${it.parent}`] : []),
          ...(it.line === true ? ['line-art'] : []),
          ...(it.tags ? [`prompt:${it.tags}`] : []),
        ],
        adult: false, imageUrl: `/openlib/thumbs/character/${file}`, cdnUrl: url,
      });
      tasks.push({ url, expect: 'webp', to: path.join(OPENLIB, 'thumbs', 'character', file), gallery: 'character', srcId });
    }
    libs.character = { entries, categories: Object.entries(catCount).map(([id, count]) => ({ id, title: id, count })) };
  }

  // 计划汇总
  for (const g of Object.keys(libs)) {
    const e = libs[g].entries;
    console.log(`  ${g}: ${e.length} 条（adult ${e.filter((x) => x.adult).length}）`);
  }
  console.log(`计划下载 ${tasks.length} 张缩略图`);
  if (!APPLY) {
    console.log('[fetch-extra] dry-run 完成；加 --apply 执行');
    return;
  }

  // ===== 3. APPLY：备份 meta，下载，写索引 =====
  const ts = nowIso().replace(/[:.]/g, '-');
  const backupDir = path.join(REPO_ROOT, 'scripts', '.openlib-fetch-backup', ts);
  await fsp.mkdir(backupDir, { recursive: true });
  await fsp.copyFile(META_JSON, path.join(backupDir, 'meta.json'));

  const failures = [];
  let done = 0;
  const queue = [...tasks];
  async function worker() {
    while (queue.length > 0) {
      const t = queue.shift();
      try {
        const buf = await download(t.url, t.expect);
        await fsp.mkdir(path.dirname(t.to), { recursive: true });
        try {
          const prev = await fsp.readFile(t.to);
          if (!prev.equals(buf)) await fsp.writeFile(t.to, buf);
        } catch { await fsp.writeFile(t.to, buf); }
      } catch (err) {
        failures.push({ gallery: t.gallery, srcId: t.srcId, url: t.url, reason: err.message });
      }
      done++;
      if (done % 200 === 0) console.log(`  进度 ${done}/${tasks.length}（失败 ${failures.length}）`);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(`下载完成：成功 ${tasks.length - failures.length} / 失败 ${failures.length}`);

  // 写三库索引 + meta 增量
  for (const g of Object.keys(libs)) {
    const { entries, categories } = libs[g];
    const adult = entries.filter((e) => e.adult).length;
    await fsp.writeFile(path.join(OPENLIB, `entries-${g}.json`), JSON.stringify({ gallery: g, categories, entries }, null, 2));
    meta.galleries[g] = {
      id: g, title: TITLES[g], indexed: true,
      license: LICENSE_RESTRICTED, sourceUrl: SOURCE_URLS[g], cdnDomains: [new URL(CDN[g]).hostname],
      entryCount: entries.length, localCount: entries.length, adultCount: adult, categories,
    };
    delete meta.galleries[g].note;
  }
  // 总量重算（遍历全部已索引库，不覆盖既有数字的口径）
  let totalEntries = 0, totalAdult = 0;
  for (const g of Object.keys(meta.galleries)) {
    const gm = meta.galleries[g];
    if (gm.indexed) { totalEntries += gm.entryCount; totalAdult += gm.adultCount; }
  }
  meta.totals = { entries: totalEntries, bundled: totalEntries, remote: 0, adult: totalAdult };
  meta.fetchedExtraAt = nowIso();
  await fsp.writeFile(META_JSON, JSON.stringify(meta, null, 2));

  const sizeBytes = await dirSize(OPENLIB);
  const byReason = {};
  for (const f of failures) byReason[f.reason] = (byReason[f.reason] ?? 0) + 1;
  const report = {
    appliedAt: nowIso(), downloads: tasks.length, ok: tasks.length - failures.length,
    failures: { count: failures.length, byReason, detail: failures.slice(0, 50) },
    openlibSizeBytes: sizeBytes, openlibSizeMB: +(sizeBytes / 1048576).toFixed(1),
    totals: meta.totals,
  };
  await fsp.writeFile(path.join(backupDir, 'fetch-extra-report.json'), JSON.stringify(report, null, 2));
  console.log(`[fetch-extra] 完成：public/openlib 总体积 ${report.openlibSizeMB}MB；总条目 ${totalEntries}（18+ ${totalAdult}）`);
  console.log(`[fetch-extra] 报告: ${path.join(backupDir, 'fetch-extra-report.json')}`);
}

main().catch((err) => {
  console.error('[fetch-extra] 失败:', err);
  process.exit(1);
});
