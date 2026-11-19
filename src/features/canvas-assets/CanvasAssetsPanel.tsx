/**
 * canvas-assets/CanvasAssetsPanel - 画布资产抽屉内容（2026-08-30 约定：与主页资产库独立架构）
 *
 * 结构：容器（分组 Tab + 共享弹窗）+ 各分组组件（纯渲染）。
 * 数据来源：useCanvasAssetsPanel（数据驱动唯一来源）。
 * 展示组件：分组内复用 shared 组件；层级分组复用 HierarchyGroup（内部接 HierarchyListView）。
 *
 * 2026-11-06 用户指令（抽屉两处收敛）：
 * - sidebar 按钮顺序 = DRAWER_TAB_DEFS 顺序（全局分组置顶，模块独有分组垫底 + 分割线）；
 * - 层级/画布只在**画布模块**（顶部页签 = 画布/画布副本）被激活时挂载，
 *   剧本/主体库/导演台模块下按钮与内容都不出现，杜绝在这些模块误选画布层级与子画布。
 */

import { useTranslation } from 'react-i18next';
import { Input, Modal } from 'antd';
import { Layers, FileText, ListChecks, Clapperboard, Images } from 'lucide-react';
import type { ThemeConfig } from '@zeroexo/shared';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import type { GroupPlugin } from '@zeroexo/plugin-group';
import { useCanvasTabStore } from '@/features/canvas-tabs/canvas-tab-store.js';
import { useCanvasAssetsPanel } from './store.js';
import type { DrawerGroup } from './tab-defs.js';
import { SidebarNav, type GroupTabItem } from './components/common.js';
import { MergedAssetsGroup } from './groups/MergedAssetsGroup.js';
import { CanvasStructureGroup } from './groups/CanvasStructureGroup.js';
import { ScriptMetaGroup } from './groups/ScriptMetaGroup.js';
import { TaskQueuePanel } from '@/features/task-center/task-queue-panel.js';
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
  // 2026-11-18 用户口径：两个大分组按产出方命名并换图标——画布资产 = 画面/图像（Images），分镜资产 = 镜头板（Clapperboard）
  assets: { icon: <Images size={18} /> },
  // 2026-11-16 用户指令：画布历史 + 分镜历史合并为一个「历史记录」入口（组内 Tab 切来源）
  history: { icon: <Clapperboard size={18} /> },
  // 画布相关合并入口：层级 / 子画布在组内 Tab 切换
  canvasStructure: { icon: <Layers size={18} /> },
  // 本剧信息（2026-11-07）：整部剧的一句话概述 + 标签，仅剧本/导演台模块挂载
  scriptMeta: { icon: <FileText size={18} /> },
  // 任务队列：全局按钮（MCP 任务 / 取消运行中或排队中任务）
  tasks: { icon: <ListChecks size={18} /> },
};

export function CanvasAssetsPanel({ theme, hierarchy, onSendToCanvas }: CanvasAssetsPanelProps): React.ReactElement {
  const { t } = useTranslation();
  // 2026-11-06：分组随**顶部页签模块**切换——层级/画布只在画布模块可挂载（见 tab-defs）
  const activeTabKey = useCanvasTabStore((s) => s.activeTabKey);
  const store = useCanvasAssetsPanel({ onSendToCanvas, module: resolveDrawerModule(activeTabKey) });

  // 2026-11-13 用户指令：删除独立「历史」入口——画布生成进「画布」、导演台生成进「导演台」。
  // 2026-11-05 用户指令（征集 #174）：「剧本」页签与剧本分组组件从抽屉全删（只留顶部「剧本」页签）
  // 2026-11-06 用户指令：顺序 = 资产 → 层级 → 画布；非画布模块只留资产（+本剧信息）
  // 2026-11-16 用户指令：模块独有分组（层级/子画布、本剧信息）统一垫底，
  // 首个独有分组上方画分割线，与全局分组（公共资产/主体/历史记录/任务队列）隔开
  const visibleItems = DRAWER_TAB_DEFS.map((d) => ({
    key: d.key,
    label: t(d.labelKey, { defaultValue: 'defaultLabel' in d ? d.defaultLabel : d.labelKey }),
    ...TAB_ICONS[d.key],
  })).filter((item) => store.visibleGroups.includes(item.key as DrawerGroup));
  // 2026-11-16 用户指令：模块独有分组（画布结构 / 本剧信息）统一垫底，并在首个独有分组上方画分割线，
  // 与全局分组（公共资产 / 主体 / 历史记录 / 任务队列）分开展示
  const MODULE_GROUP_KEYS: DrawerGroup[] = ['canvasStructure', 'scriptMeta'];
  let moduleDividerPlaced = false;
  const tabItems: GroupTabItem[] = visibleItems.map((item) => {
    if (!MODULE_GROUP_KEYS.includes(item.key as DrawerGroup)) return item;
    if (moduleDividerPlaced) return item;
    moduleDividerPlaced = true;
    return { ...item, dividerBefore: true };
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'row', flex: 1, minHeight: 0 }}>
      <SidebarNav items={tabItems} active={store.activeGroup} onChange={(k) => store.changeGroup(k as DrawerGroup)} theme={theme} />

      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}>
        {store.activeGroup === 'assets' ? (
          // 画布资产 = 画布自己产出：组内两段「画布历史 → 公共资产」
          <MergedAssetsGroup store={store} theme={theme} variant="canvasAssets" />
        ) : store.activeGroup === 'history' ? (
          // 分镜资产 = 分镜自己产出：组内两段「主体 → 分镜历史」（看主体不用回左侧切大分组）
          <MergedAssetsGroup store={store} theme={theme} variant="storyboardAssets" />
        ) : store.activeGroup === 'canvasStructure' ? (
          // 层级 / 子画布合并为一个「画布」入口，组内 Tab 切换
          <CanvasStructureGroup store={store} theme={theme} hierarchy={hierarchy} />
        ) : store.activeGroup === 'scriptMeta' ? (
          // 本剧信息（2026-11-07 用户指令）：整部剧一句话概述 + 推荐标签
          <ScriptMetaGroup theme={theme} />
        ) : store.activeGroup === 'tasks' ? (
          <TaskQueuePanel />
        ) : null}
      </div>

      {/* 2026-11-05 约定：删除改就地立即生效 + 3 秒撤销浮层（见 store.handleDeleteAsset），
          原「删除确认」弹窗一并移除 */}
      {/* 2026-11-18 修复：重命名弹窗必须在抽屉根部一直挂载——历史/主体等分组也会触发重命名，
          挂在 MaterialGroup 里时只有切到「资产」页签才存在，点重命名就像没反应 */}
      <Modal
        title={t('assetLibrary.renameTitle', { defaultValue: '重命名' })}
        open={store.renameItemOpen}
        onCancel={() => store.setRenameItemOpen(false)}
        onOk={() => void store.handleRenameItem()}
        okText={t('common.confirm', { defaultValue: '确认' })}
        cancelText={t('common.cancel', { defaultValue: '取消' })}
        centered
        width="calc(100vw - 32px)"
        style={{ maxWidth: 420 }}
        destroyOnHidden
      >
        <Input
          value={store.renameItemName}
          onChange={(e) => store.setRenameItemName(e.target.value)}
          placeholder={t('assetLibrary.renamePlaceholder', { defaultValue: '请输入新名称' })}
          maxLength={50}
          autoFocus
          onPressEnter={() => void store.handleRenameItem()}
        />
      </Modal>
    </div>
  );
}
