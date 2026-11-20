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

let sink: LoraSink | null = null;
let current: LoraRow[] = [];

/** 导演台挂载时注册（返回注销函数）；snapshot 传当前项目的 params.loras */
export function registerDirectorLoraSink(next: LoraSink, snapshot: unknown): () => void {
  sink = next;
  current = normalizeLoras(snapshot);
  return () => {
    if (sink === next) sink = null;
  };
}

/** 项目切换 / 外部改了 shared.params.loras 时同步进桥，弹窗下次打开就是真值 */
export function syncDirectorLoras(snapshot: unknown): void {
  current = normalizeLoras(snapshot);
}

export function getDirectorLoras(): LoraRow[] {
  return current;
}

export function hasDirectorLoraSink(): boolean {
  return sink !== null;
}

/** 写入：先更新桥内快照，再交给导演台写 shared.params.loras（未挂载时只更新快照） */
export function setDirectorLoras(next: LoraRow[]): LoraRow[] {
  current = normalizeLoras(next);
  sink?.(current);
  return current;
}
