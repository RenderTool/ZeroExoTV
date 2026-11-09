/**
 * useCanvasDocumentSwitch - 画布级页签 = **同一套画布界面切换文档**（2026-11-06 用户纠偏）
 *
 * 口径：画布副本不是"另一个工作区"，就是项目目录里的另一份画布文档。
 * 打开副本 = 把主画布这个编辑器切到那份文档（视图/工具栏/交互/快捷键全部同一套），
 * 不再创建第二个引擎实例、也不再自己写第二套画布界面。
 *
 * 自动保存的两条通道（互斥）：
 * - 主画布文档：`PersistencePlugin`（`.lf` 主 graph）——在副本打开期间 `pause()`，回到主画布 `resume()`；
 * - 副本文档：`entities/canvas-store` 写 `projects/<pid>/canvases/<cid>.json`，500ms 防抖 + size/mtime 乐观锁。
 *
 * 切换顺序固定为「先落盘当前文档 → 再换图」，避免把副本内容写进主画布键。
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { App } from 'antd';
import { useTranslation } from 'react-i18next';
import type { CommandQueue, GraphModel } from '@zeroexo/core';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import { loadProjectGraph } from '@zeroexo/plugin-persistence';
import { setGeneratingPreviewCanvas } from '@zeroexo/plugin-nodes';
import { useViewPrefsStore } from '@/shared/view-prefs.js';
import { MAIN_CANVAS_DOC_ID, setCurrentCanvasDocId } from '@/shared/current-canvas-doc.js';
import {
  getCanvas,
  isCanvasConflict,
  listCanvases,
  saveCanvas,
  MAIN_CANVAS_ID,
  type CanvasStamp,
} from '@/entities/canvas-store.js';
import {
  CANVAS_TAB_KEY,
  canvasTabKeyFor,
  isCanvasDiscarded,
  openCanvasTabCid,
  useCanvasTabStore,
} from './canvas-tab-store.js';

/** 主画布持久化插件在本模块用到的最小面（PersistencePlugin 结构兼容） */
interface PersistenceLike {
  save(): Promise<void>;
  waitForSave(): Promise<void>;
  pause(): void;
  resume(): void;
}

/** 切换文档所需的最小编辑器面（DefaultEditor 结构兼容） */
export interface CanvasDocEditor {
  store: ReactGraphStore;
  core: { commandQueue: CommandQueue };
  plugins: { persistence?: PersistenceLike };
}

export interface UseCanvasDocumentSwitchOptions {
  projectId: string;
  editor: CanvasDocEditor | null;
}

const COPY_SAVE_DEBOUNCE_MS = 500;

const EMPTY_VIEWPORT = { x: 0, y: 0, k: 1 } as const;

function viewportOf(graph: GraphModel): { x: number; y: number; k: number } {
  return graph.viewport ?? EMPTY_VIEWPORT;
}

