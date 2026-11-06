/**
 * 剧本导入契约断言（project-rules/docs/script-import-contract.md）——前端侧。
 * fixture 与 mcp-server/test/script-normalize.test.ts 逐字相同（双侧对齐铁律）：
 * 两份实现（src/.../script-normalize.ts 与 mcp-server/src/lib/script-normalize.ts）
 * 必须在同一 fixture 上产出完全相同的 normalized 与 report，禁止单侧修改。
 */

import { describe, expect, it } from 'vitest';
import { normalizeScript } from './script-normalize';

/** 契约 fixture（与 mcp-server 测试逐字一致，禁止单侧修改） */
const CONTRACT_FIXTURE = [
  '# 秀才住破庙',
  '引子，一个落魄书生的故事。',
  '',
  '第一集 夜宿',
  '第1场 莱州官道 夜',
  '张秀才：天黑了，何处安身？',
  '（低声）他裹紧行囊。',
  '寒风卷起尘土。',
  '[主体 @张秀才]',
  '',
].join('\n');

/** 契约期望输出（与 mcp-server 测试逐字一致） */
const CONTRACT_EXPECTED = [
  '# 秀才住破庙',
  '## 第1集：夜宿',
  '### 第1场：莱州官道 · 内 · 夜',
  '张秀才：天黑了，何处安身？',
  '（低声）他裹紧行囊。',
  '寒风卷起尘土。',
  '[主体 @张秀才]',
].join('\n');

describe('normalizeScript 契约 fixture（双侧对齐）', () => {
  it('fixture → 期望输出逐字一致（与 mcp-server 测试共用 fixture）', () => {
    const { normalized } = normalizeScript(CONTRACT_FIXTURE);
    expect(normalized).toBe(CONTRACT_EXPECTED);
  });

  it('报告字段齐全（集/场/对白/动作/主体/补场元信息/丢弃段）', () => {
    const { report } = normalizeScript(CONTRACT_FIXTURE);
    expect(report.episodeCount).toBe(1);
    expect(report.sceneCount).toBe(1);
    expect(report.dialogueCount).toBe(1);
    expect(report.actionLineCount).toBe(2);
    expect(report.subjects).toEqual(['张秀才']);
    expect(report.unknownSceneMeta).toBe(1);
    expect(report.discardedSegments).toEqual(['引子，一个落魄书生的故事。']);
  });

  it('幂等：标准剧本再规范化应保持稳定（不二次改写）', () => {
    const once = normalizeScript(CONTRACT_FIXTURE).normalized;
    const twice = normalizeScript(once).normalized;
    expect(twice).toBe(once);
  });
});
