/**
 * canvas-assets/groups/HierarchyGroup - 抽屉「层级」分组（2026-11-06 挂载时机下放）
 *
 * 此前层级树的数据 hook（useHierarchyPanelProps）挂在抽屉壳层，抽屉一打开就订阅整张图、
 * 构建整棵层级树——即使用户正停在剧本/导演台模块。现改为：
 * **分组被真正激活时才挂载**（画布模块 + 层级页签），切走即卸载（搜索/树订阅一起停）。
 */

import type { ThemeConfig } from '@zeroexo/shared';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import { useHierarchyPanelProps } from '@zeroexo/plugin-group';
import type { GroupPlugin } from '@zeroexo/plugin-group';
import { useTranslation } from 'react-i18next';
import { HierarchyListView } from '@/features/hierarchy/components/hierarchy-list-view.js';
import { SearchBox, ToolbarRow } from '../components/common.js';

export interface HierarchyGroupProps {
  theme: ThemeConfig;
  store: ReactGraphStore;
  groupPlugin: GroupPlugin;
  /** 搜索词（抽屉 store 持有，与素材分组同一字段） */
  search: string;
  onSearchChange: (value: string) => void;
  /** 点击节点时聚焦画布 */
  onFocusNode?: (nodeId: string) => void;
}

export function HierarchyGroup({
  theme, store, groupPlugin, search, onSearchChange, onFocusNode,
}: HierarchyGroupProps): React.ReactElement {
  const { t } = useTranslation();
  // 树数据 hook 随本组件挂载/卸载——画布模块外不再有层级树订阅
  const data = useHierarchyPanelProps(store, groupPlugin.getController());

  return (
    <>
      {/* 搜索统一在标签下方 */}
      <ToolbarRow>
        <SearchBox value={search} onChange={onSearchChange} placeholder={t('assetLibrary.searchPlaceholder')} theme={theme} />
      </ToolbarRow>
      <HierarchyListView
        theme={theme}
        store={store}
        data={data}
        onFocusNode={onFocusNode}
        search={search}
        multiSelectEnabled={false}
        onMultiSelectToggle={() => undefined}
        typeFilter="all"
        onTypeFilterChange={() => undefined}
      />
    </>
  );
}
