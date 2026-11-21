/**
 * StoryboardFullscreenEditor - 分镜全屏编辑（画布顶部页签承载，仅主体资产视图）
 *
 * - 顶部：统一模块工具栏（左操作 / 右纯统计）：① 集切换 ② 重新生成当前集；embedded 模式隐藏关闭
 * - 内容：主体资产管理（StoryboardSubjectTab：主体卡片网格 + 主体树详情）
 * Plan#50:embedded(页签内嵌)——不 createPortal、容器 absolute 填满父级，由调用方 portal 到页签挂载点
 */
import { memo, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { Tooltip, ConfigProvider, Button } from 'antd';
import { X, RotateCcw, ChevronDown } from 'lucide-react';
import { StoryboardSubjectTab } from './StoryboardSubjectTab';
import { FullscreenDropdown, fullToolBtnStyle } from './components/FullscreenDropdown';
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
        {/* ===== 模块顶栏（2026-11-21 统一口径）：左侧操作、右侧纯统计 ===== */}
        <div style={modalHeaderStyle(theme)}>
          {/* ① 切集永远第一项：与剧本同款「标题 + ▾」下拉，而非裸 Select */}
          <div data-toolbar-zone="left" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {episodes && episodes.length > 0 && activeEpisodeId && onEpisodeChange && (
              <FullscreenDropdown
                options={episodes.map((ep, idx) => ({
                  key: ep.id,
                  label: ep.title || t('storyboard.episodeLabel', { number: idx + 1 }),
                  active: ep.id === activeEpisodeId,
                }))}
                onSelect={(id) => { if (id !== activeEpisodeId) onEpisodeChange(id); }}
              >
                <button
                  type="button"
                  data-storyboard-episode-switch
                  aria-label={t('storyboard.switchEpisode', '切换集数')}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, maxWidth: 320,
                    padding: '2px 4px', border: 'none', borderRadius: 6, background: 'transparent',
                    color: textPrimary, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                    fontSize: 14, lineHeight: 1.4,
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {(() => {
                      const idx = episodes.findIndex((ep) => ep.id === activeEpisodeId);
                      const active = episodes[idx];
                      return active?.title || t('storyboard.episodeLabel', { number: idx + 1 });
                    })()}
                  </span>
                  <ChevronDown size={13} style={{ opacity: 0.6, flexShrink: 0 }} />
                </button>
              </FullscreenDropdown>
            )}
            <span style={{ width: 1, height: 16, background: theme.toolbar.border ?? 'rgba(128,128,128,0.3)', margin: '0 2px', flexShrink: 0 }} />
            {/* ② 主动作：带图标 + 文字（不再只留一个裸图标） */}
            {onRequestRegenerate && (
              <Tooltip title={t('storyboard.requestRegenerate', '重新生成该集')}>
                <Button
                  type="text"
                  size="small"
                  data-storyboard-regenerate
                  icon={<RotateCcw size={15} />}
                  onClick={onRequestRegenerate}
                  style={{ ...fullToolBtnStyle, color: theme.toolbar.textMuted }}
                >
                  {t('storyboard.regenerateEpisode', '重新生成该集')}
                </Button>
              </Tooltip>
            )}
          </div>

          {/* 右侧：状态栏，只读统计，不放按钮 */}
          <div
            data-toolbar-zone="right"
            data-storyboard-stats
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end',
              flex: 1, minWidth: 0, gap: 12, fontSize: 11, color: theme.toolbar.textMuted,
              whiteSpace: 'nowrap', overflow: 'hidden',
            }}
          >
            <span>{t('storyboard.subjectCount', '主体')} <b style={{ color: textPrimary }}>{(productionItems ?? []).length}</b></span>
            {episodes && episodes.length > 0 ? (
              <>
                <span style={{ width: 1, height: 12, background: theme.toolbar.border ?? 'rgba(128,128,128,0.3)', flexShrink: 0 }} />
                <span>{t('storyboard.episodeTotal', '剧集')} <b style={{ color: textPrimary }}>{episodes.length}</b></span>
              </>
            ) : null}
          </div>
          {/* 关闭固定在右上角（embedded 由页签 X 关闭） */}
          {!embedded && (
            <Tooltip title={t('common.close')}>
              <button type="button" {...ghostHoverHandlers(theme)} onClick={onClose} style={{ ...modalIconBtnStyle(theme, false), marginLeft: 12 }}>
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
