/**
 * card-send-actions - 卡片发送动作 · 单一定义源（2026-11-05 用户拍板）
 *
 * 用户反馈（2026-11-05）：「为什么我的素材没有发送到导演台的按钮？但开源素材却有？」
 * 拍板口径：**卡片动作在所有作用域（公共资产 / 本项目资产 / 开源库）完全一致**——
 * 同一套动作（发送到画布 / 发送到导演台当前片段），同一份定义（本文件），同一执行器
 * （store.sendToCanvas / sendAssetToWorkbench），同一表现形式（hover 动作按钮 + 右键菜单，
 * 文案相同、顺序相同：先画布后导演台）。开源库只额外标注「只读」（不可编辑/删除），
 * 动作本身不减。
 *
 * 不支持导演台的素材类型（纯文本/剧本）→ 按同一规则（canSendKindToDirector）在所有
 * 作用域统一置灰并给一致说明（workbench.unsupportedKind），不许只在一个作用域悄悄消失。
 */

import type { TFunction } from 'i18next';
import { Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { Clapperboard, Loader2, Send } from 'lucide-react';

// ===== 能力规则（与 workbench-slot-bus 槽位分配同口径） =====

/** 导演台槽位支持的素材类型（image/video/audio；纯文本、剧本不支持） */
export const DIRECTOR_SUPPORTED_KINDS = ['image', 'video', 'audio'] as const;

export function canSendKindToDirector(kind: string | undefined): boolean {
  return kind === 'image' || kind === 'video' || kind === 'audio';
}

// ===== 动作键与文案键（三作用域唯一定义，顺序固定） =====

export const SEND_ACTION_KEYS = ['sendToCanvas', 'sendToDirector'] as const;
export type SendActionKey = (typeof SEND_ACTION_KEYS)[number];

export const SEND_ACTION_LABEL_KEYS: Record<SendActionKey, string> = {
  sendToCanvas: 'assetLibrary.sendToCanvas',
  sendToDirector: 'assetLibrary.sendToDirector',
};

// ===== 竖排动作按钮样式（提示词卡/素材卡同款：28×28 半透明黑） =====

export const cardActionBtnStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  padding: 0,
  border: 'none',
  borderRadius: 6,
  background: 'rgba(0,0,0,0.45)',
  color: '#fff',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 0.15s',
};

export interface SendActionHandlers {
  /** 发送到画布（store.sendToCanvas 链路） */
  onSendToCanvas?: () => void;
  /** 发送到导演台当前片段（sendAssetToWorkbench 链路） */
  onSendToDirector?: () => void;
  /** 素材类型（image/video/audio/text/script…）；决定导演台动作可用性（统一置灰规则） */
  kind?: string;
  /** 开源库首用下载中：两钮转圈禁用（用户资产恒为 false） */
  importing?: boolean;
  /**
   * 画布目标不可用（如独立开源库页 #/openlib 无打开中的画布）：
   * 按统一置灰规则禁用画布动作并给一致说明（openLib.noCanvasTarget），
   * 与「纯文本不能发导演台」同款处理——按钮/菜单项仍渲染，不许悄悄消失。
   */
  canvasDisabled?: boolean;
}

/**
 * 统一 hover 动作按钮（顺序固定：画布 → 导演台）。
 * - 两处理器齐备 → 两枚按钮；
 * - 仅画布 → 一枚（无导演台上下文的场景）；
 * - 导演台不支持该类型 → 按钮置灰 + Tooltip 说明（所有作用域同一规则）；
 * - 两处理器皆无 → 不渲染。
 *
 * 定位规则（2026-11-05 修正“两套图标”）：**默认内联**（由宿主放在标题行右侧），
 * 组件自身不再硬编码 `position:absolute; top:8; right:8`——旧写法在两个宿主里
 * 分别相对封面 / 相对标题行，导致同一组按钮出现在两个不同位置。宿主确实需要
 * 浮在封面上的场景，显式传 `overlay` 才启用绝对定位。
 */
