/**
 * ConfirmDialog - 通用确认弹窗(antd Modal 版)
 *
 * 基于 antd Modal 封装,提供统一的"取消 + 确认"底部按钮。
 * danger=true 时确认按钮使用危险色(红色描边)。
 * 用于数据安全核心组:删画布/清空画布/删组/删素材/删提示词/同步失败。
 */

import type { ReactNode } from 'react';
import { Modal, Button } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  /** 正文内容 */
  children: ReactNode;
  /** 确认按钮文案(默认 common.confirm) */
  confirmLabel: string;
  /** 取消按钮文案(默认 common.cancel) */
  cancelLabel: string;
  /** 危险操作:确认按钮使用 danger 样式(红色描边) */
  danger?: boolean;
  /** 确认按钮是否处于 loading 态(禁用 + 文案不变由调用方控制) */
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  /** Modal 宽度(默认 440) */
  width?: number;
  /** z-index(默认 1050；需要盖住画布浮层时传更高值) */
  zIndex?: number;
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel,
  danger = false,
  loading = false,
  onConfirm,
  onClose,
  width = 440,
  zIndex = 1050,
}: ConfirmDialogProps): React.ReactElement {
  const { theme } = useTheme();

  return (
    <Modal
      open={open}
      title={title}
      width={width}
      centered
      zIndex={zIndex}
      onCancel={onClose}
      destroyOnHidden
      styles={{ mask: { background: 'transparent' } }}
      footer={
        <>
          <Button onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            type="primary"
            danger={danger}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div style={{ fontSize: 13, lineHeight: 1.6, color: theme.toolbar.text }}>{children}</div>
    </Modal>
  );
}
