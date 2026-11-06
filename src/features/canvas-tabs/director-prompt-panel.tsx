/**
 * DirectorPromptPanel — 导演台 H3 对齐工作区提示词面板（2026-11-04 收敛版）
 *
 * 2026-11-04 约定（参照图只提供「资产引入形式」，版式一律不抄）：
 * - 顶部一行（2026-11-05 最终态：页签/标题全部删除）：无任何页签或标题，右侧仅元信息胶囊
 *   （headerExtra 宿主挂载点 + 时长/引导胶囊）；比例/系数/引导等参数在导轨「参数」浮层面板，不在此重复。
 * - 素材池单行（2026-11-05 调整：公共素材 UI 彻底下线）：所有槽位属于当前片段，
 *   从 1 连续编号（Picture1 = 第 1 格），无行标签、无编号说明文案；sharedParams.assets 仅作
 *   老数据读取兼容（导出时由 pack 层并入），界面不暴露、不新建。公共提示词输入已移除
 *   （2026-11-05 公共提示词层下线：重复内容改由 MCP/LLM 直接写入每段提示词）。
 * - 片段提示词输入（常驻，固定高滚动、@）；媒体格子按类型分派（视频首帧/可播、音频可控）。
 * - 删除（抄来的版式）：片段 01 大标题、「引用资产及工具」副文案、引用缩略图行、右下「立即生成」按钮。
 * - `图 0/9 音 0/3 视 0/3` 计数行删除；槽位上限内部仍生效（h3 图9/音3/视3），超限红字「已达上限」。
 * - @ 资产面板（照搬资产引入形式）：锚定触发元素下方、宽 460、深色 #202020；Tab「资产/小工具」；
 *   「当前引用」分组置顶 + 角色/场景/道具分组（无内容不渲染），行高 36、左 28×28 缩略图；
 *   条目右侧二级浮层（全部图像复选 + 该资产图像多选），选中写 chips + 槽位；Esc/点外部关闭、↑↓/Enter。
 * - 本地工具无计费概念：副文案、按钮上的计费文字一律不存在。运行入口沿用宿主「选择运行 + dry-run」。
 *
 * 2026-11-04 第四轮（线上版本截图为唯一版式依据）：
 * - 恢复标题行（截图 L1：片段 01 + 引用资产及工具；积分文字不抄）与缩略图行（截图 L2：30×30）。
 * - 素材区去 @：chips 行首改为加号（+）方块（data-asset-add），点击仍开 AssetPickPanel。
 * - 底部工具行已移除（2026-11-04 第八条C）：批量→导轨工具栏，片段编辑并入时长/引导胶囊。
 *   公共素材 UI 已彻底下线（2026-11-05 调整）：sharedParams.assets 仅作老数据读取兼容，
 *   界面不暴露、不新建；槽位全部属于当前片段，从 1 连续编号（Picture1 = 第 1 格）。
 *   页签/标题整行删除（2026-11-05）：顶部仅右侧元信息胶囊（headerExtra + 时长/引导）。
 * - 「立即生成 ◆60」不恢复（含积分徽标，积分=0 红线）。
 * 冻结成果保留：唯一槽位函数 assignAssetSlots、帧数学、clampScaleFactor/resolveVideoSize、
 * 提示词内 @ 一律以槽位号引用（`@PictureN`），同资产可重复 @，删除槽位同步移除引用文本。
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { App, Checkbox, InputNumber, Popover, Select } from 'antd';
import { ChevronDown, ChevronLeft, ChevronRight, Film, Image as ImageIcon, Music, Plus, User, X } from 'lucide-react';
import type { ThemeConfig } from '@zeroexo/shared';
import {
  CONTINUITY_OVERLAP_OPTIONS,
  DIRECTOR_ASSET_CAPS,
  DirectorSlotOverflowError,
  DURATION_SLIDER_MAX_SEC,
  DURATION_SLIDER_MIN_SEC,
  DURATION_SLIDER_STEP_SEC,
  MAX_GEN_FRAMES,
  assignAssetSlots,
  durationExceedsFrameCap,
  durationOverCapSec,
  durationToFrames,
  parseBareSubjectRef,
  recommendedDurationCapSec,
  snapContinuityOverlap,
  type DirectorAssetRef,
  type DirectorModelTier,
} from '@/entities/director-params.js';
import type { WorkbenchSharedParams } from '@/entities/slot-containers.js';
import { useAssets } from '@/features/asset-picker/use-assets.js';
import type { Asset } from '@/features/asset-picker/index.js';
import type { WorkbenchShot, WorkbenchShotReference } from '@/features/canvas-nodes/storyboard/workbench-types.js';
import type { ProductionItem, ProductionItemImage, ProductionItemKind } from '@/features/canvas-nodes/production-manager/production-manager-types.js';
import { resolveSubjectCover } from '@/features/canvas-nodes/production-manager/production-manager-types.js';
import type { SubjectTree, SubjectNodeMediaRef } from '@/features/canvas-nodes/storyboard/subject-tree-types.js';
import { MentionEditor, type MentionEditorHandle, type MentionSlotView } from './mention-editor.js';
import { ThumbImage } from './thumb-image.js';
import { OpenLibBrowser } from '@/features/open-library/open-lib-browser.js';
import { useCasUpload } from '@/features/canvas-assets/use-cas-upload.js';
import { WORKSPACE_SURFACE_RADIUS } from '@/shared/components/LAYOUT_CONSTANTS.js';

// ===== 资产 → 导演台素材（不变） =====

/**
 * 插槽拖入正文的自定义 MIME（2026-11-05 用户指令）：
 * 把素材池里的插槽拖到提示词输入区的落点 → 自动插入 `@PictureN ` 引用。
 * payload = { label, assetId }；label 以当前槽位映射为准（拖入时重查，防过期槽号）。
 */
export const DIRECTOR_SLOT_DRAG_MIME = 'application/x-director-slot';
/** 素材面板条目拖拽 MIME：拖到已占用的插槽格 = 就地替换该槽内容（槽号不变） */
export const DIRECTOR_ASSET_DRAG_MIME = 'application/x-director-asset';

function assetToDirectorRef(a: Asset): DirectorAssetRef | null {
  const kind = a.data.kind;
  if (kind !== 'image' && kind !== 'video' && kind !== 'audio') return null;
  return {
    id: a.id,
    kind,
    title: a.title,
    storageKey: 'storageKey' in a.data ? a.data.storageKey : undefined,
    url: kind === 'image' ? a.data.dataUrl : a.data.url,
    originScope: a.scope === 'project' ? 'project' : 'library',
  };
}

function shotRefToDirectorRef(r: WorkbenchShotReference): DirectorAssetRef | null {
  if (r.kind !== 'image' && r.kind !== 'video' && r.kind !== 'audio') return null;
  const extra = r as WorkbenchShotReference & { originScope?: 'library' | 'project' };
  return {
    id: r.id, kind: r.kind, title: r.title, storageKey: r.storageKey, url: r.url,
    originScope: extra.originScope, slotNo: r.slotNo,
  };
}

const KIND_ICON = { image: ImageIcon, video: Film, audio: Music } as const;

/**
 * 槽位移除时把提示词里该槽位的 `@Label ` 提及降级为纯文本（保留可读 Label 字样、去掉 @ 引用关系），
 * 不允许留下指向空槽位的悬空 @ 块（2026-11-04 槽位移除指令 req3）。
 */
export function degradeMentionText(text: string, label: string): string {
  const re = new RegExp(`@${label}(?!\\d) ?`, 'g');
  return text.replace(re, `${label} `).replace(/ {2,}/g, ' ');
}

/** 槽位移除 toast 固定 key（2026-11-04 第十三条）：连续移除时新提示替换旧提示，不堆叠 */
const REMOVE_SLOT_TOAST_KEY = 'director-slot-remove';

/** 整主体占槽（2026-11-04 @ 浮层指令C）：稳定 id `subject:<subjectId>`，不绑定某张状态图 */
function subjectToRef(item: ProductionItem): DirectorAssetRef {
  return {
    id: `subject:${item.id}`,
    kind: 'image',
    title: item.name,
    originScope: 'project',
  };
}

/**
 * 引用 → 当前可视资源（唯一解析点，禁止各处各算）：
 * - `subject:<id>`（整主体占槽）→ resolveSubjectCover 回落链（手动 coverKey → 第一张状态图），
 *   补图后自动解析为当前封面，无需重新引用；
 * - 其余引用 → 自身 url / storageKey。
 */
export function resolveRefVisual(
  ref: DirectorAssetRef,
  subjects?: ProductionItem[],
): { url?: string; storageKey?: string; subject?: ProductionItem } {
  const subjectId = parseBareSubjectRef(ref.id);
  if (subjectId) {
    const subject = subjects?.find((s) => s.id === subjectId);
    const key = subject ? resolveSubjectCover(subject).key : null;
    return { storageKey: key ?? undefined, subject };
  }
  return { url: ref.url, storageKey: ref.storageKey };
}

/** 提示词框最小固定高度：内容超出走 overflow-y 滚动，不自动长高、不挤压素材区/预览区 */
export const DIRECTOR_PROMPT_MIN_HEIGHT = 180;

