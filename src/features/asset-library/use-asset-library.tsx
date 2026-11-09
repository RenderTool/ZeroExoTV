// TODO(拆分): 该文件超过 1000 行，计划按「状态层/交互层/渲染层」拆分，见 DESIGN.md
/**
 * use-asset-library - 资产库业务逻辑 Hook
 *
 * 从 asset-library-page.tsx 抽出所有状态定义、数据加载、筛选逻辑、操作回调。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { App as AntdApp } from 'antd';
import { Package, BookOpen, Layers } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { useIsMobile } from '@/shared/hooks/use-media-query.js';
import { useAssets } from '@/features/asset-picker/use-assets.js';
import { addAssets as storeAddAssets, upsertAsset, filterAssetsStrictScope, countAssetsByScope, resolveUploadScope, type UpdateAssetInput, type AssetScopeCounts } from '@/features/asset-picker/asset-store.js';
import { deleteAssetsWithUndo } from './delete-with-undo.jsx';
import { useViewPrefsStore } from '@/shared/view-prefs.js';
import type { AssetScope, Asset } from '@/features/asset-picker/index.js';
import { downloadAsset } from '@/features/asset-picker/index.js';
import { downloadGuideFile } from '@/shared/utils/guide-file.js';
import { getGuideMeta } from '@/features/asset-picker/guide.js';
import { resolveGuideForAsset } from '@/features/asset-picker/services/guide-resolve.js';
import { onAssetCreated } from '@/services/sync/sync-service.js';
import { UploadQueue } from '@zeroexo/plugin-upload-queue';
import { useAssetUploadQueue } from '@/features/upload-queue/use-upload-queue.js';
import { useAuth } from '@/features/auth/auth-store.js';
import { apiPost } from '@/services/api-client.js';
import { chapterDetectPipeline } from '@/shared/utils/chapter-detect-pipeline.js';
import type { Episode } from '@/features/canvas-nodes/storyboard/script-types.js';
import type { AssetCategory, ViewMode } from '@/shared/components/index.js';
import type {
  ContentType,
  AssetKindFilter,
  PageItem,
  ConfirmDeleteState,
  RenameItemTarget,
  SendToCanvasItem,
  HierarchyLibraryItem,
} from './types.js';


// ===== Hook 返回类型 =====

/** 剧本上传（含章节检测）回调 */
export type UploadScriptHandler = (files: FileList) => void;

export interface UseAssetLibraryReturn {
  // 基础
  isAuthenticated: boolean;
  isMobile: boolean;
  theme: ReturnType<typeof useTheme>['theme'];

  // 数据
  assets: ReturnType<typeof useAssets>['assets'];
  loadingAssets: boolean;
  refreshAssets: () => Promise<void>;

  // 分类
  categories: AssetCategory[];
  activeGroup: string | null;
  activeChild: string | null;
  contentType: ContentType;

  // 归属范围（本项目 / 公共库）
  scopeTab: AssetScope;
  setScopeTab: (tab: AssetScope) => void;
  /** 项目上下文（null=场外空间，锁定公共库） */
  projectId: string | null;
  /** 胶囊 Tab 数量徽标（library=公共四类白名单数；project=当前项目资产数，无项目上下文为 null） */
  scopeCounts: AssetScopeCounts;

  // 搜索
  search: string;

  // 视图
  viewMode: ViewMode;
  multiSelectEnabled: boolean;
  selectedIds: Set<string>;
  page: number;
  PAGE_SIZE: number;

  // 筛选后数据
  allItems: PageItem[];
  pageItems: PageItem[];

  // 拖拽上传
  dragOver: boolean;
  dragCounterRef: React.MutableRefObject<number>;


  // 弹窗状态
  confirmDelete: ConfirmDeleteState | null;
  renameItemOpen: boolean;
  renameItemName: string;
  renameItemTarget: RenameItemTarget | null;
  scriptNamePromptOpen: boolean;
  scriptNameInput: string;
  /** 新剧本建议默认名(新剧本/新剧本2...递增) */
  scriptNameSuggestion: string;
  scriptEditorOpen: boolean;
  scriptEditorEpisodes: Episode[];
  scriptEditorActiveId: string;
  scriptEditorTitle: string;
  scriptEditorAssetId: string | null;
  scriptImportOpen: boolean;
  scanningProgress: number;
  scanningMessage: string;
  assetDetail: any;

  // 操作回调
  handleUpload: (files: FileList) => Promise<void>;
  handleUploadScript: UploadScriptHandler;
  handleDragEnter: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDragOver: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  handleNewScript: () => void;
  handleConfirmNewScript: () => Promise<void>;
  handleOpenScriptAsset: (asset: any) => void;
  handleScriptImportComplete: (scriptState: any) => void;
  handleCloseScriptEditor: () => void;
  handleConfirmDelete: () => Promise<void>;
  handleToggleSelect: (id: string) => void;
  handleToggleSelectAll: () => void;
  handleBatchDelete: () => void;
  handleSendToCanvas: (item: SendToCanvasItem) => void;
  handleDownloadItem: (item: { type: 'asset'; data: any }, opts?: { withGuide?: boolean }) => void | Promise<void>;
  handleRenameItem: () => Promise<void>;
  handleOpenItem: (item: PageItem) => void;

