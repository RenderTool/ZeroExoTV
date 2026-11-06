/**
 * useEditorSync - 编辑器云端同步状态管理
 *
 * 从 use-editor-state.ts 提取，职责单一：
 * 云端版本差异提示 + 项目删除事件监听。
 * PROJECT_RELOAD_EVENT 留在主 hook 中（需访问编辑器实例）。
 */
import { useState, useEffect, useCallback } from 'react';
import {
  PROJECT_DIFF_EVENT,
  PROJECT_DELETED_EVENT,
} from '@/services/sync/broadcast-channel-service.js';

export function useEditorSync(canvasId: string): {
  cloudUpdateAvailable: boolean;
  clearCloudUpdateAvailable: () => void;
} {
  const [cloudUpdateAvailable, setCloudUpdateAvailable] = useState(false);

  const clearCloudUpdateAvailable = useCallback(() => {
    setCloudUpdateAvailable(false);
  }, []);

  useEffect(() => {
    // 监听云端版本差异：云端有新版本 + 本地无修改 → 显示同步按钮红点徽标
    const handleProjectDiff = (e: Event): void => {
      const detail = (e as CustomEvent<{ projectId: string }>).detail;
      if (!detail || detail.projectId !== canvasId) return;
      setCloudUpdateAvailable(true);
    };

    // 监听项目删除：另一标签页/设备删除了当前项目 → 返回首页
    const handleProjectDeleted = (e: Event): void => {
      const detail = (e as CustomEvent<{ projectId: string }>).detail;
      if (!detail || detail.projectId !== canvasId) return;
      window.location.href = '/';
    };

    window.addEventListener(PROJECT_DIFF_EVENT, handleProjectDiff);
    window.addEventListener(PROJECT_DELETED_EVENT, handleProjectDeleted);

    return () => {
      window.removeEventListener(PROJECT_DIFF_EVENT, handleProjectDiff);
      window.removeEventListener(PROJECT_DELETED_EVENT, handleProjectDeleted);
    };
  }, [canvasId]);

  return { cloudUpdateAvailable, clearCloudUpdateAvailable };
}