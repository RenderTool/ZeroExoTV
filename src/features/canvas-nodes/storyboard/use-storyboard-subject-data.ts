/**
 * 主体库容器数据 hook（2026-11-05）
 *
 * 整页「主体库」页签与资产抽屉「主体」分段共用这一条加载/写回链路：
 * 唯一事实源 = 项目级容器 projects/<projectId>/entities/storyboard.json
 * （@/entities/slot-containers：entities=主体条目 ProductionItem[]，subjectTree=主体树）。
 *
 * 容器缺失时自愈挂载（ensure 幂等，只写实体 JSON，不读 graph）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { useTranslation } from 'react-i18next';
import {
  ensureStoryboardContainer,
  readStoryboardContainer,
  updateStoryboardContainer,
  type StoryboardContainer,
  type StoryboardContainerPatch,
  type StoryboardContainerPatchFn,
} from '@/entities/slot-containers.js';
import {
  createProductionItem,
  nextUniqueName,
  type ProductionItem,
  type ProductionItemKind,
} from '@/features/canvas-nodes/production-manager/production-manager-types.js';
import type { SubjectTree } from '@/features/canvas-nodes/storyboard/subject-tree-types.js';

export type StoryboardSubjectLoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface StoryboardSubjectData {
  container: StoryboardContainer | null;
  loadState: StoryboardSubjectLoadState;
  subjects: ProductionItem[];
  subjectTree: SubjectTree[];
  addSubject: (kind: ProductionItemKind) => void;
  updateItem: (itemId: string, patch: Partial<ProductionItem>) => void;
  /** 批量改（2026-11-06 主体库批量编辑）：一次写回 = 一个版本 + 一份快照，不是 N 笔写排队 */
  updateItems: (itemIds: readonly string[], patch: Partial<ProductionItem>) => void;
  deleteItem: (itemId: string) => void;
  /** 批量删除（同上，单笔写回） */
  deleteItems: (itemIds: readonly string[]) => void;
  changeTree: (trees: SubjectTree[]) => void;
}

