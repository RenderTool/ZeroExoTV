/**
 * canvas-assets/groups/HistoryGroup - 画布资产抽屉「历史」分组（2026-11-04 本地版重建）
 *
 * 背景：旧「产出历史」分组是云端版功能（zeroexo-platform CanvasAssetsGroup，数据源
 * GET /api/ai/generations），本地版 CLOUD_ENABLED=false 整体不跑云端，不能恢复旧组件——
 * 本组件是本地重建版（2026-11-04 约定口径修正）：历史 = **API/生成链路产物**，
 * 唯一判据 data.origin='generation'（isGenerationAsset，由 history-autoland 在生成完成点写入，
 * 附 jobId/provider/model/prompt/durationSec/frames/createdAt 自证元数据）；
 * 用户手动上传/拖入/素材库添加的资产一律不进历史。按 createdAt 倒序。
 *
 * 结构（2026-11-07 用户指令：来源 Tab）：
 *   第一层「从画布生成 / 从导演台」来源胶囊（与抽屉素材「全局/本项目」同款 CapsuleTabs）；
 *   第二层「图片 / 视频」两个子分类（CategoryChips）+ 网格卡片 + 分页（>50）。
 *   来源由 data.originSource 决定（存量记录按 provider/标题兜底，见 getHistorySource）。
 * 卡片：缩略图懒加载（IntersectionObserver，进入视口才解析 blob URL）+
 *       相对时间（hover title 显示绝对时间）+ 尺寸/时长 + hover 操作（定位/加入资产库/下载）。
 * 视频卡片 hover 播放预览（沿用 asset-card 的悬停播放模式，不新造播放器）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { App, Button, Dropdown, Modal, Select, Tooltip } from 'antd';
import { CheckSquare, ChevronDown, Download, FileText, Film, Image as ImageIcon, ImagePlus, LibraryBig, MoreHorizontal, Pencil, Share2, Square, Star, Trash2, UserRound, Waypoints } from 'lucide-react';
import type { ThemeConfig } from '@zeroexo/shared';
import { getCurrentCanvasId } from '@/shared/current-canvas-id.js';
import { getCanvas, createCanvas, saveCanvas, MAIN_CANVAS_ID } from '@/entities/canvas-store.js';
import { useCanvasTabStore } from '@/features/canvas-tabs/canvas-tab-store.js';
import { usePreviewImage, nodeActionBus, IMAGE_FIT_BOX, fitMediaSize } from '@zeroexo/plugin-nodes';
import type { Asset } from '@/features/asset-picker/index.js';
import { downloadAssetsAsZip } from '@/features/asset-picker/services/download-asset.js';
import { deleteAssetsWithUndo } from '@/features/asset-library/delete-with-undo.jsx';
import { updateAsset } from '@/features/asset-picker/asset-store.js';
import { LOCAL_IMAGE_MODEL_KEY } from '@/features/canvas-tabs/zeroexo-jobs-client.js';
import { isShotLocked } from '@/features/canvas-assets/director-run-lock.js';
import { assetMayHaveGuide } from '@/features/asset-picker/services/guide-resolve.js';
import { MediaLightbox } from '@/shared/components/media-lightbox.js';
import { readWorkbenchContainer } from '@/entities/slot-containers.js';
import { readScript, displayEpisodeTitle } from '@/entities/script-store.js';
import { MultiSelectCheckbox } from '@/features/asset-library/components/multi-select-checkbox.js';
import { CapsuleTabs } from '@/features/asset-library/components/capsule-tabs.js';
import type { CanvasAssetsPanelStore } from '../store.js';
import { sendAssetToWorkbench, sendGuideToWorkbench, sendVideoAsSegmentCover } from '../send-to-workbench.js';
import { openSubjectLinkDialog } from '@/features/canvas-nodes/storyboard/subject-link-dialog.js';
import { CategoryChips, EmptyState, PaginationBar, SCROLL_AREA_STYLE, SearchBox, ToolbarRow } from '../components/common.js';
import { IconButton, ThumbBadge, UI_CARD_HOVER_OVERLAY, UI_CARD_INFO_PADDING_X } from '@/shared/ui/index.js';
import {
  HISTORY_PAGE_SIZE,
  countHistoryBySourceAndKind,
  filterHistoryAssets,
  fmtDuration,
  fmtRelativeTime,
  paginate,
  type HistoryKind,
  type HistorySource,
} from '../history-utils.js';

/** 卡片栅格唯一规则（2026-11-19 用户口径）：与主体库封面页同一套——repeat(auto-fill, minmax(220px, 1fr)) + gap 16。
 *  主体封面 / 主体状态 / 分镜历史封面 / 分镜版本卡 全部走这里，禁止再出现 260px 上限或瀑布流那一套。 */
const CARD_GRID_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
  gap: 16,
};

/** 来源 Tab 选择按项目记住（与素材分组 materialScopeTab 同款体验） */
const HISTORY_SOURCE_PREF_KEY = 'zeroexo.history.sourceTab';

function readInitialHistorySource(): HistorySource {
  try {
    return localStorage.getItem(HISTORY_SOURCE_PREF_KEY) === 'director' ? 'director' : 'canvas';
  } catch {
    return 'canvas';
  }
}

/** 历史卡与素材/主体/资产页共用同一套瀑布流列宽断点（不再单独 150px 网格） */

/** 进入视口才渲染子内容（缩略图解析延迟到可见时）；无 IO 环境（jsdom/老浏览器）直接可见 */
export function LazyVisible({ children }: { children: (visible: boolean) => ReactNode }): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (visible || typeof IntersectionObserver === 'undefined') return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    }, { rootMargin: '100px' });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);
  return <div ref={ref}>{children(visible)}</div>;
}

function ActionButton({ title, onClick, theme, disabled = false, size = 24, children }: {
  title: string;
  onClick: () => void;
  theme: ThemeConfig;
  disabled?: boolean;
  /** 信息行内 24（与主体卡 IconButton sm 同档）；需要更大时显式传 28 */
  size?: number;
  children: ReactNode;
}): React.ReactElement {
  // 2026-11-19 用户反馈：画布历史卡的动作按钮是「黑/白实心小方块」，跟主体卡的幽灵图标
  // （透明底 + hover 底色 + Tooltip）不是一套。这里统一走 IconButton ghost，颜色全部取
  // theme token，不再写死 #fff / #1f2937。
  return (
    <Tooltip title={title}>
      <span style={{ display: 'inline-flex' }}>
        <IconButton
          theme={theme}
          size={size >= 28 ? 'md' : 'sm'}
          aria-label={title}
          disabled={disabled}
          onClick={(e) => { e.stopPropagation(); if (!disabled) onClick(); }}
        >
          {children}
        </IconButton>
      </span>
    </Tooltip>
  );
}

/**
 * 链路快照的固有排版：**竖向成列**（上游在左、下游在右），
 * 同一列内按原 y 从上到下排，节点之间留固定间距，绝不重叠。
 * 主画布里节点可能挤在一起或被遮挡，但历史视图必须是排好序的。
 */
function layoutChainVertically(
  nodes: Array<Record<string, unknown>>,
  edges: Array<{ source?: { nodeId?: string }; target?: { nodeId?: string } }>,
): void {
  const sizeOf = (n: Record<string, unknown>): { width: number; height: number } => {
    const s = n.size as { width?: number; height?: number } | undefined;
    const d = (n.data ?? {}) as Record<string, unknown>;
    const natW = Number(d.naturalWidth);
    const natH = Number(d.naturalHeight);
    if (natW > 0 && natH > 0) return fitMediaSize(natW, natH, IMAGE_FIT_BOX);
    const w = typeof s?.width === 'number' && s.width > 0 ? s.width : 260;
    const h = typeof s?.height === 'number' && s.height > 0 ? s.height : 200;
    // 统一尺寸规则：链路快照里的节点同样等比装进 620×348 展示框，
    // 避免「末尾产物比参考图小很多」。
    return fitMediaSize(w, h, IMAGE_FIT_BOX);
  };
  const idOf = (n: Record<string, unknown>): string => String(n.id ?? '');
  const ids = new Set(nodes.map(idOf));
  const parents = new Map<string, string[]>();
  for (const e of edges) {
    const s = e.source?.nodeId;
    const t = e.target?.nodeId;
    if (!s || !t || !ids.has(s) || !ids.has(t)) continue;
    const list = parents.get(t) ?? [];
    list.push(s);
    parents.set(t, list);
  }
  // 深度 = 最长上游链长度（环/重复引用只会让深度停在有限值，不会死循环）
  const depth = new Map<string, number>();
  const resolve = (id: string, guard: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (guard.has(id)) return 0;
    guard.add(id);
    const ps = parents.get(id) ?? [];
    const d = ps.length === 0 ? 0 : Math.max(...ps.map((p) => resolve(p, guard) + 1));
    guard.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const id of ids) resolve(id, new Set());

  const columns = new Map<number, Array<Record<string, unknown>>>();
  for (const n of nodes) {
    const d = depth.get(idOf(n)) ?? 0;
    const list = columns.get(d) ?? [];
    list.push(n);
    columns.set(d, list);
  }
  const GAP_X = 120;
  const GAP_Y = 48;
  const TOP = 60;
  let cursorX = 60;
  for (const d of [...columns.keys()].sort((a, b) => a - b)) {
    const list = columns.get(d)!.slice().sort((a, b) => {
      const ay = (a.position as { y?: number } | undefined)?.y ?? 0;
      const by = (b.position as { y?: number } | undefined)?.y ?? 0;
      if (ay !== by) return ay - by;
      return ((a.position as { x?: number } | undefined)?.x ?? 0) - ((b.position as { x?: number } | undefined)?.x ?? 0);
    });
    let cursorY = TOP;
    let colWidth = 0;
    for (const n of list) {
      const size = sizeOf(n);
      n.position = { x: cursorX, y: cursorY };
      n.size = { width: size.width, height: size.height };
      cursorY += size.height + GAP_Y;
      colWidth = Math.max(colWidth, size.width);
    }
    cursorX += colWidth + GAP_X;
  }
}

