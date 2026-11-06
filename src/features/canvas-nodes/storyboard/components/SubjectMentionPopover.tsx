/**
 * SubjectMentionPopover - 分镜表格主体 @ 引用搜索浮层（2026-08-30 征集 #110）
 *
 * UI 框架与 Agent@节点 `MentionPopover` 同款（真实搜索框 + 键盘导航 + 图标 + 点击外部关闭），
 * 但数据源为「主体库」：entities ∪ aiSubjects ∪ productionItems（角色/场景/道具）。
 * - 选择后由调用方写入 shot.entities 关联 + 描述追加 @主体
 * - 主体名高亮契约色（ENTITY_KIND_META：角色绿/场景蓝/道具紫）
 * - zIndex 用 Z_INDEX.DROPDOWN，保证浮层不被表格/父容器遮挡
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, ImageIcon, Rabbit } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';

import { getResourceUrl } from '@/shared/utils/resource-url.js';
import { Z_INDEX } from '@/shared/constants/z-index.js';
import { ENTITY_KIND_META } from '../storyboard-utils';
import type { SubjectMatchSource } from '../storyboard-utils';

export interface SubjectMentionPopoverProps {
  /** 搜索关键词（@ 后已输入的词） */
  search: string;
  /** 全部可匹配主体（collectSubjectSources 结果） */
  subjects: SubjectMatchSource[];
  /** 浮层锚定（视口坐标 fixed，portal 到 body 避免被表格 overflow 裁剪） */
  position: { top: number; left: number };
  theme: ThemeConfig;
  onSelect: (subject: SubjectMatchSource) => void;
  onClose: () => void;
}

export const SubjectMentionPopover = memo(function SubjectMentionPopover({
  search,
  subjects,
  position,
  theme,
  onSelect,
  onClose,
}: SubjectMentionPopoverProps): React.ReactElement | null {
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';
  const [query, setQuery] = useState(search);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(search); setSelectedIndex(0); }, [search]);

  // 过滤：名称/别名命中
  const filtered = useMemo(() => {
    if (!query.trim()) return subjects;
    const q = query.trim().toLowerCase();
    return subjects.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.aliases ?? []).some((a) => a.toLowerCase().includes(q)),
    );
  }, [subjects, query]);

  // 键盘导航（Arrow/Enter/Esc）
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && filtered[selectedIndex]) {
        e.preventDefault();
        onSelect(filtered[selectedIndex]);
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [filtered, selectedIndex, onSelect, onClose]);

  // 点击外部关闭
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  const surface = isDark ? '#161616' : '#ffffff';
  const surface2 = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  const text = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const border = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)';
  const shadow = isDark
    ? '0 12px 32px rgba(0,0,0,0.55)'
    : '0 12px 32px rgba(28,25,23,0.18)';

  return createPortal(
    <div
      ref={listRef}
      // 2026-09-03 修复：mousedown 阻止默认行为——避免点击列表项/状态 chip 时
      // 描述 TextArea 失焦 → 编辑态卸载 → popover 消失 / click 丢失（表现为「@ 了没反应」）。
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        width: 260,
        maxHeight: 280,
        borderRadius: 12,
        background: surface,
        border: `1px solid ${border}`,
        boxShadow: shadow,
        zIndex: Z_INDEX.DROPDOWN,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* 搜索头（Agent 同款：真实输入框） */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: surface2 }}>
        <Search size={13} color={textMuted} style={{ flexShrink: 0 }} />
        <input
          type="text"
          value={query}
          readOnly
          // 2026-08-31 修复：不能 autoFocus/可输入——抢焦点会让描述 TextArea blur → 编辑态卸载 → 浮层瞬间消失
          // 过滤词跟随描述输入实时更新；用户需在描述框继续输入以筛选
          placeholder={t('subjectMention.searchPlaceholder', '搜索主体…')}
          title={t('subjectMention.continueInDesc', '在描述框中继续输入以筛选')}
          style={{
            flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none',
            fontSize: 12, color: text, fontFamily: 'inherit', cursor: 'default',
          }}
        />
      </div>

      {/* 列表 */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '20px 14px', textAlign: 'center', fontSize: 12, color: textMuted }}>
            {t('subjectMention.notFound', '未找到主体，可在「主体库」中新建')}
          </div>
        ) : (
          filtered.map((s, i) => {
            const meta = ENTITY_KIND_META[s.kind];
            // 缩略图水合（三档契约自适应档）
            const thumbSrc = s.thumbnailUrl ? getResourceUrl(s.thumbnailUrl, 'preview') ?? '' : '';
            const isPlaceholder = s.generationStatus === 'placeholder' || !s.generationStatus;
            return (
              <button
                key={s.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSelect(s)}
                onMouseEnter={() => setSelectedIndex(i)}
                style={{
                  width: '100%',
                  padding: '6px 12px',
                  background: i === selectedIndex ? surface2 : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  textAlign: 'left',
                  fontFamily: 'inherit',
                  transition: 'background 0.1s',
                }}
              >
                {/* 缩略图/占位图标 */}
                <span style={{
                  width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                  overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: isPlaceholder
                    ? (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)')
                    : `${meta.color}1A`,
                  border: isPlaceholder
                    ? `1px dashed ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}`
                    : `1px solid ${meta.color}40`,
                }}>
                  {thumbSrc ? (
                    <img src={thumbSrc} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    isPlaceholder ? <Rabbit size={14} color={isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.25)'} />
                      : <ImageIcon size={14} color={meta.color} />
                  )}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    fontSize: 12, fontWeight: 600, color: meta.color,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    {s.name}
                    {/* 生成状态标记 */}
                    {isPlaceholder && (
                      <span style={{
                        fontSize: 9, padding: '0 5px', borderRadius: 4, lineHeight: '16px',
                        background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                        color: textMuted, fontWeight: 400, flexShrink: 0,
                      }}>
                        占位
                      </span>
                    )}
                    {s.generationStatus === 'generated' && (
                      <span style={{
                        fontSize: 9, padding: '0 5px', borderRadius: 4, lineHeight: '16px',
                        background: 'rgba(34,197,94,0.14)', color: '#22c55e', fontWeight: 500, flexShrink: 0,
                      }}>
                        已生成
                      </span>
                    )}
                  </div>
                  {(s.aliases && s.aliases.length > 0) && (
                    <div style={{ fontSize: 10, color: textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.aliases.join('、')}
                    </div>
                  )}
                  {/* 状态细分 chips */}
                  {(s.states && s.states.length > 0) && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                      {s.states.map((st) => (
                        <button
                          key={st.id}
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onSelect({ ...s, state: st.name }); }}
                          style={{
                            fontSize: 9, padding: '1px 6px', borderRadius: 8,
                            background: surface2, border: `1px solid ${border}`,
                            color: meta.color, cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1.5,
                          }}
                          title="引用该状态"
                        >
                          {st.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <span style={{ fontSize: 10, color: textMuted, flexShrink: 0 }}>
                  {t(meta.labelKey)}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>,
    document.body,
  );
});
