/**
 * 主体状态/主体删除后清理导演台槽位引用。
 *
 * 主体媒体是导演台参考图的一类来源；删除状态后如果 shot.references 还留着
 * origin=subject-state 的旧条目，导演台插槽会继续显示已删图片（引用失效）。
 * 这里按 rootId/nodeId（或 subject-state:<root>/<state> id）精确移除。
 */
import { readWorkbenchContainer, updateWorkbenchContainer } from '@/entities/slot-containers.js';
import type { WorkbenchShot, WorkbenchShotReference } from '@/features/canvas-nodes/storyboard/workbench-types.js';

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
    const next = refs.filter((ref) => {
      const origin = ref.origin;
      const byState = !!origin
        && origin.kind === 'subject-state'
        && origin.rootId === rootId
        && (!stateId || origin.nodeId === stateId)
        && (!mediaKey || origin.mediaKey === mediaKey || ref.storageKey === mediaKey);
      const byBase = !stateId && !!origin && origin.kind === 'subject-base' && origin.rootId === rootId;
      const byId = !!stateId && !mediaKey && ref.id === key;
      return !(byState || byBase || byId);
    });
    if (next.length === refs.length) return shot;
    changed = true;
    return { ...shot, references: next };
  });
  if (changed) await updateWorkbenchContainer(projectId, { shots });
}
