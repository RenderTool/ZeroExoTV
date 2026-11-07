/**
 * SubjectMediaSourcePanel - 主体状态媒体来源面板（2026-11-05 需求定稿；2026-11-07 统一到共享面板）
 *
 * 与导演台 @ 引用面板是**同一个实现**（`@/shared/components/asset-pick-panel`）：
 * 同一浮层、同一分区页签、同一搜索/分组列表/右侧只读详情/键盘习惯，这里只注数据与回调，不复制 UI。
 *
 * 页签：画布资产 / 资产（项目 + 公共，按范围分组） / 手动上传。
 * - 列表只显示 image / audio（视频不再支持新关联）
 * - 手动上传 = 面板内按钮（uploads 归属主体）：uploadAsset 只落 CAS 文件、**不写 asset-store**，
 *   因此不会出现在公共库/项目资产列表；引用只挂 subject-state ref（assetId=`subject-state:<rootId>/<stateId>`），
 *   替换/移除/删除状态/删除树时由 releaseCas 释放，refCount=0 自动删文件，无孤儿。
 * - 顶部显示当前资源 + 移除动作（已有媒体时打开 = 替换语义）
 * - 选中任一来源 → onPick → 调用方统一走 linkSubjectStateMedia（不复制文件，只挂引用）
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App as AntdApp } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import { uploadAsset } from '@/features/asset-picker/services/upload-asset.js';
import { listAssets } from '@/features/asset-picker/asset-store.js';
import { loadProjectGraph } from '@zeroexo/plugin-persistence';
import { useAuth } from '@/features/auth/auth-store.js';
import type { DirectorAssetRef } from '@/entities/director-params.js';
import {
  AssetPickPanel,
  useCardPalette,
  type AssetPickTab,
} from '@/shared/components/asset-pick-panel.js';
import type { SubjectStateMediaAsset } from './subject-state-media';

export interface SubjectMediaSourcePanelProps {
  open: boolean;
  onClose: () => void;
  theme: ThemeConfig;
  /** 当前项目 id（画布/项目资产过滤 + 上传 CAS 记账用） */
  projectId?: string;
  /** 锚点元素：面板弹在其下方（@ 面板 = 弹在触发行下方；无锚点退化为视口居中偏下） */
  anchorEl?: HTMLElement | null;
  /** 已有媒体（替换语义时顶部展示 + 提供移除） */
  current?: { storageKey: string; kind: 'image' | 'audio' | 'video' } | null;
  /** 选中来源条目（写入由调用方走 linkSubjectStateMedia） */
  onPick: (asset: SubjectStateMediaAsset) => void;
  /** 移除当前媒体（清空该状态引用，走 linkSubjectStateMedia(null)） */
  onRemove?: () => void;
}

/** 页签顺序：画布资产 / 资产（项目+公共） / 手动上传 */
const TABS: AssetPickTab[] = ['canvas', 'asset', 'upload'];

interface MediaEntry {
  storageKey: string;
  kind: 'image' | 'audio';
  label: string;
  /** canvas 专有：来源节点 id（双向可见/定位回画布） */
  fromNodeId?: string;
  /** 资产页签：归属范围（项目 / 公共），与资产库同口径 */
  scope?: 'project' | 'library';
}

/** 面板尺寸（与共享面板同源常量保持一致的视口留白计算） */
const PANEL_W = 560;
const PANEL_H = 440;

