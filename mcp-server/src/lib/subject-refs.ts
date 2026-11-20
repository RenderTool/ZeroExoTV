/**
 * 主体引用 → 当前图（MCP 侧，2026-11-20）
 *
 * 网页的 `resolveRefVisual` 每次提交都按主体树实时解析；MCP 原先直接用
 * `references[].storageKey`，主体换图后仍传旧 key（实测：`cas:23d2e809` 旧图仍在用）。
 * 这里复刻同一套语义（不依赖前端代码）：
 *   - origin.kind = subject-base  → 基础状态图 / 按 mediaKey 回查 / 该主体首图
 *   - origin.kind = subject-state → 状态图（先 nodeId，再 state 名）/ 按 mediaKey 回查 /
 *     状态名对不上时按该主体当前首图回落；整树无图才算失效
 *   - 旧式 `subject-state:<itemId>/<state>` / `subject:<id>` → 同上
 *   - 其它（上传/色卡）→ 原 storageKey
 */

export interface RefOriginLike {
  kind?: string;
  rootId?: string;
  state?: string;
  mediaKey?: string;
  nodeId?: string;
}

export interface RefLike {
  id: string;
  title?: string;
  storageKey?: string;
  kind?: string;
  origin?: RefOriginLike;
}

interface MediaLike { key?: string; type?: string }
interface StateLike { id?: string; state?: string; media?: MediaLike[] }
interface TreeLike { rootId?: string; itemId?: string; name?: string; aliases?: string[]; states?: StateLike[] }

const BASE_STATE_ID = '__base__';

function firstImage(state?: StateLike): MediaLike | undefined {
  return state?.media?.find((m) => m.type !== 'audio');
}

function allImages(tree: TreeLike): MediaLike[] {
  return (tree.states ?? []).flatMap((st) => st.media ?? []).filter((m) => m.type !== 'audio');
}

function findTree(trees: TreeLike[], rootId?: string, title?: string): TreeLike | undefined {
  const byId = rootId ? trees.find((t) => t.rootId === rootId || t.itemId === rootId) : undefined;
  if (byId) return byId;
  const name = (title ?? '').trim();
  if (!name) return undefined;
  return trees.find((t) => [t.name, ...(t.aliases ?? [])].some((n) => n && (name === n || name.startsWith(`${n}-`))));
}

export function resolveRefStorageKey(
  ref: RefLike,
  subjectTree: unknown,
): { key?: string; stale?: boolean } {
  const trees = (Array.isArray(subjectTree) ? subjectTree : []) as TreeLike[];
  if (trees.length === 0) return { key: ref.storageKey };

  const byOrigin = (origin: RefOriginLike): { key?: string; stale?: boolean } => {
    const tree = findTree(trees, origin.rootId, ref.title);
    if (!tree) return { stale: true };
    const images = allImages(tree);
    if (origin.kind === 'subject-base') {
      const base = (tree.states ?? []).find((st) => st.id === BASE_STATE_ID) ?? (tree.states ?? [])[0];
      const inBase = firstImage(base);
      const byKey = images.find((m) => m.key === origin.mediaKey);
      const media = inBase ?? byKey ?? images[0];
      return media?.key ? { key: media.key } : { stale: true };
    }
    // subject-state（含状态名被重建/合并的情况）
    const state = origin.nodeId
      ? (tree.states ?? []).find((st) => st.id === origin.nodeId)
      : (tree.states ?? []).find((st) => st.state === origin.state);
    const inState = firstImage(state);
    const byKey = images.find((m) => m.key === origin.mediaKey);
    const matched = inState ?? byKey;
    if (matched?.key) return { key: matched.key };
    if (!state && images[0]?.key) return { key: images[0].key };
    return { stale: true };
  };

  if (ref.origin && trees.length > 0) {
    if (ref.origin.kind === 'subject-base' || ref.origin.kind === 'subject-state') {
      return byOrigin(ref.origin);
    }
  }

  const legacyPrefix = ref.id.startsWith('subject-state:') ? 'subject-state:' : ref.id.startsWith('subject:') ? 'subject:' : null;
  if (legacyPrefix) {
    const rest = ref.id.slice(legacyPrefix.length);
    const itemId = rest.split('/')[0] ?? '';
    const oldKey = rest.includes('/') ? rest.slice(itemId.length + 1) : '';
    const tree = findTree(trees, itemId, ref.title);
    if (!tree) return { stale: true };
    const images = allImages(tree);
    const state = (tree.states ?? []).find((st) => st.media?.some((m) => m.key === oldKey))
      ?? (tree.states ?? []).find((st) => st.state && (ref.title ?? '').endsWith(st.state))
      ?? (tree.states ?? [])[0];
    const media = firstImage(state) ?? images[0];
    return media?.key ? { key: media.key } : {};
  }

  return { key: ref.storageKey };
}
