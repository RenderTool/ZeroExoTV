/**
 * SubjectLinkDialog - 画布右键「发送到主体」目标选择弹层（2026-11-04 约定）
 *
 * 流程：资产节点右键 → 发送到主体 → 本弹层：
 *   主体搜索/列表 → 该主体的状态列表 → 单击状态即写入并关闭。
 *   - 目标状态已有媒体 → 直接替换（不走确认框）+ 3 秒轻提示（可撤销恢复旧引用）
 *   - 主体无状态 → 「新建状态」自动建一个带形象名称前缀的状态（buildDefaultStateName）
 *   - 主体无树（主体库只建过条目、从未打开详情）→ 按条目自动建树后再建状态
 *
 * 写入统一走 linkSubjectStateMedia（与主体库内上传/来源面板同一函数）。
 * Host 渲染在 editor-page 应用树内（antd App / Theme 上下文可用）。
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { App as AntdApp, Input, Modal } from 'antd';
import {
  AudioLines, ChevronDown, ChevronRight, Film, Image as ImageIcon, Plus, Send,
} from 'lucide-react';
import { create as zustandCreate } from 'zustand';
import { useTranslation } from 'react-i18next';
import {
  readStoryboardContainer,
  updateStoryboardContainer,
} from '@/entities/slot-containers.js';
import { useCanvasTabStore } from '@/features/canvas-tabs/canvas-tab-store.js';
import {
  createSubjectNode,
  createSubjectTree,
  buildDefaultStateName,
  migrateSubjectTrees,
  nextStateStep,
  type SubjectTree,
} from './subject-tree-types';
import { buildBaseStatePrompt } from './subject-prompt-templates';
import {
  linkSubjectStateMedia,
  findSubjectMediaUsage,
  useSubjectMediaLinkEventStore,
  type SubjectStateMediaAsset,
  type SubjectStateMediaKind,
} from './subject-state-media';
import type { ProductionItem, ProductionItemKind } from '../production-manager/production-manager-types';

/** 容器读出（subjectTree/entities 为 unknown[]，在此收口类型断言） */
async function readTreesForLink(pid: string): Promise<SubjectTree[]> {
  const container = await readStoryboardContainer(pid);
  return migrateSubjectTrees(container?.subjectTree);
}
async function readEntitiesForLink(pid: string): Promise<ProductionItem[]> {
  const container = await readStoryboardContainer(pid);
  return (container?.entities as ProductionItem[] | undefined) ?? [];
}

// ===== 打开状态（模块级 store：use-node-actions 右键菜单 → openSubjectLinkDialog）=====

export interface SubjectLinkDialogPayload {
  storageKey: string;
  kind: SubjectStateMediaKind;
  fromNodeId?: string;
  sourceLabel?: string;
}

interface SubjectLinkDialogStore {
  payload: SubjectLinkDialogPayload | null;
  open: (p: SubjectLinkDialogPayload) => void;
  close: () => void;
}

export const useSubjectLinkDialogStore = zustandCreate<SubjectLinkDialogStore>((set) => ({
  payload: null,
  open: (payload) => set({ payload }),
  close: () => set({ payload: null }),
}));

/** 右键菜单调用：打开「发送到主体」弹层 */
export function openSubjectLinkDialog(payload: SubjectLinkDialogPayload): void {
  useSubjectLinkDialogStore.getState().open(payload);
}

/** 记住上次发送目标，下次打开默认定位（需求：默认定位到当前选中状态） */
let lastTarget: { rootId: string; stateId: string } | null = null;

/** Host：挂在 editor-page 应用树内，只做「开/关 + 取 projectId」 */
export const SubjectLinkDialogHost = memo(function SubjectLinkDialogHost(): React.ReactElement | null {
  const payload = useSubjectLinkDialogStore((s) => s.payload);
  const close = useSubjectLinkDialogStore((s) => s.close);
  const projectId = useCanvasTabStore((s) => s.slotBindings.script);
  if (!payload || !projectId) return null;
  return <SubjectLinkDialog projectId={projectId} payload={payload} onClose={close} />;
});

interface SubjectLinkDialogProps {
  projectId: string;
  payload: SubjectLinkDialogPayload;
  onClose: () => void;
}

