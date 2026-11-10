/**
 * canvas-assets/store - 画布资产抽屉数据层（2026-08-30 约定：与主页资产库彻底独立，数据驱动）
 *
 * 架构约定：
 * - 画布内资产抽屉（HierarchyPanelSidebar）不再复用主页 AssetLibraryPage /
 *   use-asset-library 那套编排（主页是一套、抽屉是独立一套），避免巨型文件耦合。
 * - 展示组件（AssetDetailViewer 等）可复用。
 * - 本文件是抽屉唯一的数据来源：全部状态 + 派生数据 + 操作 actions，
 *   组件层只做纯渲染 + 事件派发（数据驱动）。
 *
 * 数据源（均为独立 hook，非主页编排）：
 * - 素材：useAssets（asset-picker，独立）
 * - 2026-11-04：独立提示词模块整体卸载（提示词能力只保留出片页 WorkbenchPromptDock）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nodeActionBus } from '@zeroexo/plugin-nodes';
import { useAssets } from '@/features/asset-picker/use-assets.js';
import { addAssets as storeAddAssets, filterAssetsStrictScope, countAssetsByScope, resolveUploadScope } from '@/features/asset-picker/asset-store.js';
import { deleteAssetsWithUndo } from '@/features/asset-library/delete-with-undo.jsx';
import type { AssetScope } from '@/features/asset-picker/index.js';
import { sendAssetToWorkbench } from './send-to-workbench.js';
import { getWorkbenchSendContext } from './workbench-send.js';
import { promoteAssetToScope } from '@/features/asset-picker/services/cas-upload.js';
import { onAssetCreated } from '@/services/sync/sync-service.js';
import { UploadQueue } from '@zeroexo/plugin-upload-queue';
import { useAssetUploadQueue } from '@/features/upload-queue/use-upload-queue.js';
import { downloadAssetWithGuide } from '@/features/asset-picker/services/download-asset.js';
import { getGuideMeta } from '@/features/asset-picker/guide.js';
import { resolveGuideForAsset } from '@/features/asset-picker/services/guide-resolve.js';
import { getCurrentCanvasId } from '@/shared/current-canvas-id.js';
import { isAuthorized } from '@/platform/fs.js';
import { useViewPrefsStore } from '@/shared/view-prefs.js';
import { getOpenLibMeta } from '@/features/open-library/open-library.js';
import { countHistoryByKind, libraryCasHashes } from './history-utils.js';
import type { Asset } from '@/features/asset-picker/index.js';
import { App } from 'antd';
import { useTranslation } from 'react-i18next';
import { DRAWER_MODULE_GROUPS } from './tab-defs.js';
import type { DrawerGroup, DrawerModule } from './tab-defs.js';

// ===== 类型 =====

/**
 * 抽屉分组（2026-11-05 用户指令，征集 #174）：「剧本」分组已从抽屉移除——
 * 剧本正文只由顶部固定槽位页签「剧本」打开（一个项目 = 1 剧本），抽屉不再重复入口。
 * 定义已下放到 ./tab-defs.js（分组页签 + 模块挂载规则的单一来源），此处仅转出类型。
 */
export type { DrawerGroup } from './tab-defs.js';

/**
 * 素材分组作用域胶囊键：公共/本项目（用户数据）+ openlib（开源库只读展示作用域）
 * + subject（主体库分段，渲染 SubjectLibraryPages 而不是素材列表）。
 * openlib / subject 不参与资产存储口径（filterAssetsStrictScope/countAssetsByScope/resolveUploadScope
 * 均只接受 AssetScope），store 层对两者显式旁路，确保不与用户数据混排。
 */
export type MaterialScopeTab = AssetScope | 'openlib' | 'subject';

export interface SendToCanvasItem {
  type: 'asset' | 'script';
  id: string;
  data: any;
}

// ===== 作用域判定（2026-11-05 约定：公共库资产就地可编辑、可删除，不踢回公共库） =====

/**
 * 画布抽屉（MaterialGroup 直连本 store）内的资产写判定。
 * 2026-11-05 约定（口径翻案）：公共库资产（scope==='library'）在抽屉内与公共库操作等价——
 * 就地编辑、就地删除，不再拒绝；本函数仅保留「项目资产仅本项目可写」的归属判定：
 * - library → 一律可写（与公共库内操作等价，不做权限收窄）；
 * - project → 仅 projectId 匹配当前画布可写；拿不到画布上下文时拒绝（最小安全默认）。
 * 保留导出仅供存量测试与归属判断复用，不再作为写守卫拦截使用。
 */
