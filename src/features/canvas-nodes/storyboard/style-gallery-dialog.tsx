/**
 * StyleGalleryDialog — 全剧风格画廊（2026-11-13）
 *
 * 用户要求：把 uisdc「23 套电影美学提示词 + 配图」做成可视化面板，而不是四个抽象下拉。
 * - 分类：全部 / 导演 / 主流 / 动画；搜索；收藏（localStorage）
 * - 卡片：缩略图 + 名称 + 收藏星标；选中 accent 描边
 * - 底部「使用此风格」：由调用方写入全剧风格（meta.visualStyle），主体提示词继承
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Modal } from 'antd';
import { Camera, Check, Clapperboard, ExternalLink, Lightbulb, Search, Star, Timer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import {
  STYLE_CATEGORY_LABELS, STYLE_PRESETS, stylePresetImageUrl,
  type StylePreset, type StylePresetCategory,
} from '@/shared/style-presets.js';
import { styleCraftFor } from '@/shared/style-craft.js';

const FAVORITES_KEY = 'zeroexo:style-favorites';

function readFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

export interface StyleGalleryDialogProps {
  open: boolean;
  onClose: () => void;
  /** 当前已选风格 id（高亮） */
  selectedId?: string | null;
  onSelect: (preset: StylePreset) => void;
  theme: ThemeConfig;
}

