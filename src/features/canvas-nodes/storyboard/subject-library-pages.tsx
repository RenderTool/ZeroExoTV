/**
 * subject-library-pages - 主体库页面化（2026-11-05 约定）
 *
 * 两级整页（替换原「列表 → 单树弹层」）：
 * 1. 主体库列表页：搜索 + 类型 Tab + 主体卡网格；
 * 2. 主体状态页：面包屑「主体库 / 主体名」，状态卡网格（基础状态 + states[]）。
 *    **所有编辑都在这一页的状态卡上完成，不再有第三个整页**：
 *    - 双击状态名改名；星标设封面；换图；删除；画布生成（只挂提示词、不发起 API）；
 *    - 点卡或「编辑」按钮 → 卡片内展开编辑面板（StateEditPanel）：
 *      状态名 / 提示词文本块 / 出现集数（一个按钮点开下拉列表）/ 媒体与历史图。
 *    - 面包屑第三级只是「当前正在编辑的状态」指示，不代表又进了一层页面。
 *
 * 2026-11-12 方案演进：独立状态编辑页 → 同页右栏检查器（抽屉里挤成一列，作废）
 * → 恢复独立整页（作废）→ **最终定为卡片内编辑面板**。
 * level 的 'state' 保留为「哪张卡在编辑」，用于层级记忆、前进/后退、navigate 定位、
 * 资产发送直达上下文；UI 上不再对应任何新页面。
 * UI 文案一律客户口吻，禁止出现 API / 自动跑 / 内部实现说明（可写在代码注释里）。
 *
 * 视觉口径（project-rules/specs/subject-library-ui/spec.md，2026-11-05 UI 重新设计）：
 * - 唯一强调色 = theme.toolbar.accent；主体库全量禁用绿色；
 * - 卡片走 @/shared/ui（CardShell / Badge / IconButton + 文本 token），与资产卡同一取值源；
 * - 工具栏与表单走 antd（Input / Button / TextArea / Checkbox / Dropdown / Tooltip）；
 * - 两级整页共用一个页头：面包屑 + 计数徽标 + 右侧主操作。
 *
 * 约束：
 * - 只改主体库这一块；旧单树弹层保留在 StoryboardSubjectTab 的非 pages 模式（分镜全屏编辑器）；
 * - 媒体写入统一走 linkSubjectStateMedia，不另造写入路径；
 * - 编辑即写回（onChangeTree），返回/刷新不丢草稿；
 * - 层级按项目记忆（view-prefs.subjectPages），popstate 还原层级。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { App as AntdApp, Button, Checkbox, Dropdown, Input, Popover, Tooltip } from 'antd';
import {
  ArrowLeft,
  Check, CheckSquare, ChevronDown, ChevronRight, Image as ImageIcon, ImagePlus, MapPin, Package, Pencil, Plus, Search,
  Shapes, Square, Star, Trash2, UserRound, Wand2, X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
// 抽屉内（embedded）主体库与素材/开源分段共用同一套工具栏控件（分类 chips + 搜索框 + 底端虚线新建格），
// 禁止在主体库自造一套搜索/筛选/新建样式（2026-11-05 用户纠正）
import { AddTile, CategoryChips, SCROLL_AREA_STYLE, SearchBox, ToolbarRow } from '@/features/canvas-assets/components/common.js';
// 批量编辑：多选框与资产库同一实现（同一尺寸/颜色/位置，不自造一套）
import { MultiSelectCheckbox } from '@/features/asset-library/components/multi-select-checkbox.js';
import {
  Badge,
  CardShell,
  IconButton,
  UI_CARD_GAP,
  UI_CARD_HOVER_OVERLAY,
  UI_CARD_INFO_PADDING_X,
  uiCardMetaStyle,
  uiCardNameStyle,
  ThumbBadge,
} from '@/shared/ui/index.js';
// 2026-11-05 用户指令：主体列表与资产列表共用同一套弹性排列规则（列数 = 实测容器宽度取断点，
// 封面高度 = 列宽 / 真实宽高比并夹在 [0.75, 1.9]×列宽）——直接复用共享瀑布流，不再自写网格。
import {
} from '@/shared/components/masonry-grid.js';
import { useViewPrefsStore } from '@/shared/view-prefs.js';
import { nodeActionBus } from '@zeroexo/plugin-nodes';
import { readStoryboardContainer } from '@/entities/slot-containers.js';
import { readScript, watchScript, displayEpisodeTitle } from '@/entities/script-store.js';
import {
  NAVIGATE_FOCUS_SUBJECT_EVENT,
  takePendingNavigateFocus,
} from '@/features/canvas-tabs/navigate-to-view.js';
import { resolveSubjectCover } from '../production-manager/production-manager-types';
import type { ProductionItem, ProductionItemKind } from '../production-manager/production-manager-types';
import {
  buildDefaultStateName,
  createSubjectNode,
  createSubjectTree,
  findItemForTree,
  findTreeForItem,
  firstCoverMediaKeyOfState,
  nextStateStep,
  nonBaseStates,
  subjectCoverCandidates,
  type SubjectNodeMediaRef,
  type SubjectTreeNode,
  type SubjectTree,
} from './subject-tree-types';
import { buildBaseStatePrompt } from './subject-prompt-templates';
import {
  deleteSubjectHistoryMedia,
  linkSubjectStateMedia,
  releaseSubjectStateMediaRefs,
  useSubjectMediaLinkEventStore,
  type SubjectStateMediaAsset,
} from './subject-state-media';
import { SubjectMediaSourcePanel } from './subject-media-source-panel';
import { SubjectMediaThumb, useSubjectMediaAlive } from './subject-media-preview';
import {
  SUBJECT_STATE_CARD_GAP,
  SUBJECT_STATE_CARD_MIN_WIDTH,
} from './subject-card-metrics';
import {
  SUBJECT_BASE_STATE_ID,
  SUBJECT_PAGE_HISTORY_KEY,
  clearCurrentSubjectStateContext,
  levelToMarker,
  markerToLevel,
  readRememberedSubjectLevel,
  rememberSubjectLevel,
  setCurrentSubjectStateContext,
  type SubjectPageHistoryMarker,
  type SubjectPageLevel,
} from './subject-page-nav';

const BASE_BALL = '基础状态';

/** 页边距：整页 clamp 16–24；抽屉内 20（2026-11-05 用户指令：与素材分段同一 inset，不再 16） */
const PAGE_PAD = 'clamp(16px, 3vw, 24px)';
const PAGE_PAD_EMBEDDED = 20;
/** 列表/编辑页内容宽 1200；状态卡网格放宽到 1920（1920 视口排得下 6 列） */
const LIST_MAX_WIDTH = 1200;
const STATE_MAX_WIDTH = 1920;

export interface SubjectLibraryPagesProps {
  productionItems: ProductionItem[];
  theme: ThemeConfig;
  projectId?: string | null;
  onUpdateItem?: (itemId: string, patch: Partial<ProductionItem>) => void;
  onDeleteItem?: (itemId: string) => void;
  /**
   * 批量写回（2026-11-06 批量编辑）：宿主有单笔容器写 API 时传入，
   * N 个主体 = 1 次版本递增 + 1 份快照；缺省则退回循环单条写（串行锁保证正确，只是版本会跳 N 次）。
   */
  onUpdateItems?: (itemIds: readonly string[], patch: Partial<ProductionItem>) => void;
  onDeleteItems?: (itemIds: readonly string[]) => void;
  /** 列表页主操作「添加主体」（由外层页签接线；零主体空态由外层页头承担） */
  onAddSubject?: () => void;
  subjectTree?: SubjectTree[];
  onChangeTree?: (trees: SubjectTree[]) => void;
  /** 抽屉内嵌模式：层级只在内存，不写 history / 不读项目记忆 / 不处理 popstate */
  embedded?: boolean;
  /** 窄宽面包屑折叠（…） */
  compactBreadcrumb?: boolean;
}

interface SubjectCardData {
  id: string;
  name: string;
  /** 真实类型来源 = SubjectTree.kind；老数据缺字段时 undefined → 未分类 */
  kind: ProductionItemKind | undefined;
  prompt: string;
  imageKeys: string[];
  content: string;
  coverKey: string | null;
  coverSource: 'manual' | 'default' | 'none';
  referenceImages?: Array<{ storageKey: string; prompt?: string; isPrimary?: boolean }>;
}

const KIND_FILTERS: Array<{ key: 'all' | ProductionItemKind; labelKey: string }> = [
  { key: 'all', labelKey: 'storyboard.subjectAll' },
  { key: 'character', labelKey: 'entity.character' },
  { key: 'scene', labelKey: 'entity.scene' },
  { key: 'prop', labelKey: 'entity.prop' },
  { key: 'candidate', labelKey: 'entity.candidate' },
];

/** 剧集摘要（空 = 全部；悬空编号只过滤显示，不清数据） */
/**
 * 出现集数选择器（2026-11-12 简化）：
 * 80+ 集时不再把每个集铺成一行 chip；默认只显示「已选 N 集」，点开后在弹层里搜索/勾选。
 */
function EpisodePickerContent({
  episodes,
  selected,
  onToggle,
  theme,
  t,
}: {
  episodes: Array<{ number: number; title?: string }>;
  selected: number[];
  onToggle: (n: number) => void;
  theme: ThemeConfig;
  t: ReturnType<typeof useTranslation>['t'];
}): React.ReactElement {
  const [query, setQuery] = useState('');
  const q = query.trim();
  const list = q
    ? episodes.filter((ep) => String(ep.number).includes(q) || (ep.title ?? '').includes(q))
    : episodes;
  const allSelected = episodes.every((ep) => selected.includes(ep.number));
  return (
    <div style={{ width: 300 }}>
      <Input
        size="small"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('subject.episodeSearchPlaceholder', '搜索集数 / 标题')}
        allowClear
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '8px 0' }}>
        <span style={{ fontSize: 11, color: theme.toolbar.textMuted }}>
          {selected.length > 0
            ? t('subject.appearEpisodesSelected', '已选 {{n}} 集', { n: selected.length })
            : t('subject.appearEpisodesAllShort', '未选（全部剧集）')}
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <Button
            size="small"
            type="link"
            onClick={() => {
              if (allSelected) episodes.forEach((ep) => { if (selected.includes(ep.number)) onToggle(ep.number); });
              else episodes.forEach((ep) => { if (!selected.includes(ep.number)) onToggle(ep.number); });
            }}
          >
            {allSelected ? t('subject.clearEpisodes', '清空') : t('subject.selectAllEpisodes', '全选')}
          </Button>
        </div>
      </div>
      <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {list.map((ep) => (
          <label
            key={ep.number}
            data-episode-option={ep.number}
            style={{ display: 'flex', alignItems: 'center', gap: 8, height: 30, padding: '0 6px', borderRadius: 6, cursor: 'pointer' }}
          >
            <Checkbox checked={selected.includes(ep.number)} onChange={() => onToggle(ep.number)} />
            <span style={{ fontSize: 12 }}>{displayEpisodeTitle(ep.title, ep.number)}</span>
          </label>
        ))}
        {list.length === 0 ? (
          <div style={{ fontSize: 12, color: theme.toolbar.textMuted, padding: 8 }}>
            {t('subject.episodeSearchEmpty', '没有匹配的集')}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 某状态的首个媒体槽位（2026-11-08 数据层统一）：
 * 基础状态已是 states[0]，所有状态一律取 states[].media[0]，无分叉。
 * 无媒体 / 无 key → null（上层走「待补媒体」占位）。状态卡、编辑页、来源面板共用。
 */
function slotMediaOf(tree: SubjectTree | undefined | null, stateId: string): SubjectNodeMediaRef | null {
  if (!tree) return null;
  const list = (tree.states ?? []).find((n) => n.id === stateId)?.media ?? [];
  const m = list[0];
  return m?.key ? m : null;
}

/** 媒体槽位 → 缩略图分派（audio 走语音图标，video 只读历史，其余按图） */
function slotMediaKind(m: SubjectNodeMediaRef | null): 'image' | 'audio' | 'video' {
  return m?.type === 'audio' ? 'audio' : m?.type === 'video' ? 'video' : 'image';
}

/** 媒体槽位 → 来源面板的「当前资源」（替换语义展示用）；无媒体 = null */
function panelCurrentOf(m: SubjectNodeMediaRef | null): { storageKey: string; kind: 'image' | 'audio' | 'video' } | null {
  return m ? { storageKey: m.key, kind: slotMediaKind(m) } : null;
}

/**
 * 页头：三级页面共用一个结构 —— 面包屑 + 计数徽标 + 右侧主操作（+ 一行次要提示）。
 * 面包屑由调用方作为 children 传入，保证「当前层级 = 页面标题」的唯一口径。
 */
function SubjectPageHeader({
  theme, maxWidth, pad, children, count, hint, actions,
}: {
  theme: ThemeConfig;
  maxWidth: number | string;
  pad: number | string;
  children: ReactNode;
  count?: number;
  hint?: string;
  actions?: ReactNode;
}): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flexShrink: 0,
        width: '100%', maxWidth, margin: '0 auto', boxSizing: 'border-box',
        padding: `24px ${pad} 0`,
        // 右侧给抽屉「收起」按钮留出安全距离：面包屑不钻到按钮底下（2026-11-07）
        paddingRight: 44,
      }}
    >
      {children}
      {count !== undefined && (
        <Badge theme={theme} tone="neutral" data-subject-count>{count}</Badge>
      )}
      <span style={{ flex: 1, minWidth: 0 }} />
      {hint && (
        <span style={{ fontSize: 11, color: theme.toolbar.textMuted, flexShrink: 0 }}>{hint}</span>
      )}
      {actions}
    </div>
  );
}

