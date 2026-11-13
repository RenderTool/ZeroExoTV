/**
 * AssetPickPanel — @ 引用素材面板（唯一实现，导演台与主体状态媒体共用）
 *
 * 形态：锚定在触发元素下方的浮层（或调用方给定的视口坐标），左侧分区页签 + 搜索 + 分组列表，
 * 右侧只读详情；行高 44 / 缩略 36 / 单击即写入；Esc / 点外部关闭。
 *
 * 页签（按调用方给的顺序渲染，数据与回调由调用方注入）：
 * - canvas   画布媒体节点（图片/视频/音频）
 * - asset    资产候选（已映射为 DirectorAssetRef；按「已入槽 → 项目 → 全局」分组）
 * - subject  主体库（整主体占槽 / 展开状态图子行 / 主体状态素材）
 * - openlib  开源库（复用 OpenLibBrowser 单一定义源）
 * - upload   手动上传（主体状态媒体专用：上传按钮在面板内）
 *
 * 纪律：
 * - 面板不自己读画布 / 资产库：候选由调用方注入（画布节点上下文与故事板上下文来源不同）；
 * - 素材引用身份统一为 DirectorAssetRef（id/kind/title/storageKey/url/originScope），
 *   槽位编号仍由调用方 assignAssetSlots 决定，面板只读展示；
 * - 拖拽 MIME 由本模块导出（DIRECTOR_ASSET_DRAG_MIME），导演台插槽据此接收替换。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import type { ThemeConfig } from '@zeroexo/shared';
import { ChevronDown, Film, Image as ImageIcon, Music, Plus, User, Waypoints, X, Loader2, Upload as UploadIcon } from 'lucide-react';
import type { DirectorAssetRef } from '@/entities/director-params.js';
import type { ProductionItem, ProductionItemImage } from '@/features/canvas-nodes/production-manager/production-manager-types.js';
import { resolveSubjectCover } from '@/features/canvas-nodes/production-manager/production-manager-types.js';
import { nonBaseStates, type SubjectTree, type SubjectNodeMediaRef } from '@/features/canvas-nodes/storyboard/subject-tree-types.js';
import { ThumbImage } from '@/features/canvas-tabs/thumb-image.js';

/** 素材面板条目拖拽 MIME：拖到已占用的插槽格 = 就地替换该槽内容（槽号不变） */
export const DIRECTOR_ASSET_DRAG_MIME = 'application/x-director-asset';

/** 面板尺寸 + 条目规格（视口夹取见面板内 useLayoutEffect） */
export const ASSET_PICK_PANEL_WIDTH = 'min(560px, 92vw)';
export const ASSET_PICK_PANEL_HEIGHT = 'min(440px, 80vh)';
export const ASSET_PICK_ROW_HEIGHT = 44;
export const ASSET_PICK_THUMB_SIZE = 36;
export const ASSET_PICK_DETAIL_WIDTH = 216;

export type AssetPickTab = 'canvas' | 'asset' | 'subject' | 'upload' | 'guide';

const DEFAULT_TABS: AssetPickTab[] = ['canvas', 'asset', 'subject'];

/**
 * 引导数据候选（2026-11-09）：来自已生成视频产物的 guide，进 `WorkbenchShot.guide` 独立槽，
 * 不占 9 个标准素材槽。只有传了 onPickGuide 才渲染「引导」页签。
 */
export interface GuideCandidate {
  id: string;
  title: string;
  guideId: string;
  frames?: number;
  fromAssetId?: string;
  /** 来源视频媒体键/地址：候选列表与引导槽用同一首帧预览，不再画通用图标 */
  storageKey?: string;
  url?: string;
}

const SUBJECT_KIND_NAME: Record<ProductionItem['kind'], string> = { character: '角色', scene: '场景', prop: '道具', candidate: '备选' };
const KIND_NAME: Record<DirectorAssetRef['kind'], string> = { image: '图片', video: '视频', audio: '音频' };
const KIND_ICON = { image: ImageIcon, video: Film, audio: Music } as const;

export interface AssetPickPalette {
  title: string;
  sub: string;
  divider: string;
  chipBg: string;
  chipBorder: string;
  chipText: string;
  capsuleBg: string;
  capsuleText: string;
  sep: string;
  textareaBorder: string;
  textareaText: string;
  placeholder: string;
  popBg: string;
  popBorder: string;
  popHover: string;
  scrollThumb: string;
  brand: string;
  brandHover: string;
  danger: string;
}

/** 深色卡片色板（浅色主题回退到 theme token；导演台与主体媒体面板同一套） */
export function useCardPalette(theme: ThemeConfig, isDark: boolean): AssetPickPalette {
  return useMemo(() => ({
    title: isDark ? '#d4d4d4' : theme.toolbar.text,
    sub: isDark ? '#8a8a8a' : theme.toolbar.textMuted,
    divider: isDark ? '#2a2a2a' : 'rgba(0,0,0,0.08)',
    chipBg: isDark ? '#262626' : 'rgba(0,0,0,0.05)',
    chipBorder: isDark ? '#333333' : 'rgba(0,0,0,0.10)',
    chipText: isDark ? '#c7c7c7' : theme.toolbar.text,
    capsuleBg: isDark ? '#2b2b2b' : 'rgba(0,0,0,0.06)',
    capsuleText: isDark ? '#cfcfcf' : theme.toolbar.text,
    sep: isDark ? '#6b6b6b' : theme.toolbar.textMuted,
    textareaBorder: isDark ? '#2c2c2c' : 'rgba(0,0,0,0.10)',
    textareaText: isDark ? '#d0d0d0' : theme.toolbar.text,
    placeholder: '#6b6b6b',
    popBg: isDark ? '#202020' : '#ffffff',
    popBorder: isDark ? '#333333' : 'rgba(0,0,0,0.10)',
    popHover: isDark ? '#2b2b2b' : 'rgba(0,0,0,0.05)',
    scrollThumb: isDark ? '#3a3a3a' : 'rgba(0,0,0,0.20)',
    brand: '#e94560',
    brandHover: '#f25772',
    danger: '#ef4444',
  }), [theme, isDark]);
}

