/**
 * MaskEditDialog - 局部蒙版编辑对话框(antd Modal + ThemeConfig 主题令牌)
 *
 * - 双 canvas 架构:maskCanvas(隐藏二值)+ previewCanvas(可见蓝色遮罩 + 虚线边)
 * - antd Slider/Input.TextArea + lucide 图标
 * - buildEditMask 生成 AI 所需格式(白底 + 透明孔 = 修改区)
 *
 * AI 调用由外部注入,本组件只负责蒙版绘制 + prompt 收集。
 */

import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Modal, Button, Input } from 'antd';
import { Brush, Eraser, RotateCcw, Sparkles } from 'lucide-react';
import { ViewToolsBar } from './view-tools-bar.js';
import { BrushEditorLayout, BrushModeButtons, BrushSizeControl } from './brush-editor-ui.js';
import type { ThemeConfig } from '@zeroexo/shared';
import { readImageMeta } from '../utils/image-meta.js';
import type { MaskEditPayload, ImageMeta } from '../types.js';

export interface MaskEditDialogProps {
  dataUrl: string;
  open: boolean;
  onClose: () => void;
  onConfirm: (payload: MaskEditPayload) => void;
  theme: ThemeConfig;
  /** 内联渲染（节点内编辑）：不套 Modal 外壳，由宿主给出容器 */
  inline?: boolean;
}

type DrawMode = 'paint' | 'erase';

const DEFAULT_BRUSH_SIZE = 100;
const MASK_FILL_COLOR = 'rgba(37, 99, 235, 0.38)';
const MASK_BORDER_COLOR = 'rgba(255, 255, 255, 0.72)';

