/**
 * 版本号递增（2026-11-11 用户要求：每次更新必须变版本号）。
 *
 * 网页与 MCP 共用同一版本：同时改根 package.json 与 mcp-server/package.json。
 * 用法：node tools/bump-version.mjs [patch|minor|major]（默认 patch）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const kind = (process.argv[2] ?? 'patch').toLowerCase();
if (!['patch', 'minor', 'major'].includes(kind)) {
  console.error('用法: node tools/bump-version.mjs [patch|minor|major]');
  process.exit(1);
}

const files = ['package.json', path.join('mcp-server', 'package.json')];
const rootPkg = JSON.parse(readFileSync(files[0], 'utf8'));
const [major, minor, patch] = String(rootPkg.version).split('.').map((n) => Number(n) || 0);
const next = kind === 'major'
  ? `${major + 1}.0.0`
  : kind === 'minor'
    ? `${major}.${minor + 1}.0`
    // patch 最多两位数；到 100 前必须进位到 minor，禁止出现 0.2.100+
    : patch >= 99
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`;

for (const file of files) {
  const raw = readFileSync(file, 'utf8');
  const pkg = JSON.parse(raw);
  pkg.version = next;
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}
console.log(`version -> ${next} (${files.join(', ')})`);

// 2026-11-21 用户要求：下载的插件 zip 必须带版本号。
// 每次 bump 后按插件 PLUGIN_VERSION 重打 zip，避免「代码 0.1.4、zip 还是 0.1.2」。
try {
  const { buildPluginZip } = await import('./build-plugin-zip.mjs');
  buildPluginZip();
} catch (err) {
  console.error(`[bump] 插件 zip 重打失败（版本号已改，需手动跑 node tools/build-plugin-zip.mjs）: ${err.message}`);
}
