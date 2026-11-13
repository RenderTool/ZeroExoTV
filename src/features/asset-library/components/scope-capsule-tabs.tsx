/**
 * scope-capsule-tabs - 资产库「公共资产 / 本项目」胶囊分段控件
 *
 * 视觉与交互统一由 capsule-tabs.tsx 的 CapsuleTabs 提供（2026-11-07 抽出）：
 * 抽屉「历史」按来源分 Tab 复用同一控件，两处切换体验完全一致。
 *
 * 无项目上下文（projectCount=null，主页等场外空间）时「本项目」段置灰，
 * 提示「进入项目后可用」，不产生"本项目段展示公共内容"的假页面。
 */

import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import type { AssetScope } from '@/features/asset-picker/index.js';
import { CapsuleTabs, type CapsuleSegment } from './capsule-tabs.js';

/** 胶囊分段键：用户两作用域 + 主体（抽屉内）+ 开源库（只读，排最后） */
export type ScopeCapsuleTab = AssetScope | 'subject';

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
  showSubject,
  subjectCount,
  theme,
}: ScopeCapsuleTabsProps): React.ReactElement {
  const { t } = useTranslation();

  const segments: CapsuleSegment[] = [
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

  return (
    <CapsuleTabs
      value={value}
      onChange={(key) => onChange(key as ScopeCapsuleTab)}
      segments={segments}
      theme={theme}
    />
  );
}
