/**
 * script-history 纯逻辑单测（2026-11-04 删除丢内容修复）
 * 栈深上限（≥100 步）、合并窗口、redo 分支截断、无变化不入栈。
 */
import { describe, expect, it } from 'vitest';
import { ScriptHistory, SCRIPT_HISTORY_LIMIT } from '../script-history';
import { createScriptLine, serializeScriptLines, type ScriptLine } from '../script-lines';

const sig = serializeScriptLines;
const lines = (n: number): ScriptLine[] => Array.from({ length: n }, () => createScriptLine('action', `段${Math.random()}`));

describe('script-history', () => {
  it('栈深上限：超出 SCRIPT_HISTORY_LIMIT(≥100) 丢最旧', () => {
    expect(SCRIPT_HISTORY_LIMIT).toBeGreaterThanOrEqual(100);
    const h = new ScriptHistory(sig);
    const init = lines(1);
    h.reset(init);
    for (let i = 0; i < 150; i += 1) {
      h.push(lines(2), null, i * 10_000); // 时间间隔大，绝不合并
    }
    let steps = 0;
    while (h.undo() !== null) steps += 1;
    expect(steps).toBe(SCRIPT_HISTORY_LIMIT); // 只能撤满栈深
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(true);
  });

  it('合并窗口：同 mergeKey 且 < MERGE_MS 替换栈顶；跨窗口/不同 key 独立成步', () => {
    const h = new ScriptHistory(sig);
    h.reset(lines(1));
    h.push(lines(2), 'text:a', 0);
    h.push(lines(3), 'text:a', 500);                        // 窗口内（500 < 800）→ 合并
    h.push(lines(4), 'text:a', 2000);                       // 距上次(500)超窗 → 新步
    h.push(lines(5), 'text:b', 2100);                       // 不同 key → 新步
    h.push(lines(6), null, 2200);                           // null → 新步
    let steps = 0;
    while (h.undo() !== null) steps += 1;
    expect(steps).toBe(4);
  });

  it('undo 后再编辑截断 redo 分支；无变化不入栈', () => {
    const h = new ScriptHistory(sig);
    const a = lines(1);
    const b = lines(2);
    const c = lines(3);
    h.reset(a);
    h.push(b, null);
    expect(h.undo()).toBe(a);      // 回到初始
    expect(h.canRedo()).toBe(true);
    h.push(c, null);               // 新编辑 → 截断 redo 分支
    expect(h.canRedo()).toBe(false);
    h.push(c, null);               // 无变化（同签名）不入栈
    let steps = 0;
    while (h.undo() !== null) steps += 1;
    expect(steps).toBe(1);         // 只能撤 1 步回到初始 a
  });
});
