/**
 * LoRA 选择桥（2026-11-20 用户口径：LoRA 只在「模型映射 → LoRA」页里选，参数面板不出现 LoRA）。
 *
 * 为什么需要桥：
 * - 清单与选择入口在「模型映射」弹窗（顶栏打开，全局只有一份，读的是本机 /models 清单）；
 * - 而「启用哪几条、各自强度、串联顺序」是**项目参数**，必须落进 workbench 的 `sharedParams.params.loras`，
 *   否则 payload / 插件拿不到。
 *
 * 所以：导演台（持有 sharedParams 的 workbench tab）挂一个 sink，把选择写回 shared.params.loras；
 * 弹窗通过 get/set 与它同步。没有打开任何导演台时 sink 为空，弹窗只做展示 + 明确提示无法写入。
 */
import { normalizeLoras, type LoraRow } from '@/entities/director-lora.js';

type LoraSink = (loras: LoraRow[]) => void;

/**
 * 2026-11-21 用户口径：LoRA 是「设置」，勾选完必须持久化，不能关掉窗口就丢。
 * 双写：① localStorage（跨项目/跨重启都记得）② 项目 shared.params.loras（真正下发给插件的那份）。
 * 打开项目时若项目里没有 loras，用 localStorage 里这份补写进去。
 */
const LS_KEY = 'zeroexo:director-loras';

function loadPersisted(): LoraRow[] {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    return raw ? normalizeLoras(JSON.parse(raw) as unknown) : [];
  } catch {
    return [];
  }
}

function savePersisted(rows: LoraRow[]): void {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(rows));
  } catch {
    /* 隐私模式忽略 */
  }
}

let sink: LoraSink | null = null;
let current: LoraRow[] = normalizeLoras(loadPersisted());

/** 导演台挂载时注册（返回注销函数）；snapshot 传当前项目的 params.loras */
export function registerDirectorLoraSink(next: LoraSink, snapshot: unknown): () => void {
  sink = next;
  current = normalizeLoras(snapshot);
  if (current.length === 0) {
    // 项目里还没设置过 → 用上次的 LoRA 设置补进去并落盘，用户不必每次重勾
    const persisted = normalizeLoras(loadPersisted());
    if (persisted.length > 0) {
      current = persisted;
      next(current);
    }
  } else {
    savePersisted(current);
  }
  return () => {
    if (sink === next) sink = null;
  };
}

/** 项目切换 / 外部改了 shared.params.loras 时同步进桥，弹窗下次打开就是真值 */
export function syncDirectorLoras(snapshot: unknown): void {
  current = normalizeLoras(snapshot);
  if (current.length > 0) savePersisted(current);
}

export function getDirectorLoras(): LoraRow[] {
  return current;
}

export function hasDirectorLoraSink(): boolean {
  return sink !== null;
}

/** 写入：先更新桥内快照并持久化到 localStorage，再交给导演台写 shared.params.loras */
export function setDirectorLoras(next: LoraRow[]): LoraRow[] {
  current = normalizeLoras(next);
  savePersisted(current);
  sink?.(current);
  return current;
}
