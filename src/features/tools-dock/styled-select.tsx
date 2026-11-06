/**
 * StyledSelect - 轻量主题化下拉选择器（生成器同款视觉）
 *
 * 从 node-generate-dock.tsx 提取，纯 UI 组件，无业务逻辑耦合。
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Cpu } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { getModelIconComponent } from '@zeroexo/shared';

export interface StyledSelectOption {
  value: string;
  label: string;
  iconKey?: string;
}

/** 下拉入场动画 Keyframes */
const SELECT_ANIM_KEYFRAMES = `
@keyframes dockSelectInDown {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes dockSelectInUp {
  from { opacity: 0; transform: translateY(-100%) translateY(4px); }
  to { opacity: 1; transform: translateY(-100%) translateY(0); }
}
`;

export function StyledSelect({
  value,
  options,
  onChange,
  minWidth = 64,
  maxWidth = 120,
  height = 26,
  forceDropUp = false,
}: {
  value: string;
  options: StyledSelectOption[];
  onChange: (v: string) => void;
  minWidth?: number;
  maxWidth?: number;
  height?: number;
  /** 强制向上弹出(底部 dock 场景);不传时按可用空间自动翻转 */
  forceDropUp?: boolean;
}): React.ReactElement {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const [dropUp, setDropUp] = useState(false);
  const isDark = theme.mode === 'dark';
  const hoverBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        const panels = document.querySelectorAll('[data-generator-select-panel]');
        let insidePanel = false;
        panels.forEach((panel) => { if (panel.contains(e.target as Node)) insidePanel = true; });
        if (!insidePanel) setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointer, true);
    return () => document.removeEventListener('pointerdown', onPointer, true);
  }, [open]);

  const handleOpen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const estimatedH = Math.min(300, options.length * 29 + 8);
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const up = forceDropUp || (spaceBelow < estimatedH + 12 && spaceAbove > spaceBelow);
      setDropUp(up);
      setDropdownPos({ top: up ? rect.top - 4 : rect.bottom + 4, left: rect.left });
    }
    setOpen((prev) => !prev);
  }, [options.length, forceDropUp]);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <div
        style={{
          minWidth, maxWidth, height, padding: '0 6px',
          display: 'inline-flex', alignItems: 'center', gap: 3,
          border: 'none', borderRadius: 4, background: 'transparent',
          color: theme.toolbar.text, fontSize: 12,
          fontFamily: 'inherit', cursor: 'pointer',
          boxSizing: 'border-box', userSelect: 'none',
          transition: 'background 0.12s',
        }}
        onClick={handleOpen}
        onMouseEnter={(e) => { e.currentTarget.style.background = hoverBg; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        title={selected?.label}
      >
        {selected?.iconKey ? (
          <span style={{ flexShrink: 0, display: 'inline-flex' }}>
            {React.createElement(getModelIconComponent(selected.iconKey), { size: 12 })}
          </span>
        ) : null}
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {selected?.label ?? options[0]?.label ?? ''}
        </span>
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6, flexShrink: 0 }}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>
      {open && dropdownPos && createPortal(
        <>
        <style>{SELECT_ANIM_KEYFRAMES}</style>
        <div
          data-generator-select-panel="true"
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            left: dropdownPos.left,
            transform: dropUp ? 'translateY(-100%)' : undefined,
            transformOrigin: dropUp ? 'bottom center' : 'top center',
            animation: dropUp ? 'dockSelectInUp 0.16s ease-out' : 'dockSelectInDown 0.16s ease-out',
            zIndex: 9999,
            minWidth: Math.max(minWidth, 120),
            background: theme.toolbar.panel,
            border: `1px solid ${theme.toolbar.border}`,
            borderRadius: 8,
            boxShadow: '0 6px 16px 0 rgba(0,0,0,0.08), 0 3px 6px -4px rgba(0,0,0,0.12), 0 9px 28px 8px rgba(0,0,0,0.05)',
            padding: 4,
            maxHeight: 300,
            overflowY: 'auto',
          }}
        >
          {options.map((opt) => {
            const IconComponent = opt.iconKey ? getModelIconComponent(opt.iconKey) : null;
            const isSelected = opt.value === value;
            return (
              <div
                key={opt.value}
                style={{
                  padding: '5px 12px', fontSize: 12, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                  color: theme.toolbar.text,
                  background: isSelected ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)') : 'transparent',
                  whiteSpace: 'nowrap',
                  borderRadius: 4,
                  transition: 'background 0.1s',
                  maxWidth: 240,
                  overflow: 'hidden',
                }}
                onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = hoverBg; }}
                onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                onClick={(e) => { e.stopPropagation(); onChange(opt.value); setOpen(false); }}
                title={opt.label}
              >
                {IconComponent ? (
                  <span style={{ flexShrink: 0, display: 'inline-flex' }}>
                    {React.createElement(IconComponent, { size: 12 })}
                  </span>
                ) : <Cpu size={12} style={{ flexShrink: 0, opacity: 0.6 }} />}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                  {opt.label}
                </span>
              </div>
            );
          })}
        </div>
        </>,
        document.body,
      )}
    </div>
  );
}