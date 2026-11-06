/**
 * canvas-assets/groups/MaterialGroup - 画布资产抽屉「素材」分组
 *
 * 数据驱动：数据/actions 来自 store。
 * 卡片渲染复用主页素材卡片 AssetCardGrid（2026-08-30 约束：UI 组件可复用，禁止另起一套卡片样式）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { App, Button, Dropdown, Input, Modal, Tooltip } from 'antd';
import { CheckSquare, Download, FileSearch, Pencil, Square, Trash2, X } from 'lucide-react';
import { nodeActionBus } from '@zeroexo/plugin-nodes';
import type { ThemeConfig } from '@zeroexo/shared';
import { AssetCardGrid } from '@/features/asset-library/cards/asset-card.js';
import { buildSendMenuItems, cardActionBtnStyle, SEND_ACTION_LABEL_KEYS } from '@/features/asset-library/cards/card-send-actions.js';
import { MediaLightbox, type MediaLightboxItem, type MediaLightboxKind } from '@/shared/components/media-lightbox.js';
import { UploadDropZone } from '@/shared/components/upload-drop-zone.js';
import { MasonryGrid } from '@/shared/components/masonry-grid.js';
import { ScopeCapsuleTabs } from '@/features/asset-library/components/scope-capsule-tabs.js';
// 多选框与资产库网格同一实现（同一尺寸/颜色/左上落位；FocusScrollIntoView 已提供 position:relative 基准）
import { MultiSelectCheckbox } from '@/features/asset-library/components/multi-select-checkbox.js';
import type { Asset } from '@/features/asset-picker/index.js';
import type { CanvasAssetsPanelStore } from '../store.js';
import { sendAssetToWorkbench } from '../send-to-workbench.js';
import { OpenLibGroup } from './OpenLibGroup.js';
import { SubjectGroup } from './SubjectGroup.js';
import { useSubjectTotalCount } from '@/features/canvas-nodes/storyboard/use-storyboard-subject-data.js';
import { useCanvasTabStore } from '@/features/canvas-tabs/canvas-tab-store.js';
import { useViewPrefsStore } from '@/shared/view-prefs.js';
import { AddTile, CategoryChips, EmptyState, SearchBox, SkeletonGrid, SCROLL_AREA_STYLE, ToolbarRow } from '../components/common.js';
import { FocusScrollIntoView } from '@/features/canvas-assets/components/focus-scroll-into-view.js';

const KIND_OPTIONS = [
  { key: 'all', labelKey: 'assetLibrary.filterAll' },
  { key: 'image', labelKey: 'assetLibrary.filterImage' },
  { key: 'video', labelKey: 'assetLibrary.filterVideo' },
  { key: 'audio', labelKey: 'assetLibrary.filterAudio' },
  { key: 'text', labelKey: 'assetLibrary.filterText' },
];

export function MaterialGroup({ store, theme }: {
  store: CanvasAssetsPanelStore;
  theme: ThemeConfig;
}): React.ReactElement {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const {
    assets, loadingAssets, materialKind, setMaterialKind,
    search, setSearch, handleUpload,
    setAssetDetail, handleDeleteAsset,
    setRenameItemTarget, setRenameItemOpen, handleDownloadItem, sendToCanvas,
    focusAssetId,
    // 批量操作（2026-11-06，征集 #183：与资产库页面多选同一形态）
    assetMultiSelect, setAssetMultiSelect, assetSelectedIds, assetSelectedAssets,
    toggleAssetSelect, toggleAssetSelectAll,
    handleBatchDeleteAssets, handleBatchSendToCanvas, handleBatchSendToDirector,
  } = store;
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 2026-11-05 约定：抽屉用户资产（公共/本项目）补齐「发送到导演台」，与开源库同一执行器
  // sendAssetToWorkbench（不要复制第二份逻辑）；槽位与提示词引用行为与资产库页完全一致
  const sendItemToDirector = (asset: Asset) => void sendAssetToWorkbench(asset, message, t);

  // 2026-11-05 约定：点卡片任意位置直接开大图（图片/视频/文本统一走 MediaLightbox 壳）
  const [lightbox, setLightbox] = useState<{ items: MediaLightboxItem[]; index: number } | null>(null);
  const assetToLightboxItem = (a: Asset): MediaLightboxItem | null => {
    const d = a.data as { kind?: string; storageKey?: string; content?: string };
    if (!d.storageKey && d.kind !== 'text') return null;
    const kind: MediaLightboxKind = d.kind === 'video' ? 'video' : d.kind === 'text' ? 'text' : 'image';
    return {
      id: a.id,
      title: a.title,
      kind,
      storageKey: d.storageKey,
      content: d.kind === 'text' ? (d.content ?? '') : undefined,
      source: '全局资产库',
    };
  };
  const openCard = (asset: Asset) => {
    const self = assetToLightboxItem(asset);
    // 音频/剧本等新壳未覆盖的类型仍进旧详情（编辑/元信息动作），其余全部走统一查看器
    if (!self) { setAssetDetail(asset); return; }
    const d = asset.data as { kind?: string };
    const items: MediaLightboxItem[] = assets
      .filter((a) => (a.data as { kind?: string }).kind === d.kind)
      .map(assetToLightboxItem)
      .filter((i): i is MediaLightboxItem => !!i);
    const idx = items.findIndex((i) => i.id === asset.id);
    setLightbox({ items, index: idx >= 0 ? idx : 0 });
  };

  // 大图壳顶部动作区：发送到画布 / 发送到导演台（与抽屉卡片同一执行器）
  const currentLightboxAsset = lightbox ? assets.find((a) => a.id === lightbox.items[lightbox.index]?.id) : undefined;
  const lightboxActions = currentLightboxAsset ? (
    <>
      <button
        type="button"
        data-lightbox-action="sendToCanvas"
        onClick={() => sendToCanvas({ type: 'asset', id: currentLightboxAsset.id, data: currentLightboxAsset })}
        style={{ ...cardActionBtnStyle, width: 'auto', padding: '0 8px', gap: 4, fontSize: 11 }}
      >
        {t(SEND_ACTION_LABEL_KEYS.sendToCanvas)}
      </button>
      <button
        type="button"
        data-lightbox-action="sendToDirector"
        onClick={() => sendItemToDirector(currentLightboxAsset)}
        style={{ ...cardActionBtnStyle, width: 'auto', padding: '0 8px', gap: 4, fontSize: 11 }}
      >
        {t(SEND_ACTION_LABEL_KEYS.sendToDirector)}
      </button>
    </>
  ) : undefined;

  // 分类标签计数（与结果同一 predicate；0 不显示，与主体库分类一致）
  // 兼容测试桩（旧 store mock 无该字段）
  const kindCounts = store.materialKindCounts ?? {};
  const kindOptions = KIND_OPTIONS.map((opt) => ({
    key: opt.key,
    label: t(opt.labelKey),
    count: (kindCounts as Record<string, number>)[opt.key] ?? 0,
  }));

  // 页签按项目恢复：进入抽屉素材分组时读取 canvasDrawer 切片（与写入同一 view-prefs 存储键）
  const projectId = useCanvasTabStore((s) => s.slotBindings.script);
  // 胶囊「主体 N」总数（与主体库列表同源；2026-11-06 用户反馈：其它三段有计数，主体段没有）
  const subjectCount = useSubjectTotalCount(projectId);
  const hydratedProjectRef = useRef<string | null>(null);
  useEffect(() => {
    if (!projectId || hydratedProjectRef.current === projectId) return;
    hydratedProjectRef.current = projectId;
    const saved = useViewPrefsStore.getState().canvasDrawer.materialScopeByProject[projectId];
    if (saved && saved !== store.materialScopeTab) store.setMaterialScopeTab(saved);
  }, [projectId, store.materialScopeTab, store.setMaterialScopeTab]);

  /** 图片资产「编辑」：交给编辑器页在画布建节点并打开图片编辑页签（结果落回画布） */
  const editImageAsset = useCallback((asset: Asset) => {
    const d = (asset.data ?? {}) as { storageKey?: string; content?: string; naturalWidth?: number; naturalHeight?: number };
    nodeActionBus.emit('imageEditAsset', {
      // 抽屉资产不在画布节点上：nodeId 仅作事件形状占位，宿主按 assetId 建节点
      nodeId: '',
      assetId: asset.id,
      title: asset.title,
      storageKey: d.storageKey,
      content: d.content,
      naturalWidth: d.naturalWidth,
      naturalHeight: d.naturalHeight,
    });
  }, []);

  const capsuleBar = (
    // 2026-11-04 约定（口径翻案）：「公共资产 N / 本项目 N」胶囊只放在这里——
    // 抽屉素材分组顶部、类型筛选行之上。资产库工具栏/主页/项目弹窗一律不出现。复用同一 ScopeCapsuleTabs。
    // 2026-11-05 开源库接入：胶囊扩为三段「公共 / 本项目 / 开源库」，开源库只读展示不与用户数据混排。
    // 2026-11-05 抽屉接主体：追加第四段「主体」，同段渲染主体库三级页面（SubjectGroup）。
    <div style={{ padding: '8px 20px 0', flexShrink: 0 }}>
      <ScopeCapsuleTabs
        value={store.materialScopeTab}
        onChange={store.setMaterialScopeTab}
        libraryCount={store.materialScopeCounts.library}
        projectCount={store.materialScopeCounts.project}
        openLibCount={store.openLibCount}
        showSubject
        subjectCount={subjectCount}
        theme={theme}
      />
    </div>
  );

  // 主体分段：主体库页面自成一列，不套素材拖拽上传区（避免拖文件误触发素材上传）
  if (store.materialScopeTab === 'subject') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {capsuleBar}
        <SubjectGroup theme={theme} />
      </div>
    );
  }

  return (
    // 2026-11-05 用户要求：抽屉整块区域接收外部文件拖拽（与「上传素材」按钮同一 CAS 上传链）
    <UploadDropZone
      onFiles={(files) => void handleUpload(files)}
      accept={['image/*', 'video/*', 'audio/*', '.txt', '.md']}
      theme={theme}
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      {/* 分段胶囊：见上方 capsuleBar（共用于素材/主体分段） */}
      {capsuleBar}

      {/* 开源库只读作用域：独立渲染（分页 60/页、18+ 门控、按需下载落 CAS 后可发送），不走用户素材编排 */}
      {store.materialScopeTab === 'openlib' ? (
        <>
          <OpenLibGroup store={store} theme={theme} />

          {/* 素材详情统一走 MediaLightbox 壳（2026-11-05 用户定稿：图片/视频/文本同一 UI） */}
          {store.assetDetail && (() => {
            const item = assetToLightboxItem(store.assetDetail as Asset);
            if (!item) return null;
            return (
              <MediaLightbox
                items={[item]}
                index={0}
                onIndexChange={() => undefined}
                onClose={() => setAssetDetail(null)}
              />
            );
          })()}
        </>
      ) : (
        <>
      {/* 主操作统一放顶部（2026-11-06 用户指令：原来埋在最底下每次找半天） */}
      <div style={{ padding: '12px 20px 4px', flexShrink: 0 }}>
        <AddTile label={t('assetLibrary.uploadMaterial', { defaultValue: '上传素材' })} onClick={() => fileInputRef.current?.click()} theme={theme} />
      </div>
      <ToolbarRow>
        <CategoryChips
          items={kindOptions}
          active={materialKind}
          onChange={(k) => setMaterialKind((k ?? 'all') as any)}
          theme={theme}
        />
      </ToolbarRow>
      {/* 搜索统一在分类标签下方；多选开关紧跟搜索（与资产库页面 2026-08-29 约定同一落位） */}
      <ToolbarRow style={{ paddingTop: 0 }}>
        <SearchBox value={search} onChange={setSearch} placeholder={t('assetLibrary.searchPlaceholder')} theme={theme} />
        <Tooltip title={assetMultiSelect ? t('common.multiSelectExit', '退出多选') : t('common.multiSelect', '多选')}>
          <Button
            size="small"
            data-asset-multiselect
            aria-pressed={assetMultiSelect}
            icon={assetMultiSelect ? <CheckSquare size={14} /> : <Square size={14} />}
            onClick={() => setAssetMultiSelect(!assetMultiSelect)}
            style={{ flexShrink: 0 }}
          />
        </Tooltip>
      </ToolbarRow>
      {/* 批量条：只在多选态出现，形态与资产库页面多选栏一致（左侧计数、右侧动作） */}
      {assetMultiSelect && (() => {
        const noneSelected = assetSelectedAssets.length === 0;
        const allSelected = assets.length > 0 && assetSelectedAssets.length === assets.length;
        return (
          <ToolbarRow style={{ paddingTop: 0 }} dataAttr={{ 'data-asset-batch-bar': '' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: theme.toolbar.text, flexShrink: 0 }}>
              {t('common.batchSelected', { n: assetSelectedAssets.length, defaultValue: `已选 ${assetSelectedAssets.length} 项` })}
            </span>
            <span style={{ flex: 1 }} />
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <Button size="small" data-batch-select-all disabled={assets.length === 0} onClick={toggleAssetSelectAll}>
                {allSelected ? t('common.batchSelectNone', '取消全选') : t('common.batchSelectAll', '全选')}
              </Button>
              <Button size="small" data-batch-send-canvas disabled={noneSelected} onClick={handleBatchSendToCanvas}>
                {t(SEND_ACTION_LABEL_KEYS.sendToCanvas)}
              </Button>
              <Button size="small" data-batch-send-director disabled={noneSelected} onClick={handleBatchSendToDirector}>
                {t(SEND_ACTION_LABEL_KEYS.sendToDirector)}
              </Button>
              <Button size="small" type="primary" data-batch-delete disabled={noneSelected} onClick={() => void handleBatchDeleteAssets()}>
                {t('common.batchDeleteSelected', '删除选中')}
              </Button>
              <Tooltip title={t('common.multiSelectExit', '退出多选')}>
                <Button size="small" data-batch-exit icon={<X size={14} />} onClick={() => setAssetMultiSelect(false)} />
              </Tooltip>
            </span>
          </ToolbarRow>
        );
      })()}

      <div style={SCROLL_AREA_STYLE}>
        {loadingAssets && assets.length === 0 ? (
          <SkeletonGrid theme={theme} />
        ) : assets.length === 0 ? (
          <EmptyState theme={theme} />
        ) : (
          // 2026-11-05 用户定稿：抽屉素材同样改瀑布流（列数按抽屉实测宽度取断点）
          <MasonryGrid paddingX={20} paddingBottom={16}>
            {assets.map((asset) => {
              return (
              <FocusScrollIntoView key={asset.id} active={asset.id === focusAssetId}>
              {assetMultiSelect && (
                <MultiSelectCheckbox
                  selected={assetSelectedIds.has(asset.id)}
                  onToggle={() => toggleAssetSelect(asset.id)}
                  accentColor={theme.toolbar.accent}
                />
              )}
              {/* 2026-11-05 约定：右键菜单与 hover 动作同定义同顺序（card-send-actions 单一定义源）；
                  发送项在前（画布→导演台），打开/下载/重命名/删除在后，与开源库卡片一致 */}
              <Dropdown
                menu={{
                  items: [
                    ...buildSendMenuItems({
                      onSendToCanvas: () => sendToCanvas({ type: 'asset', id: asset.id, data: asset }),
                      onSendToDirector: () => sendItemToDirector(asset),
                      kind: asset.kind,
                      t,
                    }),
                    { key: 'open', icon: <FileSearch size={13} />, label: t('assetLibrary.open', { defaultValue: '打开' }), onClick: () => setAssetDetail(asset) },
                    ...(asset.kind === 'image'
                      ? [{ key: 'editImage', icon: <Pencil size={13} />, label: t('assetLibrary.editImage', '编辑'), onClick: () => editImageAsset(asset) }]
                      : []),
                    { key: 'download', icon: <Download size={13} />, label: t('common.download'), onClick: () => void handleDownloadItem({ type: 'asset', data: asset }) },
                    { key: 'rename', icon: <Pencil size={13} />, label: t('assetLibrary.rename'), onClick: () => { setRenameItemTarget({ type: 'asset', id: asset.id, name: asset.title }); setRenameItemOpen(true); } },
                    { key: 'delete', icon: <Trash2 size={13} />, label: t('assetLibrary.delete'), danger: true, onClick: () => void handleDeleteAsset(asset) },
                  ],
                }}
                trigger={['contextMenu']}
              >
              <div>
              <AssetCardGrid
                item={asset}
                selected={assetSelectedIds.has(asset.id)}
                multiSelectEnabled={assetMultiSelect}
                onToggleSelect={toggleAssetSelect}
                onOpen={() => openCard(asset)}
                onRename={() => { setRenameItemTarget({ type: 'asset', id: asset.id, name: asset.title }); setRenameItemOpen(true); }}
                onDelete={() => void handleDeleteAsset(asset)}
                onDownload={() => void handleDownloadItem({ type: 'asset', data: asset })}
                onContextMenu={(e) => e.preventDefault()}
                // 2026-11-05 用户纠偏：抽屉卡片必须保留「发送到画布 / 发送到导演台」快捷按钮
                // （列表页通过缺省 showQuickActions=false 保持无按钮；这里是唯一显式打开处）
                // 2026-11-06：多选态下隐藏卡内快捷按钮——一个时刻只留一套操作，不与批量条抢入口
                showQuickActions={!assetMultiSelect}
                onSendToCanvas={() => sendToCanvas({ type: 'asset', id: asset.id, data: asset })}
                onSendToDirector={() => sendItemToDirector(asset)}
                onEditImage={asset.kind === 'image' ? () => editImageAsset(asset) : undefined}
                theme={theme}
                t={t}
              />
              </div>
              </Dropdown>
              </FocusScrollIntoView>
            );
            })}
          </MasonryGrid>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*,audio/*,text/plain,.txt,.md"
        style={{ display: 'none' }}
        onChange={(e) => { if (e.target.files) void handleUpload(e.target.files); e.target.value = ''; }}
      />

      {/* 素材详情统一走 MediaLightbox 壳（2026-11-05：文本只读，不再弹旧详情面板） */}
      {store.assetDetail && (() => {
        const item = assetToLightboxItem(store.assetDetail as Asset);
        if (!item) return null;
        return (
          <MediaLightbox
            items={[item]}
            index={0}
            onIndexChange={() => undefined}
            onClose={() => setAssetDetail(null)}
          />
        );
      })()}
        </>
      )}

      {/* 大图查看（点卡片开；同列表前后切换，取图走统一 storageKey 解析链） */}
      {lightbox && (
        <MediaLightbox
          items={lightbox.items}
          index={lightbox.index}
          onIndexChange={(i) => setLightbox((cur) => (cur ? { ...cur, index: i } : cur))}
          onClose={() => setLightbox(null)}
          actions={lightboxActions}
        />
      )}

      {/* 重命名弹窗（素材/提示词共用） */}
      <Modal
        title={t('assetLibrary.renameTitle', { defaultValue: '重命名' })}
        open={store.renameItemOpen}
        onCancel={() => store.setRenameItemOpen(false)}
        onOk={() => void store.handleRenameItem()}
        okText={t('common.confirm', { defaultValue: '确认' })}
        cancelText={t('common.cancel', { defaultValue: '取消' })}
        centered
        width="calc(100vw - 32px)"
        style={{ maxWidth: 420 }}
        destroyOnHidden
      >
        <Input
          value={store.renameItemName}
          onChange={(e) => store.setRenameItemName(e.target.value)}
          placeholder={t('assetLibrary.renamePlaceholder', { defaultValue: '请输入新名称' })}
          maxLength={50}
          autoFocus
          onPressEnter={() => void store.handleRenameItem()}
        />
      </Modal>
    </UploadDropZone>
  );
}
