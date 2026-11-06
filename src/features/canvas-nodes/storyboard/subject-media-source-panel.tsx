/**
 * SubjectMediaSourcePanel - 主体状态媒体来源面板（@ 引用面板形态，2026-11-05 需求定稿）
 *
 * 形态约束：主体编辑点击后弹出类似 @ 引用的菜单，复刻导演台 @ 面板（director-prompt-panel
 * AssetPickPanel）的同一套视觉与交互语言：popover 浮层、分区 tab、搜索框、分组列表行
 * （28px 缩略、hover 高亮、单击即写入）、Esc 关闭不改变数据。
 *
 * 说明：无法直接 import AssetPickPanel —— director-prompt-panel 属 canvas-tabs 导轨
 * 文件（另一会话正在改），跨会话引内部组件会冲突；故按同一形态复刻（palette/行样式/
 * tab 形态/键盘习惯一致），交互习惯不变。
 *
 * 四分区顺序：画布资产 / 公共资产 / 本项目资产 / 手动上传。
 * - 列表仅显示 image / audio（视频不显示：视频不再支持新关联）
 * - 手动上传归属主体：uploadAsset 只落 CAS 文件、**不写 asset-store**，因此不会出现在
 *   公共库/本项目资产列表；引用只挂 subject-state ref（assetId=`subject-state:<rootId>/<stateId>`），
 *   替换/移除/删除状态/删除树时由 releaseCas 释放，refCount=0 自动删文件，无孤儿。
 * - 顶部显示当前资源 + 移除动作（已有媒体时打开 = 替换语义）
 * - 选中任一来源 → onPick → 调用方统一走 linkSubjectStateMedia（不复制文件，只挂引用）
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App as AntdApp } from 'antd';
import { AudioLines, Trash2, Upload as UploadIcon, Search, Loader2, X, Image as ImageIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import { uploadAsset } from '@/features/asset-picker/services/upload-asset.js';
import { listAssets } from '@/features/asset-picker/asset-store.js';
import { loadProjectGraph } from '@zeroexo/plugin-persistence';
import { ThumbImage } from '@/features/canvas-tabs/thumb-image.js';
import { useAuth } from '@/features/auth/auth-store.js';
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

type SourceTab = 'canvas' | 'library' | 'project' | 'upload';

interface MediaEntry {
  storageKey: string;
  kind: 'image' | 'audio';
  label: string;
  /** canvas 专有：来源节点 id（双向可见/定位回画布） */
  fromNodeId?: string;
  durationMs?: number;
}

/** @ 面板同款分区 tab 顺序（用户指定：画布资产/公共资产/本项目资产/手动上传） */
const TAB_ORDER: SourceTab[] = ['canvas', 'library', 'project', 'upload'];

