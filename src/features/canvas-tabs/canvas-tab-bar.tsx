/**
 * CanvasTabBar — 顶部固定槽位页签条（2026-11-04 单例槽位改造；2026-11-05 主体库退出顶部）
 *
 * 语义：一个项目 = 1 剧本 + 1 导演台 + 1 画布的固定槽位视图（主体库已不占页签，
 * 只在抽屉「主体」分段里打开；容器仍挂载，仅顶部入口移除）：
 * - 无关闭/删除入口、无"新建页签"；
 * - 默认顺序 [剧本, 导演台, 画布]（slotOrder 里的 storyboard 槽位不渲染），可拖拽重排，顺序持久化（localStorage）；
 * - 2026-11-04 槽位供应下线：点击页签 = 纯读指针切换（有绑定→kind:id，无绑定→裸 kind），
 *   绝不创建节点/写图；无载体时由页级内容组件渲染空态。
 *
 * 视觉（2026-11-04 胶囊分段改造）：分段控件风格——容器统一内边距 + 整体圆角外壳，
 * 选中项由独立底色块 + 圆角表达（不再用下划线），未选中项为低对比文字；
 * 四枚页签等距，icon+label 同基线；画布槽位不再用红点占位，改用同语言 Frame 图标。
 * 颜色经 CSS 变量按深/浅主题注入，交互四态见 canvas-tab-bar.css。
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CSSProperties } from 'react';
import { useTheme } from '@zeroexo/plugin-theme';
import type { LucideIcon } from 'lucide-react';
import { useCanvasTabStore, slotTabKey } from './canvas-tab-store.js';
import type { FixedSlotKind } from './canvas-tab-store.js';
import { CANVAS_TAB_ICONS, CANVAS_COPY_TAB_ICON, CANVAS_TAB_CLOSE_ICON } from './icons.js';
import './canvas-tab-bar.css';

function SlotIcon({ kind, active }: { kind: FixedSlotKind; active: boolean }): React.ReactElement {
  // 与画布节点左上角/层级面板类型图标同源（出片=Film 而非通用文档图标）；
  // 四槽位同一图标语言：size 13，选中加粗笔画（2.2）、未选中常规（1.8）
  const Icon: LucideIcon = CANVAS_TAB_ICONS[kind];
  return <Icon size={13} strokeWidth={active ? 2.2 : 1.8} />;
}

/** 槽位显示名 i18n key（页签专用命名空间 canvasTab.*，与节点类型名 canvasNodes.stage.* 解耦） */
const SLOT_LABEL_KEY: Record<FixedSlotKind, string> = {
  script: 'canvasTab.script',
  storyboard: 'canvasTab.subjects',
  workbench: 'canvasTab.director',
  canvas: 'canvasTab.canvas',
};

/** 槽位显示名兜底文案（2026-11-04 正式命名：主体库 / 导演台） */
const SLOT_FALLBACK_LABEL: Record<FixedSlotKind, string> = {
  script: '剧本',
  storyboard: '主体库',
  workbench: '导演台',
  canvas: '画布',
};

