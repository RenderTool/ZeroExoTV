/**
 * CanvasLayer - 副本画布的挂载层（Plan#84，2026-11-06）
 *
 * 职责很薄（旧实现"代理卡事件 + 统计回写 + 孤儿提示"随模型一起废了）：
 * 1. 当前激活页签是副本画布（key = `canvas:<cid>`）→ 渲染 `CanvasWorkspace` 覆盖在画布区之上；
 * 2. 进入项目时按 `view-prefs.canvasTabs.openCanvasesByProject` 恢复"上次开着哪些副本"，
 *    文件已不存在的条目静默丢弃（不报错、不重建）；
 * 3. 不持有标签列表——标签的渲染在顶层 `CanvasTabBar`（与 1 号画布并排），数据在 canvas-tab-store。
 *
 * 与页签内容层的关系：1 号画布 = 固定槽位 `canvas`（由 editor-page 的主实例渲染，不走这里）；
 * 副本激活时 editor-page 不再渲染剧本/导演台内容层（`isOpenCanvasTabKey` 判定），避免两层重叠。
 */
import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@zeroexo/plugin-theme';
import {
  canvasTabKeyFor,
  openCanvasTabCid,
  useCanvasTabStore,
} from '@/features/canvas-tabs/canvas-tab-store.js';
import { useViewPrefsStore } from '@/shared/view-prefs.js';
import { listCanvases, MAIN_CANVAS_ID } from '@/entities/canvas-store.js';
import { CanvasWorkspace } from './CanvasWorkspace.js';

export interface CanvasLayerProps {
  projectId: string;
  /** 覆盖层 z-index（与页签内容层同一档，压在画布之上） */
  zIndex: number;
}

export function CanvasLayer({ projectId, zIndex }: CanvasLayerProps) {
  const { theme } = useTheme();
  const activeTabKey = useCanvasTabStore((s) => s.activeTabKey);
  const restoreCanvasTabs = useCanvasTabStore((s) => s.restoreCanvasTabs);
  const tabs = useCanvasTabStore((s) => s.openCanvasTabs);
  const [restored, setRestored] = useState<string | null>(null);
  const restoringRef = useRef(false);

  const isDark = theme.mode === 'dark';
  const activeCid = openCanvasTabCid(activeTabKey);

  // 进入项目（或切项目）时恢复打开集合；只保留磁盘上还在的副本
  useEffect(() => {
    if (!projectId || restoringRef.current) return;
    restoringRef.current = true;
    void (async () => {
      const ids = useViewPrefsStore.getState().canvasTabs.openCanvasesByProject[projectId] ?? [];
      if (ids.length === 0) {
        setRestored(projectId);
        return;
      }
      try {
        // 只读一次目录：既做存在性过滤，又取标题（上面(ids) 存的是 cid，标题以磁盘为准）
        const existing = new Map(
          (await listCanvases(projectId))
            .filter((c) => c.id !== MAIN_CANVAS_ID)
            .map((c) => [c.id, c.title] as const),
        );
        const restoredTabs = ids
          .filter((cid) => existing.has(cid))
          .map((cid) => ({ key: canvasTabKeyFor(cid), cid, title: existing.get(cid) ?? cid }));
        if (restoredTabs.length > 0) restoreCanvasTabs(restoredTabs);
      } catch (err) {
        // 目录未授权/读失败：不猜、不报错轰炸，留空集合
        console.warn('[CanvasLayer] 恢复副本画布页签失败（按无打开项处理）:', err);
      } finally {
        setRestored(projectId);
      }
    })();
  }, [projectId, restoreCanvasTabs, tabs.length]);

  // 当前激活的副本已不在打开集合里（被关掉/被删）→ 什么都不渲染，交回 1 号画布
  if (!activeCid) return null;
  if (restored !== projectId && tabs.length === 0) return null;

  return (
    <div
      data-canvas-layer
      style={{
        position: 'absolute', inset: 0, zIndex, display: 'flex', flexDirection: 'column',
        pointerEvents: 'auto', background: theme.canvas.background,
      }}
    >
      <CanvasWorkspace
        // key 绑定 cid：切换副本 = 重建实例（undo 栈与画布一一对应）
        key={activeCid}
        projectId={projectId}
        cid={activeCid}
        theme={theme}
        isDark={isDark}
      />
    </div>
  );
}
