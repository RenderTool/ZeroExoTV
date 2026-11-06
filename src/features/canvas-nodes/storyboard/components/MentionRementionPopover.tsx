/**
 * MentionRementionPopover - 只读 mention chip 的「改引」弹层（Plan#71 Spec §5.2 / T4）
 *
 * 只读态描述里的 `@老张-受伤` 渲染为 chip，点击弹本层：
 * - 列出可改引目标：基础形态（@老张，= 无状态后缀）+ 当前主体全部状态 chips；
 * - 状态已被删 → 顶栏 amber/红提示原因，但仍可从现存状态/基础形态中重新指定（修复路径）；
 * - 主体已被删（source 缺失）→ 红提示「主体已删除」，仅提供「移除该引用」。
 * 形态：fixed 定位 + 遮罩点击关闭，zIndex 用 Z_INDEX.DROPDOWN。
 */
import { memo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, RefreshCcw, AlertTriangle } from 'lucide-react';
import type { ThemeConfig } from '@zeroexo/shared';
import { Z_INDEX } from '@/shared/constants/z-index.js';
import { ENTITY_KIND_META, type SubjectMatchSource } from '../storyboard-utils';

export interface RementionTarget {
  /** 目标主体 id（rootId/entityId；undefined=移除） */
  id?: string;
  /** 目标主体名 */
  name: string;
  /** 目标状态名；undefined = 基础形态（@主体） */
  state?: string;
}

export interface MentionRementionPopoverProps {
  /** chip 点击处的锚点（视口坐标） */
  rect: { top: number; left: number; width: number };
  /** 当前 chip 对应主体（可能已删除 → undefined） */
  source?: SubjectMatchSource;
  /** 当前引用的主体名（@词解析出的 name，用于展示/移除） */
  name: string;
  /** 当前引用的状态名（@老张-受伤 → '受伤'；无状态 = 基础形态） */
  state?: string;
  /** 失效原因（主体/状态已删 → 显示 amber/红顶栏）；undefined = 正常 */
  staleReason?: string;
  theme: ThemeConfig;
  onPick: (target: RementionTarget) => void;
  onClose: () => void;
}

export const MentionRementionPopover = memo(function MentionRementionPopover({
  rect,
  source,
  name,
  state,
  staleReason,
  theme,
  onPick,
  onClose,
}: MentionRementionPopoverProps) {
  const isDark = theme.mode === 'dark';
  const surface = isDark ? '#1e1e1e' : '#ffffff';
  const surface2 = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  const text = theme.toolbar.text;
  const muted = theme.toolbar.textMuted;
  const border = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)';
  const meta = source ? ENTITY_KIND_META[source.kind] : undefined;

  // 点击外部 / Esc 关闭
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const chipBase = (deleted: boolean): React.CSSProperties => ({
    fontSize: 11,
    padding: '3px 10px',
    borderRadius: 999,
    border: `1px solid ${deleted ? 'rgba(239,68,68,0.35)' : border}`,
    background: deleted ? 'rgba(239,68,68,0.08)' : surface2,
    color: deleted ? '#f87171' : (meta?.color ?? text),
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontFamily: 'inherit',
  });

  return createPortal(
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: Z_INDEX.FULLSCREEN_DROPDOWN_MASK }} onClick={onClose} />
      <div
        ref={ref}
        style={{
          position: 'fixed',
          top: rect.top + 4,
          left: rect.left,
          minWidth: Math.max(rect.width, 220),
          zIndex: Z_INDEX.FULLSCREEN_DROPDOWN,
          background: surface,
          border: `1px solid ${border}`,
          borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
          padding: 6,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {/* 头部：当前引用 + 关闭 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 4px' }}>
          <span style={{ fontSize: 11, color: staleReason ? '#f59e0b' : muted, fontWeight: 600 }}>
            {staleReason ? <AlertTriangle size={11} style={{ verticalAlign: -1, marginRight: 4 }} /> : <RefreshCcw size={11} style={{ verticalAlign: -1, marginRight: 4 }} />}
            {staleReason ?? '改引'}
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', color: muted, cursor: 'pointer', padding: 2, display: 'inline-flex' }}>
            <X size={11} />
          </button>
        </div>

        {/* 当前 chip 展示 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 4px' }}>
          <span style={{ fontSize: 12, color: text, fontWeight: 600 }}>@ {name}</span>
          {state && (
            <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 999, background: meta?.color ? `${meta.color}22` : surface2, color: meta?.color ?? muted }}>
              {state}
            </span>
          )}
          {staleReason && (
            <span style={{ marginLeft: 'auto', fontSize: 10, color: muted, fontStyle: 'italic' }}>
              当前引用已失效
            </span>
          )}
        </div>

        {/* 可改引目标 */}
        {source ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '2px 4px', maxWidth: 320 }}>
            <button
              type="button"
              style={{ ...chipBase(false), fontWeight: state ? 400 : 700 }}
              onClick={() => onPick({ id: source.id, name: source.name })}
              title="改引为基础形态（@主体，无状态后缀）"
            >
              基础形态
            </button>
            {(source.states ?? []).map((s) => (
              <button
                key={s.id}
                type="button"
                style={{ ...chipBase(s.name === state && staleReason ? true : false), fontWeight: s.name === state ? 700 : 400 }}
                onClick={() => onPick({ id: source.id, name: source.name, state: s.name })}
                title={s.name === state ? '当前状态' : `改引为 @${source.name}-${s.name}`}
              >
                {s.name}
                {s.name === state && ' ✓'}
              </button>
            ))}
          </div>
        ) : (
          <div style={{ padding: '2px 4px', fontSize: 11, color: '#f87171' }}>
            主体「{name}」已被删除，无法改引到其状态。
          </div>
        )}

        {/* 移除该引用（主体删 / 状态删均可移除） */}
        <button
          type="button"
          onClick={() => onPick({ name })}
          style={{
            marginTop: 4,
            fontSize: 11,
            color: '#f87171',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
            padding: '2px 4px',
            fontFamily: 'inherit',
          }}
          title="从描述中移除该 @引用（保留其余文本）"
        >
          移除该引用
        </button>
      </div>
    </>,
    document.body,
  );
});