export function MaskEditDialog({
  dataUrl,
  open,
  onClose,
  onConfirm,
  theme,
  inline,
}: MaskEditDialogProps): React.ReactElement | null {
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef<{
    active: boolean;
    last: { x: number; y: number } | null;
  }>({ active: false, last: null });
  const [image, setImage] = useState<ImageMeta | null>(null);
  const [prompt, setPrompt] = useState('');
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH_SIZE);
  const [mode, setMode] = useState<DrawMode>('paint');
  const [error, setError] = useState('');
  /** 笔刷光标（显示画笔大小圆环）：x/y = 舞台内 CSS 坐标，scale = 显示像素/原图像素 */
  const [brushCursor, setBrushCursor] = useState<{ x: number; y: number; scale: number } | null>(null);
  /** 画布视图（缩放 + 平移；以舞台中心为缩放原点） */
  const [view, setView] = useState<{ zoom: number; pan: { x: number; y: number } }>({ zoom: 1, pan: { x: 0, y: 0 } });
  /** 手型工具：开启后拖拽 = 平移图片（不画遮罩） */
  const [panMode, setPanMode] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const panDragRef = useRef<{ x: number; y: number } | null>(null);
  const clampZoom = (z: number): number => Math.min(8, Math.max(0.1, z));

  // 重置 + 读取图片
  useEffect(() => {
    if (!open) return;
    setPrompt('');
    setBrushSize(DEFAULT_BRUSH_SIZE);
    setMode('paint');
    setError('');
    setView({ zoom: 1, pan: { x: 0, y: 0 } });
    setPanMode(false);
    setBrushCursor(null);
    let cancelled = false;
    readImageMeta(dataUrl)
      .then((meta) => {
        if (!cancelled) setImage(meta);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [dataUrl, open]);

  // 图片加载后清空 canvas
  useEffect(() => {
    clearCanvas(maskCanvasRef.current);
    clearCanvas(previewCanvasRef.current);
  }, [image]);

  // 滚轮缩放（以指针为锚点）：需要非 passive 监听才能 preventDefault 阻止页面滚动
  useEffect(() => {
    const el = stageRef.current;
    if (!el || !image) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = event.clientX - rect.left - rect.width / 2;
      const cy = event.clientY - rect.top - rect.height / 2;
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      setView((prev) => {
        const zoom = clampZoom(prev.zoom * factor);
        const ratio = zoom / prev.zoom;
        return {
          zoom,
          pan: {
            x: prev.pan.x + (cx - prev.pan.x) * (1 - ratio),
            y: prev.pan.y + (cy - prev.pan.y) * (1 - ratio),
          },
        };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [image]);

  const zoomBy = (factor: number): void => {
    setView((prev) => ({ ...prev, zoom: clampZoom(prev.zoom * factor) }));
  };
  const resetView = (): void => {
    setView({ zoom: 1, pan: { x: 0, y: 0 } });
    setPanMode(false);
  };

  /** 平移：手型工具（左键）或任何模式下中键拖拽 */
  const startPan = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!(panMode || event.button === 1)) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    panDragRef.current = { x: event.clientX, y: event.clientY };
  };
  const movePan = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = panDragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    setView((prev) => ({ ...prev, pan: { x: prev.pan.x + dx, y: prev.pan.y + dy } }));
  };
  const stopPan = (): void => {
    panDragRef.current = null;
  };

  /** 笔刷圆环跟随指针（舞台坐标；scale 含画布缩放，圆环在舞台层渲染不会被二次缩放） */
  const cursorRafRef = useRef(0);
  const pendingCursorRef = useRef<{ x: number; y: number; scale: number } | null>(null);
  const updateBrushCursor = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const stage = stageRef.current;
    const canvas = previewCanvasRef.current;
    if (!stage || !canvas || !image?.width) return;
    const stageRect = stage.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    pendingCursorRef.current = {
      x: event.clientX - stageRect.left,
      y: event.clientY - stageRect.top,
      scale: canvasRect.width / image.width,
    };
    // 每帧最多一次 setState：整段绘制时不因为光标状态把画布重渲染拖慢
    if (cursorRafRef.current) return;
    cursorRafRef.current = requestAnimationFrame(() => {
      cursorRafRef.current = 0;
      setBrushCursor(pendingCursorRef.current);
    });
  };
  useEffect(() => () => {
    if (cursorRafRef.current) cancelAnimationFrame(cursorRafRef.current);
  }, []);

  const draw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = readCanvasPoint(event.currentTarget, event.clientX, event.clientY);
    const maskCanvas = maskCanvasRef.current;
    const context = maskCanvas?.getContext('2d');
    if (!context || !maskCanvas) return;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = brushSize;
    context.globalCompositeOperation =
      mode === 'paint' ? 'source-over' : 'destination-out';
    context.strokeStyle = '#000';
    context.fillStyle = '#000';
    if (!drawingRef.current.last) {
      drawMaskStroke(context, point, point, brushSize);
    } else {
      drawMaskStroke(context, drawingRef.current.last, point, brushSize);
    }
    renderMaskPreview(maskCanvas, previewCanvasRef.current);
    drawingRef.current.last = point;
    if (mode === 'paint') setError('');
  };

  const startDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return; // 中键/右键留给舞台平移/菜单
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = { active: true, last: null };
    updateBrushCursor(event);
    if (maskCanvasRef.current) {
      renderMaskPreview(maskCanvasRef.current, previewCanvasRef.current);
    }
    draw(event);
  };

  const moveDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    updateBrushCursor(event);
    if (!drawingRef.current.active) return;
    event.preventDefault();
    draw(event);
  };

  const stopDraw = () => {
    drawingRef.current = { active: false, last: null };
    const maskCanvas = maskCanvasRef.current;
    if (maskCanvas) {
      renderMaskPreview(
        maskCanvas,
        previewCanvasRef.current,
        canvasHasPaint(maskCanvas),
      );
    }
  };

  const resetMask = () => {
    clearCanvas(maskCanvasRef.current);
    clearCanvas(previewCanvasRef.current);
    setError('');
  };

  const submit = () => {
    const nextPrompt = prompt.trim();
    const canvas = maskCanvasRef.current;
    if (!nextPrompt) {
      setError('请输入修改要求');
      return;
    }
    if (!canvas) return;
    if (!canvasHasPaint(canvas)) {
      setError('请先涂抹局部区域');
      return;
    }
    onConfirm({ prompt: nextPrompt, maskDataUrl: buildEditMask(canvas) });
  };

  const actions = (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
      <Button icon={<RotateCcw size={13} />} onClick={resetMask}>重置</Button>
      <Button onClick={onClose}>取消</Button>
      <Button type="primary" icon={<Sparkles size={13} />} onClick={submit}>AI 修改</Button>
    </div>
  );
  const stage = (
    <div
      ref={stageRef}
      data-mask-stage
      style={{
        position: 'relative',
        width: inline ? '100%' : undefined,
        height: inline ? '100%' : undefined,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        userSelect: 'none',
        touchAction: 'none',
        cursor: panMode ? 'grab' : 'default',
      }}
      onPointerDown={startPan}
      onPointerMove={movePan}
      onPointerUp={stopPan}
      onPointerCancel={stopPan}
      onPointerLeave={stopPan}
    >
      <div
        style={{
          transform: `translate(${view.pan.x}px, ${view.pan.y}px) scale(${view.zoom})`,
          transformOrigin: 'center center',
          willChange: 'transform',
        }}
      >
        <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%' }}>
          <img
            src={dataUrl}
            alt=""
            draggable={false}
            style={{ display: 'block', maxHeight: inline ? 'calc(100vh - 230px)' : '68vh', maxWidth: '100%' }}
          />
          {image ? (
            <>
              <canvas ref={maskCanvasRef} width={image.width} height={image.height} style={{ display: 'none' }} />
              <canvas
                ref={previewCanvasRef}
                width={image.width}
                height={image.height}
                style={{
                  position: 'absolute', inset: 0, width: '100%', height: '100%',
                  cursor: 'none', touchAction: 'none',
                  // 手型工具下让指针事件穿透到舞台，用于平移
                  pointerEvents: panMode ? 'none' : 'auto',
                }}
                onPointerDown={startDraw}
                onPointerMove={moveDraw}
                onPointerUp={stopDraw}
                onPointerCancel={stopDraw}
                onPointerEnter={updateBrushCursor}
                onPointerLeave={() => { if (!drawingRef.current.active) setBrushCursor(null); }}
              />
            </>
          ) : null}
        </div>
      </div>

      {/* 缩放 / 平移工具条：与涂抹弹窗共用同一胶囊（ViewToolsBar） */}
      <ViewToolsBar
        zoom={view.zoom}
        onZoomIn={() => zoomBy(1.25)}
        onZoomOut={() => zoomBy(1 / 1.25)}
        onReset={resetView}
        theme={theme}
        prefix="mask"
        panMode={panMode}
        onTogglePan={() => setPanMode((v) => { if (!v) setBrushCursor(null); return !v; })}
      />

      {/* 笔刷大小圆环（舞台坐标系：位置含平移、直径含缩放，不会二次缩放） */}
      {brushCursor && (
        <>
          <div
            data-brush-cursor
            style={{
              position: 'absolute',
              left: brushCursor.x,
              top: brushCursor.y,
              width: Math.max(4, brushSize * brushCursor.scale),
              height: Math.max(4, brushSize * brushCursor.scale),
              transform: 'translate(-50%, -50%)',
              borderRadius: '50%',
              border: '1.5px solid rgba(255,255,255,0.95)',
              boxShadow: '0 0 0 1px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(0,0,0,0.35)',
              pointerEvents: 'none',
              zIndex: 5,
            }}
          />
          <div
            style={{
              position: 'absolute', left: brushCursor.x, top: brushCursor.y,
              width: 2, height: 2, marginLeft: -1, marginTop: -1, borderRadius: '50%',
              background: 'rgba(255,255,255,0.95)', boxShadow: '0 0 0 1px rgba(0,0,0,0.55)',
              pointerEvents: 'none', zIndex: 6,
            }}
          />
        </>
      )}
    </div>
  );

  const toolsPanel = (
    <>
      <div style={{ fontSize: 12, color: theme.toolbar.textMuted }}>
        {image ? `${image.width} × ${image.height} px` : '读取中'}
      </div>

      {/* 画笔/橡皮擦切换 */}
      <BrushModeButtons
        theme={theme}
        value={mode}
        options={[
          { value: 'paint', label: '画笔', icon: <Brush size={13} /> },
          { value: 'erase', label: '擦除', icon: <Eraser size={13} /> },
        ]}
        onChange={(v) => setMode(v as 'paint' | 'erase')}
      />

      <BrushSizeControl theme={theme} value={brushSize} onChange={setBrushSize} min={8} max={160} step={2} />

      {/* 修改要求 */}
      <div>
        <div style={{ fontSize: 12, color: theme.toolbar.textMuted, marginBottom: 6 }}>修改要求</div>
        <Input.TextArea
          rows={6}
          value={prompt}
          placeholder="例如:把选中区域改成金属材质,保持原图光影"
          onChange={(e) => {
            setPrompt(e.target.value);
            setError('');
          }}
          status={error && !prompt.trim() ? 'error' : undefined}
        />
        {error ? (
          <div style={{ fontSize: 12, color: theme.toolbar.danger, marginTop: 6, fontWeight: 500 }}>{error}</div>
        ) : null}
      </div>
    </>
  );

  const content = (
    <BrushEditorLayout stage={stage} tools={toolsPanel} actions={actions} theme={theme} />
  );

  if (!open) return null;

  if (inline) return content;

  return (
    <Modal
      open={open && Boolean(dataUrl)}
      onCancel={onClose}
      title="局部编辑"
      width={980}
      centered
      destroyOnHidden
      styles={{
        header: { borderBottom: 'none', marginBottom: 0, paddingBottom: 8 },
        footer: { borderTop: 'none', paddingTop: 4 },
      }}
      footer={actions}
    >
      {content}
    </Modal>
  );
}

