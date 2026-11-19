/**
 * ReadOnlyCanvasOverlay - 只读历史画布的顶部标识条
 *
 * 只读**不改操作习惯**：画布平移/滚轮缩放/双击聚焦全部走画布自己的手势，
 * 这里只渲染一条胶囊（「只读 · 历史生成链路」+「生成同款」），不覆盖画布、不拦截指针。
 *
 * 真正的写保护在数据层：editor-page 在只读时把 commandQueue.execute 拦掉，
 * 任何入口（胶囊工具栏、右键菜单、拖拽、连线、快捷键）都改不动图。
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Eye } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';

interface ReadOnlyCanvasOverlayProps {
  isReadOnlyViewer: boolean;
  loading: boolean;
}

export function ReadOnlyCanvasOverlay({
  isReadOnlyViewer,
  loading,
}: ReadOnlyCanvasOverlayProps): React.ReactElement | null {
  const { t } = useTranslation();
  const theme = useTheme().theme;
  if (!isReadOnlyViewer || loading) return null;

  return (
    <div
      data-testid="readonly-chain-bar"
      style={{
        position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 46,
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '4px 12px', borderRadius: 999,
        background: theme.toolbar.panel,
        border: `1px solid ${theme.toolbar.border}`,
        color: theme.toolbar.textMuted, fontSize: 12,
        pointerEvents: 'none',
      }}
    >
      <Eye size={13} />
      <span>{t('canvasCopy.readOnlyChainBadge', '只读 · 历史生成链路')}</span>
      <span style={{ opacity: 0.75 }}>{t('canvasCopy.readOnlyChainHint', '点击任意节点查看提示词与参数')}</span>
    </div>
  );
}
