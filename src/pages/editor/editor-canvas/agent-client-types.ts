/**
 * 本地版 agentClient.subscribe 的事件回调契约（2026-11-06）
 *
 * 背景：Plan#83 剥离内置 Agent/LLM 后，三处模块各自留了一份 `agentClient` stub，
 * `subscribe` 第二参数写成 `Record<string, unknown>`。对象字面量里的箭头函数因此
 * 拿不到上下文类型，在 `strict / noImplicitAny` 下产生 18 处 TS7006（隐式 any）。
 *
 * 本接口是这三处 stub 共享的唯一契约；运行行为不变（stub 仍是 no-op / 抛错），
 * 仅让回调参数获得正确类型。字段类型按现有消费方用法定：
 * - progress 参与 `Math.min(100, progress)` → number；
 * - phase 允许 null（多处 `setPhase(null)`）；
 * - output 是未定形的任务产物，消费方各自断言 → unknown；
 * - error 用于插值展示与写入节点 data → unknown。
 */
export interface AgentTaskHandlers {
  onProgress?: (progress: number, message?: string) => void;
  onThinkingDelta?: (delta: string, scope?: string) => void;
  onPhase?: (phase: string | null, label?: string) => void;
  onDone?: (output: unknown) => void;
  onError?: (error: unknown) => void;
  onClose?: () => void;
}
