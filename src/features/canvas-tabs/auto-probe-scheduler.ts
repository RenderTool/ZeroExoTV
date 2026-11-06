/**
 * auto-probe-scheduler — ComfyUI 自动连接的「频率纪律」纯逻辑（2026-11-05）
 *
 * 用户要求：打开就能自动尝试连接，但频率必须克制且显式实现（不靠感觉）。
 *
 * 触发源（仅三类 + 手动）：
 * - mount：页面/面板首次挂载
 * - visibility：窗口 visibilitychange 回到前台（距上次探测 ≥ 60s）
 * - panel：面板打开（同 60s 门槛）
 * - manual：用户点「测试连接 / 重试」（无视退避，永远放行）
 *
 * 纪律：
 * - 后台标签页（document.hidden）一律不探测；生成任务进行中由宿主不挂载本调度器；
 * - 同一时刻只允许一个探测在飞（in-flight 去重，所有触发共用同一个 Promise）；
 * - 失败指数退避 30s → 60s → 120s（上限 300s），连续 3 次失败后停止自动探测；
 * - 手动成功重置退避与失败计数；否则只保留手动重试；
 * - 不轮询：退避只用一次性 setTimeout，不建 interval。
 *
 * 纯类实现（时间/定时器/可见性/探测均注入），便于假计时器单测。
 */

export type AutoProbeReason = 'mount' | 'visibility' | 'panel' | 'manual';

export const AUTO_PROBE_MIN_INTERVAL_MS = 60_000;
export const AUTO_PROBE_BACKOFF_MS = [30_000, 60_000, 120_000] as const;
export const AUTO_PROBE_BACKOFF_CAP_MS = 300_000;
export const AUTO_PROBE_MAX_FAILURES = 3;

export interface AutoProbeResultLike {
  kind: 'ok' | 'fail';
  message?: string;
}

export interface AutoProbeSnapshot {
  status: 'idle' | 'probing' | 'connected' | 'failed';
  failureMessage: string | null;
  consecutiveFailures: number;
  /** 连续失败 ≥ 3 → 停止自动探测（只留手动重试） */
  autoStopped: boolean;
  /** 下一次最早允许自动探测的时间戳（0 = 立即允许） */
  nextAllowedAt: number;
  lastProbeAt: number;
}

/** 第 n 次连续失败后的退避时长（1 基）：30s/60s/120s，之后上限 300s */
export function backoffDelayFor(failures: number): number {
  if (failures <= 0) return 0;
  if (failures <= AUTO_PROBE_BACKOFF_MS.length) return AUTO_PROBE_BACKOFF_MS[failures - 1] ?? AUTO_PROBE_BACKOFF_CAP_MS;
  return AUTO_PROBE_BACKOFF_CAP_MS;
}

export interface AutoProbeSchedulerOptions<T extends AutoProbeResultLike> {
  /** 真正发起探测（读当前地址、更新连接状态）。返回 null = 未探测（地址为空等） */
  probe: () => Promise<T | null>;
  now?: () => number;
  isHidden?: () => boolean;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  onChange?: (snapshot: AutoProbeSnapshot) => void;
}

export class AutoProbeScheduler<T extends AutoProbeResultLike> {
  private readonly probe: () => Promise<T | null>;
  private readonly now: () => number;
  private readonly isHidden: () => boolean;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly onChange?: (snapshot: AutoProbeSnapshot) => void;

  private snapshot: AutoProbeSnapshot = {
    status: 'idle',
    failureMessage: null,
    consecutiveFailures: 0,
    autoStopped: false,
    nextAllowedAt: 0,
    lastProbeAt: 0,
  };
  private inFlight: Promise<T | null> | null = null;
  private timerHandle: unknown = null;
  /** 是否已探测过（不能用 lastProbeAt=0 判断，假计时器从 0 起） */
  private hasProbed = false;
  /** 生成任务进行中等场景：暂停一切自动探测（手动重试仍放行） */
  private paused = false;