export function useStoryboardSubjectData(
  projectId: string | null,
  enabled = true,
): StoryboardSubjectData {
  const { t } = useTranslation();
  const [container, setContainer] = useState<StoryboardContainer | null>(null);
  const [loadState, setLoadState] = useState<StoryboardSubjectLoadState>('idle');

  useEffect(() => {
    const pid = enabled ? projectId : null;
    if (!pid) {
      setContainer(null);
      setLoadState('idle');
      return;
    }
    let cancelled = false;
    setLoadState('loading');
    readStoryboardContainer(pid)
      .then(async (found) => {
        if (cancelled) return null;
        if (found) return found;
        const ensured = await ensureStoryboardContainer(pid);
        return ensured.container;
      })
      .then((c) => {
        if (cancelled || !c) return;
        setContainer(c);
        setLoadState('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('[useStoryboardSubjectData] read storyboard container failed:', err);
        setLoadState('error');
      });
    return () => { cancelled = true; };
  }, [enabled, projectId]);

  const subjects = useMemo(
    () => ((container?.entities ?? []) as ProductionItem[]).filter((it) => it && typeof it === 'object'),
    [container],
  );

  // 胶囊计数同源：本实例每次拿到新容器（初次加载 / 任何一笔写回）都 publish
  useEffect(() => {
    if (!projectId || !container) return;
    useSubjectCountStore.getState().publish(projectId, (container.entities ?? []).length);
  }, [projectId, container]);
  const subjectTree = useMemo(
    () => ((container?.subjectTree ?? []) as SubjectTree[]),
    [container],
  );

  /**
   * 写回容器并即时刷新本地状态（写 API 返回落盘后的最新容器）。
   * 2026-11-06：patch 可为函数式——在存储层真正读到最新容器之后才算新值，
   * 避开「用渲染期 subjects 数组覆盖另一笔刚写入的 entities」这种丢写
   * （改类型 = subjectTree + entities 两笔连发，正是此处踩过的问题）。
   */
  const applyPatch = useCallback(
    (patch: StoryboardContainerPatch | StoryboardContainerPatchFn) => {
      if (!projectId) return;
      updateStoryboardContainer(projectId, patch)
        .then(setContainer)
        .catch((err: unknown) => console.error('[useStoryboardSubjectData] write container failed:', err));
    },
    [projectId],
  );

  const addSubject = useCallback(
    (kind: ProductionItemKind) => {
      // 名字自动递增（新主体 → 新主体 2 → …）：在刚读到的最新 entities 上算，
      // 连点两次也不会拿到同一个名字（同名 = 背地串台的根源）
      applyPatch((c) => {
        const entities = (c.entities ?? []) as ProductionItem[];
        const name = nextUniqueName(entities.map((it) => it?.name), t('canvasTab.newSubject', '新主体'));
        return { entities: [...entities, createProductionItem(kind, name)] };
      });
    },
    [applyPatch, t],
  );

  const updateItem = useCallback(
    (itemId: string, patch: Partial<ProductionItem>) => {
      applyPatch((c) => ({
        entities: ((c.entities ?? []) as ProductionItem[]).map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
      }));
    },
    [applyPatch],
  );

  const updateItems = useCallback(
    (itemIds: readonly string[], patch: Partial<ProductionItem>) => {
      if (itemIds.length === 0) return;
      const ids = new Set(itemIds);
      applyPatch((c) => ({
        entities: ((c.entities ?? []) as ProductionItem[]).map((it) => (ids.has(it.id) ? { ...it, ...patch } : it)),
      }));
    },
    [applyPatch],
  );

  const deleteItem = useCallback(
    (itemId: string) => {
      applyPatch((c) => ({ entities: ((c.entities ?? []) as ProductionItem[]).filter((it) => it.id !== itemId) }));
    },
    [applyPatch],
  );

  const deleteItems = useCallback(
    (itemIds: readonly string[]) => {
      if (itemIds.length === 0) return;
      const ids = new Set(itemIds);
      applyPatch((c) => ({ entities: ((c.entities ?? []) as ProductionItem[]).filter((it) => !ids.has(it.id)) }));
    },
    [applyPatch],
  );

  const changeTree = useCallback(
    (trees: SubjectTree[]) => {
      applyPatch({ subjectTree: trees });
    },
    [applyPatch],
  );

  return { container, loadState, subjects, subjectTree, addSubject, updateItem, updateItems, deleteItem, deleteItems, changeTree };
}

// ===== 主体总数（抽屉胶囊「主体 N」共用一份，2026-11-06）=====
// 胶囊在分段条上（任何分段都要可见），而容器只有主体分段挂载时才读——
// 所以计数放到模块级 store：任何一条 hook 实例读到/写完容器都 publish，
// 胶囊只订阅；本地无缓存时自己补读一次，不重复拉同一份 JSON。
interface SubjectCountState {
  totals: Record<string, number>;
  publish: (projectId: string, total: number) => void;
}

const useSubjectCountStore = create<SubjectCountState>((set, get) => ({
  totals: {},
  publish: (projectId, total) => {
    if (get().totals[projectId] === total) return;
    set((s) => ({ totals: { ...s.totals, [projectId]: total } }));
  },
}));

/** 主体总数（null = 尚未加载，胶囊不显示数字，与开源库计数同语义） */
export function useSubjectTotalCount(projectId: string | null | undefined): number | null {
  const totals = useSubjectCountStore((s) => s.totals);
  const cached = projectId ? totals[projectId] : undefined;
  useEffect(() => {
    if (!projectId || totals[projectId] !== undefined) return;
    let cancelled = false;
    readStoryboardContainer(projectId)
      .then((c) => { if (!cancelled) useSubjectCountStore.getState().publish(projectId, (c?.entities ?? []).length); })
      .catch(() => { if (!cancelled) useSubjectCountStore.getState().publish(projectId, 0); });
    return () => { cancelled = true; };
  }, [projectId, totals]);
  return cached ?? null;
}
