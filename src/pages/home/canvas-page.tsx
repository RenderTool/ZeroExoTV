/** * CanvasPage - 画布项目列表页 * * 从原 HomePage 提取的画布项目列表功能。 * 展示用户创建的所有画布项目，支持新建、删除、重命名、搜索、选择模式、导入/导出。 */

import { useState, useMemo, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, CheckSquare, Square, Download } from 'lucide-react';
import { App, Button, Input, Modal, Typography, Space, Form, Skeleton, Tooltip } from 'antd';
import { SearchButton } from '@/shared/components/search-button.js';
import { useTheme } from '@zeroexo/plugin-theme';
import { AntdThemeProvider, ProjectCard, CoverUploadModal } from '@/shared/components/index.js';
import type { ProjectCardAction } from '@/shared/components/index.js';
import { useCoverUpload } from '@/shared/hooks/use-cover-upload.js';
import { useProjects } from './use-projects.js';
import { updateProject, loadProjectGraph, saveProjectGraph } from '@zeroexo/plugin-persistence';
import { exportProjects } from './services/export-projects.js';
import { useIsMobile } from '@/shared/hooks/use-media-query.js';
import { setProjectCover, setCoverView, getCoverView, clearCoverView, deleteCoverImage } from '@/platform/cover.js';
import type { CoverViewRecord } from '@/shared/utils/cover-viewport.js';

const { Text, Title } = Typography;

export interface CanvasPageProps {
  onOpen: (canvasId: string) => void;
}

