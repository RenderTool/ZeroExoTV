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
    : `${major}.${minor}.${patch + 1}`;

for (const file of files) {
  const raw = readFileSync(file, 'utf8');
  const pkg = JSON.parse(raw);
  pkg.version = next;
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}
console.log(`version -> ${next} (${files.join(', ')})`);