// ===== 深色卡片色板（截图逐像素量取；浅色主题回退到 theme token） =====
function useCardPalette(theme: ThemeConfig, isDark: boolean) {
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

// ===== @ 资产面板（锚定触发元素下方；Tab = 资产/主体；2026-11-04 第四条：单击即写入，无二级菜单） =====
// 2026-11-04 第四条约定：
// - 一级条目（资产/主体）单击即写入引用（有空槽占槽+插入 @ 块；满槽走既有超限提示）；
// - 原「点一级 → 弹二级列表勾选」两步交互删除（残留 = 0）；
// - 右侧为只读详情面板（hover / ↑↓ 高亮即更新，不承担选中职责）；
//   主体详情里的状态图缩略图仅预览，点单张 = 精确插入 `subject:<id>:<stateId>`（详情区内显式动作，不算二级菜单）；
// - 无图主体可点可占槽：引用 = `subject:<id>`，补图后经 resolveSubjectCover 自动解析为封面。

const SUBJECT_KIND_NAME: Record<ProductionItemKind, string> = { character: '角色', scene: '场景', prop: '道具' };
const ASSET_KIND_NAME: Record<DirectorAssetRef['kind'], string> = { image: '图片', video: '视频', audio: '音频' };

/** 2026-11-05 @ 素材面板放大：面板尺寸 + 条目规格（视口夹取见 AssetPickPanel 内 useLayoutEffect） */
export const ASSET_PICK_PANEL_WIDTH = 'min(560px, 92vw)';
export const ASSET_PICK_PANEL_HEIGHT = 'min(440px, 80vh)';
export const ASSET_PICK_ROW_HEIGHT = 44;
export const ASSET_PICK_THUMB_SIZE = 36;
export const ASSET_PICK_DETAIL_WIDTH = 216;

type PickDetailTarget =
  | { type: 'asset'; asset: Asset }
  | { type: 'subject'; subject: ProductionItem };

/** 主体 Tab 扁平化行（2026-11-04 第四条更正：主体 = 文件夹语义，可展开状态图子行） */
type SubjListRow =
  | { type: 'subject'; item: ProductionItem }
  | { type: 'state'; item: ProductionItem; img: ProductionItemImage }
  | { type: 'hint'; item: ProductionItem };

function AssetPickPanel({
  candidates, subjects, subjectTrees, pooledOrder, slotLabels, isDuplicate, isKindFull,
  onPick, onPickSubject, onPickSubjectImage, onPickSubjectState, onClose, palette, t, episodeContext,
  theme, onPickAssetFromOpenLib,
}: {
  candidates: Asset[];
  /** 主体库条目（ProductionItem，images=剧照集/状态图，stateTag=状态名；production-manager-types.ts L20-52） */
  subjects: ProductionItem[];
  /** 主体树（状态级媒体 = 图片/音频；候选来源独立于插槽，2026-11-05） */
  subjectTrees: SubjectTree[];
  /** 已占槽资产 id（槽位顺序 = 公共 1..K → 片段 K+1 续排） */
  pooledOrder: string[];
  /** 资产/主体引用 id → 槽位标签（详情面板「已占用 PictureN」展示用） */
  slotLabels: Record<string, string>;
  isDuplicate: (assetId: string) => boolean;
  /** 该类型槽位是否已满（h3 图9/音3/视3；满则禁止新增占位，仅可替换） */
  isKindFull: (kind: DirectorAssetRef['kind']) => boolean;
  /** 单击资产条目即写入（占槽+插 @ 块；替换模式由调用方分流） */
  onPick: (a: Asset) => void;
  /** 单击主体一级行即写入：整主体占槽，引用 `subject:<id>`（无图主体同样可占槽） */
  onPickSubject: (item: ProductionItem) => void;
  /** 展开的状态图子行单击 = 精确插入某张状态图（`subject:<id>:<stateId>`，占一个图片槽位） */
  onPickSubjectImage: (item: ProductionItem, img: ProductionItemImage) => void;
  /** 主体状态级媒体的媒体行单击 = 按 `subject-state:<rootId>/<stateId>` 引用插入（走既有槽位规则） */
  onPickSubjectState: (ref: DirectorAssetRef) => void;
  onClose: () => void;
  palette: ReturnType<typeof useCardPalette>;
  /** react-i18next TFunction（直接用 useTranslation() 的 t；宽松签名以兼容 TFunction 返回类型） */
  t: (key: string, fallback?: string, opts?: Record<string, unknown>) => string;
  /**
   * 2026-11-05 方案 C（主体列表按「出现集数」排序）：剧本集上下文——
   * activeEpisodeId 取不到（null）= 不重排不加标签（退回原顺序，绝不硬编码）；
   * numberById = 剧集 id → 集号（「标注为第 N 集」小字用）。
   */
  episodeContext?: { activeEpisodeId: string | null; numberById: Record<string, number> };
  /** 2026-11-05 开源页签（OpenLibBrowser 嵌入）用 */
  theme: ThemeConfig;
  /** 开源条目「入库后插入」回调（与 onPick 同一执行路径：占槽 + 插 @PictureN 块） */
  onPickAssetFromOpenLib: (a: Asset) => void;
}): ReactElement {
  const [activeIdx, setActiveIdx] = useState(0);
  const [panelTab, setPanelTab] = useState<'asset' | 'subject' | 'openlib'>('asset');
  const [subjectIdx, setSubjectIdx] = useState(0);
  /** 主体展开集合（chevron 独立命中区控制；点行本身只插入） */
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set());
  /** 搜索：资产按标题；主体按名称/状态图名（命中子状态图 → 自动展开父组） */
  const [searchQ, setSearchQ] = useState('');
  /** 详情面板目标（hover / 键盘高亮驱动；仅展示，不写入） */
  const [detail, setDetail] = useState<PickDetailTarget | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** 2026-11-05 导入入口：空态主按钮 + 非空态列表底行，同一条 useCasUpload 链（不新写存储） */
  const uploadAssets = useCasUpload();
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
  }, [panelTab]);

  const query = searchQ.trim().toLowerCase();

  const groups = useMemo(() => {
    const pool = query ? candidates.filter((a) => a.title.toLowerCase().includes(query)) : candidates;
    const byId = new Map(pool.map((a) => [a.id, a]));
    const pooled = pooledOrder.map((id) => byId.get(id)).filter((a): a is Asset => !!a);
    const pooledSet = new Set(pooledOrder);
    const rest = pool.filter((a) => !pooledSet.has(a.id));
    const project = rest.filter((a) => a.scope === 'project');
    const library = rest.filter((a) => a.scope !== 'project');
    const g: Array<{ name: string; items: Asset[] }> = [];
    if (pooled.length > 0) g.push({ name: t('director.groupPooled', '已入槽'), items: pooled });
    if (project.length > 0) g.push({ name: t('director.groupProject', '项目资产'), items: project });
    if (library.length > 0) g.push({ name: t('director.groupLibrary', '全局'), items: library });
    return g;
  }, [candidates, pooledOrder, query, t]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  /**
   * 2026-11-05 方案 C（约定）：主体列表按「出现集数」排序——不过滤、
   * 命中本集或未标注排前、标注为其它集的排后（组内稳定排序，display-only）。
   * activeEpisodeId 取不到 = 不重排（与主体库 StoryboardSubjectTree 同一口径）。
   */
  const subjectEpisodeRank = useCallback((item: ProductionItem): 0 | 1 => {
    const active = episodeContext?.activeEpisodeId ?? null;
    if (!active) return 0;
    const eps = item.episodeIds ?? [];
    if (eps.length === 0) return 0; // 未标注 = 通用
    return eps.includes(active) ? 0 : 1;
  }, [episodeContext]);

  /** 主体 Tab：按 kind 分组（角色/场景/道具；无内容不渲染）；组内按方案 C 相关性排序 */
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
   * 主体「状态级媒体」行（2026-11-05）：主体树 → 状态 → 媒体（图/音频/视频）。
   * 数据源是主体树本身，与片段插槽分配完全无关（没有插槽也能查到并引用）；
   * 无媒体的状态同样列出（禁用 + 「无素材」），避免用户点到才报错。
   */
  const stateGroups = useMemo(() => {
    const out: Array<{ tree: SubjectTree; rows: Array<{ stateId: string; stateName: string; media: SubjectNodeMediaRef | null }> }> = [];
    for (const tree of subjectTrees ?? []) {
      const treeHit = tree.name.toLowerCase().includes(query);
      const rows = (tree.states ?? [])
        .filter((st) => !query || treeHit || (st.state ?? '').toLowerCase().includes(query))
        .map((st) => ({
          stateId: st.id,
          stateName: st.state || t('director.subjectStateFallback', '剧照'),
          media: (st.media ?? []).find((m) => m.type === 'image' || m.type === 'audio' || m.type === 'video') ?? null,
        }));
      if (rows.length > 0) out.push({ tree, rows });
    }
    return out;
  }, [subjectTrees, query, t]);

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
          if (a) onPick(a);
        }
      } else {
        const row = subjRows[subjectIdx];
        if (e.key === 'ArrowDown') { e.preventDefault(); setSubjectIdx((i) => Math.min(i + 1, subjRows.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setSubjectIdx((i) => Math.max(i - 1, 0)); }
        else if (e.key === 'ArrowRight' && !inSearch) {
          // → 展开当前父组
          if (row?.type === 'subject' && !expandedSubjects.has(row.item.id)) {
            e.preventDefault();
            toggleSubject(row.item.id);
          }
        } else if (e.key === 'ArrowLeft' && !inSearch) {
          // ← 收起父组；子行/提示行 → 跳回父行
          if (row?.type === 'subject' && expandedSubjects.has(row.item.id)) {
            e.preventDefault();
            toggleSubject(row.item.id);
          } else if (row && row.type !== 'subject') {
            e.preventDefault();
            const parentIdx = subjRows.findIndex((r) => r.type === 'subject' && r.item.id === row.item.id);
            if (parentIdx >= 0) setSubjectIdx(parentIdx);
          }
        } else if (e.key === 'Enter' && !inSearch) {
          // Enter = 插入当前高亮行（子行则插该状态图；提示行无动作）
          e.preventDefault();
          if (row?.type === 'subject') onPickSubject(row.item);
          else if (row?.type === 'state') onPickSubjectImage(row.item, row.img);
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [flat, subjRows, expandedSubjects, activeIdx, subjectIdx, panelTab, onPick, onPickSubject, onPickSubjectImage, toggleSubject, onClose]);

  /** 键盘高亮移动 → 详情面板同步（不承担选中职责）；Tab 无条目 → 空态 */
  useEffect(() => {
    if (panelTab === 'asset') {
      const a = flat[activeIdx];
      setDetail(a ? { type: 'asset', asset: a } : null);
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
          /* 名称可两行截断（放大后详情区变宽，长名称不再一行硬截） */
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

  /** 右侧只读详情面板（hover / ↑↓ 高亮驱动；不承担选中职责；空态给中性提示，不留空白砖） */
  const detailPanel = (
    <div
      data-asset-detail
      style={{
        width: ASSET_PICK_DETAIL_WIDTH, flexShrink: 0, borderLeft: `1px solid ${palette.popBorder}`, paddingLeft: 12,
        display: 'flex', flexDirection: 'column', gap: 8, height: '100%', minHeight: 0, overflowY: 'auto',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {!detail && (
        <div style={{ padding: '16px 8px', fontSize: 12, color: palette.sub }}>
          {t('director.detailEmpty', '悬停或用 ↑↓ 选择条目查看详情')}
        </div>
      )}
      {detail?.type === 'asset' && (() => {
        const a = detail.asset;
        const ref = assetToDirectorRef(a);
        const inSlot = slotLabels[a.id];
        return (
          <>
            {ref?.kind === 'image' ? (
              <ThumbImage storageKey={ref.storageKey} url={ref.url} prefer="preview" width="100%" height={120} radius={8} title={a.title} icon={<ImageIcon size={20} style={{ opacity: 0.6 }} />} />
            ) : null}
            {detailRow(t('director.detailName', '名称'), a.title, 'name', true)}
            {detailRow(t('director.detailKind', '类型'), ref ? ASSET_KIND_NAME[ref.kind] : '-', 'kind')}
            {detailRow(t('director.detailScope', '范围'), a.scope === 'project' ? t('director.scopeProject', '本项目') : t('director.scopeLibrary', '公共'), 'scope')}
            {detailRow(
              t('director.detailSlot', '槽位'),
              inSlot ? t('director.detailInSlot', '已占用 {{label}}', { label: inSlot }) : t('director.detailNotPooled', '未占用'),
              'slot',
            )}
            {detailRow(t('director.detailSource', '来源'), ref?.storageKey ?? ref?.url ?? '-', 'source')}
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
              /* 状态图集合 = 只读预览（2026-11-04 第四条更正 req6：插入只在左侧子行发生） */
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

  let rowIdx = -1;

  return (
    <div
      ref={panelRef}
      data-director-asset-panel
      style={{
        position: 'absolute', top: '100%', left: 0, marginTop: 8, zIndex: 30,
        /* 2026-11-05 放大：固定尺寸（视口夹取 92vw / 80vh），高度不自适应跳动 */
        width: ASSET_PICK_PANEL_WIDTH, height: ASSET_PICK_PANEL_HEIGHT, boxSizing: 'border-box',
        background: palette.popBg, border: `1px solid ${palette.popBorder}`,
        borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.45)', padding: 12,
        display: 'flex', gap: 10,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div style={{ flex: 1, minWidth: 0, height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Tab：资产 / 主体 / 开源（2026-11-05：开源复用 OpenLibBrowser 嵌入） */}
      <div style={{ display: 'inline-flex', gap: 4, padding: 3, borderRadius: 8, background: 'rgba(255,255,255,0.05)', marginBottom: 10, flexShrink: 0 }}>
        {(['asset', 'subject', 'openlib'] as const).map((key) => {
          const active = panelTab === key;
          return (
            <button
              key={key}
              type="button"
              data-asset-panel-tab={key}
              onClick={() => setPanelTab(key)}
              style={{
                padding: '6px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer', border: 'none',
                background: active ? 'rgba(255,255,255,0.10)' : 'transparent',
                color: active ? palette.capsuleText : palette.sub,
              }}
            >
              {key === 'asset'
                ? t('director.assetTab', '资产')
                : key === 'subject'
                  ? t('director.subjectTab', '主体')
                  : t('director.openlibTab', '开源')}
            </button>
          );
        })}
      </div>
      {/* 搜索（2026-11-04 第四条更正 req8）：资产按标题；主体按名称/状态图名（命中子状态图自动展开父组）。
          开源页签不渲染（OpenLibBrowser 自带分类/搜索） */}
      {panelTab !== 'openlib' && (
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
      {panelTab === 'asset' && (
      <div data-asset-panel-list ref={listRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {groups.map((g) => (
          <div key={g.name}>
            <div style={{ fontSize: 11, color: palette.sub, padding: '8px 8px 4px' }}>{g.name}</div>
            {g.items.map((a) => {
              rowIdx += 1;
              const idx = rowIdx;
              const ref = assetToDirectorRef(a);
              const Icon = ref ? KIND_ICON[ref.kind] : ImageIcon;
              const selected = idx === activeIdx;
              const inUse = isDuplicate(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  data-asset-panel-item={a.id}
                  data-asset-panel-active={selected || undefined}
                  draggable={!!ref}
                  onDragStart={(e) => {
                    if (!ref) return;
                    e.stopPropagation();
                    e.dataTransfer.effectAllowed = 'copy';
                    e.dataTransfer.setData(DIRECTOR_ASSET_DRAG_MIME, JSON.stringify(ref));
                  }}
                  onClick={() => onPick(a)}
                  onMouseEnter={() => { setActiveIdx(idx); setDetail({ type: 'asset', asset: a }); }}
                  onFocus={() => { setActiveIdx(idx); setDetail({ type: 'asset', asset: a }); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%', height: ASSET_PICK_ROW_HEIGHT,
                    padding: '0 10px', border: 'none', borderRadius: 8, cursor: 'pointer', flexShrink: 0,
                    background: selected ? palette.popHover : 'transparent',
                    color: palette.capsuleText, fontSize: 13, textAlign: 'left',
                  }}
                >
                  {ref?.kind === 'image' ? (
                    <ThumbImage storageKey={ref.storageKey} url={ref.url} width={ASSET_PICK_THUMB_SIZE} height={ASSET_PICK_THUMB_SIZE} radius={6} title={a.title} icon={<Icon size={18} style={{ opacity: 0.7 }} />} />
                  ) : (
                    <span style={{ width: ASSET_PICK_THUMB_SIZE, height: ASSET_PICK_THUMB_SIZE, borderRadius: 6, background: 'rgba(255,255,255,0.06)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon size={18} style={{ opacity: 0.7 }} />
                    </span>
                  )}
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.title}
                  </span>
                  {inUse && (
                    <span data-asset-panel-inuse style={{ fontSize: 10, color: palette.sub, flexShrink: 0 }}>
                      {slotLabels[a.id] ?? t('director.assetInUse', '已引用')}
                    </span>
                  )}
                  {!inUse && (a.data.kind === 'image' || a.data.kind === 'audio' || a.data.kind === 'video') && isKindFull(a.data.kind) && (
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
          /* 2026-11-05 空态给出口：不只留一句「暂无可引用资产」——导入按钮走
             useCasUpload（与素材抽屉同一条 CAS 链，不新写存储），导入后面板经
             useAssets 订阅自动刷新 */
          <div data-asset-panel-import-empty style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 13, color: palette.sub, textAlign: 'center' }}>
              {t('director.assetEmpty', '暂无可引用资产')}
            </div>
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
          </div>
        )}
        {flat.length > 0 && (
          /* 非空态轻量导入入口：列表底部一行（不用退出去导入） */
          <button
            type="button"
            data-asset-import
            onClick={() => importInputRef.current?.click()}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%',
              height: 36, border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
              background: 'transparent', color: palette.sub, fontSize: 12, flexShrink: 0,
            }}
          >
            <Plus size={14} />
            {t('director.importAsset', '导入资产')}
          </button>
        )}
      </div>
      )}
      {/* 隐藏导入输入（同一条 useCasUpload 链；导入后 useAssets 订阅刷新列表） */}
      <input
        ref={importInputRef}
        type="file"
        multiple
        accept="image/*,video/*,audio/*"
        data-asset-import-input
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length > 0) void uploadAssets(files);
          e.target.value = '';
        }}
      />

      {/* 主体 Tab（2026-11-04 第四条更正：文件夹语义 1 对 N）：
          - 一级行单击 = 插入整主体引用 subject:<id>（无图主体同可占槽）；
          - 行左侧 chevron 独立命中区（≥20px）= 展开/收起，与行点击互不误触；
          - 展开后状态图子行缩进呈现，单击子行 = 精确插入 subject:<id>:<stateId>；
          - 无状态图主体展开后给中性提示行（不可点） */}
      {panelTab === 'subject' && (
        <div data-asset-panel-list style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
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
                      onClick={() => onPickSubject(item)}
                      onMouseEnter={() => { setSubjectIdx(idx); setDetail({ type: 'subject', subject: item }); }}
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
                      {/* 2026-11-05 方案 C：标注为其它集的主体 → 小字「标注为第 N 集」
                          （不过滤不禁点，仍可正常选择；未标注/命中本集不显示） */}
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
                      onClick={() => onPickSubjectImage(item, img)}
                      onMouseEnter={() => { setSubjectIdx(idx); setDetail({ type: 'subject', subject: item }); }}
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
                        onClick={() => { if (ref) onPickSubjectState(ref); }}
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

      {/* 开源 Tab（2026-11-05）：复用 OpenLibBrowser 单一定义源（分类/搜索/分页/18+ 门控），
          点击条目 = importOpenLibEntry 入库 → onPickAssetFromOpenLib（与资产条目同一
          「占槽 + 插 @PictureN 」执行路径）。不复制第二份卡片实现。 */}
      {panelTab === 'openlib' && (
        <div
          data-asset-panel-openlib
          style={{ width: '100%', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', minWidth: 0 }}
        >
          <OpenLibBrowser theme={theme} onPickAsset={onPickAssetFromOpenLib} />
        </div>
      )}
      </div>
      {panelTab !== 'openlib' && detailPanel}
    </div>
  );
}

// ===== 面板主体 =====

export interface DirectorPromptPanelProps {
  shared: WorkbenchSharedParams;
  onSharedChange: (patch: Partial<WorkbenchSharedParams>) => void;
  shot: WorkbenchShot;
  shotIndex: number;
  /** 镜头总数（标题区跳转胶囊「镜头 N / M」分母，宿主受控传入） */
  totalShots: number;
  /** 跳到上一个 / 下一个镜头：只发信号，组件内不持有序号（受控组件复用铁律） */
  onPrevShot: () => void;
  onNextShot: () => void;
  onShotChange: (patch: Partial<WorkbenchShot>) => void;
  theme: ThemeConfig;
  isDark: boolean;
  /** 主体库条目（ProductionItem；images=状态图，stateTag=状态名）。缺省 = 主体 Tab 空态 */
  subjects?: ProductionItem[];
  /** 主体树（状态级媒体：图片/音频/视频）。@ 候选独立于插槽，缺省 = 无状态素材分组 */
  subjectTrees?: SubjectTree[];
  /**
   * 2026-11-05 方案 C：剧本集上下文（activeEpisodeId + 集 id→集号映射）——
   * 主体列表按「出现集数」排序（命中本集/未标注前、其它集后 + 「标注为第 N 集」小字）；
   * 缺省 = 不重排不加标签。
   */
  episodeContext?: { activeEpisodeId: string | null; numberById: Record<string, number> };
  /* 2026-11-04 参数合并：参数收进导轨「参数」浮层面板 + 独立「运行」按钮（DirectorParamsButton/DirectorRunButton，经 multitrack paramsButton/runButton 注入），本面板不再渲染参数控件。 */
}

/**
 * 主体「状态级媒体」→ 导演台素材引用（2026-11-05 扩展）。
 * 稳定身份沿用 CAS 记账键 `subject-state:<rootId>/<stateId>`（subject-state-media.ts L46），
 * 不新造第二套 id；候选来源 = 主体树状态媒体，与片段是否已分配插槽无关。
 */
function subjectStateMediaToRef(tree: SubjectTree, stateId: string, stateName: string, media: SubjectNodeMediaRef): DirectorAssetRef {
  const kind = media.type === 'audio' || media.type === 'video' ? media.type : 'image';
  return {
    id: `subject-state:${tree.rootId}/${stateId}`,
    kind,
    title: `${tree.name}·${stateName}`,
    storageKey: media.key,
    originScope: 'project',
  };
}

/** 主体状态图 → 图片素材（占一个图片槽位，走 assignAssetSlots 唯一编号路径） */
function subjectImageToRef(item: ProductionItem, img: ProductionItemImage): DirectorAssetRef {
  const stateName = img.stateTag ?? img.tags[0] ?? '剧照';
  return {
    id: `subject:${item.id}:${img.storageKey}`,
    kind: 'image',
    title: `${item.name}·${stateName}`,
    storageKey: img.storageKey,
    originScope: 'project',
  };
}

export const DirectorPromptPanel = memo(function DirectorPromptPanel({
  shared, onSharedChange, shot, shotIndex, totalShots, onPrevShot, onNextShot, onShotChange,
  theme, isDark, subjects, subjectTrees, episodeContext,
}: DirectorPromptPanelProps): ReactElement {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [assetPanelOpen, setAssetPanelOpen] = useState(false);
  /** 替换模式：点已填槽位 → 选定后替换该槽位内容（槽位号不变） */
  const [replaceTarget, setReplaceTarget] = useState<string | null>(null);
  const [hoverSlot, setHoverSlot] = useState<string | null>(null);
  const { assets: allAssets } = useAssets();
  const palette = useCardPalette(theme, isDark);
  const editorRef = useRef<MentionEditorHandle>(null);

  const tier: DirectorModelTier = shared.presetId;
  const caps = DIRECTOR_ASSET_CAPS[tier];

  const mentionCandidates = useMemo(
    () => allAssets.filter((a) => a.data.kind === 'image' || a.data.kind === 'video' || a.data.kind === 'audio'),
    [allAssets],
  );

  const segmentAssets = useMemo(
    () => (shot.references ?? []).map(shotRefToDirectorRef).filter((r): r is DirectorAssetRef => r !== null),
    [shot.references],
  );
  /** 提示词只属于片段（2026-11-05 公共提示词层下线） */
  const currentPrompt = shot.imagePrompt ?? '';
  /** 片段标题（Row2 左侧，2026-11-05 补回）：镜头号 + 时长，取现有字段、随选中片段实时变化；空数据给中性文案 */
  const shotNo = Number.isFinite(shot?.number) && (shot?.number ?? 0) > 0 ? shot.number : shotIndex + 1;
  const segTitle = Number.isFinite(shotNo) && shotNo > 0
    ? t('director.segmentTitle', '镜头 {{num}} · {{sec}}s', { num: shotNo, sec: shot.duration })
    : t('director.segmentTitleEmpty', '未选中片段');

  /** 唯一槽位计算点（2026-11-05 公共素材 UI 下线）：槽位全部属于当前片段，从 1 连续编号
   *  （Picture1 = 第 1 格）；sharedParams.assets 仅作老数据读取兼容，界面不再暴露 */
  const slotInfo = useMemo(() => {
    try {
      return assignAssetSlots({ shared: [], segment: segmentAssets, tier });
    } catch {
      return assignAssetSlots({ shared: [], segment: [], tier });
    }
  }, [segmentAssets, tier]);

  /** 本片段已用槽位数：@ 池外资产插入前判空位 */
  const kindUsed = useMemo(() => {
    const counts: Record<DirectorAssetRef['kind'], number> = { image: 0, audio: 0, video: 0 };
    for (const a of segmentAssets) counts[a.kind] += 1;
    return counts;
  }, [segmentAssets]);
  const isKindFull = useCallback(
    (kind: DirectorAssetRef['kind']) => kindUsed[kind] >= caps[kind],
    [kindUsed, caps],
  );

  const pooledOrder = useMemo(
    () => segmentAssets.map((a) => a.id),
    [segmentAssets],
  );

  /** 资产/主体引用 id → 槽位标签（@ 浮层「已入槽」徽标与详情面板展示用） */
  const slotLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const e of slotInfo.entries) map[e.assetId] = e.label;
    return map;
  }, [slotInfo]);

  /** 槽位号 → 当前资产视图（替换槽位后同 label 自动指向新资产；`subject:<id>` 走封面回落链自动解析） */
  const resolveSlot = useCallback((label: string): MentionSlotView | undefined => {
    const entry = slotInfo.entries.find((e) => e.label === label);
    if (!entry) return undefined;
    const ref = segmentAssets.find((a) => a.id === entry.assetId);
    if (!ref) return undefined;
    const visual = resolveRefVisual(ref, subjects);
    return { label, title: ref.title ?? ref.id, kind: ref.kind, url: visual.url, storageKey: visual.storageKey };
  }, [slotInfo, segmentAssets, subjects]);

  const persistRef = useCallback((ref: DirectorAssetRef) => {
    const shotRef: WorkbenchShotReference = {
      id: ref.id, kind: ref.kind, title: ref.title, storageKey: ref.storageKey, url: ref.url,
    };
    (shotRef as WorkbenchShotReference & { originScope?: string }).originScope = ref.originScope;
    shotRef.slotNo = ref.slotNo;
    onShotChange({ references: [...(shot.references ?? []), shotRef] });
  }, [shot.references, onShotChange]);

  /**
   * @ 入栈（B 组语义）：
   * - 池内已有 → 直接插入该槽位引用（不新增槽位，可重复 @）
   * - 池外 + 该类型有空位 → 第一个空槽位入栈并插入引用
   * - 池外 + 该类型已满 → 拒绝插入，提示「该类型槽位已满（N/N），请先替换某个槽位」
   */
  const insertRef = useCallback((ref: DirectorAssetRef) => {
    const existing = slotInfo.byAssetId[ref.id];
    if (existing) {
      editorRef.current?.insertAtCaret(`@${existing.label} `);
      return;
    }
    try {
      // 先校验再落库（不静默截断）；溢出直接抛 DirectorSlotOverflowError
      const trial = assignAssetSlots({ shared: [], segment: [...segmentAssets, ref], tier });
      const label = trial.byAssetId[ref.id]?.label;
      if (!label) throw new DirectorSlotOverflowError(ref.kind, kindUsed[ref.kind] + 1, caps[ref.kind]);
      // 槽位号 pin 落库：之后移除中间槽位时其余槽位保持原号（不重排）
      persistRef({ ...ref, slotNo: trial.byAssetId[ref.id]!.slot });
      editorRef.current?.insertAtCaret(`@${label} `);
    } catch (err) {
      if (err instanceof DirectorSlotOverflowError) {
        message.warning(t('director.slotFull', '该类型槽位已满（{{used}}/{{cap}}），请先替换某个槽位', {
          used: Math.min(kindUsed[ref.kind], err.cap), cap: err.cap,
        }));
      } else throw err;
    }
  }, [segmentAssets, tier, slotInfo, kindUsed, caps, persistRef, message, t]);

  const pickFromPanel = useCallback((a: Asset) => {
    const ref = assetToDirectorRef(a);
    if (ref) insertRef(ref);
  }, [insertRef]);

  const pickSubjectImage = useCallback((item: ProductionItem, img: ProductionItemImage) => {
    insertRef(subjectImageToRef(item, img));
  }, [insertRef]);

  /** 主体状态级媒体（`subject-state:<rootId>/<stateId>`）：与已分配插槽无关，插入走同一 insertRef */
  const pickSubjectState = useCallback((ref: DirectorAssetRef) => {
    insertRef(ref);
  }, [insertRef]);

  /** 整主体占槽（`subject:<id>`，无图主体同样可占；补图后经 resolveSubjectCover 自动解析封面） */
  const pickSubject = useCallback((item: ProductionItem) => {
    insertRef(subjectToRef(item));
  }, [insertRef]);

  /** 替换槽位：同位置替换（槽位号、顺序、所有 @ 引用自动跟新资产；pin 保留原槽号） */
  const replaceSlotAssetAt = useCallback((targetId: string, newRef: DirectorAssetRef) => {
    const pinned: DirectorAssetRef = {
      ...newRef,
      slotNo: newRef.slotNo ?? slotInfo.byAssetId[targetId]?.slot,
    };
    const refs = [...(shot.references ?? [])];
    const idx = refs.findIndex((r) => r.id === targetId);
    if (idx >= 0) {
      const shotRef: WorkbenchShotReference = {
        id: pinned.id, kind: pinned.kind, title: pinned.title, storageKey: pinned.storageKey, url: pinned.url,
      };
      (shotRef as WorkbenchShotReference & { originScope?: string }).originScope = pinned.originScope;
      shotRef.slotNo = pinned.slotNo;
      refs[idx] = shotRef;
      onShotChange({ references: refs });
    }
    setReplaceTarget(null);
    setAssetPanelOpen(false);
  }, [slotInfo, shot.references, onShotChange]);

  /** 点已填槽位 = 替换该槽（先在面板选新资产） */
  const replaceSlotAsset = useCallback((newRef: DirectorAssetRef) => {
    if (!replaceTarget) return;
    replaceSlotAssetAt(replaceTarget, newRef);
  }, [replaceTarget, replaceSlotAssetAt]);

  /** 槽位移除：只解引用（资产仍在项目库/公共库）；提示词 @ 块降级为纯文本；其余槽位靠 pin 保持原号 */
  const removeAsset = useCallback((assetId: string) => {
    const label = slotInfo.byAssetId[assetId]?.label;
    onShotChange({
      references: (shot.references ?? []).filter((r) => r.id !== assetId),
      ...(label ? { imagePrompt: degradeMentionText(shot.imagePrompt ?? '', label) } : {}),
    });
  }, [slotInfo, shot.references, shot.imagePrompt, onShotChange]);

  /**
   * 槽位移除入口（2026-11-04 第十三条，替代第三条 req5 的 Modal 轻确认）：
   * - 不再用 Modal/确认框：点击 × 立即移除；被引用时正文 @Label 同步降级为纯文本（沿用降级规则）
   * - 轻量 toast：3s 自动消失（antd message 默认顶部，不遮挡提示词输入区）；
   *   同一 key 渲染 → 连续快速移除时新提示替换旧提示，不堆叠
   * - toast 内带「撤销」：一次性恢复该槽位与正文引用（回到本次移除前状态）；超时/被替换后不可撤销
   */
  const requestRemoveAsset = useCallback((assetId: string) => {
    const label = slotInfo.byAssetId[assetId]?.label;
    // 移除前快照（撤销用：资产插回原位 → pin 槽号自然恢复；正文回到本次移除前，
    // 逐次独立快照 —— 快速连删时旧 toast 被替换，只剩最新一次可撤销，语义自洽）
    const prevShotRefs = [...(shot.references ?? [])];
    const prevPrompt = currentPrompt;
    const referenced = !!label && currentPrompt.includes(`@${label}`);
    removeAsset(assetId);
    if (!label) return;
    const undo = () => {
      message.destroy(REMOVE_SLOT_TOAST_KEY);
      onShotChange({ references: prevShotRefs, imagePrompt: prevPrompt });
    };
    message.open({
      key: REMOVE_SLOT_TOAST_KEY,
      type: referenced ? 'warning' : 'success',
      duration: 3,
      content: (
        <span data-slot-remove-toast>
          {referenced
            ? t('director.slotRemovedDegraded', '已移除 {{label}}，提示词中的 @{{label}} 已降级为纯文本', { label })
            : t('director.slotRemoved', '已移除 {{label}}', { label })}
          <button
            type="button"
            data-slot-remove-undo
            onClick={undo}
            style={{
              marginLeft: 10, padding: 0, border: 'none', background: 'none', cursor: 'pointer',
              color: '#3b82f6', fontSize: 'inherit', textDecoration: 'underline',
            }}
          >
            {t('director.undo', '撤销')}
          </button>
        </span>
      ),
    });
  }, [slotInfo, currentPrompt, removeAsset, message, shot.references, onShotChange, t]);

  /** 资产面板去重集合（本片段素材池） */
  const currentIdSet = useMemo(
    () => new Set(segmentAssets.map((a) => a.id)),
    [segmentAssets],
  );
  const isDuplicate = useCallback((assetId: string) => currentIdSet.has(assetId), [currentIdSet]);

  /** 插槽拖拽互换：把 A 拖到 B 上 = 两个槽位的内容互换，槽号不动（@引用跟着槽号指向新内容） */
  const swapSlotAssets = useCallback((sourceAssetId: string, targetAssetId: string) => {
    if (sourceAssetId === targetAssetId) return;
    const refs = [...(shot.references ?? [])];
    const i = refs.findIndex((r) => r.id === sourceAssetId);
    const j = refs.findIndex((r) => r.id === targetAssetId);
    if (i < 0 || j < 0) return;
    const a = refs[i]!;
    const b = refs[j]!;
    const aSlot = a.slotNo;
    const bSlot = b.slotNo;
    // 槽号 pin 跟着"格子"走：内容换位后仍占原来的槽号
    refs[i] = { ...b, slotNo: aSlot ?? bSlot };
    refs[j] = { ...a, slotNo: bSlot ?? aSlot };
    onShotChange({ references: refs });
    const aLabel = slotInfo.byAssetId[a.id]?.label;
    const bLabel = slotInfo.byAssetId[b.id]?.label;
    if (aLabel && bLabel) {
      message.success(t('director.slotSwapped', '已交换 {{a}} 与 {{b}}', { a: aLabel, b: bLabel }));
    }
  }, [shot.references, onShotChange, slotInfo, message, t]);

  /** 槽位格渲染（单行素材池，槽位全部属于当前片段、从 1 连续编号）：
   *  已填槽位默认只显示首帧/缩略图，hover 浮出大图（视频可播、音频可控）+名称；点已填槽位 = 替换该槽位；右上角 × 移除 */
  const renderSlotCells = (assets: DirectorAssetRef[]) => assets.map((a) => {
    const slot = slotInfo.byAssetId[a.id];
    const Icon = KIND_ICON[a.kind];
    // `subject:<id>` 整主体占槽走封面回落链（补图后自动解析）；无图主体 = 占位格（图标+名称+槽号）
    const visual = resolveRefVisual(a, subjects);
    return (
      <span
        key={a.id}
        data-slot={slot?.label}
        data-slot-filled={a.id}
        onClick={() => { setReplaceTarget(a.id); setAssetPanelOpen(true); }}
        onDragOver={(e) => {
          const canReplace = e.dataTransfer.types.includes(DIRECTOR_ASSET_DRAG_MIME);
          const canSwap = e.dataTransfer.types.includes(DIRECTOR_SLOT_DRAG_MIME);
          if (!canReplace && !canSwap) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = canSwap ? 'move' : 'copy';
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          // 插槽 → 插槽：整格互换（内容换位、槽号固定）
          const slotRaw = e.dataTransfer.getData(DIRECTOR_SLOT_DRAG_MIME);
          if (slotRaw) {
            try {
              const payload = JSON.parse(slotRaw) as { assetId?: string };
              if (payload.assetId) swapSlotAssets(payload.assetId, a.id);
            } catch { /* 非法 payload 忽略 */ }
            return;
          }
          // 素材面板条目 → 插槽：纯替换（槽位号固定不变，只换内容）
          const raw = e.dataTransfer.getData(DIRECTOR_ASSET_DRAG_MIME);
          if (!raw) return;
          try {
            replaceSlotAssetAt(a.id, JSON.parse(raw) as DirectorAssetRef);
          } catch { /* 非法 payload 忽略 */ }
        }}
        onMouseEnter={() => setHoverSlot(a.id)}
        onMouseLeave={() => setHoverSlot((cur) => (cur === a.id ? null : cur))}
        // 2026-11-05 用户指令：插槽可拖进提示词正文（落点自动补 @引用）；无槽号（异常态）不可拖
        draggable={!!slot}
        onDragStart={(e) => {
          if (!slot) return;
          e.stopPropagation();
          e.dataTransfer.effectAllowed = 'copy';
          e.dataTransfer.setData(DIRECTOR_SLOT_DRAG_MIME, JSON.stringify({ label: slot.label, assetId: a.id }));
        }}
        style={{
          position: 'relative', width: 64, height: 64, borderRadius: 8, flexShrink: 0,
          border: `1px solid ${palette.chipBorder}`, background: palette.chipBg,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        }}
      >
        {/* 2026-11-05 媒体分派：视频显示首帧（poster 优先，取不到 → <video preload="metadata">），
            音频显示图标；源取不到给可读原因（不静默胶片图标） */}
        {visual.storageKey || visual.url ? (
          <ThumbImage
            kind={a.kind}
            storageKey={visual.storageKey}
            url={visual.url}
            width={64} height={64} radius={8}
            title={a.title ?? a.id}
            icon={<Icon size={18} style={{ opacity: 0.75 }} />}
          />
        ) : (
          <Icon size={18} style={{ opacity: 0.75 }} />
        )}
        {/* 移除入口：右上角 18px ×，未 hover 不可见不占位；触屏 hover:none 常驻 */}
        <button
          type="button"
          className="director-slot-remove"
          data-slot-x={a.id}
          aria-label={t('director.slotRemove', '移除')}
          title={t('director.slotRemove', '移除')}
          onClick={(e) => { e.stopPropagation(); setHoverSlot(null); requestRemoveAsset(a.id); }}
          style={{
            position: 'absolute', top: -6, right: -6, width: 18, height: 18, padding: 0, zIndex: 2,
            borderRadius: '50%', border: `1px solid ${palette.popBorder}`, background: palette.popBg,
            color: palette.sub, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <X size={11} />
        </button>
        {hoverSlot === a.id && (
          <span
            data-slot-preview
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 40, width: 200,
              background: palette.popBg, border: `1px solid ${palette.popBorder}`, borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.45)', padding: 8, cursor: 'default',
              display: 'flex', flexDirection: 'column', gap: 6, textAlign: 'left',
            }}
          >
            {/* 2026-11-05 媒体分派：图片 hover 大图；视频 <video muted loop autoPlay> 可点播/暂停；音频 <audio controls> */}
            {visual.storageKey || visual.url ? (
              <ThumbImage
                kind={a.kind}
                playable
                storageKey={visual.storageKey}
                url={visual.url}
                prefer={a.kind === 'image' ? 'preview' : 'thumb'}
                width={184} height={a.kind === 'audio' ? 40 : 120} radius={8}
                title={a.title ?? a.id}
                icon={<Icon size={26} style={{ opacity: 0.6 }} />}
              />
            ) : (
              <span style={{ width: 184, height: 76, borderRadius: 8, background: 'rgba(255,255,255,0.06)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={26} style={{ opacity: 0.6 }} />
              </span>
            )}
            <span style={{ fontSize: 12, color: palette.capsuleText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {a.title ?? a.id}
            </span>
            <span style={{ fontSize: 10, color: palette.sub }}>{slot?.label ?? ''}</span>
            <button
              type="button"
              data-slot-remove
              onClick={(e) => { e.stopPropagation(); setHoverSlot(null); requestRemoveAsset(a.id); }}
              style={{ alignSelf: 'flex-start', border: 'none', borderRadius: 4, background: 'transparent', color: palette.sub, cursor: 'pointer', fontSize: 11, padding: '2px 4px' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = palette.danger; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = palette.sub; }}
            >
              {t('director.slotRemove', '移除')}
            </button>
          </span>
        )}
      </span>
    );
  });

  const setSharedParam = useCallback((key: string, v: unknown) => {
    onSharedChange({ params: { ...shared.params, [key]: v } });
  }, [shared.params, onSharedChange]);

  // 视频尺寸换算已随参数合并收进导轨「参数」浮层面板（DirectorParamsButton 浮层面板）；此面板不再使用 aspect/scaleFactor/resolvedSize。

  // 段间引导：段 1 置灰；其余段缺省 true（与节点 segment_continuity 语义一致）
  const continuityDisabled = shotIndex === 0;
  const continuityOn = !continuityDisabled && (shot.continuation?.enabled ?? true);
  const continuityMode = String(shared.params['continuityMode'] ?? 'guide');
  const overlapFrames = snapContinuityOverlap(Number(shared.params['continuityOverlapFrames'] ?? 22));
  const continuityRedraw = Number(shared.params['continuityRedraw'] ?? 0.1);

  /**
   * 时长滑动条派生量（2026-11-06）：推荐上限随段间引导的 ctx 帧数实时扣回；
   * 上限诚实扩展——老数据/MCP 写入的超 30s 值不让拇指顶死在末端假报“正常”。
   */
  const durationCtxFrames = continuityOn ? overlapFrames : 0;
  const durationCapSec = recommendedDurationCapSec(durationCtxFrames);
  const durationSliderMax = Math.max(DURATION_SLIDER_MAX_SEC, Math.ceil(shot?.duration ?? 0));
  const durationOverSec = shot ? durationOverCapSec(shot.duration, durationCtxFrames) : 0;
  const durationHardOver = shot ? durationExceedsFrameCap(shot.duration) : false;
  /** 时长文本：整数不带小数（5s），小数保留一位（6.8s）——滑动粒度 0.2s 下不会出现更长尾 */
  const durationText = (sec: number): string => {
    // 统一到 0.1s 精度，去掉浮点噪声（5.300000000000001 → 5.3），避免文案宽度抖动
    const rounded = Math.round(sec * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
  };

  /** 提示词编辑（仅片段；公共提示词层已下线 2026-11-05） */
  const setPrompt = useCallback((v: string) => {
    onShotChange({ imagePrompt: v });
  }, [onShotChange]);

  /** 主题化 CSS：提示词框 6px 细滚动条 + antd Select/InputNumber 深色（zIndex 走默认 1050，不超 21100） */
  const directorCss = useMemo(() => `
    [data-director-prompt-panel] .director-prompt-input { scrollbar-width: thin; scrollbar-color: ${palette.scrollThumb} transparent; }
    [data-director-prompt-panel] .director-prompt-input::-webkit-scrollbar { width: 6px; }
    [data-director-prompt-panel] .director-prompt-input::-webkit-scrollbar-thumb { background: ${palette.scrollThumb}; border-radius: 3px; }
    /* 轨道上下留出与外框圆角等高的空档，滚动条贴边也不切进圆角 */
    [data-director-prompt-panel] .director-prompt-input::-webkit-scrollbar-track { background: transparent; margin: ${WORKSPACE_SURFACE_RADIUS}px 0; }
    /* 聚焦描边与外框同圆角（覆盖内联 outline:none）。
       2026-11-05 用户指令：点击/聚焦状态不再用品牌红 rgba(233,69,96,*)——
       改中性亮色（深色=冷白 226,232,240；浅色=暖灰 68,64,60），与导轨卡片选中态同一口径。 */
    [data-director-prompt-panel] .director-prompt-input:focus-visible { outline: 2px solid ${isDark ? 'rgba(226,232,240,0.55)' : 'rgba(68,64,60,0.45)'} !important; outline-offset: 2px; border-radius: ${WORKSPACE_SURFACE_RADIUS}px; }
    .director-select .ant-select-selector { background: ${palette.capsuleBg} !important; border-color: transparent !important; border-radius: 6px !important; color: ${palette.capsuleText} !important; height: 25px !important; }
    .director-select .ant-select-selection-item { color: ${palette.capsuleText} !important; font-size: 12px; line-height: 23px !important; }
    .director-select .ant-select-arrow { color: ${palette.sub}; }
    .director-select-popup { background: ${palette.popBg} !important; border: 1px solid ${palette.popBorder}; border-radius: 8px !important; box-shadow: 0 4px 16px rgba(0,0,0,0.25) !important; }
    .director-select-popup .ant-select-item { color: ${palette.capsuleText}; font-size: 12px; }
    .director-select-popup .ant-select-item-option-active { background: ${palette.popHover} !important; }
    .director-select-popup .ant-select-item-option-selected { background: ${isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.10)'} !important; font-weight: 600; }
    .director-input-number { background: ${palette.capsuleBg} !important; border-color: transparent !important; border-radius: 6px !important; }
    .director-input-number .ant-input-number-prefix { color: ${palette.sub}; margin-inline-end: 2px; }
    .director-input-number input { color: ${palette.capsuleText} !important; font-size: 12px !important; background: transparent !important; }
    .director-input-number .ant-input-number-handler-wrap { background: transparent; border-inline-start-color: ${palette.popBorder}; }
    .director-input-number .ant-input-number-handler { color: ${palette.sub}; }
    /* 2026-11-04 白底根因：antd Popover 默认浅色，强制深色 token */
    .director-popover .ant-popover-inner { background: ${palette.popBg} !important; border: 1px solid ${palette.popBorder}; border-radius: 8px !important; box-shadow: 0 4px 16px rgba(0,0,0,0.45) !important; }
    .director-popover .ant-popover-inner-content, .director-popover .ant-popover-title { color: ${palette.capsuleText} !important; }
    .director-popover .ant-popover-arrow::before, .director-popover .ant-popover-arrow-content { background: ${palette.popBg} !important; }
    .director-popover .ant-checkbox-wrapper, .director-popover .ant-checkbox-inner { color: ${palette.capsuleText}; }
    .director-popover .ant-checkbox-inner { background: transparent !important; border-color: ${palette.popBorder} !important; }
    /* 时长滑动条（2026-11-06）：与导轨缩放滑块同一原生 range 形态 + 浮层深色 token；
       轨道前段（推荐区内）中性描边色，超过推荐上限的尾段走 danger，拇指越过上限同步变红 */
    .director-duration-range { -webkit-appearance: none; appearance: none; height: 4px; border-radius: 2px; outline: none; cursor: pointer; background: linear-gradient(90deg, ${palette.popBorder} 0 var(--dur-cap-pct, 100%), ${isDark ? 'rgba(239,68,68,0.55)' : 'rgba(239,68,68,0.40)'} var(--dur-cap-pct, 100%) 100%); }
    .director-duration-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 14px; height: 14px; border-radius: 50%; border: none; background: ${palette.capsuleText}; box-shadow: 0 1px 3px rgba(0,0,0,0.45); }
    .director-duration-range::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; border: none; background: ${palette.capsuleText}; }
    .director-duration-range[data-over-cap="1"]::-webkit-slider-thumb { background: ${palette.danger}; }
    .director-duration-range[data-over-cap="1"]::-moz-range-thumb { background: ${palette.danger}; }
    /* 2026-11-05 用户指令：选中态不用品牌红——浮层勾选框改中性亮色底/描边 */
    .director-popover .ant-checkbox-checked .ant-checkbox-inner { background: ${isDark ? 'rgba(226,232,240,0.88)' : 'rgba(68,64,60,0.75)'} !important; border-color: ${isDark ? 'rgba(226,232,240,0.88)' : 'rgba(68,64,60,0.75)'} !important; }
    /* 2026-11-04 第三条：槽位移除 × —— 未 hover/focus 不可见不占位；触屏（hover:none）常驻，不被锁死 */
    [data-director-prompt-panel] .director-slot-remove { opacity: 0; pointer-events: none; transition: opacity 0.12s; }
    [data-director-prompt-panel] [data-slot]:hover .director-slot-remove,
    [data-director-prompt-panel] [data-slot]:focus-within .director-slot-remove { opacity: 1; pointer-events: auto; }
    @media (hover: none) {
      [data-director-prompt-panel] .director-slot-remove { opacity: 1; pointer-events: auto; }
    }
    /* 2026-11-04 参数合并：原「合并行窄窗口降级」CSS 随参数收进导轨「参数」按钮组
       （DirectorParamsButton 自带 @container railToolbar 规则），此面板不再有 data-params-run-row。 */
  `, [palette, isDark]);

  const placeholder = t('director.segmentPromptPlaceholder', '片段 {{number}} 提示词，@ 引用资产…', { number: shot.number });

  /** 引导参数 Popover（片段编辑弹层与 `引导 22f ▾` 胶囊共用） */
  const continuityPopoverContent = (
    <div data-director-continuity-popover style={{ width: 240, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 11 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: continuityDisabled ? 0.5 : 1 }}>
        <span style={{ width: 72, color: palette.sub, flexShrink: 0 }}>{t('director.continuityFromPrev', '段间引导')}</span>
        <Checkbox
          data-param-key="continuityFromPrev"
          disabled={continuityDisabled}
          checked={continuityOn}
          onChange={(e) => onShotChange({ continuation: { enabled: e.target.checked } })}
        />
        {continuityDisabled && (
          <span style={{ fontSize: 10, color: palette.sub }}>{t('director.continuityFirstDisabled', '首个片段无前序可引导')}</span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 72, color: palette.sub, flexShrink: 0 }}>{t('director.continuityMode', '引导方式')}</span>
        <Select
          data-param-key="continuityMode"
          size="small"
          value={continuityMode}
          onChange={(v) => setSharedParam('continuityMode', v)}
          options={[
            { value: 'guide', label: 'guide（运动上下文）' },
            { value: 'continue', label: 'continue（引导+重绘）' },
          ]}
          className="director-select"
          popupClassName="director-select-popup"
          style={{ flex: 1, minWidth: 0 }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 72, color: palette.sub, flexShrink: 0 }}>{t('director.continuityOverlap', '上下文帧数')}</span>
        <Select
          data-param-key="continuityOverlapFrames"
          size="small"
          value={overlapFrames}
          onChange={(v) => setSharedParam('continuityOverlapFrames', v)}
          options={CONTINUITY_OVERLAP_OPTIONS.map((n) => ({ value: n, label: `${n} 帧` }))}
          className="director-select"
          popupClassName="director-select-popup"
          style={{ flex: 1, minWidth: 0 }}
        />
      </div>
      {continuityMode === 'continue' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 72, color: palette.sub, flexShrink: 0 }}>{t('director.continuityRedraw', '重绘幅度')}</span>
          <InputNumber
            data-param-key="continuityRedraw"
            size="small"
            value={continuityRedraw}
            min={0} max={0.95} step={0.05}
            onChange={(v) => { if (typeof v === 'number' && Number.isFinite(v)) setSharedParam('continuityRedraw', v); }}
            onBlur={(e) => {
              const n = Number(e.target.value);
              const clamped = Number.isFinite(n) ? Math.min(0.95, Math.max(0, n)) : continuityRedraw;
              if (clamped !== continuityRedraw) setSharedParam('continuityRedraw', clamped);
            }}
            className="director-input-number"
            style={{ flex: 1, minWidth: 0 }}
          />
        </div>
      )}
    </div>
  );

  // 统一控件规格（2026-11-04 红圈重排）：面板内所有胶囊/Select/InputNumber 同高 25、圆角 5-6
  const capsuleStyle = {
    display: 'inline-flex', alignItems: 'center', gap: 4, height: 25, padding: '0 8px',
    borderRadius: 5, background: palette.capsuleBg, color: palette.capsuleText,
    fontSize: 12, border: 'none', cursor: 'pointer', flexShrink: 0,
  } as const;

  /** 镜头跳转胶囊两侧箭头：与 capsuleStyle 同源（25 高 / radius 5 / 深色底），边界禁用 */
  const shotNavButtonStyle = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 22, height: 23, padding: 0, border: 'none', background: 'transparent',
    color: 'inherit', cursor: 'pointer', flexShrink: 0,
  } as const;

  const pickerCandidates = useMemo(() => {
    if (!replaceTarget) return mentionCandidates;
    const target = segmentAssets.find((a) => a.id === replaceTarget);
    if (!target) return mentionCandidates;
    return mentionCandidates.filter((a) => a.data.kind === target.kind && !isDuplicate(a.id));
  }, [replaceTarget, mentionCandidates, segmentAssets, isDuplicate]);

  return (
    <div
      data-director-prompt-panel
      style={{
        flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative',
        background: theme.toolbar.panel ?? (isDark ? '#1e1e20' : '#fafaf7'),
        color: theme.toolbar.text, overflow: 'hidden',
        // 2026-11-05 用户指令：导演台提示词面板需要圆角——与画布外框 / 输入区同源（WORKSPACE_SURFACE_RADIUS），
        // 不再出现直角硬边；overflow:hidden 已保证内部元素跟随裁切。
        borderRadius: WORKSPACE_SURFACE_RADIUS,
        padding: 16,
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <style>{directorCss}</style>

      {/* 2026-11-04 第八/九/十条：原 Row1 标题行整行移除——编号胶囊「片段 N / 分镜 N」均删
          （当前片段靠激活态与上方表格高亮表达）；参数三件套 + 运行组改到提示词输入框正下方
          同一行（见 data-params-run-row），顶部只保留 Tab 行与素材槽位区 */}

      {/* Row2（行高 32）：左「镜头 N · Ns」片段标题（2026-11-05 补回：删页签时误删了标头；
          数据源 = shot.number + shot.duration 现有字段，随选中片段实时变化，空数据给中性文案）；
          右侧元信息胶囊（headerExtra + 时长/引导）。无页签、无公共素材痕迹 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, height: 32, marginBottom: 0, fontSize: 12 }}>
        {/* 2026-11-06 用户指令：标题区加快捷跳转小胶囊（形态复用元信息胶囊：左 < / 镜头 N / M / 右 >，
            边界禁用；序号与总数全部由宿主受控传入，面板内不自建切换状态） */}
        <span
          data-director-shot-nav
          style={{ ...capsuleStyle, padding: 0, gap: 0, cursor: 'default', overflow: 'hidden' }}
        >
          <button
            type="button"
            data-director-shot-prev
            aria-label={t('director.prevShot', '上一个镜头')}
            title={t('director.prevShot', '上一个镜头')}
            disabled={shotIndex <= 0}
            onClick={onPrevShot}
            style={{ ...shotNavButtonStyle, opacity: shotIndex <= 0 ? 0.35 : 1, cursor: shotIndex <= 0 ? 'default' : 'pointer' }}
          >
            <ChevronLeft size={12} />
          </button>
          <span data-director-shot-count style={{ padding: '0 4px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
            {t('director.shotCount', '镜头 {{current}} / {{total}}', { current: shotIndex + 1, total: totalShots })}
          </span>
          <button
            type="button"
            data-director-shot-next
            aria-label={t('director.nextShot', '下一个镜头')}
            title={t('director.nextShot', '下一个镜头')}
            disabled={shotIndex >= totalShots - 1}
            onClick={onNextShot}
            style={{ ...shotNavButtonStyle, opacity: shotIndex >= totalShots - 1 ? 0.35 : 1, cursor: shotIndex >= totalShots - 1 ? 'default' : 'pointer' }}
          >
            <ChevronRight size={12} />
          </button>
        </span>
        <span
          data-director-segment-title
          title={segTitle}
          style={{
            fontSize: 13, fontWeight: 600, color: palette.title,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 1, minWidth: 0,
          }}
        >
          {segTitle}
        </span>
        {/* Row2 右侧：元信息胶囊
            2026-11-04 第八条C（用户更正）：编号胶囊「分镜 N」删除——两种编号标签均不再显示，
            当前片段靠激活态与上方表格高亮表达；「分镜」字样全区域清零 */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Popover
              trigger="click"
              placement="bottomLeft"
              classNames={{ root: 'director-popover' }}
              content={(
                <div data-duration-popover style={{ width: 260, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 11 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <strong
                      data-duration-value
                      style={{
                        fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                        display: 'inline-block', minWidth: 46, whiteSpace: 'nowrap',
                        color: durationOverSec > 0 ? palette.danger : palette.capsuleText,
                      }}
                    >
                      {durationText(shot.duration)}s
                    </strong>
                    <span data-segment-frames style={{ fontSize: 10, color: palette.sub, fontVariantNumeric: 'tabular-nums' }}>
                      {durationToFrames(shot.duration)} 帧
                    </span>
                    <span data-duration-cap style={{ marginLeft: 'auto', fontSize: 10, color: palette.sub }}>
                      {t('director.durationCapHint', '推荐 ≤{{cap}}s', { cap: durationCapSec })}
                    </span>
                  </div>
                  {/* 0–30s 滑动条（超推荐部分走轨道尾段红色提示，拇指同步变 danger）
                      不用 antd Slider：导演台浮层一直靠自家深色 token，原生 range 与导轨缩放滑块同一形态 */}
                  <input
                    type="range"
                    data-duration-range
                    data-param-key="duration_sec"
                    className="director-duration-range"
                    aria-label={t('director.duration', '时长（秒）')}
                    min={DURATION_SLIDER_MIN_SEC}
                    max={durationSliderMax}
                    step={DURATION_SLIDER_STEP_SEC}
                    value={Math.min(shot.duration, durationSliderMax)}
                    data-over-cap={durationOverSec > 0 ? '1' : undefined}
                    onChange={(e) => {
                      // 统一 0.1s 精度：避免浮点小数让下方警告文案忽长忽短、弹层高度跳动
                      const n = Math.round(Number(e.target.value) * 10) / 10;
                      if (Number.isFinite(n)) onShotChange({ duration: Math.max(DURATION_SLIDER_MIN_SEC, n) });
                    }}
                    style={{ width: '100%', ['--dur-cap-pct' as string]: `${Math.min(100, (durationCapSec / durationSliderMax) * 100)}%` } as CSSProperties}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: palette.sub }}>
                    <span>0s</span>
                    <span>{durationSliderMax}s</span>
                  </div>
                  {durationOverSec > 0 && (
                    <div data-duration-warning style={{ fontSize: 11, lineHeight: 1.5, color: palette.danger, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {durationHardOver
                        ? t('director.durationOverFrameCap', '已超单段帧上限 {{max}} 帧（≈{{cap}}s），运行预检会报 frame-overflow', { max: MAX_GEN_FRAMES, cap: durationCapSec })
                        : t('director.durationOverCap', '超出推荐时长 {{over}}s（单段建议 ≤{{cap}}s）', { over: Math.round(durationOverSec * 10) / 10, cap: durationCapSec })}
                    </div>
                  )}
                </div>
              )}
            >
              <button
                type="button"
                data-meta-duration
                data-over-cap={durationOverSec > 0 ? '1' : undefined}
                style={{
                  ...capsuleStyle,
                  // 数值定宽 + 等宽数字：拖动时文案从 5s → 5.3s 不改变胶囊宽度，弹层锚点不漂
                  minWidth: 56, justifyContent: 'center', fontVariantNumeric: 'tabular-nums',
                  color: durationOverSec > 0 ? palette.danger : palette.capsuleText,
                }}
                title={durationOverSec > 0
                  ? t('director.durationOverCapTitle', '时长超出推荐 {{cap}}s，点开查看', { cap: durationCapSec })
                  : t('director.duration', '时长（秒）')}
              >
                {durationText(shot.duration)}s
                <ChevronDown size={8} style={{ opacity: 0.7 }} />
              </button>
            </Popover>
            <Popover trigger="click" placement="bottomLeft" classNames={{ root: 'director-popover' }} content={continuityPopoverContent}>
              <button
                type="button"
                data-meta-continuity
                style={{ ...capsuleStyle, opacity: continuityDisabled ? 0.5 : 1 }}
                title={continuityDisabled ? t('director.continuityFirstDisabled', '首个片段无前序可引导') : t('director.continuityFromPrev', '段间引导')}
              >
                {t('director.continuityCapsule', '引导 {{frames}}f', { frames: overlapFrames })}
                <ChevronDown size={8} style={{ opacity: 0.7 }} />
              </button>
            </Popover>
          </div>
      </div>

      {/* 槽位池（2026-11-05 调整：公共素材 UI 彻底下线，只留一行——所有槽位属于当前片段，
          编号 1..N 连续；无行标签、无编号说明文案、无任何错误徽标）：已填槽位默认只显示缩略/首帧，
          hover 浮出大图（视频可播、音频可控）+名称；常驻加号格（虚线）打开资产选择；点已填槽位 = 替换该槽位 */}
      <div style={{ position: 'relative', flexShrink: 0, marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div data-director-slotpool="segment" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          {renderSlotCells(segmentAssets)}
          <button
            type="button"
            data-asset-add="segment"
            aria-label={t('director.addAsset', '添加素材')}
            title={t('director.addAsset', '添加素材')}
            onClick={() => { setReplaceTarget(null); setAssetPanelOpen((o) => !o); }}
            style={{
              // 2026-11-05 素材插槽放大：加号格与槽位同步 48 → 64
              width: 64, height: 64, borderRadius: 8, flexShrink: 0, cursor: 'pointer',
              border: `1px dashed ${palette.chipBorder}`, background: 'transparent', color: palette.sub,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Plus size={18} />
          </button>
        </div>

        {assetPanelOpen && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 25 }} onMouseDown={() => setAssetPanelOpen(false)} />
            <AssetPickPanel
              candidates={pickerCandidates}
              subjects={subjects ?? []}
              subjectTrees={subjectTrees ?? []}
              episodeContext={episodeContext}
              pooledOrder={pooledOrder}
              slotLabels={slotLabels}
              isDuplicate={isDuplicate}
              isKindFull={isKindFull}
              onPick={(a) => {
                const ref = assetToDirectorRef(a);
                if (!ref) return;
                if (replaceTarget) {
                  if (slotInfo.byAssetId[ref.id]) {
                    message.info(t('director.slotDuplicated', '该资产已在槽位中，请选择其他资产'));
                    return;
                  }
                  replaceSlotAsset(ref);
                } else {
                  pickFromPanel(a);
                }
                setAssetPanelOpen(false);
              }}
              onPickSubject={(item) => {
                const ref = subjectToRef(item);
                if (replaceTarget) {
                  if (slotInfo.byAssetId[ref.id]) {
                    message.info(t('director.slotDuplicated', '该资产已在槽位中，请选择其他资产'));
                    return;
                  }
                  replaceSlotAsset(ref);
                } else {
                  pickSubject(item);
                }
                setAssetPanelOpen(false);
              }}
              onPickSubjectImage={(item, img) => {
                const ref = subjectImageToRef(item, img);
                if (replaceTarget) {
                  if (slotInfo.byAssetId[ref.id]) {
                    message.info(t('director.slotDuplicated', '该资产已在槽位中，请选择其他资产'));
                    return;
                  }
                  replaceSlotAsset(ref);
                } else {
                  pickSubjectImage(item, img);
                }
                setAssetPanelOpen(false);
              }}
              onPickSubjectState={(ref) => {
                if (replaceTarget) {
                  if (slotInfo.byAssetId[ref.id]) {
                    message.info(t('director.slotDuplicated', '该资产已在槽位中，请选择其他资产'));
                    return;
                  }
                  replaceSlotAsset(ref);
                } else {
                  pickSubjectState(ref);
                }
                setAssetPanelOpen(false);
              }}
              onClose={() => setAssetPanelOpen(false)}
              palette={palette}
              t={(key, fallback, opts) => t(key, fallback ?? key, opts)}
              theme={theme}
              onPickAssetFromOpenLib={(a) => {
                /* 开源条目「入库后插入」：与资产条目 onPick 同一执行路径（占槽 + 插 @PictureN 块） */
                const ref = assetToDirectorRef(a);
                if (!ref) return;
                if (replaceTarget) {
                  if (slotInfo.byAssetId[ref.id]) {
                    message.info(t('director.slotDuplicated', '该资产已在槽位中，请选择其他资产'));
                    return;
                  }
                  replaceSlotAsset(ref);
                } else {
                  pickFromPanel(a);
                }
                setAssetPanelOpen(false);
              }}
            />
          </>
        )}
      </div>

      {/* 提示词主体区（固定高 ≥180、细滚动条、@ 行内高亮块与槽位号绑定）。
          2026-11-05 公共提示词层下线 + 公共参数 Tab 删除：编辑器常驻（提示词只属于片段） */}
      <MentionEditor
        ref={editorRef}
        className="director-prompt-input"
        dataAttr="director-prompt-input"
        value={currentPrompt}
        onChange={(v) => setPrompt(v)}
        resolveSlot={resolveSlot}
        placeholder={placeholder}
        minHeight={DIRECTOR_PROMPT_MIN_HEIGHT}
        onMentionTrigger={() => { setReplaceTarget(null); setAssetPanelOpen(true); }}
        // 插槽拖入正文：落点插入 `@Label `（槽位已不在本片段 → 忽略，不插过期引用）
        dropMimeTypes={[DIRECTOR_SLOT_DRAG_MIME]}
        onDropPayload={(mime, raw) => {
          if (mime !== DIRECTOR_SLOT_DRAG_MIME) return null;
          try {
            const p = JSON.parse(raw) as { label?: string; assetId?: string };
            if (!p.assetId) return null;
            const live = slotInfo.byAssetId[p.assetId]?.label ?? p.label;
            if (!live) return null;
            // 模型铁律：mention 序列化形态带尾空格（与 parsePromptSegments / pack.py 一致）
            return `@${live} `;
          } catch {
            return null;
          }
        }}
        style={{
          flex: 1, marginTop: 12, overflowY: 'auto', boxSizing: 'border-box',
          background: 'transparent',
          border: `1px solid ${palette.textareaBorder}`,
          borderRadius: WORKSPACE_SURFACE_RADIUS, padding: 12, fontSize: 13, lineHeight: 1.6,
          color: palette.textareaText, fontFamily: 'inherit',
        }}
      />

      {/* 2026-11-04 参数合并：参数三件套收进导轨「参数」浮层面板（DirectorParamsButton 浮层面板，
          经 multitrack runParamsRow 注入、「批量」附近右对齐）。此面板不再渲染参数行，全界面唯一一份。 */}

    </div>
  );
});
