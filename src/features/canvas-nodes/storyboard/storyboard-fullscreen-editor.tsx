/**
 * StoryboardFullscreenEditor - 分镜全屏编辑（画布顶部页签承载，仅主体资产视图）
 *
 * - 顶部：共享 header（集切换 + 重新生成当前集 + 关闭；embedded 模式隐藏关闭按钮，由页签 X 关闭）
 * - 内容：主体资产管理（StoryboardSubjectTab：主体卡片网格 + 主体树详情）
 * Plan#50:embedded(页签内嵌)——不 createPortal、容器 absolute 填满父级，由调用方 portal 到页签挂载点
 */
import { memo, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { Tooltip, ConfigProvider, Select } from 'antd';
import { X, RotateCcw } from 'lucide-react';
import { StoryboardSubjectTab } from './StoryboardSubjectTab';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { Z_INDEX } from '@/shared/constants/z-index.js';
import type { ProductionItem, ProductionItemKind } from '../production-manager/production-manager-types';
import type { SubjectTree, ProjectColorCard } from './subject-tree-types';
import {
  modalHeaderStyle, modalIconBtnStyle, ghostHoverHandlers,
} from '../production-manager/production-editor-styles';

export interface StoryboardFullscreenEditorProps {
  open: boolean;
  onClose: () => void;
  /** Plan#50:内嵌模式(画布顶部页签内显示)——容器 absolute 填满父级、不 createPortal;关闭按钮隐藏 */
  embedded?: boolean;
  /** 集数切换（未关联剧本时为 undefined） */
  episodes?: Array<{ id: string; title?: string }>;
  activeEpisodeId?: string;
  onEpisodeChange?: (epId: string) => void;
  /** 主体库数据（主体卡片网格数据源，productionItems） */
  productionItems?: ProductionItem[];
  /** 主体卡片网格新建/编辑/删除（写主体库 productionItems） */
  onAddItem?: (kind: ProductionItemKind) => void;
  onUpdateItem?: (itemId: string, patch: Partial<ProductionItem>) => void;
  onDeleteItem?: (itemId: string) => void;
  /** 主体树：node.data.subjectTree + 树变更回调 */
  subjectTree?: SubjectTree[];
  /** 项目级色卡（征集#131：随分镜任务 output 水合，主体树首棵树顶部展示） */
  colorCard?: ProjectColorCard | null;
  onChangeTree?: (trees: SubjectTree[]) => void;
  /** 重新生成当前集（2026-08-29 全屏模式入口；由节点侧触发 RegenModal 流程） */
  onRequestRegenerate?: () => void;
}

export const StoryboardFullscreenEditor = memo(function StoryboardFullscreenEditor({
  open, onClose, episodes, activeEpisodeId, onEpisodeChange,
  productionItems, onAddItem, onUpdateItem, onDeleteItem,
  onRequestRegenerate,
  embedded = false,
  subjectTree, colorCard, onChangeTree,
}: StoryboardFullscreenEditorProps): ReactElement | null {
  const { t } = useTranslation();
  const { theme } = useTheme();

  const textPrimary = theme.toolbar.text;
  const pageBg = theme.canvas.background;

  if (!open) return null;

  // Plan#50:embedded(页签内嵌)——不 createPortal、容器 absolute 填满父级(页签内容层),
  // 由调用方(分镜节点)自行 portal 到页签挂载点;非 embedded 保持原全屏覆盖形态。
  const overlay = (
    // 真全屏覆盖层:自制 overlay(Z_INDEX.FULLSCREEN=30000),antd 弹层(Dropdown/Tooltip/Modal)
    // 由 ConfigProvider 提升到 40000,保证集切换等弹层显示在全屏之上
    <ConfigProvider theme={{ token: { zIndexPopupBase: 40000 } }}>
    <div style={overlayStyle(pageBg, embedded)}>
      {/* 事件阻断：全屏挂载于 body，不阻断则事件冒泡至画布平移/缩放 */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}
      >
        {/* ===== 标题栏：集切换 + 重新生成当前集 + 关闭 ===== */}
        <div style={modalHeaderStyle(theme)}>
          {episodes && episodes.length > 0 && activeEpisodeId && onEpisodeChange && (
            <Select
              size="small"
              value={activeEpisodeId}
              onChange={onEpisodeChange}
              style={{ width: 180, flexShrink: 0 }}
              options={episodes.map((ep, idx) => ({
                value: ep.id,
                label: ep.title || t('storyboard.episodeLabel', { number: idx + 1 }),
              }))}
            />
          )}
          {onRequestRegenerate && (
            <Tooltip title={t('storyboard.requestRegenerate', '重新生成该集')}>
              <button
                type="button"
                onClick={onRequestRegenerate}
                style={{ ...modalIconBtnStyle(theme, false), flexShrink: 0 }}
              >
                <RotateCcw size={15} />
              </button>
            </Tooltip>
          )}
          <span style={{ flex: 1 }} />
          {/* Plan#50:embedded(页签)模式隐藏自带关闭按钮——统一由页签 X 关闭 */}
          {!embedded && (
            <Tooltip title={t('common.close')}>
              <button type="button" {...ghostHoverHandlers(theme)} onClick={onClose} style={modalIconBtnStyle(theme, false)}>
                <X size={15} />
              </button>
            </Tooltip>
          )}
        </div>

        {/* ===== 主体资产：AI 生成的主体占位提示词卡片（主页提示词同款，点击打开链路画布） ===== */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', color: textPrimary }}>
          <StoryboardSubjectTab
            productionItems={productionItems ?? []}
            theme={theme}
            onAddItem={onAddItem}
            onUpdateItem={onUpdateItem}
            onDeleteItem={onDeleteItem}
            subjectTree={subjectTree}
            colorCard={colorCard}
            onChangeTree={onChangeTree}
          />
        </div>
      </div>
    </div>
    </ConfigProvider>
  );

  if (embedded) return overlay;
  return createPortal(overlay, document.body);
});

/** 全屏覆盖层样式:铺满视口 + 顶部层级 */
const overlayStyle = (background: string, embedded = false): React.CSSProperties => ({
  // Plan#50:embedded(页签内嵌)用 absolute 填满父容器;否则原全屏 fixed 覆盖
  position: embedded ? 'absolute' : 'fixed',
  inset: 0,
  zIndex: embedded ? undefined : Z_INDEX.FULLSCREEN,
  display: 'flex',
  flexDirection: 'column',
  background,
});
