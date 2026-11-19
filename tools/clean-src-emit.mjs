/**
 * 清掉 tsc 误写进 src 的编译产物（2026-11-17 事故后加）。
 *
 * 为什么需要：packages/plugins/nodes 的 tsconfig 里 rootDir=./src，但它通过 `@/...`
 * 引用了宿主 app 的 src 文件（跨 rootDir）。tsc 仍会为这些文件 emit，并按相对路径
 * 写回 ../../../src/*.js / *.d.ts —— 于是 src 下出现与 .ts 同名的 .js。
 * Vite 里 `import './http-fs.js'` 会优先命中那个 .js，导致改 .ts 不生效、
 * 运行时直接报 "does not provide an export named ..."。这个脚本只删
 * “有 .ts/.tsx 同名源文件”的产物，src 里手工维护的 .js 不受影响。
 */
import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 2026-11-18：不止宿主 src。任何包执行 tsc 时都会把跨包引用的源码按 rootDir
// 相对路径 emit 回它所在的 src（例如 packages/core/src、packages/plugins/*/src），
// Vite 会优先命中这些 .js，等于线上跑旧代码。这里把根 src 与 packages/**/src 一起清。
const SRC_ROOTS = [path.join(ROOT, 'src')];
const PKG = path.join(ROOT, 'packages');
const STRAY = ['.js', '.js.map', '.d.ts', '.d.ts.map'];

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir, out) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      await walk(abs, out);
    } else {
      out.push(abs);
    }
  }
}

// packages 下所有名为 src 的目录
async function collectSrcDirs(dir, out) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const abs = path.join(dir, entry.name);
    if (entry.name === 'src') out.push(abs);
    await collectSrcDirs(abs, out);
  }
}
const pkgSrcDirs = [];
await collectSrcDirs(PKG, pkgSrcDirs).catch(() => undefined);
SRC_ROOTS.push(...pkgSrcDirs);

const files = [];
for (const root of SRC_ROOTS) {
  await walk(root, files);
}

let removed = 0;
for (const file of files) {
  const base = path.basename(file);
  const suffix = STRAY.find((s) => base.endsWith(s));
  if (!suffix) continue;
  const stem = base.slice(0, -suffix.length);
  const dir = path.dirname(file);
  if (await exists(path.join(dir, `${stem}.ts`)) || await exists(path.join(dir, `${stem}.tsx`))) {
    await rm(file, { force: true });
    removed += 1;
  }
}

console.log(`[clean-src-emit] removed ${removed} stray file(s) under ${SRC_ROOTS.length} src dir(s)`);
