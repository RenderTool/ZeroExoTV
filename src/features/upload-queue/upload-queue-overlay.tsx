/**
 * UploadQueueOverlay - 批量上传覆盖层
 *
 * 渲染在画布/素材库之上,显示文件上传进度队列:
 * - 进度条(总进度)
 * - 文件列表(文件名 + 状态)
 * - 鼠标悬停文件时显示缩略图预览
 * - 完成后可关闭
 *
 * 使用项目自研 Modal 组件（与换肤同款现代风格）
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { Progress, Typography, Space } from 'antd';
import { Image, Video, FileText, Music, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { Modal } from '@/shared/components/modal';
import { useUploadQueueStore } from './upload-queue-store.js';
import type { UploadFileItem } from './upload-queue-store.js';
import type { ThemeConfig } from '@zeroexo/shared';

export function UploadQueueOverlay({ onRetryFailed }: { onRetryFailed?: (failedFiles: File[]) => void }): React.ReactElement | null {
  const { visible, items, processing, completed, total, reset } = useUploadQueueStore();
  const [hoveredItem, setHoveredItem] = useState<UploadFileItem | null>(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const { theme } = useTheme();

  const handleMouseEnter = useCallback(
    (item: UploadFileItem, e: React.MouseEvent) => {
      if (!item.thumbnailUrl && item.kind !== 'image' && item.kind !== 'video') return;
      setHoveredItem(item);
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setHoverPos({ x: rect.right + 12, y: rect.top });
    },
    [],
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredItem(null);
  }, []);

  if (!visible) return null;

  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const allDone = completed >= total && total > 0;
  const failedCount = items.filter((it) => it.status === 'error').length;
  const showThumbnail = hoveredItem?.thumbnailUrl;

  const handleRetry = (): void => {
    const failedFiles = items
      .filter((it) => it.status === 'error')
      .map((it) => it.file);
    reset();
    onRetryFailed?.(failedFiles);
  };

  const handleDone = (): void => {
    const store = useUploadQueueStore.getState();
    store.hide();
    store.reset();
  };

  return (
    <>
      <Modal
        open={visible}
        title={allDone ? '上传完成' : processing ? '正在上传...' : '准备上传'}
        onClose={handleDone}
        width={520}
        theme={theme}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            {failedCount > 0 && !allDone && !processing ? (
              <button
                type="button"
                style={{
                  padding: '6px 12px',
                  fontSize: 13,
                  borderRadius: 6,
                  border: `1px solid ${theme.toolbar.accent}`,
                  background: 'transparent',
                  color: theme.toolbar.accent,
                  cursor: 'pointer',
                  transition: 'background 0.15s ease',
                }}
                onMouseOver={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = `${theme.toolbar.accent}10`;
                }}
                onMouseOut={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                }}
                onClick={handleRetry}
              >
                重试失败项 ({failedCount})
              </button>
            ) : null}
            {allDone ? (
              <button
                type="button"
                style={{
                  padding: '6px 12px',
                  fontSize: 13,
                  borderRadius: 6,
                  border: `1px solid ${theme.toolbar.accent}`,
                  background: theme.toolbar.accent,
                  color: theme.mode === 'dark' ? '#000' : '#fff',
                  cursor: 'pointer',
                  transition: 'opacity 0.15s ease',
                }}
                onMouseOver={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.opacity = '0.9';
                }}
                onMouseOut={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.opacity = '1';
                }}
                onClick={handleDone}
              >
                完成
              </button>
            ) : (
              <span style={{ fontSize: 12, color: theme.toolbar.textMuted }}>
                {pct}%
              </span>
            )}
          </div>
        }
      >
        {/* 副标题 */}
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 13 }}>
          共 {total} 个文件
          {allDone ? '，全部处理完毕' : `，已完成 ${completed}`}
        </Typography.Text>

        {/* 进度条 */}
        <div style={{ marginBottom: 16 }}>
          <Progress
            percent={pct}
            showInfo={false}
            strokeColor={theme.toolbar.accent}
            railColor={theme.toolbar.border}
            size="small"
          />
        </div>

        {/* 文件列表 */}
        <div style={{ maxHeight: 320, overflowY: 'auto', marginBottom: 0 }}>
          {items.map((item) => {
            const isError = item.status === 'error';
            const isDone = item.status === 'done';
            const isUploading = item.status === 'uploading';
            const hasThumbnail = !!(item.thumbnailUrl || item.kind === 'image' || item.kind === 'video');

            const getBackgroundColor = () => {
              if (isDone) return `${theme.toolbar.accent}08`;
              if (isError) return `${theme.toolbar.accent}12`;
              if (hoveredItem?.id === item.id) return theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
              return 'transparent';
            };

            const getTextColor = () => {
              if (isDone) return theme.toolbar.textMuted;
              if (isError) return theme.toolbar.accent;
              return theme.toolbar.text;
            };

            return (
              <div
                key={item.id}
                onMouseEnter={(e) => handleMouseEnter(item, e)}
                onMouseLeave={handleMouseLeave}
                style={{
                  borderRadius: 8,
                  padding: '8px 10px',
                  background: getBackgroundColor(),
                  cursor: hasThumbnail ? 'pointer' : 'default',
                  transition: 'background 0.15s ease',
                  marginBottom: 4,
                }}
              >
                <Space size={10} align="center" style={{ width: '100%', overflow: 'hidden' }}>
                  {/* 类型图标 */}
                  <FileTypeIcon kind={item.kind} theme={theme} />

                  {/* 状态图标 */}
                  {isDone ? (
                    <CheckCircle size={14} color={theme.toolbar.textMuted} />
                  ) : isError ? (
                    <XCircle size={14} color={theme.toolbar.accent} />
                  ) : isUploading ? (
                    <Loader2 size={14} color={theme.toolbar.accent} style={{ animation: 'zeroexo-spin 1s linear infinite' }} />
                  ) : (
                    <span style={{ width: 14, display: 'inline-block' }} />
                  )}

                  {/* 文件名 */}
                  <Typography.Text
                    ellipsis
                    style={{
                      flex: 1,
                      color: getTextColor(),
                      fontSize: 13,
                    }}
                  >
                    {item.name}
                  </Typography.Text>

                  {/* 文件大小 */}
                  <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
                    {(item.size / 1024).toFixed(0)}KB
                  </Typography.Text>
                </Space>
              </div>
            );
          })}
        </div>
      </Modal>

      {/* 悬停缩略图弹出层 */}
      {hoveredItem && showThumbnail && (
        <ThumbnailPopup
          thumbnailUrl={showThumbnail}
          name={hoveredItem.name}
          kind={hoveredItem.kind}
          x={hoverPos.x}
          y={hoverPos.y}
          theme={theme}
        />
      )}
    </>
  );
}