export function CanvasPage({ onOpen }: CanvasPageProps): React.ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { message } = App.useApp();
  const isMobile = useIsMobile();
  const { projects, loading, error, createProject, copyProject, deleteProjects, renameProject, refresh } = useProjects();
  const [search, setSearch] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  // 本地版（Plan#83）：协作相关状态与接口已整块删除（无后端⇒无房间/成员/待审/退出协作）

  // 重命名弹窗
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null);

  // 封面上传 (使用共享 hook，与 HomePage 保持同一逻辑)
  const { coverState, openCoverUpload, closeCoverUpload } = useCoverUpload();
  const [busy, setBusy] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [form] = Form.useForm();

  const allProjects = useMemo(() => projects, [projects]);

  /** 搜索过滤后的全部自有画布 */
  const searchFilteredAll = useMemo(() => {
    if (!search.trim()) return allProjects;
    const keyword = search.toLowerCase();
    return allProjects.filter((p) => p.title.toLowerCase().includes(keyword));
  }, [allProjects, search]);

  /** 画布列表（本地版：无协作模式与参于分区） */
  const displayOwnProjects = searchFilteredAll;

  /** 选择模式可批量操作的项目 */
  const displayForSelect = searchFilteredAll;
  const listForRender = selectMode ? displayForSelect : displayOwnProjects;
  const isEmpty = listForRender.length === 0;

  /** 自动递增命名：生成 "未命名画布", "未命名画布 2", "未命名画布 3"... */
  const getNextProjectName = useCallback((): string => {
    const baseName = t('home.untitledProject');
    const existingNames = projects.map((p) => p.title);
    if (!existingNames.includes(baseName)) return baseName;
    let i = 2;
    while (existingNames.includes(`${baseName} ${i}`)) i++;
    return `${baseName} ${i}`;
  }, [projects, t]);

  const handleCreate = useCallback(() => {
    form.resetFields();
    setCreateModalOpen(true);
  }, [form]);

  const handleCreateConfirm = useCallback(async () => {
    try {
      const values = await form.validateFields();
      const title = (values.title || '').trim() || getNextProjectName();
      setBusy(true);
      setCreateModalOpen(false);
      const project = await createProject(title);
      if (project) {
        message.success(t('home.createSuccess'));
        // 创建后不自动打开,仅提示成功并刷新列表(与剧创行为一致,等待用户主动点击进入)
        await refresh();
      }
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      setCreateModalOpen(false);
    } finally {
      setBusy(false);
    }
  }, [createProject, t, message, form, getNextProjectName, refresh]);

  const handleCreateCancel = useCallback(() => {
    setCreateModalOpen(false);
    form.resetFields();
  }, [form]);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const enterSelectMode = useCallback(() => {
    setSelectMode(true);
    setSelectedIds(new Set());
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  /** 本地版（Plan#83）：数据目录入口已上移到顶栏 */

  const handleDelete = useCallback((id: string) => {
    setPendingDeleteId(id);
    setDeleteConfirmOpen(true);
  }, []);

  const handleBatchDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    setPendingDeleteId(null);
    setDeleteConfirmOpen(true);
  }, [selectedIds]);

  const confirmDelete = useCallback(async () => {
    if (pendingDeleteId) {
      await deleteProjects([pendingDeleteId]);
    } else if (selectedIds.size > 0) {
      await deleteProjects(Array.from(selectedIds));
      exitSelectMode();
    }
    setDeleteConfirmOpen(false);
    setPendingDeleteId(null);
  }, [pendingDeleteId, selectedIds, deleteProjects, exitSelectMode]);

  const cancelDelete = useCallback(() => {
    setDeleteConfirmOpen(false);
    setPendingDeleteId(null);
  }, []);

  // 重命名
  const handleRenameOpen = useCallback((id: string, title: string) => {
    setRenameTarget({ id, title });
    setRenameModalOpen(true);
  }, []);

  const handleRenameConfirm = useCallback(async () => {
    if (!renameTarget) return;
    try {
      await renameProject(renameTarget.id, renameTarget.title);
      setRenameModalOpen(false);
      setRenameTarget(null);
    } catch (err) {
      message.error(t('errors.BAD_REQUEST'));
    }
  }, [renameTarget, renameProject, t, message]);

  const handleRenameCancel = useCallback(() => {
    setRenameModalOpen(false);
    setRenameTarget(null);
  }, []);

  // 拷贝项目
  const handleCopy = useCallback(async (id: string) => {
    const project = await copyProject(id);
    if (project) {
      message.success(`${t('home.copySuccess')}「${project.title}」`);
      await refresh();
    }
  }, [copyProject, t, message, refresh]);

  // 封面上传（本地版）：落项目桶/数据目录，返回 image: 开头的 storageKey，跟项目走并进 zip
  // view = 弹窗内取景记录（sourceKey+scale/tx/ty）；封面 key 指向裁剪好的 16:9 图，
  // 取景记录随新 key 写侧车，仅供再次打开弹窗时回填原图与平移/缩放，渲染端不消费
  const handleCoverConfirm = useCallback(async (file: File, view?: CoverViewRecord) => {
    if (!coverState.target) return;
    const coverId = coverState.target.id;
    let key: string | null = null;
    try {
      key = await setProjectCover(coverId, file);
    } catch (err) {
      console.error('[cover] save failed:', err);
    }
    if (!key) {
      message.error(t('coverUploadHook.coverUploadFailed'));
      return;
    }
    if (view) {
      try {
        await setCoverView(key, view);
      } catch (err) {
        console.warn('[cover] save view failed:', err);
      }
    }

    // 持久化到项目 graph.metadata + 本地元数据（不再上云）
    try {
      const graph = await loadProjectGraph(coverId);
      if (graph) {
        graph.metadata = { ...graph.metadata, coverUrl: key };
        await saveProjectGraph(coverId, graph);
      }
    } catch (err) {
      console.warn('[cover] save to graph metadata failed:', err);
    }

    await updateProject(coverId, { thumbnailUrl: key });

    // 覆盖成功 → 清理旧裁剪产物与旧原图(孤儿文件),排除仍在用的新封面 key 与新原图 sourceKey
    const oldKey = coverState.target.thumbnailUrl;
    if (oldKey && oldKey !== key) {
      try {
        const oldView = await getCoverView(oldKey);
        const stale = [oldKey, oldView?.sourceKey].filter(
          (k): k is string => !!k && k !== key && k !== view?.sourceKey,
        );
        await Promise.all(stale.map((k) => deleteCoverImage(k)));
        await clearCoverView(oldKey);
      } catch (err) {
        console.warn('[cover] cleanup old cover failed:', err);
      }
    }

    message.success('封面设置成功');
    closeCoverUpload();
    await refresh();
  }, [coverState.target, closeCoverUpload, refresh, message, t]);

  const refreshProjects = useCallback(async () => {
    if (selectedIds.size === 0 || busy) return;
    setBusy(true);
    try {
      await exportProjects(Array.from(selectedIds), `zeroexo-${selectedIds.size}projects`);
    } catch (err) {
      message.error(t('home.exportFailed'));
    } finally {
      setBusy(false);
    }
  }, [selectedIds, busy, t, message]);

  const hasSelection = selectedIds.size > 0;
  const deleteTargetCount = pendingDeleteId ? 1 : selectedIds.size;

  if (loading) {
    return (
      <AntdThemeProvider>
        <div style={pageStyle}>
          <div style={toolbarStyle(theme, isMobile)}>
            <Skeleton.Input active size="small" style={{ width: 100, borderRadius: 4 }} />
            <Space size={8}>
              <Skeleton.Input active size="small" style={{ width: 220, borderRadius: 4 }} />
              <Skeleton.Button active size="small" style={{ borderRadius: 6 }} />
              <Skeleton.Button active size="small" style={{ borderRadius: 6 }} />
              <Skeleton.Button active size="small" style={{ borderRadius: 6 }} />
            </Space>
          </div>
          <div style={contentScrollStyle}>
            <div style={gridStyle(isMobile)}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <Skeleton.Image active style={{ width: '100%', height: 160, borderRadius: 12 }} />
                  <Skeleton.Input active size="small" style={{ width: '55%', borderRadius: 4 }} />
                  <Skeleton.Input active size="small" style={{ width: '35%', borderRadius: 4 }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </AntdThemeProvider>
    );
  }

  return (
    <AntdThemeProvider>
      <div style={pageStyle}>
        {error && (
          <div style={errorStyle}>
            {t('home.loadFailed')}: {error}
          </div>
        )}

        <div style={toolbarStyle(theme, isMobile)}>
          <Title level={4} style={{ margin: 0, whiteSpace: 'nowrap' }}>
            {t('nav.projects')}
          </Title>

          <div style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            minWidth: 0,
          }}>
            <SearchButton
              value={search}
              onChange={setSearch}
              placeholder={t('home.searchPlaceholder')}
              theme={theme}
            />

            <div style={{ display: 'flex', flexWrap: 'nowrap', gap: 8, alignItems: 'center', minWidth: 0 }}>
              {/* 新建按钮（首位） */}
              <Tooltip title={t('home.newProject')}>
                <Button type="primary" icon={<Plus size={14} />} size="small" onClick={handleCreate} disabled={busy} />
              </Tooltip>

              {/* 数据目录入口已上收到顶栏 */}

              {selectMode && displayForSelect.length > 0 && (
                <Button
                  size="small"
                  onClick={() => {
                    if (selectedIds.size === displayForSelect.length) {
                      setSelectedIds(new Set());
                    } else {
                      setSelectedIds(new Set(displayForSelect.map((p) => p.id)));
                    }
                  }}
                >
                  {selectedIds.size === displayForSelect.length ? '取消全选' : '全选'}
                </Button>
              )}

              {selectMode && hasSelection && (
                <Tooltip title={`${t('home.deleteSelected')}(${selectedIds.size})`}>
                  <Button
                    icon={<Trash2 size={14} />}
                    size="small"
                    danger
                    onClick={handleBatchDelete}
                  />
                </Tooltip>
              )}

              {selectMode && hasSelection && (
                <Tooltip title={t('home.exportZip')}>
                  <Button
                    icon={<Download size={14} />}
                    size="small"
                    onClick={refreshProjects}
                    disabled={busy}
                  />
                </Tooltip>
              )}

              {/* 多选按钮（末位） */}
              {allProjects.length > 0 && (
                <Tooltip title={selectMode ? t('home.exitSelect') : t('home.selectMode')}>
                  <Button
                    icon={selectMode ? <CheckSquare size={14} /> : <Square size={14} />}
                    size="small"
                    onClick={selectMode ? exitSelectMode : enterSelectMode}
                  />
                </Tooltip>
              )}
            </div>
          </div>
        </div>

        <div style={contentScrollStyle}>
          {isEmpty ? (
              <div style={emptyStyle()}>
                <div
                  style={emptyIconStyle}
                  onClick={handleCreate}
                  title={t('home.newProject')}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleCreate(); }}
                >
                  <Plus size={32} style={{ opacity: 0.3 }} />
                </div>
                <Text strong style={{ fontSize: 15, marginBottom: 4 }}>
                  {t('home.empty')}
                </Text>
                <Text type="secondary" style={{ fontSize: 12, marginBottom: 16 }}>
                  {search ? t('home.searchPlaceholder') : t('home.emptyHint')}
                </Text>
              </div>
          ) : (
            <div style={gridStyle(isMobile)}>
              {!selectMode && (
                <ProjectCard variant="create" onClick={handleCreate} />
              )}
              {listForRender.map((project, index) => {
                const actions: ProjectCardAction[] = [
                  {
                    type: 'cover',
                    onClick: () => openCoverUpload(project.id, project.thumbnailUrl),
                  },
                  {
                    type: 'copy',
                    onClick: () => handleCopy(project.id),
                  },
                  {
                    type: 'rename',
                    onClick: () => handleRenameOpen(project.id, project.title),
                  },
                  { type: 'delete', onClick: () => handleDelete(project.id) },
                ];
                return (
                  <div
                    key={project.id}
                    style={{
                      animation: 'zeroexo-fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
                      animationDelay: `${Math.min(index * 40, 400)}ms`,
                    }}
                  >
                    <ProjectCard
                      title={project.title}
                      cover={project.thumbnailUrl ?? undefined}
                      updateTime={`${t('home.updatedAt')} ${new Date(project.updatedAt).toLocaleDateString()}`}
                      onClick={() => {
                        if (selectMode) { handleToggleSelect(project.id); return; }
                        onOpen(project.id);
                      }}
                      actions={actions}
                      selected={selectedIds.has(project.id)}
                      onToggleSelect={selectMode ? () => handleToggleSelect(project.id) : undefined}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <Modal
          title={t('home.deleteConfirmTitle')}
          open={deleteConfirmOpen}
          onOk={confirmDelete}
          onCancel={cancelDelete}
          okText={t('home.delete')}
          cancelText={t('home.cancel')}
          okButtonProps={{ danger: true }}
          destroyOnHidden
          centered
        >
          <Text>
            {t('home.deleteConfirm')}
            <Text strong>（{deleteTargetCount} 个）</Text>
          </Text>
        </Modal>

        {/* 重命名弹窗 */}
        <Modal
          title={t('home.rename')}
          open={renameModalOpen}
          onOk={handleRenameConfirm}
          onCancel={handleRenameCancel}
          okText={t('common.confirm')}
          cancelText={t('common.cancel')}
          destroyOnHidden
          centered
        >
          <Input
            value={renameTarget?.title ?? ''}
            onChange={(e) => setRenameTarget((prev) => prev ? { ...prev, title: e.target.value } : null)}
            onPressEnter={handleRenameConfirm}
            autoFocus
          />
        </Modal>

        <Modal
          title={t('home.createCanvas')}
          open={createModalOpen}
          onOk={handleCreateConfirm}
          onCancel={handleCreateCancel}
          okText={t('common.confirm')}
          cancelText={t('common.cancel')}
          destroyOnHidden
          centered
          forceRender
        >
          <Form form={form} layout="vertical" autoComplete="off" initialValues={{ title: '' }}>
            <Form.Item
              name="title"
              label={t('home.canvasName')}
              rules={[{ max: 100, message: t('home.canvasNameMaxLength') }]}
            >
              <Input
                placeholder="为项目命名（可选，留空将自动命名）"
                autoFocus
                onPressEnter={handleCreateConfirm}
              />
            </Form.Item>
          </Form>
        </Modal>

        {/* 封面上传弹窗 */}
        {coverState.target && (
          <CoverUploadModal
            open={coverState.modalOpen}
            onCancel={closeCoverUpload}
            onConfirm={handleCoverConfirm}
            initialCover={coverState.target.thumbnailUrl ?? undefined}
          />
        )}

      </div>
    </AntdThemeProvider>
  );
}

// ===== 样式 =====
const pageStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  width: '100%',
  overflow: 'hidden',
};

const errorStyle: CSSProperties = {
  padding: '8px 12px',
  marginBottom: 12,
  borderRadius: 8,
  background: 'rgba(239,68,68,0.1)',
  border: '1px solid rgba(239,68,68,0.3)',
  fontSize: 12,
};

const contentScrollStyle: CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: 24,
};

function toolbarStyle(_theme: { toolbar: { border: string } }, isMobile: boolean): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    padding: isMobile ? '10px 12px' : '12px 20px',
    flexShrink: 0,
    gap: 16,
  };
}

function gridStyle(isMobile: boolean): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: isMobile
      ? '1fr'
      : 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: isMobile ? 12 : 20,
    alignContent: 'start',
  };
}

function emptyStyle(): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: 12,
    padding: '60px 20px',
  };
}

const emptyIconStyle: CSSProperties = {
  width: 64,
  height: 64,
  borderRadius: 16,
  border: '2px dashed rgba(128,128,128,0.25)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  transition: 'all .2s',
};
