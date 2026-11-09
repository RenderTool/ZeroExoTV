/**
 * PromptCard - 通用提示词卡片组件
 *
 * 统一公共提示词和资产库提示词的卡片展示。
 * 接收 theme: ThemeConfig prop(不依赖 useTheme,保持纯展示)。
 *
 * 模式:
 * - 'public': 公共提示词模式,仅显示同款按钮+许可证信息
 * - 'asset': 资产库模式,显示收藏星标+删除按钮
 */

import { useEffect, useState, type CSSProperties } from 'react';
import { Globe, Trash2, Copy } from 'lucide-react';
import type { ThemeConfig } from '@zeroexo/shared';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/features/auth/auth-store.js';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import { AuthorizedImage } from '@/shared/components/authorized-media.js';
import { Tooltip, App as AntdApp } from 'antd';

// ===== 常量 =====

const CARD_ANIMATION_DURATION = 450;
const EASE_ZEROEXO = 'cubic-bezier(0.16, 1, 0.3, 1)';
const ANIMATION_BASE_DELAY = 40;
const ANIMATION_MAX_DELAY = 400;

/**
 * 卡片非封面部分的固定高度契约（瀑布流绝对定位布局依赖此值预测卡片总高）。
 * 显式锁死高度而不依赖字体行高，保证跨平台/跨字体下计算值与渲染值一致，不产生累积误差。
 */
export const PROMPT_CARD_BODY_HEIGHT = 40;
/** 许可证行高度（仅 mode='public' 且存在 license/sourceUrl 时渲染） */
export const PROMPT_CARD_LICENSE_HEIGHT = 24;

// ===== 类型 =====

export interface PromptCardProps {
  title: string;
  category: string;
  categoryLabel?: string;
  tags: string[];
  imageKeys: string[];
  /** 直接封面 URL（提示词预设用；data:/http 均可） */
  coverUrl?: string;
  animationDelay?: number;
  borderRadius?: number;
  thumbnailAspectRatio?: string;
  disableHoverScale?: boolean;
  mode: 'public' | 'asset';

  /** 公共模式许可证信息 */
  license?: string;
  /** 公共模式来源链接 */
  sourceUrl?: string;

  onClone?: () => void;
  onDelete?: () => void;
  onClick?: () => void;
  theme: ThemeConfig;
}

// ===== 样式工厂函数 =====

function cardStyle(theme: ThemeConfig, hovered: boolean, borderRadius: number = 14, disableHoverScale: boolean = false): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    borderRadius,
    overflow: 'hidden',
    background: isDark ? 'rgba(255,255,255,0.04)' : '#f5f2ec',
    border: `1px solid ${
      isDark
        ? hovered ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)'
        : hovered ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.06)'
    }`,
    cursor: 'pointer',
    transition: `all ${CARD_ANIMATION_DURATION}ms ${EASE_ZEROEXO}`,
    transform: !disableHoverScale && hovered ? 'translateY(-4px) scale(1.02)' : 'none',
    boxShadow: !disableHoverScale && hovered ? '0 12px 32px rgba(0,0,0,0.15)' : 'none',
  };
}

function thumbnailStyle(aspectRatio?: string): CSSProperties {
  return {
    position: 'relative',
    width: '100%',
    aspectRatio: aspectRatio ?? '16 / 9',
    overflow: 'hidden',
  };
}

function imgStyle(): CSSProperties {
  return {
    display: 'block',
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  };
}

/**
 * 图片骨架层：AuthorizedImage 走 fetch + Authorization → blob，blob 就绪前封面区一片空白，
 * 图片到手后整张「突变」出现。骨架层铺满封面区做 shimmer 占位（高度已由真实宽高比撑好），
 * 图片到达后淡入覆盖 → 布局不跳、观感不突变。
 */
function imgSkeletonStyle(theme: ThemeConfig): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    position: 'absolute',
    inset: 0,
    background: `linear-gradient(
      90deg,
      ${isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)'} 0%,
      ${isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)'} 50%,
      ${isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)'} 100%
    )`,
    backgroundSize: '200% 100%',
    animation: 'zeroexo-shimmer 1.5s infinite',
  };
}

