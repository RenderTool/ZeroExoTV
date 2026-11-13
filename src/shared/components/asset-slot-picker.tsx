/**
 * asset-slot-picker — 资产插槽统一选择页（2026-11-13）
 *
 * 导演台的插槽素材页是标准形态：画布 / 资产 / 主体三个分区、搜索、右侧只读详情、
 * 「导入资产」一条上传链。画布节点参考区与主体状态页的参考素材区都复用这一页，
 * 不再各自弹系统文件框或另造一套列表。
 *
 * 数据注入：
 * - 画布：宿主可传 canvasNodes（画布内实时节点）；缺省从项目图读盘过滤可见节点；
 * - 资产：本项目 + 公共库，按 acceptKinds 过滤；
 * - 主体：主体条目 + 主体树（状态图行），同样按 acceptKinds 过滤；
 * - 上传：落到 CAS 后回调宿主（参考素材不写资产库）。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { App as AntdApp } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import { filterVisibleNodes } from '@zeroexo/core';
import { loadProjectGraph } from '@zeroexo/plugin-persistence';
import { listAssets } from '@/features/asset-picker/asset-store.js';
import { uploadAsset } from '@/features/asset-picker/services/upload-asset.js';
import { getCurrentCanvasId } from '@/shared/current-canvas-id.js';
import { readStoryboardContainer } from '@/entities/slot-containers.js';
import {
  migrateSubjectTrees,
  type SubjectTree,
} from '@/features/canvas-nodes/storyboard/subject-tree-types.js';
import {
  resolveSubjectCover,
  type ProductionItem,
} from '@/features/canvas-nodes/production-manager/production-manager-types.js';
import type { DirectorAssetRef } from '@/entities/director-params.js';
import {
  AssetPickPanel,
  useCardPalette,
  type AssetPickTab,
} from '@/shared/components/asset-pick-panel.js';

export type AssetSlotKind = 'image' | 'video' | 'audio';

/** 宿主可注入的画布节点（画布内用实时图，其他页面从盘上读） */
export interface AssetSlotCanvasNode {
  id: string;
  /** image / video / audio */
  type: string;
  title?: string;
  storageKey?: string;
  url?: string;
  content?: string;
}

export interface AssetSlotPick {
  kind: AssetSlotKind;
  storageKey: string;
  title: string;
  /** 画布现有节点 → 宿主直接连该节点（不要再建一个重复节点） */
  fromNodeId?: string;
  origin: 'canvas' | 'project' | 'library' | 'subject' | 'upload';
}

export interface AssetSlotPickerProps {
  open: boolean;
  onClose: () => void;
  theme: ThemeConfig;
  projectId?: string | null;
  /** 锚点：面板弹在触发元素附近（fixed 定位，视口夹取） */
  anchorEl?: HTMLElement | null;
  /** 只列这些媒体类型（缺省三类全列） */
  acceptKinds?: AssetSlotKind[];
  /** 画布节点注入；缺省从项目图读盘 */
  canvasNodes?: AssetSlotCanvasNode[];
  /** 页签顺序（缺省 画布 / 资产 / 主体） */
  tabs?: AssetPickTab[];
  initialTab?: AssetPickTab;
  /** 已有资源（替换语义；顶部展示 + 移除） */
  current?: { storageKey: string; kind: AssetSlotKind; label?: string } | null;
  onRemoveCurrent?: () => void;
  onPick: (pick: AssetSlotPick) => void;
  /** 上传文件（默认 uploadAsset 后 onPick）；传 = 启用「导入资产」入口 */
  onUploadFiles?: (files: File[]) => void | Promise<void>;
  uploadHint?: string;
  /** 允许上传的 MIME（缺省按 acceptKinds 推导） */
  accept?: string;
}

const PANEL_W = 560;
const PANEL_H = 440;

function kindsToAccept(kinds: AssetSlotKind[]): string {
  const parts: string[] = [];
  if (kinds.includes('image')) parts.push('image/*');
  if (kinds.includes('video')) parts.push('video/*');
  if (kinds.includes('audio')) parts.push('audio/*');
  return parts.join(',') || 'image/*';
}

