/**
 * PaintDialog - 手动局部涂抹（2026-11-10 用户要求）
 *
 * 用途：用户不一定要 AI 改图，有时只是想手动涂点颜色（补色块 / 划掉 / 标记 / 上色草稿）。
 * 能力：画笔颜色（原生取色器 + 十六进制）、吸色器（从合成图取色）、笔刷大小、橡皮擦、
 *       撤销、清空；确认后把「原图 + 涂抹层」合成成一张图交给宿主落成画布节点。
 *
 * 与 MaskEditDialog 的区别：那里画的是 AI 蒙版（白=要改），这里画的是**可见颜色**。
 */
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Button, Slider } from 'antd';
import { Brush, Eraser, Palette, Pipette, RotateCcw, Save, Trash2 } from 'lucide-react';
import type { ThemeConfig } from '@zeroexo/shared';
import { loadImage, readImageMeta } from '../utils/image-meta.js';
import type { ImageMeta } from '../types.js';

export interface PaintPayload {
  blob: Blob;
  width: number;
  height: number;
}

export interface PaintDialogProps {
  dataUrl: string;
  open: boolean;
  onClose: () => void;
  onConfirm: (payload: PaintPayload) => void;
  theme: ThemeConfig;
  inline?: boolean;
}

type PaintTool = 'brush' | 'eraser' | 'picker';

const DEFAULT_BRUSH_SIZE = 24;
const DEFAULT_COLOR = '#ef4444';
const MAX_UNDO = 20;