function placeholderStyle(theme: ThemeConfig): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
    color: theme.toolbar.textMuted,
  };
}

function badgeStyle(theme: ThemeConfig): CSSProperties {
  return {
    position: 'absolute',
    top: 8,
    left: 8,
    fontSize: 10,
    fontWeight: 500,
    padding: '2px 8px',
    borderRadius: 6,
    background: theme.toolbar.accent,
    color: '#fff',
    lineHeight: '18px',
    border: 'none',
    pointerEvents: 'none',
  };
}

function overlayStyle(): CSSProperties {
  return {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: '32px 10px 8px',
    background: 'linear-gradient(transparent, rgba(0,0,0,0.65))',
    pointerEvents: 'none',
  };
}

function titleStyle(): CSSProperties {
  return {
    fontSize: 13,
    fontWeight: 600,
    color: '#fff',
    lineHeight: 1.3,
    textShadow: '0 1px 2px rgba(0,0,0,0.3)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
}

function cardBodyStyle(): CSSProperties {
  return {
    padding: 12,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    height: PROMPT_CARD_BODY_HEIGHT,
    boxSizing: 'border-box',
  };
}

function cardMetaStyle(theme: ThemeConfig): CSSProperties {
  return {
    fontSize: 11,
    color: theme.toolbar.textMuted,
    fontWeight: 500,
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
}

function actionsContainerStyle(): CSSProperties {
  return {
    position: 'absolute',
    top: 8,
    right: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  };
}

function actionBtnStyle(): CSSProperties {
  return {
    width: 28,
    height: 28,
    padding: 0,
    border: 'none',
    borderRadius: 6,
    background: 'rgba(0,0,0,0.45)',
    color: '#fff',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: `all 150ms ${EASE_ZEROEXO}`,
  };
}

function licenseSectionStyle(): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '0 12px',
    height: PROMPT_CARD_LICENSE_HEIGHT,
    boxSizing: 'border-box',
  };
}

function licenseTagStyle(theme: ThemeConfig): CSSProperties {
  const isDark = theme.mode === 'dark';
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    fontSize: 10,
    fontWeight: 700,
    padding: '2px 10px',
    borderRadius: 12,
    background: 'transparent',
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.18)'}`,
    color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)',
    letterSpacing: '0.3px',
  };
}

function sourceLinkStyle(theme: ThemeConfig): CSSProperties {
  return {
    fontSize: 10,
    color: theme.toolbar.textMuted,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: 160,
    opacity: 0.7,
  };
}

// ===== 组件 =====

