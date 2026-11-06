/**
 * scope-badge - 资产归属角标（资产项目化）
 *
 * 唯一徽标组件 Badge 的 neutral 语义：本项目 / 公共 只由文案区分，
 * 不再按来源使用不同底色或形状。
 *
 * 复用方：资产库网格卡片(asset-card)、资产选择器卡片(picker-card)、分镜主体资产模块(StoryboardSubjectManager)。
 */

import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { Badge } from '@/shared/ui/index.js';
import type { AssetScope } from '../index.js';

export function AssetScopeBadge({ scope, style }: { scope?: AssetScope; style?: CSSProperties }): React.ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  return (
    <Badge
      theme={theme}
      style={style}
      data-asset-scope={scope === 'project' ? 'project' : 'library'}
    >
      {scope === 'project'
        ? t('assetLibrary.scopeProject', '本项目')
        : t('assetLibrary.scopeLibrary', '公共')}
    </Badge>
  );
}
