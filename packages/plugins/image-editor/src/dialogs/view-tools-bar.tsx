/**
 * ViewToolsBar — 图片编辑器缩放/平移工具条（唯一实现）
 *
 * 从蒙版编辑弹窗抽出（2026-11-13 用户指令）：涂抹弹窗不得再自造「缩小/100%/放大」按钮，
 * 与蒙版弹窗共用同一条悬浮胶囊（缩放 - 百分比 - 缩放 + / 适应窗口 / 手型平移）。
 * 画布/剧本时间轴的缩放胶囊也是同一视觉语言。
 */
import type { CSSProperties } from 'react';
import { Hand, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import type { ThemeConfig } from '@zeroexo/plugin-theme';

export interface ViewToolsBarProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  theme: ThemeConfig;
  /** 数据标记前缀：paint / mask…（测试与结构断言用） */
  prefix: string;
  panMode?: boolean;
  onTogglePan?: () => void;
  style?: CSSProperties;
}

const BTN: CSSProperties = {
  width: 26,
  height: 24,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: 5,
  background: 'transparent',
  color: '#fff',
  cursor: 'pointer',
};

export function ViewToolsBar({
  zoom, onZoomIn, onZoomOut, onReset, theme, prefix, panMode, onTogglePan, style,
}: ViewToolsBarProps): React.ReactElement {
  return (
    <div
      {...{ [`data-${prefix}-view-tools`]: '' }}
      style={{
        position: 'absolute', left: 10, bottom: 10, zIndex: 6,
        display: 'inline-flex', alignItems: 'center', gap: 2, padding: 3,
        borderRadius: 8, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)',
        ...style,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        title="缩小"
        aria-label="缩小"
        data-zoom-out=""
        {...{ [`data-${prefix}-zoom-out`]: '' }}
        onClick={onZoomOut}
        style={BTN}
      >
        <ZoomOut size={14} />
      </button>
      <button
        type="button"
        title="恢复到 100%"
        aria-label="恢复到 100%"
        data-zoom-reset=""
        {...{ [`data-${prefix}-zoom-reset`]: '' }}
        onClick={onReset}
        style={{ ...BTN, minWidth: 46, padding: '0 4px', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        title="放大"
        aria-label="放大"
        data-zoom-in=""
        {...{ [`data-${prefix}-zoom-in`]: '' }}
        onClick={onZoomIn}
        style={BTN}
      >
        <ZoomIn size={14} />
      </button>
      <span style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.25)', margin: '0 3px' }} />
      <button
        type="button"
        title="适应窗口（重置缩放与平移）"
        aria-label="适应窗口"
        data-zoom-fit=""
        onClick={onReset}
        style={BTN}
      >
        <Maximize2 size={14} />
      </button>
      {onTogglePan && (
        <button
          type="button"
          title="平移（手型工具：拖拽移动图片）"
          aria-label="平移"
          data-zoom-pan=""
          aria-pressed={panMode}
          onClick={onTogglePan}
          style={{
            ...BTN,
            background: panMode ? theme.toolbar.accent : 'transparent',
          }}
        >
          <Hand size={14} />
        </button>
      )}
    </div>
  );
}
