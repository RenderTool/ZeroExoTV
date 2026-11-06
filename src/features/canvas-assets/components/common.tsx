/**
 * canvas-assets/components/common - 画布资产抽屉通用展示组件（纯渲染，数据由 store 驱动）
 *
 * 与主页资产库不共享任何编排层；仅复用 antd / lucide 等基础 UI 元件。
 */

import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Pagination } from 'antd';
import { ChevronDown, Search, Upload } from 'lucide-react';
import type { ThemeConfig } from '@zeroexo/shared';

// ===== 分组 Tab =====

export interface GroupTabItem {
  key: string;
  label: string;
  icon?: ReactNode;
  /** 激活态替换图标（如素材 Package→PackageOpen，与顶栏资产库按钮同款两态） */
  activeIcon?: ReactNode;
  count?: number;
}

/** 侧边栏导航（纯图标，无文字 label，无数字角标） */
export function SidebarNav({ items, active, onChange, theme }: {
  items: GroupTabItem[];
  active: string;
  onChange: (key: string) => void;
  theme: ThemeConfig;
}): React.ReactElement {
  // 2026-09-01 约定：视觉规格与主页 AppSidebar 完全一致（40×40 / radius 10 / 间距 4 / 容器 padding 8 10，列宽 60 = SIDEBAR_COLLAPSED），
  // 激活态禁用纯色 accent 底（用户：丑陋的红色），改主页同款 accent 18% 透明底 + accent 前景线条图标
  const accent = theme.toolbar.accent;
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      padding: '8px 10px',
      flexShrink: 0,
    }}>
      {items.map((item) => {
        const isActive = active === item.key;
        return (
          <div
            key={item.key}
            onClick={() => onChange(item.key)}
            // 2026-08-31 修复：纯图标 sidebar 无任何提示，hover 必须显示 label（原生 title，全项目 icon 按钮惯例）
            title={item.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 40,
              height: 40,
              borderRadius: 10,
              cursor: 'pointer',
              background: isActive ? `${accent}18` : 'transparent',
              color: isActive ? accent : theme.toolbar.textMuted,
              transition: 'background 0.15s, color 0.15s, transform 0.15s',
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = theme.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
              }
              // 用户长期偏好：图标 hover 缩放动画（与主页 sidebar 动态图标一致）
              e.currentTarget.style.transform = 'scale(1.1)';
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = 'transparent';
              }
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            {isActive && item.activeIcon ? item.activeIcon : item.icon}
          </div>
        );
      })}
    </div>
  );
}

export function GroupTabs({ items, active, onChange, theme }: {
  items: GroupTabItem[];
  active: string;
  onChange: (key: string) => void;
  theme: ThemeConfig;
}): React.ReactElement {
  return (
    <div style={{
      display: 'flex',
      flexWrap: 'nowrap',
      overflowX: 'auto',
      overflowY: 'hidden',
      padding: '0 20px 0',
      gap: 24,
      flexShrink: 0,
    }}>
      {items.map((item) => {
        const isActive = active === item.key;
        return (
          <div
            key={item.key}
            onClick={() => onChange(item.key)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 36,
              fontSize: 13,
              fontWeight: isActive ? 500 : 400,
              color: isActive ? theme.toolbar.text : theme.toolbar.textMuted,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              position: 'relative',
            }}
          >
            {item.icon}
            {item.label}
            {typeof item.count === 'number' && item.count > 0 && (
              <span style={{ fontSize: 11, opacity: 0.5 }}>{item.count}</span>
            )}
            <span style={{
              position: 'absolute',
              bottom: 0, left: 0, right: 0,
              height: 2,
              borderRadius: 1,
              background: isActive ? theme.toolbar.accent : 'transparent',
            }} />
          </div>
        );
      })}
    </div>
  );
}

// ===== 来源切换（我的 / 公共，显眼分段按钮） =====