/** 文件类型图标 */
function FileTypeIcon({ kind, theme }: { kind: string; theme: ThemeConfig }): React.ReactElement {
  const size = 14;
  const color = theme.toolbar.textMuted;

  switch (kind) {
    case 'image':
      return <Image size={size} color={color} />;
    case 'video':
      return <Video size={size} color={color} />;
    case 'audio':
      return <Music size={size} color={color} />;
    default:
      return <FileText size={size} color={color} />;
  }
}

/** 缩略图弹出层组件 */
function ThumbnailPopup({
  thumbnailUrl,
  name,
  kind,
  x,
  y,
  theme,
}: {
  thumbnailUrl: string;
  name: string;
  kind: string;
  x: number;
  y: number;
  theme: ThemeConfig;
}): React.ReactElement {
  const popupRef = useRef<HTMLDivElement>(null);
  const [adjustedX, setAdjustedX] = useState(x);

  useEffect(() => {
    if (popupRef.current) {
      const rect = popupRef.current.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        setAdjustedX(x - rect.width - 180);
      }
    }
  }, [x]);

  return (
    <div
      ref={popupRef}
      style={{
        position: 'fixed',
        left: adjustedX,
        top: y,
        zIndex: 100000,
        background: theme.node.contentBackground,
        border: `1px solid ${theme.toolbar.border}`,
        borderRadius: 10,
        padding: 8,
        boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        maxWidth: 220,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          width: 200,
          height: 150,
          borderRadius: 6,
          overflow: 'hidden',
          background: theme.toolbar.background,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {kind === 'image' ? (
          <img src={thumbnailUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : kind === 'video' ? (
          <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <img src={thumbnailUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: 'rgba(0,0,0,0.6)',
                  border: '2px solid rgba(255,255,255,0.7)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
                  <polygon points="8,5 19,12 8,19" />
                </svg>
              </div>
            </div>
          </div>
        ) : null}
      </div>
      <span style={{ fontSize: 11, marginTop: 6, maxWidth: 200, textAlign: 'center', color: theme.toolbar.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {name}
      </span>
    </div>
  );
}