// ===== Canvas 辅助函数(纯逻辑,无 React 依赖) =====

function readCanvasPoint(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
    y: ((clientY - rect.top) / Math.max(1, rect.height)) * canvas.height,
  };
}

function clearCanvas(canvas: HTMLCanvasElement | null): void {
  const context = canvas?.getContext('2d');
  if (!canvas || !context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
}

function drawMaskStroke(
  context: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  size: number,
): void {
  if (from.x === to.x && from.y === to.y) {
    context.beginPath();
    context.arc(to.x, to.y, size / 2, 0, Math.PI * 2);
    context.fill();
    return;
  }
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
}

function canvasHasPaint(canvas: HTMLCanvasElement): boolean {
  const context = canvas.getContext('2d');
  if (!context) return false;
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let index = 3; index < data.length; index += 4) {
    const v = data[index];
    if (v !== undefined && v > 0) return true;
  }
  return false;
}

function renderMaskPreview(
  maskCanvas: HTMLCanvasElement,
  previewCanvas: HTMLCanvasElement | null,
  withBorder = false,
): void {
  const context = previewCanvas?.getContext('2d');
  if (!previewCanvas || !context) return;
  context.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  context.fillStyle = MASK_FILL_COLOR;
  context.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(maskCanvas, 0, 0);
  context.globalCompositeOperation = 'source-over';
  if (withBorder) drawDashedMaskBorder(context, maskCanvas);
}

