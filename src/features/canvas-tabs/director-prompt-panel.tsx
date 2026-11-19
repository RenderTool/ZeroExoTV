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
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { App, Checkbox, Dropdown, InputNumber, Popover, Select } from 'antd';
import { ChevronDown, ChevronLeft, ChevronRight, Sparkles, Film, Image as ImageIcon, Music, Plus, Waypoints, X, ArrowLeftRight } from 'lucide-react';
import { buildShotAiBrief } from './shot-ai-brief.js';
import { checkShotPrompt } from '@/features/canvas-nodes/storyboard/shot-quality-check.js';
import { getCurrentCanvasId } from '@/shared/current-canvas-id.js';
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
import { listDeletedKeys } from '@/entities/deleted-asset-tombstones.js';
import { useCanvasTabStore } from '@/features/canvas-tabs/canvas-tab-store.js';
import type { Asset } from '@/features/asset-picker/index.js';
import type { WorkbenchShot, WorkbenchShotReference } from '@/features/canvas-nodes/storyboard/workbench-types.js';
import type { ProductionItem, ProductionItemImage } from '@/features/canvas-nodes/production-manager/production-manager-types.js';
import { resolveSubjectCover } from '@/features/canvas-nodes/production-manager/production-manager-types.js';
import type { SubjectTree } from '@/features/canvas-nodes/storyboard/subject-tree-types.js';
import { SUBJECT_BASE_STATE_ID, subjectBaseCoverKeys } from '@/features/canvas-nodes/storyboard/subject-tree-types.js';
import { MentionEditor, type MentionEditorHandle, type MentionSlotView } from './mention-editor.js';
import { useContext } from 'react';
import { ReactGraphStoreContext } from '@zeroexo/plugin-render-react';
import { ThumbImage } from './thumb-image.js';
import { getGuideMeta } from '@/features/asset-picker/guide.js';
import { isGeneratedAsset } from '@/features/asset-picker/asset-store.js';
import { filterHistoryAssets } from '@/features/canvas-assets/history-utils.js';
import { useCasUpload } from '@/features/canvas-assets/use-cas-upload.js';
import {
  AssetPickPanel,
  DIRECTOR_ASSET_DRAG_MIME,
  useCardPalette,
} from '@/shared/components/asset-pick-panel.js';
import { WORKSPACE_SURFACE_RADIUS } from '@/shared/components/LAYOUT_CONSTANTS.js';

// ===== 资产 → 导演台素材（不变） =====

/**
 * 插槽拖入正文的自定义 MIME（2026-11-05 用户指令）：
 * 把素材池里的插槽拖到提示词输入区的落点 → 自动插入 `@PictureN ` 引用。
 * payload = { label, assetId }；label 以当前槽位映射为准（拖入时重查，防过期槽号）。
 */
export const DIRECTOR_SLOT_DRAG_MIME = 'application/x-director-slot';

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
    origin: r.origin && (r.origin.kind === 'subject-base' || r.origin.kind === 'subject-state') && (r.origin.rootId || r.origin.nodeId)
      ? { kind: r.origin.kind, rootId: r.origin.rootId ?? r.origin.nodeId ?? '', state: r.origin.state, mediaKey: r.origin.mediaKey }
      : undefined,
  };
}

const KIND_ICON = { image: ImageIcon, video: Film, audio: Music } as const;
const KIND_NAME: Record<DirectorAssetRef['kind'], string> = { image: '图片', video: '视频', audio: '音频' };

/** 槽位移除 toast 固定 key（2026-11-04 第十三条）：连续移除时新提示替换旧提示，不堆叠 */
const REMOVE_SLOT_TOAST_KEY = 'director-slot-remove';

/**
 * 主体引用口径（2026-11-18 用户纠正）：主体只是根，本身**不代表任何图片**；
 * 「录入资产默认落基础状态，基础状态就是封面」，所以封面是状态图 / 基础状态这一级的属性，
 * 不是主体这一级的属性。@ 面板点主体只展开状态列表，绝不隐式把封面塞进槽位。
 * 历史 `subject:<id>` 引用仍能解析（见 resolveRefVisual），但新写入一律走 `subject:<id>:<storageKey>`。
 */

/**
 * 引用 → 当前可视资源（唯一解析点，禁止各处各算）：
 * - `subject:<id>`（整主体占槽）→ resolveSubjectCover 回落链（手动 coverKey → 第一张状态图），
 *   补图后自动解析为当前封面，无需重新引用；
 * - 其余引用 → 自身 url / storageKey。
 */
