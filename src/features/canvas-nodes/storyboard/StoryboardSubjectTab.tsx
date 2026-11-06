/**
 * StoryboardSubjectTab - 分镜「主体」页签（2026-08-30 约定新增）
 *
 * 双层结构（征集 #131 定稿）：
 * - 列表层：主体卡片网格（productionItems 数据源，主页提示词网格同款）——新建/删除走主体库
 * - 查看层：点开卡片 → 新版主体树详情（StoryboardSubjectTree 单树视图），替代旧版提示词链路画布：
 *   名称 + 分类徽章 + 基础定妆提示词 + 状态迭代列表 + 参考图 + 色卡，全部可编辑
 * - 首次点开时按主体名幂等建树（基础提示词从卡片带入），树随 node.data.subjectTree 持久化
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { App as AntdApp, Modal, Tooltip } from 'antd';
import { Plus, RotateCcw, Star, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useViewPrefsStore } from '@/shared/view-prefs.js';
import type { ThemeConfig } from '@zeroexo/shared';
import { PromptCard } from '@/shared/components/prompt-card.js';
import { useImagePanZoom, ZoomToolbar } from '@/shared/components/image-viewer.js';
import { AuthorizedImage } from '@/shared/components/authorized-media.js';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import { StoryboardSubjectTree } from './StoryboardSubjectTree';
import { SubjectLibraryPages } from './subject-library-pages';
import { createSubjectTree, findTreeForItem } from './subject-tree-types';
import { releaseSubjectStateMediaRefs } from './subject-state-media';
import type { SubjectTree, ProjectColorCard } from './subject-tree-types';
import { buildBaseStatePrompt } from './subject-prompt-templates';
import { ENTITY_KIND_META } from './storyboard-utils';
import type { ProductionItem, ProductionItemKind } from '../production-manager/production-manager-types';
import { resolveSubjectCover } from '../production-manager/production-manager-types';
import { KIND_ICON } from '../production-manager/production-manager-panels';
import { readScript, watchScript } from '@/entities/script-store.js';
import { readStoryboardContainer } from '@/entities/slot-containers.js';
import { useCanvasTabStore } from '@/features/canvas-tabs/canvas-tab-store.js';
import { useSubjectMediaLinkEventStore } from './subject-state-media';

export interface StoryboardSubjectTabProps {
  /** 主体库条目（卡片网格数据源 + @提及数据源，与节点主体库同一数据源） */
  productionItems: ProductionItem[];
  theme: ThemeConfig;
  /** 卡片网格新建/编辑/删除（写主体库 productionItems），由父级接线 */
  onAddItem?: (kind: ProductionItemKind) => void;
  onUpdateItem?: (itemId: string, patch: Partial<ProductionItem>) => void;
  onDeleteItem?: (itemId: string) => void;
  /** 批量写回（2026-11-06 主体库批量编辑）：宿主有单笔容器写 API 时传入，透传给页面化层 */
  onUpdateItems?: (itemIds: readonly string[], patch: Partial<ProductionItem>) => void;
  onDeleteItems?: (itemIds: readonly string[]) => void;
  /** 主体树数据（node.data.subjectTree），点开卡片后渲染单树详情 */
  subjectTree?: SubjectTree[];
  /** 树变更回调（写 node.data.subjectTree） */
  onChangeTree?: (trees: SubjectTree[]) => void;
  /** 项目级色卡（随分镜任务 output 水合，树详情顶部展示） */
  colorCard?: ProjectColorCard | null;
  /** 2026-11-05 主体库页面化：true = 三层面包屑页面（主体库页签）；false/缺省 = 旧单树弹层（分镜全屏编辑器） */
  pagesMode?: boolean;
  /** 项目 id（页面化层级的按项目记忆 + 资产发送目标校验） */
  projectId?: string | null;
}

const KIND_FILTERS: Array<{ key: 'all' | ProductionItemKind; labelKey: string }> = [
  { key: 'all', labelKey: 'storyboard.subjectAll' },
  { key: 'character', labelKey: 'entity.character' },
  { key: 'scene', labelKey: 'entity.scene' },
  { key: 'prop', labelKey: 'entity.prop' },
];

