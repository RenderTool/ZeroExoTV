/**
 * GenerationStatusBar —— 生成态唯一 footbar（2026-11-22 用户拍板「统一成节点内一条 footbar」）。
 *
 * 为什么要有它：
 *   同一个「取消 / 重试」以前散在四处（节点内容层、底栏 dock、占位卡 error、占位卡 generating），
 *   用户一次生成会同时看到两三颗按钮，文案也各拼各的（网络错误 / 本机作业已取消 / 生成失败：生成失败）。
 *   这里收成一条：左边状态与进度，右边**同一时刻只有一个动作**。
 *
 * 契约：
 *   - 生成中 → 只有「取消」；失败 → 只有「重试」；已取消/完成 → 没有按钮。
 *   - action 为空就不渲染按钮，不做"隐藏的兜底入口"。
 *   - 所有可点元素自己打开 pointerEvents='auto'：节点外层容器是 none（为了能拖画布），
 *     子元素默认继承会点不动（2026-11-22 报障「取消按钮点不了」）。
 */

export type GenerationPhase = 'running' | 'canceling' | 'error' | 'canceled' | 'done';

export interface GenerationStatusAction {
  kind: 'cancel' | 'retry';
  label: string;
  onClick: () => void;
}

export interface GenerationStatusBarProps {
  phase: GenerationPhase;
  /** 左侧状态文案：如「生成中 4/25 · QwenImage2.1」「失败 · ComfyUI 无响应」 */
  text: string;
  /** 右侧唯一动作；不传 = 该状态没有可执行动作 */
  action?: GenerationStatusAction;
  /** 进度 0-100；没有确定进度传 null（不编造进度） */
  percent?: number | null;
  accentColor?: string;
  /** overlay：浮在预览图/内容上（半透明）；solid：替代原来那块红错面板 */
  variant?: 'overlay' | 'solid';
}

const PHASE_DOT: Record<GenerationPhase, string> = {
  running: '#8b5cf6',
  canceling: '#9ca3af',
  error: '#ef4444',
  canceled: '#9ca3af',
  done: '#10b981',
};

export function GenerationStatusBar({
  phase,
  text,
  action,
  percent,
  accentColor,
  variant = 'overlay',
}: GenerationStatusBarProps): React.ReactElement {
  const dot = accentColor && phase === 'running' ? accentColor : PHASE_DOT[phase];
  const pct = typeof percent === 'number' ? Math.max(0, Math.min(100, percent)) : null;
  const overlay = variant === 'overlay';

  return (
    <div
      data-generation-status-bar
      data-phase={phase}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: overlay ? 'absolute' : 'relative',
        left: overlay ? 0 : undefined,
        right: overlay ? 0 : undefined,
        bottom: overlay ? 0 : undefined,
        // 2026-11-22 报障「点不了取消」：这一条贴在节点底边，右下角正好是画布的
        // resize 句柄（react-flow 会盖住底下十几像素），按钮点下去落到句柄上。
        // 抬高整条层级 + 右侧留出句柄宽度，取消才是真的可点。
        zIndex: 12,
        height: 28,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: overlay ? '0 20px 0 8px' : '0 8px',
        boxSizing: 'border-box',
        background: overlay
          ? 'linear-gradient(to top, rgba(10,10,12,0.86), rgba(10,10,12,0.42))'
          : 'rgba(20,20,23,0.96)',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        pointerEvents: 'auto',
        fontFamily: 'inherit',
      }}
    >
      {/* 确定性进度：贴在 footbar 顶沿的一条细线，不遮挡状态文字 */}
      {pct !== null ? (
        <div
          data-generating-progress
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height: 2,
            background: 'rgba(255,255,255,0.10)',
            overflow: 'hidden',
          }}
        >
          <div
            data-generating-progress-bar
            style={{
              height: '100%',
              width: `${pct}%`,
              background: dot,
              transition: 'width 0.2s linear',
            }}
          />
        </div>
      ) : null}

      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: dot,
          flexShrink: 0,
          boxShadow: phase === 'error' ? 'none' : `0 0 0 1px ${dot}33`,
        }}
      />
      <span
        data-generation-status-text
        data-generating-progress-text
        title={text}
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 10.5,
          lineHeight: 1.2,
          color: phase === 'error' ? '#fca5a5' : 'rgba(255,255,255,0.86)',
          fontWeight: 500,
          letterSpacing: 0.1,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {text}
      </span>

      {action ? (
        <button
          type="button"
          data-generation-status-action={action.kind}
          data-generating-cancel={action.kind === 'cancel' ? '' : undefined}
          onClick={(e) => {
            e.stopPropagation();
            action.onClick();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: 'relative',
            zIndex: 13,
            flexShrink: 0,
            height: 20,
            padding: '0 8px',
            borderRadius: 4,
            // 外层可能是 pointerEvents:none 的加载容器，按钮必须自己打开
            pointerEvents: 'auto',
            border: `1px solid ${action.kind === 'cancel' ? 'rgba(255,255,255,0.22)' : 'rgba(239,68,68,0.45)'}`,
            background: action.kind === 'cancel' ? 'rgba(255,255,255,0.06)' : 'rgba(239,68,68,0.16)',
            color: action.kind === 'cancel' ? 'rgba(255,255,255,0.88)' : '#fca5a5',
            fontSize: 10.5,
            fontWeight: 500,
            cursor: phase === 'canceling' ? 'default' : 'pointer',
            opacity: phase === 'canceling' ? 0.5 : 1,
            fontFamily: 'inherit',
          }}
          disabled={phase === 'canceling'}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
