/**
 * 外部变更监听（MCP 写盘对账，2026-11-05）
 *
 * 背景：主存储 = 用户授权的本地目录（FSA 句柄），MCP stdio 服务读写同一目录。
 * 网页侧无法收到文件系统通知，只能轮询对账：周期 + focus/visibilitychange 即时对账。
 *
 * 监测范围（与 MCP 写盘路径同源）：
 * - `.lf/zeroexo/app_meta/projects.json`            项目列表（localforage app_meta 桶）
 * - `projects/<target>/entities/script.json` 等      当前项目实体三件套
 *
 * 行为契约：
 * - 首轮只建指纹基线，不报变更；
 * - 指纹（size:lastModified，见 fs.fingerprint）与上次不同 → 收集路径，
 *   5s 去抖窗口内合并，窗口结束回调一次 onExternalChange(paths)；
 * - window focus / visibilitychange 恢复可见 → 立即对账一次（不等下一轮）；
 * - stopExternalWatcher 幂等；重复 start 先停旧实例；
 * - 仅在 isAuthorized() 为 true 时启动（目录授权是轮询的前提）。
 */

import { fingerprint, isAuthorized } from './fs.js';

/** 项目列表文件（disk-driver：app_meta 桶 `projects` 键 → .lf/zeroexo/app_meta/projects.json） */
export const PROJECTS_LIST_PATH = '.lf/zeroexo/app_meta/projects.json';

/** 当前项目实体三件套（与 entities/script-store、slot-containers 拼的路径一致） */
const ENTITY_FILES = ['script.json', 'storyboard.json', 'workbench.json'] as const;

/** reload 守卫：连续跳过超过 3 轮（2.5s×4 ≈ 10s）后强制刷新 */
const RELOAD_GUARD_MAX_SKIPS = 3;

/**
 * reload 守卫纯决策：外部变更触发整页刷新前，判断是否延后本轮。
 * - 窗口失焦 → 延后（回来时 focus 事件会立即对账再触发）；
 * - 焦点在输入框且 2s 内有按键（正在输入）→ 延后（防止丢最后 600ms 未落盘输入）；
 * - 其余（静止浏览）→ 不延后，保持秒级刷新。
 */
export interface ReloadGuardInput {
  hasFocus: boolean;
  typingRecently: boolean;
}
export function shouldDeferExternalReload(input: ReloadGuardInput): boolean {
  return !input.hasFocus || input.typingRecently;
}

/** 连续跳过超过 MAX_SKIPS 轮 → 强制刷新（兜底：用户一直输入也要最终看到外部更新） */
export function shouldForceReloadAfterSkips(skipCount: number): boolean {
  return skipCount > RELOAD_GUARD_MAX_SKIPS;
}

function entityPaths(projectId: string): string[] {
  return ENTITY_FILES.map((f) => `projects/${projectId}/entities/${f}`);
}

export interface ExternalWatcherOptions {
  /** 轮询间隔，默认 2500ms */
  pollMs?: number;
  /** 初始监听的项目 id（entities 三件套）；后续可 setWatchTarget 更新 */
  target?: string | null;
  /** 指纹实现（默认 fs.fingerprint；测试注入可控假指纹） */
  fingerprintImpl?: (path: string) => Promise<string>;
  /** 变更回调（5s 去抖合并后触发，paths 为本次变更的文件相对路径） */
  onExternalChange: (paths: string[]) => void;
}

const DEFAULT_POLL_MS = 2500;
const FLUSH_DEBOUNCE_MS = 5000;

interface WatcherState {
  pollMs: number;
  target: string | null;
  fp: (path: string) => Promise<string>;
  onExternalChange: (paths: string[]) => void;
  timer: number | null;
  running: boolean;
  /** 上一轮各文件指纹基线；undefined（首轮）不报变更 */
  last: Map<string, string>;
  /** 去抖窗口内待上报路径 */
  pending: Set<string>;
  flushTimer: number | null;
  onFocus: () => void;
  onVisibility: () => void;
}

