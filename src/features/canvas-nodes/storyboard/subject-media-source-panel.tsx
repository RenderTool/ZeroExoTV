/**
 * SubjectMediaSourcePanel — 主体状态媒体来源面板（2026-11-05 定稿，2026-11-13 收口到统一插槽页）
 *
 * 与导演台插槽页、画布参考素材区是**同一个实现**（`@/shared/components/asset-slot-picker`）：
 * 画布 / 资产 / 主体三个分区、搜索、右侧只读详情、导入资产一条上传链。
 *
 * 媒体写入仍统一走 linkSubjectStateMedia（不复制文件，只挂引用）：
 * - 手动上传的文件只落 CAS、不写资产库，引用由主体状态 ref 保活；
 * - 顶部显示当前资源 + 移除（替换语义）。
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import { AssetSlotPicker, type AssetSlotPick } from '@/shared/components/asset-slot-picker.js';
import type { SubjectMediaOrigin } from './subject-tree-types';
import type { SubjectStateMediaAsset } from './subject-state-media';

export interface SubjectMediaSourcePanelProps {
  open: boolean;
  onClose: () => void;
  theme: ThemeConfig;
  projectId?: string;
  anchorEl?: HTMLElement | null;
  current?: { storageKey: string; kind: 'image' | 'audio' | 'video' } | null;
  onPick: (asset: SubjectStateMediaAsset) => void;
  onRemove?: () => void;
}

export const SubjectMediaSourcePanel = memo(function SubjectMediaSourcePanel({
  open, onClose, theme, projectId, anchorEl, current, onPick, onRemove,
}: SubjectMediaSourcePanelProps): React.ReactElement | null {
  const { t } = useTranslation();
  return (
    <AssetSlotPicker
      open={open}
      onClose={onClose}
      theme={theme}
      projectId={projectId}
      anchorEl={anchorEl}
      acceptKinds={['image', 'audio']}
      initialTab="canvas"
      current={current && current.kind !== 'video' ? { storageKey: current.storageKey, kind: current.kind } : null}
      onRemoveCurrent={onRemove}
      uploadHint={t('subject.uploadScopedHint', '手动上传仅归属该主体，不进入公共/项目资产库')}
      onPick={(pick: AssetSlotPick) => {
        const origin: SubjectMediaOrigin = pick.origin === 'canvas'
          ? { type: 'canvas', fromNodeId: pick.fromNodeId, label: pick.title }
          : pick.origin === 'library'
            ? { type: 'library', label: pick.title }
            : pick.origin === 'upload'
              ? { type: 'upload', label: pick.title }
              : { type: 'project', label: pick.title };
        onPick({
          storageKey: pick.storageKey,
          kind: pick.kind === 'audio' ? 'audio' : 'image',
          origin,
        });
      }}
    />
  );
});