/** 主体「状态级媒体」→ 素材引用（稳定身份 = CAS 记账键 `subject-state:<rootId>/<stateId>`） */
export function subjectStateMediaToRef(
  tree: SubjectTree,
  stateId: string,
  stateName: string,
  media: SubjectNodeMediaRef,
): DirectorAssetRef {
  const kind = media.type === 'audio' || media.type === 'video' ? media.type : 'image';
  return {
    id: `subject-state:${tree.rootId}/${stateId}`,
    kind,
    title: `${tree.name}·${stateName}`,
    storageKey: media.key,
    originScope: 'project',
  };
}

type PickDetailTarget =
  | { type: 'asset'; ref: DirectorAssetRef }
  | { type: 'subject'; subject: ProductionItem };

/** 主体页签扁平化行（主体 = 文件夹语义，可展开状态图子行） */
type SubjListRow =
  | { type: 'subject'; item: ProductionItem }
  | { type: 'state'; item: ProductionItem; img: ProductionItemImage }
  | { type: 'hint'; item: ProductionItem };

/** 顶部「当前资源」（主体状态媒体替换语义：已有媒体时展示并可移除） */
export interface AssetPickCurrentMedia {
  storageKey: string;
  kind: 'image' | 'audio' | 'video';
  label?: string;
}

export interface AssetPickPanelProps {
  /** 页签顺序（缺省 canvas/asset/subject/openlib；upload 需同时给 onUploadFiles） */
  tabs?: AssetPickTab[];
  /** 资产页签候选（调用方映射；按 pooledOrder 把已入槽的排最前） */
  candidates?: DirectorAssetRef[];
  /** 画布页签候选（调用方从画布节点映射） */
  canvasMedia?: DirectorAssetRef[];
  /** 主体库条目（images = 状态图，stateTag = 状态名） */
  subjects?: ProductionItem[];
  /** 主体树（状态级媒体：图片/音频/视频） */
  subjectTrees?: SubjectTree[];
  /**
   * 主体列表按「出现集数」排序：activeEpisodeId 取不到 = 不重排不加标签；
   * numberById = 剧集 id → 集号（「标注为第 N 集」小字用）。
   */
  episodeContext?: { activeEpisodeId: string | null; numberById: Record<string, number> };
  /** 已占槽资产 id（槽位顺序） */
  pooledOrder?: string[];
  /** 资产/主体引用 id → 槽位标签（详情「已占用 PictureN」展示用） */
  slotLabels?: Record<string, string>;
  isDuplicate?: (assetId: string) => boolean;
  /** 该类型槽位是否已满（h3 图9/音3/视3；满则只标「已满」，写入由调用方拒绝） */
  isKindFull?: (kind: DirectorAssetRef['kind']) => boolean;
  /** 只允许这些媒体类型（参考素材区/图片节点用；缺省三类全允许） */
  allowedKinds?: Array<DirectorAssetRef['kind']>;
  /** 单击资产条目（占槽 + 插 @ 块由调用方执行） */
  onPickAsset: (ref: DirectorAssetRef) => void;
  /** 单击画布媒体条目（缺省回落 onPickAsset） */
  onPickCanvasMedia?: (ref: DirectorAssetRef) => void;
  /** 单击整主体（引用 `subject:<id>`；无图主体同样可占槽） */
  onPickSubject?: (item: ProductionItem) => void;
  /** 单击展开的状态图子行（精确插入某张状态图） */
  onPickSubjectImage?: (item: ProductionItem, img: ProductionItemImage) => void;
  /** 单击主体状态级媒体行（`subject-state:<rootId>/<stateId>`） */
  onPickSubjectState?: (ref: DirectorAssetRef) => void;
  /** 引导数据候选（已生成视频的 guide）；给了才出现「引导」页签 */
  guideCandidates?: GuideCandidate[];
  /** 选中引导 → 调用方写入片段独立引导槽（不占标准素材槽） */
  onPickGuide?: (candidate: GuideCandidate) => void;
  /** 手动上传页签 / 资产导入：选中文件后由调用方上传并写入 */
  onUploadFiles?: (files: File[]) => void | Promise<void>;
  uploading?: boolean;
  /** 隐藏文件输入的 accept */
  accept?: string;
  /** 顶部当前资源行（主体状态媒体替换语义） */
  current?: AssetPickCurrentMedia | null;
  onRemoveCurrent?: () => void;
  /** 定位：anchor = 触发元素下方（父级 relative）；fixed = 视口坐标 */
  placement?: { mode: 'anchor' } | { mode: 'fixed'; left: number; top: number };
  /** 面板初始页签 */
  initialTab?: AssetPickTab;
  /** 空态文案覆盖（主体媒体面板用「素材」口径） */
  emptyAssetText?: string;
  emptyCanvasText?: string;
  /** 手动上传页签说明行 */
  uploadHint?: string;
  onClose: () => void;
  palette: AssetPickPalette;
  /** react-i18next TFunction（宽松签名以兼容 TFunction 返回类型） */
  t: (key: string, fallback?: string, opts?: Record<string, unknown>) => string;
  theme: ThemeConfig;
}

