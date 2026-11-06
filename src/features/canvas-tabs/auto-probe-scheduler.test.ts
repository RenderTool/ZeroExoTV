/**
 * auto-probe-scheduler 单测（假计时器）：自动连接频率纪律
 *
 * 覆盖用户验收：首次挂载自动探一次；60s 内回到前台不再探；失败退避 30/60/120
 * （上限 5min 的纯函数断言）；连续 3 次失败停止自动探测；手动成功重置退避与计数；
 * in-flight 去重；document.hidden 不探；生成中（paused）不探。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTO_PROBE_MAX_FAILURES,
  AUTO_PROBE_MIN_INTERVAL_MS,
  AutoProbeScheduler,
  backoffDelayFor,
  type AutoProbeResultLike,
} from './auto-probe-scheduler';

type Result = AutoProbeResultLike;

function harness(opts: { hidden?: boolean } = {}) {
  let hidden = opts.hidden ?? false;
  const probe = vi.fn(async (): Promise<Result> => ({ kind: 'ok' }));
  const scheduler = new AutoProbeScheduler<Result>({
    probe,
    isHidden: () => hidden,
  });
  return {
    probe,
    scheduler,
    setHidden: (v: boolean) => {
      hidden = v;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('触发门槛', () => {
  it('首次挂载自动探一次；60s 内重复触发不再探', async () => {
    const { probe, scheduler } = harness();
    await scheduler.request('mount');
    expect(probe).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_000);
    await scheduler.request('panel');
    await scheduler.request('mount');
    expect(probe).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(AUTO_PROBE_MIN_INTERVAL_MS - 30_000);
    await scheduler.request('visibility');
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('document.hidden 时不探测（挂载/回前台都一样）', async () => {
    const { probe, scheduler, setHidden } = harness({ hidden: true });
    await scheduler.request('mount');
    await scheduler.request('visibility');
    expect(probe).not.toHaveBeenCalled();
    setHidden(false);
    await scheduler.request('visibility');
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('生成中（paused）不探测，手动重试仍放行', async () => {
    const { probe, scheduler } = harness();
    scheduler.setPaused(true);
    await scheduler.request('mount');
    expect(probe).not.toHaveBeenCalled();
    scheduler.setPaused(false);
    await scheduler.request('manual');
    expect(probe).toHaveBeenCalledTimes(1);
  });
});

describe('失败退避与停用', () => {
  it('退避序列 30s → 60s → 120s，上限 300s（纯函数）', () => {
    expect(backoffDelayFor(1)).toBe(30_000);
    expect(backoffDelayFor(2)).toBe(60_000);
    expect(backoffDelayFor(3)).toBe(120_000);
    expect(backoffDelayFor(4)).toBe(300_000);
    expect(backoffDelayFor(9)).toBe(300_000);
  });

  it('连续失败按 30s → 60s 自动重试，第 3 次失败后停止自动探测', async () => {
    const { probe, scheduler } = harness();
    probe.mockImplementation(async () => ({ kind: 'fail', message: '离线' }));

    await scheduler.request('mount'); // #1
    expect(scheduler.getSnapshot().consecutiveFailures).toBe(1);
    expect(scheduler.getSnapshot().nextAllowedAt).toBe(30_000);

    await vi.advanceTimersByTimeAsync(30_000); // 退避 #1 → #2
    expect(probe).toHaveBeenCalledTimes(2);
    expect(scheduler.getSnapshot().nextAllowedAt).toBe(60_000 + 30_000);

    await vi.advanceTimersByTimeAsync(60_000); // 退避 #2 → #3
    expect(probe).toHaveBeenCalledTimes(3);
    expect(scheduler.getSnapshot().consecutiveFailures).toBe(AUTO_PROBE_MAX_FAILURES);
    expect(scheduler.getSnapshot().autoStopped).toBe(true);

    // 停用后即使过了 5 分钟也不再自动探测
    await vi.advanceTimersByTimeAsync(300_000);
    expect(probe).toHaveBeenCalledTimes(3);
    await scheduler.request('visibility');
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it('手动成功重置退避与失败计数（停用后恢复自动）', async () => {
    const { probe, scheduler } = harness();
    probe.mockImplementation(async () => ({ kind: 'fail', message: '离线' }));
    await scheduler.request('manual'); // 失败 1
    await scheduler.request('manual'); // 失败 2
    await scheduler.request('manual'); // 失败 3 → 停用
    expect(scheduler.getSnapshot().autoStopped).toBe(true);

    probe.mockImplementation(async () => ({ kind: 'ok' }));
    scheduler.notifyManualResult({ kind: 'ok' });
    expect(scheduler.getSnapshot().autoStopped).toBe(false);
    expect(scheduler.getSnapshot().consecutiveFailures).toBe(0);
    expect(scheduler.getSnapshot().nextAllowedAt).toBe(0);

    vi.advanceTimersByTime(AUTO_PROBE_MIN_INTERVAL_MS);
    await scheduler.request('mount');
    expect(probe).toHaveBeenCalledTimes(4);
  });
});

describe('in-flight 去重', () => {
  it('并发触发只发一次请求', async () => {
    const { probe, scheduler } = harness();
    let resolveProbe!: (r: Result) => void;
    probe.mockImplementation(() => new Promise<Result>((res) => { resolveProbe = res; }));

    const a = scheduler.request('mount');
    const b = scheduler.request('panel');
    const c = scheduler.request('manual');
    expect(probe).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);

    resolveProbe({ kind: 'ok' });
    await vi.advanceTimersByTimeAsync(0); // 冲刷探测完成的微任务
    expect(scheduler.getSnapshot().status).toBe('connected');
    expect(scheduler.getSnapshot().lastProbeAt).toBe(0);
    // 下一次让探测立即完成（否则 await 会挂在未 resolve 的 Promise 上）
    probe.mockResolvedValue({ kind: 'ok' });
    vi.advanceTimersByTime(AUTO_PROBE_MIN_INTERVAL_MS);
    await scheduler.request('visibility');
    expect(probe).toHaveBeenCalledTimes(2);
  });
});