export const SubjectMediaSourcePanel = memo(function SubjectMediaSourcePanel({
  open, onClose, theme, projectId, anchorEl, current, onPick, onRemove,
}: SubjectMediaSourcePanelProps): React.ReactElement | null {
  const { t } = useTranslation();
  const { message: antdMessage } = AntdApp.useApp();
  const { isAuthenticated } = useAuth();
  const palette = useCardPalette(theme, theme.mode === 'dark');
  const panelRef = useRef<HTMLDivElement>(null);

  const [canvasList, setCanvasList] = useState<MediaEntry[]>([]);
  const [assetList, setAssetList] = useState<MediaEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [panelPos, setPanelPos] = useState<{ left: number; top: number } | null>(null);

  // ===== 数据装载（打开时） =====
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const canvas: MediaEntry[] = [];
      try {
        if (projectId) {
          const graph = await loadProjectGraph(projectId);
          if (graph && Array.isArray(graph.nodes) && !cancelled) {
            const seen = new Set<string>();
            for (const n of graph.nodes) {
              const node = n as { id?: string; title?: string; type?: string; data?: { storageKey?: string } };
              const key = node?.data?.storageKey;
              if (!key || seen.has(key)) continue;
              if (node.type === 'image') { seen.add(key); canvas.push({ storageKey: key, kind: 'image', label: node.title || t('subject.canvasNode', '画布'), fromNodeId: node.id ?? '' }); }
              else if (node.type === 'audio') { seen.add(key); canvas.push({ storageKey: key, kind: 'audio', label: node.title || t('subject.canvasNode', '画布'), fromNodeId: node.id ?? '' }); }
            }
          }
        }
      } catch { /* 画布读取失败 → 该分区空态 */ }
      let assets: MediaEntry[] = [];
      try {
        const all = await listAssets();
        if (!cancelled) {
          for (const a of all) {
            if (!a || (a.kind !== 'image' && a.kind !== 'audio')) continue; // 视频不显示
            const d = a.data as { storageKey?: string } | undefined;
            if (!d?.storageKey) continue;
            assets.push({
              storageKey: d.storageKey,
              kind: a.kind,
              label: a.title || (a.kind === 'image' ? t('subject.mediaImage', '图片') : t('subject.mediaAudio', '音频')),
              scope: (a.scope ?? 'project') === 'library' ? 'library' : 'project',
            });
          }
        }
      } catch { /* 资产读取失败 → 分区空态 */ }
      if (cancelled) return;
      setCanvasList(canvas);
      setAssetList(assets);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, projectId, t]);

  // ===== 定位：@ 面板同款「弹在触发行下方」；视口边缘翻转 =====
  useEffect(() => {
    if (!open) { setPanelPos(null); return; }
    const compute = () => {
      const W = Math.min(PANEL_W, window.innerWidth * 0.92);
      const H = Math.min(PANEL_H, window.innerHeight * 0.8);
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rect = anchorEl?.getBoundingClientRect();
      let left = rect ? Math.min(Math.max(8, rect.left), vw - W - 8) : (vw - W) / 2;
      let top = rect ? rect.bottom + 8 : vh * 0.3;
      if (top + H > vh - 8) top = Math.max(8, (rect ? rect.top - H - 8 : (vh - H) / 2));
      setPanelPos({ left, top });
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [open, anchorEl]);

  /**
   * 统一关闭：× 按钮 / Esc / 点面板外都走这里 —— 不写入、不改数据，焦点回到触发卡片。
   */
  const closeWithFocus = useCallback(() => {
    try { anchorEl?.focus?.(); } catch { /* 触发元素不可聚焦（div 等）则回落 body */ }
    onClose();
  }, [anchorEl, onClose]);

  // ===== Esc 快捷键关闭（焦点回归） + 点击面板外部关闭 =====
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeWithFocus(); };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      // antd 全局提示（如格式不支持警告）不算「面板外」误触
      if (target instanceof Element && target.closest('.ant-message-notice')) return;
      closeWithFocus();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open, closeWithFocus]);

  /** 媒体引用身份：`canvas:<nodeId|storageKey>` / `media:<storageKey>`（唯一、稳定，供面板回查来源） */
  const canvasRefs = useMemo<DirectorAssetRef[]>(
    () => canvasList.map((e) => ({
      id: `canvas:${e.fromNodeId || e.storageKey}`,
      kind: e.kind,
      title: e.label,
      storageKey: e.storageKey,
      originScope: 'project',
    })),
    [canvasList],
  );
  const assetRefs = useMemo<DirectorAssetRef[]>(
    () => assetList.map((e) => ({
      id: `media:${e.storageKey}`,
      kind: e.kind,
      title: e.label,
      storageKey: e.storageKey,
      originScope: e.scope === 'library' ? 'library' : 'project',
    })),
    [assetList],
  );
  /** 引用 id → 来源条目（选中时回填 SubjectStateMediaAsset.origin） */
  const entryById = useMemo(() => {
    const map = new Map<string, { entry: MediaEntry; source: 'canvas' | 'library' | 'project' }>();
    for (const e of canvasList) map.set(`canvas:${e.fromNodeId || e.storageKey}`, { entry: e, source: 'canvas' });
    for (const e of assetList) map.set(`media:${e.storageKey}`, { entry: e, source: e.scope === 'library' ? 'library' : 'project' });
    return map;
  }, [canvasList, assetList]);

  const doPick = useCallback((ref: DirectorAssetRef) => {
    const hit = entryById.get(ref.id);
    if (!hit) return;
    const { entry, source } = hit;
    onPick({
      storageKey: entry.storageKey,
      kind: entry.kind,
      origin: source === 'canvas'
        ? { type: 'canvas', fromNodeId: entry.fromNodeId, label: entry.label }
        : source === 'library'
          ? { type: 'library', label: entry.label }
          : { type: 'project', label: entry.label },
    });
    onClose();
  }, [entryById, onPick, onClose]);

  /**
   * 手动上传归属主体（2026-11-05 约定）：
   * uploadAsset 只落 CAS 文件、不写 asset-store → 不出现在公共/项目资产列表，不污染全局。
   * 引用由 linkSubjectStateMedia 挂 subject-state ref；删除走 releaseCas，归零自动删文件。
   */
  const handleUploadFiles = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    if (/^video\//i.test(file.type) || /\.(mp4|webm|mov|m4v|mkv)$/i.test(file.name)) {
      antdMessage.warning(t('subject.videoNotSupported', '视频不再支持，请选择图片或语音'));
      return;
    }
    const isAudio = /^audio\//i.test(file.type) || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name);
    const isImage = /^image\//i.test(file.type) || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name);
    if (!isAudio && !isImage) {
      antdMessage.warning(t('subject.uploadUnsupportedType', '仅支持图片或语音文件'));
      return;
    }
    if (!isAuthenticated) { antdMessage.warning(t('subjectCreate.loginRequired')); return; }
    setUploading(true);
    try {
      const uploaded = await uploadAsset(file);
      const d = uploaded.data as { storageKey?: string } | undefined;
      if (!d?.storageKey) { antdMessage.error(t('subjectCreate.saveFailed')); return; }
      onPick({ storageKey: d.storageKey, kind: isAudio ? 'audio' : 'image', origin: { type: 'upload', label: file.name } });
      onClose();
    } catch {
      antdMessage.error(t('subjectCreate.saveFailed'));
    } finally {
      setUploading(false);
    }
  }, [isAuthenticated, antdMessage, t, onPick, onClose]);

  if (!open) return null;

  return (
    <div ref={panelRef} data-subject-media-panel>
      <AssetPickPanel
        tabs={TABS}
        initialTab="canvas"
        canvasMedia={canvasRefs}
        candidates={assetRefs}
        placement={panelPos
          ? { mode: 'fixed', left: panelPos.left, top: panelPos.top }
          : { mode: 'fixed', left: 8, top: 80 }}
        current={current
          ? { storageKey: current.storageKey, kind: current.kind, label: t('subject.panelCurrent', '当前资源') }
          : null}
        onRemoveCurrent={onRemove ? () => onRemove() : undefined}
        onPickAsset={doPick}
        onPickCanvasMedia={doPick}
        onUploadFiles={handleUploadFiles}
        uploading={uploading}
        accept="image/*,audio/*"
        uploadHint={t('subject.uploadScopedHint', '手动上传仅归属该主体，不进入公共/项目资产库')}
        emptyAssetText={loading ? t('common.loading', '加载中…') : t('subject.sourceAssetsEmpty', '暂无可用资产')}
        emptyCanvasText={loading ? t('common.loading', '加载中…') : t('subject.sourceCanvasEmpty', '画布上暂无图片/音频节点')}
        onClose={closeWithFocus}
        palette={palette}
        t={(key, fallback, opts) => t(key, fallback ?? key, opts)}
        theme={theme}
      />
    </div>
  );
});