export function PromptCard({
  title,
  category,
  categoryLabel,
  tags,
  imageKeys,
  coverUrl: coverUrlProp,
  animationDelay = 0,
  borderRadius = 14,
  thumbnailAspectRatio,
  disableHoverScale = false,
  mode,
  license,
  sourceUrl,
  onClone,
  onDelete,
  onClick,
  theme,
}: PromptCardProps): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  const [coverError, setCoverError] = useState(false);
  // 封面图是否已加载完成（blob 就绪 + 解码）：未完成前显示骨架，完成后淡入
  const [imgLoaded, setImgLoaded] = useState(false);
  const { isAuthenticated } = useAuth();
  const { t } = useTranslation();
  const { message: antdMessage } = AntdApp.useApp();

  const coverSrc = coverUrlProp ?? (imageKeys.length > 0 && !coverError
    ? getResourceUrl(imageKeys[0], 'preview')
    : undefined);

  // 封面 URL 变化（列表复用同一组件实例）时重置骨架态，避免新图直接突变
  useEffect(() => { setImgLoaded(false); }, [coverSrc]);

  const animationDelayValue = Math.min(animationDelay * ANIMATION_BASE_DELAY, ANIMATION_MAX_DELAY);

  const handleCloneClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAuthenticated) {
      antdMessage?.warning?.(t('promptCard.pleaseLoginFirst'));
      if (typeof window !== 'undefined') window.location.hash = '#/auth';
      return;
    }
    onClone?.();
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.();
  };

  return (
    <div
      style={{
        ...cardStyle(theme, hovered, borderRadius, disableHoverScale),
        animation: `zeroexo-fade-up ${CARD_ANIMATION_DURATION}ms ${EASE_ZEROEXO} ${animationDelayValue}ms both`,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      {/* 缩略图区 */}
      <div style={thumbnailStyle(thumbnailAspectRatio)}>
        {coverSrc ? (
          <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
            {/* 骨架占位：图片未加载完成前持续 shimmer */}
            {!imgLoaded && <div style={imgSkeletonStyle(theme)} />}
            <AuthorizedImage
              src={coverSrc}
              alt={title}
              style={{
                ...imgStyle(),
                opacity: imgLoaded ? 1 : 0,
                transition: `opacity 320ms ease, transform ${CARD_ANIMATION_DURATION}ms ${EASE_ZEROEXO}`,
                transform: hovered ? 'scale(1.08)' : 'scale(1)',
              }}
              loading="lazy"
              decoding="async"
              onLoad={() => setImgLoaded(true)}
              onError={() => setCoverError(true)}
            />
          </div>
        ) : (
          <div style={placeholderStyle(theme)}>
            {coverError ? (
              <span style={{ fontSize: 11, opacity: 0.5 }}>{t('promptCard.resourceExpired')}</span>
            ) : (
              <Globe size={24} opacity={0.3} />
            )}
          </div>
        )}

        {/* 分类标签 */}
        {category !== 'other' && (
          <span style={badgeStyle(theme)}>{categoryLabel ?? category}</span>
        )}

        {/* 标题渐变覆盖 */}
        <div style={overlayStyle()}>
          <div style={titleStyle()} title={title}>{title}</div>
        </div>

        {/* 右上角操作按钮 */}
        <div style={actionsContainerStyle()}>
          {mode === 'public' ? (
            /* 公共模式：显示同款（收藏副本）按钮（hover 时可见，未登录也显示并引导登录） */
            hovered && onClone && (
              <button
                type="button"
                title={
                  isAuthenticated
                    ? t('promptCard.generateSimilar')
                    : t('promptCard.pleaseLoginFirst')
                }
                style={{
                  ...actionBtnStyle(),
                  opacity: !isAuthenticated ? 0.4 : 1,
                  cursor: !isAuthenticated ? 'not-allowed' : 'pointer',
                }}
                onClick={handleCloneClick}
                onMouseEnter={(e) => {
                  if (isAuthenticated) e.currentTarget.style.background = theme.toolbar.accent;
                }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.45)'; }}
              >
                <Copy size={13} />
              </button>
            )
          ) : (
            /* 资产库模式：显示删除按钮 */
            <>
              {hovered && onDelete && (
                <Tooltip title={t('promptCard.delete')}>
                  <button
                    type="button"
                    style={actionBtnStyle()}
                    onClick={handleDeleteClick}
                    onMouseEnter={(e) => { e.currentTarget.style.background = theme.toolbar.danger; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.45)'; }}
                  >
                    <Trash2 size={13} />
                  </button>
                </Tooltip>
              )}
            </>
          )}
        </div>
      </div>

      {/* 底部元信息 */}
      <div style={cardBodyStyle()}>
        <span style={cardMetaStyle(theme)}>
          {tags.length > 0
            ? tags.slice(0, 4).join(', ') + (tags.length > 4 ? ` +${tags.length - 4}` : '')
            : (categoryLabel ?? category)}
        </span>
      </div>

      {/* 许可证 + 来源链接（仅公共模式） */}
      {mode === 'public' && (license || sourceUrl) && (
        <div style={licenseSectionStyle()}>
          {license && (
            <span style={licenseTagStyle(theme)}>
              {license}
            </span>
          )}
          {sourceUrl && (
            <span style={sourceLinkStyle(theme)}>
              {t('promptCard.licenseText', { license: license || t('promptCard.licenseFallback') })} ·
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{
                  color: theme.toolbar.textMuted,
                  textDecoration: 'none',
                  transition: 'color 0.15s',
                  marginLeft: 3,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = theme.toolbar.accent; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = theme.toolbar.textMuted; }}
              >
                {t('promptCard.source')}
              </a>
            </span>
          )}
        </div>
      )}
    </div>
  );
}