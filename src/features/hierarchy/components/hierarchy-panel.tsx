/**
 * HierarchyPanelSidebar - 画布结构/资产库合一抽屉（征集 #87 验收轮九重设计）
 *
 * 布局：宽 450px，内容 = 主页资产库同款页面（forceMobile 移动端同款卡片布局 + 固定 2 格网格）。
 * 视图由分组决定（征集 #87 验收轮十约定）：
 * - 层级分组 = 原树形列表（HierarchyListView，层级专属；虚拟滚动/键盘导航/批量选择/ZIP 全保留）
 * - 素材/提示词/剧本分组 = 网格卡片（主页同款，上传/删除/重命名/收藏/右键发送到画布）
 *
 * 抽屉式动画（2026-09-04 约定:分镜表格自适应另行优化,抽屉恢复完整「抽屉感」）:
 * - inline(PC 非覆盖):外层 width 0.35s 过渡展开/收拢(整体带背景推出,画布被逐步推开),
 *   内层不再单独滑入(消除双动画);分镜表格列宽已 px 化稳定(StoryboardTable 稳定窗结算),
 *   宽度逐帧变化不再触发表格逐帧重排——这是 2026-09-02 改 width 瞬开的根治替代。
 * - overlay/modal(覆盖/移动端):宽度恒定,内层 translate3d 滑入 + opacity 渐显(原方案保留)。
 * 打开性能(Plan#48-T6 重带):动画期间延迟挂载资产库页(扫光骨架占位),避免与滑入动画同帧竞争。
 */