/** 主体卡片数据（来自主体库 productionItems） */
interface SubjectCardData {
  id: string;
  name: string;
  kind: ProductionItemKind;
  /** 提示词正文：优先锚点句，兜底描述 */
  prompt: string;
  /** 参考图 storageKey 列表（封面解析结果置顶，PromptCard 取首位作封面） */
  imageKeys: string[];
  /** 提示词原文（建树时带入 baseState.prompt） */
  content: string;
  /** 解析后的封面 storageKey（null = 无图，上层渲染占位） */
  coverKey: string | null;
  /** 封面来源：manual=手动指定 / default=第一个状态图 / none=无图 */
  coverSource: 'manual' | 'default' | 'none';
  referenceImages?: Array<{ storageKey: string; prompt?: string; isPrimary?: boolean }>;
}

const LegacyStoryboardSubjectTab = memo(function StoryboardSubjectTab({
  productionItems,
  theme,
  onAddItem,
  onUpdateItem,
  onDeleteItem,
  subjectTree,
  onChangeTree,
  colorCard,
}: StoryboardSubjectTabProps): React.ReactElement {
  const { t } = useTranslation();
  const { modal: antdModal } = AntdApp.useApp();
  // 2026-11-04 约定（偏好记忆）：类型筛选持久化到全局偏好 store——
  // 主体库页签切换会卸载本组件，此前筛选只活在本地 useState，切走即回「全部」；现存 store 保留
  const storedKind = useViewPrefsStore((s) => s.subjectLibrary.activeKind);
  const setSubjectActiveKind = useViewPrefsStore((s) => s.setSubjectActiveKind);
  const activeKind = (storedKind === 'character' || storedKind === 'scene' || storedKind === 'prop'
    ? storedKind : 'all') as 'all' | ProductionItemKind;
  const setActiveKind = useCallback((kind: 'all' | ProductionItemKind) => {
    setSubjectActiveKind(kind);
  }, [setSubjectActiveKind]);
  const [openCard, setOpenCard] = useState<SubjectCardData | null>(null);

  // ===== 数据源：主体库 productionItems =====
  const cards = useMemo<SubjectCardData[]>(() => {
    return (productionItems ?? [])
      .filter((it) => it && it.name && it.name.trim())
      .map((it) => {
        // 封面唯一解析入口（手动 coverKey → 第一个状态图 → 无）
        const cover = resolveSubjectCover(it);
        const allKeys = (it.images ?? []).map((r) => r.storageKey);
        // 卡片封面 = imageKeys 首位（PromptCard 契约）：解析后的封面置顶
        const imageKeys = cover.key
          ? [cover.key, ...allKeys.filter((k) => k !== cover.key)]
          : allKeys;
        return {
          id: it.id,
          name: it.name,
          kind: it.kind,
          prompt: it.consistency || '',
          imageKeys,
          content: it.consistency || '',
          coverKey: cover.key,
          coverSource: cover.source,
          referenceImages: (it.images ?? []).map((r) => ({
            storageKey: r.storageKey,
            prompt: r.prompt,
            isPrimary: r.storageKey === cover.key,
          })),
        };
      });
  }, [productionItems]);

  const counts = useMemo(() => {
    const c: Record<ProductionItemKind, number> = { character: 0, scene: 0, prop: 0 };
    for (const card of cards) {
      c[card.kind] = (c[card.kind] ?? 0) + 1;
    }
    return c;
  }, [cards]);

  const filtered = useMemo(
    () => (activeKind === 'all' ? cards : cards.filter((c) => c.kind === activeKind)),
    [cards, activeKind],
  );

  // ===== 类型筛选按钮（主页提示词子分类胶囊同款） =====
  const filterRow = (
    <div
      style={{
        display: 'flex',
        flexWrap: 'nowrap',
        gap: 4,
        padding: '8px 20px 12px',
        flexShrink: 0,
        overflowX: 'auto',
        overscrollBehavior: 'contain',
      }}
    >
      {KIND_FILTERS.map((f) => {
        const selected = activeKind === f.key;
        const count = f.key === 'all' ? cards.length : counts[f.key];
        return (
          <button
            key={f.key}
            type="button"
            onClick={() => setActiveKind(f.key)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              height: 24,
              padding: '0 8px',
              fontSize: 11,
              fontWeight: selected ? 600 : 400,
              borderRadius: 6,
              cursor: 'pointer',
              flexShrink: 0,
              border: selected ? `1px solid ${theme.toolbar.accent}` : '1px solid transparent',
              background: selected ? theme.toolbar.accent : 'transparent',
              color: selected ? '#fff' : theme.toolbar.textMuted,
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {t(f.labelKey)}
            <span style={{ opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
          </button>
        );
      })}
    </div>
  );

  // ===== 卡片网格（主页提示词网格同款） =====
  const grid: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 20,
    alignContent: 'start',
  };

  // 新建主体卡片的目标分类（全部 → 默认角色；具体分类 → 该分类）
  const createKind: ProductionItemKind = activeKind === 'all' ? 'character' : activeKind;
  const canCreate = !!onAddItem;
  const canDelete = !!onDeleteItem;

  // 卡片网格 hover 直接删除（复用 PromptCard 内置 onDelete）
  const handleDeleteCard = useCallback((card: SubjectCardData) => {
    antdModal.confirm({
      centered: true,
      okType: 'danger',
      title: t('common.delete'),
      content: t('storyboard.confirmDeleteSubject', { name: card.name }),
      okText: t('common.delete'),
      cancelText: t('common.cancel'),
      onOk: () => {
        // 删除主体前释放其全部状态媒体 CAS 引用（手动上传的主体私有文件靠它回收，防孤儿）
        const pid = useCanvasTabStore.getState().slotBindings.script;
        // 只动本条目绑定的那棵树（2026-11-06）：按 name 剔除会把同名另一条主体的树一起删掉
        const bound = findTreeForItem(subjectTree ?? [], card, productionItems ?? []);
        if (pid && bound) {
          void releaseSubjectStateMediaRefs({ trees: [bound], projectId: pid });
        }
        onDeleteItem?.(card.id);
        // 同步移除对应主体树
        if (bound && onChangeTree) {
          onChangeTree((subjectTree ?? []).filter((x) => x.rootId !== bound.rootId));
        }
        setOpenCard((cur) => (cur?.id === card.id ? null : cur));
      },
    });
  }, [antdModal, t, onDeleteItem, onChangeTree, subjectTree, productionItems]);

  // 详情弹层数据源实时化：设为封面/恢复默认写回后 container 更新 → cards 重算，
  // openCard 本地快照会过期，这里按 id 取最新卡片（找不到说明已被删除，保持旧快照让关闭逻辑处理）
  const openCardLive = useMemo(() => {
    if (!openCard) return null;
    return cards.find((c) => c.id === openCard.id) ?? openCard;
  }, [openCard, cards]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {filterRow}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '0 20px 24px' }}>
        <div style={grid}>
          {canCreate && (
            /* 常驻新建主体卡（主页 ProjectCard variant="create" 1:1：仅外框虚线 + 中央加号） */
            <button
              type="button"
              onClick={() => onAddItem?.(createKind)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
                padding: 0,
                borderRadius: 12,
                border: `1.5px dashed ${theme.mode === 'dark' ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)'}`,
                background: theme.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
                cursor: 'pointer', color: theme.toolbar.textMuted, fontFamily: 'inherit',
                transition: 'all 0.15s', outline: 'none', overflow: 'hidden',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = theme.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = theme.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)'; }}
            >
              {/* 缩略图区：与 PromptCard 缩略图同宽高比，保证与主体卡等高 */}
              <div style={{ width: '100%', aspectRatio: '239.2 / 135.4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Plus size={24} />
              </div>
              {/* 底部信息条：与 PromptCard cardBody(padding 12) 对齐，补齐等高 */}
              <div style={{ padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 500 }}>
                  {activeKind === 'all' ? t('storyboard.addSubject', '新建主体') : t(`entity.${createKind}`)}
                </span>
              </div>
            </button>
          )}
          {filtered.map((card) => {
            const meta = ENTITY_KIND_META[card.kind];
            return (
              <PromptCard
                key={card.id}
                title={card.name}
                category={card.kind}
                categoryLabel={t(meta.labelKey)}
                tags={card.prompt ? [card.prompt] : []}
                imageKeys={card.imageKeys}
                mode="asset"
                borderRadius={12}
                thumbnailAspectRatio="239.2/135.4"
                disableHoverScale
                onClick={() => setOpenCard(card)}
                onDelete={canDelete ? () => handleDeleteCard(card) : undefined}
                theme={theme}
              />
            );
          })}
        </div>
      </div>

      {/* ===== 点开卡片 → 新版主体树详情（替代旧版提示词链路画布，征集 #131） ===== */}
      {openCardLive && (
        <SubjectDetailView
          card={openCardLive}
          theme={theme}
          subjectTree={subjectTree}
          siblingItems={productionItems}
          colorCard={colorCard}
          onChangeTree={onChangeTree}
          onUpdateItem={onUpdateItem}
          onDeleteItem={onDeleteItem}
          onClose={() => setOpenCard(null)}
        />
      )}
    </div>
  );
});

/** 主体库页签：pages 模式走三层页面（列表 → 主体 → 状态），否则维持旧单树弹层（分镜全屏编辑器） */
export const StoryboardSubjectTab = memo(function StoryboardSubjectTab(props: StoryboardSubjectTabProps): React.ReactElement {
  if (props.pagesMode) {
    const shared = {
      productionItems: props.productionItems,
      theme: props.theme,
      projectId: props.projectId,
      onUpdateItem: props.onUpdateItem,
      onDeleteItem: props.onDeleteItem,
      onUpdateItems: props.onUpdateItems,
      onDeleteItems: props.onDeleteItems,
      onAddSubject: props.onAddItem ? () => props.onAddItem?.('character') : undefined,
      subjectTree: props.subjectTree,
      onChangeTree: props.onChangeTree,
    };
    return <SubjectLibraryPages {...shared} />;
  }
  return <LegacyStoryboardSubjectTab {...props} />;
});

/** 主体详情查看器（单树视图：基础定妆 + 状态迭代 + 参考图 + 色卡，征集 #131）
 *
 * 设计原则（避免死循环）：
 * - 使用 useState 本地树状态，初始化从 subjectTree 或卡片数据构建
 * - 用户编辑时同步更新本地状态 + 写回 node.data（调用 onChangeTree/onUpdateItem）
 * - 无挂载时自动建树 effect（useEffect 仅用于初始化本地状态，不写 node.data）
 * - 用 ref 追踪最新 subjectTree 确保合并正确（避免 Yjs 异步同步导致的闭包过期）
 *
 * 2026-09-02 征集 #131 修复：
 * - 使用 antd Modal（对齐 AssetDetailViewer：width=calc(100vw-32px), maxWidth=1400）
 * - 画布区域支持缩放平移（useImagePanZoom + ZoomToolbar）
 * - 禁用内部滚动（disableScroll）由 panZoom 接管视口
 */
function SubjectDetailView({
  card,
  theme,
  subjectTree,
  siblingItems,
  colorCard,
  onChangeTree,
  onUpdateItem,
  onDeleteItem,
  onClose,
}: {
  card: SubjectCardData;
  theme: ThemeConfig;
  subjectTree?: SubjectTree[];
  /** 同项目全部主体条目（2026-11-06）：供条目↔树唯一绑定判同名歧义，不传 = 只能靠名字 */
  siblingItems?: ReadonlyArray<{ id: string; name: string }>;
  colorCard?: ProjectColorCard | null;
  onChangeTree?: (trees: SubjectTree[]) => void;
  onUpdateItem?: (itemId: string, patch: Partial<ProductionItem>) => void;
  onDeleteItem?: (itemId: string) => void;
  onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { modal: antdModal } = AntdApp.useApp();
  const isDark = theme.mode === 'dark';
  const panZoom = useImagePanZoom({ panAlways: true });

  // 本地树状态：初始化按「条目↔树唯一绑定」找树，找不到则从卡片数据建（仅在组件挂载时执行一次）
  const [tree, setTree] = useState<SubjectTree>(() => {
    const existing = findTreeForItem(subjectTree ?? [], card, siblingItems ?? [card]);
    if (existing) return existing;
    const t = createSubjectTree(card.kind, card.name, card.id);
    // Plan#71 T2: 手动建树不再用一句话 consistency 顶替基础提示词 →
    // 用后端 asset-prompts 同源模板参数化填充(角色 Lineup/道具 Prop/场景 Environment)
    t.baseState.prompt = buildBaseStatePrompt(card.kind, {
      roleDesc: card.content || card.prompt || '',
      name: card.name,
    });
    if (card.referenceImages && card.referenceImages.length > 0) {
      t.baseState.referenceImages = card.referenceImages.map((r) => ({
        key: r.storageKey, type: 'image' as const, prompt: r.prompt,
      }));
    }
    return t;
  });

  // 用 ref 追踪最新 subjectTree 避免闭包过期
  const treesRef = useRef(subjectTree ?? []);
  treesRef.current = subjectTree ?? [];

  // ===== 2026-11-04 主体库改造：剧集列表（「出现集数」候选）+ 外部写入刷新 =====
  const projectId = useCanvasTabStore((s) => s.slotBindings.script);
  const [episodes, setEpisodes] = useState<Array<{ number: number; title?: string }>>([]);
  /** 当前剧集编号（方案 C 相关性排序用）：script.activeEpisodeId → 对应集 number；取不到 = null（退回原顺序，不硬编码） */
  const [activeEpisodeNumber, setActiveEpisodeNumber] = useState<number | null>(null);
  const linkVersion = useSubjectMediaLinkEventStore((s) => s.version);

  // 剧集列表：readScript 实时读取 + watch 联动（新增集自动出现在「出现集数」下拉；activeEpisodeId 联动排序上下文）
  useEffect(() => {
    if (!projectId) { setEpisodes([]); setActiveEpisodeNumber(null); return; }
    let cancelled = false;
    const apply = (e: { episodes?: Array<{ id?: string; number: number; title?: string }>; activeEpisodeId?: string } | null) => {
      if (cancelled) return;
      const list = (e?.episodes ?? []).map((ep) => ({ number: ep.number, title: ep.title }));
      setEpisodes(list);
      const active = e?.activeEpisodeId
        ? (e?.episodes ?? []).find((ep) => ep.id === e.activeEpisodeId)
        : undefined;
      setActiveEpisodeNumber(typeof active?.number === 'number' ? active.number : null);
    };
    void readScript(projectId).then(apply);
    const un = watchScript(projectId, apply);
    return () => { cancelled = true; un(); };
  }, [projectId]);

  // 画布右键「发送到主体」弹层直写容器后 → 重读容器刷新本地树（防止详情弹层陈旧）
  useEffect(() => {
    if (!linkVersion || !projectId) return;
    let cancelled = false;
    void (async () => {
      const container = await readStoryboardContainer(projectId);
      if (cancelled) return;
      const updated = ((container?.subjectTree as SubjectTree[] | undefined) ?? []).find((tr) => tr.rootId === tree.rootId);
      if (updated) setTree(updated);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkVersion, projectId, tree.rootId]);

  // 树变更回调（实时编辑）：
  const handleTreeChange = useCallback((single: SubjectTree[]) => {
    const newTree = single[0];
    if (!newTree) return;
    setTree(newTree);
    const current = treesRef.current;
    const rest = current.filter((x) => x.rootId !== newTree.rootId);
    onChangeTree?.([...rest, newTree]);
    // Plan#71 T2: 树内改名/改分类才回写卡片；基础提示词(模板)不再回写卡片 consistency
    if (newTree.name !== card.name || newTree.kind !== card.kind) {
      onUpdateItem?.(card.id, {
        name: newTree.name,
        kind: newTree.kind,
      });
    }
  }, [onChangeTree, onUpdateItem, card.id, card.name, card.content, card.prompt]);

  // 删除整个主体（征集 #154）：主体树按 rootId 精确剔除 + 主体库条目一并删，然后关闭详情弹层。
  // 主体是分镜生成时 AI 自动识别创建的产物，产物不等于只读——推翻 Plan#71 「根节点禁删」设计。
  const handleDeleteRoot = useCallback((rootId: string) => {
    antdModal.confirm({
      centered: true,
      okType: 'danger',
      title: t('common.delete'),
      content: t('storyboard.confirmDeleteSubject', { name: tree.name }),
      okText: t('common.delete'),
      cancelText: t('common.cancel'),
      onOk: () => {
        // 删除整树前释放其全部状态媒体 CAS 引用（手动上传的主体私有文件靠它回收，防孤儿）
        const removed = treesRef.current.filter((x) => x.rootId === rootId);
        if (projectId && removed.length > 0) {
          void releaseSubjectStateMediaRefs({ trees: removed, projectId });
        }
        onChangeTree?.(treesRef.current.filter((x) => x.rootId !== rootId));
        onDeleteItem?.(card.id);
        onClose();
      },
    });
  }, [antdModal, t, tree.name, onChangeTree, onDeleteItem, card.id, onClose, projectId]);

  const meta = ENTITY_KIND_META[card.kind];
  const KindIcon = KIND_ICON[card.kind];
  const stateImages = card.referenceImages ?? [];

  // ===== 封面操作（2026-11-04 主体库封面需求：详情内状态图列表设为封面 / 恢复默认）=====
  const handleSetCover = useCallback((key: string) => {
    onUpdateItem?.(card.id, { coverKey: key });
  }, [onUpdateItem, card.id]);
  const handleRestoreCover = useCallback(() => {
    onUpdateItem?.(card.id, { coverKey: null });
  }, [onUpdateItem, card.id]);

  // ===== 对齐 PromptChainCanvas：完全同款容器 + fitToContainer + ResizeObserver =====
  const containerElRef = useRef<HTMLDivElement | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  const fitToContainer = useCallback(() => {
    const el = containerElRef.current;
    const treeEl = treeRef.current;
    if (!el || !treeEl) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    if (cw <= 0 || ch <= 0) return;
    panZoom.reset();
    const { width: tw, height: th } = treeEl.getBoundingClientRect();
    if (tw <= 0 || th <= 0) return;
    const needed = Math.min((cw - 48) / tw, (ch - 48) / th);
    if (needed >= 1) return;
    const target = Math.max(needed, 0.25);
    const steps = Math.min(Math.ceil((1 - target) / 0.25), 4);
    for (let i = 0; i < steps; i++) panZoom.zoomOut();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = containerElRef.current;
    if (!el) return;
    fitToContainer();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => fitToContainer());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitToContainer]);

  return (
    <Modal
      open
      onCancel={onClose}
      footer={null}
      width="calc(100vw - 32px)"
      style={{ maxWidth: 1400 }}
      centered
      destroyOnClose
      title={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 0 }}>
          {/* 头部行：封面缩略 + 名称 + 分类徽章 + 恢复默认 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
            {card.coverKey ? (
              <AuthorizedImage
                data-subject-cover-thumb
                src={getResourceUrl(card.coverKey, 'preview') ?? ''}
                alt=""
                style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
              />
            ) : (
              <span
                data-subject-cover-thumb
                style={{
                  width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)',
                  color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(15,23,42,0.35)',
                }}
              >
                <KindIcon size={14} />
              </span>
            )}
            <span style={{ fontSize: 14, fontWeight: 600, color: theme.toolbar.text }}>{tree.name}</span>
            <span style={{
              fontSize: 10, fontWeight: 600, color: meta.color, padding: '2px 8px',
              borderRadius: 999, background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
            }}>
              {t(meta.labelKey)}
            </span>
            <span style={{ flex: 1 }} />
            {card.coverSource === 'manual' && (
              <Tooltip title={t('subject.restoreDefaultCover', '恢复默认封面')}>
                <button
                  type="button"
                  data-restore-cover
                  onClick={handleRestoreCover}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, height: 22,
                    padding: '0 8px', fontSize: 11, cursor: 'pointer', borderRadius: 5,
                    border: `1px solid ${isDark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.12)'}`,
                    background: 'transparent', color: theme.toolbar.textMuted,
                  }}
                >
                  <RotateCcw size={11} />
                  {t('subject.restoreDefaultCover', '恢复默认封面')}
                </button>
              </Tooltip>
            )}
          </div>
          {/* 状态图列表：点击设为封面（当前封面星标 + 描边），保持实体原始顺序 */}
          {stateImages.length > 0 && (
            <div
              data-cover-strip
              style={{
                display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto',
                paddingBottom: 4, overscrollBehavior: 'contain',
              }}
            >
              {stateImages.map((img) => {
                const isCover = img.storageKey === card.coverKey;
                return (
                  <Tooltip key={img.storageKey} title={isCover ? t('subject.coverImage') : t('subject.setAsCover')}>
                    <button
                      type="button"
                      data-set-cover={img.storageKey}
                      onClick={() => { if (!isCover) handleSetCover(img.storageKey); }}
                      style={{
                        position: 'relative', width: 40, height: 40, padding: 0, flexShrink: 0,
                        borderRadius: 6, overflow: 'hidden', cursor: isCover ? 'default' : 'pointer',
                        border: isCover
                          ? `2px solid ${theme.toolbar.accent}`
                          : `1px solid ${isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)'}`,
                        background: 'transparent',
                      }}
                    >
                      <AuthorizedImage
                        src={getResourceUrl(img.storageKey, 'preview') ?? ''}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                      {isCover && (
                        <span style={{
                          position: 'absolute', top: 2, right: 2, width: 14, height: 14,
                          borderRadius: 4, background: theme.toolbar.accent, color: '#fff',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Star size={9} fill="currentColor" />
                        </span>
                      )}
                    </button>
                  </Tooltip>
                );
              })}
            </div>
          )}
        </div>
      }
      closeIcon={<X size={14} style={{ cursor: 'pointer', color: 'inherit' }} onClick={onClose} />}
      styles={{
        mask: { background: 'transparent' },
        header: { marginBottom: 0, paddingBottom: 0, borderBottom: 'none' },
        body: { padding: 0, height: 'calc(100vh - 140px)', overflow: 'hidden' },
        container: { borderRadius: 12, overflow: 'hidden' },
      } as any}
    >
      {/* ===== 对齐 PromptChainCanvas：完全同款容器结构（只换节点内容） ===== */}
      <div
        ref={(el) => {
          containerElRef.current = el;
          panZoom.containerRef(el);
        }}
        {...panZoom.containerHandlers}
        style={{
          position: 'relative', width: '100%', height: '100%', overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: isDark ? '#0d0d0d' : '#f5f5f4',
          touchAction: 'none', userSelect: 'none',
        }}
      >
        {/* 世界层：缩放/平移目标（挂 panZoom.imgRef，pointerEvents: none 事件穿透到容器） */}
        <div
          ref={panZoom.imgRef as unknown as React.Ref<HTMLDivElement>}
          style={{ position: 'relative', flexShrink: 0, pointerEvents: 'none', ...panZoom.imgTransformStyle, transition: 'none' } as CSSProperties}
        >
          {/* 树容器：pointerEvents: auto 恢复交互（唯一与 PromptChainCanvas 不同的节点内容）
              userSelect: text 必须显式恢复——外层缩放容器的 userSelect:'none' 是继承属性，
              会一路传到 textarea/input 导致提示词、主体名无法拖选文本（征集 #152：无法修改文本） */}
          <div ref={treeRef} style={{ pointerEvents: 'auto', userSelect: 'text' }}>
            <StoryboardSubjectTree
              trees={[tree]}
              theme={theme}
              colorCard={colorCard ?? null}
              onChange={handleTreeChange}
              onAddSubject={() => { /* 详情视图内不提供再新建主体 */ }}
              onDeleteRoot={handleDeleteRoot}
              disableScroll
              episodes={episodes}
              activeEpisodeNumber={activeEpisodeNumber}
              projectId={projectId ?? undefined}
            />
          </div>
        </div>

        {/* 缩放工具栏（对齐 PromptChainCanvas：top-right 位置） */}
        <ZoomToolbar
          panZoom={panZoom}
          orientation="vertical"
          style={{ position: 'absolute', top: 10, right: 10, zIndex: 3 }}
        />
      </div>
    </Modal>
  );
}