export function resolveRefVisual(
  ref: DirectorAssetRef,
  subjects?: ProductionItem[],
  subjectTrees?: SubjectTree[],
): { url?: string; storageKey?: string; subject?: ProductionItem; stale?: boolean } {
  const treesLoaded = subjectTrees !== undefined;
  /**
   * 2026-11-19 报障：主体被删后重建，itemId 必然变化（时间戳随机），旧引用按 id 查不到就被判失效，
   * 用户视角就是「主体我已经放回去了，插槽还是失效」。所以 id 查不到时按「标题名字/别名」回查一次，
   * 名字命中即视为同一主体（标题形如「霜」「霜-受伤」）。
   */
  const byTitle = (): SubjectTree | undefined => {
    const title = (ref.title ?? '').trim();
    if (!title || !treesLoaded) return undefined;
    return subjectTrees!.find((t) =>
      [t.name, ...(t.aliases ?? [])].some((n) => n && (title === n || title.startsWith(`${n}-`))),
    );
  };
  const findTree = (rootId?: string): SubjectTree | undefined => {
    const byId = rootId
      ? subjectTrees!.find((t) => t.rootId === rootId || t.itemId === rootId)
      : undefined;
    return byId ?? byTitle();
  };
  // 主体来源：按 origin 回查当前树/状态，主体换图后自动用新图
  const origin = ref.origin;
  if (origin && treesLoaded) {
    const tree = findTree(origin.rootId);
    if (!tree) return { stale: true };
    if (origin.kind === 'subject-base') {
      const base = tree.states.find((st) => st.id === SUBJECT_BASE_STATE_ID) ?? tree.states[0];
      // 基础状态没挂图时，主体图可能被挂在「概念/定妆」等状态上：按 origin.mediaKey 回查整棵树，
      // 仍找不到才判失效。不能返回空对象把槽位显示成黑块（用户看到的就是「空素材」）。
      const inBase = base?.media?.find((m) => m.type !== 'audio') ?? base?.media?.[0];
      const byKey = tree.states
        .flatMap((st) => st.media ?? [])
        .find((m) => m.type !== 'audio' && m.key === origin.mediaKey);
      const anyMedia = tree.states.flatMap((st) => st.media ?? []).find((m) => m.type !== 'audio');
      const media = inBase ?? byKey ?? anyMedia;
      return media?.key ? { storageKey: media.key } : { stale: true };
    }
    if (origin.kind === 'subject-state') {
      const originNodeId = (origin as { nodeId?: string }).nodeId;
      const state = originNodeId
        ? tree.states.find((st) => st.id === originNodeId)
        : tree.states.find((st) => st.state === origin.state);
      const inState = state?.media?.find((m) => m.type !== 'audio') ?? state?.media?.[0];
      const byKey = tree.states
        .flatMap((st) => st.media ?? [])
        .find((m) => m.type !== 'audio' && m.key === origin.mediaKey);
      // 2026-11-19 报障：主体图重新生成后落在「基础状态」，旧引用带的是 state='定妆' + 旧 mediaKey，
      // 两个匹配都落空就整排槽位标红「失效」——但用户看到的是图明明已经出好了。
      // 状态名对不上（被重建/合并）时，按该主体当前图回落；只有整棵树一张图都没有才算真失效。
      const matched = inState ?? byKey;
      if (matched?.key) return { storageKey: matched.key };
      if (!state) {
        const current = tree.states.flatMap((st) => st.media ?? []).find((m) => m.type !== 'audio');
        if (current?.key) return { storageKey: current.key };
      }
      return { stale: true };
    }
  }
  // 旧引用没有 origin：按 id 回查主体树当前状态图
  if (ref.id.startsWith('subject-state:')) {
    const parts = ref.id.split(':');
    const itemId = parts[1];
    const oldKey = parts.slice(2).join(':');
    const tree = treesLoaded ? findTree(itemId) : undefined;
    if (tree) {
      const state = tree.states.find((st) => st.media?.some((m) => m.key === oldKey))
        ?? tree.states.find((st) => st.state && ref.title?.endsWith(st.state))
        ?? (ref.title?.endsWith('基础状态') || oldKey === SUBJECT_BASE_STATE_ID ? tree.states[0] : undefined);
      const media = state?.media?.find((m) => m.type !== 'audio') ?? state?.media?.[0];
      if (media?.key) return { storageKey: media.key };
      return {};
    }
    if (treesLoaded) return { stale: true };
  }
  if (ref.id.startsWith('subject:')) {
    const parts = ref.id.split(':');
    const itemId = parts[1];
    const oldKey = parts.slice(2).join(':');
    const tree = treesLoaded ? findTree(itemId) : undefined;
    if (tree) {
      const state = tree.states.find((st) => st.media?.some((m) => m.key === oldKey))
        ?? tree.states.find((st) => st.state && ref.title?.endsWith(st.state))
        ?? tree.states[0];
      const media = state?.media?.find((m) => m.type !== 'audio') ?? state?.media?.[0];
      if (media?.key) return { storageKey: media.key };
      return {};
    }
    if (treesLoaded) return { stale: true };
  }
  const subjectId = parseBareSubjectRef(ref.id);
  if (subjectId) {
    const subject = subjects?.find((s) => s.id === subjectId)
      // 主体重建后 id 变了：按名字回查，保持引用可用
      ?? (treesLoaded ? (() => {
        const tree = byTitle();
        return subjects?.find((s) => tree && (s.id === tree.itemId || s.name === tree.name));
      })() : undefined);
    if (!subject) return treesLoaded ? { stale: true } : {};
    // 2026-11-18：默认基础状态 = 封面；基础状态没图就判失效，不拿别的状态图顶
    const tree = subjectTrees?.find((t) => t.itemId === subjectId || t.rootId === subjectId) ?? (treesLoaded ? byTitle() : undefined);
    const key = resolveSubjectCover(subject, undefined, tree ? subjectBaseCoverKeys(tree) : undefined).key;
    return { storageKey: key ?? undefined, subject };
  }
  return { url: ref.url, storageKey: ref.storageKey };
}

/** 提示词框最小固定高度：内容超出走 overflow-y 滚动，不自动长高、不挤压素材区/预览区 */
export const DIRECTOR_PROMPT_MIN_HEIGHT = 180;


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
  /** 下拉快速跳转到指定镜头（0 基）。缺省不渲染下拉 */
  onJumpShot?: (index: number) => void;
  /** 与指定镜头交换位置（0 基）。缺省不渲染交换入口 */
  onSwapShot?: (index: number) => void;
  /** 镜头标题（下拉菜单展示用），缺省显示「镜头 N」 */
  shotLabels?: string[];
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