function SubjectLinkDialog({ projectId, payload, onClose }: SubjectLinkDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const { message: antdMessage } = AntdApp.useApp();
  const [trees, setTrees] = useState<SubjectTree[]>([]);
  const [entities, setEntities] = useState<ProductionItem[]>([]);
  const [expandedRootId, setExpandedRootId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // 打开时读容器（主体树 + 主体条目兜底）
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const [loadedTrees, loadedEntities] = await Promise.all([readTreesForLink(projectId), readEntitiesForLink(projectId)]);
      if (cancelled) return;
      setTrees(loadedTrees);
      setEntities(loadedEntities);
      // 默认定位上次发送目标（树还在才定位）
      setExpandedRootId(lastTarget && loadedTrees.some((tr) => tr.rootId === lastTarget!.rootId) ? lastTarget.rootId : null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const usage = useMemo(() => findSubjectMediaUsage(trees, payload.storageKey), [trees, payload.storageKey]);

  const filteredTrees = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return trees;
    return trees.filter((tr) => tr.name.toLowerCase().includes(kw));
  }, [trees, search]);

  /** 发送：统一走 linkSubjectStateMedia + 容器写回 + 事件广播 + 3 秒可撤销轻提示 */
  const sendToState = useCallback(async (rootId: string, stateId: string) => {
    const current = await readTreesForLink(projectId);
    const asset: SubjectStateMediaAsset = {
      storageKey: payload.storageKey,
      kind: payload.kind,
      origin: { type: 'canvas', fromNodeId: payload.fromNodeId, label: payload.sourceLabel },
    };
    const { replaced, trees: linkedTrees } = await linkSubjectStateMedia({ trees: current, projectId, rootId, stateId, asset });
    await updateStoryboardContainer(projectId, { subjectTree: linkedTrees });
    lastTarget = { rootId, stateId };
    useSubjectMediaLinkEventStore.getState().emit({ rootId, stateId });

    const tree = linkedTrees.find((tr) => tr.rootId === rootId);
    const stateName = tree?.states.find((n) => n.id === stateId)?.state ?? '';
    const subjectName = tree?.name ?? '';
    const toastKey = `subject-link-${Date.now()}`;
    const undo = async () => {
      const freshTrees = await readTreesForLink(projectId);
      const restore = replaced?.key
        ? { storageKey: replaced.key, kind: replaced.type, origin: replaced.origin }
        : null;
      const { trees: undoneTrees } = await linkSubjectStateMedia({ trees: freshTrees, projectId, rootId, stateId, asset: restore });
      await updateStoryboardContainer(projectId, { subjectTree: undoneTrees });
      useSubjectMediaLinkEventStore.getState().emit({ rootId, stateId });
      antdMessage.success({ key: toastKey, content: t('subject.undoDone', '已撤销，恢复原内容') });
    };
    // 3 秒可撤销轻提示（替换不弹确认框）：撤销按钮内嵌 content（antd message ArgsProps 无 btn 槽）
    antdMessage.open({
      key: toastKey,
      type: 'success',
      duration: 3,
      content: (
        <span>
          {replaced
            ? t('subject.replacedToast', { subject: subjectName, state: stateName })
            : t('subject.linkedToast', { subject: subjectName, state: stateName })}
          {' '}
          <button
            type="button"
            onClick={() => { void undo(); }}
            style={{ border: 'none', background: 'transparent', color: '#1677ff', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', padding: 0 }}
          >
            {t('subject.undo', '撤销')}
          </button>
        </span>
      ),
    });
    onClose();
  }, [projectId, payload, antdMessage, t, onClose]);

  /** 新建状态（带形象名称前缀）并发送 */
  const createAndSend = useCallback(async (rootId: string) => {
    const current = await readTreesForLink(projectId);
    const tr = current.find((x) => x.rootId === rootId);
    if (!tr) return;
    const step = nextStateStep(tr);
    const node = createSubjectNode(
      buildDefaultStateName(tr.name, step, (n) => t('subject.stateLabelN', { n, defaultValue: `状态${n}` })),
      'text', 'user', rootId, { step },
    );
    const withNode = current.map((x) => (x.rootId === rootId ? { ...x, states: [...x.states, node] } : x));
    await updateStoryboardContainer(projectId, { subjectTree: withNode });
    await sendToState(rootId, node.id);
  }, [projectId, t, sendToState]);

  /** 主体条目兜底：没开过详情（无树）→ 按条目建树（同 SubjectDetailView 建树逻辑）再建状态 */
  const ensureTreeAndSend = useCallback(async (item: ProductionItem) => {
    const current = await readTreesForLink(projectId);
    const tr = createSubjectTree(item.kind, item.name, item.id);
    const base = tr.states[0]!;
    base.fullPrompt = buildBaseStatePrompt(item.kind, {
      roleDesc: (item as { consistency?: string }).consistency || '',
      name: item.name,
    });
    base.deltaPrompt = base.fullPrompt;
    const imgs = (item as { images?: Array<{ storageKey: string; prompt?: string }> }).images;
    if (imgs && imgs.length > 0) {
      base.media = imgs.map((r) => ({ key: r.storageKey, type: 'image' as const, prompt: r.prompt }));
    }
    const nextTrees = [...current, tr];
    await updateStoryboardContainer(projectId, { subjectTree: nextTrees });
    const step = nextStateStep(tr);
    const node = createSubjectNode(
      buildDefaultStateName(tr.name, step, (n) => t('subject.stateLabelN', { n, defaultValue: `状态${n}` })),
      'text', 'user', tr.rootId, { step },
    );
    const withNode = nextTrees.map((x) => (x.rootId === tr.rootId ? { ...x, states: [...x.states, node] } : x));
    await updateStoryboardContainer(projectId, { subjectTree: withNode });
    await sendToState(tr.rootId, node.id);
  }, [projectId, t, sendToState]);

  const kindBadge = (kind: string): React.ReactElement => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9, color: 'rgba(255,255,255,0.9)', background: 'rgba(255,255,255,0.14)', borderRadius: 999, padding: '1px 6px', flexShrink: 0 }}>
      {kind === 'audio' ? <AudioLines size={8} /> : kind === 'video' ? <Film size={8} /> : <ImageIcon size={8} />}
      {kind === 'audio' ? t('subject.mediaAudio', '音频') : kind === 'video' ? t('subject.mediaVideo', '视频') : t('subject.mediaImage', '图片')}
    </span>
  );

  const noTreeItems = useMemo(() => {
    const kw = search.trim().toLowerCase();
    const withTree = new Set(trees.map((tr) => tr.name));
    return entities.filter((it) => it && it.name && it.kind && !withTree.has(it.name)
      && (!kw || it.name.toLowerCase().includes(kw)));
  }, [entities, trees, search]);

  return (
    <Modal
      open
      onCancel={onClose}
      footer={null}
      width={460}
      centered
      destroyOnClose
      title={
        <span style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Send size={13} />
          {t('subject.linkDialogTitle', '发送到主体状态')}
        </span>
      }
      styles={{ body: { maxHeight: '62vh', overflowY: 'auto', paddingTop: 8 } }}
    >
      {/* 资产摘要 + 当前引用（双向可见：画布资产侧「被 主体X · 状态Y 使用」） */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        {kindBadge(payload.kind)}
        <span style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {payload.sourceLabel || t('subject.canvasNode', '画布')}
        </span>
      </div>
      {usage.length > 0 && (
        <div style={{ fontSize: 10, color: 'rgba(22,119,255,0.9)', marginBottom: 8 }}>
          {t('subject.usedBy', '当前已被引用于：')}
          {usage.map((u, i) => (
            <span key={`${u.rootId}-${u.stateId}`}>{i > 0 && '、'}{u.treeName} · {u.stateName}</span>
          ))}
        </div>
      )}
      <Input
        allowClear
        size="small"
        placeholder={t('subject.linkDialogSearch', '搜索主体…')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 8 }}
      />

      {loading && <div style={{ fontSize: 11, opacity: 0.6, padding: '8px 0' }}>{t('common.loading', '加载中…')}</div>}

      {/* 主体树列表 */}
      {filteredTrees.map((tr) => {
        const expanded = expandedRootId === tr.rootId;
        return (
          <div key={tr.rootId} style={{ borderBottom: '1px solid rgba(128,128,128,0.12)' }}>
            <button
              type="button"
              onClick={() => setExpandedRootId(expanded ? null : tr.rootId)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '7px 2px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
            >
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span style={{ fontSize: 12, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tr.name || `#${tr.rootId.slice(0, 8)}`}</span>
              <span style={{ fontSize: 9, opacity: 0.6 }}>{t('subject.stateCount', { n: tr.states.length, defaultValue: `${tr.states.length} 状态` })}</span>
            </button>
            {expanded && (
              <div style={{ paddingBottom: 8 }}>
                {tr.states.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => { void sendToState(tr.rootId, n.id); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '5px 6px 5px 18px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', borderRadius: 6 }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(22,119,255,0.08)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{ fontSize: 11, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.state || `#${n.step ?? '?'}`}</span>
                    {n.media && n.media.length > 0
                      ? <span style={{ fontSize: 9, opacity: 0.65 }}>{t('subject.hasMedia', '已有内容·将替换')}</span>
                      : <span style={{ fontSize: 9, opacity: 0.45 }}>{t('subject.emptyState', '空')}</span>}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => { void createAndSend(tr.rootId); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 6px 5px 18px', border: 'none', background: 'transparent', color: 'rgba(22,119,255,0.95)', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit', borderRadius: 6 }}
                >
                  <Plus size={11} />
                  {t('subject.linkDialogNewState', '新建状态并发送')}
                </button>
              </div>
            )}
          </div>
        );
      })}

      {/* 有条目无树（从未打开详情）→ 一键建树并发送 */}
      {noTreeItems.length > 0 && (
        <>
          <div style={{ fontSize: 10, opacity: 0.6, margin: '10px 0 2px' }}>{t('subject.entitiesWithoutTree', '尚未初始化主体树（点击自动创建并发送）')}</div>
          {noTreeItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => { void ensureTreeAndSend(item); }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '6px 2px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
            >
              <Plus size={12} />
              <span style={{ fontSize: 11, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
              <span style={{ fontSize: 9, opacity: 0.55 }}>{item.kind as ProductionItemKind}</span>
            </button>
          ))}
        </>
      )}

      {!loading && filteredTrees.length === 0 && noTreeItems.length === 0 && (
        <div style={{ fontSize: 11, opacity: 0.65, padding: '12px 0', textAlign: 'center' }}>
          {t('subject.linkDialogEmpty', '暂无主体，请先在主体库创建')}
        </div>
      )}
    </Modal>
  );
}
