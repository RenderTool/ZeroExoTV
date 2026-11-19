/**
 * 主体状态/主体删除后清理导演台槽位引用。
 *
 * 主体媒体是导演台参考图的一类来源；删除状态后如果 shot.references 还留着
 * origin=subject-state 的旧条目，导演台插槽会继续显示已删图片（引用失效）。
 * 这里按 rootId/nodeId（或 subject-state:<root>/<state> id）精确移除。
 */
import { readWorkbenchContainer, updateWorkbenchContainer } from '@/entities/slot-containers.js';
import type { WorkbenchShot, WorkbenchShotReference } from '@/features/canvas-nodes/storyboard/workbench-types.js';

/**
 * 删除主体引用后同步清掉提示词里的悬空 token：
 * - 去掉 `<Subject N> ...` 定义行；
 * - 从「主体锚定：」行去掉 `<Subject N>＝...` 段；
 * - 正文 `<Subject N>` 替换成主体名（保留文字描述，不再指向已删图）；
 * - 去掉 `@PictureN` / `@AudioN` / `@VideoN`。
 */
function prunePromptForRemovedSlots(prompt: string, removed: Array<{ slot: number; title: string }>): string {
  if (!prompt || removed.length === 0) return prompt;
  let out = prompt;
  for (const { slot, title } of removed) {
    const subject = `<Subject ${slot}>`;
    const picture = `@Picture${slot}`;
    // 定义行
    out = out.split('\n').filter((line) => !line.trimStart().startsWith(subject)).join('\n');
    // 主体锚定段
    out = out
      .split('\n')
      .map((line) => {
        if (!line.startsWith('主体锚定：')) return line;
        const head = '主体锚定：';
        const body = line.slice(head.length);
        const kept = body
          .split('；')
          .filter((part) => !part.includes(subject) && !part.includes(picture))
          .join('；');
        return kept.trim() ? `${head}${kept}` : '';
      })
      .filter((line) => line !== '')
      .join('\n');
    // 正文 token：先换成名字，再清掉图片引用
    out = out.split(subject).join(title || '该主体');
    out = out.split(picture).join('');
  }
  return out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function removeSubjectReferences(
  projectId: string,
  rootId: string,
  stateId?: string,
  mediaKey?: string,
): Promise<void> {
  if (!projectId || !rootId) return;
  const wb = await readWorkbenchContainer(projectId).catch(() => null);
  if (!wb || !Array.isArray(wb.shots)) return;
  const key = stateId ? `subject-state:${rootId}/${stateId}` : '';
  let changed = false;
  const shots = (wb.shots as WorkbenchShot[]).map((shot) => {
    const refs = (shot.references ?? []) as WorkbenchShotReference[];
    const removedRefs = refs.filter((ref) => {
      const origin = ref.origin;
      const byState = !!origin
        && origin.kind === 'subject-state'
        && origin.rootId === rootId
        && (!stateId || origin.nodeId === stateId)
        && (!mediaKey || origin.mediaKey === mediaKey || ref.storageKey === mediaKey);
      const byBase = !stateId && !!origin && origin.kind === 'subject-base' && origin.rootId === rootId;
      const byId = !!stateId && !mediaKey && ref.id === key;
      // 旧/直挂主体图：`subject:<id>` 整主体、`subject:<id>:<storageKey>` 具体状态图都不带 origin，
      // 删除主体时必须按 id 前缀一并清掉，否则会留下「主体已删、插槽还在」的僵尸图。
      const byDirectSubject = !stateId && (ref.id === `subject:${rootId}` || ref.id.startsWith(`subject:${rootId}:`));
      return byState || byBase || byId || byDirectSubject;
    });
    if (removedRefs.length === 0) return shot;
    changed = true;
    const removed = removedRefs.map((ref) => ({
      slot: ref.slotNo ?? 0,
      title: ref.title ?? '',
    })).filter((r) => r.slot > 0);
    return {
      ...shot,
      references: refs.filter((ref) => !removedRefs.includes(ref)),
      ...(removed.length ? {
        imagePrompt: prunePromptForRemovedSlots(shot.imagePrompt ?? '', removed),
        videoPrompt: prunePromptForRemovedSlots(shot.videoPrompt ?? '', removed),
      } : {}),
    };
  });
  if (changed) await updateWorkbenchContainer(projectId, { shots });
}
