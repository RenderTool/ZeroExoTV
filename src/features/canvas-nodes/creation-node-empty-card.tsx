/**
 * CreationNodeEmptyCard - 剧创节点统一空态卡（Plan#74 Phase G）
 *
 * 🔴 单一实现：script / storyboard / workbench 三节点未生成态共用本组件，
 * 禁止各 sheet 再各写一份空态（用户明令 no duplicate implementation）。
 *
 * 形态（2026-09-05 约定）：3:4 竖卡（360×480）内 = 顶部节点图标 + 统一按钮组
 * （沿用出片 IdleState 的 icon+label 行按钮风格）；**不放任何提示文案**（尊重用户懂产品心智）。
 * 按钮配置由调用方按节点类型传入（actions），本组件只负责一致的视觉与布局。
 */
import type { CSSProperties, ReactElement } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';

/** 空态卡单个动作（图标 + 单行标签，无描述副行） */
export interface EmptyCardAction {
  key: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}

export function CreationNodeEmptyCard({
  icon: Icon,
  actions,
}: {
  /** 顶部节点图标（FileText/Aperture/Film…） */
  icon: LucideIcon;
  actions: EmptyCardAction[];
}): ReactElement {
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const iconStroke = isDark ? 'rgba(255,255,255,0.62)' : 'rgba(0,0,0,0.55)';
  const textLabel = isDark ? 'rgba(255,255,255,0.74)' : 'rgba(0,0,0,0.62)';
  const rowBgHover = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)';

  const rowStyle: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
    padding: '8px 12px', borderRadius: 9, border: 'none', backgroundColor: 'transparent',
    cursor: 'pointer', textAlign: 'left', transition: 'background-color 140ms ease', color: 'inherit',
  };

  return (
    <div
      style={{
        flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
        // 2026-09-06 约定：图标区 + 按钮组整体顶部对齐（禁止垂直居中，否则按钮数量不同导致各节点视觉参差）。
        // 上部分=图标区，下部分=快捷键注册区；图标与首行按钮在节点间严格对齐，底部自由延展。
        alignItems: 'center', justifyContent: 'flex-start', gap: 22, padding: '40px 40px 0',
      }}
    >
      {/* 顶部节点图标（图标区，固定顶对齐） */}
      <Icon size={48} strokeWidth={1.4} color={iconStroke} />
      {/* 统一按钮组（快捷键区，紧随图标下方，首行顶部对齐） */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%', maxWidth: 240 }}>
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            onClick={a.onClick}
            style={rowStyle}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = rowBgHover; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
          >
            <a.icon size={16} strokeWidth={1.8} color={iconStroke} />
            <span style={{ fontSize: 13, fontWeight: 500, color: textLabel, lineHeight: 1.3 }}>{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
