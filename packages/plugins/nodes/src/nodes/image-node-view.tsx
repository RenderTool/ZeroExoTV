/**
 * 图片载体节点视图 - 派生自 BaseNodeView + AIStateView
 *
 * 4 状态机(idle→loading→success/error),仅展示图片,不含生成逻辑。
 */

import { useProgressiveImage, buildBackendUrl } from '../utils/hydrate.js';

import React, { useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Image as ImageIcon, Image } from 'lucide-react';
import type { NodeRendererProps, Pin } from '@zeroexo/core';
import { ResizeNodeCommand, UpdateNodeDataCommand } from '@zeroexo/core';
import type { ConnectionController } from '@zeroexo/plugin-connection';
import type { ImageNodeData } from '@zeroexo/plugin-ai-provider';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { BaseNodeView, AIStateView, useHasIncomingEdges, nodeActionBus } from '../base-node-view.js';
import { generatingPreviewKey, useGeneratingPreviewStore } from '../generating-preview-store.js';
import { replaceNodeImage } from '../utils/replace-node-image.js';
import { planOnloadResize } from '../utils/media-fit.js';
import { IMAGE_DEFAULT_SIZE, IMAGE_LONG_SIDE, MEDIA_MIN_SIZE } from '../utils/node-contracts.js';
import {
  cursorOriginPercent,
  nextContentScale,
} from '../utils/image-content-zoom.js';

// ===== 引脚定义 =====
export function getImageNodePins(): Pin[] {
  return [
    { id: 'prompt', name: 'Prompt', direction: 'input' },
    { id: 'image', name: 'Image', direction: 'output' },
  ];
}

// ===== 空状态图标构建函数(需 theme 以使用主题色) =====
function imageEmptyIcon(titleColor: string): React.ReactNode {
  return <Image color={titleColor} size={22} strokeWidth={1.5} />;
}

// ===== 媒体容器样式 =====
const mediaContainerStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  position: 'relative',
  boxSizing: 'border-box',
};

// ===== ImageNodeView =====

export interface ImageNodeViewProps extends NodeRendererProps {
  connectionController: ConnectionController | null;
  /** 画布图 store(用于上一个/下一个导航) */
  store?: ReactGraphStore | null;
  /** contentOnly 模式:跳过 BaseNodeView 外壳,仅渲染媒体内容(用于 StackNode 等容器) */
  contentOnly?: boolean;
}

