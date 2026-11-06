/**
 * scope-capsule-tabs - 资产库「公共资产 / 本项目」胶囊分段控件
 *
 * 视觉沿用顶部页签(canvas-tab-bar)胶囊分段控件：
 * 容器深色 #1a1a1a / 浅色 rgba(0,0,0,.05)、border-radius 10、padding 3、gap 2、
 * 选中块深色 rgba(255,255,255,.10)（浅色 #fff）+ 0 1px 2px 轻投影。
 * 每段右侧带实时数量徽标（如「公共资产 12」），数量由调用方按数据实时计算传入。
 *
 * 无项目上下文（projectCount=null，主页等场外空间）时「本项目」段置灰，
 * 提示「进入项目后可用」，不产生"本项目段展示公共内容"的假页面。
 */

import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import type { AssetScope } from '@/features/asset-picker/index.js';

/** 胶囊分段键：用户两作用域 + 主体（抽屉内）+ 开源库（只读，排最后） */
export type ScopeCapsuleTab = AssetScope | 'openlib' | 'subject';

export interface ScopeCapsuleTabsProps {
  /** 当前激活段 */
  value: ScopeCapsuleTab;
  /** 切换回调（置灰段不触发） */
  onChange: (tab: ScopeCapsuleTab) => void;
  /** 公共资产实时数量（library 作用域 + 四类白名单口径） */
  libraryCount: number;
  /** 本项目实时数量；null = 无项目上下文 → 「本项目」段置灰 */
  projectCount: number | null;
  /**
   * 开源库条目总数；undefined = 未启用开源库 → 不渲染第三段（场外调用方零改动）。
   * openlib 为只读展示作用域，与公共/本项目用户数据互不混排。
   */
  openLibCount?: number | null;
  /**
   * 是否追加「主体」段（仅画布资产抽屉启用；资产库其它调用方不传 → 保持三段）。
   */
  showSubject?: boolean;
  /**
   * 主体总个数（2026-11-06 用户反馈：抽屉主体段没有总数统计，其它三段都有）。
   * null / 未传 = 尚未加载 → 不显示徽标（不假称 0）。
   */
  subjectCount?: number | null;
  theme: ThemeConfig;
}

export function ScopeCapsuleTabs({
  value,
  onChange,
  libraryCount,
  projectCount,
  openLibCount,
  showSubject,
  subjectCount,
  theme,
}: ScopeCapsuleTabsProps): React.ReactElement {
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';

  const segments: Array<{
    key: ScopeCapsuleTab;
    label: string;
    count: number | null;
    disabled: boolean;
    disabledHint?: string;
  }> = [
    { key: 'library', label: t('assetLibrary.scopeCapsuleLibrary', '全局'), count: libraryCount, disabled: false },
    {
      key: 'project',
      label: t('assetLibrary.scopeCapsuleProject', '本项目'),
      count: projectCount,
      disabled: projectCount === null,
      disabledHint: t('assetLibrary.scopeCapsuleProjectDisabled', '进入项目后可用'),
    },
  ];
  // 分段顺序（2026-11-06 用户指令：「开源库应该放 Tab 的最后」）：
  // 全局 / 本项目 / 主体 / 开源库——开源库是只读外部资源，排到末尾不与用户数据段夹在一起。
  if (showSubject) {
    segments.push({
      key: 'subject',
      label: t('assetLibrary.scopeCapsuleSubject', '主体'),
      count: subjectCount ?? null,
      disabled: false,
    });
  }
  if (openLibCount !== undefined) {
    segments.push({
      key: 'openlib',
      label: t('openLib.scopeTab', '开源库'),
      count: openLibCount,
      disabled: false,
    });
  }

  return (
    <div
      data-testid="scope-capsule-tabs"
      role="tablist"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        padding: 3,
        borderRadius: 10,
        background: isDark ? '#1a1a1a' : 'rgba(0,0,0,0.05)',
        flexShrink: 0,
      }}
    >
      {segments.map((seg) => {
        const active = value === seg.key;
        return (
          <button
            key={seg.key}
            type="button"
            role="tab"
            aria-selected={active}
            aria-disabled={seg.disabled || undefined}
            data-scope={seg.key}
            data-active={active || undefined}
            disabled={seg.disabled}
            title={seg.disabled ? seg.disabledHint : seg.label}
            onClick={() => { if (!seg.disabled) onChange(seg.key); }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              height: 26,
              padding: '0 12px',
              border: 'none',
              borderRadius: 8,
              cursor: seg.disabled ? 'not-allowed' : 'pointer',
              fontSize: 12,
              fontWeight: active ? 600 : 400,
              whiteSpace: 'nowrap',
              background: active ? (isDark ? 'rgba(255,255,255,0.10)' : '#ffffff') : 'transparent',
              boxShadow: active ? `0 1px 2px ${isDark ? 'rgba(0,0,0,0.40)' : 'rgba(0,0,0,0.12)'}` : 'none',
              color: seg.disabled
                ? theme.toolbar.textMuted
                : active ? theme.toolbar.text : theme.toolbar.textMuted,
              opacity: seg.disabled ? 0.45 : 1,
              transition: 'all 0.15s',
            }}
          >
            {seg.label}
            {seg.count !== null && (
              <span
                data-scope-count={seg.key}
                style={{
                  fontSize: 10,
                  lineHeight: '14px',
                  padding: '0 5px',
                  borderRadius: 999,
                  fontVariantNumeric: 'tabular-nums',
                  background: active
                    ? (isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)')
                    : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
                  color: active ? theme.toolbar.text : theme.toolbar.textMuted,
                }}
              >
                {seg.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
