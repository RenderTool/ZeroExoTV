/**
 * canvas-assets/groups/OpenLibGroup - 画布抽屉「开源库」只读作用域宿主（2026-11-05 任务C 收敛）
 *
 * 约定：开源库展示与动作走单一定义源 OpenLibBrowser（独立 #/openlib 页与本抽屉同一组件、
 * 同尺寸、同动作），本文件只负责把画布抽屉的 store.sendToCanvas 执行器注入浏览器。
 * 只读（无编辑/无删除/无上传）、18+ 门控、按需下载落 CAS、查询侧分页均由 OpenLibBrowser 提供。
 */

import { useCallback } from 'react';
import type { ThemeConfig } from '@zeroexo/shared';
import type { Asset } from '@/features/asset-picker/index.js';
import { OpenLibBrowser } from '@/features/open-library/open-lib-browser.js';
import type { CanvasAssetsPanelStore } from '../store.js';

export function OpenLibGroup({ store, theme }: {
  store: CanvasAssetsPanelStore;
  theme: ThemeConfig;
}): React.ReactElement {
  /** 插入画布执行器：导入落 CAS 后走 store.sendToCanvas（与我的/本项目作用域同一链路） */
  const sendToCanvas = useCallback(
    (asset: Asset) => { store.sendToCanvas({ type: 'asset', id: asset.id, data: asset }); },
    [store],
  );
  return <OpenLibBrowser theme={theme} sendToCanvas={sendToCanvas} />;
}
