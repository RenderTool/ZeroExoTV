/**
 * StoryboardSheet - 画布"分镜节点"独立页面壳
 *
 * 布局：状态栏（集切换 + 分镜计数）→ 主体资产管理（StoryboardSubjectManager）；
 * 全屏编辑以画布顶部页签承载（StoryboardFullscreenEditor，仅主体资产页签）。
 * 数据处理逻辑已抽离至 storyboard-utils。
 */
import { memo, useState, useCallback, useEffect, useMemo, useRef, ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { ListVideo } from 'lucide-react';
import { buildTabKey, useCanvasTabStore } from '@/features/canvas-tabs/canvas-tab-store.js';
import { CanvasTabContentBoundary } from '@/features/canvas-tabs/CanvasTabContentBoundary.js';
import { Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { useReactGraphStore, useGraph } from '@zeroexo/plugin-render-react';
import { nodeActionBus } from '@zeroexo/plugin-nodes';
import type { StoryboardNodeData } from './storyboard-types';
import type { ProductionItem, ProductionItemKind, ProductionItemImage } from '../production-manager/production-manager-types';
import { createProductionItem } from '../production-manager/production-manager-types';
import type { SubjectTree } from './subject-tree-types';
import { ensureStableKeys, cloneTrees } from './subject-tree-diff';
import { createNewShot, normalizeUpdate } from './storyboard-utils';
import { FullscreenDropdown, fullToolBtnStyle } from './components/FullscreenDropdown';
import { displayEpisodeTitle, hasCustomEpisodeTitle } from '@/entities/script-store.js';
import { StoryboardSubjectManager } from './StoryboardSubjectManager';
import { StoryboardFullscreenEditor } from './storyboard-fullscreen-editor';
import { generateFrame } from './workbench-frame-api';
import { listAssets } from '@/features/asset-picker/asset-store.js';
import { findCanvasScript, parseScriptEpisodes } from '@/services/canvas-script.js';
import { getCurrentCanvasId } from '@/shared/current-canvas-id.js';
import { RegenModal } from './components/StoryboardToolbar';

export interface StoryboardSheetProps {
  nodeId: string;
  data: StoryboardNodeData;
  onDataChange: (data: StoryboardNodeData) => void;
}

export const StoryboardSheet = memo(function StoryboardSheet({ nodeId, data, onDataChange }: StoryboardSheetProps): ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const store = useReactGraphStore();
  const graph = useGraph(store);

  // 画布图数据
  const linkedScript = useMemo(() => {
    const edges = graph.edges.filter((e) => e.target?.nodeId === nodeId && e.source?.pinId === 'output');
    if (edges.length === 0) return undefined;
    const sd = data as StoryboardNodeData;
    const preferred = edges.find((e) => e.source?.nodeId === sd.sourceScriptId) ?? edges[0]!;
    return graph.nodes.find((n) => n.id === preferred.source?.nodeId && n.type === 'script');
  }, [graph, nodeId, data]);

  // 本地版（2026-11-02）：一个画布对应一个剧本 —— 未连剧本节点时回落到本画布绑定的剧本资产
  const [canvasScriptEpisodes, setCanvasScriptEpisodes] = useState<Array<{ id: string; title?: string; content?: string }>>([]);
  useEffect(() => {
    const canvasId = getCurrentCanvasId();
    if (!canvasId) return;
    let cancelled = false;
    void listAssets().then((list) => {
      if (cancelled) return;
      setCanvasScriptEpisodes(parseScriptEpisodes(findCanvasScript(list, canvasId)));
    });
    return () => { cancelled = true; };
  }, []);

  const scriptEpisodes = useMemo(() => {
    if (!linkedScript) return canvasScriptEpisodes;
    return ((linkedScript.data ?? {}) as { episodes?: unknown[] }).episodes ?? [];
  }, [linkedScript, canvasScriptEpisodes]) as Array<{ id: string; title?: string; content?: string }>;
  const episodeLabel = useCallback((ep: { title?: string }, idx: number) => {
    const defaultTitle = t('storyboard.episodeLabel', { number: idx + 1 });
    // 2026-11-04：hasCustomEpisodeTitle 统一判定——默认(含空格变体)/空/脏值(如「第1集2集」)均不拼标题
    return hasCustomEpisodeTitle(ep.title, idx + 1)
      ? `${defaultTitle} · ${displayEpisodeTitle(ep.title, idx + 1)}`
      : defaultTitle;
  }, [t]);

  // 当前集
  const activeEpisodeId = useMemo(() => {
    const stored = data.activeEpisodeId;
    if (stored && scriptEpisodes.some((e) => e.id === stored)) return stored;
    return scriptEpisodes[0]?.id ?? stored ?? '_legacy';
  }, [data.activeEpisodeId, scriptEpisodes]);
  const hasByEpisode = useMemo(() => Object.keys(data.shotsByEpisode ?? {}).length > 0, [data.shotsByEpisode]);
  const shots = data.shotsByEpisode?.[activeEpisodeId] ?? (hasByEpisode ? [] : (data.shots ?? []));
  const activeEpisode = scriptEpisodes.find((e) => e.id === activeEpisodeId) ?? scriptEpisodes[0];
  const activeEpisodeIndex = Math.max(0, scriptEpisodes.findIndex((e) => e.id === activeEpisodeId));

  // UI 状态
  // Plan#50:分镜全屏编辑改为顶部页签承载——本地不再持有 fullscreenOpen,显示与否由 tab store 决定
  const myTabKey = buildTabKey('storyboard', nodeId);
  const tabActive = useCanvasTabStore((s) => s.activeTabKey === myTabKey);
  const tabHost = useCanvasTabStore((s) => s.contentHost);
  const openTab = useCanvasTabStore((s) => s.openTab);
  const closeTab = useCanvasTabStore((s) => s.closeTab);
  const openStoryboardTab = useCallback(() => {
    openTab({ kind: 'storyboard', id: nodeId, title: '分镜' });
  }, [openTab, nodeId]);
  const [regenMeta, setRegenMeta] = useState<null | { episodeId: string; episodeTitle?: string }>(null);
  const [regenStep, setRegenStep] = useState(0);
  const [regenOption, setRegenOption] = useState<'overwrite' | 'compare'>('overwrite');

  // 主题色
  const textColor = theme.toolbar.text;
  const mutedColor = theme.toolbar.textMuted;
  const cardBorder = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  // 数据变更
  const updateData = useCallback((updater: (prev: StoryboardNodeData) => StoryboardNodeData) => {
    const next = normalizeUpdate(data, activeEpisodeId, updater);
    store.updateNodeData(nodeId, { ...next });
    onDataChange(next);
  }, [data, activeEpisodeId, nodeId, store, onDataChange]);

  // ===== Plan#55 A3（征集 #121）：分镜生成后 entities（AI 主体字典）同步为 productionItems 占位卡 =====
  // 消除「表格有主体、主体页空白」断层：entities/aiSubjects 有值而 productionItems 缺对应条目时，自动补占位卡。
  // 幂等：以名称匹配，已存在同名条目则跳过；同步写回后 re-render 不会再触发（条目已存在）。
  useEffect(() => {
    const entities = data.entities ?? [];
    const aiSubjects = data.aiSubjects ?? [];
    const items = data.productionItems ?? [];
    const existingNames = new Set(items.map((it) => it.name.trim()));
    const additions: ProductionItem[] = [];

    // 1. 同步 data.entities（StoryboardEntity[]）
    for (const ent of entities) {
      if (!ent || !ent.name || !ent.name.trim()) continue;
      if (existingNames.has(ent.name.trim())) continue;
      const kind = (ent.kind as ProductionItemKind) || 'character';
      const item = createProductionItem(kind, ent.name.trim());
      item.aliases = [];
      item.consistency = (ent.description ?? '').slice(0, 200);
      item.note = '由分镜主体自动同步生成（占位卡）';
      item.episodeIds = [];
      additions.push(item);
      existingNames.add(item.name);
    }

    // 2. 同步 data.aiSubjects（AiSubject[]，AI 生成直接返回的主体字典）
    // BUG 修复 2026-09-02：aiSubjects 此前只在表格中，主体卡片网格（全屏/节点）缺失。
    for (const sub of aiSubjects) {
      if (!sub || !sub.name || !sub.name.trim()) continue;
      if (existingNames.has(sub.name.trim())) continue;
      const kind = sub.kind || 'character';
      const item = createProductionItem(kind, sub.name.trim());
      item.aliases = sub.aliases ?? [];
      item.consistency = (sub.description ?? '').slice(0, 200);
      item.note = '由 AI 分镜生成自动同步（占位卡）';
      item.episodeIds = [];
      additions.push(item);
      existingNames.add(item.name);
    }

    if (additions.length === 0) return;
    updateData((prev) => ({ ...prev, productionItems: [...(prev.productionItems ?? []), ...additions] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.entities, data.aiSubjects, data.productionItems]);

  // 导航
  const handleEpisodeChange = useCallback((epId: string) => {
    if (epId === activeEpisodeId) return;
    updateData((prev) => ({ ...prev, activeEpisodeId: epId }));
  }, [activeEpisodeId, updateData]);
  const handleOverwriteRegen = useCallback(() => { if (regenMeta) { nodeActionBus.emit('storyboard:regenerateEpisode', { nodeId, episodeId: regenMeta.episodeId }); setRegenMeta(null); } }, [nodeId, regenMeta]);
  const handleNewCompareRegen = useCallback(() => {
    if (!regenMeta || !linkedScript) return;
    nodeActionBus.emit('storyboard:generateMultiple', { scriptNodeId: linkedScript.id, episodeIds: [regenMeta.episodeId], autoGenerate: true } as any);
    setRegenMeta(null);
  }, [linkedScript, regenMeta]);

  // Shot CRUD
  const handleAddShot = useCallback(() => {
    const newShot = createNewShot(shots);
    updateData((prev) => ({ ...prev, shots: [...prev.shots, newShot] }));
  }, [updateData, shots]);

  // ===== 2026-08-30 主体库条目 CRUD（卡片网格新建/编辑/删除，productionItems） =====
  const handleAddProductionItem = useCallback((kind: ProductionItemKind) => {
    const item = createProductionItem(kind);
    const sameKindCount = (data.productionItems ?? []).filter((i) => i.kind === kind).length;
    const kindLabel = kind === 'character' ? t('entity.character') : kind === 'scene' ? t('entity.scene') : t('entity.prop');
    item.name = `${kindLabel} ${sameKindCount + 1}`;
    updateData((prev) => ({ ...prev, productionItems: [...(prev.productionItems ?? []), item] }));
  }, [data.productionItems, updateData, t]);

  const handleUpdateProductionItem = useCallback((itemId: string, patch: Partial<ProductionItem>) => {
    updateData((prev) => ({
      ...prev,
      productionItems: (prev.productionItems ?? []).map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
    }));
  }, [updateData]);

  const handleDeleteProductionItem = useCallback((itemId: string) => {
    updateData((prev) => ({
      ...prev,
      productionItems: (prev.productionItems ?? []).filter((it) => it.id !== itemId),
    }));
  }, [updateData]);

  /** 分镜主体库图片生成（AI 生成 + 记录历史） */
  const handleGenerateSubjectImage = useCallback(async (item: ProductionItem, prompt: string) => {
    try {
      const shot = { number: 0, description: prompt, imagePrompt: prompt } as any;
      const { storageKey } = await generateFrame(shot, 'firstFrame');
      const newImage: ProductionItemImage = { storageKey, tags: [] };
      updateData((prev) => ({
        ...prev,
        productionItems: (prev.productionItems ?? []).map((i) =>
          i.id === item.id
            ? { ...i, images: [...(i.images ?? []), newImage], coverKey: i.coverKey || storageKey }
            : i,
        ),
      }));
      // Plan#69: 产出记录由后端 AiGeneration 自动落库(workbench-frame-api 已带 projectId),
      // 抽屉「画布资产」直接查后端,无需再 emit 内存事件
    } catch (err) {
      console.error('[storyboard] generate subject image failed', err);
    }
  }, [updateData, nodeId]);

  // ===== 2026-08-31 主体树重构：变更写回 node.data.subjectTree（root+states 树） =====
  // Task2（双份数据）：B 份（用户当前主体树）写 subjectTree；A 份（AI 幂等关联表）写 subjectAiIndex。
  // - A 份是「最后一段 AI 已拍板的基线快照」，一旦建立不随用户编辑变动 → 用户改名/增删状态即产生 A/B 错位。
  // - 首次写入时（无 A 份）以当前树建立 A 基线；后续 B 份变化保留 A 快照，供出片连入 diffSubjectTree 对比。
  // - 两表都随 node.data Yjs 持久化 → 刷新/跨会话不丢。
  const handleChangeSubjectTree = useCallback((trees: SubjectTree[]) => {
    updateData((prev) => {
      // B 份：注入稳定幂等键（缺键补全，保证可对齐）
      const nextB = ensureStableKeys(trees);
      // A 份：仅当不存在时用 B 克隆建立；已存在则保留原快照（不随用户编辑漂移）
      const nextA = (prev.subjectAiIndex?.length ? prev.subjectAiIndex : cloneTrees(nextB));
      return { ...prev, subjectTree: nextB, subjectAiIndex: nextA };
    });
  }, [updateData]);

  // 2026-09-04 征集 #152：删除 handleAddAiState（假 AI 入口的回写器）。
  // 它原本无条件 `subjectAiIndex: cloneTrees(nextB)` 覆盖 A 基线，而唯一触发源是
  // 主体树底部那个「✨ AI 生成状态」按钮——零 AI 调用，只本地插一张 source:'ai' 空卡，
  // 导致用户手点一次就把 AI 基线冲成用户态数据（违反上方「A 份不随用户编辑漂移」契约）。
  // 产品约定：主体状态的 AI 生成一律走画布 Agent 聊天，编辑器内不设 AI 按钮。
  // subjectAiIndex 的合法写入方仅剩两处真 AI 链路：
  //   - canvas-op-bridge.ts（Agent save_subject_tree 工具产出）
  //   - use-storyboard.ts（分镜生成任务返回 aiTree）

  // 事件订阅(使用 ref 稳定回调引用,避免因 data 变化导致 useEffect 反复重订阅)
  const handleAddShotRef = useRef(handleAddShot);
  handleAddShotRef.current = handleAddShot;
  const scriptEpisodesRef = useRef(scriptEpisodes);
  scriptEpisodesRef.current = scriptEpisodes;
  useEffect(() => {
    const unsubs = [
      nodeActionBus.on('storyboard:addShot', (e) => { if (e.nodeId === nodeId) handleAddShotRef.current(); }),
      nodeActionBus.on('storyboard:fullscreen', (e) => { if (e.nodeId === nodeId) openStoryboardTab(); }),
      // 2026-08-21 BUG 修复: capsule 菜单"重新生成"有分镜内容时弹出确认弹窗
      nodeActionBus.on('storyboard:requestRegenerate', (e: { nodeId: string; episodeId?: string }) => {
        if (e.nodeId !== nodeId) return;
        const ep = (scriptEpisodesRef.current as Array<{ id: string; title?: string }>).find((ep) => ep.id === e.episodeId);
        setRegenMeta({ episodeId: e.episodeId ?? '', episodeTitle: ep?.title });
        setRegenStep(0);
        setRegenOption('overwrite');
      }),
    ];
    return () => unsubs.forEach((u) => u?.());
  }, [nodeId, openStoryboardTab]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden', cursor: 'default' }}>
      {/* 状态栏 */}
      <div style={{ padding: '6px 12px', borderBottom: `1px solid ${cardBorder}`, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: isDark ? '#1b1b1b' : '#fafaf7', flexShrink: 0, position: 'relative' }}>
        <div style={{ flex: 1 }} />
        {scriptEpisodes.length > 0 ? (
          <FullscreenDropdown onSelect={handleEpisodeChange} options={scriptEpisodes.map((ep, idx) => ({ key: ep.id, label: episodeLabel(ep, idx), active: ep.id === activeEpisodeId }))}>
            <Button size="small" type="text" icon={<ListVideo size={14} />} style={{ ...fullToolBtnStyle, color: textColor }}>{episodeLabel(scriptEpisodes[activeEpisodeIndex] ?? { title: undefined }, activeEpisodeIndex)}</Button>
          </FullscreenDropdown>
        ) : (
          <span style={{ fontSize: 11, color: mutedColor, display: 'inline-flex', alignItems: 'center', gap: 4 }}><ListVideo size={14} />{activeEpisode ? activeEpisode.title || t('storyboardTable.currentEpisode') : t('storyboardTable.currentEpisode')}</span>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: mutedColor }}>{t('storyboard.shotCountSummary', { count: shots.length })}</span>
      </div>

      {/* 内容区域：主体资产管理（productionItems 卡片网格） */}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <StoryboardSubjectManager
          items={data.productionItems ?? []}
          onChange={(items) => updateData((prev) => ({ ...prev, productionItems: items }))}
          onGenerateImage={handleGenerateSubjectImage}
          store={store}
          nodeId={nodeId}
        />
      </div>

      {/* Plan#50:分镜编辑器改为画布顶部页签内嵌呈现(不再全屏覆盖)——幂等 key = storyboard:<nodeId>;
          关闭统一走页签 X(closeTab) */}
      {tabActive && tabHost ? createPortal(
        // data-storyboard-tab-content：分镜页签内容标记（2026-11-04 起仅作结构标记；
        // 空态兜底已由页级 StoryboardTabContent 承担，原 StoryboardTabGuard 已删除）
        <div data-storyboard-tab-content style={{ position: 'absolute', inset: 0 }}>
        <CanvasTabContentBoundary>
        <StoryboardFullscreenEditor
          open
          embedded
          onClose={() => closeTab(myTabKey)}
          episodes={scriptEpisodes}
          activeEpisodeId={activeEpisodeId}
          onEpisodeChange={handleEpisodeChange}
          productionItems={data.productionItems ?? []}
          subjectTree={data.subjectTree}
          colorCard={data.colorCard}
          onChangeTree={handleChangeSubjectTree}
          onAddItem={handleAddProductionItem}
          onUpdateItem={handleUpdateProductionItem}
          onDeleteItem={handleDeleteProductionItem}
          />
        </CanvasTabContentBoundary>
        </div>,
        tabHost,
        ) : null}

      {/* 弹窗 */}
      <RegenModal regenMeta={regenMeta} regenStep={regenStep} regenOption={regenOption} onStepChange={setRegenStep} onOptionChange={setRegenOption} onCancel={() => setRegenMeta(null)} onOverwriteRegen={handleOverwriteRegen} onNewCompareRegen={handleNewCompareRegen} linkedScript={linkedScript} />
    </div>
  );
});