export function canWriteInCanvasDrawer(
  asset: Pick<Asset, 'scope' | 'projectId' | 'kind' | 'data'> | null | undefined,
  canvasId: string | null,
): boolean {
  if (!asset) return false;
  if (asset.scope === 'library') return true;
  if (asset.scope !== 'project') return false;
  return canvasId != null && asset.projectId === canvasId;
}

// ===== 画布资产抽屉数据 Hook（数据驱动唯一来源） =====

export interface UseCanvasAssetsOptions {
  /** 发送到画布（编辑器接线） */
  onSendToCanvas?: (item: SendToCanvasItem) => void;
  /** 抽屉当前所属模块（顶部页签）；缺省 canvas = 分组全集（独立渲染 / 单测） */
  module?: DrawerModule;
}

export function useCanvasAssetsPanel({ onSendToCanvas, module }: UseCanvasAssetsOptions) {
  const { t } = useTranslation();
  const { message: antdMessage } = App.useApp();

  // ── 独立数据源 ──
  const { assets, loading: loadingAssets, refresh: refreshAssets, removeAssets, updateAsset } = useAssets();

  // ── 视图状态（分组 / 全局搜索） ──
  // 2026-11-06 用户指令：分组按**模块**独立记忆；层级/画布只在画布模块可挂载——
  // 其余模块（剧本/主体库/导演台）即使上次停在层级，也回落到资产，绝不把画布层级挂出来。
  const drawerModule = module ?? 'canvas';
  const visibleGroups = DRAWER_MODULE_GROUPS[drawerModule];
  const [groupByModule, setGroupByModule] = useState<Record<DrawerModule, DrawerGroup>>({
    canvas: 'material', script: 'material', storyboard: 'material', workbench: 'material',
  });
  const activeGroup: DrawerGroup = visibleGroups.includes(groupByModule[drawerModule])
    ? groupByModule[drawerModule]
    : 'material';
  const setGroupForModule = useCallback((group: DrawerGroup) => {
    setGroupByModule((prev) => (prev[drawerModule] === group ? prev : { ...prev, [drawerModule]: group }));
  }, [drawerModule]);
  const [search, setSearch] = useState('');

  // 切模块即清搜索词：搜索是模块内的临时筛选，不跨模块串味
  useEffect(() => { setSearch(''); }, [drawerModule]);

  // ── 定位焦点（Plan#64: 资产创建后自动定位到对应卡片，仅瞬时滚动） ──
  const [focusAssetId, setFocusAssetId] = useState<string | null>(null);

  // 自动清除焦点（定位完成后清除，避免反复定位）
  useEffect(() => {
    if (!focusAssetId) return;
    const timer = window.setTimeout(() => setFocusAssetId(null), 3000);
    return () => window.clearTimeout(timer);
  }, [focusAssetId]);

  // 挂载时消费 pending 焦点（抽屉未打开时 assets:created 事件已发射的情况）
  // 必须 await refreshAssets() 确保 assets 数组已更新，否则分组渲染时拿到的还是旧数组
  // （本地版：一个画布一个剧本，剧本不进抽屉列表，只由顶部「剧本」页签编辑）
  useEffect(() => {
    const pending = consumePendingFocus();
    if (!pending.assetId || !pending.kind) return;
    void (async () => {
      await refreshAssets();
      // 2026-11-05 剧本分组已从抽屉移除（征集 #174）：script 类资产不在抽屉列表内，
      // 不再切分组/不抢焦点（剧本正文唯一入口 = 顶部「剧本」页签）。
      if (pending.kind === 'script') return;
      setFocusAssetId(pending.assetId);
      setGroupForModule('material');
      if (['video', 'image', 'audio', 'text'].includes(pending.kind as string)) {
        setMaterialKind(pending.kind as 'all' | 'image' | 'video' | 'audio' | 'text');
      }
    })();
  }, [refreshAssets, setGroupForModule]);

  // ── 素材分组状态 ──
  const [materialKind, setMaterialKind] = useState<'all' | 'image' | 'video' | 'audio' | 'text'>('all');

  // ── 素材分组作用域胶囊（2026-11-04 约定：抽屉「素材」分组也挂「公共资产 N / 本项目 N」双段胶囊，
  // 与资产库弹窗同一套 ScopeCapsuleTabs + 严格口径；此前抽屉走 MaterialGroup 独立组件，胶囊根本没被渲染） ──
  // 2026-11-05 开源库接入：胶囊扩为三段「公共 / 本项目 / 开源库」——开源库为只读展示作用域，
  // 不与用户数据混排（openlib 段下 filteredAssets 恒为空，由 OpenLibGroup 独立渲染条目）
  const [materialScopeTab, setMaterialScopeTabState] = useState<MaterialScopeTab>('project');
  // 页签按项目记忆：落到 view-prefs 同一存储键（canvasDrawer 切片），刷新后恢复上次所在分段
  const setMaterialScopeTab = useCallback((tab: MaterialScopeTab) => {
    setMaterialScopeTabState(tab);
    const projectId = getCurrentCanvasId();
    if (projectId) useViewPrefsStore.getState().setDrawerMaterialScope(projectId, tab);
  }, []);

  // ── 开源库条目总数（胶囊徽标；meta 缓存读一次，失败降级 0 不阻断抽屉） ──
  const [openLibCount, setOpenLibCount] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    void getOpenLibMeta()
      .then((m) => { if (alive) setOpenLibCount(m ? m.totals.entries : 0); })
      .catch(() => { if (alive) setOpenLibCount(0); });
    return () => { alive = false; };
  }, []);

  // ── 弹窗 / 详情状态 ──
  // 2026-11-05 约定：删除改就地立即生效 + 3 秒撤销浮层，原「删除确认」弹窗与 confirmDelete 状态一并移除
  const [assetDetail, setAssetDetail] = useState<any>(null);

  // ── 重命名状态 ──
  const [renameItemOpen, setRenameItemOpen] = useState(false);
  const [renameItemName, setRenameItemName] = useState('');
  const [renameItemTarget, setRenameItemTarget] = useState<{ type: 'asset'; id: string; name: string } | null>(null);

  // 上传队列（复用独立上传组件）
  const uploadQueueRef = useRef<UploadQueue | null>(null);
  if (!uploadQueueRef.current) {
    uploadQueueRef.current = new UploadQueue({ concurrency: 5, maxRetries: 2 });
  }
  const { uploadFiles } = useAssetUploadQueue(uploadQueueRef.current);

  // ===== 资产创建后自动刷新列表 + 滚动定位（Plan#64） =====
  useEffect(() => {
    const unsub = nodeActionBus.on('assets:created', async (payload: any) => {
      // 必须先 await refreshAssets() 确保 assets 数组已更新，再设置 focusAssetId，
      // 否则 MaterialGroup 渲染时 assets 还是旧数组，
      // FocusScrollIntoView 匹配不到新创建的资产，滚动定位不会触发。
      await refreshAssets();
      // 生成产物自动落库（历史分组数据底座）：只刷新列表，不抢焦点/切分组（2026-11-04）
      if (payload?.source === 'autoland') return;
      const kind = payload?.kind ?? '';
      const assetId = payload?.assetId ?? '';
      if (!assetId) return;
      setFocusAssetId(assetId);
      // 根据资产类型自动切换分组
      if (kind === 'script') {
        // 本地版（2026-11-02）：剧本为画布强关联资产（建项目即自带），创建不再抢焦点分组
      } else {
        setGroupForModule('material');
        if (['video', 'image', 'audio', 'text'].includes(kind)) {
          setMaterialKind(kind as 'all' | 'image' | 'video' | 'audio' | 'text');
        }
      }
    });
    return unsub;
  }, [refreshAssets, setGroupForModule]);

  // ===== 派生数据（数据驱动渲染输入） =====

  /** 素材（先按作用域胶囊严格口径切段，再按类型/搜索过滤；排除剧本、plan、实体）
   *  openlib 段为只读开源库展示作用域、subject 段为主体库页面：两者恒为空数组，
   *  条目分别由 OpenLibGroup / SubjectGroup 独立渲染，不与用户数据混排 */
  const filteredAssets = useMemo(() => {
    if (materialScopeTab === 'openlib' || materialScopeTab === 'subject') return [];
    const canvasId = getCurrentCanvasId();
    let result = (Array.isArray(assets) ? assets : []).filter(
      (a) => (a.kind as string) !== 'script' && (a.kind as string) !== 'zeroexo-entity' && (a.kind as string) !== 'plan',
    );
    // 2026-11-04 约定：单段内不混排两种作用域（与资产库弹窗同一严格口径）
    result = filterAssetsStrictScope(result, { scopeTab: materialScopeTab, projectId: canvasId });
    if (materialKind !== 'all') {
      result = result.filter((a) => a.kind === materialKind);
    }
    const q = search.trim().toLowerCase();
    if (q) result = result.filter((a) => a.title.toLowerCase().includes(q));
    return result;
  }, [assets, materialScopeTab, materialKind, search]);

  /** 分类标签计数（素材分组口径：当前作用域 + 搜索后按类型统计，与结果同一 predicate，避免"有数字没内容"） */
  const materialKindCounts = useMemo(() => {
    const base = (Array.isArray(assets) ? assets : []).filter(
      (a) => (a.kind as string) !== 'script' && (a.kind as string) !== 'zeroexo-entity' && (a.kind as string) !== 'plan',
    );
    // openlib/subject 段不是用户素材（独立渲染），分类计数直接归零
    if (materialScopeTab === 'openlib' || materialScopeTab === 'subject') {
      return { all: 0, image: 0, video: 0, audio: 0, text: 0 };
    }
    const scoped = filterAssetsStrictScope(base, {
      scopeTab: materialScopeTab as 'project' | 'library',
      projectId: getCurrentCanvasId(),
    });
    const q = search.trim().toLowerCase();
    const list = q ? scoped.filter((a) => a.title.toLowerCase().includes(q)) : scoped;
    return {
      all: list.length,
      image: list.filter((a) => a.kind === 'image').length,
      video: list.filter((a) => a.kind === 'video').length,
      audio: list.filter((a) => a.kind === 'audio').length,
      text: list.filter((a) => (a.kind as string) === 'text' || (a.kind as string) === 'zeroexo-text').length,
    };
  }, [assets, materialScopeTab, search]);

  /** 胶囊徽标计数（素材分组口径：排除剧本/实体/plan 后按作用域统计） */
  const materialScopeCounts = useMemo(() => {
    const base = (Array.isArray(assets) ? assets : []).filter(
      (a) => (a.kind as string) !== 'script' && (a.kind as string) !== 'zeroexo-entity' && (a.kind as string) !== 'plan',
    );
    return countAssetsByScope(base, getCurrentCanvasId());
  }, [assets]);

  // ===== 历史分组派生（2026-11-04 本地版重建：图片 / 视频，scope='project' 的本项目资产） =====
  const historyProjectId = getCurrentCanvasId();
  const allAssets = useMemo(() => (Array.isArray(assets) ? assets : []), [assets]);
  const historyCounts = useMemo(() => countHistoryByKind(allAssets, historyProjectId), [allAssets, historyProjectId]);
  const libraryHashes = useMemo(() => libraryCasHashes(allAssets), [allAssets]);

  /** 历史卡片「加入资产库」：历史产物保留；按用户选择复制到本项目或公共库（共用同一文件） */
  const promoteToScope = useCallback(async (asset: Asset, target: 'project' | 'library') => {
    try {
      const created = await promoteAssetToScope(asset, target);
      if (!created) {
        antdMessage.info(target === 'library'
          ? t('assetLibrary.historyAlreadyInLibrary', { defaultValue: '公共库已有相同内容，无需重复加入' })
          : t('assetLibrary.historyAlreadyInProject', { defaultValue: '本项目已有相同内容，无需重复加入' }));
        return;
      }
      await refreshAssets();
      antdMessage.success(target === 'library'
        ? t('assetLibrary.historyAddedToLibrary', { defaultValue: '已加入公共库（与原产出共用同一文件）' })
        : t('assetLibrary.historyAddedToProject', { defaultValue: '已加入本项目资产（与历史共用同一文件）' }));
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('assetLibrary.saveFailed', { defaultValue: '保存失败' }));
    }
  }, [refreshAssets, antdMessage, t]);

  const promoteToLibrary = useCallback((asset: Asset) => promoteToScope(asset, 'library'), [promoteToScope]);

  /** 批量加入资产库：只处理传入的选中项；目标由用户选择（本项目 / 公共库） */
  const promoteAssetsTo = useCallback(async (targets: Asset[], target: 'project' | 'library' = 'library') => {
    if (targets.length === 0) return;
    let created = 0;
    let existed = 0;
    let failed = 0;
    for (const asset of targets) {
      try {
        const r = await promoteAssetToScope(asset, target);
        if (r) created += 1;
        else existed += 1;
      } catch {
        failed += 1;
      }
    }
    await refreshAssets();
    if (created > 0) {
      antdMessage.success(target === 'library'
        ? t('assetLibrary.batchExported', { n: created, defaultValue: '已将 {{n}} 项加入公共库' })
        : t('assetLibrary.batchExportedProject', { n: created, defaultValue: '已将 {{n}} 项加入本项目' }));
    }
    if (existed > 0) {
      antdMessage.info(t('assetLibrary.batchExportSkipped', { n: existed, defaultValue: '{{n}} 项已存在，已跳过' }));
    }
    if (failed > 0) {
      antdMessage.warning(t('assetLibrary.batchExportFailed', { n: failed, defaultValue: '{{n}} 项导出失败' }));
    }
  }, [refreshAssets, antdMessage, t]);

  // ===== 操作 Actions（数据驱动：事件 → action → 状态更新） =====

  /**
   * 切分组：重置搜索；**只接受当前模块可见的分组**——层级/画布这类画布专属分组
   * 在剧本/导演台模块里没有挂载入口，也不允许被程序化激活。
   */
  const changeGroup = useCallback((group: DrawerGroup) => {
    if (!visibleGroups.includes(group)) return;
    setGroupForModule(group);
    setSearch('');
  }, [visibleGroups, setGroupForModule]);

  /** 素材上传（复用独立上传队列） */  const handleUpload = useCallback(async (files: FileList) => {
    if (files.length === 0) return;
    // 未授权 / 8790 离线时 CAS 与素材记录都写不进盘，旧行为只会显示「该文件夹暂无内容」。
    // 这里直接给出真实原因与恢复入口（浏览器目录授权与 MCP 服务无关）。
    if (!(await isAuthorized().catch(() => false))) {
      antdMessage.error('数据目录未授权且本地数据服务未在线：请在「服务 → 数据目录」重新选择/授权目录，或用 pnpm dev 启动本地数据服务（与 MCP 服务无关）');
      return;
    }
    try {
      const inputs = await uploadFiles(Array.from(files));
      if (inputs.length === 0) {
        antdMessage.warning(t('asset.uploadFailedAll'));
        return;
      }
      // 2026-11-04 约定：抽屉上传归属跟随素材分组当前胶囊段（公共段→公共库四类校验；
      // 本项目段→写入当前画布；与资产库弹窗同一 resolveUploadScope 口径）
      // openlib / subject 段无上传入口（只读/主体页面），兜底按公共库口径
      const uploadScopeTab: AssetScope = materialScopeTab === 'project' ? 'project' : 'library';
      const uploadScope = resolveUploadScope(uploadScopeTab, getCurrentCanvasId());
      const created = await storeAddAssets(inputs.map((i) => ({ ...i, ...uploadScope })));
      if (created.length === 0) {
        antdMessage.warning('没有新增素材：文件可能已存在，或当前分组与上传归属不一致（试试切到「全局」查看）');
        return;
      }
      for (const a of created) onAssetCreated(a.id);
      await refreshAssets();
      setGroupForModule('material');
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('asset.uploadFailed'));
    }
  }, [uploadFiles, refreshAssets, antdMessage, t, materialScopeTab, setGroupForModule]);

  /** 就地删除素材（2026-11-05 约定：点击删除立即生效，3 秒浮层可撤销，不用确认框；
   *  公共库资产同样就地删——复用公共库同一套 removeAssets，作用域仍是公共库本身） */
  const handleDeleteAsset = useCallback(async (asset: Asset) => {
    try {
      await deleteAssetsWithUndo({
        assets: [asset],
        projectId: getCurrentCanvasId(),
        message: antdMessage,
        t,
        onRestored: () => { void refreshAssets(); },
      });
      await refreshAssets();
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('assetLibrary.saveFailed'));
    }
  }, [refreshAssets, antdMessage, t]);

  // ===== 素材批量操作（2026-11-06，征集 #183：与资产库页面多选同一形态）=====
  // 选中集 = 数据上下文不是偏好 → 不进 view-prefs；分段/类型/搜索一变就清空，
  // 不留「选中的项已不在当前列表」的隐形操作（只能对看不见的东西下手）。
  const [assetMultiSelect, setAssetMultiSelectState] = useState(false);
  const [assetSelectedIds, setAssetSelectedIds] = useState<Set<string>>(() => new Set());

  const setAssetMultiSelect = useCallback((next: boolean) => {
    setAssetMultiSelectState(next);
    if (!next) setAssetSelectedIds(new Set());
  }, []);

  const toggleAssetSelect = useCallback((id: string) => {
    setAssetSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  useEffect(() => {
    setAssetSelectedIds(new Set());
  }, [materialScopeTab, materialKind, search]);

  /** 当前选中且仍在列表里的资产（所有批量动作的唯一输入，不拿 id 去猜数据） */
  const assetSelectedAssets = useMemo(
    () => filteredAssets.filter((a) => assetSelectedIds.has(a.id)),
    [filteredAssets, assetSelectedIds],
  );

  const toggleAssetSelectAll = useCallback(() => {
    setAssetSelectedIds((prev) => (prev.size === filteredAssets.length
      ? new Set()
      : new Set(filteredAssets.map((a) => a.id))));
  }, [filteredAssets]);

  /** 批量删除：复用就地删除同一实现（一笔 removeAssets + 3 秒撤销 + 引用失效提示） */
  const handleBatchDeleteAssets = useCallback(async () => {
    const picked = assetSelectedAssets;
    if (picked.length === 0) return;
    try {
      await deleteAssetsWithUndo({
        assets: picked,
        projectId: getCurrentCanvasId(),
        message: antdMessage,
        t,
        onRestored: () => { void refreshAssets(); },
      });
      await refreshAssets();
      setAssetSelectedIds(new Set());
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('assetLibrary.saveFailed'));
    }
  }, [assetSelectedAssets, antdMessage, t, refreshAssets]);

  /** 批量发送到导演台：先查一次片段上下文——没选中片段时只给一条提示，
   * 不能循环里 N 次警告（同一个原因弹 N 遍是噪声）。
   */
  const handleBatchSendToDirector = useCallback(() => {
    const picked = assetSelectedAssets;
    if (picked.length === 0) return;
    const snap = getWorkbenchSendContext();
    if (!snap?.activeShotId) {
      antdMessage.warning(t('workbench.noActiveShot', '请先在导演台选中一个片段'));
      return;
    }
    for (const a of picked) sendAssetToWorkbench(a, antdMessage, t);
    setAssetSelectedIds(new Set());
  }, [assetSelectedAssets, antdMessage, t]);

  /** 重命名（素材） */
  const handleRenameItem = useCallback(async () => {
    if (!renameItemTarget || !renameItemName.trim()) return;
    // 2026-11-05 约定：公共库资产就地重命名写回公共作用域，不再拦截
    try {
      let finalName = renameItemName.trim();
      if (renameItemTarget.type === 'asset' && finalName.includes('.')) {
        const lastDot = finalName.lastIndexOf('.');
        if (lastDot > 0) finalName = finalName.substring(0, lastDot);
      }
      await updateAsset(renameItemTarget.id, { title: finalName });
      await refreshAssets();
      setRenameItemOpen(false);
      setRenameItemName('');
      setRenameItemTarget(null);
      antdMessage.success(t('assetLibrary.saveSuccess', { defaultValue: '保存成功' }));
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('assetLibrary.saveFailed', { defaultValue: '保存失败' }));
    }
  }, [renameItemTarget, renameItemName, refreshAssets, updateAsset, antdMessage, t]);

  /** 下载（素材卡/历史卡共用 downloadAsset：按 storageKey 读盘；无文件明确提示） */
  const handleDownloadItem = useCallback(async (
    item: { type: 'asset'; data: Asset },
    opts?: { withGuide?: boolean },
  ) => {
    try {
      if (item.type !== 'asset') return;
      const guide = opts?.withGuide
        ? (getGuideMeta(item.data) ?? await resolveGuideForAsset(item.data).catch(() => null))
        : undefined;
      const { ok, guideOk } = await downloadAssetWithGuide(item.data, guide);
      if (!ok) {
        antdMessage.error(t('assetLibrary.downloadFailed', '下载失败：文件不存在或已被清理'));
        return;
      }
      if (opts?.withGuide && !guideOk) {
        if (guide?.id) antdMessage.error(t('assetLibrary.guideDownloadFailed', '引导数据下载失败：文件不存在或 ComfyUI 未连接'));
        else antdMessage.warning(t('assetLibrary.guideMissing', '该视频没有引导数据'));
      }
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('assetLibrary.downloadFailed', '下载失败：文件不存在或已被清理'));
    }
  }, [antdMessage, t]);

  /** 打开条目（素材详情） */
  const openItem = useCallback((item: { type: 'asset'; data: any }) => {
    if (item.type === 'asset') {
      setAssetDetail(item.data);
    }
  }, []);

  /** 发送到画布 */
  const sendToCanvas = useCallback((item: SendToCanvasItem) => {
    onSendToCanvas?.(item);
  }, [onSendToCanvas]);

  /** 批量发送到画布（必须排在 sendToCanvas 之后：依赖数组在渲染期就会读它） */
  const handleBatchSendToCanvas = useCallback(() => {
    const picked = assetSelectedAssets;
    if (picked.length === 0) return;
    for (const a of picked) sendToCanvas({ type: 'asset', id: a.id, data: a });
    setAssetSelectedIds(new Set());
  }, [assetSelectedAssets, sendToCanvas]);

  // ===== 返回（数据驱动：组件只订阅状态 + 派发 action） =====

  return {
    // 视图（visibleGroups = 当前模块允许挂载的分组；面板据此决定 sidebar 按钮）
    activeGroup,
    visibleGroups,
    search,
    changeGroup,
    setSearch,

    // 素材
    assets: filteredAssets,
    allAssetsCount: assets.length,
    loadingAssets,
    materialKind,
    setMaterialKind,
    materialScopeTab,
    setMaterialScopeTab,
    materialScopeCounts,
    materialKindCounts,
    openLibCount,
    // 素材批量操作（与资产库页面多选同形）
    assetMultiSelect,
    setAssetMultiSelect,
    assetSelectedIds,
    assetSelectedAssets,
    toggleAssetSelect,
    toggleAssetSelectAll,
    handleBatchDeleteAssets,
    handleBatchSendToCanvas,
    handleBatchSendToDirector,
    handleUpload,
    openItem,

    // 历史分组（本地版：项目产出的图片/视频，2026-11-04 重建）
    allAssets,
    historyProjectId,
    historyCounts,
    libraryHashes,
    promoteToLibrary,
    promoteToScope,
    promoteAssetsTo,

    // 通用
    focusAssetId,
    setFocusAssetId,
    handleDeleteAsset,
    renameItemOpen,
    renameItemName,
    setRenameItemName,
    renameItemTarget,
    setRenameItemTarget,
    setRenameItemOpen,
    handleRenameItem,
    handleDownloadItem,
    assetDetail,
    setAssetDetail,
    sendToCanvas,
    refreshAssets,
    removeAssets,
    updateAsset,
    uploadQueueRef,
  };
}

// ===== 模块级 pending 焦点（Plan#64: 桥接抽屉未挂载时的 assets:created 事件） =====

let pendingFocusAssetId: string | null = null;
let pendingFocusKind: string | null = null;

/** 存待处理的焦点资产（由 editor 层在打开抽屉前调用） */
export function stashPendingFocus(assetId: string, kind: string): void {
  pendingFocusAssetId = assetId;
  pendingFocusKind = kind;
}

/** 消费待处理的焦点资产（由 store 在挂载时调用） */
export function consumePendingFocus(): { assetId: string | null; kind: string | null } {
  const result = { assetId: pendingFocusAssetId, kind: pendingFocusKind };
  pendingFocusAssetId = null;
  pendingFocusKind = null;
  return result;
}

/** 抽屉 store 类型（ReturnType 推导，组件层订阅用） */
export type CanvasAssetsPanelStore = ReturnType<typeof useCanvasAssetsPanel>;






