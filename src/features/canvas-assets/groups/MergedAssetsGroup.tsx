/**
 * canvas-assets/groups/MergedAssetsGroup - 抽屉两个大分组的组内胶囊（2026-11-18 用户口径）
 *
 * 用户口径（口径定稿）：左侧不再是「资产 / 历史」这套旧概念，而是
 *   - 画布资产 = 画布自己产出的东西（组内两段：画布历史 → 公共资产）
 *   - 分镜资产 = 分镜自己产出的东西（组内两段：主体 → 分镜历史）
 * 两段是同一条胶囊行里的并排按钮（不是子页嵌套），看主体不用回左侧再切一次大分组。
 * 语序固定「本段产出在前、公共/根在后」，由 variant 决定显示哪两段。
 *
 * 内容复用既有组件：HistoryGroup 锁来源（hideHeader 关掉它自带的标题与来源 Tab）、
 * MaterialGroup 锁作用域（hideCapsules 关掉它自带的「公共 / 本项目 / 开源库 / 主体」那排）。
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import { CapsuleTabs } from '@/features/asset-library/components/capsule-tabs.js';
import { useCanvasTabStore } from '@/features/canvas-tabs/canvas-tab-store.js';
import { useSubjectTotalCount } from '@/features/canvas-nodes/storyboard/use-storyboard-subject-data.js';
import { getCurrentCanvasId } from '@/shared/current-canvas-id.js';
import { countHistoryBySourceAndKind } from '../history-utils.js';
import { MaterialGroup } from './MaterialGroup.js';
import { SubjectGroup } from './SubjectGroup.js';
import { HistoryGroup } from './HistoryGroup.js';
import type { CanvasAssetsPanelStore } from '../store.js';

export type MergedGroupVariant = 'canvasAssets' | 'storyboardAssets';

type Pill = 'canvasHistory' | 'directorHistory' | 'library' | 'subject';

export function MergedAssetsGroup({ store, theme, variant }: {
  store: CanvasAssetsPanelStore;
  theme: ThemeConfig;
  /** canvasAssets = 画布历史 + 公共资产；storyboardAssets = 主体 + 分镜历史 */
  variant: MergedGroupVariant;
}): React.ReactElement {
  const { t } = useTranslation();
  const defaultPill: Pill = variant === 'canvasAssets' ? 'canvasHistory' : 'subject';
  const [pill, setPill] = useState<Pill>(defaultPill);

  // 左侧大分组切换时本组件实例会复用（同一个组件、只换了 variant）：
  // 必须把胶囊重置到新分组的首段，否则会停在上一组的段上（表现为「点了按钮页面没跟着换」）
  useEffect(() => {
    const next: Pill = variant === 'canvasAssets' ? 'canvasHistory' : 'subject';
    if (next === 'subject') store.setMaterialScopeTab('subject');
    setPill(next);
  }, [variant, store.setMaterialScopeTab]);

  // 兜底：当前段不属于本分组（例如切组时序中间态）时按首段渲染，绝不显示别组的页面
  const activePill: Pill = variant === 'canvasAssets'
    ? (pill === 'library' ? 'library' : 'canvasHistory')
    : (pill === 'directorHistory' ? 'directorHistory' : 'subject');

  /** 切段同时把 MaterialGroup 的作用域对齐（同一个事件里改完，下一次渲染就是目标页，不留一帧旧内容） */
  const pickPill = (key: string): void => {
    const next = key as Pill;
    if (next === 'library') store.setMaterialScopeTab('library');
    else if (next === 'subject') store.setMaterialScopeTab('subject');
    setPill(next);
  };

  // 胶囊计数与各分段同源：历史按来源统计（画布/分镜）、公共资产与主体沿用既有口径
  const boundProjectId = useCanvasTabStore((s) => s.slotBindings.script);
  const projectId = boundProjectId ?? getCurrentCanvasId() ?? null;
  const sourceCounts = useMemo(
    () => countHistoryBySourceAndKind(store.allAssets, store.historyProjectId),
    [store.allAssets, store.historyProjectId],
  );
  const subjectCount = useSubjectTotalCount(projectId);

  const segments = variant === 'canvasAssets'
    ? [
      { key: 'canvasHistory', label: t('assetLibrary.historySourceCanvas', { defaultValue: '画布历史' }), count: sourceCounts.canvas.total },
      { key: 'library', label: t('assetLibrary.scopeCapsuleLibrary', { defaultValue: '公共资产' }), count: store.materialScopeCounts.library },
    ]
    : [
      { key: 'subject', label: t('assetLibrary.scopeCapsuleSubject', { defaultValue: '主体' }), count: subjectCount },
      { key: 'directorHistory', label: t('assetLibrary.historySourceDirector', { defaultValue: '分镜历史' }), count: sourceCounts.director.total },
    ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ padding: '8px 20px 0', flexShrink: 0 }} data-merged-pill-bar>
        <CapsuleTabs
          value={activePill}
          onChange={pickPill}
          segments={segments}
          theme={theme}
          testId="drawer-merged-tabs"
        />
      </div>

      {activePill === 'canvasHistory' && <HistoryGroup store={store} theme={theme} forcedSource="canvas" hideHeader />}
      {activePill === 'directorHistory' && <HistoryGroup store={store} theme={theme} forcedSource="director" hideHeader />}
      {activePill === 'library' && <MaterialGroup store={store} theme={theme} lockedScope="library" hideCapsules />}
      {activePill === 'subject' && <SubjectGroup theme={theme} />}
    </div>
  );
}
