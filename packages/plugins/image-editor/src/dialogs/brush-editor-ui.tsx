/**
 * 画笔类编辑器共用 UI（2026-11-13 用户指令）
 *
 * 涂抹（可见颜色）与局部（画遮罩）不是两套界面：同一套左右结构、同一套工具按钮、
 * 同一套笔刷大小/预览、同一套底部动作。唯一区别是画布上落的是颜色还是遮罩。
 * 禁止任一侧再自造按钮样式或另排一套面板。
 */
import type { CSSProperties, ReactNode } from 'react';
import { Slider } from 'antd';
import type { ThemeConfig } from '@zeroexo/plugin-theme';

export interface BrushModeOption {
  value: string;
  label: string;
  icon: ReactNode;
}

export function brushModeBtnStyle(theme: ThemeConfig, active: boolean): CSSProperties {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    border: `1px solid ${active ? theme.toolbar.accent : 'transparent'}`,
    background: active ? `${theme.toolbar.accent}22` : theme.toolbar.editorSurface,
    color: active ? theme.toolbar.accent : theme.toolbar.textMuted,
    padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
    fontWeight: active ? 600 : 400, transition: 'all 0.15s',
  };
}

export function BrushModeButtons({
  theme, value, options, onChange, dataPrefix,
}: {
  theme: ThemeConfig;
  value: string;
  options: BrushModeOption[];
  onChange: (value: string) => void;
  /** 可选数据前缀：paint → data-paint-tool=...（供测试/结构断言） */
  dataPrefix?: string;
}): React.ReactElement {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${options.length}, 1fr)`, gap: 8 }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          data-brush-mode={opt.value}
          {...(dataPrefix ? { [`data-${dataPrefix}-tool`]: opt.value } : {})}
          onClick={() => onChange(opt.value)}
          style={brushModeBtnStyle(theme, value === opt.value)}
        >
          {opt.icon} {opt.label}
        </button>
      ))}
    </div>
  );
}

export function BrushSizeControl({
  theme, value, onChange, min = 8, max = 160, step = 2,
}: {
  theme: ThemeConfig;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}): React.ReactElement {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: theme.toolbar.textMuted, marginBottom: 4 }}>
        <span>笔刷大小</span>
        <span style={{ fontWeight: 600, color: theme.toolbar.text }}>{value}px</span>
      </div>
      <Slider min={min} max={max} step={step} value={value} onChange={onChange} />
      {/* 笔刷预览：以 200 源像素窗口为参照等比缩放，直观看到实际笔刷相对大小 */}
      <div
        data-brush-preview
        style={{
          display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, padding: '8px 10px',
          borderRadius: 8, background: theme.toolbar.editorSurface,
        }}
      >
        <div style={{
          width: 64, height: 64, borderRadius: 8, flexShrink: 0,
          background: 'rgba(0,0,0,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            width: Math.max(4, Math.min(56, (value / 200) * 64)),
            height: Math.max(4, Math.min(56, (value / 200) * 64)),
            borderRadius: '50%',
            border: '1.5px solid rgba(255,255,255,0.95)',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.45)',
          }} />
        </div>
        <div style={{ fontSize: 11, lineHeight: 1.6, color: theme.toolbar.textMuted }}>
          <div>笔刷预览</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: theme.toolbar.text, fontVariantNumeric: 'tabular-nums' }}>
            {value} px
          </div>
          <div>参照 200 源像素窗口</div>
        </div>
      </div>
    </div>
  );
}

/** 涂抹 / 局部同款左右结构：左侧画布，右侧 300px 工具列，动作吸底 */
export function BrushEditorLayout({
  stage, tools, actions, theme,
}: {
  stage: ReactNode;
  tools: ReactNode;
  actions: ReactNode;
  theme: ThemeConfig;
}): React.ReactElement {
  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 16 }}>
      <div style={{
        flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.28)', borderRadius: 12, padding: 20, overflow: 'hidden',
      }}>
        {stage}
      </div>
      <div style={{
        width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14,
        background: theme.toolbar.editorSurface, borderRadius: 12, padding: 16, overflowY: 'auto',
      }}>
        {tools}
        <div style={{ marginTop: 'auto' }}>{actions}</div>
      </div>
    </div>
  );
}
