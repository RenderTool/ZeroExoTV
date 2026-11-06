/**
 * StoryboardTabContent — 顶部「主体库」页签 = 真正的主体库页面（2026-11-04 重写）
 *
 * 初始化完成即进入可用页面。
 *
 * ## 结构
 * - 标题栏：「主体库」+ 主体计数 +「+ 添加主体」按钮；
 * - 主体卡片网格：复用 StoryboardSubjectTab（类型筛选维度/卡片网格/剧照/主体详情单树视图）；
 * - 零主体空态：主页空项目态同款（虚线圆角框 + 加号 + 引导文案），整个虚线框可点击直接加主体。
 *
 * ## 数据源（绝不读 graph）
 * 唯一事实源 = 项目级容器 projects/<projectId>/entities/storyboard.json
 * （@/entities/slot-containers：entities=主体条目 ProductionItem[]，subjectTree=主体树）。
 * projectId 取自 slotBindings.script（剧本槽位绑定 = 项目 id，editor-page 进入项目时写入，
 * 与 ScriptTabContent 同一取值路径）。容器缺失时自愈挂载（ensure 幂等，只写实体 JSON）。
 * 本组件不 import 任何图 store——画布上有没有节点与页签渲染无关。
 */

import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Button } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import { Badge } from '@/shared/ui/index.js';
import { useCanvasTabStore } from './canvas-tab-store.js';
import { CanvasTabContentBoundary } from './CanvasTabContentBoundary.js';
import { StoryboardSubjectTab } from '@/features/canvas-nodes/storyboard/StoryboardSubjectTab.js';
import { useStoryboardSubjectData } from '@/features/canvas-nodes/storyboard/use-storyboard-subject-data.js';

export function StoryboardTabContent(): React.ReactElement | null {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const activeTabKey = useCanvasTabStore((s) => s.activeTabKey);
  // 项目 id = 剧本槽位绑定（editor-page 进入项目时写入；与 ScriptTabContent 同一路径）
  const projectId = useCanvasTabStore((s) => s.slotBindings.script);
  // 接受裸 kind（无载体）与 kind:id（历史 key）两种形态
  const isActive = activeTabKey === 'storyboard' || activeTabKey.startsWith('storyboard:');

  const { container, loadState, subjects, subjectTree, addSubject, updateItem, updateItems, deleteItem, deleteItems, changeTree } =
    useStoryboardSubjectData(projectId, isActive);

  if (!isActive) return null;

  // 容器未就绪（加载中/绑定未就绪/读取失败）：渲染加载提示，不白屏、不显示任何占位状态文案
  if (!container) {
    return (
      <CanvasTabContentBoundary>
        <div
          style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: theme.toolbar.textMuted, fontSize: 13,
          }}
        >
          {loadState === 'error'
            ? t('canvasTab.subjectsLoadError', '主体库读取失败，请重新打开页签')
            : t('canvasTab.subjectsLoading', '正在加载主体库…')}
        </div>
      </CanvasTabContentBoundary>
    );
  }

  const pagePad = 'clamp(16px, 3vw, 24px)';
  const contentMax = 1200;

  return (
    <CanvasTabContentBoundary>
      <div
        data-subject-library-page
        style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          background: theme.canvas.background,
        }}
      >
        {/* ===== 零主体空态：标题栏只在此态出现；非空时由页面内「主体库」标题承担 ===== */}
        {subjects.length === 0 && (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
              width: '100%', maxWidth: contentMax, margin: '0 auto', boxSizing: 'border-box',
              padding: `24px ${pagePad} 0`,
            }}
          >
            <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: -0.2, lineHeight: 1.4, color: theme.toolbar.text }}>
              {t('canvasTab.subjects', '主体库')}
            </span>
            <Badge theme={theme} tone="neutral">{subjects.length}</Badge>
            <span style={{ flex: 1 }} />
            <Button type="primary" size="small" data-subject-add icon={<Plus size={14} />} onClick={() => addSubject('character')}>
              {t('storyboard.addSubject', '添加主体')}
            </Button>
          </div>
        )}

        {subjects.length === 0 ? (
          /* ===== 零主体空态：整框可点击直接加主体 ===== */
          <div
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              minHeight: 0, padding: `24px ${pagePad}`,
            }}
          >
            <button
              type="button"
              data-subject-empty
              onClick={() => addSubject('character')}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = theme.toolbar.accent;
                e.currentTarget.style.color = theme.toolbar.text;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = theme.toolbar.border;
                e.currentTarget.style.color = theme.toolbar.textMuted;
              }}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 12, width: 320, maxWidth: '100%', height: 200,
                borderRadius: 12,
                border: `2px dashed ${theme.toolbar.border}`,
                background: 'transparent', cursor: 'pointer',
                color: theme.toolbar.textMuted, fontFamily: 'inherit',
                transition: 'border-color .2s ease, color .2s ease',
              }}
            >
              <Plus size={28} />
              <span style={{ fontSize: 13, lineHeight: 1.6, textAlign: 'center', padding: '0 24px' }}>
                {t('canvasTab.subjectsEmpty', '还没有主体，点击上方按钮添加你的第一个主体')}
              </span>
            </button>
          </div>
        ) : (
          /* ===== 主体卡片网格（类型筛选维度 / 剧照 / 主体详情单树视图，复用既有组件） ===== */
          <StoryboardSubjectTab
            pagesMode
            projectId={projectId}
            productionItems={subjects}
            theme={theme}
            onAddItem={addSubject}
            onUpdateItem={updateItem}
            onUpdateItems={updateItems}
            onDeleteItem={deleteItem}
            onDeleteItems={deleteItems}
            subjectTree={subjectTree}
            onChangeTree={changeTree}
          />
        )}
      </div>
    </CanvasTabContentBoundary>
  );
}