function drawDashedMaskBorder(
  context: CanvasRenderingContext2D,
  maskCanvas: HTMLCanvasElement,
): void {
  const maskContext = maskCanvas.getContext('2d');
  if (!maskContext) return;
  const { width, height } = maskCanvas;
  const data = maskContext.getImageData(0, 0, width, height).data;
  const step = Math.max(1, Math.round(Math.max(width, height) / 1200));
  const dash = step * 8;
  const gap = step * 5;
  const period = dash + gap;

  context.save();
  context.fillStyle = MASK_BORDER_COLOR;
  context.shadowColor = 'rgba(0, 0, 0, 0.24)';
  context.shadowBlur = step * 1.5;
  for (let y = step; y < height - step; y += step) {
    for (let x = step; x < width - step; x += step) {
      const offset = (y * width + x) * 4 + 3;
      if (data[offset] === 0 || !isMaskEdge(data, width, x, y, step)) continue;
      if ((x + y) % period > dash) continue;
      context.fillRect(x - step / 2, y - step / 2, Math.max(1.5, step), Math.max(1.5, step));
    }
  }
  context.restore();
}

function isMaskEdge(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  step: number,
): boolean {
  return (
    data[((y - step) * width + x) * 4 + 3] === 0 ||
    data[((y + step) * width + x) * 4 + 3] === 0 ||
    data[(y * width + x - step) * 4 + 3] === 0 ||
    data[(y * width + x + step) * 4 + 3] === 0
  );
}

function buildEditMask(selectionCanvas: HTMLCanvasElement): string {
  const canvas = document.createElement('canvas');
  canvas.width = selectionCanvas.width;
  canvas.height = selectionCanvas.height;
  const context = canvas.getContext('2d');
  if (!context) return selectionCanvas.toDataURL('image/png');
  const selectionContext = selectionCanvas.getContext('2d');
  // 输出给生成后端的遮罩必须是「白=要改、黑=保留」的 RGB 图：
  // LoadImageMask(channel=red) 只读 RGB，不读 alpha；旧实现白底+透明笔迹会被当成整图全白。
  context.fillStyle = '#000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (!selectionContext) return canvas.toDataURL('image/png');
  const selection = selectionContext.getImageData(0, 0, canvas.width, canvas.height);
  const mask = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < mask.data.length; index += 4) {
    const sel = selection.data[index + 3];
    if (sel !== undefined && sel > 0) {
      mask.data[index] = 255;
      mask.data[index + 1] = 255;
      mask.data[index + 2] = 255;
    }
    mask.data[index + 3] = 255;
  }
  context.putImageData(mask, 0, 0);
  return canvas.toDataURL('image/png');
}