export function SourceSwitch({ value, onChange, theme }: {
  value: string;
  onChange: (v: string) => void;
  theme: ThemeConfig;
}): React.ReactElement {
  const { t } = useTranslation();
  const options = [
    { key: 'mine', label: t('promptSource.mine') },
    { key: 'public', label: t('promptSource.public') },
  ];
  return (
    <div style={{
      display: 'inline-flex',
      padding: 2,
      borderRadius: 6,
      background: theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
      flexShrink: 0,
    }}>
      {options.map((opt) => {
        const selected = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            style={{
              padding: '3px 10px',
              borderRadius: 4,
              border: 'none',
              fontSize: 12,
              fontWeight: selected ? 600 : 400,
              color: selected ? '#fff' : theme.toolbar.textMuted,
              background: selected ? theme.toolbar.accent : 'transparent',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ===== 分类 chips =====

export function CategoryChips({ items, active, onChange, theme }: {
  items: Array<{ key: string | null; label: string; count?: number }>;
  active: string | null;
  onChange: (key: string | null) => void;
  theme: ThemeConfig;
}): React.ReactElement {
  return (
    <div style={{
      display: 'flex',
      // 2026-08-31 约定：分类标签不用水平滚动，flex 自适应换行
      flexWrap: 'wrap',
      gap: 4,
      flexShrink: 0,
    }}>
      {items.map((item) => {
        const selected = (item.key ?? null) === active;
        return (
          <button
            key={item.key ?? 'all'}
            type="button"
            onClick={() => onChange(item.key ?? null)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              height: 24,
              padding: '0 8px',
              fontSize: 11,
              fontWeight: selected ? 600 : 400,
              borderRadius: 6,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              border: selected ? `1px solid ${theme.toolbar.accent}` : '1px solid transparent',
              background: selected ? theme.toolbar.accent : 'transparent',
              color: selected ? '#fff' : theme.toolbar.textMuted,
            }}
          >
            {item.label}
            {typeof item.count === 'number' && item.count > 0 && (
              <span style={{ fontSize: 10, opacity: 0.6 }}>{item.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ===== 搜索框 =====

export function SearchBox({ value, onChange, placeholder, theme, inputData }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  theme: ThemeConfig;
  /** 透传到 input 的 data-* 标记（供宿主的结构断言/测试定位，不改变任何样式） */
  inputData?: Record<string, string>;
}): React.ReactElement {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      flex: 1,
      minWidth: 0,
      height: 26,
      padding: '0 8px',
      borderRadius: 6,
      background: theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
    }}>
      <Search size={12} style={{ opacity: 0.4, flexShrink: 0 }} />
      <input
        {...inputData}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          flex: 1,
          minWidth: 0,
          border: 'none',
          outline: 'none',
          background: 'transparent',
          fontSize: 12,
          color: theme.toolbar.text,
          fontFamily: 'inherit',
        }}
      />
    </div>
  );
}

// ===== 分页 =====

export function PaginationBar({ page, total, pageSize, onChange }: {
  page: number;
  total: number;
  pageSize: number;
  onChange: (p: number) => void;
}): React.ReactElement | null {
  if (total <= pageSize) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0', flexShrink: 0 }}>
      <Pagination current={page} total={total} pageSize={pageSize} onChange={onChange} showSizeChanger={false} size="small" />
    </div>
  );
}

// ===== 空态 / 错误态 =====

export function EmptyState({ text, theme }: { text?: string; theme: ThemeConfig }): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div style={{
      padding: 60,
      textAlign: 'center',
      fontSize: 13,
      color: theme.toolbar.textMuted,
    }}>
      {text ?? t('assetLibrary.empty')}
    </div>
  );
}

export function ErrorBar({ message, onRetry }: {
  message: string;
  onRetry: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '8px 12px',
      borderRadius: 8,
      fontSize: 12,
      background: 'rgba(239,68,68,0.08)',
      color: '#ef4444',
      flexShrink: 0,
    }}>
      <span style={{ flex: 1 }}>{message}</span>
      <Button size="small" onClick={onRetry}>{t('common.retry', { defaultValue: '重试' })}</Button>
    </div>
  );
}

// ===== 加载骨架 =====

export function SkeletonGrid({ theme }: { theme: ThemeConfig }): React.ReactElement {
  const isDark = theme.mode === 'dark';
  const bg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, padding: '4px 20px' }}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} style={{ height: 120, borderRadius: 10, background: bg }} />
      ))}
    </div>
  );
}

// ===== 工具栏行（筛选 + 搜索） =====

/**
 * 抽屉各分段内容滚动区统一形态（2026-11-06，征集 #182）：
 * `scrollbar-gutter: stable` 常驻滚动条槽——否则内容超高与否会切换 ~15px 可用宽度，
 * 而瀑布流列数与卡片高度都由宽度算 →「宽度 ↔ 列数/高度 ↔ 滚动条」构成反馈环，
 * 抽屉拖到某些尺寸时打开就持续抖动。列数侧另有滞回（shared/utils/stable-columns）兜底。
 */
export const SCROLL_AREA_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  scrollbarGutter: 'stable',
};

export function ToolbarRow({ children, style, dataAttr }: { children: ReactNode; style?: CSSProperties; dataAttr?: Record<string, string> }): React.ReactElement {
  return (
    <div
      {...dataAttr}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 20px 10px',
        flexWrap: 'nowrap',
        overflowX: 'auto',
        flexShrink: 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ===== 虚线加号格子（新建入口） =====

/**
 * 抽屉底端「新建/上传」单一形态（2026-11-05 用户拍板：主体库「添加主体」必须与素材「上传素材」
 * 同款同位）：整宽虚线框 + 左图标 + 文案，中性色（不用强调色/品牌红）。
 * icon 缺省 = Upload（上传语义）；新建语义传 Plus，不再另造一套按钮样式。
 */
export function AddTile({ label, onClick, theme, icon, dataAttr }: {
  label: string;
  onClick: () => void;
  theme: ThemeConfig;
  /** 左侧图标（缺省 Upload） */
  icon?: ReactNode;
  /** 透传 data-* 标记（供宿主结构断言/测试定位，不改变任何样式） */
  dataAttr?: Record<string, string>;
}): React.ReactElement {
  const isDark = theme.mode === 'dark';
  return (
    <button
      type="button"
      onClick={onClick}
      {...dataAttr}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        width: '100%',
        height: 44,
        flexShrink: 0,
        border: `1.5px dashed ${isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)'}`,
        borderRadius: 8,
        background: 'transparent',
        color: theme.toolbar.textMuted,
        fontSize: 12,
        fontWeight: 500,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {icon ?? <Upload size={16} />}
      {label}
    </button>
  );
}

// ===== 折叠触发（ChevronDown 图标按钮，通用） =====

export function ChevronButton(): React.ReactElement {
  return <ChevronDown size={12} style={{ opacity: 0.6, flexShrink: 0 }} />;
}
