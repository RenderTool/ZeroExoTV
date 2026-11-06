/**
 * CoverViewportEditor - 封面取景视口(固定 16:9,不可改框)
 *
 * - 视口即预览: 框内所见即所得,无另外的比例示意图;
 * - 严格等比: 图片只有一个缩放因子 scale,渲染宽高 = imgW·(s0·scale) / imgH·(s0·scale) px,
 *   绝不把 width/height 分别设成视口尺寸(那是 fill,会形变);
 * - 图片可拖拽平移 + 滚轮/滑块缩放;缩放下限 = 刚好铺满(scale=1,短边贴视口),上限 = 原始像素 1:1 ×2;
 * - 平移边界按等比尺寸钳制,任何位置不露空白;
 * - 性能: 拖拽/滚轮期间只写 img 定位样式(ref 直改),松手/滚轮停顿才 commit React state。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Slider } from 'antd';
import {
  COVER_ASPECT,
  clampView,
  maxScaleFor,
  viewImageStylePx,
  type CoverView,
} from '@/shared/utils/cover-viewport.js';

export interface CoverViewportEditorProps {
  /** 图片 URL(原图,非裁剪结果) */
  src: string;
  /** 原图像素尺寸 */
  imgW: number;
  imgH: number;
  /** 当前取景(受控) */
  view: CoverView;
  /** 取景变更(拖拽/滚轮/滑块结束后提交) */
  onViewChange: (view: CoverView) => void;
  borderColor: string;
}

export function CoverViewportEditor({
  src,
  imgW,
  imgH,
  view,
  onViewChange,
  borderColor,
}: CoverViewportEditorProps): React.ReactElement {
  const boxRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  /** 拖拽中的临时取景(ref,不走 React 渲染) */
  const liveViewRef = useRef<CoverView>(view);
  /** 视口 CSS 宽度(px);高 = vw / aspect */
  const [vpCssW, setVpCssW] = useState(0);
  const vw = vpCssW;
  const vh = vw > 0 ? vw / COVER_ASPECT : 0;

  // 视口 CSS 宽度(等比几何全部以实测 px 为准)
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setVpCssW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const maxScale = useMemo(
    () => (vw > 0 ? maxScaleFor(imgW, imgH, vw, vh) : 1),
    [imgW, imgH, vw, vh],
  );
  /** 滑块本地值(拖动中不 commit 受控 view,避免拇指回跳) */
  const [sliderScale, setSliderScale] = useState(view.scale);

  /** 直改 img 定位样式(拖拽期不重渲染);等比 px 派生,禁止 % 贴视口 */
  const applyStyle = useCallback(
    (v: CoverView) => {
      const img = imgRef.current;
      if (!img || vw <= 0) return;
      const s = viewImageStylePx(imgW, imgH, vw, vh, v);
      img.style.left = s.left;
      img.style.top = s.top;
      img.style.width = s.width;
      img.style.height = s.height;
    },
    [imgW, imgH, vw, vh],
  );

  // 外部 view 变化(重置/回填)或视口尺寸就绪时同步一次
  useEffect(() => {
    liveViewRef.current = view;
    setSliderScale(view.scale);
    applyStyle(view);
  }, [view, applyStyle]);

  const commit = useCallback(
    (v: CoverView) => {
      if (vw <= 0) return;
      const clamped = clampView(imgW, imgH, vw, vh, v, maxScale);
      liveViewRef.current = clamped;
      applyStyle(clamped);
      onViewChange(clamped);
    },
    [imgW, imgH, vw, vh, maxScale, applyStyle, onViewChange],
  );

  // ===== 拖拽平移(只在 pointermove 里改定位样式,松手才 commit) =====
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const box = boxRef.current;
      if (!box || vw <= 0) return;
      e.preventDefault();
      box.setPointerCapture(e.pointerId);
      const rect = box.getBoundingClientRect();
      const start = { ...liveViewRef.current };
      const startX = e.clientX;
      const startY = e.clientY;

      const onMove = (ev: PointerEvent) => {
        const dtx = (ev.clientX - startX) / rect.width; // px → 视口宽单位
        const dty = (ev.clientY - startY) / rect.width;
        const v = clampView(imgW, imgH, vw, vh, { scale: start.scale, tx: start.tx + dtx, ty: start.ty + dty }, maxScale);
        liveViewRef.current = v;
        applyStyle(v); // 只动样式,不 setState
      };
      const onUp = (ev: PointerEvent) => {
        box.removeEventListener('pointermove', onMove);
        box.removeEventListener('pointerup', onUp);
        const dtx = (ev.clientX - startX) / rect.width;
        const dty = (ev.clientY - startY) / rect.width;
        commit({ scale: start.scale, tx: start.tx + dtx, ty: start.ty + dty });
      };
      box.addEventListener('pointermove', onMove);
      box.addEventListener('pointerup', onUp);
    },
    [imgW, imgH, vw, vh, maxScale, applyStyle, commit],
  );

  // ===== 滚轮缩放(以视口中心为锚) =====
  useEffect(() => {
    const box = boxRef.current;
    if (!box || vw <= 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0015);
      const v = clampView(imgW, imgH, vw, vh, { ...liveViewRef.current, scale: liveViewRef.current.scale * factor }, maxScale);
      liveViewRef.current = v;
      applyStyle(v);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => commit(v), 150); // 滚轮停顿后提交一次
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      box.removeEventListener('wheel', onWheel);
      if (timer) clearTimeout(timer);
    };
  }, [imgW, imgH, vw, vh, maxScale, applyStyle, commit]);

  // 初始样式: 视口未测量前不渲染 img,避免 0 宽几何闪变
  const initialStyle = useMemo(
    () => (vw > 0 ? viewImageStylePx(imgW, imgH, vw, vh, view) : undefined),
    [imgW, imgH, vw, vh, view],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div
        ref={boxRef}
        onPointerDown={onPointerDown}
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '16 / 9',
          borderRadius: 8,
          overflow: 'hidden',
          border: `1px solid ${borderColor}`,
          cursor: 'grab',
          touchAction: 'none',
          userSelect: 'none',
        }}
      >
        {initialStyle ? (
          <img
            ref={imgRef}
            src={src}
            alt=""
            draggable={false}
            style={{ ...initialStyle, pointerEvents: 'none' }}
          />
        ) : null}
      </div>
      <Slider
        min={1}
        max={maxScale}
        step={0.01}
        value={sliderScale}
        tooltip={{ formatter: (v) => `${Math.round((v ?? 1) * 100)}%` }}
        onChange={(v) => {
          if (vw <= 0) return;
          setSliderScale(v);
          const next = clampView(imgW, imgH, vw, vh, { ...liveViewRef.current, scale: v }, maxScale);
          liveViewRef.current = next;
          applyStyle(next);
        }}
        onChangeComplete={(v) => commit({ ...liveViewRef.current, scale: v })}
      />
    </div>
  );
}
