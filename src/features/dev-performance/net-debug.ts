/**
 * net-debug —— 本地版空实现（原属 dev-performance 面板，已随后台链路删除）
 *
 * 用 Proxy 让任意埋点调用都变成 no-op，运行期不会抛「is not a function」。
 *
 * 2026-11-06 类型修复：原声明 `Record<string, (...args) => unknown>` 在
 * `noUncheckedIndexedAccess: true` 下，每次属性访问都带 `| undefined`，
 * 导致 backend-upload / sync-* 共 9 处 TS2722「Cannot invoke an object which is
 * possibly 'undefined'」。改为具名接口：当前调用面只有这两个方法，属性不再是索引访问。
 * Proxy 实现不变，新增埋点方法时在此接口补一行即可。
 */
export interface NetDebug {
  /** 预签名耗时（毫秒） */
  recordPresign(durationMs: number): void;
  /** CAS 去重是否命中 */
  recordCas(hit: boolean): void;
}

export const netDebug: NetDebug = new Proxy({} as NetDebug, {
  get: () => () => undefined,
});