  constructor(options: AutoProbeSchedulerOptions<T>) {
    this.probe = options.probe;
    this.now = options.now ?? (() => Date.now());
    this.isHidden = options.isHidden ?? (() => (typeof document !== 'undefined' ? document.hidden : false));
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.onChange = options.onChange;
  }

  getSnapshot(): AutoProbeSnapshot {
    return { ...this.snapshot };
  }

  /** 生成任务进行中 → 暂停自动探测（不打断、不重复探测） */
  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  /** 宿主触发：mount / visibility / panel / manual。返回本次（或正在飞的那次）探测结果 */
  request(reason: AutoProbeReason): Promise<T | null> {
    if (this.isHidden()) return Promise.resolve(null); // 后台标签页一律不探测
    if (this.inFlight) return this.inFlight; // in-flight 去重（并发触发只发一次请求）
    if (reason !== 'manual') {
      if (this.paused) return Promise.resolve(null);
      if (this.snapshot.autoStopped) return Promise.resolve(null);
      const nowMs = this.now();
      if (this.hasProbed && nowMs - this.snapshot.lastProbeAt < AUTO_PROBE_MIN_INTERVAL_MS) {
        return Promise.resolve(null);
      }
      if (this.snapshot.nextAllowedAt && nowMs < this.snapshot.nextAllowedAt) {
        return Promise.resolve(null);
      }
    }
    return this.start();
  }

  /** 手动探测（外部自己发起，如面板用草稿地址测）结果回报：成功重置退避/计数，失败进入退避 */
  notifyManualResult(result: T | null): void {
    if (!result) return;
    this.settle(result);
  }

  dispose(): void {
    if (this.timerHandle !== null) {
      this.clearTimer(this.timerHandle);
      this.timerHandle = null;
    }
    this.inFlight = null;
  }

  // ---- 内部 ----

  private start(): Promise<T | null> {
    this.patch({ status: 'probing' });
    const run = this.runProbe();
    // 同步占位 inFlight，保证同一 tick 内的并发触发共用同一个 Promise
    const tracked = run.finally(() => {
      if (this.inFlight === tracked) this.inFlight = null;
    });
    this.inFlight = tracked;
    return tracked;
  }

  private async runProbe(): Promise<T | null> {
    let result: T | null = null;
    try {
      result = await this.probe();
    } catch {
      result = { kind: 'fail', message: '探测失败' } as T;
    }
    this.hasProbed = true;
    this.patch({ lastProbeAt: this.now() });
    if (result) this.settle(result);
    else this.patch({ status: this.snapshot.status === 'probing' ? 'idle' : this.snapshot.status });
    return result;
  }

  private settle(result: T): void {
    if (result.kind === 'ok') {
      this.clearBackoffTimer();
      this.patch({
        status: 'connected',
        failureMessage: null,
        consecutiveFailures: 0,
        autoStopped: false,
        nextAllowedAt: 0,
      });
      return;
    }
    const failures = this.snapshot.consecutiveFailures + 1;
    if (failures >= AUTO_PROBE_MAX_FAILURES) {
      // 连续 3 次失败：停止自动探测，只保留手动重试
      this.clearBackoffTimer();
      this.patch({
        status: 'failed',
        failureMessage: result.message ?? '连接失败',
        consecutiveFailures: failures,
        autoStopped: true,
        nextAllowedAt: 0,
      });
      return;
    }
    this.clearBackoffTimer();
    const delay = backoffDelayFor(failures);
    this.patch({
      status: 'failed',
      failureMessage: result.message ?? '连接失败',
      consecutiveFailures: failures,
      autoStopped: false,
      nextAllowedAt: this.now() + delay,
    });
    // 一次性退避重试（非轮询）：到点只再试一次
    this.timerHandle = this.setTimer(() => {
      this.timerHandle = null;
      if (this.isHidden() || this.paused || this.snapshot.autoStopped) return;
      if (this.inFlight) return;
      void this.start();
    }, delay);
  }

  private clearBackoffTimer(): void {
    if (this.timerHandle !== null) {
      this.clearTimer(this.timerHandle);
      this.timerHandle = null;
    }
  }

  private patch(partial: Partial<AutoProbeSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    this.onChange?.(this.getSnapshot());
  }
}