let state: WatcherState | null = null;

function watchPaths(st: WatcherState): string[] {
  return [PROJECTS_LIST_PATH, ...(st.target ? entityPaths(st.target) : [])];
}

/** 单轮对账：逐文件取指纹比对；防重入（上轮未完成跳过本轮），单文件失败跳过不崩 */
async function pollOnce(st: WatcherState): Promise<void> {
  if (st.running) return;
  st.running = true;
  try {
    for (const path of watchPaths(st)) {
      let fp: string;
      try {
        fp = await st.fp(path);
      } catch {
        continue;
      }
      const prev = st.last.get(path);
      st.last.set(path, fp);
      if (prev !== undefined && prev !== fp) {
        st.pending.add(path);
        scheduleFlush(st);
      }
    }
  } finally {
    st.running = false;
  }
}

/** 去抖：首次发现变更后 5s 合并窗口，窗口结束一次性回调 */
function scheduleFlush(st: WatcherState): void {
  if (st.flushTimer !== null) return;
  st.flushTimer = window.setTimeout(() => {
    st.flushTimer = null;
    const paths = [...st.pending];
    st.pending.clear();
    if (paths.length > 0) st.onExternalChange(paths);
  }, FLUSH_DEBOUNCE_MS);
}

/** 启动外部变更监听（未授权目录时不启动，静默返回）。重复调用先停旧实例。 */
export function startExternalWatcher(opts: ExternalWatcherOptions): void {
  stopExternalWatcher();
  const st: WatcherState = {
    pollMs: opts.pollMs ?? DEFAULT_POLL_MS,
    target: opts.target ?? null,
    fp: opts.fingerprintImpl ?? fingerprint,
    onExternalChange: opts.onExternalChange,
    timer: null,
    running: false,
    last: new Map(),
    pending: new Set(),
    flushTimer: null,
    onFocus: () => void pollOnce(st),
    onVisibility: () => {
      if (document.visibilityState === 'visible') void pollOnce(st);
    },
  };
  state = st;
  void isAuthorized().then((ok) => {
    if (!ok || state !== st) return; // 未授权 / 已被 stop：不启动
    st.timer = window.setInterval(() => void pollOnce(st), st.pollMs);
    window.addEventListener('focus', st.onFocus);
    document.addEventListener('visibilitychange', st.onVisibility);
    void pollOnce(st); // 立即建基线
  });
}

/** 切换监听的项目（entities 三件套跟随）；旧实体指纹基线作废，新目标首轮只建基线 */
export function setWatchTarget(projectId: string | null): void {
  const st = state;
  if (!st || st.target === projectId) return;
  st.target = projectId;
  for (const key of [...st.last.keys()]) {
    if (ENTITY_FILES.some((f) => key.endsWith(`/entities/${f}`))) st.last.delete(key);
  }
}

/**
 * 前端自己写文件后调用：把该文件指纹刷新为新基线，同时从去抖窗口摘掉，
 * 避免把自己写的文件误判为外部变更（2026-11-07 导演台改时间整页刷新 BUG）。
 */
export function touchBaseline(path: string): void {
  const st = state;
  if (!st) return;
  st.pending.delete(path);
  void st.fp(path).then((fp) => {
    if (state === st) st.last.set(path, fp);
  }).catch(() => undefined);
}

/** 停止监听（幂等）：清定时器、移除窗口监听、丢弃待上报路径 */
export function stopExternalWatcher(): void {
  const st = state;
  state = null;
  if (!st) return;
  if (st.timer !== null) {
    window.clearInterval(st.timer);
    st.timer = null;
  }
  if (st.flushTimer !== null) {
    window.clearTimeout(st.flushTimer);
    st.flushTimer = null;
  }
  window.removeEventListener('focus', st.onFocus);
  document.removeEventListener('visibilitychange', st.onVisibility);
  st.pending.clear();
}