export function CanvasTabBar(): React.ReactElement {
  const { t } = useTranslation();
  const { theme, mode } = useTheme();
  const slotOrder = useCanvasTabStore((s) => s.slotOrder);
  const slotBindings = useCanvasTabStore((s) => s.slotBindings);
  const activeTabKey = useCanvasTabStore((s) => s.activeTabKey);
  const activateTab = useCanvasTabStore((s) => s.activateTab);
  const reorderSlots = useCanvasTabStore((s) => s.reorderSlots);
  // 副本画布标签（Spec）：与 1 号主画布**同一层并排**，可拖拽排序、可 ×（只关页签不删数据）
  const copyTabs = useCanvasTabStore((s) => s.openCanvasTabs);
  const closeCanvasTab = useCanvasTabStore((s) => s.closeCanvasTab);
  const reorderCanvasTabs = useCanvasTabStore((s) => s.reorderCanvasTabs);
  // 拖拽中的槽位下标（四个固定槽位整体参与排序）
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  // 副本标签自己的拖拽下标（与固定槽位互不串位：两套序各自排）
  const [copyDragIndex, setCopyDragIndex] = useState<number | null>(null);

  const dark = mode === 'dark';
  // 胶囊分段控件色板：深色=浮层灰块（参考图），浅色=白底块+轻投影（经典 segmented control）
  const themeVars = {
    '--zx-tabs-bg': dark ? theme.toolbar.panel : 'rgba(0,0,0,0.05)',
    '--zx-tabs-border': dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)',
    '--zx-tab-active': dark ? 'rgba(255,255,255,0.10)' : '#ffffff',
    '--zx-tab-active-shadow': dark ? 'rgba(0,0,0,0.40)' : 'rgba(0,0,0,0.12)',
    '--zx-tab-hover': dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
    '--zx-tab-press': dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
    '--zx-tab-text': theme.toolbar.text,
    '--zx-tab-muted': theme.toolbar.textMuted,
    // 2026-11-05 用户指令（状态色不用品牌红）：键盘 focus 描边已改中性 slate（见 canvas-tab-bar.css），
    // 原本注入的 --zx-tab-accent 已无消费点，故不再传——避免“页签环随主题变红”。
  } as CSSProperties;

  const handleActivate = (kind: FixedSlotKind): void => {
    // 2026-11-04 供应下线：有绑定 → kind:id（节点 portal 供内容）；无绑定 → 裸 kind（页级组件空态）。
    // 纯读指针切换，绝不创建节点/写图。
    const key = slotTabKey(kind, slotBindings) ?? kind;
    activateTab(key);
  };

  return (
    <div className="zx-canvas-tabs" style={themeVars} role="tablist">
      {slotOrder
        // 2026-11-05 用户指令：主体库不再占顶部页签，只保留抽屉内「主体」分段。
        // 项目级容器与数据（entities/storyboard.json）照旧挂载，仅顶部入口移除；
        // idx 保留为 slotOrder 原始下标，拖拽重排仍按真实位置计算。
        .map((kind, idx) => ({ kind, idx }))
        .filter(({ kind }) => kind !== 'storyboard')
        .map(({ kind, idx }) => {
        // 与 handleActivate 同口径：无绑定时页签 key 为裸 kind
        const key = slotTabKey(kind, slotBindings) ?? kind;
        const active = activeTabKey === key;
        const label = t(SLOT_LABEL_KEY[kind], SLOT_FALLBACK_LABEL[kind]);
        const className = [
          'zx-canvas-tab',
          active ? 'is-active' : '',
        ].filter(Boolean).join(' ');
        return (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={active}
            draggable
            data-slot-kind={kind}
            data-active={active || undefined}
            className={className}
            onClick={() => handleActivate(kind)}
            onDragStart={(e) => {
              setDragIndex(idx);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', kind);
            }}
            onDragOver={(e) => {
              // 仅当有拖拽源时允许放置，避免误触
              if (dragIndex === null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null && dragIndex !== idx) reorderSlots(dragIndex, idx);
              setDragIndex(null);
            }}
            onDragEnd={() => setDragIndex(null)}
            title={label}
          >
            <SlotIcon kind={kind} active={active} />
            {label}
          </button>
        );
      })}

      {/* 副本画布标签（征集#184）：本质都是本项目目录下的画布，与 1 号平级并排。
          外观沿用同一套 .zx-canvas-tab（分段胶囊），只多一个 ×；1 号是上面的固定槽位，不重复出现。 */}
      {copyTabs.map((tab, idx) => {
        const active = activeTabKey === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            draggable
            data-canvas-copy-tab={tab.cid}
            data-active={active || undefined}
            className={['zx-canvas-tab', active ? 'is-active' : ''].filter(Boolean).join(' ')}
            onClick={() => activateTab(tab.key)}
            onDragStart={(e) => {
              setCopyDragIndex(idx);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', tab.key);
            }}
            onDragOver={(e) => {
              if (copyDragIndex === null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (copyDragIndex !== null && copyDragIndex !== idx) reorderCanvasTabs(copyDragIndex, idx);
              setCopyDragIndex(null);
            }}
            onDragEnd={() => setCopyDragIndex(null)}
            title={tab.title}
          >
            <CANVAS_COPY_TAB_ICON size={13} strokeWidth={active ? 2.2 : 1.8} />
            <span className="zx-canvas-tab-label">{tab.title}</span>
            <span
              role="button"
              tabIndex={0}
              aria-label={t('canvasTab.close', '关闭页签')}
              data-canvas-copy-close={tab.cid}
              className="zx-canvas-tab-close"
              onClick={(e) => { e.stopPropagation(); closeCanvasTab(tab.key); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); closeCanvasTab(tab.key); } }}
            >
              <CANVAS_TAB_CLOSE_ICON size={12} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