/**
 * 面包屑：当前层级 = 页面标题（16/600），祖先层级 = 次级导航（11/500 muted）。
 * 每级都是原生 button（可点、可 Tab 聚焦、Enter/Space 触发）。
 */
function SubjectBreadcrumb({
  theme, subjectName, stateName, onLibrary, onSubject, compact = false,
}: {
  theme: ThemeConfig;
  subjectName?: string;
  stateName?: string;
  onLibrary: () => void;
  onSubject?: () => void;
  /** 抽屉窄宽：深层时用「…」折叠中间层，只留第一级 + 当前级 */
  compact?: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const muted = theme.toolbar.textMuted;
  const isDark = theme.mode === 'dark';
  /** 当前层级 → 上一级（返回按钮的唯一落点；一级页面不渲染返回） */
  const onBack = stateName ? onSubject : subjectName ? onLibrary : undefined;
  const titleStyle: CSSProperties = {
    border: 'none', background: 'transparent', padding: 0, borderRadius: 0,
    fontSize: 15, fontWeight: 600, lineHeight: 1.4, letterSpacing: -0.2,
    cursor: 'pointer', fontFamily: 'inherit', color: theme.toolbar.text,
    maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  };
  const ancestorStyle: CSSProperties = {
    border: 'none', background: 'transparent', padding: '1px 5px', borderRadius: 5,
    fontSize: 11, fontWeight: 500, lineHeight: 1.6,
    cursor: 'pointer', fontFamily: 'inherit', color: muted,
    maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    transition: 'background 0.12s, color 0.12s',
  };
  const divider = <ChevronRight size={10} color={muted} style={{ flexShrink: 0, opacity: 0.55 }} />;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: '1 1 auto' }}>
      {/* 2026-11-07 用户指令：显式「返回上一级」按钮（不再只靠面包屑，避免误触抽屉关闭）。
          用全站统一 IconButton（ghost），不另造方框按钮。 */}
      {onBack && (
        <Tooltip title={t('subject.backToParent', '返回上一级')}>
          <IconButton
            theme={theme}
            size="md"
            data-subject-back
            aria-label={t('subject.backToParent', '返回上一级')}
            onClick={onBack}
            style={{ flexShrink: 0, color: theme.toolbar.text, marginLeft: -4 }}
          >
            <ArrowLeft size={16} strokeWidth={2} />
          </IconButton>
        </Tooltip>
      )}
      <nav aria-label="主体库导航" data-subject-breadcrumb style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flexWrap: 'nowrap', overflow: 'hidden' }}>
        <button
          type="button"
          data-subject-crumb="library"
          aria-current={subjectName ? undefined : 'page'}
          onClick={onLibrary}
          style={subjectName ? ancestorStyle : titleStyle}
          onMouseEnter={(e) => {
            if (!subjectName) return;
            e.currentTarget.style.color = theme.toolbar.text;
            e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)';
          }}
          onMouseLeave={(e) => {
            if (!subjectName) return;
            e.currentTarget.style.color = muted;
            e.currentTarget.style.background = 'transparent';
          }}
        >
          {t('subject.library', '主体库')}
        </button>
        {subjectName && (!compact || !stateName) && (
          <>
            {divider}
            <button
              type="button"
              data-subject-crumb="subject"
              aria-current={stateName ? undefined : 'page'}
              onClick={onSubject}
              style={stateName ? ancestorStyle : titleStyle}
              onMouseEnter={(e) => {
                if (!stateName) return;
                e.currentTarget.style.color = theme.toolbar.text;
                e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)';
              }}
              onMouseLeave={(e) => {
                if (!stateName) return;
                e.currentTarget.style.color = muted;
                e.currentTarget.style.background = 'transparent';
              }}
            >
              {subjectName}
            </button>
          </>
        )}
        {compact && subjectName && stateName && (
          <>
            {divider}
            <button
              type="button"
              data-subject-crumb="subject-collapsed"
              aria-label={subjectName}
              title={subjectName}
              onClick={onSubject}
              style={ancestorStyle}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = theme.toolbar.text;
                e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = muted;
                e.currentTarget.style.background = 'transparent';
              }}
            >
              …
            </button>
          </>
        )}
        {subjectName && stateName && (
          <>
            {divider}
            <span data-subject-crumb="state" aria-current="page" style={{ ...titleStyle, cursor: 'default', maxWidth: 360 }}>
              {stateName}
            </span>
          </>
        )}
      </nav>
    </div>
  );
}

/** 真实取值域（ProductionItemKind 只有三值，不额外自造「其它」） */
const KIND_OPTIONS: ProductionItemKind[] = ['character', 'scene', 'prop', 'candidate'];
const KIND_LABEL_FALLBACK: Record<ProductionItemKind, string> = {
  character: '角色', scene: '场景', prop: '道具', candidate: '备选',
};

/** 类型徽标文案：缺字段 / 非法值 → 未分类 */
function kindLabelOf(kind: ProductionItemKind | undefined | null, t: ReturnType<typeof useTranslation>['t']): string {
  if (!kind) return t('subject.kindUnclassified', '未分类');
  return t(`entity.${kind}`, KIND_LABEL_FALLBACK[kind]);
}

/** 状态名草稿输入：只在失焦/回车时写盘，避免每敲一个字就落盘导致卡顿与回退（2026-11-12 用户反馈） */
function DraftStateName({ value, onCommit, placeholder, ariaLabel }: {
  value: string;
  onCommit: (next: string) => void;
  placeholder: string;
  ariaLabel: string;
}): React.ReactElement {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const commit = (): void => { if (draft !== value) onCommit(draft); };
  return (
    <Input
      data-field="name"
      aria-label={ariaLabel}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onPressEnter={commit}
    />
  );
}

/** 提示词草稿框：同样只在失焦时写盘 */
function DraftPromptField({ value, onCommit, placeholder }: {
  value: string;
  onCommit: (next: string) => void;
  placeholder: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  return (
    <>
      <Input.TextArea
        data-field="prompt"
        aria-label={t('subject.statePromptLabel', '提示词')}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft !== value) onCommit(draft); }}
        autoSize={{ minRows: 5, maxRows: 14 }}
        placeholder={placeholder}
        style={{ minHeight: 140, lineHeight: 1.6 }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
        <span data-prompt-count style={{ fontSize: 11, opacity: 0.6, fontVariantNumeric: 'tabular-nums' }}>
          {t('subject.charCount', { n: draft.length, defaultValue: `${draft.length} 字` })}
        </span>
      </div>
    </>
  );
}


