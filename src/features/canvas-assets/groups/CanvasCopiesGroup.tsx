/**
 * canvas-assets/groups/CanvasCopiesGroup - 抽屉「画布」分组（Plan#84，2026-11-06）
 *
 * 用户口径（征集#184）：“抽屉里要有一个地方能看到这些保存下来的画布，列表形式和主页一致，
 * 可以编辑封面、重命名等，并且多一个可以存成独立项目。”
 *
 * 所以这里**不另造一套卡片**：直接用主页同款 `ProjectCard`（封面+标题+更新时间+三点菜单）
 * 与同款 `CoverUploadModal`（同一套 `platform/cover.ts` 封面机制），数据源 = `entities/canvas-store`。
 *
 * 卡片语义（与"项目 = N 份平级画布"一致）：
 * - **1 号主画布排在最前**，`locked`：不给删除、不给"存为独立项目"（它已经是一个项目了），点开 = 回 1 号；
 * - 副本：点开 = 顶层标签并排打开该副本；重命名/设封面只写画布文档；删除只删文档并关掉对应标签；
 * - 空态文案直接教怎么做（框选 → 胶囊「保存为画布副本」），不放假数据。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { App, Input, Modal } from 'antd';
import { SquareArrowOutUpRight } from 'lucide-react';
import type { ThemeConfig } from '@zeroexo/shared';
import {
  CoverUploadModal,
  ProjectCard,
  type ProjectCardAction,
} from '@/shared/components/index.js';
import { getCurrentCanvasId } from '@/shared/current-canvas-id.js';
import { resolveCoverUrl } from '@/platform/cover.js';
import { useCanvasTabStore } from '@/features/canvas-tabs/canvas-tab-store.js';
import {
  deleteCanvas,
  listCanvases,
  MAIN_CANVAS_ID,
  saveCanvas,
  type CanvasSummary,
} from '@/entities/canvas-store.js';
import { replaceCanvasCover } from '@/features/sub-canvas/canvas-cover.js';
import { promoteCanvasToProject } from '@/features/sub-canvas/canvas-promote.js';
import { EmptyState, SearchBox, ToolbarRow } from '../components/common.js';
import type { CanvasAssetsPanelStore } from '../store.js';

export interface CanvasCopiesGroupProps {
  store: CanvasAssetsPanelStore;
  theme: ThemeConfig;
}

const GRID_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 190px), 1fr))',
  gap: 16,
  alignContent: 'start',
  padding: '0 20px 16px',
  overflowY: 'auto',
  minHeight: 0,
};

export function CanvasCopiesGroup({ store, theme }: CanvasCopiesGroupProps) {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const projectId = getCurrentCanvasId() ?? '';
  const [items, setItems] = useState<CanvasSummary[]>([]);
  const [covers, setCovers] = useState<Record<string, string | null>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [renaming, setRenaming] = useState<{ cid: string; title: string } | null>(null);
  const [coverTarget, setCoverTarget] = useState<{ cid: string; current: string | null } | null>(null);

  const openCanvasTab = useCanvasTabStore((s) => s.openCanvasTab);
  const closeCanvasTab = useCanvasTabStore((s) => s.closeCanvasTab);
  const renameCanvasTab = useCanvasTabStore((s) => s.renameCanvasTab);
  const activateTab = useCanvasTabStore((s) => s.activateTab);

  // 列表 + 封面 URL（blob URL 每次重载重新解析；卸载/刷新前释放，避免泄漏）
  useEffect(() => {
    if (!projectId) { setItems([]); setCovers({}); return; }
    let cancelled = false;
    const urls: string[] = [];
    void (async () => {
      try {
        const list = await listCanvases(projectId);
        if (cancelled) return;
        setItems(list);
        const resolved: Record<string, string | null> = {};
        for (const c of list) {
          const url = await resolveCoverUrl(c.coverKey);
          resolved[c.id] = url;
          if (url) urls.push(url);
        }
        if (!cancelled) setCovers(resolved);
      } catch (err) {
        // 未授权目录/读失败：显示空列表并给一次提示，绝不编造数据
        console.error('[CanvasCopiesGroup] 画布列表读取失败:', err);
        if (!cancelled) { setItems([]); setCovers({}); }
      }
    })();
    return () => {
      cancelled = true;
      // revoke 交给浏览器回收：这些 URL 同时被卡片 <img> 用着，此处不主动 revoke（与主页同处理）
    };
  }, [projectId, refreshKey]);

  const filtered = useMemo(() => {
    const kw = store.search.trim().toLowerCase();
    if (!kw) return items;
    // 1 号永远留着（用户不会想搜不到主画布），其余按标题过滤
    return items.filter((c) => c.id === MAIN_CANVAS_ID || c.title.toLowerCase().includes(kw));
  }, [items, store.search]);

  const open = useCallback((c: CanvasSummary) => {
    if (c.id === MAIN_CANVAS_ID) {
      activateTab('canvas');
      return;
    }
    openCanvasTab({ cid: c.id, title: c.title });
  }, [activateTab, openCanvasTab]);

  const commitRename = useCallback(async () => {
    if (!renaming || !projectId) return;
    const next = renaming.title.trim();
    const target = items.find((c) => c.id === renaming.cid);
    setRenaming(null);
    if (!target || !next || next === target.title) return;
    try {
      const got = await listCanvases(projectId);
      const fresh = got.find((c) => c.id === renaming.cid);
      await saveCanvas(projectId, renaming.cid, { title: next }, null);
      renameCanvasTab(renaming.cid, next);
      setRefreshKey((k) => k + 1);
      void fresh;
      message.success(t('canvasCopy.renamed', '已重命名'));
    } catch (err) {
      console.error('[CanvasCopiesGroup] 重命名失败:', err);
      message.error(t('canvasCopy.renameFailed', '重命名失败，请重试'));
    }
  }, [renaming, projectId, items, renameCanvasTab, message, t]);

  const askDelete = useCallback((c: CanvasSummary) => {
    modal.confirm({
      centered: true,
      okType: 'danger',
      title: t('canvasCopy.deleteTitle', '删除这块画布副本？'),
      content: t('canvasCopy.deleteBody', {
        name: c.title,
        nodeCount: c.nodeCount,
        defaultValue: `「${c.title}」的文件会被删除（${c.nodeCount} 个节点），不可恢复。1 号主画布不受影响。`,
      }),
      okText: t('common.delete', '删除'),
      cancelText: t('common.cancel', '取消'),
      onOk: async () => {
        try {
          await deleteCanvas(projectId, c.id);
          closeCanvasTab(`canvas:${c.id}`);
          setRefreshKey((k) => k + 1);
          message.success(t('canvasCopy.deleted', '画布副本已删除'));
        } catch (err) {
          console.error('[CanvasCopiesGroup] 删除失败:', err);
          message.error(t('canvasCopy.deleteFailed', '删除失败，请重试'));
        }
      },
    });
  }, [modal, t, projectId, closeCanvasTab, message]);

  const askPromote = useCallback((c: CanvasSummary) => {
    modal.confirm({
      centered: true,
      title: t('canvasCopy.promoteTitle', '存为独立项目？'),
      // Q3 已拍：不物理复制素材 ⇒ 这句话必须让用户看见，不能藏在文档里
      content: t('canvasCopy.promoteBody', `「${c.title}」会成为一个新项目的 1 号画布；素材仍位于当前项目目录（要彻底搬走请用导出/导入）。当前副本会保留。`),
      okText: t('canvasCopy.promoteOk', '存为新项目'),
      cancelText: t('common.cancel', '取消'),
      onOk: async () => {
        try {
          const res = await promoteCanvasToProject(projectId, c.id);
          message.success(t('canvasCopy.promoted', {
            name: res.title,
            defaultValue: `已独立为项目「${res.title}」`,
          }));
          window.location.hash = `#/editor/${res.newProjectId}`;
        } catch (err) {
          console.error('[CanvasCopiesGroup] 独立成新项目失败:', err);
          message.error(err instanceof Error ? err.message : t('canvasCopy.promoteFailed', '独立成新项目失败'));
        }
      },
    });
  }, [modal, t, projectId, message]);

  const confirmCover = useCallback(async (file: File) => {
    if (!coverTarget || !projectId) return;
    try {
      await replaceCanvasCover(projectId, coverTarget.cid, file);
      setRefreshKey((k) => k + 1);
      message.success(t('canvasCopy.coverUpdated', '封面已更新'));
    } catch (err) {
      console.error('[CanvasCopiesGroup] 封面写入失败:', err);
      message.error(t('canvasCopy.coverFailed', '封面保存失败，请重试'));
    } finally {
      setCoverTarget(null);
    }
  }, [coverTarget, projectId, message, t]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <ToolbarRow>
        <SearchBox
          value={store.search}
          onChange={store.setSearch}
          placeholder={t('canvasCopy.searchPlaceholder', '搜索画布')}
          theme={theme}
          inputData={{ 'data-canvas-search': '' }}
        />
      </ToolbarRow>

      {filtered.length === 0 ? (
        <EmptyState
          theme={theme}
          text={items.length === 0
            ? t('canvasCopy.drawerEmpty', '还没有画布副本：在画布上框选节点 → 点胶囊「保存为画布副本」')
            : t('common.noMatch', '没有匹配项')}
        />
      ) : (
        <div style={GRID_STYLE} data-canvas-list>
          {filtered.map((c) => {
            const isMain = c.id === MAIN_CANVAS_ID;
            const actions: ProjectCardAction[] = [
              { type: 'cover', label: t('canvasCopy.setCover', '设封面'), onClick: () => setCoverTarget({ cid: c.id, current: covers[c.id] ?? null }) },
              { type: 'rename', label: t('canvasCopy.rename', '重命名'), onClick: () => setRenaming({ cid: c.id, title: c.title }) },
            ];
            if (isMain) {
              actions.unshift({ type: 'custom', label: t('canvasCopy.openMain', '打开 1 号画布'), icon: <SquareArrowOutUpRight size={14} />, onClick: () => open(c) });
            } else {
              actions.unshift({ type: 'custom', label: t('canvasCopy.open', '打开'), icon: <SquareArrowOutUpRight size={14} />, onClick: () => open(c) });
              actions.push({ type: 'custom', label: t('canvasCopy.promote', '存为独立项目'), onClick: () => askPromote(c) });
              actions.push({ type: 'delete', label: t('canvasCopy.delete', '删除副本'), onClick: () => askDelete(c) });
            }
            return (
              <div key={c.id} data-canvas-card={c.id}>
                <ProjectCard
                  title={isMain ? `${c.title}（${t('canvasCopy.mainTag', '主画布')}）` : c.title}
                  cover={covers[c.id] ?? undefined}
                  updateTime={`${t('home.updatedAt')} ${c.updatedAt ? new Date(c.updatedAt).toLocaleDateString() : '-'}`}
                  onClick={() => open(c)}
                  actions={actions}
                />
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={!!renaming}
        centered
        title={t('canvasCopy.rename', '重命名')}
        okText={t('common.confirm', '确定')}
        cancelText={t('common.cancel', '取消')}
        onOk={() => void commitRename()}
        onCancel={() => setRenaming(null)}
        destroyOnClose
      >
        <Input
          autoFocus
          value={renaming?.title ?? ''}
          maxLength={60}
          onChange={(e) => setRenaming((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
          onPressEnter={() => void commitRename()}
        />
      </Modal>

      {coverTarget && (
        <CoverUploadModal
          open
          onCancel={() => setCoverTarget(null)}
          onConfirm={(file: File) => void confirmCover(file)}
          initialCover={coverTarget.current ?? undefined}
        />
      )}
    </div>
  );
}
