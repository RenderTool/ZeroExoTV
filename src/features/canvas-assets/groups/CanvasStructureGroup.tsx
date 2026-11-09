/**
 * CanvasStructureGroup - 抽屉「画布」分组
 *
 * 用户定稿：层级与子画布不再各占一个侧栏按钮，合并为一个「画布」入口，
 * 组内用同一套胶囊 Tab 切换「层级 / 子画布」。
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import type { GroupPlugin } from '@zeroexo/plugin-group';
import { CapsuleTabs } from '@/features/asset-library/components/capsule-tabs.js';
import type { CanvasAssetsPanelStore } from '../store.js';
import { HierarchyGroup } from './HierarchyGroup.js';
import { CanvasCopiesGroup } from './CanvasCopiesGroup.js';

export interface CanvasStructureGroupProps {
  store: CanvasAssetsPanelStore;
  theme: ThemeConfig;
  hierarchy?: {
    store: ReactGraphStore;
    groupPlugin: GroupPlugin;
    onFocusNode?: (nodeId: string) => void;
  };
}

export function CanvasStructureGroup({ store, theme, hierarchy }: CanvasStructureGroupProps): React.ReactElement {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'hierarchy' | 'canvases'>('hierarchy');
  const effectiveTab = hierarchy ? tab : 'canvases';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {hierarchy ? (
        <div style={{ padding: '8px 20px 0', flexShrink: 0 }}>
          <CapsuleTabs
            value={effectiveTab}
            onChange={(key) => setTab(key as 'hierarchy' | 'canvases')}
            segments={[
              { key: 'hierarchy', label: t('canvasCopy.structureTab', '画布结构') },
              { key: 'canvases', label: t('canvasCopy.subCanvasTab', '子画布') },
            ]}
            theme={theme}
            testId="canvas-structure-tabs"
          />
        </div>
      ) : null}
      {effectiveTab === 'hierarchy' && hierarchy ? (
        <HierarchyGroup
          theme={theme}
          store={hierarchy.store}
          groupPlugin={hierarchy.groupPlugin}
          search={store.search}
          onSearchChange={store.setSearch}
          onFocusNode={hierarchy.onFocusNode}
        />
      ) : (
        <CanvasCopiesGroup store={store} theme={theme} />
      )}
    </div>
  );
}
