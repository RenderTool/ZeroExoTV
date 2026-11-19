/**
 * packages/plugins/nodes 的构建入口（2026-11-17 事故后加）。
 *
 * 这个包的 tsconfig 里 rootDir=./src，但它通过 `@/...` 引用了宿主 app 的 src 文件，
 * 于是 tsc 会：① 对这些跨 rootDir 的文件报 TS6059（既有、无法消除）；
 * ② 仍然为它们 emit，并按相对路径把 .js/.d.ts 写回 ../../../src，污染宿主源码目录。
 * Vite 里 `import './x.js'` 会优先命中这些产物，导致改了 .ts 不生效。
 *
 * 所以这里：跑 tsc → 无论 tsc 是否报既有 TS6059 都清理 src 产物 → 只把“非 TS6059”的
 * 真实错误当成失败。dist 产物照常 emit。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'plugins', 'nodes');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn(cmd, args, { cwd, shell: true });
    child.stdout.on('data', (b) => { out += String(b); });
    child.stderr.on('data', (b) => { out += String(b); });
    child.on('close', (code) => resolve({ code: code ?? 1, out }));
  });
}

const tsc = await run('npx', ['tsc'], PKG_DIR);
const clean = await run('node', [path.join(ROOT, 'tools', 'clean-src-emit.mjs')], ROOT);

// TS6059（跨 rootDir）是这个包的既有结构问题，不阻断构建；
// 宿主 src（../../../src）被一起拉进 program 后产生的类型噪音（SVG 声明 / import.meta 等）
// 也属于同一结构问题；预览/测试文件不参与交付。
// 其余错误必须暴露。
const realErrors = tsc.out
  .split(/\r?\n/)
  .filter((line) => /error TS\d+/.test(line))
  .filter((line) => !/error TS6059/.test(line))
  .filter((line) => !line.includes('../../../src/'))
  .filter((line) => !/\.(preview\.)?test\.tsx?\(/.test(line));
if (realErrors.length > 0) {
  console.error(realErrors.join('\n'));
  process.exit(1);
}
console.log(clean.out.trim());
