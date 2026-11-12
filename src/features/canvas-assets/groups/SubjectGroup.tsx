/**
 * canvas-assets/groups/SubjectGroup - 画布资产抽屉「主体」分段（2026-11-05）
 *
 * 与整页「主体库」页签共用同一套三级页面组件（SubjectLibraryPages embedded）与同一份容器数据
 * （useStoryboardSubjectData → projects/<projectId>/entities/storyboard.json）。
 *
 * 抽屉内层级只走面包屑内存态：不写 history、不监听 popstate、不调用 navigateToView。
 */

import { useRef } from 'react';
import type { ThemeConfig } from '@zeroexo/shared';
import { useCanvasTabStore } from '@/features/canvas-tabs/canvas-tab-store.js';
import { SubjectLibraryPages } from '@/features/canvas-nodes/storyboard/subject-library-pages';
import { useStoryboardSubjectData } from '@/features/canvas-nodes/storyboard/use-storyboard-subject-data';
import { useTranslation } from 'react-i18next';

export function SubjectGroup({ theme }: { theme: ThemeConfig }): React.ReactElement {
  const { t } = useTranslation();
  // 与 @ 素材面板互斥保持：面板由页内「媒体接收位」动作唤起、叠在抽屉之上；
  // 本组只渲染主体页面，不因面板打开而关闭抽屉/切换分段，也不抢焦点。
  const projectId = useCanvasTabStore((s) => s.slotBindings.script);
  const { container, loadState, subjects, subjectTree, addSubject, updateItem, updateItems, deleteItem, deleteItems, changeTree } =
    useStoryboardSubjectData(projectId, true);

  const hostRef = useRef<HTMLDivElement>(null);

  const shell = (children: React.ReactNode) => (
    <div
      ref={hostRef}
      data-drawer-subject-group
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      {children}
    </div>
  );

  if (!container) {
    return shell(
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.toolbar.textMuted, fontSize: 13 }}>
        {loadState === 'error'
          ? t('canvasTab.subjectsLoadError', '主体库读取失败，请重新打开页签')
          : t('canvasTab.subjectsLoading', '正在加载主体库…')}
      </div>,
    );
  }

  return shell(
    <SubjectLibraryPages
      productionItems={subjects}
      subjectTree={subjectTree}
      theme={theme}
      projectId={projectId}
      onUpdateItem={updateItem}
      onUpdateItems={updateItems}
      onDeleteItem={deleteItem}
      onDeleteItems={deleteItems}
      onAddSubject={() => addSubject('character')}
      onChangeTree={changeTree}
      embedded
    />,
  );
}