/**
 * 链路的稳定标识：由「整条链路节点 id 集合」算出哈希。
 * 同一条链路从不同产物卡片打开 = 同一份只读快照，不会每个产物都复制一遍节点。
 */
function chainCanvasIdOf(ids: string[]): string {
  const sorted = [...ids].sort().join('|');
  let h = 0;
  for (let i = 0; i < sorted.length; i += 1) h = (h * 31 + sorted.charCodeAt(i)) | 0;
  return `scchain${(h >>> 0).toString(36)}${sorted.length}`;
}

function HistoryCard({ asset, visible, selected, selectMode, onToggleSelect, onPromote, onDownload, onSetCover, onSendCanvas, onRename, onDelete, onEdit, cover, versionLabel, theme, t }: {
  asset: Asset;
  visible: boolean;
  /** 多选模式：是否选中 */
  selected?: boolean;
  selectMode?: boolean;
  onToggleSelect?: () => void;
  onPromote: (target: 'project' | 'library') => void;
  onDownload: (opts?: { withGuide?: boolean }) => void;
  /** 发送源视频到导演台当前片段 */
  onSendVideo?: () => void;
  /** 发送引导到导演台当前片段（仅视频自带 guide 时可用） */
  onSendGuide?: () => void;
  /** 历史视频设为当前片段封面（= 选中该片段的当前缓存版本） */
  onSetCover?: () => void;
  /** 该版本是否是所属片段的当前封面（默认最新版本） */
  cover?: boolean;
  /** 版本序号文案（如「第 2 版」），导演台分组视图用 */
  versionLabel?: string;
  /** 发送到当前画布 */
  onSendCanvas?: () => void;
  /** 重命名（更多菜单） */
  onRename?: () => void;
  /** 删除（更多菜单） */
  onDelete?: () => void;
  /** 图片历史产出「编辑」：开画布图片编辑页签（视频不支持） */
  onEdit?: () => void;
  theme: ThemeConfig;
  t: (key: string, opts?: { defaultValue?: string }) => string;
}): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  // 2026-11-05 用户定稿：历史产出也走统一 MediaLightbox 壳（图片/视频同一 UI）
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [sendMenuOpen, setSendMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const data = asset.data as { kind: string; dataUrl?: string; url?: string; storageKey?: string; width?: number; height?: number; durationMs?: number; guide?: { id?: string } };
  const isVideo = data.kind === 'video';
  /** 2026-11-19 用户口径：历史卡与主体卡统一 16:9 封面（contain 不裁图），卡片高度不再随素材比例乱跳 */
  const coverRatio = '16 / 9';
  const hasGuide = isVideo && assetMayHaveGuide(asset);
  const isDark = theme.mode === 'dark';
  // 缩略图三档契约（与 asset-card 同款）：未进入视口时不解析（懒加载）
  const hydrated = usePreviewImage(visible ? data.storageKey : undefined, visible ? (data.dataUrl || data.url || '') : '');
  const duration = fmtDuration(data.durationMs);
  const promptText = (data as { generation?: { prompt?: string }; prompt?: string }).generation?.prompt
    ?? (data as { prompt?: string }).prompt
    ?? '';
  // 生成链路：图生图的参考图（@图片N 溯源用），记录在 generation.sourceStorageKey/sourceNodeId
  const generationRef = (data as {
    generation?: { sourceStorageKey?: string; sourceNodeId?: string; model?: string };
  }).generation;
  const referenceKey = generationRef?.sourceStorageKey;
  const { message: cardMessage } = App.useApp();
  const openCanvasTab = useCanvasTabStore((s) => s.openCanvasTab);

  /** 打开生成链路：把这张图的「参考图 → 提示词 → 产物」挂载成一块只读历史子画布 */
  const openChainCanvas = async (): Promise<boolean> => {
    const projectId = getCurrentCanvasId();
    if (!projectId) return false;
    // 旧快照兜底：主画布节点被删掉后，资产记录里可能已经没有 sourceStorageKey/sourceNodeId，
    // 但此前的链路快照还在——直接打开那份快照，别让用户看到「没有链路」。
    const legacyCid = `scchain${String(asset.id).replace(/[^a-z0-9]/gi, '').slice(0, 40)}`.toLowerCase();
    const openLegacySnapshot = async (): Promise<boolean> => {
      const snap = await getCanvas(projectId, legacyCid).catch(() => null);
      if (!snap) return false;
      const live = ((snap.graph.nodes ?? []) as Array<{ _deleted?: boolean }>).filter((n) => !n._deleted);
      if (live.length === 0) return false;
      openCanvasTab({ cid: legacyCid, title: snap.doc.title });
      return true;
    };
    // 老版本资产没有记录提示词/参考图：打开一个空链路没有任何意义，
    // 直接按「历史版本、没有提示词记录」处理，不建画布。
    if (!promptText && !referenceKey) return openLegacySnapshot();
    // 生成引用链（2026-11-18）：资产记录里持久化的「本次上游资产 + 产物 + 参数」，
    // 是历史视图的第一事实源；主画布节点删了也不影响它。
    const storedChain = (asset.data as {
      generation?: {
        chain?: {
          nodes?: Array<Record<string, unknown>>;
          edges?: Array<Record<string, unknown>>;
          inputs?: Array<{ slot: number; nodeId?: string; storageKey?: string }>;
          params?: Record<string, unknown>;
        };
      };
    }).generation?.chain;
    const nodeId = (asset.data as { originNodeId?: string }).originNodeId;
    const nodeIds = [generationRef?.sourceNodeId, nodeId].filter((x): x is string => typeof x === 'string' && Boolean(x));
    if (nodeIds.length === 0 && !promptText && !referenceKey) return false;
    try {
      const loaded = await getCanvas(projectId, MAIN_CANVAS_ID);
      if (!loaded && !storedChain?.nodes?.length) return false;
      const present = (loaded?.graph.nodes as Array<{ id: string }> ?? []).map((n) => n.id);
      const storedNodes = storedChain?.nodes ?? [];
      // 历史链只认持久化记录（2026-11-18）：
      // 有链 → 原样渲染，绝不掺 live 节点（live 已被删/被替换，拼进来就是红狗链里出猫咪）；
      // 没链 → 只渲染产物本身，绝不按 live graph 反推上游。
      const hasStoredChain = storedNodes.length > 0;
      let chainNodes: Array<Record<string, unknown>>;
      let chainEdges: Array<{ id?: string; source: { nodeId: string }; target: { nodeId: string } }> = [];
      if (hasStoredChain) {
        // 历史链节点数据做一次归一：旧记录把模型写成「qwen」这种展示名、也不带 paramValues，
        // 面板就会只显示一个错标签、没有尺寸/步数/seed。统一映射到真实模型 key 并补上链级参数。
        chainNodes = storedNodes.map((n) => {
          const raw = { ...((n.data as Record<string, unknown> | undefined) ?? {}) };
          if (typeof raw.model === 'string' && !raw.model.startsWith('zeroexo:')
            && (raw.model === 'qwen' || raw.model.toLowerCase().includes('qwen'))) {
            raw.model = LOCAL_IMAGE_MODEL_KEY;
          }
          if (!raw.paramValues && storedChain?.params && !String(n.id ?? '').startsWith('chain_input_')) {
            raw.paramValues = { ...storedChain.params };
          }
          return { ...n, data: raw };
        });
        chainEdges = (storedChain?.edges ?? []) as typeof chainEdges;
        // @ 引用的输入不一定挂在画布连线上（@图片N 来自素材/主体），
        // 但它们在「本次提交」里确实参与了生成：按 inputs 的 storageKey 补成只读参考节点。
        // 不合成连线——合成线的 pin 与真实 pin 对不上，会画出漂浮错位线。
        const knownKeys = new Set(
          chainNodes.map((n) => String((n.data as { storageKey?: string } | undefined)?.storageKey ?? '')),
        );
        for (const input of storedChain?.inputs ?? []) {
          const key = input.storageKey ?? '';
          if (!key || knownKeys.has(key)) continue;
          const id = input.nodeId || `input_${input.slot}`;
          knownKeys.add(key);
          chainNodes.push({
            id,
            type: 'image',
            position: { x: 60, y: 60 + (input.slot - 1) * 380 },
            title: `参考图${input.slot}`,
            size: { width: IMAGE_FIT_BOX.width, height: IMAGE_FIT_BOX.height },
            data: {
              kind: 'image',
              storageKey: key,
              content: '',
              status: 'success',
              __readonly: true,
            },
          });
        }
      } else {
        const productLiveId = nodeId && present.includes(nodeId) ? nodeId : '';
        const liveProduct = productLiveId
          ? (loaded!.graph.nodes as unknown as Array<Record<string, unknown>>).find((n) => String(n.id) === productLiveId)
          : undefined;
        if (liveProduct) {
          chainNodes = [liveProduct];
        } else {
          // 产物节点已被删除：用资产记录造一个只读产物节点，历史至少还看得到这张图与这次参数
          const dw = typeof data.width === 'number' ? data.width : 768;
          const dh = typeof data.height === 'number' ? data.height : 1024;
          chainNodes = [{
            id: (asset.data as { originNodeId?: string }).originNodeId || `asset_${asset.id}`,
            type: isVideo ? 'video' : 'image',
            position: { x: 60, y: 60 },
            size: fitMediaSize(dw, dh, IMAGE_FIT_BOX),
            title: promptText.slice(0, 24) || t('assetLibrary.viewPrompt', { defaultValue: '查看提示词' }),
            data: {
              kind: isVideo ? 'video' : 'image',
              storageKey: data.storageKey,
              content: '',
              prompt: promptText,
              status: 'success',
              model: generationRef?.model,
              naturalWidth: dw,
              naturalHeight: dh,
              width: dw,
              height: dh,
              paramValues: (data as { generation?: { params?: Record<string, unknown> } }).generation?.params,
            },
          }];
        }
      }
      const allNodes = chainNodes;
      const chainGraph = {
        // 快照只包含「这条链路自己的节点」：参考图 + 中间产物 + 本产物，绝不拷整张主画布。
        // 每个节点打 __readonly：节点视图据此隐藏替换图片等编辑入口（位置/尺寸仍可调）。
        nodes: allNodes.map((n) => {
          const data: Record<string, unknown> = {
            ...((n.data as Record<string, unknown> | undefined) ?? {}),
            __readonly: true,
          };
          // 2026-11-18 图裂：会话级 blob:/dataURL 不写进链路快照（CAS 键可复现，只留 storageKey）
          const key = typeof data.storageKey === 'string' ? (data.storageKey as string) : '';
          if (key.startsWith('cas:')) {
            delete data.content;
            delete data.dataUrl;
            delete data.url;
            delete data.localJob;
          }
          return { ...n, data };
        }),
        edges: chainEdges,
        viewport: { x: 0, y: 0, k: 1 },
        metadata: {
          savedFrom: 'generation-chain',
          readOnly: true,
          chainMissing: !hasStoredChain,
          chainNodeIds: allNodes.map((n) => String((n as { id?: string }).id ?? '')),
          seedNodeId: allNodes.length > 0 ? String((allNodes[allNodes.length - 1] as { id?: string }).id ?? '') : undefined,
        },
      };
      // 一条链路节点都没有 → 视为旧版本记录，交给上层提示，不建空画布
      if (chainGraph.nodes.length === 0) return false;
      // 固有规则：链路竖向成列排布（上游左、下游右，同列自上而下），杜绝节点互相压住
      layoutChainVertically(chainGraph.nodes as unknown as Array<Record<string, unknown>>, chainGraph.edges);

      // 稳定的链路标识：同一条链路（同一组节点 id）永远落回同一份只读快照，
      // 不会「每张产物卡片都复制一整条链」。
      const cid = chainCanvasIdOf(chainGraph.nodes.map((n) => String((n as { id?: string }).id ?? '')));
      const title = promptText.slice(0, 24) || t('assetLibrary.viewPrompt', { defaultValue: '查看提示词' });
      const existing = await getCanvas(projectId, cid).catch(() => null);
      if (existing) {
        const liveNodes = ((existing.graph.nodes ?? []) as Array<{ id?: string; _deleted?: boolean; data?: Record<string, unknown>; position?: unknown }>).filter((n) => !n._deleted);
        const live = liveNodes.length;
        const existingEdges = ((existing.graph.edges ?? []) as Array<{ id?: string; _deleted?: boolean }>);
        // 历史只会补全、不会缩水：主画布节点被删后，已存快照仍应原样打开，
        // 不能拿「当前能重建出的更少节点」覆盖掉历史（否则整条链路变成空壳）。
        if (live > 0 && chainGraph.nodes.length < live) {
          openCanvasTab({ cid, title: existing.doc.title || title });
          return true;
        }
        // 快照完整（有节点、连线没丢、节点已带只读标记、没有早期合成的错位线）才复用；
        // 空壳 / 丢线 / 老快照按当前链路重建同一份画布，否则历史视图永远是坏的。
        const allReadonlyMarked = liveNodes.every((n) => Boolean(n.data?.__readonly));
        const hasSynthEdge = existingEdges.some((e) => String(e.id ?? '').startsWith('edge-chain-'));
        // 数据也要一致：旧快照里模型写成「qwen」、缺 paramValues 时按当前归一结果重建，
        // 否则永远打开的是那份坏数据（用户 2026-11-18 截图里的错标签就是这个）。
        const dataSig = (list: Array<{ id?: string; data?: Record<string, unknown> }>): string => list
          .map((n) => `${String(n.id ?? '')}:${String(n.data?.model ?? '')}:${JSON.stringify(n.data?.paramValues ?? null)}`)
          .sort()
          .join('|');
        const dataSigEqual = dataSig(liveNodes) === dataSig(chainGraph.nodes as Array<{ id?: string; data?: Record<string, unknown> }>);
        if (live > 0 && allReadonlyMarked && !hasSynthEdge && dataSigEqual && (existingEdges.length > 0 || chainGraph.edges.length === 0)) {
          // 排版可能被用户手拖过：只在「位置与竖向排版不一致」时重排一次，避免每次打开都覆盖用户微调
          const currentPositions = liveNodes.map((n) => `${n.id}:${JSON.stringify((n as { position?: unknown }).position ?? null)}`).join('|');
          const laidOutPositions = (chainGraph.nodes as Array<{ id?: string; position?: unknown }>)
            .map((n) => `${String(n.id)}:${JSON.stringify(n.position ?? null)}`).join('|');
          if (currentPositions !== laidOutPositions) {
            await saveCanvas(projectId, cid, { graph: chainGraph as never, title: existing.doc.title || title });
          }
          openCanvasTab({ cid, title: existing.doc.title || title });
          return true;
        }
        await saveCanvas(projectId, cid, { graph: chainGraph as never, title: existing.doc.title || title });
        openCanvasTab({ cid, title: existing.doc.title || title });
        // 不再弹「已打开生成链路」toast：它会盖住画布页签标题（用户 2026-11-18 明确要求去掉）
        return true;
      }

      await createCanvas(projectId, { id: cid, title, graph: chainGraph as never, ephemeral: true });
      openCanvasTab({ cid, title });
      return true;
    } catch (err) {
      console.warn('[HistoryGroup] 打开生成链路失败:', err);
      return false;
    }
  };

  /** 查看提示词：优先挂载生成链路子画布；没有链路数据时退化为提示词 + @图片1 弹层 */
  const openPromptModal = (): void => {
    void openChainCanvas().then((opened) => {
      if (opened) return;
      // 旧版本生成的资产没有链路记录：不回退成提示词文本弹层，直接说清是历史记录
      cardMessage.info(
        t('assetLibrary.legacyNoChain', { defaultValue: '旧版本生成的历史记录，没有提示词和链路可查看' }),
      );
    });
  };

  // 视频悬停播放/暂停（asset-card 同款模式）
  useEffect(() => {
    if (!isVideo || !videoRef.current) return;
    if (hovered) {
      videoRef.current.play().catch(() => undefined);
    } else {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, [hovered]);

  const sizeText = data.width && data.height ? `${data.width}×${data.height}` : '';
  const absTime = new Date(asset.createdAt).toLocaleString();
  const metaText = [fmtRelativeTime(asset.createdAt), versionLabel, sizeText, duration].filter(Boolean).join(' · ');

  /** 动作行：与主体卡同构——放在封面**外面**的信息区（hover 浮出），不再压在图上看不清 */
  const actionRow = (
    <div
      data-history-actions
      onClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0,
        opacity: hovered && !selectMode ? 1 : 0,
        pointerEvents: selectMode ? 'none' : 'auto',
        transition: 'opacity 0.2s',
      }}
    >
    {/* 2026-11-16 用户指令：删除「定位到画布节点」——抽屉重构后 graphStore/onFocusNode 未接线，功能失效无意义 */}
              {/* 编辑直接落在卡片上（用户 2026-11-17：不要只藏在「更多」里）
                  位置与资产卡保持一致：编辑 → 发送 → 更多，编辑永远在最左 */}
              {/* 2026-11-17 用户要求：查看提示词要在卡片上直接可见，不要藏在「发送」菜单里 */}
              <span data-card-action="prompt">
                <ActionButton
                  title={t('assetLibrary.viewPrompt', { defaultValue: '查看提示词' })}
                  onClick={() => openPromptModal()}
                  theme={theme}
                >
                  <FileText size={14} />
                </ActionButton>
              </span>
              {onEdit && (
                <span data-card-action="edit">
                  <ActionButton
                    title={t('assetLibrary.editImage', { defaultValue: '编辑' })}
                    onClick={() => onEdit()}
                    theme={theme}
                  >
                    <Pencil size={14} />
                  </ActionButton>
                </span>
              )}
              {/* 发送统一收纳：发送到画布 / 导演台（源视频、引导）/ 本项目 / 公共资产 */}
              <Dropdown
                open={sendMenuOpen}
                onOpenChange={setSendMenuOpen}
                trigger={['click']}
                menu={{
                  items: [
                    // 2026-11-18 用户口径：所有发送动作统一「发送到…」开头，顺序固定；
                    // 「查看提示词」已从菜单移除（卡片上已有独立入口）。
                    ...(typeof data.storageKey === 'string' && data.storageKey
                      && (data.kind === 'image' || data.kind === 'video' || data.kind === 'audio') ? [{
                      key: 'subject',
                      icon: <UserRound size={13} />,
                      label: t('assetLibrary.sendToSubject', { defaultValue: '发送到主体' }),
                      onClick: () => openSubjectLinkDialog({
                        storageKey: data.storageKey as string,
                        kind: data.kind as 'image' | 'video' | 'audio',
                        sourceLabel: String(asset.title ?? ''),
                      }),
                    }] : []),
                    {
                      key: 'canvas',
                      icon: <ImagePlus size={13} />,
                      label: t('assetLibrary.sendToCanvas', { defaultValue: '发送到画布' }),
                      disabled: !onSendCanvas,
                      onClick: () => onSendCanvas?.(),
                    },
                    // 2026-11-19 用户口径：视频是「视频源 + 引导数据」的集合，成员用卡片上的
                    // 模式切换选择，所以「发送到分镜」「发送引导」两个独立入口一律去掉。
                    {
                      key: 'library',
                      icon: <LibraryBig size={13} />,
                      label: t('assetLibrary.addToPublicLibrary', { defaultValue: '发送到资产' }),
                      onClick: () => onPromote('library'),
                    },
                    // 2026-11-18：没有封面动作时不渲染分割线，避免菜单底部多一根横线
                    ...(onSetCover ? [
                      { type: 'divider' as const },
                      {
                        key: 'cover',
                        icon: <Star size={13} />,
                        label: t('assetLibrary.setSegmentCover', { defaultValue: '设为片段封面' }),
                        onClick: () => onSetCover?.(),
                      },
                    ] : []),
                  ],
                }}
              >
                <span>
                  <ActionButton
                    title={t('assetLibrary.sendTo', { defaultValue: '发送' })}
                    onClick={() => setSendMenuOpen(true)}
                    theme={theme}
                  >
                    <Share2 size={14} />
                  </ActionButton>
                </span>
              </Dropdown>
              {/* 更多最右：只保留 下载 / 重命名 / 删除；编辑已在卡片上常驻，菜单里不再重复 */}
              <Dropdown
                open={moreMenuOpen}
                onOpenChange={setMoreMenuOpen}
                trigger={['click']}
                menu={{
                  items: [
                    ...(hasGuide
                      ? [
                          { key: 'download', icon: <Download size={13} />, label: t('assetLibrary.downloadVideoOnly', { defaultValue: '下载视频' }), onClick: () => onDownload() },
                          { key: 'download-guide', icon: <Download size={13} />, label: t('assetLibrary.downloadVideoWithGuide', { defaultValue: '下载视频+引导' }), onClick: () => onDownload({ withGuide: true }) },
                        ]
                      : [
                          { key: 'download', icon: <Download size={13} />, label: t('common.download', { defaultValue: '下载' }), onClick: () => onDownload() },
                        ]),
                    { type: 'divider' as const },
                    ...(onRename ? [{ key: 'rename', icon: <Pencil size={13} />, label: t('assetLibrary.rename', { defaultValue: '重命名' }), onClick: onRename }] : []),
                    ...(onDelete ? [{ key: 'delete', danger: true, icon: <Trash2 size={13} />, label: t('common.delete', { defaultValue: '删除' }), onClick: onDelete }] : []),
                  ],
                }}
              >
                <span>
                  <ActionButton
                    title={t('common.more', { defaultValue: '更多' })}
                    onClick={() => setMoreMenuOpen(true)}
                    theme={theme}
                  >
                    <MoreHorizontal size={14} />
                  </ActionButton>
                </span>
              </Dropdown>
    </div>
  );
  return (
    <div
      data-history-card={asset.id}
      style={{
        position: 'relative', display: 'flex', flexDirection: 'column', gap: 8, width: '100%',
        outline: selected ? `2px solid ${theme.toolbar.accent}` : 'none',
        outlineOffset: 2,
        borderRadius: 12,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => { if (selectMode) onToggleSelect?.(); }}
    >
      {/* 封面区域（与素材卡片同宽高比/圆角） */}
      <div
        onClick={(e) => {
          if (selectMode) { e.stopPropagation(); onToggleSelect?.(); return; }
          if (data.storageKey) setLightboxOpen(true);
        }}
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: coverRatio,
          borderRadius: 12,
          overflow: 'hidden',
          background: isDark ? 'rgba(255,255,255,0.02)' : '#ffffff',
          border: isDark ? '1px solid rgba(255,255,255,0.06)' : '1px solid #e5e7eb',
          cursor: selectMode ? 'pointer' : data.storageKey ? 'zoom-in' : 'default',
        }}
      >
        {selectMode && (
          <MultiSelectCheckbox
            selected={!!selected}
            onToggle={() => onToggleSelect?.()}
            accentColor={theme.toolbar.accent}
          />
        )}
        {visible && hydrated ? (
          isVideo ? (
            <video
              ref={videoRef}
              src={hydrated}
              muted
              loop
              playsInline
              preload="metadata"
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            />
          ) : (
            <img
              src={hydrated}
              alt={asset.title}
              loading="lazy"
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            />
          )
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.toolbar.textMuted }}>
            {isVideo ? <Film size={22} /> : <ImageIcon size={22} />}
          </div>
        )}
        {/* 类型标签（左上角）：与开源库/主体卡统一用 ThumbBadge（深色底白字） */}
        <ThumbBadge style={{ position: 'absolute', top: 6, left: selectMode ? 34 : 6, zIndex: 2 }}>
          {isVideo ? <Film size={10} /> : <ImageIcon size={10} />}
          {isVideo ? t('assetLibrary.filterVideo', { defaultValue: '视频' }) : t('assetLibrary.filterImage', { defaultValue: '图片' })}
        </ThumbBadge>
        {cover && (
          <span data-cover-badge={asset.id} style={{ position: 'absolute', left: 6, bottom: 6, zIndex: 3 }}>
            <ThumbBadge>
              <Star size={10} />
              {t('assetLibrary.segmentCover', { defaultValue: '当前封面' })}
            </ThumbBadge>
          </span>
        )}
        {hasGuide && (
          /* 2026-11-11 用户要求：这里只是「含引导」标签，不要做成下载入口（下载在 hover 菜单里） */
          <span
            data-guide-badge={asset.id}
            style={{ position: 'absolute', top: 6, right: 6, zIndex: 3 }}
          >
            <ThumbBadge>
              <Waypoints size={10} />
              {t('assetLibrary.hasGuide', { defaultValue: '含引导' })}
            </ThumbBadge>
          </span>
        )}
        {/* 直接可见的封面按钮：不用 hover 才出现，任何非当前封面版本都能一键设回 */}
        {onSetCover && !cover && (
          <span
            data-history-set-cover
            style={{ position: 'absolute', left: 6, bottom: 6, zIndex: 4 }}
            onClick={(e) => e.stopPropagation()}
          >
            <ActionButton
              title={t('assetLibrary.setSegmentCoverHint', { defaultValue: '设为该片段封面（替换分镜显示并更新下一段引导）' })}
              onClick={onSetCover}
              theme={theme}
            >
              <Star size={14} />
            </ActionButton>
          </span>
        )}
      </div>
      {/* 信息区（与主体卡同构）：名称行 + 元信息行；动作图标在元信息行右侧、hover 浮出，不再压在封面图上 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
        paddingLeft: UI_CARD_INFO_PADDING_X, paddingRight: UI_CARD_INFO_PADDING_X,
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            title={asset.title}
            style={{
              fontSize: 12, fontWeight: 500, color: theme.toolbar.text,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            {asset.title || (isVideo
              ? t('assetLibrary.untitledVideo', { defaultValue: '视频' })
              : t('assetLibrary.untitledImage', { defaultValue: '图片' }))}
          </div>
          <div
            title={absTime}
            style={{
              fontSize: 11, color: theme.toolbar.textMuted, marginTop: 2,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            {metaText}
          </div>
        </div>
        {actionRow}
      </div>
      {lightboxOpen && (
        <MediaLightbox
          items={[{
            id: asset.id, title: asset.title, kind: isVideo ? 'video' : 'image',
            storageKey: data.storageKey, source: '历史产出',
          }]}
          index={0}
          onIndexChange={() => undefined}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * 分镜历史一级卡片（片段集合）：与主体卡同构
 * ——16:9 固定封面（contain 不裁）+ 名称行 + 元信息行；动作图标在**元信息行右侧**、hover 才浮出。
 * 2026-11-19 用户口径：不要把删除按钮常驻在名称行，也不要浮在封面上。
 */
function DirectorSegmentCard({ theme, shotId, label, versionLabel, deleteLabel, coverKey, selected, selectMode, onOpen, onToggleSelect, onDelete }: {
  theme: ThemeConfig;
  shotId: string;
  label: string;
  versionLabel: string;
  deleteLabel: string;
  coverKey?: string;
  selected: boolean;
  selectMode: boolean;
  onOpen: () => void;
  onToggleSelect?: () => void;
  onDelete?: () => void;
}): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  /** 与主体卡同一套封面解析（storageKey → 预览 URL），视频用 <video preload=metadata> 取首帧 */
  const preview = usePreviewImage(coverKey, '');
  return (
    <div
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {selectMode && onToggleSelect && (
        <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 2 }}>
          <MultiSelectCheckbox selected={selected} onToggle={onToggleSelect} accentColor={theme.toolbar.accent} />
        </div>
      )}
      <div
        role="button"
        tabIndex={0}
        data-director-segment={shotId}
        onClick={() => { if (selectMode) { onToggleSelect?.(); return; } onOpen(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
        style={{
          display: 'flex', flexDirection: 'column', gap: 6, textAlign: 'left', width: '100%',
          padding: 0, border: 'none', borderRadius: 0, cursor: 'pointer', fontFamily: 'inherit',
          background: 'transparent',
        }}
      >
        {/* 封面：固定 16:9，与主体卡同一套圆角/边框/悬停蒙版；图片 contain 完整显示不裁切 */}
        <div style={{
          position: 'relative', width: '100%', aspectRatio: '16 / 9', overflow: 'hidden', borderRadius: 12,
          border: `1px solid ${selected ? theme.toolbar.accent : theme.toolbar.border}`,
          background: theme.mode === 'dark' ? 'rgba(255,255,255,0.02)' : '#ffffff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {preview ? (
            <video
              src={preview}
              muted
              loop
              playsInline
              preload="metadata"
              title={label}
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            />
          ) : (
            <Film size={22} style={{ color: theme.toolbar.textMuted }} />
          )}
          <div style={{
            position: 'absolute', inset: 0, background: UI_CARD_HOVER_OVERLAY,
            opacity: hovered ? 1 : 0, transition: 'opacity .3s', pointerEvents: 'none',
          }} />
        </div>
        {/* 信息区：名称行（12/22/500）+ 元信息行（11/500，右侧动作 hover 浮出） */}
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 2,
          paddingLeft: UI_CARD_INFO_PADDING_X, paddingRight: UI_CARD_INFO_PADDING_X,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', height: 24 }}>
            <span style={{
              fontSize: 12, fontWeight: 500, color: theme.toolbar.text, flex: 1, minWidth: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {label}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{
              fontSize: 11, color: theme.toolbar.textMuted, minWidth: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {versionLabel}
            </span>
            {onDelete && (
              <div
                data-director-cover-actions
                style={{
                  display: selectMode ? 'none' : 'flex', alignItems: 'center', gap: 2, flexShrink: 0,
                  opacity: hovered ? 1 : 0, transition: 'opacity .2s',
                }}
              >
                <span data-director-cover-delete={shotId} style={{ display: 'inline-flex' }}>
                  <Tooltip title={deleteLabel}>
                    <IconButton
                      theme={theme}
                      size="sm"
                      aria-label={deleteLabel}
                      onClick={(e) => { e.stopPropagation(); onDelete(); }}
                      style={{ padding: 0 }}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </Tooltip>
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function HistoryGroup({ store, theme, forcedSource, hideHeader }: {
  store: CanvasAssetsPanelStore;
  theme: ThemeConfig;
  /** 锁定来源（导演台类目只显示导演台历史） */
  forcedSource?: HistorySource;
  /** 由外层统一胶囊行（画布历史 / 公共资产 / 主体 / 分镜历史）承载标题与切换时，不再自带标题和来源 Tab */
  hideHeader?: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { message: antdMessage, modal: antdModal } = App.useApp();
  /** 第一层：来源 Tab（从画布生成 / 从导演台） */
  const [historySource, setHistorySourceState] = useState<HistorySource>(() => forcedSource ?? readInitialHistorySource());
  // 独立入口切换时强制来源，避免同一组件实例保留上一个 tab 的 source 状态（画布历史/导演台串台）
  useEffect(() => {
    if (forcedSource) setHistorySourceState(forcedSource);
  }, [forcedSource]);
  /** 第二层：类型 chips（图片 / 视频） */
  const [historyKind, setHistoryKind] = useState<HistoryKind>('image');
  const [page, setPage] = useState(1);
  /** 搜索（2026-11-16 统一页面标准：标题 → Tab → 搜索栏+批量 → 分类 → 内容） */
  const [search, setSearch] = useState('');
  /** 历史多选（2026-11-07 用户指令：导出只能作用于选中的项目，且目标由用户选择） */
  const [selectMode, setSelectMode] = useState(false);
  // 批量移动：把选中的历史版本一次性移到指定集、指定段号（2026-11-17 用户要求）
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveEpisode, setMoveEpisode] = useState<string>('');
  const [moveShotId, setMoveShotId] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** 导演台类目筛选（2026-11-13 用户指令）：按集数 / 按片段（一个片段可有 N 个备用版本） */
  const [directorEpisode, setDirectorEpisode] = useState<string>('all');
  const [directorShot, setDirectorShot] = useState<string>('all');
  /** 未关联历史片段手动关联（只影响本次抽屉归组，落盘仍写 asset.data.originNodeId） */
  const [manualLinks, setManualLinks] = useState<Record<string, string>>({});
  /** 手动切封面后的本地覆盖（shotId → assetId），保证角标立刻跟着切，不等重读 workbench */
  const [coverOverrides, setCoverOverrides] = useState<Record<string, string>>({});
  const [workbenchShots, setWorkbenchShots] = useState<Array<{
    id: string; number: number; duration?: number; episodeId?: string; status?: string;
    cache?: {
      selectedVersionId?: string;
      versions?: Array<{ id: string; storageKey: string; createdAt?: string }>;
    };
  }>>([]);
  const [scriptEpisodes, setScriptEpisodes] = useState<Array<{ id: string; number: number; title?: string }>>([]);

  const setHistorySource = (source: HistorySource): void => {
    setHistorySourceState(source);
    try { localStorage.setItem(HISTORY_SOURCE_PREF_KEY, source); } catch { /* 隐私模式等：仅本次会话生效 */ }
    setPage(1);
    setSelectedIds(new Set());
  };

  const projectId = store.historyProjectId;
  /** 徽标计数：每个来源的总数 + 该来源下两类型条数（一次遍历，不依赖 store 派生） */
  const sourceCounts = useMemo(
    () => countHistoryBySourceAndKind(store.allAssets, projectId),
    [store.allAssets, projectId],
  );
  // 2026-11-08：导演台只产出视频，不需要类型分类 → 直接给「全部」；画布保留「全部/图片/视频」
  /** 分镜视图：合并入口里来源 Tab 切到「分镜」时同样成立（2026-11-16 合并口径） */
  const directorView = forcedSource === 'director' || historySource === 'director';
  const effectiveKind: HistoryKind = directorView ? 'all' : historyKind;
  const items = useMemo(
    () => filterHistoryAssets(store.allAssets, projectId, effectiveKind, historySource),
    [store.allAssets, projectId, effectiveKind, historySource],
  );

  /** 导演台筛选选项：片段来自 workbench 容器；集标题来自剧本 */
  useEffect(() => {
    if (!directorView || !projectId) return;
    let cancelled = false;
    void Promise.all([readWorkbenchContainer(projectId), readScript(projectId)]).then(([wb, script]) => {
      if (cancelled) return;
      setScriptEpisodes((script?.episodes ?? []).map((ep) => ({ id: ep.id, number: ep.number, title: ep.title })));
      setWorkbenchShots(((Array.isArray(wb?.shots) ? wb.shots : []) as Array<{
        id?: string; number?: number; duration?: number; episodeId?: string; status?: string;
        cache?: { selectedVersionId?: string; versions?: Array<{ id: string; storageKey: string; createdAt?: string }> };
      }>).filter((s) => s?.id).map((s, i) => ({
        id: String(s.id), number: Number(s.number ?? i + 1), duration: s.duration, episodeId: s.episodeId,
        status: s.status, cache: s.cache,
      })));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [directorView, projectId]);

  const shotById = useMemo(
    () => new Map(workbenchShots.map((s) => [s.id, s])),
    [workbenchShots],
  );

  /**
   * 资产 → 所属片段。旧记录可能没有 originNodeId（早期 MCP 回写只写标题），
   * 依次回退：标题里的 seg-xxx / 标题「片段 N」→ 导演台片段。保证老片段的版本也能正确归组。
   */
  const shotOfAsset = useCallback((asset: Asset) => {
    const manual = manualLinks[asset.id];
    if (manual) return shotById.get(manual);
    const data = asset.data as {
      originNodeId?: string;
      slot?: { episodeId?: string | null; number?: number };
    };
    const origin = data.originNodeId;
    if (origin) {
      const hit = shotById.get(origin);
      if (hit) return hit;
      // 原片段被删：按**槽位**（集 + 段号）找回当前位置——导演台重新编号后
      // （删掉第 3 段、第 4 段挪到 3）旧版本自动合到新位置（2026-11-17 用户口径）。
      const slot = data.slot;
      if (slot?.number) {
        return [...shotById.values()].find((s) => s.number === slot.number && (s.episodeId ?? null) === (slot.episodeId ?? null));
      }
      return undefined;
    }
    const title = asset.title ?? '';
    const segId = /(seg-[A-Za-z0-9-]+)/.exec(title)?.[1];
    if (segId) {
      const hit = shotById.get(segId);
      if (hit) return hit;
    }
    const num = /片段\s*(\d+)/.exec(title)?.[1];
    if (num) return [...shotById.values()].find((s) => s.number === Number(num));
    return undefined;
  }, [shotById, manualLinks]);

  /** 待定槽位：原片段被移除、且该槽位（集 + 段号）当前没有活片段 → 历史留在这里等它被新建回来 */
  const pendingSlotOf = useCallback((asset: Asset): { episodeId: string | null; number: number } | null => {
    const d = asset.data as { originNodeId?: string; slot?: { episodeId?: string | null; number?: number } };
    if (d.originNodeId && shotById.has(d.originNodeId)) return null;
    const slot = d.slot;
    if (!slot?.number) return null;
    const occupied = [...shotById.values()].some(
      (s) => s.number === slot.number && (s.episodeId ?? null) === (slot.episodeId ?? null),
    );
    return occupied ? null : { episodeId: slot.episodeId ?? null, number: slot.number };
  }, [shotById]);

  /** 关联到片段的选择项：按集分组，用户能看清要关联到哪一集哪个镜头 */
  const shotLinkOptions = useMemo(() => {
    const episodes = new Map<string, { id: string; number: number; title?: string }>();
    for (const ep of scriptEpisodes) episodes.set(ep.id, ep);
    const byEpisode = new Map<string, typeof workbenchShots>();
    for (const s of workbenchShots) {
      const k = s.episodeId ?? '';
      const list = byEpisode.get(k);
      if (list) list.push(s); else byEpisode.set(k, [s]);
    }
    return [...byEpisode.entries()]
      .sort((a, b) => {
        const na = episodes.get(a[0])?.number ?? Number.MAX_SAFE_INTEGER;
        const nb = episodes.get(b[0])?.number ?? Number.MAX_SAFE_INTEGER;
        return na - nb;
      })
      .map(([episodeId, shots]) => {
        const ep = episodeId ? episodes.get(episodeId) : undefined;
        return {
          label: ep ? displayEpisodeTitle(ep.title, ep.number) : t('assetLibrary.noEpisode', '未分集'),
          options: [...shots]
            .sort((a, b) => a.number - b.number)
            .map((s) => ({
              value: s.id,
              label: `${t('director.segmentTitle', '镜头 {{num}}', { num: s.number })}${s.duration ? ` · ${s.duration}s` : ''}${s.status === 'generating' ? ` · ${t('assetLibrary.segmentGenerating', '生成中')}` : ''}`,
              disabled: s.status === 'generating' || isShotLocked(s.id),
            })),
        };
      });
  }, [scriptEpisodes, workbenchShots, t]);

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const bySearch = q ? items.filter((a) => (a.title ?? '').toLowerCase().includes(q)) : items;
    if (!directorView) return bySearch;
    return bySearch.filter((a) => {
      const shot = shotOfAsset(a);
      if (directorShot !== 'all' && shot?.id !== directorShot) return false;
      if (directorEpisode !== 'all') return Boolean(shot?.episodeId === directorEpisode);
      return true;
    });
  }, [items, directorView, directorShot, directorEpisode, shotOfAsset, search]);

  const directorEpisodeOptions = useMemo(() => {
    if (!directorView) return [];
    const byId = new Map<string, { id: string; number: number; title?: string }>();
    for (const ep of scriptEpisodes) byId.set(ep.id, ep);
    for (const s of workbenchShots) {
      if (s.episodeId && !byId.has(s.episodeId)) byId.set(s.episodeId, { id: s.episodeId, number: byId.size + 1 });
    }
    return [
      { value: 'all', label: t('subject.episodeAll', { defaultValue: '全集' }) },
      ...[...byId.values()]
        .sort((a, b) => a.number - b.number)
        .map((ep) => ({ value: ep.id, label: displayEpisodeTitle(ep.title, ep.number) })),
    ];
  }, [directorView, scriptEpisodes, workbenchShots, t]);

  const directorShotOptions = useMemo(() => {
    if (!directorView) return [];
    const counts = new Map<string, number>();
    for (const a of items) {
      const shot = shotOfAsset(a);
      if (shot) counts.set(shot.id, (counts.get(shot.id) ?? 0) + 1);
    }
    return [
      { value: 'all', label: t('assetLibrary.filterAllSegments', '全部片段') },
      ...workbenchShots
        .filter((s) => directorEpisode === 'all' || s.episodeId === directorEpisode)
        .map((s) => {
          const versions = counts.get(s.id) ?? 0;
          return {
            value: s.id,
            label: `${t('director.segmentTitle', '镜头 {{num}}', { num: s.number })}${s.duration ? ` · ${s.duration}s` : ''}${versions > 0 ? `（${versions} 个版本）` : ''}`,
          };
        }),
    ];
  }, [directorView, items, workbenchShots, directorEpisode, t, shotOfAsset]);
  const { page: curPage, slice } = useMemo(() => paginate(visibleItems, page), [visibleItems, page]);
  const selectedAssets = useMemo(() => visibleItems.filter((a) => selectedIds.has(a.id)), [visibleItems, selectedIds]);
  const allSelected = visibleItems.length > 0 && selectedAssets.length === visibleItems.length;

  /** 导演台按片段分组：一个片段 = 一个集合，内部 N 个版本，默认最新版本是封面/当前启用。 */
  const isDirectorView = directorView;
  const directorGroups = useMemo(() => {
    if (!isDirectorView) return [];
    const map = new Map<string, Array<(typeof visibleItems)[number]>>();
    for (const asset of visibleItems) {
      const shot = shotOfAsset(asset);
      // 原片段被删但槽位仍空着：按「集 + 段号」聚合为待定组（整组一个标签，不打散）
      const pending = shot ? null : pendingSlotOf(asset);
      const deadOrigin = (asset.data as { originNodeId?: string }).originNodeId;
      const key = shot?.id
        ?? (pending ? `__slot__${pending.episodeId ?? ''}:${pending.number}` : (deadOrigin ? `__dead__${deadOrigin}` : `__legacy__${asset.id}`));
      const list = map.get(key);
      if (list) list.push(asset); else map.set(key, [asset]);
    }
    // 2026-11-19 用户口径：分镜历史的片段集合必须以导演台片段为准。
    // 片段版本（shot.cache.versions）还在、但对应素材记录已被移到公共资产/删除时，
    // 以前抽屉里直接没有这个片段，导演台却还在播 —— 现在用片段缓存补出卡片，两边对得上。
    for (const shot of workbenchShots) {
      if (search.trim()) break;
      if (map.has(shot.id)) continue;
      const vs = shot.cache?.versions ?? [];
      if (vs.length === 0) continue;
      map.set(shot.id, vs.map((v) => ({
        id: `shotver:${shot.id}:${v.id}`,
        title: t('director.segmentTitle', '镜头 {{num}}', { num: shot.number }),
        kind: 'video',
        scope: 'project',
        projectId: projectId ?? undefined,
        createdAt: v.createdAt ?? '',
        bytes: 0,
        data: {
          kind: 'video',
          storageKey: v.storageKey,
          origin: 'generation',
          originNodeId: shot.id,
          fromShotCache: true,
        },
      }) as never));
    }
    const groups = [...map.entries()].map(([shotId, assets]) => {
      const shot = shotById.get(shotId) ?? shotOfAsset(assets[0]!);
      const pendingSlot = shot ? null : pendingSlotOf(assets[0]!);
      const versions = [...assets].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
      const cache = shot?.cache;
      const selected = cache?.versions?.find((v: { id: string; storageKey: string; createdAt?: string }) => v.id === cache.selectedVersionId);
      const coverKey = selected?.storageKey;
      const coverId = coverOverrides[shotId]
        ?? ((coverKey
          ? versions.find((a) => (a.data as { storageKey?: string }).storageKey === coverKey)?.id
          : undefined) ?? versions[0]?.id);
      return { shotId, shot, pendingSlot, versions, coverId };
    });
    groups.sort((a, b) => (a.shot?.number ?? Number.MAX_SAFE_INTEGER) - (b.shot?.number ?? Number.MAX_SAFE_INTEGER));
    return groups;
  }, [isDirectorView, visibleItems, shotById, shotOfAsset, pendingSlotOf, coverOverrides, workbenchShots, projectId, t, search]);
  const activeDirectorGroup = directorGroups.find((g) => g.shotId === directorShot);

  /** 未关联片段手动关联到某个镜头：写回 originNodeId（历史归组/后续封面/引导都按它走） */
  const linkGroupToShot = useCallback(async (assetIds: string[], shotId: string) => {
    const shot = shotById.get(shotId);
    if (!shot || assetIds.length === 0) return;
    if (shot.status === 'generating' || isShotLocked(shotId)) {
      antdMessage.warning(t('assetLibrary.segmentGeneratingNoReplace', '该片段正在生成，完成后再替换'));
      return;
    }
    setManualLinks((prev) => {
      const next = { ...prev };
      for (const id of assetIds) next[id] = shotId;
      return next;
    });
    await Promise.all(assetIds.map(async (id) => {
      const asset = visibleItems.find((a) => a.id === id);
      if (!asset) return;
      // 移动/关联：写回归属，并把槽位同步到目标片段（之后重新编号也能找回）
      await updateAsset(id, {
        data: {
          ...asset.data,
          originNodeId: shotId,
          slot: { episodeId: shot.episodeId ?? null, number: shot.number },
        } as unknown as Asset['data'],
      });
    }));
    setDirectorShot(shotId);
    antdMessage.success(t('assetLibrary.linkedToSegment', '已关联到镜头 {{num}}', { num: shot.number }));
  }, [antdMessage, visibleItems, shotById, t]);

  const toggleSelect = (id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const exitSelect = (): void => { setSelectMode(false); setSelectedIds(new Set()); };
  const toggleSelectAll = (): void => {
    setSelectedIds(allSelected ? new Set() : new Set(visibleItems.map((a) => a.id)));
  };

  const batchDelete = (): void => {
    if (selectedAssets.length === 0) return;
    antdModal.confirm({
      title: t('assetLibrary.batchDeleteTitle', '删除选中的历史产出？'),
      content: t('assetLibrary.batchDeleteBody', '删除后可在提示条中撤销；素材文件不会立即从磁盘移除。'),
      okText: t('common.delete', '删除'),
      okType: 'danger',
      cancelText: t('common.cancel', '取消'),
      centered: true,
      onOk: async () => {
        await deleteAssetsWithUndo({
          assets: selectedAssets,
          projectId,
          message: antdMessage,
          t,
          onRestored: () => { void store.refreshAssets(); },
        });
        await store.refreshAssets();
        exitSelect();
      },
    });
  };

  const kindChips = [
    { key: 'all', label: t('assetLibrary.historyTabAll', { defaultValue: '全部' }), count: sourceCounts[historySource].total },
    { key: 'image', label: t('assetLibrary.historyTabImage', { defaultValue: '图片' }), count: sourceCounts[historySource].image },
    { key: 'video', label: t('assetLibrary.historyTabVideo', { defaultValue: '视频' }), count: sourceCounts[historySource].video },
  ];

  const handlePromote = (asset: Asset, target: 'project' | 'library'): void => {
    void store.promoteToScope(asset, target);
  };

  // 空态按「来源 × 类型」给准确指引；导演台只有视频，走「全部」口径
  const emptyText = effectiveKind === 'all'
    ? historySource === 'director'
      ? t('assetLibrary.historyEmptyDirectorVideo', { defaultValue: '还没有导演台视频，在导演台运行片段后会自动存到这里' })
      : t('assetLibrary.historyEmptyAll', { defaultValue: '还没有作品，生成图片或视频后会自动存到这里' })
    : effectiveKind === 'image'
      ? t('assetLibrary.historyEmptyImage', { defaultValue: '还没有图片作品，在画布上生成图片后会自动存到这里' })
      : t('assetLibrary.historyEmptyVideo', { defaultValue: '还没有视频作品，在画布上生成视频后会自动存到这里' });

  /** 单张历史卡（网格与导演台分组共用同一套操作/权限判定，不写两份） */
  const renderCard = (asset: (typeof visibleItems)[number], opts?: { cover?: boolean; versionLabel?: string; shotId?: string }): React.ReactElement => (
    <LazyVisible key={asset.id}>
      {(visible) => (
        <HistoryCard
          asset={asset}
          visible={visible}
          selected={selectedIds.has(asset.id)}
          selectMode={selectMode}
          onToggleSelect={() => toggleSelect(asset.id)}
          onPromote={(target) => handlePromote(asset, target)}
          onDownload={(downloadOpts) => void store.handleDownloadItem({ type: 'asset', data: asset }, downloadOpts)}
          onSendVideo={(() => {
            const kind = (asset.data as { kind?: string }).kind;
            const sendable = kind === 'image' || kind === 'video' || kind === 'audio';
            return sendable ? () => sendAssetToWorkbench(asset, antdMessage, t) : undefined;
          })()}
          onSendGuide={(asset.data as { kind?: string }).kind === 'video'
            ? () => { void sendGuideToWorkbench(asset, antdMessage, t); }
            : undefined}
          onSetCover={(asset.data as { kind?: string }).kind === 'video'
            ? () => {
              // 先就地更新抽屉里的封面角标（一次点击就有反馈），再通知导演台切版本。
              // 不要再异步重读 workbench：持久化还没落盘时重读会把刚点的封面盖回去。
              const shotId = opts?.shotId;
              const storageKey = (asset.data as { storageKey?: string }).storageKey;
              // 该片段正在生成：不允许从抽屉替换封面，避免生成结果回来时版本错乱
              if (shotId && (shotById.get(shotId)?.status === 'generating' || isShotLocked(shotId))) {
                antdMessage.warning(t('assetLibrary.segmentGeneratingNoReplace', '该片段正在生成，完成后再替换'));
                return;
              }
              if (shotId && storageKey) {
                setCoverOverrides((prev) => ({ ...prev, [shotId]: asset.id }));
                setWorkbenchShots((prev) => prev.map((s) => {
                  if (s.id !== shotId || !s.cache) return s;
                  const v = s.cache.versions?.find((x) => x.storageKey === storageKey);
                  return v ? { ...s, cache: { ...s.cache, selectedVersionId: v.id } } : s;
                }));
              }
              void sendVideoAsSegmentCover(asset, antdMessage, t, { shotId });
            }
            : undefined}
          onSendCanvas={() => store.sendToCanvas({ type: 'asset', id: asset.id, data: asset })}
          onRename={() => {
            store.setRenameItemTarget({ type: 'asset', id: asset.id, name: asset.title });
            store.setRenameItemName(asset.title);
            store.setRenameItemOpen(true);
          }}
          onDelete={() => void store.handleDeleteAsset(asset)}
          onEdit={(asset.data as { kind?: string }).kind === 'image'
            ? () => {
              const d = asset.data as { storageKey?: string; dataUrl?: string; url?: string; width?: number; height?: number };
              nodeActionBus.emit('imageEditAsset', {
                nodeId: '',
                assetId: asset.id,
                title: asset.title,
                storageKey: d.storageKey,
                content: d.dataUrl || d.url,
                naturalWidth: d.width,
                naturalHeight: d.height,
              });
            }
            : undefined}
          cover={opts?.cover}
          versionLabel={opts?.versionLabel}
          theme={theme}
          t={t}
        />
      )}
    </LazyVisible>
  );

  return (
    <>
      {/* 有来源 Tab 的页面不再重复标题（2026-11-16 用户指令）；锁死来源的单入口才显示标题 */}
      {forcedSource && !hideHeader && (
        <div style={{ padding: '10px 20px 0', fontSize: 13, fontWeight: 600, color: theme.toolbar.text, flexShrink: 0 }}>
          {forcedSource === 'director'
            ? t('assetLibrary.directorHistoryTitle', '分镜历史')
            : t('assetLibrary.canvasHistoryTitle', '画布历史')}
        </div>
      )}
      {/* 第一层：来源 Tab —— 仅独立历史入口需要；
          被「导演台」类目锁死来源时直接展示导演台视频，不再出现「从画布生成 / 从导演台」子页签 */}
      {!forcedSource && !hideHeader && (
        <div style={{ padding: '8px 20px 0', flexShrink: 0 }} data-history-source-bar>
          <CapsuleTabs
            value={historySource}
            onChange={(key) => setHistorySource(key as HistorySource)}
            segments={[
              { key: 'canvas', label: t('assetLibrary.historySourceCanvas', { defaultValue: '画布历史' }), count: sourceCounts.canvas.total },
              { key: 'director', label: t('assetLibrary.historySourceDirector', { defaultValue: '分镜历史' }), count: sourceCounts.director.total },
            ]}
            theme={theme}
            testId="history-source-tabs"
          />
        </div>
      )}

      {/* 与「主体」页同一套框架：搜索栏（顶到边） + 集数下拉 + 多选按钮同一行 */}
      <ToolbarRow>
        <SearchBox
          value={search}
          onChange={(v) => { setSearch(v); setPage(1); }}
          placeholder={t('assetLibrary.searchPlaceholder')}
          theme={theme}
        />
        {/* 顺序与「主体」页一致（2026-11-19 用户口径）：搜索 → 多选 → 集数 → 片段 */}
        <Tooltip title={selectMode ? t('common.multiSelectExit', '退出多选') : t('common.multiSelect', '多选')}>
          <Button
            size="small"
            data-history-multiselect
            aria-pressed={selectMode}
            icon={selectMode ? <CheckSquare size={14} /> : <Square size={14} />}
            onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
            style={{ flexShrink: 0 }}
          />
        </Tooltip>
        {directorView && (
          /* 与「主体」页集数下拉同一形态：size=small 按钮 + ChevronDown 尾部图标（不再用 antd Select 另造一套尺寸） */
          <Dropdown
            trigger={['click']}
            menu={{
              selectable: true,
              selectedKeys: [directorEpisode],
              items: directorEpisodeOptions.map((o) => ({ key: o.value, label: o.label })),
              onClick: ({ key }) => {
                setDirectorEpisode(key);
                setDirectorShot('all');
                setPage(1);
                setSelectedIds(new Set());
              },
            }}
          >
            <Button
              size="small"
              data-director-episode-filter
              data-episode={directorEpisode}
              icon={<ChevronDown size={13} />}
              iconPlacement="end"
              style={{ flexShrink: 0, maxWidth: 160 }}
            >
              <span style={{ display: 'inline-block', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' }}>
                {directorEpisodeOptions.find((o) => o.value === directorEpisode)?.label ?? t('subject.episodeAll', { defaultValue: '全集' })}
              </span>
            </Button>
          </Dropdown>
        )}
        {directorView && (
          <Dropdown
            trigger={['click']}
            menu={{
              selectable: true,
              selectedKeys: [directorShot],
              items: directorShotOptions.map((o) => ({ key: o.value, label: o.label })),
              onClick: ({ key }) => {
                setDirectorShot(key);
                setPage(1);
                setSelectedIds(new Set());
              },
            }}
          >
            <Button
              size="small"
              data-director-shot-filter
              icon={<ChevronDown size={13} />}
              iconPlacement="end"
              style={{ flexShrink: 0, maxWidth: 160 }}
            >
              <span style={{ display: 'inline-block', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' }}>
                {directorShotOptions.find((o) => o.value === directorShot)?.label ?? t('assetLibrary.filterAllSegments', '全部片段')}
              </span>
            </Button>
          </Dropdown>
        )}
      </ToolbarRow>

      {/* 分类行：画布历史=图片/视频 chips；分镜历史的片段筛选已并入搜索行，不再单独占一行 */}
      {!directorView && (
        <ToolbarRow style={{ paddingTop: 0 }}>
          <CategoryChips
            items={kindChips}
            active={historyKind}
            onChange={(k) => {
              setHistoryKind((k ?? 'all') as HistoryKind);
              setPage(1);
              setSelectedIds(new Set());
            }}
            theme={theme}
          />
        </ToolbarRow>
      )}

      {/* 多选批量条：只导出选中的项；目标由用户选择（本项目 / 公共库） */}
      {selectMode && (
        <ToolbarRow style={{ paddingTop: 0 }} dataAttr={{ 'data-history-batch-bar': '' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: theme.toolbar.text, flexShrink: 0 }}>
            {t('common.batchSelected', { n: selectedAssets.length, defaultValue: `已选 ${selectedAssets.length} 项` })}
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <Button size="small" data-history-select-all disabled={visibleItems.length === 0} onClick={toggleSelectAll}>
              {allSelected ? t('common.batchSelectNone', '取消全选') : t('common.batchSelectAll', '全选')}
            </Button>
            <Button
              size="small"
              data-history-batch-download
              disabled={selectedAssets.length === 0}
              onClick={() => {
                void downloadAssetsAsZip(selectedAssets, `history-${Date.now()}`).then((n) => {
                  if (n > 0) antdMessage.success(t('assetLibrary.batchDownloaded', { n, defaultValue: `已打包下载 ${n} 项` }));
                  else antdMessage.warning(t('assetLibrary.batchDownloadEmpty', '没有可下载的文件'));
                });
              }}
            >
              {t('assetLibrary.batchDownload', '打包下载')}
            </Button>
            <Button
              size="small"
              data-history-batch-export
              disabled={selectedAssets.length === 0}
              onClick={() => {
                void store.promoteAssetsTo(selectedAssets, 'library');
                exitSelect();
              }}
            >
              {t('assetLibrary.addToPublicLibrary', { defaultValue: '发送到资产' })}
            </Button>
            {isDirectorView && (
              <Button
                size="small"
                data-history-batch-move
                disabled={selectedAssets.length === 0}
                onClick={() => setMoveOpen(true)}
              >
                {t('assetLibrary.moveVersions', '移动到片段')}
              </Button>
            )}
            <Button
              size="small"
              danger
              data-history-batch-delete
              disabled={selectedAssets.length === 0}
              onClick={batchDelete}
            >
              {t('common.delete', '删除')}
            </Button>
            <Button size="small" onClick={exitSelect}>{t('common.batchCancel', '取消')}</Button>
          </span>
        </ToolbarRow>
      )}

      {/* 批量移动：选中的历史版本一次移到指定集 + 指定段号 */}
      {isDirectorView && (
        <Modal
          open={moveOpen}
          title={t('assetLibrary.moveVersionsTitle', '移动到片段')}
          okText={t('assetLibrary.moveVersionsOk', '移动')}
          cancelText={t('common.cancel', '取消')}
          okButtonProps={{ disabled: !moveEpisode || !moveShotId, 'data-history-move-confirm': '' }}
          onCancel={() => setMoveOpen(false)}
          onOk={() => {
            const target = moveShotId;
            const ids = [...selectedIds];
            setMoveOpen(false);
            setMoveEpisode('');
            setMoveShotId('');
            if (!target || ids.length === 0) return;
            void linkGroupToShot(ids, target).then(() => exitSelect());
          }}
          centered
          destroyOnHidden
        >
          <div style={{ display: 'grid', gap: 10, paddingTop: 4 }}>
            <div style={{ fontSize: 12, color: theme.toolbar.textMuted }}>
              {t('assetLibrary.moveVersionsHint', '把选中的 {{n}} 个版本移动到下面这个片段；只改归属，不动封面。', { n: selectedIds.size })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, width: 48, flexShrink: 0 }}>{t('assetLibrary.episodeCol', '集')}</span>
              <Select
                size="small"
                style={{ flex: 1 }}
                value={moveEpisode || undefined}
                placeholder={t('assetLibrary.episodeCol', '集')}
                options={scriptEpisodes.map((e) => ({ value: e.id, label: displayEpisodeTitle(e.title, e.number) }))}
                onChange={(v: string) => { setMoveEpisode(v); setMoveShotId(''); }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, width: 48, flexShrink: 0 }}>{t('assetLibrary.segmentCol', '段')}</span>
              <Select
                size="small"
                style={{ flex: 1 }}
                value={moveShotId || undefined}
                placeholder={t('assetLibrary.segmentCol', '段')}
                disabled={!moveEpisode}
                options={workbenchShots
                  .filter((s) => s.episodeId === moveEpisode)
                  .sort((a, b) => a.number - b.number)
                  .map((s) => ({
                    value: s.id,
                    label: `${t('director.segmentTitle', '镜头 {{num}}', { num: s.number })}${s.status === 'generating' ? ` · ${t('assetLibrary.segmentGenerating', '生成中')}` : ''}`,
                    disabled: s.status === 'generating' || isShotLocked(s.id),
                  }))}
                onChange={(v: string) => setMoveShotId(v)}
              />
            </div>
          </div>
        </Modal>
      )}

      <div style={SCROLL_AREA_STYLE}>
        {visibleItems.length === 0 ? (
          <EmptyState text={emptyText} theme={theme} />
        ) : isDirectorView ? (
          /* 导演台：第一级=片段集合；点开片段进第二级看它的 N 个版本（面包屑返回「全部片段」） */
          <div style={{ padding: activeDirectorGroup ? '12px 20px 16px' : '12px 20px 16px' }}>
            {activeDirectorGroup && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, fontSize: 12, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  data-director-crumb-all
                  onClick={() => { setDirectorShot('all'); setPage(1); }}
                  style={{
                    border: 'none', background: 'transparent', padding: 0, cursor: 'pointer',
                    fontSize: 11, fontWeight: 500,
                    color: theme.toolbar.textMuted, fontFamily: 'inherit',
                  }}
                >
                  {t('assetLibrary.allSegments', '全部片段')}
                </button>
                <span style={{ color: theme.toolbar.textMuted }}>/</span>
                <span style={{ fontSize: 15, fontWeight: 600, color: theme.toolbar.text }}>
                  {t('director.segmentTitle', '镜头 {{num}}', { num: activeDirectorGroup.shot?.number ?? '?' })}
                </span>
                <span style={{ fontSize: 11, color: theme.toolbar.textMuted }}>
                  {t('assetLibrary.segmentVersionCount', '{{n}} 个版本', { n: activeDirectorGroup.versions.length })}
                </span>
              </div>
            )}

            {!activeDirectorGroup ? (
              <>
                {/* 无法归属到片段的旧记录（比如早期没有 originNodeId、标题也对不上）：就地展开，不强行造片段 */}
                {directorGroups.filter((g) => !g.shot).map((group) => (
                  <div key={group.shotId} data-director-group={group.shotId} style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: group.pendingSlot ? '#d46b08' : theme.toolbar.text,
                      }}>
                        {group.pendingSlot
                          ? t('assetLibrary.pendingSegment', '待定 · {{episode}} · 镜头 {{num}}（原片段已移除，新建后自动关联回来）', {
                            episode: (() => {
                              const ep = scriptEpisodes.find((e) => e.id === group.pendingSlot?.episodeId);
                              return ep ? displayEpisodeTitle(ep.title, ep.number) : t('assetLibrary.noEpisode', '未分集');
                            })(),
                            num: group.pendingSlot.number,
                          })
                          : t('assetLibrary.unlinkedSegments', '未关联片段')}
                      </span>
                      <span style={{ fontSize: 11, color: theme.toolbar.textMuted }}>
                        {t('assetLibrary.segmentVersionCount', '{{n}} 个版本', { n: group.versions.length })}
                      </span>
                      <Select
                        size="small"
                        data-director-link-shot
                        placeholder={t('assetLibrary.moveToSegment', '移动到…')}
                        value={undefined}
                        style={{ width: 180 }}
                        options={shotLinkOptions}
                        onChange={(shotId: string) => { void linkGroupToShot(group.versions.map((a) => a.id), shotId); }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
                      {group.versions.map((asset, i) => (
                        <div key={asset.id} style={{ width: 240, flexShrink: 0 }}>
                          {renderCard(asset, {
                            // 待定槽位不显示「当前封面」角标：封面属于活着的片段，没有活片段就没有封面
                            cover: !group.pendingSlot && asset.id === group.coverId,
                            versionLabel: t('assetLibrary.versionLabel', '第 {{n}} 版', { n: group.versions.length - i }),
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <div style={CARD_GRID_STYLE}>
                  {directorGroups.filter((g) => g.shot).map((group) => {
                    const cover = group.versions.find((a) => a.id === group.coverId) ?? group.versions[0];
                    const coverKey = (cover?.data as { storageKey?: string } | undefined)?.storageKey;
                    const coverId = cover?.id;
                    const label = t('director.segmentTitle', '镜头 {{num}}', { num: group.shot?.number ?? '?' })
                      + (group.shot?.duration ? ` · ${group.shot.duration}s` : '');
                    return (
                      <DirectorSegmentCard
                        key={group.shotId}
                        theme={theme}
                        shotId={group.shotId}
                        label={label}
                        versionLabel={t('assetLibrary.segmentVersionCount', '{{n}} 个版本', { n: group.versions.length })}
                        deleteLabel={t('common.delete', { defaultValue: '删除' })}
                        coverKey={coverKey}
                        selected={Boolean(selectMode && coverId && selectedIds.has(coverId))}
                        selectMode={selectMode}
                        onToggleSelect={coverId ? () => toggleSelect(coverId) : undefined}
                        onOpen={() => { setDirectorShot(group.shotId); setPage(1); }}
                        onDelete={cover ? () => {
                          // 2026-11-19 用户口径：片段级删除属于高风险动作，必须二次确认；
                          // 文案要说清「只删当前启用版本」还是「整个片段一起消失」，不能让用户猜。
                          const n = group.versions.length;
                          const only = n <= 1;
                          antdModal.confirm({
                            title: t('assetLibrary.deleteSegmentTitle', '删除这个片段？'),
                            content: only
                              ? t('assetLibrary.deleteSegmentOnlyVersion', '这是该片段唯一的版本，删除后这个镜头会从分镜历史消失，且无法恢复。')
                              : t('assetLibrary.deleteSegmentKeepOthers', {
                                n: n - 1,
                                defaultValue: '只会删除当前启用的这一版；该片段下还有 {{n}} 个版本保留。',
                              }),
                            okText: t('common.delete', '删除'),
                            okButtonProps: { danger: true },
                            cancelText: t('common.cancel', '取消'),
                            onOk: () => { void store.handleDeleteAsset(cover); },
                          });
                        } : undefined}
                      />
                    );
                  })}
                </div>
              </>
            ) : (
              <div data-director-group={activeDirectorGroup.shotId}>
                {/* 版本卡：与主体封面页同一套栅格（repeat(auto-fill, minmax(220px, 1fr))），不再用瀑布流 */}
                <div style={CARD_GRID_STYLE}>
                  {activeDirectorGroup.versions.map((asset, i) => renderCard(asset, {
                    cover: asset.id === activeDirectorGroup.coverId,
                    versionLabel: t('assetLibrary.versionLabel', '第 {{n}} 版', { n: activeDirectorGroup.versions.length - i }),
                    shotId: activeDirectorGroup.shot?.id,
                  }))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ ...CARD_GRID_STYLE, padding: '0 20px 16px' }}>
            {slice.map((asset) => renderCard(asset))}
          </div>
        )}
      </div>

      {!isDirectorView && (
        <PaginationBar page={curPage} total={visibleItems.length} pageSize={HISTORY_PAGE_SIZE} onChange={setPage} />
      )}
    </>
  );
}