  // 状态设置
  setActiveGroup: (group: string | null) => void;
  setActiveChild: (child: string | null) => void;
  setSearch: (value: string) => void;
  setViewMode: (mode: ViewMode) => void;
  setMultiSelectEnabled: (v: boolean) => void;
  setPage: (page: number) => void;
  setConfirmDelete: (state: ConfirmDeleteState | null) => void;
  setRenameItemOpen: (open: boolean) => void;
  setRenameItemName: (name: string) => void;
  setRenameItemTarget: (target: RenameItemTarget | null) => void;
  setScriptNamePromptOpen: (open: boolean) => void;
  setScriptNameInput: (name: string) => void;
  setScriptEditorOpen: (open: boolean) => void;
  setScriptEditorEpisodes: (eps: Episode[]) => void;
  setScriptEditorActiveId: (id: string) => void;
  setScriptEditorTitle: (title: string) => void;
  setScriptImportOpen: (open: boolean) => void;
  setScanningProgress: (p: number) => void;
  setScanningMessage: (msg: string) => void;
  setAssetDetail: (detail: any) => void;
  /** 更新资产（文本类资产编辑正文后保存） */
  updateAsset: (id: string, patch: UpdateAssetInput) => Promise<void>;
}

// ===== Props =====

export interface UseAssetLibraryProps {
  defaultAssetKind?: AssetKindFilter;
  defaultGroup?: string;
  defaultChild?: string;
  onSendToCanvas?: (item: SendToCanvasItem) => void;
  /**
   * 项目上下文（资产项目化）：项目内（画布抽屉/画布内 Modal）传当前画布 ID；
   * 项目外（主页/独立 #/assets 页等场外空间）传 null —— 锁定公共库视图，
   * 不渲染分区切换、列表/创建均不会出现项目资产。
   * 判定由页面形态决定后显式传入，本 hook 不隐式读全局 getCurrentCanvasId()
   * （模块级残留值，离开编辑器回主页后可能仍非 null，不可靠）。
   */
  projectId: string | null;
  /** 层级分组数据(征集 #87 验收轮九:画布节点注册进资产面板;传入时显示「层级」分组) */
  hierarchyItems?: HierarchyLibraryItem[];
  /** 层级条目打开回调(点击节点卡片 → 画布聚焦) */
  onOpenHierarchyNode?: (nodeId: string) => void;
}

// ===== 辅助 =====

