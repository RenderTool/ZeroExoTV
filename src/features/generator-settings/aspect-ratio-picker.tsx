/**
 * AspectRatioPicker — 线上生成器同款「比例九宫格」：每个比例画一个真实宽高比的方框 + 文字。
 *
 * 为什么抽出来：画布节点参数面板与导演台「参数」面板必须共用同一套比例 UI，
 * 不再各自用 antd Select / 手写胶囊（客户反馈两处观感不一致、像业余实现）。
 */
import type { ThemeConfig } from '@zeroexo/plugin-theme';

export interface RatioOption {
  value: string;
  label: string;
  /** 宽/高；0 = auto（由参考图决定） */
  ratio: number;
}

export const RATIO_OPTIONS: RatioOption[] = [
  { value: '16:9', label: '16:9', ratio: 16 / 9 },
  { value: '9:16', label: '9:16', ratio: 9 / 16 },
  { value: '1:1', label: '1:1', ratio: 1 },
  { value: '4:3', label: '4:3', ratio: 4 / 3 },
  { value: '3:4', label: '3:4', ratio: 3 / 4 },
  { value: '21:9', label: '21:9', ratio: 21 / 9 },
];

/** 比例示意图（与线上 SizeRenderer 的 AspectIcon 同款：最大边 24px 的比例框） */
export function RatioBox({ ratio, color }: { ratio: number; color: string }): React.ReactElement {
  if (ratio === 0) {
    return <span style={{ height: 24, display: 'inline-flex', alignItems: 'center', fontSize: 11, opacity: 0.6 }}>auto</span>;
  }
  const boxWidth = ratio >= 1 ? 24 : Math.max(10, 24 * ratio);
  const boxHeight = ratio >= 1 ? Math.max(10, 24 / ratio) : 24;
  return (
    <span style={{ height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ width: boxWidth, height: boxHeight, border: `2px solid ${color}`, borderRadius: 2 }} />
    </span>
  );
}

export function AspectRatioPicker({
  value,
  onChange,
  theme,
  options = RATIO_OPTIONS,
}: {
  value: string;
  onChange: (value: string) => void;
  theme: ThemeConfig;
  options?: RatioOption[];
}): React.ReactElement {
  const textColor = theme.toolbar.text;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }} data-aspect-picker>
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            data-aspect-option={opt.value}
            data-selected={selected ? 'true' : undefined}
            aria-pressed={selected}
            onClick={() => onChange(opt.value)}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              height: 56,
              minWidth: 64,
              flex: '1 1 64px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              borderRadius: 10,
              border: `1px solid ${selected ? theme.toolbar.accent : theme.toolbar.border}`,
              background: selected
                ? (theme.mode === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.08)')
                : 'transparent',
              color: textColor,
              cursor: 'pointer',
              fontSize: 11,
              fontFamily: 'inherit',
            }}
          >
            <RatioBox ratio={opt.ratio} color={textColor} />
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
