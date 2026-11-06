/**
 * watcher 外部变更监听测试（vitest fake timers + 注入假指纹）
 * 覆盖：指纹变化→回调一次（去抖合并）、focus 立即对账、未授权不启动、stop 幂等。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// fs.js 全量 mock：isAuthorized 可控（默认授权），fingerprint 不会被触达（测试注入假指纹）
const h = vi.hoisted(() => ({ authorized: true }));
vi.mock('./fs.js', () => ({
  fingerprint: vi.fn(async () => 'absent'),
  isAuthorized: async () => h.authorized,
}));

import {
  PROJECTS_LIST_PATH,
  setWatchTarget,
  shouldDeferExternalReload,
  shouldForceReloadAfterSkips,
  startExternalWatcher,
  stopExternalWatcher,
} from './watcher.js';

const TARGET = 'p-watch';
const SCRIPT_PATH = `projects/${TARGET}/entities/script.json`;

/** 可控假指纹表：path → 'size:mtime'；改值即模拟外部写盘 */
const fps = new Map<string, string>();
const fpMock = vi.fn(async (p: string) => fps.get(p) ?? 'absent');

let changes: string[][] = [];

function seed(paths: string[], value: string): void {
  for (const p of paths) fps.set(p, value);
}

describe('watcher 外部变更监听', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.authorized = true;
    fps.clear();
    fpMock.mockClear();
    changes = [];
    seed([PROJECTS_LIST_PATH, SCRIPT_PATH], '100:1000');
  });

  afterEach(() => {
    stopExternalWatcher();
    vi.useRealTimers();
  });

  it('指纹变化 → 去抖后回调一次；指纹不再变则不再回调', async () => {
    startExternalWatcher({ target: TARGET, fingerprintImpl: fpMock, onExternalChange: (ps) => changes.push(ps) });
    await vi.advanceTimersByTimeAsync(0); // 启动 + 首轮建基线（不报变更）
    expect(changes).toHaveLength(0);

    fps.set(SCRIPT_PATH, '200:2000'); // 外部（MCP）写盘
    await vi.advanceTimersByTimeAsync(2500); // 下一轮轮询发现变更 → 进入 5s 合并窗口
    await vi.advanceTimersByTimeAsync(5000); // 窗口结束 → 回调一次
    expect(changes).toEqual([[SCRIPT_PATH]]);

    // 指纹未再变：长时间推进也不产生新回调
    await vi.advanceTimersByTimeAsync(30000);
    expect(changes).toHaveLength(1);
  });

  it('5s 去抖窗口内同一文件多次变更 → 合并为一次回调', async () => {
    startExternalWatcher({ target: TARGET, fingerprintImpl: fpMock, onExternalChange: (ps) => changes.push(ps) });
    await vi.advanceTimersByTimeAsync(0);

    fps.set(SCRIPT_PATH, '200:2000');
    await vi.advanceTimersByTimeAsync(2500); // 第一轮发现变更，窗口开
    fps.set(SCRIPT_PATH, '300:3000');
    await vi.advanceTimersByTimeAsync(2500); // 第二轮再变，pending 去重合并
    await vi.advanceTimersByTimeAsync(5000); // 窗口结束
    expect(changes).toEqual([[SCRIPT_PATH]]);

    fps.set(PROJECTS_LIST_PATH, '500:5000'); // 窗口外的下一次变更开新窗口
    await vi.advanceTimersByTimeAsync(2500);
    await vi.advanceTimersByTimeAsync(5000);
    expect(changes).toHaveLength(2);
    expect(changes[1]).toEqual([PROJECTS_LIST_PATH]);
  });

  it('window focus 立即对账（不等下一轮轮询）', async () => {
    startExternalWatcher({ target: TARGET, fingerprintImpl: fpMock, onExternalChange: (ps) => changes.push(ps) });
    await vi.advanceTimersByTimeAsync(0);

    fps.set(SCRIPT_PATH, '200:2000');
    window.dispatchEvent(new Event('focus')); // 不推进 interval，直接触发
    await vi.advanceTimersByTimeAsync(0); // 等对账 async 完成
    await vi.advanceTimersByTimeAsync(5000); // 去抖窗口结束
    expect(changes).toEqual([[SCRIPT_PATH]]);
  });

  it('visibilitychange 恢复可见立即对账', async () => {
    startExternalWatcher({ target: TARGET, fingerprintImpl: fpMock, onExternalChange: (ps) => changes.push(ps) });
    await vi.advanceTimersByTimeAsync(0);

    fps.set(PROJECTS_LIST_PATH, '500:5000');
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(changes).toEqual([[PROJECTS_LIST_PATH]]);
  });

  it('stopExternalWatcher 幂等；停止后 focus/轮询不再产生回调', async () => {
    startExternalWatcher({ target: TARGET, fingerprintImpl: fpMock, onExternalChange: (ps) => changes.push(ps) });
    await vi.advanceTimersByTimeAsync(0);

    stopExternalWatcher();
    stopExternalWatcher(); // 重复 stop 不抛错

    fps.set(SCRIPT_PATH, '200:2000');
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(60000);
    expect(changes).toHaveLength(0);
  });

  it('目录未授权时不启动（轮询/focus 均无回调）', async () => {
    h.authorized = false;
    startExternalWatcher({ target: TARGET, fingerprintImpl: fpMock, onExternalChange: (ps) => changes.push(ps) });
    fps.set(SCRIPT_PATH, '200:2000');
    await vi.advanceTimersByTimeAsync(60000);
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(60000);
    expect(changes).toHaveLength(0);
    expect(fpMock).not.toHaveBeenCalled();
  });

  it('setWatchTarget 切换项目：新目标首轮只建基线不误报', async () => {
    startExternalWatcher({ target: TARGET, fingerprintImpl: fpMock, onExternalChange: (ps) => changes.push(ps) });
    await vi.advanceTimersByTimeAsync(0);

    setWatchTarget('p-other');
    const otherScript = 'projects/p-other/entities/script.json';
    seed([otherScript], '9:9');
    await vi.advanceTimersByTimeAsync(2500); // 新目标首轮：建基线，不报
    await vi.advanceTimersByTimeAsync(5000);
    expect(changes).toHaveLength(0);

    fps.set(otherScript, '10:10'); // 新目标真实变更
    await vi.advanceTimersByTimeAsync(2500);
    await vi.advanceTimersByTimeAsync(5000);
    expect(changes).toEqual([[otherScript]]);
  });
});

