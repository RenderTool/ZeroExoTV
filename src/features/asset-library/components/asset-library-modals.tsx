/**
 * asset-library-modals - 资产库所有弹窗组件
 *
 * 从 asset-library-page.tsx 抽出所有 Modal/弹窗。
 */

import { memo, useMemo } from 'react';
import { Input, Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import type { ContextMenuItem } from '@/shared/components/index.js';
import { ContextMenu } from '@/shared/components/index.js';
import { MediaLightbox, type MediaLightboxItem, type MediaLightboxKind } from '@/shared/components/media-lightbox.js';
import { ScriptFullscreenEditor } from '@/features/canvas-nodes/storyboard/script-fullscreen-editor.js';
import { ScriptImportFlow } from '@/features/canvas-nodes/storyboard/components/script-import-flow.js';
import { UploadQueueOverlay } from '@/features/upload-queue/index.js';
import { CLOUD_ENABLED } from '@/services/sync/sync-store.js';
import type { Episode } from '@/features/canvas-nodes/storyboard/script-types.js';
import type { ConfirmDeleteState, RenameItemTarget } from '../types.js';

export interface AssetLibraryModalsProps {
  // 删除确认
  confirmDelete: ConfirmDeleteState | null;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;

  // 重命名
  renameItemOpen: boolean;
  renameItemName: string;
  renameItemTarget: RenameItemTarget | null;
  onRenameNameChange: (value: string) => void;
  onRenameConfirm: () => void;
  onRenameCancel: () => void;

  // 新建剧本
  scriptNamePromptOpen: boolean;
  scriptNameInput: string;
  /** 空名时的建议默认名(新剧本N 递增) */
  scriptNamePlaceholder?: string;
  onScriptNameChange: (value: string) => void;
  onScriptNameConfirm: () => void;
  onScriptNameCancel: () => void;

  // 资源详情
  assetDetail: any;
  onAssetDetailClose: () => void;
  /** 文本类资产保存正文（编辑模式启用后由底部出血栏「保存」触发） */
  onAssetDetailSave?: (content: string) => Promise<void>;

  // 剧本编辑器
  scriptEditorOpen: boolean;
  scriptEditorTitle: string;
  scriptEditorEpisodes: Episode[];
  scriptEditorActiveId: string;
  onScriptEditorClose: () => void;
  onScriptEditorEpisodesChange: (eps: Episode[]) => void;
  onScriptEditorActiveChange: (id: string) => void;
  onScriptEditorEpisodesAndActiveChange: (eps: Episode[], activeId?: string) => void;
  onScriptEditorAddEpisode: () => void;
  onScriptEditorImportClick: () => void;
  /** 剧本资产 id（Plan#50:页签幂等 key 用，画布抽屉内嵌模式必需） */
  scriptAssetId?: string | null;
  /** 画布抽屉内嵌（Plan#50:抽屉内剧本编辑器改为顶部页签呈现，而非全屏 Modal） */
  embeddedInCanvas?: boolean;

  // 剧本导入
  scriptImportOpen: boolean;
  onScriptImportClose: () => void;
  onScriptImportComplete: (result: any) => void;

  // 右键菜单
  ctxMenuPosition: { x: number; y: number } | null;
  ctxMenuItems: ContextMenuItem[];
  onCtxMenuClose: () => void;

  // 上传队列
  onUploadRetry: (failedFiles: File[]) => void;

  theme: ThemeConfig;
}

export const AssetLibraryModals = memo(function AssetLibraryModals(props: AssetLibraryModalsProps): React.ReactElement {
  const { t } = useTranslation();
  const theme = props.theme;

  // 2026-11-05 用户定稿：资产查看统一走 MediaLightbox 壳（图片/视频/文本），
  // 不再弹旧的 AssetDetailViewer 面板；文本在此为只读（编辑入口移到剧本/提示词节点自身）。
  const detailItem = useMemo<MediaLightboxItem | null>(() => {
    const asset = props.assetDetail;
    if (!asset) return null;
    const d = (asset.data ?? {}) as { kind?: string; storageKey?: string; content?: string };
    const kind: MediaLightboxKind = d.kind === 'video' ? 'video' : d.kind === 'text' ? 'text' : 'image';
    if (!d.storageKey && kind !== 'text') return null;
    return {
      id: asset.id,
      title: asset.title,
      kind,
      storageKey: d.storageKey,
      content: kind === 'text' ? (d.content ?? '') : undefined,
      source: '全局资产库',
    };
  }, [props.assetDetail]);

  return (
    <>
      {/* 上传队列——仅云端/同步模式挂载（本地模式不渲染、不驻留组件） */}
      {CLOUD_ENABLED && (
        <UploadQueueOverlay
          onRetryFailed={(failedFiles) => {
            props.onUploadRetry(failedFiles);
          }}
        />
      )}

      {/* 确认删除 */}
      <Modal
        title={t('assetLibrary.confirmDeleteTitle')}
        open={!!props.confirmDelete}
        onCancel={props.onCancelDelete}
        onOk={props.onConfirmDelete}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        okButtonProps={{ danger: true }}
        centered
        width="calc(100vw - 32px)"
        style={{ maxWidth: 420 }}
      >
        <p style={{ fontSize: 13, color: theme.toolbar.text, margin: 0 }}>
          {t('assetLibrary.confirmDeleteItem', { name: props.confirmDelete?.name ?? '' })}
        </p>
      </Modal>

      {/* 重命名 */}
      <Modal
        title={t('assetLibrary.renameTitle')}
        open={props.renameItemOpen}
        onCancel={props.onRenameCancel}
        onOk={props.onRenameConfirm}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        centered
        width="calc(100vw - 32px)"
        style={{ maxWidth: 420 }}
      >
        <Input
          value={props.renameItemName}
          onChange={(e) => props.onRenameNameChange(e.target.value)}
          placeholder={t('assetLibrary.renamePlaceholder')}
          maxLength={50}
          autoFocus
        />
      </Modal>

      {/* 新建剧本名称确认 */}
      <Modal
        title="新建剧本"
        open={props.scriptNamePromptOpen}
        onCancel={props.onScriptNameCancel}
        onOk={props.onScriptNameConfirm}
        okText="创建"
        cancelText="取消"
        centered
        width="calc(100vw - 32px)"
        style={{ maxWidth: 420 }}
        destroyOnHidden
      >
        <div style={{ marginBottom: 8, fontSize: 13, color: theme.toolbar.textMuted }}>
          请输入剧本名称
        </div>
        <Input
          value={props.scriptNameInput}
          onChange={(e) => props.onScriptNameChange(e.target.value)}
          placeholder={props.scriptNamePlaceholder || '新剧本'}
          maxLength={50}
          autoFocus
          onPressEnter={props.onScriptNameConfirm}
        />
      </Modal>

      {/* 资源详情查看：统一 MediaLightbox 壳 */}
      {detailItem && (
        <MediaLightbox
          items={[detailItem]}
          index={0}
          onIndexChange={() => undefined}
          onClose={props.onAssetDetailClose}
        />
      )}

      {/* 剧本编辑器(2026-08-29 统一改为 Modal 打开,与素材同尺寸;剧本与画布无关,不再走页签) */}
      <Modal
        open={props.scriptEditorOpen}
        onCancel={props.onScriptEditorClose}
        footer={null}
        width="calc(100vw - 32px)"
        style={{ maxWidth: 1400 }}
        centered
        destroyOnHidden
        styles={{ body: { height: 'calc(100vh - 140px)', padding: 0, overflow: 'hidden' } }}
      >
        <ScriptFullscreenEditor
          open
          embedded
          onClose={props.onScriptEditorClose}
          title={props.scriptEditorTitle}
          episodes={props.scriptEditorEpisodes}
          activeEpisodeId={props.scriptEditorActiveId}
          onEpisodesChange={props.onScriptEditorEpisodesChange}
          onActiveEpisodeChange={props.onScriptEditorActiveChange}
          onEpisodesAndActiveChange={props.onScriptEditorEpisodesAndActiveChange}
          onAddEpisode={props.onScriptEditorAddEpisode}
          onImportClick={props.onScriptEditorImportClick}
        />
      </Modal>

      {/* 剧本导入弹窗 */}
      <ScriptImportFlow
        open={props.scriptImportOpen}
        onClose={props.onScriptImportClose}
        onComplete={props.onScriptImportComplete}
      />

      {/* 右键上下文菜单 */}
      <ContextMenu
        items={props.ctxMenuItems}
        position={props.ctxMenuPosition}
        onClose={props.onCtxMenuClose}
      />

      {/* Plan#29 V3: 主体编辑入口已移除(主体升维为画布统筹节点,资产库不再存主体) */}
    </>
  );
});