/**
 * 顶栏「历史版本」图标按钮（2026-11-19）
 *
 * Logo 菜单里已有同一入口，但用户反馈找不到；这里在顶栏直接放一个图标按钮，
 * 与 Logo 菜单共用同一个 CanvasHistoryDialog。
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TopBarIconButton } from '@/shared/components/topbar-icon-button.js';
import { CanvasHistoryDialog } from './canvas-history-dialog.js';

export interface CanvasHistoryButtonProps {
  projectId: string;
}

export function CanvasHistoryButton({ projectId }: CanvasHistoryButtonProps): React.ReactElement {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <TopBarIconButton
        action="history"
        tooltip={t('menu.canvasHistory', '历史版本')}
        ariaLabel={t('menu.canvasHistory', '历史版本')}
        testId="topbar-canvas-history"
        onClick={() => setOpen(true)}
      />
      <CanvasHistoryDialog open={open} onClose={() => setOpen(false)} projectId={projectId} />
    </>
  );
}