export const SubjectMediaSourcePanel = memo(function SubjectMediaSourcePanel({
  open, onClose, projectId, anchorEl, current, onPick, onRemove,
}: SubjectMediaSourcePanelProps): React.ReactElement | null {
  const { t } = useTranslation();
  const { message: antdMessage } = AntdApp.useApp();
  const { isAuthenticated } = useAuth();
  const { listRef, searchRef, fileRef } = { listRef: useRef<HTMLDivElement>(null), searchRef: useRef<HTMLInputElement>(null), fileRef: useRef<HTMLInputElement>(null) };
  const panelRef = useRef<HTMLDivElement>(null);

  // @ 面板同款 palette（深色浮层；亮色主题也用深浮层，与导演台一致）
  const popBg = '#1b1b1f';
  const popBorder = 'rgba(255,255,255,0.12)';
  const popHover = 'rgba(255,255,255,0.08)';
  const popText = '#f0f0f2';
  const popSub = 'rgba(240,240,242,0.55)';

  const [tab, setTab] = useState<SourceTab>('canvas');
  const [searchQ, setSearchQ] = useState('');
  const [canvasList, setCanvasList] = useState<MediaEntry[]>([]);
  const [libraryList, setLibraryList] = useState<MediaEntry[]>([]);
  const [projectList, setProjectList] = useState<MediaEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  /** 悬停/最近浏览条目 → 面板内预览（图/音频），点条目才写入 */
  const [previewEntry, setPreviewEntry] = useState<MediaEntry | null>(null);
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
      let library: MediaEntry[] = [];
      let project: MediaEntry[] = [];
      try {
        const all = await listAssets();
        if (!cancelled) {
          for (const a of all) {
            if (!a || (a.kind !== 'image' && a.kind !== 'audio')) continue; // 视频不显示
            const d = a.data as { storageKey?: string; durationMs?: number } | undefined;
            if (!d?.storageKey) continue;
            const entry: MediaEntry = {
              storageKey: d.storageKey, kind: a.kind,
              label: a.title || (a.kind === 'image' ? t('subject.mediaImage', '图片') : t('subject.mediaAudio', '音频')),
              durationMs: d.durationMs,
            };
            if ((a.scope ?? 'project') === 'library') library.push(entry);
            else project.push(entry);
          }
        }
      } catch { /* 资产读取失败 → 分区空态 */ }
      if (cancelled) return;
      setCanvasList(canvas);
      setLibraryList(library);
      setProjectList(project);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, projectId, t]);

  // ===== 定位：@ 面板同款「弹在触发行下方」；视口边缘翻转 =====
  useEffect(() => {
    if (!open) { setPanelPos(null); return; }
    const compute = () => {
      const W = 300;
      const H = 380;
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
   * 统一关闭（2026-11-05 修复：ESC 不能是唯一退出方式）：
   * × 按钮 / Esc / 点面板外都走这里 —— 不写入、不改数据，焦点回到触发卡片。
   */
  const closeWithFocus = useCallback(() => {
    try { anchorEl?.focus?.(); } catch { /* 触发元素不可聚焦（div 等）则回落 body */ }
    onClose();
  }, [anchorEl, onClose]);

  // ===== Esc 快捷键关闭（焦点回归） + 点击面板外部关闭 =====
  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
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

  const doPick = useCallback((entry: MediaEntry, source: 'canvas' | 'library' | 'project') => {
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
  }, [onPick, onClose]);

  /**
   * 手动上传归属主体（2026-11-05 约定）：
   * uploadAsset 只落 CAS 文件、不写 asset-store → 不出现在公共/项目资产列表，不污染全局。
   * 引用由 linkSubjectStateMedia 挂 subject-state ref；删除走 releaseCas，归零自动删文件。
   */
  const handleUploadFile = useCallback(async (file: File) => {
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

  // ===== 过滤 =====
  const filterEntries = useCallback((list: MediaEntry[]): MediaEntry[] => {
    const q = searchQ.trim().toLowerCase();
    return q ? list.filter((e) => e.label.toLowerCase().includes(q)) : list;
  }, [searchQ]);

  const activeList: MediaEntry[] = useMemo(() => {
    if (loading) return [];
    if (tab === 'canvas') return filterEntries(canvasList);
    if (tab === 'library') return filterEntries(libraryList);
    if (tab === 'project') return filterEntries(projectList);
    return [];
  }, [tab, loading, canvasList, libraryList, projectList, filterEntries]);

  const tabLabel = (key: SourceTab): string => ({
    canvas: t('subject.srcTabCanvas', '画布资产'),
    library: t('subject.srcTabLibrary', '全局'),
    project: t('subject.srcTabProject', '本项目资产'),
    upload: t('subject.srcTabUpload', '手动上传'),
  })[key];

  const thumb = (storageKey: string, kind: 'image' | 'audio' = 'image', size = 28): React.ReactElement => (
    <ThumbImage
      kind={kind}
      storageKey={storageKey}
      prefer="thumb"
      width={size}
      height={size}
      radius={4}
      icon={kind === 'audio' ? <AudioLines size={14} /> : <ImageIcon size={14} />}
    />
  );
  const audioIcon = (
    <span style={{ width: 28, height: 28, borderRadius: 4, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.06)', color: popSub }}>
      <AudioLines size={14} />
    </span>
  );
  const formatDuration = (ms?: number): string => {
    if (!ms || ms <= 0) return '';
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      data-subject-media-panel
      style={{
        position: 'fixed', left: panelPos?.left ?? '50%', top: panelPos?.top ?? '30%',
        zIndex: 1200,
        background: popBg, border: `1px solid ${popBorder}`,
        borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.45)', padding: 8,
        width: 300, maxHeight: 380, overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        animation: 'zeroexo-fade-up 0.18s cubic-bezier(0.22,1,0.36,1) both',
        ...(panelPos ? {} : { transform: 'translateX(-50%)' }),
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* 常驻 header（四个分区 tab 下都在）：标题 + 可见 × 关闭按钮（Esc/点外部只是快捷方式） */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '2px 4px 6px', flexShrink: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: popText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {t('subject.sourceTitle', '选择图片或语音来源')}
        </span>
        <button
          type="button"
          data-subject-media-upload-top
          aria-label={t('subject.uploadMedia', '上传图片/语音')}
          title={t('subject.uploadMedia', '上传图片/语音')}
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 20, height: 20, flexShrink: 0, border: 'none', borderRadius: 6,
            background: 'transparent', color: popSub, cursor: uploading ? 'default' : 'pointer', fontFamily: 'inherit',
          }}
        >
          <UploadIcon size={13} />
        </button>
        <button
          type="button"
          data-subject-media-close
          aria-label={t('subject.panelClose', '关闭')}
          title={t('subject.panelClose', '关闭')}
          onClick={closeWithFocus}
          onMouseEnter={(e) => { e.currentTarget.style.background = popHover; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 20, height: 20, flexShrink: 0, border: 'none', borderRadius: 6,
            background: 'transparent', color: popSub, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          <X size={13} />
        </button>
      </div>

      {/* 顶部：当前资源（已有媒体 = 替换语义） */}
      {current && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px 8px', borderBottom: `1px solid ${popBorder}`, marginBottom: 6 }}>
          {current.kind === 'audio' ? audioIcon : current.kind === 'image' ? thumb(current.storageKey) : (
            <span style={{ width: 28, height: 28, borderRadius: 4, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.06)', color: popSub, fontSize: 9 }}>旧</span>
          )}
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, color: popText }}>
            {t('subject.panelCurrent', '当前资源')}
          </span>
          {onRemove && (
            <button
              type="button"
              data-subject-media-remove
              onClick={() => { onRemove(); onClose(); }}
              title={t('subject.deleteMedia', '删除媒体')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: `1px solid rgba(255,120,120,0.55)`, background: 'rgba(220,38,38,0.25)', color: '#fff', borderRadius: 6, padding: '2px 7px', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
            >
              <Trash2 size={10} />{t('common.delete', '删除')}
            </button>
          )}
        </div>
      )}

      {/* 分区 tab（@ 面板同款 pill 形态，顺序：画布/公共/本项目/手动上传） */}
      <div style={{ display: 'inline-flex', gap: 2, padding: 3, borderRadius: 8, background: 'rgba(255,255,255,0.05)', marginBottom: 6, flexWrap: 'wrap', flexShrink: 0 }}>
        {TAB_ORDER.map((key) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              data-subject-media-tab={key}
              onClick={() => setTab(key)}
              style={{
                padding: '3px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', border: 'none',
                background: active ? 'rgba(255,255,255,0.10)' : 'transparent',
                color: active ? popText : popSub, whiteSpace: 'nowrap',
              }}
            >
              {tabLabel(key)}
            </button>
          );
        })}
      </div>

      {/* 手动上传分区：drop 区（主体私有：不入公共/项目资产库） */}
      {tab === 'upload' && (
        <div style={{ flexShrink: 0, padding: '4px 6px 8px' }}>
          <button
            type="button"
            data-subject-media-upload
            onClick={() => !uploading && fileRef.current?.click()}
            disabled={uploading}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '18px 0', border: `1.5px dashed ${popBorder}`, borderRadius: 8, background: 'transparent',
              color: popSub, fontSize: 12, cursor: uploading ? 'default' : 'pointer', fontFamily: 'inherit',
            }}
            title={t('subject.uploadMediaHint', '点击上传图片或语音')}
          >
            {uploading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <UploadIcon size={14} />}
            {uploading ? t('asset.uploading', '上传中…') : t('subject.uploadMedia', '上传图片/语音')}
          </button>
          <div style={{ fontSize: 9, color: popSub, marginTop: 6, lineHeight: 1.5 }}>
            {t('subject.uploadScopedHint', '手动上传仅归属该主体，不进入公共/项目资产库')}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,audio/*"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUploadFile(f); e.target.value = ''; }}
          />
        </div>
      )}

      {/* 搜索（非上传分区；@ 面板同款搜索框） */}
      {tab !== 'upload' && (
        <div style={{ position: 'relative', flexShrink: 0, marginBottom: 4 }}>
          <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: popSub, pointerEvents: 'none' }} />
          <input
            ref={searchRef}
            data-subject-media-search
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder={t('subject.panelSearchPlaceholder', '搜索名称…')}
            style={{
              width: '100%', height: 26, padding: '0 8px 0 26px', fontSize: 11, borderRadius: 6,
              border: `1px solid ${popBorder}`, background: 'rgba(255,255,255,0.04)',
              color: popText, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
            }}
          />
        </div>
      )}

      {/* 预览区：悬停条目即看大图/音频（与导演台素材面板同款信息层级） */}
      {tab !== 'upload' && (
        <div
          data-subject-media-preview
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '4px 4px 8px',
            borderBottom: `1px solid ${popBorder}`, marginBottom: 4, flexShrink: 0, minHeight: 52,
          }}
        >
          {previewEntry ? (
            <>
              {thumb(previewEntry.storageKey, previewEntry.kind, 72)}
              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 11, color: popText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {previewEntry.label}
                </span>
                <span style={{ fontSize: 10, color: popSub }}>
                  {previewEntry.kind === 'image' ? t('subject.mediaImage', '图片') : t('subject.mediaAudio', '音频')}
                  {formatDuration(previewEntry.durationMs) ? ` · ${formatDuration(previewEntry.durationMs)}` : ''}
                </span>
              </div>
            </>
          ) : (
            <span style={{ fontSize: 10, color: popSub, padding: '6px 4px' }}>
              {t('subject.panelPreviewHint', '悬停条目可预览')}
            </span>
          )}
        </div>
      )}

      {/* 列表（@ 面板同款分组行：36px 高、28px 缩略、hover 高亮、单击写入） */}
      {tab !== 'upload' && (
        <div ref={listRef} style={{ flex: 1, minHeight: 120, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {loading ? (
            <div style={{ padding: 16, fontSize: 12, color: popSub, textAlign: 'center' }}>{t('common.loading', '加载中…')}</div>
          ) : activeList.length === 0 ? (
            <div style={{ padding: 16, fontSize: 12, color: popSub, textAlign: 'center' }}>
              {tab === 'canvas' ? t('subject.sourceCanvasEmpty', '画布上暂无图片/音频节点') : t('subject.sourceAssetsEmpty', '暂无可用资产')}
            </div>
          ) : activeList.map((entry) => (
            <button
              key={`${tab}-${entry.storageKey}`}
              type="button"
              data-subject-media-item={`${tab}:${entry.storageKey}`}
              onClick={() => doPick(entry, tab)}
              onMouseEnter={(e) => { e.currentTarget.style.background = popHover; setPreviewEntry(entry); }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 36,
                padding: '0 8px', border: 'none', borderRadius: 6, cursor: 'pointer',
                background: 'transparent', color: popText, fontSize: 12, textAlign: 'left', fontFamily: 'inherit',
              }}
            >
              {thumb(entry.storageKey, entry.kind === 'image' ? 'image' : 'audio')}
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {entry.label}
              </span>
              {entry.kind === 'audio' && formatDuration(entry.durationMs) && (
                <span style={{ fontSize: 9, color: popSub, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{formatDuration(entry.durationMs)}</span>
              )}
              <span style={{ fontSize: 9, color: popSub, border: `1px solid ${popBorder}`, borderRadius: 999, padding: '1px 6px', flexShrink: 0 }}>
                {entry.kind === 'image' ? t('subject.mediaImage', '图片') : t('subject.mediaAudio', '音频')}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* 底部提示 */}
      <div style={{ fontSize: 9, color: popSub, padding: '6px 4px 0', flexShrink: 0, borderTop: `1px solid ${popBorder}`, marginTop: 4 }}>
        {current
          ? t('subject.panelReplaceHint', '选择条目将替换当前资源 · Esc 取消')
          : t('subject.panelPickHint', '选择条目即写入该状态 · Esc 取消')}
      </div>
    </div>
  );
});