/** 风格详情：技法 / 运镜（带秒数）/ 叙事剪辑 / 依据来源（用户要求「点开看，不能瞎给」） */
function StyleCraftDetail({
  open, preset, theme, onBack, onApply,
}: {
  open: boolean;
  preset: StylePreset | null;
  theme: ThemeConfig;
  onBack: () => void;
  onApply: (preset: StylePreset) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const text = theme.toolbar.text;
  const muted = theme.toolbar.textMuted;
  const accent = theme.toolbar.accent;
  const isDark = theme.mode === 'dark';
  const craft = preset ? styleCraftFor(preset.id) : null;

  const section = (
    icon: React.ReactNode, title: string, items: string[],
  ): React.ReactNode => (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: text }}>
        {icon}{title}
      </div>
      <ol style={{ margin: '8px 0 0', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((line, i) => (
          <li key={i} style={{ fontSize: 12, lineHeight: 1.7, color: muted }}>{line}</li>
        ))}
      </ol>
    </div>
  );

  return (
    <Modal
      open={open}
      onCancel={onBack}
      footer={null}
      centered
      width={760}
      zIndex={1200}
      title={null}
      closeIcon={null}
      styles={{ body: { padding: 0 } }}
      destroyOnHidden
    >
      <div data-style-detail={preset?.id} style={{ background: isDark ? '#17171a' : '#fff', borderRadius: 12, maxHeight: '80vh', overflowY: 'auto' }}>
        {preset && (
          <div style={{ padding: '16px 20px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: text }}>{preset.nameZh}</div>
                <div style={{ fontSize: 11, color: muted, marginTop: 2 }}>
                  {[preset.nameEn, STYLE_CATEGORY_LABELS[preset.category]].filter(Boolean).join(' · ')}
                </div>
              </div>
              <Button size="small" onClick={onBack}>{t('styleGallery.back', '返回列表')}</Button>
            </div>
            <div style={{ fontSize: 12, color: muted, marginTop: 10, lineHeight: 1.7 }}>{preset.intro}</div>

            {craft ? (
              <>
                <div style={{
                  marginTop: 14, padding: '10px 12px', borderRadius: 8,
                  border: `1px solid ${accent}55`, background: `${accent}12`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: accent }}>
                    <Timer size={13} />{t('styleGallery.craft.beat', '镜头时长与节奏（分镜直接照此设时长）')}
                  </div>
                  <div style={{ fontSize: 12, color: text, marginTop: 6, lineHeight: 1.7 }}>{craft.asl}</div>
                </div>

                {section(<Lightbulb size={13} />, t('styleGallery.craft.techniques', '风格技法'), craft.techniques)}
                {section(<Camera size={13} />, t('styleGallery.craft.camera', '运镜要领'), craft.camera)}
                {section(<Clapperboard size={13} />, t('styleGallery.craft.narrative', '叙事与剪辑'), craft.narrative)}

                {craft.sources.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: muted }}>{t('styleGallery.craft.sources', '依据来源')}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                      {craft.sources.map((src) => (
                        <a
                          key={src.url}
                          href={src.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: accent, textDecoration: 'none' }}
                        >
                          <ExternalLink size={10} />{src.label}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div style={{ marginTop: 16, fontSize: 12, color: muted }}>
                {t('styleGallery.craft.missing', '这套风格暂无技法条目（不会拿假数据填），可先按提示词描述使用。')}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <Button size="small" onClick={onBack}>{t('styleGallery.back', '返回列表')}</Button>
              <Button size="small" type="primary" data-style-detail-apply onClick={() => onApply(preset)}>
                {t('styleGallery.apply', '使用此风格')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function StyleGalleryDialog({ open, onClose, selectedId, onSelect, theme }: StyleGalleryDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const [category, setCategory] = useState<'all' | StylePresetCategory>('all');
  const [query, setQuery] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set(readFavorites()));
  const [pendingId, setPendingId] = useState<string | null>(selectedId ?? null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const text = theme.toolbar.text;
  const muted = theme.toolbar.textMuted;
  const accent = theme.toolbar.accent;
  const isDark = theme.mode === 'dark';

  useEffect(() => { if (open) setPendingId(selectedId ?? null); }, [open, selectedId]);
  useEffect(() => { if (!open) setDetailId(null); }, [open]);
  useEffect(() => {
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites])); } catch { /* 忽略 */ }
  }, [favorites]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return STYLE_PRESETS.filter((s) => (category === 'all' || s.category === category)
      && (!favoritesOnly || favorites.has(s.id))
      && (!q || s.name.toLowerCase().includes(q) || s.nameZh.includes(q) || s.promptZh.toLowerCase().includes(q)));
  }, [category, query, favoritesOnly, favorites]);

  const pending = STYLE_PRESETS.find((s) => s.id === pendingId) ?? null;
  const toggleFavorite = (id: string): void => setFavorites((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const detailPreset = STYLE_PRESETS.find((s) => s.id === detailId) ?? null;

  return (
    <>
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      centered
      width={1000}
      title={null}
      closeIcon={null}
      styles={{ body: { padding: 0 } }}
      destroyOnHidden
    >
      <div data-style-gallery style={{ display: 'flex', flexDirection: 'column', maxHeight: '78vh', background: isDark ? '#141417' : '#fff', borderRadius: 12 }}>
        {/* 头部 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px 8px' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: text }}>{t('styleGallery.title', '全剧风格')}</span>
          <div style={{ flex: 1 }} />
          <Input
            allowClear
            prefix={<Search size={13} color={muted} />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('styleGallery.search', '搜索风格')}
            style={{ width: 220 }}
          />
          <Button size="small" onClick={onClose}>{t('common.close', '关闭')}</Button>
        </div>

        {/* 分类 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 20px 10px', flexWrap: 'wrap' }}>
          {(['all', 'director', 'mainstream', 'animation', 'genre', 'combo'] as const).map((key) => {
            const active = category === key && !favoritesOnly;
            return (
              <button
                key={key}
                type="button"
                data-style-category={key}
                onClick={() => { setFavoritesOnly(false); setCategory(key); }}
                style={{
                  height: 26, padding: '0 12px', borderRadius: 13, cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 12, fontWeight: active ? 600 : 400,
                  border: `1px solid ${active ? accent : 'rgba(128,128,128,0.35)'}`,
                  background: active ? `${accent}18` : 'transparent',
                  color: active ? accent : muted,
                }}
              >
                {STYLE_CATEGORY_LABELS[key]}
              </button>
            );
          })}
          <button
            type="button"
            data-style-favorites
            onClick={() => setFavoritesOnly((v) => !v)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, height: 26, padding: '0 12px',
              borderRadius: 13, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
              border: `1px solid ${favoritesOnly ? accent : 'rgba(128,128,128,0.35)'}`,
              background: favoritesOnly ? `${accent}18` : 'transparent',
              color: favoritesOnly ? accent : muted,
            }}
          >
            <Star size={11} fill={favoritesOnly ? accent : 'none'} />
            {t('styleGallery.favorites', '收藏')}
          </button>
          <span style={{ fontSize: 11, color: muted }}>{list.length} 套</span>
        </div>

        {/* 卡片网格 */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 20px 12px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12 }}>
            {list.map((preset) => {
              const selected = preset.id === pendingId;
              const fav = favorites.has(preset.id);
              return (
                <button
                  key={preset.id}
                  type="button"
                  data-style-card={preset.id}
                  data-style-selected={selected ? '1' : undefined}
                  onDoubleClick={() => { onSelect(preset); onClose(); }}
                  onClick={() => { setPendingId(preset.id); setDetailId(preset.id); }}
                  style={{
                    position: 'relative', padding: 0, border: `1px solid ${selected ? accent : 'rgba(128,128,128,0.25)'}`,
                    borderRadius: 10, overflow: 'hidden', cursor: 'pointer', background: isDark ? '#1b1b1f' : '#f5f5f4',
                    outline: selected ? `2px solid ${accent}` : 'none', outlineOffset: -2, textAlign: 'left',
                  }}
                >
                  <div style={{ position: 'relative', aspectRatio: '16 / 9', background: 'linear-gradient(135deg,#222,#444)' }}>
                    {preset.image ? (
                      <img
                        src={stylePresetImageUrl(preset)}
                        alt={preset.name}
                        loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
                      />
                    ) : (
                      <div style={{
                        width: '100%', height: '100%', display: 'flex', alignItems: 'flex-end', padding: 10,
                        background: `linear-gradient(135deg, ${preset.palette?.[0] ?? '#444'}, ${preset.palette?.[1] ?? '#151515'})`,
                      }}>
                        <span style={{ fontSize: 17, fontWeight: 700, color: 'rgba(255,255,255,0.92)', textShadow: '0 1px 4px rgba(0,0,0,0.45)' }}>
                          {preset.nameZh}
                        </span>
                      </div>
                    )}
                    {selected && (
                      <span style={{ position: 'absolute', top: 6, left: 6, width: 18, height: 18, borderRadius: 9, background: accent, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Check size={12} color="#fff" />
                      </span>
                    )}
                    <span style={{
                      position: 'absolute', bottom: 6, left: 6, display: 'inline-flex', alignItems: 'center', gap: 3,
                      height: 18, padding: '0 6px', borderRadius: 9, background: 'rgba(0,0,0,0.5)',
                      fontSize: 10, color: 'rgba(255,255,255,0.9)', pointerEvents: 'none',
                    }}>
                      <Clapperboard size={10} />
                      {t('styleGallery.detailHint', '技法 · 运镜')}
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={t('styleGallery.favorite', '收藏风格')}
                      data-style-favorite={preset.id}
                      onClick={(e) => { e.stopPropagation(); toggleFavorite(preset.id); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggleFavorite(preset.id); } }}
                      style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, background: 'rgba(0,0,0,0.45)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Star size={12} color={fav ? '#f5c542' : '#fff'} fill={fav ? '#f5c542' : 'none'} />
                    </span>
                  </div>
                  <div style={{ padding: '8px 10px 10px' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {preset.nameZh}
                    </div>
                    <div style={{ fontSize: 10, color: muted, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {preset.nameEn || preset.intro}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          {list.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', fontSize: 12, color: muted }}>{t('styleGallery.empty', '没有匹配的风格')}</div>
          )}
        </div>

        {/* 底部 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', borderTop: '1px solid rgba(128,128,128,0.2)' }}>
          <span style={{ fontSize: 12, color: muted, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {pending ? `${t('styleGallery.selected', '已选')}：${pending.nameZh} · ${pending.intro}` : t('styleGallery.pick', '选一套风格，所有主体提示词都会继承')}
          </span>
          <Button size="small" onClick={onClose}>{t('common.cancel', '取消')}</Button>
          <Button
            size="small"
            type="primary"
            data-style-apply
            disabled={!pending}
            onClick={() => { if (pending) { onSelect(pending); onClose(); } }}
          >
            {t('styleGallery.apply', '使用此风格')}
          </Button>
        </div>
      </div>
    </Modal>
    <StyleCraftDetail
      open={!!detailPreset}
      preset={detailPreset}
      theme={theme}
      onBack={() => setDetailId(null)}
      onApply={(preset) => { setDetailId(null); onSelect(preset); onClose(); }}
    />
    </>
  );
}
