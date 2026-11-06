/**
 * script-history — 剧本编辑器撤销/重做历史栈（2026-11-04 删除丢内容修复）
 *
 * 背景：结构化编辑器的删除段落/删除字符等操作此前直接改 lines 数组，
 * 没有任何历史栈——删掉的段落对用户等于永久丢失。本模块提供编辑器级历史：
 *  - 快照单位 = ScriptLine[]（行数组，引用不可变，push 不复制内容）；
 *  - 栈深上限 SCRIPT_HISTORY_LIMIT（可撤销步数；栈容量 = 步数 + 1 份初始基线），超出丢最旧；
 *  - 连续输入合并：同一 mergeKey（如同一行的文本输入）在 MERGE_MS 时间窗内
 *    替换栈顶（一个字一步 → 一段连续输入一步）；mergeKey = null 表示独立步骤
 *    （删除段落/插入行/类型切换等结构或格式化操作，绝不合并）；
 *  - 粘贴/剪切前调用 breakMerge() 打断合并链，使其成为独立一步；
 *  - 序列化签名去重：内容与栈顶相同时不入栈（幂等，防 StrictMode 双调用重复入栈）。
 *
 * 注意：历史栈只在编辑器会话内存活（关闭/重开即丢，允许）；
 * 跨会话兜底由 script-store 的「保存前备份」承担（entities/backups/）。
 */
import type { ScriptLine } from './script-lines.js';

/** 可撤销步数上限（≥100 步；栈容量 = 步数 + 1 份初始基线） */
export const SCRIPT_HISTORY_LIMIT = 100;

/** 连续输入合并窗口（ms）：窗口内同 mergeKey 的 push 替换栈顶 */
export const SCRIPT_HISTORY_MERGE_MS = 800;

/** 撤销/重做控制句柄（父组件工具栏按钮用） */
export interface ScriptHistoryControls {
  undo: () => void;
  redo: () => void;
}

export class ScriptHistory {
  private entries: ScriptLine[][] = [];
  private index = -1;
  private lastMergeKey: string | null = null;
  private lastPushAt = 0;

  /** @param sig 行数组 → 稳定签名的函数（用于无变化跳过） */
  constructor(private readonly sig: (lines: ScriptLine[]) => string) {}

  /** 重置历史（初始载入 / 外部 value 变化：切剧集、远端同步） */
  reset(lines: ScriptLine[]): void {
    this.entries = [lines];
    this.index = 0;
    this.lastMergeKey = null;
    this.lastPushAt = 0;
  }

  /**
   * 记录一次编辑结果。
   * @param mergeKey 非空且与上次相同、且在合并窗口内 → 替换栈顶（合并）；
   *                 null → 独立步骤（结构/格式化操作）。
   */
  push(lines: ScriptLine[], mergeKey: string | null, now = Date.now()): void {
    const top = this.entries[this.index];
    if (top && this.sig(top) === this.sig(lines)) return; // 无变化不入栈
    if (
      mergeKey !== null
      && top
      && this.index === this.entries.length - 1 // 已存在 redo 分支时不合并
      && this.lastMergeKey === mergeKey
      && now - this.lastPushAt < SCRIPT_HISTORY_MERGE_MS
    ) {
      this.entries[this.index] = lines; // 合并：替换栈顶
    } else {
      this.entries.length = this.index + 1; // 截断 redo 分支
      this.entries.push(lines);
      this.index += 1;
      if (this.entries.length > SCRIPT_HISTORY_LIMIT + 1) {
        this.entries.shift();
        this.index -= 1;
      }
    }
    this.lastMergeKey = mergeKey;
    this.lastPushAt = now;
  }

  /** 打断合并链（粘贴/剪切前调用，使其成为独立一步） */
  breakMerge(): void {
    this.lastMergeKey = null;
  }

  /** 撤销：返回上一状态；已在栈底返回 null */
  undo(): ScriptLine[] | null {
    if (this.index <= 0) return null;
    this.index -= 1;
    this.lastMergeKey = null;
    return this.entries[this.index] ?? null;
  }

  /** 重做：返回下一状态；已在栈顶返回 null */
  redo(): ScriptLine[] | null {
    if (this.index >= this.entries.length - 1) return null;
    this.index += 1;
    this.lastMergeKey = null;
    return this.entries[this.index] ?? null;
  }

  canUndo(): boolean {
    return this.index > 0;
  }

  canRedo(): boolean {
    return this.index < this.entries.length - 1;
  }
}
