/**
 * reference-slot-bar — 参考素材插槽的唯一视觉框架（2026-11-13 用户指令）
 *
 * 导演台 / 画布 / 主体状态页统一用这一排：48px 虚线加号 + 48px 缩略图（绿勾/红叉兼容徽标 + 右上角移除）。
 * 差异只在数据：画布多传 compatible / stale（模型支持情况），主体只传一张参考图。
 * 禁止各页面再自造一套「添加参考素材」大按钮或另一套槽位样式。
 */
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { AlertTriangle, Check, FileText, Film, Image as ImageIcon, Music, Upload, X } from 'lucide-react';
import type { ThemeConfig } from '@zeroexo/shared';
import { ThumbImage } from '@/features/canvas-tabs/thumb-image.js';

export interface ReferenceSlotItem {
  id: string;
  title?: string;
  /** 直连地址（画布节点 content / 开源库） */
  url?: string;
  /** CAS / 本地媒体键（优先走统一解析链） */
  storageKey?: string;
  /** 预览类型（缺省 image） */
  kind?: 'image' | 'video' | 'audio' | 'text';
  /** 模型兼容性：true=绿勾，false=红叉；缺省不显示 */
  compatible?: boolean;
  /** 引用失效（边框/角标变红/橙） */
  stale?: { level: 'warn' | 'broken'; reason: string } | null;
  /** 失效替换动作（hover 出现小刷新按钮） */
  onReplace?: () => void;
}

export interface ReferenceSlotBarProps {
  items: ReferenceSlotItem[];
  theme: ThemeConfig;
  onAdd?: (anchor: HTMLElement) => void;
  addTitle?: string;
  onRemove?: (id: string) => void;
  /** 空槽时的说明文字（与旧稿同款 11px muted） */
  hint?: ReactNode;
}

const SLOT = 48;
const NAV_BORDER = (dark: boolean): string => (dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)');
const HOVER_BG = (dark: boolean): string => (dark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.04)');

function SlotIcon({ kind, size, style }: { kind?: ReferenceSlotItem['kind']; size: number; style?: CSSProperties }): ReactElement {
  const Icon = kind === 'video' ? Film : kind === 'audio' ? Music : kind === 'text' ? FileText : ImageIcon;
  return <Icon size={size} style={style} />;
}

export function ReferenceSlotBar({
  items, theme, onAdd, addTitle, onRemove, hint,
}: ReferenceSlotBarProps): ReactElement {
  const isDark = theme.mode === 'dark';
  const border = NAV_BORDER(isDark);
  const hoverBg = HOVER_BG(isDark);
  return (
    <div data-ref-slot-bar style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {onAdd && (
        <button
          type="button"
          data-ref-add
          title={addTitle}
          aria-label={addTitle}
          onClick={(e) => onAdd(e.currentTarget)}
          style={{
            width: SLOT, height: SLOT, borderRadius: 14, border: `1px dashed ${border}`,
            background: 'transparent', color: theme.toolbar.textMuted ?? '', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, fontFamily: 'inherit', transition: 'background 0.12s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = hoverBg; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <Upload size={15} />
        </button>
      )}
      {items.map((item) => {
        const stale = item.stale;
        const staleColor = stale?.level === 'broken' ? (theme.toolbar.danger ?? '#ef4444') : '#f59e0b';
        const borderColor = stale ? staleColor : border;
        return (
          <div
            key={item.id}
            data-ref-slot={item.id}
            title={stale ? `${item.title ?? ''}（失效：${stale.reason}）` : item.title}
            style={{
              position: 'relative', width: SLOT, height: SLOT, borderRadius: 14, overflow: 'hidden',
              flexShrink: 0, border: `1px solid ${borderColor}`, background: 'transparent',
            }}
          >
            {item.url || item.storageKey ? (
              <ThumbImage
                kind={item.kind === 'video' ? 'video' : item.kind === 'audio' ? 'audio' : 'image'}
                storageKey={item.storageKey}
                url={item.url}
                prefer="preview"
                width={SLOT}
                height={SLOT}
                radius={0}
                title={item.title}
                icon={<SlotIcon kind={item.kind} size={14} style={{ opacity: 0.6 }} />}
              />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'inline-flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, padding: 4, background: hoverBg }}>
                <SlotIcon kind={item.kind} size={14} style={{ opacity: 0.7 }} />
                {item.title && (
                  <span style={{ fontSize: 9, color: theme.toolbar.text, maxWidth: 40, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.1 }}>
                    {item.title}
                  </span>
                )}
              </div>
            )}
            {stale ? (
              <span style={{ position: 'absolute', top: 2, left: 2, width: 12, height: 12, borderRadius: '50%', background: staleColor, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
                <AlertTriangle size={7} color="#fff" strokeWidth={3} />
              </span>
            ) : item.compatible !== undefined ? (
              <span
                data-ref-compatible={item.compatible ? '1' : '0'}
                style={{
                  position: 'absolute', top: 2, left: 2, width: 12, height: 12, borderRadius: '50%',
                  background: item.compatible ? '#a4fd01' : (theme.toolbar.danger ?? '#ef4444'),
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', zIndex: 2,
                }}
              >
                {item.compatible ? <Check size={7} color="#fff" strokeWidth={3} /> : <X size={7} color="#fff" strokeWidth={3} />}
              </span>
            ) : null}
            {onRemove && (
              <button
                type="button"
                data-ref-remove
                aria-label="移除参考素材"
                onClick={() => onRemove(item.id)}
                style={{
                  position: 'absolute', top: 2, right: 2, width: 16, height: 16, borderRadius: '50%',
                  border: 'none', background: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.08)',
                  color: theme.toolbar.textMuted ?? '', cursor: 'pointer', display: 'inline-flex',
                  alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1, zIndex: 2,
                }}
              >
                <X size={10} />
              </button>
            )}
            {stale && item.onReplace && (
              <button
                type="button"
                data-ref-replace
                aria-label="替换失效引用"
                onClick={item.onReplace}
                style={{
                  position: 'absolute', right: 2, bottom: 2, width: 16, height: 16, borderRadius: 6,
                  border: 'none', background: staleColor, color: '#fff', cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, zIndex: 2,
                }}
              >
                <AlertTriangle size={9} />
              </button>
            )}
          </div>
        );
      })}
      {items.length === 0 && hint && (
        <span style={{ fontSize: 11, color: theme.toolbar.textMuted ?? '', flexShrink: 0 }}>{hint}</span>
      )}
    </div>
  );
}