import { useState, useLayoutEffect, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import type { GroupPlugin } from '@zeroexo/plugin-group';
import type { ThemeConfig } from '@zeroexo/shared';
// 2026-08-30 约定:画布资产抽屉与主页资产库拆为两套独立架构(抽屉用 CanvasAssetsPanel)
import { CanvasAssetsPanel } from '@/features/canvas-assets/index.js';
import { EDITOR_ICONS } from '@/pages/editor/editor-canvas/icons.js';
import { Z_INDEX } from '@/shared/constants/z-index.js';
import { useViewPrefsStore } from '@/shared/view-prefs.js';
import {
  clampHierarchyPanelWidth,
  resolveHierarchyPanelWidth,
} from './panel-width.js';

export interface HierarchyPanelSidebarProps {
  closing: boolean;
  store: ReactGraphStore;
  groupPlugin: GroupPlugin;
  theme: ThemeConfig;
  /** 移动端弹窗模式:禁用宽度动画,宽度 100%,无右边框 */
  modal?: boolean;
  /** 覆盖模式(征集 #95):绝对定位于画布左缘之上覆盖拉开(不推开布局),移动端复用 PC 同款抽屉 */
  overlay?: boolean;
  /** 关闭按钮回调 */
  onClose?: () => void;
  /** 点击节点时聚焦(层级分组卡片点击回调) */
  onFocusNode?: (nodeId: string) => void;
  /** 资产库发送到画布(接编辑器 handleAssetInsert) */
  onSendToCanvas?: (item: { type: 'asset' | 'prompt' | 'script'; id: string; data: unknown }) => void;
}

// 2026-11-05 用户定稿：默认宽度不再写死，由瀑布流卡宽推导（≈两个卡片宽，当前 496px）；
// 视口约束 min(默认值, 92vw) 且不低于 360；用户拖拽值优先并持久化在 view-prefs 同一存储键。
// 2026-08-31 约定:PC 端抽屉支持右侧分割线拖拽调宽

// 抽屉式动画:统一 0.35s cubic-bezier(0.22, 1, 0.36, 1),展开收起同节奏
const DRAWER_TRANSITION = '0.35s cubic-bezier(0.22, 1, 0.36, 1)';

// 打开动画期间占位骨架的扫光动画（与 AgentDock .agent-shimmer 同款观感；
// 独立 keyframes 命名，避免与 AgentDock.css 的 shimmer-sweep 定义互相覆盖）
const PANEL_SHIMMER_CSS = `
@keyframes zeroexo-panel-sweep { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
.zeroexo-panel-shimmer {
  background: linear-gradient(90deg, rgba(127,127,127,0.10) 0%, rgba(127,127,127,0.22) 20%, rgba(127,127,127,0.10) 40%);
  background-size: 200% 100%;
  animation: zeroexo-panel-sweep 1.5s ease-in-out infinite;
}
`;

export function HierarchyPanelSidebar({
  closing, store, groupPlugin, theme, modal, overlay, onClose, onFocusNode,
  onSendToCanvas,
}: HierarchyPanelSidebarProps): React.ReactElement {
  const { t } = useTranslation();

  // 展开动画:useLayoutEffect 确保初始 DOM 状态提交后再触发过渡
  const [expanded, setExpanded] = useState(false);
  const [widthCollapsed, setWidthCollapsed] = useState(true);
  useLayoutEffect(() => {
    if (closing) {
      // 关闭:inline 外层 width 直接过渡收拢(内层随外层),overlay/modal 内层滑出;
      // 组件卸载由父级按 DRAWER_TRANSITION 时长(toggleHierarchy HIERARCHY_ANIM_MS)负责
      setExpanded(false);
      setWidthCollapsed(true);
      return;
    }
    // 打开:组件多为「关闭后卸载、再次打开重新挂载」——初始 width=0 必须先提交一帧,
    // 双 rAF 后再放开,width 过渡才从 0 播到 panelWidth(否则首帧即全宽、打开无动画)
    setExpanded(true);
    if (!overlay && !modal) {
      // inline:宽度过渡即抽屉动画(整体带背景推出),内容随外层同步到位
      let rafId: number;
      const id = requestAnimationFrame(() => {
        rafId = requestAnimationFrame(() => setWidthCollapsed(false));
      });
      return () => { cancelAnimationFrame(id); cancelAnimationFrame(rafId); };
    }
    // overlay/modal:宽度恒定,内层初始 translate3d(-panelWidth) 已提交,双 rAF 后触发滑入过渡
    setWidthCollapsed(false);
    let rafId2: number;
    const id2 = requestAnimationFrame(() => {
      rafId2 = requestAnimationFrame(() => setExpanded(true));
    });
    return () => { cancelAnimationFrame(id2); cancelAnimationFrame(rafId2); };
  }, [closing, overlay, modal]);

  // Plan#48-T6 打开性能(重带):资产库页延迟挂载 —— 0.35s 滑入过渡期间不挂载重页面,
  // 420ms 后再挂;避免树/卡片数据加载 + antd 控件挂载与滑入动画同帧竞争。
  const [contentReady, setContentReady] = useState(false);
  useEffect(() => {
    if (closing || !expanded || contentReady) return;
    const timer = window.setTimeout(() => setContentReady(true), 420);
    return () => window.clearTimeout(timer);
  }, [closing, expanded, contentReady]);

  // 2026-08-31 约定：PC 端资产抽屉右侧分割线拖拽调宽
  // 2026-11-05：首次用推导默认值；用户拖过则优先用户值（view-prefs 复用同一存储键）
  const savedPanelWidth = useViewPrefsStore((s) => s.hierarchy.panelWidth);
  const persistPanelWidth = useViewPrefsStore((s) => s.setHierarchyPanelWidth);
  const [panelWidth, setPanelWidth] = useState(() => resolveHierarchyPanelWidth(
    savedPanelWidth,
    typeof window === 'undefined' ? 1440 : window.innerWidth,
  ));
  const [draggingWidth, setDraggingWidth] = useState(false);
  const startDragWidth = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDraggingWidth(true);
    const startX = e.clientX;
    const startW = panelWidth;
    let latest = startW;
    const onMove = (ev: PointerEvent) => {
      const w = clampHierarchyPanelWidth(
        startW + (ev.clientX - startX),
        typeof window === 'undefined' ? 1440 : window.innerWidth,
      );
      latest = w;
      setPanelWidth(w);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      setDraggingWidth(false);
      if (latest !== startW) persistPanelWidth(Math.round(latest));
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
  }, [panelWidth, persistPanelWidth]);

  // 外层占位宽度过渡(布局属性动画):表格列宽已 px 化稳定(StoryboardTable 稳定窗),
  // 逐帧推画布不再引起分镜表格逐帧重排 → 抽屉动画恢复完整展开/收拢
  const width = widthCollapsed ? 0 : panelWidth;
  const opacity = closing ? 0 : expanded ? 1 : 0;
  // overlay/modal 内层滑入用 translate3d(合成属性);inline 内层随外层宽度展开,无自身位移
  const translate3d = closing ? `translate3d(${-panelWidth}px, 0, 0)` : expanded ? 'translate3d(0, 0, 0)' : `translate3d(${-panelWidth}px, 0, 0)`;

  // 抽屉式动画:宽度过渡(整体推出)+ opacity 渐显;拖拽调宽期间挂起过渡
  const outerStyle: CSSProperties = overlay
    ? {
        // 征集 #95:覆盖模式——绝对定位于画布左缘之上(不占布局、不推开内容),移动端与 PC 同款组件
        // 2026-08-31 修复:zIndex 提到 DRAWER_OVERLAY(31000),否则会被出片工作台全屏(30000)遮挡
        position: 'absolute', left: 0, top: 0, bottom: 0, zIndex: Z_INDEX.DRAWER_OVERLAY,
        width: panelWidth, maxWidth: '92vw',
        opacity: closing ? 0 : (expanded ? 1 : 0),
        pointerEvents: closing || !expanded ? 'none' : 'auto',
        transition: `opacity ${DRAWER_TRANSITION}`,
      }
    : modal
    ? {
        width: '100%', height: '100%',
        opacity: closing ? 0 : (expanded ? 1 : 0),
        pointerEvents: closing || !expanded ? 'none' : 'auto',
        transition: `opacity ${DRAWER_TRANSITION}`,
      }
    : {
        // 2026-08-29 修复:PC 端去掉 overflow clip——innerStyle 的 box-shadow(1px 边线)
        // 会被父级 overflow 裁剪而不可见;innerStyle 自带 overflow hidden 已足够约束内容
        flexShrink: 0, width, opacity,
        pointerEvents: closing || !expanded ? 'none' : undefined,
        // 2026-09-04 恢复:width 过渡(0.35s 整体推出/收拢)+ opacity 渐显;
        // 表格 px 化后无逐帧重排风险。will-change 不加——width 非合成属性,提示无效反诱发分层(征集 #85)
        transition: draggingWidth ? 'none' : `width ${DRAWER_TRANSITION}, opacity ${DRAWER_TRANSITION}`,
      };
  // 抽屉底色与画布主题色一致(征集 #92 拍板)。
  // 2026-08-31 约定：PC 资产抽屉去掉 border-right，仅保留移动端同款阴影。
  const innerStyle: CSSProperties = (modal || overlay)
    ? {
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        position: 'relative',
        // 2026-08-31：全站统一画布背景色
        overflow: 'hidden', backgroundColor: theme.canvas.background,
        color: theme.toolbar.text,
        transform: translate3d,
        transition: `transform ${DRAWER_TRANSITION}`,
        willChange: 'transform',
      }
    : {
        width: panelWidth, height: '100%', display: 'flex', flexDirection: 'column',
        position: 'relative',
        // 2026-08-31：全站统一画布背景色
        overflow: 'hidden', backgroundColor: theme.canvas.background,
        color: theme.toolbar.text,
        // 2026-09-04:inline 内容随外层 width 过渡整体推出,自身不再位移(消除 2026-09-02 起的内容左滑观感)
        transform: 'none',
        // 2026-09-03 修复：右侧拖拽分割线（8px 命中区）紧贴内容滚动条 →
        // 内容区右侧让出内边距，滚动条与分割线发丝线不再重叠贴死
        paddingRight: 12,
      };

  return (
    <>
      <style>{PANEL_SHIMMER_CSS}</style>
      <div style={outerStyle}>
      <div style={innerStyle}>
        {/* 关闭按钮(2026-08-31 约定:仅移动端抽屉(覆盖模式)显示;
            PC 端去掉——其开合由顶栏「资产库」开关控制;modal 模式由外部外壳提供关闭入口) */}
        {overlay && onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('hierarchy.close')}
            title={t('hierarchy.close')}
            style={{
              position: 'absolute', top: 8, right: 8, zIndex: 20,
              width: 32, height: 32, border: 'none', background: 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: theme.toolbar.text,
              padding: 0, borderRadius: 6, transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => {
              const isDark = theme.mode === 'dark';
              e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)';
            }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <X size={16} />
          </button>
        )}
        {/* 收起按钮(2026-08-31 约定:PC 内联抽屉要「收起」入口,箭头而非叉号。
            此前 PC 端无任何收起控件——只能回顶栏「资产库」开关切换,用户在抽屉里收不回去) */}
        {!modal && !overlay && onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('hierarchy.collapse', '收起')}
            title={t('hierarchy.collapse', '收起')}
            style={{
              position: 'absolute', top: 8, right: 8, zIndex: 20,
              width: 28, height: 28, border: 'none', background: 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: theme.toolbar.text,
              padding: 0, borderRadius: 6, transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => {
              const isDark = theme.mode === 'dark';
              e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)';
            }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <EDITOR_ICONS.collapseLeft size={16} />
          </button>
        )}
        {/* 征集 #87 验收轮九/十:内嵌主页资产库同款页面;
            层级分组 = 原树形列表(层级专属),其余分组 = 网格卡片
            2026-11-06 用户指令:sidebar 顺序 = 资产→历史→层级→画布(资产置顶并默认激活);
            层级/画布只在画布模块挂载;层级树数据 hook 已下放到分组组件内部——
            只有该分组真正激活时（画布模块 + 层级页签）才订阅整张图 */}
        {contentReady ? (
          <CanvasAssetsPanel
            theme={theme}
            hierarchy={{
              store,
              groupPlugin,
              onFocusNode,
            }}
            onSendToCanvas={onSendToCanvas as ((item: { type: 'asset' | 'prompt' | 'script'; id: string; data: any }) => void) | undefined}
          />
        ) : (
          // 过渡期间骨架：扫光条占位(与 AgentDock 骨架同款观感,内容 420ms 后挂载不显突兀)
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Array.from({ length: 5 }, (_, i) => (
              <div
                key={i}
                className="zeroexo-panel-shimmer"
                style={{ height: i % 2 === 0 ? 110 : 64, borderRadius: 12, flexShrink: 0 }}
              />
            ))}
          </div>
        )}
        {/* 右侧分割线拖拽 → AgentDock 同款样式（全站统一：8px 命中区 + 1px 发丝线 + 主题色手柄） */}
        {!modal && !overlay && expanded && (
          <div
            onPointerDown={startDragWidth}
            title={t('hierarchy.resize', '拖拽调整宽度')}
            style={{
              width: 8,
              cursor: 'col-resize',
              background: 'transparent',
              position: 'absolute',
              top: 0, right: 0, bottom: 0,
              zIndex: 30,
              touchAction: 'none',
            }}
          >
            {/* 中央发丝线 */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: '50%',
                width: 1,
                transform: 'translateX(-0.5px)',
                background: theme.mode === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)',
              }}
            />
            {/* hover/拖拽时的主题色手柄指示器 */}
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: 3,
                height: 36,
                borderRadius: 2,
                background: theme.toolbar.accent ?? '#3b82f6',
                opacity: 0,
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.parentElement!.style.opacity = '1'; }}
              onMouseLeave={(e) => { e.currentTarget.parentElement!.style.opacity = '0'; }}
            />
          </div>
        )}
      </div>
      </div>
    </>
  );
}