export function useCanvasDocumentSwitch({ projectId, editor }: UseCanvasDocumentSwitchOptions): void {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const activeTabKey = useCanvasTabStore((s) => s.activeTabKey);
  const activateTab = useCanvasTabStore((s) => s.activateTab);

  /** 当前已装载进编辑器的画布 cid（主画布 = 'main'） */
  const currentCidRef = useRef<string>(MAIN_CANVAS_ID);
  const switchingRef = useRef(false);
  const pendingRef = useRef<string | null>(null);

  const stampRef = useRef<CanvasStamp | null>(null);
  /** 冲突未决 → 暂停副本自动保存（禁止静默覆盖外部修改） */
  const conflictRef = useRef(false);
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const unsubGraphRef = useRef<(() => void) | null>(null);

  const stopCopyAutosave = useCallback(() => {
    unsubGraphRef.current?.();
    unsubGraphRef.current = null;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  /** 副本冲突：居中确认（重载外部版 / 保留本地并覆盖） */
  const askConflictResolution = useCallback(() => {
    const ed = editor;
    const cid = currentCidRef.current;
    if (!ed || cid === MAIN_CANVAS_ID) return;
    modal.confirm({
      title: t('canvasCopy.conflictTitle', '这份画布文件已被外部修改'),
      content: t('canvasCopy.conflictBody', '磁盘上的画布与编辑器内内容不一致（MCP 或手动改过文件）。请选择保留哪一份。'),
      centered: true,
      okText: t('canvasCopy.conflictReload', '重载外部版本'),
      cancelText: t('canvasCopy.conflictKeepLocal', '保留本地并覆盖'),
      onOk: async () => {
        const got = await getCanvas(projectId, cid);
        if (got) {
          stampRef.current = got.stamp;
          ed.core.commandQueue.replaceState(got.graph);
          ed.store.setSelection({ selectedNodeIds: new Set(), selectedEdgeIds: new Set() });
          ed.store.setViewport(viewportOf(got.graph));
        }
        conflictRef.current = false;
        dirtyRef.current = false;
        message.success(t('canvasCopy.conflictReloaded', '已重载磁盘上的画布'));
      },
      onCancel: async () => {
        try {
          await saveCanvas(projectId, cid, { graph: ed.core.commandQueue.getState() }, null);
          const got = await getCanvas(projectId, cid);
          stampRef.current = got?.stamp ?? null;
          conflictRef.current = false;
          dirtyRef.current = false;
          message.success(t('canvasCopy.conflictOverwritten', '已用编辑器内容覆盖磁盘文件'));
        } catch (err) {
          console.error('[canvas-doc] overwrite failed:', err);
          message.error(t('canvasCopy.saveFailed', '画布保存失败，请重试'));
        }
      },
    });
  }, [editor, projectId, modal, message, t]);

  /** 立即写盘当前副本；返回 false 表示冲突未决（此时不要继续切换） */
  const saveCopyNow = useCallback(async (): Promise<boolean> => {
    const ed = editor;
    const cid = currentCidRef.current;
    if (!ed || cid === MAIN_CANVAS_ID) return true;
    if (conflictRef.current) return false;
    // 已被显式删除的副本：不要因为关闭页签/切换文档又把文件写回来
    if (isCanvasDiscarded(cid)) {
      dirtyRef.current = false;
      return true;
    }
    if (!dirtyRef.current) return true;
    try {
      await saveCanvas(projectId, cid, { graph: ed.core.commandQueue.getState() }, stampRef.current);
      const got = await getCanvas(projectId, cid);
      stampRef.current = got?.stamp ?? null;
      dirtyRef.current = false;
      return true;
    } catch (err) {
      if (isCanvasConflict(err)) {
        conflictRef.current = true;
        askConflictResolution();
        return false;
      }
      console.error('[canvas-doc] save failed:', err);
      message.error(t('canvasCopy.saveFailed', '画布保存失败，请重试'));
      return false;
    }
  }, [editor, projectId, askConflictResolution, message, t]);

  /** 落盘当前文档：主画布走持久化插件，副本走 canvas-store */
  const flushCurrent = useCallback(async (): Promise<boolean> => {
    const ed = editor;
    if (!ed) return false;
    if (currentCidRef.current === MAIN_CANVAS_ID) {
      const persistence = ed.plugins.persistence;
      if (persistence) {
        await persistence.save();
        await persistence.waitForSave();
      }
      return true;
    }
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    return saveCopyNow();
  }, [editor, saveCopyNow]);

  const startCopyAutosave = useCallback((cid: string) => {
    const ed = editor;
    if (!ed) return;
    stopCopyAutosave();
    const schedule = () => {
      if (currentCidRef.current !== cid) return;
      if (conflictRef.current) return;
      dirtyRef.current = true;
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        void saveCopyNow();
      }, COPY_SAVE_DEBOUNCE_MS);
    };
    unsubGraphRef.current = ed.store.subscribeGraph(schedule);
  }, [editor, stopCopyAutosave, saveCopyNow]);

  const switchTo = useCallback(async (cid: string) => {
    const ed = editor;
    if (!ed || !projectId) return;
    if (cid === currentCidRef.current) return;
    if (switchingRef.current) {
      pendingRef.current = cid;
      return;
    }
    switchingRef.current = true;
    try {
      const flushed = await flushCurrent();
      if (!flushed) {
        // 冲突未决：本次切换中止，等用户处理完再点
        return;
      }
      if (cid === MAIN_CANVAS_ID) {
        stopCopyAutosave();
        const graph = await loadProjectGraph(projectId);
        if (!graph) throw new Error('main graph missing');
        // 先声明「当前文档 = 主画布」再换图：Yjs 推送守卫按此判断，副本内容绝不进主文档
        setCurrentCanvasDocId(MAIN_CANVAS_DOC_ID);
        setGeneratingPreviewCanvas(MAIN_CANVAS_DOC_ID);
        ed.core.commandQueue.replaceState(graph);
        ed.store.setSelection({ selectedNodeIds: new Set(), selectedEdgeIds: new Set() });
        ed.store.setViewport(viewportOf(graph));
        ed.plugins.persistence?.resume();
      } else {
        // 先停主画布自动保存，再换图（顺序反了会把副本书写进主画布键）
        ed.plugins.persistence?.pause();
        const got = await getCanvas(projectId, cid);
        if (!got) {
          // 文件已被外部删除：回主画布，不猜、不重建
          setCurrentCanvasDocId(MAIN_CANVAS_DOC_ID);
          setGeneratingPreviewCanvas(MAIN_CANVAS_DOC_ID);
          ed.plugins.persistence?.resume();
          activateTab(CANVAS_TAB_KEY);
          message.warning(t('canvasCopy.missing', '画布副本文件不存在（可能已被外部删除）'));
          return;
        }
        // 换图前先切文档作用域：副本是另一份文档，不得把它的节点/生成态写进主画布 Y.Doc
        setCurrentCanvasDocId(cid);
        setGeneratingPreviewCanvas(cid);
        ed.core.commandQueue.replaceState(got.graph);
        ed.store.setSelection({ selectedNodeIds: new Set(), selectedEdgeIds: new Set() });
        ed.store.setViewport(viewportOf(got.graph));
        stampRef.current = got.stamp;
        conflictRef.current = false;
        dirtyRef.current = false;
        currentCidRef.current = cid;
        startCopyAutosave(cid);
        return;
      }
      currentCidRef.current = cid;
    } catch (err) {
      console.error('[canvas-doc] switch failed:', err);
      message.error(t('canvasCopy.error', '画布切换失败，请重试'));
    } finally {
      switchingRef.current = false;
      const next = pendingRef.current;
      pendingRef.current = null;
      if (next && next !== currentCidRef.current) void switchTo(next);
    }
  }, [editor, projectId, flushCurrent, stopCopyAutosave, startCopyAutosave, activateTab, message, t]);

  /** 目标画布：主画布槽位 = main；副本页签 = 其 cid；剧本/导演台页签 = null（保持当前文档不动） */
  const targetCid = useMemo(() => {
    if (activeTabKey === CANVAS_TAB_KEY) return MAIN_CANVAS_ID;
    return openCanvasTabCid(activeTabKey);
  }, [activeTabKey]);

  useEffect(() => {
    if (!editor || !projectId || !targetCid) return;
    if (targetCid === currentCidRef.current) return;
    void switchTo(targetCid);
  }, [editor, projectId, targetCid, switchTo]);

  // 离开编辑器前把副本落盘（主画布由持久化插件自己收尾）。用 ref 拿最新实现，
  // 避免依赖变化导致 cleanup 反复触发保存。
  const saveCopyRef = useRef(saveCopyNow);
  useEffect(() => { saveCopyRef.current = saveCopyNow; }, [saveCopyNow]);
  useEffect(() => {
    return () => {
      stopCopyAutosave();
      if (currentCidRef.current !== MAIN_CANVAS_ID) void saveCopyRef.current();
      // 文档作用域复位：下一次进入画布页从主画布开始，生成任务/预览不得命中旧副本键
      setCurrentCanvasDocId(MAIN_CANVAS_DOC_ID);
      setGeneratingPreviewCanvas(MAIN_CANVAS_DOC_ID);
    };
  }, [stopCopyAutosave]);
}

