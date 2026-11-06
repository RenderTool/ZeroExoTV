/**
 * 弹层居中契约（2026-11-05 用户拍板：「我们项目所有提示弹出都是屏幕内居中的别搞错了」）
 *
 * 背景：antd `Modal` 与 `modal.confirm` 默认贴在视口上方（top ≈ 100px），必须显式 `centered`；
 * 而本项目自研的 `@/shared/components/modal.js`（必传 `theme`）本身 `placeItems:'center'` 已居中。
 * 此前逐文件人工排查极易漏（`=>` 里的 `>` 会让简单正则截断），故把扫描器固化成测试：
 * 新增弹层若忘写 centered，本用例直接失败并列出文件。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(process.cwd(), 'src');

/** 自研 Modal 组件定义文件（内部实现 placeItems:center，不参与检查） */
const SELF = 'shared/components/modal.tsx';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (name !== 'node_modules') walk(p, out); continue; }
    if (!/\.(tsx|ts)$/.test(name)) continue;
    if (/\.test\.(tsx|ts)$/.test(name)) continue;
    if (p.replace(/\\/g, '/').endsWith(`src/${SELF}`)) continue;
    out.push(p);
  }
  return out;
}

/**
 * 从 `<` 起截出完整 JSX 开标签：跟踪 {}()[] 深度与字符串，深度为 0 时遇到的 `>` 才是标签结束。
 * （朴素正则会被 `onCancel={() => setX(null)}` 里的 `=>` 截断，导致误判）
 */
function openingTag(src: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < src.length; i++) {
    const ch = src[i]!;
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') depth--;
    else if (ch === '>' && depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

/** 从 confirm 调用的 `{` 起截出完整对象字面量 */
function objectLiteral(src: string, braceStart: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = braceStart; i < src.length; i++) {
    const ch = src[i]!;
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(braceStart, i + 1); }
  }
  return src.slice(braceStart);
}

const offenders: string[] = [];

for (const file of walk(ROOT)) {
  const src = readFileSync(file, 'utf-8');
  const rel = relative(join(process.cwd()), file).replace(/\\/g, '/');

  // ① <Modal …>：自研组件（必带 theme）已居中，跳过；antd Modal 必须显式 centered
  for (const m of src.matchAll(/<Modal(?=[\s>])/g)) {
    const tag = openingTag(src, m.index!);
    if (/theme=\{/.test(tag)) continue;
    if (!/\bcentered\b/.test(tag)) offenders.push(`${rel}：<Modal> 缺 centered`);
  }

  // ② modal.confirm(...) / Modal.confirm(...)：必须 centered: true
  for (const m of src.matchAll(/\b[Mm]odal\.confirm\(\s*\{/g)) {
    const brace = src.indexOf('{', m.index!);
    const obj = objectLiteral(src, brace);
    if (!/centered:\s*true/.test(obj)) offenders.push(`${rel}：modal.confirm 缺 centered: true`);
  }
}

describe('弹层屏幕居中契约（全仓扫描）', () => {
  it('所有 antd <Modal> 与 modal.confirm 均声明屏幕居中（自研 Modal 组件除外）', () => {
    // 失败时把完整清单打出来，便于一次修完
    expect(offenders).toEqual([]);
  });

  it('扫描器确实命中了检查点（防正则失效导致空跑假绿）', () => {
    const files = walk(ROOT);
    const total = files.reduce((n, f) => n + (readFileSync(f, 'utf-8').match(/<Modal(?=[\s>])/g)?.length ?? 0), 0);
    expect(total).toBeGreaterThan(20);
  });
});
