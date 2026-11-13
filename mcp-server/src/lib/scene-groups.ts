/**
 * scene-groups — 场景主体归并（2026-11-13 用户拍板）
 *
 * 规则：**一个地点/建筑 = 一个场景主体**；同一建筑里的宴会厅、办公室、走廊、保安部
 * 不是新主体，而是同一主体下的状态（视图）。
 *
 * 这个文件只做纯分组：从场景名提取「地点键」（云顶大厦），供 consolidate_scenes 合并。
 */

export interface SceneEntityLike {
  id?: string;
  name?: string;
  kind?: string;
}

export interface SceneGroup {
  key: string;
  targetId: string;
  targetName: string;
  sources: Array<{ id: string; name: string }>;
}

/** 地点关键词：命中即取前缀作为地点键（云顶大厦28层总裁办公室 → 云顶大厦） */
const PLACE_RE = /^(.{2,12}?(?:大厦|酒店|医院|学校|公司|公寓|别墅|庄园|广场|中心|机场|车站|街道|村|城|府|宫|殿|楼|苑|湾|岛|园区|基地))/;

/** 场景名 → 地点键；单点场景返回 null（不参与合并） */
export function sceneGroupKey(name: string): string | null {
  const n = (name ?? "").trim();
  if (n.length < 3) return null;
  const m = n.match(PLACE_RE);
  if (m) return m[1]!.trim();
  // 没有地点关键词：用「·」「-」「—」前的第一段（如 云顶大厦·宴会厅）
  const head = n.split(/[·・|—–-]/)[0]?.trim() ?? "";
  if (head.length >= 2 && head !== n) return head;
  return null;
}

/** 场景实体 → 需要合并的组（只返回 ≥2 个主体的组） */
export function groupSceneEntities(entities: readonly SceneEntityLike[]): SceneGroup[] {
  const groups = new Map<string, Array<{ id: string; name: string }>>();
  for (const e of entities) {
    if (e.kind !== "scene" || typeof e.id !== "string" || typeof e.name !== "string") continue;
    const key = sceneGroupKey(e.name);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push({ id: e.id, name: e.name });
    groups.set(key, list);
  }
  const out: SceneGroup[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const target = list.find((x) => x.name === key) ?? list[0]!;
    out.push({
      key,
      targetId: target.id,
      targetName: target.name,
      sources: list.filter((x) => x.id !== target.id),
    });
  }
  return out;
}