function KindTabs({
  theme, activeKind, total, counts, onChange,
}: {
  theme: ThemeConfig;
  activeKind: 'all' | ProductionItemKind;
  total: number;
  counts: Record<ProductionItemKind, number>;
  onChange: (kind: 'all' | ProductionItemKind) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div
      data-subject-kind-tabs
      style={{
        display: 'flex', flexWrap: 'nowrap', gap: 24, minWidth: 0, flex: '0 1 auto',
        overflowX: 'auto', overflowY: 'hidden', overscrollBehavior: 'contain',
      }}
    >
      {KIND_FILTERS.map((f) => {
        const selected = activeKind === f.key;
        const count = f.key === 'all' ? total : counts[f.key];
        return (
          <button
            key={f.key}
            type="button"
            data-subject-kind-filter={f.key}
            onClick={() => onChange(f.key)}
            style={{
              position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6,
              height: 36, padding: 0, border: 'none', background: 'transparent',
              fontSize: 13, fontWeight: selected ? 500 : 400,
              color: selected ? theme.toolbar.text : theme.toolbar.textMuted,
              cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit',
              transition: 'color .2s ease',
            }}
            onMouseEnter={(e) => { if (!selected) e.currentTarget.style.color = theme.toolbar.text; }}
            onMouseLeave={(e) => { if (!selected) e.currentTarget.style.color = theme.toolbar.textMuted; }}
          >
            {t(f.labelKey)}
            <span style={{ fontSize: 11, opacity: 0.5, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
            <span
              data-kind-underline
              style={{
                position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, borderRadius: 1,
                background: selected ? theme.toolbar.accent : 'transparent',
                transition: 'background .2s ease',
              }}
            />
          </button>
        );
      })}
    </div>
  );
}

/**
 * 主体卡：与资产卡同一套外壳（CardShell 圆角 12 / 1px 细边 / 中性底 + 名称 12/22/500 + 元信息 11/500）。
 * 角标是 shared/ui 的中性徽标（业务类型不上色），动作区 hover/focus 才露出。
 * 多选模式（2026-11-06 批量编辑）：左上角同一 MultiSelectCheckbox（徽标右移让位，与资产卡同口径），
 * 点卡片 = 选中/取消，卡内动作区隐藏（一个时刻只留一套操作，不与批量条抢入口）。
 */
function SubjectGridCard({
  card, stateCount, theme, onOpen, onDelete, onChangeKind,
  multiSelect = false, selected = false, onToggleSelect,
}: {
  card: SubjectCardData;
  stateCount: number;
  theme: ThemeConfig;
  onOpen: () => void;
  onDelete?: () => void;
  onChangeKind: (kind: ProductionItemKind) => void;
  /** 批量模式开关（由列表层持有） */
  multiSelect?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const isDark = theme.mode === 'dark';
  const active = hovered || focused;
  const kindLabel = kindLabelOf(card.kind, t);
  const coverGlyph = card.kind === 'character' ? <UserRound size={24} />
    : card.kind === 'scene' ? <MapPin size={24} />
    : card.kind === 'prop' ? <Package size={24} />
    : <ImageIcon size={24} />;
  const kindMenu = (
    <Dropdown
      trigger={['click']}
      placement="bottomRight"
      menu={{
        items: KIND_OPTIONS.map((k) => ({
          key: k,
          label: <span data-subject-kind-option={k}>{kindLabelOf(k, t)}</span>,
          /* 2026-11-05 修复「改类型反而跳进主体状态页」：antd Dropdown 菜单虽在 portal，
             但 React 事件沿组件树冒泡到卡片 onClick → onOpen() 抢在类型写入前导航。
             与资产卡 moreMenuItems 同一约定：菜单项必须 domEvent.stopPropagation()。 */
          onClick: (e) => { e.domEvent.stopPropagation(); onChangeKind(k); },
        })),
      }}
    >
      <IconButton
        theme={theme}
        size="sm"
        aria-label={t('subject.changeKind', '改类型')}
        data-card-action="kind"
        onClick={(e) => e.stopPropagation()}
      >
        <Shapes size={14} />
      </IconButton>
    </Dropdown>
  );
  return (
    <div
      data-subject-card={card.id}
      role="button"
      tabIndex={0}
      aria-label={card.name}
      style={{
        position: 'relative', display: 'flex', flexDirection: 'column',
        gap: UI_CARD_GAP, width: '100%', cursor: 'pointer', outline: 'none',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onClick={(e) => {
        // 多选模式：整卡只负责选中/取消（与资产库多选同一语义）
        if (multiSelect) { onToggleSelect?.(); return; }
        // 卡片内自带按钮（改类型/删除等）的点击不触发进入主体
        const el = e.target as HTMLElement | null;
        if (el?.closest('button')) return;
        // 下拉菜单面板在 portal 内（不在 button 子树），同样不得当成“点卡片进入”
        if (el?.closest('.ant-dropdown')) return;
        onOpen();
      }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (multiSelect) onToggleSelect?.(); else onOpen(); } }}
    >
      {/* 封面：统一固定卡片尺寸（2026-11-12 用户要求：主体列表不用瀑布流），
          图片 contain 完整显示，不裁切人物。 */}
      <CardShell
        theme={theme}
        data-subject-card-cover
        style={{ width: '100%', aspectRatio: '16 / 9' }}
      >
        {card.coverKey ? (
          <SubjectMediaThumb
            storageKey={card.coverKey}
            kind="image"
            dark={isDark}
            fill
            fit="contain"
            emptyLabel="暂无封面"
          />
        ) : (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 6, color: theme.toolbar.textMuted,
          }}>
            <span style={{ lineHeight: 1, display: 'inline-flex' }}>{coverGlyph}</span>
            <span style={{ fontSize: 10, lineHeight: '14px' }}>{t('subject.cardCoverEmpty', '暂无封面图')}</span>
          </div>
        )}
        {multiSelect && (
          <MultiSelectCheckbox
            selected={selected}
            onToggle={() => onToggleSelect?.()}
            accentColor={theme.toolbar.accent}
          />
        )}
        <ThumbBadge
          data-subject-card-badge
          style={{ position: 'absolute', top: 6, left: multiSelect ? 34 : 6, zIndex: 2 }}
        >
          {kindLabel}
        </ThumbBadge>
        <div style={{
          position: 'absolute', inset: 0, background: UI_CARD_HOVER_OVERLAY,
          opacity: hovered ? 1 : 0, transition: 'opacity .3s', pointerEvents: 'none',
        }} />
      </CardShell>

      {/* 信息区：名称行（12/22/500）+ 元信息行（11/500）——与资产卡同构 */}
      <div style={{
        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2,
        paddingLeft: UI_CARD_INFO_PADDING_X, paddingRight: UI_CARD_INFO_PADDING_X,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', height: 24 }}>
          <span data-subject-card-name style={{ ...uiCardNameStyle(theme), flex: 1, minWidth: 0 }}>
            {card.name}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span data-subject-card-meta style={uiCardMetaStyle(theme)}>
            {kindLabel} · {t('subject.cardStateCount', { n: stateCount, defaultValue: `${stateCount} 个状态` })}
          </span>
          <div
            data-subject-card-actions
            style={{
              display: multiSelect ? 'none' : 'flex', alignItems: 'center', gap: 2, flexShrink: 0,
              opacity: active ? 1 : 0, transition: 'opacity .2s',
            }}
          >
            <Tooltip title={t('subject.changeKind', '改类型')}>{kindMenu}</Tooltip>
            <Tooltip title={t('subject.enterSubject', '进入主体')}>
              <IconButton
                theme={theme}
                size="sm"
                aria-label={t('subject.enterSubject', '进入主体')}
                data-card-action="enter"
                onClick={(e) => { e.stopPropagation(); onOpen(); }}
              >
                <ChevronRight size={14} />
              </IconButton>
            </Tooltip>
            {onDelete && (
              <Tooltip title={t('common.delete', '删除')}>
                <IconButton
                  theme={theme}
                  size="sm"
                  aria-label={t('common.delete', '删除')}
                  data-card-action="delete"
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                >
                  <Trash2 size={14} />
                </IconButton>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 状态卡：封面 16:9 按容器自适应宽度，名称/集数都在封面下方。
 * 卡内动作（悬停/聚焦露出）：设为封面 / 进入编辑 / 删除状态 —— 不必进详情就能维护状态。
 * 基础状态不可删除（它是主体树根，没有为它挂删除入口）。
 * 封面卡额外留一枚常驻「封面」徽标（不靠 hover 才能看出来哪个状态被选了）。
 */
function StateGridCard({
  stateId, title, thumbKey, thumbKind, emptyLabel, deadText, theme, isCover, editMode, editPanel,
  onClick, onToggleCover, onDelete, onToggleEdit,
  onRename, onReplaceMedia, onCanvasGenerate,
}: {
  stateId: string;
  title: string;
  thumbKey?: string | null;
  thumbKind?: 'image' | 'audio' | 'video';
  emptyLabel: string;
  deadText: string;
  theme: ThemeConfig;
  /** 当前作为主体封面的状态（常驻徽标 + 星标高亮） */
  isCover?: boolean;
  /** 当前卡片处于编辑态（封面描边 + 展开卡内编辑面板） */
  editMode?: boolean;
  /** 卡内编辑面板：由外层按需构造，编辑态下渲染在信息行下方 */
  editPanel?: ReactNode;
  onClick: () => void;
  /** 切换本卡编辑态；点卡与「编辑」按钮都走它 */
  onToggleEdit?: () => void;
  /** 缺省 = 不渲染封面入口（无树的老数据） */
  onToggleCover?: () => void;
  /** 缺省 = 不渲染删除入口（基础状态） */
  onDelete?: () => void;
  /** 就地改状态名（基础状态不传 = 不可改，名称即主体名） */
  onRename?: (next: string) => void;
  /** 就地换图：打开媒体来源面板 */
  onReplaceMedia?: (anchor: HTMLElement) => void;
  /** 画布生成：只建节点并挂提示词，不发起 API */
  onCanvasGenerate?: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const alive = useSubjectMediaAlive(thumbKey ?? undefined);
  const dead = thumbKey ? !alive : false;
  const active = hover || focus;
  return (
    <div
      data-state-card={stateId}
      role="button"
      tabIndex={0}
      aria-label={title}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        if (onToggleEdit) onToggleEdit(); else onClick();
      }}
      onKeyDown={(e) => {
        // 编辑面板内的输入不应冒泡成「卡片 Enter/Space 切换」（会打断打字）
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (onToggleEdit) onToggleEdit(); else onClick();
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{
        display: 'flex', flexDirection: 'column', gap: UI_CARD_GAP,
        width: '100%', minWidth: SUBJECT_STATE_CARD_MIN_WIDTH,
        cursor: 'pointer', outline: 'none', color: theme.toolbar.text,
      }}
    >
      <CardShell
        theme={theme}
        data-state-cover
        hovered={active || editMode}
        style={{
          width: '100%', aspectRatio: '16 / 9',
          ...(editMode ? { outline: `2px solid ${theme.toolbar.accent}`, outlineOffset: -2 } : {}),
        }}
      >
        <SubjectMediaThumb
          storageKey={thumbKey}
          kind={thumbKind}
          dark={theme.mode === 'dark'}
          fill
          fit="contain"
          emptyLabel={emptyLabel}
        />
        {isCover && (
          <ThumbBadge data-state-cover-badge style={{ position: 'absolute', top: 6, left: 6, zIndex: 3 }}>
            {t('subject.coverBadge', '封面')}
          </ThumbBadge>
        )}
        <div style={{
          position: 'absolute', inset: 0, background: UI_CARD_HOVER_OVERLAY,
          opacity: hover ? 1 : 0, transition: 'opacity .3s', pointerEvents: 'none',
        }} />
      </CardShell>
      <div data-state-info style={{
        display: 'flex', flexDirection: 'column', gap: 2,
        paddingLeft: UI_CARD_INFO_PADDING_X, paddingRight: UI_CARD_INFO_PADDING_X,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', height: 24 }}>
          {editing && onRename ? (
            <Input
              size="small"
              autoFocus
              data-state-name-input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onBlur={() => { setEditing(false); const v = draftTitle.trim(); if (v && v !== title) onRename(v); }}
              onPressEnter={() => { setEditing(false); const v = draftTitle.trim(); if (v && v !== title) onRename(v); }}
              onClick={(e) => e.stopPropagation()}
              style={{ width: '100%' }}
            />
          ) : (
            <span
              data-state-name
              title={onRename ? t('subject.inlineRenameHint', '双击改状态名') : undefined}
              onDoubleClick={(e) => { if (!onRename) return; e.stopPropagation(); setDraftTitle(title); setEditing(true); }}
              style={{ ...uiCardNameStyle(theme), flex: 1, minWidth: 0 }}
            >
              {title}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{
            display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6,
            ...uiCardMetaStyle(theme),
          }}>
            {dead && <span aria-hidden style={{ opacity: 0.45 }}>·</span>}
            <span data-state-ready style={dead ? { color: theme.toolbar.danger } : undefined}>
              {dead ? deadText : ''}
            </span>
          </span>
          {/* 与主体库卡片同一位置：信息行右下角动作区，hover/focus 出现；不再盖在封面右上角 */}
          <div
            data-state-actions
            style={{
              display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0,
              opacity: active ? 1 : 0, transition: 'opacity .2s',
            }}
          >
            {onReplaceMedia && (
              <Tooltip title={t('subject.replaceMediaInline', '换图')}>
                <IconButton
                  theme={theme}
                  size="sm"
                  aria-label={t('subject.replaceMediaInline', '换图')}
                  data-state-action="replace"
                  onClick={(e) => { e.stopPropagation(); onReplaceMedia(e.currentTarget); }}
                >
                  <ImagePlus size={13} />
                </IconButton>
              </Tooltip>
            )}
            {onCanvasGenerate && (
              <Tooltip title={t('subject.canvasGenerate', '画布生成')}>
                <IconButton
                  theme={theme}
                  size="sm"
                  aria-label={t('subject.canvasGenerate', '画布生成')}
                  data-state-action="canvas-generate"
                  onClick={(e) => { e.stopPropagation(); onCanvasGenerate(); }}
                >
                  <Wand2 size={13} />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title={isCover ? t('subject.coverCancel', '取消封面') : t('subject.setAsCover', '设为封面')}>
              <IconButton
                theme={theme}
                size="sm"
                aria-label={isCover ? t('subject.coverCancel', '取消封面') : t('subject.setAsCover', '设为封面')}
                data-state-action="cover"
                data-cover-active={isCover ? '1' : undefined}
                style={isCover ? { color: theme.toolbar.accent } : undefined}
                onClick={(e) => { e.stopPropagation(); onToggleCover?.(); }}
              >
                <Star size={13} fill={isCover ? theme.toolbar.accent : 'none'} />
              </IconButton>
            </Tooltip>
            <Tooltip title={editMode ? t('subject.closeEdit', '收起编辑') : t('subject.editState', '编辑状态')}>
              <IconButton
                theme={theme}
                size="sm"
                aria-label={editMode ? t('subject.closeEdit', '收起编辑') : t('subject.editState', '编辑状态')}
                data-state-action="edit"
                data-edit-active={editMode ? '1' : undefined}
                style={editMode ? { color: theme.toolbar.accent } : undefined}
                onClick={(e) => { e.stopPropagation(); if (onToggleEdit) onToggleEdit(); else onClick(); }}
              >
                <Pencil size={13} />
              </IconButton>
            </Tooltip>
            {onDelete && (
              <Tooltip title={t('subject.deleteState', '删除状态')}>
                <IconButton
                  theme={theme}
                  size="sm"
                  aria-label={t('subject.deleteState', '删除状态')}
                  data-state-action="delete"
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                >
                  <Trash2 size={13} />
                </IconButton>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
      {editMode && editPanel}
    </div>
  );
}

/**
 * 卡片内编辑面板（2026-11-12 最终形态）：
 * 不再跳第三个整页，点状态卡的「编辑」按钮就在卡片下方展开本区。
 * 原状态编辑页的状态名 / 提示词 / 出现集数 / 媒体与历史图全部收在这里。
 * data-subject-page="state" 保留为「当前有状态处于编辑态」的口径标记。
 */
function StateEditPanel({
  tree, node, theme, isDark, episodes, onUpdateNode,
  onReplaceMedia, onRemoveMedia, onRestoreMedia, onDeleteHistoryMedia,
}: {
  tree: SubjectTree;
  node: SubjectTreeNode;
  theme: ThemeConfig;
  isDark: boolean;
  episodes: Array<{ number: number; title?: string }>;
  onUpdateNode: (patch: Partial<SubjectTreeNode>) => void;
  onReplaceMedia: (anchor: HTMLElement) => void;
  onRemoveMedia: () => void;
  onRestoreMedia: (ref: SubjectNodeMediaRef) => void;
  onDeleteHistoryMedia: (ref: SubjectNodeMediaRef) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { message: antdMessage } = AntdApp.useApp();
  const slotMedia = slotMediaOf(tree, node.id);
  const slotKind = slotMediaKind(slotMedia);
  const hasMedia = Boolean(slotMedia);
  const promptValue = node.fullPrompt || node.deltaPrompt || '';
  const stateName = node.state ?? '';
  const isBase = node.id === SUBJECT_BASE_STATE_ID;
  const validEpisodes = episodes.slice().sort((a, b) => a.number - b.number);
  const selectedEpisodes = (node.appearEpisodes ?? []).filter((n) => validEpisodes.some((e) => e.number === n));
  const toggleEpisode = (n: number) => {
    const next = selectedEpisodes.includes(n)
      ? selectedEpisodes.filter((x) => x !== n)
      : [...selectedEpisodes, n].sort((a, b) => a - b);
    onUpdateNode({ appearEpisodes: next });
  };
  const labelStyle: CSSProperties = { fontSize: 12, fontWeight: 500, color: theme.toolbar.textMuted, marginBottom: 8 };
  const hintStyle: CSSProperties = { fontSize: 11, lineHeight: 1.6, color: theme.toolbar.textMuted };
  const episodeLabel = selectedEpisodes.length > 0
    ? `${selectedEpisodes.join('、')} 集`
    : t('subject.appearEpisodesAllShort', '全部剧集');

  return (
    <div
      data-subject-page="state"
      data-state-edit-panel
      data-root-id={tree.rootId}
      data-state-id={node.id}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      style={{
        width: '100%', boxSizing: 'border-box', marginTop: 10,
        padding: '12px 12px 14px', borderRadius: 8,
        border: `1px solid ${theme.toolbar.accent}55`,
        background: isDark ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.025)',
      }}
    >
      <section data-form-section="basic" style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
        {/* 媒体工具：小预览 + 右上角换图 / 删除媒体 + 历史图恢复 */}
        <div data-form-section="media" data-media-slot style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <CardShell theme={theme} style={{ width: '100%', height: 132, position: 'relative' }}>
            <SubjectMediaThumb
              storageKey={slotMedia?.key}
              kind={slotKind}
              dark={isDark}
              fill
              fit="contain"
              emptyLabel={t('subject.mediaPending', '待补媒体')}
            />
            <div
              data-media-actions
              style={{ position: 'absolute', top: 6, right: 6, zIndex: 3, display: 'flex', alignItems: 'center', gap: 2 }}
            >
              <Tooltip title={hasMedia ? t('subject.replaceMedia', '替换') : t('subject.uploadMedia', '上传图片/语音')}>
                <IconButton
                  theme={theme}
                  size="sm"
                  variant="overlay"
                  aria-label={hasMedia ? t('subject.replaceMedia', '替换') : t('subject.uploadMedia', '上传图片/语音')}
                  data-media-action="replace"
                  onClick={(e) => onReplaceMedia(e.currentTarget)}
                >
                  <ImagePlus size={13} />
                </IconButton>
              </Tooltip>
              {hasMedia && (
                <Tooltip title={t('subject.deleteMedia', '删除媒体')}>
                  <IconButton
                    theme={theme}
                    size="sm"
                    variant="overlay"
                    aria-label={t('subject.deleteMedia', '删除媒体')}
                    data-media-action="remove"
                    onClick={onRemoveMedia}
                  >
                    <Trash2 size={13} />
                  </IconButton>
                </Tooltip>
              )}
            </div>
          </CardShell>
          {(node.mediaHistory?.length ?? 0) > 0 && (
            <div data-media-history>
              <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>
                {t('subject.mediaHistory', '历史图片')}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {(node.mediaHistory ?? []).map((ref, i) => (
                  <div key={`${ref.key}-${i}`} style={{ position: 'relative', width: 46, height: 46 }}>
                    <Tooltip title={t('subject.restoreMedia', '恢复这张图')}>
                      <button
                        type="button"
                        data-media-history-item
                        aria-label={t('subject.restoreMedia', '恢复这张图')}
                        onClick={() => onRestoreMedia(ref)}
                        style={{
                          width: 46, height: 46, padding: 0, overflow: 'hidden',
                          borderRadius: 6, border: '1px solid rgba(128,128,128,0.28)', cursor: 'pointer',
                        }}
                      >
                        <SubjectMediaThumb storageKey={ref.key} kind={slotMediaKind(ref)} dark={isDark} fill />
                      </button>
                    </Tooltip>
                    <Tooltip title={t('subject.deleteHistory', '永久删除这张图')}>
                      <button
                        type="button"
                        data-media-history-delete
                        aria-label={t('subject.deleteHistory', '永久删除这张图')}
                        onClick={() => onDeleteHistoryMedia(ref)}
                        style={{
                          position: 'absolute', top: -6, right: -6, width: 16, height: 16, padding: 0,
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          borderRadius: 8, border: 'none', cursor: 'pointer',
                          background: 'rgba(0,0,0,0.62)', color: '#fff',
                        }}
                      >
                        <Trash2 size={9} />
                      </button>
                    </Tooltip>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 状态名 */}
        <div>
          <div style={labelStyle}>{t('subject.stateNameLabel', '状态名')}</div>
          {isBase ? (
            <div data-base-state-name style={{ ...hintStyle, fontSize: 13, fontWeight: 600, color: theme.toolbar.text, padding: '4px 0' }}>
              {tree.name}
            </div>
          ) : (
            <DraftStateName
              key={node.id}
              value={stateName}
              ariaLabel={t('subject.stateNameLabel', '状态名')}
              placeholder={t('subject.stateNamePlaceholder', '如：正常人类 / 女鬼')}
              onCommit={(next) => onUpdateNode({ state: next })}
            />
          )}
        </div>

        {/* 提示词：卡片内编辑文本块 */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={labelStyle} title={t('subject.stateRemarkHint', '该状态的生成提示词')}>
              {t('subject.statePromptLabel', '提示词')}
            </div>
            <Button
              size="small"
              type="text"
              data-copy-base-prompt
              disabled={!promptValue.trim()}
              onClick={() => {
                if (!navigator.clipboard) {
                  antdMessage.warning(t('subject.copyFailed', '复制失败，请手动选择复制'));
                  return;
                }
                void navigator.clipboard.writeText(promptValue).then(
                  () => antdMessage.success(t('subject.promptCopied', '已复制提示词')),
                  () => antdMessage.warning(t('subject.copyFailed', '复制失败，请手动选择复制')),
                );
              }}
            >
              {t('subject.copyPrompt', '复制')}
            </Button>
          </div>
          <DraftPromptField
            key={node.id}
            value={promptValue}
            placeholder={t('subject.statePromptPlaceholder', '描述这个状态的外形、服装、动作，或与其它状态的差异…')}
            onCommit={(next) => onUpdateNode({ fullPrompt: next, deltaPrompt: next })}
          />
        </div>

        {/* 出现集数：一个按钮 → 点击展开下拉列表编辑 */}
        <div data-episodes-field>
          <div style={labelStyle}>{t('subject.appearEpisodes', '出现集数')}</div>
          {validEpisodes.length === 0 ? (
            <div style={hintStyle}>{t('subject.appearEpisodesEmpty', '暂无剧集')}</div>
          ) : (
            <>
              <Popover
                trigger="click"
                placement="bottomLeft"
                content={(
                  <EpisodePickerContent
                    episodes={validEpisodes}
                    selected={selectedEpisodes}
                    onToggle={toggleEpisode}
                    theme={theme}
                    t={t}
                  />
                )}
              >
                <Button size="small" data-episodes-picker>
                  {episodeLabel} <ChevronDown size={12} />
                </Button>
              </Popover>
              {selectedEpisodes.length > 0 ? (
                <div data-episodes-summary style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {[...selectedEpisodes].sort((a, b) => a - b).map((n) => (
                    <span
                      key={n}
                      data-episode-chip={n}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        height: 22, padding: '0 4px 0 8px', borderRadius: 6, fontSize: 11,
                        border: `1px solid ${theme.toolbar.accent}`,
                        background: `${theme.toolbar.accent}18`,
                        color: theme.toolbar.accent,
                      }}
                    >
                      {t('subject.episodeN', { n, defaultValue: `第 ${n} 集` })}
                      <button
                        type="button"
                        aria-label={`移除第 ${n} 集`}
                        onClick={() => toggleEpisode(n)}
                        style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: 16, height: 16, padding: 0, border: 'none', borderRadius: 4,
                          background: 'transparent', color: 'inherit', cursor: 'pointer',
                        }}
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <span data-episodes-summary style={{ display: 'none' }} />
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * 状态网格：固定列宽、行优先（列数按实测容器宽度取，960→3 / 1280→4 / 1920→6）
 *
 * 2026-11-05：原格内「添加新状态」卡（AddStateCard）已下线——新建入口统一到底端
 * 共享 AddTile（与资产「上传素材」同款同形、中性色，hover 不亮强调色边框；2026-11-06 起统一放顶部）。
 */
function SubjectStateGrid({ children }: { children: ReactNode }): React.ReactElement {
  // 2026-11-12 用户要求：主体外面不用瀑布流；详情页用固定卡片网格，每张卡尺寸一致。
  return (
    <div
      data-subject-state-grid
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: SUBJECT_STATE_CARD_GAP,
        alignContent: 'start',
      }}
    >
      {children}
    </div>
  );
}

export const SubjectLibraryPages = memo(function SubjectLibraryPages({
  productionItems, theme, projectId, onUpdateItem, onDeleteItem, onUpdateItems, onDeleteItems, onAddSubject, subjectTree, onChangeTree,
  embedded = false, compactBreadcrumb = false,
}: SubjectLibraryPagesProps): React.ReactElement {
  const { t } = useTranslation();
  const { modal: antdModal, message: antdMessage } = AntdApp.useApp();
  const isDark = theme.mode === 'dark';

  // 布局令牌：整页 1200 内容宽（状态网格 1920）+ clamp 页边距；抽屉内 16 边距、不限宽
  const pagePad = embedded ? PAGE_PAD_EMBEDDED : PAGE_PAD;
  const maxWidthFor = (max: number): number | string => (embedded ? '100%' : max);
  const frame = (max: number): { header: CSSProperties; content: CSSProperties } => ({
    header: {
      width: '100%', maxWidth: maxWidthFor(max), margin: '0 auto', boxSizing: 'border-box',
      padding: `24px ${pagePad} 0`,
    },
    content: {
      width: '100%', maxWidth: maxWidthFor(max), margin: '0 auto', boxSizing: 'border-box',
      padding: `0 ${pagePad}`,
    },
  });
  // 滚动区与素材/历史/开源分段同一形态（含 scrollbar-gutter: stable，修抽屉抖动）
  const scrollStyle: CSSProperties = {
    ...SCROLL_AREA_STYLE,
    overflowX: 'hidden',
    paddingBottom: 32,
  };
  /** 列表空态的次级文字；卡片内编辑面板的字段样式在 StateEditPanel 内自洽 */
  const hintStyle: CSSProperties = { fontSize: 11, lineHeight: 1.6, color: theme.toolbar.textMuted };

  const [trees, setTrees] = useState<SubjectTree[]>(() => subjectTree ?? []);
  const treesRef = useRef<SubjectTree[]>(trees);
  const commitTrees = useCallback((next: SubjectTree[]) => {
    treesRef.current = next;
    setTrees(next);
    onChangeTree?.(next);
  }, [onChangeTree]);

  // 容器被另一条入口（整页页签 / 抽屉主体分段）写回时同步到本实例，两条路径共用同一份数据
  useEffect(() => {
    if (!subjectTree) return;
    if (subjectTree === treesRef.current) return;
    treesRef.current = subjectTree;
    setTrees(subjectTree);
  }, [subjectTree]);

  // ===== 层级：按项目恢复上次停留层级（刷新/重进项目） =====
  const [level, setLevel] = useState<SubjectPageLevel>(() => {
    // 抽屉内层级纯内存：每次都从列表开始，不读项目记忆
    if (embedded) return { view: 'list' };
    const remembered = readRememberedSubjectLevel(projectId);
    if (remembered.view === 'list') return remembered;
    const tree = (subjectTree ?? []).find((tr) => tr.rootId === remembered.rootId);
    if (!tree) return { view: 'list' };
    if (remembered.view === 'state' && remembered.stateId !== SUBJECT_BASE_STATE_ID) {
      if (!tree.states.some((n) => n.id === remembered.stateId)) return { view: 'subject', rootId: remembered.rootId };
    }
    return remembered;
  });
  const levelRef = useRef(level);
  const seqRef = useRef(0);
  const pushedRef = useRef(0);

  const applyLevel = useCallback((next: SubjectPageLevel, opts: { push?: boolean; replace?: boolean } = { push: true }) => {
    levelRef.current = next;
    setLevel(next);
    // 抽屉内：只改内存层级，不写项目记忆、不 pushState（浏览器后退不会把用户带出抽屉）
    if (embedded) return;
    rememberSubjectLevel(projectId, next);
    if (typeof window === 'undefined') return;
    const marker = levelToMarker(projectId ?? '', next, ++seqRef.current);
    const state = { ...(window.history.state ?? {}), [SUBJECT_PAGE_HISTORY_KEY]: marker };
    try {
      if (opts.replace) window.history.replaceState(state, '');
      else if (opts.push !== false) { window.history.pushState(state, ''); pushedRef.current += 1; }
    } catch { /* 历史不可用（部分嵌入式环境）不影响页内导航 */ }
  }, [projectId, embedded]);

  // 浏览器前进/后退 → 还原层级（仅处理本页签写入的 marker，不劫持其它路由）
  useEffect(() => {
    // 抽屉内不接管 popstate：浏览器后退不会把用户带出抽屉
    if (embedded || typeof window === 'undefined') return;
    const onPop = (e: PopStateEvent) => {
      const marker = (e.state ?? {})[SUBJECT_PAGE_HISTORY_KEY] as SubjectPageHistoryMarker | undefined;
      if (!marker) {
        if (pushedRef.current > 0) pushedRef.current -= 1;
        if (pushedRef.current === 0 && levelRef.current.view !== 'list') applyLevel({ view: 'list' }, { push: false, replace: true });
        return;
      }
      if (marker.projectId !== (projectId ?? '')) return;
      pushedRef.current = Math.max(0, pushedRef.current - 1);
      const next = markerToLevel(marker);
      levelRef.current = next;
      setLevel(next);
      rememberSubjectLevel(projectId, next);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [applyLevel, projectId, embedded]);

  // 统一导航入口 navigateToView('subject') → 事件直达 / mount 取 pending
  useEffect(() => {
    const open = (p: { rootId?: string; stateId?: string; projectId?: string } | null) => {
      if (!p?.rootId) return;
      if (p.projectId && projectId && p.projectId !== projectId) return;
      const tree = treesRef.current.find((tr) => tr.rootId === p.rootId);
      if (!tree) return;
      const stateId = p.stateId && p.stateId !== SUBJECT_BASE_STATE_ID && !tree.states.some((n) => n.id === p.stateId)
        ? undefined
        : p.stateId;
      applyLevel(stateId
        ? { view: 'state', rootId: p.rootId, stateId }
        : { view: 'subject', rootId: p.rootId }, { push: false, replace: true });
    };
    open(takePendingNavigateFocus());
    const handler = (e: Event) => open((e as CustomEvent).detail ?? null);
    window.addEventListener(NAVIGATE_FOCUS_SUBJECT_EVENT, handler);
    return () => window.removeEventListener(NAVIGATE_FOCUS_SUBJECT_EVENT, handler);
  }, [applyLevel, projectId, embedded]);

  // ===== 剧集列表（出现集数候选） =====
  const [episodes, setEpisodes] = useState<Array<{ number: number; title?: string }>>([]);
  useEffect(() => {
    if (!projectId) { setEpisodes([]); return; }
    let cancelled = false;
    const apply = (e: { episodes?: Array<{ number: number; title?: string }> } | null) => {
      if (cancelled) return;
      // 按真实集号排序（不要用 appearEpisodes 反推集数）
      setEpisodes((e?.episodes ?? [])
        .map((ep) => ({ number: ep.number, title: ep.title }))
        .sort((a, b) => a.number - b.number));
    };
    void readScript(projectId).then(apply);
    const un = watchScript(projectId, apply);
    return () => { cancelled = true; un(); };
  }, [projectId]);

  // 外部（画布右键 / 资产卡发送）直写容器后 → 重读刷新本地树
  const linkVersion = useSubjectMediaLinkEventStore((s) => s.version);
  useEffect(() => {
    if (!linkVersion || !projectId) return;
    let cancelled = false;
    void (async () => {
      const container = await readStoryboardContainer(projectId);
      if (cancelled) return;
      const next = container?.subjectTree as SubjectTree[] | undefined;
      if (Array.isArray(next)) {
        treesRef.current = next;
        setTrees(next);
        // 状态编辑页缩略图/主体页计数即时刷新（本地树同一数据源）
      }
    })();
    return () => { cancelled = true; };
  }, [linkVersion, projectId]);

  // 状态编辑页 → 登记「当前打开状态」（资产发送直达用）
  const openState = level.view === 'state' ? level : null;
  const openTree = level.view !== 'list' ? trees.find((tr) => tr.rootId === level.rootId) : undefined;
  // 基础状态也是 states[0] 真节点：所有状态走同一查找路径
  const openNode = openState ? openTree?.states.find((n) => n.id === openState.stateId) : undefined;
  const openStateName = openState
    ? (openState.stateId === SUBJECT_BASE_STATE_ID
      ? (openTree?.name ?? t('subject.baseState', BASE_BALL))
      : (openNode?.state?.trim() || ''))
    : undefined;
  useEffect(() => {
    // 2026-11-08：基础状态已是 states[0] 真节点，与其余状态同样支持「资产发送直达」
    if (!openState || !projectId || !openTree || !openNode) return;
    setCurrentSubjectStateContext({
      projectId, rootId: openState.rootId, stateId: openState.stateId,
      subjectName: openTree.name, stateName: openNode.state || openStateName || '',
    });
    return () => clearCurrentSubjectStateContext(projectId, openState.rootId, openState.stateId);
  }, [openState, openNode, openTree, projectId, openStateName]);

  // ===== 列表数据 =====
  const cards = useMemo<SubjectCardData[]>(() => {
    return (productionItems ?? [])
      .filter((it) => it && it.name && it.name.trim())
      .map((it) => {
        // 条目 ↔ 树走唯一绑定（2026-11-06）：旧版直接按 name find，同名主体（默认名全是「新主体」）
        // 会命中同一棵树 → 改一条的类型/集数/封面串到另一条。类型仍以树字段为准。
        const tree = findTreeForItem(trees, it, productionItems ?? []);
        // 封面：条目 images + 树媒体候选（2026-11-06「把某个状态当封面」）
        const cover = resolveSubjectCover(it, subjectCoverCandidates(tree));
        const allKeys = (it.images ?? []).map((r) => r.storageKey);
        const imageKeys = cover.key ? [cover.key, ...allKeys.filter((k) => k !== cover.key)] : allKeys;
        const kind = tree ? (tree.kind as ProductionItemKind | undefined) : it.kind;
        return {
          id: it.id, name: it.name, kind,
          prompt: it.consistency || '', imageKeys, content: it.consistency || '',
          coverKey: cover.key, coverSource: cover.source,
          referenceImages: (it.images ?? []).map((r) => ({
            storageKey: r.storageKey, prompt: r.prompt, isPrimary: r.storageKey === cover.key,
          })),
        };
      });
  }, [productionItems, trees]);

  const storedKind = useViewPrefsStore((s) => s.subjectLibrary.activeKind);
  const setSubjectActiveKind = useViewPrefsStore((s) => s.setSubjectActiveKind);
  const activeKind = (storedKind === 'character' || storedKind === 'scene' || storedKind === 'prop' || storedKind === 'candidate'
    ? storedKind : 'all') as 'all' | ProductionItemKind;

  // 按项目记忆的集筛选（复用 view-prefs.subjectLibrary 切片，不新增存储键）
  const storedEpisode = useViewPrefsStore(
    (s) => (projectId ? s.subjectLibrary.activeEpisodeByProject[projectId] ?? null : null),
  );
  const setSubjectActiveEpisode = useViewPrefsStore((s) => s.setSubjectActiveEpisode);
  // 剧本尚未加载时先信任记忆值；加载后若该集已不存在则回落「全集」
  const activeEpisode: number | null = storedEpisode !== null
    && (episodes.length === 0 || episodes.some((ep) => ep.number === storedEpisode))
    ? storedEpisode : null;
  /** 卡片对应的主树（唯一绑定口径；集筛选与状态计数共用） */
  const treeOfCard = useCallback((card: { id: string; name: string }): SubjectTree | undefined =>
    findTreeForItem(trees, card, productionItems ?? []),
  [trees, productionItems]);

  const [search, setSearch] = useState('');
  // ===== 批量编辑（2026-11-06 用户反馈：「没法批量编辑」）=====
  // 形态与资产库多选同一套：搜索行右侧 Square/CheckSquare 开关 + 卡片左上同一 MultiSelectCheckbox；
  // 选中集是数据上下文不是偏好 → 不写 view-prefs（与 view-prefs 头注口径一致）。
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const exitMultiSelect = useCallback(() => {
    setMultiSelect(false);
    setSelectedIds(new Set());
  }, []);
  // 离开列表页就清空选中（回来时面对的可能已是另一个主体集，不能留旧选择）
  useEffect(() => {
    if (levelRef.current.view !== 'list') setSelectedIds(new Set());
  }, [level]);
  /**
   * 集筛选规则（一句话）：基础状态无集信息 → 按主体级「全集适用」；
   * 状态按 states[].appearEpisodes 判定，未标注（空数组）视为「全集适用」；
   * 只有该主体下所有状态都标注为其它集时才隐藏整卡（复用 treeEpisodeRank，口径统一）。
   */
  const episodeCards = useMemo(() => {
    if (activeEpisode === null) return cards;
    return cards.filter((card) => {
      const tree = treeOfCard(card);
      if (!tree) return false;
      // 2026-11-12：未分配集数的状态不参与集筛选（空 = 未知，不等于“全剧出场”）
      const explicit = tree.states.filter((st) => (st.appearEpisodes ?? []).length > 0);
      if (explicit.length === 0) return false;
      return explicit.some((st) => (st.appearEpisodes ?? []).includes(activeEpisode));
    });
  }, [cards, treeOfCard, activeEpisode]);
  const filteredCards = useMemo(() => {
    const kw = search.trim().toLowerCase();
    const byKind = activeKind === 'all' ? episodeCards : episodeCards.filter((c) => c.kind === activeKind);
    return kw ? byKind.filter((c) => c.name.toLowerCase().includes(kw)) : byKind;
  }, [episodeCards, activeKind, search]);
  // 计数与结果共用 episodeCards / filteredCards 同一 predicate，避免「有数字没内容」
  const counts = useMemo(() => {
    const c: Record<ProductionItemKind, number> = { character: 0, scene: 0, prop: 0, candidate: 0 };
    for (const card of cards) {
      if (card.kind) c[card.kind] = (c[card.kind] ?? 0) + 1;
    }
    return c;
  }, [cards]);

  /** 打开主体：找不到绑定的树时按卡片幂等建树（新树直接带 itemId，不再走名字配对） */
  const openSubject = useCallback((card: SubjectCardData | null, rootId?: string) => {
    let rid = rootId;
    if (!rid && card) {
      const existing = findTreeForItem(treesRef.current, card, productionItems ?? []);
      if (existing) {
        rid = existing.rootId;
      } else {
        const kind = card.kind ?? 'character';
        const tr = createSubjectTree(kind, card.name, card.id);
        const base = tr.states[0]!;
        base.fullPrompt = buildBaseStatePrompt(kind, {
          roleDesc: card.content || card.prompt || '', name: card.name,
        });
        base.deltaPrompt = base.fullPrompt;
        if (card.referenceImages && card.referenceImages.length > 0) {
          base.media = card.referenceImages.map((r) => ({
            key: r.storageKey, type: 'image' as const, prompt: r.prompt,
          }));
        }
        commitTrees([...treesRef.current, tr]);
        rid = tr.rootId;
      }
    }
    if (!rid) return;
    applyLevel({ view: 'subject', rootId: rid }, { push: true });
  }, [applyLevel, commitTrees, productionItems]);

  const goLibrary = useCallback(() => applyLevel({ view: 'list' }, { push: false, replace: true }), [applyLevel]);
  const goSubject = useCallback(() => {
    if (levelRef.current.view === 'list') { goLibrary(); return; }
    const rootId = levelRef.current.rootId;
    applyLevel({ view: 'subject', rootId }, { push: false, replace: true });
  }, [applyLevel, goLibrary]);

  const handleDeleteCard = useCallback((card: SubjectCardData) => {
    antdModal.confirm({
      centered: true, okType: 'danger',
      title: t('common.delete'),
      content: t('storyboard.confirmDeleteSubject', { name: card.name }),
      okText: t('common.delete'), cancelText: t('common.cancel'),
      onOk: () => {
        const pid = projectId ?? undefined;
        // 只动本条目绑定的那棵树（2026-11-06）：旧版按 name 剔除会把同名另一条主体的树一起删掉
        const bound = findTreeForItem(treesRef.current, card, productionItems ?? []);
        if (pid && bound) void releaseSubjectStateMediaRefs({ trees: [bound], projectId: pid });
        onDeleteItem?.(card.id);
        commitTrees(bound ? treesRef.current.filter((x) => x.rootId !== bound.rootId) : treesRef.current);
        if (levelRef.current.view !== 'list') applyLevel({ view: 'list' }, { push: false, replace: true });
      },
    });
  }, [antdModal, t, projectId, onDeleteItem, commitTrees, applyLevel, productionItems]);

  /**
   * 删除单个状态（状态卡或状态编辑页入口）：
   * 先释放该状态的媒体引用，再从主体树剔除；正在编辑它时退回主体状态页。
   * 基础状态不是 states[] 节点，不提供删除入口。
   */
  const handleDeleteState = useCallback((rootId: string, node: SubjectTreeNode) => {
    antdModal.confirm({
      centered: true, okType: 'danger',
      title: t('subject.deleteState', '删除状态'),
      content: t('subject.deleteStateConfirm', '删除该状态及其全部图片？'),
      okText: t('common.delete'), cancelText: t('common.cancel'),
      onOk: () => {
        const pid = projectId ?? undefined;
        const tr = treesRef.current.find((x) => x.rootId === rootId);
        if (pid && tr) void releaseSubjectStateMediaRefs({ trees: [tr], projectId: pid, rootId, stateId: node.id });
        commitTrees(treesRef.current.map((x) => (
          x.rootId === rootId ? { ...x, states: (x.states ?? []).filter((n) => n.id !== node.id) } : x
        )));
        const cur = levelRef.current;
        if (cur.view === 'state' && cur.stateId === node.id) {
          applyLevel({ view: 'subject', rootId }, { push: false, replace: true });
        }
      },
    });
  }, [antdModal, t, projectId, commitTrees, applyLevel]);

  /** 添加状态（出现集数/媒体后续在状态编辑页填写） */
  const addState = useCallback(() => {
    if (levelRef.current.view === 'list') return;
    const rootId = levelRef.current.rootId;
    const tr = treesRef.current.find((x) => x.rootId === rootId);
    if (!tr) return;
    const step = nextStateStep(tr);
    const node = createSubjectNode(
      buildDefaultStateName(tr.name, step, (n) => t('subject.stateLabelN', { n, defaultValue: `状态${n}` })),
      'text', 'user', rootId, { step },
    );
    commitTrees(treesRef.current.map((x) => (x.rootId === rootId ? { ...x, states: [...(x.states ?? []), node] } : x)));
    applyLevel({ view: 'state', rootId, stateId: node.id }, { push: true });
  }, [commitTrees, applyLevel, t]);

  // ===== 状态编辑：写回 =====
  const updateTree = useCallback((rootId: string, updater: (tr: SubjectTree) => SubjectTree) => {
    commitTrees(treesRef.current.map((tr) => (tr.rootId === rootId ? updater(tr) : tr)));
  }, [commitTrees]);

  const updateNode = useCallback((rootId: string, nodeId: string, patch: Partial<SubjectTreeNode>) => {
    updateTree(rootId, (tr) => ({
      ...tr,
      states: (tr.states ?? []).map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
    }));
  }, [updateTree]);

  const renameTree = useCallback((rootId: string, name: string) => {
    const tree = treesRef.current.find((tr) => tr.rootId === rootId);
    if (!tree || tree.name === name) return;
    // 树内改名回写卡片；绑定靠 itemId 不靠名字，所以改名不断链（顺手把 itemId 补进老数据）
    const item = findItemForTree(productionItems ?? [], tree, treesRef.current);
    updateTree(rootId, (tr) => ({ ...tr, name, itemId: tr.itemId ?? item?.id ?? null }));
    if (item) onUpdateItem?.(item.id, { name });
  }, [updateTree, productionItems, onUpdateItem]);

  /**
   * 改类型：唯一事实源 = SubjectTree.kind（不改 id / 状态 / 媒体引用）。
   * 写回走既有 onChangeTree（容器落盘）→ 本地树即时刷新徽标；
   * 同条目 kind 一并回写，避免卡片与树长期不一致。
   * 条目由绑定查询得出，顺手把 itemId 补进树（老数据自愈，下次不再靠名字猜）。
   */
  const changeKind = useCallback((rootId: string, kind: ProductionItemKind) => {
    const prev = treesRef.current;
    const tree = prev.find((tr) => tr.rootId === rootId);
    if (!tree || tree.kind === kind) return;
    const item = findItemForTree(productionItems ?? [], tree, prev);
    const next = prev.map((tr) => (tr.rootId === rootId ? { ...tr, kind, itemId: tr.itemId ?? item?.id ?? null } : tr));
    try {
      commitTrees(next);
      if (item) onUpdateItem?.(item.id, { kind });
      antdMessage.success(t('subject.kindChanged', {
        kind: kindLabelOf(kind, t), defaultValue: `类型已改为${kindLabelOf(kind, t)}`,
      }));
    } catch (err) {
      treesRef.current = prev;
      setTrees(prev);
      antdMessage.error(err instanceof Error && err.message
        ? err.message : t('subject.kindChangeFailed', '类型修改失败，请重试'));
    }
  }, [commitTrees, productionItems, onUpdateItem, antdMessage, t]);

  /** 卡片入口改类型：有绑定树走树，无树只改条目字段（老数据同样可写回） */
  const changeKindByCard = useCallback((card: SubjectCardData, kind: ProductionItemKind) => {
    const tree = findTreeForItem(treesRef.current, card, productionItems ?? []);
    if (tree) { changeKind(tree.rootId, kind); return; }
    try {
      onUpdateItem?.(card.id, { kind });
      antdMessage.success(t('subject.kindChanged', {
        kind: kindLabelOf(kind, t), defaultValue: `类型已改为${kindLabelOf(kind, t)}`,
      }));
    } catch (err) {
      antdMessage.error(err instanceof Error && err.message
        ? err.message : t('subject.kindChangeFailed', '类型修改失败，请重试'));
    }
  }, [changeKind, onUpdateItem, antdMessage, t, productionItems]);

  // ===== 批量操作（多选模式下的唯一写入口，2026-11-06）=====
  const selectedCards = useMemo(() => cards.filter((c) => selectedIds.has(c.id)), [cards, selectedIds]);

  /**
   * 批量改类型：与单条 changeKind 同一口径（树 kind 为事实源 + 条目 kind 同步 + itemId 自愈），
   * 但只发两笔写（trees 一笔 + entities 一笔），不是 N×2 笔——串行锁保证不互盖，
   * 少写几笔是为了少跳几个版本、少几份快照。
   */
  const applyBatchKind = useCallback((kind: ProductionItemKind) => {
    const picked = selectedCards;
    if (picked.length === 0) return;
    const prev = treesRef.current;
    const items = productionItems ?? [];
    const treeToItem = new Map<string, string>();
    for (const c of picked) {
      const tr = findTreeForItem(prev, c, items);
      if (tr) treeToItem.set(tr.rootId, c.id);
    }
    if (treeToItem.size > 0) {
      commitTrees(prev.map((tr) => (treeToItem.has(tr.rootId)
        ? { ...tr, kind, itemId: tr.itemId ?? treeToItem.get(tr.rootId) ?? null }
        : tr)));
    }
    const ids = picked.map((c) => c.id);
    if (onUpdateItems) onUpdateItems(ids, { kind });
    else ids.forEach((id) => onUpdateItem?.(id, { kind }));
    antdMessage.success(t('subject.batchKindDone', {
      n: ids.length, kind: kindLabelOf(kind, t),
      defaultValue: `已把 ${ids.length} 个主体改为${kindLabelOf(kind, t)}`,
    }));
  }, [selectedCards, productionItems, commitTrees, onUpdateItems, onUpdateItem, antdMessage, t]);

  /** 批量删除：逐条释放绑定树的媒体引用（一笔），再单笔剔除条目与树 */
  const applyBatchDelete = useCallback(() => {
    const picked = selectedCards;
    if (picked.length === 0) return;
    antdModal.confirm({
      centered: true, okType: 'danger',
      title: t('subject.batchDeleteTitle', '批量删除主体'),
      content: t('subject.batchDeleteConfirm', { n: picked.length, defaultValue: `删除这 ${picked.length} 个主体及其全部状态？` }),
      okText: t('common.delete'), cancelText: t('common.cancel'),
      onOk: () => {
        const pid = projectId ?? undefined;
        const items = productionItems ?? [];
        const bound = picked
          .map((c) => findTreeForItem(treesRef.current, c, items))
          .filter((tr): tr is SubjectTree => Boolean(tr));
        if (pid && bound.length > 0) void releaseSubjectStateMediaRefs({ trees: bound, projectId: pid });
        const rootIds = new Set(bound.map((tr) => tr.rootId));
        commitTrees(rootIds.size > 0 ? treesRef.current.filter((tr) => !rootIds.has(tr.rootId)) : treesRef.current);
        const ids = picked.map((c) => c.id);
        if (onDeleteItems) onDeleteItems(ids);
        else ids.forEach((id) => onDeleteItem?.(id));
        setSelectedIds(new Set());
        antdMessage.success(t('subject.batchDeleteDone', { n: ids.length, defaultValue: `已删除 ${ids.length} 个主体` }));
      },
    });
  }, [selectedCards, antdModal, t, projectId, productionItems, commitTrees, onDeleteItems, onDeleteItem, antdMessage]);

  // ===== 封面（2026-11-06 用户指令：「要支持某个状态作为封面」）=====
  // 事实源 = ProductionItem.coverKey（resolveSubjectCover 既有唯一解析入口，主体卡/详情头部/
  // 导演台主体行同源）；候选集由主体树提供，所以「树里的状态图」也能当封面。
  // 单写入（entities 一笔），不碰树 → 不会重踏「同一操作两笔并发写互盖」的坑。
  const itemOfTree = useCallback(
    (tree: SubjectTree): ProductionItem | null =>
      findItemForTree(productionItems ?? [], tree, treesRef.current) ?? null,
    [productionItems],
  );
  const coverKeyOfTree = useCallback(
    (tree: SubjectTree): string | null => resolveSubjectCover(itemOfTree(tree), subjectCoverCandidates(tree)).key,
    [itemOfTree],
  );
  const stateMediaKey = (tree: SubjectTree, stateId: string): string | null =>
    firstCoverMediaKeyOfState((tree.states ?? []).find((n) => n.id === stateId)?.media);

  const toggleCover = useCallback((tree: SubjectTree, stateId: string) => {
    const item = itemOfTree(tree);
    if (!item) { antdMessage.warning(t('subject.coverNoItem', '该主体还未入库，无法设置封面')); return; }
    const key = stateMediaKey(tree, stateId);
    if (!key) { antdMessage.warning(t('subject.coverNoMedia', '该状态还没有图片，先补一张图再设为封面')); return; }
    const node = (tree.states ?? []).find((n) => n.id === stateId);
    const label = node?.state?.trim()
      || (stateId === SUBJECT_BASE_STATE_ID
        ? t('subject.baseState', BASE_BALL)
        : t('subject.stateLabelN', { n: 1, defaultValue: '状态' }));
    const isCancel = coverKeyOfTree(tree) === key;
    onUpdateItem?.(item.id, { coverKey: isCancel ? null : key });
    antdMessage.success(isCancel
      ? t('subject.coverCleared', { name: label, defaultValue: `已取消封面（${label}），回到默认取第一张图` })
      : t('subject.coverSet', { name: label, defaultValue: `已把「${label}」设为封面` }));
  }, [itemOfTree, coverKeyOfTree, onUpdateItem, antdMessage, t]);

  // ===== 媒体来源面板（状态编辑页接收位） =====
  const [panel, setPanel] = useState<{ rootId: string; stateId: string; anchorEl?: HTMLElement | null } | null>(null);

  /**
   * 唯一媒体写入路径 = linkSubjectStateMedia（CAS 记账 + 首槽替换）。
   * stateId 允许 SUBJECT_BASE_STATE_ID：基础状态与状态走同一入口，图片/语音同一入口——
   * 旧的「隐藏 file input + setBaseImage 直写」已下线（那条路不记账、也不能挂音频）。
   */
  const pickMedia = useCallback(async (asset: SubjectStateMediaAsset | null) => {
    if (!panel) return;
    try {
      const { trees: linked } = await linkSubjectStateMedia({
        trees: treesRef.current, projectId: projectId ?? undefined,
        rootId: panel.rootId, stateId: panel.stateId, asset,
      });
      commitTrees(linked);
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('subjectCreate.saveFailed', '保存失败'));
    }
    setPanel(null);
  }, [panel, projectId, commitTrees, antdMessage, t]);

  /** 危险操作：直接清空该槽位（不依赖来源面板是否打开，避免面板未开时早退） */
  const removeMedia = useCallback(async (rootId: string, stateId: string) => {
    try {
      const { trees: linked } = await linkSubjectStateMedia({
        trees: treesRef.current, projectId: projectId ?? undefined,
        rootId, stateId, asset: null,
      });
      commitTrees(linked);
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('subjectCreate.saveFailed', '保存失败'));
    }
  }, [projectId, commitTrees, antdMessage, t]);

  /** 从状态媒体历史恢复一张旧图（只换引用，不复制文件） */
  const restoreMedia = useCallback(async (rootId: string, stateId: string, ref: SubjectNodeMediaRef) => {
    try {
      const { trees: linked } = await linkSubjectStateMedia({
        trees: treesRef.current, projectId: projectId ?? undefined,
        rootId, stateId,
        asset: { storageKey: ref.key, kind: ref.type, origin: ref.origin },
      });
      commitTrees(linked);
      antdMessage.success(t('subject.mediaRestored', '已恢复历史媒体'));
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('subjectCreate.saveFailed', '保存失败'));
    }
  }, [projectId, commitTrees, antdMessage, t]);

  /** 永久删除一张历史图（2026-11-10）：二次确认 → 移除条目 + 释放 CAS 引用 + 封面回退 */
  const deleteHistoryMedia = useCallback((rootId: string, stateId: string, ref: SubjectNodeMediaRef) => {
    antdModal.confirm({
      centered: true, okType: 'danger',
      title: t('subject.deleteHistoryTitle', '永久删除这张历史图片？'),
      content: t('subject.deleteHistoryDesc', '会同时释放它的存储引用，文件不可恢复。'),
      okText: t('subject.deleteHistoryOk', '永久删除'),
      cancelText: t('common.cancel', '取消'),
      onOk: async () => {
        try {
          const { trees: linked } = await deleteSubjectHistoryMedia({
            trees: treesRef.current, projectId: projectId ?? undefined,
            rootId, stateId, key: ref.key,
          });
          commitTrees(linked);
          antdMessage.success(t('subject.deleteHistoryDone', '已永久删除'));
        } catch (err) {
          antdMessage.error(err instanceof Error ? err.message : t('subjectCreate.saveFailed', '保存失败'));
        }
      },
    });
  }, [antdModal, projectId, commitTrees, antdMessage, t]);

  // ===== 工具栏片段（整页与抽屉共用同一实现，2026-11-06）=====
  /** 按集筛选：选项来自剧本真实集数；落位由调用处决定（旧版自带 marginLeft:auto，抽屉里被右边缘裁成半截） */
  const episodeFilter = (
    <Dropdown
      trigger={['click']}
      placement="bottomRight"
      menu={{
        items: [
          {
            key: 'all',
            label: (
              <span data-subject-episode-option="all" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, display: 'inline-flex', justifyContent: 'center' }}>
                  {activeEpisode === null ? <Check size={12} /> : null}
                </span>
                {t('subject.episodeAll', '全集')}
              </span>
            ),
            onClick: () => setSubjectActiveEpisode(projectId ?? '', null),
          },
          ...episodes.map((ep) => ({
            key: String(ep.number),
            label: (
              <span data-subject-episode-option={ep.number} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, display: 'inline-flex', justifyContent: 'center' }}>
                  {activeEpisode === ep.number ? <Check size={12} /> : null}
                </span>
                {t('subject.episodeN', { n: ep.number, defaultValue: `第 ${ep.number} 集` })}
              </span>
            ),
            onClick: () => setSubjectActiveEpisode(projectId ?? '', ep.number),
          })),
        ],
      }}
    >
      <Button
        size="small"
        data-subject-episode-filter
        data-episode={activeEpisode ?? 'all'}
        icon={<ChevronDown size={13} />}
        iconPlacement="end"
        style={{ flexShrink: 0 }}
      >
        {activeEpisode === null
          ? t('subject.episodeAll', '全集')
          : `${t('subject.episodeN', { n: activeEpisode, defaultValue: `第 ${activeEpisode} 集` })} · ${episodeCards.length} 个`}
      </Button>
    </Dropdown>
  );
  /** 多选开关：与资产库同一形态（Square/CheckSquare，紧跟搜索框） */
  const multiSelectToggle = (
    <Tooltip title={multiSelect ? t('common.multiSelectExit', '退出多选') : t('common.multiSelect', '多选')}>
      <Button
        size="small"
        data-subject-multiselect
        aria-pressed={multiSelect}
        icon={multiSelect ? <CheckSquare size={14} /> : <Square size={14} />}
        onClick={() => { if (multiSelect) exitMultiSelect(); else setMultiSelect(true); }}
        style={{ flexShrink: 0 }}
      />
    </Tooltip>
  );
  /** 批量条：多选时才出现；未选中时动作置灰（不留「点了没反应」的按钮） */
  const noneSelected = selectedCards.length === 0;
  const batchActions = (
    <>
      <span style={{ fontSize: 12, fontWeight: 600, color: theme.toolbar.text, flexShrink: 0 }}>
        {t('common.batchSelected', { n: selectedCards.length, defaultValue: `已选 ${selectedCards.length} 项` })}
      </span>
      <Dropdown
        trigger={['click']}
        disabled={noneSelected}
        menu={{
          items: KIND_OPTIONS.map((k) => ({
            key: k,
            label: <span data-batch-kind-option={k}>{kindLabelOf(k, t)}</span>,
            onClick: () => applyBatchKind(k),
          })),
        }}
      >
        <Button size="small" data-batch-kind disabled={noneSelected} icon={<Shapes size={13} />} iconPlacement="end">
          {t('subject.batchChangeKind', '改类型')}
        </Button>
      </Dropdown>
      <Button size="small" danger data-batch-delete disabled={noneSelected} icon={<Trash2 size={13} />} onClick={applyBatchDelete}>
        {t('common.delete', '删除')}
      </Button>
      <Button size="small" type="text" data-batch-clear disabled={noneSelected} onClick={() => setSelectedIds(new Set())}>
        {t('common.batchClear', '清空选择')}
      </Button>
    </>
  );

  // ===== 渲染 =====
  let content: React.ReactElement;
  if (level.view === 'list') {
    const listFrame = frame(LIST_MAX_WIDTH);
    content = (
      <div data-subject-page="list" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {/* 抽屉内不出页头（2026-11-05 用户指令）：分段胶囊已经标明「主体」，「主体库 + 计数」属重复标题；
            计数与 CategoryChips 的「全部」同源，不丢信息。整页模式（非 embedded）保留面包屑页头。 */}
        {!embedded && (
          <SubjectPageHeader
            theme={theme}
            maxWidth={maxWidthFor(LIST_MAX_WIDTH)}
            pad={pagePad}
            count={episodeCards.length}
            actions={onAddSubject && (
              <Button type="primary" size="small" data-subject-add icon={<Plus size={14} />} onClick={onAddSubject}>
                {t('storyboard.addSubject', '添加主体')}
              </Button>
            )}
          >
            <SubjectBreadcrumb theme={theme} onLibrary={goLibrary} />
          </SubjectPageHeader>
        )}

        {/* 主操作统一放顶部（2026-11-06 用户指令：原来埋在最底下每次找半天） */}
        {embedded && onAddSubject && (
          <div style={{ padding: `12px ${pagePad}px 4px`, flexShrink: 0 }}>
            <AddTile
              label={t('storyboard.addSubject', '添加主体')}
              icon={<Plus size={16} />}
              onClick={onAddSubject}
              theme={theme}
              dataAttr={{ 'data-subject-add': '' }}
            />
          </div>
        )}

        {/* 工具栏：抽屉内与素材分段逐行同源（共享 ToolbarRow：8/20/10 内距 + SearchBox 高 26）。
            2026-11-06 用户指出图1/图2 布局差异：旧版把 chips+搜索塞进一列、再把集筛选
            marginLeft:auto 挤在同一行右侧，窄抽屉里被右边缘裁成半截。现：chips 一行、
            搜索+多选+集筛选一行，与素材分段同一结构同一高度。 */}
        {embedded ? (
          <>
            <ToolbarRow>
              <CategoryChips
                items={[
                  { key: 'all', label: t('subject.kindAll', '全部'), count: episodeCards.length },
                  ...KIND_OPTIONS.map((k) => ({ key: k as string, label: kindLabelOf(k, t), count: counts[k] })),
                ]}
                active={activeKind}
                onChange={(k) => setSubjectActiveKind((k ?? 'all') as 'all' | ProductionItemKind)}
                theme={theme}
              />
            </ToolbarRow>
            <ToolbarRow style={{ paddingTop: 0 }}>
              <SearchBox
                value={search}
                onChange={setSearch}
                placeholder={t('subject.searchPlaceholder', '搜索名称或标签')}
                theme={theme}
                inputData={{ 'data-subject-search': '' }}
              />
              {multiSelectToggle}
              {episodeFilter}
            </ToolbarRow>
            {multiSelect && (
              <ToolbarRow style={{ paddingTop: 0 }} dataAttr={{ 'data-subject-batch-bar': '' }}>
                {batchActions}
              </ToolbarRow>
            )}
          </>
        ) : (
          <>
            <div style={{ ...listFrame.content, paddingTop: 12, paddingBottom: 12, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', flexShrink: 0 }}>
              <Input
                data-subject-search
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('subject.searchPlaceholder', '搜索主体…')}
                prefix={<Search size={14} style={{ opacity: 0.5 }} />}
                allowClear
                style={{ width: 240, maxWidth: '100%', flexShrink: 0 }}
              />
              <KindTabs
                theme={theme}
                activeKind={activeKind}
                total={episodeCards.length}
                counts={counts}
                onChange={setSubjectActiveKind}
              />
              <span style={{ marginLeft: 'auto', flexShrink: 0, display: 'inline-flex', gap: 6 }}>
                {multiSelectToggle}
                {episodeFilter}
              </span>
            </div>
            {multiSelect && (
              <div
                data-subject-batch-bar
                style={{ ...listFrame.content, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingBottom: 12, flexShrink: 0 }}
              >
                {batchActions}
              </div>
            )}
          </>
        )}

        <div style={scrollStyle}>
          {/* 2026-11-12 用户要求：主体列表不用瀑布流，用统一尺寸的固定网格；
              卡片图片 contain 完整显示，不裁人物。 */}
          {filteredCards.length > 0 && (
            <div
              data-subject-grid
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 16,
                width: '100%',
                maxWidth: maxWidthFor(LIST_MAX_WIDTH),
                margin: '0 auto',
                paddingBottom: 16,
                boxSizing: 'border-box',
              }}
            >
              {filteredCards.map((card) => (
                <SubjectGridCard
                  key={card.id}
                  card={card}
                  stateCount={treeOfCard(card)?.states.length ?? 0}
                  theme={theme}
                  multiSelect={multiSelect}
                  selected={selectedIds.has(card.id)}
                  onToggleSelect={() => toggleSelect(card.id)}
                  onOpen={() => openSubject(card)}
                  onDelete={onDeleteItem ? () => handleDeleteCard(card) : undefined}
                  onChangeKind={(kind) => changeKindByCard(card, kind)}
                />
              ))}
            </div>
          )}
          <div style={listFrame.content}>
            {activeEpisode !== null && episodeCards.length === 0 ? (
              <div data-subject-episode-empty style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '48px 0', textAlign: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: theme.toolbar.text }}>
                  {t('subject.episodeEmpty', { n: activeEpisode, defaultValue: `第 ${activeEpisode} 集暂无主体` })}
                </span>
                <Button size="small" data-subject-episode-reset onClick={() => setSubjectActiveEpisode(projectId ?? '', null)}>
                  {t('subject.episodeBackAll', '查看全集')}
                </Button>
              </div>
            ) : filteredCards.length === 0 && (
              <div data-subject-list-empty style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '56px 0', textAlign: 'center' }}>
                <ImageIcon size={28} color={theme.toolbar.textMuted} style={{ opacity: 0.5 }} />
                <div style={{ fontSize: 13, fontWeight: 600, color: theme.toolbar.text }}>
                  {search.trim() ? t('subject.searchEmpty', '没有匹配的主体') : t('storyboard.subjectEmpty', '暂无主体')}
                </div>
                <div style={{ ...hintStyle, maxWidth: 360 }}>
                  {search.trim()
                    ? t('subject.searchEmptyHint', '换个关键词，或切换上方类型筛选')
                    : t('subject.libraryEmptyHint', '创建第一个主体后，即可为它维护形象状态与出现集数')}
                </div>
                {!embedded && !search.trim() && onAddSubject && (
                  <Button type="primary" size="small" icon={<Plus size={14} />} onClick={onAddSubject}>
                    {t('storyboard.addSubject', '添加主体')}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

      </div>
    );
  } else if (!openTree) {
    const missingFrame = frame(LIST_MAX_WIDTH);
    content = (
      <div data-subject-page="missing" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <SubjectPageHeader theme={theme} maxWidth={maxWidthFor(LIST_MAX_WIDTH)} pad={pagePad}>
          <SubjectBreadcrumb theme={theme} onLibrary={goLibrary} />
        </SubjectPageHeader>
        <div style={{ ...missingFrame.content, marginTop: 24, fontSize: 12, opacity: 0.65 }} data-subject-missing>
          {t('subject.notFound', '主体不存在或已被删除')}
        </div>
      </div>
    );
  } else {
    const coverKey = coverKeyOfTree(openTree);
    // 无图状态与「无封面」都是 null，必须先排空才不会被误判成封面
    const isCoverState = (stateId: string): boolean => {
      const k = stateMediaKey(openTree, stateId);
      return Boolean(k) && k === coverKey;
    };
    // 计数只算迭代状态（基础状态是 states[0]，不计入「N 状态」）
    const stateCount = nonBaseStates(openTree).length;
    const stateCountText = t('subject.stateCount', { n: stateCount, defaultValue: `${stateCount} 状态` });
    const stateFrame = frame(STATE_MAX_WIDTH);
    /** 点卡 / 点「编辑」= 展开或收起这张卡自己的编辑面板；不切页面 */
    const toggleEdit = (stateId: string): void => {
      if (openState?.stateId === stateId) goSubject();
      else applyLevel({ view: 'state', rootId: openTree.rootId, stateId }, { push: true });
    };
    content = (
      <div data-subject-page="subject" data-root-id={openTree.rootId} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <SubjectPageHeader
          theme={theme}
          maxWidth={maxWidthFor(STATE_MAX_WIDTH)}
          pad={pagePad}
        >
          <SubjectBreadcrumb theme={theme} subjectName={openTree.name} stateName={openStateName} compact={compactBreadcrumb} onLibrary={goLibrary} onSubject={goSubject} />
          {/* 主体名在本页改，状态名与其余字段都在卡片内编辑 */}
          <Input
            size="small"
            data-field="subject-name"
            aria-label={t('subject.subjectNameLabel', '主体名')}
            value={openTree.name}
            onChange={(e) => renameTree(openTree.rootId, e.target.value)}
            style={{ width: 160, flexShrink: 0 }}
          />
          <span data-state-count={stateCount} style={{ fontSize: 12, color: theme.toolbar.textMuted, flexShrink: 0 }}>
            {stateCountText}
          </span>
        </SubjectPageHeader>
        {/* 主操作统一放顶部（2026-11-06 用户指令）：添加状态在页头下方，不再埋到列表底端 */}
        <div style={{ padding: `12px ${pagePad}px 4px`, flexShrink: 0 }}>
          <AddTile
            label={t('subject.addState', '添加状态')}
            icon={<Plus size={16} />}
            onClick={addState}
            theme={theme}
            dataAttr={{ 'data-add-state': '' }}
          />
        </div>
        <div style={scrollStyle}>
          <div style={{ ...stateFrame.content, paddingTop: 16 }}>
            {/* 2026-11-08：基础状态是 states[0]，与其余状态共用同一张卡组件、同一个 map */}
            <SubjectStateGrid>
              {(openTree.states ?? []).map((node) => {
                const isBase = node.id === SUBJECT_BASE_STATE_ID;
                const first = (node.media ?? [])[0];
                return (
                  <StateGridCard
                    key={node.id}
                    stateId={node.id}
                    title={isBase
                      ? openTree.name
                      : (node.state?.trim() || t('subject.stateLabelN', { n: node.step ?? 1, defaultValue: `状态${node.step ?? 1}` }))}
                    thumbKey={first?.key}
                    thumbKind={slotMediaKind(first ?? null)}
                    emptyLabel={t('subject.noCover', '暂无封面')}
                    deadText={t('subject.mediaDead', '引用已失效')}
                    theme={theme}
                    isCover={isCoverState(node.id)}
                    editMode={openState?.stateId === node.id}
                    onToggleEdit={() => toggleEdit(node.id)}
                    editPanel={openState?.stateId === node.id && openNode ? (
                      <StateEditPanel
                        tree={openTree}
                        node={node}
                        theme={theme}
                        isDark={isDark}
                        episodes={episodes}
                        onUpdateNode={(patch) => updateNode(openTree.rootId, node.id, patch)}
                        onReplaceMedia={(anchor) => setPanel({ rootId: openTree.rootId, stateId: node.id, anchorEl: anchor })}
                        onRemoveMedia={() => { void removeMedia(openTree.rootId, node.id); }}
                        onRestoreMedia={(ref) => { void restoreMedia(openTree.rootId, node.id, ref); }}
                        onDeleteHistoryMedia={(ref) => deleteHistoryMedia(openTree.rootId, node.id, ref)}
                      />
                    ) : undefined}
                    onToggleCover={() => toggleCover(openTree, node.id)}
                    onClick={() => toggleEdit(node.id)}
                    onDelete={isBase ? undefined : () => handleDeleteState(openTree.rootId, node)}
                    onRename={isBase ? undefined : (next) => updateNode(openTree.rootId, node.id, { state: next })}
                    onReplaceMedia={(anchor) => setPanel({ rootId: openTree.rootId, stateId: node.id, anchorEl: anchor })}
                    onCanvasGenerate={() => {
                      nodeActionBus.emit('subject:sendStateToCanvas', {
                        nodeId: '',
                        name: isBase ? openTree.name : (node.state?.trim() || openTree.name),
                        prompt: node.fullPrompt || node.deltaPrompt || '',
                        storageKey: first?.key,
                      });
                    }}
                  />
                );
              })}
            </SubjectStateGrid>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {content}
      {panel && (
        <SubjectMediaSourcePanel
          open
          onClose={() => setPanel(null)}
          theme={theme}
          projectId={projectId ?? undefined}
          anchorEl={panel.anchorEl}
          current={panelCurrentOf(slotMediaOf(trees.find((x) => x.rootId === panel.rootId), panel.stateId))}
          onPick={(asset) => { void pickMedia(asset); }}
        />
      )}
    </>
  );
});
