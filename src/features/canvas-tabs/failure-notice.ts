/**
 * 任务失败提示去重（2026-11-22 用户口径）：
 * 「失败了就失败了，不用每次切页面就弹一次」。
 *
 * 之前只在组件 ref 里记 taskId，切页 / 刷新后组件重挂，ref 归零，
 * 同一条已失败任务又被 SSE 快照捡回来，于是每切一次页面弹一次。
 * 现在把「已提示过的失败」落到 localStorage（按 作用域+taskId 去重），
 * 一条任务一辈子只弹一次，失败状态仍在画布 / 片段卡里持续可见。
 */

const KEY = 'zeroexo.notified-task-failures';
const MAX = 300;

function readAll(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * 返回 true = 这次该弹（此前没弹过），同时登记，避免切页重复。
 * scope 用来区分同 id 的不同链路（画布 / 导演台 broker / 导演台插件）。
 */
export function consumeFailureNotice(scope: string, taskId: string | null | undefined): boolean {
  if (!taskId) return false;
  const key = `${scope}:${taskId}`;
  const list = readAll();
  if (list.includes(key)) return false;
  list.push(key);
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)));
  } catch {
    // 存不进去（私密模式 / 配额满）就退回「本进程内必弹一次」，不阻断提示
  }
  return true;
}

/**
 * 「生成失败：生成失败」这种叠词只留一层。
 * error 本身已经是「生成失败…」就直接用它，否则拼一层前缀。
 */
export function failureNoticeText(error?: string | null, fallback = '生成失败'): string {
  const detail = (error ?? '').trim();
  if (!detail) return fallback;
  if (detail.startsWith('生成失败') || detail.startsWith('任务失败')) return detail;
  return `生成失败：${detail}`;
}