/**
 * 进入项目时恢复"上次开着哪些画布副本"：只保留磁盘上仍存在的 cid，
 * 文件已删的条目静默丢弃（不报错、不重建）。
 */
export function useRestoreCanvasTabs(projectId: string | null | undefined): void {
  const restoreCanvasTabs = useCanvasTabStore((s) => s.restoreCanvasTabs);
  const doneRef = useRef<string | null>(null);

  useEffect(() => {
    if (!projectId || doneRef.current === projectId) return;
    doneRef.current = projectId;
    void (async () => {
      const ids = useViewPrefsStore.getState().canvasTabs.openCanvasesByProject[projectId] ?? [];
      if (ids.length === 0) return;
      try {
        const existing = new Map(
          (await listCanvases(projectId))
            .filter((c) => c.id !== MAIN_CANVAS_ID)
            .map((c) => [c.id, c.title] as const),
        );
        const restore = ids
          .filter((cid) => existing.has(cid))
          .map((cid) => ({
            key: canvasTabKeyFor(cid),
            cid,
            title: existing.get(cid) ?? cid,
          }));
        if (restore.length > 0) restoreCanvasTabs(restore);
      } catch (err) {
        console.warn('[canvas-tabs] 恢复画布副本页签失败（按无打开项处理）:', err);
      }
    })();
  }, [projectId, restoreCanvasTabs]);
}
