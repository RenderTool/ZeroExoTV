/**
 * DockReferencesSection - 参考素材区 UI 组件
 *
 * 从 node-generate-dock.tsx 提取，已导出给 workbench-prompt-dock.tsx 复用。
 * 职责单一：渲染连入参考素材的缩略图/首尾帧/上传按钮。
 */

import React, { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { Upload, X, Check, FileText, AlertTriangle, RefreshCw } from 'lucide-react';
import { uploadAsset } from '@/features/asset-picker/services/upload-asset.js';
import { nodeActionBus } from '@zeroexo/plugin-nodes';

/** 参考素材类型上限(与后端模板 channelConstraints.bounds 对齐) */
export interface VideoReferenceBounds {
  maxReferenceImages?: number;
  maxReferenceVideos?: number;
  maxReferenceAudios?: number;
}

/** 类型 → 图标/名称 */
const TYPE_META: Record<string, { icon: React.ReactNode; label: string }> = {
  text: { icon: <FileText size={14} />, label: '文本' },
  image: { icon: <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>, label: '图片' },
  video: { icon: <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>, label: '视频' },
  audio: { icon: <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>, label: '音频' },
  generator: { icon: <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>, label: '生成器' },
  'stacked-media': { icon: <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>, label: '堆叠' },
};

/**
 * 根据视频生成模式返回参考素材配置
 */
export function getReferenceConfigByMode(
  mode: string,
  bounds: VideoReferenceBounds,
): { isFirstLastFrameMode: boolean; showImages: boolean; showVideos: boolean; showAudio: boolean } {
  const maxReferenceImages = bounds.maxReferenceImages ?? 0;
  const maxReferenceVideos = bounds.maxReferenceVideos ?? 0;
  const maxReferenceAudios = bounds.maxReferenceAudios ?? 0;
  switch (mode) {
    case 'image-to-video-first-last-frame':
      return { isFirstLastFrameMode: true, showImages: false, showVideos: false, showAudio: false };
    case 'multi-modal-reference':
    case 'video-edit':
    case 'video-extend':
      return {
        isFirstLastFrameMode: false,
        showImages: maxReferenceImages > 0,
        showVideos: maxReferenceVideos > 0,
        showAudio: maxReferenceAudios > 0,
      };
    default:
      return { isFirstLastFrameMode: false, showImages: false, showVideos: false, showAudio: false };
  }
}

/** Plan#71 T8：引用失效标记（对应 workbench-types WorkbenchShotReference.stale） */
export interface ReferenceStaleInfo {
  level: 'warn' | 'broken';
  reason: string;
}

export const DockReferencesSection = memo(function DockReferencesSection({
  nodeId,
  incomingNodes,
  refUrlMap,
  nodeCompatibility,
  onRemoveIncoming,
  mode,
  bounds,
  onUpload,
  onExtractFrame,
  onReplaceRef,
  onOpenPicker,
  accept: acceptProp,
}: {
  nodeId: string;
  incomingNodes: Array<{ id: string; type: string; title: string; content?: string; storageKey?: string; stale?: ReferenceStaleInfo | null }>;
  refUrlMap: Record<string, string>;
  nodeCompatibility: Record<string, boolean>;
  onRemoveIncoming: (sourceNodeId: string) => void;
  mode: string;
  bounds: VideoReferenceBounds;
  /** 受控模式上传回调（出片工作台：上传后写入镜头 references；不传则走画布节点连线链路） */
  onUpload?: (file: File) => void;
  /** 受控模式从视频取帧回调（首尾帧空槽位旁「从视频取帧」按钮） */
  onExtractFrame?: (slot: 'first' | 'last') => void;
  /**
   * Plan#79 T2：上传接受的文件类型覆盖参数。
   * 剧本/分镜 dock 传 TEXT_UPLOAD_ACCEPT（图片/视频/音频转剧本链路未开发）；
   * 不传则沿用默认 image/video/文本。
   */
  accept?: string;
  /** Plan#71 T8：失效引用替换回调（宿主 re-resolve 最新图/改引后写回）；stale 卡 hover 出现替换按钮 */
  onReplaceRef?: (sourceNodeId: string) => void;
  /**
   * 统一资产选择页（2026-11-13）：传了就点上传格打开「画布 / 资产 / 主体」选择页，
   * 不再直接弹系统文件框；文本类素材仍走隐藏 file input。
   */
  onOpenPicker?: (anchor: HTMLElement) => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';
  const navBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)';
  const bgHover = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.04)';
  const dangerColor = theme.toolbar.danger ?? '#ef4444';
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const handleAddReference = useCallback((anchor?: HTMLElement) => {
    if (onOpenPicker && anchor) { onOpenPicker(anchor); return; }
    fileInputRef.current?.click();
  }, [onOpenPicker]);
  /** Plan#71 T8：hover 卡片时显示「替换失效引用」按钮 */
  const [hoverRefId, setHoverRefId] = useState<string | null>(null);

  const config = getReferenceConfigByMode(mode, bounds);
  const isFirstLast = config.isFirstLastFrameMode;
  const imageNodes = incomingNodes.filter((n) => n.type === 'image');
  const otherNodes = incomingNodes.filter((n) => n.type !== 'image');
  const slotsFull = imageNodes.length >= 2;
  // Plan#79 T2：剧本/分镜（文本类）只收文本；其余沿用多模态默认
  const accept = isFirstLast ? 'image/*' : (acceptProp ?? 'image/*,video/*,.txt,.md,.docx,.pdf');
  const textOnly = !isFirstLast && !!acceptProp;

  const handleFileInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (onUpload) {
      onUpload(file);
      return;
    }
    if (isFirstLast) {
      if (!file.type.startsWith('image/')) return;
      if (slotsFull) return;
    }
    try {
      const uploaded = await uploadAsset(file);
      const d = uploaded.data;
      const base = { nodeId, title: uploaded.title.replace(/\.[^.]+$/, '') };
      if (d.kind === 'text') {
        nodeActionBus.emit('nodeDock:addReferenceNode', { ...base, kind: 'text', content: d.content });
      } else if (d.kind === 'image' || d.kind === 'video') {
        nodeActionBus.emit('nodeDock:addReferenceNode', {
          ...base, kind: d.kind, storageKey: d.storageKey,
          content: d.kind === 'image' ? d.dataUrl : d.url,
          width: d.width, height: d.height,
        });
      } else if (d.kind === 'audio') {
        nodeActionBus.emit('nodeDock:addReferenceNode', {
          ...base, kind: d.kind, storageKey: d.storageKey, content: d.url,
        });
      }
    } catch { /* 上传失败静默 */ }
  }, [nodeId, isFirstLast, slotsFull, onUpload]);

  const renderThumb = (n: { id: string; type: string; title: string; content?: string; storageKey?: string; stale?: ReferenceStaleInfo | null }) => {
    const meta = TYPE_META[n.type] ?? { icon: <FileText size={14} />, label: n.type };
    const isCompatible = nodeCompatibility[n.id] ?? true;
    const url = refUrlMap[n.id] || (n.type === 'image' ? n.content : undefined);
    const hasThumb = !!url;
    // Plan#71 T8 失效态：broken=红边/红角标；warn=橙边/橙角标；title 优先给失效原因
    const stale = n.stale;
    const staleColor = stale?.level === 'broken' ? dangerColor : '#f59e0b';
    const borderColor = stale ? staleColor : navBorder;
    const cardTitle = stale ? `${meta.label}: ${n.title}（失效：${stale.reason}）` : `${meta.label}: ${n.title}`;
    return (
      <div key={n.id} onMouseEnter={() => setHoverRefId(n.id)} onMouseLeave={() => setHoverRefId((prev) => (prev === n.id ? null : prev))} style={{ position: 'relative', width: 48, height: 48, borderRadius: 14, overflow: 'hidden', flexShrink: 0, border: `1px solid ${borderColor}`, boxShadow: stale ? `0 0 0 1px ${staleColor}33 inset` : undefined, display: 'flex', alignItems: 'center', justifyContent: 'center', background: hasThumb ? 'transparent' : bgHover, cursor: 'default' }} title={cardTitle}>
        {hasThumb ? (
          <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: 4, width: '100%' }}>
            <span style={{ flexShrink: 0, display: 'inline-flex', opacity: 0.7 }}>{meta.icon}</span>
            <span style={{ fontSize: 10, color: theme.toolbar.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 40, textAlign: 'center', lineHeight: 1.2 }}>{n.title}</span>
          </div>
        )}
        {stale ? (
          <div style={{ position: 'absolute', top: 2, left: 2, width: 12, height: 12, borderRadius: '50%', background: staleColor, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
            <AlertTriangle size={7} color="#fff" strokeWidth={3} />
          </div>
        ) : (
          <div style={{ position: 'absolute', top: 2, left: 2, width: 12, height: 12, borderRadius: '50%', background: isCompatible ? '#a4fd01' : dangerColor, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
            {isCompatible ? <Check size={7} color="#fff" strokeWidth={3} /> : <X size={7} color="#fff" strokeWidth={3} />}
          </div>
        )}
        <button type="button" onClick={() => onRemoveIncoming(n.id)} title={t('nodeDock.removeRef', '移除参考素材')} style={{ position: 'absolute', top: 2, right: 2, width: 16, height: 16, borderRadius: '50%', border: 'none', background: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.08)', color: theme.toolbar.textMuted ?? '', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1, transition: 'background 0.1s', flexShrink: 0, zIndex: 2 }}
          onMouseEnter={(e) => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(15,23,42,0.14)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.08)'; }}>
          <X size={10} />
        </button>
        {/* Plan#71 T8：失效引用「替换（拉最新图/改引）」修复动作（hover 显示） */}
        {stale && onReplaceRef && (
          <button
            type="button"
            onClick={() => onReplaceRef(n.id)}
            title={t('nodeDock.replaceStaleRef', '替换为最新引用（拉取当前主体最新图）')}
            style={{
              position: 'absolute', right: 2, bottom: 2, width: 16, height: 16, borderRadius: 6,
              border: 'none', background: staleColor, color: '#fff', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1,
              transition: 'opacity 0.12s', zIndex: 2, opacity: hoverRefId === n.id ? 1 : 0,
            }}
          >
            <RefreshCw size={9} strokeWidth={2.6} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {isFirstLast ? (
        <>
          {[{ slot: 'first' as const, label: '首帧', node: imageNodes[0] }, { slot: 'last' as const, label: '尾帧', node: imageNodes[1] }].map(({ slot, label, node }) => (
            <div key={slot} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flexShrink: 0 }}>
              {node ? (
                <div style={{ position: 'relative', width: 56, height: 48, borderRadius: 14, overflow: 'hidden', border: `1px solid ${navBorder}`, background: 'transparent' }}>
                  <img src={refUrlMap[node.id] || node.content} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                  <button type="button" onClick={() => onRemoveIncoming(node.id)} title={t('nodeDock.removeRef', '移除参考素材')} style={{ position: 'absolute', top: 2, right: 2, width: 16, height: 16, borderRadius: '50%', border: 'none', background: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.08)', color: theme.toolbar.textMuted ?? '', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1, transition: 'background 0.1s', flexShrink: 0, zIndex: 2 }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(15,23,42,0.14)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.08)'; }}>
                    <X size={10} />
                  </button>
                </div>
              ) : (
                <button type="button" onClick={(e) => handleAddReference(e.currentTarget)} title={t('nodeDock.uploadFirstFrame', '上传图片作为首帧/尾帧')} style={{ width: 56, height: 48, borderRadius: 14, border: `1px dashed ${navBorder}`, background: 'transparent', color: theme.toolbar.textMuted ?? '', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background 0.12s' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = bgHover; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                  <Upload size={14} />
                </button>
              )}
              <span style={{ fontSize: 10, color: theme.toolbar.textMuted ?? '', lineHeight: 1 }}>{label}</span>
              {!node && onExtractFrame && (
                <button type="button" onClick={() => onExtractFrame(slot)} title="从当前镜头视频取帧" style={{ fontSize: 9, color: theme.toolbar.accent, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, flexShrink: 0 }}>
                  从视频取帧
                </button>
              )}
            </div>
          ))}
          {otherNodes.map(renderThumb)}
        </>
      ) : onOpenPicker && incomingNodes.length === 0 && !textOnly ? (
        /* 空参考区 = 一整块可点击入口（与图 2 一致）：点开统一资产选择页，而不是系统文件框 */
        <button
          type="button"
          data-ref-picker-open
          onClick={(e) => handleAddReference(e.currentTarget)}
          style={{
            width: '100%', height: 56, borderRadius: 10, boxSizing: 'border-box',
            border: `1.5px dashed ${navBorder}`, background: 'transparent',
            color: theme.toolbar.textMuted ?? '', cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            fontSize: 12, transition: 'background 0.12s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = bgHover; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <Upload size={15} />
          {mode === 'video-edit' || mode === 'video-extend'
            ? t('nodeDock.editRefHint', '编辑/延长模式:上传参考视频,并描述要修改或延伸的画面')
            : t('nodeDock.refHint', '拖入节点连入参考,或点击上传素材')}
        </button>
      ) : (
        <>
          <button type="button" onClick={(e) => handleAddReference(e.currentTarget)} style={{ width: 48, height: 48, borderRadius: 14, border: `1px dashed ${navBorder}`, background: 'transparent', color: theme.toolbar.textMuted ?? '', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background 0.12s' }} title={textOnly ? t('nodeDock.uploadRefText', '上传文本素材(图片/视频转剧本链路暂未开放)') : t('nodeDock.uploadRef', '上传参考素材(支持图片/视频/文本)')}
            onMouseEnter={(e) => { e.currentTarget.style.background = bgHover; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
            <Upload size={15} />
          </button>
          {incomingNodes.map(renderThumb)}
        </>
      )}
      <input ref={fileInputRef} type="file" accept={accept} style={{ display: 'none' }} onChange={handleFileInputChange} />
      {incomingNodes.length === 0 && !(onOpenPicker && !textOnly) && (
        <span style={{ fontSize: 11, color: theme.toolbar.textMuted ?? '', flexShrink: 0 }}>
          {isFirstLast
            ? t('nodeDock.firstLastHint', '首尾帧模式:按顺序填入首帧/尾帧,最多 2 张图片')
            : mode === 'video-edit' || mode === 'video-extend'
              ? t('nodeDock.editRefHint', '编辑/延长模式:上传参考视频,并描述要修改或延伸的画面')
              : t('nodeDock.refHint', '拖入节点连入参考,或点击上传素材')}
        </span>
      )}
      {isFirstLast && incomingNodes.length > 0 && imageNodes.length < 2 && (
        <span style={{ fontSize: 11, color: theme.toolbar.textMuted ?? '', flexShrink: 0 }}>
          {t('nodeDock.firstLastHint', '首尾帧模式:按顺序填入首帧/尾帧,最多 2 张图片')}
        </span>
      )}
    </div>
  );
});