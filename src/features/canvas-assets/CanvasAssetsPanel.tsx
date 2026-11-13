/**
 * canvas-assets/CanvasAssetsPanel - 画布资产抽屉内容（2026-08-30 约定：与主页资产库独立架构）
 *
 * 结构：容器（分组 Tab + 共享弹窗）+ 各分组组件（纯渲染）。
 * 数据来源：useCanvasAssetsPanel（数据驱动唯一来源）。
 * 展示组件：分组内复用 shared 组件；层级分组复用 HierarchyGroup（内部接 HierarchyListView）。
 *
 * 2026-11-06 用户指令（抽屉两处收敛）：
 * - sidebar 按钮顺序 = DRAWER_TAB_DEFS 顺序（资产 → 历史 → 层级 → 画布）；
 * - 层级/画布只在**画布模块**（顶部页签 = 画布/画布副本）被激活时挂载，
 *   剧本/主体库/导演台模块下按钮与内容都不出现，杜绝在这些模块误选画布层级与子画布。
 */

import { useTranslation } from 'react-i18next';
import { Layers, FileText } from 'lucide-react';
import type { ThemeConfig } from '@zeroexo/shared';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import type { GroupPlugin } from '@zeroexo/plugin-group';
import { useCanvasTabStore } from '@/features/canvas-tabs/canvas-tab-store.js';
import { useCanvasAssetsPanel } from './store.js';
import type { DrawerGroup } from './tab-defs.js';
import { SidebarNav, type GroupTabItem } from './components/common.js';
import { MaterialGroup } from './groups/MaterialGroup.js';
import { CanvasStructureGroup } from './groups/CanvasStructureGroup.js';
import { ScriptMetaGroup } from './groups/ScriptMetaGroup.js';
import { SidebarAnimatedIcon } from '@/features/app-sidebar/sidebar-animated-icon.js';
import type { SendToCanvasItem } from './store.js';

export interface CanvasAssetsPanelProps {
  theme: ThemeConfig;
  /** 层级分组视图（树数据 hook 只在该分组被激活时挂载） */
  hierarchy?: {
    store: ReactGraphStore;
    groupPlugin: GroupPlugin;
    onFocusNode?: (nodeId: string) => void;
  };
  /** 发送到画布（编辑器接线） */
  onSendToCanvas?: (item: SendToCanvasItem) => void;
}

// 抽屉分组页签定义见 ./tab-defs.js（纯数据，供结构断言/单测；2026-11-04 加回「历史」分组，本地重建版）
// tabItems 由 DRAWER_TAB_DEFS 派生——导出的页签数组即真实渲染源，测试断言即真。
export { DRAWER_TAB_DEFS } from './tab-defs.js';
import { DRAWER_TAB_DEFS, resolveDrawerModule } from './tab-defs.js';

const TAB_ICONS: Record<(typeof DRAWER_TAB_DEFS)[number]['key'], { icon: React.ReactNode; activeIcon?: React.ReactNode }> = {
  // 素材分组两态图标：激活 PackageOpen / 未激活 Package（仅视觉切换，不收起抽屉）
  material: {
    icon: <SidebarAnimatedIcon type="assets" size={18} active={false} hovered={false} mode="inline" />,
    activeIcon: <SidebarAnimatedIcon type="assets" size={18} active hovered={false} mode="inline" />,
  },
  // 画布相关合并入口：层级 / 子画布在组内 Tab 切换
  canvasStructure: { icon: <Layers size={18} /> },
  // 本剧信息（2026-11-07）：整部剧的一句话概述 + 标签，仅剧本/导演台模块挂载
  scriptMeta: { icon: <FileText size={18} /> },
};

export function CanvasAssetsPanel({ theme, hierarchy, onSendToCanvas }: CanvasAssetsPanelProps): React.ReactElement {
  const { t } = useTranslation();
  // 2026-11-06：分组随**顶部页签模块**切换——层级/画布只在画布模块可挂载（见 tab-defs）
  const activeTabKey = useCanvasTabStore((s) => s.activeTabKey);
  const store = useCanvasAssetsPanel({ onSendToCanvas, module: resolveDrawerModule(activeTabKey) });

  // 2026-11-13 用户指令：删除独立「历史」入口——画布生成进「画布」、导演台生成进「导演台」。
  // 2026-11-05 用户指令（征集 #174）：「剧本」页签与剧本分组组件从抽屉全删（只留顶部「剧本」页签）
  // 2026-11-06 用户指令：顺序 = 资产 → 层级 → 画布；非画布模块只留资产（+本剧信息）
  const tabItems: GroupTabItem[] = DRAWER_TAB_DEFS.map((d) => ({
    key: d.key,
    label: t(d.labelKey),
    ...TAB_ICONS[d.key],
  })).filter((item) => store.visibleGroups.includes(item.key as DrawerGroup));

  return (
    <div style={{ display: 'flex', flexDirection: 'row', flex: 1, minHeight: 0 }}>
      <SidebarNav items={tabItems} active={store.activeGroup} onChange={(k) => store.changeGroup(k as DrawerGroup)} theme={theme} />

      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}>
        {store.activeGroup === 'material' ? (
          <MaterialGroup store={store} theme={theme} />
        ) : store.activeGroup === 'canvasStructure' ? (
          // 层级 / 子画布合并为一个「画布」入口，组内 Tab 切换
          <CanvasStructureGroup store={store} theme={theme} hierarchy={hierarchy} />
        ) : store.activeGroup === 'scriptMeta' ? (
          // 本剧信息（2026-11-07 用户指令）：整部剧一句话概述 + 推荐标签
          <ScriptMetaGroup theme={theme} />
        ) : null}
      </div>

      {/* 2026-11-05 约定：删除改就地立即生效 + 3 秒撤销浮层（见 store.handleDeleteAsset），
          原「删除确认」弹窗一并移除 */}
    </div>
  );
}