export function SendActionButtons({
  onSendToCanvas,
  onSendToDirector,
  kind,
  importing,
  canvasDisabled,
  visible,
  alwaysVisible,
  overlay,
  t,
}: SendActionHandlers & {
  /** hover 可见性（opacity 过渡，触屏设备常驻半透明见 alwaysVisible） */
  visible: boolean;
  /** 常驻可见（抽屉窄列/触屏无 hover 时用；默认跟随 visible 过渡） */
  alwaysVisible?: boolean;
  /** 宿主显式要求浮在封面上（绝对定位右上角）；默认 false = 内联排在标题行右侧 */
  overlay?: boolean;
  t: TFunction;
}): React.ReactElement | null {
  if (!onSendToCanvas && !onSendToDirector) return null;
  const directorDisabled = !!onSendToDirector && !importing && !canSendKindToDirector(kind);
  const opacity = alwaysVisible ? (visible ? 1 : 0.75) : visible ? 1 : 0;
  const btn = (extra?: Partial<React.CSSProperties>): React.CSSProperties => ({
    ...cardActionBtnStyle,
    opacity,
    cursor: importing ? 'wait' : 'pointer',
    transition: 'opacity 0.2s, background 0.15s',
    ...extra,
  });
  return (
    <div
      style={{
        ...(overlay
          ? { position: 'absolute', top: 8, right: 8, zIndex: 10 }
          : { flexShrink: 0 }),
        display: 'inline-flex',
        gap: 4,
      }}
    >
      {onSendToCanvas && (
        <Tooltip title={importing ? t('openLib.importing') : canvasDisabled ? t('openLib.noCanvasTarget') : t(SEND_ACTION_LABEL_KEYS.sendToCanvas)}>
          <button
            type="button"
            data-card-action="sendToCanvas"
            aria-label={t(SEND_ACTION_LABEL_KEYS.sendToCanvas)}
            disabled={!!importing || !!canvasDisabled}
            style={btn(canvasDisabled && !importing ? { opacity: visible ? 0.45 : 0, cursor: 'not-allowed' } : undefined)}
            onClick={(e) => { e.stopPropagation(); onSendToCanvas(); }}
          >
            {importing ? <Loader2 size={13} style={{ animation: 'zeroexo-card-spin 1s linear infinite' }} /> : <Send size={13} />}
          </button>
        </Tooltip>
      )}
      {onSendToDirector && (
        <Tooltip title={directorDisabled ? t('workbench.unsupportedKind') : t(SEND_ACTION_LABEL_KEYS.sendToDirector)}>
          <button type="button" data-card-action="sendToDirector" aria-label={t(SEND_ACTION_LABEL_KEYS.sendToDirector)} disabled={directorDisabled || !!importing} style={btn(directorDisabled ? { opacity: visible ? 0.45 : 0, cursor: 'not-allowed' } : undefined)} onClick={(e) => { e.stopPropagation(); if (!directorDisabled) onSendToDirector(); }}>
            <Clapperboard size={13} />
          </button>
        </Tooltip>
      )}
      <style>{'@keyframes zeroexo-card-spin{to{transform:rotate(360deg)}}'}</style>
    </div>
  );
}

// ===== 右键菜单项（与 hover 按钮同定义同顺序；供各作用域卡片 contextMenu 复用） =====

/**
 * 返回类型直接用 antd 的 `MenuProps['items']`：本文件所在 antd 版本的 Dropdown/Menu
 * 对独立 interface（如旧 SendMenuItem）做联合收窄会误判到 SubMenuType（要求 children），
 * 字面量走上下文类型即可通过——返回值保持 antd 原生 items 类型，调用方零 cast。
 */
export function buildSendMenuItems({ onSendToCanvas, onSendToDirector, kind, canvasDisabled, t }: SendActionHandlers & { t: TFunction }): NonNullable<MenuProps['items']> {
  const items: NonNullable<MenuProps['items']> = [];
  if (onSendToCanvas) {
    items.push({
      key: 'sendToCanvas',
      icon: <Send size={13} />,
      label: t(SEND_ACTION_LABEL_KEYS.sendToCanvas) + (canvasDisabled ? `（${t('openLib.noCanvasTarget')}）` : ''),
      disabled: !!canvasDisabled,
      onClick: onSendToCanvas,
    });
  }
  if (onSendToDirector) {
    const disabled = !canSendKindToDirector(kind);
    items.push({
      key: 'sendToDirector',
      icon: <Clapperboard size={13} />,
      label: t(SEND_ACTION_LABEL_KEYS.sendToDirector) + (disabled ? `（${t('workbench.unsupportedKind')}）` : ''),
      disabled,
      onClick: onSendToDirector,
    });
  }
  return items;
}