export const AssetSlotPicker = memo(function AssetSlotPicker({
  open, onClose, theme, projectId, anchorEl, acceptKinds = ['image', 'video', 'audio'],
  canvasNodes, tabs = ['canvas', 'asset', 'subject'], initialTab, current, onRemoveCurrent,
  onPick, onUploadFiles, uploadHint, accept,
}: AssetSlotPickerProps): React.ReactElement | null {
  const { t } = useTranslation();
  const { message: antdMessage } = AntdApp.useApp();
  const palette = useCardPalette(theme, theme.mode === 'dark');
  const panelRef = useRef<HTMLDivElement>(null);
  /** 画布内宿主不传 projectId：回落当前画布 id（与画布素材同一口径） */
  const pid = projectId ?? getCurrentCanvasId() ?? undefined;

  const [loadedCanvas, setLoadedCanvas] = useState<AssetSlotCanvasNode[]>([]);
  const [assets, setAssets] = useState<Array<{ storageKey: string; kind: AssetSlotKind; title: string; scope: 'project' | 'library' }>>([]);
  const [subjects, setSubjects] = useState<ProductionItem[]>([]);
  const [trees, setTrees] = useState<SubjectTree[]>([]);
  const [uploading, setUploading] = useState(false);
  const [panelPos, setPanelPos] = useState<{ left: number; top: number } | null>(null);

  const kindSet = useMemo(() => new Set(acceptKinds), [acceptKinds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const allowVideo = kindSet.has('video');
  const allowAudio = kindSet.has('audio');
  /** 主体页签只有图片可挂；音频/视频槽不展示主体页 */
  const visibleTabs = useMemo(
    () => tabs.filter((k) => k !== 'subject' || kindSet.has('image')),
    [tabs, kindSet],
  );

  // ===== 数据装载（打开时） =====
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      if (canvasNodes === undefined && pid) {
        try {
          const graph = await loadProjectGraph(pid);
          if (graph && Array.isArray(graph.nodes) && !cancelled) {
            setLoadedCanvas(filterVisibleNodes(graph.nodes).map((n) => {
              const node = n as { id: string; type: string; title?: string; data?: Record<string, unknown> };
              const data = node.data ?? {};
              return {
                id: node.id,
                type: node.type,
                title: node.title,
                storageKey: typeof data.storageKey === 'string' ? data.storageKey : undefined,
                url: typeof data.url === 'string' ? data.url : undefined,
                content: typeof data.content === 'string' ? data.content : undefined,
              };
            }));
          }
        } catch { /* 画布读取失败 → 分区空态 */ }
      }
      try {
        const all = await listAssets();
        if (!cancelled) {
          setAssets(all
            .filter((a) => a && kindSet.has(a.kind as AssetSlotKind))
            .filter((a) => !(a.scope === 'project' && a.projectId && pid && a.projectId !== pid))
            .map((a) => {
              const d = a.data as { storageKey?: string } | undefined;
              if (!d?.storageKey) return null;
              return {
                storageKey: d.storageKey,
                kind: a.kind as AssetSlotKind,
                title: a.title || (a.kind === 'image' ? '图片' : a.kind === 'video' ? '视频' : '音频'),
                scope: ((a.scope ?? 'project') === 'library' ? 'library' : 'project') as 'project' | 'library',
              };
            })
            .filter((x): x is NonNullable<typeof x> => !!x));
        }
      } catch { /* 资产读取失败 → 分区空态 */ }
      if (pid) {
        try {
          const container = await readStoryboardContainer(pid);
          if (!cancelled) {
            const items = Array.isArray(container?.entities) ? (container.entities as ProductionItem[]) : [];
            setSubjects(items.filter((it) => it && it.name));
            setTrees(migrateSubjectTrees(container?.subjectTree));
          }
        } catch { /* 主体读取失败 → 分区空态 */ }
      }
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
  }, [open, pid, canvasNodes, kindSet]);

  // ===== 定位（固定层，视口夹取） =====
  useEffect(() => {
    if (!open) { setPanelPos(null); return; }
    const compute = (): void => {
      const W = Math.min(PANEL_W, window.innerWidth * 0.92);
      const H = Math.min(PANEL_H, window.innerHeight * 0.8);
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rect = anchorEl?.getBoundingClientRect();
      const left = rect ? Math.min(Math.max(8, rect.left), vw - W - 8) : (vw - W) / 2;
      let top = rect ? rect.bottom + 8 : vh * 0.3;
      if (top + H > vh - 8) top = Math.max(8, (rect ? rect.top - H - 8 : (vh - H) / 2));
      setPanelPos({ left, top });
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [open, anchorEl]);

  const closeWithFocus = useCallback(() => {
    try { anchorEl?.focus?.(); } catch { /* 触发元素不可聚焦 */ }
    onClose();
  }, [anchorEl, onClose]);

  // Esc / 点面板外关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') closeWithFocus(); };
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
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

  const sourceCanvas = canvasNodes ?? loadedCanvas;
  const canvasRefs = useMemo<DirectorAssetRef[]>(() => sourceCanvas
    .filter((n) => kindSet.has(n.type as AssetSlotKind))
    .filter((n) => n.storageKey || n.content || n.url)
    .map((n) => ({
      id: `canvas:${n.id}`,
      kind: n.type as AssetSlotKind,
      title: n.title || n.type,
      storageKey: n.storageKey,
      url: n.url || n.content,
      originScope: 'project',
    })), [sourceCanvas, kindSet]);

  const assetRefs = useMemo<DirectorAssetRef[]>(() => assets.map((a) => ({
    id: `media:${a.storageKey}`,
    kind: a.kind,
    title: a.title,
    storageKey: a.storageKey,
    originScope: a.scope,
  })), [assets]);

  const pick = useCallback((ref: DirectorAssetRef, origin: AssetSlotPick['origin']): void => {
    if (!ref.storageKey) return;
    const fromNodeId = ref.id.startsWith('canvas:') ? ref.id.slice('canvas:'.length) : undefined;
    onPick({
      kind: ref.kind,
      storageKey: ref.storageKey,
      title: ref.title ?? '',
      fromNodeId,
      origin: fromNodeId ? 'canvas' : origin,
    });
    onClose();
  }, [onPick, onClose]);

  const handleUpload = useCallback(async (files: File[]): Promise<void> => {
    const file = files[0];
    if (!file) return;
    const kind = /^video\//i.test(file.type) || /\.(mp4|webm|mov|m4v|mkv)$/i.test(file.name)
      ? 'video'
      : /^audio\//i.test(file.type) || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name)
        ? 'audio'
        : /^image\//i.test(file.type) || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name)
          ? 'image'
          : null;
    if (!kind || !kindSet.has(kind)) {
      antdMessage.warning(t('assetPick.unsupportedKind', '该素材类型不能用作当前输入'));
      return;
    }
    setUploading(true);
    try {
      const uploaded = await uploadAsset(file);
      const d = uploaded.data as { storageKey?: string } | undefined;
      if (!d?.storageKey) { antdMessage.error(t('subjectCreate.saveFailed', '保存失败')); return; }
      onPick({
        kind,
        storageKey: d.storageKey,
        title: uploaded.title.replace(/\.[^.]+$/, ''),
        origin: 'upload',
      });
      onClose();
    } catch {
      antdMessage.error(t('subjectCreate.saveFailed', '保存失败'));
    } finally {
      setUploading(false);
    }
  }, [antdMessage, kindSet, onPick, onClose, t]);

  if (!open) return null;

  const panel = (
    <div ref={panelRef} data-asset-slot-picker="">
      <AssetPickPanel
        tabs={visibleTabs}
        initialTab={initialTab}
        allowedKinds={acceptKinds}
        canvasMedia={canvasRefs}
        candidates={assetRefs}
        subjects={subjects}
        subjectTrees={trees}
        placement={panelPos
          ? { mode: 'fixed', left: panelPos.left, top: panelPos.top }
          : { mode: 'fixed', left: 8, top: 80 }}
        current={current ? { storageKey: current.storageKey, kind: current.kind, label: current.label } : null}
        onRemoveCurrent={onRemoveCurrent}
        onPickAsset={(ref) => pick(ref, ref.originScope === 'library' ? 'library' : 'project')}
        onPickCanvasMedia={(ref) => pick(ref, 'canvas')}
        onPickSubject={(item) => {
          const key = resolveSubjectCover(item).key;
          if (!key) return;
          onPick({ kind: 'image', storageKey: key, title: item.name, origin: 'subject' });
          onClose();
        }}
        onPickSubjectImage={(item, img) => {
          onPick({
            kind: 'image',
            storageKey: img.storageKey,
            title: `${item.name}·${img.stateTag ?? ''}`.replace(/·$/, ''),
            origin: 'subject',
          });
          onClose();
        }}
        onPickSubjectState={(ref) => pick(ref, 'subject')}
        onUploadFiles={(files) => { void (onUploadFiles ? onUploadFiles(files) : handleUpload(files)); }}
        uploading={uploading}
        accept={accept ?? kindsToAccept(acceptKinds)}
        uploadHint={uploadHint}
        emptyAssetText={t('subject.sourceAssetsEmpty', '暂无可用资产')}
        emptyCanvasText={allowVideo || allowAudio
          ? t('subject.sourceCanvasMediaEmpty', '画布上暂无可用素材节点')
          : t('subject.sourceCanvasEmpty', '画布上暂无图片节点')}
        onClose={closeWithFocus}
        palette={palette}
        t={(key, fallback, opts) => t(key, fallback ?? key, opts)}
        theme={theme}
      />
    </div>
  );
  if (typeof document === 'undefined') return panel;
  return createPortal(panel, document.body);
});
