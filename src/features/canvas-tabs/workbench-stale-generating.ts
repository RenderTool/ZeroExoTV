/**
 * workbench-stale-generating —— 「历史残留的生成中」自愈对账（2026-11-05 修复）。
 *
 * 问题：段状态持久化在实体里。上次运行若来自旧包（取消不回写段状态）或页面异常退出，
 * 段会永远停在 `generating`——刷新后卡片照旧「生成中」，而后端队列其实是空的，
 * 用户已连续被这个假状态骗过多次。
 *
 * 对账规则（进入导演台、实体加载完成后执行一次）：
 * 1. 本页有运行状态机在进行（phase 非 idle）→ 不降级（以运行状态机为准，不误伤本次运行）；
 * 2. 后端队列探测到任务仍在跑（queueBusy = true）→ 不降级（有真任务就保持生成中；
 *    注：段实体不持久化 jobId，无法按 jobId 精确关联，故采用保守策略——队列非空即整体跳过，
 *    下次进入再对账）；
 * 3. 其余情况：把「无运行却挂着 generating」的段降级为「已中断」（interrupted），
 *    由宿主落盘（updateShot 走既有防抖 persist 链路写回容器）并提示一次；
 *    降级幂等——status 已是 interrupted 的段再次进入不会再命中，也就不会重复提示。
 *
 * 本模块为纯函数：队列探测 / 落盘 / 提示都由宿主注入，便于单测。
 */

export interface StaleReconcileInput {
  /** 实体段（只需 id + status） */
  shots: ReadonlyArray<{ id: string; status: string }>;
  /** 本页运行状态机；'idle' = 无进行中的运行 */
  runPhase: string;
  /** 本次运行覆盖的段 id（防御性：即使 phase 判断失效也不误降本次运行的段） */
  activeSegmentIds?: ReadonlySet<string> | null;
  /**
   * 后端 /queue 探测结果：true = 队列里仍有任务在跑（不降级）；
   * null = 探测不了（未连接 / 跨域 / 兼容口无此口）——与取消路径同一语义：后端未确认也落到确定状态。
   */
  queueBusy: boolean | null;
}

export interface StaleReconcileResult {
  /** 应降级为「已中断」的段 id（宿主逐个 updateShot(id, { status: 'interrupted' }) 落盘） */
  demotedIds: string[];
  /** 因后端队列仍在跑而整体跳过（不降级） */
  skippedForQueue: boolean;
}

const ACTIVE_RUN_PHASES = new Set(['submitting', 'queued', 'running']);

export function reconcileStaleGenerating(input: StaleReconcileInput): StaleReconcileResult {
  // 1) 本次页面发起的运行在进行 → 按运行状态机为准，不动任何段
  if (ACTIVE_RUN_PHASES.has(input.runPhase)) {
    return { demotedIds: [], skippedForQueue: false };
  }
  // 2) 后端队列仍有任务在跑 → 保持生成中（真任务），下次进入再对账
  if (input.queueBusy === true) {
    return { demotedIds: [], skippedForQueue: true };
  }
  // 3) 无运行 + 队列空/不可探测 → 残留 generating 降级为「已中断」
  const active = input.activeSegmentIds ?? null;
  const demotedIds = input.shots
    .filter((s) => s.status === 'generating' && !(active && active.has(s.id)))
    .map((s) => s.id);
  return { demotedIds, skippedForQueue: false };
}