/** 主体状态图 → 图片素材（占一个图片槽位，走 assignAssetSlots 唯一编号路径） */
function subjectImageToRef(item: ProductionItem, img: ProductionItemImage, baseKeys?: string[]): DirectorAssetRef {
  const stateName = img.stateTag ?? img.tags[0] ?? '剧照';
  const isCover = resolveSubjectCover(item, undefined, baseKeys).key === img.storageKey;
  return {
    id: `subject:${item.id}:${img.storageKey}`,
    kind: 'image',
    title: `${item.name}·${stateName}${isCover ? '（封面）' : ''}`,
    storageKey: img.storageKey,
    originScope: 'project',
    // 具体状态图必须带来源指纹，删状态/删主体时能精确清掉，且换封面后按 state 回查最新图
    origin: { kind: 'subject-state', rootId: item.id, state: stateName, mediaKey: img.storageKey },
  };
}

export const DirectorPromptPanel = memo(function DirectorPromptPanel({
  shared, onSharedChange, shot, shotIndex, totalShots, onPrevShot, onNextShot, onShotChange,
  onJumpShot, onSwapShot, shotLabels,
  theme, isDark, subjects, subjectTrees, episodeContext,
}: DirectorPromptPanelProps): ReactElement {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [assetPanelOpen, setAssetPanelOpen] = useState(false);
  /** 替换模式：点已填槽位 → 选定后替换该槽位内容（槽位号不变） */
  const [replaceTarget, setReplaceTarget] = useState<string | null>(null);
  const [hoverSlot, setHoverSlot] = useState<string | null>(null);
  /** 视频槽 / 引导槽的「源视频 / 引导」下拉菜单 */
  const [slotMenuId, setSlotMenuId] = useState<string | null>(null);
  const [hoverGuide, setHoverGuide] = useState(false);
  /** 插槽拖拽中：不弹 hover 大图预览（拖拽经过别的槽位时预览会挡住落点） */
  const draggingSlotRef = useRef(false);
  const { assets: allAssets } = useAssets();
  /** 当前项目 id（素材作用域过滤）：project 素材只列本项目，库素材全局可见 */
  const currentProjectId = useCanvasTabStore((s) => s.slotBindings.script);
  const palette = useCardPalette(theme, isDark);
  const editorRef = useRef<MentionEditorHandle>(null);
  /** @ 面板「导入资产」：与素材抽屉同一条 CAS 链（只落 CAS，导入后 useAssets 订阅自动刷新） */
  const uploadAssets = useCasUpload();

  /** 画布页签 = 仅画布上物理存在的媒体节点（连线语义；生成产物统一进「历史」页签，2026-11-16 用户口径） */
  const graphStore = useContext(ReactGraphStoreContext);
  /**
   * 墓碑集合（2026-11-16 用户实测）：画布节点只在节点删除时消失，删资产记录不动节点，
   * 于是「已删除的历史图片」仍会出现在 @ 面板「画布」页签。这里按墓碑键过滤：
   * 内容一旦被用户删除，任何列表（画布/历史/资产）都不再出现它。资产列表变化时刷新集合。
   */
  const [tombstones, setTombstones] = useState<Set<string>>(() => new Set());
  // graph 变更（含删节点）必须让「画布」页签重算：store 是稳定对象，只靠 graphStore 引用做 memo
  // 依赖会一直拿到删除前的旧列表（僵尸节点复现的根因之一）。
  const [graphRev, setGraphRev] = useState(0);
  useEffect(() => {
    const off = graphStore?.subscribeGraph?.(() => setGraphRev((v) => v + 1));
    return off;
  }, [graphStore]);
  useEffect(() => {
    let alive = true;
    void listDeletedKeys().then((keys) => { if (alive) setTombstones(keys); }).catch(() => undefined);
    return () => { alive = false; };
  }, [allAssets]);
  const canvasMedia = useMemo<DirectorAssetRef[]>(() => {
    // 画布页签只认「物理存在」的节点：graph 里被删的节点是 _deleted 墓碑，
    // 不过滤就会把早就删掉的图继续列出来（用户反复报的「僵尸节点」）。
    const nodes = (graphStore?.getGraph?.().nodes ?? []).filter((n) => !(n as { _deleted?: boolean })._deleted);
    const out: DirectorAssetRef[] = [];
    const seen = new Set<string>();
    for (const n of nodes) {
      const d = (n.data ?? {}) as { storageKey?: string; content?: string; url?: string; kind?: string };
      const kind = n.type === 'image' || n.type === 'video' || n.type === 'audio'
        ? n.type
        : d.kind === 'image' || d.kind === 'video' || d.kind === 'audio' ? d.kind : null;
      if (!kind) continue;
      const storageKey = d.storageKey;
      const url = d.content || d.url;
      if (!storageKey && !url) continue;
      if (storageKey && tombstones.has(storageKey)) continue;
      // 同一份 CAS 内容在画布上可能挂在多个节点：画布页签按内容去重，不重复列同一张图
      const dedupeKey = storageKey || url || String(n.id);
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push({
        id: `canvas:${n.id}`,
        kind,
        title: n.title || `${kind === 'video' ? '视频' : kind === 'audio' ? '音频' : '图片'}节点`,
        storageKey,
        url,
        originScope: 'project',
      });
    }
    return out;
  }, [graphStore, tombstones, graphRev]);

  /** 历史页签：画布历史 + 分镜历史（与抽屉历史记录同一条 filterHistoryAssets 链：仅生成产物 + 本项目 + CAS 去重） */
  const historyMedia = useMemo<{ canvas: DirectorAssetRef[]; director: DirectorAssetRef[] }>(() => {
    const toRefs = (source: 'canvas' | 'director'): DirectorAssetRef[] =>
      filterHistoryAssets(allAssets, currentProjectId, 'all', source)
        .filter((a) => {
          const kind = (a.data as { kind?: string }).kind;
          return kind === 'image' || kind === 'video' || kind === 'audio';
        })
        .map((a) => {
          const d = a.data as { storageKey?: string; title?: string; kind?: string };
          const kind = d.kind as DirectorAssetRef['kind'];
          return {
            id: `history:${a.id}`,
            kind,
            title: d.title || a.title || `${kind === 'video' ? '视频' : kind === 'audio' ? '音频' : '图片'}历史`,
            storageKey: d.storageKey,
            url: undefined,
            originScope: 'project' as const,
          };
        });
    return { canvas: toRefs('canvas'), director: toRefs('director') };
  }, [allAssets, currentProjectId]);

  const tier: DirectorModelTier = shared.presetId;
  const caps = DIRECTOR_ASSET_CAPS[tier];

  const mentionCandidates = useMemo(
    () => allAssets.filter((a) => (a.data.kind === 'image' || a.data.kind === 'video' || a.data.kind === 'audio')
      // 2026-11-16 口径：资产页签 = 公共资产（生成产物属历史页签，项目私产不混入）
      && a.scope === 'library'
      && !isGeneratedAsset(a)),
    [allAssets],
  );

  /**
   * 主体素材优先（2026-11-18 用户实测）：同一张 CAS 图同时存在于「主体库」和「资产页」时，
   * 资产页不再重复列出，避免用户点两次把同一张图占成两个槽位。
   */
  const subjectMediaKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const item of subjects ?? []) {
      for (const img of item.images ?? []) if (img.storageKey) keys.add(img.storageKey);
    }
    for (const tree of subjectTrees ?? []) {
      for (const state of tree.states ?? []) {
        for (const media of state.media ?? []) if (media.key) keys.add(media.key);
      }
    }
    return keys;
  }, [subjects, subjectTrees]);

  const segmentAssets = useMemo(() => {
    /**
     * 2026-11-19 报障「一行里塞满重复格、每格都失效」根因：
     * 历史写入把同一个 subject-state 引用追加了两遍（slot 1–4 与 5–8 完全同 id 同 storageKey），
     * 槽位计算按条数分格 → 同一张图占两格，React key 重复还会把悬停预览渲染成叠层。
     * 这里按「id + 媒体键」去重，只保留第一次出现的格（槽号以首条为准）。
     */
    const seen = new Set<string>();
    return (shot.references ?? [])
      .map(shotRefToDirectorRef)
      .filter((r): r is DirectorAssetRef => r !== null)
      .filter((r) => {
        const k = `${r.id}|${r.storageKey ?? r.url ?? ''}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
  }, [shot.references]);
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
    const visual = resolveRefVisual(ref, subjects, subjectTrees);
    return { label, title: ref.title ?? ref.id, kind: ref.kind, url: visual.url, storageKey: visual.storageKey };
  }, [slotInfo, segmentAssets, subjects, subjectTrees]);

  const persistRef = useCallback((ref: DirectorAssetRef) => {
    /**
     * 2026-11-19 报障「插槽已修复，提示词里还是失效」根因之一：
     * 外部送来的引用自带 `slotNo`（素材抽屉/画布侧的全局序号，可能是 3、5），直接钉进本镜头会留下空洞
     * （实测镜头 2 的图片槽 = 1/3/5），提示词里早写好的 `@Picture2` 找不到槽 → 显示「失效」，
     * `@Picture3` 还会指到第 2 张上传图（成片与提示词错位）。
     * 现在新增槽位一律按「该类最小空号」重新分配，外部 slotNo 只当顺序参考，不直接落库。
     */
    let slotNo = ref.slotNo;
    try {
      const trial = assignAssetSlots({ shared: [], segment: [...segmentAssets, { ...ref, slotNo: undefined }], tier });
      slotNo = trial.byAssetId[ref.id]?.slot ?? slotNo;
    } catch {
      // 溢出/异常时保留原值，由调用方（insertRef）负责提示
    }
    const shotRef: WorkbenchShotReference = {
      id: ref.id, kind: ref.kind, title: ref.title, storageKey: ref.storageKey, url: ref.url,
    };
    (shotRef as WorkbenchShotReference & { originScope?: string }).originScope = ref.originScope;
    shotRef.origin = ref.origin;
    shotRef.slotNo = slotNo;
    onShotChange({ references: [...(shot.references ?? []), shotRef] });
  }, [shot.references, onShotChange, segmentAssets, tier]);

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
    // 同一张图（同 storageKey）已经在别的槽位 → 直接用那个槽号，不再新占一格。
    // 主体库图与资产页裸图 id 不同，但内容相同；不按内容去重就会出现「同图两个插槽」。
    const sameContent = ref.storageKey
      ? segmentAssets.find((a) => a.storageKey === ref.storageKey && resolveRefVisual(a, subjects, subjectTrees).stale !== true)
      : undefined;
    if (sameContent) {
      const label = slotInfo.byAssetId[sameContent.id];
      if (label) {
        editorRef.current?.insertAtCaret(`@${label} `);
        message.info(t('director.slotSameContent', '这张图已在 {{slot}}，直接复用该槽位', { slot: label }));
        return;
      }
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
  }, [segmentAssets, tier, slotInfo, kindUsed, caps, persistRef, message, t, subjects, subjectTrees]);

  /** 替换槽位：同位置替换（槽位号、顺序、所有 @ 引用自动跟新资产；pin 保留原槽号） */
  const replaceSlotAssetAt = useCallback((targetId: string, newRef: DirectorAssetRef) => {
    const pinned: DirectorAssetRef = {
      ...newRef,
      // 替换永远沿用被替换槽的槽号（新素材自带的 slotNo 是外部序号，不能顶掉原位置，
      // 否则提示词 @PictureN 与新位置错位）
      slotNo: slotInfo.byAssetId[targetId]?.slot ?? newRef.slotNo,
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

  /**
   * 面板选中 → 写入（唯一落库分流点）：
   * 替换模式 = 同位置替换（重复引用先拦下），否则走 insertRef（占槽 + 插 @ 引用）；面板统一关闭。
   */
  const handlePanelPick = useCallback((ref: DirectorAssetRef) => {
    if (replaceTarget) {
      if (slotInfo.byAssetId[ref.id]) {
        message.info(t('director.slotDuplicated', '该资产已在槽位中，请选择其他资产'));
        return;
      }
      const sameContent = ref.storageKey
        ? segmentAssets.find((a) => a.id !== replaceTarget && a.storageKey === ref.storageKey)
        : undefined;
      if (sameContent) {
        const label = slotInfo.byAssetId[sameContent.id] ?? '';
        message.info(t('director.slotSameContent', '这张图已在 {{slot}}，同一张图不能占两个槽位', { slot: label }));
        return;
      }
      replaceSlotAsset(ref);
    } else {
      insertRef(ref);
    }
    setAssetPanelOpen(false);
  }, [replaceTarget, slotInfo, segmentAssets, message, t, replaceSlotAsset, insertRef]);

  /**
   * 槽位移除：只解引用（资产仍在项目库/公共库）。
   * 2026-11-17 用户最终口径：提示词里的 @ 块**保留为占位**（不降级成文本），
   * 用户把同一槽位重新填上素材就自动关联回来；直接发任务时按 `@名称` 文本参与生成。
   */
  const removeAsset = useCallback((assetId: string) => {
    onShotChange({
      references: (shot.references ?? []).filter((r) => r.id !== assetId),
    });
  }, [shot.references, onShotChange]);

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
    const visual = resolveRefVisual(a, subjects, subjectTrees);
    const isStale = visual.stale === true;
    const guide = a.kind === 'video' ? guideMetaOfRef(a) : undefined;
    return (
      <span
        key={a.id}
        data-slot={slot?.label}
        data-slot-filled={a.id}
        data-slot-stale={isStale ? '1' : undefined}
        title={isStale ? t('director.refStale', '引用已失效：原主体或状态已删除') : undefined}
        onClick={() => { setReplaceTarget(a.id); setAssetPanelOpen(true); }}
        onPointerDown={(e) => e.stopPropagation()}
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
          draggingSlotRef.current = false;
        }}
        onMouseEnter={() => { if (draggingSlotRef.current) return; setHoverSlot(a.id); }}
        onMouseLeave={() => setHoverSlot((cur) => (cur === a.id ? null : cur))}
        // 2026-11-05 用户指令：插槽可拖进提示词正文（落点自动补 @引用）；无槽号（异常态）不可拖
        draggable={!!slot}
        onDragStart={(e) => {
          if (!slot) return;
          e.stopPropagation();
          draggingSlotRef.current = true;
          setHoverSlot(null);
          // copyMove：拖进提示词=copy、拖到另一个插槽=move（互换）；只允许 copy 会让 move 落点被浏览器拒绝
          e.dataTransfer.effectAllowed = 'copyMove';
          e.dataTransfer.setData(DIRECTOR_SLOT_DRAG_MIME, JSON.stringify({ label: slot.label, assetId: a.id }));
        }}
        onDragEnd={() => { draggingSlotRef.current = false; }}
        style={{
          position: 'relative', width: 64, height: 64, borderRadius: 8, flexShrink: 0,
          border: `1px ${isStale ? 'dashed' : 'solid'} ${isStale ? palette.danger : palette.chipBorder}`,
          background: palette.chipBg,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        }}
      >
        {/* 素材类型标签（视频 / 图片 / 音频）：槽位必须一眼看出类型 */}
        <span
          data-slot-kind={a.kind}
          style={{
            position: 'absolute', top: 3, left: 3, zIndex: 3, height: 14, padding: '0 3px',
            borderRadius: 3, background: 'rgba(0,0,0,0.65)', color: '#fff',
            fontSize: 9, lineHeight: '14px', fontWeight: 500,
          }}
        >
          {KIND_NAME[a.kind]}
        </span>
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
        {isStale && (
          <span
            data-slot-stale-label={a.id}
            style={{
              position: 'absolute', left: 3, bottom: 3, zIndex: 3,
              padding: '0 4px', height: 14, borderRadius: 3,
              background: palette.danger, color: '#fff',
              fontSize: 9, lineHeight: '14px', fontWeight: 600, pointerEvents: 'none',
            }}
          >
            {t('director.refStaleShort', '失效')}
          </span>
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
        {guide && (
          <Dropdown
            open={slotMenuId === a.id}
            onOpenChange={(open) => setSlotMenuId(open ? a.id : null)}
            menu={{
              items: [
                { key: 'source', label: t('director.useSourceVideo', '使用源视频'), disabled: true },
                {
                  key: 'guide',
                  icon: <Waypoints size={13} />,
                  label: t('director.useGuide', '使用引导'),
                  onClick: () => useGuideFromVideo(a),
                },
              ],
            }}
          >
            <button
              type="button"
              data-slot-variant-menu={a.id}
              aria-label={t('director.videoVariant', '切换源视频 / 引导')}
              title={t('director.videoVariant', '切换源视频 / 引导')}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); setSlotMenuId(a.id); }}
              style={{
                position: 'absolute', left: 3, bottom: 3, zIndex: 4, width: 16, height: 16, padding: 0,
                borderRadius: 4, border: 'none', background: 'rgba(0,0,0,0.65)', color: '#fff',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              }}
            >
              <ChevronDown size={10} />
            </button>
          </Dropdown>
        )}
        {hoverSlot === a.id && (
          /**
           * 2026-11-19 报障「悬停出现多重预览图」：
           * 旧实现是一张 200 宽的大卡（外层卡 + 内层 184×120 空图占位 + 槽格自身占位），
           * 引用失效时三层灰底大图标叠在一起，看起来像好几个面板。
           * 现在只输出一张矮行卡（48 缩略 + 两行文字），无论成功/失效都只有这一个容器、一个缩略位。
           */
          <span
            data-slot-preview
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 40, width: 232,
              background: palette.popBg, border: `1px solid ${isStale ? palette.danger : palette.popBorder}`,
              borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.45)', padding: 8, cursor: 'default',
              display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
            }}
          >
            {/* 单缩略位：图片/视频取同一档，音频 48 高内放控件；失效时只给图标，不再套第二层占位盒 */}
            {visual.storageKey || visual.url ? (
              <ThumbImage
                kind={a.kind}
                playable
                storageKey={visual.storageKey}
                url={visual.url}
                prefer={a.kind === 'image' ? 'preview' : 'thumb'}
                width={a.kind === 'audio' ? 96 : 48} height={a.kind === 'audio' ? 32 : 48} radius={6}
                title={a.title ?? a.id}
                icon={<Icon size={16} style={{ opacity: 0.6 }} />}
              />
            ) : (
              <span
                style={{
                  width: 48, height: 48, borderRadius: 6, flexShrink: 0,
                  border: `1px dashed ${isStale ? palette.danger : palette.chipBorder}`,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Icon size={16} style={{ opacity: 0.6 }} />
              </span>
            )}
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 12, color: palette.capsuleText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {a.title ?? a.id}
              </span>
              <span style={{ fontSize: 10, color: isStale ? palette.danger : palette.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {isStale
                  ? t('director.refStale', '引用已失效：原主体或状态已删除')
                  : (slot?.label ?? '')}
              </span>
            </span>
            <button
              type="button"
              data-slot-remove
              onClick={(e) => { e.stopPropagation(); setHoverSlot(null); requestRemoveAsset(a.id); }}
              style={{ flexShrink: 0, border: 'none', borderRadius: 4, background: 'transparent', color: palette.sub, cursor: 'pointer', fontSize: 11, padding: '2px 4px' }}
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
  const continuityMode = String(shared.params['continuityMode'] ?? 'continue');
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

  /** @ 面板资产候选：资产库 → 素材引用（唯一映射）；替换模式只列同类型且未在其它槽位的资产 */
  const candidateRefs = useMemo(
    () => mentionCandidates
      .map(assetToDirectorRef)
      .filter((r): r is DirectorAssetRef => r !== null)
      // 主体库已有同内容图 → 资产页不再列，统一从「主体」页签取（带来源指纹，可自动跟随换图）
      .filter((r) => !r.storageKey || !subjectMediaKeys.has(r.storageKey)),
    [mentionCandidates, subjectMediaKeys],
  );
  const pickerCandidates = useMemo(() => {
    if (!replaceTarget) return candidateRefs;
    const target = segmentAssets.find((a) => a.id === replaceTarget);
    if (!target) return candidateRefs;
    return candidateRefs.filter((r) => r.kind === target.kind && !isDuplicate(r.id));
  }, [replaceTarget, candidateRefs, segmentAssets, isDuplicate]);

  /** 点已填插槽打开面板时，定位到该插槽当前主体（用户可直接切该主体的其它状态） */
  const focusSubjectId = useMemo(() => {
    const ref = replaceTarget ? segmentAssets.find((a) => a.id === replaceTarget) : undefined;
    if (!ref) return undefined;
    if (ref.origin?.rootId) return ref.origin.rootId;
    if (ref.id.startsWith('subject-state:')) return ref.id.split(':')[1];
    if (ref.id.startsWith('subject:')) return ref.id.split(':')[1];
    return undefined;
  }, [replaceTarget, segmentAssets]);

  /** 引导是视频槽的变体：同一格在「源视频 / 引导」间切换，不另开独立素材列表 */
  const assetById = useMemo(() => new Map(allAssets.map((a) => [a.id, a])), [allAssets]);
  const guideMetaOfRef = useCallback((ref: DirectorAssetRef) => {
    const asset = assetById.get(ref.id);
    return asset ? getGuideMeta(asset.data) : undefined;
  }, [assetById]);

  const useGuideFromVideo = useCallback((ref: DirectorAssetRef): void => {
    const asset = assetById.get(ref.id);
    const g = asset ? getGuideMeta(asset.data) : undefined;
    if (!g?.id) {
      message.warning(t('assetLibrary.guideMissing', '该视频没有引导'));
      return;
    }
    onShotChange({
      references: (shot.references ?? []).filter((r) => r.id !== ref.id),
      guide: {
        id: g.id,
        title: ref.title,
        frames: g.frames,
        sha256: g.sha256,
        fromAssetId: ref.id,
        storageKey: ref.storageKey,
        url: ref.url,
        createdAt: new Date().toISOString(),
      },
    });
    setSlotMenuId(null);
  }, [assetById, message, onShotChange, shot.references, t]);

  const useSourceFromGuide = useCallback((): void => {
    const g = shot.guide;
    if (!g) return;
    const refs = shot.references ?? [];
    const existingRef = segmentAssets.find((r) => r.id === g.fromAssetId);
    const ref: DirectorAssetRef = existingRef ?? {
      id: g.fromAssetId ?? `guide-src:${g.id}`,
      kind: 'video',
      title: g.title,
      storageKey: g.storageKey,
      url: g.url,
    };
    onShotChange({
      guide: undefined,
      references: existingRef ? refs : [...refs, ref as unknown as WorkbenchShotReference],
    });
    setSlotMenuId(null);
  }, [onShotChange, shot.guide, shot.references]);

  /** 同一个视频的引导槽不能和源视频槽同时显示（同一格切换） */
  const visibleSegmentAssets = useMemo(
    () => (shot.guide?.fromAssetId
      ? segmentAssets.filter((a) => a.id !== shot.guide?.fromAssetId)
      : segmentAssets),
    [segmentAssets, shot.guide?.fromAssetId],
  );

  /** 分镜质量闸门（2026-11-19）：提示词 @引用 与槽位必须对得上，error 会阻止生成 */
  const qualityIssues = useMemo(
    () => checkShotPrompt({ imagePrompt: shot.imagePrompt, references: visibleSegmentAssets }),
    [shot.imagePrompt, visibleSegmentAssets],
  );
  const qualityErrors = qualityIssues.filter((i) => i.level === 'error');

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
            {onJumpShot ? (
              /* 2026-11-10 用户要求：镜头号做成下拉，可直接跳到任意片段（36 段时箭头太慢） */
              <Dropdown
                trigger={['click']}
                menu={{
                  style: { maxHeight: 320, overflowY: 'auto', minWidth: 150 },
                  items: Array.from({ length: totalShots }, (_, i) => ({
                    key: String(i),
                    label: `${t('director.shotN', '镜头 {{n}}', { n: i + 1 })}${shotLabels?.[i] ? ` · ${shotLabels[i]}` : ''}`,
                    onClick: () => onJumpShot(i),
                  })),
                }}
              >
                <button
                  type="button"
                  data-director-shot-jump
                  title={t('director.jumpShot', '快速跳转镜头')}
                  style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', padding: '0 2px', font: 'inherit', fontVariantNumeric: 'tabular-nums', display: 'inline-flex', alignItems: 'center', gap: 2 }}
                >
                  {t('director.shotCount', '镜头 {{current}} / {{total}}', { current: shotIndex + 1, total: totalShots })}
                  <ChevronDown size={10} />
                </button>
              </Dropdown>
            ) : (
              t('director.shotCount', '镜头 {{current}} / {{total}}', { current: shotIndex + 1, total: totalShots })
            )}
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
        {/* 2026-11-10：选中片段与其他片段交换位置（两段互换，编号随位置重排） */}
        {onSwapShot && totalShots > 1 ? (
          <Dropdown
            trigger={['click']}
            menu={{
              style: { maxHeight: 320, overflowY: 'auto', minWidth: 150 },
              items: Array.from({ length: totalShots }, (_, i) => ({
                key: String(i),
                disabled: i === shotIndex,
                label: t('director.swapWithShot', '与镜头 {{n}} 交换', { n: i + 1 }),
                onClick: () => onSwapShot(i),
              })),
            }}
          >
            <button
              type="button"
              data-director-swap-shot
              aria-label={t('director.swapShot', '交换片段位置')}
              title={t('director.swapShot', '交换片段位置')}
              style={{ ...shotNavButtonStyle, padding: '0 6px' }}
            >
              <ArrowLeftRight size={12} />
            </button>
          </Dropdown>
        ) : null}
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
        {qualityIssues.length ? (
          <Popover
            trigger="hover"
            placement="bottomLeft"
            classNames={{ root: 'director-popover' }}
            content={(
              <div data-shot-quality-panel style={{ width: 300, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11 }}>
                <strong>分镜质量检查</strong>
                {qualityIssues.map((q, i) => (
                  <span key={`${q.code}-${i}`} style={{ color: q.level === 'error' ? palette.danger : palette.sub, lineHeight: 1.6 }}>
                    {q.level === 'error' ? '错误：' : '提示：'}{q.message}
                  </span>
                ))}
              </div>
            )}
          >
            <span
              data-shot-quality-badge
              style={{
                flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 3, height: 18, padding: '0 6px',
                borderRadius: 4, fontSize: 10, cursor: 'default',
                background: qualityErrors.length ? palette.danger : 'rgba(245,158,11,0.18)',
                color: qualityErrors.length ? '#fff' : '#f59e0b',
              }}
            >
              {qualityErrors.length ? `质量 ${qualityErrors.length}` : `提示 ${qualityIssues.length}`}
            </span>
          </Popover>
        ) : null}
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
            {/* 问AI：复制当前镜头信息（项目 + shotId + 提示词 + 参数），粘给任意 Agent 即可定位到这一段 */}
            <button
              type="button"
              data-ask-ai
              style={{ ...capsuleStyle, gap: 4 }}
              title={t('director.askAiTitle', '复制当前镜头信息，粘给 AI 后可直接定位到这一段')}
              aria-label={t('director.askAi', '问AI')}
              onClick={() => {
                const brief = buildShotAiBrief({
                  projectId: getCurrentCanvasId() ?? '',
                  shot,
                  shotIndex,
                  totalShots,
                  shared,
                });
                void navigator.clipboard.writeText(brief)
                  .then(() => message.success(t('director.askAiCopied', '已复制镜头信息，粘贴给 AI 即可')))
                  .catch(() => message.error(t('director.askAiFailed', '复制失败，请手动选择复制')));
              }}
            >
              <Sparkles size={10} />
              {t('director.askAi', '问AI')}
            </button>
          </div>
      </div>

      {/* 槽位池（2026-11-05 调整：公共素材 UI 彻底下线，只留一行——所有槽位属于当前片段，
          编号 1..N 连续；无行标签、无编号说明文案、无任何错误徽标）：已填槽位默认只显示缩略/首帧，
          hover 浮出大图（视频可播、音频可控）+名称；常驻加号格（虚线）打开资产选择；点已填槽位 = 替换该槽位 */}
      <div style={{ position: 'relative', flexShrink: 0, marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div data-director-slotpool="segment" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          {renderSlotCells(visibleSegmentAssets)}
          {shot.guide && (
            <span
              data-guide-slot={shot.guide.id}
              data-guide-title={shot.guide.title ?? ''}
              title={`${shot.guide.title ?? t('director.guideBadge', '引导')}${shot.guide.frames ? ` · ${t('director.guideFrames', '{{n}} 帧', { n: shot.guide.frames })}` : ''}`}
              onMouseEnter={() => setHoverGuide(true)}
              onMouseLeave={() => setHoverGuide(false)}
              style={{
                position: 'relative', width: 64, height: 64, borderRadius: 8, flexShrink: 0,
                border: `1px solid ${palette.brand}`, background: palette.chipBg,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'visible',
              }}
            >
              <ThumbImage
                kind="video"
                storageKey={shot.guide.storageKey}
                url={shot.guide.url}
                width={64}
                height={64}
                radius={8}
                title={shot.guide.title}
                icon={<Waypoints size={20} style={{ opacity: 0.75 }} />}
              />
              <span
                data-slot-kind="guide"
                style={{
                  position: 'absolute', top: 3, left: 3, zIndex: 3, height: 14, padding: '0 3px',
                  borderRadius: 3, background: palette.brand, color: '#fff',
                  fontSize: 9, lineHeight: '14px', fontWeight: 600,
                  display: 'inline-flex', alignItems: 'center', gap: 2,
                }}
              >
                <Waypoints size={8} />
                {t('director.guideBadge', '引导')}
              </span>
              {shot.guide.frames ? (
                <span style={{ position: 'absolute', right: 3, bottom: 3, zIndex: 3, height: 14, padding: '0 3px', borderRadius: 3, fontSize: 9, lineHeight: '14px', background: 'rgba(0,0,0,0.65)', color: '#fff' }}>
                  {shot.guide.frames}f
                </span>
              ) : null}
              <Dropdown
                open={slotMenuId === '__guide__'}
                onOpenChange={(open) => setSlotMenuId(open ? '__guide__' : null)}
                menu={{
                  items: [
                    {
                      key: 'source',
                      icon: <Film size={13} />,
                      label: t('director.useSourceVideo', '使用源视频'),
                      onClick: useSourceFromGuide,
                    },
                    { key: 'guide', icon: <Waypoints size={13} />, label: t('director.useGuide', '使用引导'), disabled: true },
                  ],
                }}
              >
                <button
                  type="button"
                  data-guide-variant-menu={shot.guide.id}
                  aria-label={t('director.videoVariant', '切换源视频 / 引导')}
                  title={t('director.videoVariant', '切换源视频 / 引导')}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); setSlotMenuId('__guide__'); }}
                  style={{
                    position: 'absolute', left: 3, bottom: 3, zIndex: 4, width: 16, height: 16, padding: 0,
                    borderRadius: 4, border: 'none', background: 'rgba(0,0,0,0.65)', color: '#fff',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                  }}
                >
                  <ChevronDown size={10} />
                </button>
              </Dropdown>
              <button
                type="button"
                className="director-slot-remove"
                data-guide-x={shot.guide.id}
                aria-label={t('director.guideRemove', '移除引导')}
                title={t('director.guideRemove', '移除引导')}
                onClick={(e) => { e.stopPropagation(); onShotChange({ guide: undefined }); }}
                style={{
                  position: 'absolute', top: 2, right: 2, width: 18, height: 18, padding: 0, zIndex: 10,
                  borderRadius: '50%', border: `1px solid ${palette.popBorder}`, background: palette.popBg,
                  color: palette.sub, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <X size={11} />
              </button>
              {hoverGuide && (
                <span
                  data-guide-preview
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 41, width: 200,
                    background: palette.popBg, border: `1px solid ${palette.popBorder}`, borderRadius: 8,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.45)', padding: 8, cursor: 'default',
                    display: 'flex', flexDirection: 'column', gap: 6, textAlign: 'left',
                  }}
                >
                  <ThumbImage
                    kind="video"
                    playable
                    storageKey={shot.guide.storageKey}
                    url={shot.guide.url}
                    prefer="thumb"
                    width={184}
                    height={120}
                    radius={8}
                    title={shot.guide.title}
                    icon={<Waypoints size={26} style={{ opacity: 0.6 }} />}
                  />
                  <span style={{ fontSize: 12, color: palette.capsuleText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {shot.guide.title ?? t('director.guideBadge', '引导')}
                  </span>
                  <span style={{ fontSize: 10, color: palette.sub }}>
                    {t('director.guideBadge', '引导')}{shot.guide.frames ? ` · ${shot.guide.frames}f` : ''}
                  </span>
                  <button
                    type="button"
                    data-guide-remove-visible
                    onClick={(e) => { e.stopPropagation(); setHoverGuide(false); onShotChange({ guide: undefined }); }}
                    style={{
                      alignSelf: 'flex-start', height: 24, padding: '0 8px', borderRadius: 5,
                      border: `1px solid ${palette.popBorder}`, background: 'transparent',
                      color: palette.sub, fontSize: 11, cursor: 'pointer',
                    }}
                  >
                    {t('director.guideRemove', '移除引导')}
                  </button>
                </span>
              )}
            </span>
          )}
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
              canvasMedia={canvasMedia}
              historyMedia={historyMedia}
              initialTab="subject"
              focusSubjectId={focusSubjectId}
              subjects={subjects ?? []}
              subjectTrees={subjectTrees ?? []}
              episodeContext={episodeContext}
              pooledOrder={pooledOrder}
              slotLabels={slotLabels}
              isDuplicate={isDuplicate}
              isKindFull={isKindFull}
              onPickAsset={handlePanelPick}
              onPickCanvasMedia={handlePanelPick}
              onPickSubjectImage={(item, img) => {
                const tree = subjectTrees?.find((t) => t.itemId === item.id || t.rootId === item.id);
                handlePanelPick(subjectImageToRef(item, img, tree ? subjectBaseCoverKeys(tree) : undefined));
              }}
              onPickSubjectState={handlePanelPick}
              onClose={() => setAssetPanelOpen(false)}
              onUploadFiles={(files) => { void uploadAssets(files); }}
              palette={palette}
              t={(key, fallback, opts) => t(key, fallback ?? key, opts)}
              theme={theme}
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
