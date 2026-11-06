/**
 * 时间轴「插入落点」纯函数（2026-09-02 重构：整段占位虚线框方案）
 *
 * 产品契约（约定）：拖拽插入时，插入缝隙处显示**整段蓝色虚线占位框**
 * （宽度=将插入片段的时长 × pixelsPerSecond），占位框在哪，松手素材就插到哪。
 *
 * 本模块是占位框位置与真实插入下标的**唯一事实源**：
 * - computeInsertIndex(x, clips)：指针 x → 插入下标 index ∈ [0..clips.length]
 * - insertSeamX(index, clips)：  index → 占位框 left（= 插入后新片段的 left，语义见下）
 * 二者同源 —— 渲染占位框的 index 与 drop 执行的 splice index 永远是同一个。
 */
import { CLIP_GAP, CLIP_MIN_WIDTH } from './timeline-constants';

export type DropClip = { left: number; width: number };

/**
 * 指针 x（内容坐标）→ 插入下标。
 * 判定采用**中点归属**：落点在某 clip 左半 → 插到它前面（i）；右半 → 插到它后面（i+1）；
 * 所有 clip 右侧之后 → 末尾（length）。
 * 只产出整数下标 —— 渲染占位框 left / drop 都从这里取，禁止另写一套像素换算。
 */
export function computeInsertIndex(x: number, clips: DropClip[]): number {
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    if (!c) continue;
    if (x < c.left + c.width / 2) return i; // 插到 clips[i] 之前
  }
  return clips.length; // 末尾
}

/**
 * 插入下标 → 占位框 left（绝对坐标）。
 * 语义：插入后新片段紧邻「前 index 个 clip」右侧 —— 其 left 恰等于：
 * - index < len        → clips[index].left（前 index 个 clip 总宽 + index 个 gap）
 * - index === len      → 最后一个 clip 的 right + gap（末尾）
 * - 空轨道（len === 0）→ 0
 * 因此「占位框显示的位置」与「splice(index) 插入后新 clip 的实际 left」逐像素一致。
 */
export function insertSeamX(index: number, clips: DropClip[]): number {
  const len = clips.length;
  if (len === 0) return 0;
  if (index >= len) {
    const last = clips[len - 1];
    if (!last) return 0;
    return last.left + last.width + CLIP_GAP;
  }
  if (index < 0) return 0;
  const target = clips[index];
  if (!target) return 0;
  return target.left;
}

/** 素材时长(秒) → 占位框像素宽度（clamp 到最小可视宽，防超短素材占位不可见） */
export function clipPlaceholderWidth(durationSec: number, pixelsPerSecond: number): number {
  if (!durationSec || durationSec <= 0) return CLIP_MIN_WIDTH;
  return Math.max(CLIP_MIN_WIDTH, durationSec * pixelsPerSecond);
}

/**
 * 内部片段拖拽（重排）后，被拖片段**落位后的 left**（像素，内容坐标）。
 *
 * @param currentIdx 被拖片段当前数组下标（clips 含它）
 * @param finalIdx   被拖片段松手后的**最终数组下标**（即 handleClipPointerUp 里折算后的 insertAt：
 *                   `dropTargetIdx > currentIdx ? dropTargetIdx - 1 : dropTargetIdx`）
 *
 * 移除自身后，新序列前 finalIdx 个 clip 的累计宽度 + finalIdx×gap = 落位 left。
 * 占位框画在这里，松手后片段落位即严丝合缝 —— 杜绝「占位在这、落位在那」。
 */
export function movedClipLeft(
  currentIdx: number,
  finalIdx: number,
  clips: DropClip[],
): number {
  const len = clips.length;
  if (len === 0) return 0;
  if (finalIdx < 0) finalIdx = 0;
  if (finalIdx >= len) finalIdx = len - 1; // clamp 到末尾下标
  if (finalIdx === currentIdx) return clips[currentIdx]?.left ?? 0;
  let sumW = 0;
  let count = 0;
  for (let i = 0; i < len && count < finalIdx; i++) {
    if (i === currentIdx) continue;
    const c = clips[i];
    if (!c) continue;
    sumW += c.width;
    count++;
  }
  return count === finalIdx ? sumW + finalIdx * CLIP_GAP : 0;
}