export function PaintDialog({
  dataUrl,
  open,
  onClose,
  onConfirm,
  theme,
  inline,
}: PaintDialogProps): React.ReactElement | null {
  const paintCanvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef<{ active: boolean; last: { x: number; y: number } | null }>({ active: false, last: null });
  const undoRef = useRef<ImageData[]>([]);
  const [image, setImage] = useState<ImageMeta | null>(null);
  const [tool, setTool] = useState<PaintTool>('brush');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH_SIZE);
  const [saving, setSaving] = useState(false);
  const [hasPaint, setHasPaint] = useState(false);
  const [undoCount, setUndoCount] = useState(0);
  const [cursor, setCursor] = useState<{ x: number; y: number; scale: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    setTool('brush');
    setColor(DEFAULT_COLOR);
    setBrushSize(DEFAULT_BRUSH_SIZE);
    setHasPaint(false);
    setCursor(null);
    undoRef.current = [];
    let cancelled = false;
    readImageMeta(dataUrl)
      .then((meta) => { if (!cancelled) setImage(meta); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [dataUrl, open]);

  useEffect(() => {
    const canvas = paintCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  }, [image]);

  const pointOf = (canvas: HTMLCanvasElement, clientX: number, clientY: number): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
      y: ((clientY - rect.top) / Math.max(1, rect.height)) * canvas.height,
    };
  };

  const pushUndo = (): void => {
    const canvas = paintCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    undoRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (undoRef.current.length > MAX_UNDO) undoRef.current.shift();
    setUndoCount(undoRef.current.length);
  };

  const stroke = (p: { x: number; y: number }): void => {
    const canvas = paintCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = brushSize;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    const last = drawingRef.current.last;
    if (!last) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    drawingRef.current.last = p;
    setHasPaint(true);
  };

  /** 吸色器：把原图 + 涂抹层合成后取像素颜色 */
  const pickColor = async (canvas: HTMLCanvasElement, p: { x: number; y: number }): Promise<void> => {
    const composed = document.createElement('canvas');
    composed.width = canvas.width;
    composed.height = canvas.height;
    const ctx = composed.getContext('2d');
    if (!ctx) return;
    try {
      const img = await loadImage(dataUrl);
      ctx.drawImage(img, 0, 0, composed.width, composed.height);
    } catch {
      return;
    }
    ctx.drawImage(canvas, 0, 0);
    const x = Math.min(composed.width - 1, Math.max(0, Math.round(p.x)));
    const y = Math.min(composed.height - 1, Math.max(0, Math.round(p.y)));
    const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
    const hex = `#${[r, g, b].map((v) => (v ?? 0).toString(16).padStart(2, '0')).join('')}`;
    setColor(hex);
    setTool('brush');
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (event.button !== 0 || !image) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const canvas = event.currentTarget;
    const p = pointOf(canvas, event.clientX, event.clientY);
    if (tool === 'picker') {
      void pickColor(canvas, p);
      return;
    }
    pushUndo();
    drawingRef.current = { active: true, last: null };
    stroke(p);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const canvas = event.currentTarget;
    const stage = stageRef.current;
    if (stage && image?.width) {
      const stageRect = stage.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      setCursor({
        x: event.clientX - stageRect.left,
        y: event.clientY - stageRect.top,
        scale: canvasRect.width / image.width,
      });
    }
    if (!drawingRef.current.active) return;
    event.preventDefault();
    stroke(pointOf(canvas, event.clientX, event.clientY));
  };

  const onPointerUp = (): void => {
    drawingRef.current = { active: false, last: null };
  };

  const undo = (): void => {
    const canvas = paintCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    const prev = undoRef.current.pop();
    if (!canvas || !ctx || !prev) return;
    ctx.putImageData(prev, 0, 0);
    setUndoCount(undoRef.current.length);
  };

  const clearAll = (): void => {
    const canvas = paintCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    pushUndo();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasPaint(false);
  };

  const save = async (): Promise<void> => {
    const paint = paintCanvasRef.current;
    if (!paint || !image) return;
    setSaving(true);
    try {
      const composed = document.createElement('canvas');
      composed.width = paint.width;
      composed.height = paint.height;
      const ctx = composed.getContext('2d');
      if (!ctx) return;
      const img = await loadImage(dataUrl);
      ctx.drawImage(img, 0, 0, composed.width, composed.height);
      ctx.drawImage(paint, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => composed.toBlob(resolve, 'image/png'));
      if (!blob) return;
      onConfirm({ blob, width: composed.width, height: composed.height });
    } finally {
      setSaving(false);
    }
  };

  const toolBtnStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    border: `1px solid ${active ? theme.toolbar.accent : 'transparent'}`,
    background: active ? `${theme.toolbar.accent}22` : theme.toolbar.editorSurface,
    color: active ? theme.toolbar.accent : theme.toolbar.textMuted,
    padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
    fontWeight: active ? 600 : 400, transition: 'all 0.15s',
  });

  const stage = (
    <div
      ref={stageRef}
      data-paint-stage
      style={{ position: 'relative', width: inline ? '100%' : undefined, height: inline ? '100%' : undefined, display: 'flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none', touchAction: 'none', overflow: 'hidden' }}
    >
      <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%' }}>
        <img src={dataUrl} alt="" draggable={false} style={{ display: 'block', maxHeight: inline ? 'calc(100vh - 230px)' : '68vh', maxWidth: '100%' }} />
        {image ? (
          <canvas
            ref={paintCanvasRef}
            width={image.width}
            height={image.height}
            data-paint-canvas
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: tool === 'picker' ? 'crosshair' : 'none', touchAction: 'none' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => { if (!drawingRef.current.active) setCursor(null); }}
          />
        ) : null}
      </div>
      {cursor && tool !== 'picker' ? (
        <div
          data-paint-cursor
          style={{
            position: 'absolute', left: cursor.x, top: cursor.y,
            width: Math.max(4, brushSize * cursor.scale), height: Math.max(4, brushSize * cursor.scale),
            transform: 'translate(-50%, -50%)', borderRadius: '50%',
            border: '1.5px solid rgba(255,255,255,0.95)',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.55)',
            pointerEvents: 'none', zIndex: 5,
          }}
        />
      ) : null}
      {!hasPaint ? (
        <div style={{ position: 'absolute', left: 10, bottom: 10, padding: '4px 8px', borderRadius: 6, background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 11, pointerEvents: 'none' }}>
          直接在图上涂抹即可；确认后生成一张新图片节点
        </div>
      ) : null}
    </div>
  );

  const toolsPanel = (
    <>
      <div style={{ fontSize: 12, color: theme.toolbar.textMuted }}>
        {image ? `${image.width} × ${image.height} px` : '读取中'}
      </div>

      {/* 工具：画笔 / 橡皮 / 吸色器 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        <button type="button" data-paint-tool="brush" onClick={() => setTool('brush')} style={toolBtnStyle(tool === 'brush')}>
          <Brush size={13} /> 画笔
        </button>
        <button type="button" data-paint-tool="eraser" onClick={() => setTool('eraser')} style={toolBtnStyle(tool === 'eraser')}>
          <Eraser size={13} /> 擦除
        </button>
        <button type="button" data-paint-tool="picker" onClick={() => setTool('picker')} style={toolBtnStyle(tool === 'picker')} title="点击图上取色">
          <Pipette size={13} /> 吸色
        </button>
      </div>

      {/* 颜色：原生取色器 + 十六进制展示 */}
      <div>
        <div style={{ fontSize: 12, color: theme.toolbar.textMuted, marginBottom: 6 }}>颜色</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <input
            type="color"
            aria-label="画笔颜色"
            data-paint-color
            value={color}
            onChange={(e) => setColor(e.target.value)}
            style={{ width: 40, height: 32, padding: 0, border: `1px solid ${theme.toolbar.border}`, borderRadius: 6, background: 'transparent', cursor: 'pointer' }}
          />
          <Palette size={14} style={{ color: theme.toolbar.textMuted }} />
          <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: theme.toolbar.text }}>{color}</span>
        </label>
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          {['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#111827', '#ffffff'].map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              aria-label={c}
              onClick={() => setColor(c)}
              style={{ width: 22, height: 22, borderRadius: 6, border: color === c ? `2px solid ${theme.toolbar.accent}` : `1px solid ${theme.toolbar.border}`, background: c, cursor: 'pointer' }}
            />
          ))}
        </div>
      </div>

      {/* 笔刷大小 */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: theme.toolbar.textMuted, marginBottom: 4 }}>
          <span>笔刷大小</span>
          <span style={{ fontWeight: 600, color: theme.toolbar.text }}>{brushSize}px</span>
        </div>
        <Slider min={2} max={160} step={1} value={brushSize} onChange={(v) => setBrushSize(v)} />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <Button size="small" icon={<RotateCcw size={13} />} onClick={undo} disabled={undoCount === 0}>撤销</Button>
        <Button size="small" icon={<Trash2 size={13} />} onClick={clearAll} disabled={!hasPaint}>清空</Button>
      </div>
    </>
  );

  const actions = (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
      <Button onClick={onClose}>取消</Button>
      <Button type="primary" icon={<Save size={13} />} loading={saving} onClick={() => void save()}>保存到画布</Button>
    </div>
  );

  if (!open) return null;

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 16 }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.28)', borderRadius: 12, padding: 20, overflow: 'auto' }}>
        {stage}
      </div>
      <div style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14, background: theme.toolbar.editorSurface, borderRadius: 12, padding: 16, overflowY: 'auto' }}>
        {toolsPanel}
        <div style={{ marginTop: 'auto' }}>{actions}</div>
      </div>
    </div>
  );
}