export function AssetPickPanel({
  tabs = DEFAULT_TABS,
  candidates = [],
  canvasMedia = [],
  subjects = [],
  subjectTrees = [],
  episodeContext,
  pooledOrder = [],
  slotLabels = {},
  isDuplicate,
  isKindFull,
  allowedKinds,
  onPickAsset,
  onPickCanvasMedia,
  onPickSubject,
  onPickSubjectImage,
  onPickSubjectState,
  guideCandidates = [],
  onPickGuide,
  onUploadFiles,
  uploading = false,
  accept = 'image/*,video/*,audio/*',
  current,
  onRemoveCurrent,
  placement = { mode: 'anchor' },
  initialTab,
  emptyAssetText,
  emptyCanvasText,
  uploadHint,
  onClose,
  palette,
  t,
}: AssetPickPanelProps): ReactElement {
  const visibleTabs = useMemo(() => {
    const list = tabs.filter((k) => {
      if (k === 'upload') return !!onUploadFiles;
      if (k === 'guide') return !!onPickGuide;
      return true;
    });
    return list.length > 0 ? list : ['asset' as AssetPickTab];
  }, [tabs, onUploadFiles, onPickGuide]);

  const [activeIdx, setActiveIdx] = useState(0);
  const [panelTab, setPanelTab] = useState<AssetPickTab>(() => {
    const wanted = initialTab ?? visibleTabs[0]!;
    return visibleTabs.includes(wanted) ? wanted : visibleTabs[0]!;
  });
  const [subjectIdx, setSubjectIdx] = useState(0);
  /** 主体展开集合（chevron 独立命中区控制；点行本身只插入） */
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set());
  /** 搜索：资产按标题；主体按名称/状态图名（命中子状态图 → 自动展开父组） */
  const [searchQ, setSearchQ] = useState('');
  /** 详情面板目标（hover / 键盘高亮驱动；仅展示，不写入） */
  const [detail, setDetail] = useState<PickDetailTarget | null>(null);
  /** 拖拽中：不更新/不显示详情浮层（否则拖拽经过行时详情弹出、面板尺寸变化会顶掉落点） */
  const draggingRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  /** 导入入口：资产页签顶部按钮 + 空态主按钮，同一条 onUploadFiles 链 */
  const importInputRef = useRef<HTMLInputElement>(null);
  /** 视口夹取用（锚点定位不变，仅尺寸放大后按实测矩形平移，避免贴边被裁切） */
  const panelRef = useRef<HTMLDivElement>(null);

  /**
   * 视口夹取：面板仍锚定触发元素（top:100%/left:0），仅当实测矩形溢出视口时才平移回来。
   * jsdom 无布局（矩形全 0）→ 直接跳过，不影响单测与既有行为。
   */
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const margin = 8;
    let dx = 0;
    let dy = 0;
    if (r.right > window.innerWidth - margin) dx = window.innerWidth - margin - r.right;
    if (r.left + dx < margin) dx = margin - r.left;
    if (r.bottom > window.innerHeight - margin) dy = window.innerHeight - margin - r.bottom;
    if (r.top + dy < margin) dy = margin - r.top;
    el.style.transform = dx || dy ? `translate(${dx}px, ${dy}px)` : '';
  }, [panelTab, placement]);

  const query = searchQ.trim().toLowerCase();
  const allowedSet = useMemo(() => (allowedKinds ? new Set(allowedKinds) : null), [allowedKinds]);
  const kindAllowed = useCallback((kind: DirectorAssetRef['kind']): boolean => !allowedSet || allowedSet.has(kind), [allowedSet]);

  const groups = useMemo(() => {
    const pool = query ? candidates.filter((a) => (a.title ?? '').toLowerCase().includes(query)) : candidates;
    const byId = new Map(pool.map((a) => [a.id, a]));
    const pooled = pooledOrder.map((id) => byId.get(id)).filter((a): a is DirectorAssetRef => !!a);
    const pooledSet = new Set(pooledOrder);
    const rest = pool.filter((a) => !pooledSet.has(a.id));
    const project = rest.filter((a) => a.originScope === 'project');
    const library = rest.filter((a) => a.originScope !== 'project');
    const g: Array<{ name: string; items: DirectorAssetRef[] }> = [];
    if (pooled.length > 0) g.push({ name: t('director.groupPooled', '已入槽'), items: pooled });
    if (project.length > 0) g.push({ name: t('director.groupProject', '项目资产'), items: project });
    if (library.length > 0) g.push({ name: t('director.groupLibrary', '全局'), items: library });
    return g;
  }, [candidates, pooledOrder, query, t]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  /**
   * 主体列表按「出现集数」排序（display-only）：命中本集/未标注排前、标注为其它集排后，
   * 组内稳定排序；activeEpisodeId 取不到 = 不重排。
   */
  const subjectEpisodeRank = useCallback((item: ProductionItem): 0 | 1 => {
    const active = episodeContext?.activeEpisodeId ?? null;
    if (!active) return 0;
    const eps = item.episodeIds ?? [];
    if (eps.length === 0) return 0; // 未标注 = 通用
    return eps.includes(active) ? 0 : 1;
  }, [episodeContext]);

  /** 主体页签：按 kind 分组（角色/场景/道具；无内容不渲染）；组内按相关性排序 */
  const subjectGroups = useMemo(() => {
    const g: Array<{ name: string; items: ProductionItem[] }> = [];
    for (const kind of ['character', 'scene', 'prop'] as const) {
      const items = subjects.filter((s) => s.kind === kind);
      if (items.length > 0) {
        const sorted = items
          .map((s, i) => ({ s, i, r: subjectEpisodeRank(s) }))
          .sort((a, b) => a.r - b.r || a.i - b.i)
          .map((x) => x.s);
        g.push({ name: SUBJECT_KIND_NAME[kind], items: sorted });
      }
    }
    return g;
  }, [subjects, subjectEpisodeRank]);

  /** 主体扁平化行：父行 +（展开时）状态图子行/无图提示行；搜索命中子状态图自动展开父组 */
  const subjRows = useMemo(() => {
    const rows: SubjListRow[] = [];
    for (const g of subjectGroups) {
      for (const item of g.items) {
        const nameHit = item.name.toLowerCase().includes(query);
        const stateHits = query
          ? item.images.filter((img) => (img.stateTag ?? img.tags[0] ?? '').toLowerCase().includes(query))
          : [];
        if (query && !nameHit && stateHits.length === 0) continue;
        rows.push({ type: 'subject', item });
        const expanded = expandedSubjects.has(item.id) || (query.length > 0 && stateHits.length > 0);
        if (!expanded) continue;
        if (item.images.length === 0) { rows.push({ type: 'hint', item }); continue; }
        for (const img of item.images) {
          if (query && !nameHit && !stateHits.includes(img)) continue;
          rows.push({ type: 'state', item, img });
        }
      }
    }
    return rows;
  }, [subjectGroups, expandedSubjects, query]);

  /**
   * 主体「状态级媒体」行：主体树 → 状态 → 媒体。数据源是主体树本身，
   * 与片段插槽分配无关；无媒体的状态同样列出（禁用 + 「无素材」）。
   */
  const stateGroups = useMemo(() => {
    const out: Array<{ tree: SubjectTree; rows: Array<{ stateId: string; stateName: string; media: SubjectNodeMediaRef | null }> }> = [];
    for (const tree of subjectTrees) {
      const treeHit = tree.name.toLowerCase().includes(query);
      const rows = nonBaseStates(tree)
        .filter((st) => !query || treeHit || (st.state ?? '').toLowerCase().includes(query))
        .map((st) => ({
          stateId: st.id,
          stateName: st.state || t('director.subjectStateFallback', '剧照'),
          media: (st.media ?? []).find((m) => kindAllowed(m.type === 'audio' || m.type === 'video' ? m.type : 'image')) ?? null,
        }))
        .filter((row) => !allowedSet || row.media !== null);
      if (rows.length > 0) out.push({ tree, rows });
    }
    return out;
  }, [subjectTrees, query, t, kindAllowed]);

  const toggleSubject = useCallback((id: string) => {
    setExpandedSubjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      // 搜索框内：←→ 留给光标移动，只接管 ↑↓/Enter
      const inSearch = e.target instanceof HTMLInputElement;
      if (panelTab === 'asset') {
        if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, flat.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
        else if (e.key === 'Enter' && !inSearch) {
          e.preventDefault();
          const a = flat[activeIdx];
          if (a) onPickAsset(a);
        }
      } else if (panelTab === 'subject') {
        const row = subjRows[subjectIdx];
        if (e.key === 'ArrowDown') { e.preventDefault(); setSubjectIdx((i) => Math.min(i + 1, subjRows.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setSubjectIdx((i) => Math.max(i - 1, 0)); }
        else if (e.key === 'ArrowRight' && !inSearch) {
          if (row?.type === 'subject' && !expandedSubjects.has(row.item.id)) {
            e.preventDefault();
            toggleSubject(row.item.id);
          }
        } else if (e.key === 'ArrowLeft' && !inSearch) {
          if (row?.type === 'subject' && expandedSubjects.has(row.item.id)) {
            e.preventDefault();
            toggleSubject(row.item.id);
          } else if (row && row.type !== 'subject') {
            e.preventDefault();
            const parentIdx = subjRows.findIndex((r) => r.type === 'subject' && r.item.id === row.item.id);
            if (parentIdx >= 0) setSubjectIdx(parentIdx);
          }
        } else if (e.key === 'Enter' && !inSearch) {
          e.preventDefault();
          if (row?.type === 'subject') onPickSubject?.(row.item);
          else if (row?.type === 'state') onPickSubjectImage?.(row.item, row.img);
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [flat, subjRows, expandedSubjects, activeIdx, subjectIdx, panelTab, onPickAsset, onPickSubject, onPickSubjectImage, toggleSubject, onClose]);

  /** 键盘高亮移动 → 详情面板同步（不承担选中职责）；页签无条目 → 空态 */
  useEffect(() => {
    if (panelTab === 'asset') {
      const a = flat[activeIdx];
      setDetail(a ? { type: 'asset', ref: a } : null);
    }
  }, [activeIdx, flat, panelTab]);
  useEffect(() => {
    if (panelTab === 'subject') {
      const row = subjRows[subjectIdx];
      setDetail(row && row.type !== 'hint' ? { type: 'subject', subject: row.item } : null);
    }
  }, [subjectIdx, subjRows, panelTab]);

  const detailRow = (label: string, value: string, dataKey: string, multiline = false) => (
    <div data-detail-row={dataKey} style={{ display: 'flex', gap: 8, fontSize: 12, lineHeight: '20px', alignItems: 'flex-start' }}>
      <span style={{ width: 60, flexShrink: 0, color: palette.sub }}>{label}</span>
      <span
        style={multiline
          ? {
            flex: 1, minWidth: 0, color: palette.capsuleText, overflow: 'hidden',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', wordBreak: 'break-all',
          }
          : {
            flex: 1, minWidth: 0, color: palette.capsuleText,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
      >{value}</span>
    </div>
  );

  /** 右侧只读详情面板（hover / ↑↓ 高亮驱动；不承担选中职责） */
  const detailPanel = (
    <div
      data-asset-detail
      style={{
        width: ASSET_PICK_DETAIL_WIDTH, flexShrink: 0, borderLeft: `1px solid ${palette.popBorder}`, paddingLeft: 12,
        display: 'flex', flexDirection: 'column', gap: 8, height: '100%', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain',
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onDragEnd={() => { draggingRef.current = false; }}
      onDrop={() => { draggingRef.current = false; }}
    >
      {!detail && (
        <div style={{ padding: '16px 8px', fontSize: 12, color: palette.sub }}>
          {t('director.detailEmpty', '悬停或用 ↑↓ 选择条目查看详情')}
        </div>
      )}
      {detail?.type === 'asset' && (() => {
        const ref = detail.ref;
        const inSlot = slotLabels[ref.id];
        return (
          <>
            <ThumbImage
              kind={ref.kind}
              playable={ref.kind !== 'image'}
              storageKey={ref.storageKey}
              url={ref.url}
              prefer="preview"
              width="100%"
              height={ref.kind === 'audio' ? 40 : 120}
              radius={8}
              title={ref.title ?? ref.id}
              icon={<ImageIcon size={20} style={{ opacity: 0.6 }} />}
            />
            {detailRow(t('director.detailName', '名称'), ref.title ?? ref.id, 'name', true)}
            {detailRow(t('director.detailKind', '类型'), KIND_NAME[ref.kind], 'kind')}
            {detailRow(
              t('director.detailScope', '范围'),
              ref.originScope === 'project' ? t('director.scopeProject', '本项目') : t('director.scopeLibrary', '公共'),
              'scope',
            )}
            {detailRow(
              t('director.detailSlot', '槽位'),
              inSlot ? t('director.detailInSlot', '已占用 {{label}}', { label: inSlot }) : t('director.detailNotPooled', '未占用'),
              'slot',
            )}
            {detailRow(t('director.detailSource', '来源'), ref.storageKey ?? ref.url ?? '-', 'source')}
          </>
        );
      })()}
      {detail?.type === 'subject' && (() => {
        const item = detail.subject;
        const coverKey = resolveSubjectCover(item).key;
        const inSlot = slotLabels[`subject:${item.id}`];
        return (
          <>
            {coverKey ? (
              <ThumbImage storageKey={coverKey} prefer="preview" width="100%" height={120} radius={8} title={item.name} icon={<User size={20} style={{ opacity: 0.6 }} />} />
            ) : (
              <span style={{ width: '100%', height: 80, borderRadius: 8, background: 'rgba(255,255,255,0.06)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <User size={20} style={{ opacity: 0.6 }} />
              </span>
            )}
            {detailRow(t('director.detailName', '名称'), item.name, 'name', true)}
            {detailRow(t('director.detailKind', '类型'), SUBJECT_KIND_NAME[item.kind], 'kind')}
            {detailRow(t('director.detailScope', '范围'), t('director.scopeProject', '本项目'), 'scope')}
            {detailRow(
              t('director.detailSlot', '槽位'),
              inSlot ? t('director.detailInSlot', '已占用 {{label}}', { label: inSlot }) : t('director.detailNotPooled', '未占用'),
              'slot',
            )}
            {detailRow(t('director.detailImages', '状态图'), t('director.detailImageCount', '{{count}} 张', { count: item.images.length }), 'images')}
            {item.images.length > 0 && (
              <div data-subject-detail-images style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                {item.images.map((img) => (
                  <span
                    key={img.storageKey}
                    data-subject-detail-image={img.storageKey}
                    style={{ display: 'inline-block', border: `1px solid ${palette.popBorder}`, borderRadius: 6 }}
                  >
                    <ThumbImage storageKey={img.storageKey} width={36} height={36} radius={6} title={img.stateTag ?? img.tags[0]} icon={<ImageIcon size={14} style={{ opacity: 0.6 }} />} />
                  </span>
                ))}
              </div>
            )}
          </>
        );
      })()}
    </div>
  );

  const filteredCanvasMedia = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    return q ? canvasMedia.filter((m) => (m.title ?? '').toLowerCase().includes(q)) : canvasMedia;
  }, [canvasMedia, searchQ]);

  const pickCanvas = onPickCanvasMedia ?? onPickAsset;
  const pickSubject = onPickSubject ?? (() => {});
  const pickSubjectImage = onPickSubjectImage ?? (() => {});
  const pickSubjectState = onPickSubjectState ?? (() => {});

  /** 引导候选按标题 / guideId 搜索（与资产页签共用搜索框） */
  const filteredGuides = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    return guideCandidates.filter((c) => !q || `${c.title} ${c.guideId}`.toLowerCase().includes(q));
  }, [guideCandidates, searchQ]);

  let rowIdx = -1;

  const tabLabel = (key: AssetPickTab): string => {
    switch (key) {
      case 'canvas': return t('director.canvasTab', '画布');
      case 'asset': return t('director.assetTab', '资产');
      case 'subject': return t('director.subjectTab', '主体');
      case 'upload': return t('director.uploadTab', '手动上传');
      case 'guide': return t('director.guideTab', '引导');
    }
  };

  const fixed = placement.mode === 'fixed';
  const rootStyle: CSSProperties = fixed
    ? {
      position: 'fixed', left: placement.left, top: placement.top, zIndex: 1200,
      width: ASSET_PICK_PANEL_WIDTH, height: ASSET_PICK_PANEL_HEIGHT, boxSizing: 'border-box',
      background: palette.popBg, border: `1px solid ${palette.popBorder}`,
      borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.45)', padding: 12,
      display: 'flex', gap: 10, overflow: 'hidden',
    }
    : {
      position: 'absolute', top: '100%', left: 0, marginTop: 8, zIndex: 30,
      width: ASSET_PICK_PANEL_WIDTH, height: ASSET_PICK_PANEL_HEIGHT, boxSizing: 'border-box',
      background: palette.popBg, border: `1px solid ${palette.popBorder}`,
      borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.45)', padding: 12,
      display: 'flex', gap: 10, overflow: 'hidden',
    };

  return (
    <div
      ref={panelRef}
      data-asset-pick-panel=""
      /* 导演台历史选择器保留（单测与外部定位依赖），新增通用 data-asset-pick-panel */
      data-director-asset-panel=""
      style={rootStyle}
      onMouseDown={(e) => e.stopPropagation()}
      /* 画布/编辑器有全局滚轮缩放处理；面板内部滚动不能被它吞掉（2026-11-12 用户反馈滚不动） */
      onWheel={(e) => e.stopPropagation()}
    >
      <div style={{ flex: 1, minWidth: 0, height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {/* 顶部当前资源（主体状态媒体替换语义）：已有媒体时展示 + 移除 */}
        {current && (
          <div
            data-asset-pick-current
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 2px 8px', borderBottom: `1px solid ${palette.popBorder}`, marginBottom: 8, flexShrink: 0 }}
          >
            <ThumbImage
              kind={current.kind}
              storageKey={current.storageKey}
              prefer="thumb"
              width={28} height={28} radius={5}
              title={current.label}
              icon={<ImageIcon size={14} style={{ opacity: 0.6 }} />}
            />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: palette.capsuleText }}>
              {current.label ?? t('assetPick.current', '当前资源')}
            </span>
            {onRemoveCurrent && (
              <button
                type="button"
                data-asset-pick-remove
                onClick={() => { onRemoveCurrent(); onClose(); }}
                title={t('assetPick.remove', '移除当前资源')}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0, cursor: 'pointer',
                  border: '1px solid rgba(239,68,68,0.5)', background: 'rgba(239,68,68,0.16)', color: palette.danger,
                  borderRadius: 6, padding: '2px 8px', fontSize: 11, fontFamily: 'inherit',
                }}
              >
                <X size={11} />{t('assetPick.removeShort', '移除')}
              </button>
            )}
          </div>
        )}

        {/* 页签行 + 常驻关闭（Esc / 点外部之外的第三出口，不写入不改数据） */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexShrink: 0 }}>
          <div style={{ display: 'inline-flex', gap: 4, padding: 3, borderRadius: 8, background: 'rgba(255,255,255,0.05)', flexWrap: 'wrap', minWidth: 0 }}>
            {visibleTabs.map((key) => {
              const active = panelTab === key;
              return (
                <button
                  key={key}
                  type="button"
                  data-asset-panel-tab={key}
                  data-asset-pick-tab={key}
                  onClick={() => setPanelTab(key)}
                  style={{
                    padding: '6px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer', border: 'none',
                    background: active ? 'rgba(255,255,255,0.10)' : 'transparent',
                    color: active ? palette.capsuleText : palette.sub,
                  }}
                >
                  {tabLabel(key)}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            data-asset-pick-close
            aria-label={t('assetPick.close', '关闭')}
            title={t('assetPick.close', '关闭')}
            onClick={onClose}
            onMouseEnter={(e) => { e.currentTarget.style.background = palette.popHover; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            style={{
              marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 24, height: 24, padding: 0, flexShrink: 0, border: 'none', borderRadius: 6,
              background: 'transparent', color: palette.sub, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <X size={13} />
          </button>
        </div>

        {/* 搜索（开源页签不渲染：OpenLibBrowser 自带分类/搜索） */}
        {(
          <input
            data-asset-panel-search
            value={searchQ}
            onChange={(e) => { setSearchQ(e.target.value); setActiveIdx(0); setSubjectIdx(0); }}
            placeholder={t('director.searchPlaceholder', '搜索资产 / 主体 / 状态图')}
            style={{
              width: '100%', height: 34, marginBottom: 10, padding: '0 10px', fontSize: 12, borderRadius: 8,
              border: `1px solid ${palette.popBorder}`, background: 'rgba(255,255,255,0.04)',
              color: palette.capsuleText, outline: 'none', boxSizing: 'border-box', flexShrink: 0,
            }}
          />
        )}

        {/* 引导数据页签：只列已生成视频的 guide，单击写片段独立引导槽（不占标准素材槽） */}
        {panelTab === 'guide' && (
          <div data-guide-candidate-list style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {filteredGuides.length === 0 ? (
              <div style={{ padding: 16, fontSize: 12, color: palette.sub, textAlign: 'center' }}>
                {t('director.guideCandidatesEmpty', '暂无可用的引导数据（先在导演台生成视频）')}
              </div>
            ) : filteredGuides.map((c) => (
              <button
                key={c.id}
                type="button"
                data-guide-candidate={c.guideId}
                onClick={() => onPickGuide?.(c)}
                title={`${c.title} · ${c.guideId}`}
                onMouseEnter={(e) => { e.currentTarget.style.background = palette.popHover; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%', height: ASSET_PICK_ROW_HEIGHT,
                  borderRadius: 6, border: 'none', background: 'transparent', color: palette.capsuleText,
                  cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, padding: '0 10px', textAlign: 'left',
                }}
              >
                <span style={{ position: 'relative', width: ASSET_PICK_THUMB_SIZE, height: ASSET_PICK_THUMB_SIZE, flexShrink: 0 }}>
                  <ThumbImage
                    kind="video"
                    storageKey={c.storageKey}
                    url={c.url}
                    width={ASSET_PICK_THUMB_SIZE}
                    height={ASSET_PICK_THUMB_SIZE}
                    radius={6}
                    title={c.title}
                    icon={<Film size={14} style={{ opacity: 0.7 }} />}
                  />
                  <span
                    data-guide-badge
                    title={t('director.guideBadge', '引导')}
                    style={{
                      position: 'absolute', left: 2, bottom: 2, height: 14, padding: '0 3px',
                      borderRadius: 3, background: palette.brand, color: '#fff',
                      fontSize: 9, lineHeight: '14px', fontWeight: 600,
                      display: 'inline-flex', alignItems: 'center', gap: 2,
                    }}
                  >
                    <Waypoints size={8} />
                  </span>
                </span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
                <span style={{ fontSize: 10, color: palette.sub, flexShrink: 0 }}>
                  {c.frames ? t('director.guideFrames', '{{n}} 帧', { n: c.frames }) : c.guideId.slice(0, 12)}
                </span>
              </button>
            ))}
          </div>
        )}

        {panelTab === 'canvas' && (
          <div data-canvas-media-list style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {filteredCanvasMedia.length === 0 ? (
              <div style={{ padding: 16, fontSize: 12, color: palette.sub, textAlign: 'center' }}>
                {emptyCanvasText ?? t('director.canvasMediaEmpty', '画布上暂无图片/视频/音频节点')}
              </div>
            ) : filteredCanvasMedia.map((ref) => {
              const Icon = KIND_ICON[ref.kind];
              const used = slotLabels[ref.id];
              return (
                <button
                  key={ref.id}
                  type="button"
                  data-canvas-media-item={ref.id}
                  onClick={() => pickCanvas(ref)}
                  onMouseEnter={(e) => { e.currentTarget.style.background = palette.popHover; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%', height: ASSET_PICK_ROW_HEIGHT,
                    padding: '0 10px', border: 'none', borderRadius: 8, cursor: 'pointer', flexShrink: 0,
                    background: 'transparent', color: palette.capsuleText, fontSize: 13, textAlign: 'left',
                  }}
                >
                  <ThumbImage
                    kind={ref.kind}
                    storageKey={ref.storageKey}
                    url={ref.url}
                    prefer="thumb"
                    width={ASSET_PICK_THUMB_SIZE}
                    height={ASSET_PICK_THUMB_SIZE}
                    radius={6}
                    title={ref.title}
                    icon={<Icon size={18} style={{ opacity: 0.7 }} />}
                  />
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ref.title}
                  </span>
                  <span style={{ fontSize: 10, color: palette.sub, flexShrink: 0 }}>
                    {used ?? KIND_NAME[ref.kind]}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {panelTab === 'asset' && (
          <div data-asset-panel-list ref={listRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* 导入资产：列表顶部一行（导入类按钮统一放顶部，不埋底部） */}
            {flat.length > 0 && onUploadFiles && (
              <button
                type="button"
                data-asset-import
                onClick={() => importInputRef.current?.click()}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%',
                  height: 34, border: `1px dashed ${palette.popBorder}`, borderRadius: 8, cursor: 'pointer',
                  fontFamily: 'inherit', background: 'transparent', color: palette.sub, fontSize: 12, flexShrink: 0, marginBottom: 4,
                }}
              >
                <Plus size={14} />
                {t('director.importAsset', '导入资产')}
              </button>
            )}
            {groups.map((g) => (
              <div key={g.name}>
                <div style={{ fontSize: 11, color: palette.sub, padding: '8px 8px 4px' }}>{g.name}</div>
                {g.items.map((ref) => {
                  rowIdx += 1;
                  const idx = rowIdx;
                  const Icon = KIND_ICON[ref.kind];
                  const selected = idx === activeIdx;
                  const inUse = isDuplicate?.(ref.id) ?? false;
                  return (
                    <button
                      key={ref.id}
                      type="button"
                      data-asset-panel-item={ref.id}
                      data-asset-panel-active={selected || undefined}
                      draggable
                      onDragStart={(e) => {
                        e.stopPropagation();
                        draggingRef.current = true;
                        setDetail(null);
                        e.dataTransfer.effectAllowed = 'copy';
                        e.dataTransfer.setData(DIRECTOR_ASSET_DRAG_MIME, JSON.stringify(ref));
                      }}
                      onDragEnd={() => { draggingRef.current = false; }}
                      onClick={() => onPickAsset(ref)}
                      onMouseEnter={() => {
                        if (draggingRef.current) return;
                        setActiveIdx(idx);
                        setDetail({ type: 'asset', ref });
                      }}
                      onFocus={() => { setActiveIdx(idx); setDetail({ type: 'asset', ref }); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, width: '100%', height: ASSET_PICK_ROW_HEIGHT,
                        padding: '0 10px', border: 'none', borderRadius: 8, cursor: 'pointer', flexShrink: 0,
                        background: selected ? palette.popHover : 'transparent',
                        color: palette.capsuleText, fontSize: 13, textAlign: 'left',
                      }}
                    >
                      <ThumbImage
                        kind={ref.kind}
                        storageKey={ref.storageKey}
                        url={ref.url}
                        prefer="thumb"
                        width={ASSET_PICK_THUMB_SIZE}
                        height={ASSET_PICK_THUMB_SIZE}
                        radius={6}
                        title={ref.title}
                        icon={<Icon size={18} style={{ opacity: 0.7 }} />}
                      />
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ref.title}
                      </span>
                      {inUse && (
                        <span data-asset-panel-inuse style={{ fontSize: 10, color: palette.sub, flexShrink: 0 }}>
                          {slotLabels[ref.id] ?? t('director.assetInUse', '已引用')}
                        </span>
                      )}
                      {!inUse && (isKindFull?.(ref.kind) ?? false) && (
                        <span data-kind-full style={{ fontSize: 10, color: palette.danger, flexShrink: 0 }}>
                          {t('director.kindFull', '已满')}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
            {flat.length === 0 && (
              <div data-asset-panel-import-empty style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                <div style={{ fontSize: 13, color: palette.sub, textAlign: 'center' }}>
                  {emptyAssetText ?? t('director.assetEmpty', '暂无可引用资产')}
                </div>
                {onUploadFiles && (
                  <button
                    type="button"
                    data-asset-import
                    onClick={() => importInputRef.current?.click()}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 16px',
                      borderRadius: 8, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                      border: `1px solid ${palette.popBorder}`, background: 'rgba(255,255,255,0.08)',
                      color: palette.capsuleText,
                    }}
                  >
                    <Plus size={14} />
                    {t('director.importAsset', '导入资产')}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* 手动上传页签（主体状态媒体专用：上传归属该主体，不进资产库） */}
        {panelTab === 'upload' && onUploadFiles && (
          <div data-asset-panel-upload style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '4px 2px' }}>
            <button
              type="button"
              data-asset-pick-upload
              onClick={() => { if (!uploading) importInputRef.current?.click(); }}
              disabled={uploading}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '28px 0', border: `1.5px dashed ${palette.popBorder}`, borderRadius: 10,
                background: 'transparent', color: palette.sub, fontSize: 13,
                cursor: uploading ? 'default' : 'pointer', fontFamily: 'inherit',
              }}
            >
              {uploading ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <UploadIcon size={15} />}
              {uploading ? t('asset.uploading', '上传中…') : t('assetPick.upload', '上传图片/语音')}
            </button>
            {uploadHint && (
              <div style={{ fontSize: 11, color: palette.sub, marginTop: 10, lineHeight: 1.6, padding: '0 4px' }}>
                {uploadHint}
              </div>
            )}
          </div>
        )}

        {/* 隐藏文件输入（资产导入与手动上传共用同一条调用方链） */}
        {onUploadFiles && (
          <input
            ref={importInputRef}
            type="file"
            multiple={panelTab !== 'upload'}
            accept={accept}
            data-asset-import-input
            style={{ display: 'none' }}
            onChange={(e) => {
              const files = e.target.files;
              if (files && files.length > 0) void onUploadFiles(Array.from(files));
              e.target.value = '';
            }}
          />
        )}

        {/* 主体页签（文件夹语义 1 对 N）：
            一级行单击 = 整主体引用；chevron 独立命中区 = 展开/收起；展开后子行 = 精确插状态图 */}
        {panelTab === 'subject' && (
          <div data-asset-panel-list style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {subjRows.map((row, idx) => {
              const showHeader = row.type === 'subject'
                && (idx === 0 || subjRows[idx - 1]!.item.kind !== row.item.kind);
              return (
                <div key={row.type === 'state' ? `state:${row.img.storageKey}` : `${row.type}:${row.item.id}`}>
                  {showHeader && (
                    <div style={{ fontSize: 11, color: palette.sub, padding: '8px 8px 4px' }}>{SUBJECT_KIND_NAME[row.item.kind]}</div>
                  )}
                  {row.type === 'subject' && (() => {
                    const item = row.item;
                    const selected = idx === subjectIdx;
                    const inSlot = slotLabels[`subject:${item.id}`];
                    const expanded = expandedSubjects.has(item.id)
                      || (query.length > 0 && item.images.some((img) => (img.stateTag ?? img.tags[0] ?? '').toLowerCase().includes(query)));
                    const coverKey = resolveSubjectCover(item).key;
                    return (
                      <button
                        type="button"
                        data-subject-item={item.id}
                        data-asset-panel-active={selected || undefined}
                        onClick={() => pickSubject(item)}
                        onMouseEnter={() => { if (draggingRef.current) return; setSubjectIdx(idx); setDetail({ type: 'subject', subject: item }); }}
                        onFocus={() => { setSubjectIdx(idx); setDetail({ type: 'subject', subject: item }); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10, width: '100%', height: ASSET_PICK_ROW_HEIGHT,
                          padding: '0 10px 0 4px', border: 'none', borderRadius: 8, cursor: 'pointer', flexShrink: 0,
                          background: selected ? palette.popHover : 'transparent',
                          color: palette.capsuleText, fontSize: 13, textAlign: 'left',
                        }}
                      >
                        {/* chevron 独立命中区（≥20px）：点箭头才展开/收起，点行只插入 */}
                        <span
                          data-subject-chevron={item.id}
                          role="button"
                          aria-label={expanded ? t('director.collapse', '收起') : t('director.expand', '展开')}
                          onClick={(e) => { e.stopPropagation(); toggleSubject(item.id); }}
                          style={{ width: 24, height: 24, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: 4 }}
                        >
                          <ChevronDown size={14} style={{ opacity: 0.7, transform: expanded ? 'none' : 'rotate(-90deg)', transition: 'transform 0.12s' }} />
                        </span>
                        {coverKey ? (
                          <ThumbImage storageKey={coverKey} width={ASSET_PICK_THUMB_SIZE} height={ASSET_PICK_THUMB_SIZE} radius={6} title={item.name} icon={<User size={18} style={{ opacity: 0.7 }} />} />
                        ) : (
                          <span style={{ width: ASSET_PICK_THUMB_SIZE, height: ASSET_PICK_THUMB_SIZE, borderRadius: 6, background: 'rgba(255,255,255,0.06)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <User size={18} style={{ opacity: 0.7 }} />
                          </span>
                        )}
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.name}
                        </span>
                        {/* 标注为其它集的主体 → 小字「标注为第 N 集」（不过滤不禁点） */}
                        {subjectEpisodeRank(item) === 1 && (() => {
                          const nums = (item.episodeIds ?? [])
                            .map((epId) => episodeContext?.numberById[epId])
                            .filter((n): n is number => typeof n === 'number');
                          return nums.length > 0 ? (
                            <span data-subject-tagged-episodes style={{ fontSize: 10, color: palette.sub, flexShrink: 0 }}>
                              {t('director.taggedEpisodes', '标注为第 {{list}} 集', { list: nums.join('、') })}
                            </span>
                          ) : null;
                        })()}
                        {inSlot && (
                          <span data-asset-panel-inuse style={{ fontSize: 10, color: palette.sub, flexShrink: 0 }}>{inSlot}</span>
                        )}
                        <span style={{ fontSize: 10, color: palette.sub, flexShrink: 0 }}>{item.images.length} 图</span>
                      </button>
                    );
                  })()}
                  {row.type === 'state' && (() => {
                    const { item, img } = row;
                    const selected = idx === subjectIdx;
                    const stateName = img.stateTag ?? img.tags[0] ?? t('director.subjectStateFallback', '剧照');
                    const childInSlot = slotLabels[`subject:${item.id}:${img.storageKey}`];
                    return (
                      <button
                        type="button"
                        data-subject-state-row={img.storageKey}
                        data-asset-panel-active={selected || undefined}
                        onClick={() => pickSubjectImage(item, img)}
                        onMouseEnter={() => { if (draggingRef.current) return; setSubjectIdx(idx); setDetail({ type: 'subject', subject: item }); }}
                        onFocus={() => { setSubjectIdx(idx); setDetail({ type: 'subject', subject: item }); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10, width: '100%', height: 38,
                          padding: '0 10px 0 40px', border: 'none', borderRadius: 8, cursor: 'pointer', flexShrink: 0,
                          background: selected ? palette.popHover : 'transparent',
                          color: selected ? palette.capsuleText : palette.sub, fontSize: 12, textAlign: 'left',
                        }}
                      >
                        <ThumbImage storageKey={img.storageKey} width={28} height={28} radius={5} title={`${item.name}·${stateName}`} icon={<ImageIcon size={14} style={{ opacity: 0.6 }} />} />
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.name}·{stateName}
                        </span>
                        {childInSlot && (
                          <span data-asset-panel-inuse style={{ fontSize: 10, color: palette.sub, flexShrink: 0 }}>{childInSlot}</span>
                        )}
                      </button>
                    );
                  })()}
                  {row.type === 'hint' && (
                    <div
                      data-subject-empty-hint={row.item.id}
                      style={{ padding: '6px 10px 6px 40px', fontSize: 12, color: palette.sub, opacity: 0.8 }}
                    >
                      {t('director.subjectNoImagesHint', '该主体尚未录入状态图')}
                    </div>
                  )}
                </div>
              );
            })}
            {stateGroups.length > 0 && (
              <>
                <div style={{ fontSize: 11, color: palette.sub, padding: '10px 8px 4px' }}>
                  {t('director.subjectStateAssets', '主体状态素材')}
                </div>
                {stateGroups.map(({ tree, rows }) => (
                  <div key={`ss:${tree.rootId}`}>
                    <div
                      data-subject-state-tree={tree.rootId}
                      style={{ fontSize: 12, color: palette.sub, padding: '6px 8px 2px 12px', opacity: 0.85 }}
                    >
                      {tree.name}
                    </div>
                    {rows.map(({ stateId, stateName, media }) => {
                      const ref = media ? subjectStateMediaToRef(tree, stateId, stateName, media) : null;
                      const inSlot = ref ? slotLabels[ref.id] : undefined;
                      const Icon = media?.type === 'audio' ? Music : media?.type === 'video' ? Film : ImageIcon;
                      return (
                        <button
                          key={`${tree.rootId}/${stateId}`}
                          type="button"
                          disabled={!ref}
                          data-subject-state-asset={ref ? ref.id : undefined}
                          data-subject-state-empty={ref ? undefined : `${tree.rootId}/${stateId}`}
                          onClick={() => { if (ref) pickSubjectState(ref); }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10, width: '100%', height: 38,
                            padding: '0 10px 0 40px', border: 'none', borderRadius: 8,
                            cursor: ref ? 'pointer' : 'default', flexShrink: 0,
                            background: 'transparent', opacity: ref ? 1 : 0.55,
                            color: palette.sub, fontSize: 12, textAlign: 'left',
                          }}
                        >
                          {ref ? (
                            <ThumbImage storageKey={ref.storageKey} width={28} height={28} radius={5} title={ref.title} icon={<Icon size={14} style={{ opacity: 0.6 }} />} />
                          ) : (
                            <span style={{ width: 28, height: 28, borderRadius: 5, background: 'rgba(255,255,255,0.06)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <Icon size={14} style={{ opacity: 0.45 }} />
                            </span>
                          )}
                          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {tree.name}·{stateName}
                          </span>
                          {!ref && (
                            <span data-subject-state-no-media style={{ fontSize: 10, color: palette.sub, flexShrink: 0 }}>
                              {t('director.subjectStateNoMedia', '无素材')}
                            </span>
                          )}
                          {inSlot && (
                            <span data-asset-panel-inuse style={{ fontSize: 10, color: palette.sub, flexShrink: 0 }}>{inSlot}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </>
            )}
            {subjRows.length === 0 && stateGroups.length === 0 && (
              <div style={{ padding: 20, fontSize: 13, color: palette.sub, textAlign: 'center' }}>
                {t('director.subjectEmpty', '主体库暂无条目')}
              </div>
            )}
          </div>
        )}

      </div>
      {panelTab !== 'upload' && detailPanel}
    </div>
  );
}