describe('reload 守卫（外部变更整页刷新前的防丢输入决策）', () => {
  it('输入中不刷新：焦点在输入框且 2s 内有按键 → 延后本轮', () => {
    // 场景：用户正在导演台敲提示词，MCP 同时写 workbench.json → 本轮跳过，
    // 等 watcher 下一轮 2.5s 轮询重试（不会静默丢失外部更新）
    expect(shouldDeferExternalReload({ hasFocus: true, typingRecently: true })).toBe(true);
  });

  it('超 3 轮强制刷新：连续延后第 4 轮起 must reload（外部更新不能永远看不到）', () => {
    // 轮询 2.5s×4 ≈ 10s：用户一直输入也要最终看到外部更新并给出提示
    expect(shouldForceReloadAfterSkips(0)).toBe(false);
    expect(shouldForceReloadAfterSkips(1)).toBe(false);
    expect(shouldForceReloadAfterSkips(2)).toBe(false);
    expect(shouldForceReloadAfterSkips(3)).toBe(false); // 第 3 轮仍延后
    expect(shouldForceReloadAfterSkips(4)).toBe(true); // 第 4 轮强制刷新
  });

  it('静止浏览时照常刷新：窗口聚焦且无输入 → 不延后（保持秒级刷新）', () => {
    expect(shouldDeferExternalReload({ hasFocus: true, typingRecently: false })).toBe(false);
  });

  it('窗口失焦 → 延后本轮（回来时 focus 事件立即对账再处理）', () => {
    expect(shouldDeferExternalReload({ hasFocus: false, typingRecently: false })).toBe(true);
  });
});