export function ImageNodeView({
  node,
  pins,
  isSelected,
  isHovered,
  forceShowPins,
  updateNode,
  commandQueue,
  invK,
  connectionController,
  externalRenaming,
  onRenameFinish,
  store,
  contentOnly = false,
}: ImageNodeViewProps): React.ReactElement {
  const data = (node.data ?? {}) as Partial<ImageNodeData>;
  const status = data.status ?? 'idle';
  /** 生成中实时预览帧 / 采样步进（app 侧按 ComfyUI /ws 的 progress 与 PREVIEW_IMAGE 写入） */
  const generatingPreview = useGeneratingPreviewStore((s) => s.byNode[generatingPreviewKey(s.canvasDocId, node.id)]);
  const generatingProgress = useGeneratingPreviewStore((s) => s.progressByNode[generatingPreviewKey(s.canvasDocId, node.id)]);
  const { t } = useTranslation();
  const { theme } = useTheme();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Phase VI.4: 渐进式加载 — 缩小时仅渲染缩略图,放大时加载 preview 级;
  // 画布节点永不加载原图(三档图片契约,征集 #77 用户拍板:原图只在图片浏览器中使用)
  // Plan#48 像素预算:节点屏幕实际占用宽度(节点宽 × 缩放 × DPR)决定加载档位,
  // 同屏多节点时只解码/渲染看得清所需的像素;无尺寸信息时回退旧 invK 两档行为
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const viewportK = invK && invK > 0 ? 1 / invK : 1;
  const budgetPx = node.size?.width
    ? Math.min(Math.round(node.size.width * viewportK * dpr), 2048)
    : null;
  const hydratedContent = useProgressiveImage(data.storageKey, data.content ?? '', invK ?? 1, budgetPx);
  // 使用 hydratedContent 判断是否有内容,避免异步解析期间渲染 <img src=""> 导致浏览器跳转
  const hasContent = !!hydratedContent;
  // 生成节点语义(2026-08-25 用户拍板):只要连入上游即生成节点态(隐藏替换按钮,避免"既是生成器又是资源器"二义态);
  // 断开全部上游才降级为素材节点;AI 生成结果(有 generationId)恒为只读素材,永不显示替换按钮
  const hasIncoming = useHasIncomingEdges(store, node.id, isSelected);
  const isGeneratorState = hasIncoming;
  const isAiGenerated = !!(data as Record<string, unknown>).generationId;
  // 后端缩略图 URL 404 时降级到 content(blob URL 或原图)
  const [imgSrc, setImgSrc] = useState(hydratedContent);
  useEffect(() => { setImgSrc(hydratedContent); }, [hydratedContent]);

  // ===== 节点内内容缩放(2026-11-04,不依赖选中态) =====
  // 滚轮: 悬停图片直接缩放内容,按光标位置锚定(stopPropagation + preventDefault,
  // 不再冒泡到画布的平移/缩放)。
  // 双击缩放已移除(2026-11-05 用户拍板:双击不得让节点内图片变大;双击不再改变缩放)。
  // 只改 img 的 transform scale,节点尺寸不动 → 宽高比恒不变。角柄 resize 保留。
  // 缩放状态持久化到 data.contentScale/contentOrigin(刷新不丢),换图自动复位。
  const mediaRef = useRef<HTMLDivElement | null>(null);
  const savedScaleRaw = (data as Record<string, unknown>).contentScale;
  const savedScale = typeof savedScaleRaw === 'number' && Number.isFinite(savedScaleRaw) && savedScaleRaw > 0
    ? savedScaleRaw
    : 1;
  const savedOriginRaw = (data as Record<string, unknown>).contentOrigin as { x?: number; y?: number } | undefined;
  const savedOrigin = savedOriginRaw && Number.isFinite(savedOriginRaw.x) && Number.isFinite(savedOriginRaw.y)
    ? { x: savedOriginRaw.x as number, y: savedOriginRaw.y as number }
    : { x: 50, y: 50 };
  const [contentScale, setContentScale] = useState(savedScale);
  const [contentOrigin, setContentOrigin] = useState(savedOrigin);

  // 换图后复位内容缩放(并清掉持久化的缩放状态)
  useEffect(() => {
    setContentScale(1);
    setContentOrigin({ x: 50, y: 50 });
  }, [data.storageKey, data.content]);

  // 缩放状态持久化: 防抖 400ms 写入 data(可撤销),与 data 中已有值相同则不写
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (contentOnly || !commandQueue) return;
    if (contentScale === savedScale && contentOrigin.x === savedOrigin.x && contentOrigin.y === savedOrigin.y) return;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      commandQueue.execute(new UpdateNodeDataCommand(node.id, {
        contentScale,
        contentOrigin,
      } as Record<string, unknown>));
    }, 400);
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentScale, contentOrigin, contentOnly, commandQueue, node.id]);

  // 原生 wheel 监听:React 合成 wheel 在部分浏览器为 passive,preventDefault 会失效,
  // 必须以 passive:false 挂原生监听才能阻断画布平移/缩放
  useEffect(() => {
    const el = mediaRef.current;
    if (!el || !hasContent) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      setContentOrigin(cursorOriginPercent(e.clientX, e.clientY, el.getBoundingClientRect()));
      setContentScale((s) => nextContentScale(s, e.deltaY));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [hasContent]);

  // ===== 图片 onload 纠偏(2026-11-04,修复「比例失真」根因) =====
  // 节点尺寸在创建时用 payload 元数据算定,元数据缺失/错误时永远停在 16:9 fallback。
  // 图片真实加载完成后: ①元数据与 data 不符 → 回写 naturalWidth/Height;
  // ②节点宽高比与真实比例失配 → 以当前最长边为上限重新 fit(保留用户缩放尺度)。
  // 每个图源只纠一次(ref 守卫);用户拖角 resize 锁比例,纠正后比例恒匹配,不会被回打。
  const correctedForRef = useRef<string | null>(null);
  const handleImgLoad = (e: React.SyntheticEvent<HTMLImageElement>): void => {
    if (contentOnly || !commandQueue) return;
    const img = e.currentTarget;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh) return;
    const srcKey = `${data.storageKey ?? ''}|${data.content ?? ''}`;
    if (correctedForRef.current === srcKey) return;
    correctedForRef.current = srcKey;

    if (data.naturalWidth !== nw || data.naturalHeight !== nh) {
      commandQueue.execute(new UpdateNodeDataCommand(node.id, {
        naturalWidth: nw,
        naturalHeight: nh,
      } as Record<string, unknown>));
    }

    const newSize = planOnloadResize(node.size ?? IMAGE_DEFAULT_SIZE, nw, nh, {
      // 2026-11-05 用户拍板：统一长边上限 320（不再撑到 620），按真实比例重算，节点内不留 letterbox
      maxLongSide: IMAGE_LONG_SIDE,
      minShortSide: MEDIA_MIN_SIZE.height,
    });
    if (newSize) {
      const oldRect = {
        x: node.position.x,
        y: node.position.y,
        width: node.size?.width ?? IMAGE_DEFAULT_SIZE.width,
        height: node.size?.height ?? IMAGE_DEFAULT_SIZE.height,
      };
      commandQueue.execute(new ResizeNodeCommand(node.id, oldRect, { ...oldRect, ...newSize }));
    }
  };

  // 后端缩略图/预览图 404 时的降级链:
  //   当前 URL → data.content(blob/dataURL) → 后端 preview 级 URL(后端无变体自动回退原图)
  //   节点展示层不直连 full 档(征集 #77 三档契约),均失败则不再循环(guard 防抖)
  const handleImgError = (): void => {
    if (data.content && imgSrc !== data.content) {
      setImgSrc(data.content);
      return;
    }
    const previewBackendUrl = buildBackendUrl(data.storageKey, 'preview');
    if (previewBackendUrl && imgSrc !== previewBackendUrl) {
      setImgSrc(previewBackendUrl);
    }
  };

  // 节点颜色使用 theme.node.fill(所有类型共用)
  const nodeColor = theme.node.fill;

  // Bug3: 点击空状态触发文件选择器
  const handleReplaceClick = (): void => {
    fileInputRef.current?.click();
  };

  // 替换图片:统一使用 replaceNodeImage(通过 CommandQueue,支持撤销/重做,保持比例)
  const handleFileReplace = async (file: File): Promise<void> => {
    if (!file.type.startsWith('image/')) return;
    // 标题刷新为文件名(去掉扩展名)
    const fileName = file.name.replace(/\.[^.]+$/, '');
    updateNode({ title: fileName });
    await replaceNodeImage(commandQueue, node, file, {
      onStatusChange: () => {},
    });
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (file) void handleFileReplace(file);
    e.target.value = '';
  };

  // Phase D2.8: 拖拽外部文件到节点上替换内容(阻止冒泡到画布避免创建新节点)
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>): Promise<void> => {
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    e.preventDefault();
    e.stopPropagation();
    void handleFileReplace(file);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // 问题5: 标题栏尺寸规格 — 优先用自然尺寸,回退到节点尺寸
  const titleSizeText = data.naturalWidth && data.naturalHeight
    ? `${data.naturalWidth} × ${data.naturalHeight}`
    : `${node.size?.width ?? 340} × ${node.size?.height ?? 240}`;
  // T10: 图标尺寸 CSS 连续化(与标题 fontSize 同源 --zx-invk),消除量化跨桶跳变
  const TITLE_ICON_CLAMP = 'calc(11px * var(--zx-invk, 1))';
  const titleIconEl = <ImageIcon size={16} style={{ width: TITLE_ICON_CLAMP, height: TITLE_ICON_CLAMP }} />;

  // contentOnly 模式:跳过 BaseNodeView 外壳,仅渲染媒体内容
  if (contentOnly) {
    return (
      <>
        <AIStateView
          status={status}
          errorDetails={data.errorDetails}
          errorType={data.errorType}
          accentColor={nodeColor}
          emptyIcon={imageEmptyIcon(theme.toolbar.textMuted)}
          hasContent={hasContent}
          onReplace={handleReplaceClick}
          // contentOnly 内嵌卡:替换入口归容器(StackNode MainReplaceButton)管理
          isSelected={false}
          replaceBtnPosition="left"
          backgroundColor={nodeColor}
          taskLabel={(data.taskLabel as string) ?? undefined}
          skeleton="media" skeletonKind="image"
          previewImage={status === 'loading' ? generatingPreview : undefined}
          progress={status === 'loading' ? generatingProgress : undefined}
        >
          <div
            ref={mediaRef}
            style={{ ...mediaContainerStyle, background: 'transparent' }}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          >
            <img
              src={imgSrc}
              draggable={false}
              onLoad={handleImgLoad}
              onError={handleImgError}
              // contain: 按容器等比 fit —— 不裁切、不变形(节点比例与图片不一致时留白边而非裁切)
              // transform: 节点内容缩放(滚轮/双击),节点尺寸不变 → 宽高比恒定
              style={{
                width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none', display: 'block',
                transform: `scale(${contentScale})`,
                transformOrigin: `${contentOrigin.x}% ${contentOrigin.y}%`,
              }}
            />
          </div>
        </AIStateView>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileInputChange}
        />
      </>
    );
  }

  return (
    <BaseNodeView
      node={node}
      pins={pins}
      isSelected={isSelected}
      isHovered={isHovered}
      title={node.title ?? data.title ?? t('nodes.imageTitle')}
      color={nodeColor}
      connectionController={connectionController}
      forceShowPins={forceShowPins}
      contentPadding={0}
      invK={invK}
      titleIcon={titleIconEl}
      titleSize={titleSizeText}
      updateNode={updateNode}
      externalRenaming={externalRenaming}
      onRenameFinish={onRenameFinish}
      store={store}
    >
      <AIStateView
        status={status}
        errorDetails={data.errorDetails}
        errorType={data.errorType}
        accentColor={nodeColor}
        emptyIcon={imageEmptyIcon(theme.toolbar.textMuted)}
        hasContent={hasContent}
        onReplace={handleReplaceClick}
        isSelected={isSelected}
        showReplaceButton={isSelected && !isGeneratorState && !isAiGenerated}
        replaceBtnPosition="left"
        backgroundColor={nodeColor}
        taskLabel={(data.taskLabel as string) ?? undefined}
        skeleton="media" skeletonKind="image"
        previewImage={status === 'loading' ? generatingPreview : undefined}
        progress={status === 'loading' ? generatingProgress : undefined}
        onRetry={() => nodeActionBus.emit('retry', { nodeId: node.id })}
        onCancel={() => nodeActionBus.emit('cancel', { nodeId: node.id })}
      >
        <div
          ref={mediaRef}
          style={{ ...mediaContainerStyle, background: 'transparent' }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          <img
            src={imgSrc}
            draggable={false}
            onError={handleImgError}
            // contain: 按容器等比 fit —— 不裁切、不变形(节点比例与图片不一致时留白边而非裁切)
            // transform: 节点内容缩放(滚轮/双击),节点尺寸不变 → 宽高比恒定
            style={{
              width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none', display: 'block',
              transform: `scale(${contentScale})`,
              transformOrigin: `${contentOrigin.x}% ${contentOrigin.y}%`,
            }}
          />
        </div>
      </AIStateView>
      {/* Bug3: 隐藏文件选择器(空状态点击触发) */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />
    </BaseNodeView>
  );
}