/** 生成新剧本默认名 */
function nextScriptName(existingTitles: string[], baseName: string): string {
  let max = 0;
  for (const title of existingTitles) {
    const pattern = new RegExp(`^${escapeRegex(baseName)}(\\d*)$`);
    const m = pattern.exec(title.trim());
    if (!m) continue;
    const n = m[1] ? Number(m[1]) : 1;
    if (Number.isFinite(n) && n > max) max = n;
  }
  const next = max + 1;
  return next === 1 ? baseName : `${baseName}${next}`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ===== Hook =====

export function useAssetLibrary(props: UseAssetLibraryProps): UseAssetLibraryReturn {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isMobile = useIsMobile();
  const { message: antdMessage, modal } = AntdApp.useApp();
  const { isAuthenticated } = useAuth();

  const [prevDefaultAssetKind, setPrevDefaultAssetKind] = useState<AssetKindFilter | undefined>(props.defaultAssetKind);



  // ── 视图偏好（2026-11-04 约定：切 Tab 偏好必须记住）──
  // 搜索词 / 布局 / 分组 / 子类筛选 持久化到全局偏好 store（localStorage assetLibrary.prefs），
  // 全局一份：切「公共资产/本项目」、切顶部页签、刷新页面都保留。初值优先 props 指定默认。
  const prefs = useViewPrefsStore((s) => s.assetLibrary);
  const setAssetLibraryPrefs = useViewPrefsStore((s) => s.setAssetLibraryPrefs);
  const [search, setSearchState] = useState(prefs.search);
  const setSearch = useCallback((value: string) => {
    setSearchState(value);
    setAssetLibraryPrefs({ search: value });
  }, [setAssetLibraryPrefs]);

  // ── 弹窗状态 ──
  const [confirmDelete, setConfirmDelete] = useState<ConfirmDeleteState | null>(null);

  // ── 分页 ──
  const PAGE_SIZE = 24;
  const [page, setPage] = useState(1);

  // ── 视图 ──
  const [viewMode, setViewModeState] = useState<ViewMode>(prefs.viewMode);
  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode);
    setAssetLibraryPrefs({ viewMode: mode });
  }, [setAssetLibraryPrefs]);
  const [activeGroup, setActiveGroupState] = useState<string | null>(props.defaultGroup ?? prefs.activeGroup);
  const [activeChild, setActiveChildState] = useState<string | null>(props.defaultChild ?? prefs.activeChild);
  /** 分组+子类同步落偏好 store（group=null 时保留既有持久化分组值） */
  const persistGroupChild = useCallback((group: string | null, child: string | null) => {
    setAssetLibraryPrefs({ ...(group !== null ? { activeGroup: group } : {}), activeChild: child });
  }, [setAssetLibraryPrefs]);
  const setActiveChild = useCallback((child: string | null) => {
    setActiveChildState(child);
    setAssetLibraryPrefs({ activeChild: child });
  }, [setAssetLibraryPrefs]);

  // ── 归属范围（本项目 / 公共库）──
  // 有项目上下文默认「本项目」；无项目上下文（主页等场外空间）锁定「公共库」，
  // 切换请求被忽略，防止场外出现项目资产。切换时重置分页与多选，避免状态残留。
  const [scopeTab, setScopeTabState] = useState<AssetScope>(props.projectId ? 'project' : 'library');
  const setScopeTab = useCallback((tab: AssetScope) => {
    if (!props.projectId) return;
    setScopeTabState(tab);
    setPage(1);
    setSelectedIds(new Set());
    setMultiSelectEnabled(false);
    // 公共库视图无剧本等业务分组：从「本项目」剧本分组切走时回落到素材分组
    if (tab === 'library' && activeGroup === 'script') {
      setActiveGroupState('material');
      setActiveChildState(null);
      persistGroupChild('material', null);
    }
  }, [props.projectId, activeGroup, persistGroupChild]);

  // 外部 defaultAssetKind 变化时同步（映射到分组 + 子分类，由派生筛选消费）
  useEffect(() => {
    if (props.defaultAssetKind === prevDefaultAssetKind) return;
    setPrevDefaultAssetKind(props.defaultAssetKind);
    if (props.defaultAssetKind) {
      const child = props.defaultAssetKind === 'all' ? null : props.defaultAssetKind;
      setActiveGroupState('material');
      setActiveChildState(child);
      persistGroupChild('material', child);
    }
  }, [props.defaultAssetKind, prevDefaultAssetKind, persistGroupChild]);

  // 切换大分类时重置子分类，避免旧子分类残留到新分组导致列表为空
  const setActiveGroup = useCallback((group: string | null) => {
    setActiveGroupState(group);
    setActiveChildState(null);
    persistGroupChild(group, null);
  }, [persistGroupChild]);

  // ── 多选 ──
  const [multiSelectEnabled, setMultiSelectEnabled] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ── 重命名 ──
  const [renameItemOpen, setRenameItemOpen] = useState(false);
  const [renameItemName, setRenameItemName] = useState('');
  const [renameItemTarget, setRenameItemTarget] = useState<RenameItemTarget | null>(null);

  // ── 资源详情 ──
  const [assetDetail, setAssetDetail] = useState<any>(null);

  // ── 资产数据 ──
  const { assets, loading: loadingAssets, refresh: refreshAssets, removeAssets, updateAsset } = useAssets();

  // ── 归属范围过滤（资产项目化，胶囊 Tab 严格口径）──
  // 过滤口径收敛在纯函数 filterAssetsStrictScope（可单测），单段内不混排两种作用域：
  // project 视图：只出当前 projectId 的项目资产；library 视图 / 无项目上下文：仅公共库资产（四类白名单）
  const projectId = props.projectId;
  const scopedAssets = useMemo(
    () => filterAssetsStrictScope(assets, { scopeTab, projectId }),
    [assets, scopeTab, projectId],
  );
  // 胶囊 Tab 数量徽标：基于全量 assets 实时统计，不随筛选/搜索变化
  const scopeCounts: AssetScopeCounts = useMemo(
    () => countAssetsByScope(assets, projectId),
    [assets, projectId],
  );
  // 写守卫上下文（2026-11-05 约定）：公共库资产就地可编辑、可删除，不再要求回到公共库——
  // 全部拦截守卫已撤除，本项目内操作与公共库内操作等价；scopeTab 仅决定展示数据源。
  const uploadQueueRef = useRef<UploadQueue | null>(null);
  if (!uploadQueueRef.current) {
    uploadQueueRef.current = new UploadQueue({ concurrency: 5, maxRetries: 2 });
  }
  const { uploadFiles } = useAssetUploadQueue(uploadQueueRef.current);

  // ── 剧本编辑器状态 ──
  const [scriptEditorOpen, setScriptEditorOpen] = useState(false);
  const [scriptEditorEpisodes, setScriptEditorEpisodes] = useState<Episode[]>([]);
  const [scriptEditorActiveId, setScriptEditorActiveId] = useState('');
  const [scriptEditorAssetId, setScriptEditorAssetId] = useState<string | null>(null);
  const [scriptEditorTitle, setScriptEditorTitle] = useState('');
  const [scriptImportOpen, setScriptImportOpen] = useState(false);

  // ── 章节检测扫描进度 ──
  const [scanningProgress, setScanningProgress] = useState(-1);
  const [scanningMessage, setScanningMessage] = useState('');

  // ── 分类定义 ──
  const categories: AssetCategory[] = useMemo(() => [
    // 征集 #87 验收轮九:层级分组(仅画布内抽屉传入 hierarchyItems 时显示,置顶)
    ...(props.hierarchyItems ? [{
      group: 'hierarchy' as const,
      label: t('hierarchy.tabHierarchy'),
      icon: <Layers size={16} />,
      color: '#3b82f6',
      // 层级不计总数(count: 0 不显示计数)
      count: 0,
      children: [],
    }] : []),
    {
      group: 'material',
      label: t('assetLibrary.filterMaterial'),
      icon: <Package size={16} />,
      color: '#f59e0b',
      count: scopedAssets.filter((a) => (a.kind as string) !== 'script' && (a.kind as string) !== 'zeroexo-entity' && (a.kind as string) !== 'plan').length,
      children: [
        { key: 'all', label: t('assetLibrary.filterAll'), count: scopedAssets.filter((a) => (a.kind as string) !== 'script' && (a.kind as string) !== 'zeroexo-entity' && (a.kind as string) !== 'plan').length },
        { key: 'image', label: t('assetLibrary.filterImage'), count: scopedAssets.filter((a) => a.kind === 'image').length },
        { key: 'video', label: t('assetLibrary.filterVideo'), count: scopedAssets.filter((a) => a.kind === 'video').length },
        { key: 'audio', label: t('assetLibrary.filterAudio'), count: scopedAssets.filter((a) => a.kind === 'audio').length },
        { key: 'text', label: t('assetLibrary.filterText'), count: scopedAssets.filter((a) => (a.kind as string) === 'text' || (a.kind as string) === 'zeroexo-text').length },
      ],
    },
    // Plan#29 V3: 「主体」分组已移除(主体升维为画布统筹节点,资产库不再存主体)
    // 资产项目化：公共库只收四类素材（image/video/audio/text），剧本等业务分组仅在「本项目」视图出现
    ...(scopeTab === 'project' ? [{
      group: 'script',
      label: t('assetLibrary.filterScript'),
      icon: <BookOpen size={16} />,
      color: '#ec4899',
      count: scopedAssets.filter((a) => (a.kind as string) === 'script').length,
      children: [],
    } as AssetCategory] : []),
    // Plan 已定为画布强关联对象（每画布一份，入口在画布 TopBar），资产库不设分组

  ], [scopedAssets, t, props.hierarchyItems, scopeTab]);

  // ── 分类筛选逻辑（子分类值做合法性校验，非法残留值回退 all） ──
  const filteredByGroup = useMemo(() => {
    if (!activeGroup) {
      return { contentType: 'all' as ContentType, assetKind: 'all' as AssetKindFilter };
    }
    switch (activeGroup) {
      case 'hierarchy':
        return { contentType: 'hierarchy' as ContentType, assetKind: 'all' as AssetKindFilter };
      case 'material': {
        const validKinds: AssetKindFilter[] = ['all', 'image', 'video', 'audio', 'text'];
        const child = validKinds.includes(activeChild as AssetKindFilter) ? (activeChild as AssetKindFilter) : 'all';
        return { contentType: 'asset' as ContentType, assetKind: child };
      }
      case 'script':
        return { contentType: 'script' as ContentType, assetKind: 'all' as AssetKindFilter };
      default:
        return { contentType: 'all' as ContentType, assetKind: 'all' as AssetKindFilter };
    }
  }, [activeGroup, activeChild]);

  // 筛选维度全部从 filteredByGroup 派生（不再用 effect 同步 state，切换分类单次渲染生效）
  const contentType = filteredByGroup.contentType;
  const assetKindFilter = filteredByGroup.assetKind;

  const filteredAssets = useMemo(() => {
    let result = scopedAssets;
    if (activeGroup === 'material') {
      // Plan 为画布强关联对象，资产库任何分组都不展示
      result = result.filter((a) => (a.kind as string) !== 'script' && (a.kind as string) !== 'zeroexo-entity' && (a.kind as string) !== 'plan');
    }
    if (assetKindFilter !== 'all') {
      result = result.filter((a) => (a.kind as string) === assetKindFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((a) => a.title.toLowerCase().includes(q));
    }
    return result;
  }, [scopedAssets, assetKindFilter, search, activeGroup]);

  const showAssets = filteredByGroup.contentType === 'all' || filteredByGroup.contentType === 'asset';
  const showScripts = filteredByGroup.contentType === 'script';
  // 征集 #87 验收轮十:层级分组由专属树形列表渲染(自带搜索过滤),不再派生平铺条目

  const filteredScripts = useMemo(() => {
    return filteredAssets.filter((a) => (a.kind as string) === 'script');
  }, [filteredAssets]);



  const allItems = useMemo((): PageItem[] => {
    const items: PageItem[] = [];
    if (showAssets) {
      // FIX（2026-08-25 实测：剧本存入资产后「全部」视图不可见）：不再在此滤除 script——
      // material 组已在 filteredAssets 源头排除剧本（L361），「全部」视图应完整展示包括剧本在内的所有资产；
      // 发送到画布的真实类型由发送入口按 data.kind 判定（见 asset-library-page）
      // Plan 为画布强关联对象，资产库列表不展示
      filteredAssets
        .filter((a) => (a.kind as string) !== 'plan')
        .forEach((a) => items.push({ type: 'asset', data: a }));
    }
    if (showScripts) {
      filteredScripts.forEach((a) => items.push({ type: 'asset', data: a }));
    }
    // 征集 #87 验收轮十:层级分组不走 pageItems(专属树形列表渲染,不参与网格/分页)
    return items;
  }, [showAssets, filteredAssets, showScripts, filteredScripts]);

  const pageItems = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return allItems.slice(start, start + PAGE_SIZE);
  }, [allItems, page]);

  // ── 操作回调 ──

  const handleUpload = useCallback(
    async (files: FileList): Promise<void> => {
      if (files.length === 0) return;
      try {
        const inputs = await uploadFiles(Array.from(files));
        const failedCount = Array.from(files).length - inputs.length;
        if (inputs.length === 0) {
          antdMessage.warning(t('asset.uploadFailedAll'));
          return;
        }
        // 资产项目化：上传归属跟随当前 Tab（resolveUploadScope 纯函数口径）——
        // 公共段上传显式归入公共库（store 层 assertLibraryKind 兜底四类校验）；
        // 本项目段显式写入当前 projectId（不再依赖 getCurrentCanvasId 残留值）
        const uploadScope = resolveUploadScope(scopeTab, props.projectId);
        const created = await storeAddAssets(inputs.map((i) => ({ ...i, ...uploadScope })));
        for (const a of created) {
          onAssetCreated(a.id);
        }
        await refreshAssets();
        setActiveGroup('material');
        if (failedCount > 0) {
          antdMessage.warning(t('asset.uploadPartial', { success: inputs.length, total: Array.from(files).length }));
        } else {
          antdMessage.success(t('asset.uploadComplete'));
        }
      } catch (err) {
        antdMessage.error(err instanceof Error ? err.message : t('asset.uploadFailed'));
      }
    },
    [uploadFiles, refreshAssets, antdMessage, t, setActiveGroup, scopeTab, props.projectId],
  );

  // ── 剧本上传（含章节检测） ──
  const handleUploadScript: UploadScriptHandler = useCallback(
    (files: FileList) => {
      const fileArray = Array.from(files);
      const totalFiles = fileArray.length;
      setScanningProgress(0);
      setScanningMessage(`${t('assetLibrary.scanningFile', { current: 1, total: totalFiles })}`);
      let completedCount = 0;
      void Promise.all(fileArray.map(async (file, idx) => {
        try {
          const result = await chapterDetectPipeline(file, {
            onProgress: (pct, msg) => {
              const overall = Math.round(((completedCount + pct / 100) / totalFiles) * 100);
              setScanningProgress(overall);
              setScanningMessage(`${t('assetLibrary.scanningFileDetail', { current: idx + 1, total: totalFiles, message: msg })}`);
            },
          });
          if (result) {
            antdMessage.success(`${t('assetLibrary.scriptCreated', { filename: result.filename })}`);
          }
        } catch (err) {
          try {
            const textContent = await file.text();
            await storeAddAssets([{
              title: file.name.replace(/\.[^/.]+$/, ''),
              kind: 'text',
              data: { kind: 'text', content: textContent },
              bytes: textContent.length,
              mimeType: 'text/plain',
              // 资产项目化：降级保存的文本资产归属跟随当前 Tab（与 handleUpload 同口径）
              ...resolveUploadScope(scopeTab, props.projectId),
            }]);
            antdMessage.info(`${t('assetLibrary.scriptNoChapterSaved', { name: file.name })}`);
          } catch {
            antdMessage.error(err instanceof Error ? err.message : `${t('assetLibrary.scriptProcessFailed', { name: file.name })}`);
          }
        } finally {
          completedCount++;
        }
      })).then(() => {
        refreshAssets();
        setScanningProgress(-1);
        setScanningMessage('');
      });
    },
    [antdMessage, refreshAssets, t, scopeTab, props.projectId],
  );

  // ── 拖拽上传 ──
  const [dragOver, setDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 验收轮二十一:素材库自身卡片拖拽(自定义 MIME)不触发上传提示(防自己拖自己)
    if (e.dataTransfer.types?.includes('application/x-testlib-item')) return;
    dragCounterRef.current++;
    if (e.dataTransfer.types?.includes('Files')) {
      setDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setDragOver(false);
    // 验收轮二十一:素材库自身卡片拖拽不上传(防自己拖自己循环上传;卡片封面 img 已禁拖双保险)
    if (e.dataTransfer.types?.includes('application/x-testlib-item')) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handleUpload(e.dataTransfer.files);
    }
  }, [handleUpload]);

  // ── 剧本 ──
  const [scriptNamePromptOpen, setScriptNamePromptOpen] = useState(false);
  const [scriptNameInput, setScriptNameInput] = useState('');

  // 新剧本建议名:新剧本 / 新剧本2 / 新剧本3...(避免连建重名)
  const scriptNameSuggestion = useMemo(
    () => nextScriptName(scopedAssets.filter((a) => (a.kind as string) === 'script').map((a) => a.title), t('assetLibrary.newScriptName')),
    [scopedAssets, t],
  );

  const handleNewScript = useCallback(() => {
    setScriptNameInput('');
    setScriptNamePromptOpen(true);
  }, []);

  const handleConfirmNewScript = useCallback(async () => {
    const name = scriptNameInput.trim() || scriptNameSuggestion;
    // 资产项目化防御：无项目上下文时禁止创建项目资产（setScopeTab 已锁定，此处双保险；
    // 若未来出现误留的"本项目"新建入口，明示拒绝而非静默创建/静默失败）
    if (scopeTab === 'project' && !props.projectId) {
      antdMessage.warning(t('assetLibrary.scopeNeedProject', '项目资产需进入项目后创建'));
      return;
    }
    setScriptNamePromptOpen(false);
    const now = Date.now();
    const newEp: Episode = {
      id: `ep-${now}`,
      number: 1,
      title: t('assetLibrary.defaultEpisodeTitle'),
      content: '',
    };
    const episodes = [newEp];
    const text = JSON.stringify({ episodes });
    try {
      const result = await apiPost<{ id: string; kind: string; filename: string; version: number; lastSyncedAt: string; createdAt: string }>(
        '/resources/scripts',
        { filename: name, text, tags: [] },
      );
      if (result) {
        // 资产项目化：upsertAsset 不走 addAsset 默认值，显式写入归属。
        // 公共库页签 / 无项目上下文 → library（主页等场外空间只创建公共资产）；
        // 本项目页签（必有 projectId）→ project+当前项目。
        const localAsset = {
          id: result.id,
          title: name,
          kind: 'script' as const,
          bytes: 0,
          mimeType: 'application/json',
          tags: [] as string[],
          createdAt: result.createdAt ?? new Date().toISOString(),
          data: { kind: 'script' as const, content: text, storageKey: '' },
          folderId: null,
          cloudId: result.id,
          version: result.version ?? 1,
          lastSyncedAt: result.lastSyncedAt ?? new Date().toISOString(),
          ...(scopeTab === 'project' && props.projectId
            ? { scope: 'project' as const, projectId: props.projectId }
            : { scope: 'library' as const }),
        };
        await upsertAsset(localAsset as any);
        await refreshAssets();
        setScriptEditorEpisodes(episodes);
        setScriptEditorActiveId(newEp.id);
        setScriptEditorAssetId(result.id);
        setScriptEditorTitle(name);
        setScriptEditorOpen(true);
        setActiveGroup('script');
      }
    } catch {
      antdMessage.error(t('assetLibrary.scriptCreateFailed'));
    }
  }, [scriptNameInput, scriptNameSuggestion, antdMessage, refreshAssets, setActiveGroup, t, scopeTab, props.projectId]);

  const handleOpenScriptAsset = useCallback((asset: any) => {
    try {
      const scriptData = asset.data as { kind: 'script'; content: string };
      const parsed = JSON.parse(scriptData.content ?? '');
      const episodes: Episode[] = Array.isArray(parsed) ? parsed : (parsed?.episodes ?? []);
      const activeId = episodes[0]?.id ?? '';
      setScriptEditorEpisodes(episodes);
      setScriptEditorActiveId(activeId);
      setScriptEditorAssetId(asset.id);
      setScriptEditorTitle(asset.title);
      setScriptEditorOpen(true);
    } catch {
      const scriptData = asset.data as { kind: 'script'; content: string } | null;
      const rawContent = scriptData?.content ?? '';
      const fallbackEpisode: Episode = { id: `ep-${Date.now()}`, number: 0, title: asset.title, content: rawContent };
      setScriptEditorEpisodes([fallbackEpisode]);
      setScriptEditorActiveId(fallbackEpisode.id);
      setScriptEditorAssetId(asset.id);
      setScriptEditorTitle(asset.title);
      setScriptEditorOpen(true);
    }
  }, []);

  const handleScriptImportComplete = useCallback((scriptState: any) => {
    setScriptImportOpen(false);
    if (!scriptState || !scriptState.versions.length) return;
    const newEpisodes = scriptState.versions[0]!.episodes;
    if (!newEpisodes.length) return;
    setScriptEditorEpisodes(newEpisodes);
    setScriptEditorActiveId(newEpisodes[0]!.id);
  }, []);

  const currentScriptAsset = useMemo(() => {
    if (!scriptEditorAssetId) return null;
    return assets.find(a => a.id === scriptEditorAssetId) || null;
  }, [assets, scriptEditorAssetId]);

  const currentScriptAssetRef = useRef(currentScriptAsset);
  currentScriptAssetRef.current = currentScriptAsset;

  useEffect(() => {
    if (!scriptEditorOpen || !scriptEditorAssetId) return;
    if (scriptEditorEpisodes.length === 0) return;
    const timer = setTimeout(async () => {
      const asset = currentScriptAssetRef.current;
      if (!asset) return;
      // 2026-11-05 约定：公共库资产就地编辑写回公共作用域，不再拦截
      const text = JSON.stringify({ episodes: scriptEditorEpisodes });
      await updateAsset(scriptEditorAssetId, {
        title: scriptEditorTitle || asset.title,
        data: { ...asset.data, content: text } as any,
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [scriptEditorEpisodes, scriptEditorTitle, scriptEditorOpen, scriptEditorAssetId, updateAsset]);

  const handleCloseScriptEditor = useCallback(() => {
    const assetId = scriptEditorAssetId;
    const episodes = scriptEditorEpisodes;
    const title = scriptEditorTitle;
    const asset = currentScriptAssetRef.current;
    setScriptEditorOpen(false);
    if (assetId && episodes.length > 0 && asset) {
      // 2026-11-05 约定：公共库资产就地编辑写回公共作用域，不再拦截
      const text = JSON.stringify({ episodes });
      updateAsset(assetId, {
        title: title || asset.title,
        data: { ...asset.data, content: text } as any,
      });
    }
  }, [scriptEditorAssetId, scriptEditorEpisodes, scriptEditorTitle, updateAsset]);

  // ── 删除 ──
  const handleConfirmDelete = useCallback(async () => {
    if (!confirmDelete) return;
    try {
      if (confirmDelete.type === 'asset') {
        // 2026-11-05 约定：就地删除（含公共库资产），3 秒浮层可撤销；
        // 若仍被引用只提示「有 N 处引用已失效」，不阻断、不用确认框
        const target = assets.find((a) => a.id === confirmDelete.id);
        await deleteAssetsWithUndo({
          assets: target ? [target] : [{ id: confirmDelete.id } as any],
          projectId,
          message: antdMessage,
          t,
          onRestored: () => { void refreshAssets(); },
        });
        await refreshAssets();
      }
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('assetLibrary.saveFailed'));
    }
    setConfirmDelete(null);
  }, [confirmDelete, refreshAssets, antdMessage, t, assets, projectId]);

  // ── 多选 ──
  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleToggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === allItems.length) {
        return new Set();
      }
      return new Set(allItems.map((item) => item.data.id));
    });
  }, [allItems]);

  // ── 批量删除 ──
  const handleBatchDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    // 2026-11-05 约定：不再过滤公共库资产——项目内操作与公共库等价，选中即可删（浮层可撤销）
    const selectedAssets = allItems.filter((item) => item.type === 'asset' && selectedIds.has(item.data.id));
    if (selectedAssets.length === 0) return;
    const writableIds = selectedAssets.map((item) => item.data.id);
    modal.confirm({
      title: t('assetLibrary.batchDeleteTitle'),
      content: t('assetLibrary.batchDeleteConfirm', { count: writableIds.length }),
      okText: t('assetLibrary.delete'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      centered: true,
      onOk: async () => {
        try {
          if (writableIds.length > 0) {
            await removeAssets(writableIds);
          }
          await refreshAssets();
          setSelectedIds(new Set());
          setMultiSelectEnabled(false);
          antdMessage.success(t('assetLibrary.deleteSuccess'));
        } catch (err) {
          antdMessage.error(err instanceof Error ? err.message : t('assetLibrary.deleteFailed'));
        }
      },
    });
  }, [selectedIds, allItems, removeAssets, refreshAssets, antdMessage, t, modal]);

  useEffect(() => {
    if (!multiSelectEnabled) {
      setSelectedIds(new Set());
    }
  }, [multiSelectEnabled]);

  // ── 发送到画布 ──
  const handleSendToCanvas = useCallback((item: SendToCanvasItem) => {
    props.onSendToCanvas?.(item);
  }, [props.onSendToCanvas]);

  // ── 下载 ──
  // 2026-11-07 修复：生成产物只有 storageKey（image:/video:/audio:/cas:），
  // 统一由 downloadAsset 按 storageKey 读盘后触发下载；无文件时明确提示，不再静默无反应。
  // withGuide=true：视频 + 引导数据分两个文件落盘（需求 1）。
  const handleDownloadItem = useCallback(async (
    item: { type: 'asset'; data: any },
    opts?: { withGuide?: boolean },
  ): Promise<void> => {
    if (item.type !== 'asset') return;
    const ok = await downloadAsset(item.data as Asset).catch(() => false);
    if (!ok) {
      antdMessage.error(t('assetLibrary.downloadFailed', '下载失败：文件不存在或已被清理'));
      return;
    }
    if (!opts?.withGuide) return;
    const guide = getGuideMeta(item.data) ?? await resolveGuideForAsset(item.data as Asset);
    if (!guide?.id) {
      antdMessage.warning(t('assetLibrary.guideMissing', '该视频没有引导数据'));
      return;
    }
    const saved = await downloadGuideFile(guide, `${item.data.title ?? '视频'} 引导`).catch(() => false);
    if (!saved) antdMessage.error(t('assetLibrary.guideDownloadFailed', '引导数据下载失败：文件不存在或 ComfyUI 未连接'));
  }, [antdMessage, t]);

  // ── 重命名 ──
  const handleRenameItem = useCallback(async () => {
    if (!renameItemTarget || !renameItemName.trim()) return;
    // 2026-11-05 约定：公共库资产就地重命名写回公共作用域，不再拦截
    try {
      let finalName = renameItemName.trim();
      if (renameItemTarget.type === 'asset' && finalName.includes('.')) {
        const lastDot = finalName.lastIndexOf('.');
        if (lastDot > 0) {
          finalName = finalName.substring(0, lastDot);
        }
      }
      if (renameItemTarget.type === 'asset') {
        await updateAsset(renameItemTarget.id, { title: finalName });
        await refreshAssets();
      }
      setRenameItemOpen(false);
      setRenameItemName('');
      setRenameItemTarget(null);
      antdMessage.success(t('assetLibrary.saveSuccess'));
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('assetLibrary.saveFailed'));
    }
  }, [renameItemTarget, renameItemName, refreshAssets, updateAsset, antdMessage, t]);

  // ── 打开项目 ──
  const handleOpenItem = useCallback((item: PageItem) => {
    if (item.type === 'asset') {
      if (item.data.kind === 'script') {
        handleOpenScriptAsset(item.data);
      } else {
        setAssetDetail(item.data);
      }
    } else if (item.type === 'hierarchy') {
      // 征集 #87 验收轮九:层级条目打开 = 画布聚焦该节点(不回弹抽屉,支持连续浏览定位)
      props.onOpenHierarchyNode?.(item.data.id);
    }
  }, [handleOpenScriptAsset, props]);

  // ── 分类/搜索变化时重置分页（筛选维度已派生，无需多 effect 同步） ──
  useEffect(() => {
    setPage(1);
  }, [activeGroup, activeChild, search]);

  // ── 返回 ──
  return {
    isAuthenticated,
    isMobile,
    theme,
    assets,
    loadingAssets,
    refreshAssets,
    categories,
    activeGroup,
    activeChild,
    contentType,
    scopeTab,
    setScopeTab,
    projectId,
    scopeCounts,
    search,
    viewMode,
    multiSelectEnabled,
    selectedIds,
    page,
    PAGE_SIZE,
    allItems,
    pageItems,
    dragOver,
    dragCounterRef,
    confirmDelete,
    renameItemOpen,
    renameItemName,
    renameItemTarget,
    scriptNamePromptOpen,
    scriptNameInput,
    scriptNameSuggestion,
    scriptEditorOpen,
    scriptEditorEpisodes,
    scriptEditorActiveId,
    scriptEditorTitle,
    scriptEditorAssetId,
    scriptImportOpen,
    scanningProgress,
    scanningMessage,
    assetDetail,
    handleUpload,
    handleUploadScript,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleNewScript,
    handleConfirmNewScript,
    handleOpenScriptAsset,
    handleScriptImportComplete,
    handleCloseScriptEditor,
    handleConfirmDelete,
    handleToggleSelect,
    handleToggleSelectAll,
    handleBatchDelete,
    handleSendToCanvas,
    handleDownloadItem,
    handleRenameItem,
    handleOpenItem,
    setActiveGroup,
    setActiveChild,
    setSearch,
    setViewMode,
    setMultiSelectEnabled,
    setPage,
    setConfirmDelete,
    setRenameItemOpen,
    setRenameItemName,
    setRenameItemTarget,
    setScriptNamePromptOpen,
    setScriptNameInput,
    setScriptEditorOpen,
    setScriptEditorEpisodes,
    setScriptEditorActiveId,
    setScriptEditorTitle,
    setScriptImportOpen,
    setScanningProgress,
    setScanningMessage,
    setAssetDetail,
    updateAsset,

  };
}





